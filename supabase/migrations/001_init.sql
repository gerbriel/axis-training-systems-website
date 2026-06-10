-- ============================================================
-- Axis Training Systems — Supabase Database Setup
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. LEADS TABLE
create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),

  -- Contact
  first_name    text not null,
  last_name     text not null,
  email         text not null,
  social        text,
  service       text not null,
  coach_pref    text default 'No Preference',

  -- Physical profile
  age           text,
  height        text,
  body_weight   text,
  weight_class  text,
  experience    text,
  injuries      text,
  train_days    text,
  occupation    text,

  -- Training data
  squat_max     text,
  bench_max     text,
  dead_max      text,
  squat_freq    text,
  bench_freq    text,
  dead_freq     text,
  current_program text,
  squat_style   text,
  bench_style   text,
  dead_style    text,

  -- Lifestyle
  weak_points   text,
  learning_style text,
  sleep         text,
  nutrition     text,
  stress        text,
  recovery      text,

  -- Goals
  expectations  text,
  goals         text,

  -- Admin fields
  status        text default 'new' check (status in ('new','reviewed','accepted','declined')),
  admin_notes   text
);

-- 2. COACH EMAIL ROUTING TABLE
create table if not exists coach_routing (
  id          uuid primary key default gen_random_uuid(),
  coach_name  text unique not null,
  email       text not null default '',
  notify      boolean default true,
  updated_at  timestamptz default now()
);

-- Seed default coaches
insert into coach_routing (coach_name, email, notify) values
  ('Ronnie Vallejo',  '', true),
  ('Seth Burman',     '', true),
  ('Lucas Sison',     '', true),
  ('Kobe Pham',       '', true),
  ('Aedan Nguyen',    '', true),
  ('No Preference',   '', true)
on conflict (coach_name) do nothing;

-- 3. MASTER NOTIFICATION EMAIL (single-row config table)
create table if not exists admin_config (
  key   text primary key,
  value text not null default ''
);

insert into admin_config (key, value) values
  ('master_notify_email', ''),
  ('resend_api_key', '')         -- store your Resend API key here (or use Supabase secrets)
on conflict (key) do nothing;

-- 4. ROW-LEVEL SECURITY
alter table leads          enable row level security;
alter table coach_routing  enable row level security;
alter table admin_config   enable row level security;

-- Authenticated users (admin) can do everything
create policy "admin full access to leads"
  on leads for all to authenticated using (true) with check (true);

create policy "admin full access to coach_routing"
  on coach_routing for all to authenticated using (true) with check (true);

create policy "admin full access to admin_config"
  on admin_config for all to authenticated using (true) with check (true);

-- Anon role can INSERT leads only (from the public application form)
create policy "public can insert leads"
  on leads for insert to anon with check (true);

-- Anon role can READ coach_routing to send email (needed by edge function)
create policy "public can read coach_routing"
  on coach_routing for select to anon using (true);
