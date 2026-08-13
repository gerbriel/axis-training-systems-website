// Axis Training Systems — request budgeting for the public endpoints.
//
// Fixed window, counted by an atomic upsert in `rate_limit_hit` (migration 010).
// The bucket is part of the primary key, so Postgres serialises the increment
// for us — two requests arriving together are counted twice rather than both
// reading 4 and both writing 5.

/**
 * The only thing this module needs from a Supabase client, written out rather
 * than imported.
 *
 * `SupabaseClient` behaves nominally: the class carries protected members, so an
 * instance built from `esm.sh/@supabase/supabase-js` is not assignable to the
 * type imported from `npm:@supabase/supabase-js` even though they are the same
 * library at the same version. The functions in this directory each pick the
 * specifier that suits them — npm:, esm.sh and jsr: are all in use — and a
 * limiter that makes exactly one RPC call has no business forcing that choice.
 */
export interface RateLimitClient {
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args?: any): PromiseLike<{ data: unknown; error: unknown }>
}

/**
 * The caller's address, as well as this runtime can know it.
 *
 * ORDER MATTERS, AND IT USED TO BE BACKWARDS. This read `x-forwarded-for` first
 * and took element [0]. A proxy chain APPENDS to that header, so element [0] is
 * whatever the client put there before the edge ever saw the request — one
 * invented `X-Forwarded-For: 1.2.3.4` gave the caller a brand new bucket, and a
 * different one on every request gave them an unlimited number. Every per-IP
 * budget in this codebase was a formality.
 *
 * `cf-connecting-ip` is written by the edge itself and a client copy is
 * overwritten, so it is the one header here that is a fact. The forwarded chain
 * is the fallback and is read from the END, which is the hop the nearest trusted
 * proxy added rather than the one the client chose.
 */
function clientAddress(req: Request): string {
  const direct = req.headers.get('cf-connecting-ip')?.trim()
  if (direct) return direct

  const hops = (req.headers.get('x-forwarded-for') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
  if (hops.length > 0) return hops[hops.length - 1]

  return 'unknown'
}

/**
 * Salted digest of anything used as a limiter subject.
 *
 * A rate-limit table is not a place to keep a log of who visited, and a digest
 * counts requests exactly as well as the value itself does. RATE_LIMIT_SALT is a
 * Function Secret; without it the digest is still per-deployment stable, just not
 * resistant to somebody who already holds the table and wants to confirm a guess.
 */
async function saltedDigest(value: string): Promise<string> {
  const salt = Deno.env.get('RATE_LIMIT_SALT') ?? 'axis-booking'
  const bytes = new TextEncoder().encode(`${salt}:${value}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Who is asking, as an opaque string. The address is hashed before it is stored. */
export function requestSubject(req: Request): Promise<string> {
  return saltedDigest(clientAddress(req))
}

/**
 * A limiter subject that is not an address — a client's email, most of the
 * time. Hashed for the same reason and with the same salt: `rate_limit_hit` is
 * readable by anything holding service_role and has no business being a list of
 * everyone who has ever tried to book.
 */
export function hashedSubject(value: string): Promise<string> {
  return saltedDigest(value.trim().toLowerCase())
}

/**
 * FAILS CLOSED by default. Most limiters let requests through when the limiter
 * itself is broken, on the grounds that a limiter outage should not be an
 * outage. These guard writes to a real calendar that send real email, so a
 * limiter that cannot count is a reason to refuse, not a reason to wave
 * everything through.
 *
 * Reads pass `failOpen` — refusing to show anyone any times because a counter
 * is down would be a worse outage than the one being prevented.
 */
export async function rateLimitOk(
  db: RateLimitClient,
  bucket: string,
  subject: string,
  windowSeconds: number,
  limit: number,
  failOpen = false
): Promise<boolean> {
  const { data, error } = await db.rpc('rate_limit_hit', {
    p_bucket:         bucket,
    p_subject:        subject,
    p_window_seconds: windowSeconds,
    p_limit:          limit,
  })

  if (error) {
    // The code, never the error: a PostgrestError carries the failing statement
    // and its parameters, and the parameters here are a subject digest.
    console.error('rate_limit', (error as { code?: string }).code ?? 'unknown')
    return failOpen
  }
  return data === true
}
