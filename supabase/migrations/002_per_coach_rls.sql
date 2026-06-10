-- ============================================================
-- Migration 002: Per-Coach Row-Level Security + Coach Accounts
-- ============================================================
-- Run this AFTER 001_init.sql in the Supabase SQL Editor.
--
-- This migration replaces the blanket "authenticated = admin" policy
-- with a proper per-coach access model:
--
--   • Master admins  = authenticated users whose email is NOT in coach_routing
--                      → can SELECT/UPDATE/DELETE all leads
--   • Coach users    = authenticated users whose email IS in coach_routing
--                      → can only SELECT/UPDATE leads where coach_pref = their name
-- ============================================================

-- Step 1: Drop the old blanket policy
drop policy if exists "admin full access to leads" on leads;

-- Step 2: Master admin access — full access if email not in coach_routing
create policy "master admin access to leads"
  on leads for all to authenticated
  using (
    not exists (
      select 1 from coach_routing
      where lower(email) = lower(auth.email())
    )
  )
  with check (
    not exists (
      select 1 from coach_routing
      where lower(email) = lower(auth.email())
    )
  );

-- Step 3: Coach read access — only their own coach_pref leads
create policy "coaches can read own leads"
  on leads for select to authenticated
  using (
    coach_pref = (
      select coach_name from coach_routing
      where lower(email) = lower(auth.email())
      limit 1
    )
  );

-- Step 4: Coach update access — only status and admin_notes on their leads
create policy "coaches can update own leads"
  on leads for update to authenticated
  using (
    coach_pref = (
      select coach_name from coach_routing
      where lower(email) = lower(auth.email())
      limit 1
    )
  )
  with check (
    coach_pref = (
      select coach_name from coach_routing
      where lower(email) = lower(auth.email())
      limit 1
    )
  );

-- ============================================================
-- Step 5: Seed real coach emails into coach_routing
-- Replace placeholder emails below with the actual coach emails
-- used when creating their Supabase accounts.
-- ============================================================
update coach_routing set email = 'ronnie@axistrainingsystems.com' where coach_name = 'Ronnie Vallejo';
update coach_routing set email = 'seth@axistrainingsystems.com'    where coach_name = 'Seth Burman';
update coach_routing set email = 'lucas@axistrainingsystems.com'   where coach_name = 'Lucas Sison';
update coach_routing set email = 'kobe@axistrainingsystems.com'    where coach_name = 'Kobe Pham';
update coach_routing set email = 'aedan@axistrainingsystems.com'   where coach_name = 'Aedan Nguyen';

-- ============================================================
-- To create coach Supabase accounts:
--   1. Supabase Dashboard → Authentication → Users → Invite User
--   2. Enter coach email (must match what you put in coach_routing above)
--   3. Coach receives email invite and sets their password
--   4. Their portal is at: /admin/<their-slug>
--      e.g. /admin/ronnie-vallejo
-- ============================================================
