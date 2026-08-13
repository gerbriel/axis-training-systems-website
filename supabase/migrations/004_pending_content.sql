-- ============================================================
-- Migration 004: pending_content + per-coach RLS
-- ============================================================
-- Supersedes PENDING_CONTENT_SETUP.sql, a loose script that lived in the repo
-- root until it was deleted as part of 014/015.
--
-- That file created the table with `using (true)` on update/delete for every
-- authenticated user, which meant any coach could approve their own post or
-- edit/delete another coach's. This migration creates the table (if the old
-- script was already run by hand, the table survives untouched) and replaces
-- those policies with a real per-coach model:
--
--   • anon        → read approved content only
--   • coach       → insert/read/edit/delete their OWN rows, and only while the
--                   row is unapproved. Cannot set status = 'approved'.
--   • admin       → full access. Admin = an authenticated email that is either
--                   absent from coach_routing, or flagged is_admin (so the head
--                   coach can both coach and approve).
-- ============================================================

-- ── 1. Table ────────────────────────────────────────────────────────────────
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
  content        text,           -- JSON array of BlogSection, or \n\n-separated paragraphs

  -- Meet fields
  meet_name      text,
  meet_date      text,
  meet_location  text,
  federation     text,
  meet_type      text check (meet_type is null or meet_type in ('National','Regional','World','Local')),
  meet_note      text
);

create index if not exists pending_content_status_idx      on public.pending_content (status);
create index if not exists pending_content_coach_slug_idx  on public.pending_content (coach_slug);
create index if not exists pending_content_type_status_idx on public.pending_content (type, status);

-- ── 2. Identity plumbing on coach_routing ───────────────────────────────────
-- RLS needs to map auth.email() → coach slug. coach_routing only had names.
alter table public.coach_routing add column if not exists coach_slug text;
alter table public.coach_routing add column if not exists is_admin   boolean not null default false;

update public.coach_routing set coach_slug = 'ronnie-vallejo' where coach_name = 'Ronnie Vallejo';
update public.coach_routing set coach_slug = 'seth-burman'    where coach_name = 'Seth Burman';
update public.coach_routing set coach_slug = 'lucas-sison'    where coach_name = 'Lucas Sison';
update public.coach_routing set coach_slug = 'kobe-pham'      where coach_name = 'Kobe Pham';
update public.coach_routing set coach_slug = 'aedan-nguyen'   where coach_name = 'Aedan Nguyen';

-- Ronnie is Head Coach & Founder: he is a coach (writes blogs, owns leads) AND
-- the approver. Without this flag the migration-002 rule "admin = email not in
-- coach_routing" would lock him out of approving.
update public.coach_routing set is_admin = true where coach_name = 'Ronnie Vallejo';

create unique index if not exists coach_routing_coach_slug_idx
  on public.coach_routing (coach_slug) where coach_slug is not null;

-- ── 3. Identity helpers ─────────────────────────────────────────────────────
-- SECURITY DEFINER so policy evaluation can read coach_routing regardless of
-- the caller's own RLS on that table. Pinned search_path per Supabase guidance.

create or replace function public.current_coach_slug()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coach_slug
  from public.coach_routing
  where lower(email) = lower(coalesce(auth.email(), ''))
    and coach_slug is not null
  limit 1
$$;

create or replace function public.is_content_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- signed in, and either flagged admin or not a coach at all
    auth.email() is not null
    and (
      exists (
        select 1 from public.coach_routing
        where lower(email) = lower(auth.email()) and is_admin
      )
      or not exists (
        select 1 from public.coach_routing
        where lower(email) = lower(auth.email())
      )
    )
$$;

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
alter table public.pending_content enable row level security;

-- Drop the permissive policies from PENDING_CONTENT_SETUP.sql if that script
-- was run by hand against this database.
drop policy if exists "anon_read_approved" on public.pending_content;
drop policy if exists "auth_read_all"      on public.pending_content;
drop policy if exists "auth_insert"        on public.pending_content;
drop policy if exists "auth_update"        on public.pending_content;
drop policy if exists "auth_delete"        on public.pending_content;
-- and this migration's own, so it is re-runnable
drop policy if exists "public_read_approved"        on public.pending_content;
drop policy if exists "coach_read_own"              on public.pending_content;
drop policy if exists "coach_insert_own"            on public.pending_content;
drop policy if exists "coach_update_own_unapproved" on public.pending_content;
drop policy if exists "coach_delete_own_pending"    on public.pending_content;
drop policy if exists "admin_full_access"           on public.pending_content;

-- Public site: approved content only.
create policy "public_read_approved"
  on public.pending_content for select to anon, authenticated
  using (status = 'approved');

-- Coach: sees their own submissions at any status (to track pending/rejected).
create policy "coach_read_own"
  on public.pending_content for select to authenticated
  using (coach_slug = public.current_coach_slug());

-- Coach: may only create rows under their own slug, and only as 'pending'.
-- The `status = 'pending'` check is what stops a coach self-publishing.
create policy "coach_insert_own"
  on public.pending_content for insert to authenticated
  with check (
    coach_slug = public.current_coach_slug()
    and status = 'pending'
  );

-- Coach: may edit their own work while it is pending or was rejected.
-- USING gates which rows are editable (never an approved one — a coach cannot
-- silently rewrite live content). WITH CHECK forces the result back to
-- 'pending', so editing a rejected post re-enters the review queue and a coach
-- can never move a row to 'approved'.
create policy "coach_update_own_unapproved"
  on public.pending_content for update to authenticated
  using (
    coach_slug = public.current_coach_slug()
    and status in ('pending', 'rejected')
  )
  with check (
    coach_slug = public.current_coach_slug()
    and status = 'pending'
  );

-- Coach: may withdraw a submission that has not been reviewed yet.
create policy "coach_delete_own_pending"
  on public.pending_content for delete to authenticated
  using (
    coach_slug = public.current_coach_slug()
    and status = 'pending'
  );

-- Admin / head coach: approve, reject, edit, delete anything.
create policy "admin_full_access"
  on public.pending_content for all to authenticated
  using (public.is_content_admin())
  with check (public.is_content_admin());
