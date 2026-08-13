-- ============================================================
-- Axis Training Systems — 015: newsletter_leads
-- ============================================================
--
-- This table has been in production since June and has never been in the schema
-- history. It was CREATE_NEWSLETTER_LEADS.sql in the repo root, pasted into the
-- SQL editor once, by hand. Every database built from the migrations — a branch,
-- a staging project, a restore, a new developer running `supabase db reset` —
-- came up without it, and the guides page, the attempt planner gate and the
-- admin newsletter panel all fail against a table the migrations never mention.
--
-- Everything below is written to be safe against the database that already has
-- it, because that is the one that matters.
--
-- ONE THING IS DELIBERATELY NOT A FAITHFUL PORT. The original read policy was
--
--     using (auth.role() = 'authenticated')
--
-- under a comment that read "only authenticated admins can read". Those two
-- things meant the same in June, when the only accounts in the project were the
-- five coaches. They stopped meaning the same in 011, which gave clients
-- profiles, and again in 013, which turns an accepted application into an
-- account automatically. "Authenticated" is now every athlete who ever signed
-- up, and the subscriber list — name and email of everyone who downloaded a
-- guide — is readable by all of them.
--
-- So the check here is `is_axis_admin()`: the positive allowlist 005 insisted on
-- and 011 moved onto profiles. Note the old policies are dropped BY NAME below.
-- Permissive policies are OR'd together, so adding a strict one while leaving
-- the loose one in place would tighten exactly nothing.
--
-- Re-runnable.
-- ============================================================


-- ── 1. Table ────────────────────────────────────────────────────────────────

create table if not exists public.newsletter_leads (
  id         uuid primary key default gen_random_uuid(),
  first_name text        not null,
  last_name  text        not null,
  email      text        not null,
  source     text        not null default 'guides_page',
  created_at timestamptz not null default now()
);


-- ── 2. Constraints and indexes ──────────────────────────────────────────────
--
-- Drop-then-add is the idempotent form for a named constraint: `add constraint`
-- has no IF NOT EXISTS, so a second run would fail on a database that already
-- has it. On a database with duplicate addresses the ADD will fail loudly,
-- which is the correct outcome — the app lowercases before insert and treats a
-- second signup as "already subscribed", so duplicates would mean something
-- else wrote to this table.

alter table public.newsletter_leads
  drop constraint if exists newsletter_leads_email_key;
alter table public.newsletter_leads
  add  constraint newsletter_leads_email_key unique (email);

create index if not exists newsletter_leads_created_at_idx
  on public.newsletter_leads (created_at desc);


-- ── 3. Grants ───────────────────────────────────────────────────────────────
--
-- Supabase's default privileges hand anon and authenticated everything on a new
-- table in `public`, so the grants are stated rather than assumed. Anon signs
-- up and nothing more; reading is an authenticated action gated again by RLS.

revoke all           on public.newsletter_leads from anon, authenticated;
grant  insert        on public.newsletter_leads to anon;
grant  select, insert on public.newsletter_leads to authenticated;


-- ── 4. RLS ──────────────────────────────────────────────────────────────────

alter table public.newsletter_leads enable row level security;

-- The two names created by the loose root script. Dropping them is the whole
-- point of this section — see the header.
drop policy if exists "Admins can select newsletter_leads" on public.newsletter_leads;
drop policy if exists "Anyone can insert newsletter_leads" on public.newsletter_leads;

drop policy if exists "newsletter_leads_admin_read"    on public.newsletter_leads;
drop policy if exists "newsletter_leads_public_insert" on public.newsletter_leads;

create policy "newsletter_leads_admin_read"
  on public.newsletter_leads for select to authenticated
  using (public.is_axis_admin());

-- The signup form is on public pages, so the visitor is anon. Nothing to check:
-- the row is whatever they typed, and the unique index is what stops a second
-- one. Sanitising and length-capping happen in newsletterApi.ts before insert.
create policy "newsletter_leads_public_insert"
  on public.newsletter_leads for insert to anon, authenticated
  with check (true);


-- ============================================================
-- KNOWN GAP — carried over from the root script, NOT introduced here.
--
-- subscribeNewsletter() in src/lib/newsletterApi.ts does two things an anon
-- caller cannot do against this table, and could not do against the root
-- script's version either:
--
--   1. `select id ... eq email` to detect an existing subscriber, so it can
--      show "you're already subscribed" instead of an error.
--   2. `.insert(...).select().single()` — PostgREST's RETURNING is filtered by
--      the SELECT policy, and anon has none.
--
-- Neither is fixable by loosening the read: any anon SELECT policy wide enough
-- to return the caller's own row is wide enough to return `select *`, which is
-- the entire subscriber list. The fix is a `security definer` RPC that dedups
-- and inserts in one call and returns just that row — an app change as well as
-- a schema change, so it is not smuggled into a file whose job was to get the
-- existing schema under version control. Left as follow-up work.
-- ============================================================
