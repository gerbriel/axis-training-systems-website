-- ============================================================
-- Axis Training Systems — 016: the doors that were never locked
-- ============================================================
--
-- An adversarial read of 001–013, from the position of somebody holding the
-- anon key out of the Vite bundle and nothing else.
--
-- NUMBERING. This file was commissioned as 015. 014_coach_calendly_url.sql and
-- 015_newsletter_leads.sql already existed by the time it was written and
-- nothing may be renumbered, so it is 016. Everything below is stated in terms
-- of the finding it closes, and the findings are numbered as they were reported.
--
-- Re-runnable. Every statement is `drop … if exists` / `create or replace` /
-- `if not exists`, and the revokes are idempotent by nature.
--
-- ────────────────────────────────────────────────────────────────────────────
-- THE ONE THAT MATTERS MOST — F1
--
-- Every SECURITY DEFINER function in `public` written since 004 ends with some
-- version of
--
--     revoke all on function public.<name>(…) from public;
--
-- and 007 says out loud why: "Postgres grants EXECUTE TO PUBLIC by default —
-- forgetting this once would turn calendar_connection_get into an anonymous
-- REST endpoint that hands out every coach's Google credential."
--
-- The reasoning is right and the statement does not do it. Supabase does not
-- rely on the PUBLIC pseudo-role. Its project bootstrap runs
--
--     alter default privileges in schema public
--       grant all on functions to postgres, anon, authenticated, service_role;
--
-- so every function created in `public` is granted EXECUTE **directly to anon
-- and to authenticated**, by name. `REVOKE … FROM PUBLIC` removes the implicit
-- PUBLIC grant and leaves both of those standing. The check is
-- has_function_privilege('anon', oid, 'EXECUTE'), and before this file it is
-- TRUE for all twenty-nine definer functions in `public` — including
--
--   • claim_booking_notifications() — returns every queued client's name,
--     email address, stated goals, Meet URL and manage_token, which is the
--     bearer credential that cancels their booking;
--   • calendar_connection_get()     — returns a coach's Google refresh token
--     ciphertext straight out of schema `private`, the schema whose entire
--     purpose is that no client role can name it;
--   • calendar_connection_upsert/_delete, oauth_state_create/_consume —
--     write access to the same;
--   • rate_limit_hit()              — burn any subject's budget from the
--     browser, which turns the booking limiter into a booking blocker.
--
-- Anything reachable as `POST /rest/v1/rpc/<name>` with the publishable key.
--
-- The fix is in two halves. Below, every function gets `revoke … from public,
-- anon, authenticated` followed by an explicit grant to exactly the roles that
-- need it. And the default privilege itself is withdrawn, so the NEXT definer
-- function does not arrive anon-callable and quietly re-open this.
--
-- ⚠ CONSEQUENCE FOR EVERY MIGRATION AFTER THIS ONE: a new function in `public`
-- that the browser calls over PostgREST MUST carry its own
-- `grant execute on function … to anon` / `… to authenticated`. Without it the
-- call fails with "permission denied for function", which is the correct
-- direction to fail in and is exactly the discipline 004–013 already meant to
-- follow.
-- ============================================================


-- ============================================================
-- F1a. Stop new functions arriving anon-callable
-- ============================================================

alter default privileges in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public;


-- ============================================================
-- F1b. Close the twenty-nine that already exist
-- ============================================================
--
-- Grouped by WHO, because that is the only question worth asking of an RPC.
--
-- Note what is NOT re-granted: the trigger functions. Postgres checks EXECUTE
-- on a trigger function at CREATE TRIGGER time and never again — the trigger
-- fires with no privilege check on the writer. Verified against this schema: a
-- booking INSERT by `authenticated` still stamps its status, mirrors to busy
-- and queues its notifications with EXECUTE revoked from every client role.
-- So a trigger function granted to a client role is pure attack surface.

-- The sweep first, then the allowlist. Naming the twenty-nine individually
-- would close them and leave the thirtieth — anything that lands from a
-- migration written alongside this one, or after it and before someone reads
-- the header — open. So: EXECUTE is taken from anon and authenticated on every
-- SECURITY DEFINER function in `public`, and only then handed back.
--
-- Anything swept that is not re-granted below is reported by name at apply
-- time. If one of those is an RPC the browser calls, the fix is a
-- `grant execute … to anon` in ITS migration, not a hole left open in this one.
do $$
declare
  v_fn   text;
  v_left text[];
begin
  for v_fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
  end loop;
end $$;

do $$
declare
  v_fn text;
begin
  -- ── Nobody. Trigger bodies and internal helpers. ──
  foreach v_fn in array array[
    'public.bookings_enqueue_notifications()',
    'public.bookings_link_client()',
    'public.bookings_mirror_to_busy()',
    'public.bookings_set_sync_status()',
    'public.bookings_stamp_status()',
    'public.guard_testimonial_main_status()',
    'public.handle_new_user()',
    'public.handle_user_email_change()',
    'public.invitations_before_insert()',
    'public.invitations_before_update()',
    'public.leads_invite_on_accept()',
    'public.profiles_adopt_bookings()',
    'public.profiles_guard_privileges()',
    'public.profiles_touch()',
    'public.coach_notify_email(text)',
    'public.mint_invitation_token()',
    'public.booking_enqueue(public.bookings, public.booking_notification_kind, timestamptz)',
    'public.booking_enqueue_coach(public.bookings, public.booking_notification_kind, timestamptz, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;

  -- ── service_role only. Every one of these can see or move a credential. ──
  foreach v_fn in array array[
    'public.calendar_connection_upsert(text, text, text, text, text)',
    'public.calendar_connection_get(text)',
    'public.calendar_connection_list()',
    'public.calendar_connection_mark_synced(text, text, text)',
    'public.calendar_connection_delete(text)',
    'public.oauth_state_create(text, text, text)',
    'public.oauth_state_consume(text)',
    'public.claim_booking_notifications(int)',
    'public.rate_limit_hit(text, text, int, int)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;

  -- ── Signed-in users. No argument on any of these names another person. ──
  foreach v_fn in array array[
    'public.is_axis_admin()',
    'public.is_content_admin()',
    'public.current_coach_slug()',
    'public.calendar_connection_status()',
    'public.claim_pending_invite()',
    'public.claim_invitation_token(text)',
    -- The permission helpers (016). The blanket sweep above revokes EXECUTE
    -- from every SECURITY DEFINER function in public, and 016 runs before this
    -- file, so without naming them here the sweep would leave has_permission and
    -- its siblings uncallable by authenticated — every permission check in the
    -- portal would fail closed and the admin UI would go blank. These grants
    -- restate 016's own grants exactly; the uuid-argument ones are gated
    -- internally (an admin reads another person''s effective set), which is why
    -- 016 already deemed them safe for authenticated.
    'public.is_axis_staff()',
    'public.has_permission(text)',
    'public.profile_has_permission(uuid, text)',
    'public.can_grant_permission(uuid, text)',
    'public.effective_permissions(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated, service_role', v_fn);
  end loop;

  -- set_staff_permission stamps granted_by from auth.uid(), which is null for
  -- the service role, so it is authenticated-only by design (016). Kept out of
  -- the loop above for that reason.
  execute 'revoke all on function public.set_staff_permission(uuid, text, boolean, text) from public, anon, service_role';
  execute 'grant execute on function public.set_staff_permission(uuid, text, boolean, text) to authenticated';

  -- ── Everyone, deliberately. Both are argument-gated and leak nothing. ──
  foreach v_fn in array array[
    'public.invitation_preview(text)',
    'public.coach_slug_exists(text)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('grant execute on function %s to anon, authenticated, service_role', v_fn);
  end loop;
end $$;

-- Say out loud what the sweep closed and nothing re-opened. On 001–013 this is
-- silent; it speaks up the moment a migration adds a definer RPC without
-- deciding who may call it.
do $$
declare
  v_orphans text;
begin
  select string_agg(format('%s.%s', n.nspname, p.proname), ', ' order by p.proname)
    into v_orphans
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('anon',          p.oid, 'EXECUTE')
     and not has_function_privilege('service_role',  p.oid, 'EXECUTE')
     and p.prorettype <> 'pg_catalog.trigger'::regtype;

  if v_orphans is not null then
    raise notice
      '016: these SECURITY DEFINER functions are now callable by no client role. If any is an RPC the app calls, add an explicit grant in its own migration: %',
      v_orphans;
  end if;
end $$;

-- booking_ends_at is the exception, and it must stay granted. It is not an RPC:
-- it is the expression behind `bookings.ends_at`, a STORED generated column, and
-- unlike a trigger a generated column IS privilege-checked against the writer.
-- Revoking it makes every booking insert fail with "permission denied for
-- function booking_ends_at". It takes two scalars, returns their sum, reads
-- nothing and is not SECURITY DEFINER — there is no surface here to close.
grant execute on function public.booking_ends_at(timestamptz, int) to anon, authenticated, service_role;


-- ============================================================
-- F2. `coach_routing` is writable by every signed-in account
-- ============================================================
--
--   001:97  create policy "admin full access to coach_routing"
--             on coach_routing for all to authenticated using (true) with check (true);
--
-- 002 dropped the identically-shaped policy on `leads`. This one was never
-- dropped, and "authenticated" stopped meaning "one of the five coaches" in
-- 011, which gave every client a login, and again in 013, which turns an
-- accepted application into an account on its own.
--
-- What made it critical rather than untidy is `handle_new_user`'s Gate 2 (011):
-- a new signup whose address appears in coach_routing with a slug is admitted
-- as a coach, and as an ADMIN if the row says is_admin. So the full chain, with
-- nothing but the publishable key, is:
--
--   1. sign up as anyone;                        → role `authenticated`
--   2. POST /rest/v1/coach_routing
--      {"coach_name":"x","email":"me2@evil","coach_slug":"x","is_admin":true};
--   3. sign up again as me2@evil;                → profiles.role = 'admin'
--
-- Proven end to end: step 3 produced role=admin, status=active on a database
-- built from 001–013.
--
-- Two lesser paths close with it: `coach_notify_email` (010) reads this table
-- to address the coach's booking alerts, so rewriting a row redirected another
-- coach's client mail to the attacker; and the `leads` policies in F3 resolve
-- identity through it.

drop policy if exists "admin full access to coach_routing" on public.coach_routing;
drop policy if exists "public can read coach_routing"      on public.coach_routing;
drop policy if exists "coach_routing_public_read"          on public.coach_routing;
drop policy if exists "coach_routing_staff_read"           on public.coach_routing;
drop policy if exists "coach_routing_admin_write"          on public.coach_routing;

-- WHO: everyone, for the roster facts a public page could want. The row also
-- carries `email` and `is_admin`, and 014 noted that the 001 policy exposed the
-- whole row to anon while declining to narrow it, on the grounds that an edge
-- function depended on the read. It does not: every edge function that touches
-- coach_routing (send-lead-email, booking-update, google-oauth, _shared/db.ts)
-- builds its client with SUPABASE_SERVICE_ROLE_KEY, and _shared/db.ts says so
-- in a comment. Nothing in src/ reads this table except AdminSettings, which is
-- the admin panel. So the policy stays open and the COLUMN GRANT is what
-- narrows it — the same shape 005 used for coach_availability_blocks.reason.
create policy "coach_routing_public_read"
  on public.coach_routing for select to anon
  using (true);

-- WHO: staff, whole row. The portal needs the notify flag and the address.
create policy "coach_routing_staff_read"
  on public.coach_routing for select to authenticated
  using (public.current_coach_slug() is not null or public.is_axis_admin());

-- WHO: an active admin. This table decides who becomes staff at signup; it is
-- an admin-only table by consequence, not by convention.
create policy "coach_routing_admin_write"
  on public.coach_routing for all to authenticated
  using (public.is_axis_admin()) with check (public.is_axis_admin());

revoke all on public.coach_routing from anon, authenticated;
grant  select, insert, update, delete on public.coach_routing to authenticated;

-- `calendly_url` arrives in 014, and 014 is the one file in this sequence that
-- has been rewritten more than once. Grant it only if it is there, so 016 does
-- not fail on a database where the column has not landed yet — and so that the
-- anon surface is the same either way: never `email`, never `is_admin`.
do $$
begin
  execute 'grant select (id, coach_name, coach_slug) on public.coach_routing to anon';
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'coach_routing'
       and column_name = 'calendly_url'
  ) then
    execute 'grant select (calendly_url) on public.coach_routing to anon';
  end if;
end $$;


-- ============================================================
-- F3. `leads` is readable and writable by any signed-in account
-- ============================================================
--
--   002:19  create policy "master admin access to leads"
--             on leads for all to authenticated
--             using (not exists (select 1 from coach_routing
--                                 where lower(email) = lower(auth.email())));
--
-- Fail-open, and 005 wrote the diagnosis of this exact shape three years of
-- migrations ago — "the previous 'absent from coach_routing = master admin'
-- rule was fail-open … anyone could self-register an unknown email, land in the
-- 'absent' branch, and read every client's PII" — then fixed only
-- `is_content_admin()` and left the policy that says the same thing in place.
--
-- Confirmed: an account created seconds ago, with a pending athlete profile,
-- selects and updates every row of `leads`. That is the whole application
-- intake — name, email, injuries, occupation, training history, goals — plus
-- `admin_notes`, the coach's private assessment of the applicant.
--
-- And it is a privilege escalation as well as a disclosure, through 013:
-- `leads_invite_on_accept` fires on `status → 'accepted'` and activates a
-- pending profile at that address. So the attacker inserts a lead carrying
-- their own email, accepts it, and admits themselves to an invite-gated site.
-- Proven: profiles.status went pending → active with no invitation involved.
--
-- The replacement resolves identity through `profiles` (011), not through an
-- email lookup in a table that F2 has only just stopped being client-writable.

drop policy if exists "master admin access to leads"  on public.leads;
drop policy if exists "coaches can read own leads"    on public.leads;
drop policy if exists "coaches can update own leads"  on public.leads;
drop policy if exists "leads_admin_all"               on public.leads;
drop policy if exists "leads_coach_read_own"          on public.leads;
drop policy if exists "leads_coach_update_own"        on public.leads;

-- `leads.coach_pref` stores the coach's DISPLAY NAME ('Ronnie Vallejo'), which
-- is what the public application form posts. profiles carries the slug. This is
-- the one join between them, and it is SECURITY DEFINER for the same reason
-- current_coach_slug() is: a policy on `leads` cannot depend on the caller's own
-- read access to coach_routing.
create or replace function public.current_coach_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.coach_name
    from public.coach_routing r
   where r.coach_slug = public.current_coach_slug()
   limit 1
$$;

revoke all     on function public.current_coach_name() from public, anon;
grant  execute on function public.current_coach_name() to authenticated, service_role;

create policy "leads_admin_all"
  on public.leads for all to authenticated
  using (public.is_axis_admin()) with check (public.is_axis_admin());

create policy "leads_coach_read_own"
  on public.leads for select to authenticated
  using (coach_pref is not null and coach_pref = public.current_coach_name());

create policy "leads_coach_update_own"
  on public.leads for update to authenticated
  using (coach_pref is not null and coach_pref = public.current_coach_name())
  with check (coach_pref is not null and coach_pref = public.current_coach_name());

-- The public application form is the only anon write, and it may not choose the
-- row's ADMIN fields. `status` in particular: an anon INSERT with
-- status = 'accepted' lands a pre-approved application in the review queue.
-- (It does not fire leads_invite_on_accept — that trigger is AFTER UPDATE OF
-- status — but the queue is what a coach trusts.) Column grants rather than a
-- table grant, so `id`, `created_at`, `status` and `admin_notes` are simply not
-- addressable from the form.
revoke all on public.leads from anon, authenticated;
grant  insert (first_name, last_name, email, social, service, coach_pref,
               age, height, body_weight, weight_class, experience, injuries,
               train_days, occupation, squat_max, bench_max, dead_max,
               squat_freq, bench_freq, dead_freq, current_program,
               squat_style, bench_style, dead_style, weak_points,
               learning_style, sleep, nutrition, stress, recovery,
               expectations, goals)
  on public.leads to anon;
grant  select, insert, update, delete on public.leads to authenticated;


-- ============================================================
-- F4. `admin_config` holds a live API key and is world-readable to logins
-- ============================================================
--
--   001:100 create policy "admin full access to admin_config"
--             on admin_config for all to authenticated using (true) with check (true);
--
-- 001:85 seeds this table with a row named `resend_api_key`, under a comment
-- that says to store the Resend key there. 007 acknowledged the shape in
-- passing — "never in admin_config, which every authenticated coach can read" —
-- but every authenticated ACCOUNT can read it, which since 011 includes every
-- athlete and since 013 includes anybody whose application was accepted. A
-- Resend key sends mail as Axis from anywhere.
--
-- Proven: a pending athlete selected `re_LIVE_…` out of this table.

drop policy if exists "admin full access to admin_config" on public.admin_config;
drop policy if exists "admin_config_admin_only"           on public.admin_config;

create policy "admin_config_admin_only"
  on public.admin_config for all to authenticated
  using (public.is_axis_admin()) with check (public.is_axis_admin());

revoke all on public.admin_config from anon, authenticated;
grant  select, insert, update, delete on public.admin_config to authenticated;

-- Not a substitute for moving the credential. `private.app_settings` (007)
-- exists precisely because a bearer credential does not belong in a table any
-- portal screen can read, and the edge functions already take RESEND_API_KEY
-- from the Function Secret store. Blank the row once the secret is confirmed
-- set — this migration will not do it for you, because a database that silently
-- empties a key somebody is still reading is worse than one that does not.
comment on table public.admin_config is
  'Operator settings readable by an active admin only (016). Do NOT store bearer '
  'credentials here — resend_api_key is a leftover from 001 and belongs in the '
  'edge functions'' secret store or private.app_settings.';


-- ============================================================
-- F5. Every signed-in account can rewrite every coach's calendar
-- ============================================================
--
--   003:71  create policy "auth_all_schedules" on coach_schedules for all
--             using (auth.role() = 'authenticated') with check (true);
--   003:72  … the same for coach_availability_blocks
--   003:74  … the same for pageviews
--
-- 005 fixed the identical `auth_all_bookings` and said so — "003's
-- auth_all_bookings gave EVERY authenticated user full read/write over EVERY
-- booking … Same defect 002 fixed for `leads`; it was never applied to
-- `bookings`." It was never applied to these three either.
--
-- `delete from coach_schedules` from any account empties the booking page for
-- the whole roster; an insert into coach_availability_blocks blocks any coach
-- out of any day.

drop policy if exists "auth_all_schedules"        on public.coach_schedules;
drop policy if exists "auth_all_blocks"           on public.coach_availability_blocks;
drop policy if exists "auth_all_pageviews"        on public.pageviews;
drop policy if exists "schedules_coach_write_own" on public.coach_schedules;
drop policy if exists "schedules_admin_all"       on public.coach_schedules;
drop policy if exists "blocks_coach_write_own"    on public.coach_availability_blocks;
drop policy if exists "blocks_admin_all"          on public.coach_availability_blocks;
drop policy if exists "pageviews_staff_read"      on public.pageviews;
drop policy if exists "pageviews_admin_write"     on public.pageviews;

-- `public_read_schedules` / `public_read_blocks` (003) stay exactly as they are.
-- Published working hours and the dates a coach is unavailable are what the
-- booking page is for, and 005 already narrowed anon's block columns so the
-- private `reason` is not among them.

-- WHO: the coach whose calendar it is. Slug from the verified JWT via profiles,
-- never from the client. WITH CHECK repeats USING so a coach cannot write a row
-- onto somebody else's slug on the way out.
create policy "schedules_coach_write_own"
  on public.coach_schedules for all to authenticated
  using (coach_slug = public.current_coach_slug())
  with check (coach_slug = public.current_coach_slug());

create policy "schedules_admin_all"
  on public.coach_schedules for all to authenticated
  using (public.is_axis_admin()) with check (public.is_axis_admin());

create policy "blocks_coach_write_own"
  on public.coach_availability_blocks for all to authenticated
  using (coach_slug = public.current_coach_slug())
  with check (coach_slug = public.current_coach_slug());

create policy "blocks_admin_all"
  on public.coach_availability_blocks for all to authenticated
  using (public.is_axis_admin()) with check (public.is_axis_admin());

-- Pageviews are the analytics panel's raw material. Staff read them; nobody
-- edits or deletes them but an admin. The anon INSERT (003) is untouched — the
-- whole point of the table is that a visitor records their own visit.
create policy "pageviews_staff_read"
  on public.pageviews for select to authenticated
  using (public.current_coach_slug() is not null or public.is_axis_admin());

create policy "pageviews_admin_write"
  on public.pageviews for all to authenticated
  using (public.is_axis_admin()) with check (public.is_axis_admin());

revoke all on public.pageviews from anon, authenticated;
grant  insert (path, referrer, session_id) on public.pageviews to anon, authenticated;
grant  select, update, delete on public.pageviews to authenticated;

revoke all on public.coach_schedules from anon, authenticated;
grant  select on public.coach_schedules to anon, authenticated;
grant  insert, update, delete on public.coach_schedules to authenticated;

-- 005 set anon's block columns; restated here because the revoke above is a
-- table-wide reset and would otherwise drop them.
revoke all on public.coach_availability_blocks from anon, authenticated;
grant  select (id, coach_slug, block_date, start_time, end_time)
  on public.coach_availability_blocks to anon;
grant  select, insert, update, delete on public.coach_availability_blocks to authenticated;

-- KNOWN AND ACCEPTED: `public_read_blocks` is `using (true)` for every role, so
-- a signed-in coach can read another coach's block `reason`. Narrowing it needs
-- a per-column split that RLS cannot express and that would blank the block list
-- for any visitor who happens to be logged in. Staff-to-staff, and the write
-- side — which is what an attacker wanted — is closed above.


-- ============================================================
-- F6. A client reads coach_notes and manage_token off `bookings`
-- ============================================================
--
-- 013 opens with the correct analysis: "A row in `bookings` is not a
-- client-facing object. It carries `coach_notes`, which is the coach's private
-- assessment of the person reading it, and `manage_token`, which is a bearer
-- credential. RLS is row-level and cannot withhold a column, so 'let a client
-- read their own booking' through a policy alone hands over both. Hence a
-- view."
--
-- It then creates the view AND the policy. `authenticated` still holds table
-- SELECT on every column of `bookings`, so
--
--     GET /rest/v1/bookings?select=coach_notes,manage_token
--
-- returns exactly the two things the view exists to withhold. Proven against
-- 001–013 with an athlete account.
--
-- The fix is the fallback 013 already described and reasoned about: the view
-- runs with the OWNER's rights and its own WHERE clause is the restriction, so
-- the row-level policy on the base table is not needed and is removed. 013's
-- warning applies unchanged and is the reason the predicate lives in the body —
-- do not move `where b.client_id = auth.uid()` out of it.

drop policy if exists "client reads own bookings" on public.bookings;

drop view if exists public.my_bookings;

create view public.my_bookings as
  select
    b.id,
    b.coach_slug,
    b.booked_at,
    b.ends_at,
    b.duration_minutes,
    b.status,
    b.service_name,
    b.service_price_cents,
    b.goals,
    b.google_meet_url,
    b.manage_token,
    b.cancelled_at,
    b.cancellation_reason,
    b.created_at
  from public.bookings b
  where b.client_id = auth.uid();

comment on view public.my_bookings is
  'A client''s own bookings, without coach_notes. Runs with the owner''s rights '
  'and is restricted by its own WHERE clause (016): the base table carries no '
  'client-facing SELECT policy, so this view is the only path and cannot be '
  'widened by asking for a different column list. manage_token IS included: it '
  'is this person''s own cancel link and they already have it in their email.';

-- SELECT and nothing else. Supabase's default privileges granted INSERT/UPDATE/
-- DELETE on this view to `authenticated` when 013 created it, and a simple view
-- over one table is auto-updatable — with the owner's rights, that would have
-- been a write path around every policy on `bookings`.
revoke all   on public.my_bookings from anon, authenticated;
grant  select on public.my_bookings to authenticated;


-- ============================================================
-- F7. The privileged-write GUC is a flag anyone could set
-- ============================================================
--
--   011:148  if coalesce(current_setting('axis.privileged_write', true), 'off') = 'on'
--              then return new;
--
-- `profiles_guard_privileges` is the whole of "nobody promotes themselves": the
-- UPDATE policy on `profiles` is `id = auth.uid()`, and this trigger is what
-- stops that from also meaning "you may set your own role to admin". Its bypass
-- is a session string with a fixed, published value.
--
-- Is it reachable from the browser today? Not directly. PostgREST runs one
-- transaction per request and exposes only functions in its configured schemas;
-- `set_config` lives in `pg_catalog` and is not among them, and no function in
-- `public` wraps it. So there is no confirmed anon-key exploit.
--
-- It is still the wrong shape, and the reason is that the bypass is not bound
-- to anything. It is a global mutable string, and it is one of: a future RPC
-- that calls set_config for an unrelated reason; a `db-pre-request` hook; a
-- single `set_config(…, false)` on a pooled connection, which makes every
-- later request on that connection privileged; or any SQL injection anywhere in
-- any definer function. Any one of those is total: role, status and coach_slug
-- all become self-assignable. Demonstrated on the 001–013 schema — with the GUC
-- set, a pending athlete promoted itself to an active admin in one UPDATE.
--
-- So the flag is replaced by a ticket the caller cannot forge. The ticket lives
-- in schema `private`, on which no client role holds USAGE (007), keyed by the
-- current transaction id, and it is written only by a SECURITY DEFINER function
-- that no client role may execute. Being transaction-keyed it also cannot
-- outlive its transaction: an abort rolls the row back with everything else,
-- and a committed one names a transaction id that will never occur again.

-- `depth` makes the ticket RE-ENTRANT, which it has to be the moment more than
-- one ticketed flow can nest in a single transaction. That happens as soon as
-- the permission system lands: a self-claim (claim_pending_invite) takes a
-- ticket to change a profile's role, and that role change fires
-- clear_permission_overrides_on_role_change (016), which takes a ticket of its
-- own to delete the now-stale overrides. Without a depth count, the inner
-- flow's `end()` would delete the outer flow's ticket, and any privileged write
-- the outer flow still had to do would hit the guard with no ticket and raise.
-- A plain `on conflict do nothing` + unconditional delete is not re-entrant.
--
-- The security property is untouched: an attacker still cannot reach begin() at
-- all (revoked from every client role, and the table is RLS-locked with no
-- policy), so depth can never leave 0 for them.
create table if not exists private.privileged_write_ticket (
  txid       bigint primary key,
  depth      int not null default 0,
  granted_at timestamptz not null default now()
);

-- A pre-016 database created this table without `depth`; add it on re-run.
alter table private.privileged_write_ticket add column if not exists depth int not null default 0;

alter table private.privileged_write_ticket enable row level security;
revoke all on private.privileged_write_ticket from public, anon, authenticated, service_role;

create or replace function private.privileged_write_begin()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.privileged_write_ticket (txid, depth)
  values (pg_catalog.pg_current_xact_id()::text::bigint, 1)
  on conflict (txid) do update set depth = private.privileged_write_ticket.depth + 1
$$;

-- Decrement, and release only when the outermost caller ends.
--
-- TWO statements, deliberately, not one CTE. A `with bumped as (update …
-- returning) delete … using bumped` cannot work: Postgres refuses to both
-- UPDATE and DELETE the same tuple in a single command, so the delete silently
-- skips the row it just decremented and the ticket leaks at depth 0. Sequential
-- statements in a SQL function each see the previous one's effect within the
-- transaction, so the delete reads the freshly-written depth. (Found by
-- verification: the CTE form left one depth-0 row per ticketed flow.)
--
-- `depth <= 0` rather than `= 0` tolerates an unbalanced end() rather than
-- leaving a ticket alive for the rest of the transaction, which is the one
-- thing this must never do — a within-txn leak keeps the bypass open for later
-- statements. (A ticket cannot outlive its transaction regardless: the txid is
-- an xid8 and never recurs, so a committed stray can never match a future txn.)
create or replace function private.privileged_write_end()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update private.privileged_write_ticket
     set depth = depth - 1
   where txid = pg_catalog.pg_current_xact_id()::text::bigint;
  delete from private.privileged_write_ticket
   where txid = pg_catalog.pg_current_xact_id()::text::bigint and depth <= 0;
$$;

-- `_if_assigned` rather than `pg_current_xact_id()`: the guard must answer
-- "false" cheaply for a transaction that never took a ticket, not force an xid
-- assignment of its own.
create or replace function private.privileged_write_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.privileged_write_ticket t
     where t.txid = pg_catalog.pg_current_xact_id_if_assigned()::text::bigint
       and t.depth > 0
  )
$$;

revoke all on function private.privileged_write_begin()  from public, anon, authenticated, service_role;
revoke all on function private.privileged_write_end()    from public, anon, authenticated, service_role;
revoke all on function private.privileged_write_active() from public, anon, authenticated, service_role;


-- The guard itself. Identical to 011 except for what it trusts.
create or replace function public.profiles_guard_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.privileged_write_active() then
    return new;
  end if;

  if auth.uid() is not null and not public.is_axis_admin() then
    new.role       := old.role;
    new.status     := old.status;
    new.coach_slug := old.coach_slug;
  end if;

  return new;
end $$;

revoke all on function public.profiles_guard_privileges() from public, anon, authenticated, service_role;

drop trigger if exists profiles_guard_privileges_trg on public.profiles;
create trigger profiles_guard_privileges_trg
  before update on public.profiles
  for each row execute function public.profiles_guard_privileges();


-- ============================================================
-- F7b. The four callers, moved onto the ticket
-- ============================================================
-- Bodies are 011/012/013 verbatim apart from the two bypass lines and, in
-- handle_new_user, the confirmation gate of F8. Each still takes the ticket
-- immediately before ONE update and gives it back immediately after, with no
-- branch in between that could return while holding it.

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email and coalesce(new.email, '') <> '' then
    perform private.privileged_write_begin();
    update public.profiles set email = lower(new.email) where id = new.id;
    perform private.privileged_write_end();
  end if;
  return new;
end $$;

revoke all on function public.handle_user_email_change() from public, anon, authenticated, service_role;


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

  -- F8: an address that has not been proven belongs to nobody. Cheap here, and
  -- it makes "an invitation is redeemed by the person who holds the mailbox" a
  -- property of the database rather than of a project setting.
  if not exists (
    select 1 from auth.users u
     where u.id = auth.uid() and u.email_confirmed_at is not null
  ) then
    return false;
  end if;

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

  perform private.privileged_write_begin();
  update public.profiles
     set status = 'active', role = v_invite_role, coach_slug = v_invite_slug
   where id = auth.uid();
  perform private.privileged_write_end();

  update public.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_invite_id;

  return true;
end $$;

revoke all     on function public.claim_pending_invite() from public, anon;
grant  execute on function public.claim_pending_invite() to authenticated, service_role;


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

  if v_inv.accepted_at is not null then
    return case when v_inv.accepted_by = auth.uid() then 'already_yours' else 'already_used' end;
  end if;

  if v_email is distinct from v_inv.email then
    return 'wrong_email';
  end if;

  if v_status = 'active' then
    return 'already_active';
  end if;
  if v_status = 'suspended' then
    return 'suspended';
  end if;

  -- F8, same reasoning as claim_pending_invite. Distinct return value so the
  -- accept page can say "confirm your email address first" rather than showing
  -- a link that does nothing.
  if not exists (
    select 1 from auth.users u
     where u.id = auth.uid() and u.email_confirmed_at is not null
  ) then
    return 'email_unconfirmed';
  end if;

  perform private.privileged_write_begin();
  update public.profiles
     set status = 'active', role = v_inv.role, coach_slug = v_inv.coach_slug
   where id = auth.uid();
  perform private.privileged_write_end();

  update public.invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_inv.id;

  return 'claimed';
end $$;

revoke all     on function public.claim_invitation_token(text) from public, anon;
grant  execute on function public.claim_invitation_token(text) to authenticated, service_role;


create or replace function public.leads_invite_on_accept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email   text := lower(btrim(coalesce(new.email, '')));
  v_user    uuid;
  v_status  public.profile_status;
  v_inviter uuid := auth.uid();
begin
  if v_email = '' or position('@' in v_email) < 2 then
    return new;
  end if;

  select id, status into v_user, v_status
    from public.profiles where lower(email) = v_email limit 1;

  if v_status = 'active' or v_status = 'suspended' then
    return new;
  end if;

  if v_user is not null then
    perform private.privileged_write_begin();
    update public.profiles set status = 'active' where id = v_user;
    perform private.privileged_write_end();
    return new;
  end if;

  if v_inviter is null or not exists (select 1 from public.profiles where id = v_inviter) then
    select id into v_inviter
      from public.profiles where role = 'admin' and status = 'active'
      order by created_at limit 1;
  end if;
  if v_inviter is null then
    return new;
  end if;

  begin
    insert into public.invitations (
      email, first_name, last_name, role, invited_by, token_hash, note
    ) values (
      v_email,
      nullif(btrim(new.first_name), ''),
      nullif(btrim(new.last_name), ''),
      'athlete',
      v_inviter,
      encode(sha256(convert_to(public.mint_invitation_token(), 'UTF8')), 'hex'),
      'Application accepted'
    );
  exception when others then
    raise warning 'lead % accepted but invitation not issued: %', new.id, sqlerrm;
  end;

  return new;
end $$;

revoke all on function public.leads_invite_on_accept() from public, anon, authenticated, service_role;


-- ============================================================
-- F8. Pre-registering somebody else's invited address
-- ============================================================
--
-- `handle_new_user` (011) admits a signup by matching `auth.users.email`
-- against a live invitation, and 012 explains why the match is by email rather
-- than by token — it is what makes "Continue with Google" work for an invitee
-- who never opened the link. Correct, and it rests on an assumption stated
-- nowhere: that the address on the auth user has been PROVEN to belong to them.
--
-- With Supabase email confirmation off, it has not. Anyone who learns or
-- guesses an invited address signs up with it first, and the trigger hands them
-- whatever the invitation described — for a staff invitation, an active coach
-- profile carrying that coach's slug, which is read access to that coach's
-- clients' phone numbers.
--
-- ⚠ OPERATOR REQUIREMENT, and it is not optional:
--
--     Supabase Dashboard → Authentication → Sign In / Providers → Email
--       "Confirm email"  MUST be ON.
--
-- The same assumption is load-bearing in two more places, both closed below:
-- `profiles_adopt_bookings` (013) attaches every past booking made at an
-- address to whoever registers it, and `my_bookings` then hands over that
-- booking's manage_token; and `claim_pending_invite` / `claim_invitation_token`
-- (F7b) admit on the same match.
--
-- What this section adds is that the database no longer takes it on trust. A
-- signup whose address is unconfirmed becomes a pending athlete and nothing
-- else, however many invitations name it. The gates re-run the moment the
-- address is confirmed, so the ordinary flows are unchanged: an OAuth signup
-- arrives with email_confirmed_at already set and is admitted immediately, and
-- a password signup is admitted when the confirmation link is clicked.

-- Gate 1 (a live invitation) and Gate 2 (already on the roster), lifted out of
-- handle_new_user so the confirmation trigger can run exactly the same logic
-- rather than a second copy of it that drifts.
create or replace function public.admit_confirmed_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email       text;
  v_role        public.user_role;
  v_coach_slug  text;
  v_invite_id   bigint;
  v_invite_role public.user_role;
  v_invite_slug text;
begin
  select lower(p.email) into v_email
    from public.profiles p where p.id = p_user_id and p.status = 'pending';
  if v_email is null then
    return;                                   -- no profile, or already admitted
  end if;

  -- ── Gate 1: a live invitation for this address ──
  select id, role, coach_slug into v_invite_id, v_invite_role, v_invite_slug
    from public.invitations
   where email = v_email
     and accepted_at is null
     and revoked_at is null
     and expires_at > now()
   order by created_at desc
   limit 1
   for update;

  if v_invite_id is not null then
    v_role       := v_invite_role;
    v_coach_slug := v_invite_slug;
  else
    -- ── Gate 2: already on the roster ──
    -- F2 made coach_routing admin-write-only, which is what this gate always
    -- assumed: a row here is an admin decision carrying the same trust as an
    -- invitation. Before F2 it was writable by any signed-in account and this
    -- was a two-signup path to an admin profile.
    select case when r.is_admin then 'admin'::public.user_role
                else 'coach'::public.user_role end,
           r.coach_slug
      into v_role, v_coach_slug
      from public.coach_routing r
     where lower(r.email) = v_email and r.coach_slug is not null
     limit 1;

    if v_coach_slug is null then
      return;                                 -- nothing admits this address yet
    end if;
  end if;

  perform private.privileged_write_begin();
  update public.profiles
     set status = 'active', role = v_role, coach_slug = v_coach_slug
   where id = p_user_id;
  perform private.privileged_write_end();

  if v_invite_id is not null then
    update public.invitations
       set accepted_at = now(), accepted_by = p_user_id
     where id = v_invite_id;
  end if;
end $$;

revoke all on function public.admit_confirmed_user(uuid) from public, anon, authenticated, service_role;


create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text := lower(trim(coalesce(new.email, '')));
  v_name   text;
  v_first  text;
  v_last   text;
  v_avatar text;
begin
  if v_email = '' or position('@' in v_email) < 2 then
    return new;
  end if;

  v_name := left(btrim(coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    ''
  )), 120);
  if v_name = '' then
    v_name := left(split_part(v_email, '@', 1), 120);
  end if;

  v_first := nullif(left(split_part(v_name, ' ', 1), 80), '');
  v_last  := nullif(left(btrim(substr(v_name, length(split_part(v_name, ' ', 1)) + 1)), 80), '');

  v_avatar := left(coalesce(
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'picture'
  ), 500);
  if v_avatar is null or v_avatar !~* '^https?://' then
    v_avatar := null;
  end if;

  -- Always pending. Admission is a separate decision and it is not this
  -- trigger's to make any more.
  insert into public.profiles (
    id, email, first_name, last_name, display_name, avatar_url, role, status, coach_slug
  )
  values (
    new.id, v_email, v_first, v_last, v_name, v_avatar, 'athlete', 'pending', null
  )
  on conflict (id) do nothing;

  -- OAuth and admin-invite signups arrive already confirmed and are admitted
  -- here. A password signup arrives unconfirmed and is admitted by
  -- on_auth_user_confirmed below, when the link is clicked.
  if new.email_confirmed_at is not null then
    perform public.admit_confirmed_user(new.id);
  end if;

  return new;
end $$;

revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admit_confirmed_user(new.id);
  perform public.adopt_bookings_for_profile(new.id);
  return new;
end $$;

revoke all on function public.handle_user_confirmed() from public, anon, authenticated, service_role;

-- The `to_regclass`-style guard 011 used for `invitations` is not needed: this
-- trigger and everything it calls are created in this same file.
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (new.email_confirmed_at is not null and old.email_confirmed_at is null)
  execute function public.handle_user_confirmed();


-- Booking adoption, on the same terms. 013 ran this AFTER INSERT ON profiles,
-- which means it ran before the address had been proven — and `my_bookings`
-- returns manage_token, so adopting a stranger's booking hands over the
-- credential that cancels it.
create or replace function public.adopt_bookings_for_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select lower(p.email) into v_email
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.id = p_user_id and u.email_confirmed_at is not null;

  if v_email is null then
    return;
  end if;

  -- Takes the ticket because F11's column guard freezes `client_id` for any
  -- session that is neither service_role nor an admin, and adoption is exactly
  -- the legitimate exception to that.
  perform private.privileged_write_begin();
  update public.bookings
     set client_id = p_user_id
   where client_id is null and lower(email) = v_email;
  perform private.privileged_write_end();
end $$;

revoke all on function public.adopt_bookings_for_profile(uuid) from public, anon, authenticated, service_role;

create or replace function public.profiles_adopt_bookings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.adopt_bookings_for_profile(new.id);
  return new;
end $$;

revoke all on function public.profiles_adopt_bookings() from public, anon, authenticated, service_role;


-- ============================================================
-- F9. `revoke ... from public` misses the table grants too
-- ============================================================
--
-- The same Supabase default that granted EXECUTE to anon by name granted ALL on
-- every table in `public` to anon and authenticated by name. Where a table has
-- no matching policy the grant is inert — RLS refuses the row and the caller
-- gets an empty result — so most of these were harmless in isolation. They are
-- not harmless as a standing condition: they mean the next `using (true)`
-- written in a hurry is immediately a full read of whatever it is on, with no
-- second gate to catch it.
--
-- TRUNCATE is the one that is not merely latent. It is not filtered by RLS at
-- all, it is granted to anon on eight tables, and one statement empties
-- `bookings`, `leads` or `profiles`. PostgREST has no way to issue it, which is
-- the only reason this is not the top of the file — but nothing about the grant
-- itself says so.

do $$
declare
  v_tbl text;
begin
  for v_tbl in
    select format('%I.%I', schemaname, tablename)
      from pg_tables where schemaname = 'public'
  loop
    execute format('revoke truncate, trigger, references on %s from anon, authenticated', v_tbl);
  end loop;
end $$;

-- And for tables created after this file. Deliberately NOT a blanket revoke of
-- select/insert/update/delete: that would make every future migration's table
-- unreachable until someone noticed, which is a different kind of outage. These
-- three are never wanted by a client role.
alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

-- The tables whose grants were never stated, now stated. Each keeps exactly the
-- access its policies describe and no more.
revoke all on public.content_rotation   from anon, authenticated;
grant  select, insert, update, delete on public.content_rotation to authenticated;

revoke all on public.pending_content    from anon, authenticated;
grant  select (id, type, coach_slug, coach_name, status, submitted_at, title,
               subtitle, tags, summary, content, meet_name, meet_date,
               meet_location, federation, meet_type, meet_note)
  on public.pending_content to anon;
grant  select, insert, update, delete on public.pending_content to authenticated;

revoke all on public.coach_testimonials from anon;
grant  select (id, coach_slug, coach_name, quote, athlete, result, photo,
               show_on_coach, main_status, created_at)
  on public.coach_testimonials to anon;

-- coach_calendar_busy: 007 gave anon three columns and `authenticated` the
-- whole row, which includes `booking_id`. Nothing in src/ reads this table —
-- the busy surface is consumed through booking-availability — and a booking id
-- paired with an instant is an enumeration handle on a table a client is not
-- supposed to be able to name. Same three columns for both.
revoke all on public.coach_calendar_busy from anon, authenticated;
grant  select (coach_slug, starts_at, ends_at) on public.coach_calendar_busy to anon, authenticated;

-- `content_rotation`'s read is `using (true)` for authenticated, which since 011
-- is every athlete. The editorial schedule is a staff fact.
drop policy if exists "rotation_read_all"  on public.content_rotation;
drop policy if exists "rotation_staff_read" on public.content_rotation;
create policy "rotation_staff_read"
  on public.content_rotation for select to authenticated
  using (public.current_coach_slug() is not null or public.is_axis_admin());


-- ============================================================
-- F10. Definer functions without a pinned search_path
-- ============================================================
--
-- 007 states the rule — "`set search_path = ''` (so a caller cannot shadow a
-- table name with a temp table)" — and six functions predate or missed it.
-- `guard_testimonial_main_status` is the one that matters: it is SECURITY
-- DEFINER, it is the only thing stopping a coach approving their own homepage
-- testimonial, and it runs with `search_path = public`.
--
-- The rest are SECURITY INVOKER trigger bodies, where an unpinned path is a
-- smaller problem than it looks — pg_temp is never searched for functions or
-- operators — but "smaller" is not a reason to leave one of them unpinned while
-- the file next to it explains why they should not be.

create or replace function public.guard_testimonial_main_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.is_content_admin() then
    return new;
  end if;

  if new.main_status in ('approved', 'rejected')
     and coalesce(old.main_status, 'none') is distinct from new.main_status then
    raise exception 'Only the head coach can approve or reject a main-page testimonial';
  end if;

  if tg_op = 'UPDATE'
     and old.main_status = 'approved'
     and new.main_status <> 'none'
     and (new.quote, new.athlete, new.result, coalesce(new.photo, ''))
         is distinct from (old.quote, old.athlete, old.result, coalesce(old.photo, '')) then
    new.main_status := 'pending';
    new.reviewed_at := null;
  end if;

  return new;
end $$;

revoke all on function public.guard_testimonial_main_status() from public, anon, authenticated, service_role;

drop trigger if exists guard_testimonial_main_status on public.coach_testimonials;
create trigger guard_testimonial_main_status
  before insert or update on public.coach_testimonials
  for each row execute function public.guard_testimonial_main_status();

-- The bodies of these five reference nothing but pg_catalog and fully-qualified
-- `public` objects, so pinning changes no behaviour.
alter function public.bookings_stamp_status()        set search_path = '';
alter function public.profiles_touch()               set search_path = '';
alter function public.invitations_before_update()    set search_path = '';
alter function public.mint_invitation_token()        set search_path = '';
alter function public.booking_enqueue(public.bookings, public.booking_notification_kind, timestamptz)
  set search_path = '';
alter function public.booking_enqueue_coach(public.bookings, public.booking_notification_kind, timestamptz, text)
  set search_path = '';

-- Including the generated-column expression. `+` and make_interval both resolve
-- out of pg_catalog, which is searched implicitly whatever search_path says, so
-- pinning it changes nothing — verified by inserting across a DST boundary and
-- getting the same answer 007 documents (01:30 PST + 120 min = 04:30 PDT).
alter function public.booking_ends_at(timestamptz, int) set search_path = '';


-- ============================================================
-- F11. What a coach may change on their own bookings
-- ============================================================
--
-- `coach_update_own_bookings` (005) is right about the row — a coach reaches
-- only their own calendar, and the WITH CHECK stops them re-assigning one to
-- somebody else's slug. It says nothing about the COLUMNS, because a policy
-- cannot, and two of them are not theirs to move:
--
--   manage_token  the client's bearer credential. Rotating it silently breaks
--                 the cancel link in a confirmation email already sent.
--   client_id     which account the booking belongs to. Re-pointing it hands
--                 the row, and through my_bookings the manage_token, to a
--                 chosen account.
--
-- Neither is reachable through the portal; both are one PATCH away from it.
-- Same clamp-in-a-trigger shape as profiles_guard_privileges, for the same
-- reason: WITH CHECK cannot say "unchanged from the old row".

alter table public.bookings drop constraint if exists bookings_reschedule_count_sane;
alter table public.bookings add  constraint bookings_reschedule_count_sane
  check (reschedule_count >= 0 and reschedule_count <= 100);

create or replace function public.bookings_guard_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The ticket (F7) is how booking adoption writes client_id from a session
  -- that may well be a signed-in non-admin. It cannot be forged.
  if private.privileged_write_active() then
    return new;
  end if;

  -- No end-user session: service_role, a migration, or the SQL editor. The edge
  -- functions are the legitimate writers of both columns.
  if auth.uid() is null or public.is_axis_admin() then
    return new;
  end if;

  new.manage_token := old.manage_token;
  new.client_id    := old.client_id;
  return new;
end $$;

revoke all on function public.bookings_guard_columns() from public, anon, authenticated, service_role;

drop trigger if exists bookings_guard_columns_trg on public.bookings;
create trigger bookings_guard_columns_trg
  before update on public.bookings
  for each row execute function public.bookings_guard_columns();


-- ============================================================
-- F12. Smaller column leaks
-- ============================================================
--
-- `pending_content.rejection_note` is the head coach's private feedback to a
-- coach, and 006 revoked exactly the equivalent column on coach_testimonials
-- for exactly this reason. 004 did not: `public_read_approved` is `using
-- (status = 'approved')` for anon, and an approved row can carry a note left
-- over from an earlier rejection. Handled by the column grant in F9 above,
-- which omits it — restated here so the reason is next to the finding.
--
-- `booking_events` (010) is granted `select` to every authenticated user with a
-- policy that also allows every coach. That is intended and stays. The insert
-- grant is column-scoped already.

-- ============================================================
-- ALREADY SAFE — recorded so a later reader does not re-litigate them
-- ============================================================
--
-- • `invitation_preview` (012) is anon-callable by design and is sound. The
--   token is the only way in, the length check `between 16 and 400` narrows
--   nothing an attacker did not already control, and the comparison is against
--   sha256 of the argument on a UNIQUE index — a wrong guess returns zero rows
--   and no error. 013 mints 64 hex characters of gen_random_uuid(); guessing is
--   not the attack.
--
-- • No dynamic SQL in 001–013 concatenates a caller-supplied value. 011's two
--   `execute` statements pass `$1`/`$2` through USING; 013's `execute` builds a
--   view from a constant declared `constant text` in the same block; 008's
--   `format()` produces an error message, not a statement.
--
-- • `bookings_no_overlap` (008) holds against the cancel-then-reinstate race:
--   reinstating a cancelled booking onto a slot another booking has since taken
--   raises 23P01 rather than double-booking. Verified.
--
-- • A coach cannot see, cancel or steal another coach's bookings by any path in
--   the schema. Verified: zero rows visible, zero rows updated.
--
-- • `request_rate_limits` and `booking_notifications` carry no policies and no
--   grants; a client role gets "permission denied for table" rather than an
--   empty set. Correct, and the reason `rate_limit_hit` only needed its EXECUTE
--   grant repaired (F1) rather than a redesign.
--
-- • `profiles_guard_privileges` clamps role/status/coach_slug for a non-admin
--   session. It always did — the bypass, not the clamp, was the problem (F7).


-- ============================================================
-- VERIFY — every line below must hold after this file runs
-- ============================================================
--
-- 1. No SECURITY DEFINER function in `public` is anon-callable except the two
--    that are meant to be. Must return exactly invitation_preview and
--    coach_slug_exists:
--
--      select p.proname
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.prosecdef
--         and has_function_privilege('anon', p.oid, 'EXECUTE')
--       order by 1;
--
-- 2. No definer function in `public` or `private` without a pinned path.
--    Must return 0 rows:
--
--      select p.proname
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname in ('public','private') and p.prosecdef
--         and coalesce(array_to_string(p.proconfig,''), '') not like '%search_path%';
--
-- 3. The four fail-open policies are gone. Must return 0 rows:
--
--      select polname from pg_policy
--       where polname in ('master admin access to leads',
--                         'admin full access to coach_routing',
--                         'admin full access to admin_config',
--                         'auth_all_schedules', 'auth_all_blocks',
--                         'auth_all_pageviews', 'client reads own bookings');
--
-- 4. The GUC no longer opens anything:
--
--      begin;
--        set local role authenticated;
--        set local "request.jwt.claims" = '{"sub":"<a pending athlete>","role":"authenticated"}';
--        select set_config('axis.privileged_write','on',true);
--        update public.profiles set role='admin', status='active' where id = auth.uid();
--        select role, status from public.profiles where id = auth.uid();  -- athlete / pending
--      rollback;
--
-- 5. Nobody holds TRUNCATE:
--
--      select table_name from information_schema.role_table_grants
--       where table_schema='public' and privilege_type='TRUNCATE'
--         and grantee in ('anon','authenticated');
-- ============================================================


-- ── F7c. The permission guard onto the same ticket ──────────────────────────
--
-- 016 introduced its own bypass GUC, `axis.permission_reset`, for exactly one
-- job: letting clear_permission_overrides_on_role_change() delete a person's
-- now-stale overrides when their role changes, past the guard that otherwise
-- forbids a non-admin deleting an override. That GUC is the same shape F7 just
-- removed from 011 — a global mutable string with a published value — and
-- leaving it is leaving one unlocked door in a building whose other doors we
-- just re-keyed. It is not reachable from the anon key today (set_config is not
-- RPC-exposed and PostgREST is one transaction per request), which is precisely
-- what was true of `axis.privileged_write` before F7 hardened it anyway.
--
-- So both functions move onto the ticket. This also fixes a correctness bug the
-- GUC masked: a self-claim (claim_pending_invite) that changes a role already
-- holds a ticket, and the cleanup trigger firing inside it takes a second one —
-- the re-entrant depth count added above is what makes that nesting safe, and
-- the GUC never was (its 'off' write would have switched the bypass off for the
-- rest of the OUTER flow).
--
-- The bodies below are 016's verbatim, with only the bypass swapped. Any change
-- to the permission logic itself belongs in 016; this changes the door, not the
-- rules behind it.

create or replace function public.staff_permissions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid;
  v_target public.profiles%rowtype;
begin
  if tg_op = 'DELETE' then
    -- The unforgeable ticket (F7), not 016's `axis.permission_reset` GUC. Set
    -- only by clear_permission_overrides_on_role_change below, around one
    -- DELETE, and no client role can call privileged_write_begin() to fake it.
    if private.privileged_write_active() then
      return old;
    end if;

    -- No JWT means a migration, psql, or the service role, all already
    -- privileged — the same reasoning 011 gives for the profiles guard.
    if auth.uid() is null or public.is_axis_admin() then
      return old;
    end if;

    if old.profile_id = auth.uid() and old.granted = false then
      raise exception
        'You cannot lift a restriction on your own account. An admin has to.'
        using errcode = '22023';
    end if;

    if not public.can_grant_permission(auth.uid(), old.permission) then
      raise exception 'You cannot change % for anyone', old.permission
        using errcode = '22023';
    end if;

    return old;
  end if;

  if new.granted_by is null then
    raise exception 'A permission override has to record who made it'
      using errcode = '22023';
  end if;

  v_actor        := new.granted_by;
  new.granted_at := now();

  if auth.uid() is not null and v_actor is distinct from auth.uid() then
    raise exception 'A permission override is recorded against whoever made it'
      using errcode = '22023';
  end if;

  select * into v_target from public.profiles where id = new.profile_id;

  if v_target.id is null then
    raise exception 'There is no such profile to give a permission to'
      using errcode = '22023';
  end if;

  if v_target.role = 'athlete' then
    raise exception 'Permissions are for staff. Make them a coach first.'
      using errcode = '22023';
  end if;

  if v_target.role = 'admin' then
    raise exception
      'An admin passes every check in the database already, so this would hide '
      'a button without stopping anything. Change their role instead.'
      using errcode = '22023';
  end if;

  if new.profile_id = v_actor and new.granted then
    raise exception 'You cannot grant yourself a permission'
      using errcode = '22023';
  end if;

  if not public.can_grant_permission(v_actor, new.permission) then
    raise exception 'You cannot grant or revoke %', new.permission
      using errcode = '22023';
  end if;

  return new;
end $$;

revoke all on function public.staff_permissions_guard() from public, anon, authenticated;

create or replace function public.clear_permission_overrides_on_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    perform private.privileged_write_begin();
    delete from public.staff_permissions where profile_id = new.id;
    perform private.privileged_write_end();
  end if;
  return null;
end $$;

revoke all on function public.clear_permission_overrides_on_role_change() from public, anon, authenticated;
