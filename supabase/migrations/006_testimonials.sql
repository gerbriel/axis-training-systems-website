-- ============================================================
-- Migration 006: Coach-Managed Testimonials
-- ============================================================
-- Depends on 004_pending_content.sql, which already added:
--   • coach_routing.coach_slug + coach_routing.is_admin
--   • public.current_coach_slug()   → auth.email() → coach slug
--   • public.is_content_admin()     → true for the head coach
-- This migration reuses those. It does not redefine them.
--
-- Moves testimonials out of the hardcoded array in src/data/coaches.ts and into
-- a table coaches can CRUD from their portal, with per-testimonial page
-- assignment:
--
--   • show_on_coach = true  → shows on /coaches/<slug>. The coach controls this
--                             outright; it publishes immediately.
--   • main_status           → controls the homepage. A coach can only ever
--                             REQUEST the main page ('pending'); only the head
--                             coach can move it to 'approved'.
--
-- Note is_content_admin() (not the migration-002 "email not in coach_routing"
-- rule) is what identifies the approver. Ronnie is Head Coach AND a coach, so he
-- is in coach_routing with is_admin = true; the old rule would lock him out.
-- ============================================================


-- ── 0. Fail loudly if the prerequisites aren't there ────────────────────────
do $$
begin
  if to_regprocedure('public.current_coach_slug()') is null
     or to_regprocedure('public.is_content_admin()') is null then
    raise exception
      'Missing current_coach_slug()/is_content_admin(). Run 004_pending_content.sql first.';
  end if;
end
$$;


-- ── 1. Table ────────────────────────────────────────────────────────────────

create table if not exists public.coach_testimonials (
  id             uuid primary key default gen_random_uuid(),

  coach_slug     text not null,
  coach_name     text not null,

  -- Visible content
  quote          text not null,
  athlete        text not null,
  result         text not null default '',
  photo          text,

  -- Page assignment
  show_on_coach  boolean not null default true,
  main_status    text not null default 'none'
                   check (main_status in ('none', 'pending', 'approved', 'rejected')),
  rejection_note text,

  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz
);

create index if not exists coach_testimonials_coach_slug_idx
  on public.coach_testimonials (coach_slug);

create index if not exists coach_testimonials_main_status_idx
  on public.coach_testimonials (main_status);


-- ── 2. The self-approval guard ──────────────────────────────────────────────
-- RLS alone is NOT enough. A policy of `using (coach_slug = current_coach_slug())`
-- lets a coach update any column of their OWN row — including main_status — via a
-- direct PostgREST call that never touches our UI. This trigger is what actually
-- enforces "only the head coach approves".

create or replace function public.guard_testimonial_main_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Migrations and service_role run with no end-user session. Let them through:
  -- there is no anon INSERT/UPDATE policy below, so nothing unauthenticated can
  -- reach this trigger through the API.
  if auth.uid() is null then
    return new;
  end if;

  -- Head coach may do anything.
  if public.is_content_admin() then
    return new;
  end if;

  -- A coach may only ever put a testimonial into 'none' or 'pending'.
  if new.main_status in ('approved', 'rejected')
     and coalesce(old.main_status, 'none') is distinct from new.main_status then
    raise exception 'Only the head coach can approve or reject a main-page testimonial';
  end if;

  -- Editing the visible copy of an already-approved homepage testimonial sends it
  -- back for re-review, so approved copy can't be swapped out after the fact.
  -- Skip this when the coach explicitly pulled it from the main page in the same
  -- edit (new.main_status = 'none'); their removal wins over the re-review.
  if tg_op = 'UPDATE'
     and old.main_status = 'approved'
     and new.main_status <> 'none'
     and (new.quote, new.athlete, new.result, coalesce(new.photo, ''))
         is distinct from (old.quote, old.athlete, old.result, coalesce(old.photo, '')) then
    new.main_status := 'pending';
    new.reviewed_at := null;
  end if;

  return new;
end
$$;

drop trigger if exists guard_testimonial_main_status on public.coach_testimonials;
create trigger guard_testimonial_main_status
  before insert or update on public.coach_testimonials
  for each row execute function public.guard_testimonial_main_status();


-- ── 3. Row Level Security ───────────────────────────────────────────────────

alter table public.coach_testimonials enable row level security;

-- Public site: visible if it's on its coach's page, or approved for the homepage.
drop policy if exists "anon reads visible testimonials" on public.coach_testimonials;
create policy "anon reads visible testimonials"
  on public.coach_testimonials for select to anon
  using (show_on_coach = true or main_status = 'approved');

-- Column-level: rejection_note is the head coach's PRIVATE feedback to a coach.
-- RLS is row-level, so without this an anon SELECT of a coach-page-visible row
-- would return that note (and it renders to the public). Revoke it from anon;
-- the public fetches in testimonialsApi select an explicit column list (PUBLIC_COLS)
-- that omits it. Coaches (authenticated) keep full column access on their own rows.
revoke select (rejection_note) on public.coach_testimonials from anon;

-- Coaches see their OWN rows; the head coach sees all via the admin policy below
-- (permissive policies OR together). This keeps one coach from reading another
-- coach's drafts and private decline notes.
drop policy if exists "auth reads all testimonials" on public.coach_testimonials;
drop policy if exists "coaches read own testimonials" on public.coach_testimonials;
create policy "coaches read own testimonials"
  on public.coach_testimonials for select to authenticated
  using (coach_slug = public.current_coach_slug());

-- Head coach: full write access.
drop policy if exists "admin writes testimonials" on public.coach_testimonials;
create policy "admin writes testimonials"
  on public.coach_testimonials for all to authenticated
  using (public.is_content_admin())
  with check (public.is_content_admin());

-- Coaches: own rows only. Combined with the trigger above, a coach can create,
-- edit and delete their own testimonials, but cannot approve one for the homepage
-- and cannot touch another coach's rows at all.
drop policy if exists "coaches insert own testimonials" on public.coach_testimonials;
create policy "coaches insert own testimonials"
  on public.coach_testimonials for insert to authenticated
  with check (coach_slug = public.current_coach_slug());

drop policy if exists "coaches update own testimonials" on public.coach_testimonials;
create policy "coaches update own testimonials"
  on public.coach_testimonials for update to authenticated
  using (coach_slug = public.current_coach_slug())
  with check (coach_slug = public.current_coach_slug());

drop policy if exists "coaches delete own testimonials" on public.coach_testimonials;
create policy "coaches delete own testimonials"
  on public.coach_testimonials for delete to authenticated
  using (coach_slug = public.current_coach_slug());


-- ── 4. Seed the 15 existing hardcoded testimonials ──────────────────────────
-- Generated from src/data/coaches.ts. All 15 keep showing on their coach page.
-- The 3 the homepage currently hardcodes (Isaiah Salazar, Dylan Quitoriano, Zack
-- Scott) are pre-approved for the main page, and their created_at values are
-- ordered so the homepage's new "newest first" sort reproduces exactly the order
-- shown today. Guarded so re-running this file can't duplicate the seed.

do $$
begin
  if exists (select 1 from public.coach_testimonials limit 1) then
    raise notice 'coach_testimonials already seeded — skipping.';
    return;
  end if;

  insert into public.coach_testimonials
    (coach_slug, coach_name, quote, athlete, result, photo, show_on_coach, main_status, created_at)
  values
    ('ronnie-vallejo', 'Ronnie Vallejo', 'My total before I met him was about 600, it''s now at 1040 in less than a year — Ronnie added 400+ lbs in 7 months. Not only is he a great coach, he''s a great athlete, motivator, and he''s created a family through what he does. He''s led me to be 7th in the nation for my class.', 'Isaiah Salazar', '+400+ lbs total in 7 months · 7th in the nation', 'https://static.wixstatic.com/media/e99af3_2b17679f70a445c1b3d3f497a6eed428~mv2.jpg', true, 'approved', '2026-01-10T00:00:00.000Z'::timestamptz),
    ('ronnie-vallejo', 'Ronnie Vallejo', 'I immensely appreciate the excellent communication, knowledgeable and specific feedback I receive on my lift videos, the constant upbeat and positive encouraging attitude that Ronnie exudes out as he shares his passion of coaching. I am a stronger, smarter, and more prepared lifter as a result.', 'Zack Scott', '3 competitions coached & handled · national meet prep', 'https://static.wixstatic.com/media/e99af3_0d512540dd3b4d1d8084bbba566931e2~mv2.jpeg', true, 'approved', '2026-01-09T00:00:00.000Z'::timestamptz),
    ('ronnie-vallejo', 'Ronnie Vallejo', 'As an athlete, I have learned small details to become a better powerlifter overall, but as a coach myself, having Ronnie as my coach was invaluable. Since working with Ronnie, I have grown leaps and bounds as a coach. Of any coach I''ve ever personally met, Ronnie demonstrates the same characteristics I hold dear — knowledge, soft skills, genuine care, and personal investment.', 'Michelle Madruga', 'Competitive powerlifter & coach', 'https://static.wixstatic.com/media/e99af3_cc35fd3c63fc473191f2a3b7385d4bd3~mv2.jpg', true, 'none', '2026-01-08T00:00:00.000Z'::timestamptz),
    ('seth-burman', 'Seth Burman', 'Seth called every single attempt perfectly at my first meet. I went 8/9 and hit a 20lb PR on my total. Could not have done it without him in my corner.', 'Jordan T.', '8/9 at USPA debut, 83kg', null, true, 'none', '2026-01-10T01:00:00.000Z'::timestamptz),
    ('seth-burman', 'Seth Burman', 'I was a nervous wreck before the meet. Seth kept me grounded and made sure my warm-ups were perfect. Best investment I''ve made in this sport.', 'Camille B.', 'State record attempt, 69kg', null, true, 'none', '2026-01-09T01:00:00.000Z'::timestamptz),
    ('seth-burman', 'Seth Burman', 'The peaking cycle he wrote got me to the meet feeling the best I ever have. Opener felt like a warm-up.', 'Tyler N.', '1,200lb total at 83kg', null, true, 'none', '2026-01-08T01:00:00.000Z'::timestamptz),
    ('lucas-sison', 'Lucas Sison', 'I have been working with Lucas for over a year now and on my first training block with him I was able to gain +115lb to my gym total. Under his wing, I was able to gain +49lb meet total and place 2nd in my division. Lucas isn''t just a coach — he is also a student of the sport and seeks out knowledge of others in the field.', 'Lex Funtila', '+115 lb gym total · +49 lb meet total · 2nd place', 'https://static.wixstatic.com/media/e99af3_7dd394887fc14c8e971368b4cafc90ee~mv2.jpg', true, 'none', '2026-01-10T02:00:00.000Z'::timestamptz),
    ('lucas-sison', 'Lucas Sison', 'Throughout my first meet prep block we were able to increase my total from 505kg to 552.5kg. Then in a quick turnaround I was prepping two months later and we increased from 552.5kg all the way up to 597.5kg — including putting 50kgs on my deadlift in 7 months.', 'Dylan Quitoriano', '505kg → 597.5kg total · +50kg deadlift in 7 months', 'https://static.wixstatic.com/media/e99af3_1de65a1aa35548269955b4d8a43a615c~mv2.jpg', true, 'approved', '2026-01-09T02:00:00.000Z'::timestamptz),
    ('lucas-sison', 'Lucas Sison', 'Lucas picked me up off the streets 8 weeks out of my first competition and with such a short amount of time to work together, he did a great job. Having a coach expedites progress and I wish I joined him from the beginning. I love Team Sison and I couldn''t see another team as my family.', 'Calvin Phan', 'First meet prep · 2 meets together', 'https://static.wixstatic.com/media/e99af3_7411362124364417ad6f848f6f1d7993~mv2.jpg', true, 'none', '2026-01-08T02:00:00.000Z'::timestamptz),
    ('kobe-pham', 'Kobe Pham', 'I work 12-hour nursing shifts and Kobe built my training around my actual life. I made more progress in 4 months with him than in the previous year on my own.', 'Elena M.', '700+ total at 63kg, first meet', null, true, 'none', '2026-01-10T03:00:00.000Z'::timestamptz),
    ('kobe-pham', 'Kobe Pham', 'He checked in every week without fail. Accountability is underrated and Kobe delivers it without being overbearing.', 'Sam H.', 'Consistent PR streak over 6 months', null, true, 'none', '2026-01-09T03:00:00.000Z'::timestamptz),
    ('kobe-pham', 'Kobe Pham', 'As a woman new to powerlifting, I needed someone patient and technical. Kobe was both. I competed 5 months after starting with him.', 'Jasmine L.', 'First meet at 57kg, 9 months training', null, true, 'none', '2026-01-08T03:00:00.000Z'::timestamptz),
    ('aedan-nguyen', 'Aedan Nguyen', 'I came to Aedan knowing nothing about powerlifting. He didn''t just give me a program — he taught me how to train. I competed at 9 months and went 7/9.', 'Aaliyah J.', '7/9 at USPA debut, 69kg', null, true, 'none', '2026-01-10T04:00:00.000Z'::timestamptz),
    ('aedan-nguyen', 'Aedan Nguyen', 'He explains the why behind everything. I finally feel like I know what I''m doing instead of just guessing.', 'Noah C.', 'From zero to 900lb total in 14 months', null, true, 'none', '2026-01-09T04:00:00.000Z'::timestamptz),
    ('aedan-nguyen', 'Aedan Nguyen', 'The most patient and thoughtful coach I''ve had. He met me exactly where I was and helped me build from there.', 'Hana S.', 'PR total on debut, 52kg class', null, true, 'none', '2026-01-08T04:00:00.000Z'::timestamptz);
end
$$;


-- ============================================================
-- VERIFY — run after the migration.
--
-- 1. Every coach must resolve to a real auth user, or they are locked out of
--    saving (current_coach_slug() would return null):
--
--      select cr.coach_name, cr.coach_slug, cr.is_admin, cr.email,
--             u.email as auth_email
--      from coach_routing cr
--      left join auth.users u on lower(u.email) = lower(cr.email)
--      where cr.coach_name <> 'No Preference';
--
--    NULL auth_email → fix coach_routing.email to their real login email.
--    Exactly one row should have is_admin = true (Ronnie).
--
-- 2. Seed landed:
--      select count(*) from coach_testimonials;                              -- 15
--      select count(*) from coach_testimonials where main_status='approved'; -- 3
-- ============================================================
