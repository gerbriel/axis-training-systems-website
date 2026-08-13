// Axis Training Systems — shared CORS + response helpers for edge functions.
//
// Origin allowlist, never '*'. `Vary: Origin` is mandatory because the
// Access-Control-Allow-Origin value depends on the request's Origin header and
// these responses may sit behind a shared cache.
//
// Responses carry OPAQUE error codes only. Never put a stringified error, a
// fetch failure (which embeds its request URL — and therefore an OAuth code),
// a token, or an upstream body into a response or a log line.

const DEFAULT_ORIGINS = [
  'https://axistrainingsystems.com',
  'https://www.axistrainingsystems.com',
  'http://localhost:5173',
]

function allowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS') ?? ''
  const list = raw.split(',').map(s => s.trim()).filter(Boolean)
  return list.length > 0 ? list : DEFAULT_ORIGINS
}

export function isAllowedOrigin(origin: string | null): boolean {
  return !!origin && allowedOrigins().includes(origin)
}

// Accepts either the Request (call sites pass `corsHeaders(req)`) or a bare
// origin string. Normalizing here keeps a single signature the whole codebase
// can call without caring which it holds.
export function corsHeaders(reqOrOrigin: Request | string | null): Record<string, string> {
  const origin = reqOrOrigin instanceof Request
    ? reqOrOrigin.headers.get('origin')
    : reqOrOrigin
  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  }
  if (isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin as string
  return headers
}

/** Returns a 204 preflight response for OPTIONS requests, or null to continue. */
export function preflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
  })
}

/**
 * Opaque error response. `code` is a short machine-readable token
 * (e.g. 'slot_taken', 'not_connected', 'bad_request') — never a message
 * derived from an exception.
 */
export function jsonError(req: Request, code: string, status = 400): Response {
  return json(req, { error: code }, status)
}

/** Redirect (OAuth callback). CORS headers are irrelevant on a top-level nav but harmless. */
export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } })
}
