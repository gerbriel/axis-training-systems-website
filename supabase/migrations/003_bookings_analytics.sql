-- ============================================================
-- Axis Training Systems — Bookings & Analytics
-- ============================================================

-- Coach recurring weekly schedule
create table if not exists coach_schedules (
  id                    uuid primary key default gen_random_uuid(),
  coach_slug            text not null,
  day_of_week           int  not null check (day_of_week between 0 and 6), -- 0=Sun, 1=Mon...
  start_time            time not null,
  end_time              time not null,
  slot_duration_minutes int  not null default 30,
  is_active             boolean not null default true,
  created_at            timestamptz default now()
);

-- Date-specific blocks (coaches mark specific dates/times unavailable)
create table if not exists coach_availability_blocks (
  id           uuid primary key default gen_random_uuid(),
  coach_slug   text not null,
  block_date   date not null,
  start_time   time,   -- null = full-day block
  end_time     time,   -- null = full-day block
  reason       text,
  created_at   timestamptz default now()
);

-- Booked calls
create table if not exists bookings (
  id               uuid primary key default gen_random_uuid(),
  coach_slug       text not null,
  booked_at        timestamptz not null,
  duration_minutes int  not null default 30,
  first_name       text not null,
  last_name        text not null,
  email            text not null,
  phone            text,
  service_interest text,
  goals            text,
  status           text not null default 'pending'
                     check (status in ('pending', 'confirmed', 'cancelled')),
  coach_notes      text,
  created_at       timestamptz default now()
);

-- Page analytics
create table if not exists pageviews (
  id         uuid primary key default gen_random_uuid(),
  path       text not null,
  referrer   text,
  session_id text not null,
  created_at timestamptz default now()
);

-- RLS
alter table coach_schedules           enable row level security;
alter table coach_availability_blocks enable row level security;
alter table bookings                  enable row level security;
alter table pageviews                 enable row level security;

-- Public can read availability data (needed to show open slots)
create policy "public_read_schedules"    on coach_schedules           for select using (true);
create policy "public_read_blocks"       on coach_availability_blocks for select using (true);
create policy "public_read_bookings"     on bookings                  for select using (true);

-- Public can insert bookings and pageviews (no auth required)
create policy "public_insert_bookings"   on bookings  for insert with check (true);
create policy "public_insert_pageviews"  on pageviews for insert with check (true);

-- Authenticated users have full access
create policy "auth_all_schedules" on coach_schedules           for all using (auth.role() = 'authenticated') with check (true);
create policy "auth_all_blocks"    on coach_availability_blocks for all using (auth.role() = 'authenticated') with check (true);
create policy "auth_all_bookings"  on bookings                  for all using (auth.role() = 'authenticated') with check (true);
create policy "auth_all_pageviews" on pageviews                 for all using (auth.role() = 'authenticated') with check (true);
