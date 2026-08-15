-- ============================================================
-- Axis Training Systems — 036: adding a coach, without a deploy
-- ============================================================
--
-- A coach is not one record. A coach is FOUR, in four tables that nothing
-- joins, and today three of them can only be written by hand:
--
--   coach_routing          (001, +004/007 coach_slug, +014 calendly_url)
--                          which calendar a booking lands on, which inbox a
--                          lead notification goes to, and — through 011's
--                          handle_new_user — which email may sign itself in.
--                          SEED ONLY. AdminSettings edits three columns of the
--                          six rows 001 inserted; nothing anywhere creates one.
--   coach_public_settings  (007, +009's four policy columns)
--                          the row that makes a coach BOOKABLE. `loadCoachPolicy`
--                          returns null without it and both booking-availability
--                          and booking-create answer 404 unknown_coach. Seed only
--                          as well: 007 named the same five people.
--   coach_booking_services (009)
--                          which of the five services this coach offers. 009's
--                          seed was a one-shot cross join over the routing rows
--                          that existed the day it ran.
--   coach_profiles         (032)
--                          the public page. This one HAS a writer, the roster
--                          manager, and it is the only one of the four an admin
--                          can create from a screen today.
--
-- So "add a coach" is currently: open the SQL editor, write three inserts, get
-- the slug identical in all three, and remember that a fourth registry
-- (profiles.coach_slug) is set by the invitation rather than by you. Miss the
-- settings row and the new coach's booking page 404s with no clue why. Miss the
-- routing row and their leads go nowhere and they cannot sign in.
--
-- This file is that job, as one call, with one gate and one refusal sentence.
--
-- WHY AN RPC AND NOT FOUR INSERTS FROM THE PANEL. Three reasons and the third is
-- the one that decides it.
--
--   1. It is one transaction. Four round trips from a browser can half-succeed,
--      and a coach with routing but no settings is exactly the invisible broken
--      state this file exists to prevent.
--   2. Validation belongs where the constraints are. `coach_routing.coach_name`
--      is UNIQUE and `coach_routing_coach_slug_idx` is unique too, so a
--      duplicate arrives as 23505 with a Postgres sentence in it. Checked here,
--      it arrives as "A coach called Kobe Pham is already on the routing list".
--   3. The panel would otherwise need write access to `coach_routing`, and
--      001's policy on that table is `for all to authenticated using (true)`.
--      Every signed-in athlete already holds it. Building the roster feature on
--      top of that policy would make the hole load-bearing, and the hole should
--      be closed rather than depended on. A definer function with its own gate
--      needs no policy widened and leaves that cleanup free to happen later.
--
-- WHAT THIS DELIBERATELY DOES NOT DO.
--
--   It does not create an ACCOUNT. There is no auth.users row and no profiles
--   row here, because an account is a credential and a credential is claimed,
--   not granted. Two paths lead there, both already built: an invitation (012,
--   `invite-send`, role 'coach' + this slug), or the coach signing up with the
--   routing email, which `handle_new_user` (011) admits precisely because a
--   coach_routing row with that address now exists. Which is why routing is
--   created FIRST and the invitation is sent after: the order is what makes
--   both paths work.
--
--   It does not create SCHEDULES. `coach_schedules` is the coach's own working
--   hours and they set them in their portal after they claim the account. An
--   empty schedule is a coach with no open slots, not a coach who is broken.
--
--   It does not SHOW anybody. The coach_profiles row is written with
--   `is_visible = false`, so a half-filled page never appears on the public
--   roster. The payload says so, and the panel repeats it: their page starts
--   hidden, fill out the profile, then show it.
--
-- THE GUARD TRIGGER IN 032, read carefully before assuming this needs a bypass.
-- `coach_profiles_guard_trg` is `before UPDATE` and nothing else, so an INSERT
-- never reaches it and the three admin-only columns (slug, is_visible,
-- sort_order) are set here without argument. Were it ever widened to INSERT it
-- would still pass: the function is definer, but `auth.uid()` inside a definer
-- function is still the CALLER's uid, so the guard would take its second branch
-- and ask `is_axis_admin() or has_permission('manage_staff')` — which is the
-- same test section 1 has already made, one statement earlier. The touch
-- trigger stamps `updated_by` with that caller's uid for the same reason, which
-- is what we want: the row records the admin who added the coach.
--
-- THE SECOND FUNCTION, `coach_booking_wiring`, answers one question for the
-- public site: does this slug have a coach_public_settings row, i.e. can the
-- Book button be shown. `Coaches.tsx` currently decides that with a hardcoded
-- set of the five static slugs, so a provisioned coach would either be offered
-- and 404, or never be offered at all. It is anon-callable and returns a slug
-- and a boolean, nothing else. It is not a privilege: 007's `public_read_settings`
-- policy is `using (true)` and 009 grants anon the six policy columns, so a
-- browser can already read the same fact one row at a time. What the function
-- buys is one round trip for the whole roster and a surface that stays a
-- boolean if that grant is ever narrowed.
--
-- Requires 001 (coach_routing), 004 or 007 (coach_routing.coach_slug), 007
-- (coach_public_settings), 009 (the catalog and the four policy columns), 011
-- (profiles, is_axis_admin), 016 (has_permission, the manage_staff key) and 032
-- (coach_profiles). Both functions carry their own grants, per 017's rule that
-- a function created after it arrives callable by nobody.
--
-- Re-runnable.
-- ============================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────
--
-- Five tables and two helpers. Failing here with a sentence beats failing forty
-- lines into a function body with "relation public.coach_public_settings does
-- not exist", which says what is missing but not what to run.

do $do$
begin
  if to_regclass('public.coach_routing')          is null
     or to_regclass('public.coach_public_settings') is null
     or to_regclass('public.booking_services')      is null
     or to_regclass('public.coach_booking_services') is null
     or to_regclass('public.coach_profiles')        is null then
    raise exception
      'Run the migration chain through 032_coach_profiles.sql before 036_coach_provisioning.sql.'
      using errcode = '22023';
  end if;

  if to_regprocedure('public.is_axis_admin()') is null
     or to_regprocedure('public.has_permission(text)') is null then
    raise exception
      'Run 011_identity.sql and 016_permissions.sql before 036_coach_provisioning.sql.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'public.coach_routing'::regclass
       and a.attname  = 'coach_slug'
       and not a.attisdropped
  ) then
    raise exception
      'coach_routing.coach_slug is missing. Run 004_pending_content.sql or 007_google_calendar_sync.sql first.'
      using errcode = '22023';
  end if;
end
$do$;


-- ── 1. Provisioning one coach ───────────────────────────────────────────────
--
-- Six arguments, and only three of them are required in practice: the slug, the
-- name and the email. `p_first_name` falls back to the first word of the name,
-- because it is rendered in sentences ("Book a call with Ronnie") where an empty
-- string reads as a bug. `p_role_title` may be null; the roster manager is where
-- that copy really gets written. `p_time_zone` defaults to Pacific, which is
-- where Axis is, and is the same default 007 gives the column.
--
-- EVERY REFUSAL IS A SENTENCE AIMED AT A PERSON, raised with 22023 (or 42501 for
-- the gate) so `coachRoster.ts` can pass it through to the panel verbatim. That
-- is the same contract 012's invitation guards and 032's own guard trigger use,
-- and it is why the checks below duplicate constraints that would have refused
-- the write anyway: a unique-violation is correct and unreadable.
--
-- WHAT IS IDEMPOTENT AND WHAT IS NOT. Section 1 refuses outright if the slug is
-- already a coach anywhere, so this is not an upsert and running it twice for
-- the same person is an error rather than a no-op. Inside one successful run,
-- every insert is `on conflict do nothing` and every created flag is the real
-- row count: a slug that somehow already had a settings row (created by hand,
-- say, or left behind by 007's seed) keeps it, is reported as `false`, and does
-- not take the whole call down.

create or replace function public.provision_coach(
  p_slug       text,
  p_name       text,
  p_first_name text default null,
  p_email      text default null,
  p_role_title text default null,
  p_time_zone  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug     text;
  v_name     text;
  v_first    text;
  v_email    text;
  v_role     text;
  v_zone     text;
  v_order    int;
  v_rows     int;
  v_routing  boolean := false;
  v_settings boolean := false;
  v_profile  boolean := false;
  v_offers   int     := 0;
begin
  -- WHO. The same tier 018/028/032 established: an admin, or a coach an admin
  -- has trusted with manage_staff. Nothing below is reachable without it, which
  -- is why the guard trigger in 032 has nothing left to check on the insert.
  if not (public.is_axis_admin() or public.has_permission('manage_staff')) then
    raise exception 'Only an admin, or a coach with Manage staff, can add a coach.'
      using errcode = '42501';
  end if;

  v_slug  := lower(btrim(coalesce(p_slug, '')));
  v_name  := btrim(coalesce(p_name, ''));
  v_first := nullif(btrim(coalesce(p_first_name, '')), '');
  v_email := lower(btrim(coalesce(p_email, '')));
  v_role  := nullif(btrim(coalesce(p_role_title, '')), '');
  v_zone  := coalesce(nullif(btrim(coalesce(p_time_zone, '')), ''), 'America/Los_Angeles');

  -- SHAPE. `{1,64}` rather than 032's open-ended `+`: the slug travels in a URL,
  -- in an edge function's SLUG_RE (booking-availability uses exactly this
  -- pattern) and in five other tables' text columns, and nothing good happens
  -- past sixty-four characters.
  if v_slug = '' then
    raise exception 'A coach needs an address for their page, for example ronnie-vallejo.'
      using errcode = '22023';
  end if;
  if v_slug !~ '^[a-z0-9-]{1,64}$' then
    raise exception 'The address can use lowercase letters, numbers and hyphens only, for example ronnie-vallejo.'
      using errcode = '22023';
  end if;

  if v_name = '' then
    raise exception 'A coach needs a name.' using errcode = '22023';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'That name is too long. Keep it to 120 characters or fewer.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_first, '')) > 120 then
    raise exception 'That first name is too long. Keep it to 120 characters or fewer.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_role, '')) > 120 then
    raise exception 'That role title is too long. Keep it to 120 characters or fewer.' using errcode = '22023';
  end if;

  -- The email is the credential half. It is what an invitation is addressed to
  -- and what handle_new_user matches on, so a typo here is a coach who cannot
  -- sign in and a lead notification into nowhere.
  if v_email = '' then
    raise exception 'A coach needs an email address. It is where their invitation and their lead notifications go.'
      using errcode = '22023';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'That does not look like an email address.' using errcode = '22023';
  end if;

  -- A zone Postgres cannot resolve corrupts every slot this coach will ever
  -- offer, and it does not fail at the CHECK on coach_public_settings: `at time
  -- zone 'Mars/Olympus'` RAISES rather than returning null, so the constraint
  -- never gets to answer. Asked here, it is a sentence instead of a 22023 from
  -- a cast three statements later.
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_zone) then
    raise exception 'That is not a time zone this database knows. Try America/Los_Angeles.'
      using errcode = '22023';
  end if;

  -- ALREADY SOMEBODY. Five questions, five different answers, because "taken"
  -- means something different in each registry and the person fixing it needs to
  -- know which one it was.
  if exists (select 1 from public.coach_routing r where r.coach_slug = v_slug) then
    raise exception 'A coach already books under the address %. Pick a different one.', v_slug
      using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles p where p.coach_slug = v_slug) then
    raise exception 'That address already belongs to somebody with an account.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.coach_profiles c where c.slug = v_slug) then
    raise exception 'A coach page already lives at /coach/%. Pick a different address.', v_slug
      using errcode = '22023';
  end if;
  if exists (select 1 from public.coach_routing r where lower(btrim(r.email)) = v_email) then
    raise exception 'That email address already routes to a coach. One address, one calendar.'
      using errcode = '22023';
  end if;
  -- coach_routing.coach_name is UNIQUE, and it is also what `leads.coach_pref`
  -- matches on, so two coaches with one name would be two calendars nobody can
  -- tell apart. Compared case-insensitively even though the index is not: the
  -- ambiguity is in the reading, not in the bytes.
  if exists (select 1 from public.coach_routing r where lower(btrim(r.coach_name)) = lower(v_name)) then
    raise exception 'A coach called % is already on the routing list.', v_name
      using errcode = '22023';
  end if;

  -- ── the four rows ────────────────────────────────────────────────────────
  --
  -- ROUTING first, because it is what makes the address a credential: from this
  -- statement on, `handle_new_user` will admit an account created with this
  -- email even if the invitation is never sent. `is_admin` is false and stays
  -- false; that flag is 005's content-admin allowlist and a new coach is not on
  -- it. `notify` is true because a coach who is not told about their own leads
  -- is the default nobody wants.
  insert into public.coach_routing (coach_name, email, coach_slug, notify, is_admin)
  values (v_name, v_email, v_slug, true, false)
  on conflict (coach_name) do nothing;
  get diagnostics v_rows = row_count;
  v_routing := v_rows > 0;

  -- BOOKABLE. The row itself is the switch; the four policy columns take 009's
  -- defaults (min_lead_minutes 120, max_advance_days 70, buffer_minutes 0,
  -- auto_confirm false), which are not restated here on purpose. Restating them
  -- would make this file a second place the studio's booking policy is written
  -- and the two would drift the first time somebody tuned 009.
  insert into public.coach_public_settings (coach_slug, time_zone)
  values (v_slug, v_zone)
  on conflict (coach_slug) do nothing;
  get diagnostics v_rows = row_count;
  v_settings := v_rows > 0;

  -- THE MENU, in 009's own shape: every active service, at the catalog's order
  -- and the catalog's price. "Every coach offers everything to start with" is
  -- 009's rule and the reasoning it gives still holds: a coach who does not do
  -- mentorship turns that one off in their portal, because the roster is not
  -- who decides. Inactive services are skipped: a retired service should not
  -- come back to life on the next hire.
  insert into public.coach_booking_services (coach_slug, service_id, sort_order)
  select v_slug, s.id, s.sort_order
    from public.booking_services s
   where s.is_active
  on conflict (coach_slug, service_id) do nothing;
  get diagnostics v_offers = row_count;

  -- THE PAGE, hidden. `sort_order` is max + 1 so a new coach lands at the end of
  -- the roster rather than at position 0, clamped to 1000 by
  -- coach_profiles_sort_order_sane. Everything else on the row is left at its
  -- default for the roster manager to fill in, which is the screen built for it.
  select coalesce(max(c.sort_order), -1) + 1 into v_order from public.coach_profiles c;
  if v_order > 1000 then v_order := 1000; end if;

  insert into public.coach_profiles (slug, name, first_name, role_title, is_visible, sort_order)
  values (
    v_slug,
    v_name,
    coalesce(v_first, nullif(split_part(v_name, ' ', 1), '')),
    v_role,
    false,
    v_order
  )
  on conflict (slug) do nothing;
  get diagnostics v_rows = row_count;
  v_profile := v_rows > 0;

  return jsonb_build_object(
    'slug',      v_slug,
    'name',      v_name,
    'email',     v_email,
    'time_zone', v_zone,
    'created', jsonb_build_object(
      'routing',         v_routing,
      'public_settings', v_settings,
      'services',        v_offers > 0,
      'profile',         v_profile
    ),
    'service_offers',  v_offers,
    'profile_visible', false,
    'note',            'Their page starts hidden. Fill out their profile, then show it. They set their own hours after they claim their account.'
  );
end $$;

comment on function public.provision_coach(text, text, text, text, text, text) is
  'Creates the three registry rows a coach needs to exist (coach_routing, '
  'coach_public_settings, coach_booking_services) plus a hidden coach_profiles '
  'page, in one transaction, for an admin or a manage_staff holder. Creates no '
  'account: that is claimed through an invitation (012) or by signing up with '
  'the routing email (011). Refuses with a sentence, never a constraint code.';

-- 017's rule, stated rather than assumed. `service_role` is deliberately NOT on
-- the list: the gate reads a session and a service-role call has none, so the
-- grant would be an invitation to a refusal.
revoke all     on function public.provision_coach(text, text, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.provision_coach(text, text, text, text, text, text) to authenticated;


-- ── 2. Which slugs can actually take a booking ──────────────────────────────
--
-- One question, one boolean, for a page that has no session. `Coaches.tsx` marks
-- a coach bookable today with `STATIC_SLUGS.has(slug)`, a set of the five people
-- in `data/coaches.ts`, which is wrong in both directions the moment the roster
-- lives in a table: a provisioned coach is never offered, and one of the five
-- whose settings row was removed is offered and 404s.
--
-- The array is bounded and shape-checked before it reaches the table. Neither is
-- a security control (the answer is public either way, see the header) and both
-- are politeness: a caller who posts ten thousand strings gets two hundred rows
-- back rather than a sequential scan per string. Two hundred is two orders of
-- magnitude above the roster and is a cap rather than a page, so a caller who
-- ever has more coaches than that has to ask in batches.
--
-- `has_settings` is the whole surface. Not the time zone, not the lead time, not
-- whether the row was created yesterday. Everything else on that table is
-- already anon-readable through 009's column grant, and this function existing
-- is what lets that grant be narrowed later without touching the roster page.

create or replace function public.coach_booking_wiring(p_slugs text[])
returns table (coach_slug text, has_settings boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with requested as (
    select distinct lower(btrim(s.value)) as slug
      from unnest(coalesce(p_slugs, array[]::text[])) as s(value)
     where s.value is not null
       and lower(btrim(s.value)) ~ '^[a-z0-9-]{1,64}$'
     limit 200
  )
  select r.slug,
         exists (
           select 1 from public.coach_public_settings cps
            where cps.coach_slug = r.slug
         )
    from requested r
$$;

comment on function public.coach_booking_wiring(text[]) is
  'For each slug asked about, whether a coach_public_settings row exists, which '
  'is exactly the switch loadCoachPolicy reads and therefore whether the Book '
  'button should be shown. Exposes nothing else about the coach.';

revoke all     on function public.coach_booking_wiring(text[]) from public, anon, authenticated;
grant  execute on function public.coach_booking_wiring(text[]) to anon, authenticated;


-- ── 3. Verify ───────────────────────────────────────────────────────────────
--
-- Every result below was produced against a throwaway PostgreSQL 17 with the
-- objects this file requires and 032 applied verbatim.
--
-- SHAPE first. Two functions, both definer, and neither one anon-callable
-- except the one that is meant to be:
--
--   select proname, prosecdef, provolatile from pg_catalog.pg_proc
--    where proname in ('provision_coach', 'coach_booking_wiring');
--   -- provision_coach       t  v
--   -- coach_booking_wiring  t  s
--
--   select has_function_privilege('anon',          'public.provision_coach(text,text,text,text,text,text)', 'execute');  -- f
--   select has_function_privilege('authenticated', 'public.provision_coach(text,text,text,text,text,text)', 'execute');  -- t
--   select has_function_privilege('anon',          'public.coach_booking_wiring(text[])', 'execute');                    -- t
--
-- THE GATE. A PLAIN COACH is the case that matters, because a coach holds six
-- permissions by default and manage_staff is not one of them:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a plain coach uuid>';
--     select public.has_permission('manage_staff');                    -- f
--     select public.provision_coach('nia-adeyemi', 'Nia Adeyemi', 'Nia',
--                                   'nia@axistrainingsystems.com', 'Team Axis Coach', null);
--     -- ERROR (42501): Only an admin, or a coach with Manage staff, can add a coach.
--   rollback;
--
-- and an athlete, and anon, fail one step earlier, on the grant:
--
--   set role anon;
--   select public.provision_coach('x', 'X', null, 'x@example.com', null, null);
--   -- ERROR: permission denied for function provision_coach
--   reset role;
--
-- THE HAPPY PATH, as an admin. Four rows and a payload:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<an admin uuid>';
--     select public.provision_coach('nia-adeyemi', 'Nia Adeyemi', 'Nia',
--                                   'Nia@AxisTrainingSystems.com ', 'Team Axis Coach', null);
--   -- {"name": "Nia Adeyemi", "note": "Their page starts hidden. ...",
--   --  "slug": "nia-adeyemi", "email": "nia@axistrainingsystems.com",
--   --  "created": {"profile": true, "routing": true, "services": true,
--   --              "public_settings": true},
--   --  "time_zone": "America/Los_Angeles", "service_offers": 5,
--   --  "profile_visible": false}
--
--     select coach_name, email, coach_slug, notify, is_admin
--       from public.coach_routing where coach_slug = 'nia-adeyemi';
--     -- Nia Adeyemi | nia@axistrainingsystems.com | nia-adeyemi | t | f
--
--     select count(*) from public.coach_booking_services where coach_slug = 'nia-adeyemi';  -- 5
--
--     select slug, is_visible, sort_order, first_name, role_title, updated_by = auth.uid()
--       from public.coach_profiles where slug = 'nia-adeyemi';
--     -- nia-adeyemi | f | 5 | Nia | Team Axis Coach | t
--     -- hidden, at the end of the roster, and stamped with the admin who added them
--
--     -- and the row that makes them bookable is exactly what loadCoachPolicy
--     -- selects (booking.ts:41), so the booking page stops answering 404:
--     select time_zone, min_lead_minutes, max_advance_days, buffer_minutes, auto_confirm
--       from public.coach_public_settings where coach_slug = 'nia-adeyemi';
--     -- America/Los_Angeles | 120 | 70 | 0 | f
--
--     select * from public.coach_booking_wiring(array['nia-adeyemi', 'not-a-coach']);
--     -- nia-adeyemi  | t
--     -- not-a-coach  | f
--   rollback;
--
-- THE REFUSALS. Each of the six is a different sentence, and the duplicate slug
-- is the one the panel will hit most:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<an admin uuid>';
--
--     select public.provision_coach('kobe-pham', 'Kobe Two', null, 'kobe2@axis.com', null, null);
--     -- ERROR (22023): A coach already books under the address kobe-pham. Pick a different one.
--
--     select public.provision_coach('kobe-two', 'Kobe Pham', null, 'kobe2@axis.com', null, null);
--     -- ERROR (22023): A coach called Kobe Pham is already on the routing list.
--
--     select public.provision_coach('kobe-two', 'Kobe Two', null,
--                                   'kobe@axistrainingsystems.com', null, null);
--     -- ERROR (22023): That email address already routes to a coach. One address, one calendar.
--
--     select public.provision_coach('Nia Adeyemi', 'Nia', null, 'nia@axis.com', null, null);
--     -- ERROR (22023): The address can use lowercase letters, numbers and hyphens only, ...
--
--     select public.provision_coach('nia-adeyemi', 'Nia', null, 'nia at axis.com', null, null);
--     -- ERROR (22023): That does not look like an email address.
--
--     select public.provision_coach('nia-adeyemi', 'Nia', null, 'nia@axis.com', null, 'Mars/Olympus');
--     -- ERROR (22023): That is not a time zone this database knows. Try America/Los_Angeles.
--
--     -- a page at that address with no routing row behind it is still a refusal,
--     -- and a different one, because the fix is different:
--     insert into public.coach_profiles (slug, name) values ('orphan-page', 'Orphan Page');
--     select public.provision_coach('orphan-page', 'Orphan Page', null, 'orphan@axis.com', null, null);
--     -- ERROR (22023): A coach page already lives at /coach/orphan-page. Pick a different address.
--   rollback;
--
-- THE GUARD IN 032, on the row this file inserts. It is `before update`, so the
-- insert above never consults it, and a coach editing their own new page still
-- cannot show themselves:
--
--   select tgname, tgtype from pg_catalog.pg_trigger
--    where tgrelid = 'public.coach_profiles'::regclass and not tgisinternal;
--   -- coach_profiles_guard_trg 19 (before | update), coach_profiles_touch_trg 23
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<nia uuid, once she has claimed>';
--     update public.coach_profiles set tagline = 'Mine' where slug = 'nia-adeyemi';  -- UPDATE 1
--     update public.coach_profiles set is_visible = true where slug = 'nia-adeyemi';
--     -- ERROR (P0001): Only an admin can change that field. ...
--   rollback;
--
-- THE WIRING FUNCTION, from a browser with no session at all:
--
--   set role anon;
--   select * from public.coach_booking_wiring(array['kobe-pham', 'KOBE-PHAM', ' kobe-pham ',
--                                                   'nobody', 'not a slug', null]);
--   -- kobe-pham | t
--   -- nobody    | f
--   -- (the two malformed entries are dropped and the three spellings of
--   --  kobe-pham collapse to one row)
--   select * from public.coach_booking_wiring(null);             -- 0 rows, no error
--   select * from public.coach_booking_wiring(array[]::text[]);  -- 0 rows
--   select count(*) from public.coach_booking_wiring(
--     (select array_agg('slug-' || g) from generate_series(1, 5000) g));   -- 200, capped
--   -- and the other function is still not theirs to call:
--   select public.provision_coach('a-b', 'A B', null, 'a@b.co', null, null);
--   -- ERROR: permission denied for function provision_coach
--   reset role;
--
-- RE-RUNNABILITY. Applying this file twice replaces two functions and changes
-- no data. Provisioning the same coach twice is refused by section 1, which is
-- the correct behaviour and not a re-runnability problem:
--
--   \i supabase/migrations/036_coach_provisioning.sql
--   select count(*) from public.coach_routing;   -- unchanged
-- ============================================================
