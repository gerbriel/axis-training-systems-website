-- ============================================================
-- Axis Training Systems — 025: the merch catalog + inventory
-- ============================================================
--
-- Team-branded merchandise — t-shirts, hoodies — sold from a small storefront.
-- This is the SHARED SCHEMA the orders/sales vertical (026) is built on, so the
-- table and column names here are a contract: 026 decrements stock through the
-- `adjust_stock` RPC and reads `product_variants.stock_qty`, and neither may be
-- renamed without changing 026 in step.
--
-- Four tables and one RPC:
--
--   * product_categories — how the shop is grouped (Apparel, Accessories).
--   * products           — the item and its default price, in integer cents.
--   * product_variants   — a size/colour of a product, and WHERE STOCK LIVES. A
--                          product always has at least one variant; one with no
--                          real sizes gets a single implicit 'Default' variant
--                          so there is exactly one place a unit count can sit.
--   * stock_adjustments  — the audit trail. Stock is never written by hand; it
--                          moves only through adjust_stock(), which records why.
--
-- The storefront is public, so anon/authenticated READ active products, their
-- variants and their categories through narrow column grants — no audit rows,
-- and no inactive rows. Every write is gated on an active admin or one of the
-- three new permissions: manage_products, manage_categories, manage_inventory.
--
-- Money is integer cents everywhere. There is no float on a price in this file.
--
-- Re-runnable: every object is created if-not-exists or create-or-replace, every
-- policy is dropped first, and the seed guards against its own duplicates.
-- ============================================================


-- ── 1. updated_at ───────────────────────────────────────────────────────────
--
-- `products` is the only table here that is edited after creation, so it is the
-- only one carrying updated_at. The trigger mirrors 011's `profiles_touch`; a
-- fixed empty search_path keeps it off the mutable-search_path list 017 swept.

create or replace function public.catalog_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.catalog_touch_updated_at() from public, anon, authenticated;


-- ── 2. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.product_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  sort_order int  not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,
  description text,
  category_id uuid references public.product_categories(id) on delete set null,
  price_cents int  not null check (price_cents >= 0),
  sku         text,
  -- A stored image URL is rendered into an <img src>; the CHECK refuses anything
  -- that is not an http(s) URL so a `javascript:` scheme can never be persisted.
  image_url   text check (image_url is null or image_url ~* '^https?://'),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.product_variants (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references public.products(id) on delete cascade,
  -- 'S', 'M', 'L', 'XL' — or 'Default' for a product that has no real sizes.
  name                text,
  sku                 text,
  -- null = inherit the product's price. A real override is still integer cents.
  price_cents_override int check (price_cents_override is null or price_cents_override >= 0),
  stock_qty           int not null default 0,
  created_at          timestamptz not null default now()
);

-- The audit trail. adjust_stock() is the only writer; there is no write policy
-- and no write grant, so nothing but the definer RPC (or the service role) can
-- put a row here — which is what makes the ledger trustworthy.
create table if not exists public.stock_adjustments (
  id          uuid primary key default gen_random_uuid(),
  variant_id  uuid not null references public.product_variants(id) on delete cascade,
  delta       int  not null,
  reason      text,
  adjusted_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- One row per size per product. Partial-unique on the id-bearing columns rather
-- than a plain constraint so a re-run of the seed cannot double a size.
create unique index if not exists product_variants_product_name_uniq
  on public.product_variants (product_id, name) where name is not null;

create index if not exists products_category_idx  on public.products (category_id) where is_active;
create index if not exists products_active_idx     on public.products (is_active, created_at desc);
create index if not exists product_variants_product_idx on public.product_variants (product_id);
create index if not exists stock_adjustments_variant_idx on public.stock_adjustments (variant_id, created_at desc);

drop trigger if exists products_touch_trg on public.products;
create trigger products_touch_trg
  before update on public.products
  for each row execute function public.catalog_touch_updated_at();


-- ── 3. adjust_stock: the only door onto a stock number ──────────────────────
--
-- 026 calls this to decrement on a sale; the inventory panel calls it to receive
-- or correct. It is SECURITY DEFINER so it can move stock and write the ledger
-- in one statement a caller has no direct grant for — which is exactly why it
-- re-checks authorisation itself: is_axis_admin() or manage_inventory, or it
-- raises. A definer function that trusted its caller would be a hole around RLS.
--
-- Overselling is refused: a delta that would drive a variant below zero raises
-- rather than writing a negative balance, so a race between two sales fails loud
-- instead of shipping stock that is not there.

create or replace function public.adjust_stock(
  p_variant uuid,
  p_delta   int,
  p_reason  text
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new int;
begin
  if not (public.is_axis_admin() or public.has_permission('manage_inventory')) then
    raise exception 'Not authorised to adjust stock'
      using errcode = 'insufficient_privilege';
  end if;

  update public.product_variants
     set stock_qty = stock_qty + p_delta
   where id = p_variant
  returning stock_qty into v_new;

  if v_new is null then
    raise exception 'Unknown variant %', p_variant using errcode = 'no_data_found';
  end if;

  if v_new < 0 then
    -- Undo the update: the exception rolls the statement back, but say why in
    -- the language the app checks for (23514 → a stock rule, like a CHECK).
    raise exception 'Insufficient stock for variant %', p_variant using errcode = 'check_violation';
  end if;

  insert into public.stock_adjustments (variant_id, delta, reason, adjusted_by)
  values (p_variant, p_delta, p_reason, auth.uid());

  return v_new;
end $$;

revoke all     on function public.adjust_stock(uuid, int, text) from public, anon;
grant  execute on function public.adjust_stock(uuid, int, text) to authenticated, service_role;


-- ── 4. RLS ──────────────────────────────────────────────────────────────────
--
-- Read: the storefront is public, so anon and authenticated read ACTIVE rows.
-- Staff (an admin, or someone holding the matching manage_* permission) read
-- everything, including retired rows they are about to bring back.
--
-- Write: an active admin, or the permission that names the surface. Postgres ORs
-- permissive policies, so naming both in one policy is the whole gate.

alter table public.product_categories enable row level security;
alter table public.products           enable row level security;
alter table public.product_variants   enable row level security;
alter table public.stock_adjustments  enable row level security;

drop policy if exists "read active categories"  on public.product_categories;
drop policy if exists "manage categories"        on public.product_categories;
drop policy if exists "read active products"      on public.products;
drop policy if exists "manage products"           on public.products;
drop policy if exists "read variants of active"   on public.product_variants;
drop policy if exists "manage variants"           on public.product_variants;
drop policy if exists "read stock adjustments"    on public.stock_adjustments;

-- The public read and the staff read are SEPARATE policies, and the public one
-- names NO function on purpose. `is_axis_admin()` / `has_permission()` are
-- revoked from anon (017 F1), and a single `using (is_active or is_axis_admin())`
-- policy makes anon evaluate that function and get "permission denied for
-- function" on every storefront read — the row being active does not save it,
-- because the qual is checked as a whole. So: a function-free "active rows"
-- policy for everyone, plus a staff-only policy (authenticated) that widens to
-- inactive rows. Multiple permissive SELECT policies OR together, so staff see
-- both. (This is the shape the settings migration already used for locations.)

-- Categories -----------------------------------------------------------------
drop policy if exists "public reads active categories" on public.product_categories;
drop policy if exists "staff reads all categories"     on public.product_categories;
create policy "public reads active categories"
  on public.product_categories for select to anon, authenticated
  using (is_active);
create policy "staff reads all categories"
  on public.product_categories for select to authenticated
  using (public.is_axis_admin() or public.has_permission('manage_categories') or public.has_permission('manage_products'));

create policy "manage categories"
  on public.product_categories for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_categories'))
  with check (public.is_axis_admin() or public.has_permission('manage_categories'));

-- Products -------------------------------------------------------------------
drop policy if exists "public reads active products" on public.products;
drop policy if exists "staff reads all products"     on public.products;
create policy "public reads active products"
  on public.products for select to anon, authenticated
  using (is_active);
create policy "staff reads all products"
  on public.products for select to authenticated
  using (public.is_axis_admin() or public.has_permission('manage_products') or public.has_permission('manage_inventory'));

create policy "manage products"
  on public.products for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_products'))
  with check (public.is_axis_admin() or public.has_permission('manage_products'));

-- Variants -------------------------------------------------------------------
-- A variant is public exactly when its product is: the EXISTS gate lets anon
-- read a size of an active tee without reading a size of a retired one. That
-- subquery hits products under anon's OWN RLS (the active-only policy above),
-- so it needs no function either.
drop policy if exists "public reads variants of active" on public.product_variants;
drop policy if exists "staff reads all variants"        on public.product_variants;
create policy "public reads variants of active"
  on public.product_variants for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.is_active)
  );
create policy "staff reads all variants"
  on public.product_variants for select to authenticated
  using (public.is_axis_admin() or public.has_permission('manage_products') or public.has_permission('manage_inventory'));

-- Editing a variant's identity (adding a size, renaming, repricing) is a catalog
-- act, so it is gated on manage_products. Moving its STOCK is not done here at
-- all — that goes through adjust_stock(), which has its own manage_inventory
-- gate — so this policy deliberately does not admit manage_inventory.
create policy "manage variants"
  on public.product_variants for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_products'))
  with check (public.is_axis_admin() or public.has_permission('manage_products'));

-- Stock adjustments ----------------------------------------------------------
-- Read only, and only for inventory-holders; there is intentionally no write
-- policy, because the audit trail is written solely by the definer RPC above.
create policy "read stock adjustments"
  on public.stock_adjustments for select to authenticated
  using (public.is_axis_admin() or public.has_permission('manage_inventory'));


-- ── 5. Grants ───────────────────────────────────────────────────────────────
--
-- Column grants, not just policies (the 009 idiom): a `select('*')` from the
-- browser is a permission error rather than a slow leak of a column anon should
-- never have seen. anon gets the storefront columns; authenticated gets full
-- table DML (RLS is what then decides which rows), except on the audit trail,
-- which authenticated may only READ.

revoke all on public.product_categories from anon, authenticated;
revoke all on public.products           from anon, authenticated;
revoke all on public.product_variants   from anon, authenticated;
revoke all on public.stock_adjustments  from anon, authenticated;

grant select (id, name, slug, sort_order, is_active, created_at)
  on public.product_categories to anon;
grant select (id, name, slug, description, category_id, price_cents, sku, image_url, is_active, created_at)
  on public.products to anon;
grant select (id, product_id, name, sku, price_cents_override, stock_qty, created_at)
  on public.product_variants to anon;

grant select, insert, update, delete on public.product_categories to authenticated;
grant select, insert, update, delete on public.products           to authenticated;
grant select, insert, update, delete on public.product_variants   to authenticated;

-- Audit is read-only to authenticated; the RPC (definer) is the only writer.
grant select on public.stock_adjustments to authenticated;


-- ── 6. Permission catalogue ─────────────────────────────────────────────────
--
-- Three operational permissions, registered so the permissions editor can offer
-- them. None is sensitive (like manage_services in 016): holding one lets you
-- run a corner of the shop, not hand out power. `do update` so a re-run restores
-- a hand-edited label.

insert into public.permissions (key, label, description, is_sensitive) values
  ('manage_products', 'Manage the merch catalog',
   'Add, retire, reprice and reword merchandise and its sizes.', false),
  ('manage_categories', 'Manage product categories',
   'Create, rename, reorder and hide the groups the shop is sorted into.', false),
  ('manage_inventory', 'Manage stock levels',
   'Receive, correct and count stock. Every change is written to the audit trail.', false)
on conflict (key) do update
  set label        = excluded.label,
      description  = excluded.description,
      is_sensitive = excluded.is_sensitive;


-- ── 7. Seed: something for the shop to show ─────────────────────────────────
--
-- Two categories and two products with real sizes, so the admin panels and the
-- future storefront have something the moment this lands. Idempotent: products
-- conflict on slug, variants guard on (product, name).

insert into public.product_categories (name, slug, sort_order) values
  ('Apparel',     'apparel',     10),
  ('Accessories', 'accessories', 20)
on conflict (slug) do nothing;

insert into public.products (name, slug, description, category_id, price_cents, sku, image_url) values
  ('Team Axis Tee',
   'team-axis-tee',
   'Soft cotton training tee with the Axis mark across the chest. Runs true to size.',
   (select id from public.product_categories where slug = 'apparel'),
   2500, 'AXIS-TEE',
   null),
  ('Axis Hoodie',
   'axis-hoodie',
   'Midweight fleece hoodie for warm-ups and the drive home. Embroidered logo.',
   (select id from public.product_categories where slug = 'apparel'),
   5500, 'AXIS-HOOD',
   null)
on conflict (slug) do nothing;

insert into public.product_variants (product_id, name, sku, stock_qty)
select p.id, v.name, v.sku, v.stock
from public.products p
join (values
  ('team-axis-tee', 'S',  'AXIS-TEE-S',  12),
  ('team-axis-tee', 'M',  'AXIS-TEE-M',  20),
  ('team-axis-tee', 'L',  'AXIS-TEE-L',  18),
  ('team-axis-tee', 'XL', 'AXIS-TEE-XL',  8),
  ('axis-hoodie',   'M',  'AXIS-HOOD-M', 10),
  ('axis-hoodie',   'L',  'AXIS-HOOD-L', 14),
  ('axis-hoodie',   'XL', 'AXIS-HOOD-XL', 3)
) as v(slug, name, sku, stock) on v.slug = p.slug
where not exists (
  select 1 from public.product_variants pv
  where pv.product_id = p.id and pv.name = v.name
);


-- ── 8. Verify ───────────────────────────────────────────────────────────────
--
--   set role anon;
--   select name, price_cents from public.products;            -- 2 active rows
--   select * from public.products;                            -- permission denied (cost/audit-safe grants)
--   select delta from public.stock_adjustments;               -- permission denied
--   reset role;
--
--   -- As an admin or a manage_inventory holder:
--   select public.adjust_stock(
--     (select id from public.product_variants where sku = 'AXIS-TEE-M'),
--     -1, 'demo sale');                                        -- returns 19, writes one audit row
