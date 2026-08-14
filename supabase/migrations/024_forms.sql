-- ============================================================
-- Axis Training Systems — 024: intake forms and their submissions
-- ============================================================
--
-- Coaching starts with a questionnaire, and until now the only one was hard
-- coded into Apply.tsx — thirty fixed fields, the same for every athlete and
-- every coach, editable only by shipping a new build. This migration makes the
-- form a ROW: a coach can build their own intake, an admin can build a general
-- one for the whole site, and the answers land in a table instead of an email.
--
-- TWO TABLES.
--
--   intake_forms      a form definition. `coach_slug` null means the general,
--                     site-wide form; a slug means it belongs to that coach.
--                     `fields` is the questionnaire itself — an ordered jsonb
--                     array the builder edits and the public page renders.
--
--   form_submissions  one filled-in copy. `client_id` null means a guest filled
--                     it out signed-out; otherwise it is the submitter, stamped
--                     server-side from auth.uid() so it can never be forged.
--
-- WHO MAY DO WHAT — the shape of the RLS below.
--
--   * Anyone, signed in or not, may READ an ACTIVE form. The public /intake page
--     has to render one, and a form definition is not secret. Inactive/retired
--     forms are visible only to staff who own them.
--   * Anyone may SUBMIT to an active form — the whole point is a public intake —
--     but only three columns are grantable (form_id, client_email, answers), so
--     a caller cannot set client_id, cannot backdate submitted_at, and cannot
--     attribute a submission to another account. A trigger stamps client_id from
--     the verified session.
--   * A SUBMISSION is CLINICAL-ISH: injuries, medical history, goals. Anon can
--     never SELECT one. Reads are the admin, the owning coach, whoever holds
--     view_form_submissions, or the submitter about their own answers.
--   * WRITING a form is the admin, the coach who owns that slug, or a person
--     granted manage_forms. A coach cannot touch the general form or another
--     coach's — the policy is phrased on current_coach_slug(), not on role.
--
-- Borrows the answered-form invariant from the studio schema this project is
-- lineage to: once a submission exists, the form's `fields` are frozen, because
-- an answer sheet keyed by field is unreadable if the questions change under it.
-- Retire the form and build a new one instead.
--
-- Re-runnable.
-- ============================================================


-- ── 1. The catalogue gains two permissions ──────────────────────────────────
--
-- Neither is is_sensitive: they are not the power to grant everything else, so a
-- coach who holds manage_permissions AND one of these may pass it on (016's
-- can_grant_permission rule). Written through the same insert idiom 016 uses, so
-- the catalogue guard installed there accepts it (auth.uid() is null in a
-- migration) and a re-run refreshes the labels.

insert into public.permissions (key, label, description, is_sensitive) values
  ('manage_forms', 'Manage intake forms',
   'Build and edit intake forms, including the general site-wide one and other '
   'coaches''. A coach can always manage their own form without this.', false),
  ('view_form_submissions', 'See form submissions',
   'Read what athletes have submitted on any intake form. A coach can always see '
   'submissions to their own form without this.', false)
on conflict (key) do update
  set label        = excluded.label,
      description  = excluded.description,
      is_sensitive = excluded.is_sensitive;

-- Give the admin column of the settings matrix a row for each new key, exactly
-- as 016 does. It is signage only — profile_has_permission short-circuits on
-- role = 'admin' before it ever reads this table — but a missing row would draw
-- the box unticked for the one account that holds everything.
insert into public.role_permissions (role, permission)
select 'admin'::public.user_role, key
  from public.permissions
 where key in ('manage_forms', 'view_form_submissions')
on conflict do nothing;


-- ── 2. Forms ────────────────────────────────────────────────────────────────

create table if not exists public.intake_forms (
  id          uuid primary key default gen_random_uuid(),

  -- Null is the general, site-wide form. A slug ties the form to one coach and
  -- is the same slug profiles.coach_slug and every per-coach policy since 002
  -- already use, so the shape constraint matches profiles' exactly.
  coach_slug  text,

  title       text not null,
  description text,
  is_active   boolean not null default true,

  -- The questionnaire. An ordered array of
  --   { key, label, type, required, options? }
  -- where type is one of text|textarea|number|select|checkbox|date and options
  -- is the choice list for a select. The shape of each field is validated in
  -- src/lib/forms.ts before the write; the constraints here guard the envelope
  -- (it is a non-empty array, capped) so a malformed blob cannot be stored even
  -- from psql.
  fields      jsonb not null default '[]'::jsonb,

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint intake_forms_title_len   check (length(title) between 1 and 200),
  constraint intake_forms_desc_len    check (description is null or length(description) <= 2000),
  constraint intake_forms_slug_shape  check (coach_slug is null or coach_slug ~ '^[a-z0-9-]+$'),
  constraint intake_forms_fields_array
    check (jsonb_typeof(fields) = 'array' and jsonb_array_length(fields) <= 100)
);

create index if not exists intake_forms_coach_idx
  on public.intake_forms (coach_slug) where coach_slug is not null;
create index if not exists intake_forms_active_idx
  on public.intake_forms (is_active, created_at desc);


create or replace function public.intake_forms_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists intake_forms_touch_trg on public.intake_forms;
create trigger intake_forms_touch_trg
  before update on public.intake_forms
  for each row execute function public.intake_forms_touch();


-- ── 3. Submissions ──────────────────────────────────────────────────────────

create table if not exists public.form_submissions (
  id           uuid primary key default gen_random_uuid(),

  -- Cascade: a form's submissions are meaningless without it, and the delete is
  -- blocked below while any exist, so this fires only on an intentional teardown
  -- of a form nobody has answered.
  form_id      uuid not null references public.intake_forms (id) on delete cascade,

  -- Null is a guest. Set null on delete keeps the answer sheet as a record even
  -- if the account that filed it is removed. Never taken from the payload — the
  -- stamp trigger writes it from auth.uid().
  client_id    uuid references public.profiles (id) on delete set null,

  client_email text,

  -- The answers, an object keyed by field key. `{ "goals": "...", ... }`.
  answers      jsonb not null default '{}'::jsonb,

  submitted_at timestamptz not null default now(),

  constraint form_submissions_email_len check (client_email is null or length(client_email) <= 254),
  constraint form_submissions_answers_object check (jsonb_typeof(answers) = 'object')
);

create index if not exists form_submissions_form_idx
  on public.form_submissions (form_id, submitted_at desc);
create index if not exists form_submissions_client_idx
  on public.form_submissions (client_id) where client_id is not null;


-- The submitter is whoever is signed in, and a guest is null. Read from the
-- verified auth.uid() and NEVER from the row, so that a caller who somehow got
-- the column granted still could not attribute a submission to another account.
-- client_id is not in the insert grant below either, which is belt and braces.
create or replace function public.form_submissions_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.client_id := auth.uid();
  return new;
end $$;

revoke all on function public.form_submissions_stamp() from public;

drop trigger if exists form_submissions_stamp_trg on public.form_submissions;
create trigger form_submissions_stamp_trg
  before insert on public.form_submissions
  for each row execute function public.form_submissions_stamp();


-- ── 4. Two definer helpers the policies are written against ──────────────────
--
-- Both read intake_forms, and the anon INSERT policy on form_submissions calls
-- one of them — so they are SECURITY DEFINER and read the table with RLS off,
-- the same reasoning 011 gives for its identity helpers. Neither leaks anything:
-- one returns a boolean about a form the caller named, the other a slug used
-- only to compare against the caller's own.

/** Is this form real and accepting submissions? Gate for the public insert. */
create or replace function public.intake_form_is_active(p_form uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.intake_forms
    where id = p_form and is_active
  )
$$;

/** The coach_slug a form belongs to, or null for the general one. */
create or replace function public.intake_form_coach_slug(p_form uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coach_slug from public.intake_forms where id = p_form
$$;

revoke all     on function public.intake_form_is_active(uuid)   from public;
revoke all     on function public.intake_form_coach_slug(uuid)  from public;
grant  execute on function public.intake_form_is_active(uuid)   to anon, authenticated, service_role;
grant  execute on function public.intake_form_coach_slug(uuid)  to authenticated, service_role;


-- ── 5. Once answered, the questions are frozen ──────────────────────────────
--
-- `answers` is keyed by field key. Change or drop a field on a form that has
-- submissions and every stored answer sheet becomes partly unreadable — the
-- values survive, but nothing records what was asked. That is worse than losing
-- them, because it looks fine. So the fields of an answered form cannot change,
-- and an answered form cannot be deleted. Everything else (title, description,
-- is_active) stays editable; retire it and build a new one when the questions
-- must change.

create or replace function public.intake_form_guard_answered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fields is distinct from old.fields and exists (
    select 1 from public.form_submissions where form_id = old.id
  ) then
    raise exception
      'Athletes have already answered this form. Switch it off and build a new one rather than changing the questions.'
      using errcode = '22023';
  end if;
  return new;
end $$;

revoke all on function public.intake_form_guard_answered() from public;

drop trigger if exists intake_forms_guard_answered_trg on public.intake_forms;
create trigger intake_forms_guard_answered_trg
  before update on public.intake_forms
  for each row execute function public.intake_form_guard_answered();

create or replace function public.intake_form_block_answered_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.form_submissions where form_id = old.id) then
    raise exception
      'Athletes have filled this form in. Switch it off instead of deleting it.'
      using errcode = '22023';
  end if;
  return old;
end $$;

revoke all on function public.intake_form_block_answered_delete() from public;

drop trigger if exists intake_forms_block_answered_delete_trg on public.intake_forms;
create trigger intake_forms_block_answered_delete_trg
  before delete on public.intake_forms
  for each row execute function public.intake_form_block_answered_delete();


-- ── 6. Grants ───────────────────────────────────────────────────────────────
--
-- Supabase hands anon and authenticated everything on a new public table, so the
-- grants are stated rather than assumed — revoke, then hand back exactly what
-- each role needs and no more.

revoke all on public.intake_forms     from anon, authenticated;
revoke all on public.form_submissions from anon, authenticated;

-- Forms: everyone may read (RLS narrows anon to active); only the authenticated
-- write, and RLS narrows that to the owner.
grant select                        on public.intake_forms to anon, authenticated;
grant insert, update, delete        on public.intake_forms to authenticated;

-- Submissions: the public may INSERT, and ONLY these three columns are theirs to
-- set. id, submitted_at default; client_id is stamped by the trigger from the
-- session. Reading is authenticated-only, narrowed by RLS — anon never selects.
grant insert (form_id, client_email, answers) on public.form_submissions to anon, authenticated;
grant select                                  on public.form_submissions to authenticated;


-- ── 7. RLS ──────────────────────────────────────────────────────────────────

alter table public.intake_forms     enable row level security;
alter table public.form_submissions enable row level security;

drop policy if exists "anyone reads active forms"   on public.intake_forms;
drop policy if exists "staff read their forms"       on public.intake_forms;
drop policy if exists "owner writes forms"           on public.intake_forms;
drop policy if exists "anyone submits to a form"     on public.form_submissions;
drop policy if exists "read submissions"             on public.form_submissions;

-- READ a form: an active form is public — the /intake page renders it with the
-- anon key. Permissive policies OR together, so the staff policy below only ever
-- ADDS the retired forms an owner needs to see.
create policy "anyone reads active forms"
  on public.intake_forms for select to anon, authenticated
  using (is_active);

-- The extra rows staff get: an admin and manage_forms holders see every form
-- including retired ones; a coach additionally sees their own, active or not.
create policy "staff read their forms"
  on public.intake_forms for select to authenticated
  using (
    public.is_axis_admin()
    or public.has_permission('manage_forms')
    or (coach_slug is not null and coach_slug = public.current_coach_slug())
  );

-- WRITE a form: the admin, a manage_forms holder, or the coach who owns the
-- slug. Phrased on current_coach_slug() rather than on role, so a coach is
-- confined to their OWN slug — the with-check refuses a coach creating a general
-- form (coach_slug null) or one under someone else's slug. FOR ALL covers the
-- insert (with check), the edit (both) and the delete (using).
create policy "owner writes forms"
  on public.intake_forms for all to authenticated
  using (
    public.is_axis_admin()
    or public.has_permission('manage_forms')
    or (coach_slug is not null and coach_slug = public.current_coach_slug())
  )
  with check (
    public.is_axis_admin()
    or public.has_permission('manage_forms')
    or (coach_slug is not null and coach_slug = public.current_coach_slug())
  );

-- SUBMIT: anyone, but only to a form that exists and is active. The column grant
-- already caps WHAT they can set; this caps WHICH form they can set it against,
-- through a definer helper so anon can evaluate it without reading the table.
create policy "anyone submits to a form"
  on public.form_submissions for insert to anon, authenticated
  with check (public.intake_form_is_active(form_id));

-- READ a submission: the admin, a view_form_submissions holder, the coach who
-- owns the form it was filed against, or the submitter about their own. The
-- coach comparison uses = (not `is not distinct from`) on purpose: a general
-- form's slug is null, and null = <coach slug> is not true, so being a coach
-- never by itself grants a peek at the general form's clinical answers. No anon
-- policy exists, and anon has no select grant — two locks on the same door.
create policy "read submissions"
  on public.form_submissions for select to authenticated
  using (
    public.is_axis_admin()
    or public.has_permission('view_form_submissions')
    or client_id = auth.uid()
    or public.intake_form_coach_slug(form_id) = public.current_coach_slug()
  );


-- ── 8. Seed: one general intake form ────────────────────────────────────────
--
-- `where not exists` rather than a conflict target, because there is no unique
-- key on "the general form" — a re-run must not add a second, and must not
-- overwrite one the coaches have since edited.

insert into public.intake_forms (coach_slug, title, description, is_active, fields, created_by)
select
  null,
  'General Intake',
  'Tell us about yourself and your training. This helps us point you to the right coach and start your program on the right footing.',
  true,
  '[
    {"key":"full_name","label":"Full name","type":"text","required":true},
    {"key":"email","label":"Email address","type":"text","required":true},
    {"key":"phone","label":"Phone number","type":"text","required":false},
    {"key":"goals","label":"What are your main training goals?","type":"textarea","required":true},
    {"key":"experience","label":"How long have you been training seriously?","type":"select","required":true,"options":["Less than 1 year","1 to 2 years","2 to 4 years","4 or more years"]},
    {"key":"injuries","label":"Any past or current injuries or medical conditions we should know about?","type":"textarea","required":false},
    {"key":"training_days","label":"How many days a week can you train?","type":"number","required":true},
    {"key":"consent","label":"I understand Axis Training Systems will use this information to provide coaching.","type":"checkbox","required":true}
  ]'::jsonb,
  null
where not exists (
  select 1 from public.intake_forms where coach_slug is null
);


-- ── 9. Verify ───────────────────────────────────────────────────────────────
--
-- The two permissions exist and are not sensitive, the admin holds both:
--
--   select key, is_sensitive from public.permissions
--    where key in ('manage_forms', 'view_form_submissions');            -- 2 rows, f
--   select count(*) from public.role_permissions
--    where role = 'admin' and permission in ('manage_forms','view_form_submissions'); -- 2
--
-- The general form is there exactly once:
--
--   select count(*) from public.intake_forms where coach_slug is null;  -- 1
--
-- Anon may read the active form and nothing about a submission:
--
--   set role anon;
--   select id, title from public.intake_forms where is_active;          -- the general form
--   select * from public.form_submissions limit 1;                      -- permission denied
--   -- and a submission goes in, client_id stamped null (guest):
--   insert into public.form_submissions (form_id, client_email, answers)
--   select id, 'guest@example.com', '{"full_name":"Guest"}'::jsonb
--     from public.intake_forms where coach_slug is null;                -- 1 row
--   reset role;
--   select client_id from public.form_submissions order by submitted_at desc limit 1; -- null
--
-- The answered-form guard holds even here, as the owner, with RLS bypassed —
-- that is the whole point of putting it in a trigger:
--
--   update public.intake_forms
--      set fields = '[]'::jsonb
--    where coach_slug is null;   -- ERROR: Athletes have already answered this form...
--   delete from public.intake_forms where coach_slug is null; -- ERROR: Switch it off instead...
