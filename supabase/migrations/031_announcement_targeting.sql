-- ============================================================
-- Axis Training Systems, 031: who an announcement is for
-- ============================================================
--
-- 028 gave the site one banner and asked one question of every row: is this
-- live right now. Everybody who loads the home page gets the same sentence.
-- This file adds the second question. Who is that sentence for.
--
-- Two columns answer it. `target_audience` is a small jsonb object, default
-- `{"type":"all"}`, naming the audience. `priority` is the tiebreak for the
-- moment when two rows are live at once and only one banner can be on screen.
--
--
-- READ THIS BEFORE YOU WRITE AN ANNOUNCEMENT.
--
-- Targeting here is PRESENTATION. It is not confidentiality, and it is not a
-- permission. 028's `announcements_public_read` policy is untouched by this
-- file: a live row is readable by anon, target_audience and all. A row
-- addressed to coaches is still fetched by a signed-out visitor's browser. The
-- client simply declines to render it, and anybody with a network tab reads the
-- text in full. So never put staff-only information in an announcement, or a
-- price that only one person should see, or anything about a named athlete.
-- That is what 030's newsletter is for: it is delivered per recipient and RLS
-- decides who may read it.
--
-- What targeting IS good for: showing the intake offer only to signed-out
-- visitors, welcoming accounts made in the last two weeks, telling returning
-- visitors about something the first-time reader would find confusing.
--
--
-- WHY THE BROWSER DECIDES AND NOT THE DATABASE.
--
-- 030 resolves `newsletters.audience` server side, inside send_newsletter(),
-- and that is right for a newsletter because sending is a write with a
-- recipient list. A banner is neither. It renders on public static pages where
-- the viewer usually has no session at all, and the anon role cannot call
-- is_axis_admin() or has_permission(): 011 and 016 revoked execute on those
-- helpers, and 017 hardened it further, so a policy that called them would fail
-- for exactly the visitors the banner exists to greet. One signal also never reaches
-- the database. "Returning visitor" is a timestamp in localStorage, written the
-- first time a browser sees the site, and no signed-out visitor has a row
-- anywhere to hold it.
--
-- So the row carries its audience and the client evaluates it, in
-- src/lib/announceTargeting.ts, which is a pure module with unit tests behind
-- it (tests/announcements.test.ts). An unknown audience type fails OPEN: a row
-- nobody can parse is shown to everybody rather than silently hidden, because a
-- banner that vanishes with no error is the harder bug to find.
--
--
-- THE GRANTS ARE THE WHOLE MIGRATION.
--
-- 028 grants COLUMNS, not tables. A new column on a column-granted table is
-- invisible to every reader and unwritable by every writer until it is named in
-- those lists. Section 3 re-issues all three of them in full. If the panel ever
-- reports "column announcements.target_audience does not exist", or a targeting
-- change saves and comes back as `{"type":"all"}`, section 3 is what to check.
-- Note the ordering rule that comes with it: 028 is the authority on those
-- lists, so re-running 028 AFTER this file drops the two new columns back out
-- of the grants. Run the chain in order.
--
-- Re-runnable.
-- ============================================================


-- ── 1. The two columns ──────────────────────────────────────────────────────
--
-- Both NOT NULL with a default, so every row 028 already holds becomes
-- `{"type":"all"}` at priority 0, which is exactly what those rows mean today.
-- Nothing about the current banner changes until somebody edits a row.
--
-- jsonb and not three flat columns (audience_type / audience_roles /
-- audience_days) because the shape differs per type: 'role' needs a list,
-- 'new_accounts' needs a number, 'all' needs nothing. Three columns would mean
-- two of them are NULL in every row and a check constraint per combination.

alter table public.announcements
  add column if not exists target_audience jsonb not null default '{"type":"all"}'::jsonb;

alter table public.announcements
  add column if not exists priority int not null default 0;

comment on column public.announcements.target_audience is
  'Client-side presentation targeting, e.g. {"type":"role","roles":["coach"]}. '
  'NOT confidentiality: every live row is anon-readable in full.';

comment on column public.announcements.priority is
  'Highest number wins when several announcements are live at once. Ties break '
  'on created_at, newest first.';


-- ── 2. The shape of target_audience ─────────────────────────────────────────
--
-- jsonb accepts anything, so the vocabulary is stated here rather than trusted
-- to the panel. Seven types, and only 'new_accounts' carries a required extra.
--
-- Written as a CASE and not a chain of ANDs on purpose. Postgres does not
-- promise left-to-right evaluation of AND, so `days ~ '^[0-9]+$' and
-- days::int between 1 and 365` may run the cast first and raise 22P02 on
-- `{"days":"soon"}` instead of the 23514 the writer should see. CASE does
-- promise the ordering, and the digit count is capped at three so the cast can
-- never overflow an int either.
--
-- `roles` is validated lightly: an array, if present. Which strings are in it
-- is the client's business, since an unknown role string simply matches nobody.
-- Membership is checked in one place, and that place is announceTargeting.ts.
--
-- `jsonb ? key` is the has-key operator. If a migration runner ever mistakes
-- that `?` for a bind placeholder, `jsonb_exists(target_audience, 'type')` is
-- the same test spelled as a function call.

alter table public.announcements
  drop constraint if exists announcements_audience_shape;

alter table public.announcements
  add constraint announcements_audience_shape check (
    case
      when jsonb_typeof(target_audience) <> 'object' then false
      when not (target_audience ? 'type')            then false
      when target_audience->>'type' not in (
        'all', 'anonymous', 'authenticated', 'role',
        'new_accounts', 'returning', 'returning_anonymous'
      ) then false
      when (target_audience ? 'roles')
       and jsonb_typeof(target_audience->'roles') <> 'array' then false
      when target_audience->>'type' = 'new_accounts' then
        case
          when (target_audience->>'days') ~ '^[0-9]{1,3}$'
            then (target_audience->>'days')::int between 1 and 365
          else false
        end
      else true
    end
  );


-- ── 3. The grants, re-issued in full ────────────────────────────────────────
--
-- The critical step. See the header: 028's grants are column lists, and these
-- are those same lists with the two new columns added. `created_by` stays out
-- of all three, unchanged from 028: the trigger stamps it from auth.uid() and a
-- client can neither read nor forge it.
--
-- No `revoke all` first, deliberately. 028's revoke set the baseline, a revoke
-- here would also drop the DELETE grant that section does not restate, and
-- granting a superset of an existing column list is idempotent on its own.

grant  select (id, title, body, kind, is_active, starts_at, ends_at,
               cta_label, cta_url, target_audience, priority,
               created_at, updated_at)
       on public.announcements to anon, authenticated;

grant  insert (title, body, kind, is_active, starts_at, ends_at,
               cta_label, cta_url, target_audience, priority)
       on public.announcements to authenticated;

grant  update (title, body, kind, is_active, starts_at, ends_at,
               cta_label, cta_url, target_audience, priority)
       on public.announcements to authenticated;


-- ── 4. The index the banner reads through ───────────────────────────────────
--
-- The public fetch is "the live set, best first", so the order is the index:
-- priority descending, then newest. Partial on is_active for the same reason
-- 028's announcements_live_idx is: the inactive rows are the panel's problem,
-- not the banner's, and they are the majority once the studio has been running
-- announcements for a year.

create index if not exists announcements_priority_idx
  on public.announcements (priority desc, created_at desc)
  where is_active;


-- ── 4b. A repair to 028's cta_url check ─────────────────────────────────────
--
-- 028's comment on cta_url promises that a protocol-relative `//host` fails
-- the check "because the second char is not the end". It does not: `//evil.com`
-- matches `^/` just fine, and only the client-side safeUrl() stands between a
-- stored protocol-relative URL and the banner. The intent was written down;
-- the regex missed it by one character class. `^/[^/]` requires a site-relative
-- path to be exactly one leading slash, plus the bare root `/$` for
-- completeness. Absolute http(s) is unchanged.
--
-- Existing rows: the table shipped in 028 with no seed, so in practice there
-- is nothing to violate. If a protocol-relative row was somehow written in the
-- window between 028 and this file, the ADD CONSTRAINT below will refuse to
-- run and name it, which is the correct outcome: that row is the attack this
-- check exists to stop.

alter table public.announcements
  drop constraint if exists announcements_cta_url_check;

alter table public.announcements
  drop constraint if exists announcements_cta_url_shape;

alter table public.announcements
  add constraint announcements_cta_url_shape check (
    cta_url is null or cta_url ~* '^https?://' or cta_url ~ '^/$|^/[^/]'
  );


-- ── 5. Verify ───────────────────────────────────────────────────────────────
--
-- The columns exist with the intended defaults:
--
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'announcements'
--      and column_name in ('target_audience', 'priority');        -- 2 rows, not null
--
-- The grants are the point of the file, so prove them. Expect target_audience
-- and priority under anon SELECT, and under authenticated INSERT and UPDATE:
--
--   select grantee, privilege_type, column_name
--     from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'announcements'
--      and column_name in ('target_audience', 'priority')
--    order by grantee, privilege_type;
--   -- anon: SELECT x2. authenticated: SELECT, INSERT, UPDATE x2 each.
--
-- Anon still reads a live row, now including its audience, and still cannot
-- reach created_by or write anything:
--
--   set role anon;
--   select id, target_audience, priority from public.announcements;  -- live rows only
--   select created_by from public.announcements limit 1;             -- denied
--   update public.announcements set priority = 99;                   -- denied
--   reset role;
--
-- The shape check, as an admin. Each of these is 23514:
--
--   insert into public.announcements (title, target_audience)
--     values ('x', '{"type":"vip"}');                       -- unknown type
--   insert into public.announcements (title, target_audience)
--     values ('x', '{"roles":["coach"]}');                  -- no type key
--   insert into public.announcements (title, target_audience)
--     values ('x', '"all"');                                -- not an object
--   insert into public.announcements (title, target_audience)
--     values ('x', '{"type":"new_accounts"}');              -- days missing
--   insert into public.announcements (title, target_audience)
--     values ('x', '{"type":"new_accounts","days":"soon"}'); -- days not a number
--   insert into public.announcements (title, target_audience)
--     values ('x', '{"type":"new_accounts","days":0}');     -- below 1
--   insert into public.announcements (title, target_audience)
--     values ('x', '{"type":"new_accounts","days":400}');   -- above 365
--   insert into public.announcements (title, target_audience)
--     values ('x', '{"type":"role","roles":"coach"}');      -- roles not an array
--
-- And each of these is accepted:
--
--   insert into public.announcements (title, target_audience, priority)
--     values ('x', '{"type":"all"}', 0);
--   insert into public.announcements (title, target_audience, priority)
--     values ('x', '{"type":"anonymous"}', 5);
--   insert into public.announcements (title, target_audience)
--     values ('x', '{"type":"role","roles":["coach","admin"]}');
--   insert into public.announcements (title, target_audience)
--     values ('x', '{"type":"new_accounts","days":14,"roles":["athlete"]}');
--   insert into public.announcements (title, target_audience)
--     values ('x', '{"type":"returning_anonymous"}');
--
-- The existing rows were not disturbed:
--
--   select count(*) from public.announcements
--    where target_audience = '{"type":"all"}'::jsonb and priority = 0;
--
-- Re-runnable.
-- ============================================================
