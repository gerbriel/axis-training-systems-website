// Axis Training Systems — the loaders every booking path shares.
//
// Three functions decide what a booking IS, and all three live here so that the
// endpoint offering a time, the endpoint taking it, and the endpoint moving it
// cannot disagree about the answer:
//
//   loadCoachPolicy   how this coach takes bookings (zone, notice, horizon)
//   priceService      how long the thing is and what it costs — from the DB
//   loadAvailability  everything generateSlots() needs, fetched in one round
//
// The client supplies WHICH service. It never supplies a duration or a price.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { addDaysToDateKey, isValidTimeZone, zonedTimeToUtc } from './tz.ts'
import type { BlockRow, Interval, ScheduleWindow, SlotInput } from './slots.ts'

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000

/** Axis is a Fresno gym. Used only when a coach has no settings row at all. */
export const DEFAULT_TIME_ZONE = 'America/Los_Angeles'

// ─────────────────────────────────────────────────────────────────────────────
// Coach policy
// ─────────────────────────────────────────────────────────────────────────────

export interface CoachPolicy {
  timeZone:        string
  minLeadMinutes:  number
  maxAdvanceDays:  number
  bufferMinutes:   number
  autoConfirm:     boolean
}

/**
 * Null means "no such coach", which is a 404 and not a default. Guessing a zone
 * for an unknown slug would happily generate a calendar for a coach who does
 * not exist and then take a booking on it.
 */
export async function loadCoachPolicy(db: SupabaseClient, coachSlug: string): Promise<CoachPolicy | null> {
  const { data, error } = await db
    .from('coach_public_settings')
    .select('time_zone,min_lead_minutes,max_advance_days,buffer_minutes,auto_confirm')
    .eq('coach_slug', coachSlug)
    .maybeSingle()

  if (error) {
    console.error('booking policy_read', error.code)
    return null
  }
  if (!data) return null

  const row = data as {
    time_zone: string | null
    min_lead_minutes: number | null
    max_advance_days: number | null
    buffer_minutes: number | null
    auto_confirm: boolean | null
  }

  // A zone this runtime cannot resolve corrupts every slot the coach offers, so
  // it is refused rather than silently replaced with UTC.
  if (!row.time_zone || !isValidTimeZone(row.time_zone)) {
    console.error('booking invalid_coach_tz', coachSlug)
    return null
  }

  return {
    timeZone:       row.time_zone,
    minLeadMinutes: row.min_lead_minutes ?? 120,
    maxAdvanceDays: row.max_advance_days ?? 70,
    bufferMinutes:  row.buffer_minutes ?? 0,
    autoConfirm:    row.auto_confirm === true,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Services
// ─────────────────────────────────────────────────────────────────────────────

export interface PricedService {
  id:              string
  slug:            string
  name:            string
  durationMinutes: number
  /** null is a real value — most Axis coaching has no price at booking time. */
  priceCents:      number | null
}

export type PriceOutcome =
  | { ok: true; service: PricedService | null }
  | { ok: false; error: 'unknown_service' | 'service_not_offered' | 'server_error' }

/**
 * The length and the price of what is being booked, with the coach's overrides
 * applied.
 *
 * `serviceId` may be null, and that is a supported booking: a coach with no
 * catalog rows takes calls at whatever their schedule window says, exactly as
 * they did before there was a catalog. `{ ok: true, service: null }` is that
 * case — distinct from a service id that does not exist, which is a 404.
 */
export async function priceService(
  db: SupabaseClient,
  coachSlug: string,
  serviceId: string | null
): Promise<PriceOutcome> {
  if (!serviceId) return { ok: true, service: null }

  const [serviceRes, offerRes] = await Promise.all([
    db.from('booking_services')
      .select('id,slug,name,duration_minutes,price_cents,is_active')
      .eq('id', serviceId)
      .maybeSingle(),
    db.from('coach_booking_services')
      .select('duration_minutes_override,price_cents_override,is_active')
      .eq('coach_slug', coachSlug)
      .eq('service_id', serviceId)
      .maybeSingle(),
  ])

  if (serviceRes.error || offerRes.error) {
    console.error('booking service_read', serviceRes.error?.code ?? offerRes.error?.code)
    return { ok: false, error: 'server_error' }
  }

  const svc = serviceRes.data as {
    id: string; slug: string; name: string
    duration_minutes: number; price_cents: number | null; is_active: boolean
  } | null

  if (!svc || !svc.is_active) return { ok: false, error: 'unknown_service' }

  const offer = offerRes.data as {
    duration_minutes_override: number | null
    price_cents_override: number | null
    is_active: boolean
  } | null

  // A service this coach does not offer is refused rather than quietly booked
  // at the catalog's length: "who does what" is the coach's to decide, and a
  // deep link from an old page is exactly how a request for the wrong one shows up.
  if (!offer || !offer.is_active) return { ok: false, error: 'service_not_offered' }

  return {
    ok: true,
    service: {
      id:              svc.id,
      slug:            svc.slug,
      name:            svc.name,
      durationMinutes: offer.duration_minutes_override ?? svc.duration_minutes,
      // `??` and not `||`: an override of 0 is a free session, not a missing value.
      priceCents:      offer.price_cents_override ?? svc.price_cents,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Availability
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 'unavailable' is NOT an empty calendar. It means a read failed and we do not
 * know what is open — the caller must say so rather than render a blank week,
 * which is a fact we would be making up, and never take a booking against it.
 */
export type AvailabilityOutcome = SlotInput | 'unavailable'

export async function loadAvailability(opts: {
  db:              SupabaseClient
  coachSlug:       string
  policy:          CoachPolicy
  durationMinutes: number | null
  fromDateKey:     string
  days:            number
  now:             Date
}): Promise<AvailabilityOutcome> {
  const { db, coachSlug, policy, durationMinutes, fromDateKey, days, now } = opts

  // A day of margin either side: a window that opens at 23:30 in the coach's
  // zone reaches into the next UTC day, and a block on the boundary has to be
  // in hand when that day is generated.
  const blockFrom = addDaysToDateKey(fromDateKey, -1)
  const blockTo   = addDaysToDateKey(fromDateKey, days + 1)

  // ── The busy window is anchored on fromDateKey, NOT on `now`. ─────────────
  //
  // Anchoring it on `now` is only correct when the caller is asking about the
  // next few days, which is true of the availability endpoint and false of
  // every other caller. booking-create asks about ONE day that may be two
  // months out; with a now-anchored window it read three days of busy time
  // around today, found nothing near the requested slot, and declared it open.
  //
  // The exclusion constraint (008) would still have caught a genuine collision
  // with another booking. It would NOT have caught a collision with the coach's
  // own Google calendar, which lives in coach_calendar_busy and is not a
  // booking — so a far-future slot could be sold on top of the coach's
  // afternoon off.
  //
  // `now` is still the floor: an interval that has already finished cannot
  // block anything, and there is no reason to read the past.
  const windowStartMs = Math.max(
    now.getTime(),
    zonedTimeToUtc(blockFrom, '00:00', policy.timeZone).getTime()
  )
  const windowStart = new Date(windowStartMs).toISOString()
  const windowEnd   = new Date(
    zonedTimeToUtc(blockTo, '00:00', policy.timeZone).getTime() + DAY_MS
  ).toISOString()

  const [schedulesRes, blocksRes, busyRes, bookingsRes] = await Promise.all([
    db.from('coach_schedules')
      .select('day_of_week,start_time,end_time,slot_duration_minutes')
      .eq('coach_slug', coachSlug)
      .eq('is_active', true),
    db.from('coach_availability_blocks')
      .select('block_date,start_time,end_time')
      .eq('coach_slug', coachSlug)
      .gte('block_date', blockFrom)
      .lte('block_date', blockTo),
    // coach_calendar_busy carries BOTH imported Google busy time and the mirror
    // of our own bookings (007), so this one read covers "already booked" too.
    // ends_at, not starts_at: an interval already in progress still blocks.
    db.from('coach_calendar_busy')
      .select('starts_at,ends_at')
      .eq('coach_slug', coachSlug)
      .gte('ends_at', windowStart)
      .lte('starts_at', windowEnd),
    // Belt and braces. The mirror above is maintained by a trigger in the same
    // transaction as the booking, so this should be a subset of it — but a slot
    // re-offered because a trigger regressed is a double booking, and the
    // second read costs one round trip on a query that is already parallel.
    db.from('bookings')
      .select('booked_at,duration_minutes')
      .eq('coach_slug', coachSlug)
      .neq('status', 'cancelled')
      .gte('ends_at', windowStart)
      .lte('booked_at', windowEnd),
  ])

  // Fail loud, in one direction only: a swallowed error here silently re-offers
  // time the coach is not free for.
  const failure = schedulesRes.error ?? blocksRes.error ?? busyRes.error ?? bookingsRes.error
  if (failure) {
    console.error('booking availability_read', failure.code)
    return 'unavailable'
  }

  const busy: Interval[] = [
    ...((busyRes.data ?? []) as { starts_at: string; ends_at: string }[]).map(b => ({
      start: new Date(b.starts_at).getTime(),
      end:   new Date(b.ends_at).getTime(),
    })),
    ...((bookingsRes.data ?? []) as { booked_at: string; duration_minutes: number }[]).map(b => {
      const start = new Date(b.booked_at).getTime()
      return { start, end: start + b.duration_minutes * MINUTE_MS }
    }),
  ]

  return {
    timeZone:       policy.timeZone,
    schedules:      (schedulesRes.data ?? []) as ScheduleWindow[],
    blocks:         (blocksRes.data ?? []) as BlockRow[],
    busy,
    durationMinutes,
    bufferMinutes:  policy.bufferMinutes,
    minLeadMinutes: policy.minLeadMinutes,
    maxAdvanceDays: policy.maxAdvanceDays,
    now,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting
//
// Lives in ./ratelimit.ts — it is not booking-specific and the invitation
// endpoint needs it too. Re-exported here so the three booking functions that
// already import it from this module keep working.
// ─────────────────────────────────────────────────────────────────────────────

export { rateLimitOk, requestSubject } from './ratelimit.ts'
