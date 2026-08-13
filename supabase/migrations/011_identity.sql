-- ============================================================
-- Axis Training Systems — 011: who anybody is
-- ============================================================
--
-- Until now there was no such thing as a user.
--
-- Staff identity was an email address compared against `coach_routing`:
-- `current_coach_slug()` looked up the slug by `auth.email()`, and
-- `is_content_admin()` looked up a boolean the same way. That works, and it has
-- one property that becomes a problem the moment anyone else needs an account —
-- it can only ever answer questions about the five people on the roster. There
-- is no row anywhere for a client. There is no notion of an account that exists
-- but is not yet allowed in. There is no role that is not "coach or not".
--
-- This migration introduces `profiles`: one row per auth user, carrying the
-- role, the status, and — for staff — the coach_slug that every policy written
-- since 002 has been resolving by email.
--
-- THE SITE IS INVITE-GATED. A new account is created `pending` and can do
-- nothing until something says otherwise. Three things can:
--
--   1. A live invitation for that address (012). Athletes and staff alike.
--   2. A `coach_routing` row for that address, which is how the five people
--      already on the roster keep working, and how a coach added to the roster
--      later can make their own account without an invitation.
--   3. An admin, by hand, in the portal.
--
-- Every provider goes through the same gate. `handle_new_user` fires on the
-- auth.users insert whether the account came from a password, a magic link, or
-- Google — there is no provider-specific path, so there is no provider-specific
-- hole.
--
-- Re-runnable.
-- ============================================================


-- ── 1. Roles and statuses ───────────────────────────────────────────────────
--
-- Three roles, and `admin` is not a fourth kind of person: Ronnie is the head
-- coach AND the admin, so an admin may also carry a coach_slug and appear on the
-- roster. What separates the two is what they may do, not who they are.
--
-- `suspended` keeps the row and the role so history stays readable while taking
-- every power away. That is why the helpers below test status and not just role:
-- a suspended admin who still passed `is_content_admin()` would be a suspension
-- in name only.

do $do$ begin
  create type public.user_role as enum ('athlete', 'coach', 'admin');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.profile_status as enum ('pending', 'active', 'suspended');
exception when duplicate_object then null; end $do$;


-- ── 2. Profiles ─────────────────────────────────────────────────────────────
--
-- `email` is a COPY of auth.users.email, kept because RLS policies and the
-- invitation flow need to match on it and `auth.users` is not readable from a
-- policy without a definer hop on every single check. It is maintained by
-- trigger, never by hand.

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  first_name   text,
  last_name    text,
  display_name text,
  avatar_url   text,
  phone        text,
  role         public.user_role      not null default 'athlete',
  status       public.profile_status not null default 'pending',

  -- Staff only. It is the same slug `coach_routing`, `coach_schedules`,
  -- `bookings` and every per-coach policy since 002 already use — this column
  -- moves the LOOKUP into profiles, it does not invent a second identity.
  coach_slug   text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint profiles_email_normalised
    check (email = lower(email) and position('@' in email) > 1 and length(email) <= 254),
  -- An athlete has no calendar, so an athlete with a coach_slug is a row that
  -- would make `current_coach_slug()` hand someone else's bookings to a client.
  constraint profiles_coach_slug_is_staff
    check (role <> 'athlete' or coach_slug is null),
  constraint profiles_coach_slug_shape
    check (coach_slug is null or coach_slug ~ '^[a-z0-9-]+$'),
  constraint profiles_avatar_url_shape
    check (avatar_url is null or avatar_url ~* '^https?://')
);

-- One person per calendar. Two profiles claiming 'ronnie-vallejo' would both
-- pass `current_coach_slug()` and both read his clients' phone numbers.
create unique index if not exists profiles_coach_slug_idx
  on public.profiles (coach_slug) where coach_slug is not null;

create unique index if not exists profiles_email_idx on public.profiles (lower(email));
create index if not exists profiles_role_idx on public.profiles (role, status);
create index if not exists profiles_pending_idx on public.profiles (created_at desc) where status = 'pending';


create or replace function public.profiles_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch_trg on public.profiles;
create trigger profiles_touch_trg
  before update on public.profiles
  for each row execute function public.profiles_touch();


-- ── 3. Nobody promotes themselves ───────────────────────────────────────────
--
-- The sensible policy below is "you may update your own profile", and it has to
-- be, because a person changing their own phone number should not need an
-- admin. Without this trigger that same policy is also "you may set your own
-- role to admin", which is the entire security model gone in one PATCH.
--
-- So: `role`, `status` and `coach_slug` are CLAMPED to their old values unless
-- the writer is an active admin. Note what is NOT here — no check that the
-- caller is not the subject. An admin editing their own row is fine; what is
-- refused is a non-admin editing anyone's, including their own.
--
-- Two transaction-local bypasses exist for the flows that legitimately must
-- write those columns from a non-admin session. Both are set by SECURITY
-- DEFINER functions in this file and 012, immediately before one UPDATE, and
-- cleared immediately after — `set_config(..., true)` is transaction-scoped, so
-- neither can leak into another statement or another session.
--
-- `auth.uid() is null` means the writer is the service role, a database
-- trigger, or the SQL editor. Those must be able to set role and status —
-- bootstrapping the first admin is exactly that case — and none of them are
-- reachable with the anon key.

create or replace function public.profiles_guard_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('axis.privileged_write', true), 'off') = 'on' then
    return new;
  end if;

  if auth.uid() is not null and not public.is_axis_admin() then
    new.role       := old.role;
    new.status     := old.status;
    new.coach_slug := old.coach_slug;
  end if;

  return new;
end $$;


-- ── 4. Identity helpers ─────────────────────────────────────────────────────
--
-- `is_axis_admin()` is new. `is_content_admin()` and `current_coach_slug()` are
-- REPLACED IN PLACE — same names, same signatures, same meaning, reading a
-- different table. Every policy written since 002 calls them and none of those
-- policies change, which is the whole reason this migration is safe to apply to
-- a live database: the authorization surface is identical the instant it lands,
-- because the backfill below has already put the same five people in profiles.
--
-- If the backfill were wrong, every coach would lose their portal at once —
-- which is loud, immediate, and recoverable, rather than silent.

create or replace function public.is_axis_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  )
$$;

revoke all     on function public.is_axis_admin() from public;
grant  execute on function public.is_axis_admin() to authenticated, service_role;

-- Was: an email flagged is_admin in coach_routing. Now: an active admin
-- profile. The positive-allowlist property 005 insisted on is preserved —
-- absence from profiles, or a pending/suspended status, is NOT admin.
create or replace function public.is_content_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_axis_admin()
$$;

revoke all     on function public.is_content_admin() from public;
grant  execute on function public.is_content_admin() to authenticated, service_role;

-- Was: coach_routing.coach_slug by email. Now: profiles.coach_slug by uid.
-- Reading it off the verified `auth.uid()` rather than `auth.email()` also drops
-- a class of problem nobody had hit yet: an email address is mutable and
-- re-assignable, and a uid is neither.
--
-- `status = 'active'` is the load-bearing addition. A suspended coach previously
-- kept their slug and therefore kept reading their clients' bookings.
create or replace function public.current_coach_slug()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coach_slug from public.profiles
   where id = auth.uid() and status = 'active' and coach_slug is not null
   limit 1
$$;

revoke all     on function public.current_coach_slug() from public;
grant  execute on function public.current_coach_slug() to authenticated, service_role;

-- `is_axis_admin` is referenced by profiles_guard_privileges above, so the
-- trigger goes on only now that the function it calls exists.
drop trigger if exists profiles_guard_privileges_trg on public.profiles;
create trigger profiles_guard_privileges_trg
  before update on public.profiles
  for each row execute function public.profiles_guard_privileges();


-- ── 5. Every new account, whatever it signed up with ────────────────────────
--
-- One trigger, on auth.users, for every provider. A password signup, a magic
-- link and a Google sign-in all arrive here, so the gate cannot be walked around
-- by choosing a different button.
--
-- The name and the photo are whatever the provider gave us: password signups
-- send `display_name` in the metadata, Google sends `full_name`/`name` and
-- `picture`. Falling back to the local part of the address is better than a
-- blank name on a booking.
--
-- Invitation matching is BY EMAIL, not by token. That is deliberate and it is
-- what makes Google sign-in work: somebody invited at a@b.com who never opens
-- the link, and simply clicks "Continue with Google" a week later, is let
-- straight in. The token in 012 is what makes the link show "Ronnie invited you
-- to coach"; the email is what makes the invitation actually take effect.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email      text := lower(trim(coalesce(new.email, '')));
  v_name       text;
  v_first      text;
  v_last       text;
  v_avatar     text;
  v_role       public.user_role      := 'athlete';
  v_status     public.profile_status := 'pending';
  v_coach_slug text;
  -- Scalars, not a `record`. An unassigned record raises the moment you touch a
  -- field on it, so a lookup that finds nothing would take the whole signup down
  -- rather than falling through to the next gate.
  v_invite_id    bigint;
  v_invite_role  public.user_role;
  v_invite_slug  text;
begin
  -- An auth user with no address cannot be matched to an invitation and cannot
  -- be mailed. Nothing in this app creates one, but a profile row with a NULL
  -- email would violate the check constraint and take the signup down with it.
  if v_email = '' or position('@' in v_email) < 2 then
    return new;
  end if;

  v_name := left(btrim(coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    ''
  )), 120);
  if v_name = '' then
    v_name := left(split_part(v_email, '@', 1), 120);
  end if;

  v_first := nullif(left(split_part(v_name, ' ', 1), 80), '');
  v_last  := nullif(left(btrim(substr(v_name, length(split_part(v_name, ' ', 1)) + 1)), 80), '');

  v_avatar := left(coalesce(
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'picture'
  ), 500);
  if v_avatar is null or v_avatar !~* '^https?://' then
    v_avatar := null;
  end if;

  -- ── Gate 1: a live invitation for this address ──
  -- 012 creates `invitations`. Guarded with to_regclass so this file can be
  -- applied on its own, before 012 exists, without failing.
  -- Dynamic, and guarded by to_regclass, only so that 011 can be applied on its
  -- own — before 012 exists — without every signup in the window between them
  -- failing on a missing table. Once 012 has run this is an ordinary lookup.
  if to_regclass('public.invitations') is not null then
    execute $q$
      select id, role, coach_slug
        from public.invitations
       where email = $1
         and accepted_at is null
         and revoked_at is null
         and expires_at > now()
       order by created_at desc
       limit 1
    $q$ into v_invite_id, v_invite_role, v_invite_slug using v_email;

    if v_invite_id is not null then
      v_role       := v_invite_role;
      v_status     := 'active';
      v_coach_slug := v_invite_slug;
    end if;
  end if;

  -- ── Gate 2: already on the roster ──
  -- The five coaches predate accounts entirely, and a coach added to
  -- coach_routing later should not also need an invitation to make the account
  -- the roster already says is theirs. An email in coach_routing is an admin
  -- decision, which is the same trust an invitation carries.
  if v_status = 'pending' then
    select
      case when r.is_admin then 'admin'::public.user_role else 'coach'::public.user_role end,
      r.coach_slug
      into v_role, v_coach_slug
    from public.coach_routing r
    where lower(r.email) = v_email and r.coach_slug is not null
    limit 1;

    if v_coach_slug is not null then
      v_status := 'active';
    else
      -- Reset: the SELECT may have written v_role before finding no slug.
      v_role := 'athlete';
    end if;
  end if;

  insert into public.profiles (
    id, email, first_name, last_name, display_name, avatar_url, role, status, coach_slug
  )
  values (
    new.id, v_email, v_first, v_last, v_name, v_avatar, v_role, v_status, v_coach_slug
  )
  on conflict (id) do nothing;

  -- Consumed only now that the profile it created actually exists. Dynamic for
  -- the same to_regclass reason as the lookup.
  if v_invite_id is not null then
    execute 'update public.invitations set accepted_at = now(), accepted_by = $1 where id = $2'
      using new.id, v_invite_id;
  end if;

  return new;
end $$;

revoke all on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── 6. The address follows the account ──────────────────────────────────────
--
-- A user who changes their email in Supabase would otherwise leave
-- `profiles.email` pointing at the old one, and every match made on it — the
-- invitation gate, the booking link in 013 — would quietly go on using an
-- address they no longer own.

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email and coalesce(new.email, '') <> '' then
    perform set_config('axis.privileged_write', 'on', true);
    update public.profiles set email = lower(new.email) where id = new.id;
    perform set_config('axis.privileged_write', 'off', true);
  end if;
  return new;
end $$;

revoke all on function public.handle_user_email_change() from public;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();


-- ── 7. Backfill ─────────────────────────────────────────────────────────────
--
-- THIS IS THE STEP THAT DECIDES WHETHER THE PORTALS SURVIVE THE MIGRATION.
--
-- `is_content_admin()` and `current_coach_slug()` now read profiles. Every auth
-- user that exists right now was created before profiles did and has no row, so
-- until this runs, every coach is locked out of their own portal.
--
-- Anyone in auth.users who is NOT on the roster becomes a pending athlete. That
-- is the correct outcome for an invite-gated site — they can sign in and are
-- told they are waiting — but it is worth knowing before running it that a test
-- account made in the dashboard lands there too.

insert into public.profiles (id, email, first_name, last_name, display_name, role, status, coach_slug)
select
  u.id,
  lower(u.email),
  nullif(split_part(coalesce(r.coach_name, split_part(u.email, '@', 1)), ' ', 1), ''),
  nullif(btrim(substr(coalesce(r.coach_name, ''), length(split_part(coalesce(r.coach_name, ''), ' ', 1)) + 1)), ''),
  coalesce(r.coach_name, split_part(u.email, '@', 1)),
  case
    when r.is_admin then 'admin'::public.user_role
    when r.coach_slug is not null then 'coach'::public.user_role
    else 'athlete'::public.user_role
  end,
  case when r.coach_slug is not null then 'active'::public.profile_status
       else 'pending'::public.profile_status end,
  r.coach_slug
from auth.users u
left join public.coach_routing r
  on lower(r.email) = lower(u.email) and r.coach_slug is not null
where coalesce(u.email, '') <> ''
on conflict (id) do nothing;


-- ── 8. RLS ──────────────────────────────────────────────────────────────────
--
-- A profile carries a name, an email address and a phone number. `anon` gets
-- nothing at all — not a count, not an existence check. Account enumeration is
-- the whole attack this closes.
--
-- ON THE APPARENT RECURSION. Two policies below call `current_coach_slug()` and
-- `is_axis_admin()`, and both of those SELECT FROM THIS TABLE. That is not a
-- loop, and the reason is the one property that makes the whole design work:
-- both are SECURITY DEFINER, owned by the role that owns `profiles`, and RLS is
-- not applied to a table's owner. The policy calls a function that reads the
-- table with the policy switched off, gets an answer, and returns.
--
-- Write either of them as SECURITY INVOKER and every query against `profiles`
-- recurses until Postgres gives up. It is worth knowing before "simplifying"
-- them.

alter table public.profiles enable row level security;

drop policy if exists "read own profile"        on public.profiles;
drop policy if exists "update own profile"      on public.profiles;
drop policy if exists "staff read profiles"     on public.profiles;
drop policy if exists "admin writes profiles"   on public.profiles;

-- WHO: you, about yourself. The route guards and the pending screen need it.
create policy "read own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

-- WHO: you, about yourself — name, phone, avatar. `role`, `status` and
-- `coach_slug` are clamped by profiles_guard_privileges, not by this policy:
-- a WITH CHECK cannot express "unchanged from the old row".
create policy "update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- WHO: staff. A coach needs to see who their athletes are; the CRM and the
-- invitation screens list people. Read only — promotion is admin-only below.
create policy "staff read profiles"
  on public.profiles for select to authenticated
  using (public.current_coach_slug() is not null or public.is_axis_admin());

-- WHO: an active admin, over everything. This is the one path that may set a
-- role, and it is the path User Management uses.
create policy "admin writes profiles"
  on public.profiles for all to authenticated
  using (public.is_axis_admin()) with check (public.is_axis_admin());

revoke all on public.profiles from anon;
grant  select, insert, update on public.profiles to authenticated;


-- ── 9. Verify ───────────────────────────────────────────────────────────────
--
-- The first must list every coach with an account and an active status. If a
-- coach is missing, they cannot open their portal — add the profile by hand
-- before anyone notices.
--
--   select p.email, p.role, p.status, p.coach_slug
--     from public.profiles p where p.coach_slug is not null order by p.coach_slug;
--
--   select count(*) from public.profiles where status = 'pending';  -- expect: test accounts only
--
--   set role anon; select * from public.profiles limit 1;  -- expect: permission denied
--   reset role;
