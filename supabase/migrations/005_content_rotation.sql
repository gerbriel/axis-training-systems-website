-- ============================================================
-- Migration 005: content_rotation
-- ============================================================
-- The editorial rotation: every coach owes one blog every two months.
--
-- This table holds ASSIGNMENTS ONLY (who owes a post, and by when). It does not
-- track completion, because a status column would drift out of sync with the
-- posts themselves the moment anyone edits or deletes one. Completion is
-- derived in the app by looking for a pending_content blog from that coach with
-- submitted_at inside the cycle window — see src/lib/rotationApi.ts.
--
-- The one thing that cannot be derived is intent, so `waived` exists for the
-- admin to excuse a cycle (injury, holiday, coach on leave) without it showing
-- up as overdue forever.
--
-- Cadence: each coach is due every 2 months, staggered 2 weeks apart across the
-- roster, so a post lands roughly every 2 weeks instead of five arriving at once.
-- ============================================================

create table if not exists public.content_rotation (
  id          uuid primary key default gen_random_uuid(),
  coach_slug  text not null,
  cycle_start date not null,   -- window opens: coach may start writing
  due_date    date not null,   -- window closes: post owed by this date
  waived      boolean not null default false,
  waive_note  text,
  created_at  timestamptz not null default now(),

  constraint content_rotation_window_valid check (due_date > cycle_start),
  constraint content_rotation_unique_cycle unique (coach_slug, due_date)
);

create index if not exists content_rotation_coach_idx on public.content_rotation (coach_slug);
create index if not exists content_rotation_due_idx   on public.content_rotation (due_date);

-- ── Seed: 6 cycles (1 year) per coach ───────────────────────────────────────
-- Ordinal drives the 2-week stagger. Anchor is the first Saturday of Aug 2026.
-- Re-runnable: the unique (coach_slug, due_date) constraint absorbs repeats.
with roster(coach_slug, ordinal) as (
  values
    ('ronnie-vallejo', 0),
    ('seth-burman',    1),
    ('lucas-sison',    2),
    ('kobe-pham',      3),
    ('aedan-nguyen',   4)
),
cycles as (
  select
    r.coach_slug,
    (date '2026-08-01'
       + (r.ordinal * interval '14 days')
       + (n        * interval '2 months'))::date as due_date
  from roster r
  cross join generate_series(0, 5) as n
)
insert into public.content_rotation (coach_slug, cycle_start, due_date)
select
  coach_slug,
  (due_date - interval '2 months')::date,
  due_date
from cycles
on conflict (coach_slug, due_date) do nothing;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.content_rotation enable row level security;

drop policy if exists "rotation_read_all"   on public.content_rotation;
drop policy if exists "rotation_admin_write" on public.content_rotation;

-- Every signed-in coach can see the whole schedule — knowing whose turn is next
-- is the point of a rotation.
create policy "rotation_read_all"
  on public.content_rotation for select to authenticated
  using (true);

-- Only the admin / head coach can add cycles, reassign, or waive.
create policy "rotation_admin_write"
  on public.content_rotation for all to authenticated
  using (public.is_content_admin())
  with check (public.is_content_admin());
