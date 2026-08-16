import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchCalendarEvents, KIND_META, KIND_ORDER,
} from '../../lib/calendar'
import type { CalendarEvent, CalendarEventKind } from '../../lib/calendar'
import {
  addDaysToDateKey, browserTimeZone, dateKeyInTimeZone, dayOfWeekOfDateKey,
  formatTimeInTimeZone, timeZoneAbbreviation, utcToZonedParts, zonedDateTimeToUtc,
} from '../../lib/tz'
import { useMediaQuery, MOBILE_QUERY } from '../../lib/dashboard'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { COACHES } from '../../data/coaches'

type View = 'month' | 'week' | 'day'

const ACCENT = '#272C84'
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MS_HOUR = 3_600_000

const pad = (n: number) => String(n).padStart(2, '0')
const coachFirst = (slug: string) => COACHES.find(c => c.slug === slug)?.firstName ?? slug.split('-')[0]

// ── Zone-free date-key helpers (a date has a weekday and a neighbour on its own) ──
function firstOfMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${y}-${pad(m)}-01`
}
function lastOfMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${pad(m)}-${pad(lastDay)}`
}
function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`
}
function startOfWeekKey(key: string): string {
  return addDaysToDateKey(key, -dayOfWeekOfDateKey(key))
}
/** A Date at noon UTC for a key — safe to format month/weekday/day, never drifts. */
function keyNoon(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}
function fmtKey(key: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(keyNoon(key))
}

/** Local-midnight instants (ms) bounding a day in the display zone. */
function dayBoundsMs(key: string, tz: string): { start: number; end: number } {
  const s = zonedDateTimeToUtc(key, '00:00', tz, { nonexistent: 'forward' })
  const e = zonedDateTimeToUtc(addDaysToDateKey(key, 1), '00:00', tz, { nonexistent: 'forward' })
  return { start: (s ?? keyNoon(key)).getTime(), end: (e ?? keyNoon(key)).getTime() }
}

function hourFloat(ms: number, tz: string): number {
  const p = utcToZonedParts(ms, tz)
  return p.hour + p.minute / 60
}

interface Positioned { ev: CalendarEvent; start: number; end: number; lane: number; cols: number }

/** Greedy column packing so overlapping foreground events sit side by side. */
function packLanes(items: { ev: CalendarEvent; start: number; end: number }[]): Positioned[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Positioned[] = []
  let cluster: Positioned[] = []
  let clusterEnd = -Infinity
  let laneEnds: number[] = []
  const flush = () => {
    const cols = laneEnds.length
    for (const r of cluster) r.cols = cols
    cluster = []
    laneEnds = []
    clusterEnd = -Infinity
  }
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) flush()
    let lane = laneEnds.findIndex(end => end <= it.start)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.end) } else { laneEnds[lane] = it.end }
    const r: Positioned = { ev: it.ev, start: it.start, end: it.end, lane, cols: 1 }
    cluster.push(r)
    out.push(r)
    clusterEnd = Math.max(clusterEnd, it.end)
  }
  if (cluster.length) flush()
  return out
}

interface Props {
  isDemo?: boolean
  /** When mounted in a single coach's portal, pin the calendar to their slug. */
  coachSlug?: string | null
  /** Hide the all/one-coach picker (per-coach mount). */
  lockCoach?: boolean
}

export default function CalendarPanel({ isDemo = false, coachSlug = null, lockCoach = false }: Props) {
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const tz = useMemo(() => browserTimeZone(), [])
  const locked = lockCoach && !!coachSlug

  const [view, setView] = useState<View>(isMobile ? 'day' : 'month')
  const [anchor, setAnchor] = useState(() => dateKeyInTimeZone(new Date(), browserTimeZone()))
  const [coachFilter, setCoachFilter] = useState<string>(locked ? coachSlug! : 'all')
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<CalendarEvent | null>(null)

  const today = dateKeyInTimeZone(new Date(), tz)

  // ── Visible date-key range for the current view ──
  const { rangeFrom, rangeTo, weeks, weekDays } = useMemo(() => {
    if (view === 'month') {
      const gridStart = startOfWeekKey(firstOfMonthKey(anchor))
      const last = lastOfMonthKey(anchor)
      const gridEnd = addDaysToDateKey(last, 6 - dayOfWeekOfDateKey(last))
      const keys: string[] = []
      for (let k = gridStart; k <= gridEnd; k = addDaysToDateKey(k, 1)) keys.push(k)
      const w: string[][] = []
      for (let i = 0; i < keys.length; i += 7) w.push(keys.slice(i, i + 7))
      return { rangeFrom: gridStart, rangeTo: gridEnd, weeks: w, weekDays: [] as string[] }
    }
    if (view === 'week') {
      const start = startOfWeekKey(anchor)
      const days: string[] = []
      for (let i = 0; i < 7; i++) days.push(addDaysToDateKey(start, i))
      return { rangeFrom: start, rangeTo: addDaysToDateKey(start, 6), weeks: [] as string[][], weekDays: days }
    }
    return { rangeFrom: anchor, rangeTo: anchor, weeks: [] as string[][], weekDays: [anchor] }
  }, [view, anchor])

  const queryCoach = locked ? coachSlug! : (coachFilter === 'all' ? null : coachFilter)

  const load = useCallback(async () => {
    setLoading(true)
    // `tz` is the zone this panel renders in, and the deadlines layer needs it to
    // anchor a date-only due date to exactly the day cell that bears its name.
    const rows = await fetchCalendarEvents(rangeFrom, rangeTo, queryCoach, isDemo, tz)
    setEvents(rows)
    setLoading(false)
  }, [rangeFrom, rangeTo, queryCoach, isDemo, tz])

  useEffect(() => { void load() }, [load])

  // Escape closes the detail dialog; lock scroll while it is open.
  useEffect(() => {
    if (!selected) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [selected])

  const showCoach = !locked && coachFilter === 'all'
  const hasClock = events.some(e => e.kind === 'clock')
  // Same gating as 'clock': a coach with no cycle in view gets no orphan swatch.
  const hasDeadline = events.some(e => e.kind === 'deadline')

  // ── Navigation ──
  const step = (dir: -1 | 1) => {
    if (view === 'month') setAnchor(a => shiftMonthKey(a, dir))
    else if (view === 'week') setAnchor(a => addDaysToDateKey(a, dir * 7))
    else setAnchor(a => addDaysToDateKey(a, dir))
  }
  const goToday = () => setAnchor(today)
  const openDay = (key: string) => { setAnchor(key); setView('day') }

  const periodLabel = useMemo(() => {
    if (view === 'month') return fmtKey(anchor, { month: 'long', year: 'numeric' })
    if (view === 'week') {
      const start = startOfWeekKey(anchor)
      const end = addDaysToDateKey(start, 6)
      const sameMonth = start.slice(0, 7) === end.slice(0, 7)
      const left = fmtKey(start, { month: 'short', day: 'numeric' })
      const right = fmtKey(end, sameMonth ? { day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
      return `${left} – ${right}`
    }
    return fmtKey(anchor, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }, [view, anchor])

  // Events overlapping a given day, in the display zone.
  const eventsOnDay = useCallback((key: string): CalendarEvent[] => {
    const { start, end } = dayBoundsMs(key, tz)
    return events.filter(ev => {
      const s = new Date(ev.startsAt).getTime()
      const e = new Date(ev.endsAt).getTime()
      return e > start && s < end
    })
  }, [events, tz])

  const openIfBooking = (ev: CalendarEvent) => { if (ev.kind === 'booking') setSelected(ev) }

  // ── Shared time-grid bounds (week + day) ──
  const gridHours = useMemo(() => {
    let minH = 24, maxH = 0
    for (const ev of events) {
      if (ev.allDay) continue
      minH = Math.min(minH, Math.floor(hourFloat(new Date(ev.startsAt).getTime(), tz)))
      const eh = hourFloat(new Date(ev.endsAt).getTime(), tz)
      maxH = Math.max(maxH, Math.ceil(eh === 0 ? 24 : eh))
    }
    const startHour = Math.max(0, Math.min(8, minH === 24 ? 8 : minH))
    const endHour = Math.min(24, Math.max(18, maxH === 0 ? 18 : maxH))
    return { startHour, endHour: Math.max(endHour, startHour + 1) }
  }, [events, tz])

  const HOUR_PX = isMobile ? 40 : 46

  // ── Renderers ──────────────────────────────────────────────────────────────

  const chip = (ev: CalendarEvent, compact: boolean) => {
    const meta = KIND_META[ev.kind]
    const label = ev.kind === 'booking'
      ? (showCoach ? `${coachFirst(ev.coachSlug)} · ${ev.title}` : ev.title)
      : ev.kind === 'available'
        ? (showCoach ? coachFirst(ev.coachSlug) : 'Available')
        : ev.kind === 'deadline'
          ? (showCoach ? `${coachFirst(ev.coachSlug)} · ${ev.title}` : ev.title)
          : ev.title
    // A deadline has no time of day, so 'All day' tells the reader nothing. Its
    // tooltip carries the writing window instead, which is the fact a coach
    // actually wants when they see the chip.
    // `reason` already opens with the title, so prefixing `label` would say
    // "Blog post due" twice. The banner in the week view reads it the same way.
    const tip = ev.kind === 'deadline'
      ? (showCoach ? `${coachFirst(ev.coachSlug)} · ${ev.reason ?? ev.title}` : (ev.reason ?? ev.title))
      : `${label} · ${fmtRange(ev)}`
    return (
      <button
        key={ev.eventId}
        onClick={() => openIfBooking(ev)}
        title={tip}
        style={{
          display: 'flex', alignItems: 'center', gap: '.3rem', width: '100%',
          background: meta.color + '1f', border: `1px solid ${meta.color}66`,
          borderLeft: `3px solid ${meta.color}`, color: 'var(--text)',
          fontSize: compact ? '.6rem' : '.68rem', fontWeight: 600,
          padding: compact ? '.15rem .3rem' : '.25rem .4rem', borderRadius: '.2rem',
          cursor: ev.kind === 'booking' ? 'pointer' : 'default', fontFamily: 'inherit',
          textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {!ev.allDay && <span style={{ color: meta.color, fontWeight: 800 }}>{shortTime(ev)} </span>}
          {label}
        </span>
      </button>
    )
  }

  function shortTime(ev: CalendarEvent): string {
    return formatTimeInTimeZone(new Date(ev.startsAt), tz).replace(':00', '').replace(' ', '')
  }
  function fmtRange(ev: CalendarEvent): string {
    if (ev.allDay) return 'All day'
    return `${formatTimeInTimeZone(new Date(ev.startsAt), tz)} – ${formatTimeInTimeZone(new Date(ev.endsAt), tz)}`
  }

  // Month grid ----------------------------------------------------------------
  const monthGrid = (
    <div style={{ border: '1px solid var(--surface-2)', borderRadius: '.4rem', overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: 'var(--surface)' }}>
        {DOW_LABELS.map(d => (
          <div key={d} style={{ padding: '.5rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase' }}>
            {isMobile ? d[0] : d}
          </div>
        ))}
      </div>
      {weeks.map((wk, wi) => (
        <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {wk.map(key => {
            const inMonth = key.slice(0, 7) === anchor.slice(0, 7)
            const isToday = key === today
            const dayEvents = eventsOnDay(key)
            const hasAvail = dayEvents.some(e => e.kind === 'available')
            // Deadlines are drawn outside the chip budget, not sorted to the top
            // of it. That does two jobs at once: a deadline can never be hidden
            // behind '+N more' (solid is capped at 2 chips on mobile, 3 on
            // desktop, and the merge appends deadlines last), and it can never
            // displace a real booking chip. `solid.length > shown.length` stays
            // correct because deadlines were never in `solid`.
            const deadlines = dayEvents.filter(e => e.kind === 'deadline')
            const solid = dayEvents.filter(e => e.kind !== 'available' && e.kind !== 'deadline')
            const shown = solid.slice(0, isMobile ? 2 : 3)
            const dayNum = Number(key.split('-')[2])
            return (
              <div key={key} style={{
                minHeight: isMobile ? 74 : 104, borderTop: '1px solid var(--surface)', borderLeft: '1px solid var(--surface)',
                padding: '.25rem', display: 'flex', flexDirection: 'column', gap: '.15rem',
                background: inMonth ? 'var(--bg)' : 'var(--surface)', opacity: inMonth ? 1 : 0.55,
              }}>
                <button
                  onClick={() => openDay(key)}
                  style={{
                    alignSelf: 'flex-start', background: isToday ? ACCENT : 'transparent',
                    color: isToday ? '#fff' : 'var(--text-2)', border: 'none', cursor: 'pointer',
                    fontSize: '.66rem', fontWeight: isToday ? 900 : 600, fontFamily: 'inherit',
                    minWidth: 20, height: 20, borderRadius: '50%', padding: 0,
                  }}
                >
                  {dayNum}
                </button>
                {hasAvail && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '.25rem', color: KIND_META.available.color, fontSize: '.55rem', fontWeight: 700 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: KIND_META.available.color, flexShrink: 0 }} />
                    {!isMobile && 'Available'}
                  </span>
                )}
                {deadlines.map(ev => chip(ev, true))}
                {shown.map(ev => chip(ev, true))}
                {solid.length > shown.length && (
                  <button onClick={() => openDay(key)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: '.58rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: '0 .3rem' }}>
                    +{solid.length - shown.length} more
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )

  // Time grid (week + day) ----------------------------------------------------
  const { startHour, endHour } = gridHours
  const gridHeight = (endHour - startHour) * HOUR_PX
  const hourRows: number[] = []
  for (let h = startHour; h <= endHour; h++) hourRows.push(h)

  // Every column's all-day banner is the SAME height, sized to the busiest day
  // on screen. The columns are flex siblings, so a banner that grows to fit its
  // own contents pushes only its own time grid down and 9am stops being one
  // straight line across the week. Deadlines made this reachable: blocks used to
  // be the only all-day kind, and two of them on one day was rare.
  const ALL_DAY_ROW_PX = 15
  const bannerRows = Math.max(1, ...weekDays.map(k => eventsOnDay(k).filter(e => e.allDay).length))
  const bannerHeight = 12 + bannerRows * ALL_DAY_ROW_PX

  const dayColumn = (key: string) => {
    const { start: dayStart } = dayBoundsMs(key, tz)
    const gridTopMs = dayStart + startHour * MS_HOUR
    const dayEvents = eventsOnDay(key)
    const allDayBlocks = dayEvents.filter(e => e.allDay)
    const avail = dayEvents.filter(e => e.kind === 'available' && !e.allDay)
    const fore = dayEvents.filter(e => e.kind !== 'available' && !e.allDay)

    const positioned = packLanes(fore.map(ev => ({
      ev,
      start: new Date(ev.startsAt).getTime(),
      end: new Date(ev.endsAt).getTime(),
    })))

    const blockStyle = (s: number, e: number) => {
      const top = Math.max(0, (s - gridTopMs) / MS_HOUR * HOUR_PX)
      const rawBottom = (e - gridTopMs) / MS_HOUR * HOUR_PX
      const bottom = Math.min(gridHeight, rawBottom)
      return { top, height: Math.max(14, bottom - top) }
    }

    return (
      <div key={key} style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--surface)' }}>
        {/* All-day banner */}
        <div style={{ borderBottom: '1px solid var(--surface)', padding: '.2rem', height: bannerHeight, boxSizing: 'border-box', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '.15rem' }}>
          {allDayBlocks.map(ev => {
            // Coloured by KIND, not by the block red this banner used to hardcode.
            // Behaviour-preserving while blocks are the only all-day kind, and
            // required now that they are not: a blog deadline painted red reads
            // as time off.
            const meta = KIND_META[ev.kind]
            return (
              <div key={ev.eventId} title={ev.reason ?? ev.title}
                style={{ background: meta.color + '26', border: `1px solid ${meta.color}66`, borderRadius: '.2rem', padding: '.1rem .3rem', color: 'var(--text)', fontSize: '.58rem', fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {showCoach ? `${coachFirst(ev.coachSlug)} · ` : ''}{ev.title}
              </div>
            )
          })}
        </div>

        {/* Time grid */}
        <div style={{ position: 'relative', height: gridHeight }}>
          {hourRows.slice(0, -1).map((h, i) => (
            <div key={h} style={{ position: 'absolute', top: i * HOUR_PX, left: 0, right: 0, height: HOUR_PX, borderTop: '1px solid var(--surface)' }} />
          ))}

          {/* Availability background bands */}
          {avail.map(ev => {
            const { top, height } = blockStyle(new Date(ev.startsAt).getTime(), new Date(ev.endsAt).getTime())
            return (
              <div key={ev.eventId} title={`Available · ${fmtRange(ev)}`}
                style={{ position: 'absolute', top, height, left: 2, right: 2, background: KIND_META.available.color + '1a', borderLeft: `3px solid ${KIND_META.available.color}`, borderRadius: '.2rem', zIndex: 0 }}>
                {showCoach && (
                  <span style={{ position: 'absolute', bottom: 2, right: 4, color: KIND_META.available.color, fontSize: '.5rem', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>{coachFirst(ev.coachSlug)}</span>
                )}
              </div>
            )
          })}

          {/* Foreground events */}
          {positioned.map(p => {
            const meta = KIND_META[p.ev.kind]
            const { top, height } = blockStyle(p.start, p.end)
            const w = 100 / p.cols
            return (
              <button
                key={p.ev.eventId}
                onClick={() => openIfBooking(p.ev)}
                title={`${p.ev.title} · ${fmtRange(p.ev)}`}
                style={{
                  position: 'absolute', top, height,
                  left: `calc(${p.lane * w}% + 3px)`, width: `calc(${w}% - 5px)`,
                  background: meta.color + (p.ev.kind === 'busy' ? '2b' : '33'),
                  border: `1px solid ${meta.color}`, borderLeft: `3px solid ${meta.color}`,
                  borderRadius: '.2rem', padding: '.15rem .3rem', overflow: 'hidden',
                  color: 'var(--text)', fontFamily: 'inherit', textAlign: 'left', zIndex: 1,
                  cursor: p.ev.kind === 'booking' ? 'pointer' : 'default',
                }}
              >
                <span style={{ display: 'block', fontSize: '.6rem', fontWeight: 800, color: meta.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {shortTime(p.ev)}
                </span>
                <span style={{ display: 'block', fontSize: '.62rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {showCoach && p.ev.kind === 'booking' ? `${coachFirst(p.ev.coachSlug)} · ` : ''}{p.ev.title}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const timeGrid = (
    <div style={{ border: '1px solid var(--surface-2)', borderRadius: '.4rem', overflow: 'hidden' }}>
      {/* Column headers */}
      <div style={{ display: 'flex', background: 'var(--surface)' }}>
        <div style={{ width: 48, flexShrink: 0 }} />
        {weekDays.map(key => {
          const isToday = key === today
          return (
            <button key={key} onClick={() => openDay(key)} style={{ flex: 1, minWidth: 0, padding: '.4rem .2rem', background: 'none', border: 'none', borderLeft: '1px solid var(--surface)', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ color: 'var(--text-3)', fontSize: '.52rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase' }}>{fmtKey(key, { weekday: 'short' })}</div>
              <div style={{ margin: '.15rem auto 0', width: 22, height: 22, borderRadius: '50%', background: isToday ? ACCENT : 'transparent', color: isToday ? '#fff' : 'var(--text)', fontSize: '.72rem', fontWeight: isToday ? 900 : 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {Number(key.split('-')[2])}
              </div>
            </button>
          )
        })}
      </div>

      {/* Body: hour gutter + columns */}
      <div style={{ display: 'flex', maxHeight: isMobile ? undefined : '70vh', overflowY: 'auto' }}>
        <div style={{ width: 48, flexShrink: 0 }}>
          <div style={{ minHeight: 26, borderBottom: '1px solid var(--surface)' }} />
          <div style={{ position: 'relative', height: gridHeight }}>
            {hourRows.slice(0, -1).map((h, i) => (
              <div key={h} style={{ position: 'absolute', top: i * HOUR_PX - 6, right: 6, color: 'var(--text-4)', fontSize: '.55rem', fontWeight: 700 }}>
                {fmtHour(h)}
              </div>
            ))}
          </div>
        </div>
        {weekDays.map(dayColumn)}
      </div>
    </div>
  )

  function fmtHour(h: number): string {
    const hr = h % 24
    const ampm = hr < 12 ? 'AM' : 'PM'
    const twelve = hr % 12 === 0 ? 12 : hr % 12
    return `${twelve}${ampm}`
  }

  const tzAbbr = timeZoneAbbreviation(new Date(), tz)

  // ── Toolbar + legend ──
  const btn = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--surface-2)' : 'transparent',
    border: `1px solid ${active ? 'var(--border-mid)' : 'var(--border)'}`,
    color: active ? 'var(--text)' : 'var(--text-4)',
    fontSize: '.62rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
    padding: isMobile ? '.5rem .7rem' : '.35rem .8rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
  })

  return (
    <div className="dash-pad">
      {isDemo && <DemoBanner note="A sample week of bookings, availability and time off — click any booking for its details." />}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.9rem' }}>
        <div style={{ display: 'flex', gap: '.3rem' }}>
          {(['month', 'week', 'day'] as View[]).map(v => (
            <button key={v} onClick={() => setView(v)} style={btn(view === v)}>{v}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
          <button onClick={() => step(-1)} aria-label="Previous" style={{ ...btn(false), minWidth: 34 }}>‹</button>
          <button onClick={goToday} style={btn(anchor === today)}>Today</button>
          <button onClick={() => step(1)} aria-label="Next" style={{ ...btn(false), minWidth: 34 }}>›</button>
        </div>

        <span style={{ color: 'var(--text)', fontSize: '.9rem', fontWeight: 900, letterSpacing: '-.01em' }}>{periodLabel}</span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-4)', fontSize: '.58rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>{tzAbbr}</span>
          {!locked && (
            <select className="field" value={coachFilter} onChange={e => setCoachFilter(e.target.value)} style={{ maxWidth: 190, minWidth: 130 }}>
              <option value="all">All coaches</option>
              {COACHES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          )}
          <button onClick={() => void load()} style={{ ...btn(false), color: 'var(--text-2)' }}>↺ Refresh</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '.9rem' }}>
        {KIND_ORDER.filter(k => (k !== 'clock' || hasClock) && (k !== 'deadline' || hasDeadline)).map(k => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>
            <span style={{ width: 10, height: 10, borderRadius: '.15rem', background: KIND_META[k as CalendarEventKind].color, flexShrink: 0 }} />
            {KIND_META[k as CalendarEventKind].label}
          </span>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading calendar…</div>
      ) : view === 'month' ? monthGrid : timeGrid}

      {/* Booking detail dialog */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : '1rem' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg)', border: '1px solid var(--surface-2)', borderRadius: isMobile ? '.6rem .6rem 0 0' : '.5rem', width: isMobile ? '100%' : 'min(440px, 92vw)', maxHeight: '90vh', overflowY: 'auto', padding: '1.5rem' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <span style={{ display: 'inline-block', background: KIND_META.booking.color + '22', border: `1px solid ${KIND_META.booking.color}`, color: KIND_META.booking.color, fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.2rem .55rem', borderRadius: '.2rem', marginBottom: '.5rem' }}>
                  {selected.status ?? 'Booking'}
                </span>
                <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.05rem' }}>{selected.clientName ?? selected.title}</p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.1rem', padding: '.25rem .5rem', fontFamily: 'inherit' }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '.7rem', background: 'var(--surface)', borderRadius: '.3rem', padding: '1rem' }}>
              {([
                ['When', `${fmtKey(dateKeyInTimeZone(new Date(selected.startsAt), tz), { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtRange(selected)} ${tzAbbr}`],
                ['Coach', coachFirst(selected.coachSlug)],
                ['Service', selected.service ?? '—'],
                ['Email', selected.clientEmail ?? '—'],
                ['Phone', selected.clientPhone ?? '—'],
              ] as [string, string][]).map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '.8rem' }}>
                  <span style={{ color: 'var(--text-3)' }}>{l}</span>
                  <span style={{ color: 'var(--text)', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{v}</span>
                </div>
              ))}
            </div>

            <p style={{ color: 'var(--text-4)', fontSize: '.68rem', lineHeight: 1.6, marginTop: '1rem' }}>
              Read-only view. Confirm, reschedule or cancel this booking from the Bookings tab.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
