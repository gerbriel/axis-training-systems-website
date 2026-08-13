// Axis Training Systems — public availability
// Deploy: supabase functions deploy booking-availability --no-verify-jwt
//
// verify_jwt is OFF: anonymous visitors call this directly.
//
// WHY THIS EXISTS. The booking page used to compute slots in the browser. To do
// that it had to download, over the anon key, the coach's entire weekly
// schedule, their date blocks, and ten weeks of `coach_calendar_busy` — which
// is every instant they are busy, whether that is a client or a dentist. Anyone
// who opened devtools on /book got a coach's calendar shape for the quarter.
// Reading it did not even require visiting the page: the anon key ships in the
// Vite bundle.
//
// So the computation moved here. What leaves the building now is a list of
// times that are open. Not what fills the rest of the week, and not why.
//
// It also removes the last way the browser's arithmetic could differ from the
// server's: `booking-create` re-derives the slot through the same module this
// endpoint uses, so what is offered is exactly what will be accepted.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { json, jsonError, preflight } from '../_shared/cors.ts'
import { loadAvailability, loadCoachPolicy, priceService, rateLimitOk, requestSubject } from '../_shared/booking.ts'
import { generateSlots } from '../_shared/slots.ts'
import { dateKeyInTimeZone } from '../_shared/tz.ts'

const MAX_BODY_BYTES = 2_048
const MAX_DAYS       = 42
const DEFAULT_DAYS   = 28

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG_RE = /^[a-z0-9-]{1,64}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonError(req, 'method_not_allowed', 405)

  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) return jsonError(req, 'payload_too_large', 413)
    body = JSON.parse(raw)
  } catch {
    return jsonError(req, 'invalid_request', 400)
  }

  const coachSlug = typeof body.coach_slug === 'string' ? body.coach_slug : ''
  if (!SLUG_RE.test(coachSlug)) return jsonError(req, 'invalid_request', 400)

  const serviceId = typeof body.service_id === 'string' && body.service_id ? body.service_id : null
  if (serviceId && !UUID_RE.test(serviceId)) return jsonError(req, 'invalid_request', 400)

  const from = typeof body.from === 'string' && body.from ? body.from : null
  if (from && !DATE_RE.test(from)) return jsonError(req, 'invalid_request', 400)

  const days = Math.min(MAX_DAYS, Math.max(1, Number(body.days) || DEFAULT_DAYS))

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  // Generous, and fails OPEN. Stepping through a calendar week by week is the
  // normal way to use this page; the limit is here to stop a scraper walking a
  // year of every coach's availability, not to ration browsing.
  const subject = await requestSubject(req)
  if (!(await rateLimitOk(db, 'availability', subject, 60, 60, true))) {
    return jsonError(req, 'rate_limited', 429)
  }

  const policy = await loadCoachPolicy(db, coachSlug)
  if (!policy) return jsonError(req, 'unknown_coach', 404)

  const priced = await priceService(db, coachSlug, serviceId)
  if (!priced.ok) {
    return jsonError(req, priced.error, priced.error === 'server_error' ? 500 : 404)
  }

  const now = new Date()
  // "Today" is the COACH's today. Taking it from the caller's clock hides a day
  // the coach still has open whenever the two are across a date boundary.
  const fromDateKey = from ?? dateKeyInTimeZone(now, policy.timeZone)

  const input = await loadAvailability({
    db,
    coachSlug,
    policy,
    durationMinutes: priced.service?.durationMinutes ?? null,
    fromDateKey,
    days,
    now,
  })

  // 503, never an empty week. "Nothing is open" and "we could not find out" are
  // different facts and the page says something different for each.
  if (input === 'unavailable') return jsonError(req, 'availability_unavailable', 503)

  const slots = generateSlots(input, fromDateKey, days)

  return json(req, {
    ok:               true,
    time_zone:        policy.timeZone,
    from:             fromDateKey,
    days:             slots.map(d => ({
      date:  d.dateKey,
      slots: d.slots.map(s => ({
        start:    new Date(s.start).toISOString(),
        duration: s.durationMinutes,
      })),
    })),
    duration_minutes: priced.service?.durationMinutes ?? null,
    price_cents:      priced.service?.priceCents ?? null,
    min_lead_minutes: policy.minLeadMinutes,
    max_advance_days: policy.maxAdvanceDays,
  }, 200)
})
