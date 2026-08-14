/**
 * store.ts — the merch store's data layer (migrations 025 catalog + 026 orders).
 *
 * Three audiences, one module:
 *   • Storefront  — fetchStoreProducts + checkout (public /shop page).
 *   • Orders/Sales — fetchOrders, updateOrderStatus, markPaid, fetchSales (admin).
 *   • Expenses    — CRUD + monthly totals (admin).
 *
 * Demo / no-backend mode (supabaseConfigured === false, or isDemo) runs entirely
 * off in-memory stores seeded to mirror 025's catalog seed, so the panels and the
 * storefront have something the moment they mount. Money is integer cents; the
 * only place cents become a string is money().
 *
 * SECURITY NOTE: nothing here prices anything. checkout() sends variant ids and
 * quantities to the store-checkout edge function, which re-reads every price
 * server-side. A price on the client is signage on a button, never a charge.
 */

import { supabase, supabaseConfigured } from './supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export interface StoreVariant {
  id: string
  name: string | null
  sku: string | null
  priceCentsOverride: number | null
  stockQty: number
}

export interface StoreProduct {
  id: string
  name: string
  slug: string | null
  description: string | null
  priceCents: number
  imageUrl: string | null
  variants: StoreVariant[]
}

export interface CartLine { variantId: string; qty: number }

export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded'

export const ORDER_STATUSES: readonly OrderStatus[] =
  ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded']

export interface OrderItem {
  id: string
  productId: string | null
  variantId: string | null
  nameSnapshot: string
  unitPriceCents: number
  qty: number
  lineTotalCents: number
}

export interface Order {
  id: string
  orderNumber: string | null
  clientId: string | null
  customerEmail: string | null
  customerName: string | null
  status: OrderStatus
  subtotalCents: number
  totalCents: number
  stripeSessionId: string | null
  stripePaymentIntent: string | null
  createdAt: string
  updatedAt: string
  items: OrderItem[]
}

export interface Expense {
  id: string
  description: string
  amountCents: number
  category: string | null
  incurredOn: string        // YYYY-MM-DD
  note: string | null
  createdBy: string | null
  createdAt: string
}

export interface ExpenseInput {
  description: string
  amountCents: number
  category?: string | null
  incurredOn: string
  note?: string | null
}

export interface SalesSummary {
  totalRevenueCents: number
  paidOrderCount: number
  avgOrderCents: number
  byDay: { date: string; cents: number; orders: number }[]
  topProducts: { name: string; qty: number; cents: number }[]
}

export interface CheckoutResult {
  /** Present when Stripe is configured — redirect the browser here. */
  url?: string
  orderId: string
  orderNumber?: string
  /** True when the order was recorded without Stripe, for manual mark-paid. */
  recordsOnly?: boolean
}

/** A sensible starter list for the category dropdown; the field is free text. */
export const EXPENSE_CATEGORIES: readonly string[] = [
  'Inventory / stock',
  'Shipping & fulfillment',
  'Packaging',
  'Payment processing fees',
  'Marketing',
  'Software & subscriptions',
  'Other',
]

// Revenue counts an order once the money has landed and while it stays landed.
const REVENUE_STATUSES: readonly OrderStatus[] = ['paid', 'fulfilled']

// ── Formatting ───────────────────────────────────────────────────────────────

/** Integer cents → a dollar string. The one place cents become text. */
export function money(cents: number): string {
  const v = (cents ?? 0) / 100
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** The effective unit price of a variant, override winning over the product. */
export function variantPriceCents(product: StoreProduct, variant: StoreVariant): number {
  return variant.priceCentsOverride ?? product.priceCents
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending', paid: 'Paid', fulfilled: 'Fulfilled',
  cancelled: 'Cancelled', refunded: 'Refunded',
}
export function orderStatusLabel(s: OrderStatus): string { return STATUS_LABELS[s] ?? s }

/** Turn an opaque edge-function code into something a person can read. */
export function checkoutErrorMessage(code: string): string {
  switch (code) {
    case 'insufficient_stock': return 'One of those items just sold out. Adjust your cart and try again.'
    case 'unavailable':        return 'One of those items is no longer available.'
    case 'rate_limited':       return 'Too many attempts. Give it a minute and try again.'
    case 'invalid_payload':    return 'Please check your details and your cart, then try again.'
    default:                   return 'Checkout could not be completed. Please try again.'
  }
}

// ── Row coercion helpers (untyped supabase client → typed rows) ──────────────

type Row = Record<string, unknown>
const asStr    = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''))
const asStrN   = (v: unknown): string | null => (v == null ? null : String(v))
const asNum    = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0))
const asNumN   = (v: unknown): number | null => (v == null ? null : Number(v))

function mapVariant(r: Row): StoreVariant {
  return {
    id: asStr(r.id),
    name: asStrN(r.name),
    sku: asStrN(r.sku),
    priceCentsOverride: asNumN(r.price_cents_override),
    stockQty: asNum(r.stock_qty),
  }
}

function mapItem(r: Row): OrderItem {
  return {
    id: asStr(r.id),
    productId: asStrN(r.product_id),
    variantId: asStrN(r.variant_id),
    nameSnapshot: asStr(r.name_snapshot),
    unitPriceCents: asNum(r.unit_price_cents),
    qty: asNum(r.qty),
    lineTotalCents: asNum(r.line_total_cents),
  }
}

function mapOrder(r: Row): Order {
  const itemsRaw = Array.isArray(r.order_items) ? (r.order_items as Row[]) : []
  return {
    id: asStr(r.id),
    orderNumber: asStrN(r.order_number),
    clientId: asStrN(r.client_id),
    customerEmail: asStrN(r.customer_email),
    customerName: asStrN(r.customer_name),
    status: asStr(r.status) as OrderStatus,
    subtotalCents: asNum(r.subtotal_cents),
    totalCents: asNum(r.total_cents),
    stripeSessionId: asStrN(r.stripe_session_id),
    stripePaymentIntent: asStrN(r.stripe_payment_intent),
    createdAt: asStr(r.created_at),
    updatedAt: asStr(r.updated_at),
    items: itemsRaw.map(mapItem),
  }
}

function mapExpense(r: Row): Expense {
  return {
    id: asStr(r.id),
    description: asStr(r.description),
    amountCents: asNum(r.amount_cents),
    category: asStrN(r.category),
    incurredOn: asStr(r.incurred_on),
    note: asStrN(r.note),
    createdBy: asStrN(r.created_by),
    createdAt: asStr(r.created_at),
  }
}

// ── Storefront ───────────────────────────────────────────────────────────────

export async function fetchStoreProducts(isDemo = false): Promise<StoreProduct[]> {
  if (!supabaseConfigured || isDemo) return demoProducts()

  const { data: products, error } = await supabase
    .from('products')
    .select('id,name,slug,description,price_cents,image_url,is_active,created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  const rows = (products ?? []) as Row[]
  const ids = rows.map((p) => asStr(p.id))

  const byProduct = new Map<string, StoreVariant[]>()
  if (ids.length > 0) {
    const { data: variants, error: vErr } = await supabase
      .from('product_variants')
      .select('id,product_id,name,sku,price_cents_override,stock_qty')
      .in('product_id', ids)
    if (vErr) throw new Error(vErr.message)
    for (const v of (variants ?? []) as Row[]) {
      const pid = asStr(v.product_id)
      const arr = byProduct.get(pid) ?? []
      arr.push(mapVariant(v))
      byProduct.set(pid, arr)
    }
  }

  return rows.map((p) => ({
    id: asStr(p.id),
    name: asStr(p.name),
    slug: asStrN(p.slug),
    description: asStrN(p.description),
    priceCents: asNum(p.price_cents),
    imageUrl: asStrN(p.image_url),
    variants: byProduct.get(asStr(p.id)) ?? [],
  }))
}

/**
 * Post the cart to store-checkout. Returns either a Stripe url to redirect to,
 * or a records-only order id. Prices are decided server-side; the cart carries
 * ids and quantities only.
 */
export async function checkout(
  cart: CartLine[],
  contact: { email: string; name: string },
  isDemo = false,
): Promise<CheckoutResult> {
  if (!supabaseConfigured || isDemo) {
    const order = pushDemoOrder(cart, contact)
    return { orderId: order.id, orderNumber: order.orderNumber ?? undefined, recordsOnly: true }
  }

  const { data, error } = await supabase.functions.invoke('store-checkout', {
    body: {
      items: cart.map((c) => ({ variant_id: c.variantId, qty: c.qty })),
      email: contact.email,
      name: contact.name,
    },
  })
  if (error) throw new Error(await invokeErrorCode(error))

  const res = (data ?? {}) as { url?: string; order_id?: string; order_number?: string; records_only?: boolean }
  if (!res.order_id) throw new Error('checkout_failed')
  return { url: res.url, orderId: res.order_id, orderNumber: res.order_number, recordsOnly: res.records_only }
}

/** Best-effort read of the opaque `{ error }` code an edge function returned. */
async function invokeErrorCode(error: unknown): Promise<string> {
  try {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context
    if (ctx && typeof ctx.json === 'function') {
      const body = (await ctx.json()) as { error?: unknown }
      if (typeof body?.error === 'string') return body.error
    }
  } catch { /* fall through to a generic code */ }
  return 'checkout_failed'
}

// ── Orders (admin) ───────────────────────────────────────────────────────────

const ORDER_SELECT =
  'id,order_number,client_id,customer_email,customer_name,status,subtotal_cents,' +
  'total_cents,stripe_session_id,stripe_payment_intent,created_at,updated_at,' +
  'order_items(id,product_id,variant_id,name_snapshot,unit_price_cents,qty,line_total_cents)'

export async function fetchOrders(isDemo = false): Promise<Order[]> {
  if (!supabaseConfigured || isDemo) return demoOrders().map(cloneOrder)

  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  // ORDER_SELECT embeds order_items(...); postgrest-js parses select strings at
  // the type level, so the embedded shape degrades to an error-ish type on the
  // untyped client. The rows are real at runtime — cast through unknown.
  return ((data ?? []) as unknown as Row[]).map(mapOrder)
}

export async function updateOrderStatus(id: string, status: OrderStatus, isDemo = false): Promise<void> {
  if (!supabaseConfigured || isDemo) { updateDemoOrder(id, status); return }
  const { error } = await supabase.from('orders').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Records-only mark-paid: transitions an order to paid, firing the 026 trigger
 *  that decrements stock. Same write as updateOrderStatus, named for intent. */
export function markPaid(id: string, isDemo = false): Promise<void> {
  return updateOrderStatus(id, 'paid', isDemo)
}

// ── Sales (admin) ────────────────────────────────────────────────────────────

/** Range bounds are inclusive YYYY-MM-DD; omit either to leave that side open. */
export async function fetchSales(
  isDemo = false,
  range?: { from?: string; to?: string },
): Promise<SalesSummary> {
  const orders = await fetchOrders(isDemo)
  return summarizeSales(orders, range)
}

export function summarizeSales(orders: Order[], range?: { from?: string; to?: string }): SalesSummary {
  const from = range?.from
  const to   = range?.to
  const inRange = (iso: string): boolean => {
    const day = iso.slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  }

  const revenue = orders.filter(
    (o) => REVENUE_STATUSES.includes(o.status) && inRange(o.createdAt),
  )

  const byDayMap = new Map<string, { cents: number; orders: number }>()
  const productMap = new Map<string, { qty: number; cents: number }>()
  let total = 0

  for (const o of revenue) {
    total += o.totalCents
    const day = o.createdAt.slice(0, 10)
    const d = byDayMap.get(day) ?? { cents: 0, orders: 0 }
    d.cents += o.totalCents
    d.orders += 1
    byDayMap.set(day, d)

    for (const it of o.items) {
      const p = productMap.get(it.nameSnapshot) ?? { qty: 0, cents: 0 }
      p.qty += it.qty
      p.cents += it.lineTotalCents
      productMap.set(it.nameSnapshot, p)
    }
  }

  const byDay = [...byDayMap.entries()]
    .map(([date, v]) => ({ date, cents: v.cents, orders: v.orders }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const topProducts = [...productMap.entries()]
    .map(([name, v]) => ({ name, qty: v.qty, cents: v.cents }))
    .sort((a, b) => b.cents - a.cents)

  return {
    totalRevenueCents: total,
    paidOrderCount: revenue.length,
    avgOrderCents: revenue.length ? Math.round(total / revenue.length) : 0,
    byDay,
    topProducts,
  }
}

// ── Expenses (admin) ─────────────────────────────────────────────────────────

export async function fetchExpenses(isDemo = false): Promise<Expense[]> {
  if (!supabaseConfigured || isDemo) return demoExpenses().map((e) => ({ ...e }))

  const { data, error } = await supabase
    .from('expenses')
    .select('id,description,amount_cents,category,incurred_on,note,created_by,created_at')
    .order('incurred_on', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map(mapExpense)
}

export async function createExpense(input: ExpenseInput, isDemo = false): Promise<Expense> {
  if (!supabaseConfigured || isDemo) return createDemoExpense(input)

  const { data: userData } = await supabase.auth.getUser()
  const createdBy = userData?.user?.id ?? null

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      description: input.description,
      amount_cents: input.amountCents,
      category: input.category ?? null,
      incurred_on: input.incurredOn,
      note: input.note ?? null,
      created_by: createdBy,
    })
    .select('id,description,amount_cents,category,incurred_on,note,created_by,created_at')
    .single()
  if (error) throw new Error(error.message)
  return mapExpense(data as Row)
}

export async function updateExpense(id: string, patch: Partial<ExpenseInput>, isDemo = false): Promise<Expense> {
  if (!supabaseConfigured || isDemo) return updateDemoExpense(id, patch)

  const update: Row = {}
  if (patch.description !== undefined) update.description = patch.description
  if (patch.amountCents !== undefined) update.amount_cents = patch.amountCents
  if (patch.category !== undefined) update.category = patch.category
  if (patch.incurredOn !== undefined) update.incurred_on = patch.incurredOn
  if (patch.note !== undefined) update.note = patch.note

  const { data, error } = await supabase
    .from('expenses')
    .update(update)
    .eq('id', id)
    .select('id,description,amount_cents,category,incurred_on,note,created_by,created_at')
    .single()
  if (error) throw new Error(error.message)
  return mapExpense(data as Row)
}

export async function deleteExpense(id: string, isDemo = false): Promise<void> {
  if (!supabaseConfigured || isDemo) { deleteDemoExpense(id); return }
  const { error } = await supabase.from('expenses').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Sum expenses per calendar month (YYYY-MM), newest first. */
export function monthlyExpenseTotals(expenses: Expense[]): { month: string; cents: number }[] {
  const map = new Map<string, number>()
  for (const e of expenses) {
    const month = e.incurredOn.slice(0, 7)
    map.set(month, (map.get(month) ?? 0) + e.amountCents)
  }
  return [...map.entries()]
    .map(([month, cents]) => ({ month, cents }))
    .sort((a, b) => b.month.localeCompare(a.month))
}

// ── Demo stores (in-memory, seeded to mirror 025) ────────────────────────────

let _demoProducts: StoreProduct[] | null = null
let _demoOrders: Order[] | null = null
let _demoExpenses: Expense[] | null = null

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}
function daysAgoDate(days: number): string {
  return daysAgoISO(days).slice(0, 10)
}

function demoProducts(): StoreProduct[] {
  if (!_demoProducts) {
    _demoProducts = [
      {
        id: 'demo-prod-tee', name: 'Team Axis Tee', slug: 'team-axis-tee',
        description: 'Soft cotton training tee with the Axis mark across the chest. Runs true to size.',
        priceCents: 2500, imageUrl: null,
        variants: [
          { id: 'demo-var-tee-s',  name: 'S',  sku: 'AXIS-TEE-S',  priceCentsOverride: null, stockQty: 12 },
          { id: 'demo-var-tee-m',  name: 'M',  sku: 'AXIS-TEE-M',  priceCentsOverride: null, stockQty: 20 },
          { id: 'demo-var-tee-l',  name: 'L',  sku: 'AXIS-TEE-L',  priceCentsOverride: null, stockQty: 18 },
          { id: 'demo-var-tee-xl', name: 'XL', sku: 'AXIS-TEE-XL', priceCentsOverride: null, stockQty: 8 },
        ],
      },
      {
        id: 'demo-prod-hood', name: 'Axis Hoodie', slug: 'axis-hoodie',
        description: 'Midweight fleece hoodie for warm-ups and the drive home. Embroidered logo.',
        priceCents: 5500, imageUrl: null,
        variants: [
          { id: 'demo-var-hood-m',  name: 'M',  sku: 'AXIS-HOOD-M',  priceCentsOverride: null, stockQty: 10 },
          { id: 'demo-var-hood-l',  name: 'L',  sku: 'AXIS-HOOD-L',  priceCentsOverride: null, stockQty: 14 },
          { id: 'demo-var-hood-xl', name: 'XL', sku: 'AXIS-HOOD-XL', priceCentsOverride: null, stockQty: 3 },
        ],
      },
    ]
  }
  return _demoProducts.map((p) => ({ ...p, variants: p.variants.map((v) => ({ ...v })) }))
}

function cloneOrder(o: Order): Order {
  return { ...o, items: o.items.map((it) => ({ ...it })) }
}

function demoOrders(): Order[] {
  if (!_demoOrders) {
    _demoOrders = [
      {
        id: 'demo-order-1', orderNumber: 'AX-2608-00001', clientId: null,
        customerEmail: 'jordan@example.com', customerName: 'Jordan Blake',
        status: 'paid', subtotalCents: 5000, totalCents: 5000,
        stripeSessionId: 'cs_demo_1', stripePaymentIntent: 'pi_demo_1',
        createdAt: daysAgoISO(2), updatedAt: daysAgoISO(2),
        items: [
          { id: 'demo-oi-1', productId: 'demo-prod-tee', variantId: 'demo-var-tee-m', nameSnapshot: 'Team Axis Tee · M', unitPriceCents: 2500, qty: 2, lineTotalCents: 5000 },
        ],
      },
      {
        id: 'demo-order-2', orderNumber: 'AX-2608-00002', clientId: null,
        customerEmail: 'sam@example.com', customerName: 'Sam Rivera',
        status: 'fulfilled', subtotalCents: 8000, totalCents: 8000,
        stripeSessionId: 'cs_demo_2', stripePaymentIntent: 'pi_demo_2',
        createdAt: daysAgoISO(5), updatedAt: daysAgoISO(4),
        items: [
          { id: 'demo-oi-2', productId: 'demo-prod-hood', variantId: 'demo-var-hood-l', nameSnapshot: 'Axis Hoodie · L', unitPriceCents: 5500, qty: 1, lineTotalCents: 5500 },
          { id: 'demo-oi-3', productId: 'demo-prod-tee',  variantId: 'demo-var-tee-l', nameSnapshot: 'Team Axis Tee · L', unitPriceCents: 2500, qty: 1, lineTotalCents: 2500 },
        ],
      },
      {
        id: 'demo-order-3', orderNumber: 'AX-2608-00003', clientId: null,
        customerEmail: 'alex@example.com', customerName: 'Alex Okafor',
        status: 'pending', subtotalCents: 2500, totalCents: 2500,
        stripeSessionId: null, stripePaymentIntent: null,
        createdAt: daysAgoISO(0), updatedAt: daysAgoISO(0),
        items: [
          { id: 'demo-oi-4', productId: 'demo-prod-tee', variantId: 'demo-var-tee-s', nameSnapshot: 'Team Axis Tee · S', unitPriceCents: 2500, qty: 1, lineTotalCents: 2500 },
        ],
      },
    ]
  }
  return _demoOrders
}

function pushDemoOrder(cart: CartLine[], contact: { email: string; name: string }): Order {
  const products = demoProducts()
  const variantIndex = new Map<string, { product: StoreProduct; variant: StoreVariant }>()
  for (const p of products) for (const v of p.variants) variantIndex.set(v.id, { product: p, variant: v })

  const items: OrderItem[] = []
  let total = 0
  cart.forEach((line, i) => {
    const found = variantIndex.get(line.variantId)
    if (!found) return
    const unit = variantPriceCents(found.product, found.variant)
    const lineTotal = unit * line.qty
    total += lineTotal
    const vn = found.variant.name && found.variant.name !== 'Default' ? ` · ${found.variant.name}` : ''
    items.push({
      id: `demo-oi-new-${Date.now()}-${i}`,
      productId: found.product.id, variantId: found.variant.id,
      nameSnapshot: `${found.product.name}${vn}`,
      unitPriceCents: unit, qty: line.qty, lineTotalCents: lineTotal,
    })
  })

  const store = demoOrders()
  const seq = String(store.length + 1).padStart(5, '0')
  const order: Order = {
    id: `demo-order-new-${Date.now()}`,
    orderNumber: `AX-2608-${seq}`,
    clientId: null,
    customerEmail: contact.email, customerName: contact.name,
    status: 'pending', subtotalCents: total, totalCents: total,
    stripeSessionId: null, stripePaymentIntent: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    items,
  }
  store.unshift(order)
  return order
}

function updateDemoOrder(id: string, status: OrderStatus): void {
  const order = demoOrders().find((o) => o.id === id)
  if (order) { order.status = status; order.updatedAt = new Date().toISOString() }
}

function demoExpenses(): Expense[] {
  if (!_demoExpenses) {
    _demoExpenses = [
      { id: 'demo-exp-1', description: 'Tee restock, 50 units', amountCents: 42500, category: 'Inventory / stock', incurredOn: daysAgoDate(20), note: 'Blank cotton tees from supplier.', createdBy: null, createdAt: daysAgoISO(20) },
      { id: 'demo-exp-2', description: 'Poly mailers & tissue', amountCents: 6800, category: 'Packaging', incurredOn: daysAgoDate(12), note: null, createdBy: null, createdAt: daysAgoISO(12) },
      { id: 'demo-exp-3', description: 'Stripe fees, August', amountCents: 3120, category: 'Payment processing fees', incurredOn: daysAgoDate(3), note: null, createdBy: null, createdAt: daysAgoISO(3) },
    ]
  }
  return _demoExpenses
}

function createDemoExpense(input: ExpenseInput): Expense {
  const e: Expense = {
    id: `demo-exp-new-${Date.now()}`,
    description: input.description, amountCents: input.amountCents,
    category: input.category ?? null, incurredOn: input.incurredOn,
    note: input.note ?? null, createdBy: null, createdAt: new Date().toISOString(),
  }
  demoExpenses().unshift(e)
  return e
}

function updateDemoExpense(id: string, patch: Partial<ExpenseInput>): Expense {
  const e = demoExpenses().find((x) => x.id === id)
  if (!e) throw new Error('Expense not found')
  if (patch.description !== undefined) e.description = patch.description
  if (patch.amountCents !== undefined) e.amountCents = patch.amountCents
  if (patch.category !== undefined) e.category = patch.category ?? null
  if (patch.incurredOn !== undefined) e.incurredOn = patch.incurredOn
  if (patch.note !== undefined) e.note = patch.note ?? null
  return { ...e }
}

function deleteDemoExpense(id: string): void {
  const store = demoExpenses()
  const i = store.findIndex((x) => x.id === id)
  if (i >= 0) store.splice(i, 1)
}
