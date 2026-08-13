-- ============================================================
-- Axis Training Systems — 014: what a person may do
-- ============================================================
--
-- Authorisation today is three values of `user_role` and the three helpers in
-- 011, and every policy written since 002 is phrased in terms of them. Nothing
-- here changes that. The role stays the baseline and grants sit on top of it:
--
--     permissions        the catalogue — what a permission even is
--     role_permissions   what a role holds before anyone decides anything
--     staff_permissions  per-person overrides, in either direction
--     has_permission()   the override first, then the role default, then no
--
-- Every existing policy keeps working because not one of them is touched.
-- Rewriting thirteen migrations of RLS onto has_permission() in a single pass
-- would be an excellent way to take the site's security boundary apart on a
-- Wednesday, so it is not attempted here.
--
-- BEING PRECISE ABOUT WHAT THIS IS. has_permission() gates exactly what is
-- written against it and nothing else. Until a policy adopts it, a permission
-- describes intent and drives the UI. Two of the coach defaults below
-- (manage_content, view_analytics) are more generous than what 004 and 005
-- actually allow a coach to do, and on the day this lands that discrepancy
-- changes nothing at all, because `is_content_admin()` is still what stops the
-- request. Nobody gains access from this file. When a policy is migrated onto
-- has_permission(), that is the moment the default becomes real, and it is the
-- moment to decide whether it was the right default.
--
-- THE DANGEROUS PART IS THE GRANT PATH. 011 installs a trigger that clamps
-- `profiles.role` for any writer who is not an active admin, precisely so that
-- the otherwise sensible "update own profile" policy cannot be turned into a
-- self-promotion. A table of per-person permissions is that same hole cut a
-- second time unless the write path is guarded at least as well, so it is:
--
--   * You cannot grant yourself anything. Not one you lack, and not one you
--     already hold — an explicit grant OUTLIVES the role that justified it, so
--     "grant myself what I already have" is a real escalation with a delay on
--     it: it survives the demotion that was supposed to take it away.
--   * You cannot grant what you do not hold. The set of permissions in
--     circulation can spread between people, but nobody can conjure one that
--     nobody had. Only an admin introduces one.
--   * manage_permissions, manage_staff and manage_site_settings are flagged
--     is_sensitive and are admin-only to grant, so the ability to spread
--     anything at all is admin-conferred.
--   * The check reads the role of `granted_by` — a stored NOT NULL column —
--     rather than of auth.uid(), exactly as 012 checks `invited_by`. Triggers
--     fire for the service role too, so "an admin granted this" is a property
--     of the row rather than a property of whichever route handler wrote it.
--   * An admin cannot be overridden at all. `is_axis_admin()` short-circuits
--     policies all over this database; a revoked permission on an admin would
--     hide a button while the SQL still said yes, which is the UI-as-security
--     mistake the whole schema is written to avoid.
--
-- Re-runnable.
-- ============================================================


-- ── 0. A note on the function grants below ──────────────────────────────────
--
-- Every function in this file is revoked `from public, anon` and not merely
-- `from public`. Supabase ships `alter default privileges in schema public
-- grant all on functions to anon, authenticated, service_role`, so a new
-- function arrives with an EXPLICIT grant to anon, and revoking from PUBLIC
-- takes away the implicit one while leaving that explicit grant in place.
--
-- It matters here more than it does in 011. `has_permission()` is harmless to
-- anon — it returns false, because auth.uid() is null. `profile_has_permission`
-- and `effective_permissions` take the profile as an ARGUMENT, so left reachable
-- they are an oracle: name a uuid, learn whether that account exists and what
-- it may do. Two of the three read gates in this file are written as
-- `auth.uid() is null or ...` so that the service role and psql can use them,
-- and anon's uid is null too.


-- ── 1. Who counts as staff ──────────────────────────────────────────────────
--
-- 011 and 012 spell staff as `current_coach_slug() is not null or
-- is_axis_admin()`, which answers "does this person own a calendar". That is
-- the right question for a booking policy and the wrong one for this file: a
-- coach who has not been given a slug yet is still a coach, and a permission is
-- a statement about a person rather than about a calendar. Hence a helper of
-- its own rather than a fourth copy of the slug idiom.
--
-- `status = 'active'` for the reason 011 gives for putting it in
-- `current_coach_slug()`: a suspended coach who kept reading the catalogue and
-- their own grants would be suspended in name only.

create or replace function public.is_axis_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('coach', 'admin') and status = 'active'
  )
$$;

revoke all     on function public.is_axis_staff() from public, anon;
grant  execute on function public.is_axis_staff() to authenticated, service_role;


-- ── 2. The catalogue ────────────────────────────────────────────────────────
--
-- A permission has to exist here before anyone can hold it. Both mapping tables
-- carry a foreign key to this one, so a typo cannot be stored at all — which is
-- what lets the helpers in section 4 answer "no" to an unknown name instead of
-- raising, without that leniency hiding a mistake.

create table if not exists public.permissions (
  key          text primary key,
  label        text not null,
  description  text not null,

  -- Granting one of these is, directly or eventually, the power to grant
  -- everything else, so it stays admin-only however the roster is configured.
  -- `can_grant_permission` treats an UNKNOWN key as sensitive as well, so the
  -- failure mode of a missing catalogue row is a refusal rather than a hole.
  is_sensitive boolean not null default false,

  -- The key is written into policies and into UI code, and a permission named
  -- 'Manage Staff' one day and 'manage_staff' the next is two permissions.
  constraint permissions_key_shape check (key ~ '^[a-z][a-z0-9_]*$')
);


-- ── 3. What a role holds, and what one person holds instead ─────────────────

-- `athlete` is absent on purpose: an athlete holds no staff permission at all,
-- and a row here saying so would be a second place to look. `admin` is present
-- for the settings matrix, which has to draw the admin column from somewhere,
-- but it is NOT what makes an admin an admin — section 4 short-circuits before
-- it ever reads this table, so the two cannot disagree about an admin even if
-- a later migration adds a permission and forgets the row.
create table if not exists public.role_permissions (
  role       public.user_role not null,
  permission text not null references public.permissions (key) on delete cascade,
  primary key (role, permission)
);

create table if not exists public.staff_permissions (
  id         bigserial primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  permission text not null references public.permissions (key) on delete cascade,

  -- true grants what the role does not give, false takes away what it does.
  -- Both directions matter: "everything a coach can do except the lead
  -- contacts" is a real arrangement and the only way to express it is to be
  -- able to subtract.
  granted    boolean not null,

  -- Deliberately NOT a foreign key, and it is the one place this file departs
  -- from ordinary practice. The column is NOT NULL because the tier check in
  -- section 5 is read from it, so a row that names nobody is a row nothing can
  -- be verified against. A reference to profiles would then have to choose
  -- between `on delete cascade`, which quietly takes away everyone's
  -- permissions the day the admin who granted them leaves, and `on delete
  -- restrict`, which blocks deleting that admin's auth user at all — profiles
  -- cascades from auth.users, so restrict would break the Supabase delete-user
  -- button for anyone who ever granted anything. The guard validates the
  -- pointer on the way in, when it is load-bearing. Afterwards it is a record
  -- of who decided, and a dangling record of who decided is better than either
  -- of the alternatives.
  granted_by uuid not null,

  -- Stamped by the guard rather than defaulted, so it cannot be backdated by
  -- whoever writes the row.
  granted_at timestamptz not null default now(),

  -- "Covering for Seth until March." Six months later this is the difference
  -- between a decision and a mystery.
  note       text,

  unique (profile_id, permission)
);

-- An override is a statement about a person, not about a calendar. Every
-- policy that will ever call has_permission() asks one question — "may this
-- caller do this?" — and a per-coach-slug answer would have to resolve a grant
-- on one calendar against a revocation on another before it could reply. A
-- security helper that returns "it depends" is a security helper nobody can
-- reason about, so this table is deliberately not slug-scoped.

comment on table public.staff_permissions is
  'Per-person grants and revocations. One row beats the role default in either '
  'direction; no row means the role default applies.';

comment on column public.staff_permissions.granted_by is
  'Who made this override. The self-grant and tier checks read this column and '
  'not auth.uid(), so the service role cannot attribute a grant to somebody '
  'who could not have made it.';


-- ── 4. The helper everything else is written against ────────────────────────
--
-- SECURITY DEFINER for the reason 011 spells out for its own helpers: the RLS
-- policies in section 8 call these, and these read the very tables those
-- policies protect. The functions are owned by the role that owns the tables
-- and RLS is not applied to a table's owner, so the policy calls a function
-- that reads the table with the policy switched off, gets an answer, and
-- returns. Write either of them SECURITY INVOKER and every query against
-- staff_permissions recurses until Postgres gives up.

/**
 * Does this profile hold this permission?
 *
 * The override first, then the role default, then no. An unknown permission
 * name returns false rather than raising: a typo in a policy should deny, not
 * throw a 500 at whoever tripped over it.
 *
 * `status = 'active'` covers pending and suspended in one clause. A pending
 * account on an invite-gated site has not been let in yet, and a suspended one
 * keeps its role only so history stays readable (011).
 */
create or replace function public.profile_has_permission(
  p_profile    uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile
      and p.status = 'active'
      and (
        -- An admin passes every check in this database already. Saying anything
        -- else here would be a fiction that only the UI believed.
        p.role = 'admin'
        or coalesce(
             (select sp.granted
                from public.staff_permissions sp
               where sp.profile_id = p.id
                 and sp.permission = p_permission),
             (select true
                from public.role_permissions rp
               where rp.role = p.role
                 and rp.permission = p_permission),
             false
           )
      )
  )
$$;

/** The same question about whoever is making this request. */
create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and public.profile_has_permission(auth.uid(), p_permission)
$$;

comment on function public.has_permission(text) is
  'Per-person permission check: the override wins, then the role default. '
  'False for the service role, whose auth.uid() is null — which is correct, '
  'because the service role bypasses RLS and never needs to ask.';

revoke all     on function public.profile_has_permission(uuid, text) from public, anon;
revoke all     on function public.has_permission(text) from public, anon;
grant  execute on function public.profile_has_permission(uuid, text) to authenticated, service_role;
grant  execute on function public.has_permission(text)               to authenticated, service_role;


-- ── 5. May this person hand this to somebody else? ──────────────────────────
--
-- Two rules, and the second is the interesting one: you must already hold what
-- you are handing over. That makes the set of permissions in circulation closed
-- under everything a non-admin can do. It can spread between people; it cannot
-- grow. Only an admin introduces a permission nobody had.
--
-- Note what this function does NOT take: a target. "You cannot grant yourself"
-- needs to compare the actor against the subject, and it is enforced in the
-- guard below, where both are in hand. Keeping it out of here means the RLS
-- policy in section 8 can call this on a row without pretending it is the whole
-- rule.

create or replace function public.can_grant_permission(
  p_actor      uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_actor and p.status = 'active' and p.role <> 'athlete'
  )
  and (
    (select p.role = 'admin' from public.profiles p where p.id = p_actor)
    or (
      -- coalesce to true: a key that is not in the catalogue is treated as
      -- sensitive, so an unknown name fails closed rather than open.
      not coalesce(
        (select pm.is_sensitive from public.permissions pm where pm.key = p_permission),
        true)
      and public.profile_has_permission(p_actor, 'manage_permissions')
      and public.profile_has_permission(p_actor, p_permission)
    )
  )
$$;

revoke all     on function public.can_grant_permission(uuid, text) from public, anon;
grant  execute on function public.can_grant_permission(uuid, text) to authenticated, service_role;

/**
 * Everything a person effectively holds, and why.
 *
 * `source` is 'role' or 'override', because "he can do this because he is a
 * coach" and "he can do this because you ticked it in March" are different
 * facts and the settings matrix has to show which one it is.
 *
 * The WHERE clause is the read gate. A person may always see their own set;
 * everyone else needs manage_permissions. A definer function with no gate would
 * be a way around the RLS in section 8.
 */
create or replace function public.effective_permissions(p_profile uuid)
returns table (
  permission text,
  label      text,
  granted    boolean,
  source     text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pm.key,
    pm.label,
    public.profile_has_permission(p_profile, pm.key),
    case
      when (select p.role from public.profiles p where p.id = p_profile) = 'admin'
        then 'role'
      when exists (
        select 1 from public.staff_permissions sp
        where sp.profile_id = p_profile and sp.permission = pm.key
      ) then 'override'
      else 'role'
    end
  from public.permissions pm
  where auth.uid() is null
     or p_profile = auth.uid()
     or public.is_axis_admin()
     or public.has_permission('manage_permissions')
  order by pm.key
$$;

revoke all     on function public.effective_permissions(uuid) from public, anon;
grant  execute on function public.effective_permissions(uuid) to authenticated, service_role;


-- ── 6. The guard ────────────────────────────────────────────────────────────
--
-- This is the trigger the whole feature stands on. The RLS in section 8 says
-- some of the same things, and it is not enough on its own for exactly the
-- reason 012 gives: RLS binds callers that are SUBJECT to it, and the service
-- role is not one of them. A route handler written in a hurry could otherwise
-- insert `granted_by = <some admin>, profile_id = <themselves>` and RLS would
-- have nothing to say. Putting the rules here makes them true for psql, for the
-- service role, and for an edge function nobody has written yet.
--
-- DELETE is guarded too, even though clearing a row is not a grant. Clearing
-- one restores the role default, which is a privilege change in whichever
-- direction the row was pointing — and for a `granted = false` row on your own
-- account it is a promotion.

create or replace function public.staff_permissions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid;
  v_target public.profiles%rowtype;
begin
  if tg_op = 'DELETE' then
    -- Set only by clear_permission_overrides_on_role_change below, immediately
    -- around one DELETE. Its own GUC rather than 011's `axis.privileged_write`,
    -- because widening that one would mean every flow in 011 and 012 that sets
    -- it also switches this guard off for the rest of the transaction.
    if coalesce(current_setting('axis.permission_reset', true), 'off') = 'on' then
      return old;
    end if;

    -- No JWT means a migration, psql, or the service role, all already
    -- privileged — the same reasoning 011 gives for the profiles guard.
    if auth.uid() is null or public.is_axis_admin() then
      return old;
    end if;

    if old.profile_id = auth.uid() and old.granted = false then
      raise exception
        'You cannot lift a restriction on your own account. An admin has to.'
        using errcode = '22023';
    end if;

    if not public.can_grant_permission(auth.uid(), old.permission) then
      raise exception 'You cannot change % for anyone', old.permission
        using errcode = '22023';
    end if;

    return old;
  end if;

  -- Not redundant with the NOT NULL column: a BEFORE trigger runs first, so
  -- this is what the person actually reads instead of a 23502.
  if new.granted_by is null then
    raise exception 'A permission override has to record who made it'
      using errcode = '22023';
  end if;

  v_actor        := new.granted_by;
  new.granted_at := now();

  -- You act as yourself. Combined with the checks below, which all read the
  -- role of exactly this column, impersonating somebody more senior buys
  -- nothing: the row would then have to survive THEIR tier check.
  if auth.uid() is not null and v_actor is distinct from auth.uid() then
    raise exception 'A permission override is recorded against whoever made it'
      using errcode = '22023';
  end if;

  select * into v_target from public.profiles where id = new.profile_id;

  if v_target.id is null then
    raise exception 'There is no such profile to give a permission to'
      using errcode = '22023';
  end if;

  if v_target.role = 'athlete' then
    raise exception 'Permissions are for staff. Make them a coach first.'
      using errcode = '22023';
  end if;

  -- Section 4 short-circuits on admin, so an override here would change the
  -- matrix and not the answer: the button disappears, the SQL still says yes,
  -- and the person who ticked the box believes they took something away.
  if v_target.role = 'admin' then
    raise exception
      'An admin passes every check in the database already, so this would hide '
      'a button without stopping anything. Change their role instead.'
      using errcode = '22023';
  end if;

  -- The hole 011 was written to close, cut a second time. Note that this
  -- refuses a self-grant of something the actor ALREADY holds, which looks
  -- harmless and is not: the override outlives the role that justified it.
  if new.profile_id = v_actor and new.granted then
    raise exception 'You cannot grant yourself a permission'
      using errcode = '22023';
  end if;

  if not public.can_grant_permission(v_actor, new.permission) then
    raise exception 'You cannot grant or revoke %', new.permission
      using errcode = '22023';
  end if;

  return new;
end $$;

revoke all on function public.staff_permissions_guard() from public, anon;

drop trigger if exists staff_permissions_guard_trg on public.staff_permissions;
create trigger staff_permissions_guard_trg
  before insert or update or delete on public.staff_permissions
  for each row execute function public.staff_permissions_guard();

/**
 * The catalogue and the default map are the shape of the roles themselves.
 *
 * `is_sensitive` is the flag that makes manage_permissions admin-only to grant,
 * so being able to edit the catalogue is being able to unlock the grant path.
 * The RLS below says admin-only as well; this is here because a SECURITY
 * DEFINER function written later would not be subject to that RLS and would be
 * subject to this.
 */
create or replace function public.permission_catalogue_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_axis_admin() then
    raise exception 'Only an admin can change %', tg_table_name
      using errcode = '22023';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke all on function public.permission_catalogue_guard() from public, anon;

drop trigger if exists permissions_guard_trg on public.permissions;
create trigger permissions_guard_trg
  before insert or update or delete on public.permissions
  for each row execute function public.permission_catalogue_guard();

drop trigger if exists role_permissions_guard_trg on public.role_permissions;
create trigger role_permissions_guard_trg
  before insert or update or delete on public.role_permissions
  for each row execute function public.permission_catalogue_guard();


-- ── 7. A role change restates what somebody may do ──────────────────────────
--
-- Overrides do not survive it. A coach who was granted manage_pricing and is
-- then moved back to athlete should not keep it by inertia, and the person
-- doing the demotion is deciding what this person may do — inherited exceptions
-- are how "why can she still see that?" happens six months later. Re-granting
-- is two clicks in the matrix.
--
-- The bypass GUC is set immediately around the one DELETE and cleared straight
-- after, the pattern 011 established. `set_config(..., true)` is
-- transaction-scoped, so it cannot leak into another statement or session. It
-- is needed because a role change is not always made by an admin: 012's
-- `claim_pending_invite` and `claim_invitation_token` set a role while
-- auth.uid() is the subject's own, and without the bypass a pending coach
-- carrying a `granted = false` row who then claims an athlete invitation would
-- have their whole claim refused by the DELETE branch above.

create or replace function public.clear_permission_overrides_on_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    perform set_config('axis.permission_reset', 'on', true);
    delete from public.staff_permissions where profile_id = new.id;
    perform set_config('axis.permission_reset', 'off', true);
  end if;
  return null;
end $$;

revoke all on function public.clear_permission_overrides_on_role_change() from public, anon;

drop trigger if exists profiles_clear_permission_overrides_trg on public.profiles;
create trigger profiles_clear_permission_overrides_trg
  after update of role on public.profiles
  for each row execute function public.clear_permission_overrides_on_role_change();


-- ── 8. Setting one, from the portal ─────────────────────────────────────────
--
/**
 * Grant, revoke, or clear one permission for one person.
 *
 * p_granted true grants, false revokes, null clears the override so the role
 * default applies again. Returns what the person effectively holds afterwards.
 *
 * SECURITY DEFINER on purpose, and it gives nothing away: the guard trigger is
 * the authority either way and fires for a definer call exactly as it does for
 * anybody else. What coming through here buys is that a refusal arrives as a
 * sentence somebody can act on rather than as "new row violates row-level
 * security policy for table staff_permissions".
 */
create or replace function public.set_staff_permission(
  p_profile    uuid,
  p_permission text,
  p_granted    boolean,
  p_note       text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Sign in before changing permissions' using errcode = '22023';
  end if;

  if not exists (select 1 from public.permissions where key = p_permission) then
    raise exception 'There is no permission called %', p_permission
      using errcode = '22023';
  end if;

  if p_granted is null then
    delete from public.staff_permissions
     where profile_id = p_profile and permission = p_permission;
  else
    insert into public.staff_permissions
      (profile_id, permission, granted, note, granted_by)
    values (p_profile, p_permission, p_granted, p_note, v_actor)
    on conflict (profile_id, permission) do update
      set granted    = excluded.granted,
          note       = excluded.note,
          granted_by = excluded.granted_by;
  end if;

  return public.profile_has_permission(p_profile, p_permission);
end $$;

revoke all     on function public.set_staff_permission(uuid, text, boolean, text) from public, anon;
grant  execute on function public.set_staff_permission(uuid, text, boolean, text) to authenticated;


-- ── 9. RLS ──────────────────────────────────────────────────────────────────
--
-- No anon policy on any of the three, and `anon` is revoked outright below. The
-- catalogue is labels and the default map is shape, but together they are a
-- description of the admin surface of this site, and a profile id paired with a
-- permission is a statement about a named person.

alter table public.permissions       enable row level security;
alter table public.role_permissions  enable row level security;
alter table public.staff_permissions enable row level security;

drop policy if exists "staff read permissions"       on public.permissions;
drop policy if exists "admin writes permissions"     on public.permissions;
drop policy if exists "staff read role defaults"     on public.role_permissions;
drop policy if exists "admin writes role defaults"   on public.role_permissions;
drop policy if exists "read own permission overrides" on public.staff_permissions;
drop policy if exists "grant within your reach"      on public.staff_permissions;

-- WHO: any active coach or admin. Staff need the catalogue to render anything
-- at all — a settings matrix with no labels is a grid of checkboxes.
create policy "staff read permissions"
  on public.permissions for select to authenticated
  using (public.is_axis_staff());

create policy "admin writes permissions"
  on public.permissions for all to authenticated
  using (public.is_axis_admin()) with check (public.is_axis_admin());

create policy "staff read role defaults"
  on public.role_permissions for select to authenticated
  using (public.is_axis_staff());

create policy "admin writes role defaults"
  on public.role_permissions for all to authenticated
  using (public.is_axis_admin()) with check (public.is_axis_admin());

-- WHO: you, about yourself, always. Being told what you may do is not a
-- privilege; being able to change it is. Otherwise, manage_permissions.
create policy "read own permission overrides"
  on public.staff_permissions for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_axis_admin()
    or public.has_permission('manage_permissions')
  );

-- WHO: somebody who could hand this particular permission over. Phrasing the
-- policy as can_grant_permission rather than as a flat
-- has_permission('manage_permissions') means the reach test — you must hold it,
-- and it must not be sensitive unless you are an admin — is stated in the
-- policy too, so a coach with manage_permissions is refused at the RLS layer
-- and not only by the trigger.
--
-- The policy is the coarse gate and the trigger in section 6 is the fine one:
-- "not yourself", "not an admin", and "granted_by is who you say it is" all
-- need both sides of the row, which a policy predicate on one column cannot
-- see. Neither layer is decorative.
create policy "grant within your reach"
  on public.staff_permissions for all to authenticated
  using (public.can_grant_permission(auth.uid(), permission))
  with check (public.can_grant_permission(auth.uid(), permission));

revoke all on public.permissions       from anon;
revoke all on public.role_permissions  from anon;
revoke all on public.staff_permissions from anon;

grant select on public.permissions      to authenticated;
grant select on public.role_permissions to authenticated;
grant select, insert, update, delete on public.staff_permissions to authenticated;
grant usage, select on sequence public.staff_permissions_id_seq  to authenticated;


-- ── 10. Seed: the catalogue ─────────────────────────────────────────────────
--
-- `do update` rather than `do nothing`, so re-running this file restores a
-- label or an is_sensitive flag that was edited by hand in the SQL editor. The
-- flag is a security control and this is the only statement that asserts what
-- it should be.

insert into public.permissions (key, label, description, is_sensitive) values
  ('view_own_calendar', 'See their own calendar',
   'Their own bookings and working hours.', false),
  ('view_all_calendars', 'See every calendar',
   'The whole roster''s day, not just their own column.', false),
  ('manage_own_availability', 'Set their own hours',
   'Their weekly schedule, blocks, and time off.', false),
  ('manage_bookings_all', 'Manage every booking',
   'Confirm, reschedule, annotate and cancel on anybody''s calendar.', false),

  ('manage_services', 'Edit what Axis offers',
   'Add, retire and reword services and their durations.', false),
  ('manage_pricing', 'Change prices',
   'What a service costs, including per-coach overrides.', false),

  ('manage_leads', 'Work the application queue',
   'Triage, assign, annotate and close incoming applications.', false),
  ('view_lead_contact', 'See applicant contact details',
   'The email address, phone number and socials on an application. The rest of '
   'a lead — lifts, history, goals — is readable without this.', false),
  ('manage_athletes', 'Manage athletes',
   'Athlete records: profile, history, and adding somebody new.', false),

  ('manage_staff', 'Manage staff',
   'Add and edit coach records, calendars and roster placement. Admin-only to '
   'grant.', true),
  ('manage_permissions', 'Manage permissions',
   'Change what other people may do. Admin-only to grant, because it is the '
   'power to grant everything else.', true),

  ('manage_content', 'Edit the site',
   'Public copy, programme pages and the media library.', false),
  ('moderate_testimonials', 'Moderate testimonials',
   'Approve, hide and respond to what athletes have written.', false),

  ('view_analytics', 'See analytics',
   'Bookings, conversion, and where applications are coming from.', false),
  ('send_marketing', 'Send marketing',
   'Newsletters and broadcast email.', false),

  ('manage_site_settings', 'Change site settings',
   'Booking policy, coach routing, integrations and keys. Admin-only to grant, '
   'because most of what it configures is how the other rules are enforced.',
   true)
on conflict (key) do update
  set label        = excluded.label,
      description  = excluded.description,
      is_sensitive = excluded.is_sensitive;


-- ── 11. Seed: the defaults ──────────────────────────────────────────────────
--
-- A coach gets their own calendar, their own hours, the application queue with
-- the contact details on it, their athletes, the site copy, and the numbers.
-- Not other people's calendars, not prices, not the roster, and not the
-- settings that decide how any of this is enforced.
--
-- `athlete` gets nothing, which is why there is no athlete block: an athlete
-- holds no staff permission, and writing sixteen rows of `false` would only
-- create a second place where that could be edited to say otherwise.

insert into public.role_permissions (role, permission) values
  ('coach', 'view_own_calendar'),
  ('coach', 'manage_own_availability'),
  ('coach', 'manage_leads'),
  ('coach', 'view_lead_contact'),
  ('coach', 'manage_athletes'),
  ('coach', 'manage_content'),
  ('coach', 'view_analytics')
on conflict do nothing;

-- Selected FROM the catalogue rather than listed, so the admin column cannot
-- fall behind a permission added in the same statement above. It is the matrix
-- these rows feed, never the answer — profile_has_permission short-circuits on
-- role = 'admin' long before it reads this table.
insert into public.role_permissions (role, permission)
select 'admin'::public.user_role, key from public.permissions
on conflict do nothing;


-- ── 12. Verify ──────────────────────────────────────────────────────────────
--
-- Shape first. Sixteen permissions, three of them sensitive, seven coach
-- defaults, and an admin row for every key:
--
--   select count(*) from public.permissions;                             -- 16
--   select count(*) from public.permissions where is_sensitive;          --  3
--   select count(*) from public.role_permissions where role = 'coach';   --  7
--   select count(*) from public.permissions
--    where key not in (select permission from public.role_permissions
--                       where role = 'admin');                           --  0
--
-- Anon has nothing:
--
--   set role anon;
--   select * from public.permissions       limit 1;  -- permission denied
--   select * from public.staff_permissions limit 1;  -- permission denied
--   reset role;
--
-- Now the properties the guard exists for. All four must FAIL even here, as the
-- owner, with RLS bypassed entirely — that is the whole point of putting them
-- in a trigger. Substitute a real coach and a real second coach:
--
--   -- a coach cannot grant themselves anything, including what they hold
--   insert into public.staff_permissions (profile_id, permission, granted, granted_by)
--   select p.id, 'manage_pricing', true, p.id
--     from public.profiles p where p.role = 'coach' limit 1;
--   -- ERROR: You cannot grant yourself a permission
--
--   -- a coach cannot hand over what they do not hold
--   insert into public.staff_permissions (profile_id, permission, granted, granted_by)
--   select b.id, 'manage_pricing', true, a.id
--     from public.profiles a, public.profiles b
--    where a.role = 'coach' and b.role = 'coach' and a.id <> b.id limit 1;
--   -- ERROR: You cannot grant or revoke manage_pricing
--
--   -- and not manage_permissions even to somebody else, even holding it
--   insert into public.staff_permissions (profile_id, permission, granted, granted_by)
--   select b.id, 'manage_permissions', true, a.id
--     from public.profiles a, public.profiles b
--    where a.role = 'coach' and b.role = 'coach' and a.id <> b.id limit 1;
--   -- ERROR: You cannot grant or revoke manage_permissions
--
--   -- an admin cannot be overridden
--   insert into public.staff_permissions (profile_id, permission, granted, granted_by)
--   select b.id, 'view_analytics', false, a.id
--     from public.profiles a, public.profiles b
--    where a.role = 'admin' and b.role = 'admin' and a.id <> b.id limit 1;
--   -- ERROR: An admin passes every check in the database already...
--
-- What must SUCCEED — an admin granting a coach something, and the override
-- then beating the role default in both directions:
--
--   insert into public.staff_permissions (profile_id, permission, granted, granted_by)
--   select b.id, 'manage_pricing', true, a.id
--     from public.profiles a, public.profiles b
--    where a.role = 'admin' and b.role = 'coach' limit 1;
--
--   select p.email,
--          public.profile_has_permission(p.id, 'manage_pricing'),    -- t, overridden on
--          public.profile_has_permission(p.id, 'view_own_calendar')  -- t, role default
--     from public.profiles p where p.role = 'coach';
--
-- And the role change that clears it:
--
--   update public.profiles set role = 'athlete' where id = '<that coach>';
--   select count(*) from public.staff_permissions where profile_id = '<that coach>'; -- 0
