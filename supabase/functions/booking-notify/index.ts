// Axis Training Systems — the booking notification dispatcher
//
// Deploy:  supabase functions deploy booking-notify
// Schedule (every 5 minutes, via pg_cron in the SQL editor):
//
//   select cron.schedule(
//     'booking-notify', '*/5 * * * *',
//     $$ select net.http_post(
//          url     := 'https://<project-ref>.supabase.co/functions/v1/booking-notify',
//          headers := jsonb_build_object('Authorization', 'Bearer ' || '<service-role-key>')
//        ) $$
//   );
//
// A five-minute cadence is what makes the reminder times in migration 010 real:
// a "2 hours before" queued for 07:00 goes out somewhere in 07:00–07:05, which
// is what anyone means by two hours.
//
// verify_jwt stays ON, AND THAT IS NOT ENOUGH ON ITS OWN. The platform gate only
// asks for a valid Supabase JWT, and the anon key is one — it ships in the Vite
// bundle, so "verify_jwt = true" left this dispatcher open to anybody who viewed
// source. They could not read the queue, but they could make it fire whenever
// they liked and spend Axis's Resend quota doing it.
//
// So the caller is checked here as well, against exactly two credentials, both
// compared in constant time:
//   • Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>  — what the cron job
//     below already sends, and what a by-hand run from the dashboard must send.
//   • X-Cron-Secret: <BOOKING_NOTIFY_CRON_SECRET>        — optional alternative,
//     for a scheduler that should not be holding the service-role key at all.
// Anything else is 401, including a signed-in coach: nobody's session dispatches
// the queue.
//
// The queue is the record. This function claims due rows through
// `claim_booking_notifications` (which counts the attempt and takes a row lock,
// so two dispatchers overlapping cannot both send the same mail), sends them,
// and stamps `sent_at`. A row that fails keeps its incremented attempt count and
// its last error and is swept again until it runs out of attempts. Nothing here
// remembers anything between invocations.
//
// TWO jobs run here, in this order. The queue first, because it is the one with
// a deadline. Then a small Meet-link recovery sweep over bookings still sitting
// at google_sync_status='pending' — the retry migration 007 wrote an outbox for
// and never gave a drainer. It runs on whatever time is left, it is bounded, and
// it cannot affect the mail: see the sweep itself for what it does and does not
// touch.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { loadCoachPolicy } from '../_shared/booking.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { buildIcs, icsBase64 } from '../_shared/ics.ts'
import { mirrorFindEvent, mirrorUpsert } from '../_shared/mirror.ts'
import { formatDateInTimeZone, formatTimeInTimeZone, timeZoneAbbreviation } from '../_shared/tz.ts'

const BATCH_SIZE = 25
const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
const BRAND = '#272C84'

/**
 * How much Google work one invocation will do. Five pushes is a couple of
 * seconds against a cadence of five minutes, and it keeps the sweep from ever
 * being the reason an invocation runs long enough to lose the mail behind it.
 */
const RECOVERY_BATCH = 5

/**
 * How far back the sweep looks. This is the whole retry budget: a booking gets
 * retried every five minutes for a week and is then left alone. No attempt
 * counter, no backoff column, nothing to keep in step with the row — the window
 * expires the work by itself, which is the one bookkeeping scheme that cannot
 * drift out of sync with what actually happened.
 */
const RECOVERY_WINDOW_DAYS = 7

/**
 * Failure codes that will not heal on their own, whatever the window says.
 *
 *   google_revoked  the coach revoked Axis in their Google account settings.
 *                   The connection row survives that, so nothing here notices:
 *                   every refresh fails the same way, for ever.
 *   decrypt_failed  the stored refresh token cannot be decrypted by this
 *                   deployment. A key that changed, not a credential that will
 *                   come back.
 *
 * A row failing on one of these sorts first by created_at and therefore holds a
 * place in every batch of five until the window drops it a week later. Two or
 * three of them are most of the batch, and the sweep spends its whole budget
 * failing the same rows and never reaches the booking behind them. So these are
 * written to google_sync_status='failed' and taken out of the sweep.
 */
const TERMINAL_SYNC_CODES = new Set(['google_revoked', 'decrypt_failed'])

/**
 * Not a mirror code: the coach has no usable coach_public_settings row, so
 * there is no zone to write an event in. Terminal for the same reason as the
 * two above, and recorded the same way.
 */
const POLICY_MISSING = 'policy_missing'

/**
 * How far either side of a booking the look-before-insert search reaches. Wide
 * enough that a start recorded a moment off still overlaps, narrow enough that
 * the search is about this booking and not about the coach's afternoon.
 */
const ADOPT_PAD_MS = 5 * MS_PER_MINUTE

type Kind =
  | 'confirmation' | 'confirmed' | 'coach_alert'
  | 'reminder_24h' | 'reminder_2h' | 'cancellation' | 'reschedule'

interface Claimed {
  notification_id: string
  kind: Kind
  recipient: string
  booking_id: string
  coach_slug: string
  booked_at: string
  duration_minutes: number
  first_name: string
  last_name: string
  client_email: string
  status: string
  service_name: string | null
  goals: string | null
  meet_url: string | null
  manage_token: string
  time_zone: string
  cancellation_reason: string | null
}

function siteUrl(): string {
  return (Deno.env.get('SITE_URL') ?? 'https://axistrainingsystems.com').replace(/\/$/, '')
}

function fromAddress(): string {
  return Deno.env.get('BOOKING_FROM_EMAIL') ?? 'Axis Training Systems <noreply@axistrainingsystems.com>'
}

/** Titles a coach slug when no display name is to hand: 'seth-burman' -> 'Seth Burman'. */
function coachLabel(slug: string): string {
  return slug.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy
//
// Every one of these says what is true of THIS booking rather than what is
// usually true. A pending booking is never described as confirmed; a reminder
// for a booking the coach has not confirmed yet says so, because the client can
// see the difference on the page the email links to and the two must agree.
// ─────────────────────────────────────────────────────────────────────────────

interface Copy {
  subject: string
  heading: string
  body: string[]
  /** REQUEST attaches an invite, CANCEL retracts it, null attaches nothing. */
  ics: 'REQUEST' | 'CANCEL' | null
}

function copyFor(n: Claimed, when: string, coach: string): Copy {
  const service = n.service_name ?? 'call'
  const pendingNote =
    'Your coach will confirm within 24 hours. Your time is held on their calendar until then — nobody else can take it.'

  switch (n.kind) {
    case 'confirmation':
      return {
        subject: `We have your booking — ${when}`,
        heading: 'Booking received',
        body: [
          `Thanks ${escapeHtml(n.first_name)} — we have your ${escapeHtml(service)} with ${escapeHtml(coach)} down for ${escapeHtml(when)}.`,
          n.status === 'pending' ? pendingNote : 'This one is confirmed. See you then.',
        ],
        ics: 'REQUEST',
      }

    case 'confirmed':
      return {
        subject: `Confirmed — ${when}`,
        heading: 'You are confirmed',
        body: [
          `${escapeHtml(coach)} has confirmed your ${escapeHtml(service)} for ${escapeHtml(when)}.`,
          'The invite attached to this email will update the one already in your calendar.',
        ],
        ics: 'REQUEST',
      }

    case 'reminder_24h':
      return {
        subject: `Tomorrow — ${when}`,
        heading: 'Your call is tomorrow',
        body: [
          `${escapeHtml(service)} with ${escapeHtml(coach)}, ${escapeHtml(when)}.`,
          n.status === 'pending'
            ? 'This is still awaiting your coach’s confirmation. If you have not heard by the morning, reply to this email.'
            : 'If something has come up, use the link below to move it or let us know — it takes a second and gives the slot back.',
        ],
        ics: null,
      }

    case 'reminder_2h':
      return {
        subject: `In two hours — ${when}`,
        heading: 'Starting soon',
        body: [
          `${escapeHtml(service)} with ${escapeHtml(coach)} starts at ${escapeHtml(when)}.`,
          n.meet_url
            ? 'Join with the button below.'
            : 'Your coach will be in touch on the number you gave us.',
        ],
        ics: null,
      }

    case 'cancellation':
      return {
        subject: `Cancelled — ${when}`,
        heading: 'That booking is cancelled',
        body: [
          `The ${escapeHtml(service)} with ${escapeHtml(coach)} on ${escapeHtml(when)} has been cancelled and the time is back on the calendar.`,
          n.cancellation_reason ? `Reason given: ${escapeHtml(n.cancellation_reason)}` : '',
          'Book again whenever you are ready.',
        ].filter(Boolean),
        ics: 'CANCEL',
      }

    case 'reschedule':
      return {
        subject: `Moved — now ${when}`,
        heading: 'Your booking moved',
        body: [
          `The ${escapeHtml(service)} with ${escapeHtml(coach)} is now ${escapeHtml(when)}.`,
          'The invite attached will update your calendar.',
        ],
        ics: 'REQUEST',
      }

    case 'coach_alert':
      return {
        subject: `New booking — ${escapeHtml(n.first_name)} ${escapeHtml(n.last_name)}, ${when}`,
        heading: 'Someone booked you',
        body: [
          `${escapeHtml(n.first_name)} ${escapeHtml(n.last_name)} booked a ${escapeHtml(service)} for ${escapeHtml(when)}.`,
          `Contact: ${escapeHtml(n.client_email)}`,
          n.goals ? `What they wrote: ${escapeHtml(n.goals)}` : '',
          n.status === 'pending' ? 'It is sitting as pending until you confirm it in the portal.' : '',
        ].filter(Boolean),
        ics: 'REQUEST',
      }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Template
// ─────────────────────────────────────────────────────────────────────────────

function renderEmail(copy: Copy, n: Claimed, when: string, isCoach: boolean): string {
  // Percent-encoded, not interpolated raw: a path segment built by concatenation
  // is a path traversal waiting for the first value with a slash in it.
  const manageUrl = `${siteUrl()}/booking/${encodeURIComponent(n.manage_token)}`

  // Every href goes through escapeHtml too. These URLs are all ours — SITE_URL,
  // a uuid, a Google Meet link — but "it came from the database" is the same
  // sentence that was true of the lead fields in send-lead-email, and an
  // unescaped attribute is one bad row away from being a hole.
  const button = (label: string, url: string, filled: boolean) => `
    <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 26px;margin:0 8px 10px 0;border-radius:4px;
       text-decoration:none;font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;
       ${filled
         ? `background:${BRAND};color:#ffffff;border:1px solid ${BRAND}`
         : 'background:transparent;color:#bbbbbb;border:1px solid #2a2a2a'}">${label}</a>`

  const actions = isCoach
    ? button('Open the portal', `${siteUrl()}/admin/${encodeURIComponent(n.coach_slug)}`, true)
    : [
        n.meet_url ? button('Join the call', n.meet_url, true) : '',
        n.kind === 'cancellation'
          ? button('Book again', `${siteUrl()}/book?coach=${encodeURIComponent(n.coach_slug)}`, !n.meet_url)
          : button('Manage this booking', manageUrl, !n.meet_url),
      ].join('')

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#080808;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px">

    <p style="color:${BRAND};font-size:10px;font-weight:900;letter-spacing:.35em;text-transform:uppercase;margin:0 0 10px">
      Axis Training Systems
    </p>
    <h1 style="color:#ffffff;font-size:28px;font-weight:900;line-height:1.05;letter-spacing:-.5px;
               text-transform:uppercase;margin:0 0 24px">${copy.heading}</h1>

    ${copy.body.map(p => `<p style="color:#b4b4b4;font-size:15px;line-height:1.65;margin:0 0 16px">${p}</p>`).join('')}

    <table style="width:100%;border-collapse:collapse;background:#0d0d0d;border:1px solid #1e1e1e;
                  border-radius:4px;margin:28px 0">
      ${[
        ['When', escapeHtml(when)],
        ['Length', `${n.duration_minutes} minutes`],
        [isCoach ? 'Client' : 'Coach',
         isCoach ? escapeHtml(`${n.first_name} ${n.last_name}`) : escapeHtml(coachLabel(n.coach_slug))],
        n.service_name ? ['Service', escapeHtml(n.service_name)] : null,
      ].filter(Boolean).map(row => {
        const [label, value] = row as [string, string]
        return `<tr>
          <td style="padding:12px 16px;border-bottom:1px solid #1a1a1a;color:#666;font-size:10px;
                     font-weight:700;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap">${label}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #1a1a1a;color:#ffffff;font-size:14px;
                     font-weight:700;text-align:right">${value}</td>
        </tr>`
      }).join('')}
    </table>

    <div style="margin:0 0 32px">${actions}</div>

    <p style="color:#3a3a3a;font-size:11px;line-height:1.6;margin:32px 0 0;
              border-top:1px solid #1a1a1a;padding-top:20px">
      ${isCoach
        ? 'You are getting this because notifications are on for your coach profile.'
        : `Need to change or cancel? <a href="${escapeHtml(manageUrl)}" style="color:#666">Manage your booking</a>. Times are shown in ${escapeHtml(n.time_zone.replace('_', ' '))}.`}
    </p>
  </div>
</body></html>`
}

// ─────────────────────────────────────────────────────────────────────────────

async function send(n: Claimed): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return { ok: false, error: 'no_api_key' }

  const start = new Date(n.booked_at)
  const end   = new Date(start.getTime() + n.duration_minutes * MS_PER_MINUTE)
  const zone  = n.time_zone
  const coach = coachLabel(n.coach_slug)
  const isCoach = n.kind === 'coach_alert' || n.recipient !== n.client_email

  // Always rendered in the COACH's zone with the abbreviation spelled out. A
  // bare "9:00 AM" in an email is read in whatever zone the reader is standing
  // in, and that is the entire reason this class of bug ships.
  const when = `${formatDateInTimeZone(start, zone)}, ${formatTimeInTimeZone(start, zone)} ${timeZoneAbbreviation(start, zone)}`

  const copy = copyFor(n, when, coach)

  const attachments = copy.ics
    ? [{
        filename: 'axis-booking.ics',
        content: icsBase64(buildIcs({
          // The booking id, stable for the life of the booking. Reusing it is
          // what makes the reschedule mail an UPDATE to the calendar entry
          // rather than a second entry beside the first.
          uid:            `booking-${n.booking_id}@axistrainingsystems.com`,
          start,
          end,
          summary:        `${n.service_name ?? 'Axis call'} — ${isCoach ? `${n.first_name} ${n.last_name}` : coach}`,
          description:    n.meet_url ? `Join: ${n.meet_url}` : undefined,
          location:       n.meet_url ?? undefined,
          organizerName:  'Axis Training Systems',
          organizerEmail: 'noreply@axistrainingsystems.com',
          attendeeName:   `${n.first_name} ${n.last_name}`,
          attendeeEmail:  n.client_email,
          // A calendar ignores an update that is not numbered higher than the
          // copy it holds, so every mail about a moved booking has to advance
          // this. The kind is a coarse but monotonic stand-in: nothing sends
          // 'reschedule' before 'confirmation'.
          sequence:       n.kind === 'reschedule' ? 2 : n.kind === 'cancellation' ? 3 : n.kind === 'confirmed' ? 1 : 0,
          method:         copy.ics,
        })),
      }]
    : undefined

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress(),
      to: [n.recipient],
      subject: copy.subject,
      html: renderEmail(copy, n, when, isCoach),
      ...(attachments ? { attachments } : {}),
    }),
  })

  if (!res.ok) {
    // The status, never the body: an upstream body can echo back the address it
    // was given, and this string is written to a column.
    return { ok: false, error: `resend_${res.status}` }
  }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Meet-link recovery sweep
//
// Migration 007 built `google_sync_outbox` for exactly this and then nothing was
// ever written to drain it: rows go in on every booking and nothing takes them
// out, private.calendar_gc only deletes rows already marked completed, and
// nothing marks them completed. So the comment in booking-create that says a
// failed push is "left at 'pending' for the outbox to retry" described a retry
// that did not exist, and a booking whose Google push failed kept
// google_sync_status='pending' and no Meet link for ever.
//
// This sweep is that retry. It adopts the outbox's job WITHOUT adopting the
// outbox: the bookings row already carries the state the drain needs
// (google_sync_status, google_event_id, created_at), so the queue table is not
// a second source of truth worth keeping in step. google_sync_outbox remains
// write-only legacy — still enqueued by bookings_mirror_to_busy, still read by
// nobody — and a later migration may drop it and that trigger's insert.
//
// What it is careful about:
//   • Cancelled bookings are excluded. booking-update's failed-cancel branch and
//     booking-manage's client cancel both leave rows at 'pending', and pushing
//     one would put a cancelled appointment back on the coach's calendar and
//     mail the client an invite for it (mirrorUpsert sends updates to all).
//   • Bookings whose end has passed are excluded. A Meet link for a call that
//     already happened is not a recovery, it is an invite to a past event.
//   • The event payload is the one booking-create builds, from the columns that
//     booking's snapshot fields hold. It is duplicated rather than shared: the
//     three call sites already each build it from what they have (booking-update
//     has its own eventSummary/eventDescription), and a shared builder would
//     have to take either a payload or a row shape that no two of them agree on.
//   • Any event id the row already holds is passed through, so a row that failed
//     part-way PATCHes its existing event instead of creating a second one. That
//     branch cannot mint a Meet link — only insert can — but a duplicate event on
//     a coach's calendar is worse than a link they can add by hand.
//   • A row with NO event id is not assumed to have no event. booking-create's
//     push can reach Google, create the event and mail the client, and still
//     leave the row at 'pending' with google_event_id null if the response is
//     lost or the row update fails. Inserting there would be a second event and
//     a second invitation in the client's inbox, so the sweep looks first
//     (mirrorFindEvent) and adopts what it finds. A lookup it could not perform
//     is not a licence to insert: that row waits for the next run.
//
// Terminal versus transient. 'failed' in google_sync_status means WILL NOT HEAL
// WITHOUT HUMAN ACTION, and the reason is in google_sync_error as an opaque
// code: a coach who revoked Axis in their Google settings, a credential this
// deployment cannot decrypt, a coach with no usable settings row. Those rows
// leave the sweep, because sorting oldest-first meant they otherwise held their
// place in every batch of five for a week and starved the rows behind them.
// Everything else stays at 'pending' and is retried, and the seven-day window
// is still the entire budget for those.
// ─────────────────────────────────────────────────────────────────────────────

/** The booking columns the sweep needs, and no others. */
interface PendingSync {
  id: string
  coach_slug: string
  booked_at: string
  duration_minutes: number
  first_name: string
  last_name: string
  email: string
  phone: string | null
  service_name: string | null
  goals: string | null
  google_event_id: string | null
  google_calendar_id: string | null
}

interface Recovery {
  swept: number
  synced: number
  skipped: number
  /** Transient failures. Still 'pending', will be tried again. */
  failed: number
  /** Terminal failures. Now 'failed', with the reason in google_sync_error. */
  stopped: number
  /** Rows that turned out to already have an event, and PATCHed it. */
  adopted: number
}

/**
 * Take a row out of the sweep for good, with the reason attached.
 *
 * Guarded on 'pending' like every other write here: a coach confirming or
 * moving the same booking in booking-update may have synced it since this run
 * read it, and this must not paint 'failed' over their 'synced'.
 */
async function stopSweeping(db: SupabaseClient, bookingId: string, code: string): Promise<void> {
  const { error } = await db.from('bookings')
    .update({ google_sync_status: 'failed', google_sync_error: code })
    .eq('id', bookingId)
    .eq('google_sync_status', 'pending')
  if (error) console.error('booking-notify recovery_persist', error.code)
}

async function recoverPendingSyncs(db: SupabaseClient): Promise<Recovery> {
  const out: Recovery = { swept: 0, synced: 0, skipped: 0, failed: 0, stopped: 0, adopted: 0 }

  const now = new Date()
  const since = new Date(now.getTime() - RECOVERY_WINDOW_DAYS * MS_PER_DAY).toISOString()

  // Oldest first: the booking that has been waiting longest is the one whose
  // client is closest to needing the link.
  const { data, error } = await db
    .from('bookings')
    .select(
      'id,coach_slug,booked_at,duration_minutes,first_name,last_name,email,phone,' +
      'service_name,goals,google_event_id,google_calendar_id'
    )
    .eq('google_sync_status', 'pending')
    .neq('status', 'cancelled')
    .gt('created_at', since)
    .gt('ends_at', now.toISOString())
    .order('created_at', { ascending: true })
    .limit(RECOVERY_BATCH)

  if (error) {
    console.error('booking-notify recovery_read', error.code)
    return out
  }

  const pending = (data ?? []) as PendingSync[]
  out.swept = pending.length

  // Sequential, like the mail above. These are token refreshes and Google writes
  // against one coach at a time, and there is no hurry.
  for (const b of pending) {
    // The coach's zone, from the loader booking-create used. Null is "no usable
    // settings row", and there is no zone to fall back to: an event written in
    // the wrong zone is a call an hour out, not a cosmetic defect. Nothing this
    // function does will produce that row, so the booking stops being swept.
    const policy = await loadCoachPolicy(db, b.coach_slug)
    if (!policy) {
      out.stopped++
      console.error('booking-notify recovery_sync', b.id, POLICY_MISSING)
      await stopSweeping(db, b.id, POLICY_MISSING)
      continue
    }

    const start = new Date(b.booked_at)
    const end   = new Date(start.getTime() + b.duration_minutes * MS_PER_MINUTE)

    let existing = { eventId: b.google_event_id, calendarId: b.google_calendar_id }

    // Look before inserting. Only when the row holds no event id: with one, the
    // upsert PATCHes and there is nothing to look for.
    if (!existing.eventId) {
      const found = await mirrorFindEvent(db, b.coach_slug, {
        bookingId:  b.id,
        startsAt:   start,
        timeMin:    new Date(start.getTime() - ADOPT_PAD_MS),
        timeMax:    new Date(end.getTime() + ADOPT_PAD_MS),
        calendarId: b.google_calendar_id,
      })

      if (found.status === 'found') {
        // The event booking-create created and never got to record. PATCHing it
        // updates the invitation the client already has instead of sending a
        // second one, and the ids are persisted below like any other sync.
        out.adopted++
        existing = { eventId: found.eventId, calendarId: found.calendarId }
      } else if (found.status === 'failed') {
        // Not knowing whether an event exists is the one state in which we do
        // not insert. Nothing is lost by waiting: the row is still pending and
        // the next invocation asks again.
        if (TERMINAL_SYNC_CODES.has(found.code)) {
          out.stopped++
          await stopSweeping(db, b.id, found.code)
        } else {
          out.failed++
        }
        console.error('booking-notify recovery_lookup', b.id, found.code)
        continue
      }
      // 'skipped' and 'absent' both fall through: 'skipped' is a coach with no
      // connection, and letting the upsert below say so keeps that terminal
      // write in one place; 'absent' is the ordinary case, an insert.
    }

    const sync = await mirrorUpsert(
      db,
      b.coach_slug,
      existing,
      {
        summary:     `${b.service_name ?? 'Axis Consultation'} — ${b.first_name} ${b.last_name}`,
        description: [
          b.service_name ? `Service: ${b.service_name} (${b.duration_minutes} min)` : null,
          b.goals ? `Goals: ${b.goals}` : null,
          b.phone ? `Phone: ${b.phone}` : null,
          `Booking ID: ${b.id}`,
        ].filter(Boolean).join('\n'),
        start,
        end,
        timeZone:      policy.timeZone,
        attendeeEmail: b.email,
        attendeeName:  `${b.first_name} ${b.last_name}`,
        // Stamped on the event when this is an insert, so the NEXT run can find
        // it by key if this one's answer never comes back.
        bookingId:     b.id,
      }
    )

    // Both writes re-assert google_sync_status='pending'. Nothing else in this
    // function is racing for the row, but a coach confirming or moving the same
    // booking in booking-update is, and if they got there first their event id
    // is the current one — this write is stale and must not land on top of it.
    if (sync.status === 'synced') {
      out.synced++
      const { error: persistError } = await db.from('bookings').update({
        google_event_id:    sync.eventId,
        google_calendar_id: sync.calendarId,
        google_meet_url:    sync.meetLink,
        google_synced_at:   new Date().toISOString(),
        google_sync_status: 'synced',
      }).eq('id', b.id).eq('google_sync_status', 'pending')
      if (persistError) console.error('booking-notify recovery_persist', persistError.code)
    } else if (sync.status === 'skipped') {
      // The coach disconnected Google between the booking and now, or never had
      // it. A terminal state, and the row stops being swept.
      out.skipped++
      const { error: persistError } = await db.from('bookings')
        .update({ google_sync_status: 'skipped' })
        .eq('id', b.id).eq('google_sync_status', 'pending')
      if (persistError) console.error('booking-notify recovery_persist', persistError.code)
    } else if (TERMINAL_SYNC_CODES.has(sync.code)) {
      // Nothing about the next five minutes changes this answer, so the row is
      // marked 'failed' and the reason is left where a person can read it. The
      // batch is five rows wide and sorted oldest-first; a row that can only
      // fail must not be allowed to occupy one of those places for a week.
      out.stopped++
      await stopSweeping(db, b.id, sync.code)
      console.error('booking-notify recovery_sync', b.id, sync.code)
    } else {
      // Left at 'pending' deliberately: the next invocation tries again, and the
      // seven-day window is what eventually stops it. The code is opaque and the
      // id is ours — neither is anybody's personal data.
      out.failed++
      console.error('booking-notify recovery_sync', b.id, sync.code)
    }
  }

  if (out.swept > 0) {
    console.log(
      `booking-notify recovery swept=${out.swept} synced=${out.synced} ` +
      `adopted=${out.adopted} skipped=${out.skipped} ` +
      `failed=${out.failed} stopped=${out.stopped}`
    )
  }

  return out
}

/**
 * Constant-time string compare. Returns false on a length mismatch, which does
 * leak the length — irrelevant for credentials whose length is not the secret,
 * and the alternative is a compare that leaks the prefix instead.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Either of the two credentials above. Never a user session. */
function isDispatcher(req: Request): boolean {
  const header  = req.headers.get('Authorization') ?? ''
  const bearer  = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (timingSafeEqual(bearer, service)) return true

  const cronSecret = Deno.env.get('BOOKING_NOTIFY_CRON_SECRET') ?? ''
  return timingSafeEqual(req.headers.get('x-cron-secret')?.trim() ?? '', cronSecret)
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Before anything is claimed. A claim counts an attempt against every row it
  // takes, so an unauthorized caller who got this far would be burning the
  // retry budget of mail that has not been sent yet.
  if (!isDispatcher(req)) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  const { data, error } = await db.rpc('claim_booking_notifications', { p_limit: BATCH_SIZE })
  if (error) {
    console.error('booking-notify claim', error.code)
    return new Response(JSON.stringify({ ok: false, error: 'claim_failed' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const claimed = (data ?? []) as Claimed[]
  let sent = 0
  let failed = 0

  // Sequential, not Promise.all. A batch of 25 firing at once is exactly the
  // shape Resend rate-limits, and the whole batch failing together would burn
  // an attempt on every one of them.
  for (const n of claimed) {
    const result = await send(n)

    if (result.ok) {
      sent++
      const { error: stampError } = await db
        .from('booking_notifications')
        .update({ sent_at: new Date().toISOString(), last_error: null })
        .eq('id', n.notification_id)
      // Failing to stamp is worse than failing to send: the row stays due and
      // the client gets the same email again on the next sweep. Loud, so it is
      // findable when someone reports a duplicate.
      if (stampError) console.error('booking-notify stamp', stampError.code)
    } else {
      failed++
      await db
        .from('booking_notifications')
        .update({ last_error: result.error })
        .eq('id', n.notification_id)
      console.error('booking-notify send', n.kind, result.error)
    }
  }

  // After the mail, never before it, and never able to stop it. The sweep does
  // its own error handling and returns counts; this catch is for the thing it
  // did not think of. Only the error's name is logged — a message can carry a
  // URL, an address, or whatever an upstream decided to echo back.
  let recovery: Recovery = { swept: 0, synced: 0, skipped: 0, failed: 0, stopped: 0, adopted: 0 }
  try {
    recovery = await recoverPendingSyncs(db)
  } catch (err) {
    console.error('booking-notify recovery', err instanceof Error ? err.name : 'unknown')
  }

  return new Response(JSON.stringify({ ok: true, claimed: claimed.length, sent, failed, recovery }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
