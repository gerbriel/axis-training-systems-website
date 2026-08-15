-- ============================================================
-- Axis Training Systems, 039: who has actually connected a calendar
-- ============================================================
--
-- BOOKABLE AND CONNECTED ARE TWO DIFFERENT FACTS, and today a staff screen can
-- only see the first one.
--
--   bookable   a `coach_public_settings` row exists (007). `loadCoachPolicy`
--              reads it, both booking edge functions 404 without it, and
--              `coach_booking_wiring` (036) is how the roster asks.
--   connected  a `private.coach_calendar_connections` row exists (007). It is
--              what turns a booking into an event on a Google calendar, and it
--              is the only thing that can ever produce a Google Meet link.
--
-- A coach can be perfectly bookable and not connected. That is a SUPPORTED
-- state, not a fault: `bookings_set_sync_status` (007) sees no connection row
-- and marks the booking 'skipped' before it is written, the booking commits, the
-- client gets their confirmation email, and everybody involved is happy. What
-- nobody gets is a video link. `google_meet_url` stays null on that row forever,
-- because a Meet link is only ever minted by an event INSERT with
-- conferenceDataVersion set, and a skipped booking never has one.
--
-- Nothing anywhere says so. Not the booking page, not the coach's portal, and
-- above all not the admin screen where a person would go looking after a client
-- asks where the call is. The two functions 007 already has cannot answer it for
-- a staff screen:
--
--   calendar_connection_list()    service_role only. It is the cron's worklist,
--                                 and it hands back calendar ids besides.
--   calendar_connection_status()  the signed-in coach's OWN row, derived from
--                                 their JWT, taking no argument on purpose so
--                                 there is nothing to tamper with. It cannot be
--                                 asked about somebody else and should not be.
--
-- So this file adds the third question, for the third audience, and answers it
-- with one bit per coach.
--
-- WHAT IS EXPOSED, AND WHAT IS DELIBERATELY NOT. A boolean. Not the Google
-- address, not the calendar id, not `last_synced_at`, not `last_sync_error`,
-- not `connected_at`. Those belong to the coach and they live in the `private`
-- schema alongside the encrypted refresh token, which is the whole reason that
-- schema exists. An admin needs to know whether to go and ask somebody to
-- connect; they do not need to know which Gmail account it was.
--
-- WHY SECURITY DEFINER. `authenticated` holds no USAGE on schema `private` and
-- must not, so no policy or grant can make this readable directly. A definer
-- function is the only door, and this one is a one-bit door with a lock on it.
--
-- THE GATE is the same tier 036 uses for the roster: an admin, or a coach an
-- admin has trusted with `manage_staff`. A plain coach is refused, with a
-- sentence, at 42501. That matters more here than it does for
-- `coach_booking_wiring`, which is anon-callable because the fact it returns is
-- already public. This fact is not public and is not derivable: nothing anon or
-- authenticated can read tells you whether a given coach has a Google
-- connection.
--
-- Requires 007 (private.coach_calendar_connections), 011 (is_axis_admin) and
-- 016 (has_permission). Carries its own grants, per 017's rule that a function
-- created after it arrives callable by nobody.
--
-- Re-runnable.
-- ============================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────
--
-- One table and two helpers. Failing here with a sentence beats failing inside
-- the function body with "schema private does not exist", which says what is
-- missing but not what to run.

do $do$
begin
  if to_regclass('private.coach_calendar_connections') is null then
    raise exception
      'Run 007_google_calendar_sync.sql before 039_calendar_visibility.sql.'
      using errcode = '22023';
  end if;

  if to_regprocedure('public.is_axis_admin()') is null
     or to_regprocedure('public.has_permission(text)') is null then
    raise exception
      'Run 011_identity.sql and 016_permissions.sql before 039_calendar_visibility.sql.'
      using errcode = '22023';
  end if;
end
$do$;


-- ── 1. One bit per coach ────────────────────────────────────────────────────
--
-- The array is normalised, deduplicated, shape-checked and capped at two
-- hundred, exactly as `coach_booking_wiring` (036) does it, and for the same two
-- reasons: a caller who posts ten thousand strings gets two hundred rows back
-- rather than a sequential scan per string, and the three spellings of one slug
-- collapse into the one row a screen can render. Unlike 036 the cap here is also
-- a privacy bound of sorts: a gated caller cannot page the whole connection
-- table one enormous array at a time, they can only ask about coaches they can
-- already name.
--
-- plpgsql rather than 036's plain sql, for one reason: the gate has to REFUSE.
-- A sql function can filter to zero rows but it cannot raise, and "no rows"
-- would read on screen as "nobody has connected", which is the exact wrong
-- answer to give somebody who is not allowed to ask.
--
-- Every column reference inside is table-qualified. The OUT parameters are named
-- `coach_slug` and `connected`, and `coach_slug` is also a column on the table
-- being read, so an unqualified mention would be an ambiguity error at runtime
-- rather than at create time.

create or replace function public.coach_calendar_connected(p_slugs text[])
returns table (coach_slug text, connected boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_axis_admin() or public.has_permission('manage_staff')) then
    raise exception 'Only an admin, or a coach with Manage staff, can see who has connected a calendar.'
      using errcode = '42501';
  end if;

  return query
  with requested as (
    select distinct lower(btrim(s.value)) as slug
      from unnest(coalesce(p_slugs, array[]::text[])) as s(value)
     where s.value is not null
       and lower(btrim(s.value)) ~ '^[a-z0-9-]{1,64}$'
     limit 200
  )
  select r.slug,
         exists (
           select 1 from private.coach_calendar_connections c
            where c.coach_slug = r.slug
         )
    from requested r;
end $$;

comment on function public.coach_calendar_connected(text[]) is
  'For each slug asked about, whether that coach has a Google Calendar '
  'connection, which is what decides whether their bookings can carry a Google '
  'Meet link. A boolean and nothing else: no Google address, no calendar id, no '
  'sync state. Admin or manage_staff only.';

-- 017's rule, stated rather than assumed. `service_role` is granted so that a
-- trusted server-side caller meets the GATE rather than the grant, which is the
-- readable failure of the two. Note what that means today: the gate reads a
-- session, and a service-role call carries none, so `is_axis_admin()` and
-- `has_permission` are both false and such a call is refused with the sentence
-- above. Nothing calls it that way; a server-side caller that needs the same
-- fact should read `private.coach_calendar_connections` directly, as
-- `calendar_connection_list` already does.
revoke all     on function public.coach_calendar_connected(text[]) from public, anon, authenticated;
grant  execute on function public.coach_calendar_connected(text[]) to authenticated, service_role;


-- ── 2. Verify ───────────────────────────────────────────────────────────────
--
-- SHAPE first. Definer, stable, and not anon's to call:
--
--   select proname, prosecdef, provolatile, proconfig
--     from pg_catalog.pg_proc where proname = 'coach_calendar_connected';
--   -- coach_calendar_connected | t | s | {search_path=""}
--
--   select has_function_privilege('anon',          'public.coach_calendar_connected(text[])', 'execute');  -- f
--   select has_function_privilege('authenticated', 'public.coach_calendar_connected(text[])', 'execute');  -- t
--   select has_function_privilege('service_role',  'public.coach_calendar_connected(text[])', 'execute');  -- t
--
-- THE GATE. A PLAIN COACH is the case that matters, because a coach holds six
-- permissions by default and manage_staff is not one of them. They can read
-- their OWN connection through 007's status function and still cannot ask about
-- anybody else's:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a plain coach uuid>';
--     select public.has_permission('manage_staff');                                 -- f
--     select * from public.calendar_connection_status();                            -- their own row
--     select * from public.coach_calendar_connected(array['kobe-pham']);
--     -- ERROR (42501): Only an admin, or a coach with Manage staff, can see who
--     --                has connected a calendar.
--   rollback;
--
-- and anon fails one step earlier, on the grant:
--
--   set role anon;
--   select * from public.coach_calendar_connected(array['kobe-pham']);
--   -- ERROR: permission denied for function coach_calendar_connected
--   reset role;
--
-- THE ANSWER, as an admin, with one connected coach and one not:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<an admin uuid>';
--
--     insert into private.coach_calendar_connections (coach_slug, refresh_token_enc)
--     values ('kobe-pham', 'not-a-real-token')
--     on conflict (coach_slug) do nothing;
--
--     select * from public.coach_calendar_connected(
--       array['kobe-pham', 'KOBE-PHAM', ' kobe-pham ', 'aedan-nguyen', 'nobody', 'not a slug', null]);
--     -- kobe-pham     | t
--     -- aedan-nguyen  | f
--     -- nobody        | f
--     -- (the malformed entry is dropped, null is dropped, and the three
--     --  spellings of kobe-pham collapse to one row)
--
--     select * from public.coach_calendar_connected(null);             -- 0 rows, no error
--     select * from public.coach_calendar_connected(array[]::text[]);  -- 0 rows
--     select count(*) from public.coach_calendar_connected(
--       (select array_agg('slug-' || g) from generate_series(1, 5000) g));   -- 200, capped
--   rollback;
--
-- A MANAGE_STAFF COACH gets the same answer an admin does, which is the point of
-- that permission:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a coach holding manage_staff>';
--     select * from public.coach_calendar_connected(array['kobe-pham']);   -- kobe-pham | t
--   rollback;
--
-- NOTHING PRIVATE LEAKS. The function is the only new reader of that table and
-- it returns two columns, neither of which is a token, an address or a calendar
-- id. The schema itself is still closed:
--
--   set role authenticated;
--   select * from private.coach_calendar_connections;
--   -- ERROR: permission denied for schema private
--   reset role;
--
-- RE-RUNNABILITY. Applying this file twice replaces one function and changes no
-- data.
--
--   \i supabase/migrations/039_calendar_visibility.sql
-- ============================================================
