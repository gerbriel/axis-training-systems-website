-- ============================================================
-- Axis Training Systems — 022: the clock
-- ============================================================
--
-- Two people press the same button for two different reasons. An athlete taps
-- "I'm here" when they walk into the gym; a coach taps "on the clock" when their
-- shift starts. Same table, one column apart — `kind` is 'gym_visit' or
-- 'work_shift' — because a gym visit and a paid shift are the same shape (a
-- start, maybe an end, a note) and splitting them into two tables would mean two
-- copies of every policy and every report.
--
-- What the DATABASE makes true, not the UI:
--
--   • A person has at most ONE open entry per kind. Two taps, two tabs, or a
--     visit nobody ever closed are all the same violation, settled by a partial
--     unique index rather than by a check the app did first. Same reasoning as
--     the booking guard: the constraint is what makes it true.
--   • An athlete cannot open a work_shift, and a coach cannot open a gym_visit.
--     The clock is driven by the signed-in role, but a forged request that names
--     the wrong kind is refused by a trigger reading `profiles.role`, so the
--     rule holds on every path in — the RPC, a direct insert, psql.
--   • A work_shift is a wage record in waiting. `timeclock_totals` is the hook
--     Commission will read: whole minutes on the clock per person per range,
--     open shifts contributing zero, because a figure for a shift still running
--     is a guess and the clock shows elapsed time live instead.
--
-- Everyone writes their OWN punches (RLS: profile_id = auth.uid()). An admin, or
-- a coach an admin has trusted with `view_timeclock_all`, reads everyone's;
-- everyone else reads only their own.
--
-- Re-runnable.
-- ============================================================


-- ── 1. The permission that widens the read ──────────────────────────────────
--
-- Reading your own hours is not a privilege — it is your own timesheet. Reading
-- everyone's is, and `view_timeclock_all` is that privilege. It is NOT a coach
-- default: a coach sees their own shifts and no further unless an admin hands
-- this over, exactly the head-coach case the permission system was built for.
--
-- The catalogue guard (016) refuses this write to a non-admin, which in a
-- migration is nobody (auth.uid() is null), so it lands. `do update` restores
-- the label if it was edited by hand in the SQL editor.

insert into public.permissions (key, label, description, is_sensitive) values
  ('view_timeclock_all', 'See everyone''s time clock',
   'Every athlete''s gym visits and every coach''s work shifts, plus the hours '
   'totals — not just their own. Read-only; it grants no power to edit a punch.',
   false)
on conflict (key) do update
  set label        = excluded.label,
      description  = excluded.description,
      is_sensitive = excluded.is_sensitive;

-- The admin column of the settings matrix has to draw from somewhere. It is the
-- matrix these rows feed, never the answer — profile_has_permission (016)
-- short-circuits on role = 'admin' long before it reads this table.
insert into public.role_permissions (role, permission) values
  ('admin', 'view_timeclock_all')
on conflict do nothing;


-- ── 2. The table ────────────────────────────────────────────────────────────
--
-- `clock_in` defaults to now() and is the only honest value: a punch is "me,
-- here, now", and the SECURITY DEFINER functions below never take a time from
-- the caller precisely so nobody can back-date their own arrival. An admin
-- correction tool is a later migration; until then a punch is when it happened.

create table if not exists public.time_entries (
  id          uuid primary key default gen_random_uuid(),

  profile_id  uuid not null references public.profiles (id) on delete cascade,

  -- The whole reason one table serves both people. Constrained, so a typo is a
  -- failed insert rather than a row nothing reports on.
  kind        text not null check (kind in ('gym_visit', 'work_shift')),

  clock_in    timestamptz not null default now(),
  clock_out   timestamptz,

  note        text,

  created_at  timestamptz not null default now(),

  -- Cannot clock out before clocking in. Strict >: a zero-length entry is a
  -- misfire, not a visit.
  constraint time_entries_out_after_in
    check (clock_out is null or clock_out > clock_in)
);

-- The read path for both the widget (a person's own history) and the reports
-- (everybody, newest first).
create index if not exists time_entries_profile_idx
  on public.time_entries (profile_id, clock_in desc);

-- At most one OPEN entry per person per kind. This is the guard: two concurrent
-- clock-ins both pass the app's check, both reach the insert, exactly one
-- commits and the loser gets a unique_violation the RPC turns into
-- "You are already clocked in".
create unique index if not exists time_entries_one_open_per_kind
  on public.time_entries (profile_id, kind) where clock_out is null;

-- The reports scan open entries directly ("who is on the clock right now").
create index if not exists time_entries_open_idx
  on public.time_entries (clock_in) where clock_out is null;


-- ── 3. The role decides the kind, on every path ─────────────────────────────
--
-- The clock renders one button per person because the role already decides
-- which kind they may open. That is signage; THIS is the rule. A forged request
-- that names the wrong kind — an athlete opening a work_shift to land on a
-- payroll report — is refused here, in a trigger, so it holds for the RPC, a
-- direct insert under the "insert own entries" policy, and psql alike.
--
-- SECURITY DEFINER so it reads `profiles` regardless of the writer, and
-- search_path pinned to nothing so every name below is qualified.

create or replace function public.time_entries_guard_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = new.profile_id;

  if v_role is null then
    raise exception 'There is no profile to clock for' using errcode = '22023';
  end if;

  -- An athlete has no shift; a coach or admin has no "gym visit" on this clock.
  -- Both directions, because the payroll report is fed by exactly this column
  -- and a row on the wrong side of it is a wage figure for the wrong person.
  if new.kind = 'work_shift' and v_role = 'athlete' then
    raise exception 'Athletes clock gym visits, not work shifts' using errcode = '22023';
  end if;
  if new.kind = 'gym_visit' and v_role <> 'athlete' then
    raise exception 'Staff clock work shifts, not gym visits' using errcode = '22023';
  end if;

  return new;
end $$;

revoke all on function public.time_entries_guard_kind() from public, anon, authenticated;

drop trigger if exists time_entries_guard_kind_trg on public.time_entries;
create trigger time_entries_guard_kind_trg
  before insert or update of profile_id, kind on public.time_entries
  for each row execute function public.time_entries_guard_kind();


-- ── 4. The punches ──────────────────────────────────────────────────────────
--
-- A punch is inherently "me, now", so these re-derive the actor from auth.uid()
-- rather than taking it as an argument. SECURITY DEFINER buys the friendly
-- refusal: the same violation that RLS would report as "new row violates
-- row-level security policy" arrives here as a sentence a person can act on.
-- The guard trigger and the unique index are still the authority — a definer
-- call is subject to both.

create or replace function public.clock_in(
  p_kind text,
  p_note text default null
)
returns public.time_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_status public.profile_status;
  v_role   public.user_role;
  v_row    public.time_entries;
begin
  if v_actor is null then
    raise exception 'Sign in before clocking in' using errcode = '22023';
  end if;

  if p_kind not in ('gym_visit', 'work_shift') then
    raise exception 'Unknown clock kind' using errcode = '22023';
  end if;

  select status, role into v_status, v_role
  from public.profiles where id = v_actor;

  if v_role is null then
    raise exception 'There is no profile for this account' using errcode = '22023';
  end if;
  -- A pending or suspended account is not on the clock. The trigger does not
  -- test status — status is this function's concern, kind is the trigger's.
  if v_status <> 'active' then
    raise exception 'Your account is not active yet' using errcode = '22023';
  end if;

  -- The role↔kind rule is enforced by the trigger too; checked here so the
  -- refusal is phrased for the person rather than surfacing from the trigger
  -- after a failed insert.
  if p_kind = 'work_shift' and v_role = 'athlete' then
    raise exception 'Athletes clock gym visits, not work shifts' using errcode = '22023';
  end if;
  if p_kind = 'gym_visit' and v_role <> 'athlete' then
    raise exception 'Staff clock work shifts, not gym visits' using errcode = '22023';
  end if;

  begin
    insert into public.time_entries (profile_id, kind, clock_in, note)
    values (v_actor, p_kind, now(), nullif(btrim(p_note), ''))
    returning * into v_row;
  exception when unique_violation then
    -- The partial index decided it, not a check we did first.
    raise exception 'You are already clocked in' using errcode = '22023';
  end;

  return v_row;
end $$;

create or replace function public.clock_out(
  p_note text default null
)
returns public.time_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row   public.time_entries;
begin
  if v_actor is null then
    raise exception 'Sign in before clocking out' using errcode = '22023';
  end if;

  -- Closes this person's open entry. The role↔kind rule means a person only
  -- ever has one kind of open entry, so there is nothing to disambiguate.
  update public.time_entries
     set clock_out = now(),
         note      = coalesce(nullif(btrim(p_note), ''), note)
   where profile_id = v_actor and clock_out is null
   returning * into v_row;

  if not found then
    raise exception 'You are not clocked in' using errcode = '22023';
  end if;

  return v_row;
end $$;

revoke all     on function public.clock_in(text, text) from public, anon;
revoke all     on function public.clock_out(text)      from public, anon;
grant  execute on function public.clock_in(text, text) to authenticated;
grant  execute on function public.clock_out(text)      to authenticated;


-- ── 5. Reading the clock ────────────────────────────────────────────────────
--
-- SECURITY INVOKER, deliberately: the RLS policies in section 6 are the filter.
-- A person calling any of these sees their own entries and no more; an admin, or
-- a coach with view_timeclock_all, sees everyone. Asking for somebody else's
-- rows returns nothing rather than an error, which is the right way to fail. No
-- gate is written into the function body because the row policy already is one —
-- a definer function here would have to re-implement it and could drift from it.

-- Whole minutes between two instants, floored — integer minutes for the same
-- reason money is integer cents. The only duration arithmetic in this file.
create or replace function public.timeclock_minutes(
  p_from timestamptz,
  p_to   timestamptz
) returns integer language sql immutable as $$
  select case
    when p_from is null or p_to is null or p_to <= p_from then 0
    else floor(extract(epoch from (p_to - p_from))::numeric / 60)::int
  end;
$$;

-- Entries that STARTED in [p_from, p_to), each with its own arithmetic. An open
-- entry reports its running elapsed against now(); a closed one, its real span.
create or replace function public.timeclock_entries(
  p_from timestamptz,
  p_to   timestamptz,
  p_kind text default null
) returns table (
  entry_id        uuid,
  profile_id      uuid,
  name            text,
  role            public.user_role,
  kind            text,
  clock_in        timestamptz,
  clock_out       timestamptz,
  is_open         boolean,
  elapsed_minutes integer,
  note            text
) language sql stable security invoker set search_path = '' as $$
  select
    e.id,
    e.profile_id,
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
    p.role,
    e.kind,
    e.clock_in,
    e.clock_out,
    e.clock_out is null,
    public.timeclock_minutes(e.clock_in, coalesce(e.clock_out, now())),
    e.note
  from public.time_entries e
  left join public.profiles p on p.id = e.profile_id
  where e.clock_in >= p_from
    and e.clock_in <  p_to
    and (p_kind is null or e.kind = p_kind)
  order by e.clock_in desc;
$$;

-- Hours per person over a range — the Commission hook. CLOSED entries only:
-- timeclock_minutes returns 0 for an open one, so a shift still running adds
-- nothing to a payroll total until it is closed. open_count is carried
-- separately so a report can say "on the clock now" without inflating the pay.
create or replace function public.timeclock_totals(
  p_from timestamptz,
  p_to   timestamptz,
  p_kind text default null
) returns table (
  profile_id    uuid,
  name          text,
  role          public.user_role,
  entry_count   integer,
  open_count    integer,
  total_minutes integer
) language sql stable security invoker set search_path = '' as $$
  select
    e.profile_id,
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
    p.role,
    count(*)::int,
    count(*) filter (where e.clock_out is null)::int,
    -- Aliased so ORDER BY can name it: a RETURNS TABLE output column is NOT an
    -- alias on the inner query, so `order by total_minutes` was a 42703 until
    -- the expression itself carried the name.
    coalesce(sum(public.timeclock_minutes(e.clock_in, e.clock_out)), 0)::int as total_minutes
  from public.time_entries e
  left join public.profiles p on p.id = e.profile_id
  where e.clock_in >= p_from
    and e.clock_in <  p_to
    and (p_kind is null or e.kind = p_kind)
  group by e.profile_id, p.first_name, p.last_name, p.role
  order by total_minutes desc;
$$;

-- Who is on the clock RIGHT NOW, regardless of when the entry started — an open
-- entry from yesterday is exactly the one a rollup most needs to surface.
create or replace function public.timeclock_open()
returns table (
  entry_id        uuid,
  profile_id      uuid,
  name            text,
  role            public.user_role,
  kind            text,
  clock_in        timestamptz,
  elapsed_minutes integer
) language sql stable security invoker set search_path = '' as $$
  select
    e.id,
    e.profile_id,
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
    p.role,
    e.kind,
    e.clock_in,
    public.timeclock_minutes(e.clock_in, now())
  from public.time_entries e
  left join public.profiles p on p.id = e.profile_id
  where e.clock_out is null
  order by e.clock_in asc;
$$;

revoke all     on function public.timeclock_minutes(timestamptz, timestamptz)        from public, anon;
revoke all     on function public.timeclock_entries(timestamptz, timestamptz, text)  from public, anon;
revoke all     on function public.timeclock_totals(timestamptz, timestamptz, text)   from public, anon;
revoke all     on function public.timeclock_open()                                   from public, anon;
grant  execute on function public.timeclock_minutes(timestamptz, timestamptz)        to authenticated, service_role;
grant  execute on function public.timeclock_entries(timestamptz, timestamptz, text)  to authenticated, service_role;
grant  execute on function public.timeclock_totals(timestamptz, timestamptz, text)   to authenticated, service_role;
grant  execute on function public.timeclock_open()                                   to authenticated, service_role;


-- ── 6. RLS ──────────────────────────────────────────────────────────────────
--
-- Nothing here is readable by anon, ever — a time entry says where a named
-- person was and when, which is not public information about anybody. There are
-- no `to anon` policies and anon is revoked outright below.

alter table public.time_entries enable row level security;

drop policy if exists "read own or all time entries"  on public.time_entries;
drop policy if exists "insert own time entries"        on public.time_entries;
drop policy if exists "update own time entries"        on public.time_entries;

-- WHO: you, about yourself, always. An admin, or a coach handed
-- view_timeclock_all, about everyone. A plain coach falls to the first clause
-- and sees only their own shifts — which is the whole point of splitting the
-- permission out rather than letting every coach read the roster's hours.
create policy "read own or all time entries"
  on public.time_entries for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_axis_admin()
    or public.has_permission('view_timeclock_all')
  );

-- WHO: you, punching your own clock. The `kind` is still gated by the trigger —
-- this policy decides WHOSE row it is, the trigger decides whether the role may
-- open that kind. Both are needed; neither is the other's job.
create policy "insert own time entries"
  on public.time_entries for insert to authenticated
  with check (profile_id = auth.uid());

-- WHO: you, closing your own entry (a clock-out is an update). The row stays
-- yours on both sides of the write.
create policy "update own time entries"
  on public.time_entries for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- No delete policy: a visit or a shift that happened is a record, not a draft.
-- Corrections are an admin tool for a later migration, not a user power.

revoke all on public.time_entries from anon;
grant  select, insert, update on public.time_entries to authenticated;
grant  all on public.time_entries to service_role;


-- ── 7. Verify ───────────────────────────────────────────────────────────────
--
-- The role↔kind rule, from both sides — both must FAIL even as the owner with
-- RLS bypassed, because they are trigger-enforced. Substitute a real athlete and
-- a real coach:
--
--   insert into public.time_entries (profile_id, kind)
--   select id, 'work_shift' from public.profiles where role = 'athlete' limit 1;
--   -- ERROR: Athletes clock gym visits, not work shifts
--
--   insert into public.time_entries (profile_id, kind)
--   select id, 'gym_visit' from public.profiles where role = 'coach' limit 1;
--   -- ERROR: Staff clock work shifts, not gym visits
--
-- One open entry per kind — the second insert loses:
--
--   insert into public.time_entries (profile_id, kind)
--   select id, 'gym_visit' from public.profiles where role = 'athlete' limit 1;
--   insert into public.time_entries (profile_id, kind)
--   select id, 'gym_visit' from public.profiles where role = 'athlete' limit 1;
--   -- ERROR: duplicate key value violates unique constraint
--   --        "time_entries_one_open_per_kind"
--
-- Anon sees nothing:
--
--   set role anon; select * from public.time_entries limit 1;  -- permission denied
--   reset role;
--
-- The permission exists and is a non-sensitive, non-coach-default:
--
--   select key, is_sensitive from public.permissions where key = 'view_timeclock_all'; -- f
--   select count(*) from public.role_permissions
--    where permission = 'view_timeclock_all' and role = 'coach';                        -- 0
