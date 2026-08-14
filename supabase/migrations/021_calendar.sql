-- ============================================================
-- Axis Training Systems — 021: the calendar, as one stream
-- ============================================================
--
-- Everything a coach's day is made of already lives in this database, spread
-- across four tables that were each built for a different job:
--
--     bookings                  — the calls people booked
--     coach_availability_blocks — the dates and hours a coach marked off
--     coach_schedules           — the recurring weekly working hours
--     coach_calendar_busy       — the freeBusy intervals synced from Google
--
-- Nothing here is new data. This migration is a READ MODEL: one function that
-- merges those four into a single stream of events over a date range, so the
-- admin (and each coach) can finally SEE the bookings sitting inside the hours
-- that were open, next to the time that was blocked, next to what Google says
-- is already taken. The bookings are already stored; the point is to show them
-- on a calendar alongside the availability.
--
-- WHY A FUNCTION AND NOT A VIEW. `coach_schedules` is a RECURRING weekly
-- pattern — "Mondays 9 to 5" — with no dates of its own. Turning it into events
-- means expanding it across a concrete date range, and a range is an argument.
-- A view cannot take one; `calendar_events(p_from, p_to, p_coach)` can.
--
-- WHY SECURITY INVOKER. The whole access model is already written into the RLS
-- on these tables, and running the body as the caller inherits it for free:
--
--   * `bookings` — a coach reads only rows on their own slug (005), an admin
--     reads all (005 admin_all_bookings). The booking rows this function
--     returns are exactly the rows the caller could already select. No new
--     surface, no chance of this function handing a coach another coach's
--     client list.
--   * `coach_schedules` / `coach_availability_blocks` — world-readable working
--     hours (003/017). RLS does NOT scope these per coach, so the explicit
--     `v_scope` filter below is what carries the SAME "your own only" rule onto
--     them that RLS already enforces on bookings. Belt on the bookings, braces
--     everywhere else.
--   * `coach_calendar_busy` — 017 cut `authenticated` down to a COLUMN grant of
--     exactly (coach_slug, starts_at, ends_at); `source` and `booking_id` are
--     unreadable to the caller. This body therefore never names those columns.
--     It cannot ask a busy row "are you a booking mirror?", so it answers the
--     question the other way — an anti-join against `bookings` drops any busy
--     interval that coincides with a visible booking, leaving only the external
--     (Google) busy that is not already on the calendar as a booking.
--
-- WHO MAY CALL IT. An active admin (every calendar) or an active coach (their
-- own, and only their own — `p_coach` is ignored for a coach). Everyone else —
-- an athlete, anon, the service role whose auth.uid() is null — gets an empty
-- stream from the gate, before a single table is touched. This mirrors the
-- `view_own_calendar` / `view_all_calendars` intent in the 016 catalogue: a
-- coach holds `view_own_calendar` by default and sees their column; seeing the
-- whole roster is the admin's to do until a future migration adopts
-- `view_all_calendars` into the bookings RLS itself (the pattern 018 set out).
--
-- No new tables, so no new RLS and no new permission keys — this is a pure view
-- over what 003/005/007/016/017 already secured.
--
-- Re-runnable.
-- ============================================================


-- Dropped first (not just `create or replace`) so a later change to the
-- RETURNS TABLE shape re-applies cleanly instead of erroring on a changed
-- return type.
drop function if exists public.calendar_events(date, date, text);

create function public.calendar_events(
  p_from  date,
  p_to    date,
  p_coach text default null
)
returns table (
  event_id     text,        -- stable per-event id: '<kind>:<row id>[:<date>]'
  kind         text,        -- 'booking' | 'block' | 'busy' | 'available' | 'clock'
  coach_slug   text,
  title        text,
  starts_at    timestamptz, -- absolute instant
  ends_at      timestamptz, -- absolute instant
  all_day      boolean,     -- a full-day block
  status       text,        -- booking status ('pending'|'confirmed'); null otherwise
  client_name  text,        -- booking only
  client_email text,        -- booking only
  client_phone text,        -- booking only
  service      text,        -- booking only
  reason       text,        -- block only (the coach's private note)
  source       text,        -- 'booking' | 'external' | 'time_clock'; null for schedule
  booking_id   uuid         -- booking only, for click-through
)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_is_admin   boolean     := public.is_axis_admin();
  v_my_slug    text        := public.current_coach_slug();
  v_scope      text;
  -- A day of pad on each side of the window absorbs the ≤14h a zone can sit off
  -- UTC, so an event that starts late on the last local day is never dropped for
  -- landing on the next UTC day. The frontend buckets precisely per zone.
  v_lo         timestamptz := (p_from::timestamp - interval '1 day') at time zone 'UTC';
  v_hi         timestamptz := ((p_to + 2)::timestamp)                at time zone 'UTC';
  v_default_tz constant text := 'America/Los_Angeles';  -- Axis is a Fresno gym
  v_coach_col   text;
  v_profile_col text;
  v_start_col   text;
  v_end_col     text;
  v_end_expr    text;
  v_from_sql    text;
  v_coach_expr  text;
  v_extra_where text := '';
begin
  -- ── Access gate ──
  -- Nothing for an athlete, anon, or the service role (null uid). A coach is
  -- pinned to their own slug; an admin may narrow to one with p_coach or pass
  -- null for the whole roster.
  if not v_is_admin and v_my_slug is null then
    return;
  end if;

  v_scope := case when v_is_admin then p_coach else v_my_slug end;

  -- ── 1. Booked calls ──────────────────────────────────────────────────────
  -- Cancelled calls are not events; the mirror trigger (007) has already
  -- removed their busy rows too. RLS scopes these to the caller; v_scope lets an
  -- admin focus one coach.
  return query
  select
    'booking:' || b.id::text,
    'booking'::text,
    b.coach_slug,
    btrim(b.first_name || ' ' || b.last_name),
    b.booked_at,
    b.ends_at,
    false,
    b.status,
    btrim(b.first_name || ' ' || b.last_name),
    b.email,
    b.phone,
    coalesce(b.service_name, b.service_interest),
    null::text,
    'booking'::text,
    b.id
  from public.bookings b
  where b.status <> 'cancelled'
    and (v_scope is null or b.coach_slug = v_scope)
    and b.booked_at < v_hi
    and b.ends_at   > v_lo;

  -- ── 2. Blocked-off time ──────────────────────────────────────────────────
  -- start_time/end_time null = a whole-day block; it spans local midnight to
  -- local midnight in the coach's zone. Timed blocks convert their wall-clock
  -- times the same way a booking slot is authored.
  return query
  select
    'block:' || bl.id::text,
    'block'::text,
    bl.coach_slug,
    coalesce(nullif(btrim(bl.reason), ''), 'Blocked'),
    case when bl.start_time is null
         then (bl.block_date::timestamp)                at time zone coalesce(cps.time_zone, v_default_tz)
         else (bl.block_date + bl.start_time)           at time zone coalesce(cps.time_zone, v_default_tz) end,
    case when bl.end_time is null
         then ((bl.block_date + 1)::timestamp)          at time zone coalesce(cps.time_zone, v_default_tz)
         else (bl.block_date + bl.end_time)             at time zone coalesce(cps.time_zone, v_default_tz) end,
    (bl.start_time is null or bl.end_time is null),  -- all_day
    null::text,                     -- status
    null::text,                     -- client_name
    null::text,                     -- client_email
    null::text,                     -- client_phone
    null::text,                     -- service
    nullif(btrim(bl.reason), ''),   -- reason
    null::text,                     -- source
    null::uuid                      -- booking_id
  from public.coach_availability_blocks bl
  left join public.coach_public_settings cps on cps.coach_slug = bl.coach_slug
  where (v_scope is null or bl.coach_slug = v_scope)
    and bl.block_date >= p_from - 1
    and bl.block_date <= p_to   + 1;

  -- ── 3. Working windows (the recurring schedule, expanded) ────────────────
  -- One 'available' band per active weekly window per matching date in the
  -- range. day_of_week is 0=Sun..6=Sat, which is exactly extract(dow).
  return query
  select
    'available:' || s.id::text || ':' || to_char(g.ts, 'YYYYMMDD'),
    'available'::text,
    s.coach_slug,
    'Available'::text,
    (g.ts::date + s.start_time) at time zone coalesce(cps.time_zone, v_default_tz),
    (g.ts::date + s.end_time)   at time zone coalesce(cps.time_zone, v_default_tz),
    false,
    null::text,                     -- status
    null::text,                     -- client_name
    null::text,                     -- client_email
    null::text,                     -- client_phone
    null::text,                     -- service
    null::text,                     -- reason
    null::text,                     -- source
    null::uuid                      -- booking_id
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g(ts)
  join public.coach_schedules s
    on s.is_active
   and s.day_of_week = extract(dow from g.ts)::int
  left join public.coach_public_settings cps on cps.coach_slug = s.coach_slug
  where (v_scope is null or s.coach_slug = v_scope);

  -- ── 4. External busy (Google freeBusy) ──────────────────────────────────
  -- `source` is unreadable to the caller (017), so booking-mirror rows are
  -- identified the only way left: an interval that coincides exactly with a
  -- visible, non-cancelled booking IS that booking, already returned in step 1.
  -- What remains is genuinely-external busy the calendar should still show.
  return query
  select
    'busy:' || cb.id::text,
    'busy'::text,
    cb.coach_slug,
    'Busy'::text,
    cb.starts_at,
    cb.ends_at,
    false,
    null::text,                     -- status
    null::text,                     -- client_name
    null::text,                     -- client_email
    null::text,                     -- client_phone
    null::text,                     -- service
    null::text,                     -- reason
    'external'::text,               -- source
    null::uuid                      -- booking_id
  from public.coach_calendar_busy cb
  where (v_scope is null or cb.coach_slug = v_scope)
    and cb.starts_at < v_hi
    and cb.ends_at   > v_lo
    and not exists (
      select 1 from public.bookings b
      where b.coach_slug =  cb.coach_slug
        and b.booked_at  =  cb.starts_at
        and b.ends_at    =  cb.ends_at
        and b.status     <> 'cancelled'
    );

  -- ── 5. Optional overlay: time-clock entries (agent 022) ──────────────────
  -- Guarded with to_regclass so THIS migration applies whether or not 022 has
  -- created `time_entries`, and tolerant of its shape so a table it does not
  -- recognise is simply not overlaid rather than an error that takes the four
  -- real layers above down with it.
  --
  -- 022 keys punches by `profile_id`, not by coach_slug, with `clock_in` /
  -- `clock_out`. The calendar is keyed by coach_slug, so a profile-keyed table
  -- is joined to `profiles` to resolve the coach; a table that already carries
  -- coach_slug is used directly. Only rows that resolve to a coach appear —
  -- an admin's own punch with no slug is a time record, not a calendar event.
  -- time_entries' own RLS (profile_id = auth.uid(), plus the admin path) scopes
  -- which punches the caller may read; this SECURITY INVOKER body inherits it.
  if to_regclass('public.time_entries') is not null then
    select c.column_name into v_coach_col
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'time_entries'
       and c.column_name = 'coach_slug' limit 1;

    select c.column_name into v_profile_col
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'time_entries'
       and c.column_name in ('profile_id','user_id','staff_id') limit 1;

    select c.column_name into v_start_col
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'time_entries'
       and c.column_name in ('clock_in','started_at','clock_in_at','start_at','clocked_in_at')
     order by array_position(
       array['clock_in','started_at','clock_in_at','start_at','clocked_in_at'], c.column_name)
     limit 1;

    select c.column_name into v_end_col
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'time_entries'
       and c.column_name in ('clock_out','ended_at','clock_out_at','end_at','clocked_out_at')
     order by array_position(
       array['clock_out','ended_at','clock_out_at','end_at','clocked_out_at'], c.column_name)
     limit 1;

    -- Resolve how to reach a coach_slug, and where to read punches from.
    if v_coach_col is not null then
      v_from_sql    := 'public.time_entries t';
      v_coach_expr  := format('t.%I', v_coach_col);
    elsif v_profile_col is not null then
      v_from_sql    := format('public.time_entries t join public.profiles p on p.id = t.%I', v_profile_col);
      v_coach_expr  := 'p.coach_slug';
      v_extra_where := ' and p.coach_slug is not null';
    end if;

    if v_coach_expr is not null and v_start_col is not null then
      -- An open shift (no end column, or a null end) reads as "ongoing", drawn
      -- up to now().
      v_end_expr := case
        when v_end_col is not null then format('coalesce(t.%I, now())', v_end_col)
        else 'now()'
      end;

      begin
        return query execute format(
          $q$
          select
            'clock:' || t.id::text,
            'clock'::text,
            %1$s,
            'Clocked in'::text,
            t.%2$I::timestamptz,
            (%3$s)::timestamptz,
            false,
            null::text, null::text, null::text, null::text,  -- status, client_name, client_email, client_phone
            null::text, null::text, 'time_clock'::text, null::uuid  -- service, reason, source, booking_id
          from %4$s
          where (%5$L is null or %1$s = %5$L)%6$s
            and t.%2$I::timestamptz < %7$L::timestamptz
            and (%3$s)::timestamptz > %8$L::timestamptz
          $q$,
          v_coach_expr,  -- %1$s  coach_slug expression
          v_start_col,   -- %2$I  start column
          v_end_expr,    -- %3$s  end expression (safely built from %I above)
          v_from_sql,    -- %4$s  FROM clause (with optional profiles join)
          v_scope,       -- %5$L  coach scope (NULL = all)
          v_extra_where, -- %6$s  extra predicate (coach_slug is not null)
          v_hi,          -- %7$L  window upper bound
          v_lo           -- %8$L  window lower bound
        );
      exception when others then
        -- A shape surprise (no id, an incompatible type) must never break the
        -- calendar. The overlay is optional; the four layers above are not.
        null;
      end;
    end if;
  end if;

  return;
end
$fn$;

comment on function public.calendar_events(date, date, text) is
  'Unified read model for the admin/coach calendar: bookings, blocked time, '
  'recurring working windows expanded to the range, and external (Google) busy, '
  'as one event stream. SECURITY INVOKER — a coach sees only their own slug, an '
  'admin every calendar (optionally narrowed by p_coach). Optionally overlays '
  'time_entries (022) if that table exists.';

revoke all     on function public.calendar_events(date, date, text) from public, anon;
grant  execute on function public.calendar_events(date, date, text) to authenticated, service_role;


-- ── Verify ──────────────────────────────────────────────────────────────────
--
-- As an admin, a month of everyone:
--
--   select kind, count(*) from public.calendar_events(
--     date_trunc('month', now())::date,
--     (date_trunc('month', now()) + interval '1 month - 1 day')::date
--   ) group by kind order by kind;
--
-- As a specific coach (set the JWT / run as that user in the API), the same call
-- returns only their own slug regardless of the p_coach argument:
--
--   select distinct coach_slug from public.calendar_events(
--     current_date, current_date + 30, 'some-other-coach');   -- only their own
--
-- Anon gets nothing but a permission error on EXECUTE (not granted):
--
--   set role anon;
--   select * from public.calendar_events(current_date, current_date);  -- denied
--   reset role;
--
-- And it applies with or without 022: the time_entries block is skipped whole
-- when to_regclass('public.time_entries') is null.
