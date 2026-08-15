-- ============================================================
-- Axis Training Systems, 043: a response is something you WORK, not just store
-- ============================================================
--
-- 024 gave the intake questionnaire a home. An athlete fills the form in, the
-- answers land in `form_submissions`, a coach can read them, and there the story
-- stops. The row is write-once and read-many and nothing else. There is no way
-- to mark one as dealt with, nowhere to write down what was decided, and no way
-- to remove the three test submissions somebody made while building the form.
--
-- What that costs is not theoretical. Two coaches read the same intake and both
-- email the athlete. A response filed six weeks ago looks exactly like one filed
-- this morning. The note about the shoulder that a coach wrote in Slack is not
-- attached to the shoulder. And the only cure anyone has for a junk submission
-- is to retire the whole form, because 024 blocks deleting an answered one.
--
-- So this file adds the three columns that turn an answer sheet into a piece of
-- work, and the two policies that decide who may touch them.
--
--   status       new | reviewed | archived. Three states, not a free-text field:
--                a filter row is only useful if everyone spells the states the
--                same way. Defaults to 'new', which is the truth about every row
--                that already exists.
--   staff_notes  what the coach decided, next to what the athlete wrote.
--   updated_at   when a staff member last touched it, stamped by a trigger so it
--                cannot be back-dated and cannot be forgotten.
--
-- WHO MAY WRITE, AND THE ONE BRANCH THAT IS DELIBERATELY MISSING.
--
-- 024's read policy has four branches: the admin, a `view_form_submissions`
-- holder, the coach who owns the form, and `client_id = auth.uid()` — the
-- submitter reading back their own answers. The UPDATE policy below is that same
-- tier MINUS THE LAST BRANCH, and the omission is the point of this migration.
--
-- `staff_notes` is written ABOUT the submitter, by the people assessing them. If
-- the client-own branch were carried across, an athlete could open their own
-- submission and rewrite the coach's assessment of it, or flip their own status
-- to 'reviewed' so it dropped out of the queue. The read tier and the write tier
-- answer two different questions — "may you see this?" and "is this yours to
-- decide about?" — and a submission is one of the places those answers diverge.
-- Reading your own answers back is fine and stays allowed. Editing the file kept
-- on you is not.
--
-- WHAT ELSE THE WRITE CANNOT REACH. The update grant names two columns and only
-- two: `status` and `staff_notes`. Everything that makes a submission evidence —
-- `answers`, `client_email`, `submitted_at`, and above all `client_id`, which
-- 024's trigger stamps from the verified session — is outside the grant, so no
-- policy has to defend it and no with-check has to mention it. A caller who
-- tries gets "permission denied for column" before RLS is consulted. That is the
-- same column-scoped shape 024 uses for the public INSERT, applied to the other
-- end of the row's life.
--
-- DELETING is narrower than updating, on purpose. Marking a response reviewed is
-- routine and belongs to whoever works the queue, including the owning coach.
-- Destroying a clinical record is not routine, so it is the admin or a
-- `manage_forms` holder and nobody else. A coach who wants a response out of
-- their way archives it. Note that this is also the FIRST way a submission can
-- be removed without its form: 024's cascade only fires on a form teardown, and
-- that teardown is itself blocked once anyone has answered.
--
-- ONE THING THIS MIGRATION CANNOT DO, stated here because a screen has to say it
-- rather than pretend otherwise: `staff_notes` is NOT private from the submitter.
-- Postgres has no per-column RLS, and 024's read policy lets a signed-in athlete
-- select their own submission row, which after today includes the notes column.
-- Making notes staff-only would take a second table or a view, and this file does
-- not add one. Write notes as if the athlete will read them, because they can.
--
-- Requires 024 (form_submissions, intake_form_coach_slug), 011 (is_axis_admin)
-- and 016 (has_permission). Carries its own grants, per 017's rule.
--
-- Re-runnable.
-- ============================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────
--
-- Failing here with a sentence beats failing four statements down with
-- "relation public.form_submissions does not exist", which says what is missing
-- but not what to run.

do $do$
begin
  if to_regclass('public.form_submissions') is null then
    raise exception
      'Run 024_forms.sql before 043_submission_management.sql.'
      using errcode = '22023';
  end if;

  if to_regprocedure('public.intake_form_coach_slug(uuid)') is null
     or to_regprocedure('public.is_axis_admin()') is null
     or to_regprocedure('public.has_permission(text)') is null then
    raise exception
      'Run 011_identity.sql, 016_permissions.sql and 024_forms.sql before 043_submission_management.sql.'
      using errcode = '22023';
  end if;
end
$do$;


-- ── 1. Three columns ────────────────────────────────────────────────────────
--
-- `status` takes its default and its check separately, because `add constraint`
-- has no IF NOT EXISTS — drop-then-add is the idempotent form for a named
-- constraint, the same shape 015 and 035 use. Naming it matters twice over: a
-- named constraint can be dropped and replaced on a re-run, and 23514 arriving
-- with a name a person can read beats an anonymous `check` in a log.

alter table public.form_submissions
  add column if not exists status text not null default 'new';

alter table public.form_submissions drop constraint if exists form_submissions_status_check;
alter table public.form_submissions add constraint form_submissions_status_check
  check (status in ('new', 'reviewed', 'archived'));

alter table public.form_submissions
  add column if not exists staff_notes text;

alter table public.form_submissions drop constraint if exists form_submissions_notes_len;
alter table public.form_submissions add constraint form_submissions_notes_len
  check (staff_notes is null or length(staff_notes) <= 4000);

-- `updated_at` arrives in three steps rather than one, and the reason is what
-- the column would otherwise claim. `add column ... not null default now()`
-- stamps EVERY existing row with the moment the migration ran, so a submission
-- from July would report that somebody worked it the day this file was applied.
-- Nobody did. So: add it nullable, backfill each row from its own submitted_at
-- (untouched since it arrived, which is the truth), and only then attach the
-- default and the NOT NULL. All three steps are idempotent on a re-run — the
-- backfill matches nothing the second time.

alter table public.form_submissions
  add column if not exists updated_at timestamptz;

update public.form_submissions
   set updated_at = submitted_at
 where updated_at is null;

alter table public.form_submissions alter column updated_at set default now();
alter table public.form_submissions alter column updated_at set not null;

comment on column public.form_submissions.status is
  'Where this response is in the queue: new, reviewed or archived. Staff-set; '
  'the submitter cannot change it.';

comment on column public.form_submissions.staff_notes is
  'What staff decided about this response. NOT private from the submitter: '
  'Postgres has no per-column RLS and 024''s read policy lets an athlete select '
  'their own submission row. Write it as if they will read it.';

comment on column public.form_submissions.updated_at is
  'When a staff member last changed status or notes. Stamped by a trigger, '
  'never supplied by a caller. Equal to submitted_at until someone works it.';


-- ── 2. The cross-form list needs its own index ──────────────────────────────
--
-- 024 indexed (form_id, submitted_at desc), which is exactly right for the
-- per-form view it shipped with: one form, newest first. The manager this file
-- exists for asks a different question — every response the reader may see,
-- newest first, capped at a thousand — and that leading column is no help to it.
-- Without this the query is a sequential scan and a sort on every screen load.
--
-- Only the one index. `status` is not indexed because the manager filters in the
-- browser over rows it has already fetched, so a status predicate never reaches
-- the database at all.

create index if not exists form_submissions_recent_idx
  on public.form_submissions (submitted_at desc);


-- ── 3. The touch ────────────────────────────────────────────────────────────
--
-- BEFORE UPDATE only. An insert leaves updated_at on its default, which for a
-- brand new row is the same instant as submitted_at, so "updated_at is later
-- than submitted_at" means precisely "a human has been here".
--
-- Definer with an empty search_path, per 017 and the shape 032's touch uses:
-- the function must not be resolvable through a caller-controlled search_path,
-- and the caller cannot supply updated_at anyway because it is not in the grant
-- in section 5.

create or replace function public.form_submissions_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.form_submissions_touch() from public, anon, authenticated, service_role;

drop trigger if exists form_submissions_touch_trg on public.form_submissions;
create trigger form_submissions_touch_trg
  before update on public.form_submissions
  for each row execute function public.form_submissions_touch();


-- ── 4. Grants ───────────────────────────────────────────────────────────────
--
-- Revoke-then-grant, so the privilege surface of this table is one readable list
-- rather than a thing assembled across two files and Supabase's defaults. The
-- first two lines RESTATE 024 section 6 verbatim: the revoke above would drop
-- them otherwise, and a public intake page that silently stops accepting
-- submissions is the worst possible way to find that out.
--
-- The new pair is the whole point. UPDATE is scoped to two columns; DELETE is
-- table-wide because a delete has no columns, which is exactly why its policy
-- below is the tightest one in this file.

revoke all on public.form_submissions from anon, authenticated;

-- 024, unchanged: the public may submit, and only these three columns are
-- theirs to set. Reading is authenticated-only and RLS narrows it.
grant insert (form_id, client_email, answers) on public.form_submissions to anon, authenticated;
grant select                                  on public.form_submissions to authenticated;

-- 043. Two columns and no others: answers, client_email, client_id and
-- submitted_at are not writable by anybody through the API, at any tier.
grant update (status, staff_notes)            on public.form_submissions to authenticated;
grant delete                                  on public.form_submissions to authenticated;


-- ── 5. RLS ──────────────────────────────────────────────────────────────────
--
-- RLS is already enabled on this table (024 section 7) and stays enabled; the
-- two policies here are additions, and 024's "anyone submits to a form" and
-- "read submissions" are untouched. A policy is per-command, so an UPDATE policy
-- cannot widen a read and a DELETE policy cannot widen either.

drop policy if exists "staff manage submissions"  on public.form_submissions;
drop policy if exists "admins delete submissions" on public.form_submissions;

-- UPDATE: the admin, a view_form_submissions holder, or the coach whose form it
-- was filed against. THREE branches where the read policy has four — there is
-- deliberately no `client_id = auth.uid()`, so an athlete who can read their own
-- submission still cannot edit the staff notes written about them, and cannot
-- mark themselves reviewed to drop out of somebody's queue. The essay at the top
-- of this file is about that missing line.
--
-- USING and WITH CHECK are identical, and both are needed. USING picks the rows
-- this caller may touch; WITH CHECK re-tests the row AFTER the update, which is
-- what stops a permitted edit from producing a row the caller could not have
-- edited in the first place. There is nothing they could move it to today —
-- form_id is not in the update grant — but the two clauses staying in step is
-- the invariant, not the current column list.
--
-- The coach comparison uses `=` rather than `is not distinct from`, for the same
-- reason 024's read policy does: the general form's coach_slug is null, and
-- `null = <slug>` is not true, so being a coach never by itself grants the power
-- to annotate responses to the site-wide form.
create policy "staff manage submissions"
  on public.form_submissions for update to authenticated
  using (
    public.is_axis_admin()
    or public.has_permission('view_form_submissions')
    or public.intake_form_coach_slug(form_id) = public.current_coach_slug()
  )
  with check (
    public.is_axis_admin()
    or public.has_permission('view_form_submissions')
    or public.intake_form_coach_slug(form_id) = public.current_coach_slug()
  );

-- DELETE: the admin, or somebody trusted with manage_forms — the permission that
-- already means "you own the questionnaires". Narrower than the update tier on
-- purpose. A plain view_form_submissions holder can read every response and
-- annotate every response and cannot destroy one; the owning coach can work
-- their own queue and cannot destroy one either. Both archive instead. This is
-- clinical-ish data (024's words: injuries, medical history, goals) and deleting
-- it is not part of working the queue.
--
-- No WITH CHECK: a delete produces no row to check.
--
-- ONE INTERACTION TO KNOW ABOUT, because it decides who can actually press the
-- button. `manage_forms` is NOT in 024's read tier — building questionnaires and
-- reading the medical answers filed against them are deliberately two different
-- grants there, and this file does not merge them. But Postgres applies the
-- SELECT policy to an UPDATE or DELETE that carries a RETURNING clause, and
-- every write in src/lib/forms.ts carries one (`.select('id')`, so that an RLS
-- refusal is a value rather than a silent success). The two rules compose:
--
--   holds manage_forms, cannot read the row   →  0 rows, and NOTHING IS DELETED
--   holds manage_forms, can read the row      →  the delete lands
--
-- That composition fails CLOSED, which is the direction to fail in, and the lib
-- reports it as a refusal rather than inventing a success. It is still a trap
-- worth naming: somebody holding the permission this policy names can watch a
-- delete do nothing. In practice the person deleting is an admin — `is_axis_admin()`
-- satisfies both tiers, and 024 seeds the admin row for both keys — or a coach
-- an admin has handed BOTH keys. src/lib/forms.ts says so in its sentence.
create policy "admins delete submissions"
  on public.form_submissions for delete to authenticated
  using (
    public.is_axis_admin()
    or public.has_permission('manage_forms')
  );


-- ── 6. Verify ───────────────────────────────────────────────────────────────
--
-- SHAPE first. Three columns, two named constraints, a definer touch:
--
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_name = 'form_submissions'
--      and column_name in ('status', 'staff_notes', 'updated_at');
--   -- status      | text        | NO  | 'new'::text
--   -- staff_notes | text        | YES |
--   -- updated_at  | timestamptz | NO  | now()
--
--   select conname from pg_catalog.pg_constraint
--    where conrelid = 'public.form_submissions'::regclass and contype = 'c';
--   -- ..._email_len, ..._answers_object, ..._status_check, ..._notes_len
--
--   select prosecdef, proconfig from pg_catalog.pg_proc
--    where proname = 'form_submissions_touch';           -- t | {search_path=""}
--
-- THE BACKFILL told the truth. Every row that predates this file reports that
-- nobody has worked it:
--
--   select count(*) from public.form_submissions where updated_at <> submitted_at;  -- 0
--   select count(*) from public.form_submissions where status <> 'new';             -- 0
--
-- THE GRANT is two columns wide. As a signed-in admin, through the API role:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<an admin uuid>';
--
--     update public.form_submissions set status = 'reviewed';        -- ok
--     update public.form_submissions set answers = '{}'::jsonb;
--     -- ERROR (42501): permission denied for table form_submissions
--     update public.form_submissions set client_id = auth.uid();
--     -- ERROR (42501): permission denied for table form_submissions
--     update public.form_submissions set status = 'triaged';
--     -- ERROR (23514): violates check constraint "form_submissions_status_check"
--   rollback;
--
-- THE CLIENT CANNOT EDIT THEIR OWN. This is the case the file exists for. The
-- athlete reads the row back (024's fourth branch) and the update matches
-- nothing, which arrives as zero rows rather than an error — which is exactly
-- why every write in src/lib/forms.ts asks for `.select('id')` back and treats
-- an empty result as a refusal:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<an athlete who submitted>';
--
--     select id, status from public.form_submissions;               -- their own row
--     update public.form_submissions set status = 'reviewed'
--      where client_id = auth.uid() returning id;                   -- 0 rows
--     update public.form_submissions set staff_notes = 'looks great to me'
--      where client_id = auth.uid() returning id;                   -- 0 rows
--     delete from public.form_submissions where client_id = auth.uid()
--      returning id;                                                -- 0 rows
--   rollback;
--
-- THE OWNING COACH may work their own form, and may not reach the general one.
-- Two submissions: one against that coach's form, one against the site-wide
-- form they have no claim on:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a plain coach uuid>';
--     select public.current_coach_slug();                           -- e.g. kobe-pham
--
--     update public.form_submissions s set status = 'reviewed'
--      where public.intake_form_coach_slug(s.form_id) = 'kobe-pham'
--      returning s.id;                                              -- 1 row
--
--     update public.form_submissions s set staff_notes = 'mine now'
--      where public.intake_form_coach_slug(s.form_id) is null
--      returning s.id;                                              -- 0 rows: the
--     -- general form's null slug is not equal to theirs, and never will be
--
--     delete from public.form_submissions returning id;             -- 0 rows
--   rollback;
--
-- A PLAIN view_form_submissions HOLDER annotates everything and destroys
-- nothing, which is the difference between the two policies:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a coach holding view_form_submissions>';
--     select public.has_permission('view_form_submissions'),
--            public.has_permission('manage_forms');                 -- t | f
--
--     update public.form_submissions set status = 'archived' returning id;  -- every row
--     delete from public.form_submissions returning id;                     -- 0 rows
--   rollback;
--
-- and with manage_forms the delete lands, PROVIDED the deleter can also read the
-- row — the RETURNING interaction named under the policy above. An admin, or a
-- coach holding both keys:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<an admin uuid>';
--     delete from public.form_submissions where id = '<one id>' returning id;  -- 1 row
--   rollback;
--
-- The trap itself, proven both ways. A coach holding manage_forms and NOT
-- view_form_submissions, whose slug owns no form:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<that coach>';
--     select count(*) from public.form_submissions;             -- 0: cannot read any
--     delete from public.form_submissions returning id;         -- 0 rows, 0 deleted
--     delete from public.form_submissions;                      -- no RETURNING: they land
--     select count(*) from public.form_submissions;             -- 0 (as themselves)
--   rollback;
--
-- The lib only ever issues the first form, so the fail-closed branch is the one
-- that ships.
--
-- ANON IS UNCHANGED — still insert-only, still blind. Note the insert below has
-- no RETURNING: anon holds no SELECT on this table, so asking for the id back is
-- itself a "permission denied for table form_submissions", which is 024's design
-- and not a fault:
--
--   set role anon;
--   insert into public.form_submissions (form_id, client_email, answers)
--   select id, 'guest@example.com', '{"goals":"x"}'::jsonb
--     from public.intake_forms where coach_slug is null;      -- INSERT 0 1
--   update public.form_submissions set status = 'reviewed';   -- ERROR: permission denied
--   delete from public.form_submissions;                      -- ERROR: permission denied
--   select * from public.form_submissions;                    -- ERROR: permission denied
--   reset role;
--
-- THE TOUCH FIRES and cannot be steered. As the table owner, with RLS and grants
-- both out of the way, so what is left is the trigger itself:
--
--   update public.form_submissions
--      set status = 'reviewed', updated_at = '2001-01-01'
--    where id = '<one id>';
--   select updated_at > submitted_at from public.form_submissions where id = '<one id>';  -- t
--
-- RE-RUNNABILITY. Applying this file twice adds no column, moves no timestamp,
-- and replaces one function and two policies:
--
--   \i supabase/migrations/043_submission_management.sql
-- ============================================================
