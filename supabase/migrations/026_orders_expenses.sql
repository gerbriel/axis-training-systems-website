-- ============================================================
-- Axis Training Systems — 026: orders, sales + expenses
-- ============================================================
--
-- The money vertical for the merch store 025 built the catalog for. Three
-- tables — orders, order_items, expenses — plus the permission keys that gate
-- them and the one trigger that turns "paid" into a stock movement.
--
-- WHAT THIS DEPENDS ON (025, applied first because 025 < 026):
--   * public.products         (id, name, price_cents, is_active, …)
--   * public.product_variants (id, product_id, price_cents_override, stock_qty)
--   * public.adjust_stock(uuid,int,text) and public.stock_adjustments
-- 026 never joins order_items back to those tables to read a price — a line is
-- a SNAPSHOT taken at order time (see order_items). The only live coupling is
-- the stock decrement on payment, and it is guarded with to_regclass so a
-- partial or out-of-order apply degrades to a diagnosable no-op instead of a
-- hard failure on the first sale.
--
-- WHY A TRIGGER DECREMENTS STOCK RATHER THAN store-webhook CALLING adjust_stock:
-- adjust_stock() re-checks is_axis_admin()/manage_inventory against auth.uid(),
-- and auth.uid() is NULL for the service-role webhook — so the RPC would refuse
-- the very path it exists for. The trigger below does the same two writes (move
-- the count, record why) in the one context that is authorised by construction:
-- an order that just became paid. It fires once, on the pending→paid edge, so a
-- Stripe retry or a re-save cannot double-decrement, and it covers BOTH the
-- online (webhook) and the manual "mark paid" (records-only) paths uniformly.
--
-- Money is integer cents everywhere. There is no float on a price in this file.
--
-- Rows are inserted into `orders`/`order_items` by the store-checkout edge
-- function (service role) ONLY — anon and authenticated get no insert policy.
--
-- Re-runnable: every object is create-if-not-exists / create-or-replace, every
-- policy is dropped first, and the seed guards its own duplicates.
-- ============================================================


-- ── 0. Dependency check (diagnostic, non-fatal) ─────────────────────────────
--
-- 026 can be created without 025 present — order_items.product_id/variant_id are
-- deliberately NOT foreign keys (they are snapshots' companions, not live
-- joins). Only the stock trigger needs 025 at run time, and it guards itself.
-- This notice makes an out-of-order apply obvious in the migration log.
do $$
begin
  if to_regclass('public.product_variants') is null
     or to_regprocedure('public.adjust_stock(uuid,int,text)') is null then
    raise notice '026: 025 catalog objects (product_variants / adjust_stock) not found yet — '
                 'orders will apply, but the paid→stock decrement is a no-op until 025 is present.';
  end if;
end $$;


-- ── 1. Trigger helpers ──────────────────────────────────────────────────────
--
-- Own copies rather than a reach into 025's catalog_touch_updated_at(), so 026
-- stands on its own. Fixed empty search_path keeps them off the mutable-path
-- list 017 swept; revoked from every role because a trigger function is invoked
-- by the trigger, never called, and nothing should be able to call it directly.

create or replace function public.orders_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.orders_touch_updated_at() from public, anon, authenticated;

-- Human-readable order number, assigned on insert. A uuid pk is the identity;
-- this is the string a customer and an admin actually say out loud.
create sequence if not exists public.orders_number_seq;

create or replace function public.orders_assign_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_number is null then
    new.order_number := 'AX-' || to_char(now(), 'YYMM') || '-' ||
                        lpad(nextval('public.orders_number_seq')::text, 5, '0');
  end if;
  return new;
end $$;

revoke all on function public.orders_assign_number() from public, anon, authenticated;


-- ── 2. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),
  order_number          text unique,
  -- The account, when there is one. `set null` on delete: an order is a record
  -- that survives the customer's account being removed.
  client_id             uuid references public.profiles(id) on delete set null,
  customer_email        text,
  customer_name         text,
  status                text not null default 'pending'
                          check (status in ('pending','paid','fulfilled','cancelled','refunded')),
  subtotal_cents        int  not null default 0 check (subtotal_cents >= 0),
  total_cents           int  not null default 0 check (total_cents >= 0),
  -- Stripe's session id is unique when set; many nulls coexist (records-only
  -- orders never get one), and nulls are distinct under a unique constraint.
  stripe_session_id     text unique,
  stripe_payment_intent text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists orders_client_idx  on public.orders (client_id, created_at desc);
create index if not exists orders_status_idx  on public.orders (status, created_at desc);
create index if not exists orders_created_idx  on public.orders (created_at desc);

-- Prices here are SNAPSHOTS. Renaming or repricing a product later must never
-- rewrite what someone was charged, so name and unit price are copied in at
-- order time and this table is never joined back to products for a price.
-- product_id / variant_id are kept for attribution and stock, deliberately WITH
-- NO foreign key — a deleted product must not cascade-null a paid receipt, and
-- 026 must not hard-depend on 025's exact columns to create its own tables.
create table if not exists public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete cascade,
  product_id       uuid,
  variant_id       uuid,
  name_snapshot    text not null,
  unit_price_cents int  not null check (unit_price_cents >= 0),
  qty              int  not null check (qty > 0),
  line_total_cents int  not null default 0 check (line_total_cents >= 0)
);

create index if not exists order_items_order_idx   on public.order_items (order_id);
create index if not exists order_items_variant_idx on public.order_items (variant_id) where variant_id is not null;

-- Money going out. One row per outflow: what it was, how much, when, and who
-- keyed it in. amount_cents is a positive magnitude (an expense is a spend, not
-- a signed ledger line). created_by set null on delete keeps history readable
-- after the staffer leaves.
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  description  text not null,
  amount_cents int  not null check (amount_cents >= 0),
  category     text,
  incurred_on  date not null default current_date,
  note         text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists expenses_incurred_idx on public.expenses (incurred_on desc);
create index if not exists expenses_category_idx on public.expenses (category) where category is not null;


-- ── 3. Derived values: line totals + order rollup ───────────────────────────
--
-- The line total is a product of two columns on the same row, so it is set
-- BEFORE the row is written — computing it in an AFTER trigger would mean that
-- trigger writing its own table and re-firing itself.
create or replace function public.order_item_line_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.line_total_cents := new.unit_price_cents * new.qty;
  return new;
end $$;

revoke all on function public.order_item_line_total() from public, anon, authenticated;

drop trigger if exists order_items_line_total on public.order_items;
create trigger order_items_line_total
  before insert or update of unit_price_cents, qty on public.order_items
  for each row execute function public.order_item_line_total();

-- Roll the lines up onto the parent order. Touches `orders` only — never
-- `order_items` — so there is no recursion, and it fires on `update or delete`
-- too so an edit is never left with a stale total. NEW is unassigned on DELETE,
-- hence the TG_OP branch. This makes the order total AUTHORITATIVE from its
-- items; the checkout function's own math only ever has to agree with it.
create or replace function public.order_recalc_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
  v_sum    int;
begin
  if tg_op = 'DELETE' then v_target := old.order_id; else v_target := new.order_id; end if;

  select coalesce(sum(unit_price_cents * qty), 0) into v_sum
  from public.order_items where order_id = v_target;

  update public.orders
     set subtotal_cents = v_sum,
         total_cents    = v_sum
   where id = v_target;

  return null;
end $$;

revoke all on function public.order_recalc_totals() from public, anon, authenticated;

drop trigger if exists order_items_recalc on public.order_items;
create trigger order_items_recalc
  after insert or update or delete on public.order_items
  for each row execute function public.order_recalc_totals();


-- ── 4. Order maintenance triggers ───────────────────────────────────────────

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch
  before update on public.orders
  for each row execute function public.orders_touch_updated_at();

drop trigger if exists orders_assign_number on public.orders;
create trigger orders_assign_number
  before insert on public.orders
  for each row execute function public.orders_assign_number();


-- ── 5. Paid → stock decrement (the single, idempotent decrement point) ──────
--
-- See the header for why this is a definer trigger rather than an adjust_stock()
-- call from the webhook. Fires on the pending→paid EDGE only, so a retry or a
-- re-save cannot double-count. It never RAISES on oversell: the money has
-- already settled by the time an order is paid, so a variant is allowed to go
-- negative (a real "we owe stock" signal the inventory panel can surface)
-- rather than blocking the paid transition. Guarded by to_regclass so a missing
-- 025 is a logged no-op, not a failure.
create or replace function public.orders_apply_paid_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  it record;
begin
  -- Only the transition INTO paid. `is not distinct from` treats a NULL old as
  -- "was not paid" correctly, so a fresh insert that somehow lands paid still
  -- decrements exactly once.
  if new.status <> 'paid' or old.status is not distinct from 'paid' then
    return null;
  end if;

  if to_regclass('public.product_variants') is null then
    raise notice 'orders_apply_paid_stock: public.product_variants absent (025 not applied?) — '
                 'stock NOT decremented for order %', new.id;
    return null;
  end if;

  for it in
    select variant_id, qty
    from public.order_items
    where order_id = new.id and variant_id is not null
  loop
    update public.product_variants
       set stock_qty = stock_qty - it.qty
     where id = it.variant_id;

    -- Keep the audit trail complete: a sale is a stock movement and belongs in
    -- the same ledger adjust_stock() writes to. adjusted_by is null — this
    -- movement was made by the system on a payment, not by a person.
    if to_regclass('public.stock_adjustments') is not null then
      insert into public.stock_adjustments (variant_id, delta, reason, adjusted_by)
      values (it.variant_id, -it.qty, 'Order ' || coalesce(new.order_number, new.id::text), null);
    end if;
  end loop;

  return null;
end $$;

revoke all on function public.orders_apply_paid_stock() from public, anon, authenticated;

drop trigger if exists orders_apply_paid_stock_trg on public.orders;
create trigger orders_apply_paid_stock_trg
  after update of status on public.orders
  for each row execute function public.orders_apply_paid_stock();


-- ── 6. Grants ───────────────────────────────────────────────────────────────
--
-- Supabase hands anon + authenticated everything on a new public table, so the
-- grants are STATED rather than assumed (the 015/025 idiom). anon gets nothing
-- on any of these — the storefront never reads an order, it only posts one
-- through the edge function (service role). authenticated gets exactly what RLS
-- then filters: read on orders/items, plus update on orders for status changes,
-- and full DML on expenses.

revoke all on public.orders      from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
revoke all on public.expenses    from anon, authenticated;

-- No INSERT on orders/order_items for authenticated: checkout owns creation via
-- the service role. UPDATE on orders is for an admin/manage_orders status change.
grant select, update on public.orders      to authenticated;
grant select          on public.order_items to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;


-- ── 7. RLS ──────────────────────────────────────────────────────────────────
--
-- orders / order_items — a client reads their OWN (client_id = auth.uid());
-- an admin or a holder of manage_orders/view_sales reads all. No one but the
-- service role INSERTS an order (no insert policy at all). manage_orders may
-- UPDATE (status, fulfilment, the manual mark-paid). anon: nothing.
--
-- expenses — an admin or manage_expenses does everything; anon and every other
-- authenticated user see nothing.

alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.expenses    enable row level security;

-- Orders ---------------------------------------------------------------------
drop policy if exists "orders_client_read" on public.orders;
create policy "orders_client_read"
  on public.orders for select to authenticated
  using (client_id = auth.uid());

drop policy if exists "orders_staff_read" on public.orders;
create policy "orders_staff_read"
  on public.orders for select to authenticated
  using (
    public.is_axis_admin()
    or public.has_permission('manage_orders')
    or public.has_permission('view_sales')
  );

drop policy if exists "orders_staff_update" on public.orders;
create policy "orders_staff_update"
  on public.orders for update to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_orders'))
  with check (public.is_axis_admin() or public.has_permission('manage_orders'));

-- Order items ----------------------------------------------------------------
-- Readable exactly when the parent order is: the owning client, or staff who
-- may see orders or sales. No write policy — items are written by the checkout
-- function (service role) alongside the order they belong to.
drop policy if exists "order_items_read" on public.order_items;
create policy "order_items_read"
  on public.order_items for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          o.client_id = auth.uid()
          or public.is_axis_admin()
          or public.has_permission('manage_orders')
          or public.has_permission('view_sales')
        )
    )
  );

-- Expenses -------------------------------------------------------------------
drop policy if exists "expenses_manage" on public.expenses;
create policy "expenses_manage"
  on public.expenses for all to authenticated
  using      (public.is_axis_admin() or public.has_permission('manage_expenses'))
  with check (public.is_axis_admin() or public.has_permission('manage_expenses'));


-- ── 8. Permission catalogue ─────────────────────────────────────────────────
--
-- Three keys, registered so the permissions editor can offer them. None is
-- sensitive (holding one runs a corner of the shop, it does not hand out
-- power). NO role_permissions defaults are seeded: until an admin grants one,
-- only an admin holds it (profile_has_permission short-circuits on role=admin).
-- `do update` so a re-run restores a hand-edited label.

insert into public.permissions (key, label, description, is_sensitive) values
  ('manage_orders', 'Manage orders',
   'See every order, change its status, and mark a records-only order paid.', false),
  ('view_sales', 'See sales',
   'Revenue totals, top products and the day-by-day takings. Read-only.', false),
  ('manage_expenses', 'Manage expenses',
   'Record, edit and remove what the shop spends, and see the monthly totals.', false)
on conflict (key) do update
  set label        = excluded.label,
      description  = excluded.description,
      is_sensitive = excluded.is_sensitive;


-- ── 9. Verify ───────────────────────────────────────────────────────────────
--
--   -- As anon: no reach into any of these.
--   set role anon;
--   select * from public.orders;      -- permission denied (no grant)
--   select * from public.expenses;    -- permission denied
--   reset role;
--
--   -- The checkout function (service role) inserts a pending order + items;
--   -- the rollup trigger fills the totals, the number trigger stamps AX-YYMM-…:
--   --   insert into public.orders (customer_email, customer_name) values (…) returning id;
--   --   insert into public.order_items (order_id, variant_id, name_snapshot, unit_price_cents, qty) …
--
--   -- Marking it paid (webhook OR manual) decrements each line's variant ONCE
--   -- and writes one stock_adjustments row per line:
--   --   update public.orders set status = 'paid' where id = '<order>';
--   --   -- a second identical update is a no-op for stock (paid→paid edge guard).
