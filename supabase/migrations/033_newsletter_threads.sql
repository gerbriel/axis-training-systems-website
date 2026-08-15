-- ============================================================
-- Axis Training Systems, 033: a newsletter is not a conversation
-- ============================================================
--
-- 030 shipped the fan-out with a sentence in its header that reads, six months
-- later, like a decision nobody actually made: "a reply is an ordinary
-- conversation with the person who sent it rather than a dead end." The reply
-- was the whole justification for one broadcast conversation per recipient
-- instead of one shared channel. It is also the part the studio does not want.
--
-- A newsletter is an ANNOUNCEMENT. Meet week moved, invoicing changed, bring
-- your singlet. Forty athletes each typing "thanks!" back into forty threads is
-- not a conversation, it is a mailbox the head coach now has to clear, and the
-- athlete who genuinely needs to ask something already has a DM with their
-- coach sitting one tab away. So this file reverses that half of 030: the
-- fan-out stays exactly as it is, and the reply goes.
--
-- WHAT THE FAN-OUT STILL BUYS, now that nobody replies. Per-person unread,
-- per-person realtime, and a delivery record. One shared channel would give a
-- single unread flag for everybody and no way to answer "did Devin ever open
-- it". Those are worth the rows on their own, and section 3 is the surface that
-- finally reads the delivery record back out: one call per newsletter that
-- answers who got it and who has seen it, instead of the sender scrolling N
-- broadcast threads counting bold rows.
--
-- WHERE THE HOLE IS. 023's `messages` INSERT policy says you, active, in the
-- room, and says nothing about what kind of room. A broadcast is a room the
-- recipient is in, so the policy admits their reply. That is not an oversight in
-- 023 either, it was the intent at the time. Section 2 adds the fourth clause.
--
-- WHY A POLICY AND NOT A UI CHANGE. The composer disappearing from the
-- Newsletters tab is a rendering decision, and a rendering decision is not a
-- rule. Anybody with the anon key and a conversation id could still POST a row
-- into somebody's broadcast, and it would arrive in the sender's inbox looking
-- like a reply, because a broadcast has two members and one of them is the
-- sender. The rule belongs in the database and the tab is how it is presented.
--
-- WHY THE FAN-OUT DOES NOT BREAK. `send_newsletter` is SECURITY DEFINER. It
-- executes as the function owner, which owns `messages` and is therefore not
-- policy-checked at all, so the delivery insert in its section 5 goes in exactly
-- as it did yesterday. Nothing in this file touches it. Section 7 has the test
-- that proves both halves at once: the send succeeds, the recipient's reply into
-- the conversation it produced is refused.
--
--
-- THREE DEFECTS, FOLDED IN. A review of 023 and 030 turned up three, all in the
-- same neighbourhood as the change above, all cheaper to fix in one file than to
-- carry until somebody trips over them. They are sections 4, 5 and 6, and each
-- one states its own reasoning.
--
--   4. `athlete_coaches` writes were gated on `manage_athletes`, which 016 hands
--      to every coach by default. The assignment table is what `can_message()`
--      reads, so a coach could assign themselves any athlete on the roster and
--      then message them. The write moves to `manage_staff`, which is sensitive.
--
--   5. `messages` was granted INSERT on every column, so a client could supply
--      its own `id` and its own `created_at`. A forged timestamp reorders a
--      thread and dates a message to before it was written. The grant becomes
--      column level.
--
--   6. `poll_results_multi` had no authorization at all. Any signed-in account
--      could read the tallies of any poll by id. It now returns rows only for
--      polls the caller can read.
--
-- ORDER MATTERS HERE MORE THAN USUAL, and it is worth saying once rather than
-- three times below. Sections 2, 4 and 5 all narrow something 023 declares:
-- the messages INSERT policy, the athlete_coaches write policies, and the
-- messages INSERT grant. 023 creates each of those with `drop policy if exists`
-- and `revoke ... grant ...`, so REPLAYING 023 ON ITS OWN REVERTS ALL THREE.
-- Applying the directory in filename order always leaves this file last, which
-- is the normal case and is fine. Running a single earlier file by hand is not:
-- re-apply this one after it. Section 7 has the three queries that say whether
-- the current database is in the state this file describes.
--
-- Requires 023_messaging_foundation.sql and 030_newsletter_broadcasts.sql.
--
-- Re-runnable.
-- ============================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────
--
-- Same courtesy 030 extends: fail with a sentence rather than forty lines down
-- with "function public.can_read_poll(uuid) does not exist".

do $do$
begin
  if to_regclass('public.conversations') is null then
    raise exception
      'Run 023_messaging_foundation.sql before 033_newsletter_threads.sql.'
      using errcode = '22023';
  end if;
  if to_regclass('public.newsletters') is null then
    raise exception
      'Run 030_newsletter_broadcasts.sql before 033_newsletter_threads.sql.'
      using errcode = '22023';
  end if;
end
$do$;


-- ── 1. Is this room a broadcast ─────────────────────────────────────────────
--
-- 023 section 4 lays down the rule this follows: a policy on a messaging table
-- never inlines a read of another messaging table, it calls a definer function
-- that answers the one question. Here the question is about `conversations`,
-- and a policy on `messages` that inlined `exists (select 1 from conversations
-- where ...)` would drag 023's "members read conversations" policy into every
-- single INSERT check, which is a membership test the policy is already doing
-- one clause earlier. The definer hop skips that entirely and the answer is one
-- primary key probe.
--
-- A conversation id that does not exist answers false rather than raising. That
-- is correct and it costs nothing: the same policy's `is_conversation_member`
-- clause has already refused a stale id, so the only caller who can reach a
-- false from this function is one who is genuinely in a room that is genuinely
-- not a broadcast.

create or replace function public.conversation_is_broadcast(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.conversations c
     where c.id = p_conversation_id
       and c.kind = 'broadcast'
  )
$$;

comment on function public.conversation_is_broadcast(uuid) is
  'True when that conversation is a newsletter delivery. Used by the messages '
  'INSERT policy to refuse replies into a broadcast; false for a missing id.';

revoke all     on function public.conversation_is_broadcast(uuid) from public, anon;
grant  execute on function public.conversation_is_broadcast(uuid) to authenticated, service_role;


-- ── 2. Newsletters do not take replies ──────────────────────────────────────
--
-- The policy from 023 section 5 with a fourth clause. The first three are
-- unchanged and are still the three things that can be false about an ordinary
-- send: a forged sender, a suspended account, a stale or foreign conversation.
-- The fourth is new and is about the room rather than the person.
--
-- Recreated whole rather than altered, because `alter policy` cannot add to a
-- WITH CHECK without restating it anyway, and a policy that is defined in two
-- files is a policy nobody can read in one place. The drop-and-create is also
-- what makes this file re-runnable.
--
-- This is an RLS refusal and NOT a raise, so it arrives at the client as 42501
-- with the standard "new row violates row-level security policy" text rather
-- than as one of our own sentences. That is deliberate. The UI does not offer a
-- composer on a newsletter at all, so anything that reaches here is a stale tab
-- or somebody with a REST client, and neither is owed a hand-written apology.
-- `messagingApi.sendMessage` already maps 42501 to a sentence of its own.
--
-- What this does NOT restrict: `send_newsletter` (030 section 5), which is
-- SECURITY DEFINER and runs as the owner of `messages`. The owner is not policy
-- checked, so the fan-out's own insert is unaffected. If a send ever starts
-- failing with a policy violation, something has made that function INVOKER or
-- turned on FORCE ROW LEVEL SECURITY, and this clause is the thing that would
-- notice first.

drop policy if exists "members send messages" on public.messages;

create policy "members send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_axis_active()
    and public.is_conversation_member(conversation_id)
    and not public.conversation_is_broadcast(conversation_id)
  );


-- ── 3. Who a newsletter went to, and who has seen it ────────────────────────
--
-- The sender's half of the reversal. Before this, "who did this go to" was
-- answerable only by opening N broadcast conversations, and "have they seen it"
-- was not answerable at all, because `conversation_members.unread` belongs to
-- rooms the sender can read but is scattered across one row per recipient.
--
-- One call, one newsletter, one list. `seen` is `not unread`, which is the same
-- boolean the recipient's own inbox badge reads, so there is no second read
-- model to fall out of step. `delivered_at` is the broadcast conversation's
-- `created_at`, which is the moment the fan-out ran.
--
-- WHAT IT DOES NOT EXPOSE, and this is the line that matters: votes. Nothing in
-- this projection touches `poll_votes`, and there is no shape of result from it
-- that pairs a person with an option. 030 section 6 is explicit that a poll
-- whose author can see who voted for what is not a poll people answer honestly,
-- and joining delivery to voting here would undo that in one line. Delivery is
-- not anonymous and never was; the vote is.
--
-- SECURITY DEFINER for 023's reason and 030's reason at once: it reads
-- `profiles` rows the caller has no policy for, and it reads the membership
-- rows of conversations the caller is only sometimes in.
--
-- Gated on the sender tier, the same `is_axis_admin() or send_marketing` pair
-- 030 uses for every write in the feature. A raise rather than an empty result,
-- because an empty list and a refusal look identical on screen and only one of
-- them is worth showing a person. The text is the sentence the UI prints.
--
-- The member excluded is the one whose profile is `conversations.created_by`,
-- the sender. If that column is null the sender's account was deleted, and the
-- comparison is `is distinct from`, so nobody is excluded rather than everybody:
-- a list with one extra row in it beats a list that is silently empty.

create or replace function public.newsletter_recipients(p_newsletter_id uuid)
returns table (
  id           uuid,
  display_name text,
  avatar_url   text,
  role         public.user_role,
  seen         boolean,
  delivered_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_axis_admin() or public.has_permission('send_marketing')) then
    raise exception 'Only newsletter senders can see recipients.'
      using errcode = '22023';
  end if;

  return query
    select
      p.id,
      -- The same three-step fallback `messaging_profiles` uses (023 section 9),
      -- restated rather than shared because that function projects seven columns
      -- for a different question and this one must not grow to match it.
      coalesce(
        nullif(btrim(coalesce(p.display_name, '')), ''),
        nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
        'Member'
      ),
      p.avatar_url,
      p.role,
      not m.unread,
      c.created_at
      from public.conversations        c
      join public.conversation_members m on m.conversation_id = c.id
      join public.profiles             p on p.id = m.profile_id
     where c.newsletter_id = p_newsletter_id
       and c.kind = 'broadcast'
       and m.profile_id is distinct from c.created_by
     -- By ordinal, because `display_name` is also an output parameter of this
     -- function and naming it here would be ambiguous. 023 does the same.
     order by 2;
end
$$;

comment on function public.newsletter_recipients(uuid) is
  'Sender-tier only: everybody a newsletter was delivered to, with their seen '
  'state and delivery time. Exposes delivery, never votes.';

revoke all     on function public.newsletter_recipients(uuid) from public, anon;
grant  execute on function public.newsletter_recipients(uuid) to authenticated, service_role;


-- ── 4. Assigning a coach is a staffing decision ─────────────────────────────
--
-- DEFECT. 023 section 2 gates both writes on `is_axis_admin() or
-- has_permission('manage_athletes')`, and the comment above them argues that
-- deciding who works with whom is the roster and `manage_athletes` is the roster
-- permission. The argument is fine. The fact underneath it is not: 016 section
-- 11 lists `manage_athletes` among the SEVEN COACH DEFAULTS. Every coach holds
-- it the day their account is created, without an admin ever deciding anything.
--
-- What that buys an ordinary coach, today, with no help from anybody:
--
--   insert into public.athlete_coaches (athlete_id, coach_id)
--   values ('<any athlete on the roster>', '<themselves>');
--
-- and `can_message()` (023 section 8) now returns true for that pair, because
-- its coach branch is exactly `exists (select 1 from athlete_coaches where
-- athlete_id = target and coach_id = me)`. The matrix that section spends forty
-- lines explaining, the one whose stated purpose is that a coach cannot reach an
-- athlete they do not work with on a platform where the members are minors as
-- often as not, is defeated by one row the coach writes themselves. They can
-- also unassign an athlete from a colleague, which is quieter and worse.
--
-- The read policy is deliberately NOT changed. An athlete reading their own
-- coaches is what makes their contact list render, a coach reading their own
-- roster is the same, and `manage_athletes` seeing the whole board is what the
-- People panel's matrix needs. Reading who works with whom was never the hole.
--
-- The writes move to `manage_staff`, which 016 flags `is_sensitive` and which
-- only an admin can hand out. That is the right key on the merits and not just
-- for safety: an assignment is roster placement, and 016's own description of
-- `manage_staff` is "Add and edit coach records, calendars and roster
-- placement". The word is already in the catalogue.
--
-- Nothing in the app breaks. The only screen that writes an assignment is
-- `UserManagementPanel`, the People tab of the admin portal, and the admin
-- portal is closed to coaches and athletes before any of this is reached.
--
-- The policies are renamed for the rule they now state, so a reviewer reading
-- `pg_policies` sees the truth rather than a name from a previous decision. Both
-- old names and both new ones are dropped first, which is what makes re-running
-- this file, or re-running 023 after it, land somewhere predictable. Note the
-- ordering hazard: 023 recreates its own pair, so replaying 023 alone reopens
-- this. Replay 033 after it.

drop policy if exists "manage_athletes assigns coaches"   on public.athlete_coaches;
drop policy if exists "manage_athletes unassigns coaches" on public.athlete_coaches;
drop policy if exists "manage_staff assigns coaches"      on public.athlete_coaches;
drop policy if exists "manage_staff unassigns coaches"    on public.athlete_coaches;

-- WHO: an admin, or somebody an admin trusted with staffing. A coach holding
-- only the default `manage_athletes` may read this table and may not write it.
create policy "manage_staff assigns coaches"
  on public.athlete_coaches for insert to authenticated
  with check (public.is_axis_admin() or public.has_permission('manage_staff'));

create policy "manage_staff unassigns coaches"
  on public.athlete_coaches for delete to authenticated
  using (public.is_axis_admin() or public.has_permission('manage_staff'));


-- ── 5. A client may not date its own message ────────────────────────────────
--
-- DEFECT. 023 section 5 ends with `grant select, insert on public.messages to
-- authenticated`, and an unqualified INSERT grant is a grant on EVERY column.
-- `messages` has five, and two of them are defaulted precisely because nobody is
-- supposed to supply them:
--
--   insert into public.messages (conversation_id, sender_id, body, created_at)
--   values ('<a room I am in>', auth.uid(), 'said it last week',
--           now() - interval '7 days');
--
-- Every clause of the INSERT policy is satisfied. It is my own room, I am the
-- sender, I am active. The row lands, `message_after_insert` copies the forged
-- timestamp into `conversations.last_message_at`, and the thread now contains a
-- message I can point at that says I told them on the Monday. A coaching thread
-- is a record of what was said and when, and this is the one column in the
-- schema where "when" lives. `id` is the smaller half of the same problem: a
-- chosen id lets a client collide with, or squat on, a row it does not own.
--
-- The fix is the grant, not a policy and not a trigger. A WITH CHECK cannot see
-- whether a column was supplied or defaulted, only what it ended up as, so a
-- policy would have to compare `created_at` against `now()` with a tolerance,
-- and a trigger doing `new.created_at := now()` would also overwrite the
-- deliberate values a restore or a backfill needs to write as the owner. A
-- column-level grant refuses the attempt at the door, before RLS is consulted,
-- and it is invisible to every legitimate caller: nothing may write those two
-- columns, so both defaults always apply.
--
-- The revoke is what makes this re-runnable. Revoking a table-level privilege
-- takes the column-level ones with it, so this pair is the same on the first run
-- and the fifth. SELECT is untouched: the client reads all five columns back,
-- and `sendMessage` returns the inserted row precisely so the real id and the
-- real timestamp replace the optimistic bubble.
--
-- `messagingApi.sendMessage` already inserts exactly these three columns, so
-- this is a lock on a door the app was not using. Verified before the grant
-- narrowed, not after.

revoke insert on public.messages from authenticated;
grant  insert (conversation_id, sender_id, body) on public.messages to authenticated;


-- ── 6. Tallies belong to the people who were sent the poll ──────────────────
--
-- DEFECT. `poll_results_multi` (030 section 7) is SECURITY DEFINER, takes an
-- array of poll ids, and asks nothing at all about who is calling. Every other
-- poll object in 030 is careful: `polls` and `poll_options` have SELECT policies
-- naming the sender tier and `can_read_poll`, `poll_votes` shows you your own
-- row and nobody else's, and `cast_vote` restates the readability check in its
-- own body with a comment explaining that "can write" must never be wider than
-- "can see". The aggregate is the one place that was left open, and being
-- definer means the caller's own policies never get a chance to narrow it.
--
-- The exposure is small and real. An athlete who was not in the audience of a
-- staff-only send, holding a poll id from anywhere, learns the result of a vote
-- they were never part of. Poll ids are uuids and are not published, so this is
-- an accident waiting on a leak rather than an open door. It is still the kind
-- of thing that is embarrassing to explain and free to close.
--
-- The check is `can_read_poll`, which is the same function the `poll_options`
-- policy uses and which resolves to 030's `can_read_newsletter`: the poll's
-- newsletter is sent AND the caller is a member of one of its broadcast
-- conversations. Delivery is the permission, exactly as section 3 of 030 argues.
-- The sender tier is admitted alongside it so the composer can still read the
-- results of anything it can see, including a draft's poll before it goes out.
--
-- Filtered once per requested poll id rather than once per vote row. The
-- straightforward spelling puts the predicate in the WHERE clause of the
-- aggregate, where a stable definer function is evaluated against every row of
-- `poll_votes` that matches; on a poll with four hundred votes that is four
-- hundred evaluations of a three-table exists. Resolving the id list first costs
-- one evaluation per id, at most one screenful of them, and the two spellings
-- return the same rows.
--
-- Unchanged: the projection. Poll id, option id, count. No voter ids, no shape
-- from which one could be derived. That property is why the feed can show
-- percentages at all, and it survives this file untouched.

create or replace function public.poll_results_multi(p_poll_ids uuid[])
returns table (poll_id uuid, option_id uuid, votes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with readable as (
    select t.id
      from unnest(coalesce(p_poll_ids, '{}'::uuid[])) as t(id)
     where public.is_axis_admin()
        or public.has_permission('send_marketing')
        or public.can_read_poll(t.id)
  )
  select v.poll_id, v.option_id, count(*) as votes
    from public.poll_votes v
    join readable r on r.id = v.poll_id
   group by v.poll_id, v.option_id
$$;

comment on function public.poll_results_multi(uuid[]) is
  'Aggregate tallies for polls the caller may read: the sender tier, or anybody '
  'the poll''s newsletter was delivered to. Counts only, never voter ids.';

revoke all     on function public.poll_results_multi(uuid[]) from public, anon;
grant  execute on function public.poll_results_multi(uuid[]) to authenticated, service_role;


-- ── 7. Verify ───────────────────────────────────────────────────────────────
--
-- Shape first. The helper, the RPC, and the policy with its fourth clause:
--
--   select proname, prosecdef from pg_catalog.pg_proc
--    where proname in ('conversation_is_broadcast','newsletter_recipients');   -- both t
--
--   select policyname, with_check from pg_policies
--    where tablename = 'messages' and cmd = 'INSERT';
--   -- 'members send messages', and the expression contains
--   -- (NOT conversation_is_broadcast(conversation_id))
--
--   select policyname, cmd from pg_policies
--    where tablename = 'athlete_coaches' order by cmd;
--   -- SELECT 'read your own coaching assignments'
--   -- INSERT 'manage_staff assigns coaches'
--   -- DELETE 'manage_staff unassigns coaches'
--
-- The column grant. Three rows, and `id` and `created_at` are not among them:
--
--   select column_name, privilege_type from information_schema.column_privileges
--    where table_name = 'messages' and grantee = 'authenticated'
--      and privilege_type = 'INSERT';                    -- conversation_id, sender_id, body
--
-- Anon still has nothing, including the two new functions:
--
--   set role anon;
--   select public.conversation_is_broadcast(gen_random_uuid());  -- permission denied
--   select public.newsletter_recipients(gen_random_uuid());      -- permission denied
--   select public.poll_results_multi(array[]::uuid[]);           -- permission denied
--   reset role;
--
-- Now the behaviour, against a real send. As an admin or a send_marketing coach:
--
--   insert into public.newsletters (subject, body, audience)
--   values ('Meet week', 'Weigh-ins move to Thursday at 6.', 'athletes')
--   returning id;                                                -- <news>
--   select public.upsert_newsletter_poll('<news>', 'Which session suits you?',
--                                        array['Morning','Evening']);
--   select public.send_newsletter('<news>');                      -- {"sent": n}
--
-- The send is the first assertion of this file: it proves section 2 did not
-- break the fan-out, because `send_newsletter` is definer and the owner is not
-- policy checked. Now the recipient, in their own transaction:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a recipient uuid>';
--
--     -- they can see it, and their inbox still counts it
--     select count(*) from public.conversations where kind = 'broadcast';  -- 1
--     select count(*) from public.messages;                                -- 1
--
--     -- and they cannot answer it
--     insert into public.messages (conversation_id, sender_id, body)
--     values ('<their broadcast id>', '<recipient uuid>', 'thanks!');
--     -- ERROR: new row violates row-level security policy for table "messages"
--   rollback;
--
-- The same insert into their DM with their coach must still SUCCEED, or the
-- fourth clause is too wide:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a recipient uuid>';
--     insert into public.messages (conversation_id, sender_id, body)
--     values ('<their dm id>', '<recipient uuid>', 'quick question');       -- INSERT 0 1
--   rollback;
--
-- Forging a timestamp fails on the grant rather than on the policy, which is a
-- DIFFERENT error and the point of section 5. Note it fails in the DM, the room
-- where the insert is otherwise perfectly legal:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a recipient uuid>';
--     insert into public.messages (conversation_id, sender_id, body, created_at)
--     values ('<their dm id>', '<recipient uuid>', 'said it last week',
--             now() - interval '7 days');
--     -- ERROR: permission denied for table messages
--   rollback;
--
--   -- and the same for a chosen id
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a recipient uuid>';
--     insert into public.messages (id, conversation_id, sender_id, body)
--     values (gen_random_uuid(), '<their dm id>', '<recipient uuid>', 'mine');
--     -- ERROR: permission denied for table messages
--   rollback;
--
-- The recipient list, as the sender. n rows, none of them the sender:
--
--   select display_name, role, seen, delivered_at
--     from public.newsletter_recipients('<news>');
--   -- every row seen = false until somebody opens it
--   select count(*) from public.newsletter_recipients('<news>');   -- n
--
--   -- after the recipient's client calls mark_conversation_read
--   select seen from public.newsletter_recipients('<news>')
--    where id = '<recipient uuid>';                                -- t
--
-- And it refuses everybody else. A PLAIN COACH is the case that matters, since
-- they hold six permissions by default and none of them is this one:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a plain coach uuid>';
--     select * from public.newsletter_recipients('<news>');
--     -- ERROR: Only newsletter senders can see recipients.
--   rollback;
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a recipient uuid>';
--     select * from public.newsletter_recipients('<news>');
--     -- ERROR: Only newsletter senders can see recipients.
--   rollback;
--
-- Section 4, as that same plain coach. This is the insert that used to succeed:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a plain coach uuid>';
--     select public.has_permission('manage_athletes');   -- t, still, by role default
--     select public.has_permission('manage_staff');      -- f
--     insert into public.athlete_coaches (athlete_id, coach_id)
--     values ('<an athlete they do not coach>', '<the coach uuid>');
--     -- ERROR: new row violates row-level security policy for table "athlete_coaches"
--   rollback;
--
--   -- unassigning somebody else's athlete is refused as a silent zero, because
--   -- DELETE is filtered by USING rather than raised
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a plain coach uuid>';
--     delete from public.athlete_coaches where athlete_id = '<any athlete>';  -- DELETE 0
--     select count(*) from public.athlete_coaches;       -- their own rows, readable
--   rollback;
--
-- An admin still writes both, or the People panel is broken:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<admin uuid>';
--     insert into public.athlete_coaches (athlete_id, coach_id)
--     values ('<athlete>', '<coach>');                                    -- INSERT 0 1
--     delete from public.athlete_coaches
--      where athlete_id = '<athlete>' and coach_id = '<coach>';           -- DELETE 1
--   rollback;
--
-- Section 6. The recipient sees the tally of the poll they were sent; somebody
-- who was not in the audience gets nothing at all from the same id:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a recipient uuid>';
--     select public.cast_vote('<poll>', '<option>');
--     select * from public.poll_results_multi(array['<poll>']::uuid[]);   -- 1 row, votes 1
--   commit;
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<somebody outside the audience>';
--     select count(*) from public.poll_results_multi(array['<poll>']::uuid[]);  -- 0
--   rollback;
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<admin uuid>';
--     select count(*) from public.poll_results_multi(array['<poll>']::uuid[]);  -- 1
--   rollback;
--
-- Re-runnability, last. Applying this file twice must change nothing, and
-- applying 023 after it re-opens section 4 by design, since 023 recreates its
-- own pair of policies:
--
--   \i supabase/migrations/033_newsletter_threads.sql
--   select count(*) from pg_policies
--    where tablename = 'athlete_coaches' and policyname like 'manage_staff%';   -- 2
--   select count(*) from information_schema.column_privileges
--    where table_name = 'messages' and grantee = 'authenticated'
--      and privilege_type = 'INSERT';                                           -- 3
--
-- Re-runnable.
-- ============================================================
