import { supabase, supabaseConfigured } from './supabase'
import type { BookingStatus } from '../types/database'

/**
 * The client's side of their own booking — typed client for `booking-manage`.
 *
 * The credential is the `manage_token` from the confirmation email (010). There
 * are no accounts, so the link IS the identity: one unguessable uuid scoped to
 * one booking. Everything here goes through the edge function; the browser
 * never touches `bookings`, which anon cannot read at all (005).
 *
 * Nothing throws. Every failure is a value, because the caller is a page that
 * has to render something either way.
 */

export type ManageErrorCode =
  | 'not_found'
  | 'already_cancelled'
  | 'already_past'
  | 'too_late'
  | 'reschedule_limit'
  | 'slot_taken'
  | 'slot_unavailable'
  | 'too_soon'
  | 'too_far'
  | 'same_time'
  | 'rate_limited'
  | 'not_configured'
  | 'server_error'

export interface ManagedBooking {
  id: string
  coachSlug: string
  bookedAt: string
  durationMinutes: number
  firstName: string
  lastName: string
  email: string
  status: BookingStatus
  serviceName: string | null
  priceCents: number | null
  goals: string | null
  meetLink: string | null
  timeZone: string
  isPast: boolean
  cancelledAt: string | null
  cancellationReason: string | null
  reschedulesLeft: number
  /**
   * Decided by the server, not re-derived here. The button the page draws and
   * the answer the server would give have to be the same answer — a disabled
   * control that hides a 409, or an enabled one that produces it, are both
   * ways of lying to someone about their own booking.
   */
  canCancel: boolean
  canReschedule: boolean
  cutoffMinutes: number
}

export interface ManageDay {
  dateKey: string
  slots: { start: Date; durationMinutes: number }[]
}

export type ManageResult<T> = { ok: true; data: T } | { ok: false; code: ManageErrorCode }

const ERROR_CODES: ManageErrorCode[] = [
  'not_found', 'already_cancelled', 'already_past', 'too_late', 'reschedule_limit',
  'slot_taken', 'slot_unavailable', 'too_soon', 'too_far', 'same_time',
  'rate_limited', 'not_configured', 'server_error',
]

function asErrorCode(value: unknown): ManageErrorCode {
  return ERROR_CODES.includes(value as ManageErrorCode) ? (value as ManageErrorCode) : 'server_error'
}

async function call<T>(body: Record<string, unknown>): Promise<ManageResult<T>> {
  if (!supabaseConfigured) return { ok: false, code: 'not_configured' }

  try {
    const { data, error } = await supabase.functions.invoke('booking-manage', { body })

    if (error) {
      // supabase-js does not parse a non-2xx body; the code is on the Response.
      const context = (error as { context?: Response }).context
      if (context && typeof context.json === 'function') {
        try {
          const payload = (await context.json()) as { error?: unknown }
          return { ok: false, code: asErrorCode(payload?.error) }
        } catch {
          // Non-JSON body.
        }
      }
      return { ok: false, code: 'server_error' }
    }

    return { ok: true, data: data as T }
  } catch {
    return { ok: false, code: 'server_error' }
  }
}

interface RawBooking {
  id: string
  coach_slug: string
  booked_at: string
  duration_minutes: number
  first_name: string
  last_name: string
  email: string
  status: BookingStatus
  service_name: string | null
  price_cents: number | null
  goals: string | null
  meet_link: string | null
  time_zone: string
  is_past: boolean
  cancelled_at: string | null
  cancellation_reason: string | null
  reschedules_left: number
  can_cancel: boolean
  can_reschedule: boolean
  cutoff_minutes: number
}

function toBooking(b: RawBooking): ManagedBooking {
  return {
    id: b.id,
    coachSlug: b.coach_slug,
    bookedAt: b.booked_at,
    durationMinutes: b.duration_minutes,
    firstName: b.first_name,
    lastName: b.last_name,
    email: b.email,
    status: b.status,
    serviceName: b.service_name,
    priceCents: b.price_cents,
    goals: b.goals,
    meetLink: b.meet_link,
    timeZone: b.time_zone,
    isPast: b.is_past,
    cancelledAt: b.cancelled_at,
    cancellationReason: b.cancellation_reason,
    reschedulesLeft: b.reschedules_left,
    canCancel: b.can_cancel,
    canReschedule: b.can_reschedule,
    cutoffMinutes: b.cutoff_minutes,
  }
}

export interface BookingWithAvailability {
  booking: ManagedBooking
  /**
   * null is the OUTAGE signal, [] is a genuinely empty month. The page says
   * something different for each, because "your coach has nothing free for four
   * weeks" is a claim and "we could not load the calendar" is an apology.
   *
   * Absent entirely (also null here) when a reschedule is not on offer —
   * generating a calendar for a booking that cannot move is work nobody asked for.
   */
  availability: ManageDay[] | null
}

export async function getBooking(token: string): Promise<ManageResult<BookingWithAvailability>> {
  const res = await call<{
    booking: RawBooking
    availability: { date: string; slots: { start: string; duration: number }[] }[] | null
  }>({ token, action: 'get' })

  if (!res.ok) return res

  return {
    ok: true,
    data: {
      booking: toBooking(res.data.booking),
      availability: res.data.availability
        ? res.data.availability.map(d => ({
            dateKey: d.date,
            slots: d.slots.map(s => ({ start: new Date(s.start), durationMinutes: s.duration })),
          }))
        : null,
    },
  }
}

export async function cancelBooking(token: string, reason?: string): Promise<ManageResult<null>> {
  const res = await call<unknown>({ token, action: 'cancel', reason: reason?.trim() || null })
  return res.ok ? { ok: true, data: null } : res
}

export async function rescheduleBooking(
  token: string,
  startsAt: Date
): Promise<ManageResult<{ bookedAt: string }>> {
  const res = await call<{ booked_at: string }>({
    token,
    action: 'reschedule',
    starts_at: startsAt.toISOString(),
  })
  return res.ok ? { ok: true, data: { bookedAt: res.data.booked_at } } : res
}

/** Human copy for the codes above. Generic by design — never surface server text. */
export function manageErrorMessage(code: ManageErrorCode): string {
  switch (code) {
    case 'not_found':
      return 'We could not find that booking. The link may be from an old email, or the booking may have been removed.'
    case 'already_cancelled':
      return 'That booking is already cancelled.'
    case 'already_past':
      return 'That booking has already happened.'
    case 'too_late':
      return 'It is too close to your call to change it here. Contact your coach directly and they will sort it out.'
    case 'reschedule_limit':
      return 'This booking has been moved as many times as it can be online. Contact your coach to find a new time.'
    case 'slot_taken':
      return 'That time was just taken. Please pick another.'
    case 'slot_unavailable':
      return 'That time is not open. Please pick another.'
    case 'too_soon':
      return 'That is sooner than your coach takes bookings. Please pick a later time.'
    case 'too_far':
      return 'That is further out than your coach takes bookings. Please pick a nearer date.'
    case 'same_time':
      return 'That is the time it is already booked for.'
    case 'rate_limited':
      return 'Too many attempts in a short time. Give it a few minutes.'
    case 'not_configured':
      return 'This is not available in preview mode.'
    default:
      return 'Something went wrong. Please try again.'
  }
}
