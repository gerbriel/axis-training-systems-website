import { supabase, supabaseConfigured } from './supabase.ts'
import { addDaysToDateKey, browserTimeZone, dateKeyInTimeZone, zonedDateTimeToUtc } from './tz.ts'
import { COACHES } from '../data/coaches.ts'
import type { CalendarEvent } from './calendar.ts'

/**
 * Blog rotation deadlines, as calendar events.
 *
 * This is the one layer of the calendar that is NOT in the `calendar_events`
 * RPC. It comes from `public.content_deadlines` (migration 047) as DATES, and
 * the conversion to instants happens HERE, in the viewer's display zone. 047's
 * header carries the full argument; the short version is that a due date is a
 * date, a date has no hour, and converting it server-side through the coach's
 * zone and then bucketing it client-side through the viewer's zone lands one
 * deadline on two different day cells.
 *
 * Every import below carries its `.ts` extension on purpose. It is what lets
 * `node --test` load this module directly (see tests/deadlines.test.ts) — the
 * same reason rotationApi.ts states in its own header. `CalendarEvent` is
 * imported as a TYPE only, and that is load bearing rather than tidy: calendar.ts
 * is not loadable under node (its first line imports './supabase' with no
 * extension), and a type-only import is erased entirely before the module is
 * resolved. The value direction is calendar.ts -> deadlines.ts and never the
 * reverse.
 *
 * Nothing here throws. A failure is an empty stream, matching the contract
 * fetchCalendarEvents already states.
 */

/** The shape `public.content_deadlines` returns (snake_case, dates as keys). */
export interface ContentDeadlineRow {
  cycle_id: string
  coach_slug: string
  /** 'YYYY-MM-DD' — window opens. */
  cycle_start: string
  /** 'YYYY-MM-DD' — window closes, the post is owed. */
  due_date: string
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const isDateKey = (s: unknown): s is string => typeof s === 'string' && DATE_KEY_RE.test(s)

const MS_PER_DAY = 86_400_000

/** 'Jun 5' from a date key. Formatted at noon UTC, which never drifts a day. */
function fmtDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d, 12)))
}

/** Whole days from `a` to `b`. Pure UTC integer math, never perturbed by DST. */
function daysBetweenKeys(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY)
}

/**
 * Rotation rows -> calendar events, anchored to the DISPLAY zone.
 *
 * The two `zonedDateTimeToUtc` calls below are byte-identical to the panel's own
 * `dayBoundsMs` (src/pages/admin/CalendarPanel.tsx:50-55): local midnight on the
 * due date, and local midnight on the day after. That is the whole reason this
 * conversion is not in SQL. The panel decides which cell an event belongs to
 * with an OVERLAP test, `e > start && s < end` (CalendarPanel.tsx:181-188), so an
 * event whose bounds EQUAL a cell's bounds matches that cell and no other, by
 * construction rather than by luck. Any other anchoring smears the deadline
 * across two days for every viewer whose zone differs from the one it was built
 * in.
 */
export function buildDeadlineEvents(
  rows: ContentDeadlineRow[],
  fromKey: string,
  toKey: string,
  tz: string,
): CalendarEvent[] {
  const out: CalendarEvent[] = []
  if (!Array.isArray(rows)) return out

  for (const r of rows) {
    if (!r || !isDateKey(r.due_date) || !isDateKey(r.cycle_start)) continue
    if (typeof r.cycle_id !== 'string' || typeof r.coach_slug !== 'string') continue
    // Date keys are lexicographically ordered, so string comparison is date
    // comparison. The server applies the same window; this is the single filter
    // the demo path gets, and a second opinion on the live one.
    if (r.due_date < fromKey || r.due_date > toKey) continue

    const s = zonedDateTimeToUtc(r.due_date, '00:00', tz, { nonexistent: 'forward' })
    const e = zonedDateTimeToUtc(addDaysToDateKey(r.due_date, 1), '00:00', tz, { nonexistent: 'forward' })
    // Never fabricate an instant. calendar.ts's demo seed falls back to
    // `new Date()` for a round hour that cannot fail, which is fine for a seed
    // and would be a lie about a real deadline: it would draw the due date on
    // today. A deadline we cannot place is a deadline we do not draw.
    if (!s || !e) continue

    out.push({
      // cycle_id is a uuid primary key and one row yields exactly one event, so
      // this is unique without the date suffix the 'available' layer needs.
      eventId: `deadline:${r.cycle_id}`,
      kind: 'deadline',
      coachSlug: r.coach_slug,
      title: 'Blog post due',
      startsAt: s.toISOString(),
      endsAt: e.toISOString(),
      // Not stylistic. gridHours (CalendarPanel.tsx:193-204) skips all-day
      // events when it computes the time grid's vertical extent; a
      // midnight-to-midnight event with allDay false would force every column in
      // week view to a full 24 hours tall.
      allDay: true,
      // status renders only in the detail dialog, which opens only for bookings.
      status: null,
      clientName: null,
      clientEmail: null,
      clientPhone: null,
      service: null,
      // The cycle window, as prose. The all-day banner already renders `reason`
      // as its tooltip (CalendarPanel.tsx:337), so the window costs no markup.
      reason: `Blog post due. Writing window opened ${fmtDateKey(r.cycle_start)}.`,
      source: 'rotation',
      bookingId: null,
    })
  }

  return out
}

/**
 * Deadlines overlapping a date range, as calendar events.
 *
 * Mirrors fetchCalendarEvents' contract exactly: it never throws, and returns []
 * on an error, on null data, or on anything thrown underneath. The honest
 * consequence is that a broken 047 presents in the UI as "this coach has no
 * deadlines" and says nothing else, which is why 047's Verify block is the only
 * real proof that this works.
 */
export async function fetchContentDeadlines(
  fromKey: string,
  toKey: string,
  coachSlug: string | null,
  isDemo = false,
  timeZone?: string,
): Promise<CalendarEvent[]> {
  const tz = timeZone ?? browserTimeZone()
  if (!isDateKey(fromKey) || !isDateKey(toKey)) return []

  if (isDemo || !supabaseConfigured) {
    return buildDeadlineEvents(demoContentDeadlines(fromKey, toKey, coachSlug, tz), fromKey, toKey, tz)
  }

  try {
    const { data, error } = await supabase.rpc('content_deadlines', {
      p_from: fromKey,
      p_to: toKey,
      p_coach: coachSlug,
    })
    if (error || !data) return []
    return buildDeadlineEvents(data as ContentDeadlineRow[], fromKey, toKey, tz)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Demo seed
// ---------------------------------------------------------------------------

/** Coaches the demo shows deadlines for when no single coach is selected. */
const DEMO_ROSTER = COACHES.slice(0, 3).map(c => c.slug) // ronnie, seth, lucas

/** 005's cadence: a post every two months, the roster staggered two weeks apart. */
const CYCLE_DAYS = 61
const STAGGER_DAYS = 14
/** A ceiling on the seed, mirroring the RPC's `limit 2000`. */
const MAX_DEMO_ROWS = 400

/**
 * A rotation that always straddles today.
 *
 * Anchored to TODAY rather than to 005's `date '2026-08-01'` literal, so the
 * demo portal does not quietly go blank once that seed's year runs out. The
 * requested window drives how many cycles are generated, so a month view and a
 * year view are both populated, and the range filter still lives in exactly one
 * place: buildDeadlineEvents.
 *
 * No waived rows are produced. Waiving is filtered server-side in live mode, so
 * a waived row here would be demonstrating something the real calendar never
 * shows.
 */
export function demoContentDeadlines(
  fromKey: string,
  toKey: string,
  coachSlug: string | null,
  tz: string,
): ContentDeadlineRow[] {
  const rows: ContentDeadlineRow[] = []
  if (!isDateKey(fromKey) || !isDateKey(toKey) || toKey < fromKey) return rows

  const roster: string[] = coachSlug ? [coachSlug] : DEMO_ROSTER
  const today = dateKeyInTimeZone(new Date(), tz)
  const dFrom = daysBetweenKeys(today, fromKey)
  const dTo = daysBetweenKeys(today, toKey)

  roster.forEach(slug => {
    // The coach's own phase in the rotation: five days out, staggered by seat.
    // Seat comes from the FULL roster, never from this loop's index: scoping to
    // one coach would otherwise make them seat 0 and slide their demo deadlines
    // by a stagger or two, so the coach portal and the admin portal would
    // disagree about the same dates.
    const seat = (DEMO_ROSTER as readonly string[]).indexOf(slug)
    const phase = 5 + STAGGER_DAYS * (seat >= 0 ? seat : 0)
    // Enough cycles to cover the asked-for window with one cycle of margin on
    // each side, so a window of any width is populated rather than blank.
    const nLo = Math.floor((dFrom - phase) / CYCLE_DAYS) - 1
    const nHi = Math.ceil((dTo - phase) / CYCLE_DAYS) + 1
    for (let n = nLo; n <= nHi; n++) {
      if (rows.length >= MAX_DEMO_ROWS) return
      const due = addDaysToDateKey(today, phase + CYCLE_DAYS * n)
      rows.push({
        cycle_id: `demo-cycle-${slug}-${n}`,
        coach_slug: slug,
        cycle_start: addDaysToDateKey(due, -CYCLE_DAYS),
        due_date: due,
      })
    }
  })

  return rows
}
