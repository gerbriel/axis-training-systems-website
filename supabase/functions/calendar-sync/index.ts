// Axis Training Systems — Google Calendar busy import (Google -> website)
// Deploy: supabase functions deploy calendar-sync
//
// Two callers, one code path:
//   (a) pg_cron / service role  -> X-Cron-Secret: <CALENDAR_SYNC_CRON_SECRET>  -> every connected coach
//   (b) a signed-in coach       -> Authorization: Bearer <user jwt>            -> that coach only
//
// The coach_slug is NEVER read from the request body (integration invariant 3). For (b) it is
// derived from the verified auth.uid() by current_coach_slug(), which takes no arguments.
//
// (b) is budgeted per coach and fails closed. Every press of "sync now" is a token refresh plus
// a walk of the horizon against Google, and a page stuck retrying is how the whole project gets
// rate-limited off the Calendar API. (a) is exempt: it holds the secret and it IS the schedule.
//
// We call freeBusy, not events.list, so event titles, descriptions and attendees never enter our
// system (invariant 2) — coach_calendar_busy is publicly readable and holds instants and nothing else.
//
// A coach whose Google call fails keeps their PREVIOUS busy cache. Wiping it would silently reopen
// slots they are actually busy for, which is the one failure mode worse than a stale cache. We
// therefore INSERT the fresh generation first and only then DELETE the previous one — if either the
// Google call or the insert fails we never reach the delete, so the old cache survives untouched.
//
// Required Function Secrets:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   GOOGLE_TOKEN_ENC_KEY          base64 32-byte AES-256-GCM key (same key oauth-callback encrypts with)
//   CALENDAR_SYNC_CRON_SECRET
//   BOOKING_HORIZON_WEEKS         optional, default 8 (must match fetchAvailableSlots' weeksAhead)

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { hashedSubject, rateLimitOk } from '../_shared/ratelimit.ts'

const GOOGLE_TOKEN_URL    = 'https://oauth2.googleapis.com/token'
const GOOGLE_FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy'

// Google rejects a freeBusy range longer than ~3 months; chunk well inside that.
const MAX_QUERY_DAYS = 60
const MS_PER_DAY     = 86_400_000

/**
 * "Sync now" budget for the coach-triggered path, per coach, failing CLOSED.
 *
 * The cron path is exempt — it holds the secret and it is the schedule. This is
 * for the button: every press is a token refresh plus up to four freeBusy calls
 * against Google, and the way Axis loses calendar sync for everybody is one
 * coach's page stuck in a retry loop getting the whole project rate-limited off
 * Google. Generous for a person clicking; useless for a loop.
 */
const SYNC_WINDOW_SECONDS = 3_600
const SYNC_LIMIT_PER_COACH = 20

// Google merges abutting busy intervals, so an interval that merely *touches* one of our bookings
// will not be contained by it and is correctly kept. Only a busy block wholly inside a booking we
// created is dropped — that guarantees we can never erase real busy time.
const CONTAINMENT_TOLERANCE_MS = 60_000

interface Interval {
  start: number
  end: number
}

interface CoachResult {
  coach_slug: string
  ok: boolean
  busy_count: number
  error?: string
}

// Shape of a row from public.calendar_connection_get(text) (migration 004).
interface Connection {
  coach_slug:        string
  google_email:      string | null
  refresh_token_enc: string
  calendar_id:       string
  sync_token:        string | null
  last_synced_at:    string | null
}

/** Opaque, non-echoing error. `code` is all the client and the DB ever see (B19). */
class SyncError extends Error {
  constructor(public code: string, public connectionStatus: 'error' | 'revoked' = 'error') {
    super(code)
  }
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Token storage: AES-256-GCM, key in Function Secrets and never in the database.
// Wire format: base64( iv(12 bytes) || ciphertext || tag ) — what oauth-callback writes.
// ---------------------------------------------------------------------------

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

let cachedKey: CryptoKey | null = null

async function encryptionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  const raw = b64ToBytes(Deno.env.get('GOOGLE_TOKEN_ENC_KEY')!)
  cachedKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt'])
  return cachedKey
}

async function decryptRefreshToken(cipherB64: string): Promise<string> {
  try {
    const bytes = b64ToBytes(cipherB64)
    const iv    = bytes.slice(0, 12)
    const body  = bytes.slice(12)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await encryptionKey(), body)
    return new TextDecoder().decode(plain)
  } catch {
    throw new SyncError('token_decrypt_failed')
  }
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

async function fetchAccessToken(refreshToken: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    })
  } catch {
    // A failed fetch stringifies with its request body/URL — never let it escape (B19).
    throw new SyncError('google_unreachable')
  }

  if (!res.ok) {
    let reason = ''
    try {
      reason = ((await res.json()) as { error?: string }).error ?? ''
    } catch { /* body is not JSON; the status is all we need */ }
    console.error('token refresh failed', { status: res.status, error: reason })
    // The coach revoked us in their Google account settings, or the grant expired.
    if (reason === 'invalid_grant') throw new SyncError('google_revoked', 'revoked')
    throw new SyncError('google_token_refresh_failed')
  }

  const body = (await res.json()) as { access_token?: string }
  if (!body.access_token) throw new SyncError('google_token_refresh_failed')
  return body.access_token
}

async function fetchBusyWindow(
  accessToken: string,
  calendarId:  string,
  timeMin:     Date,
  timeMax:     Date
): Promise<Interval[]> {
  let res: Response
  try {
    res = await fetch(GOOGLE_FREEBUSY_URL, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items:   [{ id: calendarId }],
      }),
    })
  } catch {
    throw new SyncError('google_unreachable')
  }

  if (!res.ok) {
    console.error('freeBusy failed', { status: res.status })
    if (res.status === 401 || res.status === 403) throw new SyncError('google_revoked', 'revoked')
    throw new SyncError('google_freebusy_failed')
  }

  const body = (await res.json()) as {
    calendars?: Record<string, {
      busy?:   { start: string; end: string }[]
      errors?: { reason?: string }[]
    }>
  }

  const cal = body.calendars?.[calendarId]
  if (!cal) throw new SyncError('google_freebusy_failed')

  if (cal.errors?.length) {
    const reason = cal.errors[0].reason ?? 'unknown'
    console.error('freeBusy calendar error', { reason })
    if (reason === 'authError' || reason === 'notFound') throw new SyncError('google_revoked', 'revoked')
    throw new SyncError('google_freebusy_failed')
  }

  return (cal.busy ?? [])
    .map(b => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
    .filter(i => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
}

/** freeBusy caps its range, so walk the horizon in chunks and concatenate. */
async function fetchBusy(
  accessToken: string,
  calendarId:  string,
  timeMin:     Date,
  timeMax:     Date
): Promise<Interval[]> {
  const out: Interval[] = []
  let from = timeMin.getTime()
  while (from < timeMax.getTime()) {
    const to = Math.min(from + MAX_QUERY_DAYS * MS_PER_DAY, timeMax.getTime())
    out.push(...await fetchBusyWindow(accessToken, calendarId, new Date(from), new Date(to)))
    from = to
  }
  return out
}

// ---------------------------------------------------------------------------
// Interval algebra
// ---------------------------------------------------------------------------

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged: Interval[] = []
  for (const iv of sorted) {
    const last = merged[merged.length - 1]
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end)
    else merged.push({ ...iv })
  }
  return merged
}

/**
 * Drop the events WE put on the coach's calendar. Website bookings are already represented by
 * the `bookings` table, and availability.ts subtracts them there; re-importing them as Google
 * busy time double-counts the same call. Containment (not overlap) is the test: if Google merged
 * our event with a neighbouring personal event, the merged block is not contained and is kept.
 */
function excludeOwnBookings(busy: Interval[], bookings: Interval[]): Interval[] {
  if (bookings.length === 0) return busy
  return busy.filter(b => !bookings.some(bk =>
    b.start >= bk.start - CONTAINMENT_TOLERANCE_MS &&
    b.end   <= bk.end   + CONTAINMENT_TOLERANCE_MS
  ))
}

// ---------------------------------------------------------------------------
// Per-coach sync
// ---------------------------------------------------------------------------

async function syncCoach(
  // deno-lint-ignore no-explicit-any
  db:         any,
  conn:       Connection,
  timeMin:    Date,
  timeMax:    Date
): Promise<CoachResult> {
  try {
    const refreshToken = await decryptRefreshToken(conn.refresh_token_enc)
    const accessToken  = await fetchAccessToken(refreshToken)
    const raw          = await fetchBusy(accessToken, conn.calendar_id, timeMin, timeMax)

    const { data: bookingRows, error: bookingsErr } = await db
      .from('bookings')
      .select('booked_at,ends_at')
      .eq('coach_slug', conn.coach_slug)
      .neq('status', 'cancelled')
      .not('google_event_id', 'is', null)
      .gte('ends_at', timeMin.toISOString())
      .lte('booked_at', timeMax.toISOString())

    if (bookingsErr) throw new SyncError('db_read_failed')

    const ours = (bookingRows ?? []).map((b: { booked_at: string; ends_at: string }) => ({
      start: Date.parse(b.booked_at),
      end:   Date.parse(b.ends_at),
    }))

    const busy = mergeIntervals(excludeOwnBookings(raw, ours))

    // Replace this coach's future Google-sourced busy rows with the fresh set.
    // There is no calendar_sync_apply RPC; service_role bypasses RLS and keeps its
    // grant on coach_calendar_busy, so we write it directly. INSERT-then-DELETE
    // (not delete-then-insert) so a failed write can never wipe the cache and
    // reopen slots the coach is actually busy for — the old generation survives
    // until the new one is safely committed. `synced_at` tags the generation:
    // the prune below removes only rows written before this run.
    const syncedAt = new Date().toISOString()

    if (busy.length > 0) {
      const { error: insErr } = await db.from('coach_calendar_busy').insert(
        busy.map(i => ({
          coach_slug: conn.coach_slug,
          starts_at:  new Date(i.start).toISOString(),
          ends_at:    new Date(i.end).toISOString(),
          source:     'google',
          synced_at:  syncedAt,
        }))
      )
      if (insErr) {
        console.error('busy insert failed', { code: insErr.code })
        throw new SyncError('db_apply_failed')
      }
    }

    // Drop the previous generation: this coach's Google rows in the sync window
    // written before this run. Unreached if the insert above threw, so a failure
    // leaves the prior cache intact.
    const { error: pruneErr } = await db
      .from('coach_calendar_busy')
      .delete()
      .eq('coach_slug', conn.coach_slug)
      .eq('source', 'google')
      .gte('ends_at', timeMin.toISOString())
      .lt('synced_at', syncedAt)
    if (pruneErr) {
      console.error('busy prune failed', { code: pruneErr.code })
      throw new SyncError('db_apply_failed')
    }

    // Record success: advances last_synced_at and clears last_sync_error.
    const { error: markErr } = await db.rpc('calendar_connection_mark_synced', {
      p_coach_slug: conn.coach_slug,
      p_sync_token: null,
      p_error:      null,
    })
    if (markErr) console.error('mark_synced failed', { code: markErr.code })

    return { coach_slug: conn.coach_slug, ok: true, busy_count: busy.length }
  } catch (err) {
    const e = err instanceof SyncError ? err : new SyncError('sync_failed')

    // Best-effort: the cache stays exactly as it was; we only record why it is
    // stale. p_error is an OPAQUE SHORT CODE (B19), never a stringified error.
    const { error: markErr } = await db.rpc('calendar_connection_mark_synced', {
      p_coach_slug: conn.coach_slug,
      p_sync_token: null,
      p_error:      e.code,
    })
    if (markErr) console.error('mark_synced (fail) failed', { code: markErr.code })

    return { coach_slug: conn.coach_slug, ok: false, busy_count: 0, error: e.code }
  }
}

// ---------------------------------------------------------------------------
// Caller identity
// ---------------------------------------------------------------------------

/** The signed-in coach's own slug, derived server-side from the verified JWT. Never from the body. */
async function coachSlugFromJwt(authHeader: string): Promise<string | null> {
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
  )

  // current_coach_slug() is granted to `authenticated`, takes no arguments, and
  // derives the slug from the verified auth.email() — so the caller cannot forge
  // another coach's identity, and anon gets null by construction. It returns a
  // scalar text (the RPC result is the slug string, or null when not a coach).
  const { data, error } = await asCaller.rpc('current_coach_slug')
  if (error) {
    console.error('current_coach_slug failed', { code: error.code })
    return null
  }

  return typeof data === 'string' && data.length > 0 ? data : null
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const cors = corsHeaders(req)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405, cors)

  const cronSecret = Deno.env.get('CALENDAR_SYNC_CRON_SECRET') ?? ''
  const presented  = req.headers.get('x-cron-secret') ?? ''
  const isCron     = cronSecret.length > 0 && timingSafeEqual(presented, cronSecret)

  let coachSlug: string | null = null
  if (!isCron) {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, cors)

    coachSlug = await coachSlugFromJwt(authHeader)
    if (!coachSlug) return json({ error: 'forbidden' }, 403, cors)
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  // Only the coach-triggered path. The slug came from the verified JWT above, so
  // this is a budget per coach and not per address — the same coach on a laptop
  // and a phone shares it, which is the intent.
  if (coachSlug) {
    const ok = await rateLimitOk(
      db, 'calendar-sync-manual', await hashedSubject(coachSlug),
      SYNC_WINDOW_SECONDS, SYNC_LIMIT_PER_COACH,
    )
    if (!ok) return json({ error: 'rate_limited' }, 429, cors)
  }

  const weeksAhead = Number(Deno.env.get('BOOKING_HORIZON_WEEKS') ?? '8') || 8
  const timeMin    = new Date()
  const timeMax    = new Date(timeMin.getTime() + weeksAhead * 7 * MS_PER_DAY)

  // Build the worklist of coach slugs. calendar_connection_get filters on an
  // EXACT slug (`where coach_slug = p_coach_slug`), so a null slug matches zero
  // rows — the all-coaches worklist must come from calendar_connection_list().
  let slugs: string[]
  if (coachSlug) {
    slugs = [coachSlug]
  } else {
    const { data: listRows, error: listErr } = await db.rpc('calendar_connection_list')
    if (listErr) {
      console.error('calendar_connection_list failed', { code: listErr.code })
      return json({ error: 'db_read_failed' }, 500, cors)
    }
    slugs = ((listRows ?? []) as { coach_slug: string }[]).map(r => r.coach_slug)
  }

  // Sequential on purpose: one coach's Google failure must not abort the run, and a burst of
  // parallel token refreshes is the fastest way to get rate-limited off Google.
  const results: CoachResult[] = []
  for (const slug of slugs) {
    // The credential (with the encrypted refresh token) is fetched one coach at a
    // time; calendar_connection_list() returns slugs only, never a token.
    const { data: connRows, error: connErr } = await db.rpc('calendar_connection_get', {
      p_coach_slug: slug,
    })
    if (connErr) {
      console.error('calendar_connection_get failed', { code: connErr.code })
      results.push({ coach_slug: slug, ok: false, busy_count: 0, error: 'db_read_failed' })
      continue
    }

    const conn = ((connRows ?? []) as Connection[])[0]
    // A coach with no connection (or none since consumed between list and get) is
    // a fully supported state, not an error (invariant 4) — skip silently.
    if (!conn || !conn.refresh_token_enc) continue

    results.push(await syncCoach(db, conn, timeMin, timeMax))
  }

  return json({
    ok:      results.every(r => r.ok),
    synced:  results.filter(r => r.ok).length,
    failed:  results.filter(r => !r.ok).length,
    results,
  }, 200, cors)
})
