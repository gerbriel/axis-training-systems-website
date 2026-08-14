-- ============================================================
-- Axis Training Systems — 029: the settings vertical
-- ============================================================
--
-- The admin portal grew a Settings screen with a column of sub-tabs, and each
-- one needs somewhere to keep what it configures. Most of those places did not
-- exist yet. This migration is the backing store for nine of them:
--
--   Scheduling ............ NO new table. It edits coach_public_settings (009)
--                           — min_lead_minutes / max_advance_days /
--                           buffer_minutes / auto_confirm, per coach. The policy
--                           already exists; the panel is a UI over it.
--   Rooms & equipment ..... public.resources
--   Waitlist rules ........ public.waitlist_settings   (a singleton row)
--   Client notifications .. public.notification_settings (a singleton row) — a
--                           settings SURFACE the dispatcher reads. It does not
--                           rebuild the booking_notifications queue (010); it
--                           only says which kinds are on and how far ahead the
--                           reminders fire.
--   Team .................. NO new table. It reads profiles (011) + coach_routing
--                           (001) and links out to Users for the role itself.
--   Commission ............ public.commission_rules
--   Locations ............. public.locations   (anon may read the active ones —
--                           this is the public contact/address surface)
--   Import & export ....... NO table. The panel exports CSV client-side and
--                           imports nothing new here.
--   Legal ................. public.legal_documents  (privacy / terms / waiver)
--
-- Permission keys added (all delegable — non-sensitive — so an admin can hand a
-- single settings area to a coach without handing over everything):
--   manage_scheduling, manage_resources, manage_waitlist,
--   manage_notifications, manage_commission, manage_locations, manage_legal
--
-- Every write policy gates on is_axis_admin() OR the matching permission. The
-- two anon-readable tables (locations, legal_documents) keep their public read
-- in a SEPARATE policy that calls no helper, because is_axis_admin() and
-- has_permission() are revoked from anon (011/016) — a policy that made anon
-- evaluate them would raise "permission denied for function" on a public read.
--
-- Re-runnable: create-if-not-exists, drop-then-create policies, do-nothing seeds.
-- ============================================================


-- ── 0. Shared touch triggers ────────────────────────────────────────────────
--
-- Two, because some of these tables record WHO last wrote (a settings row an
-- admin will want to attribute) and some only WHEN. Named settings_* so they do
-- not collide with the per-table touch functions 011/018/006 already define.

create or replace function public.settings_touch_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.settings_touch_at_by()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  -- coalesce so a service-role write (auth.uid() is null) keeps whatever the
  -- row already carried rather than nulling the last human author.
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- These run as the table owner on owner-owned tables; they touch no protected
-- data, but lock the search_path anyway per 017's hardening convention.
alter function public.settings_touch_at()    set search_path = '';
alter function public.settings_touch_at_by() set search_path = '';

revoke all on function public.settings_touch_at()    from public, anon;
revoke all on function public.settings_touch_at_by() from public, anon;
grant  execute on function public.settings_touch_at()    to authenticated, service_role;
grant  execute on function public.settings_touch_at_by() to authenticated, service_role;


-- ── 1. Permission catalogue additions ───────────────────────────────────────
--
-- One key per settings area that owns a table. Scheduling reuses
-- coach_public_settings, whose write policy (009) is already the coach's own
-- slug plus admin, so it needs no new key here — but the panel that edits the
-- WHOLE roster is an admin surface, so `manage_scheduling` exists for the UI to
-- gate on and for a future policy to adopt. None are sensitive: these govern
-- business settings, not the power to grant other permissions, so an admin may
-- delegate one area at a time. `do update` mirrors 016 so a re-run restores the
-- label a hand-edit may have changed.

insert into public.permissions (key, label, description, is_sensitive) values
  ('manage_scheduling', 'Manage scheduling',
   'Booking lead time, how far ahead the calendar opens, buffers and auto-confirm, across the roster.', false),
  ('manage_resources', 'Manage rooms & equipment',
   'The rooms and equipment a booking can occupy, and how many of each exist.', false),
  ('manage_waitlist', 'Manage the waitlist',
   'Whether cancellations auto-offer to the waitlist, how long a hold lasts, and how long the list may grow.', false),
  ('manage_notifications', 'Manage client notifications',
   'Which booking emails go out — confirmation, reminders, cancellation — and how far ahead the reminders fire.', false),
  ('manage_commission', 'Manage commission',
   'The commission rules that pay coaches on bookings and sales.', false),
  ('manage_locations', 'Manage locations',
   'The studio locations, their addresses, time zones and which one is primary.', false),
  ('manage_legal', 'Manage legal documents',
   'The privacy policy, terms of service and liability waiver shown on the site.', false)
on conflict (key) do update
  set label        = excluded.label,
      description  = excluded.description,
      is_sensitive = excluded.is_sensitive;

-- The admin holds every key by definition (016 seeds the same way). Selected
-- FROM the catalogue so the admin column can never fall behind a key added just
-- above. Idempotent.
insert into public.role_permissions (role, permission)
select 'admin'::public.user_role, key from public.permissions
on conflict do nothing;


-- ── 2. Rooms & equipment ────────────────────────────────────────────────────

create table if not exists public.resources (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null check (kind in ('room', 'equipment')),
  quantity   int  not null default 1 check (quantity between 0 and 1000),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resources_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists resources_active_idx on public.resources (kind, name) where is_active;

drop trigger if exists resources_touch_trg on public.resources;
create trigger resources_touch_trg
  before update on public.resources
  for each row execute function public.settings_touch_at();

alter table public.resources enable row level security;

drop policy if exists "staff manage resources" on public.resources;
create policy "staff manage resources"
  on public.resources for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_resources'))
  with check (public.is_axis_admin() or public.has_permission('manage_resources'));

revoke all on public.resources from anon, authenticated;
grant  select, insert, update, delete on public.resources to authenticated;


-- ── 3. Waitlist rules ───────────────────────────────────────────────────────
--
-- Singleton: one studio, one set of waitlist rules. `id boolean primary key
-- default true check (id)` makes a second row impossible — the only value the
-- pk may hold is true, and the pk is unique — so the table is a struct the
-- portal edits in place rather than a list.

create table if not exists public.waitlist_settings (
  id           boolean primary key default true check (id),
  auto_offer   boolean not null default false,
  hold_minutes int not null default 30 check (hold_minutes between 0 and 1440),
  max_size     int not null default 10 check (max_size between 0 and 1000),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id) on delete set null
);

drop trigger if exists waitlist_settings_touch_trg on public.waitlist_settings;
create trigger waitlist_settings_touch_trg
  before insert or update on public.waitlist_settings
  for each row execute function public.settings_touch_at_by();

alter table public.waitlist_settings enable row level security;

drop policy if exists "staff manage waitlist settings" on public.waitlist_settings;
create policy "staff manage waitlist settings"
  on public.waitlist_settings for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_waitlist'))
  with check (public.is_axis_admin() or public.has_permission('manage_waitlist'));

revoke all on public.waitlist_settings from anon, authenticated;
grant  select, insert, update on public.waitlist_settings to authenticated;

insert into public.waitlist_settings (id) values (true) on conflict (id) do nothing;


-- ── 4. Client notifications ─────────────────────────────────────────────────
--
-- A settings surface, not a queue. booking_notifications (010) stays the queue
-- and the trigger that fills it stays the source of truth for WHEN a row is
-- written; this table only says which of the four kinds are switched on and how
-- far ahead the two reminders should fire. The dispatcher (a service-role edge
-- function) reads it; service_role bypasses RLS, so it needs no grant here.
-- Singleton for the same reason as the waitlist.

create table if not exists public.notification_settings (
  id                   boolean primary key default true check (id),
  confirmation_enabled boolean not null default true,
  reminder_24h_enabled boolean not null default true,
  reminder_2h_enabled  boolean not null default true,
  cancellation_enabled boolean not null default true,
  -- Lead times in HOURS, matching the kind names in booking_notification_kind.
  -- Ranges keep a reminder from being scheduled a year out or zero minutes ago.
  reminder_24h_hours   int not null default 24 check (reminder_24h_hours between 1 and 168),
  reminder_2h_hours    int not null default 2  check (reminder_2h_hours  between 1 and 48),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.profiles (id) on delete set null,
  -- The 2-hour reminder must fire AFTER the 24-hour one, or the two swap places
  -- and a client gets the "in 2 hours" note a day early.
  constraint notification_settings_reminders_ordered check (reminder_2h_hours < reminder_24h_hours)
);

drop trigger if exists notification_settings_touch_trg on public.notification_settings;
create trigger notification_settings_touch_trg
  before insert or update on public.notification_settings
  for each row execute function public.settings_touch_at_by();

alter table public.notification_settings enable row level security;

drop policy if exists "staff manage notification settings" on public.notification_settings;
create policy "staff manage notification settings"
  on public.notification_settings for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_notifications'))
  with check (public.is_axis_admin() or public.has_permission('manage_notifications'));

revoke all on public.notification_settings from anon, authenticated;
grant  select, insert, update on public.notification_settings to authenticated;

insert into public.notification_settings (id) values (true) on conflict (id) do nothing;


-- ── 5. Commission ───────────────────────────────────────────────────────────
--
-- The rules only. What they pay OUT against (time_entries, orders) is a later
-- migration's job; this is where an admin writes "Seth earns 60% of the bookings
-- he takes" and "everyone earns a flat $5 per retail sale". A null coach_slug is
-- the house rule that applies to anyone without their own.
--
-- Money in one unit each: percent as basis points (6000 = 60.00%), flat as
-- integer cents. The CHECK makes exactly the right column present for the kind,
-- so a percent rule can never carry a stray cent amount that a reader might add.

create table if not exists public.commission_rules (
  id           uuid primary key default gen_random_uuid(),
  coach_slug   text,
  kind         text not null check (kind in ('percent', 'flat')),
  rate_bps     int check (rate_bps is null or rate_bps between 0 and 100000),
  amount_cents int check (amount_cents is null or amount_cents between 0 and 100000000),
  applies_to   text not null check (applies_to in ('bookings', 'sales')),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint commission_rules_slug_shape
    check (coach_slug is null or coach_slug ~ '^[a-z0-9-]+$'),
  constraint commission_rules_amount_matches_kind check (
        (kind = 'percent' and rate_bps     is not null and amount_cents is null)
     or (kind = 'flat'    and amount_cents is not null and rate_bps     is null)
  )
);

create index if not exists commission_rules_slug_idx on public.commission_rules (coach_slug);

drop trigger if exists commission_rules_touch_trg on public.commission_rules;
create trigger commission_rules_touch_trg
  before update on public.commission_rules
  for each row execute function public.settings_touch_at();

alter table public.commission_rules enable row level security;

drop policy if exists "staff manage commission rules" on public.commission_rules;
create policy "staff manage commission rules"
  on public.commission_rules for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_commission'))
  with check (public.is_axis_admin() or public.has_permission('manage_commission'));

revoke all on public.commission_rules from anon, authenticated;
grant  select, insert, update, delete on public.commission_rules to authenticated;


-- ── 6. Locations ────────────────────────────────────────────────────────────
--
-- The one settings table with a PUBLIC face: a contact/address block on the site
-- reads the active locations, so anon may SELECT the active rows. Admin writes.
--
-- Read is split into two policies on purpose. The public one is `using
-- (is_active)` and calls nothing — anon cannot execute is_axis_admin() or
-- has_permission() (revoked in 011/016), so a single policy that OR-ed them in
-- would raise on every anonymous read. The staff policy adds the inactive rows
-- for signed-in managers and is the only one that touches the helpers.

create table if not exists public.locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  address    text,
  timezone   text not null default 'America/Los_Angeles',
  is_primary boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_name_not_blank check (length(btrim(name)) > 0),
  -- Rejects a zone Postgres cannot resolve, the same guard coach_public_settings
  -- (007) uses. Fixed literal because a CHECK may only call IMMUTABLE functions.
  constraint locations_tz_valid
    check ((timestamp '2000-01-01 12:00' at time zone timezone) is not null)
);

-- At most one primary. A partial unique index over the TRUE rows only — two
-- false rows do not collide, one true row is all that is allowed.
create unique index if not exists locations_one_primary_idx
  on public.locations (is_primary) where is_primary;

create index if not exists locations_active_idx on public.locations (name) where is_active;

drop trigger if exists locations_touch_trg on public.locations;
create trigger locations_touch_trg
  before update on public.locations
  for each row execute function public.settings_touch_at();

alter table public.locations enable row level security;

drop policy if exists "public reads active locations" on public.locations;
drop policy if exists "staff read all locations"      on public.locations;
drop policy if exists "staff write locations"         on public.locations;

create policy "public reads active locations"
  on public.locations for select to anon, authenticated
  using (is_active);

create policy "staff read all locations"
  on public.locations for select to authenticated
  using (public.is_axis_admin() or public.has_permission('manage_locations'));

create policy "staff write locations"
  on public.locations for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_locations'))
  with check (public.is_axis_admin() or public.has_permission('manage_locations'));

revoke all on public.locations from anon, authenticated;
grant  select (id, name, address, timezone, is_primary, is_active, created_at) on public.locations to anon;
grant  select, insert, update, delete on public.locations to authenticated;


-- ── 7. Legal documents ──────────────────────────────────────────────────────
--
-- privacy / terms / waiver — a fixed vocabulary, so the slug is the primary key
-- and a CHECK, not free text. anon reads (the footer links render them), admin
-- writes. Public read is `using (true)` and helper-free, for the anon reason
-- above.

create table if not exists public.legal_documents (
  slug       text primary key check (slug in ('privacy', 'terms', 'waiver')),
  title      text not null,
  body       text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

drop trigger if exists legal_documents_touch_trg on public.legal_documents;
create trigger legal_documents_touch_trg
  before insert or update on public.legal_documents
  for each row execute function public.settings_touch_at_by();

alter table public.legal_documents enable row level security;

drop policy if exists "public reads legal documents" on public.legal_documents;
drop policy if exists "staff write legal documents"  on public.legal_documents;

create policy "public reads legal documents"
  on public.legal_documents for select to anon, authenticated
  using (true);

create policy "staff write legal documents"
  on public.legal_documents for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_legal'))
  with check (public.is_axis_admin() or public.has_permission('manage_legal'));

revoke all on public.legal_documents from anon, authenticated;
grant  select (slug, title, body, updated_at) on public.legal_documents to anon;
grant  select, insert, update on public.legal_documents to authenticated;

-- Seed the three with their titles and an empty body. do-nothing on conflict so
-- a re-run never wipes copy the studio has since written.
insert into public.legal_documents (slug, title, body) values
  ('privacy', 'Privacy Policy', ''),
  ('terms',   'Terms of Service', ''),
  ('waiver',  'Liability Waiver', '')
on conflict (slug) do nothing;


-- ── 8. Verify ───────────────────────────────────────────────────────────────
--
-- Seven new permission keys, none sensitive, all held by admin:
--
--   select count(*) from public.permissions
--    where key in ('manage_scheduling','manage_resources','manage_waitlist',
--                  'manage_notifications','manage_commission','manage_locations',
--                  'manage_legal');                                        -- 7
--   select count(*) from public.permissions
--    where key like 'manage_%' and is_sensitive
--      and key in ('manage_resources','manage_locations','manage_legal');  -- 0
--
-- Singletons hold exactly one row and refuse a second:
--
--   insert into public.waitlist_settings (id) values (true);   -- 0 rows / conflict
--   select count(*) from public.notification_settings;         -- 1
--
-- anon sees an active location but not an inactive one, and cannot write:
--
--   set role anon;
--   select count(*) from public.locations;                     -- active rows only
--   insert into public.locations (name) values ('x');          -- denied
--   select slug from public.legal_documents;                   -- privacy/terms/waiver
--   reset role;
-- ============================================================
