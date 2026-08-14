// Axis Training Systems — Public merch checkout
// Deploy: supabase functions deploy store-checkout --no-verify-jwt
//
// verify_jwt is OFF: anonymous storefront visitors call this directly. Nothing
// here trusts the caller. The cart names WHICH variant and HOW MANY, never what
// it costs — every price is re-read from products/product_variants (025) at
// request time. A client that sends a price is ignored; a client that sends a
// quantity for a variant that does not exist, is retired, or is out of stock is
// refused with an opaque code.
//
// The order is written as `pending` here (service role — 026 gives no one else
// an insert). Then:
//   * STRIPE_SECRET_KEY set  → a Checkout Session is created and its url
//     returned; the money becomes authoritative only when store-webhook sees
//     checkout.session.completed.
//   * STRIPE_SECRET_KEY unset → records-only: the pending order id is returned
//     with { records_only: true } so an admin can mark it paid by hand.
//
// Errors are OPAQUE: a short machine token, never a stringified exception.

import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^17.7.0'
import { preflight, json, jsonError } from '../_shared/cors.ts'
import { hashedSubject, rateLimitOk, requestSubject } from '../_shared/ratelimit.ts'

const MAX_BODY_BYTES = 8_192
const MAX_ITEMS      = 50
const MAX_QTY        = 99

// Per-address, per-hour. A checkout writes a real order; nobody legitimately
// starts twenty in an hour. Per-email over a day catches an IP-rotator.
const IP_WINDOW_SECONDS    = 3_600
const IP_LIMIT             = 15
const EMAIL_WINDOW_SECONDS = 86_400
const EMAIL_LIMIT          = 30

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

interface CheckoutItem { variant_id: string; qty: number }
interface CheckoutRequest { items: CheckoutItem[]; email: string; name: string }

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t.length === 0 || t.length > max) return null
  return t
}

function parseRequest(raw: unknown): CheckoutRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const b = raw as Record<string, unknown>

  const email = str(b.email, 254)
  const name  = str(b.name, 120)
  if (!email || !name || !EMAIL_RE.test(email)) return null

  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > MAX_ITEMS) return null

  const items: CheckoutItem[] = []
  for (const raw of b.items) {
    if (typeof raw !== 'object' || raw === null) return null
    const r = raw as Record<string, unknown>
    const variant_id = str(r.variant_id, 64)
    const qty = typeof r.qty === 'number' ? r.qty : NaN
    if (!variant_id || !UUID_RE.test(variant_id)) return null
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return null
    items.push({ variant_id, qty })
  }

  return { items, email: email.toLowerCase(), name }
}

/** The public site origin to send Stripe back to. Prefer an explicit env var;
 *  fall back to the request Origin (already CORS-allowlisted) then the domain. */
function siteBase(req: Request): string {
  const configured = Deno.env.get('STORE_PUBLIC_URL') ?? Deno.env.get('SITE_URL')
  if (configured) return configured.replace(/\/$/, '')
  const origin = req.headers.get('origin')
  if (origin) return origin.replace(/\/$/, '')
  return 'https://axistrainingsystems.com'
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonError(req, 'method_not_allowed', 405)

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return jsonError(req, 'payload_too_large', 413)

  let payload: CheckoutRequest | null
  try {
    const body = await req.text()
    if (body.length > MAX_BODY_BYTES) return jsonError(req, 'payload_too_large', 413)
    payload = parseRequest(JSON.parse(body))
  } catch {
    return jsonError(req, 'invalid_payload', 400)
  }
  if (!payload) return jsonError(req, 'invalid_payload', 400)

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  // ── Rate limit (fail-closed) ──────────────────────────────────────────────
  const subject = await requestSubject(req)
  if (!(await rateLimitOk(db, 'store-checkout-ip', subject, IP_WINDOW_SECONDS, IP_LIMIT))) {
    return jsonError(req, 'rate_limited', 429)
  }
  const emailSubject = await hashedSubject(payload.email)
  if (!(await rateLimitOk(db, 'store-checkout-email', emailSubject, EMAIL_WINDOW_SECONDS, EMAIL_LIMIT))) {
    return jsonError(req, 'rate_limited', 429)
  }

  // ── Attach the account, if the caller happens to be signed in ─────────────
  // verify_jwt is off, so this is best-effort: a valid user JWT in the header
  // resolves a client_id; anything else (the anon key, no header) leaves it
  // null. Read from the verified token, never from the body.
  let clientId: string | null = null
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
  if (token && token !== (Deno.env.get('SUPABASE_ANON_KEY') ?? '')) {
    const { data: userData } = await db.auth.getUser(token)
    clientId = userData?.user?.id ?? null
  }

  // ── Aggregate duplicate lines, then re-price against the live catalog ─────
  const wanted = new Map<string, number>()
  for (const it of payload.items) {
    wanted.set(it.variant_id, (wanted.get(it.variant_id) ?? 0) + it.qty)
  }
  const variantIds = [...wanted.keys()]

  const { data: variants, error: variantsError } = await db
    .from('product_variants')
    .select('id, product_id, name, price_cents_override, stock_qty')
    .in('id', variantIds)
  if (variantsError) return jsonError(req, 'server_error', 500)
  if (!variants || variants.length !== variantIds.length) return jsonError(req, 'unavailable', 409)

  const productIds = [...new Set(variants.map((v) => v.product_id as string))]
  const { data: products, error: productsError } = await db
    .from('products')
    .select('id, name, price_cents, is_active')
    .in('id', productIds)
  if (productsError) return jsonError(req, 'server_error', 500)

  const productById = new Map((products ?? []).map((p) => [p.id as string, p]))

  interface Line { product_id: string; variant_id: string; name_snapshot: string; unit_price_cents: number; qty: number }
  const lines: Line[] = []
  let total = 0

  for (const v of variants) {
    const qty = wanted.get(v.id as string)!
    const product = productById.get(v.product_id as string)
    if (!product || product.is_active !== true) return jsonError(req, 'unavailable', 409)

    // `??` not `||`: a price override of 0 (a giveaway) is a real value.
    const override = v.price_cents_override as number | null
    const unit = override ?? (product.price_cents as number)
    if (typeof unit !== 'number' || unit < 0) return jsonError(req, 'unavailable', 409)

    if ((v.stock_qty as number) < qty) return jsonError(req, 'insufficient_stock', 409)

    const variantName = (v.name as string | null) ?? null
    const label = variantName && variantName !== 'Default'
      ? `${product.name} · ${variantName}`
      : (product.name as string)

    lines.push({
      product_id:       v.product_id as string,
      variant_id:       v.id as string,
      name_snapshot:    label,
      unit_price_cents: unit,
      qty,
    })
    total += unit * qty
  }

  if (lines.length === 0 || total <= 0) return jsonError(req, 'invalid_payload', 400)

  // ── Create the pending order + its items ──────────────────────────────────
  const { data: order, error: orderError } = await db
    .from('orders')
    .insert({
      client_id:      clientId,
      customer_email: payload.email,
      customer_name:  payload.name,
      status:         'pending',
      subtotal_cents: total,
      total_cents:    total,
    })
    .select('id, order_number')
    .single()

  if (orderError || !order) {
    console.error('store-checkout order_insert', (orderError as { code?: string } | null)?.code ?? 'unknown')
    return jsonError(req, 'checkout_failed', 500)
  }

  const { error: itemsError } = await db.from('order_items').insert(
    lines.map((l) => ({
      order_id:         order.id,
      product_id:       l.product_id,
      variant_id:       l.variant_id,
      name_snapshot:    l.name_snapshot,
      unit_price_cents: l.unit_price_cents,
      qty:              l.qty,
    })),
  )
  if (itemsError) {
    // Roll back the orphan order so a failed checkout leaves no empty pending row.
    await db.from('orders').delete().eq('id', order.id)
    console.error('store-checkout items_insert', (itemsError as { code?: string }).code ?? 'unknown')
    return jsonError(req, 'checkout_failed', 500)
  }

  // ── Stripe, or records-only ───────────────────────────────────────────────
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) {
    // No Stripe configured: the sale exists as a pending record for an admin to
    // confirm by hand. This is a supported mode, not an error.
    return json(req, { order_id: order.id, order_number: order.order_number, records_only: true })
  }

  try {
    const stripe = new Stripe(stripeKey, {
      httpClient: Stripe.createFetchHttpClient(),
    })

    const base = siteBase(req)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: payload.email,
      line_items: lines.map((l) => ({
        quantity: l.qty,
        price_data: {
          currency: 'usd',
          unit_amount: l.unit_price_cents,
          product_data: { name: l.name_snapshot },
        },
      })),
      success_url: `${base}/shop?status=success&order=${order.id}`,
      cancel_url:  `${base}/shop?status=cancelled&order=${order.id}`,
      // The order id is how the webhook finds the row to mark paid.
      metadata: { kind: 'store_order', order_id: order.id as string },
    })

    await db.from('orders').update({ stripe_session_id: session.id }).eq('id', order.id)

    return json(req, { url: session.url, order_id: order.id })
  } catch (err) {
    // The Stripe call failed (bad key, network). The pending order stays for an
    // admin to see; the client gets an opaque failure, not the Stripe message.
    console.error('store-checkout stripe', err instanceof Error ? err.name : 'unknown')
    return jsonError(req, 'checkout_failed', 502)
  }
})
