-- ============================================================
-- Axis Training Systems, 044: what an athlete is working on, and what they were
-- ============================================================
--
-- Ask a coach at this studio what Devin is doing right now and the answer is one
-- word: prep. Ask what Devin was doing in March and the answer is a pause, a
-- scroll through a chat thread, and a guess. The first fact lives in somebody's
-- head and on a whiteboard; the second one does not live anywhere at all.
--
-- This file is where both of those facts start living in the product, and the
-- second one is the reason it exists at all.
--
-- A TRAINING BLOCK is one stretch of programming
-- with one intent behind it: a development block, a prep block, six weeks off
-- with a broken wrist. It has a phase, a start, an end that arrives later, and
-- somewhere to write down what it was for. The roster reads the open one to draw
-- a chip on a card. The athlete's own page reads the closed ones and finally has
-- an answer to what did we do last spring.
--
-- WHY A HISTORY TABLE AND NOT A COLUMN ON `profiles`. The obvious schema is
-- `profiles.training_phase text`, one row per athlete, updated in place. It is
-- smaller, it needs no join, and the roster query gets it for free off a table
-- the screen already reads. It is also the version of this feature that answers
-- the first question and destroys the second one: every phase change overwrites
-- the only record that the previous phase ever happened. A year of that leaves a
-- coach with exactly what they have today, which is one word and no history.
--
-- So the row is the unit, and rows accumulate. Everything below follows from
-- that one decision:
--
--   * A PHASE CHANGE IS A NEW ROW. There is no path anywhere in this file that
--     writes `phase` on a block that already exists. `start_training_block`
--     closes the open block and inserts the next one; `edit_training_block`
--     touches the label and the notes and nothing else. Fixing a typo in a note
--     is an edit. Deciding somebody moves from prep to competition is a new
--     block, because it is a new thing that happened on a date.
--   * ONE OPEN BLOCK PER ATHLETE. "What are they doing now" has to have a single
--     answer, and two open rows is a screen that has to pick one and a coach who
--     cannot tell which is real. Enforced twice, in section 1 and section 5: the
--     RPC closes the current block before it inserts, and a partial unique index
--     means two taps in the same second lose in the database rather than in the
--     application. That is 023's DM dedup argument again, and it holds for the
--     same reason: a read followed by a write is a race, and an index is not.
--   * NOTHING IS EVER DELETED FROM HERE by anything in this file. There is no
--     delete policy, no delete grant and no RPC that removes a block. A block
--     that should not have been started is closed the day it started, which
--     leaves a one-day row in the history, which is what actually happened.
--
-- WHO MAY WRITE, and this is the decision worth the most argument. Three tiers:
-- an admin, a holder of `manage_staff`, or A COACH THIS ATHLETE IS ASSIGNED TO.
--
-- The third one is the point of the feature. Programming is the coach's daily
-- job. `manage_staff` is 016's sensitive staffing key, the one only an admin can
-- hand out and the one 033 moved the assignment table onto precisely because it
-- is scarce. If setting a phase needed it, a coach would have to ask an admin
-- every four weeks for a block they wrote themselves, and within a month the
-- real record would be back on the whiteboard where it started.
--
-- It is not a hole, and the reason is 033. The coach branch reads
-- `athlete_coaches`, and since 033 only an admin or a `manage_staff` holder can
-- write a row into that table. A coach cannot assign themselves an athlete and
-- therefore cannot widen this. What they get is authority over the athletes
-- somebody else decided were theirs, which is the same boundary `can_message()`
-- (023) already draws for the conversation.
--
-- WHO MAY READ. Staff see the whole board, because the roster is a board. An
-- athlete sees their own history and nobody else's, which is both the privacy
-- rule 011 sets for `profiles` and the thing that makes an athlete-facing
-- training page possible later without another migration.
--
-- WHY THE WRITES ARE ALL RPCs. 023's reasoning, unchanged. There is no INSERT,
-- UPDATE or DELETE policy on this table and no such grant, so the three
-- functions in section 5 are not the recommended route, they are the only one.
-- Every interesting rule here is about a different row (is there an open block)
-- or a different table (is this coach assigned), and a WITH CHECK expression
-- that reaches both is a rule nobody can read six months later. The refusals are
-- sentences aimed at a person, which an RLS violation can never be.
--
-- NAMING. 005 owns the vocabulary of repeating schedules for the blog and this
-- file borrows none of it. A stretch of programming is a BLOCK, which is the
-- word a coach says out loud, and the seven phases below are the words on the
-- whiteboard rather than a taxonomy invented here.
--
-- Requires 011 (profiles, is_axis_admin), 016 (has_permission, is_axis_staff,
-- the manage_staff key) and 023 (athlete_coaches). Every function carries its
-- own grants, per 017's rule that a function created after it arrives callable
-- by nobody.
--
-- Re-runnable.
-- ============================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────
--
-- Two tables and three helpers. Failing here with a sentence beats failing
-- inside a function body with "relation public.athlete_coaches does not exist",
-- which says what is missing but not what to run.

do $do$
begin
  if to_regclass('public.profiles') is null then
    raise exception
      'Run 011_identity.sql before 044_training_blocks.sql.'
      using errcode = '22023';
  end if;

  if to_regclass('public.athlete_coaches') is null then
    raise exception
      'Run 023_messaging_foundation.sql before 044_training_blocks.sql.'
      using errcode = '22023';
  end if;

  if to_regprocedure('public.is_axis_admin()') is null
     or to_regprocedure('public.is_axis_staff()') is null
     or to_regprocedure('public.has_permission(text)') is null then
    raise exception
      'Run 011_identity.sql and 016_permissions.sql before 044_training_blocks.sql.'
      using errcode = '22023';
  end if;
end
$do$;


-- ── 1. The block ────────────────────────────────────────────────────────────
--
-- WHY `phase` IS TEXT WITH A CHECK AND NOT AN ENUM. This database has enums and
-- uses them well (`user_role`, `conversation_kind`), and the case for one here
-- is real: seven fixed values that a screen renders as chips. The case against
-- is that the list will change. A studio that adds a "deload" phase next season
-- needs one statement to widen a named CHECK, in the same file as the comment
-- explaining why, and it needs `alter type ... add value` plus a separate
-- transaction to widen an enum, because a value added to an enum cannot be used
-- in the transaction that added it. The seven strings are also exactly what the
-- client's `PHASES` array carries, in the same spelling, so a mismatch is a
-- constraint violation on a string a reviewer can read rather than a cast error.
--
-- WHY `starts_on` AND `ends_on` ARE DATES AND NOT TIMESTAMPS. Nobody moves an
-- athlete into a competition block at 14:32. A block starts on a day and ends on
-- a day, the roster renders whole days in phase, and a timestamp would invite a
-- client somewhere to compute a difference in hours and print "0 days" on the
-- morning a coach starts a block.
--
-- `ends_on is null` IS THE OPEN STATE and there is no separate boolean. Two
-- columns that can disagree about the same fact is a bug waiting for a partial
-- write, and the null already means the only thing it could mean: this block has
-- not finished.
--
-- `created_by` is `on delete set null` rather than cascade, for 023's reason:
-- the day a coach leaves is not the day every athlete loses their history.
-- `athlete_id` DOES cascade, because a deleted account takes its own training
-- record with it and a block belonging to nobody is not history, it is litter.

create table if not exists public.training_blocks (
  id         uuid not null primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id) on delete cascade,

  phase text not null,

  -- What this block is called on the whiteboard: "Spring meet prep", "Post-comp
  -- reset". Optional, because the phase alone is often the whole story.
  label text,

  -- The coach's own note about the intent. Read by staff and by the athlete the
  -- block belongs to, so it is a note TO them as much as about them.
  notes text,

  starts_on date not null default current_date,
  ends_on   date,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Named, so a violation names the rule rather than a generated string. The
  -- seven values are the client's `PHASES` keys exactly.
  constraint training_blocks_phase_known
    check (phase in ('development', 'transition', 'prep', 'competition',
                     'recovery', 'injury', 'off')),

  constraint training_blocks_label_len
    check (label is null or char_length(label) <= 120),

  constraint training_blocks_notes_len
    check (notes is null or char_length(notes) <= 2000),

  -- A block that ends before it starts is not a typo anybody can act on. Equal
  -- is allowed and is the ordinary shape of a block started and closed the same
  -- day, which is what correcting a mis-click leaves behind.
  constraint training_blocks_dates_ordered
    check (ends_on is null or ends_on >= starts_on)
);

-- ONE OPEN BLOCK PER ATHLETE, decided in the database. Section 5 closes the
-- current block before inserting the next, which is the path every legitimate
-- caller takes; this index is what happens when two of them run at once. The
-- loser gets 23505 and `start_training_block` turns that into a sentence.
create unique index if not exists training_blocks_one_open_idx
  on public.training_blocks (athlete_id) where ends_on is null;

-- The history query: this athlete, newest block first. The roster's own read is
-- the whole table filtered by RLS, and it sorts on `starts_on` too.
create index if not exists training_blocks_athlete_idx
  on public.training_blocks (athlete_id, starts_on desc);


-- ── 2. The touch ────────────────────────────────────────────────────────────
--
-- `updated_at` on every update and nothing else. No `updated_by`: unlike 032's
-- coach page, which several people edit and where "who changed this" is the
-- first question, a block is written by the coach who started it and edited by
-- the same person minutes later. `created_by` already carries the name that
-- matters, and a second stamp nobody renders is a column that goes stale
-- silently.
--
-- BEFORE UPDATE alone. The column defaults to now() on insert, so firing on
-- insert as well would write the same value twice.

create or replace function public.training_blocks_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.training_blocks_touch() from public, anon, authenticated, service_role;

drop trigger if exists training_blocks_touch_trg on public.training_blocks;
create trigger training_blocks_touch_trg
  before update on public.training_blocks
  for each row execute function public.training_blocks_touch();


-- ── 3. Who may set an athlete's programming ─────────────────────────────────
--
-- The writer tier, in one function, so the three RPCs and any signage in the UI
-- read the same answer. Stated as prose: an admin, a coach an admin trusted with
-- `manage_staff`, or one of the coaches this athlete is actually assigned to.
--
-- SECURITY DEFINER for the third branch. `athlete_coaches` has a read policy
-- that already admits a coach to their own rows (023), so an invoker function
-- would answer correctly for the coach asking about their own athlete. It would
-- not answer correctly for an admin, whose branch is settled one line earlier
-- anyway, and it would make the answer depend on a policy in another file. The
-- definer hop makes it one index probe against a fixed rule.
--
-- STABLE, so a policy or a screen can call it repeatedly inside one statement
-- without re-planning it. Nothing here writes.
--
-- A null argument answers false rather than raising: this is a predicate, and
-- every caller below already has a sentence ready for the false.

create or replace function public.can_manage_training(p_athlete uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and p_athlete is not null
     and (
       public.is_axis_admin()
       or public.has_permission('manage_staff')
       or (
         -- The assignment row alone is not authority: rows survive a coach
         -- being suspended or demoted (nothing deletes them on a status
         -- change), and every identity helper in this schema requires the
         -- CALLER to be active staff. is_axis_staff() restores that here,
         -- making the write tier exactly as narrow as the read policy's
         -- staff clause below.
         public.is_axis_staff()
         and exists (
           select 1 from public.athlete_coaches ac
           where ac.athlete_id = p_athlete
             and ac.coach_id   = auth.uid()
         )
       )
     )
$$;

comment on function public.can_manage_training(uuid) is
  'Whether the caller may start, end or edit training blocks for that athlete: '
  'an admin, a manage_staff holder, or one of the athlete''s assigned coaches. '
  'The coach branch requires the caller to be ACTIVE staff and one of the '
  'athlete''s assigned coaches: assignment rows survive suspension, so the '
  'row alone is never authority.';

-- `service_role` is deliberately absent. The answer is derived from a session
-- and a service-role call carries none, so the grant would be an invitation to a
-- false. Definer callers, including the three RPCs below, execute as the owner
-- and need no grant at all.
revoke all     on function public.can_manage_training(uuid) from public, anon, authenticated;
grant  execute on function public.can_manage_training(uuid) to authenticated;


-- ── 4. RLS ──────────────────────────────────────────────────────────────────
--
-- Read is two clauses. Write is nothing at all: no INSERT, UPDATE or DELETE
-- policy exists on this table and the grants below match, so section 5 is the
-- only door. See the header.
--
-- The athlete's own clause is not a courtesy. It is what lets an athlete-facing
-- page render their own history without a definer projection, and it is narrow
-- in the way 011 is narrow: their own rows, by id, and no shape of query returns
-- anybody else's.
--
-- `is_axis_staff()` and not `has_permission('manage_athletes')` for the staff
-- clause. Reading who is in what phase is roster awareness rather than a
-- privilege: a coach covering a session needs to know the athlete in front of
-- them is three weeks into a recovery block, and a permission check there would
-- mean a coach with a default permission set sees a card with a blank chip on
-- it and no way to know why. Writing is where the tier gets narrow, and section
-- 3 is that tier.
--
-- No anon policy and anon is revoked outright. There is no reading of this
-- without an account.

alter table public.training_blocks enable row level security;

drop policy if exists "read training blocks" on public.training_blocks;

create policy "read training blocks"
  on public.training_blocks for select to authenticated
  using (
    athlete_id = auth.uid()
    or public.is_axis_staff()
  );

revoke all    on public.training_blocks from anon, authenticated;
grant  select on public.training_blocks to authenticated;


-- ── 5. The write surface ────────────────────────────────────────────────────
--
-- Three functions, and between them they are every write this feature has.
-- Every refusal is a sentence, raised with 42501 for the gate and 22023 for
-- everything else, because `trainingApi.ts` passes both codes through to the
-- screen verbatim. Read them as UI copy, because that is what they are.
--
-- All three restate validation the constraints in section 1 would have enforced
-- anyway. That is 036's deliberate duplication: a check violation is correct and
-- unreadable, and the person who typed 3000 characters of notes deserves to be
-- told which field and what the limit is.

/**
 * Move an athlete into a phase: close whatever they are in, and open the next.
 *
 * The two writes are one statement each and one transaction between them, which
 * is the reason this is a function rather than two calls from a browser. A close
 * that lands without its insert leaves an athlete with no current block, and a
 * screen with no chip and no explanation.
 *
 * `greatest(starts_on, current_date)` rather than a bare `current_date` on the
 * close: nothing in this file can create a block that starts in the future, but
 * a restore or a hand-written row could, and the alternative to this coalesce is
 * a constraint violation on `training_blocks_dates_ordered` in the middle of a
 * coach's afternoon.
 *
 * Returns the new block's id, so the client can select the row it just made
 * rather than refetching the board to find it.
 */
create or replace function public.start_training_block(
  p_athlete uuid,
  p_phase   text,
  p_label   text default null,
  p_notes   text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_role  public.user_role;
  v_phase text;
  v_label text;
  v_notes text;
  v_id    uuid;
begin
  if v_me is null then
    raise exception 'You must be signed in to start a training block.'
      using errcode = '42501';
  end if;

  -- WHO. The three tiers, in one call. See section 3 for why the third one is
  -- there and why it is not a hole.
  if not public.can_manage_training(p_athlete) then
    raise exception 'Only an admin, a coach with Manage staff, or one of this athlete''s own coaches can change their training block.'
      using errcode = '42501';
  end if;

  -- The gate has already answered, so a caller who reaches here naming a coach
  -- is an admin who picked the wrong row. Both sentences say which.
  select p.role into v_role from public.profiles p where p.id = p_athlete;
  if v_role is null then
    raise exception 'That athlete account no longer exists.' using errcode = '22023';
  end if;
  if v_role <> 'athlete' then
    raise exception 'Training blocks belong to athletes.' using errcode = '22023';
  end if;

  -- Status is deliberately NOT checked, unlike 023's assignment trigger. A
  -- suspended athlete is somebody whose history still matters and whose open
  -- block somebody probably wants to close; refusing that would leave the board
  -- showing them mid-prep forever.

  v_phase := lower(btrim(coalesce(p_phase, '')));
  if v_phase = '' then
    raise exception 'Pick a phase for this block.' using errcode = '22023';
  end if;
  if v_phase not in ('development', 'transition', 'prep', 'competition',
                     'recovery', 'injury', 'off') then
    raise exception 'That is not a training phase. Use development, transition, prep, competition, recovery, injury or off.'
      using errcode = '22023';
  end if;

  v_label := nullif(btrim(coalesce(p_label, '')), '');
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');

  if char_length(coalesce(v_label, '')) > 120 then
    raise exception 'That block name is too long. Keep it to 120 characters or fewer.'
      using errcode = '22023';
  end if;
  if char_length(coalesce(v_notes, '')) > 2000 then
    raise exception 'Those notes are too long. Keep them to 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  -- Close first. A block closed on the day it opened is a one-day row and stays
  -- in the history, because the coach did start it and did change their mind,
  -- and a table that quietly swallows that is a table nobody can audit.
  update public.training_blocks
     set ends_on = greatest(starts_on, current_date)
   where athlete_id = p_athlete
     and ends_on is null;

  -- The index in section 1 is what makes the close-then-insert safe under two
  -- simultaneous callers. The loser lands here, and 23505 on this table means
  -- exactly one thing, so it gets its own sentence rather than the constraint
  -- name Postgres would otherwise hand the screen.
  begin
    insert into public.training_blocks (athlete_id, phase, label, notes, created_by)
    values (p_athlete, v_phase, v_label, v_notes, v_me)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Somebody else just started a block for this athlete. Refresh the roster and try again.'
      using errcode = '22023';
  end;

  return v_id;
end $$;

comment on function public.start_training_block(uuid, text, text, text) is
  'Closes the athlete''s open training block and opens a new one in the given '
  'phase, in one transaction, for an admin, a manage_staff holder or one of that '
  'athlete''s coaches. A phase change is always a new block: nothing anywhere '
  'rewrites the phase of a block that already exists.';

revoke all     on function public.start_training_block(uuid, text, text, text) from public, anon, authenticated;
grant  execute on function public.start_training_block(uuid, text, text, text) to authenticated;


/**
 * Close the open block and leave the athlete between blocks.
 *
 * A real state and not a gap in the data: an athlete who has finished a
 * competition block and has not been given the next one yet is exactly what the
 * roster should draw as no chip. The alternative, an implicit 'off' block, would
 * be this file inventing a fact the coach did not state.
 *
 * The refusal when there is nothing open is a sentence rather than a silent
 * no-op, because the button that calls this is only rendered when the screen
 * believes a block is open, so reaching it means the screen is stale and the
 * person should be told to look again.
 */
create or replace function public.end_training_block(p_athlete uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to end a training block.'
      using errcode = '42501';
  end if;

  if not public.can_manage_training(p_athlete) then
    raise exception 'Only an admin, a coach with Manage staff, or one of this athlete''s own coaches can change their training block.'
      using errcode = '42501';
  end if;

  update public.training_blocks
     set ends_on = greatest(starts_on, current_date)
   where athlete_id = p_athlete
     and ends_on is null;

  if not found then
    raise exception 'This athlete has no open training block.' using errcode = '22023';
  end if;
end $$;

comment on function public.end_training_block(uuid) is
  'Closes the athlete''s open training block as of today, leaving them between '
  'blocks. Refuses with a sentence when nothing is open.';

revoke all     on function public.end_training_block(uuid) from public, anon, authenticated;
grant  execute on function public.end_training_block(uuid) to authenticated;


/**
 * Correct the label and the notes on a block.
 *
 * THE PHASE IS NOT AN ARGUMENT, and that is the whole design of this file in one
 * signature. A block records that an athlete spent those weeks doing that kind
 * of work. Editing the phase after the fact does not change what they did, it
 * changes what the record says they did, and there is then no version of the
 * history that is true. Moving somebody to a different phase is
 * `start_training_block`, which closes this block and opens the next one on
 * today's date, which is what actually happened.
 *
 * Neither are the dates. A block starts when it is started and ends when it is
 * ended; a hand-corrected start date is the same rewrite wearing a different
 * hat. If backdating a block ever becomes a real requirement, it belongs in a
 * later migration with its own gate and its own argument about who may do it.
 *
 * A CLOSED BLOCK IS EDITABLE. Writing up what a block was for is a thing coaches
 * do afterwards, and a note that can only be written while the block is open is
 * a note that gets written in a hurry or not at all.
 *
 * Both columns are written on every call, so passing null clears one. The editor
 * that calls this holds the whole pair on screen already.
 */
create or replace function public.edit_training_block(
  p_block uuid,
  p_label text,
  p_notes text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_athlete uuid;
  v_label   text;
  v_notes   text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to edit a training block.'
      using errcode = '42501';
  end if;

  -- The gate is about the block's athlete, not about the block, so it needs one
  -- lookup first. A missing row and a row the caller may not touch get different
  -- sentences on purpose: the first is a stale screen, the second is a boundary.
  select b.athlete_id into v_athlete
    from public.training_blocks b
   where b.id = p_block;

  if v_athlete is null then
    raise exception 'That training block no longer exists.' using errcode = '22023';
  end if;

  if not public.can_manage_training(v_athlete) then
    raise exception 'Only an admin, a coach with Manage staff, or one of this athlete''s own coaches can edit their training blocks.'
      using errcode = '42501';
  end if;

  v_label := nullif(btrim(coalesce(p_label, '')), '');
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');

  if char_length(coalesce(v_label, '')) > 120 then
    raise exception 'That block name is too long. Keep it to 120 characters or fewer.'
      using errcode = '22023';
  end if;
  if char_length(coalesce(v_notes, '')) > 2000 then
    raise exception 'Those notes are too long. Keep them to 2000 characters or fewer.'
      using errcode = '22023';
  end if;

  update public.training_blocks
     set label = v_label,
         notes = v_notes
   where id = p_block;
end $$;

comment on function public.edit_training_block(uuid, text, text) is
  'Rewrites the label and notes of one training block. The phase and the dates '
  'are deliberately not arguments: a phase change is a new block, because the '
  'history is the point of this table.';

revoke all     on function public.edit_training_block(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.edit_training_block(uuid, text, text) to authenticated;


-- ── 6. Verify ───────────────────────────────────────────────────────────────
--
-- Every result below was produced against a throwaway PostgreSQL 17 carrying
-- stand-ins for 011, 016 and 023 and this file applied verbatim, with one admin,
-- two coaches (the second holding manage_staff, and neither holding it by
-- default), and two athletes, the first assigned to the first coach only. Both
-- athletes are given a block by the admin before the refusals below, so that
-- every refusal is about authorization rather than about a missing row.
--
-- SHAPE first. One table, RLS on, and NOT ONE write policy:
--
--   select relname, relrowsecurity from pg_class where relname = 'training_blocks';
--   -- training_blocks | t
--
--   select policyname, cmd from pg_policies where tablename = 'training_blocks';
--   -- read training blocks | SELECT      (one row, and only one)
--
--   select privilege_type from information_schema.table_privileges
--    where table_name = 'training_blocks' and grantee = 'authenticated';
--   -- SELECT                              (one row: no INSERT, UPDATE or DELETE)
--
--   select privilege_type from information_schema.table_privileges
--    where table_name = 'training_blocks' and grantee = 'anon';        -- 0 rows
--
-- The four functions, all definer, and the predicate is the only stable one:
--
--   select proname, prosecdef, provolatile, proconfig from pg_proc
--    where proname in ('can_manage_training','start_training_block',
--                      'end_training_block','edit_training_block','training_blocks_touch')
--    order by proname;
--   -- can_manage_training   | t | s | {search_path=""}
--   -- edit_training_block   | t | v | {search_path=""}
--   -- end_training_block    | t | v | {search_path=""}
--   -- start_training_block  | t | v | {search_path=""}
--   -- training_blocks_touch | t | v | {search_path=""}
--
--   select has_function_privilege('anon', 'public.start_training_block(uuid,text,text,text)', 'execute');           -- f
--   select has_function_privilege('authenticated', 'public.start_training_block(uuid,text,text,text)', 'execute');  -- t
--   select has_function_privilege('authenticated', 'public.training_blocks_touch()', 'execute');                    -- f
--
-- and anon cannot reach any of it:
--
--   set role anon;
--   select * from public.training_blocks limit 1;
--   -- ERROR: permission denied for table training_blocks
--   select public.start_training_block(gen_random_uuid(), 'prep', null, null);
--   -- ERROR: permission denied for function start_training_block
--   select public.can_manage_training(gen_random_uuid());
--   -- ERROR: permission denied for function can_manage_training
--   reset role;
--
-- THE GATE, one tier at a time. The assigned coach is the case this file exists
-- for, and they hold no sensitive permission at all:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<coach one, assigned to athlete one>';
--     select public.has_permission('manage_staff');                    -- f
--     select public.can_manage_training('<athlete one>');              -- t
--     select public.can_manage_training('<athlete two>');              -- f
--     select public.start_training_block('<athlete one>', 'prep',
--                                        'Spring meet prep', 'Four weeks out.');
--     -- <a uuid>
--   commit;
--
-- THE UNASSIGNED-COACH REFUSAL, which is the boundary. Same coach, the athlete
-- who is not theirs, all three calls:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<coach one>';
--     select public.start_training_block('<athlete two>', 'prep', null, null);
--     -- ERROR (42501): Only an admin, a coach with Manage staff, or one of this
--     --                athlete's own coaches can change their training block.
--   rollback;
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<coach one>';
--     select public.end_training_block('<athlete two>');
--     -- ERROR (42501): Only an admin, a coach with Manage staff, or one of this
--     --                athlete's own coaches can change their training block.
--   rollback;
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<coach one>';
--     select public.edit_training_block('<athlete two''s open block>', 'Mine now', null);
--     -- ERROR (42501): Only an admin, a coach with Manage staff, or one of this
--     --                athlete's own coaches can edit their training blocks.
--   rollback;
--
-- and the same coach editing THEIR OWN athlete's block succeeds, or the gate is
-- too tight and the feature does not exist:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<coach one>';
--     select public.edit_training_block('<athlete one''s open block>',
--                                       'Spring meet prep, week two', 'Openers only.');
--     select label, notes, phase, updated_at > created_at from public.training_blocks
--      where athlete_id = '<athlete one>' and ends_on is null;
--     -- Spring meet prep, week two | Openers only. | prep | t
--   rollback;
--
-- A COACH HOLDING manage_staff reaches every athlete, assigned or not, which is
-- the second tier doing its job:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<coach two, manage_staff>';
--     select public.can_manage_training('<athlete one>');   -- t
--     select public.can_manage_training('<athlete two>');   -- t
--   rollback;
--
-- and an ATHLETE cannot write their own programming, which is the tier that
-- would be easiest to leave open by accident:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete one>';
--     select public.can_manage_training('<athlete one>');              -- f
--     select public.start_training_block('<athlete one>', 'off', null, null);
--     -- ERROR (42501): Only an admin, a coach with Manage staff, or one of this
--     --                athlete's own coaches can change their training block.
--   rollback;
--
-- A PHASE CHANGE IS A NEW BLOCK, and the old one closes rather than changes.
-- Two calls, two rows, one of them open:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<admin>';
--     select public.start_training_block('<athlete one>', 'competition', 'Meet week', null);
--   commit;
--
--   select phase, starts_on, ends_on, label from public.training_blocks
--    where athlete_id = '<athlete one>' order by starts_on desc, created_at desc;
--   -- competition | 2026-08-15 |            | Meet week
--   -- prep        | 2026-08-15 | 2026-08-15 | Spring meet prep
--   -- (the closed row ends the day it started, because both calls ran today.
--   --  That is the history working: the coach did start a prep block.)
--
--   select count(*) from public.training_blocks
--    where athlete_id = '<athlete one>' and ends_on is null;            -- 1
--
-- A SECOND OPEN BLOCK IS IMPOSSIBLE, and it is worth seeing fail as the owner,
-- with RLS out of the way entirely, because that is the guarantee the RPC's
-- close-then-insert is relying on:
--
--   insert into public.training_blocks (athlete_id, phase)
--   values ('<athlete one>', 'recovery');
--   -- ERROR: duplicate key value violates unique constraint "training_blocks_one_open_idx"
--
--   -- a CLOSED block alongside the open one is fine, which is what makes the
--   -- index partial rather than unique on the athlete:
--   insert into public.training_blocks (athlete_id, phase, starts_on, ends_on)
--   values ('<athlete one>', 'off', current_date - 60, current_date - 30);  -- INSERT 0 1
--
-- THE RACE, run as two real sessions rather than reasoned about. A starts a
-- block for an athlete and holds the transaction open; B starts a different one
-- for the same athlete a second later. B waits on A's close (it is trying to
-- update the same open row), and when A commits, B finds that row already closed
-- and skips it, then loses its own insert to the partial index:
--
--   -- session A
--   select public.start_training_block('<athlete one>', 'competition', 'A wins', null);
--   -- <a uuid>, then commit
--
--   -- session B, released the moment A commits
--   select public.start_training_block('<athlete one>', 'recovery', 'B loses', null);
--   -- ERROR (22023): Somebody else just started a block for this athlete.
--   --                Refresh the roster and try again.
--
--   -- and the athlete is left with exactly one open block, A's:
--   select phase, label, ends_on from public.training_blocks
--    where athlete_id = '<athlete one>' order by created_at;
--   -- prep        | Spring meet prep | 2026-08-15
--   -- competition | A wins           |
--
-- THE VALIDATION SENTENCES, as an admin. Every one of these is a screen message:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<admin>';
--
--     select public.start_training_block('<athlete one>', 'peaking', null, null);
--     -- ERROR (22023): That is not a training phase. Use development,
--     --                transition, prep, competition, recovery, injury or off.
--
--     select public.start_training_block('<athlete one>', '   ', null, null);
--     -- ERROR (22023): Pick a phase for this block.
--
--     select public.start_training_block('<athlete one>', 'prep', repeat('x', 121), null);
--     -- ERROR (22023): That block name is too long. Keep it to 120 characters or fewer.
--
--     select public.start_training_block('<athlete one>', 'prep', null, repeat('x', 2001));
--     -- ERROR (22023): Those notes are too long. Keep them to 2000 characters or fewer.
--
--     select public.start_training_block('<coach one>', 'prep', null, null);
--     -- ERROR (22023): Training blocks belong to athletes.
--
--     select public.start_training_block(gen_random_uuid(), 'prep', null, null);
--     -- ERROR (22023): That athlete account no longer exists.
--   rollback;
--
-- The SAME call as a coach stops one step earlier, and the difference is worth
-- knowing when reading a support ticket: an unknown id is assigned to nobody, so
-- the gate answers before the lookup ever runs.
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<coach one>';
--     select public.start_training_block(gen_random_uuid(), 'prep', null, null);
--     -- ERROR (42501): Only an admin, a coach with Manage staff, or one of this
--     --                athlete's own coaches can change their training block.
--   rollback;
--
--   -- 'PREP' and ' prep ' are the same phase. The client sends the key from its
--   -- own PHASES array, so this only ever matters to a REST caller:
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<admin>';
--     select public.start_training_block('<athlete two>', '  PREP  ', '  ', '  ');
--     select phase, label, notes from public.training_blocks
--      where athlete_id = '<athlete two>' and ends_on is null;
--     -- prep |  |     (label and notes are null, not two spaces)
--   rollback;
--
-- ENDING, and ending twice:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<admin>';
--     select public.end_training_block('<athlete one>');                  -- (void)
--     select count(*) from public.training_blocks
--      where athlete_id = '<athlete one>' and ends_on is null;            -- 0
--     select public.end_training_block('<athlete one>');
--     -- ERROR (22023): This athlete has no open training block.
--   rollback;
--
-- EDITING touches two columns and cannot touch the third:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<admin>';
--     select public.edit_training_block('<the competition block>',
--                                       'Meet week, rewritten', 'Openers only.');
--     select phase, label, notes, updated_at > created_at
--       from public.training_blocks where id = '<the competition block>';
--     -- competition | Meet week, rewritten | Openers only. | t
--     -- (the phase is untouched, and the touch trigger fired)
--
--     select public.edit_training_block('<the competition block>', null, null);
--     select label, notes from public.training_blocks where id = '<the competition block>';
--     -- (both null: passing null clears)
--
--     select public.edit_training_block(gen_random_uuid(), 'x', null);
--     -- ERROR (22023): That training block no longer exists.
--   rollback;
--
-- and there is no other way in. As the athlete whose block it is, and as a coach
-- with the whole board readable, every direct write is refused on the GRANT,
-- before RLS is consulted, because the table has no write grant at all:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete one>';
--     insert into public.training_blocks (athlete_id, phase)
--     values ('<athlete one>', 'off');
--     -- ERROR: permission denied for table training_blocks
--   rollback;
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<coach one>';
--     update public.training_blocks set phase = 'off' where athlete_id = '<athlete one>';
--     -- ERROR: permission denied for table training_blocks
--     delete from public.training_blocks where athlete_id = '<athlete one>';
--     -- ERROR: permission denied for table training_blocks
--   rollback;
--
-- READS. Staff see the board, an athlete sees themselves, and that is the whole
-- policy:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<coach one>';
--     select count(*) from public.training_blocks;             -- every row, both athletes
--   rollback;
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete one>';
--     select count(*) from public.training_blocks;             -- their own rows only
--     select count(*) from public.training_blocks
--      where athlete_id <> '<athlete one>';                    -- 0
--   rollback;
--
-- THE CASCADE, last, and it is the one destructive path in the file. Deleting an
-- account takes its blocks with it; deleting the coach who started them does
-- not:
--
--   -- two blocks, one started by coach one and one by the admin
--   select phase, created_by is null from public.training_blocks order by phase;
--   -- development | f
--   -- prep        | f
--
--   delete from public.profiles where id = '<coach one>';
--   select phase, created_by is null from public.training_blocks order by phase;
--   -- development | f
--   -- prep        | t          (their athlete's history survives them)
--
--   delete from public.profiles where id = '<athlete two>';
--   select count(*) from public.training_blocks
--    where athlete_id = '<athlete two>';                    -- 0
--   select count(*) from public.training_blocks;            -- 1
--
-- RE-RUNNABILITY. Applying this file twice replaces four functions, re-creates
-- one policy and one trigger, and changes no data:
--
--   \i supabase/migrations/044_training_blocks.sql
--   select count(*) from public.training_blocks;              -- unchanged
--   select count(*) from pg_policies where tablename = 'training_blocks';   -- 1
-- ============================================================
