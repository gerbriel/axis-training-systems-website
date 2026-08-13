-- ============================================================
-- Axis Training Systems — 019: site settings the public can read
-- ============================================================
--
-- There was nowhere to keep a site-wide switch that the PUBLIC page needs to
-- read. `admin_config` is the obvious candidate and is exactly wrong for it:
-- 017 F4 locked it to admins because it holds the Resend key, so anon cannot
-- read a thing in it. A "show the demo button to everyone" flag that only an
-- admin can read is a flag that does nothing.
--
-- So this is the public half of settings: a small key/value table that anyone
-- may READ and only an admin (or a coach granted manage_site_settings) may
-- WRITE. Nothing secret goes here — by construction, because anon reads it.
-- Secrets stay in admin_config and the edge-function secret store.
--
-- The first setting is `demo_enabled`: whether the "View Demo" affordance shows
-- to the public. Default false — a live site does not lead with a demo button —
-- and an admin always sees it regardless, so turning it off hides it from
-- visitors without locking the admin out of the demo.
--
-- Re-runnable.
-- ============================================================

create table if not exists public.site_settings (
  key        text primary key,
  -- jsonb so a later setting can be a string, number, or object without a
  -- schema change. A boolean flag stores as `true`/`false`.
  value      jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,

  -- Keys are a controlled vocabulary, not free text: this table is
  -- admin-writable and anon-readable, and an open key space is a place to
  -- scribble. Add a key here when you add a setting.
  constraint site_settings_key_known check (key in ('demo_enabled'))
);

create or replace function public.site_settings_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

drop trigger if exists site_settings_touch_trg on public.site_settings;
create trigger site_settings_touch_trg
  before insert or update on public.site_settings
  for each row execute function public.site_settings_touch();


-- ── RLS ──────────────────────────────────────────────────────────────────────
--
-- Read: everyone, signed in or not. The whole point is that the public home
-- page can decide whether to render the demo button.
--
-- Write: an admin, or a coach the admin has trusted with manage_site_settings
-- (the permission is admin-only to grant, 016). This is the first policy to
-- adopt that permission, following 018's pattern exactly.

alter table public.site_settings enable row level security;

drop policy if exists "public reads site settings"  on public.site_settings;
drop policy if exists "admins write site settings"   on public.site_settings;

create policy "public reads site settings"
  on public.site_settings for select to anon, authenticated
  using (true);

create policy "admins write site settings"
  on public.site_settings for all to authenticated
  using (public.is_axis_admin() or public.has_permission('manage_site_settings'))
  with check (public.is_axis_admin() or public.has_permission('manage_site_settings'));

revoke all on public.site_settings from anon, authenticated;
grant  select (key, value) on public.site_settings to anon;
grant  select, insert, update on public.site_settings to authenticated;


-- ── Seed ─────────────────────────────────────────────────────────────────────
-- do nothing on conflict, so re-running never resets a flag the studio has since
-- flipped in the portal.

insert into public.site_settings (key, value) values ('demo_enabled', 'false'::jsonb)
on conflict (key) do nothing;


-- ── Verify ───────────────────────────────────────────────────────────────────
--
--   set role anon;
--   select value from public.site_settings where key = 'demo_enabled';  -- false
--   update public.site_settings set value = 'true' where key = 'demo_enabled'; -- 0 rows / denied
--   reset role;
