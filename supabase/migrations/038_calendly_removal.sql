-- ============================================================
-- Axis Training Systems, 038: Calendly, removed
-- ============================================================
--
-- Two columns hold a third-party booking link, and nothing on the site has ever
-- read either one:
--
--   coach_routing.calendly_url    014. Written by AdminSettings since June.
--   coach_profiles.book_call_url  032. Carried over from the static roster file
--                                 and seeded with the same Calendly address on
--                                 all five coaches.
--
-- 014's header says CoachPage "reads it to decide whether to show Book a
-- Consultation". That stopped being true. Every Book a Consultation button on
-- the site resolves through `bookCoachHref` (src/utils/nav.ts), which returns
-- the internal `/book` page for that coach's slug, and Axis takes the booking
-- itself: its own availability, its own hold on the slot, its own Google
-- Calendar event with the Meet link on it. There is no code path left that
-- turns either column into an href. Both are write-only dead data, and the two
-- admin fields that fill them in describe a button nobody renders.
--
-- So this is not a deprecation with a grace period. It is the removal of two
-- unread columns, and the screens that write them go in the same change:
-- AdminSettings' Calendly URL field and the roster manager's Book a call URL
-- field are deleted alongside this file, together with `Coach.bookCallUrl`,
-- `CoachRouting.calendly_url` and the row parser and payload plumbing behind
-- them. After this round the string "calendly" survives only in the history:
-- this file, 014, 017's guard, 032's seed literals and 036's lineage comment.
--
-- WHY THE VALUES ARE NULLED BEFORE THE COLUMNS ARE DROPPED. `alter table drop
-- column` is a catalogue edit. Postgres marks the attribute dropped and leaves
-- the bytes where they are, and every row keeps its old value in the heap until
-- that row is next rewritten. Nulling first forces the rewrite now, so the URLs
-- leave the live rows rather than merely becoming unreachable through SQL. It
-- also means a database where the DROP is refused for a reason this chain does
-- not know about still ends up with no URLs in it.
--
-- WHY EACH UPDATE SITS INSIDE AN IF-EXISTS GUARD. Re-runnable is a house rule,
-- and the second run of this file happens on a database where these columns are
-- already gone. A statement that names a column that does not exist cannot be
-- parsed at all (42703), so it fails even though it would have matched no rows.
-- This is the same guard 017 wraps around its calendly_url grant, for the same
-- reason. The DROP statements need no such help: `if exists` covers them.
--
-- THE SHAPE CHECK IS DROPPED BY NAME even though it would go with its column
-- anyway. A check constraint cannot outlive the column it references, so
-- `coach_profiles_book_call_url_shape` is removed either way. Naming it means
-- this file lists everything it takes with it, rather than relying on the
-- reader knowing that rule.
--
-- COLUMN GRANTS need no attention for the same reason. 032 grants
-- `book_call_url` to anon in a select list and to authenticated in the insert
-- and update lists; 017 grants `calendly_url` to anon. Dropping a column drops
-- its privileges with it, so there is nothing here to revoke.
--
-- REPLAY HAZARDS, because both source files are re-runnable and one of them
-- adds its column straight back:
--
--   014  re-adds coach_routing.calendly_url, empty. Nothing writes it after
--        this file, so it stays empty.
--   017  re-grants select on that column to anon ONLY inside `if exists`. With
--        the column gone that guard no-ops, so replaying 017 on its own leaves
--        the anon surface at exactly id, coach_name, coach_slug. Replaying 014
--        and then 017 brings back the empty column and its anon grant.
--   032  re-adds coach_profiles.book_call_url through its section 3
--        `add column if not exists`, and without the shape check: the
--        constraints hang off `create table if not exists`, which is a no-op on
--        a second run. It also re-grants the column to anon and authenticated.
--        The column comes back EMPTY, because 032's seed is
--        `on conflict (slug) do nothing` and inserts nothing on a database that
--        already holds the five rows. An empty column nothing reads or writes
--        is harmless; re-apply this file to be rid of it again.
--
-- Applying the directory in filename order is the normal case and lands in the
-- right state: 014 adds, 017 guards, 032 adds and seeds, 038 removes.
--
-- 036's header still lists `+014 calendly_url` in coach_routing's lineage. That
-- is a true statement about what 014 did and it is left as written.
--
-- Re-runnable.
-- ============================================================


-- ── 1. coach_profiles.book_call_url ─────────────────────────────────────────

do $do$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'coach_profiles'
       and column_name = 'book_call_url'
  ) then
    execute 'update public.coach_profiles set book_call_url = null where book_call_url is not null';
  end if;
end
$do$;

alter table public.coach_profiles
  drop constraint if exists coach_profiles_book_call_url_shape;

alter table public.coach_profiles
  drop column if exists book_call_url;


-- ── 2. coach_routing.calendly_url ───────────────────────────────────────────

do $do$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'coach_routing'
       and column_name = 'calendly_url'
  ) then
    execute 'update public.coach_routing set calendly_url = null where calendly_url is not null';
  end if;
end
$do$;

alter table public.coach_routing
  drop column if exists calendly_url;


-- ── 3. Verify ───────────────────────────────────────────────────────────────
--
-- Both columns gone, and the check that hung off one of them with it:
--
--   select table_name, column_name
--     from information_schema.columns
--    where table_schema = 'public'
--      and (table_name, column_name) in (('coach_routing',  'calendly_url'),
--                                        ('coach_profiles', 'book_call_url'));
--   -- 0 rows
--
--   select conname from pg_constraint
--    where conname = 'coach_profiles_book_call_url_shape';   -- 0 rows
--
--   select calendly_url from public.coach_routing limit 1;   -- 42703
--   select book_call_url from public.coach_profiles limit 1; -- 42703
--
-- 017's guard is now a no-op, and the anon surface on coach_routing is what
-- that file's comment promises: never `email`, never `is_admin`, and now never
-- a booking link either.
--
--   \i supabase/migrations/017_security_hardening.sql
--   select column_name, privilege_type
--     from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'coach_routing'
--      and grantee = 'anon'
--    order by column_name;
--   -- coach_name / coach_slug / id, SELECT on each. No calendly_url row.
--
-- The roster is untouched apart from the one column. Five rows, still visible,
-- still in order:
--
--   select count(*) from public.coach_profiles where is_visible;   -- 5
--
-- And the second run changes nothing rather than raising 42703:
--
--   \i supabase/migrations/038_calendly_removal.sql   -- no error
--
-- Re-runnable.
