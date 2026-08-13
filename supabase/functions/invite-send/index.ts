// Axis Training Systems — issue an invitation
// Deploy: supabase functions deploy invite-send
//
// verify_jwt stays ON. This is the one endpoint that hands out access to the
// site, and the caller has to be somebody.
//
// WHY A FUNCTION RATHER THAN AN RPC. Two reasons, and only two:
//
//   1. THE TOKEN IS GENERATED HERE, NOT IN THE DATABASE. 32 bytes from
//      crypto.getRandomValues, and only its SHA-256 is ever sent to Postgres.
//      The plaintext exists in this process, in the email, and in the response —
//      never in a row, never in a WAL segment, never in a statement log. A
//      `create_invitation()` RPC returning the token would put it in all three.
//
//   2. It has to send the email, and Resend lives out here.
//
// WHAT IT DELIBERATELY DOES NOT DO: decide who may invite whom. It inserts with
// the service role, which bypasses RLS entirely — so if the tier rule lived in
// this file, a bug in this file would be the whole of the security model. It
// lives in `invitations_before_insert` (012), which fires for the service role
// too and reads the role of `invited_by`. The check below is a courtesy that
// produces a good error message; the trigger is what makes it true.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { rateLimitOk, requestSubject } from '../_shared/ratelimit.ts'

const MAX_BODY_BYTES = 4_096
const ACCENT = '#272C84'

/** Per inviter, per hour. Generous for real use, useless for a mail bomb. */
const RATE_WINDOW_SECONDS = 3_600
const RATE_LIMIT          = 20

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const SLUG_RE  = /^[a-z0-9-]{1,64}$/

type Role = 'athlete' | 'coach' | 'admin'

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

const fail = (req: Request, error: string, status: number) => json(req, { ok: false, error }, status)

function siteUrl(): string {
  return (Deno.env.get('SITE_URL') ?? 'https://axistrainingsystems.com').replace(/\/$/, '')
}

/** 32 bytes, base64url. 256 bits — guessing is not a threat model. */
function mintToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function inviteEmail(opts: {
  link: string
  role: Role
  firstName: string | null
  inviterName: string
  note: string | null
  expiresAt: Date
}): string {
  const greeting = opts.firstName ? `${escapeHtml(opts.firstName)},` : 'Hello,'
  const what = opts.role === 'athlete'
    ? 'set up your athlete account'
    : opts.role === 'coach'
      ? 'set up your coach account'
      : 'set up your admin account'

  const expires = opts.expiresAt.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric',
  })

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#080808;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px">
    <p style="color:${ACCENT};font-size:10px;font-weight:900;letter-spacing:.35em;text-transform:uppercase;margin:0 0 10px">
      Axis Training Systems
    </p>
    <h1 style="color:#ffffff;font-size:28px;font-weight:900;line-height:1.05;letter-spacing:-.5px;
               text-transform:uppercase;margin:0 0 24px">You&rsquo;re invited</h1>

    <p style="color:#b4b4b4;font-size:15px;line-height:1.65;margin:0 0 16px">${greeting}</p>
    <p style="color:#b4b4b4;font-size:15px;line-height:1.65;margin:0 0 16px">
      ${escapeHtml(opts.inviterName)} has invited you to ${what} at Axis.
    </p>
    ${opts.note ? `<p style="color:#b4b4b4;font-size:15px;line-height:1.65;margin:0 0 16px;
      border-left:2px solid ${ACCENT};padding-left:16px">${escapeHtml(opts.note)}</p>` : ''}

    <div style="margin:32px 0">
      <a href="${escapeHtml(opts.link)}" style="display:inline-block;padding:14px 30px;background:${ACCENT};
         color:#ffffff;border-radius:4px;text-decoration:none;font-size:12px;font-weight:900;
         letter-spacing:.12em;text-transform:uppercase">Accept the invitation</a>
    </div>

    <p style="color:#8a8a8a;font-size:13px;line-height:1.65;margin:0 0 8px">
      You can sign in with Google, or with an email link — whichever you prefer. Use
      <strong style="color:#b4b4b4">this email address</strong> either way; it&rsquo;s the one the
      invitation was issued to.
    </p>
    <p style="color:#8a8a8a;font-size:13px;line-height:1.65;margin:0">
      This link expires on ${escapeHtml(expires)}.
    </p>

    <p style="color:#3a3a3a;font-size:11px;line-height:1.6;margin:32px 0 0;
              border-top:1px solid #1a1a1a;padding-top:20px">
      If you weren&rsquo;t expecting this, you can ignore it — nothing happens until someone signs in.
      <br><span style="word-break:break-all">${escapeHtml(opts.link)}</span>
    </p>
  </div>
</body></html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return fail(req, 'method_not_allowed', 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return fail(req, 'not_authenticated', 401)

  // Declared length first, so an oversized body is refused before it is read
  // rather than after this isolate has already buffered the whole of it.
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return fail(req, 'payload_too_large', 413)

  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) return fail(req, 'payload_too_large', 413)
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return fail(req, 'invalid_request', 400)
    }
    body = parsed as Record<string, unknown>
  } catch {
    return fail(req, 'invalid_request', 400)
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email) || email.length > 254) return fail(req, 'invalid_email', 400)

  const role = (typeof body.role === 'string' ? body.role : 'athlete') as Role
  if (!['athlete', 'coach', 'admin'].includes(role)) return fail(req, 'invalid_request', 400)

  const coachSlug = typeof body.coach_slug === 'string' && body.coach_slug ? body.coach_slug : null
  if (coachSlug && !SLUG_RE.test(coachSlug)) return fail(req, 'invalid_request', 400)
  if (role === 'athlete' && coachSlug) return fail(req, 'invalid_request', 400)

  const firstName = typeof body.first_name === 'string' ? body.first_name.trim().slice(0, 80) || null : null
  const lastName  = typeof body.last_name  === 'string' ? body.last_name.trim().slice(0, 80)  || null : null
  const note      = typeof body.note       === 'string' ? body.note.trim().slice(0, 500)      || null : null

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  // ── Who is asking ─────────────────────────────────────────────────────────
  // The uid comes from the verified JWT and nothing else. It is what goes into
  // `invited_by`, which is what the trigger reads to decide whether this
  // invitation is allowed at all.
  const { data: userData, error: userError } = await db.auth.getUser(authHeader.replace('Bearer ', ''))
  if (userError || !userData?.user) return fail(req, 'not_authenticated', 401)

  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('id,role,status,display_name,first_name,last_name')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileError) {
    console.error('invite-send profile_read', profileError.code)
    return fail(req, 'server_error', 500)
  }
  if (!profile || profile.status !== 'active') return fail(req, 'forbidden', 403)

  // A courtesy check so the caller gets a sentence instead of a constraint
  // violation. The trigger enforces the same rule and is what actually holds.
  const inviterRole = profile.role as Role
  if (role === 'athlete' ? !['coach', 'admin'].includes(inviterRole) : inviterRole !== 'admin') {
    return fail(req, 'forbidden', 403)
  }

  const subject = await requestSubject(req)
  if (!(await rateLimitOk(db, 'invite-send', `${profile.id}:${subject}`, RATE_WINDOW_SECONDS, RATE_LIMIT))) {
    return fail(req, 'rate_limited', 429)
  }

  // ── Mint and store ────────────────────────────────────────────────────────
  const token     = mintToken()
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + 14 * 86_400_000)

  const { data: invitation, error: insertError } = await db
    .from('invitations')
    .insert({
      email,
      first_name: firstName,
      last_name:  lastName,
      note,
      role,
      coach_slug: coachSlug,
      invited_by: profile.id,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    })
    .select('id,expires_at')
    .single()

  if (insertError) {
    // 22023 is what every guard in 012 raises with, and every one of them is a
    // sentence a human should read: "that email already has an account", "only
    // an admin can invite staff". Passing it through is the whole reason they
    // were given a distinct SQLSTATE.
    if (insertError.code === '22023') {
      // Only 012's own `raise` messages reach this branch, and they are short
      // sentences by construction — but this is the one place in the codebase
      // where a database string is repeated to a caller, so it is bounded rather
      // than trusted to stay that way.
      const message = String(insertError.message ?? '').slice(0, 300)
      return json(req, { ok: false, error: 'refused', message }, 409)
    }
    console.error('invite-send insert', insertError.code)
    return fail(req, 'server_error', 500)
  }

  const link = `${siteUrl()}/invite/${token}`

  // ── Send ──────────────────────────────────────────────────────────────────
  // The invitation is already committed and is ALREADY EFFECTIVE — the email
  // match in handle_new_user (011) does not need this mail to have arrived. So a
  // send failure is reported, not rolled back, and the link comes back in the
  // response either way so the inviter can paste it into a text message.
  let emailed = false
  const apiKey = Deno.env.get('RESEND_API_KEY')

  if (apiKey) {
    const inviterName =
      profile.display_name
      || [profile.first_name, profile.last_name].filter(Boolean).join(' ')
      || 'Axis Training Systems'

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('BOOKING_FROM_EMAIL')
          ?? 'Axis Training Systems <noreply@axistrainingsystems.com>',
        to: [email],
        subject: role === 'athlete'
          ? 'Your Axis account is ready to set up'
          : 'You have been invited to Axis Training Systems',
        html: inviteEmail({ link, role, firstName, inviterName, note, expiresAt }),
      }),
    })
    emailed = res.ok
    // The status, never the body: an upstream body can echo the address it was
    // given, and this line goes to a log.
    if (!res.ok) console.error('invite-send resend', res.status)
  }

  return json(req, {
    ok: true,
    invitation_id: invitation.id,
    // The only time this leaves the building. It is not stored and cannot be
    // shown again — issuing another invitation supersedes this one, which is
    // what makes a rotated link also a revoked link.
    link,
    emailed,
    expires_at: invitation.expires_at,
  }, 201)
})
