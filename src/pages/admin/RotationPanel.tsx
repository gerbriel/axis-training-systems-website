import { useState, useEffect, useCallback, useMemo } from 'react'
import { COACHES, getCoachBySlug } from '../../data/coaches'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { fetchAllContent } from '../../lib/contentApi'
import type { PendingContent } from '../../data/pendingContent'
import {
  fetchRotation, deriveStatuses, waiveCycle, formatCycleDate,
  type RotationStatus, type CycleState,
} from '../../lib/rotationApi'

const STATE_STYLE: Record<CycleState, { border: string; fg: string; label: string }> = {
  overdue:   { border: '#c8102e',        fg: '#f87171',        label: 'Overdue' },
  due:       { border: '#272C84',        fg: 'var(--text)',    label: 'Due' },
  submitted: { border: '#272C84',        fg: 'var(--text)',    label: 'In Review' },
  complete:  { border: '#22c55e',        fg: '#22c55e',        label: 'Complete' },
  upcoming:  { border: 'var(--border)',  fg: 'var(--text-3)',  label: 'Upcoming' },
  waived:    { border: 'var(--border)',  fg: 'var(--text-3)',  label: 'Waived' },
}

// Cycles a coach still owes something on — what the head coach actually chases.
const NEEDS_ACTION: CycleState[] = ['overdue', 'due', 'submitted']

interface Props { isDemo?: boolean }

export default function RotationPanel({ isDemo = false }: Props) {
  const [statuses, setStatuses] = useState<RotationStatus[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [showAll, setShowAll]   = useState(false)
  const [busyId, setBusyId]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [cycles, content] = await Promise.all([
        fetchRotation(isDemo),
        fetchAllContent(isDemo) as Promise<PendingContent[]>,
      ])
      setStatuses(deriveStatuses(cycles, content))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load the rotation schedule.')
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { load() }, [load])

  async function toggleWaive(s: RotationStatus) {
    const next = !s.cycle.waived
    let note: string | undefined
    if (next) {
      const answer = window.prompt('Reason for waiving this cycle? (optional)') ?? ''
      note = answer.trim() || undefined
    }
    setBusyId(s.cycle.id)
    try {
      await waiveCycle(s.cycle.id, next, note, isDemo)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update that cycle.')
    } finally {
      setBusyId(null)
    }
  }

  // Per coach: the cycle that matters now — the oldest one still outstanding,
  // else the next one on the calendar.
  const currentPerCoach = useMemo(() => {
    return COACHES.map(coach => {
      const mine = statuses
        .filter(s => s.cycle.coachSlug === coach.slug)
        .sort((a, b) => a.cycle.dueDate.localeCompare(b.cycle.dueDate))
      const current =
        mine.find(s => s.state === 'overdue') ??
        mine.find(s => s.state === 'due') ??
        mine.find(s => s.state === 'submitted') ??
        mine.find(s => s.state === 'upcoming') ??
        mine[mine.length - 1]
      const completed = mine.filter(s => s.state === 'complete').length
      return { coach, current, completed, total: mine.length }
    })
  }, [statuses])

  const upcoming = useMemo(() => {
    const rows = statuses
      .slice()
      .sort((a, b) => a.cycle.dueDate.localeCompare(b.cycle.dueDate))
    return showAll ? rows : rows.filter(s => NEEDS_ACTION.includes(s.state))
  }, [statuses, showAll])

  const overdueCount = statuses.filter(s => s.state === 'overdue').length

  if (loading) return <div style={{ padding: '2rem' }}><p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>Loading rotation…</p></div>

  return (
    <div style={{ padding: '2rem', maxWidth: 1000 }}>
      {isDemo && <DemoBanner />}
      {error && (
        <div style={{ background: 'rgba(200,16,46,.08)', border: '1px solid #c8102e', borderRadius: '.25rem', padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <p style={{ color: '#f87171', fontSize: '.8rem', fontWeight: 700 }}>{error}</p>
        </div>
      )}

      <div style={{ marginBottom: '2rem' }}>
        <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.7, maxWidth: 620 }}>
          Every coach contributes one blog every two months. Turns are staggered two weeks apart,
          so a post lands roughly every fortnight rather than five arriving at once.
          {overdueCount > 0 && (
            <>
              {' '}
              <strong style={{ color: '#f87171' }}>
                {overdueCount} cycle{overdueCount === 1 ? ' is' : 's are'} overdue.
              </strong>
            </>
          )}
        </p>
      </div>

      {/* ── Per-coach summary ─────────────────────────────────────────────── */}
      <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
        Coaches
      </p>
      {/* Bordered cards rather than a 1px-gap grid: the roster is an odd number,
          so a gap-grid leaves the trailing empty cell rendering as a filled box. */}
      <div style={{ display: 'grid', gap: '.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', marginBottom: '2.5rem' }}>
        {currentPerCoach.map(({ coach, current, completed, total }) => {
          const st = current ? STATE_STYLE[current.state] : STATE_STYLE.upcoming
          return (
            <div key={coach.slug} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '1.25rem 1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.5rem', flexWrap: 'wrap' }}>
                <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.875rem' }}>{coach.name}</p>
                {current && (
                  <span style={{
                    background: st.border, color: '#fff',
                    fontSize: '.5rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
                    padding: '.15rem .45rem', borderRadius: '.15rem',
                  }}>{st.label}</span>
                )}
              </div>
              {current ? (
                <p style={{ color: st.fg, fontSize: '.75rem' }}>
                  Due {formatCycleDate(current.cycle.dueDate)}
                  {current.state === 'overdue' && ` · ${Math.abs(current.daysUntilDue)}d late`}
                  {current.state === 'due'     && ` · ${current.daysUntilDue}d left`}
                </p>
              ) : (
                <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>No cycles scheduled.</p>
              )}
              <p style={{ color: 'var(--text-3)', fontSize: '.65rem', marginTop: '.4rem' }}>
                {completed} of {total} cycles published
              </p>
            </div>
          )
        })}
      </div>

      {/* ── Schedule ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase' }}>
          {showAll ? `Full Schedule (${upcoming.length})` : `Needs Attention (${upcoming.length})`}
        </p>
        <button
          onClick={() => setShowAll(v => !v)}
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .75rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {showAll ? 'Show Needs Attention' : 'Show Full Schedule'}
        </button>
      </div>

      {upcoming.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>
          Nothing outstanding — every coach is current on their rotation.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--surface)' }}>
          {upcoming.map(s => {
            const st = STATE_STYLE[s.state]
            const coach = getCoachBySlug(s.cycle.coachSlug)
            return (
              <div key={s.cycle.id} style={{ background: 'var(--bg)', padding: '1rem 1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{
                  border: `1px solid ${st.border}`, color: st.fg,
                  fontSize: '.5rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
                  padding: '.2rem .5rem', borderRadius: '.15rem', flexShrink: 0, minWidth: 74, textAlign: 'center',
                }}>{st.label}</span>

                <div style={{ flex: 1, minWidth: 200 }}>
                  <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.8rem' }}>
                    {coach?.name ?? s.cycle.coachSlug}
                  </p>
                  <p style={{ color: 'var(--text-3)', fontSize: '.7rem', marginTop: '.15rem' }}>
                    {formatCycleDate(s.cycle.cycleStart)} → due {formatCycleDate(s.cycle.dueDate)}
                  </p>
                  {s.post && (
                    <p style={{ color: 'var(--text-2)', fontSize: '.72rem', marginTop: '.25rem' }}>
                      “{s.post.title}”
                    </p>
                  )}
                  {s.cycle.waived && s.cycle.waiveNote && (
                    <p style={{ color: 'var(--text-3)', fontSize: '.7rem', marginTop: '.25rem' }}>
                      Waived — {s.cycle.waiveNote}
                    </p>
                  )}
                </div>

                {/* A published cycle is settled; waiving it would be meaningless. */}
                {s.state !== 'complete' && (
                  <button
                    onClick={() => toggleWaive(s)}
                    disabled={busyId === s.cycle.id || isDemo}
                    title={isDemo ? 'Waiving is disabled in demo mode' : undefined}
                    style={{
                      background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)',
                      fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                      padding: '.35rem .75rem', borderRadius: '.2rem', fontFamily: 'inherit', flexShrink: 0,
                      cursor: busyId === s.cycle.id || isDemo ? 'not-allowed' : 'pointer',
                      opacity: busyId === s.cycle.id || isDemo ? .4 : 1,
                    }}
                  >
                    {busyId === s.cycle.id ? '…' : s.cycle.waived ? 'Un-waive' : 'Waive'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
