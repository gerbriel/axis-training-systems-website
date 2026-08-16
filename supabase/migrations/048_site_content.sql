-- ============================================================
-- Axis Training Systems — 048: the site's own words, as data
-- ============================================================
--
-- Every headline on the public site is compiled into the bundle. The hero says
-- AXIS TRAINING., the philosophy section tells the 2021 founding story, four
-- service cards describe four tracks, and none of it exists anywhere but in a
-- React file. Changing a word is a developer, a build and a deploy.
--
-- 041 did this for the resources library and proved the shape works: the code
-- keeps its own copy as the shipped default, a row OVERRIDES it, and putting
-- the original back is deleting the row rather than rewriting it. This table is
-- that idea applied to the marketing copy itself, and it is the half the owner
-- meant by "anything hardcoded". The other half of his sentence — "stuff that
-- gets pushed into the database too" — needs no new table at all: blog posts,
-- coach profiles, testimonials and meets already have tables, libraries and
-- policies, and the edit bar reuses those. Sections 5 and 6 below repair the
-- two of them whose permission gates were never actually wired up.
--
-- FOUR DECISIONS, STATED HERE RATHER THAN DISCOVERED LATER:
--
--   1. THIS IS THE FIRST ADOPTION OF `manage_content` ANYWHERE. The key is
--      registered at 016_permissions.sql:725 and granted to the coach role by
--      default at 016:762, but
--          grep -rn "has_permission('manage_content')" supabase/migrations
--      returned nothing before this file. Until now it has authorized exactly
--      nothing: it hid the Meet Listings tab and granted no write behind it.
--      Adopting it here hands every coach the homepage headline on the day this
--      runs. That is what was asked for, and it is a real widening, so it is
--      written down. If it is too wide, the alternative is a new key with no
--      role default granted per person — one row in `public.permissions`, one
--      entry in src/lib/userManagement.ts, and this file's policy predicate.
--
--   2. THIS TABLE SHIPS EMPTY, and that is a deliberate departure from 041,
--      which seeded eleven rows. A resource row carries IDENTITY — kind, slug,
--      builtin_key — and has to exist before anybody can edit it. A copy block
--      carries only a REPLACEMENT. The words are already on the page; the row
--      exists solely to say "not those words, these". So absence is a complete
--      and correct answer, and there is nothing to seed.
--
--   3. DELETE IS THE UNDO. This is the exact inversion of 041 section 3, which
--      needed a BEFORE DELETE trigger because deleting a built-in orphaned a
--      live route. Here, deleting a row restores the shipped copy, which is the
--      one thing an owner most needs to be able to do after a bad edit. No
--      delete guard, by design: the destructive act on this table is UPDATE,
--      and the reversible one is DELETE.
--
--   4. EM DASHES. The house rule bans them in user-facing copy, and several of
--      the shipped strings had them (four in Services, three in How It Works,
--      one in the founder attribution). They are rewritten in the code registry
--      — src/lib/siteContent.ts — in the same commit as this file, with periods,
--      commas and colons. Nothing is seeded here, so a stored row can never
--      disagree with a code constant about what "the original" says.
--
-- Re-runnable: create-if-not-exists, drop-then-create policies and triggers,
-- create-or-replace functions, do-update permission seed, no content seed.
-- ============================================================


-- ── 1. The table ────────────────────────────────────────────────────────────
--
-- One row per BLOCK: a named slot in the page that holds one editable thing.
-- The block id is the primary key, which is what makes every write an upsert on
-- a natural key and every restore a single-row delete. There is no surrogate
-- uuid, because nothing references a row here and the id an owner sees in the
-- editor should be the id in the table.
--
-- `value` is jsonb rather than text because a block is not always a string. The
-- registry in src/lib/siteContent.ts describes six kinds:
--
--     text       "Powerlifting Coaching"                 a single line
--     paragraph  "Founded in 2021, Axis Training …"      a block of prose
--     list       ["Solution Focused", "Evidence Based"]  fixed-length strings
--     items      [{"title":"…","desc":"…"}, …]           fixed-length records
--     image      {"src":"https://…","alt":"…"}
--     link       {"label":"Linktree","href":"https://…"}
--
-- so a scalar, an array and an object are all legitimate stored values and the
-- `jsonb_typeof(value) = 'object'` check 041 puts on `config` would be wrong
-- here. What IS refused is the JSON null literal: "no override" is already
-- spelled by having no row, and a row holding null would be a second way to say
-- the same thing that every reader would have to remember to handle.
--
-- THERE IS DELIBERATELY NO `check (block in (...))`. That is the 019
-- site_settings trap: `site_settings_key_known` closes the key space in a table
-- constraint, so every new setting needs a migration to drop and recreate it,
-- and until then an insert fails with a bare 23514 that says nothing useful.
-- The vocabulary of blocks belongs to the BUNDLE, not to the database: adding a
-- new editable headline should be a line in the registry, not a migration. A
-- row whose block id is not in the registry is simply never read — section 8
-- lists them so an operator can clear them out after a redesign.

create table if not exists public.site_content (
  block       text primary key,
  value       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,

  -- Lowercase, dot-separated, hyphens inside a segment: 'hero.headline-1',
  -- 'how-it-works.steps'. The same shape src/lib/siteContent.ts enforces as
  -- BLOCK_ID_SHAPE, so a typo is refused at the door rather than stored as a
  -- row nothing will ever read.
  constraint site_content_block_shape
    check (block ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'),
  constraint site_content_block_length
    check (length(block) between 1 and 120)
);

-- No index. The public read is "every row", unfiltered, over a table that will
-- hold a few dozen rows at most: the whole point is that a block with no row
-- costs nothing, so this only ever contains the copy somebody actually changed.
-- The primary key covers the per-block upsert and delete.


-- ── 2. Touch trigger ────────────────────────────────────────────────────────
--
-- Copied from 041 section 2, which is the corrected form of this shape. Do NOT
-- copy 019's version: it shipped without `set search_path = ''` and without the
-- revoke/grant pair, and 034 had to retrofit both (034:330 and 034:423).
--
-- updated_by is coalesced so a service-role write, where auth.uid() is null,
-- leaves the last human author in place rather than blanking the attribution.
-- On a table whose whole purpose is "somebody changed the words on the site",
-- who changed them is most of the value of the row.

create or replace function public.site_content_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

revoke all on function public.site_content_touch() from public, anon;
grant  execute on function public.site_content_touch() to authenticated, service_role;

drop trigger if exists site_content_touch_trg on public.site_content;
create trigger site_content_touch_trg
  before insert or update on public.site_content
  for each row execute function public.site_content_touch();


-- ── 3. Size guard ───────────────────────────────────────────────────────────
--
-- A trigger rather than a CHECK constraint, for one reason: a CHECK failure
-- reads "new row for relation "site_content" violates check constraint
-- "site_content_value_size"", which tells the person who pasted three chapters
-- of a book into a headline box nothing about what to do. A trigger can raise a
-- sentence, and errcode 22023 is the code src/lib/siteContent.ts (and
-- resourceLibrary.ts:167 before it) reads to mean "this message is already
-- written for a person, show it as it stands".
--
-- 64 KB is deliberately far above anything the editor will ever send: the
-- client refuses at 16 KB per block, which is itself eight times the longest
-- shipped block. The two numbers are not a mistake. The client cap is the
-- courtesy, this one is the boundary, and the gap is the room a future block
-- kind needs before somebody has to write another migration.
--
-- This also refuses the JSON null literal and SQL NULL, per section 1: an empty
-- row is a second spelling of "no override", and the first spelling is having
-- no row. The message says so, because "put the original back" is the thing the
-- person is usually trying to do when they reach for an empty value.

create or replace function public.site_content_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  bytes integer;
begin
  if new.value is null or jsonb_typeof(new.value) = 'null' then
    raise exception
      'A block has to hold something. To put the original copy back, delete the row for "%" instead of storing an empty one.',
      new.block
      using errcode = '22023';
  end if;

  bytes := octet_length(new.value::text);
  if bytes > 65536 then
    raise exception
      'There is too much text in "%" to save: % characters, and one block holds 65536. Shorten it, or spread it across the blocks the page already has.',
      new.block, bytes
      using errcode = '22023';
  end if;

  return new;
end $$;

revoke all on function public.site_content_guard() from public, anon;
grant  execute on function public.site_content_guard() to authenticated, service_role;

drop trigger if exists site_content_guard_trg on public.site_content;
create trigger site_content_guard_trg
  before insert or update on public.site_content
  for each row execute function public.site_content_guard();


-- ── 4. RLS and grants ───────────────────────────────────────────────────────
--
-- READ IS PUBLIC AND UNCONDITIONAL, `using (true)`, calling NO helper. This is
-- the 042_calculator_settings.sql:171-173 shape rather than 041's split read,
-- for two reasons. The first is correctness: anon may not execute
-- is_axis_admin() or has_permission() (revoked in 011/016, swept in 017 F1), so
-- a single policy that OR-ed one in would raise "permission denied for
-- function" on every anonymous page load of the homepage. The second is that
-- there is nothing to hide: every row in this table is text that is already
-- printed on a public page. A staff-only read policy would be guarding the
-- hero headline from the people reading the hero headline.
--
-- WRITE is admin, or a coach the admin has trusted with `manage_content`. See
-- decision 1 in the header: this is that key's first adoption anywhere, and it
-- is a coach role default from 016:762.
--
-- Grants are the second, separate gate, and anon gets a COLUMN LIST rather than
-- the table (the 041:216-229 idiom). created_at and updated_by stay off it, so
-- a logged-out `select('*')` is a permission error rather than a quiet leak of
-- which coach last rewrote the hero. 035's header records this exact trap
-- biting twice in the other direction: a column added later and NOT named in
-- the anon grant does not read as null, it 403s the entire request. If a column
-- is ever added here, this grant and the COLUMNS constant in
-- src/lib/siteContent.ts change in the same commit.
--
-- Writes address the row by its primary key, which is in the anon list, so
-- nothing needs a hidden column to find the row it is updating.

alter table public.site_content enable row level security;

drop policy if exists "public reads site content"      on public.site_content;
drop policy if exists "manage_content writes site content" on public.site_content;

create policy "public reads site content"
  on public.site_content for select to anon, authenticated
  using (true);

create policy "manage_content writes site content"
  on public.site_content for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_content'))
  with check (public.is_axis_admin() or public.has_permission('manage_content'));

revoke all on public.site_content from anon, authenticated;

grant select (block, value, updated_at) on public.site_content to anon;
grant select, insert, update, delete on public.site_content to authenticated;


-- ── 5. Repair: moderators cannot actually write testimonials ────────────────
--
-- A PRE-EXISTING DEFECT, not something this feature introduces. It is repaired
-- here because the edit bar offers a testimonial to anybody holding
-- `moderate_testimonials`, and a bar whose save silently does nothing is worse
-- than no bar at all.
--
-- 018:87-112 rewrote guard_testimonial_main_status() to accept
--     public.is_content_admin() or public.has_permission('moderate_testimonials')
-- so the TRIGGER has admitted moderators since then. No migration ever added a
-- POLICY admitting that key. The write policies on coach_testimonials are still
-- 006's "admin writes testimonials" (is_content_admin) and the two coach
-- own-row policies at 006:151-175. So a non-admin moderator's UPDATE on
-- somebody else's testimonial matches no policy and changes ZERO ROWS — and
-- because testimonialsApi.reviewTestimonial does not append .select(),
-- PostgREST answers 204 and the panel reports success over a write that did
-- nothing. 018's own verify block claims that update succeeds. It does not.
--
-- One FOR ALL policy, the same predicate in USING and WITH CHECK, beside the
-- policies that already exist rather than replacing them: 006's coach own-row
-- policies are what let a coach submit and edit their own, and this adds the
-- moderator who reviews everybody's. The trigger still decides what main_status
-- transitions are allowed; this only decides whose rows are reachable at all.

drop policy if exists "moderators write testimonials" on public.coach_testimonials;

create policy "moderators write testimonials"
  on public.coach_testimonials for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('moderate_testimonials'))
  with check (public.is_axis_admin() or public.has_permission('moderate_testimonials'));


-- ── 6. Repair: the Meet Listings tab gates on a key no policy adopts ────────
--
-- The other half of the same defect. AdminPortal.tsx gates the meets tab (TAB_KEYS.meets) on
-- ['manage_content'], and until section 4 of this file no policy anywhere read
-- that key. Meets are rows in public.pending_content (004) discriminated by
-- `type = 'meet'`, whose write policies are 040:157's "manage_blog manages every
-- submission" plus 004's admin and coach-own-row policies. So a coach holding
-- manage_content sees the tab, opens the panel, types a meet, saves, and RLS
-- refuses every write unless they ALSO happen to hold manage_blog.
--
-- Adopted NARROWLY, for the rows the tab already claims and no others. A meet
-- listing is a date and a venue; a blog post is an article with a slug that
-- becomes a public URL. `manage_content` is a coach role default and
-- `manage_blog` is not, so widening this to every row in pending_content would
-- hand every coach the blog through the back door. The `type = 'meet'` clause
-- appears in both USING and WITH CHECK so a manage_content holder can neither
-- reach a blog row nor turn a meet row into one by updating its type.

drop policy if exists "manage_content writes meets" on public.pending_content;

create policy "manage_content writes meets"
  on public.pending_content for all to authenticated
  using      (public.is_axis_admin()
              or (type = 'meet' and public.has_permission('manage_content')))
  with check (public.is_axis_admin()
              or (type = 'meet' and public.has_permission('manage_content')));


-- ── 7. Catalogue repair ─────────────────────────────────────────────────────
--
-- `manage_content` has been in the catalogue since 016 and is already a coach
-- default, so nothing is granted here and role_permissions is left alone. What
-- changes is the DESCRIPTION: it said "Public copy, programme pages and the
-- media library", describing an intention. As of this file it describes a fact,
-- and the fact is wider than the old sentence implied, so the row says what it
-- now actually opens.
--
-- The 040:70-109 idiom: `on conflict (key) do update`, so a re-run repairs a
-- hand-edited label, unlike the CONTENT seeds elsewhere in this repo which are
-- `do nothing` because after ship the copy belongs to the owner. A permission's
-- label is ours; a headline is not.

insert into public.permissions (key, label, description, is_sensitive) values
  ('manage_content', 'Edit the site',
   'Edit the words on the public site in place, and manage the meet listings. '
   'Does not include the blog, the coach roster or the resource library, which '
   'have keys of their own.', false)
on conflict (key) do update
  set label        = excluded.label,
      description  = excluded.description,
      is_sensitive = excluded.is_sensitive;


-- ── 8. Verify ───────────────────────────────────────────────────────────────
--
-- The table ships empty, and empty is the shipped site:
--
--   select count(*) from public.site_content;                          -- 0
--
-- anon reads the granted columns and only those, and writes nothing. Run each
-- of these AS THE ROLE, not as the table owner, or RLS is bypassed and every
-- one of them passes for the wrong reason:
--
--   insert into public.site_content (block, value)
--     values ('hero.eyebrow', '"Powerlifting Coaching"'::jsonb);
--   set role anon;
--   select block, value, updated_at from public.site_content;          -- ok, 1 row
--   select * from public.site_content;                                 -- permission denied
--   select updated_by from public.site_content;                        -- permission denied
--   update public.site_content set value = '"nope"'::jsonb
--    where block = 'hero.eyebrow';                                     -- 0 rows (RLS)
--   delete from public.site_content;                                   -- 0 rows (RLS)
--   reset role;
--
-- The shape constraints hold:
--
--   insert into public.site_content (block, value)
--     values ('Hero.Eyebrow', '"x"'::jsonb);        -- site_content_block_shape (23514)
--   insert into public.site_content (block, value)
--     values ('-hero', '"x"'::jsonb);               -- site_content_block_shape (23514)
--
-- The guard refuses an empty value and an oversized one, with a sentence:
--
--   insert into public.site_content (block, value)
--     values ('hero.scroll-cue', 'null'::jsonb);
--     -- ERROR: A block has to hold something. To put the original copy back,
--     --        delete the row for "hero.scroll-cue" instead of storing an empty one.
--   insert into public.site_content (block, value)
--     values ('hero.headline-1', to_jsonb(repeat('x', 70000)));
--     -- ERROR: There is too much text in "hero.headline-1" to save: 70002
--     --        characters, and one block holds 65536. …
--
-- A scalar, an array and an object are all legitimate values:
--
--   insert into public.site_content (block, value) values
--     ('hero.headline-2', '"Training."'::jsonb),
--     ('hero.taglines',   '["Solution Focused","Evidence Based"]'::jsonb),
--     ('footer.linktree', '{"label":"Linktree","href":"https://linktr.ee/x"}'::jsonb)
--   on conflict (block) do update set value = excluded.value;
--
-- Attribution is recorded, and a delete is the undo:
--
--   select block, updated_by is not null from public.site_content;      -- true for a JWT write
--   delete from public.site_content where block = 'hero.eyebrow';       -- 1 row
--   select count(*) from public.site_content where block = 'hero.eyebrow';  -- 0
--
-- The permission actually works, run as the coach's JWT and not as the owner:
--
--   -- as a coach WITHOUT manage_content (an athlete-turned-coach, key revoked):
--   insert into public.site_content (block, value)
--     values ('hero.eyebrow', '"x"'::jsonb);                            -- 42501
--   -- as a coach WITH manage_content (the role default, so this is most coaches):
--   insert into public.site_content (block, value)
--     values ('hero.eyebrow', '"Powerlifting Coaching"'::jsonb);        -- 1 row
--
-- The two repairs are in place:
--
--   select polname from pg_policy
--    where polrelid = 'public.coach_testimonials'::regclass;
--     -- includes "moderators write testimonials"
--   select polname from pg_policy
--    where polrelid = 'public.pending_content'::regclass;
--     -- includes "manage_content writes meets"
--
--   -- as a coach holding manage_content and NOT manage_blog:
--   update public.pending_content set meet_note = 'x'
--    where type = 'meet' and status = 'approved';                       -- rows > 0
--   update public.pending_content set title = 'x' where type = 'blog';  -- 0 rows
--
-- Orphans, after a redesign removes a block from the registry. Nothing reads
-- these; this is the list to clear out. The id list mirrors the groups in
-- src/lib/siteContent.ts, so update it there and here together:
--
--   select block, updated_at from public.site_content
--    where split_part(block, '.', 1) not in
--      ('hero','philosophy','services','how-it-works','testimonials',
--       'coaches','tools','meets','footer')
--    order by block;
--
-- Re-runnable.
-- ============================================================
