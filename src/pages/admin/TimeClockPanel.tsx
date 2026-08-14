import { useState, useEffect, useCallback, useMemo } from 'react'
import { useMediaQuery, MOBILE_QUERY } from '../../lib/dashboard'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { ROLE_LABELS, ROLE_COLORS } from '../../lib/userManagement'
import {
  fetchOpen, fetchTotals,
  formatMinutes, minutesToHours, elapsedClock, formatWhen,
  type OpenEntry, type TimeTotal, type TimeEntryKind,
} from '../../lib/timeclock'

const ACCENT = '#272C84'
const GREEN = '#22c55e'

const microLabel: React.CSSProperties = {
  color: 'var(--text)', fontSize: '.6rem', fontWeight: 900,
  letterSpacing: '.3em', textTransform: 'uppercase',
}
const heading: React.CSSProperties = {
  color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem',
  textTransform: 'uppercase', letterSpacing: '-.01em',
}

// The panel speaks in people, not in `kind` — an admin filters by "athletes" or
// "coaches", which the table stores as gym_visit / work_shift.
type Who = 'all' | 'athletes' | 'coaches'
const KIND_OF: Record<Who, TimeEntryKind | null> = { all: null, athletes: 'gym_visit', coaches: 'work_shift' }

type RangeKey = 'today' | 'week' | 'last7' | 'month'
const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Today', week: 'This week', last7: 'Last 7 days', month: 'This month',
}

/** [from, to) for a preset, computed against `now`. `to` is now — an entry that
 *  started in the future does not exist, so this includes everything up to it. */
function rangeFor(key: RangeKey, now: Date): [Date, Date] {
  const to = now
  const from = new Date(now)
  from.setHours(0, 0, 0, 0)
  if (key === 'today') return [from, to]
  if (key === 'last7') { const f = new Date(now.getTime() - 7 * 86_400_000); return [f, to] }
  if (key === 'month') { from.setDate(1); return [from, to] }
  // week: back to Monday.
  const dow = (from.getDay() + 6) % 7 // Mon = 0
  from.setDate(from.getDate() - dow)
  return [from, to]
}

function Badge({ role }: { role: keyof typeof ROLE_LABELS }) {
  const c = ROLE_COLORS[role]
  return (
    <span style={{ background: `${c}18`, border: `1px solid ${c}`, color: c, fontSize: '.5rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.15rem .45rem', borderRadius: '.2rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {ROLE_LABELS[role]}
    </span>
  )
}

/**
 * The admin rollup: who is on the clock right now, and hours per person over a
 * range. The totals here are the number Commission will read later — closed
 * entries only, whole minutes, so an open shift never inflates a pay figure.
 *
 * This is a READ. `view_timeclock_all` (022) is what the database checks; an
 * admin holds it by definition, a coach only if it was handed to them. A caller
 * without it sees only their own rows come back — the panel does not pretend to
 * gate what RLS already does.
 */
export default function TimeClockPanel({ isDemo = false }: { isDemo?: boolean }) {
  const isMobile = useMediaQuery(MOBILE_QUERY)

  const [rangeKey, setRangeKey] = useState<RangeKey>('last7')
  const [who, setWho] = useState<Who>('all')

  const [openList, setOpenList] = useState<OpenEntry[]>([])
  const [totals, setTotals] = useState<TimeTotal[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)

  // A single clock, ticking every second, drives every open entry's elapsed
  // display — one timer for the whole panel rather than one per row.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  // Recomputed only when the preset changes, not on every tick — the range's
  // upper bound is "now" but a one-second drift does not change which day an
  // entry started in.
  const [from, to] = useMemo(() => rangeFor(rangeKey, new Date()), [rangeKey])
  const kind = KIND_OF[who]

  const load = useCallback(async () => {
    setLoading(true)
    const [open, tot] = await Promise.all([
      fetchOpen(isDemo),
      fetchTotals(from, to, kind, isDemo),
    ])
    // Either read failing is an outage — a rollup that silently shows nobody
    // when the server is down reads as "everyone went home", which is a lie.
    if (open === null || tot === null) { setOutage(true); setOpenList([]); setTotals([]) }
    else {
      setOutage(false)
      // The open list respects the athletes/coaches filter too, so the two
      // halves of the screen always agree about who they are showing.
      setOpenList(kind ? open.filter(o => o.kind === kind) : open)
      setTotals(tot)
    }
    setLoading(false)
  }, [isDemo, from, to, kind])

  useEffect(() => { void load() }, [load])

  const totalMinutes = totals.reduce((s, t) => s + t.total_minutes, 0)
  const people = totals.length

  const filterPills = (
    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
      {(['all', 'athletes', 'coaches'] as const).map(w => {
        const on = who === w
        return (
          <button
            key={w}
            onClick={() => setWho(w)}
            style={{
              background: on ? 'var(--surface-2)' : 'transparent',
              border: `1px solid ${on ? 'var(--text-dim)' : 'var(--border)'}`,
              color: on ? 'var(--text)' : 'var(--text-4)',
              fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
              padding: isMobile ? '.55rem .8rem' : '.35rem .8rem', borderRadius: '.25rem',
              cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}
          >
            {w}
          </button>
        )
      })}
    </div>
  )

  const rangePills = (
    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
      {(['today', 'week', 'last7', 'month'] as const).map(r => {
        const on = rangeKey === r
        return (
          <button
            key={r}
            onClick={() => setRangeKey(r)}
            style={{
              background: on ? `${ACCENT}22` : 'transparent',
              border: `1px solid ${on ? ACCENT : 'var(--border)'}`,
              color: on ? 'var(--text)' : 'var(--text-4)',
              fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
              padding: isMobile ? '.55rem .8rem' : '.35rem .8rem', borderRadius: '.25rem',
              cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}
          >
            {RANGE_LABELS[r]}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="dash-pad" style={{ paddingBottom: isMobile ? '1rem' : '1.25rem' }}>
      {isDemo && <DemoBanner note="Sample punches. Clocking in and out on the athlete or coach clock feeds these totals." />}

      {/* Stats */}
      <div style={{ display: 'flex', gap: isMobile ? '1.25rem 1.75rem' : '2.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        {([
          ['On the clock', openList.length, GREEN],
          ['People', people, 'var(--text)'],
          ['Hours', minutesToHours(totalMinutes).toFixed(2), ACCENT],
        ] as const).map(([label, value, color]) => (
          <div key={label}>
            <p style={{ color, fontWeight: 900, fontSize: '1.5rem', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '.25rem' }}>{label}</p>
          </div>
        ))}
      </div>

      <div style={{ maxWidth: 880 }}>
        {/* ── On the clock now ─────────────────────────────────────────────── */}
        <section style={{ marginBottom: '2.25rem' }}>
          <p style={{ ...microLabel, marginBottom: '.4rem' }}>Right now</p>
          <h2 style={{ ...heading, marginBottom: '.9rem' }}>
            {openList.length === 0 ? 'Nobody is on the clock' : `${openList.length} on the clock`}
          </h2>

          {loading ? (
            <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
          ) : outage ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>Couldn&rsquo;t load the clock.</p>
              <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>That&rsquo;s on our side.</p>
              <button onClick={() => void load()} style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--text)', color: 'var(--text)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '0 0 .25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                Try again
              </button>
            </div>
          ) : openList.length === 0 ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.25rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>Nobody is clocked in right now.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {openList.map(o => (
                <div
                  key={o.entry_id}
                  style={{
                    background: 'var(--surface)', border: `1px solid ${GREEN}44`, borderLeft: `3px solid ${GREEN}`,
                    borderRadius: '.25rem', padding: '.8rem 1.05rem',
                    display: 'flex', gap: '.85rem', alignItems: 'center', flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.15rem' }}>
                      <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.88rem' }}>{o.name ?? 'Someone'}</span>
                      <Badge role={o.role} />
                    </div>
                    <p style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>
                      {o.kind === 'work_shift' ? 'On shift since' : 'In the gym since'} {formatWhen(o.clock_in)}
                    </p>
                  </div>
                  <span style={{ color: GREEN, fontSize: '1.05rem', fontWeight: 900, fontVariantNumeric: 'tabular-nums', letterSpacing: '.02em' }}>
                    {elapsedClock(o.clock_in, nowMs)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Hours over a range ───────────────────────────────────────────── */}
        <section>
          <p style={{ ...microLabel, marginBottom: '.4rem' }}>Hours</p>
          <h2 style={{ ...heading, marginBottom: '.9rem' }}>Time on the clock</h2>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.1rem' }}>
            {rangePills}
            {filterPills}
            <button
              onClick={() => void load()}
              style={{ marginLeft: isMobile ? undefined : 'auto', background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: isMobile ? '.55rem .875rem' : '.35rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              ↺ Refresh
            </button>
          </div>

          {loading ? (
            <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
          ) : outage ? null : totals.length === 0 ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>No time logged in this range.</p>
            </div>
          ) : (
            <div style={{ border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden' }}>
              {/* header */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr auto' : '1fr auto auto auto', gap: '.75rem', padding: '.65rem 1rem', borderBottom: '1px solid var(--surface-2)', background: 'var(--surface)' }}>
                <span style={{ color: 'var(--text-4)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase' }}>Person</span>
                {!isMobile && <span style={{ color: 'var(--text-4)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', textAlign: 'right' }}>Entries</span>}
                {!isMobile && <span style={{ color: 'var(--text-4)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', textAlign: 'right' }}>Hours</span>}
                <span style={{ color: 'var(--text-4)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', textAlign: 'right' }}>Total</span>
              </div>

              {totals.map(t => (
                <div key={t.profile_id} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr auto' : '1fr auto auto auto', gap: '.75rem', padding: '.75rem 1rem', borderBottom: '1px solid var(--surface)', alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--text)', fontSize: '.84rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name ?? 'Someone'}</span>
                      <Badge role={t.role} />
                      {t.open_count > 0 && (
                        <span style={{ color: GREEN, fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase' }}>· on now</span>
                      )}
                    </div>
                    {isMobile && (
                      <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.2rem' }}>
                        {t.entry_count} {t.entry_count === 1 ? 'entry' : 'entries'} · {minutesToHours(t.total_minutes).toFixed(2)} h
                      </p>
                    )}
                  </div>
                  {!isMobile && <span style={{ color: 'var(--text-3)', fontSize: '.82rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.entry_count}</span>}
                  {!isMobile && <span style={{ color: 'var(--text-3)', fontSize: '.82rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{minutesToHours(t.total_minutes).toFixed(2)}</span>}
                  <span style={{ color: 'var(--text)', fontSize: '.82rem', fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatMinutes(t.total_minutes)}</span>
                </div>
              ))}

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.7rem 1rem', background: 'var(--surface)' }}>
                <span style={{ color: 'var(--text-4)', fontSize: '.7rem' }}>{people} {people === 1 ? 'person' : 'people'}</span>
                <span style={{ color: 'var(--text-2)', fontSize: '.72rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {formatMinutes(totalMinutes)} · {minutesToHours(totalMinutes).toFixed(2)} h
                </span>
              </div>
            </div>
          )}

          <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.55, marginTop: '.9rem', maxWidth: 560 }}>
            Totals count closed entries only — an open shift shows on the clock above but adds nothing to the hours until it is clocked out. These are the figures commission reads.
          </p>
        </section>
      </div>
    </div>
  )
}
