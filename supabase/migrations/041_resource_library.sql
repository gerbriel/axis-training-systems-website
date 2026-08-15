-- ============================================================
-- Axis Training Systems — 041: the free resources & tools library
-- ============================================================
--
-- The "free stuff" on the site — five calculators under /tools and six guides
-- on /guides — has always been three hardcoded React arrays: TOOL_LIST in
-- ToolPage.tsx, GUIDES in GuidesPage.tsx, and a third copy (TABS) in the
-- homepage Tools strip. Renaming a tool meant a deploy. Taking a guide down
-- meant a deploy. Putting a new PDF in front of visitors meant a developer.
--
-- This table is the registry those arrays become. It holds the METADATA only:
-- what a card is called, what it says, what badge it wears, where it sits in
-- the order, whether it is live, and whether an email unlocks it. The five
-- calculators and six guides are still React components — the interactive part
-- of an RPE calculator is code, not content — so a built-in row names its
-- component in `builtin_key` and the page looks the component up by that name.
-- Everything around the component is now the owner's to edit.
--
-- The new kinds are the point of the exercise. `link`, `download` and `article`
-- have no component behind them: they are wholly content, created in the admin
-- portal, and they render from `config` alone. That is what makes this a
-- library rather than a settings screen for eleven fixed things.
--
-- THE ONE RULE THIS FILE ENFORCES IN THE DATABASE, not in the UI: a built-in
-- row cannot be deleted. Deleting the 'rpe' tool row does not delete the RPE
-- calculator; it orphans a route that is still in the bundle and still linked,
-- and no amount of re-running the seed brings back the copy the owner had
-- written on it (the seed is `do nothing`, deliberately — see below). So the
-- refusal is a BEFORE DELETE trigger with a sentence that says what to do
-- instead. Unpublishing is the reversible act; deleting a built-in is not an
-- act we have a story for.
--
--   Permission: `manage_resource_library`, seeded by 040. A key is inert until
--   a policy adopts it (016 says so at length); this file is its adoption. If
--   040 has not run, has_permission() answers false for an unknown key and the
--   policies simply admit admins only, so the order the two land in is safe.
--
--   requires_signup is SIGNAGE. The newsletter gate lives in localStorage
--   (`axis_newsletter_access`) and is enforced by the page, which is to say it
--   is enforced by nothing. This column records the owner's INTENT per item —
--   today the whole guides page is gated and one tool is — so the pages can
--   stop hardcoding which. A gated item's content is still public; if a future
--   resource holds something that must not leak, it needs a real policy, not
--   this boolean.
--
-- Re-runnable: create-if-not-exists, drop-then-create policies and triggers,
-- create-or-replace functions, do-nothing seeds.
-- ============================================================


-- ── 1. The table ────────────────────────────────────────────────────────────
--
-- One row per card the free-resources area shows, of any kind.
--
-- `slug` is unique PER KIND, not globally, because the two registries this
-- replaces were independent namespaces and both use 'rpe' and 'attempts': the
-- RPE Calculator (a tool, at /tools/rpe) and the RPE Guide for Beginners (a
-- guide, on /guides) are different things that were both always called rpe.
-- Collapsing them into one namespace would have meant renaming a live URL.
--
-- `builtin_key` names the React component a built-in row renders:
--     kind 'tool'  → 'rpe' | 'dots' | 'convert' | 'attempts' | 'rankings'
--     kind 'guide' → 'checklist' | 'attempts' | 'quiz' | 'rpe' | 'big3' | 'audit'
-- and is null for the three custom kinds, which have no component. It is
-- deliberately NOT a check constraint against that list: the list is the
-- bundle's, not the database's, and a new calculator should not need a
-- migration to be registered. An unknown key renders nothing, which the page
-- treats the same as an unpublished row.
--
-- `config` is the per-kind payload, validated client-side (resourceLibrary.ts)
-- because its shape is a rendering contract, not a data-integrity one:
--     tool, guide → {}                      (the component carries everything)
--     article     → { body: string }        markdown, rendered as text
--     link        → { url: string }         http(s) or a site-relative path
--     download    → { url: string, file_label: string }
-- Anything else in the object is carried but ignored, so a later kind can add
-- a field without a migration.

create table if not exists public.resource_library (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('tool', 'guide', 'link', 'download', 'article')),
  slug          text not null,
  builtin_key   text,
  title         text not null,
  description   text not null default '',
  -- The badge on the card ("Free Checklist", "Scored Quiz"). Null means no badge.
  tag           text,
  sort_order    integer not null default 0,
  is_published  boolean not null default true,
  requires_signup boolean not null default false,
  config        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null,

  constraint resource_library_kind_slug_key unique (kind, slug),
  -- The slug appears in a URL and is matched against a component key. Lowercase
  -- alphanumerics and hyphens, starting and ending with a character rather than
  -- a hyphen, so '-x', 'x-' and 'X Y' are refused at the door rather than in a
  -- router.
  constraint resource_library_slug_shape check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  constraint resource_library_title_not_blank check (length(btrim(title)) > 0),
  -- config is a jsonb OBJECT, never an array or a bare scalar. Every reader
  -- indexes into it by key; a stored `[]` would read as an empty object right
  -- up until something iterated it.
  constraint resource_library_config_is_object check (jsonb_typeof(config) = 'object')
);

-- The public read is always "the published rows of one kind, in order", which
-- is exactly this index. Partial, over the published rows only, because the
-- unpublished ones are only ever read by an admin listing everything.
create index if not exists resource_library_published_idx
  on public.resource_library (kind, sort_order, title)
  where is_published;


-- ── 2. Touch trigger ────────────────────────────────────────────────────────
--
-- Records when and by whom, the 029 `settings_touch_at_by` shape. Its own
-- function rather than a reuse of that one, so this table can be dropped and
-- rebuilt without a thought about what else hangs off a shared trigger.
-- updated_by is coalesced so a service-role write (auth.uid() is null) leaves
-- the last human author in place rather than blanking the attribution.

create or replace function public.resource_library_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

revoke all on function public.resource_library_touch() from public, anon;
grant  execute on function public.resource_library_touch() to authenticated, service_role;

drop trigger if exists resource_library_touch_trg on public.resource_library;
create trigger resource_library_touch_trg
  before insert or update on public.resource_library
  for each row execute function public.resource_library_touch();


-- ── 3. A built-in cannot be deleted ─────────────────────────────────────────
--
-- The header explains why this is a trigger and not a disabled button: the row
-- is the only editable half of a thing whose other half is compiled into the
-- bundle, and there is no undo. `unpublish it instead` is in the message
-- because a refusal that does not say what to do next is just an error.
--
-- errcode 22023 (invalid_parameter_value) matches 012's guards, and is what
-- the client's error translator reads to know it may show the raw sentence.
--
-- This fires for the service role too. That is intentional: a batch job with
-- the service key bypasses RLS but not a trigger, and "an edge function wiped
-- the tools" is precisely the accident worth being unable to have.

create or replace function public.resource_library_protect_builtin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.builtin_key is not null then
    raise exception
      'The % "%" is built into the site and cannot be deleted. Unpublish it instead and it stops showing.',
      old.kind, old.title
      using errcode = '22023';
  end if;
  return old;
end $$;

revoke all on function public.resource_library_protect_builtin() from public, anon;
grant  execute on function public.resource_library_protect_builtin() to authenticated, service_role;

drop trigger if exists resource_library_protect_builtin_trg on public.resource_library;
create trigger resource_library_protect_builtin_trg
  before delete on public.resource_library
  for each row execute function public.resource_library_protect_builtin();


-- ── 4. RLS ──────────────────────────────────────────────────────────────────
--
-- Read splits in two, the 029 locations idiom. The public policy is
-- `using (is_published)` and calls no helper, because anon may not execute
-- is_axis_admin() or has_permission() (revoked in 011/016) — a single policy
-- that OR-ed them in would raise "permission denied for function" on every
-- anonymous page load of /tools. The staff policy is the one that adds the
-- unpublished rows, and is the only one that touches the helpers.
--
-- Write is admin or manage_resource_library, on all four verbs. Note that the
-- delete verb being granted here does not make a built-in deletable: section 3
-- refuses that after RLS has already said yes.

alter table public.resource_library enable row level security;

drop policy if exists "public reads published resources" on public.resource_library;
drop policy if exists "staff read all resources"         on public.resource_library;
drop policy if exists "staff write resources"            on public.resource_library;

create policy "public reads published resources"
  on public.resource_library for select to anon, authenticated
  using (is_published);

create policy "staff read all resources"
  on public.resource_library for select to authenticated
  using (public.is_axis_admin() or public.has_permission('manage_resource_library'));

create policy "staff write resources"
  on public.resource_library for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_resource_library'))
  with check (public.is_axis_admin() or public.has_permission('manage_resource_library'));


-- ── 5. Grants ───────────────────────────────────────────────────────────────
--
-- Column grants for anon (the 009/025 idiom): the public page needs the card,
-- not the paperwork, so created_at and updated_by are not in the anon list and
-- a `select('*')` from a logged-out browser is a permission error rather than a
-- quiet leak of which staff member last touched what.

revoke all on public.resource_library from anon, authenticated;

grant select (id, kind, slug, builtin_key, title, description, tag,
              sort_order, is_published, requires_signup, config, updated_at)
  on public.resource_library to anon;

grant select, insert, update, delete on public.resource_library to authenticated;


-- ── 6. Seed: the eleven that already exist ──────────────────────────────────
--
-- Titles, descriptions, tags and order lifted from TOOL_LIST (ToolPage.tsx) and
-- GUIDES (GuidesPage.tsx) so the first render off this table is identical to
-- the last render off the arrays.
--
-- `on conflict do nothing`, NOT `do update`. Every other seed in this repo
-- restores its labels on a re-run because those labels are OURS. These are not:
-- the moment this ships, the title and description of a tool are the owner's
-- copy, edited in the portal. A `do update` would quietly revert their work the
-- next time somebody replayed the migrations, which is the one failure mode
-- this whole feature exists to remove.
--
-- Gating matches the site as it stands, not an ideal: exactly one tool (the
-- Attempt Planner) sits behind the newsletter form, and the guides page gates
-- ALL SIX at the page level, so all six carry requires_signup. The owner can
-- now change that per item without touching code, which is the point.

insert into public.resource_library
  (kind, slug, builtin_key, title, description, tag, sort_order, requires_signup) values
  ('tool', 'rpe', 'rpe', 'RPE Calculator',
   'Estimate your 1RM or get a prescribed working weight from any RPE and rep target.',
   null, 0, false),
  ('tool', 'dots', 'dots', 'Dots Score',
   'Calculate your Dots coefficient to compare performance across weight classes and sexes.',
   null, 10, false),
  ('tool', 'convert', 'convert', 'Weight Converter',
   'Instantly convert between lbs and kg for any weight or total.',
   null, 20, false),
  ('tool', 'attempts', 'attempts', 'Attempt Planner',
   'Plan your opener, second, and third attempts based on your training maxes and meet strategy.',
   null, 30, true),
  ('tool', 'rankings', 'rankings', 'View Rankings',
   'Browse 3M+ powerlifting results worldwide. Filter by federation, weight class, and gender.',
   null, 40, false),

  ('guide', 'checklist', 'checklist', 'Meet Day Checklist',
   'Warmup timing, attempt strategy, gear bag essentials: everything you need the night before and on the day.',
   'Free Checklist', 0, true),
  ('guide', 'attempts', 'attempts', 'Attempt Selection Calculator',
   'Enter your training maxes and get your opener, second, and third attempt recommendations based on proven percentages.',
   'Interactive Tool', 10, true),
  ('guide', 'quiz', 'quiz', '"Is Your Training Leaving Gains on the Table?" Quiz',
   '6 questions. Score your programming, volume management, recovery habits, and more. Get your tier and a clear picture of what to fix.',
   'Scored Quiz', 20, true),
  ('guide', 'rpe', 'rpe', 'RPE Guide for Beginners',
   'What RPE 6 to 10 actually means, how many reps each level implies, and how to calibrate your own effort accurately.',
   'Reference Guide', 30, true),
  ('guide', 'big3', 'big3', 'Beginner''s Guide to the Big Three',
   'Squat, bench, and deadlift cue breakdowns, phase-by-phase. Setup, execution, and the most common technical mistakes.',
   'Technical Guide', 40, true),
  ('guide', 'audit', 'audit', 'Audit Your Last Training Block',
   'Rate your last block across 6 programming dimensions. Score your structure, specificity, recovery management, and compliance.',
   'Scored Worksheet', 50, true)
on conflict (kind, slug) do nothing;


-- ── 7. Verify ───────────────────────────────────────────────────────────────
--
-- Eleven built-ins, five tools and six guides, seven of them gated:
--
--   select kind, count(*) from public.resource_library
--    where builtin_key is not null group by kind;        -- guide 6, tool 5
--   select count(*) from public.resource_library where requires_signup;   -- 7
--   select slug from public.resource_library where kind = 'tool' order by sort_order;
--                                            -- rpe, dots, convert, attempts, rankings
--
-- The two 'rpe' rows coexist because the unique key is (kind, slug):
--
--   select kind, slug from public.resource_library where slug = 'rpe';  -- 2 rows
--
-- anon sees the published rows and only the granted columns, and writes nothing:
--
--   update public.resource_library set is_published = false where slug = 'dots';
--   set role anon;
--   select count(*) from public.resource_library;             -- 10, not 11
--   select * from public.resource_library;                    -- permission denied
--   select updated_by from public.resource_library limit 1;   -- permission denied
--   insert into public.resource_library (kind, slug, title)
--     values ('link', 'x', 'X');                              -- denied
--   reset role;
--   update public.resource_library set is_published = true where slug = 'dots';
--
-- A coach granted the key may edit; one without it may not (run each as that
-- coach's JWT, not as the table owner, or RLS is bypassed and both pass):
--
--   -- as a coach holding manage_resource_library:
--   update public.resource_library set title = 'RPE Tool' where kind='tool' and slug='rpe';  -- 1 row
--   select count(*) from public.resource_library where not is_published;  -- can see hidden rows
--   -- as a coach without it:
--   update public.resource_library set title = 'nope' where kind='tool' and slug='rpe';      -- 0 rows
--
-- A built-in refuses to be deleted; a custom row does not:
--
--   delete from public.resource_library where kind = 'tool' and slug = 'rpe';
--     -- ERROR: The tool "RPE Calculator" is built into the site and cannot be
--     --        deleted. Unpublish it instead and it stops showing.
--   insert into public.resource_library (kind, slug, title, config)
--     values ('link', 'usapl-rules', 'USAPL Rulebook', '{"url":"https://usapl.com"}'::jsonb);
--   delete from public.resource_library where kind = 'link' and slug = 'usapl-rules';  -- 1 row
--
-- The shape constraints hold:
--
--   insert into public.resource_library (kind, slug, title) values ('tool', '-bad', 'X');   -- slug_shape
--   insert into public.resource_library (kind, slug, title) values ('podcast', 'x', 'X');   -- kind check
--   insert into public.resource_library (kind, slug, title, config)
--     values ('link', 'x', 'X', '[]'::jsonb);                                              -- config_is_object
-- ============================================================
