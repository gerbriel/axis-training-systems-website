-- ============================================================
-- Axis Training Systems — 050: retire the email send log
-- ============================================================
--
-- This file deletes `public.broadcasts` and repairs the two permission
-- descriptions that still describe it. Read the next forty lines before you
-- restore anything: the word "broadcast" means two different things in this
-- schema and only one of them is going.
--
--
-- ── WHAT public.broadcasts WAS ──────────────────────────────────────────────
--
-- A LOGBOOK. 028 says it in its own header: "a record that a newsletter/
-- marketing send was made. The send itself needs Resend and is out of scope
-- here; this table is the intent + the audience count, so the studio has a
-- history of what went out even before the mailer is wired."
--
-- The mailer was never wired. Nothing in this application has ever put an email
-- in front of a person, and this table never sent one — a row was typed by hand,
-- after the fact, in a form whose button said "Record send". The studio never
-- typed one: the panel has read "No broadcasts recorded yet" for its entire
-- life. So the table's whole contribution was a second screen, beside the real
-- newsletter, that looked like a way to send email and was not.
--
-- The owner reviewed the trade (keep an empty table against a wired mailer that
-- may never come, or delete it) and chose deletion. A future Resend integration
-- would want a delivery log written BY the mailer with message ids, bounces and
-- opens in it. It would not want this shape, so keeping this one buys nothing.
--
--
-- ── WHAT STAYS, AND IT IS NOT THE SAME THING ────────────────────────────────
--
-- THE IN-APP NEWSLETTER IS A DIFFERENT, WORKING FEATURE AND IS UNTOUCHED HERE.
-- That is `public.newsletters` (030) plus the fan-out in 030/033: staff compose
-- it in the newsletter desk, `send_newsletter` delivers it as ONE CONVERSATION
-- PER RECIPIENT, and `newsletter_recipients` reads back who has opened it. It
-- sends something real, to real people, today.
--
-- Those conversations carry `kind = 'broadcast'`, because that is the value 023
-- gave `public.conversation_kind`, and 023/030/033/040 name it in policies and
-- functions. THAT ENUM VALUE IS NOT THIS TABLE and must never be retired on the
-- strength of this file. If you are reading 050 while deciding whether some
-- other "broadcast" is dead: if it is the enum value, the fan-out, or anything
-- under `conversations`, it is ALIVE. Only the standalone `broadcasts` table is
-- dead, and after this migration it does not exist to be confused with.
--
-- `send_marketing` STAYS for the same reason. 016 created it, 028 reused it for
-- this logbook, but 030's "senders manage newsletters" policy and the
-- `send_newsletter` RPC are both gated on it too. It is the in-app newsletter's
-- send gate. Dropping it here would silence the feature that works.
--
--
-- ── WHAT THIS FILE TOUCHES ──────────────────────────────────────────────────
--
--   1. The logbook: two policies, the table (with its index and trigger), and
--      the stamp function that existed only to feed it.
--   2. Two rows of `public.permissions`, description only.
--
-- HISTORY IS NOT REWRITTEN. 028 still creates the table, 040 still adds a read
-- policy to it, 034 still revokes on its trigger function. Those files are the
-- record of what was true when they ran, and they are left alone. The ordered
-- set 001..050 is the schema, and 050 is the last word on this table. Replaying
-- 028 or 040 ALONE, after this file, would resurrect the table or error on a
-- missing one; replay the whole set in order, or none of it.
--
-- Re-runnable: every drop is guarded and the two updates are idempotent.
-- ============================================================


-- ── 1. Retire the logbook ───────────────────────────────────────────────────
--
-- ROWS. The drop is unconditional. No row is archived, exported or migrated
-- anywhere, and there is no undo. None are expected — the studio recorded none
-- and the demo rows never lived in a database — but this statement would take
-- them with it either way, and that is the owner's decision, made knowing it.
--
-- Two policies, because two files wrote one each: 028 gave the table a `for all`
-- policy on `send_marketing`, and 040 added a SELECT-only reader on
-- `view_marketing` so that "may read the history" and "may send" could be held
-- separately. Both are dropped by name before the table so that a partial
-- earlier run, or a database that somehow has the policies without the table,
-- lands in the same place.

drop policy if exists "broadcasts_staff_all"             on public.broadcasts;  -- 028
drop policy if exists "view_marketing reads broadcasts"  on public.broadcasts;  -- 040

-- The table, its index and its trigger. `broadcasts_created_at_idx` (028) and
-- `broadcasts_stamp_trg` (028) are owned by the table and go with it, so they
-- are not named separately; naming them would only invite a `drop index` that
-- errors on the second run.
drop table if exists public.broadcasts;

-- The trigger function is NOT owned by the table and would otherwise survive as
-- an orphan. `broadcasts_stamp()` (028) had exactly one consumer, the trigger
-- above, and one job: stamp `created_by` from `auth.uid()` on insert. With the
-- table gone it can never fire, so it goes too. 034 revoked EXECUTE on it as
-- part of the linter sweep; a revoke on a function that no longer exists is
-- moot, and 034 is history either way.
--
-- Its sibling `public.announcements_touch()` is NOT dropped: announcements are
-- the other half of 028 and are very much alive.
drop function if exists public.broadcasts_stamp();

-- DELIBERATELY KEPT, each for a named consumer that is still running:
--
--   `send_marketing`        (016) — gates 030's "senders manage newsletters"
--                                   policy and the `send_newsletter` RPC. The
--                                   in-app newsletter's send gate.
--   `view_marketing`        (040) — still gates `newsletter_leads` (the signup
--                                   list), `newsletters` and the
--                                   `newsletter_recipients` reader.
--   `manage_announcements`  (028) — the banner, the other half of 028.
--   `public.announcements`  (028) — the banner's table, with its own trigger,
--                                   indexes, grants and policies.
--
-- No `role_permissions` row is touched: no key is being removed, so no grant
-- becomes stale.


-- ── 2. Say "newsletter" where the database still says "broadcast" ───────────
--
-- Two catalogue descriptions describe the marketing area to a human being, in
-- the permissions matrix an admin reads when deciding what to hand a coach.
-- Both still use the word "broadcast", which named a feature that no longer
-- exists after section 1 and that nothing a person reads has ever called that.
--
-- The client's fallback catalogue (src/lib/userManagement.ts) was already
-- reworded; these rows were not, so a live portal — which reads the DATABASE,
-- not the fallback — still shows the old sentence. The two sentences below are
-- that client copy, verbatim, so the fallback and the row now say one thing.
--
--   view_marketing   was: 'Newsletter leads and signups, broadcast history and
--                          the marketing insights. Read-only: it sends nothing.'
--   send_marketing   was: 'Newsletters and broadcast email.'
--
-- A plain UPDATE rather than 016 section 10's `on conflict (key) do update`,
-- and the difference is honesty rather than style: this file has no business
-- inserting a permission key, and it must not restate `is_sensitive`, which is
-- the flag that decides whether a key is admin-only to grant. An UPDATE of one
-- column can do neither by accident. It is idempotent: the second run matches
-- the same two rows and writes the same two strings.
--
-- Both writes pass 016's `permission_catalogue_guard` because a migration runs
-- with `auth.uid()` null. Run as a signed-in non-admin, they would raise 22023,
-- which is the guard working.

update public.permissions
   set description = 'Newsletter leads and signups, newsletter history and the '
                     'marketing insights. Read-only: it sends nothing.'
 where key = 'view_marketing';

-- "and by email" would be a promise this app does not keep. Retiring the
-- logbook above removed the last thing in Axis that even PRETENDED to send
-- email, and `newsletter_leads` is still a capture list nobody mails. A
-- permission description is read by whoever is deciding to grant it, so it
-- describes what the grant actually confers and nothing more.
update public.permissions
   set description = 'Newsletters, delivered inside the app.'
 where key = 'send_marketing';


-- ── 3. Verify ───────────────────────────────────────────────────────────────
--
-- (a) THE LOGBOOK IS GONE. The table, its policies, its index and its function:
--
--   select to_regclass('public.broadcasts');                              -- NULL
--   select count(*) from pg_catalog.pg_policies
--    where schemaname = 'public' and tablename = 'broadcasts';            -- 0
--   select count(*) from pg_catalog.pg_indexes
--    where schemaname = 'public' and indexname = 'broadcasts_created_at_idx'; -- 0
--   select count(*) from pg_catalog.pg_proc p
--     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'broadcasts_stamp';       -- 0
--
--   -- and it cannot be read by anybody, which is the point of a drop:
--   select * from public.broadcasts limit 1;                              -- 42P01
--
-- (b) THE TWO DESCRIPTIONS MATCH THE CLIENT COPY, word for word:
--
--   select key, description from public.permissions
--    where key in ('view_marketing', 'send_marketing') order by key;
--
--   -- send_marketing | Newsletters, delivered inside the app.
--   -- view_marketing | Newsletter leads and signups, newsletter history and the
--   --                  marketing insights. Read-only: it sends nothing.
--
--   -- no row anywhere in the catalogue still says broadcast:
--   select count(*) from public.permissions
--    where description ilike '%broadcast%' or label ilike '%broadcast%';  -- 0
--
-- (c) NOTHING ELSE MOVED. Both keys are still present, still not sensitive,
--     and still granted to admin:
--
--   select count(*) from public.permissions
--    where key in ('view_marketing', 'send_marketing') and is_sensitive;  -- 0
--   select count(*) from public.role_permissions
--    where role = 'admin' and permission in ('view_marketing','send_marketing'); -- 2
--
-- (d) THE IN-APP NEWSLETTER IS UNTOUCHED. The enum value, the tables, the
--     policies and the RPCs are all where 030 and 033 left them:
--
--   select unnest(enum_range(null::public.conversation_kind));   -- dm, channel, broadcast
--   select to_regclass('public.newsletters');                    -- public.newsletters
--   select count(*) from pg_catalog.pg_policies
--    where schemaname = 'public' and tablename = 'newsletters';  -- unchanged (4)
--   select count(*) from pg_catalog.pg_proc p
--     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('send_newsletter','newsletter_recipients',
--                        'conversation_is_broadcast');            -- 3
--
--   -- end to end, as an admin: a draft still sends and still fans out.
--   select public.send_newsletter('<a draft newsletter id>');     -- recipient count
--   select count(*) from public.conversations where kind = 'broadcast'; -- that many
--
-- (e) RE-RUNNABILITY. Applying this file twice drops nothing the second time
--     (every statement is `if exists`) and rewrites the same two descriptions.
--
--   \i supabase/migrations/050_retire_email_send_log.sql
-- ============================================================
