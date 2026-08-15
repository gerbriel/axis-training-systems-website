// Axis Training Systems — Coach/admin booking mutation + Google mirror
// Deploy: supabase functions deploy booking-update
//
// verify_jwt is ON. The caller's identity comes from the verified JWT and nothing
// else: `coach_slug` is never read from the request body. A coach (an email present
// in coach_routing) may only touch their own bookings; an admin (an email flagged
// is_admin in coach_routing, matching is_content_admin() in 005) may touch any.
// Admin is a POSITIVE allowlist — an email absent from coach_routing, or a coach
// whose coach_slug failed to backfill, is NOT an admin and NOT authorized. The
// verified email is matched against coach_routing EXACTLY (case-folded), never
// with `ilike`, whose wildcards are ordinary characters in an email address.
//
// Budgeted per verified caller, failing closed: this endpoint writes to a real
// calendar and mails real people, so a stolen coach session is not a loop.
//
// The DB row is authoritative and is written first. Google is mirrored after; a
// Google failure leaves google_sync_status = 'pending' for the reconcile worker and
// never fails the mutation.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { mirrorCancel, mirrorUpsert } from '../_shared/mirror.ts'
import { hashedSubject, rateLimitOk } from '../_shared/ratelimit.ts'
import { isValidTimeZone } from '../_shared/tz.ts'

const MAX_BODY_BYTES   = 8_192
const ALLOWED_STATUSES = ['pending', 'confirmed', 'cancelled']
const MS_PER_MINUTE    = 60_000

/**
 * Per signed-in caller. Not a defence against the coaching roster, which is
 * trusted — it is what stops a stolen coach session from being turned into a
 * loop, and every call here writes to a real calendar and mails real people.
 * Generous enough that confirming a morning's bookings one by one never sees it.
 */
const RATE_WINDOW_SECONDS = 60
const RATE_LIMIT_PER_USER = 60

/**
 * A sanity bound on how far out a coach may drag a booking, matching
 * booking-create's. Google will happily accept the year 9999 and the row will
 * happily hold it; neither is a thing anybody meant to type.
 */
const ABSOLUTE_MAX_ADVANCE_DAYS = 400

/**
 * A sanity bound, not a menu. The four fixed durations that used to live here
 * were the same list booking-create carried, and both stopped being the truth
 * when migration 009 put the length on the service. A coach stretching a call
 * to 75 minutes in the portal is a normal thing to do; a coach booking a
 * fourteen-hour one is a typo.
 */
const MIN_DURATION_MINUTES = 5
const MAX_DURATION_MINUTES = 480

type BookingStatus = 'pending' | 'confirmed' | 'cancelled'

interface UpdateRequest {
  booking_id: string
  status?: BookingStatus
  booked_at?: string
  duration_minutes?: number
  coach_notes?: string | null
}

interface BookingRow {
  id: string
  coach_slug: string
  booked_at: string
  duration_minutes: number
  first_name: string
  last_name: string
  email: string
  phone: string | null
  service_interest: string | null
  service_name: string | null
  goals: string | null
  status: BookingStatus
  google_event_id: string | null
  google_calendar_id: string | null
  /**
   * `google_meet_url`, which is what migration 007 actually called the column.
   * This file spent its whole life selecting and writing `google_meet_link`,
   * which does not exist — every query it made came back 42703 and every
   * mutation it attempted failed before it began.
   */
  google_meet_url: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function fail(error: string, status: number, cors: Record<string, string>): Response {
  return json({ ok: false, error }, status, cors)
}

function parseRequest(raw: unknown): UpdateRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const b = raw as Record<string, unknown>

  if (typeof b.booking_id !== 'string' || !UUID_RE.test(b.booking_id)) return null

  const out: UpdateRequest = { booking_id: b.booking_id }

  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !ALLOWED_STATUSES.includes(b.status)) return null
    out.status = b.status as BookingStatus
  }
  if (b.booked_at !== undefined) {
    if (typeof b.booked_at !== 'string') return null
    out.booked_at = b.booked_at
  }
  if (b.duration_minutes !== undefined) {
    if (typeof b.duration_minutes !== 'number' || !Number.isInteger(b.duration_minutes)) return null
    if (b.duration_minutes < MIN_DURATION_MINUTES || b.duration_minutes > MAX_DURATION_MINUTES) return null
    out.duration_minutes = b.duration_minutes
  }
  if (b.coach_notes !== undefined) {
    if (b.coach_notes !== null && typeof b.coach_notes !== 'string') return null
    if (typeof b.coach_notes === 'string' && b.coach_notes.length > 4_000) return null
    out.coach_notes = b.coach_notes
  }

  if (out.status === undefined && out.booked_at === undefined &&
      out.duration_minutes === undefined && out.coach_notes === undefined) return null

  return out
}

/**
 * The caller's coach identity, derived from the verified JWT email.
 * `slug` is null when the email is absent from coach_routing (or the row's slug
 * failed to backfill). `isAdmin` mirrors is_content_admin() in 005: it is true
 * ONLY for an email whose coach_routing row is flagged is_admin. A null slug does
 * NOT imply admin — admin is a positive allowlist, never inferred from absence.
 */
async function resolveCoachSlug(
  db: SupabaseClient,
  email: string,
): Promise<{ slug: string | null; isAdmin: boolean }> {
  // NOT `.ilike('email', email)`, which is what this used to be. ilike reads `%`
  // and `_` in its PATTERN as wildcards, and the pattern here is the caller's own
  // email — `_` is an ordinary character in a local part, so an account at
  // `ronni_@axistrainingsystems.com` matched `ronnie@axistrainingsystems.com` and
  // was handed that coach's slug, is_admin flag included. The roster is a handful
  // of rows: read it whole and compare exactly, case-folded, in this process.
  const { data, error } = await db
    .from('coach_routing')
    .select('email,coach_slug,is_admin')

  if (error) {
    console.error('booking-update identity', error.code)
    throw new Error('identity_lookup_failed')
  }

  const wanted = email.trim().toLowerCase()
  const row = ((data ?? []) as {
    email: string | null; coach_slug: string | null; is_admin: boolean | null
  }[]).find(r => (r.email ?? '').trim().toLowerCase() === wanted)

  return { slug: row?.coach_slug ?? null, isAdmin: row?.is_admin === true }
}

async function coachTimeZone(db: SupabaseClient, coachSlug: string): Promise<string> {
  const { data } = await db
    .from('coach_public_settings')
    .select('time_zone')
    .eq('coach_slug', coachSlug)
    .maybeSingle()

  const tz = data?.time_zone
  if (!tz || !isValidTimeZone(tz)) return 'UTC'
  return tz
}

function eventSummary(b: BookingRow): string {
  return `${b.service_name ?? 'Axis Consultation'} — ${b.first_name} ${b.last_name}`
}

function eventDescription(b: BookingRow): string {
  return [
    b.service_name ?? b.service_interest ? `Service: ${b.service_name ?? b.service_interest}` : null,
    b.goals ? `Goals: ${b.goals}` : null,
    b.phone ? `Phone: ${b.phone}` : null,
    `Booking ID: ${b.id}`,
  ].filter(Boolean).join('\n')
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method_not_allowed', 405, cors)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return fail('unauthorized', 401, cors)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!

  const caller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: userData, error: userError } = await caller.auth.getUser()
  const email  = userData?.user?.email
  const userId = userData?.user?.id
  if (userError || !email || !userId) return fail('unauthorized', 401, cors)

  const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  // Budgeted per verified caller, not per address: the identity that matters
  // here is the session, and a coach on a phone changing networks is still one
  // coach. Fails CLOSED — everything past this point writes.
  const subject = await hashedSubject(userId)
  if (!(await rateLimitOk(db, 'booking-update', subject, RATE_WINDOW_SECONDS, RATE_LIMIT_PER_USER))) {
    return fail('rate_limited', 429, cors)
  }

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return fail('payload_too_large', 413, cors)

  let payload: UpdateRequest | null
  try {
    const body = await req.text()
    if (body.length > MAX_BODY_BYTES) return fail('payload_too_large', 413, cors)
    payload = parseRequest(JSON.parse(body))
  } catch {
    return fail('invalid_payload', 400, cors)
  }
  if (!payload) return fail('invalid_payload', 400, cors)

  let callerSlug: string | null
  let callerIsAdmin: boolean
  try {
    const identity = await resolveCoachSlug(db, email)
    callerSlug = identity.slug
    callerIsAdmin = identity.isAdmin
  } catch {
    return fail('server_error', 500, cors)
  }

  const { data: existing, error: readError } = await db
    .from('bookings')
    .select('id,coach_slug,booked_at,duration_minutes,first_name,last_name,email,phone,service_interest,service_name,goals,status,google_event_id,google_calendar_id,google_meet_url')
    .eq('id', payload.booking_id)
    .maybeSingle<BookingRow>()

  if (readError) {
    console.error('booking-update read', readError.code)
    return fail('server_error', 500, cors)
  }
  if (!existing) return fail('not_found', 404, cors)

  // Authorization is a positive check, never inferred from a missing slug.
  // An admin (is_admin allowlist) may mutate any booking; every other caller may
  // mutate only bookings on their own coach_slug. A caller who is neither the
  // owning coach nor a flagged admin — including a self-registered email or a
  // coach whose slug failed to backfill (null) — is forbidden.
  if (!callerIsAdmin && (callerSlug === null || callerSlug !== existing.coach_slug)) {
    return fail('forbidden', 403, cors)
  }

  const nextStatus   = payload.status ?? existing.status
  const nextDuration = payload.duration_minutes ?? existing.duration_minutes

  let nextStartMs = new Date(existing.booked_at).getTime()
  let rescheduled = false

  if (payload.booked_at !== undefined) {
    const parsed = new Date(payload.booked_at)
    if (Number.isNaN(parsed.getTime())) return fail('invalid_payload', 400, cors)
    if (parsed.getTime() % MS_PER_MINUTE !== 0) return fail('invalid_payload', 400, cors)
    if (parsed.getTime() < Date.now()) return fail('past_slot', 400, cors)
    if (parsed.getTime() > Date.now() + ABSOLUTE_MAX_ADVANCE_DAYS * 86_400_000) {
      return fail('too_far', 400, cors)
    }
    rescheduled = parsed.getTime() !== nextStartMs
    nextStartMs = parsed.getTime()
  }
  if (payload.duration_minutes !== undefined && payload.duration_minutes !== existing.duration_minutes) {
    rescheduled = true
  }

  const update: Record<string, unknown> = {}
  if (payload.status !== undefined)           update.status = nextStatus
  if (payload.coach_notes !== undefined)      update.coach_notes = payload.coach_notes
  if (payload.booked_at !== undefined)        update.booked_at = new Date(nextStartMs).toISOString()
  if (payload.duration_minutes !== undefined) update.duration_minutes = nextDuration

  const { error: writeError } = await db.from('bookings').update(update).eq('id', existing.id)
  if (writeError) {
    // 23P01 = exclusion_violation: the coach rescheduled onto an instant they already hold.
    if (writeError.code === '23P01') return fail('slot_taken', 409, cors)
    console.error('booking-update write', writeError.code)
    return fail('server_error', 500, cors)
  }

  const booking: BookingRow = {
    ...existing,
    status: nextStatus,
    booked_at: new Date(nextStartMs).toISOString(),
    duration_minutes: nextDuration,
  }

  // ---- Google mirror. Never fails the mutation. ----
  //
  // The row above is already committed and is what the calendar, the busy
  // mirror and the notification queue all key off. Everything below is a
  // courtesy to Google, and 'failed' means the row goes back to
  // google_sync_status='pending' for the outbox to retry — never that the
  // coach's change did not happen.
  //
  // Cancel deletes rather than patching STATUS:CANCELLED, so a cancelled
  // booking cannot linger on the coach's calendar looking like an appointment.
  const timeZone = await coachTimeZone(db, booking.coach_slug)

  let calendarSynced = existing.google_event_id !== null
  let meetLink       = existing.google_meet_url

  if (nextStatus === 'cancelled') {
    const res = await mirrorCancel(
      db, booking.coach_slug, existing.google_event_id, existing.google_calendar_id
    )
    if (res.status === 'failed') {
      console.error('booking-update google_cancel', res.code)
      await db.from('bookings').update({ google_sync_status: 'pending' }).eq('id', booking.id)
    } else {
      calendarSynced = false
      meetLink = null
      await db.from('bookings').update({
        google_event_id:    null,
        google_meet_url:    null,
        google_sync_status: res.status === 'skipped' ? 'skipped' : 'synced',
      }).eq('id', booking.id)
    }
  } else {
    // Patch when we hold an event, insert when we do not — which covers a coach
    // who connected Google after the booking was taken, and one whose first
    // push failed. mirrorUpsert also re-inserts when Google says 410 Gone,
    // i.e. the coach deleted the event by hand.
    const res = await mirrorUpsert(
      db,
      booking.coach_slug,
      { eventId: existing.google_event_id, calendarId: existing.google_calendar_id },
      {
        summary:       eventSummary(booking),
        description:   eventDescription(booking),
        start:         new Date(nextStartMs),
        end:           new Date(nextStartMs + nextDuration * MS_PER_MINUTE),
        timeZone,
        attendeeEmail: booking.email,
        attendeeName:  `${booking.first_name} ${booking.last_name}`,
        // Only read on the insert branch, where it stamps the new event with a
        // private key the recovery sweep can find it by. The patch branch is
        // unaffected.
        bookingId:     booking.id,
      }
    )

    if (res.status === 'synced') {
      calendarSynced = true
      meetLink = res.meetLink
      await db.from('bookings').update({
        google_event_id:    res.eventId,
        google_calendar_id: res.calendarId,
        google_meet_url:    res.meetLink,
        google_synced_at:   new Date().toISOString(),
        google_sync_status: 'synced',
      }).eq('id', booking.id)
    } else if (res.status === 'skipped') {
      calendarSynced = false
      await db.from('bookings').update({ google_sync_status: 'skipped' }).eq('id', booking.id)
    } else {
      console.error('booking-update google_sync', res.code)
      calendarSynced = false
      await db.from('bookings').update({ google_sync_status: 'pending' }).eq('id', booking.id)
    }
  }

  return json(
    {
      ok: true,
      booking_id: booking.id,
      status: nextStatus,
      rescheduled,
      calendar_synced: calendarSynced,
      meet_link: meetLink,
    },
    200,
    cors
  )
})
