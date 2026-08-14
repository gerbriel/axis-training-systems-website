// Axis Training Systems — Stripe webhook for the merch store
// Deploy: supabase functions deploy store-webhook --no-verify-jwt
//
// verify_jwt is OFF because Stripe does not carry a Supabase JWT; the SIGNATURE
// is the authentication. The browser landing on the success_url proves nothing —
// only a signature-verified checkout.session.completed marks an order paid.
//
// Marking an order paid is all this does; the paid→stock decrement is the job of
// the 026 trigger `orders_apply_paid_stock`, which fires on the pending→paid
// edge. That is deliberate: adjust_stock() re-checks auth.uid(), which is null
// here, so it would refuse the service role. See 026's header.
//
// IDEMPOTENT. Stripe retries, so every handler checks the order is not already
// paid before touching it, and the trigger's edge guard is a second line: a
// second identical event is a no-op for both the row and the stock.

import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^17.7.0'

const MAX_BODY_BYTES = 1_048_576 // 1 MiB — Stripe events are small; cap the rest.

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function paymentIntentId(session: Stripe.Checkout.Session): string | null {
  if (!session.payment_intent) return null
  return typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent.id
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const secret    = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!stripeKey || !secret) {
    // Records-only deployments run without Stripe; a webhook that arrives anyway
    // has nothing to verify against. Say so plainly and stop.
    console.error('store-webhook: STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not set')
    return json({ error: 'not_configured' }, 503)
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) return json({ error: 'missing_signature' }, 400)

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413)

  // Signature verification needs the EXACT bytes Stripe sent — read raw text,
  // never req.json().
  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413)

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() })

  let event: Stripe.Event
  try {
    // constructEventAsync + SubtleCryptoProvider: verification is async in Deno.
    event = await stripe.webhooks.constructEventAsync(
      raw,
      signature,
      secret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    )
  } catch (err) {
    console.error('store-webhook signature', err instanceof Error ? err.name : 'unknown')
    return json({ error: 'invalid_signature' }, 400)
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  // supabase-js resolves with { error } rather than throwing; this turns a failed
  // write back into the 500 the catch promises, so Stripe retries an event whose
  // money would otherwise be recorded nowhere. The idempotency guards above each
  // write make the retry safe.
  const must = <T extends { error: unknown }>(res: T, what: string): T => {
    if (res.error) {
      const code = (res.error as { code?: string }).code ?? 'unknown'
      throw new Error(`${what}:${code}`)
    }
    return res
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.metadata?.kind !== 'store_order') break

        const orderId = session.metadata?.order_id
        if (!orderId) break

        const { data: order } = await db
          .from('orders')
          .select('id, status')
          .eq('id', orderId)
          .maybeSingle()

        // Idempotency: an already-paid (or fulfilled) order is left untouched, so
        // a retry never re-fires the stock trigger.
        if (!order || order.status === 'paid' || order.status === 'fulfilled') break

        must(
          await db
            .from('orders')
            .update({
              status: 'paid',
              stripe_payment_intent: paymentIntentId(session),
            })
            .eq('id', orderId)
            .neq('status', 'paid'),
          `mark order ${orderId} paid`,
        )
        break
      }

      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.metadata?.kind !== 'store_order') break

        const orderId = session.metadata?.order_id
        if (!orderId) break

        // Only a still-pending order is cancelled; never touch one that was paid.
        must(
          await db
            .from('orders')
            .update({ status: 'cancelled' })
            .eq('id', orderId)
            .eq('status', 'pending'),
          `cancel expired order ${orderId}`,
        )
        break
      }

      default:
        // Acknowledge everything else so Stripe stops retrying it.
        break
    }
  } catch (err) {
    // A 500 makes Stripe retry, which is what we want for a transient write
    // failure. The message carries only a token, never a body.
    console.error('store-webhook handler', err instanceof Error ? err.message : 'unknown')
    return json({ error: 'handler_failed' }, 500)
  }

  return json({ received: true }, 200)
})
