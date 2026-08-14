-- ============================================================
-- Axis Training Systems — 028: marketing (announcements + broadcasts)
-- ============================================================
--
-- Two surfaces the studio drives from the admin portal's Marketing tab:
--
--   public.announcements — the site-wide banner. A row that is `is_active` AND
--     inside its optional [starts_at, ends_at] window is "currently live", and
--     the public home and booking pages render the highest one. Everyone,
--     signed in or not, may READ a live row (that is the whole point of a
--     banner); only an admin — or a coach granted `manage_announcements` — may
--     write, or read the scheduled/expired ones the panel manages.
--
--   public.broadcasts — a record that a newsletter/marketing send was made.
--     The send itself needs Resend and is out of scope here; this table is the
--     intent + the audience count, so the studio has a history of what went out
--     even before the mailer is wired. Gated by the existing `send_marketing`
--     permission (016) — no new key for it.
--
-- Follows 019_site_settings.sql for the anon-read / admin-write shape: column
-- grants decide the columns, RLS decides the rows, and the write check is the
-- `is_axis_admin() or has_permission(...)` pattern 018/019 established.
--
-- Re-runnable.
-- ============================================================


-- ── 1. Permission key ───────────────────────────────────────────────────────
--
-- `send_marketing` already exists in the 016 catalogue and is reused for
-- broadcasts. `manage_announcements` is new. The catalogue is guarded (016 §6):
-- a write is refused unless auth.uid() is null (a migration) or the writer is an
-- admin, so this INSERT is only ever run by the migration itself.
--
-- `do update` mirrors 016 — re-running restores the label / is_sensitive a hand
-- edit may have drifted. Not sensitive: it drives a marketing banner, not an
-- authorization surface.

insert into public.permissions (key, label, description, is_sensitive) values
  ('manage_announcements', 'Manage announcements',
   'Create, schedule and retire the site-wide announcement banner.', false)
on conflict (key) do update
  set label        = excluded.label,
      description  = excluded.description,
      is_sensitive = excluded.is_sensitive;

-- Admin holds every key by definition — profile_has_permission short-circuits on
-- role='admin' (016) — but the matrix the PermissionsEditor renders is fed by
-- role_permissions, so the admin row is stated here too, or the new key would
-- show as un-granted for admins in that screen. Coaches do not get it by
-- default; an admin grants it per-person when they want a coach running the
-- banner.
insert into public.role_permissions (role, permission)
  select 'admin'::public.user_role, 'manage_announcements'
on conflict do nothing;


-- ── 2. announcements ────────────────────────────────────────────────────────

create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text        not null,
  body       text,
  -- 'info' | 'promo' | 'alert' — decides the banner's accent, nothing more.
  kind       text        not null default 'info'
               check (kind in ('info', 'promo', 'alert')),
  is_active  boolean     not null default false,
  -- Both bounds optional. NULL start = live immediately; NULL end = no expiry.
  starts_at  timestamptz,
  ends_at    timestamptz,
  cta_label  text,
  -- Absolute http(s) or a site-relative path only. A protocol-relative `//host`
  -- fails `^/` because the second char is not the end — it is a costume for an
  -- absolute URL — and the client re-checks with safeUrl before it ever renders.
  cta_url    text        check (cta_url is null or cta_url ~* '^https?://|^/'),
  created_by uuid        references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fast lookup of the currently-live set for the public banner, and a created-at
-- order for the admin list.
create index if not exists announcements_live_idx
  on public.announcements (starts_at, ends_at)
  where is_active;
create index if not exists announcements_created_at_idx
  on public.announcements (created_at desc);

-- updated_at on every write; created_by stamped from the writer on insert so the
-- client never supplies it (and cannot forge it — it is not in the insert grant
-- below either).
create or replace function public.announcements_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  return new;
end $$;

revoke all     on function public.announcements_touch() from public, anon, authenticated;
grant  execute on function public.announcements_touch() to authenticated, service_role;

drop trigger if exists announcements_touch_trg on public.announcements;
create trigger announcements_touch_trg
  before insert or update on public.announcements
  for each row execute function public.announcements_touch();


-- ── 3. announcements — grants + RLS ─────────────────────────────────────────
--
-- Supabase hands anon/authenticated everything on a new public table, so state
-- it. `created_by` is in NONE of the grants — not select (an internal uuid the
-- banner never needs and the panel never shows), and not insert/update either,
-- so a client cannot forge it. It is set only by the trigger, from auth.uid().
-- The insert/update column lists are the eight fields a person actually edits;
-- id/created_at/updated_at fall to their defaults and the trigger.

revoke all on public.announcements from anon, authenticated;
grant  select (id, title, body, kind, is_active, starts_at, ends_at,
               cta_label, cta_url, created_at, updated_at)
       on public.announcements to anon, authenticated;
grant  insert (title, body, kind, is_active, starts_at, ends_at, cta_label, cta_url)
       on public.announcements to authenticated;
grant  update (title, body, kind, is_active, starts_at, ends_at, cta_label, cta_url)
       on public.announcements to authenticated;
grant  delete on public.announcements to authenticated;

alter table public.announcements enable row level security;

drop policy if exists "announcements_public_read" on public.announcements;
drop policy if exists "announcements_admin_all"    on public.announcements;

-- Everyone reads the currently-live rows. `now()` between the optional bounds,
-- NULL meaning "unbounded on that side".
create policy "announcements_public_read"
  on public.announcements for select to anon, authenticated
  using (
    is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >= now())
  );

-- Staff do everything: read the scheduled/expired/inactive rows the panel needs,
-- and insert/update/delete. `for all` covers SELECT too, OR'd with the public
-- policy — a non-staff athlete still sees only live rows because this policy's
-- USING is false for them.
create policy "announcements_admin_all"
  on public.announcements for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_announcements'))
  with check (public.is_axis_admin() or public.has_permission('manage_announcements'));


-- ── 4. broadcasts ───────────────────────────────────────────────────────────
--
-- The record of a send. `sent_at` NULL = drafted but not sent; a value = went
-- out, with `sent_count` the audience size at that moment. Nothing anon touches
-- this table, so there is no anon grant and no public read policy.

create table if not exists public.broadcasts (
  id         uuid primary key default gen_random_uuid(),
  subject    text        not null,
  body       text,
  audience   text        not null default 'newsletter'
               check (audience in ('newsletter', 'all')),
  sent_at    timestamptz,
  sent_count integer     not null default 0 check (sent_count >= 0),
  created_by uuid        references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists broadcasts_created_at_idx
  on public.broadcasts (created_at desc);

create or replace function public.broadcasts_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  return new;
end $$;

revoke all     on function public.broadcasts_stamp() from public, anon, authenticated;
grant  execute on function public.broadcasts_stamp() to authenticated, service_role;

drop trigger if exists broadcasts_stamp_trg on public.broadcasts;
create trigger broadcasts_stamp_trg
  before insert on public.broadcasts
  for each row execute function public.broadcasts_stamp();

-- created_by excluded from insert/update for the same reason as announcements:
-- it is stamped from auth.uid() by the trigger, never supplied by the client.
revoke all on public.broadcasts from anon, authenticated;
grant  select on public.broadcasts to authenticated;
grant  insert (subject, body, audience, sent_at, sent_count) on public.broadcasts to authenticated;
grant  update (subject, body, audience, sent_at, sent_count) on public.broadcasts to authenticated;

alter table public.broadcasts enable row level security;

drop policy if exists "broadcasts_staff_all" on public.broadcasts;

create policy "broadcasts_staff_all"
  on public.broadcasts for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('send_marketing'))
  with check (public.is_axis_admin() or public.has_permission('send_marketing'));


-- ── 5. Verify ───────────────────────────────────────────────────────────────
--
-- The new key is in the catalogue and granted to admin:
--
--   select 1 from public.permissions      where key = 'manage_announcements';           -- 1 row
--   select 1 from public.role_permissions where role = 'admin'
--                                            and permission = 'manage_announcements';    -- 1 row
--
-- Anon sees only a live announcement, and none of the machinery:
--
--   set role anon;
--   insert into public.announcements (title, is_active) values ('x', true); -- denied (no insert grant)
--   select created_by from public.announcements limit 1;                    -- denied (column not granted)
--   select * from public.broadcasts limit 1;                               -- denied (no grant / no policy)
--   reset role;
--
-- The cta_url check refuses a scheme that is neither http(s) nor a rooted path:
--
--   insert into public.announcements (title, cta_url) values ('x', 'javascript:alert(1)'); -- 23514
--   insert into public.announcements (title, cta_url) values ('x', '//evil.com');          -- 23514
--   insert into public.announcements (title, cta_url) values ('x', '/book');               -- ok
--   insert into public.announcements (title, cta_url) values ('x', 'https://axis.co');      -- ok
-- ============================================================
