// Axis Training Systems — Google OAuth + Calendar API client.
//
// Plain fetch(). No googleapis SDK, no esm.sh shim.
//
// Hard rules:
//   • A token — access or refresh — is NEVER logged, NEVER returned to a client,
//     NEVER embedded in an Error message. Errors carry status + Google's `reason`
//     only. `String(err)` on a failed fetch stringifies its request URL, which on
//     the token endpoint carries the auth code — so we never stringify one either.
//   • Data minimization: we call freeBusy, not events.list. Event titles and
//     attendees from a coach's personal calendar never enter our system.
//   • A revoked coach (invalid_grant) is a STATE, not an exception: callers get a
//     typed GoogleRevokedError to record and surface, not an unhandled throw.

const TOKEN_URL    = 'https://oauth2.googleapis.com/token'
const AUTH_URL     = 'https://accounts.google.com/o/oauth2/v2/auth'
const REVOKE_URL   = 'https://oauth2.googleapis.com/revoke'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
]

/** Refresh when the stored access token expires within this window. */
const EXPIRY_SKEW_MS = 60_000

const MAX_ATTEMPTS = 4

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/** A Google API call failed. `message` is an opaque code — safe to log, never a body. */
export class GoogleApiError extends Error {
  readonly status: number
  readonly reason: string
  constructor(status: number, reason: string) {
    super(`google_api_error:${status}:${reason}`)
    this.name   = 'GoogleApiError'
    this.status = status
    this.reason = reason
  }
}

/** The coach revoked access (or the refresh token was expired/invalidated). Terminal. */
export class GoogleRevokedError extends Error {
  constructor() {
    super('google_revoked')
    this.name = 'GoogleRevokedError'
  }
}

/** The Google resource is gone (410) — e.g. the coach deleted the event by hand. Terminal, benign. */
export class GoogleGoneError extends Error {
  constructor() {
    super('google_gone')
    this.name = 'GoogleGoneError'
  }
}

export function isTerminalGoogleError(err: unknown): boolean {
  return err instanceof GoogleRevokedError || err instanceof GoogleGoneError
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth
// ─────────────────────────────────────────────────────────────────────────────

export interface GoogleTokens {
  accessToken:   string
  refreshToken:  string | null
  /** Absolute instant the access token expires. */
  expiresAt:     Date
  scope:         string
  tokenType:     string
  /** Present on the initial exchange when `openid email` was requested. */
  idToken:       string | null
}

function clientId(): string     { return Deno.env.get('GOOGLE_CLIENT_ID')     ?? '' }
function clientSecret(): string { return Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '' }
function redirectUri(): string  { return Deno.env.get('GOOGLE_REDIRECT_URI')  ?? '' }

/** The consent URL. `state` is the single-use state row's opaque id. */
export function buildAuthUrl(state: string, loginHint?: string): string {
  const params = new URLSearchParams({
    client_id:              clientId(),
    redirect_uri:           redirectUri(),
    response_type:          'code',
    scope:                  GOOGLE_SCOPES.join(' '),
    access_type:            'offline',
    prompt:                 'consent',
    include_granted_scopes: 'true',
    state,
  })
  if (loginHint) params.set('login_hint', loginHint)
  return `${AUTH_URL}?${params.toString()}`
}

interface TokenResponse {
  access_token?:  string
  refresh_token?: string
  expires_in?:    number
  scope?:         string
  token_type?:    string
  id_token?:      string
  error?:         string
}

async function postToken(body: URLSearchParams): Promise<GoogleTokens> {
  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch {
    // Deliberately swallowing the cause: a fetch failure stringifies with its
    // request URL, and this request body carries the auth code / refresh token.
    throw new GoogleApiError(0, 'network')
  }

  let payload: TokenResponse = {}
  try { payload = await res.json() as TokenResponse } catch { /* keep {} */ }

  if (!res.ok || !payload.access_token) {
    if (payload.error === 'invalid_grant') throw new GoogleRevokedError()
    throw new GoogleApiError(res.status, payload.error ?? 'token_failed')
  }

  return {
    accessToken:  payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt:    new Date(Date.now() + (payload.expires_in ?? 3600) * 1000),
    scope:        payload.scope ?? '',
    tokenType:    payload.token_type ?? 'Bearer',
    idToken:      payload.id_token ?? null,
  }
}

export function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  return postToken(new URLSearchParams({
    code,
    client_id:     clientId(),
    client_secret: clientSecret(),
    redirect_uri:  redirectUri(),
    grant_type:    'authorization_code',
  }))
}

/** Throws GoogleRevokedError on invalid_grant — the coach pulled access. */
export function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  return postToken(new URLSearchParams({
    refresh_token: refreshToken,
    client_id:     clientId(),
    client_secret: clientSecret(),
    grant_type:    'refresh_token',
  }))
}

/** Best-effort. Google returns 400 for an already-revoked token; that is success for us. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ token }),
    })
  } catch {
    // no-op: revocation is advisory, and the cause may carry the token
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Access-token cache
//
// Module scope, so it survives across invocations of a warm isolate. Mutex-free:
// two concurrent refreshes for the same coach are harmless — Google keeps prior
// access tokens valid, and the persist callback is idempotent (last write wins).
//
// KEYED ON THE CREDENTIAL, NOT ON THE COACH. It used to be keyed on coachSlug
// alone, and that is wrong across a reconnect: a coach who disconnects and
// reconnects with a DIFFERENT Google account gets a new refresh token, but a warm
// isolate holding the old slug entry would keep handing out the old account's
// access token for up to an hour — and 'primary' resolves on whichever account
// the token belongs to. A client's booking, with their name and email on it, gets
// written to the calendar the coach just walked away from. A new credential is a
// new key, so the stale entry is simply never consulted again.
// ─────────────────────────────────────────────────────────────────────────────

interface CachedToken { accessToken: string; expiresAt: number }

const tokenCache = new Map<string, CachedToken>()

/**
 * The refresh token is DIGESTED, not stored. The map lives in the same process
 * as the plaintext either way, but a key that is not itself a credential cannot
 * be leaked by anything that dumps a map.
 */
async function cacheKey(conn: StoredConnection): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(conn.refreshToken),
  )
  const tag = [...new Uint8Array(digest)].slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0')).join('')
  return `${conn.coachSlug}:${tag}`
}

export interface StoredConnection {
  coachSlug:    string
  accessToken:  string | null
  refreshToken: string
  /** Absolute instant the stored access token expires; null = unknown, refresh now. */
  expiresAt:    Date | null
}

/** Called with a freshly minted access token so the caller can persist it (encrypted). */
export type PersistToken = (coachSlug: string, accessToken: string, expiresAt: Date) => Promise<void>

function isFresh(expiresAt: Date | number | null): boolean {
  if (!expiresAt) return false
  const ms = expiresAt instanceof Date ? expiresAt.getTime() : expiresAt
  return ms - Date.now() > EXPIRY_SKEW_MS
}

/**
 * Returns a usable access token, refreshing if it expires within 60s.
 * Throws GoogleRevokedError if the coach revoked access — the caller marks the
 * connection revoked and surfaces it; it never becomes an unhandled error.
 */
export async function getAccessToken(conn: StoredConnection, persist?: PersistToken): Promise<string> {
  const key = await cacheKey(conn)

  const cached = tokenCache.get(key)
  if (cached && isFresh(cached.expiresAt)) return cached.accessToken

  if (conn.accessToken && isFresh(conn.expiresAt)) {
    tokenCache.set(key, {
      accessToken: conn.accessToken,
      expiresAt:   (conn.expiresAt as Date).getTime(),
    })
    return conn.accessToken
  }

  const tokens = await refreshAccessToken(conn.refreshToken)
  tokenCache.set(key, {
    accessToken: tokens.accessToken,
    expiresAt:   tokens.expiresAt.getTime(),
  })
  if (persist) await persist(conn.coachSlug, tokens.accessToken, tokens.expiresAt)
  return tokens.accessToken
}

/**
 * Drop every cached access token for a coach (on revoke / disconnect).
 *
 * A prefix sweep, because the key is now `slug:credential-digest` and the caller
 * disconnecting knows the slug but not which credential is cached under it.
 */
export function invalidateTokenCache(coachSlug: string): void {
  const prefix = `${coachSlug}:`
  for (const key of [...tokenCache.keys()]) {
    if (key.startsWith(prefix)) tokenCache.delete(key)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar API
// ─────────────────────────────────────────────────────────────────────────────

interface GoogleErrorBody {
  error?: {
    code?:    number
    status?:  string
    message?: string
    errors?:  { reason?: string }[]
  }
  error_description?: string
}

function reasonOf(status: number, body: GoogleErrorBody): string {
  return body.error?.errors?.[0]?.reason ?? body.error?.status ?? `http_${status}`
}

const RETRYABLE_403 = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'backendError',
])

function isRetryable(status: number, reason: string): boolean {
  if (status === 429) return true
  if (status >= 500) return true
  if (status === 403 && RETRYABLE_403.has(reason)) return true
  return false
}

/** Exponential backoff with full jitter: ~0.5s, 1s, 2s (capped 8s). */
function backoffMs(attempt: number): number {
  const base = Math.min(500 * 2 ** (attempt - 1), 8_000)
  return Math.round(base / 2 + Math.random() * (base / 2))
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function calendarFetch<T>(
  accessToken: string,
  path: string,
  init: RequestInit & { query?: Record<string, string> } = {},
): Promise<T | null> {
  const { query, ...rest } = init
  const qs  = query ? `?${new URLSearchParams(query).toString()}` : ''
  const url = `${CALENDAR_API}${path}${qs}`

  for (let attempt = 1; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        ...rest,
        headers: {
          ...(rest.headers as Record<string, string> | undefined),
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })
    } catch {
      if (attempt >= MAX_ATTEMPTS) throw new GoogleApiError(0, 'network')
      await sleep(backoffMs(attempt))
      continue
    }

    if (res.status === 204) return null
    if (res.ok) return await res.json() as T

    let body: GoogleErrorBody = {}
    try { body = await res.json() as GoogleErrorBody } catch { /* keep {} */ }
    const reason = reasonOf(res.status, body)

    // 401: the access token is dead. The caller holds the cache; it is cheaper to
    // treat this as revoked-until-proven-otherwise than to re-enter the refresh
    // path from inside a request loop. Callers refresh + retry once at their level.
    if (res.status === 401) throw new GoogleApiError(401, 'unauthorized')
    if (res.status === 410) throw new GoogleGoneError()
    if (res.status === 403 && !RETRYABLE_403.has(reason)) throw new GoogleApiError(403, reason)

    if (isRetryable(res.status, reason) && attempt < MAX_ATTEMPTS) {
      await sleep(backoffMs(attempt))
      continue
    }

    throw new GoogleApiError(res.status, reason)
  }
}

export interface BusyInterval { start: Date; end: Date }

/**
 * freeBusy.query on the coach's primary calendar. Returns busy INSTANTS only —
 * no titles, no attendees, nothing that could leak back out of our system.
 */
export async function freeBusyQuery(
  accessToken: string,
  opts: { timeMin: Date; timeMax: Date; timeZone: string; calendarId?: string },
): Promise<BusyInterval[]> {
  const calendarId = opts.calendarId ?? 'primary'

  const data = await calendarFetch<{
    calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }>
  }>(accessToken, '/freeBusy', {
    method: 'POST',
    body:   JSON.stringify({
      timeMin:  opts.timeMin.toISOString(),
      timeMax:  opts.timeMax.toISOString(),
      timeZone: opts.timeZone,
      items:    [{ id: calendarId }],
    }),
  })

  const cal = data?.calendars?.[calendarId]
  if (cal?.errors?.length) throw new GoogleApiError(403, cal.errors[0]?.reason ?? 'freebusy_failed')

  return (cal?.busy ?? []).map(b => ({ start: new Date(b.start), end: new Date(b.end) }))
}

export interface GoogleEventInput {
  summary:      string
  description?: string
  /** Absolute instants. `timeZone` is the coach's IANA zone so the event survives DST. */
  start:        Date
  end:          Date
  timeZone:     string
  attendees?:   { email: string; displayName?: string }[]
  /** Request a Google Meet link on insert. */
  addMeet?:     boolean
}

export interface GoogleEvent {
  id:           string
  htmlLink:     string | null
  hangoutLink:  string | null
  status:       string | null
}

type SendUpdates = 'all' | 'externalOnly' | 'none'

interface RawEvent {
  id?:          string
  htmlLink?:    string
  hangoutLink?: string
  status?:      string
}

function eventBody(input: GoogleEventInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary:     input.summary,
    description: input.description ?? '',
    start:       { dateTime: input.start.toISOString(), timeZone: input.timeZone },
    end:         { dateTime: input.end.toISOString(),   timeZone: input.timeZone },
    attendees:   input.attendees ?? [],
  }
  if (input.addMeet) {
    body.conferenceData = {
      createRequest: {
        requestId:             crypto.randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    }
  }
  return body
}

function toEvent(raw: RawEvent | null): GoogleEvent {
  return {
    id:          raw?.id ?? '',
    htmlLink:    raw?.htmlLink ?? null,
    hangoutLink: raw?.hangoutLink ?? null,
    status:      raw?.status ?? null,
  }
}

export async function insertEvent(
  accessToken: string,
  input: GoogleEventInput,
  opts: { calendarId?: string; sendUpdates?: SendUpdates } = {},
): Promise<GoogleEvent> {
  const calendarId = opts.calendarId ?? 'primary'
  const raw = await calendarFetch<RawEvent>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      query:  {
        conferenceDataVersion: input.addMeet ? '1' : '0',
        sendUpdates:           opts.sendUpdates ?? 'all',
      },
      body:   JSON.stringify(eventBody(input)),
    },
  )
  return toEvent(raw)
}

/** Partial update — reschedule, retitle, or mark cancelled. 410 => GoogleGoneError. */
export async function patchEvent(
  accessToken: string,
  eventId: string,
  patch: Partial<GoogleEventInput> & { status?: 'confirmed' | 'cancelled' },
  opts: { calendarId?: string; sendUpdates?: SendUpdates } = {},
): Promise<GoogleEvent> {
  const calendarId = opts.calendarId ?? 'primary'

  const body: Record<string, unknown> = {}
  if (patch.summary     !== undefined) body.summary     = patch.summary
  if (patch.description !== undefined) body.description = patch.description
  if (patch.status      !== undefined) body.status      = patch.status
  if (patch.attendees   !== undefined) body.attendees   = patch.attendees
  if (patch.start && patch.timeZone) body.start = { dateTime: patch.start.toISOString(), timeZone: patch.timeZone }
  if (patch.end   && patch.timeZone) body.end   = { dateTime: patch.end.toISOString(),   timeZone: patch.timeZone }

  const raw = await calendarFetch<RawEvent>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      query:  { sendUpdates: opts.sendUpdates ?? 'all' },
      body:   JSON.stringify(body),
    },
  )
  return toEvent(raw)
}

/** Idempotent: an event that is already gone (404/410) is a success, not a failure. */
export async function deleteEvent(
  accessToken: string,
  eventId: string,
  opts: { calendarId?: string; sendUpdates?: SendUpdates } = {},
): Promise<void> {
  const calendarId = opts.calendarId ?? 'primary'
  try {
    await calendarFetch<null>(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        query:  { sendUpdates: opts.sendUpdates ?? 'all' },
      },
    )
  } catch (err) {
    if (err instanceof GoogleGoneError) return
    if (err instanceof GoogleApiError && err.status === 404) return
    throw err
  }
}

/** Safe-to-log summary of any error. Never includes a token, a body, or a URL. */
export function describeError(err: unknown): string {
  if (err instanceof GoogleRevokedError) return 'google_revoked'
  if (err instanceof GoogleGoneError)    return 'google_gone'
  if (err instanceof GoogleApiError)     return `google_api_error:${err.status}:${err.reason}`
  if (err instanceof Error)              return `error:${err.name}`
  return 'error:unknown'
}
