import { supabase, supabaseConfigured } from './supabase'
import {
  addDaysToDateKey,
  browserTimeZone,
  dateKeyInTimeZone,
  dayOfWeekOfDateKey,
  zonedDateTimeToUtc,
} from './tz'
import { COACHES } from '../data/coaches'

/**
 * The calendar read layer.
 *
 * Every merged event is an ABSOLUTE INSTANT (starts_at / ends_at as ISO
 * strings). The panel renders them in a single display zone with a label — a
 * bare time is the whole class of bug tz.ts exists to prevent. Nothing here
 * throws: a failure is an empty stream the caller can render, never an
 * unhandled rejection that leaves a spinner up for ever.
 *
 * In demo mode (isDemo, or no Supabase configured) the same shape is produced
 * from an in-memory seed — no network, no crash.
 */

export type CalendarEventKind = 'booking' | 'block' | 'busy' | 'available' | 'clock'

export interface CalendarEvent {
  eventId: string
  kind: CalendarEventKind
  coachSlug: string
  title: string
  /** ISO absolute instant. */
  startsAt: string
  /** ISO absolute instant. */
  endsAt: string
  allDay: boolean
  status: string | null
  clientName: string | null
  clientEmail: string | null
  clientPhone: string | null
  service: string | null
  reason: string | null
  source: string | null
  bookingId: string | null
}

/** Colour + label per kind. The single source both the grid and the legend read. */
export const KIND_META: Record<CalendarEventKind, { label: string; color: string }> = {
  booking:   { label: 'Booking',     color: '#272C84' }, // brand accent
  available: { label: 'Available',   color: '#22c55e' }, // green — open hours
  block:     { label: 'Blocked',     color: '#c8102e' }, // red — time off
  busy:      { label: 'Busy',        color: '#eab308' }, // amber — external (Google)
  clock:     { label: 'Clocked in',  color: '#0ea5e9' }, // blue — time-clock overlay
}

export const KIND_ORDER: CalendarEventKind[] = ['booking', 'available', 'block', 'busy', 'clock']

/** The shape the RPC returns (snake_case). */
interface CalendarEventRow {
  event_id: string
  kind: string
  coach_slug: string
  title: string
  starts_at: string
  ends_at: string
  all_day: boolean
  status: string | null
  client_name: string | null
  client_email: string | null
  client_phone: string | null
  service: string | null
  reason: string | null
  source: string | null
  booking_id: string | null
}

function mapRow(r: CalendarEventRow): CalendarEvent {
  return {
    eventId: r.event_id,
    kind: (KIND_META[r.kind as CalendarEventKind] ? r.kind : 'busy') as CalendarEventKind,
    coachSlug: r.coach_slug,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    allDay: !!r.all_day,
    status: r.status,
    clientName: r.client_name,
    clientEmail: r.client_email,
    clientPhone: r.client_phone,
    service: r.service,
    reason: r.reason,
    source: r.source,
    bookingId: r.booking_id,
  }
}

/**
 * Unified events for a date range.
 *
 * `fromDateKey` / `toDateKey` are 'YYYY-MM-DD' bounds (inclusive) in the display
 * zone. `coachSlug` null = all calendars the caller may see (admin); a slug =
 * that coach. The server pins a coach to their own slug regardless, so passing a
 * slug is a UI convenience, never the security boundary.
 */
export async function fetchCalendarEvents(
  fromDateKey: string,
  toDateKey: string,
  coachSlug: string | null,
  isDemo = false,
): Promise<CalendarEvent[]> {
  if (isDemo || !supabaseConfigured) {
    return demoCalendarEvents(fromDateKey, toDateKey, coachSlug)
  }

  try {
    const { data, error } = await supabase.rpc('calendar_events', {
      p_from: fromDateKey,
      p_to: toDateKey,
      p_coach: coachSlug,
    })
    if (error || !data) return []
    return (data as CalendarEventRow[]).map(mapRow)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Demo seed
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')

/** The instant at wall-clock HH:MM on a date key, in the demo (browser) zone. */
function instantOn(dateKey: string, hour: number, minute: number, tz: string): string {
  const d = zonedDateTimeToUtc(dateKey, `${pad(hour)}:${pad(minute)}`, tz, { nonexistent: 'forward' })
  // Fallback should never trigger for these round times, but keep it total.
  return (d ?? new Date()).toISOString()
}

/** Coaches the demo shows availability for when no single coach is selected. */
const DEMO_ROSTER = COACHES.slice(0, 3).map(c => c.slug) // ronnie, seth, lucas

const coachFirst = (slug: string): string =>
  COACHES.find(c => c.slug === slug)?.firstName ?? slug.split('-')[0]

/**
 * A representative week-in-the-life for the demo portal: recurring working
 * hours Mon–Sat for the scoped coaches, with real bookings, a day off, a timed
 * block and an external busy hold layered on top around "today" so Day, Week and
 * Month all render something worth looking at.
 */
function demoCalendarEvents(
  fromDateKey: string,
  toDateKey: string,
  coachSlug: string | null,
): CalendarEvent[] {
  const tz = browserTimeZone()
  const roster = coachSlug ? [coachSlug] : DEMO_ROSTER
  const events: CalendarEvent[] = []

  // ── Recurring working windows across the visible range ──
  for (let key = fromDateKey; key <= toDateKey; key = addDaysToDateKey(key, 1)) {
    const dow = dayOfWeekOfDateKey(key) // 0=Sun..6=Sat
    if (dow === 0) continue // closed Sundays
    const isSat = dow === 6
    const startH = 9
    const endH = isSat ? 13 : 17
    roster.forEach((slug, i) => {
      // Stagger start by coach so overlapping columns are visible in week view.
      const s = startH + i
      events.push({
        eventId: `available:${slug}:${key}`,
        kind: 'available',
        coachSlug: slug,
        title: 'Available',
        startsAt: instantOn(key, s, 0, tz),
        endsAt: instantOn(key, endH, 0, tz),
        allDay: false,
        status: null, clientName: null, clientEmail: null, clientPhone: null,
        service: null, reason: null, source: null, bookingId: null,
      })
    })
  }

  // ── Layered specifics, anchored relative to today ──
  const today = dateKeyInTimeZone(new Date(), tz)
  const inRange = (key: string) => key >= fromDateKey && key <= toDateKey
  const primary = roster[0]
  const secondary = roster[1] ?? roster[0]

  interface Seed {
    dayOffset: number
    startH: number
    startM: number
    durMin: number
    kind: CalendarEventKind
    coach: string
    title: string
    status?: string | null
    clientName?: string | null
    clientEmail?: string | null
    clientPhone?: string | null
    service?: string | null
    reason?: string | null
    allDay?: boolean
  }

  const seeds: Seed[] = [
    { dayOffset: 0, startH: 10, startM: 0, durMin: 30, kind: 'booking', coach: primary,
      title: 'Marcus Rivera', status: 'confirmed', clientName: 'Marcus Rivera',
      clientEmail: 'marcus.r@gmail.com', clientPhone: '555-0119', service: '1:1 Coaching (Full Service)' },
    { dayOffset: 0, startH: 13, startM: 30, durMin: 30, kind: 'booking', coach: secondary,
      title: 'Grace Okafor', status: 'pending', clientName: 'Grace Okafor',
      clientEmail: 'grace.okafor@outlook.com', clientPhone: '555-0161', service: 'Meet Day Coaching' },
    { dayOffset: 0, startH: 15, startM: 0, durMin: 60, kind: 'busy', coach: primary,
      title: 'Busy' },
    { dayOffset: 1, startH: 11, startM: 0, durMin: 30, kind: 'booking', coach: primary,
      title: 'Bianca Reyes', status: 'confirmed', clientName: 'Bianca Reyes',
      clientEmail: 'bianca.reyes@gmail.com', clientPhone: '555-0142', service: '1:1 Coaching (Full Service)' },
    { dayOffset: 1, startH: 12, startM: 0, durMin: 60, kind: 'block', coach: secondary,
      title: 'Lunch', reason: 'Lunch' },
    { dayOffset: 2, startH: 9, startM: 30, durMin: 30, kind: 'booking', coach: secondary,
      title: 'Devin Brooks', status: 'confirmed', clientName: 'Devin Brooks',
      clientEmail: 'devin.brooks@icloud.com', clientPhone: null, service: '1:1 Coaching (Full Service)' },
    { dayOffset: 3, startH: 0, startM: 0, durMin: 24 * 60, kind: 'block', coach: primary,
      title: 'Traveling — meet', reason: 'Traveling — national meet', allDay: true },
    { dayOffset: 4, startH: 14, startM: 0, durMin: 30, kind: 'booking', coach: primary,
      title: 'Yuki Tanaka', status: 'pending', clientName: 'Yuki Tanaka',
      clientEmail: 'yuki.tanaka@gmail.com', clientPhone: '555-0175', service: 'Movement Coaching' },
    { dayOffset: -2, startH: 12, startM: 0, durMin: 30, kind: 'booking', coach: secondary,
      title: 'Simone Adebayo', status: 'confirmed', clientName: 'Simone Adebayo',
      clientEmail: 'simone.adebayo@icloud.com', clientPhone: '555-0134', service: '1:1 Coaching (Full Service)' },
  ]

  for (const s of seeds) {
    if (coachSlug && s.coach !== coachSlug) continue
    const key = addDaysToDateKey(today, s.dayOffset)
    if (!inRange(key)) continue
    const start = s.allDay
      ? instantOn(key, 0, 0, tz)
      : instantOn(key, s.startH, s.startM, tz)
    const end = s.allDay
      ? instantOn(addDaysToDateKey(key, 1), 0, 0, tz)
      : new Date(new Date(start).getTime() + s.durMin * 60_000).toISOString()
    events.push({
      eventId: `${s.kind}:demo:${s.coach}:${key}:${s.startH}${s.startM}`,
      kind: s.kind,
      coachSlug: s.coach,
      title: s.title,
      startsAt: start,
      endsAt: end,
      allDay: !!s.allDay,
      status: s.status ?? null,
      clientName: s.clientName ?? null,
      clientEmail: s.clientEmail ?? null,
      clientPhone: s.clientPhone ?? null,
      service: s.service ?? null,
      reason: s.reason ?? null,
      source: s.kind === 'busy' ? 'external' : s.kind === 'booking' ? 'booking' : null,
      bookingId: s.kind === 'booking' ? `demo-bk-${s.coach}-${key}-${s.startH}` : null,
    })
  }

  return events
}
