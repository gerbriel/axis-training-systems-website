// Axis Training Systems — lead notification for the public application form
// Deploy: supabase functions deploy send-lead-email      (verify_jwt stays ON)
//
// WHAT THIS USED TO BE. It took a JSON object from anybody on the internet,
// wildcard-CORS'd, uncapped and unbudgeted, and interpolated its fields straight
// into an HTML email that Axis's own Resend account then sent to the coaching
// roster. No field was escaped. A stranger could compose the mail, choose who it
// went to by naming a coach, and get it delivered from
// noreply@axistrainingsystems.com — and the reply told them which addresses had
// just been mailed. This file is the fix for all of that.
//
// AUTHORIZATION. verify_jwt stays ON (there is no entry for this function in
// supabase/config.toml, and ON is the platform default), but that gate is not
// the control and must not be mistaken for one: the application form is filled
// in by anonymous visitors, so the JWT their browser presents is the anon key,
// which ships in the Vite bundle. A shared-secret header would be no better —
// it would ship in the same bundle. The gate stops a caller with no Supabase
// credential at all, and that is the whole of what it is worth here.
//
// So the authorization that matters is about the SUBJECT rather than the caller.
// The request may NAME a lead. It may not DESCRIBE one:
//
//   • Every value rendered into the email is read back from `leads` with the
//     service role. The body is read for one uuid and nothing else — the other
//     thirty fields the caller sends are ignored, not merged.
//   • A lead is notified about ONCE. `lead-email-once` is a budget of one per
//     lead id, so a replayed request cannot mail the roster a second time.
//   • A lead is notified about only while it is FRESH. The legitimate caller
//     fires within a second of the insert (src/components/Apply.tsx); an id
//     harvested from anywhere else, later, is refused.
//   • A per-address budget on top, failing closed, because every send spends
//     Axis's Resend quota.
//
// AND STILL ESCAPED. anon may INSERT into `leads` (001), so the text coming back
// out of the database is attacker-controlled even after the round trip. Every
// interpolated value is HTML-escaped, length-capped, and stripped of control
// characters at render. The round trip buys provenance, never trust.
//
// Nothing here logs or returns a key, an upstream body, a recipient address, or
// a stringified exception. Responses carry opaque short codes.
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//           ALLOWED_ORIGINS, RATE_LIMIT_SALT (optional)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { json, jsonError, preflight } from '../_shared/cors.ts'
import { hashedSubject, rateLimitOk, requestSubject } from '../_shared/ratelimit.ts'
import { formatDateInTimeZone, formatTimeInTimeZone, timeZoneAbbreviation } from '../_shared/tz.ts'

/** The caller posts the whole inserted row; only `id` is read off it. Generous
 *  enough for a long application, small enough that a body is never a weapon. */
const MAX_BODY_BYTES = 32_768

/** Per address, per hour. Fails CLOSED: every send spends real Resend quota. */
const RATE_WINDOW_SECONDS = 3_600
const RATE_LIMIT_PER_IP   = 10

/** One notification per lead, ever (the window only has to outlive the retry). */
const ONCE_WINDOW_SECONDS = 86_400

/**
 * How long after the insert a lead may still be notified about. Apply.tsx fires
 * this within a second of the row landing, so the margin is for clock skew and a
 * retry — not for anyone walking a list of ids they collected some other way.
 */
const MAX_LEAD_AGE_MS = 30 * 60_000

/** Axis is a Fresno gym; the coaches read these in Pacific time. */
const DISPLAY_TZ = 'America/Los_Angeles'

/** Nothing a person types into an application is longer than this in an email. */
const MAX_FIELD_CHARS = 2_000

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const BRAND = '#e63e3e'

/** Exactly the columns this email renders. Never `select('*')`. */
const LEAD_COLUMNS = [
  'id', 'created_at', 'first_name', 'last_name', 'email', 'social', 'service',
  'coach_pref', 'age', 'height', 'body_weight', 'weight_class', 'experience',
  'injuries', 'train_days', 'occupation', 'squat_max', 'bench_max', 'dead_max',
  'squat_freq', 'bench_freq', 'dead_freq', 'current_program', 'squat_style',
  'bench_style', 'dead_style', 'weak_points', 'learning_style', 'sleep',
  'nutrition', 'stress', 'recovery', 'expectations', 'goals',
].join(',')

interface LeadRow {
  id: string
  created_at: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  social: string | null
  service: string | null
  coach_pref: string | null
  age: string | null
  height: string | null
  body_weight: string | null
  weight_class: string | null
  experience: string | null
  injuries: string | null
  train_days: string | null
  occupation: string | null
  squat_max: string | null
  bench_max: string | null
  dead_max: string | null
  squat_freq: string | null
  bench_freq: string | null
  dead_freq: string | null
  current_program: string | null
  squat_style: string | null
  bench_style: string | null
  dead_style: string | null
  weak_points: string | null
  learning_style: string | null
  sleep: string | null
  nutrition: string | null
  stress: string | null
  recovery: string | null
  expectations: string | null
  goals: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
//
// Two steps, both mandatory, in this order: flatten the value to safe plain text
// (no control characters, bounded length), then escape it for the context it is
// being dropped into. `row()` is the only thing that writes a lead's own words
// into the document, and it is the only place `escapeHtml` has to be right.
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * Control characters out, length capped. A newline inside a subject line is a
 * header injection in any transport that is not JSON, and a megabyte of `goals`
 * is a mail nobody can open — neither is worth carrying into the template to
 * find out.
 */
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]+/g

function plain(value: unknown, max = MAX_FIELD_CHARS): string {
  if (typeof value !== 'string') return ''
  const flat = value.replace(CONTROL_RE, ' ').replace(/\s{2,}/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function buildEmailHtml(lead: LeadRow, receivedAt: string): string {
  const row = (label: string, value: unknown) => {
    const text = plain(value)
    return text
      ? `<tr><td style="padding:6px 12px;color:#888;font-size:13px;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 12px;color:#ddd;font-size:13px">${escapeHtml(text)}</td></tr>`
      : ''
  }

  const outOf10 = (label: string, value: unknown) => {
    const text = plain(value, 12)
    return text ? row(label, `${text}/10`) : ''
  }

  const section = (title: string, rows: string) =>
    rows.trim()
      ? `<tr><td colspan="2" style="padding:16px 12px 4px;color:${BRAND};font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;border-top:1px solid #222">${escapeHtml(title)}</td></tr>${rows}`
      : ''

  const name  = plain(`${plain(lead.first_name, 80)} ${plain(lead.last_name, 80)}`.trim(), 170) || 'Applicant'
  const email = plain(lead.email, 254)

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="background:#080808;font-family:ui-sans-serif,system-ui,sans-serif;padding:0;margin:0">
  <div style="max-width:680px;margin:0 auto;padding:32px 16px">
    <div style="margin-bottom:24px">
      <p style="color:${BRAND};font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin:0 0 8px">New Application</p>
      <h1 style="color:#fff;font-size:28px;font-weight:900;margin:0;text-transform:uppercase;letter-spacing:-1px">${escapeHtml(name)}</h1>
      <p style="color:#555;font-size:13px;margin:4px 0 0">${escapeHtml(email)} · ${escapeHtml(receivedAt)}</p>
    </div>

    <div style="background:#0a0a0a;border:1px solid #1e1e1e;border-radius:4px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        ${section('Service', `
          ${row('Service', lead.service)}
          ${row('Coach Preference', lead.coach_pref)}
          ${row('Instagram / Facebook', lead.social)}
        `)}
        ${section('Physical Profile', `
          ${row('Age', lead.age)}
          ${row('Height', lead.height)}
          ${row('Body Weight', lead.body_weight)}
          ${row('Weight Class', lead.weight_class)}
          ${row('Experience', lead.experience)}
          ${row('Injuries', lead.injuries)}
          ${row('Training Days', lead.train_days)}
          ${row('Occupation', lead.occupation)}
        `)}
        ${section('Training Data', `
          ${row('Squat Max', lead.squat_max)}
          ${row('Bench Max', lead.bench_max)}
          ${row('Deadlift Max', lead.dead_max)}
          ${row('Squat Frequency', lead.squat_freq)}
          ${row('Bench Frequency', lead.bench_freq)}
          ${row('Deadlift Frequency', lead.dead_freq)}
          ${row('Current Program', lead.current_program)}
          ${row('Squat Style', lead.squat_style)}
          ${row('Bench Style', lead.bench_style)}
          ${row('Deadlift Style', lead.dead_style)}
        `)}
        ${section('Lifestyle & Recovery', `
          ${row('Weak Points', lead.weak_points)}
          ${row('Learning Style', lead.learning_style)}
          ${row('Sleep (hrs)', lead.sleep)}
          ${outOf10('Nutrition / Hydration', lead.nutrition)}
          ${outOf10('Life Stress', lead.stress)}
          ${outOf10('Overall Recovery', lead.recovery)}
        `)}
        ${section('Goals', `
          ${row('Expectations', lead.expectations)}
          ${row('Further Goals', lead.goals)}
        `)}
      </table>
    </div>

    <p style="color:#333;font-size:12px;margin-top:24px;text-align:center">
      Axis Training Systems Admin · <a href="https://axistrainingsystems.com/admin" style="color:#555">View in Dashboard</a>
    </p>
  </div>
</body>
</html>`
}

// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonError(req, 'method_not_allowed', 405)

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return jsonError(req, 'payload_too_large', 413)

  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) return jsonError(req, 'payload_too_large', 413)
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return jsonError(req, 'invalid_request', 400)
    }
    body = parsed as Record<string, unknown>
  } catch {
    return jsonError(req, 'invalid_request', 400)
  }

  // The whole of what is trusted from the request. `lead_id` is accepted as an
  // alias so a caller that has only the id does not have to fake a row around it.
  const rawId = typeof body.id === 'string' ? body.id
    : typeof body.lead_id === 'string' ? body.lead_id
    : ''
  if (!UUID_RE.test(rawId)) return jsonError(req, 'invalid_request', 400)

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  const subject = await requestSubject(req)
  if (!(await rateLimitOk(db, 'lead-email-ip', subject, RATE_WINDOW_SECONDS, RATE_LIMIT_PER_IP))) {
    return jsonError(req, 'rate_limited', 429)
  }

  const { data, error } = await db
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('id', rawId)
    .maybeSingle()

  if (error) {
    console.error('send-lead-email lead_read', error.code)
    return jsonError(req, 'server_error', 500)
  }
  // Same answer for an id that never existed and one that is too old to notify
  // about: neither is a fact worth handing to somebody guessing.
  if (!data) return jsonError(req, 'not_found', 404)

  const lead = data as unknown as LeadRow

  const createdMs = lead.created_at ? Date.parse(lead.created_at) : NaN
  if (!Number.isFinite(createdMs) || Date.now() - createdMs > MAX_LEAD_AGE_MS) {
    return jsonError(req, 'not_found', 404)
  }

  // ── Who it goes to ────────────────────────────────────────────────────────
  // Both reads are narrowed to the row that is actually wanted. admin_config in
  // particular is a key/value table that has held a `resend_api_key` row since
  // 001, and `select('*')` on it pulls a credential into this process for no
  // reason at all.
  const coachPref = plain(lead.coach_pref, 120)

  const routePromise = coachPref
    ? db.from('coach_routing').select('email,notify').eq('coach_name', coachPref).maybeSingle()
    : null
  const configPromise = db
    .from('admin_config').select('value').eq('key', 'master_notify_email').maybeSingle()

  const [routeRes, configRes] = await Promise.all([routePromise, configPromise])

  if (routeRes?.error || configRes.error) {
    console.error('send-lead-email routing_read', routeRes?.error?.code ?? configRes.error?.code)
    return jsonError(req, 'server_error', 500)
  }

  const route  = routeRes?.data as { email?: string | null; notify?: boolean | null } | null
  const config = configRes.data as { value?: string | null } | null

  // Validated before they are handed to Resend: an address is the one field of a
  // config table that becomes an instruction to a third party, and a row edited
  // by hand is exactly where a malformed one comes from.
  const recipients: string[] = []
  const addRecipient = (raw: unknown) => {
    const address = plain(raw, 254).toLowerCase()
    if (!EMAIL_RE.test(address)) return
    if (!recipients.includes(address)) recipients.push(address)
  }

  if (route?.notify !== false) addRecipient(route?.email)
  addRecipient(config?.value)

  // Deliberately the same shape as a successful send. Whether Axis has routing
  // configured is not something an anonymous caller gets to probe for.
  if (recipients.length === 0) return json(req, { ok: true })

  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    console.error('send-lead-email no_api_key')
    return jsonError(req, 'server_error', 500)
  }

  // ── At most once ──────────────────────────────────────────────────────────
  // Claimed immediately before the send, so a lead is mailed about once and a
  // replay is refused. The trade-off is deliberate: if Resend fails after this
  // point the notification is lost rather than retried, and the lead is still
  // sitting in the admin dashboard where it was always going to be read from.
  // Mailing the roster twice for one application is the worse failure.
  const onceSubject = await hashedSubject(lead.id)
  if (!(await rateLimitOk(db, 'lead-email-once', onceSubject, ONCE_WINDOW_SECONDS, 1))) {
    // Logged rather than reported. The reply is the same shape as a send, so a
    // caller cannot use this endpoint to ask which leads have been mailed about.
    console.error('send-lead-email already_sent')
    return json(req, { ok: true })
  }

  const receivedAt = Number.isFinite(createdMs)
    ? `${formatDateInTimeZone(new Date(createdMs), DISPLAY_TZ)}, ${formatTimeInTimeZone(new Date(createdMs), DISPLAY_TZ)} ${timeZoneAbbreviation(new Date(createdMs), DISPLAY_TZ)}`
    : ''

  const who     = plain(`${plain(lead.first_name, 80)} ${plain(lead.last_name, 80)}`.trim(), 170) || 'Applicant'
  const service = plain(lead.service, 120)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: Deno.env.get('BOOKING_FROM_EMAIL')
        ?? 'Axis Training Systems <noreply@axistrainingsystems.com>',
      to: recipients,
      subject: service ? `New Application — ${who} (${service})` : `New Application — ${who}`,
      html: buildEmailHtml(lead, receivedAt),
    }),
  })

  if (!res.ok) {
    // The status, never the body: an upstream body echoes back the addresses it
    // was given, and this line goes to a log the coaches do not own.
    console.error('send-lead-email resend', res.status)
    return jsonError(req, 'send_failed', 502)
  }

  // No recipient list. Who Axis notifies is not the caller's business, and the
  // old response handed the whole roster to anyone who posted a form.
  return json(req, { ok: true })
})
