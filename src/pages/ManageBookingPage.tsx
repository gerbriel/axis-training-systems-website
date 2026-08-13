import { useState, useEffect, useCallback } from 'react'
import {
  getBooking, cancelBooking, rescheduleBooking, manageErrorMessage,
} from '../lib/bookingManage'
import type { ManagedBooking, ManageDay, ManageErrorCode } from '../lib/bookingManage'
import {
  fmtDateInZone, fmtTimeInZone, tzLabel, fmtDuration, browserTimeZone,
} from '../lib/availability'
import { dateKeyInTimeZone } from '../lib/tz'
import { downloadCalendarFile } from '../lib/ics'
import { trackBookingEvent } from '../lib/analytics'
import { COACHES } from '../data/coaches'
import { href } from '../utils/nav'
import { safeUrl } from '../utils/sanitize'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'
const ACCENT = '#272C84'

/**
 * The client's own booking, reached by the token in their confirmation email.
 *
 * Before this page existed a booking ended at the confirmation screen: no way
 * to cancel, no way to move it, and no way to find out it had been confirmed.
 * A client who cannot cancel does not cancel — they no-show, and the coach
 * loses the hour instead of getting it back.
 *
 * Every permission shown here (`canCancel`, `canReschedule`) is decided by the
 * server and rendered, never re-derived. A disabled button that hides a 409, or
 * an enabled one that produces it, are both ways of lying to somebody about
 * their own booking.
 */

function Panel({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'warn' }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${tone === 'warn' ? 'rgba(200,16,46,.35)' : 'var(--surface-2)'}`,
      borderRadius: '.25rem', padding: '1.5rem', marginBottom: '1.25rem',
    }}>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: ACCENT, fontSize: '.6rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.75rem' }}>
      {children}
    </p>
  )
}

function coachName(slug: string): string {
  return COACHES.find(c => c.slug === slug)?.name
    ?? slug.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

function StatusBadge({ booking }: { booking: ManagedBooking }) {
  const [text, color] =
    booking.status === 'cancelled' ? ['Cancelled', 'var(--text-4)'] :
    booking.isPast                 ? ['Completed', 'var(--text-4)'] :
    booking.status === 'confirmed' ? ['Confirmed', '#22c55e'] :
                                     ['Awaiting confirmation', '#eab308']

  return (
    <span style={{
      display: 'inline-block', padding: '.25rem .6rem', borderRadius: '999px',
      border: `1px solid ${color}`, color, background: 'transparent',
      fontSize: '.6rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
    }}>
      {text}
    </span>
  )
}

function ReschedulePicker({ availability, timeZone, viewerZone, busy, onPick }: {
  availability: ManageDay[] | null
  timeZone: string
  viewerZone: string
  busy: boolean
  onPick: (start: Date) => void
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // null is the OUTAGE signal, [] is a genuinely empty month. Saying "no times"
  // for an outage claims something about the coach's calendar that we did not
  // manage to find out.
  if (availability === null) {
    return (
      <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.6 }}>
        We couldn’t load your coach’s calendar just now — that’s on our side. Reload the page and try again,
        or reply to your confirmation email and we’ll move it for you.
      </p>
    )
  }

  const withSlots = availability.filter(d => d.slots.length > 0)

  if (withSlots.length === 0) {
    return (
      <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.6 }}>
        Nothing else is open in the next four weeks. Reply to your confirmation email and your coach will find you a time.
      </p>
    )
  }

  const day = withSlots.find(d => d.dateKey === selectedDate)

  return (
    <div>
      <p style={{ color: 'var(--text-3)', fontSize: '.75rem', marginBottom: '.9rem' }}>
        Times in your timezone ({tzLabel(new Date(), viewerZone)}). Your coach is in {timeZone.replace('_', ' ')}.
      </p>

      <div style={{ display: 'flex', gap: '.4rem', overflowX: 'auto', paddingBottom: '.6rem', marginBottom: '1rem' }}>
        {withSlots.map(d => {
          const active = d.dateKey === selectedDate
          const [, month, dayNum] = d.dateKey.split('-')
          return (
            <button
              key={d.dateKey}
              onClick={() => setSelectedDate(d.dateKey)}
              style={{
                flexShrink: 0, minWidth: 62, padding: '.55rem .5rem',
                background: active ? ACCENT : 'var(--bg)',
                border: `1px solid ${active ? ACCENT : 'var(--surface-2)'}`,
                borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
                color: active ? '#fff' : 'var(--text)', textAlign: 'center',
              }}
            >
              <span style={{ display: 'block', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.1em', opacity: .75 }}>
                {monthShort(Number(month))}
              </span>
              <span style={{ display: 'block', fontSize: '1rem', fontWeight: 900, lineHeight: 1.2 }}>
                {Number(dayNum)}
              </span>
              <span style={{ display: 'block', fontSize: '.55rem', opacity: .75 }}>
                {d.slots.length}
              </span>
            </button>
          )
        })}
      </div>

      {!day ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.8rem' }}>Pick a date to see times.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '.5rem' }}>
          {day.slots.map((s, i) => {
            // A slot is grouped under the COACH's day but rendered in the
            // viewer's. When those disagree the button says so, rather than
            // showing a time under a date it does not belong to.
            const crossesDay = dateKeyInTimeZone(s.start, viewerZone) !== day.dateKey
            return (
              <button
                key={i}
                disabled={busy}
                onClick={() => onPick(s.start)}
                style={{
                  background: 'var(--bg)', border: '1px solid var(--surface-2)',
                  color: busy ? 'var(--text-4)' : 'var(--text)',
                  fontSize: '.78rem', fontWeight: 700, padding: '.6rem .5rem',
                  borderRadius: '.25rem', cursor: busy ? 'default' : 'pointer',
                  fontFamily: 'inherit', textAlign: 'center',
                }}
              >
                {crossesDay && (
                  <span style={{ display: 'block', fontSize: '.6rem', opacity: .7, fontWeight: 700 }}>
                    {fmtDateInZone(s.start, viewerZone)}
                  </span>
                )}
                {fmtTimeInZone(s.start, viewerZone)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function monthShort(month: number): string {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1] ?? ''
}

export default function ManageBookingPage({ token }: { token: string }) {
  const viewerZone = browserTimeZone()

  const [booking, setBooking] = useState<ManagedBooking | null>(null)
  const [availability, setAvailability] = useState<ManageDay[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<ManageErrorCode | null>(null)

  const [mode, setMode] = useState<'view' | 'cancelling' | 'rescheduling'>('view')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getBooking(token)
    if (!res.ok) {
      setLoadError(res.code)
      setBooking(null)
    } else {
      setLoadError(null)
      setBooking(res.data.booking)
      setAvailability(res.data.availability)
    }
    setLoading(false)
  }, [token])

  useEffect(() => { void load() }, [load])

  const doCancel = async () => {
    if (!booking || busy) return
    setBusy(true)
    setActionError(null)

    const res = await cancelBooking(token, reason)
    setBusy(false)

    if (!res.ok) {
      setActionError(manageErrorMessage(res.code))
      return
    }

    trackBookingEvent('booking_cancelled_by_client', { coachSlug: booking.coachSlug })
    setMode('view')
    setFlash('Your booking is cancelled. The time is back on your coach’s calendar and we’ve emailed you a confirmation.')
    // Refetched rather than patched locally: cancelling changes what the server
    // will now allow, and this page renders the server's answer, not a guess.
    await load()
  }

  const doReschedule = async (start: Date) => {
    if (!booking || busy) return
    setBusy(true)
    setActionError(null)

    const res = await rescheduleBooking(token, start)
    setBusy(false)

    if (!res.ok) {
      setActionError(manageErrorMessage(res.code))
      // A slot that went stale means the calendar on screen is out of date.
      if (res.code === 'slot_taken' || res.code === 'slot_unavailable') await load()
      return
    }

    trackBookingEvent('booking_rescheduled_by_client', { coachSlug: booking.coachSlug })
    setMode('view')
    setFlash('Moved. Your calendar invite has been updated and we’ve emailed you the new time.')
    await load()
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <header style={{ background: 'var(--bg)', borderBottom: '1px solid var(--surface)', padding: '0 1.25rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.25rem' }}>
        <a href={href('/')} style={{ display: 'flex', alignItems: 'center' }}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 22, filter: 'var(--logo-filter)' }} />
        </a>
        <span style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase' }}>Your booking</span>
      </header>

      <div style={{ maxWidth: 620, margin: '0 auto', padding: '2.5rem 1.25rem 5rem' }}>
        {loading ? (
          <div style={{ padding: '4rem 0', textAlign: 'center', color: 'var(--text-3)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>
            Loading…
          </div>
        ) : loadError || !booking ? (
          <Panel>
            <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.4rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '.75rem' }}>
              We couldn’t open that booking
            </h1>
            <p style={{ color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.7, marginBottom: '1.5rem' }}>
              {manageErrorMessage(loadError ?? 'not_found')}
            </p>
            <a href={href('/book')} style={{ background: ACCENT, color: '#fff', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '.8rem 1.6rem', borderRadius: '.25rem', textDecoration: 'none', display: 'inline-block' }}>
              Book a call →
            </a>
          </Panel>
        ) : (
          <>
            <div style={{ marginBottom: '1.5rem' }}>
              <StatusBadge booking={booking} />
              <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.5rem,5vw,2.2rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: 1, margin: '.9rem 0 .5rem' }}>
                {booking.serviceName ?? 'Your call'}
              </h1>
              <p style={{ color: 'var(--text-3)', fontSize: '.9rem' }}>with {coachName(booking.coachSlug)}</p>
            </div>

            {flash && (
              <div style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.35)', borderRadius: '.25rem', padding: '.85rem 1rem', marginBottom: '1.25rem' }}>
                <span style={{ color: '#22c55e', fontSize: '.82rem', lineHeight: 1.6 }}>{flash}</span>
              </div>
            )}

            <Panel>
              {[
                ['When', `${fmtDateInZone(new Date(booking.bookedAt), viewerZone)}, ${fmtTimeInZone(new Date(booking.bookedAt), viewerZone)} ${tzLabel(new Date(booking.bookedAt), viewerZone)}`],
                ['Length', fmtDuration(booking.durationMinutes)],
                ['Booked as', `${booking.firstName} ${booking.lastName}`],
                ['Email', booking.email],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline', padding: '.65rem 0', borderBottom: '1px solid var(--surface-2)' }}>
                  <span style={{ color: 'var(--text-3)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', flexShrink: 0 }}>{label}</span>
                  <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.85rem', textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
                </div>
              ))}

              {booking.status === 'pending' && !booking.isPast && (
                <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.7, marginTop: '1rem' }}>
                  Your coach hasn’t confirmed this one yet. Your time is held on their calendar while that happens — nobody
                  else can take it — and we’ll email you the moment it’s confirmed.
                </p>
              )}

              {booking.status === 'cancelled' && (
                <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.7, marginTop: '1rem' }}>
                  This booking was cancelled{booking.cancelledAt ? ` on ${fmtDateInZone(new Date(booking.cancelledAt), viewerZone)}` : ''}.
                  {booking.cancellationReason ? ` Reason given: ${booking.cancellationReason}` : ''}
                </p>
              )}

              {/* The link comes back from booking-manage, but it is still a URL
                  out of a database column being handed to `href` — and React
                  renders a `javascript:` scheme there with only a warning. */}
              {safeUrl(booking.meetLink) && !booking.isPast && booking.status !== 'cancelled' && (
                <a href={safeUrl(booking.meetLink)} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: '1.25rem', background: ACCENT, color: '#fff', fontWeight: 900, fontSize: '.68rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '.75rem 1.5rem', borderRadius: '.25rem', textDecoration: 'none' }}>
                  Join the call
                </a>
              )}
            </Panel>

            {actionError && (
              <div style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.85rem 1rem', marginBottom: '1.25rem' }}>
                <span style={{ color: '#c8102e', fontSize: '.82rem', lineHeight: 1.6 }}>{actionError}</span>
              </div>
            )}

            {/* ── Reschedule ─────────────────────────────────────────────── */}
            {mode === 'rescheduling' && booking.canReschedule && (
              <Panel>
                <Label>Pick a new time</Label>
                <ReschedulePicker
                  availability={availability}
                  timeZone={booking.timeZone}
                  viewerZone={viewerZone}
                  busy={busy}
                  onPick={doReschedule}
                />
                <button onClick={() => { setMode('view'); setActionError(null) }} style={ghostButton()}>
                  Never mind
                </button>
              </Panel>
            )}

            {/* ── Cancel ─────────────────────────────────────────────────── */}
            {mode === 'cancelling' && booking.canCancel && (
              <Panel tone="warn">
                <Label>Cancel this booking</Label>
                <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.65, marginBottom: '1rem' }}>
                  This gives the time back to {coachName(booking.coachSlug).split(' ')[0]} straight away. You can always book again.
                </p>
                <label className="field-label" htmlFor="cancel-reason">Anything you want to tell them? (optional)</label>
                <textarea
                  id="cancel-reason"
                  className="field"
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Something came up…"
                />
                <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                  <button onClick={doCancel} disabled={busy} style={{
                    background: busy ? 'var(--border)' : '#c8102e', border: 'none', color: '#fff',
                    fontWeight: 900, fontSize: '.68rem', letterSpacing: '.15em', textTransform: 'uppercase',
                    padding: '.8rem 1.6rem', borderRadius: '.25rem', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
                  }}>
                    {busy ? 'Cancelling…' : 'Yes, cancel it'}
                  </button>
                  <button onClick={() => { setMode('view'); setActionError(null) }} style={ghostButton()}>
                    Keep it
                  </button>
                </div>
              </Panel>
            )}

            {/* ── Actions ────────────────────────────────────────────────── */}
            {mode === 'view' && (
              <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
                {booking.canReschedule && (
                  <button onClick={() => setMode('rescheduling')} style={outlineButton()}>
                    Move it {booking.reschedulesLeft <= 1 ? `(${booking.reschedulesLeft} left)` : ''}
                  </button>
                )}
                {booking.canCancel && (
                  <button onClick={() => setMode('cancelling')} style={outlineButton()}>
                    Cancel
                  </button>
                )}
                {booking.status !== 'cancelled' && !booking.isPast && (
                  <button
                    onClick={() => downloadCalendarFile({
                      uid: `booking-${booking.id}@axistrainingsystems.com`,
                      start: new Date(booking.bookedAt),
                      end: new Date(new Date(booking.bookedAt).getTime() + booking.durationMinutes * 60_000),
                      summary: `${booking.serviceName ?? 'Axis call'} — ${coachName(booking.coachSlug)}`,
                      description: booking.meetLink ? `Join: ${booking.meetLink}` : undefined,
                      location: booking.meetLink ?? undefined,
                    })}
                    style={outlineButton()}
                  >
                    Add to calendar
                  </button>
                )}
                {(booking.status === 'cancelled' || booking.isPast) && (
                  <a href={href(`/book?coach=${booking.coachSlug}`)} style={{ ...outlineButton(), textDecoration: 'none', display: 'inline-block' }}>
                    Book another →
                  </a>
                )}
              </div>
            )}

            {/*
              Said plainly rather than left for someone to discover by finding
              the buttons gone. The cutoff is the server's number, not a copy of
              it kept in sync by hand.
            */}
            {mode === 'view' && booking.status !== 'cancelled' && !booking.isPast && !booking.canCancel && (
              <p style={{ color: 'var(--text-4)', fontSize: '.78rem', lineHeight: 1.65, marginTop: '1.25rem' }}>
                It’s within {booking.cutoffMinutes / 60} hours of your call, so changes have to go through your coach now.
                Reply to your confirmation email and they’ll sort it out.
              </p>
            )}

            {mode === 'view' && booking.canCancel && !booking.canReschedule && booking.reschedulesLeft === 0 && (
              <p style={{ color: 'var(--text-4)', fontSize: '.78rem', lineHeight: 1.65, marginTop: '1.25rem' }}>
                This booking has been moved as many times as it can be online. Your coach can still move it for you.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function outlineButton(): React.CSSProperties {
  return {
    background: 'none', border: '1px solid var(--surface-2)', color: 'var(--text-2)',
    fontWeight: 700, fontSize: '.68rem', letterSpacing: '.12em', textTransform: 'uppercase',
    padding: '.8rem 1.4rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
  }
}

function ghostButton(): React.CSSProperties {
  return {
    background: 'none', border: 'none', color: 'var(--text-3)',
    fontWeight: 700, fontSize: '.66rem', letterSpacing: '.12em', textTransform: 'uppercase',
    padding: '.8rem 0 0', cursor: 'pointer', fontFamily: 'inherit',
  }
}
