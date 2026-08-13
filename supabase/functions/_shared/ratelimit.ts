// Axis Training Systems — request budgeting for the public endpoints.
//
// Fixed window, counted by an atomic upsert in `rate_limit_hit` (migration 010).
// The bucket is part of the primary key, so Postgres serialises the increment
// for us — two requests arriving together are counted twice rather than both
// reading 4 and both writing 5.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

/**
 * Who is asking, as an opaque string.
 *
 * The address is HASHED before it is stored. A rate-limit table is not a place
 * to keep a log of who visited, and a salted digest counts requests exactly as
 * well as the address itself does. RATE_LIMIT_SALT is a Function Secret;
 * without it the digest is still per-deployment stable, just not resistant to
 * somebody who already holds the table and wants to confirm a guess at an
 * address.
 */
export async function requestSubject(req: Request): Promise<string> {
  const forwarded = req.headers.get('x-forwarded-for') ?? ''
  const ip = forwarded.split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown'
  const salt = Deno.env.get('RATE_LIMIT_SALT') ?? 'axis-booking'
  const bytes = new TextEncoder().encode(`${salt}:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('')
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
  db: SupabaseClient,
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
    console.error('rate_limit', error.code)
    return failOpen
  }
  return data === true
}
