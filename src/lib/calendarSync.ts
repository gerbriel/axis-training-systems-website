import { supabase, supabaseConfigured } from './supabase'
import type { BookingStatus, GoogleSyncStatus } from '../types/database'

/**
 * Typed client for the calendar edge functions.
 *
 * Nothing here throws: a Google failure must never take down a page, and it must never
 * take down a booking. Every call returns a discriminated result whose failure carries an
 * opaque short code — the functions never echo request context back, so there is nothing
 * to unwrap beyond the code itself.
 */

export type CalendarErrorCode =
  | 'not_configured'
  | 'not_authenticated'
  | 'not_connected'
  | 'slot_taken'
  | 'slot_unavailable'
  | 'invalid_request'
  | 'rate_limited'
  | 'google_error'
  | 'server_error'
  // ── booking-create, since 009/010 ──
  | 'unknown_coach'
  | 'unknown_service'
  | 'service_not_offered'
  | 'too_soon'
  | 'too_far'

export type Result<T> =
  | ({ ok: true } & T)
  | { ok: false; code: CalendarErrorCode }

/**
 * A success that carries nothing back. `Record<string, never>` looks like the way to say this
 * but is not: its index signature makes every key `never`, so `{ ok: true }` does not satisfy
 * `{ ok: true } & Record<string, never>` — it only ever typechecks by accident when the value
 * is spread rather than written out.
 */
export type NoPayload = Record<never, never>

/**
 * The connection as the CLIENT is allowed to see it. No tokens: they live encrypted in the
 * `private` schema and are unreachable from any client role, so they have no type here.
 */
export interface CalendarConnectionStatus {
  connected: boolean
  googleEmail: string | null
  calendarId: string | null
  lastSyncedAt: string | null
  lastSyncError: string | null
}

export interface BookingCreateInput {
  coachSlug: string
  /** Absolute instant — serialized as ISO with an offset, never a wall-clock string. */
  startsAt: Date
  /**
   * WHICH service, and nothing about it. The duration and the price are read
   * from the database by booking-create (009); a client that sent them would be
   * answering a question it was not asked. null is valid — a coach with no
   * catalog rows takes calls at their schedule window's own length.
   */
  serviceId: string | null
  firstName: string
  lastName: string
  email: string
  phone?: string
  goals?: string
}

export interface BookingCreateSuccess {
  bookingId: string
  /**
   * The client's only route back to this booking — Axis has no accounts. It
   * goes on the confirmation screen and into the confirmation email, and this
   * is the last time it leaves the database.
   */
  manageToken: string
  /** What the DATABASE made of it, not what was asked for. See BookPage. */
  status: BookingStatus
  durationMinutes: number
  serviceName: string | null
  priceCents: number | null
  googleSyncStatus: GoogleSyncStatus
  /** Present only when booking-create synchronously created a Google event with a Meet link. */
  meetLink: string | null
}

export interface BookingUpdateInput {
  bookingId: string
  status?: BookingStatus
  coachNotes?: string
}

export const DISCONNECTED: CalendarConnectionStatus = {
  connected:     false,
  googleEmail:   null,
  calendarId:    null,
  lastSyncedAt:  null,
  lastSyncError: null,
}

const ERROR_CODES: CalendarErrorCode[] = [
  'not_configured',
  'not_authenticated',
  'not_connected',
  'slot_taken',
  'slot_unavailable',
  'invalid_request',
  'rate_limited',
  'google_error',
  'server_error',
  'unknown_coach',
  'unknown_service',
  'service_not_offered',
  'too_soon',
  'too_far',
]

function asErrorCode(value: unknown): CalendarErrorCode {
  return ERROR_CODES.includes(value as CalendarErrorCode)
    ? (value as CalendarErrorCode)
    : 'server_error'
}

/**
 * supabase-js surfaces a FunctionsHttpError for any non-2xx and does not parse the body,
 * so the short code has to be read off the attached Response.
 */
async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<Result<T>> {
  if (!supabaseConfigured) return { ok: false, code: 'not_configured' }

  const { data, error } = await supabase.functions.invoke(fn, { body })

  if (error) {
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

  if (data && typeof data === 'object' && 'error' in data) {
    return { ok: false, code: asErrorCode((data as { error: unknown }).error) }
  }

  return { ok: true, ...(data as T) }
}

// ---------------------------------------------------------------------------
// Coach portal — google-oauth
// ---------------------------------------------------------------------------

/**
 * google-oauth routes on the trailing PATH segment, not on an `action` field in the body —
 * it has to, because the /callback leg is a plain browser redirect from Google and carries no
 * body at all. Every leg below is addressed as `google-oauth/<leg>` for that reason.
 */

/**
 * Mints the consent URL. The function stores a single-use state row keyed to the caller's
 * verified auth.uid() — the coach_slug is never taken from the client. `redirectTo` is where
 * the callback returns the coach and is checked against a server-side allowlist.
 *
 * Returns the URL; it does not navigate. The caller decides when to leave the page.
 */
export async function startGoogleOAuth(redirectTo: string): Promise<Result<{ url: string }>> {
  return invoke<{ url: string }>('google-oauth/start', { redirect_to: redirectTo })
}

export async function disconnectGoogleCalendar(): Promise<Result<NoPayload>> {
  return invoke<NoPayload>('google-oauth/disconnect', {})
}

/**
 * Never fails loudly: a coach who has not connected Google is a fully supported state, so a
 * failed status check reads as "disconnected" rather than breaking the portal.
 */
export async function getCalendarConnectionStatus(): Promise<CalendarConnectionStatus> {
  const res = await invoke<{
    connected?: boolean
    google_email?: string | null
    calendar_id?: string | null
    last_synced_at?: string | null
    last_sync_error?: string | null
  }>('google-oauth/status', {})

  if (!res.ok) return DISCONNECTED

  return {
    connected:     res.connected === true,
    googleEmail:   res.google_email    ?? null,
    calendarId:    res.calendar_id     ?? null,
    lastSyncedAt:  res.last_synced_at  ?? null,
    lastSyncError: res.last_sync_error ?? null,
  }
}

// ---------------------------------------------------------------------------
// Coach portal — calendar-sync ("sync now")
// ---------------------------------------------------------------------------

/**
 * Pulls the coach's freeBusy window into coach_calendar_busy on demand. The same function runs
 * on a cron — this is a latency shortcut, never the only path.
 */
export async function syncCalendarNow(): Promise<Result<{ busyCount: number; syncedAt: string }>> {
  // calendar-sync returns { ok, synced, failed, results: [{ coach_slug, ok, busy_count }] }.
  // The coach-portal path syncs exactly one coach, so the count lives at results[0].busy_count —
  // there is no top-level busy_count. synced_at is read from the response when present and falls
  // back to the client clock only for the optimistic banner (the authoritative last_synced_at is
  // refetched via getCalendarConnectionStatus).
  const res = await invoke<{
    synced?: number
    failed?: number
    synced_at?: string
    results?: Array<{ coach_slug: string; ok: boolean; busy_count?: number }>
  }>('calendar-sync', {})
  if (!res.ok) return res
  const entry = res.results?.[0]
  return {
    ok:        true,
    busyCount: entry?.busy_count ?? 0,
    syncedAt:  res.synced_at ?? new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Public booking page — booking-create
// ---------------------------------------------------------------------------

/**
 * The only write path for a booking. booking-create re-validates the slot server-side and the
 * DB exclusion constraint settles the race — the loser gets `slot_taken`. A Google failure never
 * fails the booking: the row is committed first and mirrored through the outbox.
 */
export async function createBooking(input: BookingCreateInput): Promise<Result<BookingCreateSuccess>> {
  if (!supabaseConfigured) {
    return {
      ok:               true,
      bookingId:        'demo-' + Math.random().toString(36).slice(2, 10),
      manageToken:      '00000000-0000-4000-8000-000000000000',
      status:           'pending',
      durationMinutes:  30,
      serviceName:      null,
      priceCents:       null,
      googleSyncStatus: 'skipped',
      meetLink:         null,
    }
  }

  // booking-create returns { ok, booking_id, manage_token, status, duration_minutes,
  // service_name, price_cents, calendar_synced, meet_link } — not google_sync_status.
  // calendar_synced is a boolean describing the synchronous mirror attempt: true means a Google
  // event (with the Meet link) was created inline, false means it was skipped (coach not connected)
  // or deferred to the outbox. We surface that as the client-visible GoogleSyncStatus.
  const res = await invoke<{
    booking_id: string
    manage_token: string
    status?: BookingStatus
    duration_minutes?: number
    service_name?: string | null
    price_cents?: number | null
    calendar_synced?: boolean
    meet_link?: string | null
  }>('booking-create', {
    coach_slug: input.coachSlug,
    booked_at:  input.startsAt.toISOString(),
    service_id: input.serviceId,
    first_name: input.firstName,
    last_name:  input.lastName,
    email:      input.email,
    phone:      input.phone || null,
    goals:      input.goals || null,
  })

  if (!res.ok) return res

  return {
    ok:              true,
    bookingId:       res.booking_id,
    manageToken:     res.manage_token,
    // An older server build that does not send this is treated as the status
    // Axis has run on until now: a coach confirms by hand.
    status:          res.status ?? 'pending',
    durationMinutes: res.duration_minutes ?? 30,
    serviceName:     res.service_name ?? null,
    priceCents:      res.price_cents ?? null,
    googleSyncStatus: res.calendar_synced === true ? 'synced' : 'skipped',
    meetLink:        res.meet_link ?? null,
  }
}

// ---------------------------------------------------------------------------
// Coach portal — booking-update
// ---------------------------------------------------------------------------

/**
 * Status/notes change. Mirrors to Google (update or cancel the event) through the outbox.
 *
 * booking-update returns { ok, booking_id, status, rescheduled, calendar_synced, meet_link } —
 * not google_sync_status, exactly as booking-create does not. `calendar_synced` is the boolean
 * outcome of the synchronous mirror attempt; false means the coach has no Google connection or
 * the write was deferred to the outbox, which is 'skipped' from the client's point of view.
 */
export async function updateBooking(
  input: BookingUpdateInput
): Promise<Result<{ googleSyncStatus: GoogleSyncStatus; meetLink: string | null }>> {
  const res = await invoke<{ calendar_synced?: boolean; meet_link?: string | null }>('booking-update', {
    booking_id: input.bookingId,
    ...(input.status     !== undefined ? { status: input.status } : {}),
    ...(input.coachNotes !== undefined ? { coach_notes: input.coachNotes } : {}),
  })
  if (!res.ok) return res
  return {
    ok:               true,
    googleSyncStatus: res.calendar_synced === true ? 'synced' : 'skipped',
    meetLink:         res.meet_link ?? null,
  }
}

// ---------------------------------------------------------------------------
// Coach portal — timezone (public.coach_public_settings)
// ---------------------------------------------------------------------------

/**
 * The coach's IANA zone is NOT part of the Google connection — it is what every schedule the
 * coach writes is denominated in, and it matters whether or not Google is connected. It lives
 * in coach_public_settings, so it is read and written straight through PostgREST rather than
 * through an edge function; RLS pins the row to current_coach_slug(), so the slug passed here
 * is a filter, never an authorization claim.
 */
export async function getCoachTimeZone(coachSlug: string): Promise<string | null> {
  if (!supabaseConfigured) return null

  const { data, error } = await supabase
    .from('coach_public_settings')
    .select('time_zone')
    .eq('coach_slug', coachSlug)
    .maybeSingle()

  if (error) return null
  return (data as { time_zone: string } | null)?.time_zone ?? null
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * Upsert rather than update: the seeded roster has a settings row, but a coach onboarded later
 * does not, and "I cannot save my timezone" is not an acceptable way to find that out.
 *
 * `updated_at` is set here because the column's default only fires on INSERT and the table
 * carries no touch trigger — an UPDATE that omitted it would leave the timestamp lying.
 */
export async function updateCoachTimeZone(
  coachSlug: string,
  timeZone: string
): Promise<Result<NoPayload>> {
  if (!supabaseConfigured)      return { ok: false, code: 'not_configured' }
  if (!isValidTimeZone(timeZone)) return { ok: false, code: 'invalid_request' }

  const { error } = await supabase
    .from('coach_public_settings')
    .upsert(
      { coach_slug: coachSlug, time_zone: timeZone, updated_at: new Date().toISOString() },
      { onConflict: 'coach_slug' }
    )

  if (error) {
    // 23514 → the coach_public_settings_tz_valid CHECK rejected the zone.
    // 42501 → RLS refused the row: this is not the signed-in coach's own settings.
    if (error.code === '23514') return { ok: false, code: 'invalid_request' }
    if (error.code === '42501') return { ok: false, code: 'not_authenticated' }
    return { ok: false, code: 'server_error' }
  }

  return { ok: true }
}

/** Human-readable copy for the codes above. Generic by design — never surface server text. */
export function calendarErrorMessage(code: CalendarErrorCode): string {
  switch (code) {
    case 'slot_taken':
    case 'slot_unavailable':
      return 'That time was just taken. Please pick another slot.'
    case 'not_connected':
      return 'No Google Calendar is connected yet.'
    case 'not_authenticated':
      return 'Your session expired. Sign in again.'
    case 'not_configured':
      return 'This is not available in preview mode.'
    case 'rate_limited':
      return 'That is a lot of bookings from one place in a short time. Give it a few minutes and try again.'
    case 'too_soon':
      return 'That time is too close now — your coach needs more notice. Please pick a later slot.'
    case 'too_far':
      return 'That is further out than this coach takes bookings. Please pick a nearer date.'
    case 'unknown_service':
    case 'service_not_offered':
      return 'That service is no longer offered by this coach. Please pick another.'
    case 'unknown_coach':
      return 'We could not find that coach. Please start again.'
    case 'invalid_request':
      return 'Something about that request was invalid. Please try again.'
    default:
      return 'Something went wrong. Please try again.'
  }
}
