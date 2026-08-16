import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  clockIn, clockOut, fetchMyEntries, fetchOpenEntry,
  kindForRole, elapsedClock, formatMinutes, formatWhen,
  type TimeEntry, type TimeEntryKind,
} from '../lib/timeclock'

const ACCENT = '#272C84'
const GREEN = '#22c55e'
const DANGER = '#c8102e'

/**
 * The clock, as a mountable widget.
 *
 * One button that says Clock In or Clock Out depending on whether an entry is
 * open, the open entry's elapsed time ticking live, and a short recent history.
 * The KIND is driven by the signed-in role — an athlete logs a gym visit, a
 * coach or admin logs a work shift — which the database enforces, so this only
 * has to render the right label.
 *
 * Self-contained: it fetches its own state and needs no props to work on the
 * account page. Pass `variant` to force athlete/coach where there is no session
 * to read (a coach portal in demo), and `isDemo` to run against seeded data.
 */
export default function TimeClock({
  variant,
  isDemo = false,
}: {
  variant?: 'athlete' | 'coach'
  isDemo?: boolean
}) {
  const { profile } = useAuth()

  // The role decides the kind. An explicit variant wins (the coach portal knows
  // what it is even in demo, where there is no profile to read); otherwise the
  // signed-in role does, defaulting to the athlete's gym visit.
  const role = variant === 'coach' ? 'coach' : variant === 'athlete' ? 'athlete' : (profile?.role ?? 'athlete')
  const kind: TimeEntryKind = kindForRole(role)
  const isShift = kind === 'work_shift'

  const [open, setOpen] = useState<TimeEntry | null>(null)
  const [history, setHistory] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')

  // Re-renders once a second so the open entry's elapsed clock ticks. Only runs
  // while something is open — a dormant widget does not need a heartbeat.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!open) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [open])

  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [openRow, rows] = await Promise.all([
      fetchOpenEntry(kind, isDemo),
      fetchMyEntries(kind, isDemo, 8),
    ])
    if (!live.current) return
    // A failed history read is an outage; an empty one is a real "nothing yet".
    if (rows === null) { setOutage(true); setHistory([]) }
    else { setOutage(false); setHistory(rows) }
    setOpen(openRow)
    setLoading(false)
  }, [kind, isDemo])

  useEffect(() => { void load() }, [load])

  const punchIn = async () => {
    if (busy) return
    setBusy(true); setError(null)
    const res = await clockIn(kind, null, isDemo)
    if (!live.current) return
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setOpen(res.entry)
    setNowMs(Date.now())
    void load()
  }

  const punchOut = async () => {
    if (busy) return
    setBusy(true); setError(null)
    const res = await clockOut(note || null, isDemo, kind)
    if (!live.current) return
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setNote('')
    setOpen(null)
    void load()
  }

  const title = isShift ? 'Your shift' : 'Gym clock'
  const inLabel = isShift ? 'Clock in' : "I'm here"
  const outLabel = isShift ? 'Clock out' : 'Head out'
  const idleCopy = isShift
    ? "Clock in when your shift starts. Your hours roll up for the admin's records."
    : 'Tap in when you get to the gym and out when you leave. It is just for you and your coach.'

  return (
    <section
      style={{
        background: 'var(--surface)', border: '1px solid var(--surface-2)',
        borderRadius: '.4rem', padding: '1.25rem 1.4rem', maxWidth: 560,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '1rem' }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: open ? GREEN : 'var(--text-4)',
          boxShadow: open ? `0 0 0 4px ${GREEN}22` : 'none',
        }} />
        <h3 style={{ color: 'var(--text)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase' }}>
          {title}
        </h3>
        {isDemo && (
          <span style={{ marginLeft: 'auto', color: 'var(--text-4)', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase' }}>
            Demo
          </span>
        )}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-3)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '1rem 0' }}>
          Loading…
        </p>
      ) : (
        <>
          {/* The live state ------------------------------------------------- */}
          {open ? (
            <div style={{ marginBottom: '1rem' }}>
              <p style={{ color: 'var(--text-3)', fontSize: '.7rem', marginBottom: '.35rem' }}>
                {isShift ? 'On the clock since' : 'In the gym since'} {formatWhen(open.clock_in)}
              </p>
              <p
                aria-live="off"
                style={{ color: 'var(--text)', fontSize: '2.4rem', fontWeight: 900, letterSpacing: '.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}
              >
                {elapsedClock(open.clock_in, nowMs)}
              </p>
            </div>
          ) : (
            <p style={{ color: 'var(--text-3)', fontSize: '.82rem', lineHeight: 1.6, marginBottom: '1rem', maxWidth: 420 }}>
              {idleCopy}
            </p>
          )}

          {/* An optional note, only worth asking for on the way out of a shift */}
          {open && isShift && (
            <input
              className="field"
              placeholder="Add a note for this shift (optional)"
              maxLength={280}
              value={note}
              onChange={e => setNote(e.target.value)}
              style={{ marginBottom: '.75rem' }}
            />
          )}

          {error && (
            <div role="alert" style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.6rem .8rem', marginBottom: '.75rem' }}>
              <span style={{ color: DANGER, fontSize: '.78rem', lineHeight: 1.5 }}>{error}</span>
            </div>
          )}

          {/* The one button -------------------------------------------------- */}
          <button
            onClick={() => void (open ? punchOut() : punchIn())}
            disabled={busy}
            style={{
              width: '100%',
              background: open ? DANGER : ACCENT,
              border: 'none', color: '#ffffff',
              fontSize: '.8rem', fontWeight: 900, letterSpacing: '.18em', textTransform: 'uppercase',
              padding: '1rem 1.25rem', minHeight: '3.25rem', borderRadius: '.3rem',
              cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Saving…' : open ? outLabel : inLabel}
          </button>

          {/* Recent history -------------------------------------------------- */}
          <div style={{ marginTop: '1.4rem' }}>
            <p style={{ color: 'var(--text-4)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.6rem' }}>
              Recent
            </p>

            {outage ? (
              <p style={{ color: 'var(--text-4)', fontSize: '.78rem' }}>
                Couldn&rsquo;t load your history — that&rsquo;s on our side.
              </p>
            ) : history.length === 0 ? (
              <p style={{ color: 'var(--text-4)', fontSize: '.78rem' }}>
                {isShift ? 'No shifts logged yet.' : 'No visits logged yet.'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {history.map(h => {
                  const isOpenRow = h.clock_out === null
                  const mins = isOpenRow ? 0 : Math.max(0, Math.floor((new Date(h.clock_out as string).getTime() - new Date(h.clock_in).getTime()) / 60_000))
                  return (
                    <div
                      key={h.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.55rem 0', borderTop: '1px solid var(--surface-2)' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ color: 'var(--text-2)', fontSize: '.78rem', fontWeight: 600 }}>
                          {formatWhen(h.clock_in)}
                        </p>
                        {h.note && (
                          <p style={{ color: 'var(--text-4)', fontSize: '.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {h.note}
                          </p>
                        )}
                      </div>
                      {isOpenRow ? (
                        <span style={{ color: GREEN, fontSize: '.6rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                          Open
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-3)', fontSize: '.78rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {formatMinutes(mins)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
