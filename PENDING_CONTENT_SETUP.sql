-- ============================================================
-- Axis Training Systems — pending_content table
-- Run once in your Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Table
create table if not exists public.pending_content (
  id             uuid primary key default gen_random_uuid(),
  type           text not null check (type in ('blog', 'meet')),
  coach_slug     text not null,
  coach_name     text not null,
  status         text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected')),
  submitted_at   timestamptz not null default now(),
  reviewed_at    timestamptz,
  rejection_note text,

  -- Blog fields
  title          text,
  subtitle       text,
  tags           text,           -- comma-separated
  summary        text,
  content        text,           -- paragraphs separated by \n\n

  -- Meet fields
  meet_name      text,
  meet_date      text,           -- stored as display string e.g. "July 24–27, 2026"
  meet_location  text,
  federation     text,
  meet_type      text check (meet_type is null or meet_type in ('National','Regional','World','Local')),
  meet_note      text
);

-- 2. Indexes for common query patterns
create index if not exists pending_content_status_idx
  on public.pending_content (status);

create index if not exists pending_content_coach_slug_idx
  on public.pending_content (coach_slug);

create index if not exists pending_content_type_status_idx
  on public.pending_content (type, status);

-- 3. Row Level Security
alter table public.pending_content enable row level security;

-- Anon users (public site): read only approved content
create policy "anon_read_approved"
  on public.pending_content
  for select
  to anon
  using (status = 'approved');

-- Authenticated users (coaches + master admin): read everything
create policy "auth_read_all"
  on public.pending_content
  for select
  to authenticated
  using (true);

-- Authenticated users: submit new content
create policy "auth_insert"
  on public.pending_content
  for insert
  to authenticated
  with check (true);

-- Authenticated users: approve / reject / update status
create policy "auth_update"
  on public.pending_content
  for update
  to authenticated
  using (true);

-- Authenticated users: delete records
create policy "auth_delete"
  on public.pending_content
  for delete
  to authenticated
  using (true);

-- ============================================================
-- Done. The app will use this table automatically when
-- VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.
-- Without those env vars, the app falls back to localStorage
-- (demo / preview mode).
-- ============================================================
