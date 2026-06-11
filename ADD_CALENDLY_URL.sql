-- Add calendly_url column to coach_routing
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)

alter table public.coach_routing
  add column if not exists calendly_url text default null;

-- Allow anon (public site) to read calendly_url from coach_routing
-- so CoachPage can display the correct per-coach booking link
create policy if not exists "anon_read_coach_routing"
  on public.coach_routing
  for select
  to anon
  using (true);
