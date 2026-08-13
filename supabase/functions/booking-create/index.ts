// Axis Training Systems — Public booking creation
// Deploy: supabase functions deploy booking-create --no-verify-jwt
//
// verify_jwt is OFF: anonymous website visitors call this directly. Nothing here
// trusts the caller. The requested slot is re-derived from the coach's schedule in
// the COACH's timezone and re-checked against blocks, bookings and cached Google
// busy intervals. The browser's start time is only ever *matched*, never believed.
//
// What the request may say:  which coach, which service, which instant, who they are.
// What it may NOT say:       how long the call is, what it costs, or what status it
//                            lands in. All three are read from the database here.
//
// The DB exclusion constraint on bookings — `bookings_no_overlap`, migration 008 —
// is the last line of defence: two clients that pass validation on the same instant
// race into the insert and exactly one wins; the loser gets 23P01 -> 409 slot_taken.
// (This comment used to describe a constraint that did not exist. It does now.)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { mirrorUpsert } from '../_shared/mirror.ts'
import {
  hashedSubject,
  loadAvailability,
  loadCoachPolicy,
  priceService,
  rateLimitOk,
  requestSubject,
  type PricedService,
} from '../_shared/booking.ts'
import { isSlotOffered } from '../_shared/slots.ts'
import { dateKeyInTimeZone } from '../_shared/tz.ts'

const MAX_BODY_BYTES = 8_192
const MS_PER_MINUTE  = 60_000

/**
 * Slack on top of the coach's own `min_lead_minutes`. The browser refuses to
 * OFFER a slot inside the coach's notice period; this absorbs the seconds
 * between the page being drawn and Confirm being pressed, so a client who
 * clicks the last legal slot at the last legal moment is not told no.
 *
 * The two numbers used to be unrelated constants in two files — 120 in the
 * browser, 90 in this function — and the 30 minutes between them was a slot the
 * page never showed and this endpoint would have taken.
 */
const LEAD_GRACE_MINUTES = 5

/** Hard ceiling regardless of the coach's horizon: a sanity bound, not a policy. */
const ABSOLUTE_MAX_ADVANCE_DAYS = 400

/**
 * Per-address budget. Deliberately small: a booking is a row on a real calendar
 * that fires a real calendar invite and a real email, and nobody legitimately
 * books five calls in an hour.
 */
const RATE_WINDOW_SECONDS = 3_600
const RATE_LIMIT_PER_IP   = 5
/** Per-address-of-the-CLIENT, over a day. Catches a spammer who rotates IPs. */
const EMAIL_WINDOW_SECONDS = 86_400
const EMAIL_LIMIT_PER_DAY  = 6

interface BookingRequest {
  coach_slug: string
  service_id: string | null
  booked_at: string
  first_name: string
  last_name: string
  email: string
  phone?: string | null
  goals?: string | null
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function fail(error: string, status: number, cors: Record<string, string>): Response {
  return json({ ok: false, error }, status, cors)
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (trimmed.length === 0 || trimmed.length > max) return null
  return trimmed
}

function optionalStr(v: unknown, max: number): string | null {
  if (v === undefined || v === null || v === '') return null
  return str(v, max)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseRequest(raw: unknown): BookingRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const b = raw as Record<string, unknown>

  const coach_slug = str(b.coach_slug, 64)
  const booked_at  = str(b.booked_at, 40)
  const first_name = str(b.first_name, 80)
  const last_name  = str(b.last_name, 80)
  const email      = str(b.email, 254)
  if (!coach_slug || !booked_at || !first_name || !last_name || !email) return null
  if (!EMAIL_RE.test(email)) return null
  if (!/^[a-z0-9-]+$/.test(coach_slug)) return null

  // Optional: a coach with no catalog rows still takes bookings. Present but
  // malformed is a rejection, though — that is a bug in the caller, not a
  // coach without a menu.
  let service_id: string | null = null
  if (b.service_id !== undefined && b.service_id !== null && b.service_id !== '') {
    if (typeof b.service_id !== 'string' || !UUID_RE.test(b.service_id)) return null
    service_id = b.service_id
  }

  const phone = optionalStr(b.phone, 40)
  const goals = optionalStr(b.goals, 2_000)
  if (b.phone && phone === null) return null
  if (b.goals && goals === null) return null

  return {
    coach_slug,
    service_id,
    booked_at,
    first_name,
    last_name,
    email: email.toLowerCase(),
    phone,
    goals,
  }
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method_not_allowed', 405, cors)

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return fail('payload_too_large', 413, cors)

  let payload: BookingRequest | null
  try {
    const body = await req.text()
    if (body.length > MAX_BODY_BYTES) return fail('payload_too_large', 413, cors)
    payload = parseRequest(JSON.parse(body))
  } catch {
    return fail('invalid_payload', 400, cors)
  }
  if (!payload) return fail('invalid_payload', 400, cors)

  const requestedStart = new Date(payload.booked_at)
  if (Number.isNaN(requestedStart.getTime())) return fail('invalid_payload', 400, cors)
  if (requestedStart.getTime() % MS_PER_MINUTE !== 0) return fail('invalid_payload', 400, cors)

  const nowMs = Date.now()
  const now   = new Date(nowMs)

  if (requestedStart.getTime() > nowMs + ABSOLUTE_MAX_ADVANCE_DAYS * 86_400_000) {
    return fail('too_far', 400, cors)
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  // ── Rate limit ────────────────────────────────────────────────────────────
  // Two budgets, both fail-closed. The address one is checked first because it
  // is free — no second lookup — and it is the one a loop trips instantly.
  //
  // The client's email is HASHED before it becomes a subject. It used to go in
  // as plaintext, which quietly turned `rate_limit_hit` into a list of everybody
  // who had tried to book — a table that exists to count, holding contact
  // details it has no use for. The digest counts identically.
  const subject = await requestSubject(req)
  if (!(await rateLimitOk(db, 'booking-create-ip', subject, RATE_WINDOW_SECONDS, RATE_LIMIT_PER_IP))) {
    return fail('rate_limited', 429, cors)
  }
  const emailSubject = await hashedSubject(payload.email)
  if (!(await rateLimitOk(db, 'booking-create-email', emailSubject, EMAIL_WINDOW_SECONDS, EMAIL_LIMIT_PER_DAY))) {
    return fail('rate_limited', 429, cors)
  }

  const policy = await loadCoachPolicy(db, payload.coach_slug)
  if (!policy) return fail('unknown_coach', 404, cors)

  // ── What is being booked ──────────────────────────────────────────────────
  // The duration comes from here and from nowhere else. The request was never
  // asked how long the call is and is not consulted about it.
  const priced = await priceService(db, payload.coach_slug, payload.service_id)
  if (!priced.ok) {
    return fail(priced.error, priced.error === 'server_error' ? 500 : 404, cors)
  }
  const service: PricedService | null = priced.service

  const leadMs = Math.max(0, policy.minLeadMinutes - LEAD_GRACE_MINUTES) * MS_PER_MINUTE
  if (requestedStart.getTime() < nowMs + leadMs) return fail('too_soon', 409, cors)
  if (requestedStart.getTime() > nowMs + policy.maxAdvanceDays * 86_400_000) {
    return fail('too_far', 400, cors)
  }

  const dateKey = dateKeyInTimeZone(requestedStart, policy.timeZone)

  const input = await loadAvailability({
    db,
    coachSlug:       payload.coach_slug,
    policy,
    durationMinutes: service?.durationMinutes ?? null,
    fromDateKey:     dateKey,
    days:            1,
    now,
  })

  // A read failure is NOT an open calendar. Refusing here costs one retry;
  // guessing costs a double booking.
  if (input === 'unavailable') return fail('server_error', 500, cors)

  // The authoritative check: an exact instant match against regenerated
  // availability. Not a range test on bounds the caller supplied.
  const matched = isSlotOffered(input, requestedStart.getTime(), dateKey)
  if (!matched) return fail('slot_unavailable', 409, cors)

  const durationMinutes = matched.durationMinutes

  const { data: booking, error: insertError } = await db
    .from('bookings')
    .insert({
      coach_slug:          payload.coach_slug,
      booked_at:           new Date(matched.start).toISOString(),
      duration_minutes:    durationMinutes,
      first_name:          payload.first_name,
      last_name:           payload.last_name,
      email:               payload.email,
      phone:               payload.phone,
      // Snapshots. Renaming or repricing the service later must not rewrite
      // what this person booked (009).
      service_id:          service?.id ?? null,
      service_name:        service?.name ?? null,
      service_price_cents: service?.priceCents ?? null,
      // Kept for continuity with every booking taken before there was a catalog:
      // it is the column the coach's screens have always read.
      service_interest:    service?.name ?? null,
      goals:               payload.goals,
      status:              policy.autoConfirm ? 'confirmed' : 'pending',
      google_sync_status:  'pending',
    })
    .select('id,manage_token,status')
    .single()

  if (insertError) {
    // 23P01 = exclusion_violation: another client won the same instant. This is
    // the branch migration 008 finally made reachable.
    if (insertError.code === '23P01') return fail('slot_taken', 409, cors)
    console.error('booking-create insert', insertError.code)
    return fail('server_error', 500, cors)
  }

  // ── Google export (best-effort, synchronous fast-path) ────────────────────
  //
  // Past this point the booking EXISTS and is authoritative. A Google failure
  // never fails it (invariant 4): the row stays at google_sync_status='pending'
  // and the outbox (007: bookings_mirror_to_busy enqueues a 'create' op) retries.
  // This is a head start, not the delivery path. A coach with no connection is
  // 'skipped', a supported state and not an error.
  //
  // The credential never comes near the client: mirrorUpsert loads the
  // connection through the service_role-only calendar_connection_get RPC and
  // decrypts the refresh token with a key that lives in Function Secrets.
  let calendarSynced = false
  let meetLink: string | null = null

  const sync = await mirrorUpsert(
    db,
    payload.coach_slug,
    { eventId: null, calendarId: null },
    {
      summary:     `${service?.name ?? 'Axis Consultation'} — ${payload.first_name} ${payload.last_name}`,
      description: [
        service ? `Service: ${service.name} (${service.durationMinutes} min)` : null,
        payload.goals ? `Goals: ${payload.goals}` : null,
        payload.phone ? `Phone: ${payload.phone}` : null,
        `Booking ID: ${booking.id}`,
      ].filter(Boolean).join('\n'),
      start:         new Date(matched.start),
      end:           new Date(matched.start + durationMinutes * MS_PER_MINUTE),
      timeZone:      policy.timeZone,
      attendeeEmail: payload.email,
      attendeeName:  `${payload.first_name} ${payload.last_name}`,
    }
  )

  if (sync.status === 'synced') {
    calendarSynced = true
    meetLink = sync.meetLink
    const { error } = await db.from('bookings').update({
      google_event_id:    sync.eventId,
      google_calendar_id: sync.calendarId,
      google_meet_url:    sync.meetLink,
      google_synced_at:   new Date().toISOString(),
      google_sync_status: 'synced',
    }).eq('id', booking.id)
    if (error) console.error('booking-create sync_persist', error.code)
  } else if (sync.status === 'skipped') {
    const { error } = await db.from('bookings')
      .update({ google_sync_status: 'skipped' })
      .eq('id', booking.id)
    if (error) console.error('booking-create sync_persist', error.code)
  } else {
    // Left at 'pending' for the outbox to retry.
    console.error('booking-create google_sync', sync.code)
  }

  return json(
    {
      ok:              true,
      booking_id:      booking.id,
      // The client's only way back to this booking — there are no accounts. It
      // goes in the confirmation email and on the confirmation screen, and it
      // is the last time it leaves the database.
      manage_token:    booking.manage_token,
      status:          booking.status,
      duration_minutes: durationMinutes,
      service_name:    service?.name ?? null,
      price_cents:     service?.priceCents ?? null,
      calendar_synced: calendarSynced,
      meet_link:       meetLink,
    },
    201,
    cors
  )
})
