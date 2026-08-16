-- ============================================================
-- Axis Training Systems — 046: the rotation becomes a plan
-- ============================================================
--
-- 005 wrote the editorial rotation down twice. Once in its own seed block — five
-- slugs, an ordinal apiece, a 14-day stagger and the date 2026-08-01 — and again
-- in src/lib/rotationApi.ts, where ROTATION_ORDER / ANCHOR / STAGGER_DAYS exist
-- so demo mode can draw the same calendar with no database behind it. Both
-- copies are frozen at the founding five. A coach provisioned through 036 cannot
-- be put into the rotation, a coach who leaves cannot be taken out of it, and
-- "make it every three weeks" is a code change, a review and a deploy.
--
-- This file turns those constants into a row an admin edits: WHO is in the
-- rotation and in WHAT ORDER, HOW OFTEN a turn comes round, and WHERE the
-- counting starts.
--
-- IT IS A TEMPLATE, NOT A SCHEDULE. Nothing here replaces content_rotation,
-- which stays the record of who owes a post by when. The plan is what the
-- rotation panel's "Generate next N assignments" reads in order to WRITE those
-- rows, and an assignment already written is never touched again by an edit
-- here. That separation is deliberate: a head coach who reorders the rotation in
-- March must not silently move a due date a coach has already been told about.
-- The generator skips any (coach_slug, due_date) that exists, so pressing it
-- twice costs nothing and re-planning only ever adds future turns.
--
-- Singleton, by 029's pattern: `id boolean primary key default true check (id)`.
-- One studio, one rotation. The pk may only ever hold `true` and a pk is unique,
-- so "there is exactly one row" is a constraint rather than a rule somebody has
-- to remember.
--
-- PERMISSIONS: no new key. The rotation is the blog area, and 040 already split
-- that area into `view_blog` (see whose turn it is next) and `manage_blog`
-- (change whose turn it is). The plan is the same surface at the same two
-- depths, so it reuses that pair rather than minting a third key an admin would
-- have to discover and hand out before the panel worked.
--
-- Re-runnable: create-if-not-exists, drop-then-create policies, do-nothing seed.
-- ============================================================


-- ── 1. The table ────────────────────────────────────────────────────────────
--
-- `members` is a jsonb ARRAY and the array's ORDER IS THE ROTATION ORDER. It is
-- not a join table on purpose. There is no rotation_plan_members row to garbage
-- collect, no ordinal column to renumber when somebody drags a coach from fifth
-- to second, and reordering is one write of one value rather than five updates
-- inside a transaction that has to hold a unique(ordinal) constraint the whole
-- way through.
--
-- `every_count` + `every_unit` are the cadence: every 2 weeks, every 45 days,
-- every 3 months. The count is bounded at 365 so a typo cannot schedule the next
-- turn in the year 3000; the unit is a fixed three-word vocabulary and a CHECK,
-- not free text, because the generator switches on it.
--
-- `anchor` is the FIRST due date the generator counts from, not "when the plan
-- was made". Assignment i is due at anchor + i * (every_count every_unit) and
-- falls to members[i mod length], so moving the anchor moves the whole future
-- grid and changing the member list changes whose name is on each slot. Both are
-- things an admin does on purpose and can see the result of before saving: the
-- panel previews the next eight assignments live.

create table if not exists public.rotation_plans (
  id          boolean primary key default true check (id),
  members     jsonb   not null default '[]'::jsonb,
  every_count integer not null default 2 check (every_count between 1 and 365),
  every_unit  text    not null default 'week' check (every_unit in ('day', 'week', 'month')),
  anchor      date    not null default current_date,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);


-- ── 2. The members guard ────────────────────────────────────────────────────
--
-- SHAPE ONLY: an array, at most 50 entries, every entry a non-empty string.
--
-- WHAT IT DELIBERATELY DOES NOT CHECK is that each string names a coach who
-- exists. That validation belongs to the panel, against the live roster
-- (fetchCoachRoster), and it has to stay there for one reason: a coach can
-- LEAVE. There is no foreign key that could point at "a coach" in any case —
-- the roster is assembled in the app from four registries (coach_profiles,
-- coach_routing, coach_public_settings and the static five; see coachRoster.ts)
-- and no single table is the list. But even if one were, a departed coach whose
-- slug is still sitting in `members` must not make the plan row unwritable. The
-- head coach's next act after somebody leaves is to open this panel and take
-- them out, and a constraint that rejected the row on the way IN would have
-- already blocked that edit from ever being saved. So the database keeps the
-- shape, the panel keeps the meaning, and a stale slug renders on screen as
-- itself with a "not on the roster" note instead of vanishing or bricking.
--
-- 50 is a ceiling, not a target. It exists so a paste accident cannot put ten
-- thousand strings in a row every reader of this table has to parse.

create or replace function public.rotation_plan_guard_members()
returns trigger language plpgsql as $$
declare
  bad integer;
begin
  if jsonb_typeof(new.members) <> 'array' then
    raise exception 'The rotation plan members must be a JSON array of coach slugs.';
  end if;

  if jsonb_array_length(new.members) > 50 then
    raise exception 'A rotation plan holds at most 50 coaches; this one has %.',
      jsonb_array_length(new.members);
  end if;

  select count(*) into bad
    from jsonb_array_elements(new.members) as entry
   where jsonb_typeof(entry) <> 'string'
      or length(btrim(entry #>> '{}')) = 0;

  if bad > 0 then
    raise exception 'Every entry in the rotation plan must be a coach slug, and none may be blank.';
  end if;

  return new;
end $$;

-- Reads nothing outside its own NEW row and calls only pg_catalog functions, so
-- an empty search_path costs it nothing and 017's hardening convention applies
-- to every function this project adds.
alter function public.rotation_plan_guard_members() set search_path = '';

revoke all on function public.rotation_plan_guard_members() from public, anon;
grant  execute on function public.rotation_plan_guard_members() to authenticated, service_role;

drop trigger if exists rotation_plans_guard_members_trg on public.rotation_plans;
create trigger rotation_plans_guard_members_trg
  before insert or update on public.rotation_plans
  for each row execute function public.rotation_plan_guard_members();


-- ── 3. Touch ────────────────────────────────────────────────────────────────
--
-- 029's `settings_touch_at_by()` verbatim, because this table has exactly the
-- shape that function was written for: an `updated_at` to stamp and an
-- `updated_by` to attribute, with the coalesce that keeps a service-role write
-- (auth.uid() is null) from nulling the last human author. `before insert or
-- update`, as the other singletons do it, so the seeded row is stamped too.

drop trigger if exists rotation_plans_touch_trg on public.rotation_plans;
create trigger rotation_plans_touch_trg
  before insert or update on public.rotation_plans
  for each row execute function public.settings_touch_at_by();


-- ── 4. RLS ──────────────────────────────────────────────────────────────────
--
-- Read and write are separate policies for the reason 040 gives about
-- content_rotation itself: knowing whose turn is next is the point of a
-- rotation, and a `view_blog` holder who can see the schedule but not the plan
-- that produced it can see the WHAT and never the WHY. So the read is the wider
-- of the two keys and the write is the narrow one. No anon face at all: the
-- editorial calendar is not a public artefact.

alter table public.rotation_plans enable row level security;

drop policy if exists "blog readers read the rotation plan"  on public.rotation_plans;
drop policy if exists "manage_blog writes the rotation plan" on public.rotation_plans;

create policy "blog readers read the rotation plan"
  on public.rotation_plans for select to authenticated
  using (
    public.is_axis_admin()
    or public.has_permission('view_blog')
    or public.has_permission('manage_blog')
  );

create policy "manage_blog writes the rotation plan"
  on public.rotation_plans for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_blog'))
  with check (public.is_axis_admin() or public.has_permission('manage_blog'));

-- No DELETE grant. The singleton is edited, never removed; a plan with nobody in
-- it is expressed as an empty `members` array, which the generator answers with
-- zero assignments rather than with an error.
revoke all on public.rotation_plans from anon, authenticated;
grant  select, insert, update on public.rotation_plans to authenticated;


-- ── 5. Seed ─────────────────────────────────────────────────────────────────
--
-- The founding five in the order 005 gave them, and today's cadence stated in
-- the plan's own terms.
--
-- READ THE CADENCE CAREFULLY, because it is not the sentence 005 wrote in its
-- header. 005 says "every 2 months, staggered 2 weeks apart", which is two
-- numbers describing one grid. The plan describes the same grid with one number:
-- consecutive TURNS fall 14 days apart, so `every 2 week` is the step, and with
-- five members a given coach comes round again after a full loop of 5 * 14 = 70
-- days. That is the same fortnightly drumbeat the studio already has. It is not
-- identical to 005's arithmetic to the day — a 2-month gap is 61 days and a full
-- loop here is 70 — and that difference is accepted rather than papered over:
-- the plan's promise is "a post every two weeks, in this order", which is what
-- the rotation was always for, and the exact calendar from here on is whatever
-- the head coach generates and can see previewed before they do.
--
-- `on conflict (id) do nothing` is load-bearing. This row is OWNER-EDITED data
-- from the moment the panel is first used, and a re-run of the migration folder
-- must not put the founding five back over a roster somebody has since curated.

insert into public.rotation_plans (id, members, every_count, every_unit, anchor)
values (
  true,
  '["ronnie-vallejo","seth-burman","lucas-sison","kobe-pham","aedan-nguyen"]'::jsonb,
  2,
  'week',
  date '2026-08-01'
)
on conflict (id) do nothing;


-- ── 6. Verify ───────────────────────────────────────────────────────────────
--
-- One row, and a second is impossible:
--
--   select count(*) from public.rotation_plans;                         -- 1
--   insert into public.rotation_plans (id) values (true);               -- 0 rows
--   insert into public.rotation_plans (id) values (false);              -- CHECK
--
-- The seed is the founding five in order, every 2 weeks from 2026-08-01:
--
--   select jsonb_array_length(members), every_count, every_unit, anchor
--     from public.rotation_plans;                                -- 5 | 2 | week
--                                                                -- | 2026-08-01
--   select members -> 0 from public.rotation_plans;              -- "ronnie-vallejo"
--
-- The guard keeps the shape and nothing else:
--
--   update public.rotation_plans set members = '{}'::jsonb;      -- must be an array
--   update public.rotation_plans set members = '["a", 7]'::jsonb;-- must be a slug
--   update public.rotation_plans set members = '["a", "  "]'::jsonb; -- none blank
--   update public.rotation_plans
--      set members = (select jsonb_agg('c' || n) from generate_series(1, 51) n);
--                                                                -- at most 50
--   update public.rotation_plans
--      set members = '["someone-who-left","seth-burman"]'::jsonb; -- ACCEPTED, and
--                                                                 -- that is the point
--
-- The cadence is bounded and the unit is a vocabulary:
--
--   update public.rotation_plans set every_count = 0;            -- CHECK
--   update public.rotation_plans set every_count = 366;          -- CHECK
--   update public.rotation_plans set every_unit  = 'fortnight';  -- CHECK
--
-- Touch fires and attributes:
--
--   update public.rotation_plans set every_count = 3;
--   select updated_at > now() - interval '1 minute', updated_by is not null
--     from public.rotation_plans;                                -- t | t (signed in)
--
-- The two depths of the blog area, which is the whole reason there are two
-- policies:
--
--   -- as a coach holding view_blog only
--   select every_count from public.rotation_plans;               -- 1 row
--   update public.rotation_plans set every_count = 9;            -- UPDATE 0
--
--   -- as a coach holding manage_blog
--   update public.rotation_plans set every_count = 9;            -- UPDATE 1
--
--   -- as an athlete, holding neither
--   select count(*) from public.rotation_plans;                  -- 0
--
-- And anon cannot reach it at all:
--
--   set role anon;
--   select count(*) from public.rotation_plans;                  -- permission denied
--   reset role;
--
-- Re-runnable:
--
--   \i supabase/migrations/046_rotation_plan.sql
--   select count(*) from public.rotation_plans;                  -- still 1
--   select count(*) from pg_policies
--    where tablename = 'rotation_plans';                         -- 2
-- ============================================================
