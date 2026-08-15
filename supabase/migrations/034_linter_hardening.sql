-- ============================================================
-- Axis Training Systems, 034: what the linter can and cannot be told
-- ============================================================
--
-- Supabase's database linter was run against the live database with the whole
-- chain applied, and it came back with six categories. This file is the answer
-- to all six, and the answer is not the same answer six times. Two of the
-- categories are real defects and get fixed. Two are shapes the advisor cannot
-- distinguish from a defect and never will be able to, so they get restated in
-- a form it can read. Two are deliberate and get written down here, by name,
-- with the reason, so the next person who runs the linter and sees the same
-- warnings knows they were read rather than skipped.
--
-- The distinction matters more than the individual fixes. An advisory list that
-- nobody has dispositioned is worse than no list at all: every run produces the
-- same noise, the noise gets skimmed, and the one new line in it gets skimmed
-- with the rest. So every finding below lands in exactly one of two states,
-- RESOLVED or ACKNOWLEDGED, and the acknowledgements carry their argument.
--
--
-- 1. SECURITY DEFINER VIEW public.my_bookings. RESOLVED, by deleting the view
-- and moving its body into a function. The definer behaviour it was flagged for
-- is correct and section 1 explains at length why, but the advisor flags definer
-- VIEWS categorically and cannot be told about an exception. A definer FUNCTION
-- is the same guarantee in a shape the advisor already understands, because a
-- function is where PostgREST expects authorisation logic to live. This is the
-- one finding with a client-side half: `AccountPage.tsx` moves from
-- `.from('my_bookings')` to `.rpc('my_bookings')` in the same change.
--
-- 2. function_search_path_mutable on three functions. RESOLVED. Section 2. Three
-- files written after 017 forgot the pin that every other function in the schema
-- carries. All three bodies were already fully qualified, so the pin is a lock
-- on a door that happened to be shut rather than a behaviour change.
--
-- 3. Trigger functions executable by client roles. RESOLVED. Section 3. 017's
-- F1b already made this argument, in its own words: "a trigger function granted
-- to a client role is pure attack surface", and it swept them. The sweep was a
-- one-time event over the functions that existed in August of that chain, and it
-- only ever looked at SECURITY DEFINER functions. Everything written since, and
-- every INVOKER trigger function ever written, fell outside it. Section 3 names
-- all forty-one and revokes each explicitly.
--
-- 4. SECURITY DEFINER functions executable by `authenticated`. ACKNOWLEDGED, in
-- the main, with three genuine narrowings. This schema's architecture is that
-- writes go through definer RPCs with their guards in the body, so a long list
-- of definer functions callable by signed-in users is the design working, not
-- the design leaking. Section 4 audits the list against four tests, revokes the
-- three that pass all four, and prints the reasoning for everything that stays.
--
-- 5. rls_policy_always_true on booking_events, leads, newsletter_leads and
-- pageviews. ACKNOWLEDGED, no change. Each of the four is a table a stranger is
-- supposed to be able to write to, and a public write path whose INSERT policy
-- is not `true` is a public write path that does not work. What keeps each one
-- honest is a column grant and a constraint rather than a row predicate, because
-- a row predicate has nothing to predicate on when the writer is anonymous:
--
--   booking_events    anon may write four columns and read nothing at all, and
--                     `booking_events_name_known` restricts `name` to the eight
--                     funnel steps the analytics panel charts (010).
--   leads             the application form. Row shape is enforced by NOT NULL on
--                     the six contact columns and a CHECK on `status` (001), and
--                     the submit path is behind the edge rate limiter, which is
--                     also what stops a script from filling the table.
--   newsletter_leads  anon holds INSERT and nothing else, and the unique index
--                     on `email` makes a repeat signup a no-op rather than a
--                     second row (015). Length capping happens in
--                     `newsletterApi.ts` before the insert.
--   pageviews         the anon grant is column level, `(path, referrer,
--                     session_id)` and no more, so a visitor cannot choose their
--                     own id or backdate a visit (017 F5). Reading is staff only.
--
-- The booking path proper, which is the one that costs money to abuse, does not
-- write through any of these: `booking-create` runs behind `rate_limit_hit` at
-- five per IP per hour and one per email per day, and the row it writes is
-- refused by `bookings_no_overlap` if the slot is gone.
--
-- 6. extension_in_public on btree_gist and pg_net. RESOLVED where it can be,
-- reported where it cannot. Section 5, and read its comments before running this
-- on a database whose calendar sync you care about.
--
-- 7. Anon-executable definer functions. ACKNOWLEDGED, no change. Three functions
-- are callable without a session, all three deliberately, all three because the
-- page that calls them exists precisely for people who do not have one yet:
--
--   coach_slug_exists(text)     the apply and booking pages, to check a slug in
--                               the URL is real before rendering around it.
--                               Returns a boolean about a slug that is already
--                               public in the site's own navigation (007).
--   intake_form_is_active(uuid) the public intake form. Answers whether a form
--                               id is open for submissions, which the visitor is
--                               about to find out by submitting anyway (024).
--   invitation_preview(text)    the invite acceptance page, which by definition
--                               runs before the account exists. Token-gated: it
--                               tells you nothing without the token, and the
--                               token was mailed to the address it names (012,
--                               regranted by 017 F1b).
--
-- Each returns strictly less than the page it serves needs to render, and none
-- of them takes an argument that names a person the caller has not already been
-- handed. They stay as they are.
--
--
-- ORDERING HAZARDS, in one place rather than five. This file narrows things
-- earlier files declare, and several of those earlier files declare them with
-- `create or replace`, `drop ... create`, or a grant loop. Replaying an earlier
-- file on its own therefore reverts part of this one:
--
--   017  recreates the `my_bookings` VIEW (section 1) and re-grants
--        `profile_has_permission` and friends in its F1b loop (section 4).
--   019, 022, 024  `create or replace` the three functions of section 2, which
--        discards a SET clause the replacement does not restate.
--   any file that DROPS and recreates a trigger function resets its ACL to the
--        schema default and undoes that function's line in section 3. A plain
--        `create or replace` does NOT: PostgreSQL preserves the existing ACL
--        across a replace, which is why section 3 holds under normal replays.
--
-- Applying the directory in filename order always leaves this file last, which
-- is the normal case and is fine. Running a single earlier file by hand is not:
-- re-apply this one after it. Section 6 has the queries that say whether the
-- database in front of you is in the state this file describes.
--
-- Requires the full chain through 032_coach_profiles.sql.
--
-- Re-runnable.
-- ============================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────
--
-- The same courtesy 030 and 033 extend. Section 3 names forty-one functions
-- without guards, so a database missing any of the files that create them fails
-- on "function public.<something>() does not exist" thirty lines in, with no
-- indication of what to run instead. Two probes are enough: `bookings` is the
-- oldest thing this file touches and `coach_profiles` the newest.

do $do$
begin
  if to_regclass('public.bookings') is null then
    raise exception
      'Run the migration chain from 003_bookings_analytics.sql before 034_linter_hardening.sql.'
      using errcode = '22023';
  end if;
  if to_regclass('public.coach_profiles') is null then
    raise exception
      'Run 032_coach_profiles.sql before 034_linter_hardening.sql.'
      using errcode = '22023';
  end if;
end
$do$;


-- ── 1. `my_bookings` stops being a view ─────────────────────────────────────
--
-- WHAT THE VIEW WAS FOR, because none of it changes and all of it has to survive
-- into the function. 013 section 4 states the problem: "A row in `bookings` is
-- not a client-facing object. It carries `coach_notes`, which is the coach's
-- private assessment of the person reading it, and `manage_token`, which is a
-- bearer credential. RLS is row-level and cannot withhold a column, so 'let a
-- client read their own booking' through a policy alone hands over both."
--
-- 013 answered that with an invoker view plus a "client reads own bookings"
-- policy, and 017 F6 found the hole: `authenticated` still held table SELECT on
-- every column, so `GET /rest/v1/bookings?select=coach_notes,manage_token`
-- returned exactly the two things the view existed to withhold. 017's fix was to
-- take the policy away and let the view run with the owner's rights, so that the
-- base table has no client-facing SELECT policy at all and the projection is the
-- only path to a booking a client can reach.
--
-- WHY DEFINER IS STILL RIGHT, and this is the part the advisor cannot be told.
-- Coaches and athletes are the same PostgreSQL role. Both authenticate through
-- GoTrue, both arrive as `authenticated`, and the difference between them lives
-- in `profiles.role`, which is data. Column-level grants are per ROLE, so there
-- is no grant that shows `coach_notes` to staff and hides it from the athlete
-- sitting in the next row of the same table. The only mechanism that can make
-- that distinction is code that runs with more rights than the caller and hands
-- back less. That is what SECURITY DEFINER is, and swapping it for an invoker
-- object means either giving athletes a policy on `bookings` (which returns the
-- notes) or giving them nothing (which empties their account page).
--
-- WHY A FUNCTION RATHER THAN THE VIEW. Nothing about the security argument, and
-- everything about the shape. The linter flags `security definer` views
-- categorically, because a definer view is a common accident: somebody omits
-- `security_invoker` and silently publishes a table. It has no way to see that
-- this one was deliberate, and no annotation that would tell it. It will report
-- this view on every run forever, and a finding that can never be closed is a
-- finding that trains people to skim the list. A definer FUNCTION is where
-- PostgREST expects authorisation to live, is not flagged, and is the pattern
-- every other privileged read in this schema already uses: `messaging_profiles`,
-- `newsletter_recipients`, `effective_permissions`, the six `report_*` calls.
--
-- WHY THE WHERE CLAUSE LIVES IN THE BODY. Unchanged from 013 and 017, and worth
-- restating because it is the single line that makes the definer safe. `where
-- b.client_id = auth.uid()` is the restriction. There is no policy underneath it
-- doing the same job, and there has not been since 017 F6 removed the one 013
-- added. Do not move it out on the grounds that RLS covers it. RLS does not
-- cover it. The owner is not policy checked, and this predicate is the whole of
-- the row-level security on this path.
--
-- WHAT IS PROJECTED, and what is not. `coach_notes` is excluded because it is
-- the coach's assessment of the reader. `client_id` is excluded because it is
-- the join key that decides ownership and it is already implied: every row this
-- returns has `client_id = auth.uid()`, so returning it tells the caller their
-- own id back. `manage_token` IS included, deliberately, and 013 put it best:
-- "it is this person's own cancel link and they already have it in their email."
-- The fourteen columns are the same fourteen 017 projected, in the same order.
--
-- The policy drop below restates 017 F6 rather than duplicating it for its own
-- sake. If 013 is ever replayed by hand it recreates that policy, and the
-- moment it exists the definer function stops being the only path to a booking
-- row: the athlete gets a policy on the base table and `select coach_notes` from
-- it works again. Re-dropping here costs nothing on a database where 017 already
-- did it, and is the difference between a hole and no hole on one where 013 ran
-- last.

drop policy if exists "client reads own bookings" on public.bookings;

drop view if exists public.my_bookings;

create or replace function public.my_bookings()
returns table (
  id                  uuid,
  coach_slug          text,
  booked_at           timestamptz,
  ends_at             timestamptz,
  duration_minutes    integer,
  status              text,
  service_name        text,
  service_price_cents integer,
  goals               text,
  google_meet_url     text,
  manage_token        uuid,
  cancelled_at        timestamptz,
  cancellation_reason text,
  created_at          timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Every reference is qualified with `b.`, which is not a style preference
  -- here. A `returns table` function puts its output column names in scope, and
  -- `id`, `status`, `goals` and `created_at` are all also columns of `bookings`.
  -- An unqualified reference to any of them is ambiguous and PostgreSQL refuses
  -- it at creation time.
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
  where b.client_id = auth.uid()
$$;

comment on function public.my_bookings() is
  'A client''s own bookings, without coach_notes. Was a SECURITY DEFINER view '
  '(013, 017 F6) until 034; the definer rights are unchanged and deliberate, '
  'because coaches and athletes share the `authenticated` role and no column '
  'grant can separate them. Restricted by its own WHERE clause: the base table '
  'carries no client-facing SELECT policy, so this is the only path to a booking '
  'a client can reach. manage_token IS included: it is this person''s own cancel '
  'link and they already have it in their email. No ORDER BY, deliberately, so '
  'the caller supplies its own.';

-- No sort inside the function. The account page orders by `booked_at` desc and
-- PostgREST appends that as an ORDER BY over the function's result, so a sort
-- here would be discarded work on every call. It would also reintroduce 033's
-- ordinal problem: `booked_at` is an output column name and would be ambiguous.

revoke all     on function public.my_bookings() from public, anon;
grant  execute on function public.my_bookings() to authenticated, service_role;


-- ── 2. Three functions that never pinned their search path ──────────────────
--
-- `function_search_path_mutable` is the advisor noticing that a function will
-- resolve unqualified names against whatever `search_path` the caller happens to
-- have. On a definer function that is a privilege escalation waiting for
-- somebody who can create a schema; on an invoker function it is a correctness
-- bug waiting for a `set search_path` in a pooled session. Neither is
-- theoretical, and the schema pins every other function it has.
--
-- These three are the ones written after 017 that forgot:
--
--   public.site_settings_touch()                     019
--   public.timeclock_minutes(timestamptz, timestamptz)  022
--   public.intake_forms_touch()                      024
--
-- ALL THREE GET `= ''` RATHER THAN A `pg_catalog, public` FALLBACK, because all
-- three bodies were already fully qualified and were read line by line before
-- this was written:
--
--   site_settings_touch  `new.updated_at := now()` and `new.updated_by :=
--                        coalesce(auth.uid(), new.updated_by)`. `auth.uid()` is
--                        schema-qualified; `now` and `coalesce` are pg_catalog,
--                        which is searched implicitly even when the path is
--                        empty. `new` is a trigger record, not a name lookup.
--   timeclock_minutes    `floor(extract(epoch from (p_to - p_from))::numeric /
--                        60)::int`. Every name in that expression, function and
--                        type alike, is pg_catalog.
--   intake_forms_touch   `new.updated_at := now()`. One name, pg_catalog.
--
-- So the empty path is safe and is the stricter of the two options. If a future
-- reader adds an unqualified reference to a `public` object inside any of them,
-- it will fail immediately and loudly rather than resolving to whatever the
-- caller's path found, which is the point.
--
-- ONE COST, on `timeclock_minutes` only. A function carrying a SET clause cannot
-- be inlined by the planner, and this one is called once per row by
-- `timeclock_entries`. It is `immutable` and arithmetic on two timestamps, so
-- the per-call overhead is a function call against a few hundred rows on the
-- timeclock panel's widest query. Correctness over the inline. It is not used in
-- an index or a generated column, where losing inlining would matter more, and
-- that was checked before pinning it.
--
-- ALTER rather than CREATE OR REPLACE, so this file does not carry a second copy
-- of three bodies that live in three other files. `alter function ... set` is
-- idempotent and is a no-op on the second run.

alter function public.site_settings_touch()                       set search_path = '';
alter function public.timeclock_minutes(timestamptz, timestamptz) set search_path = '';
alter function public.intake_forms_touch()                        set search_path = '';


-- ── 3. No trigger function is an RPC ────────────────────────────────────────
--
-- 017 F1b made this argument and it has not improved on:
--
--   "Postgres checks EXECUTE on a trigger function at CREATE TRIGGER time and
--    never again. The trigger fires with no privilege check on the writer.
--    Verified against this schema: a booking INSERT by `authenticated` still
--    stamps its status, mirrors to busy and queues its notifications with
--    EXECUTE revoked from every client role. So a trigger function granted to a
--    client role is pure attack surface."
--
-- Re-verified against PostgreSQL 17 before writing this section, because the
-- whole section rests on it: an INVOKER trigger function with `revoke all ...
-- from public, anon, authenticated` refuses a direct `select public.f()` with
-- 42501 and still fires on an INSERT by that same role, stamping its column.
-- Nothing here can break a trigger. The revokes are strictly tightening.
--
-- WHY 017's SWEEP DID NOT COVER THESE. Two reasons, and both are structural
-- rather than an oversight in 017:
--
--   1. The sweep loop selects `where p.prosecdef`, so it only ever saw SECURITY
--      DEFINER functions. Every INVOKER trigger function in the schema was
--      outside it from the start. `site_settings_touch`, `intake_forms_touch`,
--      `settings_touch_at`, `catalog_touch_updated_at`, `saved_reports_touch`
--      and the three plain stamps in 026 are all invoker.
--   2. A sweep is a one-time event. 019 through 032 wrote twenty-two more
--      trigger functions after it ran, and 017's F1a default-privilege revoke
--      was supposed to keep them closed. The linter's report says it did not:
--      `announcements_touch` and `broadcasts_stamp` are both definer, both
--      created in 028, and both came back flagged as client-executable. The
--      most likely reason is that ALTER DEFAULT PRIVILEGES applies only to
--      objects created by the role that ran it, and the later files did not all
--      reach the database through the same role that applied 017. Whatever the
--      cause, a default is not a guarantee and an explicit revoke is.
--
-- So: all forty-one, named, grouped by the file that created them. No loop over
-- pg_proc, because a loop is a statement whose effect you cannot read, and the
-- point of writing them out is that a reviewer can check the list against
-- `grep -l "returns trigger"` and see nothing missing. All forty-one take no
-- arguments, which is what a trigger function is.
--
-- REVOKE ALL rather than REVOKE EXECUTE, and from `public` as well as the two
-- client roles, because `public` is where the PostgreSQL default lives and
-- revoking from anon and authenticated alone leaves it. `service_role` is not
-- named and keeps whatever it had: it is the key that runs migrations and
-- backfills, and there is no threat model in which taking a privilege from it
-- helps.
--
-- Revoking a privilege a role does not hold is a silent no-op, which is what
-- makes the fourteen that 017 already closed harmless to restate and the whole
-- block re-runnable.

-- 006
revoke all on function public.guard_testimonial_main_status()          from public, anon, authenticated;

-- 007
revoke all on function public.bookings_set_sync_status()               from public, anon, authenticated;
revoke all on function public.bookings_mirror_to_busy()                from public, anon, authenticated;

-- 010
revoke all on function public.bookings_stamp_status()                  from public, anon, authenticated;
revoke all on function public.bookings_enqueue_notifications()         from public, anon, authenticated;

-- 011
revoke all on function public.profiles_touch()                         from public, anon, authenticated;
revoke all on function public.profiles_guard_privileges()              from public, anon, authenticated;
revoke all on function public.handle_new_user()                        from public, anon, authenticated;
revoke all on function public.handle_user_email_change()               from public, anon, authenticated;

-- 012
revoke all on function public.invitations_before_insert()              from public, anon, authenticated;
revoke all on function public.invitations_before_update()              from public, anon, authenticated;

-- 013
revoke all on function public.leads_invite_on_accept()                 from public, anon, authenticated;
revoke all on function public.bookings_link_client()                   from public, anon, authenticated;
revoke all on function public.profiles_adopt_bookings()                from public, anon, authenticated;

-- 016
revoke all on function public.staff_permissions_guard()                from public, anon, authenticated;
revoke all on function public.permission_catalogue_guard()             from public, anon, authenticated;
revoke all on function public.clear_permission_overrides_on_role_change() from public, anon, authenticated;

-- 017
revoke all on function public.handle_user_confirmed()                  from public, anon, authenticated;
revoke all on function public.bookings_guard_columns()                 from public, anon, authenticated;

-- 019
revoke all on function public.site_settings_touch()                    from public, anon, authenticated;

-- 022
revoke all on function public.time_entries_guard_kind()                from public, anon, authenticated;

-- 023
revoke all on function public.athlete_coaches_validate()               from public, anon, authenticated;
revoke all on function public.message_after_insert()                   from public, anon, authenticated;
revoke all on function public.message_rate_limit_trigger()             from public, anon, authenticated;

-- 024
revoke all on function public.intake_forms_touch()                     from public, anon, authenticated;
revoke all on function public.form_submissions_stamp()                 from public, anon, authenticated;
revoke all on function public.intake_form_guard_answered()             from public, anon, authenticated;
revoke all on function public.intake_form_block_answered_delete()      from public, anon, authenticated;

-- 025
revoke all on function public.catalog_touch_updated_at()               from public, anon, authenticated;

-- 026
revoke all on function public.orders_touch_updated_at()                from public, anon, authenticated;
revoke all on function public.orders_assign_number()                   from public, anon, authenticated;
revoke all on function public.order_item_line_total()                  from public, anon, authenticated;
revoke all on function public.order_recalc_totals()                    from public, anon, authenticated;
revoke all on function public.orders_apply_paid_stock()                from public, anon, authenticated;

-- 027
revoke all on function public.saved_reports_touch()                    from public, anon, authenticated;

-- 028
revoke all on function public.announcements_touch()                    from public, anon, authenticated;
revoke all on function public.broadcasts_stamp()                       from public, anon, authenticated;

-- 029
revoke all on function public.settings_touch_at()                      from public, anon, authenticated;
revoke all on function public.settings_touch_at_by()                   from public, anon, authenticated;

-- 032
revoke all on function public.coach_profiles_guard()                   from public, anon, authenticated;
revoke all on function public.coach_profiles_touch()                   from public, anon, authenticated;


-- ── 4. The definer RPC list, audited ────────────────────────────────────────
--
-- The advisor's longest section is every SECURITY DEFINER function in `public`
-- that `authenticated` may execute. On most schemas that is a finding. On this
-- one it is close to a description: writes go through definer RPCs whose guard
-- is the first statement of the body, precisely so that the guard is one thing
-- in one place rather than a policy expression repeated across four commands.
-- `send_newsletter`, `set_staff_permission`, `cast_vote`, `clock_in`,
-- `create_channel` and the rest are all supposed to be callable by a signed-in
-- person, and all of them refuse the person who should not have called.
--
-- THE RULE THAT DECIDES WHAT MAY BE REVOKED, and it is the one that would have
-- broken the application if it had been got wrong. A function named inside a
-- `create policy` expression is evaluated as the QUERYING user, not as the
-- policy's author and not as the table's owner. Taking EXECUTE from
-- `authenticated` on such a function does not narrow anything: it makes every
-- SELECT, INSERT, UPDATE and DELETE against that table fail with "permission
-- denied for function", for everybody, including admins. Every helper below is
-- named in at least one policy in this chain and every one of them KEEPS its
-- grant:
--
--   is_axis_admin()              88 policies
--   has_permission(text)         61 policies
--   current_coach_slug()         36 policies, and called by the edge functions
--   is_content_admin()           13 policies
--   is_conversation_member(uuid)  5 policies (023)
--   is_axis_staff()               3 policies
--   current_coach_name()          3 policies
--   reports_can_view()            2 policies (027, saved_reports)
--   is_axis_active()              2 policies
--   can_read_newsletter(uuid)     2 policies (030)
--   can_grant_permission(uuid,text) 2 policies (016, staff_permissions)
--   intake_form_is_active(uuid)   1 policy  (024), and anon by design
--   intake_form_coach_slug(uuid)  1 policy  (024)
--   conversation_is_broadcast(uuid) 1 policy (033, messages INSERT)
--   can_read_poll(uuid)           1 policy  (030, poll_options)
--
-- AND EVERYTHING ELSE THAT STAYS, because "audited and intentional" is only
-- worth saying if the list is complete. These are definer, granted to
-- `authenticated`, and called directly by the browser through `.rpc(...)`, which
-- is the whole reason they exist:
--
--   adjust_stock, cast_vote, claim_invitation_token, claim_pending_invite,
--   clock_in, clock_out, create_channel, effective_permissions,
--   get_or_create_dm, has_permission, invitation_preview, leave_conversation,
--   list_message_contacts, mark_conversation_read, messaging_profiles,
--   newsletter_recipients, poll_results_multi, rename_channel,
--   report_booking_funnel, report_bookings_over_time, report_coach_hours,
--   report_form_submissions_over_time, report_leads_by_status,
--   report_revenue_over_time, send_newsletter, set_staff_permission,
--   update_channel_members, upsert_newsletter_poll
--
-- Already closed by an earlier file and confirmed still closed, so the advisor
-- does not list them and neither does this section need to act:
-- `enforce_message_rate_limit` (023, service_role only), `admit_confirmed_user`
-- and `adopt_bookings_for_profile` (017, nobody), `coach_notify_email` (017 F1b,
-- nobody), the six `calendar_connection_*`, both `oauth_state_*`,
-- `claim_booking_notifications` and `rate_limit_hit` (017 F1b, service_role only
-- because every one of them can see or move a credential).
--
--
-- THE THREE THAT MOVE. Each had to pass all four tests, and each was checked
-- against the whole tree rather than against memory:
--
--   (a) not named in any `create policy` expression in any migration;
--   (b) not called via `.rpc('<name>'` anywhere in src/;
--   (c) not called via rpc anywhere in supabase/functions/, where the caller
--       client runs as `authenticated` with the user's own JWT;
--   (d) reached only from inside other SECURITY DEFINER bodies, which execute as
--       the function owner and are not affected by a client role's grant.
--
--   can_message(uuid)  023 section 8. The contact matrix: may I start a thread
--       with this person. Called at 023:742 by `get_or_create_dm`, at 023:843 by
--       `create_channel`, at 023:935 by `update_channel_members` and at 023:1116
--       inside `list_message_contacts`. All four are definer. The browser never
--       calls it: `messagingApi.ts` and `NewMessageModal.tsx` both mention it in
--       comments describing where the refusal comes from, and neither invokes
--       it. Revoking is worth doing rather than merely tidy, because the
--       function answers a question about a named third party. A signed-in
--       athlete could previously walk a list of profile ids and learn which
--       coaches they are assigned to, one boolean at a time, without being able
--       to read `athlete_coaches` at all.
--
--   profile_has_permission(uuid, text)  016 section 4. Called at 016:260 by
--       `has_permission`, at 016:309 and 016:310 by `can_grant_permission`, at
--       016:344 by `effective_permissions` and at 016:609 by
--       `set_staff_permission`. All five are definer. 017 F1b re-granted it in
--       the "signed-in users" group with the note that "the uuid-argument ones
--       are gated internally (an admin reads another person's effective set)".
--       That is true of `effective_permissions`, whose WHERE clause is a read
--       gate and whose own comment says why: "A person may always see their own
--       set; everyone else needs manage_permissions. A definer function with no
--       gate would be a way around the RLS in section 8." It is not true of this
--       one, which is that function with no gate. It answers "does that person
--       hold that key" about any profile id, for any caller, and it is the
--       primitive `effective_permissions` is built out of.
--       Nothing in the app loses anything. `has_permission(text)` is the call
--       the portal actually makes and it passes `auth.uid()`, so it is
--       self-scoped by construction; `effective_permissions` is how one person
--       reads another's set and it keeps both its grant and its gate. This is
--       the narrowing 017 intended and did not quite make.
--
--   reports_scope_coach()  027 section 1. Returns the coach slug the caller's
--       reports should be clamped to, or null for an unrestricted reader. Called
--       at 027:116, 166, 221, 279, 335 and 392, every one of them inside one of
--       the six definer `report_*` functions. Not in a policy: the policies on
--       `saved_reports` use `reports_can_view()`, which is the sibling that
--       stays. Nothing outside 027 mentions it.
--
-- `service_role` is not named in the revokes, so it keeps EXECUTE on all three.
-- That is deliberate and matches 023's treatment of `enforce_message_rate_limit`:
-- these are internals, and the service key is not a client.

revoke all on function public.can_message(uuid)                  from public, anon, authenticated;
revoke all on function public.profile_has_permission(uuid, text) from public, anon, authenticated;
revoke all on function public.reports_scope_coach()              from public, anon, authenticated;


-- ── 5. Extensions out of `public` ───────────────────────────────────────────
--
-- `extension_in_public` is the advisor pointing out that an extension installed
-- into `public` puts its objects in the same namespace the application writes
-- to. The concrete risks are a name collision with a future table or function,
-- and a `public`-schema dump or grant sweep that now includes objects the
-- extension owns. Neither has bitten this schema. Both are free to prevent.
--
-- WHAT USES WHAT, checked before moving anything:
--
--   btree_gist  installed by 008 for exactly one object, and there is only one
--               in the whole chain: the `bookings_no_overlap` EXCLUDE constraint
--               on `public.bookings`, which needs `coach_slug WITH =` to live
--               inside a gist index. That is a btree equality operator being
--               asked to work under gist, which is the entire purpose of the
--               extension. Nothing else in 001 through 033 uses gist.
--   pg_net      installed by 007 section 12 for `net.http_post`, called once, in
--               `private.invoke_edge_function`, which is how the pg_cron jobs
--               reach the calendar sync and outbox drain edge functions.
--
-- THE EXISTING CONSTRAINT KEEPS WORKING. An index binds its operator class by
-- OID at creation, not by name at query time, so moving the extension does not
-- touch `bookings_no_overlap`. Verified on PostgreSQL 17 rather than assumed:
-- after `alter extension btree_gist set schema extensions`, an overlapping
-- insert still fails with 23P01.
--
-- WHAT A FUTURE MIGRATION MUST DO. Default operator class resolution goes
-- through the catalogue by type and access method, not through `search_path`, so
-- a future `exclude using gist (some_text_column WITH =, ...)` written the same
-- way 008 wrote it still works with `extensions` off the path. Also verified
-- rather than assumed. What does NOT work is naming an operator class
-- explicitly. After this file,
--
--     exclude using gist (coach_slug gist_text_ops WITH =, ...)
--
-- fails with 'operator class "gist_text_ops" does not exist for access method
-- "gist"' unless the statement runs with `extensions` on the search path. Same
-- for calling any btree_gist support function by bare name. Schema-qualify, or
-- `set local search_path = public, extensions` for the statement.
--
-- WHY EACH BRANCH IS GUARDED AND SWALLOWS ITS ERROR. `alter extension ... set
-- schema` fails on an extension that is not installed, and it fails with
-- feature_not_supported on one whose control file says `relocatable = false`,
-- which older pg_net builds do. This file must not fail on either: it would take
-- the whole migration down over a cosmetic finding. Each block reports what it
-- did or could not do and moves on. Re-running is safe because ALTER EXTENSION
-- SET SCHEMA on an extension already in the target schema succeeds as a no-op.

create schema if not exists extensions;

do $do$
begin
  alter extension btree_gist set schema extensions;
  raise notice '034: btree_gist is in schema extensions.';
exception
  when others then
    raise notice '034: btree_gist NOT relocated (% / %). The bookings_no_overlap constraint is unaffected either way; extension_in_public stays open for it.',
      sqlstate, sqlerrm;
end
$do$;

-- pg_net gets one extra condition on top of the same guard, and it is the reason
-- to read this block rather than skim it. `private.invoke_edge_function` calls
-- `net.http_post` by a fully qualified name and runs with `set search_path = ''`
-- (007), so it resolves that name against schema `net` and nothing else. If the
-- relocation moved the extension's functions out of `net`, the cron drain would
-- stop reaching the edge functions and would do it silently, because 007's own
-- comment records that `net.http_post` never raises.
--
-- So the move is attempted and then checked, inside one subtransaction. If
-- `net.http_post` no longer resolves afterwards, the raise rolls the ALTER back
-- and the handler turns it into a notice. The finding stays open in that case,
-- which is the correct trade: a cosmetic advisory line is cheaper than a
-- calendar sync that stopped and did not say so.

do $do$
begin
  alter extension pg_net set schema extensions;

  if not exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'net' and p.proname = 'http_post'
  ) then
    raise exception 'relocating pg_net would move net.http_post out of schema net'
      using errcode = '0A000';
  end if;

  raise notice '034: pg_net is in schema extensions and net.http_post still resolves.';
exception
  when others then
    raise notice '034: pg_net LEFT WHERE IT IS (% / %). This is expected on builds where pg_net is not relocatable. private.invoke_edge_function is unaffected; extension_in_public stays open for pg_net.',
      sqlstate, sqlerrm;
end
$do$;


-- ── 6. Verify ───────────────────────────────────────────────────────────────
--
-- Section 1 first. The view is gone, the function is there, it is definer, it is
-- owned by the role that owns `bookings`, and its search path is pinned:
--
--   select to_regclass('public.my_bookings');                      -- null
--
--   select p.proname, p.prosecdef, p.provolatile, p.proconfig,
--          pg_get_userbyid(p.proowner) as owner
--     from pg_catalog.pg_proc p
--     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'my_bookings';
--   -- prosecdef t, provolatile s, proconfig {search_path=""}
--   -- owner must equal the owner of public.bookings:
--   select pg_get_userbyid(relowner) from pg_class
--    where oid = 'public.bookings'::regclass;
--
-- Fourteen columns, no coach_notes, no client_id:
--
--   select p.proname, pg_get_function_result(p.oid)
--     from pg_catalog.pg_proc p where p.proname = 'my_bookings';
--
--   select column_name from information_schema.columns
--    where table_name = 'bookings'
--      and column_name in ('coach_notes','client_id');            -- 2 rows, on the TABLE
--
-- And the base table has no client-facing SELECT policy, which is what makes the
-- function the only path:
--
--   select policyname, roles, cmd from pg_policies
--    where tablename = 'bookings' and cmd in ('SELECT','ALL') order by policyname;
--   -- nothing here may be a bare `client_id = auth.uid()` for authenticated
--
-- Now behaviour, as an athlete with at least one booking of their own and at
-- least one belonging to somebody else:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<athlete uuid>';
--
--     select count(*) from public.my_bookings();          -- only their own
--     select count(*) from public.my_bookings() m
--       join public.bookings b on b.id = m.id
--      where b.client_id is distinct from '<athlete uuid>'::uuid;   -- 0
--
--     -- the column is not merely blank, it is absent
--     select coach_notes from public.my_bookings();
--     -- ERROR: column "coach_notes" does not exist
--     select client_id from public.my_bookings();
--     -- ERROR: column "client_id" does not exist
--
--     -- and the base table is still shut, which is the point of 017 F6
--     select coach_notes from public.bookings;            -- 0 rows or permission denied
--   rollback;
--
--   -- anon cannot call it at all
--   begin;
--     set local role anon;
--     select * from public.my_bookings();                 -- ERROR: permission denied
--   rollback;
--
-- Section 2. Three rows, each with a search_path in proconfig:
--
--   select p.proname, p.proconfig
--     from pg_catalog.pg_proc p
--     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('site_settings_touch','timeclock_minutes','intake_forms_touch');
--   -- three rows, every proconfig {search_path=""}
--
--   -- nothing about the pin changed what they compute
--   select public.timeclock_minutes(now() - interval '90 minutes', now());   -- 90
--
--   -- and the trigger that uses one of them still stamps
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<admin uuid>';
--     update public.site_settings set value = value where key = 'demo_enabled';
--     select updated_at > now() - interval '1 minute' from public.site_settings
--      where key = 'demo_enabled';                                            -- t
--   rollback;
--
-- Section 3. Forty-one functions, none of them holding anything for a client
-- role. This should return zero rows:
--
--   select r.routine_name, r.grantee, r.privilege_type
--     from information_schema.routine_privileges r
--     join pg_catalog.pg_proc p on p.oid = ('public.' || r.routine_name)::regproc
--    where r.specific_schema = 'public'
--      and r.grantee in ('PUBLIC','anon','authenticated')
--      and p.prorettype = 'pg_catalog.trigger'::regtype;            -- 0 rows
--
-- The same question without the regproc cast, which is safer on a schema with
-- overloads and is the spot check to run if the above complains:
--
--   select n.nspname, p.proname, p.proacl
--     from pg_catalog.pg_proc p
--     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.prorettype = 'pg_catalog.trigger'::regtype
--      and (p.proacl::text like '%anon=%' or p.proacl::text like '%authenticated=%'
--           or p.proacl is null);                                   -- 0 rows
--
--   -- named spot checks, the four the advisor reported
--   select proname, proacl from pg_catalog.pg_proc
--    where proname in ('announcements_touch','broadcasts_stamp',
--                      'site_settings_touch','intake_forms_touch');
--   -- no anon= and no authenticated= in any proacl
--
-- The triggers still fire, which is the assertion that matters more than the
-- ACLs. Any write that stamps a column will do; this one goes through
-- `intake_forms_touch`, whose EXECUTE was just taken away from the role doing
-- the writing:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a coach uuid>';
--     update public.intake_forms set title = title where id = '<a form they own>';
--     select updated_at > now() - interval '1 minute' from public.intake_forms
--      where id = '<that form>';                                    -- t
--     -- and calling it directly is refused
--     select public.intake_forms_touch();
--     -- ERROR: permission denied for function intake_forms_touch
--   rollback;
--
-- Section 4. The three are closed to clients and open to service_role:
--
--   select proname, proacl from pg_catalog.pg_proc
--    where proname in ('can_message','profile_has_permission','reports_scope_coach');
--   -- each proacl has service_role=X and neither anon= nor authenticated=
--
-- Nothing that a policy depends on moved, which is the failure this section was
-- most able to cause. Every one of these must still be callable, and the tables
-- they gate must still be queryable:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a plain coach uuid>';
--     select public.is_axis_admin(), public.is_axis_active(),
--            public.has_permission('manage_athletes'), public.current_coach_slug();
--     select count(*) from public.profiles;          -- policy evaluates, no denial
--     select count(*) from public.conversations;     -- is_conversation_member fires
--     select count(*) from public.saved_reports;     -- reports_can_view fires
--     select count(*) from public.staff_permissions; -- can_grant_permission fires
--     select count(*) from public.intake_forms;      -- intake_form_coach_slug fires
--   rollback;
--
-- The app paths that reach the revoked internals indirectly must still work,
-- because that is the whole claim of test (d):
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a coach uuid>';
--     select count(*) from public.list_message_contacts();      -- calls can_message
--     select count(*) from public.effective_permissions('<a profile uuid>');
--                                                              -- calls profile_has_permission
--     select count(*) from public.report_booking_funnel(now() - interval '30 days', now());
--                                                              -- calls reports_scope_coach
--   rollback;
--
--   -- and the direct calls are now refused
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a coach uuid>';
--     select public.can_message('<any profile uuid>');
--     -- ERROR: permission denied for function can_message
--   rollback;
--
-- Section 5. Where the extensions live, and whether the constraint still bites:
--
--   select e.extname, n.nspname
--     from pg_catalog.pg_extension e
--     join pg_catalog.pg_namespace n on n.oid = e.extnamespace
--    where e.extname in ('btree_gist','pg_net');
--   -- btree_gist should read `extensions`; pg_net reads `extensions` or wherever
--   -- it was, and the apply-time notice says which and why
--
--   select conname from pg_catalog.pg_constraint
--    where conrelid = 'public.bookings'::regclass
--      and conname = 'bookings_no_overlap';                    -- 1 row
--
--   -- 008's own test, unchanged, must still fail with 23P01
--   begin;
--     insert into public.bookings (coach_slug, booked_at, duration_minutes,
--                                  first_name, last_name, email)
--     values ('<slug>', now() + interval '1 day', 60, 'A', 'B', 'a@b.c');
--     insert into public.bookings (coach_slug, booked_at, duration_minutes,
--                                  first_name, last_name, email)
--     values ('<slug>', now() + interval '1 day' + interval '10 min', 60, 'C', 'D', 'c@d.e');
--     -- ERROR: conflicting key value violates exclusion constraint "bookings_no_overlap"
--   rollback;
--
--   -- and net.http_post is still where private.invoke_edge_function looks
--   select n.nspname, p.proname from pg_catalog.pg_proc p
--     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
--    where p.proname = 'http_post';                            -- nspname = net
--
-- Re-runnability, last. Applying this file twice must change nothing:
--
--   \i supabase/migrations/034_linter_hardening.sql
--   select to_regclass('public.my_bookings');                  -- still null
--   select count(*) from pg_catalog.pg_proc p
--     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'my_bookings'; -- 1
--
-- Re-runnable.
-- ============================================================
