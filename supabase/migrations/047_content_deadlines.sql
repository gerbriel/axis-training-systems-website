-- ============================================================
-- Axis Training Systems — 047: the blog rotation, on the calendar
-- ============================================================
--
-- "The calendar is synced with the blog due dates." Concretely: a coach's
-- editorial deadline should appear on the same grid as their bookings and their
-- blocked time, because a deadline the coach never sees is competing with those
-- bookings for the same hours and losing silently.
--
-- `content_rotation` (005) is the only DATED obligation Axis owns that has never
-- appeared on a calendar. It has lived on its own admin panel since 005, next to
-- nothing. Everything else with a date on it — the calls (bookings), the time
-- off (coach_availability_blocks), the working hours (coach_schedules), the
-- external holds (coach_calendar_busy) — was merged into one stream by 021.
-- This migration finishes that sentence.
--
--
-- ── WHY A TWIN OF calendar_events, AND NOT A SIXTH BRANCH INSIDE IT ─────────
--
-- The obvious move is a sixth `return query` in `public.calendar_events`. It is
-- wrong, and the reason is arithmetic rather than taste.
--
-- `calendar_events` returns `starts_at` / `ends_at` as timestamptz — absolute
-- instants — and it has no `p_tz` parameter. A branch over `content_rotation`
-- would therefore have to turn a DATE into an instant server-side, the only way
-- the function knows how (021 branch 2, the whole-day block):
--
--     (due_date::timestamp) at time zone coalesce(cps.time_zone, 'America/Los_Angeles')
--
-- The panel then buckets that instant back into a day cell using the VIEWER's
-- browser zone (src/pages/admin/CalendarPanel.tsx:101), with an OVERLAP test
-- (CalendarPanel.tsx:181-188):
--
--     e > start && s < end
--
-- Two zones, one date, and an overlap test is a smear. Worked example, a Pacific
-- coach with a deadline named 2026-08-15:
--
--     server-side instants:  2026-08-15T07:00Z .. 2026-08-16T07:00Z
--
--     a New York viewer:  Aug 15 cell = 08-15T04:00Z .. 08-16T04:00Z  -> OVERLAPS
--                         Aug 16 cell = 08-16T04:00Z .. 08-17T04:00Z  -> OVERLAPS
--                         the deadline draws TWICE, on two different days
--
--     a Honolulu viewer:  Aug 14 cell = 08-14T10:00Z .. 08-15T10:00Z  -> OVERLAPS
--                         Aug 15 cell = 08-15T10:00Z .. 08-16T10:00Z  -> OVERLAPS
--                         the deadline draws on Aug 14, a day that is not its name
--
-- That is exactly the bug class `src/lib/tz.ts` exists to prevent, committed in
-- SQL where no test in this repo can reach it. A due date is a DATE. It has no
-- hour, it has no instant, and only the client knows which zone is being read.
--
-- So: this function hands back DATES and nothing else, and the client anchors
-- them to local midnight in the DISPLAY zone with the identical
-- `zonedDateTimeToUtc` pair the panel's own `dayBoundsMs` uses. The event's
-- bounds then equal the day cell's bounds byte for byte, and the overlap test
-- matches exactly one cell, provably, in every zone. See src/lib/deadlines.ts.
--
-- The second reason is smaller but not nothing: 021 is created with DROP +
-- CREATE, not CREATE OR REPLACE, over a five-branch body whose fifteen-column
-- SELECT lists are positional and unaliased. Recreating it to append one chip
-- risks two silent failures — a transposed pair of same-typed columns puts a
-- client email in the `service` column, and a forgotten grant leaves an RPC
-- callable by nobody, which the frontend renders as an empty calendar. Neither
-- is a risk worth taking for a payload of one date per coach per two months.
--
--
-- ── WHY IT RETURNS DATE AND NOT timestamptz ────────────────────────────────
--
-- Because that is what the column is. `cycle_start` and `due_date` are `date`
-- (005:23-24). Casting either to timestamptz here resolves it against the SERVER
-- TimeZone (UTC on Supabase), which lands a Pacific viewer's deadline on the
-- previous local day. Returning the date unconverted is not laziness, it is the
-- only representation that cannot be wrong before the display zone is known.
--
-- It also means there is NO window padding anywhere in this file, unlike 021's
-- v_lo / v_hi. Padding exists to absorb UTC bucketing at the edges of a range.
-- Nothing here is bucketed, so a plain `due_date between p_from and p_to` is
-- exact, and it is index-supported by `content_rotation_due_idx` (005:34).
--
--
-- ── WHY NO NEW POLICY, GRANT OR PERMISSION KEY ─────────────────────────────
--
-- SECURITY INVOKER, and the reads it makes are already secured:
--
--   * 017:1245 already grants `select` on `public.content_rotation` to
--     `authenticated`, covering all four columns this function names. Nothing to
--     add.
--   * Four permissive policies already govern the read (005 rotation_admin_write
--     via its FOR ALL USING, 017 rotation_staff_read, 040 "view_blog reads the
--     rotation", 040 "manage_blog writes the rotation" via its FOR ALL USING).
--     Postgres ORs them.
--
-- Read the second bullet carefully, because it is the trap in this table.
-- `rotation_staff_read` is:
--
--     using (public.current_coach_slug() is not null or public.is_axis_admin())
--
-- Its USING clause names NO COLUMN of content_rotation. It is a table-wide
-- yes/no, not a row filter. Any coach who passes it can select EVERY coach's
-- cycles, and RLS will never say otherwise. So the `(v_scope is null or
-- cr.coach_slug = v_scope)` predicate in the body below is THE SECURITY
-- BOUNDARY, not decoration — precisely the situation 021's own header already
-- describes for coach_schedules and coach_availability_blocks:
--
--     "RLS does NOT scope these per coach, so the explicit `v_scope` filter
--      below is what carries the SAME 'your own only' rule onto them"
--
-- Delete that one line and every coach's blog deadlines appear on every other
-- coach's personal calendar, with no error anywhere.
--
--
-- ── THE GATE IS 021'S GATE, CHARACTER FOR CHARACTER ────────────────────────
--
--     if not v_is_admin and v_my_slug is null then return; end if;
--
-- Deliberately copied, not adapted, so the two surfaces can never disagree about
-- who has a calendar. An active admin sees the roster (optionally narrowed with
-- p_coach); an active coach sees their own slug and only their own, with p_coach
-- ignored entirely. An athlete, a suspended coach, anon, and the service role
-- (auth.uid() is null, so both helpers are false) get an empty stream before a
-- table is touched.
--
-- One consequence worth stating because it looks like a bug and is not: an
-- editor holding `view_blog` with no coach_slug and no admin role gets nothing
-- here, which makes 040's "view_blog reads the rotation" policy dead code behind
-- this gate. That is the same nothing they already get from calendar_events. See
-- non-goal 4 below.
--
--
-- ── EXPLICIT NON-GOALS (so nobody reopens them by accident) ────────────────
--
-- 1. NO PUSH TO GOOGLE. This is a correctness refusal, not a cost one. The
--    outbound path is supabase/functions/_shared/mirror.ts; it is bookings-only
--    and keyed on `google_event_id` / `google_calendar_id`, columns that live on
--    public.bookings and that no rotation row has. 007:870-874 records that
--    `google_sync_outbox` deliberately has NO drain, so "just enqueue it" writes
--    rows nobody ever reads. `eventBody` (_shared/google.ts:445-452) has no
--    `date:` branch, so an all-day deadline would go out as a timed 24-hour
--    event. And decisively: calendar-sync's `excludeOwnBookings`
--    (calendar-sync/index.ts:255-261) only spares intervals contained inside a
--    booking with a non-null google_event_id, so a pushed deadline returns on
--    the next freeBusy import as a full day of `coach_calendar_busy` and closes
--    that coach's entire bookable day. A calendar decoration would eat a day of
--    revenue.
--
-- 2. NO ICS DOWNLOAD in this change. src/lib/ics.ts cannot express an all-day
--    VEVENT: `stamp()` (ics.ts:24-26) unconditionally emits a UTC datetime with
--    a Z suffix, so a date-only deadline lands on the wrong day for every viewer
--    west of UTC. Both its callers are public visitor booking pages, so a
--    coach-facing download is a brand-new authorized surface, not a button. If
--    it is wanted later the correct shape is a new builder in deadlines.ts
--    emitting `DTSTART;VALUE=DATE:<due>` with an EXCLUSIVE
--    `DTEND;VALUE=DATE:<due + 1 day>`, UID `rotation-<cycle_id>@...`, folded with
--    the 75-OCTET UTF-8-safe fold() in supabase/functions/_shared/ics.ts:56-74,
--    which is the complete builder. Never src/lib/ics.ts, which is the weaker.
--
-- 3. NO COMPLETION STATE. content_rotation has no status column BY DESIGN
--    (005's header: a status column drifts out of sync the moment a post is
--    edited), and completion is derived in src/lib/rotationApi.ts from a
--    pending_content submission inside the cycle window. A second definition in
--    SQL would be two answers to one question, and it could not even be a
--    correct second answer: pending_content's `coach_read_own` policy (004:136)
--    scopes a coach to their OWN submissions while content_rotation scopes to
--    none, so a join computed in this body would report every OTHER coach's
--    finished cycle as unfinished. The honest consequence is why the copy is
--    neutral: the chip reads "Blog post due" on every due date, past or future,
--    and never "overdue", so it states an assignment and never accuses a coach
--    who already filed.
--
-- 4. NO GATE WIDENING. Letting a view_blog holder with no slug through here
--    would mean widening 021's gate too, and that hands them branch 1: client
--    names, client emails and client phone numbers. docs/SECURITY.md places that
--    transfer in the deliberately-deferred tranche alongside `view_all_calendars`
--    and `manage_bookings_all`. It is a permissions migration with its own
--    argument, not a line in this file.
--
-- 5. NO SECOND MARKER ON cycle_start, AND NO IN-WINDOW RAIL. The windows are
--    CONTIGUOUS: 005's seed sets `cycle_start = due_date - 2 months` against a
--    2-month cadence, and the rotation plan computes cycleStart as a full loop
--    (step * members) before the due date. Under both, cycle_start of cycle N
--    equals due_date of cycle N-1 for the same coach, always. So a "cycle opens"
--    marker would land on the same day, for the same coach, as the previous
--    cycle's due marker every single time, and a rail over in-window days would
--    paint every cell of the grid for every coach. The window survives as PROSE
--    in the event's `reason`, which the panel's all-day banner already renders as
--    a tooltip for free. If the cadence ever becomes non-contiguous, a low-weight
--    marker is a few lines in buildDeadlineEvents and needs no schema change.
--
-- Re-runnable: an additive column grant, then drop + create of one function.
-- ============================================================


-- ============================================================
-- 1. A one-line repair to migration 021, which has been throwing
-- ============================================================
--
-- This does not belong to the deadlines feature. It is here because the feature
-- cannot be verified without it, and because merging on top of a read model that
-- currently raises would have handed the blame to whoever touched it next.
--
-- 021 branch 4 (021_calendar.sql:213) builds its event_id from
-- `coach_calendar_busy.id`:
--
--     'busy:' || cb.id::text
--
-- but that column is not readable by the caller. 007:238 gave `authenticated` a
-- TABLE-level `grant select on public.coach_calendar_busy` and never a column
-- grant. 017:1264 then did `revoke all ... from anon, authenticated`, which in
-- PostgreSQL drops table-level and column-level privileges alike, and 017:1265
-- re-granted only `select (coach_slug, starts_at, ends_at)`. `id` survives under
-- neither reading of revoke-vs-column-grant semantics, because `authenticated`
-- never held a column grant on `id` to survive in the first place. No later
-- migration re-grants it.
--
-- Reproduced against a scratch PostgreSQL replaying those exact statements:
--
--     has_column_privilege('authenticated', 'public.coach_calendar_busy', 'id', 'select')  -- f
--     select 'busy:' || cb.id::text from public.coach_calendar_busy cb;
--     -- ERROR: permission denied for table coach_calendar_busy
--
-- Because `calendar_events` is SECURITY INVOKER, that error is raised inside the
-- function for EVERY signed-in caller, admin and coach alike, and it aborts the
-- whole RPC — so branches 1 through 3 return nothing either. And because
-- src/lib/calendar.ts:120 does `if (error || !data) return []`, the client shows
-- an EMPTY CALENDAR rather than an error. 021's own header claims the body
-- "never names those columns"; it overlooked `id`.
--
-- The repair is the grant, not a rewrite of the function. `id` is an opaque
-- gen_random_uuid surrogate on a row whose three other readable columns the
-- caller already holds, so it discloses nothing new. 017's stated worry was
-- `booking_id` as an enumeration handle onto a table a client is not supposed to
-- be able to name, and `booking_id` and `source` both stay revoked. `anon` is
-- deliberately NOT granted: it needs the three public columns for the booking
-- availability surface and has no business holding row identity.
--
-- Idempotent: re-granting an existing column privilege is a no-op.

grant select (id) on public.coach_calendar_busy to authenticated;


-- ============================================================
-- 2. content_deadlines — the rotation as dates, on the same terms
-- ============================================================
--
-- Dropped first (not `create or replace`) so a later change to the RETURNS TABLE
-- shape re-applies cleanly instead of erroring on a changed return type. That
-- also discards the function's grants, which is why both grant lines below are
-- restated rather than assumed — a freshly created Postgres function carries
-- EXECUTE for PUBLIC, and 017 states the rule for the whole schema.

drop function if exists public.content_deadlines(date, date, text);

create function public.content_deadlines(
  p_from  date,
  p_to    date,
  p_coach text default null
)
returns table (
  cycle_id    uuid,   -- content_rotation.id; one row is one event, so it is a stable key
  coach_slug  text,
  cycle_start date,   -- window opens: the coach may start writing
  due_date    date    -- window closes: the post is owed
)
language plpgsql
stable
security invoker
set search_path = ''   -- so every reference below must be schema-qualified
as $fn$
declare
  v_is_admin boolean := public.is_axis_admin();
  v_my_slug  text    := public.current_coach_slug();
  v_scope    text;
begin
  -- ── Access gate ──
  -- Character for character 021's gate, deliberately. Nothing for an athlete,
  -- anon, a suspended coach (current_coach_slug() requires status = 'active'),
  -- or the service role (auth.uid() is null, so both helpers are false).
  if not v_is_admin and v_my_slug is null then
    return;
  end if;

  -- A malformed or inverted range is an empty answer, not an error: the panel
  -- computes its own bounds and a refusal here would blank the whole calendar.
  if p_from is null or p_to is null or p_to < p_from then
    return;
  end if;

  -- But an ENORMOUS range is a refusal, in 039's capping style. The month view
  -- asks for 42 days and the widest sensible question is a year. Nothing today
  -- writes rotation rows in bulk, but a plan generator that materialises cycles
  -- for a long horizon must not be able to turn one month view into an
  -- unbounded scan.
  if (p_to - p_from) > 400 then
    raise exception 'content_deadlines answers at most 400 days at a time.'
      using errcode = '22023';
  end if;

  -- An admin passing null sees the roster; an admin passing a slug narrows to
  -- it; a COACH'S p_coach ARGUMENT IS IGNORED ENTIRELY, so a coach can only ever
  -- receive their own slug. Same three lines, same order, as 021.
  v_scope := case when v_is_admin then p_coach else v_my_slug end;

  return query
  select
    cr.id,
    cr.coach_slug,
    cr.cycle_start,
    cr.due_date
  from public.content_rotation cr
   -- `waived` is `not null default false` (005:25), so `not cr.waived` has no
   -- three-valued-logic hole. Excluding waived cycles is the ENTIRE reason that
   -- column exists: 005's header says it is there so an excused cycle (injury,
   -- holiday, coach on leave) stops showing up as owed forever. Drawing one on
   -- the calendar would undo the only intent this table stores.
   where not cr.waived
     -- THE SECURITY BOUNDARY. Not decoration. 017:1269-1273's rotation_staff_read
     -- names no column of content_rotation, so it admits the WHOLE table to
     -- anyone who is past the gate above. This predicate is the only thing
     -- keeping one coach's deadlines off another coach's calendar.
     and (v_scope is null or cr.coach_slug = v_scope)
     -- Unpadded on purpose. Nothing here becomes an instant, so there is no UTC
     -- bucketing edge to absorb (contrast 021's v_lo / v_hi). Index-supported by
     -- content_rotation_due_idx (005:34).
     and cr.due_date >= p_from
     and cr.due_date <= p_to
   order by cr.due_date, cr.coach_slug
   limit 2000;

  -- Every column reference above is qualified with `cr.`, and that is load
  -- bearing rather than tidy: the OUT parameters are named `coach_slug`,
  -- `cycle_start` and `due_date`, which are also the column names being read. An
  -- unqualified mention is an ambiguity error at RUN time, not at create time.
  -- 039:105-108 documents the same trap in the same words.
  return;
end
$fn$;

comment on function public.content_deadlines(date, date, text) is
  'Blog rotation cycles due inside a date range, as DATES. Same gate and same '
  'per-coach scope as calendar_events, so the two surfaces agree about who has a '
  'calendar. Dates rather than instants because only the client knows the display '
  'zone, and a date converted server-side then bucketed client-side lands on two '
  'days. Waived cycles are not owed and are not returned.';

revoke all     on function public.content_deadlines(date, date, text) from public, anon;
grant  execute on function public.content_deadlines(date, date, text) to authenticated, service_role;

-- No table grant and no policy is added. 017:1245 already grants select on
-- public.content_rotation to authenticated, which covers all four columns named
-- above, and the four existing policies already decide the read.


-- ── Verify ──────────────────────────────────────────────────────────────────
--
-- Read this section as the ONLY real proof. Failure is silent in three
-- independent places: src/lib/calendar.ts:120 and the deadline fetcher both
-- swallow errors into [], mapRow coerces an unrecognised `kind` to 'busy', and
-- 021's branch 5 swallows exceptions into null. A working panel is not evidence
-- and an empty panel does not say why.
--
-- SHAPE first. Invoker, stable, pinned search_path, and not anon's to call:
--
--   select proname, prosecdef, provolatile, proconfig
--     from pg_catalog.pg_proc where proname = 'content_deadlines';
--   -- content_deadlines | f | s | {search_path=""}
--
--   select has_function_privilege('anon',          'public.content_deadlines(date,date,text)', 'execute');  -- f
--   select has_function_privilege('authenticated', 'public.content_deadlines(date,date,text)', 'execute');  -- t
--   select has_function_privilege('service_role',  'public.content_deadlines(date,date,text)', 'execute');  -- t
--
-- (a) AS AN ADMIN, this month, everyone:
--
--   select * from public.content_deadlines(
--     date_trunc('month', now())::date,
--     (date_trunc('month', now()) + interval '1 month - 1 day')::date,
--     null);
--
--   select coach_slug, count(*) from public.content_deadlines(
--     current_date, current_date + 365, null) group by coach_slug order by coach_slug;
--
-- (b) AS A PLAIN COACH holding NEITHER view_blog NOR manage_blog — the case that
--     matters, because it proves both that p_coach is ignored and that a coach
--     with no blog permission still reaches their own deadlines:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a plain coach uuid>';
--     select public.has_permission('view_blog');    -- f
--     select public.has_permission('manage_blog');  -- f
--     select distinct coach_slug from public.content_deadlines(
--       current_date - 180, current_date + 180, 'some-other-coach');
--     -- exactly one row, and it is THEIR OWN slug
--   rollback;
--
-- (c) WAIVED CYCLES ARE NOT OWED. As an admin:
--
--   begin;
--     update public.content_rotation set waived = true
--      where id = (select cr.id from public.content_rotation cr
--                   where cr.due_date >= current_date order by cr.due_date limit 1);
--     -- re-run (a): that cycle is absent, every other cycle is unchanged
--   rollback;
--
-- (d) ANON fails on the grant, one step before the gate:
--
--   set role anon;
--   select * from public.content_deadlines(current_date, current_date, null);
--   -- ERROR: permission denied for function content_deadlines
--   reset role;
--
-- (e) AN ATHLETE gets zero rows and NO error (the gate returns, it does not
--     raise — an athlete asking is not an athlete trespassing):
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<an athlete uuid>';
--     select count(*) from public.content_deadlines(current_date - 365, current_date + 365, null);  -- 0
--   rollback;
--
-- (f) THE EDGES. An inverted range and a null bound are empty, not errors; an
--     absurd range is refused:
--
--   select count(*) from public.content_deadlines(current_date + 10, current_date, null);  -- 0
--   select count(*) from public.content_deadlines(null, current_date, null);               -- 0
--   select * from public.content_deadlines(current_date, current_date + 401, null);
--   -- ERROR (22023): content_deadlines answers at most 400 days at a time.
--
-- (g) THE SECTION 1 REPAIR, proved four ways. The first three are the grant, the
--     fourth is the function that depends on it:
--
--   select has_column_privilege('authenticated','public.coach_calendar_busy','id','select');          -- t (was f)
--   select has_column_privilege('authenticated','public.coach_calendar_busy','booking_id','select');  -- f (still)
--   select has_column_privilege('anon',         'public.coach_calendar_busy','id','select');          -- f (still)
--
--   -- as an authenticated coach or admin, this RAISED "permission denied for
--   -- table coach_calendar_busy" before this migration and returns rows after:
--   select kind, count(*) from public.calendar_events(
--     current_date, current_date + 30, null) group by kind order by kind;
--   -- expect booking / block / available / busy, with a non-zero busy count on
--   -- any coach who has connected a Google calendar
--
-- (h) RE-RUNNABILITY. Applying this file twice re-grants one column privilege
--     (a no-op) and replaces one function. It changes no data.
--
--   \i supabase/migrations/047_content_deadlines.sql
-- ============================================================
