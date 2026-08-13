// Axis Training Systems — writing a booking through to the coach's Google Calendar.
//
// One rule governs everything in this file: THE DATABASE ROW IS AUTHORITATIVE AND
// IS WRITTEN FIRST. Google is a mirror. A Google outage delays an invite; it can
// never fail, block, or undo a booking. Every function here returns a result
// rather than throwing, so a caller cannot accidentally let a calendar problem
// escape into the response of a write that already committed.
//
// The credential never touches a client. `calendar_connection_get` is
// service_role-only, the refresh token is AES-GCM encrypted with a key that
// lives in Function Secrets rather than the database, and nothing below logs
// anything but an opaque code.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { decryptToken } from './db.ts'
import {
  deleteEvent,
  getAccessToken,
  insertEvent,
  patchEvent,
  GoogleApiError,
  GoogleGoneError,
  GoogleRevokedError,
  type StoredConnection,
} from './google.ts'

export type MirrorResult =
  /** The coach has not connected Google. A fully supported state, not an error. */
  | { status: 'skipped' }
  | { status: 'synced' }
  | { status: 'failed'; code: string }

/** What an upsert learned, so the caller can persist it against the booking. */
export type MirrorUpsertResult =
  | { status: 'skipped' }
  | { status: 'synced'; eventId: string; calendarId: string; meetLink: string | null }
  | { status: 'failed'; code: string }

/**
 * Runs `fn` with a live access token for this coach, or reports why it could not.
 *
 * Returns 'skipped' — not 'failed' — when there is no connection row. Half the
 * roster may never connect Google, and treating that as a failure would leave a
 * permanent error on every one of their bookings.
 */
async function withCalendar(
  db: SupabaseClient,
  coachSlug: string,
  fn: (accessToken: string, calendarId: string) => Promise<void>
): Promise<MirrorResult> {
  const { data, error } = await db.rpc('calendar_connection_get', { p_coach_slug: coachSlug })
  if (error) {
    console.error('mirror connection_read', error.code)
    return { status: 'failed', code: 'connection_read' }
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    { refresh_token_enc?: string | null; calendar_id?: string | null } | null | undefined
  if (!row?.refresh_token_enc) return { status: 'skipped' }

  let refreshToken: string
  try {
    refreshToken = await decryptToken(row.refresh_token_enc)
  } catch {
    console.error('mirror decrypt_failed', coachSlug)
    return { status: 'failed', code: 'decrypt_failed' }
  }

  const conn: StoredConnection = {
    coachSlug,
    accessToken:  null,
    refreshToken,
    expiresAt:    null,
  }

  try {
    const accessToken = await getAccessToken(conn)
    await fn(accessToken, row.calendar_id || 'primary')
    return { status: 'synced' }
  } catch (err) {
    if (err instanceof GoogleRevokedError) return { status: 'failed', code: 'google_revoked' }
    if (err instanceof GoogleApiError)     return { status: 'failed', code: `google_api_${err.status}` }
    return { status: 'failed', code: 'google_unknown' }
  }
}

/**
 * Take a cancelled booking off the coach's calendar.
 *
 * `deleteEvent` treats an event that is already gone as success, so this is safe
 * to run twice — which matters, because the outbox may also carry a 'cancel' op
 * for the same booking.
 */
export function mirrorCancel(
  db: SupabaseClient,
  coachSlug: string,
  eventId: string | null,
  calendarId: string | null
): Promise<MirrorResult> {
  if (!eventId) return Promise.resolve({ status: 'skipped' })
  return withCalendar(db, coachSlug, (token, defaultCalendar) =>
    deleteEvent(token, eventId, { calendarId: calendarId ?? defaultCalendar, sendUpdates: 'all' })
  )
}

/**
 * Put the booking on the calendar, whether or not it is already there.
 *
 * PATCH when we hold an event id, INSERT when we do not — and INSERT as the
 * fallback when the PATCH comes back 410 Gone, which is what Google says about
 * an event the coach deleted by hand. Without that fallback, a coach tidying up
 * their calendar permanently detaches the booking from it, and every later
 * update is a successful write to nothing.
 */
export async function mirrorUpsert(
  db: SupabaseClient,
  coachSlug: string,
  existing: { eventId: string | null; calendarId: string | null },
  event: {
    summary: string
    description: string
    start: Date
    end: Date
    timeZone: string
    attendeeEmail: string
    attendeeName: string
  }
): Promise<MirrorUpsertResult> {
  let out: MirrorUpsertResult = { status: 'failed', code: 'unreachable' }

  const result = await withCalendar(db, coachSlug, async (token, defaultCalendar) => {
    const calendarId = existing.calendarId ?? defaultCalendar

    if (existing.eventId) {
      try {
        const patched = await patchEvent(
          token,
          existing.eventId,
          {
            summary:     event.summary,
            description: event.description,
            start:       event.start,
            end:         event.end,
            timeZone:    event.timeZone,
          },
          { calendarId, sendUpdates: 'all' }
        )
        out = {
          status: 'synced', eventId: patched.id, calendarId, meetLink: patched.hangoutLink,
        }
        return
      } catch (err) {
        // Anything other than "it is not there any more" is a real failure and
        // is rethrown for withCalendar to classify.
        if (!(err instanceof GoogleGoneError)) throw err
      }
    }

    const created = await insertEvent(
      token,
      {
        summary:     event.summary,
        description: event.description,
        start:       event.start,
        end:         event.end,
        timeZone:    event.timeZone,
        attendees:   [{ email: event.attendeeEmail, displayName: event.attendeeName }],
        addMeet:     true,
      },
      { calendarId, sendUpdates: 'all' }
    )
    out = { status: 'synced', eventId: created.id, calendarId, meetLink: created.hangoutLink }
  })

  if (result.status === 'skipped') return { status: 'skipped' }
  if (result.status === 'failed')  return { status: 'failed', code: result.code }
  return out
}

/**
 * Move an existing event. `sendUpdates: 'all'` is what makes Google mail both
 * the coach and the client the new time — the closest thing to a reschedule
 * notice that exists without our own sender, and it goes out even when the
 * queue in migration 010 has not been dispatched yet.
 */
export function mirrorReschedule(
  db: SupabaseClient,
  coachSlug: string,
  eventId: string | null,
  calendarId: string | null,
  next: { start: Date; end: Date; timeZone: string }
): Promise<MirrorResult> {
  if (!eventId) return Promise.resolve({ status: 'skipped' })
  return withCalendar(db, coachSlug, (token, defaultCalendar) =>
    patchEvent(
      token,
      eventId,
      { start: next.start, end: next.end, timeZone: next.timeZone },
      { calendarId: calendarId ?? defaultCalendar, sendUpdates: 'all' }
    ).then(() => undefined)
  )
}
