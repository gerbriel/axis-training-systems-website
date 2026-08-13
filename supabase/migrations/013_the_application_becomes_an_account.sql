-- ============================================================
-- Axis Training Systems — 013: the application becomes an account
-- ============================================================
--
-- `leads` has had a lifecycle since 001 — new, reviewed, accepted, declined —
-- and accepting one has never done anything except change a word on a screen.
-- Somebody then had to remember, separately, to get that athlete into the
-- system. There was no system to get them into.
--
-- Now there is, so accepting an application issues the invitation. One action,
-- in the place a coach already performs it, with nothing to remember.
--
-- The second half of this file connects a booking to the account of whoever
-- made it. A visitor books as a guest — that has to keep working, and it does —
-- but if they later have an account at the same address, that booking is theirs
-- and should appear on their page rather than being reachable only through a
-- link in an old email.
--
-- Re-runnable.
-- ============================================================


-- ── 1. Tokens the database can mint ─────────────────────────────────────────
--
-- `invitations.token_hash` is NOT NULL, so an invitation raised by a trigger
-- needs a token even when nobody will ever read it.
--
-- Two v4 uuids, hyphens stripped: 64 hex characters carrying ~244 bits of
-- randomness. `gen_random_uuid()` is in pg_catalog and is therefore reachable
-- under `search_path = ''`, which pgcrypto's `gen_random_bytes` is not —
-- pgcrypto lives in `extensions` on Supabase and in `public` on a plain
-- Postgres, and a function that resolves on one and not the other is a
-- migration that works in staging.
--
-- THE PLAINTEXT IS DISCARDED. An invitation minted here has no link — the
-- hash is stored and the token is thrown away in the same statement. That is
-- not a limitation, it is the division of labour described in 012: this
-- invitation works by the EMAIL half, so the athlete signs in with the address
-- they applied from, at any provider, and is let in. If somebody wants a link
-- to send, the invitations screen issues a fresh one through `invite-send`,
-- which supersedes this row and can actually show the token it generated.

create or replace function public.mint_invitation_token()
returns text
language sql
volatile
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;


-- ── 2. Accepting an application ─────────────────────────────────────────────
--
-- A trigger rather than a function the admin screen has to call, because the
-- admin screen already writes `status` straight through PostgREST and a coach
-- accepting an application should not depend on a second request that a future
-- refactor might drop.
--
-- Three outcomes, and the ordering matters:
--
--   * They already have an active account — nothing to do. Re-accepting an
--     application must not disturb somebody who is already in.
--   * They have an account sitting at `pending` — activate it directly. An
--     invitation would never be seen: handle_new_user only fires at signup, and
--     theirs has already happened.
--   * No account — leave an invitation, so whenever they sign up (password,
--     magic link, or Google) they are let straight in.
--
-- Failures here are SWALLOWED, deliberately, and this is the one place in this
-- codebase that does that. `invitations_before_insert` raises for a handful of
-- ordinary situations — the address already has an account, the inviter is
-- suspended — and none of them are a reason to refuse to accept an application.
-- The lead is the record that matters; the invitation is a convenience on top
-- of it. A coach must never be unable to accept somebody because of a problem
-- with an email address they cannot see.

create or replace function public.leads_invite_on_accept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email   text := lower(btrim(coalesce(new.email, '')));
  v_user    uuid;
  v_status  public.profile_status;
  v_inviter uuid := auth.uid();
begin
  if v_email = '' or position('@' in v_email) < 2 then
    return new;
  end if;

  select id, status into v_user, v_status
    from public.profiles where lower(email) = v_email limit 1;

  if v_status = 'active' or v_status = 'suspended' then
    return new;
  end if;

  if v_user is not null then
    -- Pending account, waiting on exactly this decision.
    perform set_config('axis.privileged_write', 'on', true);
    update public.profiles set status = 'active' where id = v_user;
    perform set_config('axis.privileged_write', 'off', true);
    return new;
  end if;

  -- No account yet. `invited_by` must be a real profile: when a trigger fires
  -- from a session with no uid (the SQL editor, a service-role job) fall back to
  -- an admin so the row still satisfies the tier check.
  if v_inviter is null or not exists (select 1 from public.profiles where id = v_inviter) then
    select id into v_inviter
      from public.profiles where role = 'admin' and status = 'active'
      order by created_at limit 1;
  end if;
  if v_inviter is null then
    return new;
  end if;

  begin
    insert into public.invitations (
      email, first_name, last_name, role, invited_by, token_hash, note
    ) values (
      v_email,
      nullif(btrim(new.first_name), ''),
      nullif(btrim(new.last_name), ''),
      'athlete',
      v_inviter,
      encode(sha256(convert_to(public.mint_invitation_token(), 'UTF8')), 'hex'),
      'Application accepted'
    );
  exception when others then
    -- See the note above. An invitation that could not be issued is a message
    -- worth having in the logs and is never a reason to fail the acceptance.
    raise warning 'lead % accepted but invitation not issued: %', new.id, sqlerrm;
  end;

  return new;
end $$;

revoke all on function public.leads_invite_on_accept() from public;

drop trigger if exists leads_invite_on_accept_trg on public.leads;
create trigger leads_invite_on_accept_trg
  after update of status on public.leads
  for each row
  when (new.status = 'accepted' and old.status is distinct from 'accepted')
  execute function public.leads_invite_on_accept();


-- ── 3. A booking belongs to somebody ────────────────────────────────────────
--
-- Nullable, and it stays nullable. Booking without an account is the normal
-- path on a public site and nothing here changes that — `client_id` is how a
-- booking finds its way onto an account page when one happens to exist, not a
-- requirement for making one.

alter table public.bookings
  add column if not exists client_id uuid references public.profiles (id) on delete set null;

create index if not exists bookings_client_idx
  on public.bookings (client_id, booked_at desc) where client_id is not null;


-- Set at insert, by email. The booking form asks for an address; if it matches
-- an account, that is whose booking it is.
create or replace function public.bookings_link_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_id is null and coalesce(new.email, '') <> '' then
    select id into new.client_id
      from public.profiles where lower(email) = lower(new.email) limit 1;
  end if;
  return new;
end $$;

revoke all on function public.bookings_link_client() from public;

drop trigger if exists bookings_link_client_trg on public.bookings;
create trigger bookings_link_client_trg
  before insert on public.bookings
  for each row execute function public.bookings_link_client();


-- And the other direction: somebody who booked as a guest in March and made an
-- account in April should find March's booking on their page. Without this the
-- link only ever forms for bookings made after the account, which is backwards
-- — the booking is usually what brings them here in the first place.
create or replace function public.profiles_adopt_bookings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.bookings
     set client_id = new.id
   where client_id is null and lower(email) = lower(new.email);
  return new;
end $$;

revoke all on function public.profiles_adopt_bookings() from public;

drop trigger if exists profiles_adopt_bookings_trg on public.profiles;
create trigger profiles_adopt_bookings_trg
  after insert on public.profiles
  for each row execute function public.profiles_adopt_bookings();

-- Backfill for every account that already exists.
update public.bookings b
   set client_id = p.id
  from public.profiles p
 where b.client_id is null and lower(b.email) = lower(p.email);


-- ── 4. What an athlete may see of their own booking ─────────────────────────
--
-- A row in `bookings` is not a client-facing object. It carries `coach_notes`,
-- which is the coach's private assessment of the person reading it, and
-- `manage_token`, which is a bearer credential. RLS is row-level and cannot
-- withhold a column, so "let a client read their own booking" through a policy
-- alone hands over both.
--
-- Hence a view. `security_invoker` keeps the caller's RLS in force — the view is
-- not a way around the policy below, only a narrower projection of what it
-- already allows.

drop policy if exists "client reads own bookings" on public.bookings;
create policy "client reads own bookings"
  on public.bookings for select to authenticated
  using (client_id = auth.uid());

-- `security_invoker` is PostgreSQL 15+. Supabase has been on 15 or later for a
-- long time, but a project created early enough may not be, and a migration
-- that fails on `unrecognized parameter` is a migration nobody can apply.
--
-- SO THE FALLBACK HAS TO BE SAFE ON ITS OWN. A view WITHOUT security_invoker
-- runs with the OWNER's rights, and the owner is not subject to RLS — so the
-- policy above does not restrict it, and a naive fallback would hand every
-- client every other client's bookings.
--
-- What makes both versions correct is that `where b.client_id = auth.uid()`
-- lives in the VIEW BODY rather than being left to the policy. On 15+ that
-- restriction and the RLS policy both apply; on 14 the view's own predicate is
-- what holds. Do not move that WHERE clause out on the grounds that RLS covers
-- it — on 14 it would not.
do $do$
declare
  v_body constant text := $view$
    select
      b.id,
      b.coach_slug,
      b.booked_at,
      b.ends_at,
      b.duration_minutes,
      b.status,
      b.service_name,
      b.service_price_cents,
      b.goals,
      b.google_meet_url,
      b.manage_token,
      b.cancelled_at,
      b.cancellation_reason,
      b.created_at
    from public.bookings b
    where b.client_id = auth.uid()
  $view$;
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'create or replace view public.my_bookings with (security_invoker = true) as ' || v_body;
  else
    raise warning
      'PostgreSQL % predates security_invoker views; my_bookings relies on its own WHERE clause for row restriction',
      current_setting('server_version');
    execute 'create or replace view public.my_bookings as ' || v_body;
  end if;
end $do$;

comment on view public.my_bookings is
  'A client''s own bookings, without coach_notes. security_invoker keeps the '
  'bookings RLS in force — this narrows what is returned, it does not widen who '
  'may ask. manage_token IS included: it is this person''s own cancel link and '
  'they already have it in their email.';

revoke all on public.my_bookings from anon;
grant  select on public.my_bookings to authenticated;


-- ── 5. Verify ───────────────────────────────────────────────────────────────
--
-- Accepting an application should leave exactly one live invitation:
--
--   update public.leads set status = 'accepted' where id = '<lead-id>';
--   select email, role, note from public.invitations
--    where accepted_at is null and revoked_at is null order by created_at desc limit 1;
--
-- And a client must not be able to read the coach's notes on their own booking:
--
--   select coach_notes from public.my_bookings;  -- ERROR: column does not exist
