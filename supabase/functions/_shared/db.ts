// Axis Training Systems — shared Supabase clients + identity resolution.
//
// Two clients, two purposes:
//   • serviceClient()  — service_role. Bypasses RLS. Used for the private schema
//                        (calendar connections, outbox) and for writes the caller
//                        is not privileged to make. NEVER derive authorization from
//                        a client-supplied coach_slug while holding this client.
//   • callerClient(req) — anon key + the caller's Authorization header. RLS applies.
//                        Its only job is to VERIFY the JWT and hand back auth.uid().
//
// Spec §8.3: coach_slug is never trusted from a client for authorization. It is
// derived from the verified user via coach_routing (resolveCoachSlugFromUser), or
// read from the single-use OAuth state row.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export { createClient }
export type { SupabaseClient }

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export function callerClient(req: Request): SupabaseClient {
  const authorization = req.headers.get('Authorization') ?? ''
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      auth:   { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    },
  )
}

export interface CoachIdentity {
  userId:    string
  email:     string
  coachSlug: string
}

/**
 * Verifies the caller's JWT and maps them to a coach slug.
 * Returns null when the JWT is missing/invalid or the email is not a coach
 * (i.e. a master admin) — callers decide whether that is a 401 or a 403.
 */
export async function resolveCoachSlugFromUser(authed: SupabaseClient): Promise<CoachIdentity | null> {
  const { data, error } = await authed.auth.getUser()
  if (error || !data?.user?.email) return null

  const email = data.user.email.toLowerCase()

  // coach_routing is read with service_role: the mapping is identity, not data the
  // coach owns, and 002's policies restrict what a coach may SELECT from it.
  //
  // Named columns, not `*`. This runs with service_role and the table has grown
  // columns since it was written; pulling every one of them into a process that
  // needs three is how a column added later ends up somewhere it was never
  // reviewed for.
  //
  // The match is an exact case-folded compare in this process rather than an
  // `ilike` filter. `_` and `%` are wildcards to ilike and ordinary characters in
  // an email local part, so a pattern built from a caller's own address matches
  // rows that are not theirs.
  const { data: rows, error: routeErr } = await serviceClient()
    .from('coach_routing')
    .select('email,coach_slug,coach_name')
  if (routeErr || !rows) return null

  const row = (rows as Record<string, unknown>[]).find(
    r => String(r.email ?? '').trim().toLowerCase() === email,
  )
  if (!row) return null

  const slug = typeof row.coach_slug === 'string' && row.coach_slug
    ? row.coach_slug
    : slugifyCoachName(String(row.coach_name ?? ''))
  if (!slug) return null

  return { userId: data.user.id, email, coachSlug: slug }
}

/** 'Ronnie Vallejo' -> 'ronnie-vallejo'. Mirrors src/data/coaches.ts slugs. */
export function slugifyCoachName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ─────────────────────────────────────────────────────────────────────────────
// Token encryption (AES-256-GCM). The key lives in Function Secrets, never in the
// DB — so a leaked service_role key or a forgotten `revoke ... from public` on an
// RPC still yields ciphertext. Wire format: base64( iv[12] || ciphertext||tag ).
// ─────────────────────────────────────────────────────────────────────────────

const IV_BYTES = 12

let keyPromise: Promise<CryptoKey> | null = null

function encryptionKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const raw = Deno.env.get('GOOGLE_TOKEN_ENC_KEY') ?? ''
      const bytes = decodeBase64(raw)
      if (bytes.length !== 32) throw new Error('enc_key_invalid')
      return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    })()
  }
  return keyPromise
}

export async function encryptToken(plaintext: string): Promise<string> {
  const key = await encryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0)
  out.set(ct, iv.length)
  return encodeBase64(out)
}

export async function decryptToken(ciphertext: string): Promise<string> {
  const key = await encryptionKey()
  const buf = decodeBase64(ciphertext)
  const iv = buf.slice(0, IV_BYTES)
  const ct = buf.slice(IV_BYTES)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}

function encodeBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function decodeBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
