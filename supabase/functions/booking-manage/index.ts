// Axis Training Systems — the client's side of their own booking
// Deploy: supabase functions deploy booking-manage --no-verify-jwt
//
// verify_jwt is OFF. Axis has no client accounts, so the credential is the
// `manage_token` from the confirmation email (010): one unguessable uuid,
// scoped to exactly one booking, and never readable on any other path —
// `bookings` is revoked from anon in full (005) and this function holds the
// only key that turns a token into a row.
//
// Three actions, and the two that write are re-derived here exactly as a new
// booking is. A reschedule is a booking: the requested instant is matched
// against regenerated availability in the coach's zone, and `bookings_no_overlap`
// (008) settles the race with whoever else is reaching for that time. A client
// moving their own call cannot land it outside the coach's hours, on top of a
// block, or in the middle of somebody else's session.
//
// What a token holder may NOT do: change who the coach is, what the service is,
// how long it runs, or its status to anything other than cancelled.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { json, jsonError, preflight } from '../_shared/cors.ts'
import {
  loadAvailability,
  loadCoachPolicy,
  rateLimitOk,
  requestSubject,
} from '../_shared/booking.ts'
import { generateSlots, isSlotOffered } from '../_shared/slots.ts'
import { mirrorCancel, mirrorReschedule } from '../_shared/mirror.ts'
import { dateKeyInTimeZone } from '../_shared/tz.ts'

const MAX_BODY_BYTES = 4_096
const MS_PER_MINUTE  = 60_000

/**
 * How close to the call a client may still change it themselves. Inside this,
 * the page tells them to phone their coach instead — a booking dropped twenty
 * minutes beforehand by someone who has already set off is a conversation, not
 * a form submission.
 */
const SELF_SERVICE_CUTOFF_MINUTES = 120

/** Past this, moving it again is a conversation with the coach. */
const MAX_RESCHEDULES = 3

/** Days of availability returned alongside a booking, for the reschedule picker. */
const RESCHEDULE_WINDOW_DAYS = 28

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface BookingRow {
  id: string
  coach_slug: string
  booked_at: string
  duration_minutes: number
  first_name: string
  last_name: string
  email: string
  status: 'pending' | 'confirmed' | 'cancelled'
  service_id: string | null
  service_name: string | null
  service_price_cents: number | null
  goals: string | null
  google_event_id: string | null
  google_calendar_id: string | null
  google_meet_url: string | null
  reschedule_count: number
  cancelled_at: string | null
  cancellation_reason: string | null
}

const SELECT = [
  'id', 'coach_slug', 'booked_at', 'duration_minutes', 'first_name', 'last_name',
  'email', 'status', 'service_id', 'service_name', 'service_price_cents', 'goals',
  'google_event_id', 'google_calendar_id', 'google_meet_url', 'reschedule_count',
  'cancelled_at', 'cancellation_reason',
].join(',')

/**
 * What the token holder is allowed to see. Notably NOT: coach notes, the token
 * itself, the Google event id, or the sync bookkeeping. A client's own booking
 * is not the same surface as the row.
 */
function publicView(b: BookingRow, timeZone: string, now: number) {
  const startMs   = new Date(b.booked_at).getTime()
  const cutoffMs  = startMs - SELF_SERVICE_CUTOFF_MINUTES * MS_PER_MINUTE
  const isPast    = startMs + b.duration_minutes * MS_PER_MINUTE < now
  const isLive    = b.status !== 'cancelled' && !isPast

  return {
    id:               b.id,
    coach_slug:       b.coach_slug,
    booked_at:        b.booked_at,
    duration_minutes: b.duration_minutes,
    first_name:       b.first_name,
    last_name:        b.last_name,
    email:            b.email,
    status:           b.status,
    service_name:     b.service_name,
    price_cents:      b.service_price_cents,
    goals:            b.goals,
    meet_link:        b.google_meet_url,
    time_zone:        timeZone,
    is_past:          isPast,
    cancelled_at:     b.cancelled_at,
    cancellation_reason: b.cancellation_reason,
    reschedules_left: Math.max(0, MAX_RESCHEDULES - b.reschedule_count),
    // Computed here rather than in the browser: the page renders what the
    // server will actually allow, so a disabled button and a 409 can never
    // disagree about the same booking.
    can_cancel:       isLive && now < cutoffMs,
    can_reschedule:   isLive && now < cutoffMs && b.reschedule_count < MAX_RESCHEDULES,
    cutoff_minutes:   SELF_SERVICE_CUTOFF_MINUTES,
  }
}

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

  const token  = typeof body.token === 'string' ? body.token : ''
  const action = typeof body.action === 'string' ? body.action : 'get'
  if (!UUID_RE.test(token)) return jsonError(req, 'invalid_request', 400)
  if (!['get', 'cancel', 'reschedule'].includes(action)) return jsonError(req, 'invalid_request', 400)

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  // Budgeted per address, and fails closed on a write. A token is unguessable,
  // but a limiter is what makes "unguessable" mean something against a machine
  // that is willing to try.
  const subject = await requestSubject(req)
  const ok = action === 'get'
    ? await rateLimitOk(db, 'booking-manage-read', subject, 60, 30, true)
    : await rateLimitOk(db, 'booking-manage-write', subject, 3_600, 10)
  if (!ok) return jsonError(req, 'rate_limited', 429)

  const { data, error } = await db
    .from('bookings')
    .select(SELECT)
    .eq('manage_token', token)
    .maybeSingle()

  if (error) {
    console.error('booking-manage read', error.code)
    return jsonError(req, 'server_error', 500)
  }
  // Same response for a token that never existed and one whose booking was
  // deleted. There is nothing to learn from the difference.
  if (!data) return jsonError(req, 'not_found', 404)

  const booking = data as unknown as BookingRow

  const policy = await loadCoachPolicy(db, booking.coach_slug)
  if (!policy) {
    console.error('booking-manage unknown_coach', booking.coach_slug)
    return jsonError(req, 'server_error', 500)
  }

  const now   = Date.now()
  const view  = publicView(booking, policy.timeZone, now)

  // ── get ───────────────────────────────────────────────────────────────────
  if (action === 'get') {
    // The reschedule picker's times come back on the same round trip, but only
    // when a reschedule is actually on offer. Generating a calendar for a
    // booking that cannot move is work nobody asked for.
    let days: { date: string; slots: { start: string; duration: number }[] }[] | null = null

    if (view.can_reschedule) {
      const fromDateKey = dateKeyInTimeZone(new Date(now), policy.timeZone)
      const input = await loadAvailability({
        db,
        coachSlug:       booking.coach_slug,
        policy,
        durationMinutes: booking.duration_minutes,
        fromDateKey,
        days:            RESCHEDULE_WINDOW_DAYS,
        now:             new Date(now),
      })

      // null is the outage signal and the page renders it as one. An empty
      // array would say "your coach has nothing free for a month", which is a
      // different and possibly untrue thing.
      days = input === 'unavailable' ? null : generateSlots(input, fromDateKey, RESCHEDULE_WINDOW_DAYS)
        .map(d => ({
          date:  d.dateKey,
          slots: d.slots.map(s => ({ start: new Date(s.start).toISOString(), duration: s.durationMinutes })),
        }))
    }

    return json(req, { ok: true, booking: view, availability: days })
  }

  // ── Both writes need a live booking ───────────────────────────────────────
  if (booking.status === 'cancelled') return jsonError(req, 'already_cancelled', 409)
  if (view.is_past) return jsonError(req, 'already_past', 409)
  if (now >= new Date(booking.booked_at).getTime() - SELF_SERVICE_CUTOFF_MINUTES * MS_PER_MINUTE) {
    return jsonError(req, 'too_late', 409)
  }

  // ── cancel ────────────────────────────────────────────────────────────────
  if (action === 'cancel') {
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null

    const { error: updateError } = await db
      .from('bookings')
      .update({
        status:              'cancelled',
        cancelled_by:        'client',
        cancellation_reason: reason || null,
      })
      .eq('id', booking.id)
      // Not a bare id match: a coach confirming or a second tab cancelling
      // between our read and this write would otherwise be silently overwritten.
      .neq('status', 'cancelled')

    if (updateError) {
      console.error('booking-manage cancel', updateError.code)
      return jsonError(req, 'server_error', 500)
    }

    // The row is committed and the slot is already free — the mirror trigger
    // (007) removed the busy entry in the same transaction. Google is tidied up
    // afterwards and its failure changes nothing about the cancellation.
    const mirror = await mirrorCancel(
      db, booking.coach_slug, booking.google_event_id, booking.google_calendar_id
    )
    if (mirror.status === 'failed') console.error('booking-manage mirror', mirror.code)

    return json(req, { ok: true, status: 'cancelled' })
  }

  // ── reschedule ────────────────────────────────────────────────────────────
  if (booking.reschedule_count >= MAX_RESCHEDULES) return jsonError(req, 'reschedule_limit', 409)

  const startsAt = typeof body.starts_at === 'string' ? new Date(body.starts_at) : null
  if (!startsAt || Number.isNaN(startsAt.getTime())) return jsonError(req, 'invalid_request', 400)
  if (startsAt.getTime() % MS_PER_MINUTE !== 0) return jsonError(req, 'invalid_request', 400)
  if (startsAt.getTime() === new Date(booking.booked_at).getTime()) {
    return jsonError(req, 'same_time', 400)
  }

  if (startsAt.getTime() < now + policy.minLeadMinutes * MS_PER_MINUTE) return jsonError(req, 'too_soon', 409)
  if (startsAt.getTime() > now + policy.maxAdvanceDays * 86_400_000) return jsonError(req, 'too_far', 400)

  const dateKey = dateKeyInTimeZone(startsAt, policy.timeZone)
  const input = await loadAvailability({
    db,
    coachSlug:       booking.coach_slug,
    policy,
    // The length is the BOOKING's, not the request's. A client moving a call
    // does not get to change what they booked.
    durationMinutes: booking.duration_minutes,
    fromDateKey:     dateKey,
    days:            1,
    now:             new Date(now),
  })

  if (input === 'unavailable') return jsonError(req, 'server_error', 500)

  // The booking's own current slot is in `busy` — it is on the calendar. Moving
  // it inside its own hour would otherwise be refused as a clash with itself,
  // so its interval is dropped before the target is tested.
  const selfStart = new Date(booking.booked_at).getTime()
  const selfEnd   = selfStart + booking.duration_minutes * MS_PER_MINUTE
  input.busy = input.busy.filter(b => !(b.start === selfStart && b.end === selfEnd))

  const matched = isSlotOffered(input, startsAt.getTime(), dateKey)
  if (!matched) return jsonError(req, 'slot_unavailable', 409)

  const patch: Record<string, unknown> = {
    booked_at:        new Date(matched.start).toISOString(),
    reschedule_count: booking.reschedule_count + 1,
  }
  // The ORIGINAL instant, not the previous one: after two moves what a coach
  // wants to know is where this started, and the intermediate hop is noise. Set
  // on the first move only, and written as an absent key rather than an
  // `undefined` value — PostgREST would send that as a null and blank it.
  if (booking.reschedule_count === 0) patch.rescheduled_from = booking.booked_at

  const { error: moveError } = await db
    .from('bookings')
    .update(patch)
    .eq('id', booking.id)
    .eq('booked_at', booking.booked_at)
    .neq('status', 'cancelled')

  if (moveError) {
    // 23P01 = exclusion_violation (008): somebody took that instant between the
    // availability check and this write.
    if (moveError.code === '23P01') return jsonError(req, 'slot_taken', 409)
    console.error('booking-manage reschedule', moveError.code)
    return jsonError(req, 'server_error', 500)
  }

  const mirror = await mirrorReschedule(
    db, booking.coach_slug, booking.google_event_id, booking.google_calendar_id,
    {
      start:    new Date(matched.start),
      end:      new Date(matched.start + booking.duration_minutes * MS_PER_MINUTE),
      timeZone: policy.timeZone,
    }
  )
  if (mirror.status === 'failed') console.error('booking-manage mirror', mirror.code)

  return json(req, {
    ok:        true,
    status:    'rescheduled',
    booked_at: new Date(matched.start).toISOString(),
  })
})
