-- ============================================================
-- Axis Training Systems — 027: Insights (reporting + saved reports)
-- ============================================================
--
-- Everything the admin/coach portals already collect — bookings, the booking
-- funnel, applications, and (when their verticals land) revenue and coach hours
-- — has never had a place that AGGREGATES it. AnalyticsPanel (003/010) charts
-- raw pageviews and nothing else. This file adds the READ layer: a handful of
-- SECURITY DEFINER reporting functions that roll those tables up over a date
-- range, and one small table that remembers a report someone built.
--
-- WHY DEFINER. Every source table has its own RLS — `leads` is locked to admins
-- and the matching coach, `booking_events` to staff, `time_entries` to nobody
-- but the owner. A report that JOINs across them cannot be written as an
-- invoker query without punching a read hole in each. Instead these functions
-- run as owner, bypass RLS, and re-impose ONE gate of their own:
--
--   * an admin, or a non-coach staffer holding `view_analytics`, sees the whole
--     business;
--   * a coach sees only their own slice (their calendar, their applications,
--     their hours), enforced by a coach_slug / coach_name filter inside every
--     function — never by trusting the caller;
--   * everyone else gets a 42501, not an empty result that reads as "no data".
--
-- The gate reuses the `view_analytics` permission from 016 (coaches hold it by
-- default; revoking it takes reports away too). No new permission key is minted.
--
-- SIBLING TABLES behind to_regclass guards. `orders` is the sales vertical's
-- (026) and does not exist yet; `time_entries` (022) and `form_submissions`
-- (024) are siblings too. Each is probed with to_regclass before it is read, so
-- this migration applies cleanly whether or not those siblings have run, and the
-- revenue query additionally degrades to empty (rather than erroring) if 026
-- lands `orders` in a shape different from the one assumed here.
--
-- Re-runnable: every object is create-or-replace / if-not-exists / drop-guarded.
-- ============================================================


-- ── 1. The gate ─────────────────────────────────────────────────────────────
--
-- Two scalars the reporting functions share, so the access rule lives in one
-- place rather than being copy-pasted (and drifting) across six bodies.

-- May the caller see reports at all? True for the service role / SQL editor
-- (auth.uid() is null, same convenience effective_permissions(016) grants), an
-- active admin, or anyone holding `view_analytics`.
create or replace function public.reports_can_view()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is null
      or public.is_axis_admin()
      or public.has_permission('view_analytics')
$$;

comment on function public.reports_can_view() is
  'Report visibility gate: service role, an active admin, or a view_analytics holder.';

revoke all     on function public.reports_can_view() from public, anon;
grant  execute on function public.reports_can_view() to authenticated, service_role;

-- The coach_slug a caller is CONFINED to, or null for "the whole business".
-- Null for the service role and for an admin (they see everyone); null for a
-- non-coach analyst (a staffer with view_analytics but no calendar of their
-- own); the caller's own slug for a coach. A coach's view is capped here even
-- though they hold view_analytics — being a coach narrows the scope, being an
-- admin lifts it.
create or replace function public.reports_scope_coach()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when auth.uid() is null       then null
           when public.is_axis_admin()   then null
           else public.current_coach_slug()
         end
$$;

comment on function public.reports_scope_coach() is
  'The coach_slug a report caller is confined to, or null for business-wide.';

revoke all     on function public.reports_scope_coach() from public, anon;
grant  execute on function public.reports_scope_coach() to authenticated, service_role;


-- ── 2. Bookings over time ───────────────────────────────────────────────────
--
-- How many bookings were MADE per bucket, split by the status they now sit in.
-- created_at (not booked_at) is the axis: this is the acquisition curve — "how
-- many came in on Tuesday" — and the current status colours each bar so a run
-- of cancellations is visible against a run of confirmations.

create or replace function public.report_bookings_over_time(
  p_from   timestamptz,
  p_to     timestamptz,
  p_bucket text default 'day'
)
returns table (
  bucket   timestamptz,
  status   text,
  bookings integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bucket text := case when p_bucket in ('day','week','month') then p_bucket else 'day' end;
  v_coach  text := public.reports_scope_coach();
begin
  if not public.reports_can_view() then
    raise exception 'not authorized to view reports' using errcode = '42501';
  end if;

  return query
    select date_trunc(v_bucket, b.created_at) as bucket,
           b.status,
           count(*)::int
      from public.bookings b
     where b.created_at >= p_from
       and b.created_at <  p_to
       and (v_coach is null or b.coach_slug = v_coach)
     group by 1, b.status
     order by 1, b.status;
end
$$;

revoke all     on function public.report_bookings_over_time(timestamptz, timestamptz, text) from public, anon;
grant  execute on function public.report_bookings_over_time(timestamptz, timestamptz, text) to authenticated, service_role;


-- ── 3. The booking funnel ───────────────────────────────────────────────────
--
-- Distinct sessions that reached each of the five booking steps (010's
-- booking_events). The stages come from a VALUES list LEFT JOINed onto the
-- events, so a stage nobody reached still returns a zero row rather than
-- vanishing — a funnel with a missing rung is unreadable.
--
-- Coach scope note: `booking_page_view` and `service_selected` are emitted
-- before a coach is chosen and carry no coach_slug, so a coach-scoped caller
-- sees their own coach_selected → completed sub-funnel and zeros above it. That
-- is the honest answer: the top of the funnel belongs to no coach.

create or replace function public.report_booking_funnel(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  step       text,
  step_order integer,
  sessions   integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_coach text := public.reports_scope_coach();
begin
  if not public.reports_can_view() then
    raise exception 'not authorized to view reports' using errcode = '42501';
  end if;

  return query
    with stages(step, step_order) as (
      values
        ('booking_page_view', 1),
        ('service_selected',  2),
        ('coach_selected',    3),
        ('slot_selected',     4),
        ('booking_completed', 5)
    )
    select s.step,
           s.step_order,
           coalesce(count(distinct e.session_id), 0)::int
      from stages s
      left join public.booking_events e
        on e.name = s.step
       and e.created_at >= p_from
       and e.created_at <  p_to
       and (v_coach is null or e.coach_slug = v_coach)
     group by s.step, s.step_order
     order by s.step_order;
end
$$;

revoke all     on function public.report_booking_funnel(timestamptz, timestamptz) from public, anon;
grant  execute on function public.report_booking_funnel(timestamptz, timestamptz) to authenticated, service_role;


-- ── 4. Applications (leads) by status ───────────────────────────────────────
--
-- The application queue (001) grouped by lifecycle status. A coach is scoped by
-- NAME, not slug: `leads.coach_pref` stores the display name the public form
-- posts ('Ronnie Vallejo'), and current_coach_name() (017) is the one bridge
-- from the caller's slug to that name.

create or replace function public.report_leads_by_status(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  status text,
  leads  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Scoped is a property of BEING a coach (a non-null slug), decided once.
  v_scoped    boolean := public.reports_scope_coach() is not null;
  v_coach_name text   := public.current_coach_name();
begin
  if not public.reports_can_view() then
    raise exception 'not authorized to view reports' using errcode = '42501';
  end if;

  -- A coach with no resolvable display name (no coach_routing row) sees NOTHING
  -- rather than everything — the name lookup failing must never widen the scope.
  return query
    select l.status, count(*)::int
      from public.leads l
     where l.created_at >= p_from
       and l.created_at <  p_to
       and (
         not v_scoped
         or (v_coach_name is not null and l.coach_pref = v_coach_name)
       )
     group by l.status
     order by l.status;
end
$$;

revoke all     on function public.report_leads_by_status(timestamptz, timestamptz) from public, anon;
grant  execute on function public.report_leads_by_status(timestamptz, timestamptz) to authenticated, service_role;


-- ── 5. Revenue over time (orders — sibling 026, guarded) ────────────────────
--
-- Revenue is a business-wide figure: a coach's slice of the studio's takings is
-- undefined, so a coach-scoped caller gets nothing here rather than a number
-- that would mean the wrong thing. `orders` does not exist until 026, so the
-- table is probed first; and because 026 owns its own shape, the read is wrapped
-- so a column that isn't there degrades to empty instead of raising.

create or replace function public.report_revenue_over_time(
  p_from   timestamptz,
  p_to     timestamptz,
  p_bucket text default 'day'
)
returns table (
  bucket        timestamptz,
  revenue_cents bigint,
  order_count   integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bucket text := case when p_bucket in ('day','week','month') then p_bucket else 'day' end;
begin
  if not public.reports_can_view() then
    raise exception 'not authorized to view reports' using errcode = '42501';
  end if;

  -- Coaches do not see business-wide revenue.
  if public.reports_scope_coach() is not null then
    return;
  end if;

  -- Not built yet (026 owns `orders`).
  if to_regclass('public.orders') is null then
    return;
  end if;

  -- `orders` exists but this file predates its final columns. Anything that
  -- doesn't line up (a renamed total, a missing status) turns into "no revenue
  -- data" rather than a failed report.
  begin
    return query
      select date_trunc(v_bucket, o.created_at) as bucket,
             coalesce(sum(o.total_cents), 0)::bigint,
             count(*)::int
        from public.orders o
       where o.created_at >= p_from
         and o.created_at <  p_to
         and coalesce(o.status, 'paid') in ('paid', 'completed', 'fulfilled', 'succeeded')
       group by 1
       order by 1;
  exception
    when others then
      return;
  end;
end
$$;

revoke all     on function public.report_revenue_over_time(timestamptz, timestamptz, text) from public, anon;
grant  execute on function public.report_revenue_over_time(timestamptz, timestamptz, text) to authenticated, service_role;


-- ── 6. Coach hours (time_entries — sibling 022, guarded) ────────────────────
--
-- Work-shift minutes per coach over the range. A coach sees their own row; an
-- admin sees the roster. An open shift counts its running time to now(), so "on
-- the clock" is reflected rather than dropped.

create or replace function public.report_coach_hours(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  coach_slug text,
  coach_name text,
  minutes    integer,
  entries    integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_coach text := public.reports_scope_coach();
begin
  if not public.reports_can_view() then
    raise exception 'not authorized to view reports' using errcode = '42501';
  end if;

  if to_regclass('public.time_entries') is null then
    return;
  end if;

  return query
    select p.coach_slug,
           nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
           coalesce(sum(floor(extract(epoch from (coalesce(e.clock_out, now()) - e.clock_in)) / 60)), 0)::int,
           count(*)::int
      from public.time_entries e
      join public.profiles p on p.id = e.profile_id
     where e.kind = 'work_shift'
       and e.clock_in >= p_from
       and e.clock_in <  p_to
       and p.coach_slug is not null
       and (v_coach is null or p.coach_slug = v_coach)
     group by p.coach_slug, p.first_name, p.last_name
     order by 3 desc;
end
$$;

revoke all     on function public.report_coach_hours(timestamptz, timestamptz) from public, anon;
grant  execute on function public.report_coach_hours(timestamptz, timestamptz) to authenticated, service_role;


-- ── 7. Form submissions over time (forms — sibling 024, guarded) ────────────
--
-- Intake submissions per bucket. Forms carry no coach linkage, so a coach-scoped
-- caller gets nothing; the whole business is the only meaningful denominator.

create or replace function public.report_form_submissions_over_time(
  p_from   timestamptz,
  p_to     timestamptz,
  p_bucket text default 'day'
)
returns table (
  bucket      timestamptz,
  submissions integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bucket text := case when p_bucket in ('day','week','month') then p_bucket else 'day' end;
begin
  if not public.reports_can_view() then
    raise exception 'not authorized to view reports' using errcode = '42501';
  end if;

  if public.reports_scope_coach() is not null then
    return;
  end if;

  if to_regclass('public.form_submissions') is null then
    return;
  end if;

  return query
    select date_trunc(v_bucket, fs.submitted_at) as bucket,
           count(*)::int
      from public.form_submissions fs
     where fs.submitted_at >= p_from
       and fs.submitted_at <  p_to
     group by 1
     order by 1;
end
$$;

revoke all     on function public.report_form_submissions_over_time(timestamptz, timestamptz, text) from public, anon;
grant  execute on function public.report_form_submissions_over_time(timestamptz, timestamptz, text) to authenticated, service_role;


-- ── 8. Saved reports ────────────────────────────────────────────────────────
--
-- A remembered report definition — which metric, over what range, drawn as
-- what. It is NOT SQL and is never executed as SQL: `config` is a description
-- the front-end reads to decide which reporting function above to call and how
-- to draw the result. So the RLS here protects the DEFINITIONS (who may see
-- whose saved views), and the numbers stay protected by the gate on the
-- functions, exactly as everywhere else.

create table if not exists public.saved_reports (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid()
                references public.profiles (id) on delete cascade,
  name        text not null,
  -- { metric, rangeDays, bucket, chart, filters }. jsonb, not columns, because
  -- the builder's shape is still moving and a migration per new filter is absurd.
  config      jsonb not null default '{}'::jsonb,
  -- Opt-in. A shared report is how staff agree on what a number means; a
  -- half-built draft is not a house standard, so sharing is never the default.
  is_shared   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint saved_reports_name_not_blank
    check (length(btrim(name)) between 1 and 120),
  -- A config must be an object; a bare array or scalar would sail through jsonb
  -- and then confuse the reader.
  constraint saved_reports_config_is_object
    check (jsonb_typeof(config) = 'object')
);

-- Read as "mine and everyone's shared", newest first.
create index if not exists saved_reports_owner_idx
  on public.saved_reports (owner_id, created_at desc);
create index if not exists saved_reports_shared_idx
  on public.saved_reports (created_at desc) where is_shared;

create or replace function public.saved_reports_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists saved_reports_touch_trg on public.saved_reports;
create trigger saved_reports_touch_trg
  before update on public.saved_reports
  for each row execute function public.saved_reports_touch();


-- ── 9. Saved-report RLS ─────────────────────────────────────────────────────

alter table public.saved_reports enable row level security;

drop policy if exists "saved_reports_select" on public.saved_reports;
drop policy if exists "saved_reports_insert" on public.saved_reports;
drop policy if exists "saved_reports_update" on public.saved_reports;
drop policy if exists "saved_reports_delete" on public.saved_reports;

-- You always see your own. You see a shared one if you may see reports at all.
-- An admin sees everything.
create policy "saved_reports_select" on public.saved_reports
  for select to authenticated
  using (
    owner_id = auth.uid()
    or (is_shared and public.reports_can_view())
    or public.is_axis_admin()
  );

-- Authorship is not a claim the row makes about itself: owner_id must be the
-- caller, and the caller must be allowed to see reports in the first place.
create policy "saved_reports_insert" on public.saved_reports
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and public.reports_can_view()
  );

-- Only the owner (or an admin) may edit, and the WITH CHECK repeats the USING
-- test so an update cannot hand the row to someone else on its way past.
create policy "saved_reports_update" on public.saved_reports
  for update to authenticated
  using (owner_id = auth.uid() or public.is_axis_admin())
  with check (owner_id = auth.uid() or public.is_axis_admin());

create policy "saved_reports_delete" on public.saved_reports
  for delete to authenticated
  using (owner_id = auth.uid() or public.is_axis_admin());

revoke all on public.saved_reports from anon;
grant  select, insert, update, delete on public.saved_reports to authenticated;


-- ── 10. Verify ──────────────────────────────────────────────────────────────
--
--   -- gate: an anon session may not call a report
--   set role anon;
--   select public.report_leads_by_status(now() - interval '30 days', now());  -- ERROR
--   reset role;
--
--   -- shape: every funnel stage present even with no events
--   select step, step_order, sessions
--     from public.report_booking_funnel(now() - interval '90 days', now());   -- 5 rows
--
--   -- guarded siblings return empty (not error) before 026 lands orders
--   select * from public.report_revenue_over_time(now() - interval '30 days', now());  -- 0 rows
--
--   -- a saved report cannot be inserted for someone else
--   insert into public.saved_reports (owner_id, name, config)
--     values ('00000000-0000-0000-0000-000000000000', 'x', '{}');            -- ERROR (RLS)
