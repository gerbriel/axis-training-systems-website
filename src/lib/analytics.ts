import { supabase, supabaseConfigured } from './supabase'

let _sessionId: string | null = null

function sessionId(): string {
  if (_sessionId) return _sessionId
  const stored = sessionStorage.getItem('ax_sid')
  if (stored) { _sessionId = stored; return stored }
  const id = crypto.randomUUID()
  sessionStorage.setItem('ax_sid', id)
  _sessionId = id
  return id
}

export function trackPageview(path: string): void {
  if (!supabaseConfigured) return
  supabase.from('pageviews').insert({
    path,
    referrer: document.referrer || null,
    session_id: sessionId(),
  }).then(() => {})
}

/**
 * The steps between "opened /book" and "booked".
 *
 * `pageviews` has always recorded that the booking page was opened and nothing
 * about what happened next, so "people land on /book and do not book" has never
 * had a second question. These are the five points where they leave.
 *
 * The names are a CHECK constraint in migration 010, not free text: the table
 * is anon-writable, and an open string column on an anon-writable table is a
 * place to store anything.
 *
 * Fire-and-forget by design. Analytics must never delay a booking or fail one —
 * the `.then()` swallows the result and nothing awaits it.
 */
export type BookingEventName =
  | 'booking_page_view'
  | 'service_selected'
  | 'coach_selected'
  | 'slot_selected'
  | 'booking_completed'
  | 'booking_failed'
  | 'booking_cancelled_by_client'
  | 'booking_rescheduled_by_client'

export function trackBookingEvent(
  name: BookingEventName,
  props: { coachSlug?: string | null; serviceId?: string | null } = {}
): void {
  if (!supabaseConfigured) return

  // A demo service id ('demo-intro-call') is not a uuid and would be rejected by
  // the foreign key. Demo mode does not reach here, but a preview build with
  // credentials would.
  const serviceId =
    props.serviceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(props.serviceId)
      ? props.serviceId
      : null

  supabase.from('booking_events').insert({
    session_id: sessionId(),
    name,
    coach_slug: props.coachSlug ?? null,
    service_id: serviceId,
  }).then(() => {})
}
