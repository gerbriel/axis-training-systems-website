-- ============================================================
-- Axis Training Systems — 012: invitations
-- ============================================================
--
-- An invitation is a one-time credential: whoever holds it may claim EXACTLY
-- the account Axis described, once, before it expires. That framing decides
-- every design choice below.
--
-- IT HAS TWO HALVES, AND BOTH MATTER.
--
--   The TOKEN half. 32 random bytes, and only its SHA-256 is stored. The
--   plaintext exists in two places ever: the link in the invitee's email, and
--   the response that created it. A leaked backup or an over-broad SELECT
--   yields hashes, not working links. It follows that a pending invitation's
--   link cannot be re-shown — "send a new link" issues a fresh invitation that
--   supersedes the old, which means a rotated link is also a revoked one.
--
--   The EMAIL half. The row also carries the address in plaintext, and
--   `handle_new_user` (011) matches on it. This is what makes Google sign-in
--   work: somebody invited who never opens the link and simply clicks "Continue
--   with Google" a week later is let straight in. Without it, the only way in
--   is to find an email, and a bearer token that must be found is a support
--   ticket waiting to happen.
--
-- The token is therefore what makes the landing page say "Ronnie invited you to
-- coach". The email is what makes the invitation actually take effect. Neither
-- alone is the whole system.
--
-- Re-runnable.
-- ============================================================


-- ── 1. The table ────────────────────────────────────────────────────────────

create table if not exists public.invitations (
  id          bigserial primary key,

  -- Lower-cased on the way in by the trigger; the check then holds it that way,
  -- so the partial unique index below is a real "one live invite per address"
  -- and the match in handle_new_user is a plain equality.
  email       text not null,
  first_name  text,
  last_name   text,
  -- A line from whoever sent it, shown on the accept page. Optional.
  note        text,

  -- The whole point of the row. Immutable after insert — see
  -- invitations_before_update. Nothing may edit an invitation into a
  -- higher-privileged one after the tier check has passed.
  role        public.user_role not null default 'athlete',
  -- Which calendar, when inviting a coach. Meaningless for an athlete and
  -- refused for one below.
  coach_slug  text,

  invited_by  uuid not null references public.profiles (id) on delete cascade,

  -- sha256(token) as lowercase hex. Unique, so a token names one row.
  token_hash  text not null unique,

  expires_at  timestamptz not null default (now() + interval '14 days'),

  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles (id) on delete set null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint invitations_email_normalised
    check (email = lower(email) and position('@' in email) > 1 and length(email) <= 254),
  constraint invitations_token_hash_shape
    check (token_hash ~ '^[0-9a-f]{64}$'),
  -- A bearer credential with no horizon is a password nobody rotates. 31 rather
  -- than 30 so clock skew between whatever computed expires_at and the database
  -- that stamped created_at cannot reject a legitimate 30-day invitation.
  constraint invitations_expiry_bounded
    check (expires_at > created_at and expires_at <= created_at + interval '31 days'),
  constraint invitations_accepted_pair
    check ((accepted_at is null) = (accepted_by is null)),
  -- An athlete has no calendar. A slug here would be written straight onto
  -- their profile by handle_new_user and hand them a coach's bookings.
  constraint invitations_coach_slug_is_staff
    check (role <> 'athlete' or coach_slug is null),
  constraint invitations_coach_slug_shape
    check (coach_slug is null or coach_slug ~ '^[a-z0-9-]+$')
);

-- Inviting the same address twice is normal — the first link went to a typo'd
-- inbox, or they lost it. At most one may be live, so the superseded link stops
-- working the moment the new one is issued.
create unique index if not exists invitations_one_live_per_email
  on public.invitations (email)
  where accepted_at is null and revoked_at is null;

-- handle_new_user's lookup, and the pending screen's.
create index if not exists invitations_live_idx
  on public.invitations (email, expires_at)
  where accepted_at is null and revoked_at is null;

create index if not exists invitations_recent_idx
  on public.invitations (created_at desc);

drop trigger if exists invitations_touch_trg on public.invitations;
create trigger invitations_touch_trg
  before update on public.invitations
  for each row execute function public.profiles_touch();


-- ── 2. Who may invite whom ──────────────────────────────────────────────────
--
-- The RLS policies further down encode the tier rule too, and they are not
-- enough on their own: RLS binds callers that are SUBJECT to it, and the
-- invite-send edge function holds the service role, which is not. A bug in that
-- function — or a later one written in a hurry — could insert role = 'admin' on
-- behalf of a coach and RLS would have nothing to say.
--
-- So the tier check lives in a trigger, and it checks the role of `invited_by`
-- rather than of `auth.uid()`. Triggers fire for the service role too, and
-- `invited_by` is NOT NULL, so there is no caller — not the anon key, not the
-- service key, not psql — that can produce a staff invitation attributed to a
-- non-admin. "Only an admin can create a staff invitation" is then a property
-- of the database rather than a property of one function.

create or replace function public.invitations_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inviter public.profiles%rowtype;
begin
  new.email := lower(btrim(new.email));

  select * into v_inviter from public.profiles where id = new.invited_by;

  if v_inviter.id is null then
    raise exception 'An invitation must name the person who sent it' using errcode = '22023';
  end if;

  -- A suspended account keeps its role so history stays readable. It must not
  -- keep its powers, and inviting people is a power.
  if v_inviter.status <> 'active' then
    raise exception 'A suspended or pending account cannot invite anyone' using errcode = '22023';
  end if;

  if new.role = 'athlete' then
    if v_inviter.role not in ('coach', 'admin') then
      raise exception 'Only a coach or an admin can invite an athlete' using errcode = '22023';
    end if;
  else
    if v_inviter.role <> 'admin' then
      raise exception 'Only an admin can invite staff' using errcode = '22023';
    end if;
    if new.coach_slug is null then
      raise exception 'A coach invitation must name the calendar it is for' using errcode = '22023';
    end if;
    -- Two people cannot own one calendar. profiles_coach_slug_idx would refuse
    -- the second profile anyway, but that failure would happen at SIGNUP —
    -- after the link had been sent, and to the invitee rather than the admin.
    if exists (select 1 from public.profiles where coach_slug = new.coach_slug) then
      raise exception 'That calendar already belongs to somebody' using errcode = '22023';
    end if;
  end if;

  -- An invitation may not ADOPT an account that is already in. Changing
  -- somebody's role is a different operation, it is admin-only, and letting an
  -- invitation do it would mean anyone who can invite an athlete can re-role an
  -- existing one.
  --
  -- A PENDING profile is the exception, and it is the important one. On an
  -- invite-gated site signup is open and admission is not, so the ordinary
  -- sequence is: somebody signs up, waits, and is invited afterwards. Refusing
  -- that address would make `claim_pending_invite` (section 6) unreachable —
  -- the function exists precisely to rescue this person, and there would never
  -- be an invitation for it to find. Which is to say the rule inherited from a
  -- site with open self-signup is the wrong rule for this one.
  if exists (
    select 1 from public.profiles
     where lower(email) = new.email and status in ('active', 'suspended')
  ) then
    raise exception 'That email already has an account — change their role instead'
      using errcode = '22023';
  end if;

  -- Supersede rather than collide with invitations_one_live_per_email. Doing it
  -- here, in the same statement, is what makes "issue a new link" atomically
  -- equal to "revoke the old one".
  update public.invitations
     set revoked_at = now(), revoked_by = new.invited_by
   where email = new.email and accepted_at is null and revoked_at is null;

  return new;
end $$;

revoke all on function public.invitations_before_insert() from public;

drop trigger if exists invitations_guard_insert on public.invitations;
create trigger invitations_guard_insert
  before insert on public.invitations
  for each row execute function public.invitations_before_insert();


-- ── 3. An invitation is not editable ────────────────────────────────────────
--
-- Revoking is the only thing a person may do to one after sending it. Accepting
-- is done by handle_new_user or claim_pending_invite and nothing else. Freezing
-- the rest is what stops the tier check being sidestepped by inserting an
-- athlete invitation and then editing it up to admin.

create or replace function public.invitations_before_update()
returns trigger language plpgsql as $$
begin
  if new.email      is distinct from old.email
     or new.role       is distinct from old.role
     or new.coach_slug is distinct from old.coach_slug
     or new.invited_by is distinct from old.invited_by
     or new.token_hash is distinct from old.token_hash
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at
     or new.first_name is distinct from old.first_name
     or new.last_name  is distinct from old.last_name
     or new.note       is distinct from old.note then
    raise exception 'An invitation cannot be edited — revoke it and send a new one'
      using errcode = '22023';
  end if;

  if old.accepted_at is not null
     and (new.accepted_at is distinct from old.accepted_at
          or new.accepted_by is distinct from old.accepted_by
          or new.revoked_at  is distinct from old.revoked_at) then
    raise exception 'An accepted invitation is a record of what happened and cannot change'
      using errcode = '22023';
  end if;

  if old.revoked_at is not null and new.revoked_at is null then
    raise exception 'A revoked invitation cannot be reinstated' using errcode = '22023';
  end if;

  if new.accepted_at is not null and new.revoked_at is not null then
    raise exception 'A revoked invitation cannot be accepted' using errcode = '22023';
  end if;

  return new;
end $$;

drop trigger if exists invitations_guard_update on public.invitations;
create trigger invitations_guard_update
  before update on public.invitations
  for each row execute function public.invitations_before_update();


-- ── 4. RLS ──────────────────────────────────────────────────────────────────
--
-- No anon policy at all. A row carries an email address, an intended role and a
-- token hash, and none of that is public. The accept page reads what it needs
-- through the definer function in section 5, which takes the token as its
-- argument and can therefore only ever return the one row you already hold a
-- secret for.

alter table public.invitations enable row level security;

drop policy if exists "staff read invitations"  on public.invitations;
drop policy if exists "invite within your tier" on public.invitations;
drop policy if exists "revoke an invitation"    on public.invitations;

create policy "staff read invitations"
  on public.invitations for select to authenticated
  using (public.current_coach_slug() is not null or public.is_axis_admin());

create policy "invite within your tier"
  on public.invitations for insert to authenticated
  with check (
    -- You invite as yourself. Combined with the trigger above — which reads the
    -- role of exactly this column — impersonation buys nothing.
    invited_by = auth.uid()
    and (
      (role = 'athlete' and (public.current_coach_slug() is not null or public.is_axis_admin()))
      or (role <> 'athlete' and public.is_axis_admin())
    )
  );

-- Revoking only. `accepted_at is null` in the WITH CHECK is what stops this
-- policy being used to mark an invitation accepted — that belongs to
-- handle_new_user and claim_pending_invite, which run as definers outside RLS.
create policy "revoke an invitation"
  on public.invitations for update to authenticated
  using (
    accepted_at is null
    and (public.is_axis_admin() or (role = 'athlete' and public.current_coach_slug() is not null))
  )
  with check (
    accepted_at is null
    and (public.is_axis_admin() or (role = 'athlete' and public.current_coach_slug() is not null))
  );

-- No delete policy. An invitation that was sent is a fact about who was offered
-- what, and the invitations screen is the wrong place to lose it.

revoke all on public.invitations from anon;
grant  select, insert, update on public.invitations to authenticated;
grant  usage, select on sequence public.invitations_id_seq to authenticated;


-- ── 5. Reading an invitation before you have an account ─────────────────────
--
-- The accept page must render "Ronnie invited you to join as a coach" before
-- the invitee has signed in, so this is anon-callable. It is safe because the
-- TOKEN IS THE ARGUMENT: without the 256-bit secret it returns nothing, and it
-- can never return a different invitation than the one asked for. No token
-- hash, no id, and no other row is exposed.
--
-- sha256() is the core Postgres function, not pgcrypto's digest(). pgcrypto
-- lives in the `extensions` schema on Supabase and in `public` on a plain
-- Postgres, so a search_path-qualified digest() resolves on one and not the
-- other. sha256(bytea) is in pg_catalog and is always found.

create or replace function public.invitation_preview(p_token text)
returns table (
  email           text,
  role            public.user_role,
  coach_slug      text,
  first_name      text,
  last_name       text,
  note            text,
  invited_by_name text,
  expires_at      timestamptz,
  status          text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.email,
    i.role,
    i.coach_slug,
    i.first_name,
    i.last_name,
    i.note,
    nullif(btrim(coalesce(p.display_name, concat_ws(' ', p.first_name, p.last_name))), ''),
    i.expires_at,
    case
      when i.accepted_at is not null then 'accepted'
      when i.revoked_at  is not null then 'revoked'
      when i.expires_at <= now()     then 'expired'
      else 'pending'
    end
  from public.invitations i
  left join public.profiles p on p.id = i.invited_by
  where length(coalesce(p_token, '')) between 16 and 400
    and i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

grant execute on function public.invitation_preview(text) to anon, authenticated;


-- ── 6. Claiming, after the fact ─────────────────────────────────────────────
--
-- `handle_new_user` consumes an invitation at the moment the account is
-- created, and it fires exactly once. That leaves an ordering gap: somebody who
-- signed up BEFORE being invited sits at `pending` for ever, no matter how many
-- times they sign in, because the invitation issued afterwards is never looked
-- at again.
--
-- This closes it. The /pending screen calls it on load and on "Check again".
--
-- It is authenticated-callable, and safe, because it takes NO arguments: the
-- address it matches on is the signed-in user's own, read from auth.users. There
-- is no parameter here that says "make me a coach" — there is only "look again
-- at me", and what it finds was minted by an insert that already passed the
-- admin-only tier check.
--
-- The privileged-write bypass is set immediately before the one UPDATE and
-- cleared immediately after. `set_config(..., true)` is transaction-scoped, so
-- it cannot leak into another statement or another session.

create or replace function public.claim_pending_invite()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email       text;
  v_invite_id   bigint;
  v_invite_role public.user_role;
  v_invite_slug text;
begin
  if auth.uid() is null then
    return false;
  end if;

  -- Only a pending profile has anything to claim. An active one calling this is
  -- not an error, it is the /pending page being reloaded after it worked.
  select lower(email) into v_email
    from public.profiles where id = auth.uid() and status = 'pending';
  if v_email is null then
    return false;
  end if;

  select id, role, coach_slug into v_invite_id, v_invite_role, v_invite_slug
    from public.invitations
   where email = v_email
     and accepted_at is null
     and revoked_at is null
     and expires_at > now()
   order by created_at desc
   limit 1
   for update;

  if v_invite_id is null then
    return false;
  end if;

  perform set_config('axis.privileged_write', 'on', true);
  update public.profiles
     set status = 'active', role = v_invite_role, coach_slug = v_invite_slug
   where id = auth.uid();
  perform set_config('axis.privileged_write', 'off', true);

  update public.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_invite_id;

  return true;
end $$;

revoke all     on function public.claim_pending_invite() from public;
grant  execute on function public.claim_pending_invite() to authenticated;


-- ── 7. Claiming with the link ───────────────────────────────────────────────
--
-- The email match in section 6 is the safety net and covers almost everything.
-- This covers the one case it cannot: an invitation sent to one address, opened
-- by somebody who signs in with ANOTHER — the classic "invited at
-- work@axis.com, signs in with Google as personal@gmail.com".
--
-- It deliberately does NOT let that succeed. The invited address is the
-- credential Axis issued, and redeeming onto a different one would mean an
-- invitation is transferable, which is not what anybody sending one intends.
-- What this function adds over section 6 is a precise, actionable refusal —
-- "this was sent to w***@axis.com, sign in with that instead" — rather than a
-- pending screen that never resolves and never says why.
--
-- Returns the status as text so the page can say which of the five things
-- happened. It never raises for an invalid token: a 500 on a bad link is a
-- worse experience than a sentence explaining it.

create or replace function public.claim_invitation_token(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv    public.invitations%rowtype;
  v_email  text;
  v_status public.profile_status;
begin
  if auth.uid() is null then
    return 'not_signed_in';
  end if;

  select lower(email), status into v_email, v_status
    from public.profiles where id = auth.uid();
  if v_email is null then
    return 'no_profile';
  end if;

  select * into v_inv
    from public.invitations
   where length(coalesce(p_token, '')) between 16 and 400
     and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   for update;

  if v_inv.id is null      then return 'invalid'; end if;
  if v_inv.revoked_at  is not null then return 'revoked'; end if;
  if v_inv.expires_at <= now()     then return 'expired'; end if;

  -- Already used. If it was used by THIS account, say so plainly — that is a
  -- refresh, not a failure, and the page should send them onward rather than
  -- accuse them of anything.
  if v_inv.accepted_at is not null then
    return case when v_inv.accepted_by = auth.uid() then 'already_yours' else 'already_used' end;
  end if;

  if v_email is distinct from v_inv.email then
    return 'wrong_email';
  end if;

  -- Signed in with the right address and already let in — by handle_new_user at
  -- signup, most likely, which is the ordinary path. Nothing to do.
  if v_status = 'active' then
    return 'already_active';
  end if;
  if v_status = 'suspended' then
    return 'suspended';
  end if;

  perform set_config('axis.privileged_write', 'on', true);
  update public.profiles
     set status = 'active', role = v_inv.role, coach_slug = v_inv.coach_slug
   where id = auth.uid();
  perform set_config('axis.privileged_write', 'off', true);

  update public.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_inv.id;

  return 'claimed';
end $$;

revoke all     on function public.claim_invitation_token(text) from public;
grant  execute on function public.claim_invitation_token(text) to authenticated;


-- ── 8. Verify ───────────────────────────────────────────────────────────────
--
--   set role anon;
--   select * from public.invitations limit 1;            -- permission denied
--   select * from public.invitation_preview('nonsense'); -- 0 rows, no error
--   reset role;
--
-- And the property the trigger exists for — even as the service role, which
-- bypasses RLS entirely, this must fail:
--
--   insert into public.invitations (email, role, coach_slug, invited_by, token_hash)
--   select 'x@example.com', 'admin', 'x', p.id, repeat('a', 64)
--     from public.profiles p where p.role = 'coach' limit 1;
--   -- ERROR: Only an admin can invite staff
