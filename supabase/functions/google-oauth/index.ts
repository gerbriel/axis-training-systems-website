// Axis Training Systems — Google Calendar OAuth
// Deploy: supabase functions deploy google-oauth --no-verify-jwt
//
// verify_jwt MUST be false for this function (see supabase/config.toml). The
// /callback leg is a top-level browser redirect from Google and carries no
// Supabase JWT. The /start, /disconnect and /status legs therefore verify the
// caller's JWT explicitly (auth.getUser) and derive coach_slug server-side from
// coach_routing — a coach_slug in a query string is never trusted.
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI,
//          GOOGLE_TOKEN_ENC_KEY, ALLOWED_ORIGINS,
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { encryptToken, decryptToken } from '../_shared/db.ts'

const GOOGLE_AUTH_URL   = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const GOOGLE_CHANNELS_STOP_URL = 'https://www.googleapis.com/calendar/v3/channels/stop'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
].join(' ')

const CALENDAR_ID = 'primary'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CLIENT_ID         = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const CLIENT_SECRET     = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const REDIRECT_URI      = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI') ?? `${SUPABASE_URL}/functions/v1/google-oauth/callback`

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean)

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'not_a_coach'
  | 'invalid_redirect'
  | 'invalid_state'
  | 'oauth_denied'
  | 'exchange_failed'
  | 'no_refresh_token'
  | 'not_connected'
  | 'server_error'

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function fail(req: Request, code: ErrorCode, status: number): Response {
  return json(req, { error: code }, status)
}

// No safe redirect target is known when the state row is unusable, so the
// browser gets an opaque terminal page rather than a redirect.
function terminal(code: ErrorCode, status: number): Response {
  return new Response(code, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

function redirect(target: string): Response {
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } })
}

function isAllowedRedirect(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    return ALLOWED_ORIGINS.includes(u.origin.replace(/\/$/, ''))
  } catch {
    return false
  }
}

function withParam(raw: string, key: string, value: string): string {
  const u = new URL(raw)
  u.searchParams.set(key, value)
  return u.toString()
}

async function coachSlugFromJwt(req: Request): Promise<{ slug: string | null; authed: boolean }> {
  const header = req.headers.get('Authorization') ?? ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return { slug: null, authed: false }

  const { data, error } = await admin.auth.getUser(token)
  const email = data?.user?.email
  if (error || !email) return { slug: null, authed: false }

  const { data: route } = await admin
    .from('coach_routing')
    .select('coach_slug')
    .ilike('email', email)
    .maybeSingle()

  return { slug: route?.coach_slug ?? null, authed: true }
}

function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const claims = JSON.parse(atob(padded)) as { email?: string }
    return claims.email ?? null
  } catch {
    return null
  }
}

// ── start ────────────────────────────────────────────────────────────────────
async function handleStart(req: Request): Promise<Response> {
  const { slug, authed } = await coachSlugFromJwt(req)
  if (!authed) return fail(req, 'unauthorized', 401)
  if (!slug)   return fail(req, 'not_a_coach', 403)

  let requested = ''
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    requested = typeof body?.redirect_to === 'string' ? body.redirect_to : ''
  } else {
    requested = new URL(req.url).searchParams.get('redirect_to') ?? ''
  }

  const origin = req.headers.get('Origin') ?? ''
  const fallback = isAllowedRedirect(origin) ? `${origin.replace(/\/$/, '')}/` : ''
  const redirectTo = requested || fallback
  if (!redirectTo || !isAllowedRedirect(redirectTo)) return fail(req, 'invalid_redirect', 400)

  // oauth_state_create is a SECURITY DEFINER RPC — the private.oauth_states table
  // is unreachable via PostgREST by design. It generates the state and returns it.
  const { data: state, error } = await admin.rpc('oauth_state_create', {
    p_coach_slug:  slug,
    p_redirect_to: redirectTo,
  })
  if (error || !state) {
    console.error('[google-oauth] state create failed', error?.code)
    return fail(req, 'server_error', 500)
  }

  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)

  return json(req, { url: url.toString() })
}

// ── callback ─────────────────────────────────────────────────────────────────
// The state row is the ONLY binding between the Google account and a coach_slug.
async function handleCallback(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams
  const state  = params.get('state') ?? ''
  const code   = params.get('code') ?? ''
  const denied = params.get('error')

  if (!state) return terminal('invalid_state', 400)

  // oauth_state_consume is the SINGLE-USE atomic test-and-set for the private
  // state row (the private schema is unreachable via PostgREST). Zero rows means
  // the state was replayed, expired, or never existed → abort.
  const { data: consumed, error: stateErr } = await admin.rpc('oauth_state_consume', {
    p_state: state,
  })
  if (stateErr) {
    console.error('[google-oauth] state consume failed', stateErr.code)
    return terminal('server_error', 500)
  }
  const stateRow = (Array.isArray(consumed) ? consumed[0] : consumed) as {
    coach_slug?: string
    redirect_to?: string
  } | null | undefined
  if (!stateRow?.coach_slug) return terminal('invalid_state', 400)

  const coachSlug = stateRow.coach_slug
  const back = isAllowedRedirect(stateRow.redirect_to as string)
    ? (stateRow.redirect_to as string)
    : ''
  if (!back) return terminal('invalid_redirect', 400)

  const errorBack = (reason: ErrorCode) =>
    redirect(withParam(withParam(back, 'calendar', 'error'), 'reason', reason))

  if (denied) return errorBack('oauth_denied')
  if (!code)  return errorBack('oauth_denied')

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    console.error('[google-oauth] token exchange status', tokenRes.status)
    return errorBack('exchange_failed')
  }

  const tokens = await tokenRes.json().catch(() => null) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    id_token?: string
  } | null

  if (!tokens?.access_token) return errorBack('exchange_failed')
  if (!tokens.refresh_token) return errorBack('no_refresh_token')

  const googleEmail = emailFromIdToken(tokens.id_token)

  try {
    // Only the refresh token is persisted; the sync path re-derives short-lived
    // access tokens from it. Arg names match calendar_connection_upsert (004:349).
    const { error } = await admin.rpc('calendar_connection_upsert', {
      p_coach_slug:        coachSlug,
      p_refresh_token_enc: await encryptToken(tokens.refresh_token),
      p_google_email:      googleEmail,
      p_calendar_id:       CALENDAR_ID,
      p_scopes:            tokens.scope ?? SCOPES,
    })
    if (error) {
      console.error('[google-oauth] connection upsert failed', error.code)
      return errorBack('server_error')
    }
  } catch {
    console.error('[google-oauth] connection upsert threw')
    return errorBack('server_error')
  }

  return redirect(withParam(back, 'calendar', 'connected'))
}

// ── disconnect ───────────────────────────────────────────────────────────────
async function handleDisconnect(req: Request): Promise<Response> {
  const { slug, authed } = await coachSlugFromJwt(req)
  if (!authed) return fail(req, 'unauthorized', 401)
  if (!slug)   return fail(req, 'not_a_coach', 403)

  const { data: conn, error: getErr } = await admin.rpc('calendar_connection_get', {
    p_coach_slug: slug,
  })
  if (getErr) {
    console.error('[google-oauth] connection get failed', getErr.code)
    return fail(req, 'server_error', 500)
  }

  const row = (Array.isArray(conn) ? conn[0] : conn) as {
    refresh_token_enc?: string
    channel_id?: string | null
    channel_resource_id?: string | null
  } | null | undefined

  if (row?.refresh_token_enc) {
    let refreshToken = ''
    try {
      refreshToken = await decryptToken(row.refresh_token_enc)
    } catch {
      console.error('[google-oauth] refresh token decrypt failed')
    }

    if (refreshToken) {
      // Stop the (unused in v1) push channel before the credential dies, so the
      // channel cannot outlive our ability to authenticate against it.
      if (row.channel_id && row.channel_resource_id) {
        const accessToken = await accessTokenFromRefresh(refreshToken)
        if (accessToken) {
          const stopRes = await fetch(GOOGLE_CHANNELS_STOP_URL, {
            method: 'POST',
            headers: {
              Authorization:  `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ id: row.channel_id, resourceId: row.channel_resource_id }),
          })
          if (!stopRes.ok) console.error('[google-oauth] channels.stop status', stopRes.status)
        }
      }

      const revokeRes = await fetch(GOOGLE_REVOKE_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({ token: refreshToken }),
      })
      if (!revokeRes.ok) console.error('[google-oauth] revoke status', revokeRes.status)
    }
  }

  const { error: delErr } = await admin.rpc('calendar_connection_delete', { p_coach_slug: slug })
  if (delErr) {
    console.error('[google-oauth] connection delete failed', delErr.code)
    return fail(req, 'server_error', 500)
  }

  const { error: busyErr } = await admin
    .from('coach_calendar_busy')
    .delete()
    .eq('coach_slug', slug)
  if (busyErr) {
    console.error('[google-oauth] busy purge failed', busyErr.code)
    return fail(req, 'server_error', 500)
  }

  return json(req, { ok: true, connected: false })
}

async function accessTokenFromRefresh(refreshToken: string): Promise<string | null> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type:    'refresh_token',
    }),
  })
  if (!res.ok) {
    console.error('[google-oauth] refresh status', res.status)
    return null
  }
  const body = await res.json().catch(() => null) as { access_token?: string } | null
  return body?.access_token ?? null
}

// ── status ───────────────────────────────────────────────────────────────────
async function handleStatus(req: Request): Promise<Response> {
  const header = req.headers.get('Authorization') ?? ''
  if (!header.startsWith('Bearer ')) return fail(req, 'unauthorized', 401)

  const asCoach = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth:   { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: header } },
  })

  const { slug, authed } = await coachSlugFromJwt(req)
  if (!authed) return fail(req, 'unauthorized', 401)
  if (!slug)   return fail(req, 'not_a_coach', 403)

  const { data, error } = await asCoach.rpc('calendar_connection_status')
  if (error) {
    console.error('[google-oauth] status rpc failed', error.code)
    return fail(req, 'server_error', 500)
  }

  // calendar_connection_status() returns zero rows when the coach has no connection,
  // so the presence of a row IS the connected bit.
  const row = (Array.isArray(data) ? data[0] : data) as {
    google_email?: string | null
    calendar_id?: string | null
    connected_at?: string | null
    last_synced_at?: string | null
    last_sync_error?: string | null
  } | null | undefined

  return json(req, {
    connected:       !!row,
    google_email:    row?.google_email    ?? null,
    calendar_id:     row?.calendar_id     ?? null,
    connected_at:    row?.connected_at    ?? null,
    last_synced_at:  row?.last_synced_at  ?? null,
    last_sync_error: row?.last_sync_error ?? null,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })

  const action = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? ''

  try {
    switch (action) {
      case 'start':      return await handleStart(req)
      case 'callback':   return await handleCallback(req)
      case 'disconnect': return await handleDisconnect(req)
      case 'status':     return await handleStatus(req)
      default:           return fail(req, 'bad_request', 404)
    }
  } catch {
    console.error('[google-oauth] unhandled error in', action)
    return fail(req, 'server_error', 500)
  }
})
