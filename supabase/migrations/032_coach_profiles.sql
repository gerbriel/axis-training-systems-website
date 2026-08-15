-- ============================================================
-- Axis Training Systems — 032: the roster, out of the bundle
-- ============================================================
--
-- `src/data/coaches.ts` is a hardcoded array of five people and it is the only
-- copy of the public roster there has ever been. Every word on the coaches
-- section, every bio paragraph, every price on a coach page, ships as
-- JavaScript. Changing "Head Coach & Founder" to "Head Coach" is a commit, a
-- review, a build and a deploy. Adding a sixth coach is the same. Hiding a coach
-- who has stopped taking athletes is the same, and until the deploy lands the
-- site is still selling their 1:1 slots. This table is that array, in the
-- database, editable from the admin portal.
--
-- WHAT DOES NOT MOVE, and this is the important half.
--
--   `Coach.email` stays in the file, because it is a CREDENTIAL. CoachAdmin.tsx
--   gates the per-coach portal on `session.user.email === coach.email`. If that
--   comparison ever read from a table an admin can edit, "manage staff" would
--   quietly become "grant yourself somebody else's portal". There is no email
--   column below and there must not be one.
--
--   Testimonials stay out too. They already have a home in
--   `public.coach_testimonials` (006), with a moderation status and a policy
--   that decides what shows. Duplicating them into a jsonb column here would
--   give the same quote two sources of truth and one of them no moderation.
--
--   `coach_routing` is untouched. It answers "which calendar does this booking
--   land on", which is routing, not display. A hidden coach still takes the
--   bookings already on their calendar, and still signs in.
--
-- So the file keeps identity and the table keeps presentation, and the client
-- merges the two. That merge is also the fallback: `Coaches.tsx` renders the
-- static array while this table is loading and if it never answers, so the
-- roster section cannot go blank because of a database outage.
--
-- WHY jsonb ARRAYS rather than child tables for bio, specialties, stats and
-- services. Because there is no query that asks about them. Nothing will ever
-- select the coaches who have a stat labelled "Squat PR", or sort by price.
-- These four are read whole, written whole, and rendered in the order they were
-- typed, which is exactly what a jsonb array is. Four child tables would buy
-- referential integrity nobody needs and cost the editor four round trips and a
-- diffing algorithm. The checks below assert the shape (`jsonb_typeof = array`)
-- so a malformed write is refused rather than rendered.
--
-- VISIBILITY IS PRESENTATION, NOT CONFIDENTIALITY. `is_visible = false` removes
-- a coach from the public roster and from their public page. It does not delete
-- them, does not revoke their sign-in, does not stop their existing bookings,
-- and does not hide the row from staff. Nothing in this table is private in the
-- first place: every visible row is anon-readable, which is the point of a
-- public roster. Do not put anything here that is not meant for the open web.
--
-- WHY THE OWN-ROW GUARD IS A TRIGGER. A coach may edit their own row: their
-- bio, their photo, their prices. They may NOT change its slug (that is the
-- public URL and the join key everything else matches on), its visibility, or
-- its position in the roster. A policy cannot express "unchanged from the old
-- row" (WITH CHECK sees only the new one), so this is the same clamp-in-a-
-- trigger shape 017 uses for `bookings.manage_token` and `profiles` privileges,
-- and it raises P0001 with a sentence the panel can print rather than letting
-- a policy refuse with "new row violates row-level security policy".
--
-- WHY THE PUBLIC POLICY IS `using (is_visible)` AND NOTHING ELSE. 028 learned
-- this the hard way: an anon-evaluated policy must not call `is_axis_admin()`
-- or `has_permission()`, because 017 revoked EXECUTE on both from `anon` and
-- the call fails before the row is ever considered. Every helper reference
-- below is inside a policy whose TO list is `authenticated` only.
--
-- THE SEED IS `on conflict (slug) do nothing`. Section 7 inserts the five
-- coaches as they stand in `data/coaches.ts` today, so the table is not empty on
-- the first deploy and the site looks identical the moment the components start
-- reading it. Re-running this file must never overwrite an edit somebody made
-- in the portal, which is the whole reason it is `do nothing` and not an upsert.
-- The seed copy is transcribed verbatim, punctuation included, because a diff
-- between the static fallback and the seeded row would show up on screen as a
-- flicker when the fetch lands.
--
-- Requires 011 (`is_axis_admin`), 016 (`is_axis_staff`, `has_permission`,
-- the `manage_staff` key) and 007/004 (`current_coach_slug`).
--
-- Re-runnable.
-- ============================================================


-- ── 1. Preconditions ────────────────────────────────────────────────────────
--
-- All four helpers are referenced from policies and from the guard trigger.
-- Failing here with a sentence beats failing at the first policy with
-- "function public.is_axis_staff() does not exist".

do $do$
begin
  if to_regprocedure('public.is_axis_admin()') is null
     or to_regprocedure('public.is_axis_staff()') is null
     or to_regprocedure('public.has_permission(text)') is null
     or to_regprocedure('public.current_coach_slug()') is null then
    raise exception
      'Run 011_identity.sql, 016_permissions.sql and 007_google_calendar_sync.sql before 032_coach_profiles.sql.'
      using errcode = '22023';
  end if;
end
$do$;


-- ── 2. The table ────────────────────────────────────────────────────────────
--
-- Column for column, this is `interface Coach` minus `email` and
-- `testimonials`, with `role` renamed `role_title` (a table with a `role`
-- column in this database means something else entirely) and
-- `coachingPhilosophy` renamed `philosophy`.
--
-- Every text limit is generous and stated. They exist so a paste accident is
-- refused at the door instead of becoming a page nobody can scroll past, not to
-- police how much anybody writes.
--
-- The three URL columns are 028's `cta_url` check with one correction: absolute
-- http(s), or a rooted path whose second character is not another slash.
--
-- 028 writes that check as `~* '^https?://|^/'` and its comment says a
-- protocol-relative `//host` "fails `^/` because the second char is not the
-- end". It does not. `^/` matches any string that begins with a slash,
-- `//evil.com` included, and the announcements table accepts one today.
-- Verified against a local Postgres; section 8 has the probe. `safeUrl`
-- (src/utils/sanitize.ts) refuses it on the client for exactly the reason 028
-- gives ("an absolute URL wearing a costume"), so the intent is not in doubt,
-- only the regex. `^/[^/]` is the version that does what both of them say.
-- A bare '/' is refused with it, which is correct: it is not a photo and it is
-- not a booking link.
--
-- ⚠ The same one-character fix belongs on `announcements.cta_url`. It is not
-- made here, because that column is not this file's to change.

create table if not exists public.coach_profiles (
  id            uuid primary key default gen_random_uuid(),
  -- The public URL (`/coach/<slug>`) and the key every other surface joins on:
  -- coach_routing, coach_testimonials, the static array. Immutable in practice,
  -- see the guard in section 4.
  slug          text        not null unique,
  name          text        not null,
  first_name    text,
  role_title    text,
  tagline       text,
  philosophy    text,
  -- Paragraphs, in order. `["para", "para"]`.
  bio           jsonb       not null default '[]'::jsonb,
  -- `["Full meet prep", ...]`.
  specialties   jsonb       not null default '[]'::jsonb,
  -- `[{"label": "Squat PR", "value": "600 lbs"}, ...]`.
  stats         jsonb       not null default '[]'::jsonb,
  -- `[{"name": "...", "price": "...", "description": "..."}, ...]`.
  services      jsonb       not null default '[]'::jsonb,
  photo_url     text,
  cta_bg_url    text,
  book_call_url text,
  is_visible    boolean     not null default true,
  sort_order    int         not null default 0,
  updated_at    timestamptz not null default now(),
  -- Stamped by the trigger from auth.uid(), in no client grant, so it records
  -- who last edited a row and cannot be forged into saying somebody else did.
  updated_by    uuid        references public.profiles (id) on delete set null,

  constraint coach_profiles_slug_shape check (
    slug ~ '^[a-z0-9-]+$'
  ),
  constraint coach_profiles_name_len check (
    btrim(name) <> '' and char_length(name) <= 120
  ),
  constraint coach_profiles_first_name_len check (
    first_name is null or char_length(first_name) <= 120
  ),
  constraint coach_profiles_role_title_len check (
    role_title is null or char_length(role_title) <= 120
  ),
  constraint coach_profiles_tagline_len check (
    tagline is null or char_length(tagline) <= 300
  ),
  constraint coach_profiles_philosophy_len check (
    philosophy is null or char_length(philosophy) <= 2000
  ),
  constraint coach_profiles_bio_shape check (
    jsonb_typeof(bio) = 'array'
  ),
  constraint coach_profiles_specialties_shape check (
    jsonb_typeof(specialties) = 'array'
  ),
  constraint coach_profiles_stats_shape check (
    jsonb_typeof(stats) = 'array'
  ),
  constraint coach_profiles_services_shape check (
    jsonb_typeof(services) = 'array'
  ),
  constraint coach_profiles_photo_url_shape check (
    photo_url is null or photo_url ~* '^https?://|^/[^/]'
  ),
  constraint coach_profiles_cta_bg_url_shape check (
    cta_bg_url is null or cta_bg_url ~* '^https?://|^/[^/]'
  ),
  constraint coach_profiles_book_call_url_shape check (
    book_call_url is null or book_call_url ~* '^https?://|^/[^/]'
  ),
  constraint coach_profiles_sort_order_sane check (
    sort_order >= 0 and sort_order <= 1000
  )
);

comment on table public.coach_profiles is
  'The public roster: how each coach appears on the site. Display copy only. '
  'Sign-in (data/coaches.ts email), booking routing (coach_routing) and '
  'testimonials (coach_testimonials) live elsewhere and are not affected by '
  'anything in this table.';

-- The public read is `order by sort_order, name` over the visible rows, which
-- is every request the roster section and the coach pages make. The unique
-- index on `slug` comes free with the constraint and serves the per-coach page.
create index if not exists coach_profiles_visible_order_idx
  on public.coach_profiles (is_visible, sort_order);


-- ── 3. Re-runnability for the columns above ─────────────────────────────────
--
-- `create table if not exists` is a no-op on the second run, which means a
-- column added to this file later would never appear on a database that already
-- has the table. Restating them as `add column if not exists` costs nothing on a
-- fresh install and is the difference between this file being re-runnable and
-- only looking it. Constraints are attached above rather than here because they
-- are all column-local and a fresh table gets them from the create.

alter table public.coach_profiles add column if not exists first_name    text;
alter table public.coach_profiles add column if not exists role_title    text;
alter table public.coach_profiles add column if not exists tagline       text;
alter table public.coach_profiles add column if not exists philosophy    text;
alter table public.coach_profiles add column if not exists bio           jsonb not null default '[]'::jsonb;
alter table public.coach_profiles add column if not exists specialties   jsonb not null default '[]'::jsonb;
alter table public.coach_profiles add column if not exists stats         jsonb not null default '[]'::jsonb;
alter table public.coach_profiles add column if not exists services      jsonb not null default '[]'::jsonb;
alter table public.coach_profiles add column if not exists photo_url     text;
alter table public.coach_profiles add column if not exists cta_bg_url    text;
alter table public.coach_profiles add column if not exists book_call_url text;
alter table public.coach_profiles add column if not exists is_visible    boolean not null default true;
alter table public.coach_profiles add column if not exists sort_order    int not null default 0;
alter table public.coach_profiles add column if not exists updated_at    timestamptz not null default now();
alter table public.coach_profiles add column if not exists updated_by    uuid references public.profiles (id) on delete set null;


-- ── 4. The two triggers ─────────────────────────────────────────────────────
--
-- They fire in name order, so the guard runs before the touch: `_guard_trg`
-- sorts before `_touch_trg`. That order does not actually matter here (the
-- touch writes two columns the guard does not read) but it is worth knowing
-- before anybody adds a third.
--
-- THE GUARD. Three columns are an admin's to set and nobody else's:
--
--   slug        the public URL and the join key. Renaming it breaks every link
--               anybody has ever shared and orphans the row from the static
--               array, from coach_routing and from coach_testimonials.
--   is_visible  whether Axis is currently selling this coach's services. That
--               is a business decision, not a self-service one.
--   sort_order  who appears first on the roster. Same reasoning, and it is a
--               zero-sum field: moving yourself up moves somebody else down.
--
-- Everything else on their own row is theirs. `auth.uid() is null` means there
-- is no end-user session at all, meaning a migration, the SQL editor or the
-- service role, and those are allowed through, exactly as 017's guards do it.

create or replace function public.coach_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No session: a migration, the SQL editor, or service_role. Section 7 runs
  -- here on a fresh install, and it sets all three of these columns.
  if auth.uid() is null then
    return new;
  end if;

  if public.is_axis_admin() or public.has_permission('manage_staff') then
    return new;
  end if;

  if new.slug       is distinct from old.slug
     or new.is_visible is distinct from old.is_visible
     or new.sort_order is distinct from old.sort_order then
    raise exception
      'Only an admin can change that field. You can edit the words and pictures on your own profile, but its address, whether it is shown, and where it sits in the roster are set by an admin.';
  end if;

  return new;
end $$;

comment on function public.coach_profiles_guard() is
  'Refuses a change to slug, is_visible or sort_order from anybody but an admin '
  'or a holder of manage_staff. A policy cannot say "unchanged from the old '
  'row", so this is a trigger.';

revoke all on function public.coach_profiles_guard() from public, anon, authenticated, service_role;

drop trigger if exists coach_profiles_guard_trg on public.coach_profiles;
create trigger coach_profiles_guard_trg
  before update on public.coach_profiles
  for each row execute function public.coach_profiles_guard();


-- THE TOUCH. `updated_at` on every write, and `updated_by` from the session
-- that made it. `coalesce(auth.uid(), new.updated_by)` rather than a bare
-- assignment so a migration or a service-role fix-up does not blank out the
-- name of the last person who actually edited the row. The client cannot supply
-- either column: neither is in the insert or update grant in section 6.

create or replace function public.coach_profiles_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

revoke all on function public.coach_profiles_touch() from public, anon, authenticated, service_role;

drop trigger if exists coach_profiles_touch_trg on public.coach_profiles;
create trigger coach_profiles_touch_trg
  before insert or update on public.coach_profiles
  for each row execute function public.coach_profiles_touch();


-- ── 5. RLS ──────────────────────────────────────────────────────────────────
--
-- Four policies, and they answer four different questions.
--
--   Anybody, signed in or not, reads the VISIBLE rows. That is the roster and
--   the coach pages, and it is the only policy anon ever evaluates, so it calls
--   nothing (see the header).
--
--   Staff read EVERY row, hidden ones included, because the manager lists them
--   all with a Hidden pill next to the ones that are off.
--
--   An admin, or a coach an admin has trusted with `manage_staff`, does
--   everything: insert, update, delete, and read.
--
--   A coach updates THEIR OWN row, matched on the slug their JWT resolves to.
--   The trigger in section 4 is what narrows that to the columns they own.

alter table public.coach_profiles enable row level security;

drop policy if exists "public reads visible coach profiles" on public.coach_profiles;
drop policy if exists "staff read all coach profiles"       on public.coach_profiles;
drop policy if exists "admins manage coach profiles"        on public.coach_profiles;
drop policy if exists "coaches edit their own profile"      on public.coach_profiles;

create policy "public reads visible coach profiles"
  on public.coach_profiles for select to anon, authenticated
  using (is_visible);

create policy "staff read all coach profiles"
  on public.coach_profiles for select to authenticated
  using (public.is_axis_staff());

create policy "admins manage coach profiles"
  on public.coach_profiles for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_staff'))
  with check (public.is_axis_admin() or public.has_permission('manage_staff'));

-- `current_coach_slug()` returns null for everybody who is not a coach in
-- `coach_routing`, and `slug = null` matches no row, so this policy is inert
-- for athletes without needing to say so.
create policy "coaches edit their own profile"
  on public.coach_profiles for update to authenticated
  using      (slug = public.current_coach_slug())
  with check (slug = public.current_coach_slug());


-- ── 6. Grants ───────────────────────────────────────────────────────────────
--
-- Supabase's default privileges still hand `anon` and `authenticated` full DML
-- on a new table (017 declined to revoke that by default, on the grounds that it
-- would silently break every future migration), so this is stated rather than
-- assumed. RLS decides the rows; these decide the columns.
--
-- `anon` gets a column list rather than the table, and `updated_by` is not on
-- it: a profile uuid is nothing a visitor needs and it is the one column here
-- that is about a person rather than about a page. `authenticated` gets plain
-- SELECT because the manager screen may want to show who last edited a row, and
-- because the same uuid is already reachable from a signed-in session through
-- messaging_profiles.
--
-- `updated_by` is in NEITHER write grant, along with `id` and `updated_at`: all
-- three are the database's to set, and section 4 sets them.

revoke all on public.coach_profiles from anon, authenticated;

grant  select (id, slug, name, first_name, role_title, tagline, philosophy,
               bio, specialties, stats, services,
               photo_url, cta_bg_url, book_call_url,
               is_visible, sort_order, updated_at)
       on public.coach_profiles to anon;

grant  select on public.coach_profiles to authenticated;

grant  insert (slug, name, first_name, role_title, tagline, philosophy,
               bio, specialties, stats, services,
               photo_url, cta_bg_url, book_call_url,
               is_visible, sort_order)
       on public.coach_profiles to authenticated;

grant  update (slug, name, first_name, role_title, tagline, philosophy,
               bio, specialties, stats, services,
               photo_url, cta_bg_url, book_call_url,
               is_visible, sort_order)
       on public.coach_profiles to authenticated;

grant  delete on public.coach_profiles to authenticated;


-- ── 7. Seed: the five coaches as they ship today ────────────────────────────
--
-- Transcribed from `src/data/coaches.ts`, verbatim, in the order that file
-- declares them (`sort_order` 0 to 4). `email` and `testimonials` are the two
-- fields deliberately not carried over; see the header.
--
-- `on conflict (slug) do nothing` is load-bearing. This file is re-runnable and
-- an admin will have edited these rows by the second run. Nothing here is an
-- upsert, and nothing here touches a row that already exists.

insert into public.coach_profiles
  (slug, name, first_name, role_title, tagline, philosophy,
   bio, specialties, stats, services,
   photo_url, cta_bg_url, book_call_url, is_visible, sort_order)
values
  (
    'ronnie-vallejo', 'Ronnie Vallejo', 'Ronnie', 'Head Coach & Founder',
    'Strength built on intention, not ego.',
    'Coaching is more than crunching numbers and critiquing form. We establish strong coach-athlete bonds that give the athlete a sense of intrinsic motivation.',
    jsonb_build_array(
      'Ronnie Vallejo is the founder of Axis Training Systems. He serves as Team USA Coach for Powerlifting America, Head Coach of Fresno State Powerlifting, and is an active Powerlifting America Referee — with a level of involvement in the sport that goes well beyond the gym.',
      'His coaching philosophy centers on building genuine coach-athlete relationships. He believes intrinsic motivation — the kind that comes from trust, transparency, and real investment in the athlete — is what drives every result worth earning.',
      'Axis was founded in 2021 on the belief that every athlete deserves the same standard of care, regardless of level, background, or personality type.'
    ),
    jsonb_build_array(
      'Full meet prep',
      'Attempt selection strategy',
      'Team USA & national-level coaching',
      'Coach mentorship & development'
    ),
    jsonb_build_array(
      jsonb_build_object('label', 'Years Competing',  'value', '10+'),
      jsonb_build_object('label', 'Athletes Coached', 'value', '50+'),
      jsonb_build_object('label', 'Squat PR',         'value', '600 lbs'),
      jsonb_build_object('label', 'Bench PR',         'value', '385 lbs'),
      jsonb_build_object('label', 'Deadlift PR',      'value', '650 lbs'),
      jsonb_build_object('label', 'Meets Attended',   'value', '20+')
    ),
    jsonb_build_array(
      jsonb_build_object(
        'name', '1:1 Coaching (Full Service)',
        'price', '$180/mo',
        'description', 'Weekly programming, daily check-ins via WhatsApp, video review, full meet prep, and attempt selection.'
      ),
      jsonb_build_object(
        'name', 'Meet Day Coaching',
        'price', 'Contact for pricing',
        'description', 'In-person or remote coaching on competition day — warm-up timing, attempt strategy, real-time feedback.'
      )
    ),
    'https://static.wixstatic.com/media/e99af3_1947a325134d4dff956eb3a7a6436e0e~mv2.jpg/v1/fill/w_432,h_434,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/20240302_201048_edited_edited_edited.jpg',
    'https://static.wixstatic.com/media/e99af3_78afea37a86d42b59c9a5885e5909905~mv2.jpg',
    'https://calendly.com/ronnie-axistrainingsystems',
    true, 0
  ),
  (
    'seth-burman', 'Seth Burman', 'Seth', 'Team Axis Coach',
    'Competitive fire, methodical preparation.',
    'A great meet performance is won in the prep, not on the platform. Prepare obsessively, compete confidently.',
    jsonb_build_array(
      'Seth Burman is a USAPL 100kg competitor with a Doctorate of Physical Therapy, a BS in Exercise Science, and the CSCS credential. His background spans clinical rehabilitation and strength science — a rare combination that lets him optimize performance while genuinely managing injury risk.',
      'He specializes in meet prep and game day coaching, with experience at national-level Powerlifting America and USAPL events.',
      'Seth brings discipline and calm to high-pressure situations — the qualities that matter most when it''s time to step on the platform.'
    ),
    jsonb_build_array(
      'Meet day logistics & attempt strategy',
      'DPT & physical therapy background',
      'Peaking and tapering',
      'National-level competition experience'
    ),
    jsonb_build_array(
      jsonb_build_object('label', 'Years Competing',  'value', '8'),
      jsonb_build_object('label', 'Athletes Coached', 'value', '40+'),
      jsonb_build_object('label', 'Squat PR',         'value', '545 lbs'),
      jsonb_build_object('label', 'Bench PR',         'value', '350 lbs'),
      jsonb_build_object('label', 'Deadlift PR',      'value', '600 lbs'),
      jsonb_build_object('label', 'Meets Attended',   'value', '15+')
    ),
    jsonb_build_array(
      jsonb_build_object(
        'name', '1:1 Coaching (Full Service)',
        'price', '$175/mo',
        'description', 'Weekly programming, WhatsApp coaching, video review, and full meet prep support.'
      ),
      jsonb_build_object(
        'name', 'Meet Day Coaching',
        'price', 'Contact for pricing',
        'description', 'On-site or remote presence at your competition — full warm-up protocol, attempt calls, handler duties.'
      )
    ),
    'https://static.wixstatic.com/media/e99af3_c6dd9c18b5374a038d9d94d95c94ccc2~mv2.jpg/v1/fill/w_432,h_434,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/IMG_6895%20(1).jpg',
    'https://static.wixstatic.com/media/c0cc37_22d0ada4e59a43e68d265f53b7ff6219~mv2.jpg',
    'https://calendly.com/ronnie-axistrainingsystems',
    true, 1
  ),
  (
    'lucas-sison', 'Lucas Sison', 'Lucas', 'Team Axis Coach',
    'Fix the movement, free the strength.',
    'You can''t maximize what you haven''t optimized. Movement quality is the ceiling on your strength.',
    jsonb_build_array(
      'Lucas Sison is a USAPL 75kg national-level competitor and holds a Doctorate of Pharmacy. His clinical background informs a rigorously evidence-based approach that treats the whole athlete — not just their numbers.',
      'His specialty is identifying and correcting the technical inefficiencies that act as a ceiling on strength. Whether that''s a hip position off the floor, bar path inconsistency, or a squat that breaks down under load — Lucas finds the root and addresses it.',
      'His athletes don''t just get stronger. They understand exactly why.'
    ),
    jsonb_build_array(
      'Technical analysis and correction',
      'USAPL 75kg national-level competitor',
      'Evidence-based programming (PharmD background)',
      'Intermediate to advanced development'
    ),
    jsonb_build_array(
      jsonb_build_object('label', 'Years in Sport',       'value', '9'),
      jsonb_build_object('label', 'Athletes Coached',     'value', '35+'),
      jsonb_build_object('label', 'Squat PR',             'value', '525 lbs'),
      jsonb_build_object('label', 'Bench PR',             'value', '315 lbs'),
      jsonb_build_object('label', 'Deadlift PR',          'value', '575 lbs'),
      jsonb_build_object('label', 'Movement Assessments', 'value', '100+')
    ),
    jsonb_build_array(
      jsonb_build_object(
        'name', '1:1 Coaching (Full Service)',
        'price', '$170/mo',
        'description', 'Weekly programming, WhatsApp coaching, detailed video analysis, and technical coaching focus.'
      ),
      jsonb_build_object(
        'name', 'Movement Coaching',
        'price', 'Contact for pricing',
        'description', 'Targeted analysis of your squat, bench, or deadlift with a corrective action plan — no long-term commitment required.'
      )
    ),
    'https://static.wixstatic.com/media/e99af3_c0aba7590f844eddaf80c5aa96fa99e4~mv2.jpg/v1/fill/w_432,h_434,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Screenshot_20220826-172606_Instagram_edited.jpg',
    'https://static.wixstatic.com/media/e99af3_8188e795483040e68ca52efc20c469ca~mv2.jpg',
    'https://calendly.com/ronnie-axistrainingsystems',
    true, 2
  ),
  (
    'kobe-pham', 'Kobe Pham', 'Kobe', 'Performance Coach',
    'Consistency compounds. Show up and do the work.',
    'Smart athletes train for decades, not cycles. Every decision I make is with the long game in mind.',
    jsonb_build_array(
      'Kobe Pham is a results-driven coach who excels at working with athletes who need structure, accountability, and a programming system that fits a demanding schedule. He has a particular talent for coaching athletes in physically demanding occupations — nurses, teachers, tradespeople — who need intelligent training, not just hard training.',
      'His programming philosophy centers on sustainability: building a body that can train hard for years, not weeks. He understands recovery, fatigue management, and how to get the most out of limited training time.',
      'Kobe is direct, detail-oriented, and deeply invested in his athletes'' progress. He believes no question is too small and that open communication is what separates good coaching from great coaching.'
    ),
    jsonb_build_array(
      'High-stress lifestyle adaptation',
      'Fatigue management',
      'Women''s powerlifting',
      'Beginner to intermediate development'
    ),
    jsonb_build_array(
      jsonb_build_object('label', 'Years Coaching',   'value', '6'),
      jsonb_build_object('label', 'Athletes Coached', 'value', '45+'),
      jsonb_build_object('label', 'Squat PR',         'value', '480 lbs'),
      jsonb_build_object('label', 'Bench PR',         'value', '295 lbs'),
      jsonb_build_object('label', 'Deadlift PR',      'value', '530 lbs'),
      jsonb_build_object('label', 'Female Athletes',  'value', '60%')
    ),
    jsonb_build_array(
      jsonb_build_object(
        'name', '1:1 Coaching (Full Service)',
        'price', '$165/mo',
        'description', 'Weekly programming, WhatsApp coaching, video review, and lifestyle-integrated training structure.'
      ),
      jsonb_build_object(
        'name', 'Movement Coaching',
        'price', 'Contact for pricing',
        'description', 'Targeted technique sessions for athletes who want focused coaching without a full program.'
      )
    ),
    'https://instagram.fsac1-2.fna.fbcdn.net/v/t51.82787-15/612966792_18038219582719560_4634281464013267619_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=103&ig_cache_key=MzgwNDM4OTc1NDc0MjY5NTUyMw%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuMTY2OS5zZHIucmVndWxhcl9waG90by5DMyJ9&_nc_ohc=DZQ9CydWePUQ7kNvwGfJAmR&_nc_oc=AdrN_uW7lR5z63vCEPrGBIZVDu-_zVs-UWTGGoPYQJHHo4ied_qn8To1JJUadL0XdTwv4XSEEN4wKd2NK0k52NTw&_nc_ad=z-m&_nc_cid=0&_nc_zt=23&_nc_ht=instagram.fsac1-2.fna&_nc_gid=2js1Ezqun08wK0n65x4XkA&_nc_ss=7a22e&oh=00_Af8dmkjx9765S3FbuKJEi_Cauix3mtjG9nAYdrrVupwZdA&oe=6A3E9EAD',
    'https://static.wixstatic.com/media/e99af3_33b79dddeb93448a8e7ddb66b45fd5aa~mv2.jpg',
    'https://calendly.com/ronnie-axistrainingsystems',
    true, 3
  ),
  (
    'aedan-nguyen', 'Aedan Nguyen', 'Aedan', 'Development Coach',
    'Every elite athlete was once a beginner. Start right.',
    'Teach the athlete, not just the movement. An athlete who understands their training will always outperform one who just follows it.',
    jsonb_build_array(
      'Aedan Nguyen specializes in developing new and early-intermediate powerlifters into confident, technically sound competitors. He is passionate about the learning curve of the sport and believes the first year of powerlifting training is the most important — and the most often mishandled.',
      'His approach is educational as much as it is physical: athletes leave each training block with a deeper understanding of their own movement, their programming rationale, and their place in the sport.',
      'Aedan competes actively himself, which keeps his coaching grounded in current competitive standards and real-world application.'
    ),
    jsonb_build_array(
      'New lifter development',
      'Technique fundamentals',
      'First meet preparation',
      'Educational coaching approach'
    ),
    jsonb_build_array(
      jsonb_build_object('label', 'Years Competing',      'value', '5'),
      jsonb_build_object('label', 'New Lifters Coached',  'value', '30+'),
      jsonb_build_object('label', 'Squat PR',             'value', '445 lbs'),
      jsonb_build_object('label', 'Bench PR',             'value', '275 lbs'),
      jsonb_build_object('label', 'Deadlift PR',          'value', '500 lbs'),
      jsonb_build_object('label', 'First-Meet Athletes',  'value', '25+')
    ),
    jsonb_build_array(
      jsonb_build_object(
        'name', '1:1 Coaching (Full Service)',
        'price', '$165/mo',
        'description', 'Weekly programming, WhatsApp coaching, video review, and heavy emphasis on educational development.'
      ),
      jsonb_build_object(
        'name', 'Meet Day Coaching',
        'price', 'Contact for pricing',
        'description', 'Competition day support for newer athletes who want an experienced voice in their corner.'
      )
    ),
    'https://instagram.fsac1-1.fna.fbcdn.net/v/t51.82787-15/612987658_18038926238719560_8601351049067518365_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=100&ig_cache_key=MzgwOTQ2MzUyODMxNDY1OTA3MQ%3D%3D.3-ccb7-5&ccb=7-5&_nc_sid=58cdad&efg=eyJ2ZW5jb2RlX3RhZyI6IkZFRUQueHBpZHMuMTA4MC5zZHIucmVndWxhcl9waG90by5DMyJ9&_nc_ohc=-xyB7SSPppcQ7kNvwH1zfB0&_nc_oc=AdrZ8gWCxMOfQNzfQjkvvZBMhPsIMci7_szT7XpMgnDuwA_gbNxyEESsxH_SmHR4VEqsGdGEw687KDsJSMWQ8v19&_nc_ad=z-m&_nc_cid=0&_nc_zt=23&_nc_ht=instagram.fsac1-1.fna&_nc_gid=1SfPPqlAnHOot5ksQaYlrQ&_nc_ss=7a22e&oh=00_Af_TuQUbB-scW5zCyWEtpzkhrbik4VHrpBR3wx6BK9g8pg&oe=6A3E8ADD',
    'https://static.wixstatic.com/media/e99af3_c7a9a45668c649ae84984977f3b7603a~mv2.jpg',
    'https://calendly.com/ronnie-axistrainingsystems',
    true, 4
  )
on conflict (slug) do nothing;


-- ── 8. Verify ───────────────────────────────────────────────────────────────
--
-- Structure first. Five rows, in order, with the four jsonb columns populated:
--
--   select slug, sort_order, is_visible,
--          jsonb_array_length(bio)         as bio,
--          jsonb_array_length(specialties) as specialties,
--          jsonb_array_length(stats)       as stats,
--          jsonb_array_length(services)    as services
--     from public.coach_profiles order by sort_order;
--   -- 5 rows, sort_order 0..4, bio 3, specialties 4, stats 6, services 2
--
--   -- The shape checks refuse anything that is not an array:
--   insert into public.coach_profiles (slug, name, bio)
--   values ('probe', 'Probe', '"not an array"'::jsonb);        -- 23514
--   insert into public.coach_profiles (slug, name, photo_url)
--   values ('probe', 'Probe', 'javascript:alert(1)');          -- 23514
--   insert into public.coach_profiles (slug, name, photo_url)
--   values ('probe', 'Probe', '//evil.com');                   -- 23514, see section 2
--   insert into public.coach_profiles (slug, name, photo_url)
--   values ('probe', 'Probe', '/img/coach.jpg');               -- ok
--   -- and the same probe against the column this one was copied from, which
--   -- still takes it:
--   insert into public.announcements (title, cta_url)
--   values ('probe', '//evil.com');                            -- INSERT 1. A bug.
--   insert into public.coach_profiles (slug, name)
--   values ('Not A Slug', 'Probe');                            -- 23514
--   insert into public.coach_profiles (slug, name)
--   values ('ronnie-vallejo', 'Duplicate');                    -- 23505
--
-- ANON. Reads the visible rows and only the display columns:
--
--   set role anon;
--   select count(*) from public.coach_profiles;                -- 5
--   select updated_by from public.coach_profiles limit 1;      -- 42501, not granted
--   insert into public.coach_profiles (slug, name) values ('x', 'X');  -- 42501
--   update public.coach_profiles set name = 'X';                       -- 42501
--   reset role;
--
--   -- and a hidden coach disappears from the public read:
--   update public.coach_profiles set is_visible = false where slug = 'kobe-pham';
--   set role anon;
--   select count(*) from public.coach_profiles;                -- 4
--   reset role;
--
-- AN ATHLETE. Sees the same five rows as anon and cannot write one of them:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete uuid>';
--     select count(*) from public.coach_profiles;              -- the visible ones
--     update public.coach_profiles set tagline = 'mine' where slug = 'ronnie-vallejo';
--     -- UPDATE 0 (no policy admits them; RLS filters rather than raising)
--     insert into public.coach_profiles (slug, name) values ('me', 'Me');
--     -- ERROR: new row violates row-level security policy
--   rollback;
--
-- A COACH, on their own row. The words are theirs, the three admin columns are
-- not. `request.jwt.claim.email` is what current_coach_slug() resolves:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub   = '<seth uuid>';
--     set local request.jwt.claim.email = 'seth@axistrainingsystems.com';
--     select public.current_coach_slug();                      -- seth-burman
--     update public.coach_profiles set tagline = 'Prepared, not lucky.'
--      where slug = 'seth-burman';                             -- UPDATE 1
--     select updated_by = '<seth uuid>' from public.coach_profiles
--      where slug = 'seth-burman';                             -- t, stamped by the trigger
--
--     update public.coach_profiles set is_visible = false where slug = 'seth-burman';
--     -- ERROR (P0001): Only an admin can change that field. ...
--     update public.coach_profiles set sort_order = 0 where slug = 'seth-burman';
--     -- ERROR (P0001): Only an admin can change that field. ...
--     update public.coach_profiles set slug = 'seth' where slug = 'seth-burman';
--     -- ERROR (P0001): Only an admin can change that field. ...
--
--     -- and somebody else's row is not theirs at all:
--     update public.coach_profiles set tagline = 'nope' where slug = 'lucas-sison';
--     -- UPDATE 0
--     delete from public.coach_profiles where slug = 'seth-burman';
--     -- DELETE 0
--   rollback;
--
-- AN ADMIN. Everything, including the three guarded columns:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<admin uuid>';
--     select count(*) from public.coach_profiles;              -- 5, hidden included
--     update public.coach_profiles set is_visible = false, sort_order = 9
--      where slug = 'kobe-pham';                               -- UPDATE 1
--     insert into public.coach_profiles (slug, name, sort_order)
--     values ('new-coach', 'New Coach', 5);                    -- INSERT 1
--     delete from public.coach_profiles where slug = 'new-coach';  -- DELETE 1
--   rollback;
--
-- A COACH HOLDING manage_staff behaves as the admin above; that is the same
-- `is_axis_admin() or has_permission(...)` tier 018/028 established.
--
-- Re-runnability, last. Running this file twice must leave the edits alone:
--
--   update public.coach_profiles set tagline = 'edited' where slug = 'ronnie-vallejo';
--   \i supabase/migrations/032_coach_profiles.sql
--   select tagline from public.coach_profiles where slug = 'ronnie-vallejo';  -- 'edited'
--   select count(*) from public.coach_profiles;                               -- still 5
-- ============================================================
