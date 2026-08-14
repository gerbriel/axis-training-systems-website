-- ============================================================
-- Axis Training Systems — 021: the conversation, and who may start one
-- ============================================================
--
-- Coaching happens in a WhatsApp thread that Axis does not own. The marketing
-- copy says so out loud (`HowItWorks.tsx`). Every consequence of that follows
-- from the same fact: when a coach leaves, the history leaves with them; an
-- athlete's phone number is the address book of the business; and there is no
-- answer to "what did we tell this athlete in March" that does not begin with
-- asking somebody to scroll. This file is the first half of moving that
-- conversation inside the product.
--
-- WHAT IS HERE. Three tables and a matrix. `conversations` is a thread of any
-- shape, `conversation_members` is who is in it, `messages` is what was said.
-- `can_message()` is the matrix: an athlete may write to the coaches assigned
-- to them, a coach may write to their athletes and to any other staff, an admin
-- may write to anyone active. `athlete_coaches` is the assignment table that
-- matrix reads, and it is new too, because nothing in this database has ever
-- recorded which coach an athlete belongs to. `leads.coach_pref` is a display
-- name typed into a form and `bookings.coach_slug` is a fact about one hour.
-- Neither is a roster.
--
-- WHY NOT TWO PARTIES PER ROW. The obvious schema is the one this design was
-- ported from: a thread with an `a_id` and a `b_id`. It is smaller, it needs no
-- join to answer "who is in this", and it makes the unread flag two booleans on
-- a row already being written. It also cannot express "Coach Sarah and her six
-- athletes", which is the thing the studio asked for. A membership table costs
-- one join on a list that is already denormalized to avoid joining to messages,
-- and it is the difference between a feature and a workaround.
--
-- WHY THE WRITES ARE ALL RPCs. There is no INSERT policy on `conversations` and
-- none on `conversation_members`. Every conversation and every membership row
-- is created by a SECURITY DEFINER function in section 9. The reason is that
-- the interesting rule is never about one row: "you may add this person to this
-- channel" needs the channel, the caller, the target, and the assignment table
-- in hand at once, and a WITH CHECK expression that reaches all four is a rule
-- nobody can read six months later. `messages` is the exception and keeps a
-- direct INSERT policy, because sending is a single-row decision the client
-- makes optimistically and RLS states it exactly: you, active, in the room.
--
-- WHY DM DEDUP IS AN INDEX AND NOT A LOOKUP. "Find the thread with this person,
-- or make one" is a read followed by a write, and two taps in the same second
-- produce two threads. The reference implementation has that race and has lived
-- with it. Here `dm_a`/`dm_b` are stored normalized (least, greatest) under a
-- partial unique index, so the second insert loses to the first in the database
-- rather than in the application, and `get_or_create_dm` returns the winner.
--
-- WHY THE UNREAD FLAG IS A BOOLEAN. Not a count, not a per-message read table.
-- The badge answers "is there anything for me" and the list answers "in which
-- conversations", and both are the same boolean read off the membership row the
-- inbox query already returns. A count is a second thing that can be wrong.
--
-- WHY PROFILE NAMES COME THROUGH A FUNCTION. 011 is deliberate that an athlete
-- can read no profile row but their own, not even their coach's. That is worth
-- keeping, so this file does NOT widen the profiles policies. Instead
-- `messaging_profiles()` and `list_message_contacts()` are definer projections
-- of exactly seven columns for exactly the people the caller already shares a
-- room with, or may start one with. Nothing here should ever be reached with a
-- PostgREST embed on profiles: the embed would run under the caller's own RLS
-- and return nulls to precisely the people this feature is for.
--
-- Re-runnable.
-- ============================================================


-- ── 0. A note on the grants below ───────────────────────────────────────────
--
-- 017 F1a withdrew the default EXECUTE grant Supabase hands to `anon` and
-- `authenticated` on every new function in `public`. A function in this file
-- that the browser calls therefore MUST carry its own explicit
-- `grant execute … to authenticated`, or the call fails with "permission denied
-- for function" the first time somebody opens their inbox.
--
-- Two functions here deliberately do NOT get that grant, and it is not an
-- oversight. `enforce_message_rate_limit` and `message_rate_limit_trigger` are
-- internal machinery: the first takes the action name as free text and writes a
-- row keyed on it, so a client that could call it directly could fill a table
-- it cannot otherwise touch with rows nobody reads. They are reachable only
-- from the triggers below and from SECURITY DEFINER callers, which execute as
-- the owner and need no grant. 017 F1b treats every other trigger function the
-- same way.
--
-- Table grants get the same treatment for the opposite reason: Supabase's
-- default privileges DO still hand `anon` and `authenticated` full DML on a new
-- table (017 declined to revoke that by default, on the grounds that it would
-- silently break every future migration). So every table below is revoked and
-- then granted back exactly what its policies describe, and no more.


-- ── 1. The shape of a conversation, and who is active ───────────────────────
--
-- Three kinds, and they differ in what the client renders and in what the RPCs
-- allow, never in where the rows live. A 'dm' is two people and has no title. A
-- 'channel' has a title and any number of members. A 'broadcast' is what 022
-- creates when a newsletter goes out: one per recipient, titled with the
-- subject, carrying the sender, so a reply is an ordinary conversation with the
-- person who sent it rather than a dead end.

do $do$ begin
  create type public.conversation_kind as enum ('dm', 'channel', 'broadcast');
exception when duplicate_object then null; end $do$;

-- 016 has `is_axis_staff()` and 011 has `is_axis_admin()`. Neither answers the
-- question messaging asks most often, which is not about rank at all: is the
-- person holding this request a real, admitted account. A pending athlete has
-- signed up and not been let in; a suspended one keeps their history readable
-- and every power removed (011). Both must be unable to send.
create or replace function public.is_axis_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  )
$$;

revoke all     on function public.is_axis_active() from public, anon;
grant  execute on function public.is_axis_active() to authenticated, service_role;


-- ── 2. Which coach an athlete belongs to ────────────────────────────────────
--
-- The table the architecture has been missing. It is a plain many-to-many,
-- because an athlete can be shared between a lifting coach and a nutrition
-- coach and the studio does that already, informally, in a group chat.
--
-- `coach_id` admits admins as well as coaches on purpose: Axis's head coach is
-- `role = 'admin'` with a `coach_slug` (011), so a schema that let only
-- `role = 'coach'` be assigned would be unable to represent the roster's most
-- assigned person.
--
-- INSERT and DELETE only. There is no UPDATE grant and no UPDATE policy: an
-- assignment is a pair of ids, and "changing" one is unassigning and assigning,
-- which is what the portal's toggle does anyway. That is also why the stamping
-- trigger is BEFORE INSERT alone and cannot rewrite an existing `assigned_at`.

create table if not exists public.athlete_coaches (
  athlete_id  uuid not null references public.profiles (id) on delete cascade,
  coach_id    uuid not null references public.profiles (id) on delete cascade,

  -- Who decided. `on delete set null` rather than cascade: the day an admin
  -- leaves is not the day every athlete loses their coach.
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),

  primary key (athlete_id, coach_id)
);

-- The primary key already answers "who are this athlete's coaches". This index
-- answers the other direction, which is the one `list_message_contacts()` asks
-- on every load of a coach's contact picker.
create index if not exists athlete_coaches_coach_idx
  on public.athlete_coaches (coach_id);

-- A trigger and not CHECK constraints, because every rule here is about a
-- different row in another table, which a CHECK cannot see. Messages are
-- written as sentences a person could be shown: `manage_athletes` is a
-- permission a coach can hold, and a coach who mis-clicks should be told what
-- went wrong rather than handed a constraint name.
create or replace function public.athlete_coaches_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_athlete_role   public.user_role;
  v_athlete_status public.profile_status;
  v_coach_role     public.user_role;
  v_coach_status   public.profile_status;
begin
  select p.role, p.status into v_athlete_role, v_athlete_status
    from public.profiles p where p.id = new.athlete_id;

  if v_athlete_role is null then
    raise exception 'That athlete account no longer exists.';
  end if;
  if v_athlete_role <> 'athlete' then
    raise exception 'Only an athlete can be assigned to a coach.';
  end if;
  if v_athlete_status <> 'active' then
    raise exception 'That athlete account is not active yet.';
  end if;

  select p.role, p.status into v_coach_role, v_coach_status
    from public.profiles p where p.id = new.coach_id;

  if v_coach_role is null then
    raise exception 'That coach account no longer exists.';
  end if;
  if v_coach_role not in ('coach', 'admin') then
    raise exception 'Only a coach or an admin can be assigned to an athlete.';
  end if;
  if v_coach_status <> 'active' then
    raise exception 'That coach account is not active.';
  end if;

  -- Stamped rather than trusted, the way 016 stamps `granted_by`. The coalesce
  -- keeps the service role and the SQL editor able to write a row on somebody's
  -- behalf, where auth.uid() is null and there is nothing to forge.
  new.assigned_by := coalesce(auth.uid(), new.assigned_by);
  new.assigned_at := now();
  return new;
end $$;

revoke all on function public.athlete_coaches_validate() from public, anon, authenticated, service_role;

drop trigger if exists athlete_coaches_validate_trg on public.athlete_coaches;
create trigger athlete_coaches_validate_trg
  before insert on public.athlete_coaches
  for each row execute function public.athlete_coaches_validate();

alter table public.athlete_coaches enable row level security;

drop policy if exists "read your own coaching assignments" on public.athlete_coaches;
drop policy if exists "manage_athletes assigns coaches"    on public.athlete_coaches;
drop policy if exists "manage_athletes unassigns coaches"  on public.athlete_coaches;

-- WHO: the two people the row is about, plus anyone who manages athletes. The
-- athlete's half is load-bearing rather than courteous: their contact list is
-- their coaches, and a client that cannot read the assignment cannot render an
-- inbox at all.
create policy "read your own coaching assignments"
  on public.athlete_coaches for select to authenticated
  using (
    athlete_id = auth.uid()
    or coach_id = auth.uid()
    or public.is_axis_admin()
    or public.has_permission('manage_athletes')
  );

-- WHO: an admin, or a coach the admin trusted with the athlete roster. Note
-- what a coach may NOT do here even holding it: nothing stops them assigning
-- an athlete to a different coach, and that is correct. Deciding who works with
-- whom is the roster, and `manage_athletes` is the roster permission.
create policy "manage_athletes assigns coaches"
  on public.athlete_coaches for insert to authenticated
  with check (public.is_axis_admin() or public.has_permission('manage_athletes'));

create policy "manage_athletes unassigns coaches"
  on public.athlete_coaches for delete to authenticated
  using (public.is_axis_admin() or public.has_permission('manage_athletes'));

revoke all on public.athlete_coaches from anon, authenticated;
grant  select, insert, delete on public.athlete_coaches to authenticated;


-- ── 3. The three tables ─────────────────────────────────────────────────────
--
-- `last_message_at`, `last_message_preview` and `last_message_from` are a
-- denormalized rollup maintained by the trigger in section 6. They exist so the
-- inbox list never touches `messages`: one query, ordered, paged, with the
-- preview text already on the row. The cost is that a message insert writes
-- twice; the alternative is a lateral join to the newest message per
-- conversation on every list render, forever.

create table if not exists public.conversations (
  id    uuid primary key default gen_random_uuid(),
  kind  public.conversation_kind not null,

  -- Required for a channel and enforced in `create_channel`, not here: a
  -- CHECK would also have to be true of a broadcast, whose title is the
  -- newsletter subject, and of a dm, whose title is nothing at all.
  title text,

  created_by uuid references public.profiles (id) on delete set null,

  -- Plain uuid on purpose. 022 owns `newsletters` and adds the foreign key and
  -- the index once the table it points at exists. Declaring the column here
  -- means 022 is additive and this file has no forward dependency.
  newsletter_id uuid,

  -- Set only for kind = 'dm', and normalized so that dm_a < dm_b. That
  -- normalization plus the partial unique index below is the whole of DM
  -- deduplication, and it is enforced by the database rather than by whichever
  -- caller got there first.
  dm_a uuid references public.profiles (id) on delete set null,
  dm_b uuid references public.profiles (id) on delete set null,

  last_message_at      timestamptz not null default now(),
  last_message_preview text,
  last_message_from    uuid,

  created_at timestamptz not null default now(),

  constraint conversations_title_len
    check (title is null or char_length(title) <= 200),

  -- A channel or a broadcast has no dm pair.
  constraint conversations_dm_columns
    check (kind = 'dm' or (dm_a is null and dm_b is null)),

  -- Normalized when both are present. It deliberately does NOT also demand that
  -- a dm has both: the foreign keys above are `on delete set null`, so deleting
  -- an account has to be able to leave a half-orphaned dm row behind rather
  -- than fail on a constraint. A row with a null side matches nothing in the
  -- unique index and is never returned by `get_or_create_dm`, which is the
  -- correct fate for a conversation with a deleted person.
  constraint conversations_dm_normalized
    check (dm_a is null or dm_b is null or dm_a < dm_b)
);

-- One dm per pair, decided in the index. Two simultaneous "message this coach"
-- taps race here and exactly one wins.
create unique index if not exists conversations_dm_uniq
  on public.conversations (dm_a, dm_b) where kind = 'dm';

-- The inbox is "my conversations, newest first". RLS narrows to mine; this
-- orders the rest.
create index if not exists conversations_recent_idx
  on public.conversations (last_message_at desc);


create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  profile_id      uuid not null references public.profiles (id)      on delete cascade,

  -- The whole of the read model. See the header.
  unread    boolean not null default false,
  added_by  uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),

  primary key (conversation_id, profile_id)
);

-- The badge query is `count(*) where profile_id = me and unread`, and it runs
-- on every page of the app that renders a header.
create index if not exists conversation_members_unread_idx
  on public.conversation_members (profile_id, unread);


create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,

  -- Nullable, and `on delete set null` rather than cascade. Deleting a coach
  -- must not silently rewrite the history of every athlete they worked with;
  -- the client renders a null sender as "Former member".
  sender_id uuid references public.profiles (id) on delete set null,

  body       text not null,
  created_at timestamptz not null default now(),

  -- 8000 matches what 022 allows in a newsletter body, and that is not a
  -- coincidence: a newsletter is delivered by inserting its body as a message,
  -- so a limit here that is lower than the one there turns a successful send
  -- into a failed one halfway through the roster.
  constraint messages_body_len
    check (btrim(body) <> '' and char_length(body) <= 8000)
);

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at);


-- ── 4. The recursion breaker ────────────────────────────────────────────────
--
-- Every policy in section 5 asks the same question: is the person holding this
-- request in this room. Asked inline, that question is a subquery on
-- `conversation_members`, which is itself a table with a policy that asks
-- whether the person is in the room. Postgres does not survive that.
--
-- So it is asked exactly once, here, in a SECURITY DEFINER function. The
-- definer hop is what breaks the cycle: the function's own read of
-- `conversation_members` runs as the owner and is not policy-checked. It is
-- also why the answer is cheap, since it is one primary-key probe rather than a
-- policy evaluation per candidate row.
--
-- Nothing else in this file may inline a membership test in a policy. If a
-- later migration needs one, it calls this.

create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (
       select 1 from public.conversation_members cm
       where cm.conversation_id = p_conversation_id
         and cm.profile_id = auth.uid()
     )
$$;

revoke all     on function public.is_conversation_member(uuid) from public, anon;
grant  execute on function public.is_conversation_member(uuid) to authenticated, service_role;


-- ── 5. RLS ──────────────────────────────────────────────────────────────────
--
-- Read is membership, three times. Write is a single INSERT policy on messages
-- and nothing else at all: no policy grants INSERT, UPDATE or DELETE on
-- `conversations` or `conversation_members`, and the table grants below match,
-- so the RPCs in section 9 are not merely the recommended route, they are the
-- only one. That is deliberate — see the header — and it is also why the
-- identity-guard trigger the reference implementation needed on its thread
-- table has no counterpart here: there is no UPDATE path to guard.
--
-- No anon policy anywhere, and anon is revoked outright. There is no reading of
-- this data without an account.

alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;

drop policy if exists "members read conversations" on public.conversations;
drop policy if exists "members read the roster"    on public.conversation_members;
drop policy if exists "members read messages"      on public.messages;
drop policy if exists "members send messages"      on public.messages;

-- WHO: the people in it. An admin is not special here and does not need to be:
-- an admin who wants to read a conversation is a member of it, and an admin who
-- is not a member is reading somebody's private messages.
create policy "members read conversations"
  on public.conversations for select to authenticated
  using (public.is_conversation_member(id));

-- WHO: you, about your own membership, plus every member about every other
-- member of a shared room. The first clause is what makes the unread badge
-- query work before any conversation is opened; the second is what lets the
-- client render "Sarah, Mike and 4 others" without a second round trip.
create policy "members read the roster"
  on public.conversation_members for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_conversation_member(conversation_id)
  );

create policy "members read messages"
  on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id));

-- WHO: you, active, in the room, writing as yourself. Three clauses because
-- three things can be false: a suspended account whose old rooms are still
-- listed, a stale conversation id, and a forged sender.
--
-- Note what is NOT re-checked: `can_message()`. Permission decides who may
-- START a conversation, not who may speak in one that exists. An athlete
-- reassigned to a different coach keeps their history and can still reply in
-- the room they are in, which is what anybody would expect and what the
-- alternative (a thread that goes read-only on a roster change) would not give
-- them. Removing somebody from a room is `update_channel_members`.
create policy "members send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_axis_active()
    and public.is_conversation_member(conversation_id)
  );

revoke all on public.conversations        from anon, authenticated;
revoke all on public.conversation_members from anon, authenticated;
revoke all on public.messages             from anon, authenticated;

grant select         on public.conversations        to authenticated;
grant select         on public.conversation_members to authenticated;
grant select, insert on public.messages             to authenticated;


-- ── 6. What happens when somebody sends something ───────────────────────────
--
-- The rollup and the unread flags, in one AFTER INSERT trigger. SECURITY
-- DEFINER because both writes are to tables the sender has no UPDATE grant on
-- at all, which is the point: the only thing that can mark a conversation
-- unread for somebody else is the arrival of a message.

create or replace function public.message_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
     set last_message_at      = new.created_at,
         last_message_preview = left(new.body, 120),
         last_message_from    = new.sender_id
   where id = new.conversation_id;

  -- `is distinct from` rather than `<>` so a null sender (a message whose
  -- author's account was later deleted, replayed by a restore) marks everyone
  -- unread instead of nobody: `profile_id <> null` is null, and null is not
  -- true, so the plain comparison would update zero rows.
  --
  -- `and not unread` keeps this from rewriting rows that already say true. That
  -- is not micro-optimization: these tables are in the realtime publication, so
  -- a no-op UPDATE is a websocket frame to every subscriber and a refetch on
  -- the other end.
  update public.conversation_members
     set unread = true
   where conversation_id = new.conversation_id
     and profile_id is distinct from new.sender_id
     and not unread;

  return new;
end $$;

revoke all on function public.message_after_insert() from public, anon, authenticated, service_role;

drop trigger if exists message_after_insert on public.messages;
create trigger message_after_insert
  after insert on public.messages
  for each row execute function public.message_after_insert();


-- ── 7. Rate limiting ────────────────────────────────────────────────────────
--
-- A fixed-window counter, deliberately named apart from the `rate_limit_hit`
-- machinery the edge functions use: that one is called by the service role with
-- an IP address, this one is a trigger on a table and keys on the account. Two
-- different questions, and sharing a table would make the answer to either one
-- depend on traffic to the other.
--
-- The exemption at the top is load-bearing rather than a courtesy. 022's
-- newsletter fan-out inserts one conversation and one message per recipient in
-- a single statement; without the early return, sending to a roster of more
-- than twenty people would trip the conversation limit partway through and roll
-- the whole send back. Admins and `send_marketing` holders are exactly the
-- people who can trigger a fan-out, and they are the people the studio trusts
-- with the megaphone already.

create table if not exists public.message_rate_limits (
  actor        text        not null,
  action       text        not null,
  window_start timestamptz not null,
  count        int         not null default 1,
  primary key (actor, action, window_start)
);

create index if not exists message_rate_limits_window_idx
  on public.message_rate_limits (window_start);

-- RLS on with no policies at all, and every client grant removed. Nothing but
-- the definer functions below and the service role can see or touch this.
alter table public.message_rate_limits enable row level security;
revoke all on public.message_rate_limits from anon, authenticated;

create or replace function public.enforce_message_rate_limit(
  p_action         text,
  p_max            int,
  p_window_seconds int
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  text;
  v_window timestamptz;
  v_count  int;
begin
  if public.is_axis_admin() or public.has_permission('send_marketing') then
    return;
  end if;

  -- The account if there is one. The header fallback exists so that a future
  -- unauthenticated caller is still counted rather than silently exempt.
  v_actor := coalesce(
    auth.uid()::text,
    current_setting('request.headers', true)::jsonb ->> 'x-real-ip',
    'anon'
  );

  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.message_rate_limits as rl (actor, action, window_start)
  values (v_actor, p_action, v_window)
  on conflict (actor, action, window_start)
  do update set count = rl.count + 1
  returning rl.count into v_count;

  if v_count > p_max then
    raise exception 'Rate limit exceeded. Please wait a moment and try again.';
  end if;

  -- Expired windows are dead weight and nothing reads them. Cleaning up on a
  -- fiftieth of calls costs one indexed delete now and again instead of a cron
  -- job nobody remembers to configure.
  if random() < 0.02 then
    delete from public.message_rate_limits where window_start < now() - interval '1 day';
  end if;
end $$;

-- NOT granted to authenticated. See section 0: the action name is free text and
-- a client that could call this directly could write arbitrary rows into a
-- table it is otherwise fully revoked from. Definer callers (the trigger below,
-- and 022's `cast_vote`) execute as the owner and need no grant.
revoke all     on function public.enforce_message_rate_limit(text, int, int) from public, anon, authenticated;
grant  execute on function public.enforce_message_rate_limit(text, int, int) to service_role;

create or replace function public.message_rate_limit_trigger()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.enforce_message_rate_limit(tg_argv[0], tg_argv[1]::int, tg_argv[2]::int);
  return new;
end $$;

revoke all on function public.message_rate_limit_trigger() from public, anon, authenticated, service_role;

-- Thirty messages a minute is a fast typist and a hundred is a script. Twenty
-- new conversations an hour is a coach setting up their roster and two hundred
-- is somebody enumerating the profiles table.
drop trigger if exists messages_rate_limit_trg on public.messages;
create trigger messages_rate_limit_trg
  before insert on public.messages
  for each row execute function public.message_rate_limit_trigger('messages', '30', '60');

drop trigger if exists conversations_rate_limit_trg on public.conversations;
create trigger conversations_rate_limit_trg
  before insert on public.conversations
  for each row execute function public.message_rate_limit_trigger('conversations', '20', '3600');


-- ── 8. Who may start a conversation with whom ───────────────────────────────
--
-- The matrix, in one function, so that the RPCs, the contact list and any UI
-- gate all read the same answer. Stated as prose:
--
--   * an admin may message anyone with an active account;
--   * a coach may message any other active coach or admin, and any athlete
--     assigned to them;
--   * an athlete may message the coaches they are assigned to, and nobody else;
--   * nobody may message themselves, a pending account, or a suspended one.
--
-- What the athlete rule buys is worth being explicit about: an athlete cannot
-- enumerate the roster, cannot message another athlete, and cannot reach a
-- coach they do not work with. On a platform where the members are minors as
-- often as not, that is the requirement, and it is why the contact picker is a
-- definer function over this matrix rather than a filtered read of profiles.
--
-- Note that this governs STARTING a conversation. Section 5 explains why it is
-- not re-checked on every message.

create or replace function public.can_message(p_target uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me          uuid := auth.uid();
  v_my_role     public.user_role;
  v_target_role public.user_role;
begin
  if v_me is null or p_target is null or p_target = v_me then
    return false;
  end if;

  -- The target has to be a real, admitted account before anything else is worth
  -- asking. A null role here means either no such profile or not active, and
  -- the two are indistinguishable to the caller on purpose.
  select p.role into v_target_role
    from public.profiles p
   where p.id = p_target and p.status = 'active';
  if v_target_role is null then
    return false;
  end if;

  if public.is_axis_admin() then
    return true;
  end if;

  select p.role into v_my_role
    from public.profiles p
   where p.id = v_me and p.status = 'active';
  if v_my_role is null then
    return false;
  end if;

  if v_my_role = 'coach' then
    return v_target_role in ('coach', 'admin')
        or exists (
             select 1 from public.athlete_coaches ac
             where ac.athlete_id = p_target and ac.coach_id = v_me
           );
  end if;

  if v_my_role = 'athlete' then
    return exists (
      select 1 from public.athlete_coaches ac
      where ac.athlete_id = v_me and ac.coach_id = p_target
    );
  end if;

  -- An active admin was answered above; nothing else reaches here.
  return false;
end $$;

revoke all     on function public.can_message(uuid) from public, anon;
grant  execute on function public.can_message(uuid) to authenticated, service_role;


-- ── 9. The write surface ────────────────────────────────────────────────────
--
-- Every one of these raises with a sentence rather than returning a code,
-- because the client's `writeMessage()` passes P0001 text through verbatim to
-- the person who tripped it. Read them as UI copy, because that is what they
-- are.

/**
 * Open the direct message with somebody, creating it if this is the first one.
 *
 * The select-then-insert-then-select shape is not redundancy. The leading
 * select is what keeps re-opening an existing conversation from costing a row
 * against the conversation rate limit, since a BEFORE INSERT trigger fires
 * before the unique index gets a chance to reject the row. The ON CONFLICT is
 * what makes it race-free anyway. The trailing select is what the loser of that
 * race returns.
 */
create or replace function public.get_or_create_dm(p_other uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_a  uuid;
  v_b  uuid;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'You must be signed in to send a message.';
  end if;
  if not public.can_message(p_other) then
    raise exception 'You cannot start a conversation with that person.';
  end if;

  v_a := least(v_me, p_other);
  v_b := greatest(v_me, p_other);

  select c.id into v_id
    from public.conversations c
   where c.kind = 'dm' and c.dm_a = v_a and c.dm_b = v_b;

  if v_id is null then
    insert into public.conversations (kind, created_by, dm_a, dm_b)
    values ('dm', v_me, v_a, v_b)
    on conflict (dm_a, dm_b) where kind = 'dm' do nothing
    returning id into v_id;

    if v_id is null then
      select c.id into v_id
        from public.conversations c
       where c.kind = 'dm' and c.dm_a = v_a and c.dm_b = v_b;
    end if;
  end if;

  if v_id is null then
    raise exception 'We could not open that conversation.';
  end if;

  insert into public.conversation_members (conversation_id, profile_id, added_by)
  values (v_id, v_me, v_me), (v_id, p_other, v_me)
  on conflict (conversation_id, profile_id) do nothing;

  return v_id;
end $$;

revoke all     on function public.get_or_create_dm(uuid) from public, anon;
grant  execute on function public.get_or_create_dm(uuid) to authenticated, service_role;


/**
 * Create a named channel with a starting roster.
 *
 * Gated on `manage_channels`, which is the head-coach pattern 016 established
 * and 018 first adopted: not a role, a permission an admin hands to one senior
 * coach. An admin may put anyone active in a channel. Anyone else may put in
 * only people they could have messaged one at a time, so a channel is not a
 * way around the matrix in section 8.
 */
create or replace function public.create_channel(p_title text, p_member_ids uuid[])
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_admin  boolean;
  v_title  text;
  v_id     uuid;
  v_member uuid;
begin
  if v_me is null then
    raise exception 'You must be signed in to create a channel.';
  end if;

  v_admin := public.is_axis_admin();
  if not (v_admin or public.has_permission('manage_channels')) then
    raise exception 'You do not have permission to create channels.';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then
    raise exception 'Give the channel a name.';
  end if;
  if char_length(v_title) > 200 then
    raise exception 'That channel name is too long. Keep it to 200 characters.';
  end if;

  insert into public.conversations (kind, title, created_by)
  values ('channel', v_title, v_me)
  returning id into v_id;

  -- The creator is always in the room. A channel you cannot see is a channel
  -- you cannot fix.
  insert into public.conversation_members (conversation_id, profile_id, added_by)
  values (v_id, v_me, v_me)
  on conflict (conversation_id, profile_id) do nothing;

  for v_member in
    select distinct t.m
      from unnest(coalesce(p_member_ids, '{}'::uuid[])) as t(m)
     where t.m is not null and t.m <> v_me
  loop
    if not exists (
      select 1 from public.profiles p
      where p.id = v_member and p.status = 'active'
    ) then
      raise exception 'One of the people you picked is not an active account.';
    end if;

    if not v_admin and not public.can_message(v_member) then
      raise exception 'You can only add people you are allowed to message.';
    end if;

    insert into public.conversation_members (conversation_id, profile_id, added_by)
    values (v_id, v_member, v_me)
    on conflict (conversation_id, profile_id) do nothing;
  end loop;

  return v_id;
end $$;

revoke all     on function public.create_channel(text, uuid[]) from public, anon;
grant  execute on function public.create_channel(text, uuid[]) to authenticated, service_role;


/**
 * Add and remove people. Removals are applied first, so an id passed in both
 * arrays ends up in the channel.
 *
 * The creator cannot be removed by anyone, including an admin. Somebody has to
 * be answerable for a room, and a channel whose creator was quietly dropped is
 * a room nobody owns. They can still walk out themselves, via
 * `leave_conversation`.
 */
create or replace function public.update_channel_members(
  p_conversation_id uuid,
  p_add             uuid[],
  p_remove          uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me         uuid := auth.uid();
  v_admin      boolean;
  v_kind       public.conversation_kind;
  v_created_by uuid;
  v_member     uuid;
begin
  if v_me is null then
    raise exception 'You must be signed in to change a channel.';
  end if;

  select c.kind, c.created_by into v_kind, v_created_by
    from public.conversations c where c.id = p_conversation_id;

  if v_kind is null then
    raise exception 'That conversation no longer exists.';
  end if;
  if v_kind <> 'channel' then
    raise exception 'Only a channel has a member list you can change.';
  end if;

  v_admin := public.is_axis_admin();
  if not (
    v_admin
    or v_created_by = v_me
    or (public.has_permission('manage_channels')
        and public.is_conversation_member(p_conversation_id))
  ) then
    raise exception 'You do not have permission to change this channel.';
  end if;

  for v_member in
    select distinct t.m
      from unnest(coalesce(p_remove, '{}'::uuid[])) as t(m)
     where t.m is not null
  loop
    if v_created_by is not null and v_member = v_created_by then
      raise exception 'The person who created this channel cannot be removed.';
    end if;

    delete from public.conversation_members
     where conversation_id = p_conversation_id and profile_id = v_member;
  end loop;

  for v_member in
    select distinct t.m
      from unnest(coalesce(p_add, '{}'::uuid[])) as t(m)
     where t.m is not null
  loop
    if not exists (
      select 1 from public.profiles p
      where p.id = v_member and p.status = 'active'
    ) then
      raise exception 'One of the people you picked is not an active account.';
    end if;

    if not v_admin and v_member <> v_me and not public.can_message(v_member) then
      raise exception 'You can only add people you are allowed to message.';
    end if;

    insert into public.conversation_members (conversation_id, profile_id, added_by)
    values (p_conversation_id, v_member, v_me)
    on conflict (conversation_id, profile_id) do nothing;
  end loop;
end $$;

revoke all     on function public.update_channel_members(uuid, uuid[], uuid[]) from public, anon;
grant  execute on function public.update_channel_members(uuid, uuid[], uuid[]) to authenticated, service_role;


/** Rename a channel. Same authorization as changing its roster. */
create or replace function public.rename_channel(p_conversation_id uuid, p_title text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me         uuid := auth.uid();
  v_kind       public.conversation_kind;
  v_created_by uuid;
  v_title      text;
begin
  if v_me is null then
    raise exception 'You must be signed in to rename a channel.';
  end if;

  select c.kind, c.created_by into v_kind, v_created_by
    from public.conversations c where c.id = p_conversation_id;

  if v_kind is null then
    raise exception 'That conversation no longer exists.';
  end if;
  if v_kind <> 'channel' then
    raise exception 'Only a channel can be renamed.';
  end if;

  if not (
    public.is_axis_admin()
    or v_created_by = v_me
    or (public.has_permission('manage_channels')
        and public.is_conversation_member(p_conversation_id))
  ) then
    raise exception 'You do not have permission to rename this channel.';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if v_title = '' then
    raise exception 'Give the channel a name.';
  end if;
  if char_length(v_title) > 200 then
    raise exception 'That channel name is too long. Keep it to 200 characters.';
  end if;

  update public.conversations set title = v_title where id = p_conversation_id;
end $$;

revoke all     on function public.rename_channel(uuid, text) from public, anon;
grant  execute on function public.rename_channel(uuid, text) to authenticated, service_role;


/**
 * Walk out of a channel.
 *
 * Channels only. A direct message is a relationship rather than a room and
 * leaving one would silently make the other person's replies disappear; a
 * broadcast is a delivery record. Neither should be removable by the recipient,
 * so both raise instead of failing quietly.
 */
create or replace function public.leave_conversation(p_conversation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_kind public.conversation_kind;
begin
  if v_me is null then
    raise exception 'You must be signed in.';
  end if;

  select c.kind into v_kind from public.conversations c where c.id = p_conversation_id;

  if v_kind is null then
    raise exception 'That conversation no longer exists.';
  end if;
  if v_kind <> 'channel' then
    raise exception 'You can only leave a channel. Direct messages and newsletters stay in your inbox.';
  end if;

  delete from public.conversation_members
   where conversation_id = p_conversation_id and profile_id = v_me;

  if not found then
    raise exception 'You are not in that channel.';
  end if;
end $$;

revoke all     on function public.leave_conversation(uuid) from public, anon;
grant  execute on function public.leave_conversation(uuid) to authenticated, service_role;


/**
 * Clear your own unread flag.
 *
 * Silent about a conversation that is not yours or does not exist: the client
 * calls this on every open and fires it and forgets, so an exception here would
 * be noise on a path where there is nothing for the person to do about it. The
 * `and unread` keeps an already-read conversation from writing a row and waking
 * every subscriber.
 */
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.conversation_members
     set unread = false
   where conversation_id = p_conversation_id
     and profile_id = auth.uid()
     and unread;
end $$;

revoke all     on function public.mark_conversation_read(uuid) from public, anon;
grant  execute on function public.mark_conversation_read(uuid) to authenticated, service_role;


/**
 * Everybody the caller may START a conversation with.
 *
 * The contact picker. It filters `profiles` through `can_message()` row by row
 * rather than restating the matrix as a WHERE clause, which costs a couple of
 * index probes per candidate on a roster of hundreds and buys the guarantee
 * that the picker can never offer somebody the RPC will then refuse.
 *
 * Seven columns and no more. No email, no phone, no status: this is a definer
 * function over a table an athlete cannot read at all, so what it selects IS
 * the privacy boundary.
 */
create or replace function public.list_message_contacts()
returns table (
  id           uuid,
  display_name text,
  first_name   text,
  last_name    text,
  avatar_url   text,
  role         public.user_role,
  coach_slug   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    coalesce(
      nullif(btrim(coalesce(p.display_name, '')), ''),
      nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
      'Member'
    ),
    p.first_name,
    p.last_name,
    p.avatar_url,
    p.role,
    p.coach_slug
  from public.profiles p
  where auth.uid() is not null
    and p.status = 'active'
    and p.id <> auth.uid()
    and public.can_message(p.id)
  -- By enum order (athlete, coach, admin) and then by name. The ordinal is
  -- deliberate: `display_name` is also an output parameter of this function, so
  -- naming it here would be ambiguous.
  order by p.role, 2
$$;

revoke all     on function public.list_message_contacts() from public, anon;
grant  execute on function public.list_message_contacts() to authenticated, service_role;


/**
 * Names and faces for every id the client is about to render.
 *
 * Three sets, unioned: everybody who shares a conversation with the caller, the
 * caller themselves, and everybody they could start one with. The first is what
 * turns a `sender_id` into a name; the second is what labels their own
 * messages; the third means the contact picker and the inbox draw from one map
 * instead of two.
 *
 * `union` and not `union all`, so the overlap collapses. The projection is
 * identical to `list_message_contacts()` because it literally selects from it.
 */
create or replace function public.messaging_profiles()
returns table (
  id           uuid,
  display_name text,
  first_name   text,
  last_name    text,
  avatar_url   text,
  role         public.user_role,
  coach_slug   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    coalesce(
      nullif(btrim(coalesce(p.display_name, '')), ''),
      nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
      'Member'
    ),
    p.first_name,
    p.last_name,
    p.avatar_url,
    p.role,
    p.coach_slug
  from public.profiles p
  where auth.uid() is not null
    and (
      p.id = auth.uid()
      or exists (
        select 1
          from public.conversation_members mine
          join public.conversation_members theirs
            on theirs.conversation_id = mine.conversation_id
         where mine.profile_id = auth.uid()
           and theirs.profile_id = p.id
      )
    )

  union

  select c.id, c.display_name, c.first_name, c.last_name, c.avatar_url, c.role, c.coach_slug
  from public.list_message_contacts() c
$$;

revoke all     on function public.messaging_profiles() from public, anon;
grant  execute on function public.messaging_profiles() to authenticated, service_role;


-- ── 10. The permission ──────────────────────────────────────────────────────
--
-- `manage_channels` is the seventeenth key in 016's catalogue and the head-coach
-- pattern again: a senior coach who runs the group rooms without being handed
-- the admin portal. Not sensitive, because everything it can do is bounded by
-- `can_message()` anyway, so holding it widens nobody's reach beyond the people
-- they could already write to one at a time.
--
-- `on conflict do nothing` rather than 016's `do update`: this is one row in a
-- catalogue that file owns and asserts, and re-running this migration should
-- not fight an edit made there.
--
-- Deliberately absent from the coach role defaults. It is granted per person or
-- not at all. The admin row IS written, because 016's own verify block asserts
-- that every catalogue key has one and a new key without it would make that
-- assertion false.

insert into public.permissions (key, label, description, is_sensitive) values
  ('manage_channels', 'Manage channels',
   'Create group message channels and manage their members', false)
on conflict (key) do nothing;

insert into public.role_permissions (role, permission)
values ('admin', 'manage_channels')
on conflict do nothing;


-- ── 11. Realtime ────────────────────────────────────────────────────────────
--
-- The first migration in this database to touch the publication. Everything
-- about the feature is live: the inbox reorders when somebody writes to you,
-- the badge lights without a refresh, an open conversation appends.
--
-- Guarded twice. The `pg_publication_tables` check makes re-running a no-op,
-- since `alter publication … add table` raises on a table that is already in
-- it. The exception handler covers the local case where `supabase_realtime` was
-- never created, and the case where the migration role does not own it: neither
-- is a reason for the whole file to fail to apply, since realtime is an
-- enhancement and the queries underneath work without it.
--
-- Realtime honors RLS, so a subscriber is only sent rows it could already have
-- selected. The policies in section 5 are the subscription's authorization too,
-- which is the reason the Supabase dashboard's realtime RLS setting has to stay
-- on.

do $do$
declare
  t      text;
  wanted text[] := array['conversations', 'conversation_members', 'messages'];
begin
  foreach t in array wanted loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception
  when undefined_object or insufficient_privilege then
    raise notice 'supabase_realtime not available here. Add conversations, conversation_members and messages to it by hand.';
end $do$;

-- Ship the whole old row on update and delete. Without this the payload carries
-- only the primary key, which is not enough for realtime to evaluate RLS on the
-- row that just changed, so a subscriber silently misses it. Both of these are
-- read by subscribers on UPDATE: the conversation for its rollup, the
-- membership row for the unread flag.
alter table public.conversations        replica identity full;
alter table public.conversation_members replica identity full;

-- `messages` is deliberately NOT `replica identity full`. Only INSERT is ever
-- consumed there, the payload for an insert is the whole new row regardless,
-- and message bodies are the largest thing in this schema.


-- ── 12. Verify ──────────────────────────────────────────────────────────────
--
-- Shape first. Seventeen permissions now, and an admin row for every one:
--
--   select count(*) from public.permissions;                              -- 17
--   select count(*) from public.permissions
--    where key not in (select permission from public.role_permissions
--                       where role = 'admin');                            --  0
--   select count(*) from public.role_permissions
--    where role = 'coach' and permission = 'manage_channels';             --  0
--
-- Every table has RLS, and the two RPC-only tables have no write policies:
--
--   select relname, relrowsecurity from pg_class
--    where relname in ('athlete_coaches','conversations','conversation_members',
--                      'messages','message_rate_limits');                 -- all t
--   select tablename, cmd, policyname from pg_policies
--    where tablename in ('conversations','conversation_members')
--      and cmd <> 'SELECT';                                               -- 0 rows
--
-- Anon has nothing at all:
--
--   set role anon;
--   select * from public.conversations        limit 1;  -- permission denied
--   select * from public.conversation_members limit 1;  -- permission denied
--   select * from public.messages             limit 1;  -- permission denied
--   select * from public.athlete_coaches      limit 1;  -- permission denied
--   select public.get_or_create_dm(gen_random_uuid());  -- permission denied for function
--   select public.messaging_profiles();                 -- permission denied for function
--   reset role;
--
-- Now the rules, as a real athlete. Substitute their uuid. `set local` needs a
-- transaction, and setting request.jwt.claim.sub is how to make auth.uid()
-- answer in psql the way it answers under PostgREST:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete uuid>';
--
--     -- their assigned coaches, and only those
--     select id, display_name, role from public.list_message_contacts();
--
--     -- an assigned coach works, and twice returns the same row
--     select public.get_or_create_dm('<assigned coach uuid>');   -- <id>
--     select public.get_or_create_dm('<assigned coach uuid>');   -- the SAME <id>
--   commit;
--   select count(*) from public.conversations where kind = 'dm'; -- one per pair
--
-- Each refusal needs its own transaction, because the raise aborts the one it
-- happens in:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete uuid>';
--     select public.get_or_create_dm('<unassigned coach uuid>');
--     -- ERROR: You cannot start a conversation with that person.
--   rollback;
--
--   -- another athlete is refused too, which is the rule that matters most
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete uuid>';
--     select public.get_or_create_dm('<other athlete uuid>');
--     -- ERROR: You cannot start a conversation with that person.
--   rollback;
--
--   -- and they cannot create a channel
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete uuid>';
--     select public.create_channel('Nope', array[]::uuid[]);
--     -- ERROR: You do not have permission to create channels.
--   rollback;
--
-- The membership boundary, as somebody who is not in the room. The reads must
-- come back EMPTY rather than raise, because RLS filters:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a third person uuid>';
--     select count(*) from public.conversations;        -- 0
--     select count(*) from public.messages;             -- 0
--     select count(*) from public.conversation_members; -- 0
--   rollback;
--
--   -- and they cannot write into it either
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a third person uuid>';
--     insert into public.messages (conversation_id, sender_id, body)
--     values ('<the dm id>', '<a third person uuid>', 'hello');
--     -- ERROR: new row violates row-level security policy for table "messages"
--   rollback;
--
-- Forging a sender inside a room you ARE in fails the same way:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete uuid>';
--     insert into public.messages (conversation_id, sender_id, body)
--     values ('<the dm id>', '<coach uuid>', 'not me');
--     -- ERROR: new row violates row-level security policy for table "messages"
--   rollback;
--
-- The rollup and the unread flag, after one legitimate send:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete uuid>';
--     insert into public.messages (conversation_id, sender_id, body)
--     values ('<the dm id>', '<athlete uuid>', 'first message');
--   commit;
--   select last_message_preview, last_message_from from public.conversations
--    where id = '<the dm id>';                     -- 'first message', athlete
--   select profile_id, unread from public.conversation_members
--    where conversation_id = '<the dm id>';        -- coach t, athlete f
--
-- The dm index is what makes the dedup race-free, and it is worth seeing fail
-- directly. As the owner, RLS out of the way entirely:
--
--   insert into public.conversations (kind, dm_a, dm_b)
--   select 'dm', dm_a, dm_b from public.conversations where kind = 'dm';
--   -- ERROR: duplicate key value violates unique constraint "conversations_dm_uniq"
--
-- Channel authorization, as the coach who created one (grant them
-- manage_channels first, through set_staff_permission, as an admin):
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<coach uuid>';
--     select public.update_channel_members('<channel id>',
--       array['<an athlete they do not coach>']::uuid[], array[]::uuid[]);
--     -- ERROR: You can only add people you are allowed to message.
--   rollback;
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<coach uuid>';
--     select public.update_channel_members('<channel id>',
--       array[]::uuid[], array['<coach uuid>']::uuid[]);
--     -- ERROR: The person who created this channel cannot be removed.
--   rollback;
--
-- A member with no rights over the channel cannot rename it:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete in that channel>';
--     select public.rename_channel('<channel id>', 'Hijacked');
--     -- ERROR: You do not have permission to rename this channel.
--   rollback;
--
-- And leaving is channels only:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete uuid>';
--     select public.leave_conversation('<the dm id>');
--     -- ERROR: You can only leave a channel. Direct messages and newsletters
--     --        stay in your inbox.
--   rollback;
--
-- The assignment guard. All three must fail even here, as the owner, with RLS
-- bypassed entirely, which is the whole reason they are in a trigger:
--
--   insert into public.athlete_coaches (athlete_id, coach_id)
--   select a.id, b.id from public.profiles a, public.profiles b
--    where a.role = 'coach' and b.role = 'coach' and a.id <> b.id limit 1;
--   -- ERROR: Only an athlete can be assigned to a coach.
--
--   insert into public.athlete_coaches (athlete_id, coach_id)
--   select a.id, b.id from public.profiles a, public.profiles b
--    where a.role = 'athlete' and b.role = 'athlete' and a.id <> b.id limit 1;
--   -- ERROR: Only a coach or an admin can be assigned to an athlete.
--
--   insert into public.athlete_coaches (athlete_id, coach_id)
--   select a.id, b.id from public.profiles a, public.profiles b
--    where a.role = 'athlete' and a.status = 'active'
--      and b.role = 'coach' and b.status <> 'active' limit 1;
--   -- ERROR: That coach account is not active.
--
-- And the rule the trigger cannot state, which is that picking your own coach
-- is not an athlete's decision:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete uuid>';
--     insert into public.athlete_coaches (athlete_id, coach_id)
--     values ('<athlete uuid>', '<any coach uuid>');
--     -- ERROR: new row violates row-level security policy for table "athlete_coaches"
--     select count(*) from public.athlete_coaches;  -- only their own rows
--   rollback;
--
-- The rate limiter, as a plain coach. Testing it as an admin proves nothing,
-- because an admin is exempt by design:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<coach uuid>';
--     insert into public.messages (conversation_id, sender_id, body)
--     select '<a channel they are in>', '<coach uuid>', 'flood ' || g
--       from generate_series(1, 40) g;
--     -- ERROR: Rate limit exceeded. Please wait a moment and try again.
--   rollback;
--
-- The same forty sends must SUCCEED for an admin, and for a coach holding
-- send_marketing. That exemption is what lets 022's fan-out reach a roster
-- larger than the limit, so it is the test that protects the newsletter:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<admin uuid>';
--     insert into public.messages (conversation_id, sender_id, body)
--     select '<a channel they are in>', '<admin uuid>', 'blast ' || g
--       from generate_series(1, 40) g;                          -- INSERT 0 40
--   commit;
--   select count(*) from public.message_rate_limits
--    where actor = '<admin uuid>';                              -- 0
--
-- The limiter itself is NOT reachable from the browser, and that is deliberate
-- (section 0). It must refuse even a signed-in caller:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<any uuid>';
--     select public.enforce_message_rate_limit('probe', 1, 60);
--     -- ERROR: permission denied for function enforce_message_rate_limit
--   rollback;
--
-- 022's `cast_vote` reaches it anyway, because a SECURITY DEFINER function runs
-- as the owner. Any definer wrapper demonstrates the shape.
--
-- Realtime, last:
--
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime'
--    and tablename in ('conversations','conversation_members','messages');   -- 3 rows
--   select relname, relreplident from pg_class
--    where relname in ('conversations','conversation_members');              -- both 'f'
--
-- Re-runnable.
