-- ============================================================
-- Migration 005: Booking RLS lockdown
-- ============================================================
--
--   ██  DO NOT APPLY THIS UNTIL THE EDGE FUNCTIONS AND THE NEW FRONTEND
--   ██  ARE BOTH DEPLOYED AND VERIFIED. IT TAKES AWAY THE ANON ROLE'S
--   ██  ACCESS TO `bookings`. APPLIED EARLY, /book STOPS WORKING.
--
-- Preconditions — all four must be true before you run this:
--
--   1. 004_google_calendar_sync.sql applied.
--   2. Edge function `booking-create` deployed and returning 200 on a real
--      booking. It is the ONLY way a visitor can create a booking after this
--      file runs.
--   3. The frontend deployed from this branch: `availability.ts` must read busy
--      times from `coach_calendar_busy`, NOT from `bookings`, and must read
--      `coach_availability_blocks` with an explicit column list (it currently
--      does `select('*')`, which becomes a permission error the moment `reason`
--      is revoked below).
--   4. `BookPage.tsx` POSTs to `booking-create` instead of
--      `supabase.from('bookings').insert(...)`.
--
-- What today looks like without this file (003:64-67):
--
--   create policy "public_read_bookings"   on bookings for select using (true);
--   create policy "public_insert_bookings" on bookings for insert with check (true);
--
-- `public_read_bookings` means anyone on the internet can
-- `GET /rest/v1/bookings?select=*` and download every client's first name, last
-- name, email, phone, stated goals and coach notes. That is the most serious
-- issue in the schema, and this file is what closes it.
--
-- ROLLBACK — if /book breaks, paste this and the site is back to 003 behaviour
-- immediately (it re-opens the PII leak; treat it as an emergency measure only):
--
--   grant select, insert on public.bookings to anon;
--   create policy "public_read_bookings"   on public.bookings for select using (true);
--   create policy "public_insert_bookings" on public.bookings for insert with check (true);
--   grant select on public.coach_availability_blocks to anon;
--   drop policy if exists "coach_read_own_bookings"   on public.bookings;
--   drop policy if exists "coach_update_own_bookings" on public.bookings;
--   drop policy if exists "admin_all_bookings"        on public.bookings;
--   create policy "auth_all_bookings" on public.bookings for all
--     using (auth.role() = 'authenticated') with check (true);
--
-- ============================================================


-- ── 0. Identity helper ──────────────────────────────────────────────────────
-- Re-declared identically to 004_pending_content.sql so this migration does not
-- silently depend on the content track having been applied.
-- Admin = an authenticated email flagged is_admin in coach_routing, and NOTHING
-- ELSE. Membership is a positive allowlist: an email absent from coach_routing is
-- NOT an admin. The previous "absent from coach_routing = master admin" rule was
-- fail-open — Supabase public signup ships enabled and the anon key is in the
-- Vite bundle, so anyone could self-register an unknown email, land in the
-- "absent" branch, and read every client's PII. This function must only ever
-- return true for a deliberately-flagged row.

alter table public.coach_routing add column if not exists is_admin boolean not null default false;
update public.coach_routing set is_admin = true where coach_name = 'Ronnie Vallejo';

create or replace function public.is_content_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.email() is not null
    and exists (
      select 1 from public.coach_routing
      where lower(email) = lower(auth.email()) and is_admin
    )
$$;

revoke all     on function public.is_content_admin() from public;
grant  execute on function public.is_content_admin() to authenticated, service_role;


-- ── 1. Anon loses `bookings` entirely ───────────────────────────────────────
-- Reads: closed. A booking row is client PII (name, email, phone, goals) plus
-- the coach's private notes. Nothing on the public site needs it — the /book
-- page gets its busy intervals from coach_calendar_busy, which carries an
-- interval and nothing else (invariant 2).
--
-- Writes: closed. Direct anon INSERT means the client chooses the row: any
-- coach_slug, any instant, any duration, in the past, at 3am, overlapping an
-- existing booking. Every one of those validations now lives server-side in
-- `booking-create` (slot must genuinely be open, ≥90 min out, ≤120 d out, one of
-- the four allowed durations, coach must exist), running as service_role.

drop policy if exists "public_read_bookings"   on public.bookings;
drop policy if exists "public_insert_bookings" on public.bookings;

revoke all on public.bookings from anon;


-- ── 2. Anon loses `coach_availability_blocks.reason` ────────────────────────
-- The block DATE and TIMES are public by necessity — they are why a slot is not
-- offered. The REASON is not: it is the coach's private note to themselves
-- ("surgery", "interview at <competitor>", "vacation with <name>"). Today anon
-- reads the whole row.
--
-- The policy stays `using (true)`; it is the column grant that narrows the
-- surface. Consequence: an anon `select('*')` on this table is now a permission
-- error, which is precisely why precondition 3 above exists.

revoke all    on public.coach_availability_blocks from anon;
grant  select (id, coach_slug, block_date, start_time, end_time)
  on public.coach_availability_blocks to anon;

-- coach_schedules stays fully readable by anon: it is a coach's published
-- working hours, which is exactly what the booking page is for. No PII, nothing
-- to narrow.


-- ── 3. Authenticated: per-coach, not blanket ────────────────────────────────
-- 003's `auth_all_bookings` gave EVERY authenticated user full read/write over
-- EVERY booking — so any coach could read another coach's clients' phone numbers
-- and cancel their calls. Same defect 002 fixed for `leads`; it was never
-- applied to `bookings`.

drop policy if exists "auth_all_bookings"         on public.bookings;
drop policy if exists "coach_read_own_bookings"   on public.bookings;
drop policy if exists "coach_update_own_bookings" on public.bookings;
drop policy if exists "admin_all_bookings"        on public.bookings;

-- WHO: a signed-in coach, for bookings on THEIR OWN calendar only. The slug comes
-- from the verified JWT via coach_routing, never from the client (invariant 3).
create policy "coach_read_own_bookings"
  on public.bookings for select to authenticated
  using (coach_slug = public.current_coach_slug());

-- WHO: the same coach, confirming / cancelling / annotating their own bookings.
-- The WITH CHECK repeats the USING predicate so a coach cannot re-assign a
-- booking to another coach's slug on the way out.
create policy "coach_update_own_bookings"
  on public.bookings for update to authenticated
  using (coach_slug = public.current_coach_slug())
  with check (coach_slug = public.current_coach_slug());

-- WHO: master admins and the head coach. Full access, including the admin
-- dashboard's cross-coach view.
create policy "admin_all_bookings"
  on public.bookings for all to authenticated
  using (public.is_content_admin())
  with check (public.is_content_admin());

-- Coaches do not create bookings from the portal, and service_role bypasses RLS,
-- so there is no INSERT policy for `authenticated` beyond the admin one above.
-- If the portal ever grows a "book on behalf of a client" button, it gets its own
-- policy — it does not get `with check (true)`.


-- ── 4. Verify ───────────────────────────────────────────────────────────────
-- Run these after applying. The first must return 0 rows; the second must fail.
--
--   select polname from pg_policy
--    where polrelid = 'public.bookings'::regclass
--      and polname in ('public_read_bookings', 'public_insert_bookings');
--
--   set role anon; select * from public.bookings limit 1;  -- expect: permission denied
--   reset role;
