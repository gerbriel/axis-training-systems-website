-- ============================================================
-- Axis Training Systems — 008: the double-booking guard
-- ============================================================
--
-- booking-create has said this since the day it was written:
--
--   "The DB exclusion constraint on bookings (coach_slug, slot) is the last
--    line of defence: two clients that pass validation on the same instant race
--    into the insert and exactly one wins; the loser gets 23P01 -> 409."
--
-- There is no such constraint. There never was. `grep -r "exclude using"` over
-- supabase/migrations/ returns nothing, and the function's own 23P01 branch is
-- therefore unreachable code guarding an invariant nothing enforces.
--
-- What that means in practice: booking-create reads the coach's schedule, the
-- blocks, the bookings and the busy cache, decides the slot is open, and then
-- inserts. Two requests for the same instant interleave between the read and
-- the write and BOTH commit. Two clients, one coach, one 9am. The window is
-- small — a few hundred milliseconds — which is exactly what makes it the kind
-- of bug that never shows up in testing and shows up on a Monday morning.
--
-- Application-level checking cannot close this. Only the database can, because
-- only the database can serialise the two writers. So:
--
--   * `slot` is not stored. The range is derived in the constraint expression
--     from `booked_at` and the generated `ends_at` (007), so there is exactly
--     one definition of when a booking occupies the calendar and no column that
--     can drift out of step with the two that produce it.
--
--   * The predicate is `status <> 'cancelled'`, matching
--     `bookings_mirror_to_busy` (007) and `bookings_coach_ends_idx`. A pending
--     booking holds its time exactly as a confirmed one does — that is what
--     makes "we will confirm within 24 hours" honest — and cancelling is what
--     releases it.
--
--   * Half-open `[)`. A 9:00–9:30 and a 9:30–10:00 do not overlap. Touching is
--     not overlapping, which is the same rule `overlaps()` uses in both the
--     browser and the edge function.
--
-- Re-runnable.
-- ============================================================


-- ── 1. Refuse to install a guard over data that already violates it ─────────
--
-- If two overlapping bookings already exist, ADD CONSTRAINT fails with a
-- Postgres error that names one arbitrary row and nothing else. That is a bad
-- way to find out you double-booked someone in March. This block finds every
-- offending pair first and raises with all of them, so the operator can go and
-- cancel the right one before running this again.

do $$
declare
  v_conflicts text;
  v_count     int;
begin
  select count(*), string_agg(
           format('  %s  %s  %s ↔ %s',
                  a.coach_slug,
                  to_char(a.booked_at, 'YYYY-MM-DD HH24:MI TZ'),
                  a.id, b.id),
           e'\n' order by a.booked_at)
    into v_count, v_conflicts
  from public.bookings a
  join public.bookings b
    on a.coach_slug = b.coach_slug
   and a.id < b.id
   and a.status <> 'cancelled'
   and b.status <> 'cancelled'
   and tstzrange(a.booked_at, a.ends_at, '[)') && tstzrange(b.booked_at, b.ends_at, '[)');

  if v_count > 0 then
    raise exception
      'Cannot add the double-booking guard: % overlapping booking pair(s) already exist.%',
      v_count, e'\n' || v_conflicts
      using hint =
        'Cancel one booking from each pair (update public.bookings set status = ''cancelled'' where id = ...), then re-run this migration.';
  end if;
end $$;


-- ── 2. The guard ────────────────────────────────────────────────────────────
--
-- gist over a text column needs btree_gist: `coach_slug WITH =` is a btree
-- equality operator being asked to live inside a gist index.

create extension if not exists btree_gist;

alter table public.bookings
  drop constraint if exists bookings_no_overlap;

alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    coach_slug WITH =,
    tstzrange(booked_at, ends_at, '[)') WITH &&
  )
  where (status <> 'cancelled');


-- ── 3. Verify ───────────────────────────────────────────────────────────────
--
-- Run these after applying. The first must return one row; the second must fail
-- with SQLSTATE 23P01 (exclusion_violation), which is the code booking-create
-- already translates to a 409 slot_taken.
--
--   select conname from pg_constraint
--    where conrelid = 'public.bookings'::regclass and conname = 'bookings_no_overlap';
--
--   begin;
--     insert into public.bookings (coach_slug, booked_at, duration_minutes,
--                                  first_name, last_name, email)
--     values ('ronnie-vallejo', now() + interval '30 days', 30, 'A', 'A', 'a@example.com'),
--            ('ronnie-vallejo', now() + interval '30 days', 30, 'B', 'B', 'b@example.com');
--   rollback;
