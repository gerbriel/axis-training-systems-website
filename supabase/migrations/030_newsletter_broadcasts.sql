-- ============================================================
-- Axis Training Systems — 022: the newsletter that goes out
-- ============================================================
--
-- 015 got `newsletter_leads` under version control and was honest about what it
-- is: a capture list. Somebody types their email on the guides page and lands in
-- a table nobody sends anything to. The word "newsletter" has meant a form field
-- here since June. This file is the other half, the one that leaves.
--
-- It does not send email. There is no Resend call, no queue, no bounce handling,
-- no unsubscribe link to honour. A newsletter is DELIVERED INTO THE APP, on top
-- of the messaging tables 021 builds: sending fans the newsletter out as one
-- broadcast conversation per recipient, carrying one message from the sender.
-- The athlete opens Messages and it is sitting there, unread, next to their
-- coach. That is the whole delivery mechanism.
--
-- WHY ONE CONVERSATION PER RECIPIENT rather than a single shared channel that
-- everybody is dropped into. Because of the reply. A shared channel means the
-- first athlete who answers "will this be recorded?" is answering to the entire
-- roster, and the coach who wants to answer them privately has to remember to go
-- and start a DM. A per-recipient conversation makes the reply an ordinary
-- private thread with the sender, which is what the sender expects and what the
-- athlete expects. The cost is honest and stated: ten newsletters leave every
-- athlete holding ten broadcast conversations. The inbox sorts by
-- last_message_at, so they sink; nothing has to garbage-collect them.
--
-- AUDIENCE. The reference implementation this is ported from fanned out to every
-- active member, full stop. Axis has three roles and the two obvious sends are
-- "meet schedule changed" (athletes) and "reminder about invoicing" (staff), so
-- `audience` is a column here rather than a filter somebody remembers to apply:
-- all / athletes / staff, checked in the table, honoured in the RPC.
--
-- THE LENGTH BUG, FIXED HERE BY CONSTRUCTION. In the implementation this ports,
-- `newsletters.body` allowed 20 000 characters and `messages.body` allowed
-- 8 000. Any newsletter longer than 8 000 characters passed its own check,
-- passed the composer, and then raised 23514 halfway through the fan-out. The
-- whole send rolled back and the author had no idea why. Both limits are 8 000
-- here: the constraint below, and the body check 021 puts on `messages`. A body
-- that can be saved is a body that can be delivered. Do not raise one without
-- the other; section 9 has the query that proves they still agree.
--
-- POLL WRITES HAVE NO POLICIES AT ALL. `polls`, `poll_options` and `poll_votes`
-- get SELECT policies and nothing else, and no insert/update/delete grants. The
-- three SECURITY DEFINER RPCs at the bottom are the only way anything is ever
-- written to them. This is deliberate and it is the same reasoning as 021's
-- conversation tables: "one vote per person, only on a poll you can actually
-- see, only while it is open, rate limited" is four rules, and a WITH CHECK
-- expression that tries to be all four is a place where the fifth rule gets
-- forgotten. A refusal from an RPC also arrives as a sentence the UI can print,
-- which a policy violation never does.
--
-- ONE THING THE SCHEMA DOES NOT DO, said plainly. Editing a sent newsletter
-- rewrites the News feed but does NOT rewrite the messages already delivered:
-- those are frozen copies, which is the point of delivering them as messages.
-- The composer therefore edits drafts only. No trigger enforces that, because
-- an admin fixing a typo on a sent newsletter is a reasonable thing to want and
-- the divergence is cosmetic.
--
-- Requires 021_messaging_foundation.sql: `conversations`, `conversation_members`,
-- `messages`, `is_axis_active()` and `enforce_message_rate_limit()` all come from
-- there. 021 also declares `conversations.newsletter_id` as a bare uuid, because
-- this table did not exist yet; section 4 below is the foreign key it was always
-- meant to have.
--
-- Re-runnable.
-- ============================================================


-- ── 1. Preconditions ────────────────────────────────────────────────────────
--
-- 022 references four objects from 021. Failing here with a sentence beats
-- failing forty lines down with "relation public.conversations does not exist".

do $do$
begin
  if to_regclass('public.conversations') is null then
    raise exception
      'Run 021_messaging_foundation.sql before 022_newsletter_broadcasts.sql.'
      using errcode = '22023';
  end if;
end
$do$;


-- ── 2. The newsletters table ────────────────────────────────────────────────
--
-- `status` is draft or sent and there is no third state. Sending is not a job
-- that can be queued, retried or half-finished: send_newsletter() does the whole
-- fan-out in one transaction and either every recipient got it or nobody did.
--
-- `recipient_count` is written at send time and never recomputed. It records who
-- the audience WAS on the day, which is the number the author wants six months
-- later, not "how many active athletes are there now".

create table if not exists public.newsletters (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid references public.profiles (id) on delete set null,
  subject         text        not null,
  body            text        not null,
  audience        text        not null default 'all',
  status          text        not null default 'draft',
  recipient_count int         not null default 0,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,

  constraint newsletters_subject_len check (
    btrim(subject) <> '' and char_length(subject) <= 200
  ),
  -- 8 000 is not a taste decision. It is messages_body_len from 021. See header.
  constraint newsletters_body_len check (
    btrim(body) <> '' and char_length(body) <= 8000
  ),
  constraint newsletters_audience_known check (
    audience in ('all', 'athletes', 'staff')
  ),
  constraint newsletters_status_known check (
    status in ('draft', 'sent')
  )
);

-- Both surfaces read newest-first: the composer's draft/sent lists and the
-- athlete-facing News feed.
create index if not exists newsletters_created_at_idx
  on public.newsletters (created_at desc);


-- ── 3. Who can read a newsletter ────────────────────────────────────────────
--
-- Two tiers, and they answer different questions.
--
-- The SENDER TIER is 018's idiom exactly: an admin, or a coach the admin has
-- trusted with `send_marketing`. 016 created that key with the label "Send
-- marketing / Newsletters and broadcast email" and left it inert because no
-- policy had ever adopted it. This is the adoption. They see everything,
-- including drafts, and they are the only ones who can write.
--
-- The RECIPIENT TIER is the interesting one: you may read a sent newsletter if
-- it was actually delivered to you, which is to say if there is a broadcast
-- conversation for it that you are a member of. Not "if you are active" — an
-- athlete has no business reading a newsletter that went to staff only. The
-- delivery IS the permission, so the audience filter is enforced once, in the
-- fan-out, and never has to be re-derived at read time by comparing your role
-- against a column that may since have changed.
--
-- can_read_newsletter() exists so that this question is asked in exactly one
-- place. It is SECURITY DEFINER for the usual two reasons: it reads `profiles`-
-- adjacent rows the caller has no policy for, and it is the recursion-breaker —
-- a policy on `newsletters` that inlined `exists (select ... from newsletters)`
-- would re-enter its own policy, and one that inlined a read of `conversations`
-- would drag 021's membership policy into every row check.

create or replace function public.can_read_newsletter(p_newsletter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_newsletter_id is not null
     and auth.uid() is not null
     and exists (
       select 1
         from public.newsletters n
         join public.conversations c        on c.newsletter_id  = n.id
         join public.conversation_members m on m.conversation_id = c.id
        where n.id = p_newsletter_id
          and n.status = 'sent'
          and m.profile_id = auth.uid()
     )
$$;

comment on function public.can_read_newsletter(uuid) is
  'True when the caller was actually delivered this newsletter: it is sent and '
  'they are a member of one of its broadcast conversations. Delivery is the '
  'permission, so the audience filter is enforced once at send time.';

revoke all     on function public.can_read_newsletter(uuid) from public, anon;
grant  execute on function public.can_read_newsletter(uuid) to authenticated, service_role;


alter table public.newsletters enable row level security;

revoke all on public.newsletters from anon, authenticated;
grant  select, insert, update, delete on public.newsletters to authenticated;

drop policy if exists "senders manage newsletters"      on public.newsletters;
drop policy if exists "recipients read sent newsletters" on public.newsletters;

-- WHO: an admin, or a coach granted send_marketing. Read and write, drafts
-- included. Anon is not in the TO list, so the public sees nothing at all.
create policy "senders manage newsletters"
  on public.newsletters for all to authenticated
  using       (public.is_axis_admin() or public.has_permission('send_marketing'))
  with check  (public.is_axis_admin() or public.has_permission('send_marketing'));

-- WHO: anybody a copy was delivered to. Read only, sent only. `status = 'sent'`
-- is restated here even though the helper checks it, because a policy that does
-- not say what it lets through is a policy nobody can review.
create policy "recipients read sent newsletters"
  on public.newsletters for select to authenticated
  using (status = 'sent' and public.can_read_newsletter(id));


-- ── 4. The foreign key 021 could not declare ────────────────────────────────
--
-- 021 creates `conversations.newsletter_id` as a plain nullable uuid because
-- `public.newsletters` did not exist when that file ran. This is the constraint
-- it was always going to be. `on delete set null`: deleting a newsletter must
-- not delete the conversations it produced, because those conversations contain
-- replies, and a reply belongs to the two people who wrote it, not to the
-- newsletter that happened to start the thread.
--
-- `add constraint` has no IF NOT EXISTS, hence the catalog check.

do $do$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conname  = 'conversations_newsletter_id_fkey'
       and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations
      add constraint conversations_newsletter_id_fkey
      foreign key (newsletter_id) references public.newsletters (id)
      on delete set null;
  end if;
end
$do$;

-- Partial: only broadcasts carry a newsletter_id, and every lookup through this
-- column (can_read_newsletter, the News feed, delete cascades) supplies a real
-- id. No reason to index the millions of nulls that DMs and channels will be.
create index if not exists conversations_newsletter_id_idx
  on public.conversations (newsletter_id)
  where newsletter_id is not null;


-- ── 5. send_newsletter() — the fan-out ──────────────────────────────────────
--
-- SET-BASED, not a loop. Three inserts total regardless of roster size: the
-- conversation ids are minted up front into an array so the membership rows and
-- the message rows can be joined back to their conversation without a RETURNING
-- round trip per recipient.
--
-- Note what this function does NOT do: it never touches `unread`. 021's
-- `message_after_insert` trigger is what stamps the rollup columns and flips the
-- recipient's flag, and it fires on the message insert below exactly as it does
-- for a hand-typed DM. Newsletters are not a special case in the inbox.
--
-- 021's rate limits (30 messages a minute, 20 conversations an hour) would stop
-- this dead at the twenty-first recipient. `enforce_message_rate_limit` returns
-- early for admins and for `send_marketing` holders, which is the same tier this
-- function's own guard admits, so the exemption and the guard cannot drift
-- apart. If fan-out ever starts failing with "Rate limit exceeded", that
-- exemption is what regressed.
--
-- Zero recipients is refused rather than recorded. Marking a newsletter sent to
-- nobody would burn the draft: `status = 'sent'` is one-way, so there would be
-- no way to send it once the audience exists.

create or replace function public.send_newsletter(p_newsletter_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sender          uuid := auth.uid();
  v_news            public.newsletters;
  v_recipients      uuid[];
  v_conversations   uuid[];
  v_count           int;
begin
  if v_sender is null then
    raise exception 'You must be signed in to send a newsletter.'
      using errcode = '22023';
  end if;

  if not (public.is_axis_admin() or public.has_permission('send_marketing')) then
    raise exception 'You do not have permission to send newsletters.'
      using errcode = '22023';
  end if;

  select * into v_news from public.newsletters where id = p_newsletter_id;

  if v_news.id is null then
    raise exception 'That newsletter no longer exists.' using errcode = '22023';
  end if;

  if v_news.status <> 'draft' then
    raise exception 'That newsletter has already been sent.' using errcode = '22023';
  end if;

  -- The audience, resolved as of right now. Suspended and pending accounts are
  -- not recipients, and the sender never mails themselves.
  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
    into v_recipients
    from public.profiles p
   where p.status = 'active'
     and p.id <> v_sender
     and (
       v_news.audience = 'all'
       or (v_news.audience = 'athletes' and p.role = 'athlete')
       or (v_news.audience = 'staff'    and p.role in ('coach', 'admin'))
     );

  v_count := coalesce(array_length(v_recipients, 1), 0);

  if v_count = 0 then
    raise exception 'There is nobody in that audience yet, so nothing was sent.'
      using errcode = '22023';
  end if;

  -- One conversation id per recipient, minted before anything is written so the
  -- next three statements can join recipient to conversation by position.
  select coalesce(array_agg(gen_random_uuid()), '{}'::uuid[])
    into v_conversations
    from generate_series(1, v_count);

  insert into public.conversations (id, kind, title, created_by, newsletter_id)
  select t.conversation_id,
         'broadcast'::public.conversation_kind,
         v_news.subject,
         v_sender,
         v_news.id
    from unnest(v_recipients, v_conversations) as t(recipient_id, conversation_id);

  -- Two members: the sender, so the reply thread is theirs, and the recipient.
  -- Both start read; the message insert below is what marks the recipient.
  insert into public.conversation_members (conversation_id, profile_id, added_by, unread)
  select t.conversation_id, v_sender, v_sender, false
    from unnest(v_recipients, v_conversations) as t(recipient_id, conversation_id)
  union all
  select t.conversation_id, t.recipient_id, v_sender, false
    from unnest(v_recipients, v_conversations) as t(recipient_id, conversation_id)
  on conflict (conversation_id, profile_id) do nothing;

  -- The delivery itself. Fires message_after_insert once per row: rollups get
  -- written, recipients go unread, realtime pushes it into an open inbox.
  insert into public.messages (conversation_id, sender_id, body)
  select t.conversation_id, v_sender, v_news.body
    from unnest(v_recipients, v_conversations) as t(recipient_id, conversation_id);

  update public.newsletters
     set status          = 'sent',
         sent_at         = now(),
         recipient_count = v_count,
         author_id       = v_sender
   where id = p_newsletter_id;

  return jsonb_build_object('sent', v_count);
end
$$;

comment on function public.send_newsletter(uuid) is
  'Delivers a draft newsletter in-app: one broadcast conversation per recipient '
  'in the chosen audience, each carrying one message from the sender, so replies '
  'come back as ordinary private threads. Returns {"sent": n}.';

revoke all     on function public.send_newsletter(uuid) from public, anon;
grant  execute on function public.send_newsletter(uuid) to authenticated, service_role;


-- ── 6. Polls ────────────────────────────────────────────────────────────────
--
-- A poll hangs off a newsletter and there is at most one per newsletter, which
-- the partial unique index makes true rather than assumed. The reference
-- implementation did `select id into v_poll_id from polls where newsletter_id =
-- ...` with no unique constraint behind it: two polls on one newsletter and the
-- upsert silently edits whichever row came back first.
--
-- `poll_votes` is keyed (poll_id, voter_id), so changing your mind is an UPDATE
-- of your one row, not a second vote.

create table if not exists public.polls (
  id            uuid primary key default gen_random_uuid(),
  newsletter_id uuid references public.newsletters (id) on delete cascade,
  question      text not null,
  created_by    uuid references public.profiles (id) on delete set null,
  closes_at     timestamptz,
  created_at    timestamptz not null default now(),

  constraint polls_question_len check (
    btrim(question) <> '' and char_length(question) <= 200
  )
);

create unique index if not exists polls_newsletter_id_uniq
  on public.polls (newsletter_id)
  where newsletter_id is not null;

create table if not exists public.poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.polls (id) on delete cascade,
  label    text not null,
  position int  not null default 0,

  constraint poll_options_label_len check (
    btrim(label) <> '' and char_length(label) <= 100
  )
);

create index if not exists poll_options_poll_id_idx
  on public.poll_options (poll_id, position);

create table if not exists public.poll_votes (
  poll_id    uuid not null references public.polls (id) on delete cascade,
  option_id  uuid not null references public.poll_options (id) on delete cascade,
  voter_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (poll_id, voter_id)
);

-- poll_results_multi aggregates by option; without this it is a seq scan per
-- News feed render.
create index if not exists poll_votes_option_id_idx
  on public.poll_votes (option_id);


-- can_read_poll is can_read_newsletter with one hop added, kept as its own
-- function so the poll_options policy does not have to read `polls` and drag
-- that table's policy into the check.
create or replace function public.can_read_poll(p_poll_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.polls p
     where p.id = p_poll_id
       and public.can_read_newsletter(p.newsletter_id)
  )
$$;

revoke all     on function public.can_read_poll(uuid) from public, anon;
grant  execute on function public.can_read_poll(uuid) to authenticated, service_role;


alter table public.polls        enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes   enable row level security;

-- SELECT only. No insert, update or delete grant exists on any of these three,
-- so even a policy added later by mistake could not open a write path from the
-- browser. Writes go through section 7.
revoke all on public.polls        from anon, authenticated;
revoke all on public.poll_options from anon, authenticated;
revoke all on public.poll_votes   from anon, authenticated;
grant  select on public.polls        to authenticated;
grant  select on public.poll_options to authenticated;
grant  select on public.poll_votes   to authenticated;

drop policy if exists "read polls on readable newsletters"   on public.polls;
drop policy if exists "read options on readable newsletters" on public.poll_options;
drop policy if exists "read own vote"                        on public.poll_votes;

-- WHO: the sender tier, who need to see the poll while the newsletter is still
-- a draft, plus anybody the newsletter was delivered to.
create policy "read polls on readable newsletters"
  on public.polls for select to authenticated
  using (
    public.is_axis_admin()
    or public.has_permission('send_marketing')
    or public.can_read_newsletter(newsletter_id)
  );

-- WHO: same people, one hop down.
create policy "read options on readable newsletters"
  on public.poll_options for select to authenticated
  using (
    public.is_axis_admin()
    or public.has_permission('send_marketing')
    or public.can_read_poll(poll_id)
  );

-- WHO: you, about you. Nobody reads anybody else's vote, not even an admin:
-- tallies come from poll_results_multi, which returns counts and no voter ids.
-- A poll whose author can see who voted for what is not a poll people answer
-- honestly.
create policy "read own vote"
  on public.poll_votes for select to authenticated
  using (voter_id = auth.uid());


-- ── 7. Poll RPCs — the only write path ──────────────────────────────────────

-- Create, replace or remove the poll attached to a draft newsletter. Options are
-- replaced wholesale rather than diffed: an option row is only ever referenced
-- by votes, a draft has no votes, and "edit option 3" is not a thing the
-- composer offers.
create or replace function public.upsert_newsletter_poll(
  p_newsletter_id uuid,
  p_question      text,
  p_options       text[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_poll_id uuid;
  v_options text[];
  v_count   int;
begin
  if not (public.is_axis_admin() or public.has_permission('send_marketing')) then
    raise exception 'You do not have permission to manage newsletter polls.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.newsletters
     where id = p_newsletter_id and status = 'draft'
  ) then
    raise exception 'A poll can only be edited while the newsletter is a draft.'
      using errcode = '22023';
  end if;

  -- An empty question means "no poll". Cascades take the options with it.
  if btrim(coalesce(p_question, '')) = '' then
    delete from public.polls where newsletter_id = p_newsletter_id;
    return null;
  end if;

  -- Clean first, count second, write third. The reference implementation wrote
  -- the options and then counted them, which works only because the raise rolls
  -- the transaction back. Validating up front means the error is about what the
  -- author typed, not about what the database half did.
  select coalesce(array_agg(left(btrim(o), 100) order by ord), '{}'::text[])
    into v_options
    from unnest(coalesce(p_options, '{}'::text[])) with ordinality as u(o, ord)
   where btrim(o) <> '';

  v_count := coalesce(array_length(v_options, 1), 0);

  if v_count < 2 then
    raise exception 'A poll needs at least two options.' using errcode = '22023';
  end if;
  if v_count > 8 then
    raise exception 'A poll can have at most eight options.' using errcode = '22023';
  end if;

  select id into v_poll_id from public.polls where newsletter_id = p_newsletter_id;

  if v_poll_id is null then
    insert into public.polls (newsletter_id, question, created_by)
    values (p_newsletter_id, left(btrim(p_question), 200), auth.uid())
    returning id into v_poll_id;
  else
    update public.polls
       set question = left(btrim(p_question), 200)
     where id = v_poll_id;
    delete from public.poll_options where poll_id = v_poll_id;
  end if;

  insert into public.poll_options (poll_id, label, position)
  select v_poll_id, o.label, (o.ord - 1)::int
    from unnest(v_options) with ordinality as o(label, ord);

  return v_poll_id;
end
$$;

revoke all     on function public.upsert_newsletter_poll(uuid, text, text[]) from public, anon;
grant  execute on function public.upsert_newsletter_poll(uuid, text, text[]) to authenticated, service_role;


-- Cast or change one vote.
--
-- The readability check is not decoration. This function is SECURITY DEFINER, so
-- it is the only thing standing between a guessed poll id and a vote on a poll
-- the caller was never sent. It asks the same question the SELECT policy asks,
-- because "can write" must never be wider than "can see".
create or replace function public.cast_vote(p_poll_id uuid, p_option_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_axis_active() then
    raise exception 'Your account needs to be active before you can vote.'
      using errcode = '22023';
  end if;

  if not (
    public.is_axis_admin()
    or public.has_permission('send_marketing')
    or public.can_read_poll(p_poll_id)
  ) then
    raise exception 'That poll is not available to you.' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.poll_options o
      join public.polls p       on p.id = o.poll_id
      join public.newsletters n on n.id = p.newsletter_id
     where o.id = p_option_id
       and o.poll_id = p_poll_id
       and n.status = 'sent'
  ) then
    raise exception 'That poll option is not available.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.polls
     where id = p_poll_id and closes_at is not null and closes_at < now()
  ) then
    raise exception 'This poll is closed.' using errcode = '22023';
  end if;

  -- Generous, and aimed at a script rather than a person: sixty votes an hour is
  -- more polls than Axis will ever run. Shares 021's counter table, so a flood
  -- of votes and a flood of messages are visible as one actor's behaviour.
  perform public.enforce_message_rate_limit('cast_vote', 60, 3600);

  insert into public.poll_votes (poll_id, option_id, voter_id)
  values (p_poll_id, p_option_id, auth.uid())
  on conflict (poll_id, voter_id)
  do update set option_id = excluded.option_id, created_at = now();
end
$$;

revoke all     on function public.cast_vote(uuid, uuid) from public, anon;
grant  execute on function public.cast_vote(uuid, uuid) to authenticated, service_role;


-- Tallies for a screenful of newsletters in one call. Returns counts and option
-- ids and nothing else: there is no shape of result from this function that
-- reveals who voted. That is why the News feed can show percentages while
-- `poll_votes` stays readable only to its own author.
create or replace function public.poll_results_multi(p_poll_ids uuid[])
returns table (poll_id uuid, option_id uuid, votes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select v.poll_id, v.option_id, count(*) as votes
    from public.poll_votes v
   where v.poll_id = any(coalesce(p_poll_ids, '{}'::uuid[]))
   group by v.poll_id, v.option_id
$$;

revoke all     on function public.poll_results_multi(uuid[]) from public, anon;
grant  execute on function public.poll_results_multi(uuid[]) to authenticated, service_role;


-- ── 8. Realtime ─────────────────────────────────────────────────────────────
--
-- 021 adds the three messaging tables; this adds `newsletters` so the News feed
-- and the composer's sent list update without a refresh when a send lands.
--
-- Guarded twice over: the publication does not exist on a bare local Postgres,
-- and on a restored database the migration runner may not own it. Neither is a
-- reason to fail a migration whose actual job is the schema above.
--
-- `replica identity full` so an update or delete ships the whole old row.
-- Without it the payload carries the primary key only, which is not enough for
-- realtime to evaluate RLS on the row that just changed, and subscribers
-- silently miss it.

alter table public.newsletters replica identity full;

do $do$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'newsletters'
  ) then
    execute 'alter publication supabase_realtime add table public.newsletters';
  end if;
exception
  when insufficient_privilege then
    raise notice 'Skipped adding public.newsletters to supabase_realtime: not the publication owner.';
end
$do$;


-- ── 9. Verify ───────────────────────────────────────────────────────────────
--
-- Structure. Expect the foreign key and both length limits to agree.
--
--   select conname from pg_catalog.pg_constraint
--    where conrelid = 'public.conversations'::regclass
--      and conname = 'conversations_newsletter_id_fkey';        -- 1 row
--
--   -- the fan-out bug this file exists to not have: both must say 8000.
--   -- Matched by relation, not by constraint name, since 021 names its check
--   -- however it likes.
--   select conrelid::regclass, pg_get_constraintdef(oid)
--     from pg_catalog.pg_constraint
--    where conrelid in ('public.newsletters'::regclass, 'public.messages'::regclass)
--      and contype = 'c'
--      and pg_get_constraintdef(oid) like '%char_length(body)%';
--
-- Happy path, as an admin or a coach holding send_marketing:
--
--   insert into public.newsletters (subject, body, audience)
--   values ('Meet week', 'Weigh-ins move to Thursday at 6.', 'athletes')
--   returning id;                                              -- <id>
--
--   select public.upsert_newsletter_poll('<id>', 'Which session suits you?',
--                                        array['Morning', 'Evening']);
--   select public.send_newsletter('<id>');                     -- {"sent": n}
--
--   -- n broadcast conversations, 2n memberships, n messages, all recipients unread
--   select count(*) from public.conversations where newsletter_id = '<id>';
--   select count(*) from public.conversation_members m
--     join public.conversations c on c.id = m.conversation_id
--    where c.newsletter_id = '<id>';                            -- 2 x the above
--   select count(*) from public.conversation_members m
--     join public.conversations c on c.id = m.conversation_id
--    where c.newsletter_id = '<id>' and m.unread;               -- n, the sender is read
--
--   select public.send_newsletter('<id>');   -- 'That newsletter has already been sent.'
--   select public.upsert_newsletter_poll('<id>', 'Too late', array['a','b']);
--                                            -- 'A poll can only be edited while ... draft.'
--   select public.upsert_newsletter_poll('<draft2>', 'One choice', array['only']);
--                                            -- 'A poll needs at least two options.'
--
-- Negative, as an ATHLETE who was in the audience (the recipient tier):
--
--   select subject from public.newsletters;              -- the sent one only, no drafts
--   select count(*) from public.polls;                   -- their newsletter's poll
--   select * from public.poll_votes;                     -- only their own row
--   insert into public.polls (question) values ('mine'); -- ERROR: permission denied
--   insert into public.poll_votes (poll_id, option_id, voter_id)
--   values ('<poll>', '<opt>', auth.uid());              -- ERROR: permission denied
--   select public.cast_vote('<poll>', '<opt>');          -- succeeds, one row in poll_votes
--   select public.send_newsletter('<id2>');
--                                            -- 'You do not have permission to send newsletters.'
--
-- Negative, as an ATHLETE who was NOT in the audience (a staff-only send):
--
--   select count(*) from public.newsletters;             -- 0
--   select count(*) from public.polls;                   -- 0
--   select public.cast_vote('<poll>', '<opt>');          -- 'That poll is not available to you.'
--
-- Negative, as anon:
--
--   set role anon;
--   select count(*) from public.newsletters;             -- ERROR: permission denied
--   select count(*) from public.polls;                   -- ERROR: permission denied
--   select public.poll_results_multi(array['<poll>']::uuid[]);
--                                                        -- ERROR: permission denied
--   reset role;
