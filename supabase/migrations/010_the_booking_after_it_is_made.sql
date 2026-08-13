-- ============================================================
-- Axis Training Systems — 010: the booking after it is made
-- ============================================================
--
-- Today a booking ends at the confirmation screen. The client is told "your
-- coach will confirm within 24 hours", and then:
--
--   * nothing ever tells them it was confirmed — `status` flips in an admin
--     panel and no signal leaves the building;
--   * they cannot cancel. A client who cannot cancel does not cancel, they
--     no-show, and the coach loses the hour instead of getting it back;
--   * they cannot move it, so a clash means booking a second call and leaving
--     the first one sitting on the calendar;
--   * nothing reminds them it is happening.
--
-- Four things, then. A bearer token that identifies the booking without an
-- account. Columns that record what happened to it. A notification queue with
-- the times already computed. And a rate limiter, because the public booking
-- endpoint has never had one.
--
-- Re-runnable.
-- ============================================================


-- ── 1. The token ────────────────────────────────────────────────────────────
--
-- Axis has no client accounts and this migration is not the place to invent
-- them, so the link in the confirmation email IS the credential: 122 bits from
-- gen_random_uuid(), unguessable, one per booking.
--
-- It is a bearer token — anyone holding the link can cancel that booking — and
-- it is scoped to exactly one row, so the worst case is the same as forwarding
-- your own confirmation email to someone. What makes that acceptable is that it
-- never leaves the server on any other path: `bookings` is revoked from anon in
-- full (005), and `booking-manage` is the only reader.
--
-- The coach and admin portals CAN read it — RLS lets them read their own rows,
-- and this column is in those rows. That grants them nothing they do not
-- already have (a coach can cancel their own bookings from the portal), but it
-- would copy a live credential into a browser for no reason, so neither staff
-- screen selects it: see BOOKING_STAFF_COLUMNS in src/types/database.ts, which
-- exists so that nobody reaches for `select('*')` here.
--
-- Adding it NOT NULL with a volatile default rewrites the table and evaluates
-- the default per row, so every booking that already exists gets its own token
-- rather than all of them sharing one.

alter table public.bookings add column if not exists manage_token uuid not null default gen_random_uuid();

create unique index if not exists bookings_manage_token_idx on public.bookings (manage_token);


-- ── 2. What happened to it ──────────────────────────────────────────────────
--
-- `status` says where a booking IS. These say how it got there, and by whose
-- hand — a call the client dropped and a call the coach dropped are the same
-- status and very different facts, and the one screen where the difference
-- matters is the one where a coach is deciding whether to chase someone.
--
-- `rescheduled_from` holds the ORIGINAL instant, not the previous one: after
-- two moves what a coach wants to know is "this started life as Tuesday", and
-- the intermediate hop is noise. The counter is what stops a booking being
-- dragged around the calendar indefinitely.

alter table public.bookings add column if not exists confirmed_at        timestamptz;
alter table public.bookings add column if not exists cancelled_at        timestamptz;
alter table public.bookings add column if not exists cancelled_by        text;
alter table public.bookings add column if not exists cancellation_reason text;
alter table public.bookings add column if not exists rescheduled_from    timestamptz;
alter table public.bookings add column if not exists reschedule_count    int not null default 0;

alter table public.bookings drop constraint if exists bookings_cancelled_by_check;
alter table public.bookings add  constraint bookings_cancelled_by_check
  check (cancelled_by is null or cancelled_by in ('client', 'coach', 'admin'));

-- A cancelled booking has to say when. Anything reading "cancelled" and
-- reaching for the timestamp should never find NULL there.
alter table public.bookings drop constraint if exists bookings_cancelled_shape;
alter table public.bookings add  constraint bookings_cancelled_shape
  check (status <> 'cancelled' or cancelled_at is not null);

-- Backfill before the constraint can be violated by an existing row. Rows
-- cancelled before this file existed have no honest timestamp, so they take
-- their creation time and an explicitly unknown hand.
update public.bookings
   set cancelled_at = coalesce(cancelled_at, created_at, now())
 where status = 'cancelled' and cancelled_at is null;

-- `confirmed_at` for the same reason, in the other direction: a booking already
-- sitting at 'confirmed' was confirmed by somebody at some point, and NULL here
-- would make "confirmed but never confirmed" a state the reminder copy has to
-- reason about.
update public.bookings
   set confirmed_at = coalesce(confirmed_at, created_at, now())
 where status = 'confirmed' and confirmed_at is null;


-- Keep the two in step from here on, in the database rather than in whichever
-- of the three writers (booking-update, booking-manage, the admin panel)
-- happens to be doing the writing. A status is not a timestamp; forgetting one
-- while setting the other is the normal way these drift.
create or replace function public.bookings_stamp_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;

  if new.status = 'cancelled' and (tg_op = 'INSERT' or old.status is distinct from 'cancelled') then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.cancelled_by := coalesce(new.cancelled_by, 'coach');
  end if;

  -- Un-cancelling is a real thing a coach does after a phone call. Clearing the
  -- cancellation is part of it: leaving the timestamp behind means every later
  -- reader sees a live booking that claims to have been cancelled.
  if new.status <> 'cancelled' and tg_op = 'UPDATE' and old.status = 'cancelled' then
    new.cancelled_at        := null;
    new.cancelled_by        := null;
    new.cancellation_reason := null;
  end if;

  return new;
end
$$;

drop trigger if exists bookings_stamp_status_trg on public.bookings;
create trigger bookings_stamp_status_trg
  before insert or update on public.bookings
  for each row execute function public.bookings_stamp_status();


-- ── 3. The notification queue ───────────────────────────────────────────────
--
-- What goes out, when, and — once it has gone — the record that it did.
--
-- Idempotency is a unique index, not a flag. A cron that fires twice, a
-- dispatcher invoked by hand while the scheduled one is mid-sweep, a trigger
-- that runs again because someone re-saved the row: all of them collide on
-- (booking_id, kind, channel, recipient, scheduled_for) and the second insert is
-- a no-op. Nothing anywhere has to remember what it did.
--
-- `scheduled_for` is IN the key on purpose. A rescheduled booking gets new
-- reminder instants, which are new rows by definition, while the old unsent
-- ones are deleted below. Keying without it would silently swallow the second
-- reminder of a moved call.
--
-- So is `recipient`. A cancellation goes to the client AND to the coach, at the
-- same instant, with the same kind — two rows that differ only in who they are
-- addressed to. Leave the address out of the key and the second one is quietly
-- absorbed by the conflict clause, which is a coach who never learns their 9am
-- is off.

-- `confirmation` and `confirmed` are two different emails and the distinction is
-- the whole point of this file. The first says we have your booking and your
-- coach will come back to you; the second says they have. Collapsing them into
-- one kind means either the client is told twice that we received something, or
-- the moment they were actually waiting for arrives silently.

do $do$ begin
  create type public.booking_notification_kind as enum (
    'confirmation',   -- to the client, immediately: we have your request
    'confirmed',      -- to the client, when the coach accepts it
    'coach_alert',    -- to the coach, immediately: someone booked you
    'reminder_24h',
    'reminder_2h',
    'cancellation',
    'reschedule'
  );
exception when duplicate_object then null; end $do$;

create table if not exists public.booking_notifications (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id) on delete cascade,
  kind          public.booking_notification_kind not null,
  channel       text not null default 'email' check (channel in ('email')),
  recipient     text not null,
  scheduled_for timestamptz not null,
  sent_at       timestamptz,
  attempts      int  not null default 0,
  last_error    text,
  created_at    timestamptz not null default now()
);

create unique index if not exists booking_notifications_idem_idx
  on public.booking_notifications (booking_id, kind, channel, recipient, scheduled_for);

-- The dispatcher's only query: unsent work that is due. Attempts are capped in
-- the predicate so a permanently-failing address stops being swept forever.
create index if not exists booking_notifications_due_idx
  on public.booking_notifications (scheduled_for)
  where sent_at is null and attempts < 5;

alter table public.booking_notifications enable row level security;

-- No policies at all. WHO: nobody except service_role, which bypasses RLS. This
-- is machine plumbing carrying a client's email address; no visitor and no
-- coach reads it. Grants revoked so a client role gets a permission error
-- rather than an empty result and the wrong conclusion.
revoke all on public.booking_notifications from anon, authenticated;


-- ── 4. Enqueueing ───────────────────────────────────────────────────────────
--
-- The times are computed once, here, at the moment the booking changes — not
-- re-derived by a dispatcher that would then have to agree with this file about
-- what "24 hours before" means.
--
-- A reminder whose instant has already passed is never queued. Booking a call
-- for tomorrow morning should not fire a "24 hours to go" email that is already
-- wrong, and the 2-hour reminder for a call booked 90 minutes out is a
-- notification about the past.

-- Goes to the CLIENT. There is no recipient argument on purpose: an argument
-- that defaults to the client's address is one NULL away from mailing them
-- something addressed to their coach, which is exactly what a `coalesce(
-- p_recipient, p_booking.email)` does the moment the coach lookup comes back
-- empty. Who a message is for is a property of which function queued it.
create or replace function public.booking_enqueue(
  p_booking public.bookings,
  p_kind    public.booking_notification_kind,
  p_when    timestamptz
) returns void
language sql
as $$
  insert into public.booking_notifications (booking_id, kind, recipient, scheduled_for)
  select p_booking.id, p_kind, p_booking.email, greatest(p_when, now())
  where p_when > now() - interval '1 minute'
    and p_booking.email is not null
  on conflict (booking_id, kind, channel, recipient, scheduled_for) do nothing
$$;

-- Goes to the COACH. A NULL address means the coach has notifications off (or
-- has no row), and the message is simply not queued — never redirected.
create or replace function public.booking_enqueue_coach(
  p_booking   public.bookings,
  p_kind      public.booking_notification_kind,
  p_when      timestamptz,
  p_recipient text
) returns void
language sql
as $$
  insert into public.booking_notifications (booking_id, kind, recipient, scheduled_for)
  select p_booking.id, p_kind, p_recipient, greatest(p_when, now())
  where p_recipient is not null
    and p_when > now() - interval '1 minute'
  on conflict (booking_id, kind, channel, recipient, scheduled_for) do nothing
$$;

-- The coach's own address, and only when they asked to hear about it.
-- `coach_routing.notify` is the same switch that governs application emails, so
-- a coach who turned notifications off does not start getting booking mail
-- because a different table learned how to send it.
create or replace function public.coach_notify_email(p_coach_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select email from public.coach_routing
   where coach_slug = p_coach_slug and notify and email is not null and email <> ''
   limit 1
$$;

revoke all on function public.coach_notify_email(text) from public;

create or replace function public.bookings_enqueue_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved       boolean;
  v_coach_email text := public.coach_notify_email(new.coach_slug);
begin
  if tg_op = 'INSERT' then
    if new.status <> 'cancelled' then
      perform public.booking_enqueue(new, 'confirmation', now());
      perform public.booking_enqueue_coach(new, 'coach_alert', now(), v_coach_email);
      perform public.booking_enqueue(new, 'reminder_24h', new.booked_at - interval '24 hours');
      perform public.booking_enqueue(new, 'reminder_2h',  new.booked_at - interval '2 hours');
    end if;
    return new;
  end if;

  -- ── Cancelled ─────────────────────────────────────────────────────────────
  -- Unsent reminders for a call that is not happening are deleted, not left to
  -- be filtered by the dispatcher. A queue you have to remember to read
  -- carefully is a queue that eventually sends a reminder for a cancelled call.
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    delete from public.booking_notifications
     where booking_id = new.id
       and sent_at is null
       and kind in ('reminder_24h', 'reminder_2h', 'confirmation', 'confirmed');
    perform public.booking_enqueue(new, 'cancellation', now());
    perform public.booking_enqueue_coach(new, 'cancellation', now(), v_coach_email);
    return new;
  end if;

  v_moved := new.booked_at is distinct from old.booked_at
          or new.duration_minutes is distinct from old.duration_minutes;

  if v_moved and new.status <> 'cancelled' then
    delete from public.booking_notifications
     where booking_id = new.id
       and sent_at is null
       and kind in ('reminder_24h', 'reminder_2h');
    perform public.booking_enqueue(new, 'reschedule', now());
    perform public.booking_enqueue_coach(new, 'reschedule', now(), v_coach_email);
    perform public.booking_enqueue(new, 'reminder_24h', new.booked_at - interval '24 hours');
    perform public.booking_enqueue(new, 'reminder_2h',  new.booked_at - interval '2 hours');
    return new;
  end if;

  -- A coach confirming a booking the client was told to expect confirmation of
  -- is the one status change worth an email on its own — and it is the email
  -- the client has actually been waiting for since the confirmation screen said
  -- "your coach will confirm within 24 hours".
  if new.status = 'confirmed' and old.status = 'pending' then
    perform public.booking_enqueue(new, 'confirmed', now());
  end if;

  return new;
end
$$;

revoke all on function public.booking_enqueue(public.bookings, public.booking_notification_kind, timestamptz) from public;
revoke all on function public.booking_enqueue_coach(public.bookings, public.booking_notification_kind, timestamptz, text) from public;
revoke all on function public.bookings_enqueue_notifications() from public;

drop trigger if exists bookings_enqueue_notifications_trg on public.bookings;
create trigger bookings_enqueue_notifications_trg
  after insert or update on public.bookings
  for each row execute function public.bookings_enqueue_notifications();


-- ── 4b. Claiming ────────────────────────────────────────────────────────────
--
-- `booking-notify` runs on a schedule and can also be poked by hand. Two of
-- them overlapping must not both send the same reminder, so work is CLAIMED
-- rather than selected: `for update skip locked` hands each row to exactly one
-- caller, and the attempt is counted at claim time, not at send time.
--
-- Counting on claim rather than on failure is deliberate. A dispatcher that
-- crashes mid-send has already burned the attempt, which is what stops a
-- message that reliably kills the sender from being retried for ever. Five
-- attempts and it stops being swept — the row stays, unsent, with its last
-- error, which is a record rather than a silent drop.
--
-- The join is done here so the sender gets everything it needs in one round
-- trip and cannot accidentally read a booking it was not handed.

create or replace function public.claim_booking_notifications(p_limit int default 25)
returns table (
  notification_id  uuid,
  kind             public.booking_notification_kind,
  recipient        text,
  booking_id       uuid,
  coach_slug       text,
  booked_at        timestamptz,
  duration_minutes int,
  first_name       text,
  last_name        text,
  client_email     text,
  status           text,
  service_name     text,
  goals            text,
  meet_url         text,
  manage_token     uuid,
  time_zone        text,
  cancellation_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    update public.booking_notifications n
       set attempts = n.attempts + 1
     where n.id in (
       select id from public.booking_notifications
        where sent_at is null
          and attempts < 5
          and scheduled_for <= now()
        order by scheduled_for
        for update skip locked
        limit p_limit
     )
    returning n.id, n.kind, n.recipient, n.booking_id
  )
  select
    c.id, c.kind, c.recipient, b.id,
    b.coach_slug, b.booked_at, b.duration_minutes,
    b.first_name, b.last_name, b.email, b.status,
    coalesce(b.service_name, b.service_interest), b.goals, b.google_meet_url,
    b.manage_token,
    coalesce(s.time_zone, 'America/Los_Angeles'),
    b.cancellation_reason
  from claimed c
  join public.bookings b on b.id = c.booking_id
  left join public.coach_public_settings s on s.coach_slug = b.coach_slug;
end
$$;

revoke all     on function public.claim_booking_notifications(int) from public;
grant  execute on function public.claim_booking_notifications(int) to service_role;


-- ── 5. Rate limiting ────────────────────────────────────────────────────────
--
-- `booking-create` validates hard and caps its body size, and has never had any
-- limit on how often it may be called. A loop against it fills a coach's
-- calendar with junk faster than anyone can cancel it, and every row is a real
-- row on a real calendar with a real Google event and now a real email.
--
-- Fixed window rather than a sliding one: the bucket is part of the primary
-- key, so the increment is a single upsert that Postgres serialises for us. A
-- sliding window needs either a row per request or a read-modify-write, and
-- neither is worth it to smooth the edge of a limit measured in bookings per
-- hour.
--
-- Fails CLOSED, unlike most limiters: if this table cannot be written to, the
-- request is refused. It guards writes to a calendar, not reads of a page.

create table if not exists public.request_rate_limits (
  bucket       text        not null,
  subject      text        not null,
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (bucket, subject, window_start)
);

create index if not exists request_rate_limits_sweep_idx on public.request_rate_limits (window_start);

alter table public.request_rate_limits enable row level security;
revoke all on public.request_rate_limits from anon, authenticated;

-- Atomic increment-and-test. The upsert takes a row lock, so two requests
-- arriving together are counted twice rather than both reading 4 and both
-- writing 5.
--
-- `p_subject` is whatever the caller decided identifies the requester — an IP,
-- an email, a coach slug. It is hashed by the caller when it is personal; this
-- function neither knows nor cares.
create or replace function public.rate_limit_hit(
  p_bucket         text,
  p_subject        text,
  p_window_seconds int,
  p_limit          int
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits   int;
begin
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.request_rate_limits (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, v_window, 1)
  on conflict (bucket, subject, window_start)
    do update set hits = public.request_rate_limits.hits + 1
  returning hits into v_hits;

  -- Opportunistic sweep. No cron to forget to schedule, and at one row per
  -- subject per window there is never much to clear.
  if v_hits = 1 and random() < 0.01 then
    delete from public.request_rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end
$$;

revoke all     on function public.rate_limit_hit(text, text, int, int) from public;
grant  execute on function public.rate_limit_hit(text, text, int, int) to service_role;


-- ── 6. Funnel events ────────────────────────────────────────────────────────
--
-- `pageviews` (003) records that /book was opened and nothing about what
-- happened next, so "people land on the booking page and do not book" has never
-- had a next question. These are the five steps between the two.
--
-- The name is a CHECK against a fixed list rather than free text: an
-- anon-writable table with an open string column is a place to store anything,
-- and the analytics panel can only chart what it can name anyway.

create table if not exists public.booking_events (
  id         uuid primary key default gen_random_uuid(),
  session_id text not null,
  name       text not null,
  coach_slug text,
  service_id uuid references public.booking_services (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint booking_events_name_known check (name in (
    'booking_page_view',
    'service_selected',
    'coach_selected',
    'slot_selected',
    'booking_completed',
    'booking_failed',
    'booking_cancelled_by_client',
    'booking_rescheduled_by_client'
  ))
);

create index if not exists booking_events_recent_idx on public.booking_events (created_at desc);
create index if not exists booking_events_funnel_idx on public.booking_events (name, created_at desc);

alter table public.booking_events enable row level security;

drop policy if exists "public_insert_booking_events" on public.booking_events;
drop policy if exists "admin_read_booking_events"    on public.booking_events;

-- WHO: anyone, write-only. A visitor emits their own funnel steps and can read
-- back none of them — not their own, not anyone else's.
create policy "public_insert_booking_events"
  on public.booking_events for insert to anon, authenticated with check (true);

create policy "admin_read_booking_events"
  on public.booking_events for select to authenticated
  using (public.is_content_admin() or public.current_coach_slug() is not null);

revoke all on public.booking_events from anon, authenticated;
grant  insert (session_id, name, coach_slug, service_id) on public.booking_events to anon, authenticated;
grant  select on public.booking_events to authenticated;


-- ── 7. Verify ───────────────────────────────────────────────────────────────
--
--   select count(*) from public.bookings where manage_token is null;   -- 0
--   select public.rate_limit_hit('test', 'x', 60, 2);                  -- t
--   select public.rate_limit_hit('test', 'x', 60, 2);                  -- t
--   select public.rate_limit_hit('test', 'x', 60, 2);                  -- f
--   delete from public.request_rate_limits where bucket = 'test';
