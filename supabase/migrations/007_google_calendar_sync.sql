-- ============================================================
-- Migration 007: Google Calendar two-way sync
-- ============================================================
-- ⚠ NUMBERING: `supabase db push` keys schema_migrations by the numeric version
-- token, which is a primary key, so every migration version must be unique. This
-- repo already uses 004_pending_content.sql, 005_content_rotation.sql and
-- 006_testimonials.sql, so the calendar track is numbered 007 (this file) and
-- 008_booking_rls_lockdown.sql. Apply order is: 001 → 002 → 003 →
-- 004_pending_content → 005_content_rotation → 006_testimonials →
-- 007_google_calendar_sync (this file) → 008_booking_rls_lockdown. Everything
-- here is `if not exists` / `or replace`, so re-running it is a no-op.
--
-- This migration is PURELY ADDITIVE and is safe to apply immediately, before
-- any edge function or frontend is deployed. It breaks nothing: every existing
-- policy, grant and column is left alone. The lockdown (removing anon's read of
-- `bookings` and anon's write to `bookings`) lives in 008_booking_rls_lockdown,
-- which must only run once the edge functions are live.
--
-- What it establishes:
--
--   • schema `private`                     — refresh tokens + OAuth state. No
--                                            client role has USAGE on it, so no
--                                            client role can name the tables at
--                                            all, let alone read them. Not even
--                                            service_role: the edge functions
--                                            reach the data through SECURITY
--                                            DEFINER RPCs in `public` that are
--                                            granted to service_role only.
--   • coach_public_settings                — the coach's IANA time zone. This is
--                                            the ONLY interpretation of the
--                                            wall-clock times in coach_schedules
--                                            and coach_availability_blocks
--                                            (invariant 6).
--   • coach_calendar_busy                  — the single, PII-free busy surface
--                                            the public /book page reads. It
--                                            holds Google freeBusy intervals AND
--                                            a trigger-maintained mirror of our
--                                            own bookings, so the booking page
--                                            never needs to touch `bookings`
--                                            (invariant 2).
--   • bookings.google_*                    — mirror bookkeeping.
--   • google_sync_outbox                   — at-least-once delivery to Google.
--                                            Enqueued in the SAME transaction as
--                                            the booking, so a Google outage can
--                                            never fail a booking (invariant 4).
--   • pg_cron jobs                         — periodic freeBusy re-sync, outbox
--                                            drain, and garbage collection.
--
-- Data minimization: we call Google's freeBusy endpoint, never events.list, so
-- event titles/attendees/locations from a coach's personal calendar never enter
-- this database and therefore cannot leak from it. coach_calendar_busy stores
-- an interval and nothing else.
-- ============================================================


-- ============================================================
-- 1. PRIVATE SCHEMA — nothing in here is reachable by a client role
-- ============================================================

create schema if not exists private;

-- Supabase's default privileges only apply to schema `public`, so a fresh
-- `private` schema starts with no grants. Revoke anyway: this is the single
-- most important line in the file and it must not depend on a default.
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
revoke all on schema private from service_role;

-- Operator-supplied config for the pg_cron jobs (project URL, service role key,
-- and the calendar-sync cron secret). Lives in `private` because the service
-- role key and the cron secret are both bearer credentials: they must never sit
-- in `admin_config`, which every authenticated coach can read. Populate by hand
-- after applying:
--   update private.app_settings set value = 'https://<ref>.supabase.co' where key = 'project_url';
--   update private.app_settings set value = '<service-role-key>'        where key = 'service_role_key';
--   update private.app_settings set value = '<CALENDAR_SYNC_CRON_SECRET>' where key = 'cron_secret';
-- `cron_secret` MUST equal the calendar-sync function's CALENDAR_SYNC_CRON_SECRET
-- Function Secret; it is sent as the X-Cron-Secret header so calendar-sync
-- recognises the poll as a trusted cron caller (service-role-mode) rather than a
-- coach JWT. A Bearer service-role key alone is not enough — without the secret
-- calendar-sync falls through to the coach-JWT branch and returns 403.
create table if not exists private.app_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

insert into private.app_settings (key, value) values
  ('project_url',      ''),
  ('service_role_key', ''),
  ('cron_secret',      '')
on conflict (key) do nothing;

-- A coach's Google credential. `refresh_token_enc` is AES-256-GCM ciphertext,
-- base64 of iv ‖ ciphertext ‖ tag; the key lives in the edge functions' secret
-- store (GOOGLE_TOKEN_ENC_KEY), never in Postgres. That is deliberate: a leaked
-- pg_dump, a leaked service_role key, and a forgotten `revoke ... from public`
-- on an RPC are all non-events, because none of them yield the key.
create table if not exists private.coach_calendar_connections (
  coach_slug               text primary key,
  google_email             text,
  refresh_token_enc        text not null,
  access_token_enc         text,
  access_token_expires_at  timestamptz,
  calendar_id              text not null default 'primary',
  scopes                   text,

  -- Reserved for v2 push notifications / incremental sync. Unused today; the
  -- cron poll is the only sync mechanism.
  sync_token               text,
  channel_id               text,
  channel_resource_id      text,
  channel_expires_at       timestamptz,

  last_synced_at           timestamptz,
  last_sync_error          text,
  connected_at             timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Single-use OAuth state. The coach_slug is written here from the VERIFIED JWT
-- at /oauth-start and read back at /oauth-callback, which is why the callback
-- never has to trust a slug from the query string (invariant 3).
create table if not exists private.oauth_states (
  state         text primary key,
  coach_slug    text not null,
  code_verifier text,
  redirect_to   text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '10 minutes',
  consumed_at   timestamptz
);

create index if not exists oauth_states_expires_idx
  on private.oauth_states (expires_at);

-- Belt and braces. The real gate is the absent USAGE on schema `private`; RLS
-- with zero policies means that even if a client role somehow acquired USAGE
-- and SELECT, it would still read zero rows.
alter table private.app_settings                enable row level security;
alter table private.coach_calendar_connections  enable row level security;
alter table private.oauth_states                enable row level security;

revoke all on all tables in schema private from public, anon, authenticated, service_role;


-- ============================================================
-- 2. COACH PUBLIC SETTINGS — the time zone that gives meaning to wall-clock
-- ============================================================
-- coach_schedules.start_time / coach_availability_blocks.block_date are
-- wall-clock in THIS zone. Nothing else defines them. The public booking page
-- reads (coach_slug, time_zone) and nothing more.

create table if not exists public.coach_public_settings (
  coach_slug text primary key,
  time_zone  text not null default 'America/Los_Angeles',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Rejects anything Postgres cannot resolve as a zone. A bad zone here silently
  -- corrupts every slot the coach ever offers, so it fails at write time. Fixed
  -- timestamp literal because a CHECK may only call IMMUTABLE functions.
  constraint coach_public_settings_tz_valid
    check ((timestamp '2000-01-01 12:00' at time zone time_zone) is not null)
);

-- Axis is Fresno-based; Pacific is the right default for the whole roster.
insert into public.coach_public_settings (coach_slug, time_zone) values
  ('ronnie-vallejo', 'America/Los_Angeles'),
  ('seth-burman',    'America/Los_Angeles'),
  ('lucas-sison',    'America/Los_Angeles'),
  ('kobe-pham',      'America/Los_Angeles'),
  ('aedan-nguyen',   'America/Los_Angeles')
on conflict (coach_slug) do nothing;


-- ============================================================
-- 3. COACH CALENDAR BUSY — the PII-free busy surface
-- ============================================================
-- Two sources, one table:
--   source = 'google'  → an interval from Google freeBusy. Wiped and re-written
--                        wholesale for the sync window on each poll.
--   source = 'booking' → a mirror of one of our own bookings, maintained by
--                        trigger so it is always exactly in step with the
--                        `bookings` row, in the same transaction.
--
-- The public page reads (coach_slug, starts_at, ends_at). Nothing else is
-- granted to anon — not `source`, not `booking_id`.

create table if not exists public.coach_calendar_busy (
  id         uuid primary key default gen_random_uuid(),
  coach_slug text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  source     text not null check (source in ('google', 'booking')),
  booking_id uuid references public.bookings (id) on delete cascade,
  synced_at  timestamptz not null default now(),

  constraint coach_calendar_busy_interval_valid check (ends_at > starts_at),
  -- A 'booking' row is a mirror: exactly one per booking, and it must name it.
  -- A 'google' row must not.
  constraint coach_calendar_busy_source_shape check (
    (source = 'booking' and booking_id is not null)
    or (source = 'google' and booking_id is null)
  )
);

-- The only query the booking page runs: "busy intervals for this coach that
-- have not finished yet". An interval query, not a start-time query (B16).
create index if not exists coach_calendar_busy_lookup_idx
  on public.coach_calendar_busy (coach_slug, ends_at);

create index if not exists coach_calendar_busy_starts_idx
  on public.coach_calendar_busy (coach_slug, starts_at);

create unique index if not exists coach_calendar_busy_booking_idx
  on public.coach_calendar_busy (booking_id) where booking_id is not null;

alter table public.coach_calendar_busy enable row level security;

drop policy if exists "public_read_busy" on public.coach_calendar_busy;

-- WHO: everyone, signed in or not. The public /book page must know which
-- instants are taken. Column grants below limit anon to (coach_slug, starts_at,
-- ends_at) — an anon SELECT * on this table is a permission error, by design.
create policy "public_read_busy"
  on public.coach_calendar_busy for select to anon, authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policy exists for anon or authenticated: writes come
-- exclusively from the sync edge function (service_role, which bypasses RLS) and
-- from the SECURITY DEFINER mirror trigger below. Revoking the DML grants means
-- a missing policy fails closed as a permission error rather than a silent
-- zero-row write.
revoke all    on public.coach_calendar_busy from anon, authenticated;
grant  select (coach_slug, starts_at, ends_at) on public.coach_calendar_busy to anon;
grant  select on public.coach_calendar_busy to authenticated;


-- ============================================================
-- 4. BOOKINGS — Google mirror bookkeeping
-- ============================================================

alter table public.bookings add column if not exists google_event_id     text;
alter table public.bookings add column if not exists google_calendar_id  text;
alter table public.bookings add column if not exists google_meet_url     text;
alter table public.bookings add column if not exists google_synced_at    timestamptz;
alter table public.bookings add column if not exists google_sync_error   text;
alter table public.bookings add column if not exists google_sync_status  text not null default 'pending';

-- 'skipped' is a fully supported terminal state, not an error: a coach who has
-- not connected Google books exactly like one who has (invariant 4).
alter table public.bookings drop constraint if exists bookings_google_sync_status_check;
alter table public.bookings add  constraint bookings_google_sync_status_check
  check (google_sync_status in ('pending', 'synced', 'skipped', 'failed'));

-- The end instant of a booking, derived rather than stored twice. Busy is an
-- interval; every query against it is an interval query (B16).
--
-- ── Why the wrapper function ──
--
-- The obvious spelling — `generated always as (booked_at + make_interval(mins
-- => duration_minutes)) stored` — is REJECTED by PostgreSQL:
--
--   ERROR: generation expression is not immutable
--
-- `make_interval` is immutable, but the `+` operator on timestamptz
-- (`timestamptz_pl_interval`) is only STABLE, because an interval carrying a
-- month or day component has to be resolved against the session's TimeZone to
-- know how long it is. A generated column may only use immutable expressions,
-- so the whole ALTER fails and — since this file is one transaction — so does
-- every statement after it. That is not a version quirk; it is true on 14, 15,
-- 16 and 17 alike.
--
-- An interval built only from MINUTES has no such ambiguity: minutes are a
-- fixed quantity of elapsed time in every zone, DST transitions included. So
-- the addition genuinely is immutable for this argument shape, and marking it
-- so is a statement of fact rather than a way around the check.
--
-- Verify, across a spring-forward boundary in Los Angeles — 01:30 PST plus two
-- hours of elapsed time is 04:30 PDT, not 03:30:
--
--   select public.booking_ends_at('2026-03-08 01:30:00-08', 120);
--   -- 2026-03-08 04:30:00-07

create or replace function public.booking_ends_at(p_start timestamptz, p_minutes int)
returns timestamptz
language sql
immutable
strict
as $$
  select p_start + make_interval(mins => p_minutes)
$$;

alter table public.bookings add column if not exists ends_at timestamptz
  generated always as (public.booking_ends_at(booked_at, duration_minutes)) stored;

create index if not exists bookings_coach_ends_idx
  on public.bookings (coach_slug, ends_at) where status <> 'cancelled';

create index if not exists bookings_sync_status_idx
  on public.bookings (google_sync_status) where google_sync_status = 'pending';


-- ============================================================
-- 5. OUTBOX — at-least-once delivery to Google
-- ============================================================
-- The bookings row is authoritative and commits first. The outbox row commits
-- with it. Google is contacted afterwards, out of band. A Google outage
-- therefore delays a calendar event; it can never fail a booking.

create table if not exists public.google_sync_outbox (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.bookings (id) on delete cascade,
  coach_slug      text not null,
  op              text not null check (op in ('create', 'update', 'cancel')),
  attempts        int  not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- The drainer's only query: unfinished work that is due.
create index if not exists google_sync_outbox_due_idx
  on public.google_sync_outbox (next_attempt_at)
  where completed_at is null;

alter table public.google_sync_outbox enable row level security;

-- No policies at all. WHO: nobody except service_role, which bypasses RLS. The
-- outbox is machine plumbing; no coach and no visitor has any business reading
-- or writing it. Grants revoked so a client role gets a permission error rather
-- than an empty result and a wrong conclusion.
revoke all on public.google_sync_outbox from anon, authenticated;


-- ============================================================
-- 6. IDENTITY HELPERS
-- ============================================================
-- Every function below is SECURITY DEFINER with `set search_path = ''` (so a
-- caller cannot shadow a table name with a temp table) and an explicit
-- `revoke ... from public` (Postgres grants EXECUTE TO PUBLIC by default —
-- forgetting this once would turn calendar_connection_get into an anonymous
-- REST endpoint that hands out every coach's Google credential).

-- Re-declared identically to 004_pending_content.sql so this migration is
-- self-contained and order-independent with respect to the content track.
create or replace function public.current_coach_slug()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coach_slug
  from public.coach_routing
  where lower(email) = lower(coalesce(auth.email(), ''))
    and coach_slug is not null
  limit 1
$$;

revoke all     on function public.current_coach_slug() from public;
grant  execute on function public.current_coach_slug() to authenticated, service_role;

-- `coach_slug` as DATA, not as authorization: booking-create takes the slug from
-- the request body (which coach am I booking?) and validates it exists. It
-- grants no privilege, so validating it is enough (invariant 3).
create or replace function public.coach_slug_exists(p_coach_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.coach_routing
    where coach_slug = p_coach_slug
  )
$$;

revoke all     on function public.coach_slug_exists(text) from public;
grant  execute on function public.coach_slug_exists(text) to anon, authenticated, service_role;


-- ============================================================
-- 7. CONNECTION RPCs
-- ============================================================
-- The tables live in `private`, which no client role can even name. These
-- SECURITY DEFINER wrappers in `public` are the only doors, and every door that
-- can see a refresh token is granted to service_role alone.

-- WHO: service_role only (the oauth-callback edge function).
create or replace function public.calendar_connection_upsert(
  p_coach_slug        text,
  p_refresh_token_enc text,
  p_google_email      text default null,
  p_calendar_id       text default 'primary',
  p_scopes            text default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.coach_calendar_connections
    (coach_slug, refresh_token_enc, google_email, calendar_id, scopes, connected_at, updated_at)
  values
    (p_coach_slug, p_refresh_token_enc, p_google_email, coalesce(p_calendar_id, 'primary'), p_scopes, now(), now())
  on conflict (coach_slug) do update set
    refresh_token_enc = excluded.refresh_token_enc,
    google_email      = coalesce(excluded.google_email, private.coach_calendar_connections.google_email),
    calendar_id       = excluded.calendar_id,
    scopes            = excluded.scopes,
    last_sync_error   = null,
    updated_at        = now()
$$;

revoke all     on function public.calendar_connection_upsert(text, text, text, text, text) from public;
grant  execute on function public.calendar_connection_upsert(text, text, text, text, text) to service_role;

-- WHO: service_role only. Returns ciphertext; the plaintext key is not in this
-- database, so even this function cannot yield a usable token on its own.
create or replace function public.calendar_connection_get(p_coach_slug text)
returns table (
  coach_slug        text,
  google_email      text,
  refresh_token_enc text,
  calendar_id       text,
  sync_token        text,
  last_synced_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.coach_slug, c.google_email, c.refresh_token_enc, c.calendar_id, c.sync_token, c.last_synced_at
  from private.coach_calendar_connections c
  where c.coach_slug = p_coach_slug
$$;

revoke all     on function public.calendar_connection_get(text) from public;
grant  execute on function public.calendar_connection_get(text) to service_role;

-- WHO: service_role only. The cron busy-sync's worklist. Slugs only — no token.
create or replace function public.calendar_connection_list()
returns table (
  coach_slug     text,
  calendar_id    text,
  last_synced_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.coach_slug, c.calendar_id, c.last_synced_at
  from private.coach_calendar_connections c
  order by c.coach_slug
$$;

revoke all     on function public.calendar_connection_list() from public;
grant  execute on function public.calendar_connection_list() to service_role;

-- WHO: service_role only. p_error null on success, an OPAQUE SHORT CODE on
-- failure (B19: never a stringified error, never a URL, never a body — a failed
-- fetch stringifies with its request URL, and that URL can carry an auth code).
create or replace function public.calendar_connection_mark_synced(
  p_coach_slug text,
  p_sync_token text default null,
  p_error      text default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update private.coach_calendar_connections set
    last_synced_at  = case when p_error is null then now() else last_synced_at end,
    sync_token      = coalesce(p_sync_token, sync_token),
    last_sync_error = p_error,
    updated_at      = now()
  where coach_slug = p_coach_slug
$$;

revoke all     on function public.calendar_connection_mark_synced(text, text, text) from public;
grant  execute on function public.calendar_connection_mark_synced(text, text, text) to service_role;

-- WHO: service_role only (the disconnect edge function, after revoking the grant
-- with Google). Drops the coach's Google-sourced busy rows with it — leaving
-- them would block slots forever with no way to clear them.
create or replace function public.calendar_connection_delete(p_coach_slug text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from private.coach_calendar_connections where coach_slug = p_coach_slug;
  delete from public.coach_calendar_busy
   where coach_slug = p_coach_slug and source = 'google';
end
$$;

revoke all     on function public.calendar_connection_delete(text) from public;
grant  execute on function public.calendar_connection_delete(text) to service_role;

-- WHO: the signed-in coach, for their OWN connection, and nobody else. Takes NO
-- arguments — the slug is derived from the verified JWT — so there is no
-- parameter to tamper with, and it returns zero rows for anon by construction
-- (current_coach_slug() is null → the `=` never matches). Returns no token, no
-- ciphertext: connection state and nothing more.
create or replace function public.calendar_connection_status()
returns table (
  connected       boolean,
  google_email    text,
  calendar_id     text,
  last_synced_at  timestamptz,
  last_sync_error text,
  connected_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select true, c.google_email, c.calendar_id, c.last_synced_at, c.last_sync_error, c.connected_at
  from private.coach_calendar_connections c
  where c.coach_slug = public.current_coach_slug()
$$;

revoke all     on function public.calendar_connection_status() from public;
grant  execute on function public.calendar_connection_status() to authenticated;


-- ============================================================
-- 8. OAUTH STATE RPCs
-- ============================================================

-- WHO: service_role only (oauth-start, after it has verified the coach's JWT
-- and derived p_coach_slug from it — never from the request body).
create or replace function public.oauth_state_create(
  p_coach_slug    text,
  p_code_verifier text default null,
  p_redirect_to   text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  v_state := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into private.oauth_states (state, coach_slug, code_verifier, redirect_to)
  values (v_state, p_coach_slug, p_code_verifier, p_redirect_to);

  return v_state;
end
$$;

revoke all     on function public.oauth_state_create(text, text, text) from public;
grant  execute on function public.oauth_state_create(text, text, text) to service_role;

-- WHO: service_role only (oauth-callback). SINGLE USE: the `consumed_at is null`
-- predicate inside the UPDATE is the atomic test-and-set, so a replayed callback
-- returns zero rows. Expired states return zero rows too. Zero rows → the
-- callback must abort; there is no other way for it to learn a coach_slug.
create or replace function public.oauth_state_consume(p_state text)
returns table (
  coach_slug    text,
  code_verifier text,
  redirect_to   text
)
language sql
volatile
security definer
set search_path = ''
as $$
  update private.oauth_states s
     set consumed_at = now()
   where s.state = p_state
     and s.consumed_at is null
     and s.expires_at > now()
  returning s.coach_slug, s.code_verifier, s.redirect_to
$$;

revoke all     on function public.oauth_state_consume(text) from public;
grant  execute on function public.oauth_state_consume(text) to service_role;


-- ============================================================
-- 9. BOOKING → BUSY MIRROR + OUTBOX ENQUEUE (triggers)
-- ============================================================
-- Why triggers and not application code: the mirror and the outbox row must
-- commit in the SAME transaction as the booking, or there exists an interleaving
-- where a booking is durable and its calendar work is not. A trigger is the only
-- place that guarantee is free.
--
-- SECURITY DEFINER because the mirror writes to coach_calendar_busy and
-- google_sync_outbox, on which anon and authenticated deliberately hold no
-- write grant.

create or replace function public.bookings_set_sync_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A coach with no Google connection is a supported state, not an error.
  if new.google_sync_status = 'pending'
     and not exists (
       select 1 from private.coach_calendar_connections
       where coach_slug = new.coach_slug
     )
  then
    new.google_sync_status := 'skipped';
  end if;

  return new;
end
$$;

create or replace function public.bookings_mirror_to_busy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op text;
begin
  -- ── Busy mirror ───────────────────────────────────────────────────────────
  if tg_op = 'DELETE' then
    delete from public.coach_calendar_busy where booking_id = old.id;
    return old;
  end if;

  if new.status = 'cancelled' then
    delete from public.coach_calendar_busy where booking_id = new.id;
  else
    -- `where booking_id is not null` is REQUIRED, not decoration.
    -- coach_calendar_busy_booking_idx is a PARTIAL unique index, and ON CONFLICT
    -- can only infer a partial index when the statement repeats its predicate.
    -- Without it Postgres raises "there is no unique or exclusion constraint
    -- matching the ON CONFLICT specification" — from inside this trigger, on
    -- every single booking insert.
    insert into public.coach_calendar_busy (coach_slug, starts_at, ends_at, source, booking_id)
    values (new.coach_slug, new.booked_at, new.ends_at, 'booking', new.id)
    on conflict (booking_id) where booking_id is not null do update set
      coach_slug = excluded.coach_slug,
      starts_at  = excluded.starts_at,
      ends_at    = excluded.ends_at,
      synced_at  = now();
  end if;

  -- ── Outbox ────────────────────────────────────────────────────────────────
  -- 'skipped' coaches have no calendar to write to; enqueueing would just churn.
  if new.google_sync_status = 'skipped' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_op := 'create';
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    v_op := 'cancel';
  elsif new.booked_at is distinct from old.booked_at
     or new.duration_minutes is distinct from old.duration_minutes
     or (new.status <> 'cancelled' and old.status = 'cancelled')
  then
    v_op := 'update';
  else
    return new;
  end if;

  insert into public.google_sync_outbox (booking_id, coach_slug, op)
  values (new.id, new.coach_slug, v_op);

  return new;
end
$$;

revoke all on function public.bookings_set_sync_status() from public;
revoke all on function public.bookings_mirror_to_busy() from public;

drop trigger if exists bookings_set_sync_status_trg on public.bookings;
create trigger bookings_set_sync_status_trg
  before insert or update on public.bookings
  for each row execute function public.bookings_set_sync_status();

drop trigger if exists bookings_mirror_to_busy_trg on public.bookings;
create trigger bookings_mirror_to_busy_trg
  after insert or update or delete on public.bookings
  for each row execute function public.bookings_mirror_to_busy();

-- Backfill the mirror for bookings that already exist. Idempotent.
insert into public.coach_calendar_busy (coach_slug, starts_at, ends_at, source, booking_id)
select b.coach_slug, b.booked_at, b.ends_at, 'booking', b.id
from public.bookings b
where b.status <> 'cancelled'
on conflict (booking_id) where booking_id is not null do nothing;

-- Existing bookings predate Google entirely; they must not be pushed.
update public.bookings set google_sync_status = 'skipped'
where google_sync_status = 'pending'
  and created_at < now();


-- ============================================================
-- 10. SEEDS — coach identity
-- ============================================================
-- coach_routing.coach_slug is how a verified auth.email() becomes a coach_slug.
-- Also added by 004_pending_content.sql; repeated here so the calendar track
-- does not silently depend on the content track having been applied first.

alter table public.coach_routing add column if not exists coach_slug text;

update public.coach_routing set coach_slug = 'ronnie-vallejo' where coach_name = 'Ronnie Vallejo';
update public.coach_routing set coach_slug = 'seth-burman'    where coach_name = 'Seth Burman';
update public.coach_routing set coach_slug = 'lucas-sison'    where coach_name = 'Lucas Sison';
update public.coach_routing set coach_slug = 'kobe-pham'      where coach_name = 'Kobe Pham';
update public.coach_routing set coach_slug = 'aedan-nguyen'   where coach_name = 'Aedan Nguyen';

create unique index if not exists coach_routing_coach_slug_idx
  on public.coach_routing (coach_slug) where coach_slug is not null;


-- ============================================================
-- 11. COACH PUBLIC SETTINGS — RLS + grants
-- ============================================================

alter table public.coach_public_settings enable row level security;

drop policy if exists "public_read_settings"    on public.coach_public_settings;
drop policy if exists "coach_write_own_settings" on public.coach_public_settings;

-- WHO: everyone. A visitor cannot be shown a correct time without knowing the
-- zone the coach's schedule is written in. Nothing here is sensitive.
create policy "public_read_settings"
  on public.coach_public_settings for select to anon, authenticated
  using (true);

-- WHO: the signed-in coach, for their OWN row only. The slug is derived from the
-- JWT, never accepted from the client (invariant 3). Master admins are handled
-- by the head-coach flag in coach_routing via is_content_admin(), if present.
create policy "coach_write_own_settings"
  on public.coach_public_settings for all to authenticated
  using (coach_slug = public.current_coach_slug())
  with check (coach_slug = public.current_coach_slug());

-- anon reads the zone and nothing else. (There is nothing else worth reading
-- today; the column grant is here so that adding a column later does not
-- silently widen the public surface.)
revoke all    on public.coach_public_settings from anon, authenticated;
grant  select (coach_slug, time_zone) on public.coach_public_settings to anon;
grant  select, insert, update on public.coach_public_settings to authenticated;


-- ============================================================
-- 12. CRON — periodic freeBusy re-sync, outbox drain, garbage collection
-- ============================================================
-- Google push notifications (events.watch) are deliberately NOT used: they are a
-- second public endpoint, they expire every 7 days with no auto-renew, and
-- Google itself does not guarantee delivery — so a reconcile poll is required
-- regardless. The poll IS the sync; a webhook would only have sat on top of it.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Reads the project URL + service role key from private.app_settings (never from
-- admin_config, which any authenticated coach can read). Silently does nothing
-- until the operator fills them in.
create or replace function private.invoke_edge_function(p_name text, p_body jsonb default '{}'::jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_key    text;
  v_secret text;
begin
  select value into v_url    from private.app_settings where key = 'project_url';
  select value into v_key    from private.app_settings where key = 'service_role_key';
  select value into v_secret from private.app_settings where key = 'cron_secret';

  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    raise notice 'private.app_settings not configured — skipping %', p_name;
    return;
  end if;

  -- Authorization gets the request through the Functions gateway (verify_jwt);
  -- X-Cron-Secret is what calendar-sync checks to treat this as a trusted cron
  -- poll instead of a coach JWT. Without it the function answers 403.
  perform net.http_post(
    url     := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'Authorization',  'Bearer ' || v_key,
      'X-Cron-Secret',  coalesce(v_secret, '')
    ),
    body    := p_body
  );
end
$$;

revoke all on function private.invoke_edge_function(text, jsonb) from public;

-- Expired OAuth states are attack surface; consumed ones are noise. Google busy
-- rows in the past are dead weight (the booking page only ever asks for
-- ends_at >= now). Booking mirrors are NOT touched here — they are owned by the
-- trigger and deleting one would resurrect a taken slot.
create or replace function private.calendar_gc()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from private.oauth_states
   where expires_at < now() - interval '1 day'
      or consumed_at < now() - interval '1 day';

  delete from public.coach_calendar_busy
   where source = 'google' and ends_at < now() - interval '1 day';

  delete from public.google_sync_outbox
   where completed_at is not null and completed_at < now() - interval '7 days';
end
$$;

revoke all on function private.calendar_gc() from public;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron unavailable — schedule calendar-sync / calendar-gc by hand';
    return;
  end if;

  -- unschedule-then-schedule so this block is re-runnable. The legacy job names
  -- 'calendar-busy-sync' and 'calendar-outbox-drain' are unscheduled too so an
  -- upgrade over a prior apply drops them cleanly.
  perform cron.unschedule(jobname)
  from cron.job
  where jobname in ('calendar-busy-sync', 'calendar-outbox-drain',
                    'calendar-sync', 'calendar-gc');

  -- Every 15 min: pull each connected coach's freeBusy for the booking horizon
  -- and rewrite their `source = 'google'` rows. Targets the deployed function
  -- name `calendar-sync` (there is no `calendar-busy-sync` function).
  perform cron.schedule(
    'calendar-sync',
    '*/15 * * * *',
    $cron$select private.invoke_edge_function('calendar-sync')$cron$
  );

  -- NOTE: there is intentionally NO outbox-drain cron here. No
  -- `calendar-outbox-drain` edge function exists, and the deployed
  -- booking-create / booking-update push to Google inline and record a failure
  -- as bookings.google_sync_status = 'pending' — they do not consume
  -- google_sync_outbox. Scheduling a drain against a missing function was a
  -- silent 404 (net.http_post never raises). The booking→Google retry path must
  -- be reconciled cross-file before a drain cron is (re-)added; see the migration
  -- notes / return-to-orchestrator for the two options.

  perform cron.schedule('calendar-gc', '17 4 * * *', $cron$select private.calendar_gc()$cron$);
end $$;
