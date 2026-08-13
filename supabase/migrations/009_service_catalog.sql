-- ============================================================
-- Axis Training Systems — 009: what is actually being booked
-- ============================================================
--
-- Until now `/book` offered four services as a hard-coded array of strings in
-- BookPage.tsx, and what the visitor picked landed in `bookings.service_interest`
-- as free text. Nothing derived from it. The length of the call came from
-- `coach_schedules.slot_duration_minutes`, so a 20-minute intro call and a
-- 45-minute movement screen were both whatever the coach's window happened to
-- say — usually 30 minutes, for everyone, forever.
--
-- This migration makes the service a row, and the row own the duration.
--
-- Two rules, both borrowed from the same place the booking engine came from:
--
--   1. THE CLIENT NEVER SUPPLIES A DURATION OR A PRICE. The booking request
--      names which service. booking-create reads the length and the price off
--      the catalog, applies any per-coach override, and computes the slot from
--      that. A request that carries `duration_minutes` is answering a question
--      it was not asked.
--
--   2. `coach_schedules.slot_duration_minutes` STOPS MEANING "how long the
--      appointment is" AND STARTS MEANING "how often a slot may start". It is
--      the granularity of the grid — 9:00, 9:30, 10:00 — and the service is
--      what decides how much of the grid one booking consumes. A 45-minute
--      session on a 30-minute grid occupies 9:00–9:45 and the 9:30 start is
--      simply not offered. Nothing about the column changes; only what reads it.
--
-- A coach with no rows in `coach_booking_services` is a supported state and
-- behaves exactly as they did before this file: the slot engine falls back to
-- the window's own `slot_duration_minutes`. Nobody's calendar breaks on deploy.
--
-- Re-runnable.
-- ============================================================


-- ── 1. The catalog ──────────────────────────────────────────────────────────
--
-- `price_cents` is nullable and that is deliberate: Axis sells monthly coaching,
-- not sessions, so most of what you can book a call about genuinely has no
-- price at the point of booking. NULL renders as "Contact for pricing" and is
-- not a missing value to be backfilled later. `price_note` carries the qualifier
-- when there IS a number ('/mo', 'from').
--
-- Integer cents. No floats, here or anywhere near money.

create table if not exists public.booking_services (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  name             text not null,
  description      text,
  duration_minutes int  not null check (duration_minutes between 5 and 480),
  price_cents      int  check (price_cents >= 0),
  price_note       text,
  is_active        boolean not null default true,
  sort_order       int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint booking_services_slug_shape check (slug ~ '^[a-z0-9-]+$')
);

create index if not exists booking_services_active_idx
  on public.booking_services (sort_order, name) where is_active;


-- ── 2. Who offers what ──────────────────────────────────────────────────────
--
-- The join carries overrides rather than a copy of the service: a coach who
-- charges differently, or who runs a longer version of the same call, says so
-- here. Both columns are nullable and NULL means "the catalog's value" — never
-- zero, which is why neither has a default.

create table if not exists public.coach_booking_services (
  coach_slug                text not null,
  service_id                uuid not null references public.booking_services (id) on delete cascade,
  price_cents_override      int  check (price_cents_override >= 0),
  duration_minutes_override int  check (duration_minutes_override between 5 and 480),
  is_active                 boolean not null default true,
  sort_order                int  not null default 0,
  created_at                timestamptz not null default now(),

  primary key (coach_slug, service_id)
);

create index if not exists coach_booking_services_coach_idx
  on public.coach_booking_services (coach_slug) where is_active;


-- ── 3. What the booking remembers ───────────────────────────────────────────
--
-- `service_id` is the reference; `service_name` and `service_price_cents` are
-- SNAPSHOTS taken at booking time. Renaming a service or changing its price
-- next quarter must not rewrite what somebody booked last month — the same
-- reason a receipt is not a foreign key. `on delete set null` keeps the
-- snapshot readable after the catalog row is gone.
--
-- `service_interest` (003) stays exactly where it is. It is what every booking
-- taken before today recorded, the coach's screens read it, and dropping it
-- would blank the history to make the new column look tidier.

alter table public.bookings add column if not exists service_id          uuid references public.booking_services (id) on delete set null;
alter table public.bookings add column if not exists service_name        text;
alter table public.bookings add column if not exists service_price_cents int check (service_price_cents >= 0);

create index if not exists bookings_service_idx on public.bookings (service_id) where service_id is not null;


-- ── 4. Booking policy, per coach ────────────────────────────────────────────
--
-- These were constants in two files that had to be kept in step by hand, and
-- were not: the browser refused anything sooner than 120 minutes out
-- (BOOKING_BUFFER_MINUTES) while the edge function refused anything sooner than
-- 90 (MIN_LEAD_MS). The 30 minutes between them is a slot the UI never showed
-- and the server would have accepted.
--
-- They live on coach_public_settings because they are public facts about how
-- this coach takes bookings, they are read on the same page load as the zone,
-- and they belong to the same grain (one row per coach).
--
--   min_lead_minutes  the notice a coach needs. 0 = same-minute booking.
--   max_advance_days  how far out the calendar opens.
--   buffer_minutes    idle held after every booking. Occupies the calendar; it
--                     is not part of the call and never appears in a duration.
--   auto_confirm      whether a website booking lands 'confirmed' or 'pending'.
--                     Default false keeps today's behaviour, where a coach
--                     confirms by hand.

alter table public.coach_public_settings add column if not exists min_lead_minutes int     not null default 120;
alter table public.coach_public_settings add column if not exists max_advance_days int     not null default 70;
alter table public.coach_public_settings add column if not exists buffer_minutes   int     not null default 0;
alter table public.coach_public_settings add column if not exists auto_confirm     boolean not null default false;

alter table public.coach_public_settings drop constraint if exists coach_public_settings_policy_sane;
alter table public.coach_public_settings add  constraint coach_public_settings_policy_sane check (
      min_lead_minutes between 0 and 20160      -- ≤ 14 days
  and max_advance_days between 1 and 365
  and buffer_minutes   between 0 and 240
);


-- ── 5. RLS ──────────────────────────────────────────────────────────────────
--
-- The catalog is a menu. It is meant to be read by anyone standing outside the
-- building, so anon reads active rows and nothing else. Writes are the head
-- coach's: `is_content_admin()` (005) is a positive allowlist, so an email that
-- is not deliberately flagged cannot reach these tables at all.
--
-- A coach owns their own offerings row — that is their menu, not the roster's —
-- via `current_coach_slug()` (007), which reads the slug off the verified JWT.
-- The WITH CHECK repeats the USING predicate so a coach cannot write a row onto
-- another coach's slug on the way out.

alter table public.booking_services       enable row level security;
alter table public.coach_booking_services enable row level security;

drop policy if exists "public_read_services"       on public.booking_services;
drop policy if exists "admin_write_services"       on public.booking_services;
drop policy if exists "public_read_coach_services" on public.coach_booking_services;
drop policy if exists "coach_write_own_services"   on public.coach_booking_services;
drop policy if exists "admin_write_coach_services" on public.coach_booking_services;

create policy "public_read_services"
  on public.booking_services for select to anon, authenticated
  using (is_active);

create policy "admin_write_services"
  on public.booking_services for all to authenticated
  using (public.is_content_admin()) with check (public.is_content_admin());

create policy "public_read_coach_services"
  on public.coach_booking_services for select to anon, authenticated
  using (is_active);

create policy "coach_write_own_services"
  on public.coach_booking_services for all to authenticated
  using (coach_slug = public.current_coach_slug())
  with check (coach_slug = public.current_coach_slug());

create policy "admin_write_coach_services"
  on public.coach_booking_services for all to authenticated
  using (public.is_content_admin()) with check (public.is_content_admin());

-- Column grants, not just policies. anon has no business reading `created_at`
-- or an inactive row's existence, and narrowing here means a `select('*')` from
-- the browser is a permission error rather than a slow leak.
revoke all on public.booking_services       from anon, authenticated;
revoke all on public.coach_booking_services from anon, authenticated;

grant select (id, slug, name, description, duration_minutes, price_cents, price_note, sort_order)
  on public.booking_services to anon;
grant select (coach_slug, service_id, price_cents_override, duration_minutes_override, sort_order)
  on public.coach_booking_services to anon;

grant select, insert, update, delete on public.booking_services       to authenticated;
grant select, insert, update, delete on public.coach_booking_services to authenticated;

-- The four policy columns join the zone on the public read surface: the booking
-- page cannot draw a calendar without knowing how far out it opens.
grant select (coach_slug, time_zone, min_lead_minutes, max_advance_days, buffer_minutes, auto_confirm)
  on public.coach_public_settings to anon;


-- ── 6. Seed ─────────────────────────────────────────────────────────────────
--
-- The four strings that were in BookPage.tsx, plus the intro call that the
-- "book a call" CTA has always implied and never named, each given the length
-- it actually takes. Durations are the point of this file; they are the first
-- thing to correct against how these calls really run.
--
-- `on conflict (slug) do nothing` — re-running must not overwrite a duration
-- the studio has since tuned in the admin.

insert into public.booking_services (slug, name, description, duration_minutes, sort_order) values
  ('intro-call',
   'Free Intro Call',
   'A short call to talk through where you are, what you want, and whether Axis is the right fit. No commitment.',
   20, 10),
  ('coaching-consult',
   '1:1 Coaching Consultation',
   'For athletes considering full-service coaching. Training history, competition goals, and how the coach-athlete relationship would work.',
   30, 20),
  ('game-day-consult',
   'Game Day Coaching Call',
   'Meet-day handling: warm-up timing, attempt selection, and what having a coach in your corner on the platform looks like.',
   30, 30),
  ('movement-consult',
   'Movement Consulting Session',
   'A movement screen and technical review. Bring video of your competition lifts if you have it.',
   45, 40),
  ('coach-mentorship',
   'Coaching Mentorship Call',
   'For coaches. Programming philosophy, athlete management, and building a practice — mentorship rather than training.',
   45, 50)
on conflict (slug) do nothing;

-- Every coach on the roster offers everything to start with. A coach who does
-- not do mentorship turns that one off in their portal; the roster is not the
-- place to encode it, because the roster is not who decides.
insert into public.coach_booking_services (coach_slug, service_id, sort_order)
select r.coach_slug, s.id, s.sort_order
from public.coach_routing r
cross join public.booking_services s
where r.coach_slug is not null
on conflict (coach_slug, service_id) do nothing;


-- ── 7. Verify ───────────────────────────────────────────────────────────────
--
--   set role anon;
--   select slug, name, duration_minutes from public.booking_services;   -- 5 rows
--   select * from public.booking_services;                              -- permission denied
--   reset role;
