-- ============================================================
-- Axis Training Systems — 040: one area at a time, and read before write
-- ============================================================
--
-- 016 built the permission engine and 018 proved the adoption pattern on two
-- safe surfaces. What neither of them has is GRANULARITY across the areas of
-- the portal a person actually works in. Today a coach either holds
-- `manage_content` — which the site reads as "edit the site" — or holds nothing
-- about content at all, and there is no way to say the sentence the head coach
-- keeps saying out loud: "Seth reads the blog queue but does not approve it,
-- Lucas runs the shop and never sees the newsletter list, Kobe writes posts and
-- nothing else."
--
-- Two ideas are missing, and this file adds both.
--
-- FIRST, AN AREA IS NOT A VERB. `view_blog` and `manage_blog` are the same
-- surface at two depths, and the split is what makes delegation survivable: a
-- person can be shown the whole publishing queue — every draft, every rejection
-- note, the rotation — without being handed the button that puts something on
-- the public site. The same split is why `view_marketing` and `view_store`
-- exist with no `manage_` twin here: the writing side of marketing is already
-- governed by `send_marketing` and `manage_announcements` (028, 030), and the
-- writing side of the shop by `manage_products` / `manage_categories` /
-- `manage_inventory` / `manage_orders` / `manage_expenses` (025, 026). What was
-- missing on both was the READ, which until now was admin-or-manager and
-- nothing in between. A bookkeeper who may see every order and change none of
-- them was not expressible. Now it is.
--
-- SECOND, THE HEAD COACH IS A GRANT, NOT A ROLE. There is no head-coach role in
-- `user_role` and this file does not add one. 016 already describes the shape:
-- an admin grants one senior coach `manage_permissions` (sensitive, so only an
-- admin can introduce it) plus the area keys that coach is meant to distribute,
-- and `can_grant_permission` then lets them hand those onward — never a
-- sensitive key, never one they do not themselves hold. The set in circulation
-- spreads and never grows. Every key seeded below is `is_sensitive = false`
-- precisely so it CAN be distributed that way; making one sensitive would mean
-- the admin has to do every grant by hand, which is the arrangement this whole
-- feature exists to end.
--
-- WHAT THIS FILE ADOPTS, AND WHAT IT ONLY REGISTERS. Sections 2 through 4 write
-- real policy against blog, marketing and store. `manage_resource_library` and
-- `manage_calculators` are seeded in section 1 and adopted NOWHERE here: the
-- tables they will govern arrive in 041 and 042, and a policy against a table
-- that does not exist yet is not a policy, it is a broken migration. 016 is
-- explicit that a permission is inert until something is written against it;
-- these two are inert on purpose, for exactly one migration each.
--
-- ONLY WIDER, NEVER NARROWER. Every clause below is a NEW permissive policy
-- sitting alongside the ones the owning migration wrote, which is 018 section
-- 1's shape ("the owning-coach and admin policies from 009 stay; this adds the
-- head coach"). Postgres ORs permissive policies, so nothing here can take
-- access away from anyone, and re-running an earlier migration cannot undo this
-- one. `public.is_axis_admin()` is restated in every predicate so each policy
-- reads as a complete sentence on its own rather than leaning on a neighbour.
--
-- Re-runnable.
-- ============================================================


-- ── 1. The catalogue ────────────────────────────────────────────────────────
--
-- `do update` rather than `do nothing`, matching 016 section 10: re-running
-- this file restores a label or an is_sensitive flag somebody edited by hand in
-- the SQL editor, and the flag is a security control that only this statement
-- asserts.
--
-- None of the six is sensitive. Holding one runs a corner of the site; it does
-- not hand out power. The three that do — manage_staff, manage_permissions,
-- manage_site_settings — were flagged in 016 and are not joined here.

insert into public.permissions (key, label, description, is_sensitive) values
  ('view_blog', 'See the blog queue',
   'Every blog submission, draft and the publishing rotation, in the portal. '
   'Read-only: it shows the whole queue and approves nothing.', false),
  ('manage_blog', 'Manage the blog',
   'Create, edit, approve, reject and schedule blog content, anyone''s, plus '
   'the publishing rotation.', false),

  ('view_marketing', 'See marketing data',
   'Newsletter leads and signups, broadcast history and the marketing '
   'insights. Read-only: it sends nothing.', false),

  ('view_store', 'See the storefront',
   'The catalog, inventory levels, orders and sales figures. Read-only: it '
   'changes no price, no stock and no order.', false),

  ('manage_resource_library', 'Manage the resource library',
   'Create, edit, publish and retire the free resources and tools on the '
   'public site.', false),
  ('manage_calculators', 'Manage the calculators',
   'Adjust the numbers inside the public calculators: percentages, tables and '
   'rounding.', false)
on conflict (key) do update
  set label        = excluded.label,
      description  = excluded.description,
      is_sensitive = excluded.is_sensitive;

-- Selected FROM the catalogue rather than listed, the 016 section 11 idiom, so
-- the admin column cannot fall behind a key added in the statement above. It
-- feeds the settings matrix and is never the answer: profile_has_permission
-- short-circuits on role = 'admin' long before it reads this table.
insert into public.role_permissions (role, permission)
select 'admin'::public.user_role, key from public.permissions
on conflict do nothing;

-- COACH DEFAULTS ARE NOT TOUCHED. A coach keeps the seven 016 gave them. Every
-- key above is granted per person, which is the whole point: "some coaches get
-- the blog, others get the shop" is a statement about people, and a role
-- default is a statement about everyone.


-- ── 2. Blog: the queue, the approval, and the rotation ──────────────────────
--
-- 004 governs `pending_content` with four coach policies and one admin policy,
-- and its per-coach rules are unusually load-bearing, so read them before
-- reading these:
--
--   coach_read_own              a coach sees their OWN rows at any status
--   coach_insert_own            and may only create them as 'pending'
--   coach_update_own_unapproved may edit own pending/rejected rows, and the
--                               WITH CHECK forces the result back to 'pending'
--   coach_delete_own_pending    may withdraw an unreviewed submission
--   admin_full_access           is_content_admin() does everything
--
-- A CORRECTION TO THE FOLKLORE, because the next person to touch this will go
-- looking for a trigger that is not there. "A trigger stops a non-admin setting
-- status = 'approved'" is how this rule gets described, and it is not how it is
-- enforced. There is no trigger on `pending_content` in any migration — 008 is
-- the booking overlap constraint and 006/017/018 own the only status trigger in
-- the schema, which is the testimonials one. What actually stops a coach
-- publishing themselves is the WITH CHECK on `coach_update_own_unapproved`:
-- their only route to an UPDATE forces `status = 'pending'` on the way out. So
-- the widening below is a policy change, not a function rewrite, and the
-- verify section proves the approve path really does open.
--
-- Why two policies and not one. SELECT and ALL are different questions here. A
-- `view_blog` holder must see rows they did not write and must change none of
-- them; giving them a SELECT policy and no UPDATE policy is exactly that, and
-- it is enforced by the absence of a matching USING clause rather than by
-- anything the client does. Their update finds no policy that admits the row
-- and writes zero rows. That is the read-only guarantee, and it is why the
-- panels in src/pages/admin can be honest about hiding the buttons.

drop policy if exists "view_blog reads every submission" on public.pending_content;
create policy "view_blog reads every submission"
  on public.pending_content for select to authenticated
  using (
    public.is_axis_admin()
    or public.has_permission('view_blog')
    or public.has_permission('manage_blog')
  );

-- The approve/reject path. `for all` so a manage_blog holder edits, publishes,
-- unpublishes and deletes anybody's post exactly as the admin policy allows —
-- including moving `status` to 'approved', which no coach policy will ever
-- permit. The admin route (004's admin_full_access) is untouched beside it.
drop policy if exists "manage_blog manages every submission" on public.pending_content;
create policy "manage_blog manages every submission"
  on public.pending_content for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_blog'))
  with check (public.is_axis_admin() or public.has_permission('manage_blog'));

-- The rotation (005). Its read was `using (true)` until 017 F9 narrowed it to
-- `rotation_staff_read`: `current_coach_slug() is not null or is_axis_admin()`.
-- That asks "do you own a calendar", which is the wrong question for a person
-- whose job is the editorial schedule — 016 section 1 makes the same point
-- about `is_axis_staff()`. A view_blog holder with no slug of their own could
-- not see whose turn it is to write.
drop policy if exists "view_blog reads the rotation" on public.content_rotation;
create policy "view_blog reads the rotation"
  on public.content_rotation for select to authenticated
  using (
    public.is_axis_admin()
    or public.has_permission('view_blog')
    or public.has_permission('manage_blog')
  );

-- Adding a cycle, reassigning one, waiving one. 005's `rotation_admin_write`
-- (is_content_admin(), which is is_axis_admin() since 011) stays as it is.
drop policy if exists "manage_blog writes the rotation" on public.content_rotation;
create policy "manage_blog writes the rotation"
  on public.content_rotation for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_blog'))
  with check (public.is_axis_admin() or public.has_permission('manage_blog'));


-- ── 3. Marketing: the reads, and only the reads ─────────────────────────────
--
-- Every write in this area is already gated on a key that exists:
-- `send_marketing` for broadcasts and newsletters (028, 030),
-- `manage_announcements` for the banner (028). None of them is widened here,
-- deliberately — "may see who signed up" and "may email them" are the two
-- halves of this area that most need to stay separable, and merging them would
-- make `view_marketing` a send permission wearing a read permission's name.
--
-- `newsletter_leads` (015) is the case the header describes. Its read has been
-- `is_axis_admin()` since 015 replaced the root script's
-- `auth.role() = 'authenticated'`, which by then meant every athlete on the
-- site. The check stays a positive allowlist; it just names one more thing.

drop policy if exists "view_marketing reads signups" on public.newsletter_leads;
create policy "view_marketing reads signups"
  on public.newsletter_leads for select to authenticated
  using (public.is_axis_admin() or public.has_permission('view_marketing'));

-- `broadcasts` (028) is one `for all` policy on send_marketing, so today
-- reading the send history and performing a send are the same permission. This
-- separates them: SELECT only, no WITH CHECK, so nothing about the insert path
-- changes. The column grants (028 revokes `created_by` from insert/update)
-- apply either way.
drop policy if exists "view_marketing reads broadcasts" on public.broadcasts;
create policy "view_marketing reads broadcasts"
  on public.broadcasts for select to authenticated
  using (public.is_axis_admin() or public.has_permission('view_marketing'));

-- `newsletters` (030) has the same shape: "senders manage newsletters" is `for
-- all` on send_marketing, and beside it "recipients read sent newsletters"
-- lets anybody who was actually delivered a copy read that copy. This adds the
-- third reader — somebody whose job is to look at what went out, drafts
-- included, and send none of it.
drop policy if exists "view_marketing reads newsletters" on public.newsletters;
create policy "view_marketing reads newsletters"
  on public.newsletters for select to authenticated
  using (public.is_axis_admin() or public.has_permission('view_marketing'));

/**
 * Who a newsletter went to, and whether they have opened it (033 section 3).
 *
 * The body is 033's, verbatim, with one predicate widened — the same move 018
 * section 2 made on `guard_testimonial_main_status`, and for the same reason:
 * 033 has its own story and its own verify block, and editing it in place would
 * hide this change inside a file about something else.
 *
 * WHAT IT STILL DOES NOT EXPOSE: votes. 033's comment is emphatic and it holds
 * unchanged here, because nothing in this projection touches `poll_votes` and
 * widening the gate does not add a column. Delivery is not anonymous and never
 * was; the vote is, and a `view_marketing` holder learns exactly as much about
 * a poll as a `send_marketing` holder does, which is nothing.
 */
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
  -- WAS: is_axis_admin() or send_marketing. NOW: that, or a read-only
  -- marketing holder. The raise stays a sentence rather than an empty list,
  -- because an empty list and a refusal look identical on screen.
  if not (
    public.is_axis_admin()
    or public.has_permission('send_marketing')
    or public.has_permission('view_marketing')
  ) then
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
  'Sender or marketing-reader tier: everybody a newsletter was delivered to, '
  'with their seen state and delivery time. Exposes delivery, never votes.';

revoke all     on function public.newsletter_recipients(uuid) from public, anon;
grant  execute on function public.newsletter_recipients(uuid) to authenticated, service_role;

-- POLLS ARE NOT WIDENED, and the boundary is drawn on purpose. `polls`,
-- `poll_options` and `poll_results_multi` (030 section 6, 033 section 6) admit
-- the sender tier and whoever the newsletter was delivered to. A marketing
-- reader gets the subject, the audience, the recipient list and the seen state,
-- which is "broadcast history"; they do not get the question or the tallies.
-- Half of that pair is worse than neither: reading the options through a
-- widened policy while `poll_results_multi` still refuses would render every
-- option at zero votes, and a zero that means "you may not see this" is a lie
-- that looks like data.

-- Shared saved reports (027 section 9). The `is_shared` half of
-- `saved_reports_select` is gated on `reports_can_view()`, which is
-- `view_analytics`. A person whose access is one area should be able to open a
-- report somebody deliberately shared with the team.
--
-- NOT WIDENED, AND THIS IS THE DELIBERATE PART: `reports_can_view()` itself.
-- That one function gates all six report RPCs at once — bookings, the funnel,
-- applications, revenue, COACH HOURS, form submissions. Adding an area key to
-- it would hand somebody hired to read the newsletter list a report of every
-- coach's worked hours, which is the cross-coach transfer 018's header says
-- gets its own migration and its own verification rather than a line in a
-- batch. `view_analytics` remains the key for the report set; this policy only
-- covers rows a person chose to share.
drop policy if exists "area readers open shared reports" on public.saved_reports;
create policy "area readers open shared reports"
  on public.saved_reports for select to authenticated
  using (
    is_shared
    and (
      public.is_axis_admin()
      or public.has_permission('view_marketing')
      or public.has_permission('view_store')
    )
  );


-- ── 4. Store: the shop, read-only ───────────────────────────────────────────
--
-- 025 established the shape this section follows: the PUBLIC read and the STAFF
-- read are separate policies, and the public one names no function, because
-- `has_permission()` is revoked from anon (017 F1) and a single policy calling
-- it would make every storefront read a "permission denied for function". None
-- of that changes. The public product and category reads below are untouched;
-- what is added is one more staff reader beside the ones 025 and 026 wrote.
--
-- 025's staff reads already OR two manage keys together ("manage_products or
-- manage_inventory"), so a third reader is the established idiom rather than a
-- new one. Every clause is SELECT only. Nothing here grants a write, and
-- `adjust_stock()` — the definer RPC that is the sole writer of the audit trail
-- — keeps its own `manage_inventory` gate untouched.

drop policy if exists "view_store reads all categories" on public.product_categories;
create policy "view_store reads all categories"
  on public.product_categories for select to authenticated
  using (public.is_axis_admin() or public.has_permission('view_store'));

drop policy if exists "view_store reads all products" on public.products;
create policy "view_store reads all products"
  on public.products for select to authenticated
  using (public.is_axis_admin() or public.has_permission('view_store'));

drop policy if exists "view_store reads all variants" on public.product_variants;
create policy "view_store reads all variants"
  on public.product_variants for select to authenticated
  using (public.is_axis_admin() or public.has_permission('view_store'));

-- The stock audit trail. 025 gives it a read for manage_inventory holders and
-- no write policy at all; this adds the read and, again, no write.
drop policy if exists "view_store reads stock history" on public.stock_adjustments;
create policy "view_store reads stock history"
  on public.stock_adjustments for select to authenticated
  using (public.is_axis_admin() or public.has_permission('view_store'));

-- Orders. 026's `orders_staff_read` already admits `view_sales` alongside
-- `manage_orders`, which is the read/write split this file is generalising, so
-- `view_store` is ADDED beside them rather than replacing either. The update
-- policy (`orders_staff_update`, manage_orders) is not touched, so a view_store
-- holder reads every order and changes none.
drop policy if exists "view_store reads orders" on public.orders;
create policy "view_store reads orders"
  on public.orders for select to authenticated
  using (public.is_axis_admin() or public.has_permission('view_store'));

-- Order lines are readable exactly when their parent order is, which is 026's
-- rule restated for the new key. The EXISTS runs against `orders` under the
-- caller's own RLS, so it cannot reveal a line of an order they may not see.
drop policy if exists "view_store reads order items" on public.order_items;
create policy "view_store reads order items"
  on public.order_items for select to authenticated
  using (
    public.is_axis_admin()
    or (
      public.has_permission('view_store')
      and exists (select 1 from public.orders o where o.id = order_id)
    )
  );

-- Expenses are one `for all` policy on manage_expenses (026), so reading the
-- monthly spend and editing it are currently the same permission. Same split as
-- broadcasts: SELECT only, no WITH CHECK, write path unchanged.
drop policy if exists "view_store reads expenses" on public.expenses;
create policy "view_store reads expenses"
  on public.expenses for select to authenticated
  using (public.is_axis_admin() or public.has_permission('view_store'));


-- ── 5. Verify ───────────────────────────────────────────────────────────────
--
-- Shape first. Six new keys, none sensitive, still exactly three sensitive keys
-- in the whole catalogue, an admin row for every key, and a coach role that did
-- NOT grow:
--
--   select count(*) from public.permissions;                             -- 40
--   select count(*) from public.permissions where is_sensitive;          --  3
--   select count(*) from public.role_permissions where role = 'coach';   --  7
--   select key from public.permissions
--    where key not in (select permission from public.role_permissions
--                       where role = 'admin');                           --  0 rows
--
-- Now the three properties this file exists for. Run each as the coach, through
-- PostgREST or with `set local role authenticated` and a JWT claim, and grant
-- the keys as an admin through set_staff_permission first:
--
--   -- as an admin:
--   select public.set_staff_permission('<coach A>', 'view_blog',   true, 'reads the queue');
--   select public.set_staff_permission('<coach B>', 'manage_blog', true, 'approves posts');
--
-- (1) A view_blog holder SEES EVERYTHING AND WRITES NOTHING. The select returns
--     the whole table including other coaches' drafts; the update matches no
--     policy USING clause it qualifies for, so PostgREST reports zero rows
--     changed rather than an error — RLS filters, it does not raise:
--
--   -- as coach A
--   select count(*) from public.pending_content;                 -- every row
--   update public.pending_content set status = 'approved'
--    where coach_slug <> public.current_coach_slug();            -- UPDATE 0
--   select status from public.pending_content
--    where coach_slug <> public.current_coach_slug() limit 1;    -- unchanged
--
-- (2) A manage_blog holder APPROVES. This is the clause 004 had no route for
--     short of making somebody an admin:
--
--   -- as coach B
--   update public.pending_content set status = 'approved', reviewed_at = now()
--    where id = '<somebody else''s pending post>';               -- UPDATE 1
--
-- (3) A PLAIN COACH IS UNCHANGED. Neither key granted: they still see only
--     their own submissions, and still cannot publish one:
--
--   -- as coach C, holding neither key
--   select distinct coach_slug from public.pending_content;      -- only their own
--   update public.pending_content set status = 'approved'
--    where coach_slug = public.current_coach_slug();             -- UPDATE 0
--                                                                -- (WITH CHECK
--                                                                --  forces 'pending')
--
-- The rotation, same pair:
--
--   -- as coach A (view_blog):   select count(*) from public.content_rotation;  -- all
--   --                           update public.content_rotation set waived = true; -- 0
--   -- as coach B (manage_blog): update public.content_rotation set waived = true
--   --                            where id = '<cycle>';                          -- 1
--
-- Marketing, read without send:
--
--   -- as a coach granted view_marketing only
--   select count(*) from public.newsletter_leads;                -- the list
--   select count(*) from public.broadcasts;                      -- the history
--   insert into public.broadcasts (subject, audience)
--   values ('nope', 'newsletter');                               -- 0 rows / 42501
--
-- Store, read without manage:
--
--   -- as a coach granted view_store only
--   select count(*) from public.orders;                          -- every order
--   select count(*) from public.expenses;                        -- every expense
--   select count(*) from public.stock_adjustments;               -- the audit trail
--   update public.orders set status = 'paid' where id = '<any>'; -- UPDATE 0
--   delete from public.expenses where id = '<any>';              -- DELETE 0
--
-- And anon is not reachable by any of it — the storefront reads still work
-- because 025's public policies name no function:
--
--   set role anon;
--   select count(*) from public.products where is_active;        -- works
--   select count(*) from public.orders;                          -- permission denied
--   select count(*) from public.newsletter_leads;                -- permission denied
--   reset role;
--
-- The two keys this file only registers stay inert until their own migrations
-- land, which is the correct state for them today:
--
--   select key from public.permissions
--    where key in ('manage_resource_library', 'manage_calculators');   -- 2 rows
--   -- and no policy names either one yet:
--   select polname from pg_policy
--    where pg_get_expr(polqual, polrelid) like '%manage_resource_library%'; -- 0 rows
