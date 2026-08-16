import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDeadlineEvents,
  demoContentDeadlines,
  fetchContentDeadlines,
  type ContentDeadlineRow,
} from '../src/lib/deadlines.ts'
import { addDaysToDateKey, dateKeyInTimeZone, zonedDateTimeToUtc } from '../src/lib/tz.ts'

// The blog rotation on the calendar (migration 047 + src/lib/deadlines.ts).
//
// The heart of this feature is one claim: a due date drawn from a DATE lands on
// exactly the day cell that bears its name, in every display zone. That claim is
// only true because the event's bounds are built with the same two calls the
// panel uses to bound a day cell, so the panel's overlap test matches one cell
// and no other. Both of those are reimplemented locally below, from
// src/pages/admin/CalendarPanel.tsx, so this file tests the AGREEMENT between
// the two rather than a restatement of one of them.
//
// Everything here is pure or runs in DEMO mode. The reads themselves are a
// Supabase RPC gated by 047's own gate, and belong to the Verify block in that
// migration rather than to `node --test`.

/** CalendarPanel.tsx:50-55, dayBoundsMs. */
function dayBoundsMs(key: string, tz: string): { start: number; end: number } {
  const s = zonedDateTimeToUtc(key, '00:00', tz, { nonexistent: 'forward' })
  const e = zonedDateTimeToUtc(addDaysToDateKey(key, 1), '00:00', tz, { nonexistent: 'forward' })
  assert.ok(s && e, `the panel itself could not bound ${key} in ${tz}`)
  return { start: s!.getTime(), end: e!.getTime() }
}

/** CalendarPanel.tsx:181-188, the eventsOnDay overlap predicate. */
const overlaps = (s: number, e: number, start: number, end: number) => e > start && s < end

function drawsOn(ev: { startsAt: string; endsAt: string }, key: string, tz: string): boolean {
  const { start, end } = dayBoundsMs(key, tz)
  return overlaps(new Date(ev.startsAt).getTime(), new Date(ev.endsAt).getTime(), start, end)
}

const row = (over: Partial<ContentDeadlineRow> = {}): ContentDeadlineRow => ({
  cycle_id: '3f7c1c6e-0000-4000-8000-000000000001',
  coach_slug: 'ronnie-vallejo',
  cycle_start: '2026-06-15',
  due_date: '2026-08-15',
  ...over,
})

const WIDE_FROM = '2020-01-01'
const WIDE_TO = '2030-12-31'

// ---------------------------------------------------------------------------
// 1. One row, one event, bounded exactly like the day cell it belongs to
// ---------------------------------------------------------------------------

test('a due date becomes one all-day event whose bounds are the display-zone day bounds', () => {
  const tz = 'America/Los_Angeles'
  const events = buildDeadlineEvents([row()], WIDE_FROM, WIDE_TO, tz)

  assert.equal(events.length, 1)
  const ev = events[0]

  const { start, end } = dayBoundsMs('2026-08-15', tz)
  assert.equal(new Date(ev.startsAt).getTime(), start)
  assert.equal(new Date(ev.endsAt).getTime(), end)

  // And the instants are what a Pacific August midnight actually is.
  assert.equal(ev.startsAt, '2026-08-15T07:00:00.000Z')
  assert.equal(ev.endsAt, '2026-08-16T07:00:00.000Z')
})

// ---------------------------------------------------------------------------
// 2. THE REGRESSION TEST FOR THE SMEAR
// ---------------------------------------------------------------------------
//
// This is the reason the conversion is in TypeScript and not in a sixth branch
// of calendar_events. A date converted server-side through the COACH's zone and
// then bucketed client-side through the VIEWER's zone overlaps two cells. 047's
// header works the arithmetic: a Pacific coach's 2026-08-15 becomes
// 07:00Z..07:00Z, which draws on Aug 15 AND Aug 16 for a New York viewer, and on
// Aug 14 AND Aug 15 for Honolulu. Anchoring in the display zone makes it exact.

test('a due date draws on exactly its own day, in every display zone', () => {
  const zones = [
    'America/Los_Angeles',
    'America/New_York',
    'Pacific/Honolulu',
    'Australia/Sydney',
    'Europe/London',
    'Asia/Kolkata',   // a half-hour offset, where a whole-hour assumption would show
    'Pacific/Kiritimati', // UTC+14, the far edge
  ]

  for (const tz of zones) {
    const events = buildDeadlineEvents([row()], WIDE_FROM, WIDE_TO, tz)
    assert.equal(events.length, 1, `${tz}: expected exactly one event`)
    const ev = events[0]

    // The day it is NAMED after is the day it renders on.
    assert.equal(dateKeyInTimeZone(new Date(ev.startsAt), tz), '2026-08-15', `${tz}: wrong start day`)

    assert.ok(drawsOn(ev, '2026-08-15', tz), `${tz}: does not draw on its own day`)
    assert.ok(!drawsOn(ev, '2026-08-14', tz), `${tz}: smears onto the day before`)
    assert.ok(!drawsOn(ev, '2026-08-16', tz), `${tz}: smears onto the day after`)
  }
})

test('the server-side conversion this design rejects really would smear', () => {
  // Not a test of our code. A guard on the CLAIM in 047's header, so that if
  // someone later proposes the sixth-branch design the counter-example is here
  // rather than in a comment. Pacific coach, date converted in the COACH's zone.
  const s = new Date('2026-08-15T07:00:00.000Z').getTime()
  const e = new Date('2026-08-16T07:00:00.000Z').getTime()

  for (const [tz, a, b] of [
    ['America/New_York', '2026-08-15', '2026-08-16'],
    ['Pacific/Honolulu', '2026-08-14', '2026-08-15'],
  ] as [string, string, string][]) {
    const first = dayBoundsMs(a, tz)
    const second = dayBoundsMs(b, tz)
    assert.ok(overlaps(s, e, first.start, first.end), `${tz}: expected a smear onto ${a}`)
    assert.ok(overlaps(s, e, second.start, second.end), `${tz}: expected a smear onto ${b}`)
  }
})

// ---------------------------------------------------------------------------
// 3. DST — a due date on a day whose midnight does not exist
// ---------------------------------------------------------------------------

test('a due date on a spring-forward midnight still yields exactly one placed event', () => {
  // Both of these zones jump at 00:00 local, so the due date's own midnight is
  // in the gap. `nonexistent: 'forward'` moves it to 01:00, and the panel's
  // dayBoundsMs makes the identical call, so the bounds still agree exactly.
  const cases: [string, string][] = [
    ['America/Santiago', '2026-09-06'],
    ['Asia/Beirut', '2026-03-29'],
  ]

  for (const [tz, due] of cases) {
    // Confirm the premise: this really is a gap.
    assert.equal(zonedDateTimeToUtc(due, '00:00', tz), null, `${tz}: ${due} was expected to be a DST gap`)

    const events = buildDeadlineEvents(
      [row({ due_date: due, cycle_start: addDaysToDateKey(due, -61) })],
      WIDE_FROM, WIDE_TO, tz,
    )
    assert.equal(events.length, 1, `${tz}: expected exactly one event`)
    const ev = events[0]

    const { start, end } = dayBoundsMs(due, tz)
    assert.equal(new Date(ev.startsAt).getTime(), start)
    assert.equal(new Date(ev.endsAt).getTime(), end)

    assert.ok(drawsOn(ev, due, tz), `${tz}: does not draw on its own day`)
    assert.ok(!drawsOn(ev, addDaysToDateKey(due, -1), tz), `${tz}: smears backwards`)
    assert.ok(!drawsOn(ev, addDaysToDateKey(due, 1), tz), `${tz}: smears forwards`)

    // And it is never a fabricated "now". calendar.ts's demo seed falls back to
    // new Date() for a round hour; a real deadline must never do that, because
    // it would silently draw the due date on today.
    assert.ok(
      Math.abs(new Date(ev.startsAt).getTime() - Date.now()) > 60_000,
      `${tz}: the instant looks fabricated from the clock`,
    )
  }
})

// ---------------------------------------------------------------------------
// 4. The range filter, and rows that cannot be trusted
// ---------------------------------------------------------------------------

test('rows whose due date falls outside the window emit nothing', () => {
  const tz = 'America/Los_Angeles'
  const rows = [
    row({ cycle_id: 'a', due_date: '2026-07-31' }),
    row({ cycle_id: 'b', due_date: '2026-08-01' }),
    row({ cycle_id: 'c', due_date: '2026-08-31' }),
    row({ cycle_id: 'd', due_date: '2026-09-01' }),
  ]
  const events = buildDeadlineEvents(rows, '2026-08-01', '2026-08-31', tz)

  // Inclusive on both bounds, which is what the RPC's `between` means too.
  assert.deepEqual(events.map(e => e.eventId), ['deadline:b', 'deadline:c'])
})

test('malformed rows are skipped rather than guessed at', () => {
  const tz = 'America/Los_Angeles'
  const rows = [
    row({ cycle_id: 'good' }),
    row({ cycle_id: 'bad-due', due_date: '15/08/2026' }),
    row({ cycle_id: 'bad-start', cycle_start: 'sometime in June' }),
    row({ cycle_id: 'null-due', due_date: null as unknown as string }),
    null as unknown as ContentDeadlineRow,
  ]
  const events = buildDeadlineEvents(rows, WIDE_FROM, WIDE_TO, tz)

  assert.deepEqual(events.map(e => e.eventId), ['deadline:good'])
})

// ---------------------------------------------------------------------------
// 5. The event shape the panel and the merge rely on
// ---------------------------------------------------------------------------

test('every emitted event is an all-day deadline carrying no client data', () => {
  const tz = 'Europe/London'
  const events = buildDeadlineEvents(
    demoContentDeadlines('2026-01-01', '2026-12-31', null, tz),
    '2026-01-01', '2026-12-31', tz,
  )
  assert.ok(events.length > 0)

  for (const ev of events) {
    assert.equal(ev.kind, 'deadline')
    assert.equal(ev.allDay, true)          // keeps it out of gridHours entirely
    assert.equal(ev.source, 'rotation')
    assert.equal(ev.status, null)          // the detail dialog is booking-shaped
    assert.equal(ev.bookingId, null)
    assert.equal(ev.clientName, null)
    assert.equal(ev.clientEmail, null)
    assert.equal(ev.clientPhone, null)
    assert.equal(ev.service, null)
    assert.equal(ev.title, 'Blog post due')
    assert.equal(typeof ev.coachSlug, 'string')
    assert.ok(ev.eventId.startsWith('deadline:'))
  }
})

// ---------------------------------------------------------------------------
// 6. React key safety
// ---------------------------------------------------------------------------

test('event ids are unique across a full year for the whole roster', () => {
  const tz = 'America/Los_Angeles'
  const events = buildDeadlineEvents(
    demoContentDeadlines('2026-01-01', '2026-12-31', null, tz),
    '2026-01-01', '2026-12-31', tz,
  )
  const ids = new Set(events.map(e => e.eventId))
  assert.equal(ids.size, events.length, 'duplicate eventId would drop renders in React')
})

// ---------------------------------------------------------------------------
// 7. HOUSE RULE — no em dashes in user-facing copy
// ---------------------------------------------------------------------------

test('no emitted title or reason contains an em dash', () => {
  const tz = 'America/New_York'
  const events = buildDeadlineEvents(
    demoContentDeadlines('2026-01-01', '2026-12-31', null, tz),
    '2026-01-01', '2026-12-31', tz,
  )
  assert.ok(events.length > 0)

  for (const ev of events) {
    assert.ok(!ev.title.includes('—'), `em dash in title: ${ev.title}`)
    assert.ok(!(ev.reason ?? '').includes('—'), `em dash in reason: ${ev.reason}`)
  }
})

// ---------------------------------------------------------------------------
// 8. The cycle window survives as prose
// ---------------------------------------------------------------------------

test('the reason states when the writing window opened', () => {
  const tz = 'America/Los_Angeles'
  const [ev] = buildDeadlineEvents([row({ cycle_start: '2026-06-05' })], WIDE_FROM, WIDE_TO, tz)

  assert.equal(ev.reason, 'Blog post due. Writing window opened Jun 5.')
})

test('the formatted cycle start never drifts a day, whatever the display zone', () => {
  // Formatted at noon UTC precisely so a zone far from UTC cannot roll it back
  // to the 4th or forward to the 6th.
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Honolulu', 'Asia/Kolkata']) {
    const [ev] = buildDeadlineEvents([row({ cycle_start: '2026-01-01' })], WIDE_FROM, WIDE_TO, tz)
    assert.equal(ev.reason, 'Blog post due. Writing window opened Jan 1.', `wrong in ${tz}`)
  }
})

// ---------------------------------------------------------------------------
// 9. The demo seed
// ---------------------------------------------------------------------------

test('the demo seed is deterministic, unwaived, and never leaves a month view blank', () => {
  const tz = 'America/Los_Angeles'
  const today = dateKeyInTimeZone(new Date(), tz)

  // A month grid is 5 or 6 weeks; 42 days centred on today is the widest it gets.
  const from = addDaysToDateKey(today, -21)
  const to = addDaysToDateKey(today, 20)

  const first = demoContentDeadlines(from, to, null, tz)
  const second = demoContentDeadlines(from, to, null, tz)
  assert.deepEqual(first, second, 'the seed must not move between renders')

  for (const r of first) {
    assert.ok(!('waived' in r), 'the demo seed must not model a waived cycle')
  }

  const events = buildDeadlineEvents(first, from, to, tz)
  assert.ok(events.length > 0, 'the demo portal would show an empty rotation')

  // Anchored to today, not to a literal year, so it does not go blank next year.
  const years = new Set(events.map(e => e.startsAt.slice(0, 4)))
  assert.ok(years.has(today.slice(0, 4)) || years.has(String(Number(today.slice(0, 4)) + 1)))
})

test('the demo seed populates a window of any width, and stays bounded', () => {
  const tz = 'America/Los_Angeles'
  const today = dateKeyInTimeZone(new Date(), tz)

  for (const span of [1, 7, 42, 365, 4000]) {
    const from = addDaysToDateKey(today, -Math.floor(span / 2))
    const to = addDaysToDateKey(from, span)
    const rows = demoContentDeadlines(from, to, null, tz)
    assert.ok(rows.length <= 400, `span ${span}: the seed is unbounded (${rows.length} rows)`)
    const events = buildDeadlineEvents(rows, from, to, tz)
    if (span >= 42) assert.ok(events.length > 0, `span ${span}: nothing to show`)
  }
})

// ---------------------------------------------------------------------------
// 10. The demo fetch path: no network, and scoped to one coach
// ---------------------------------------------------------------------------

test('fetchContentDeadlines in demo mode resolves offline and returns one coach only', async () => {
  const tz = 'America/Los_Angeles'
  const today = dateKeyInTimeZone(new Date(), tz)
  const from = addDaysToDateKey(today, -60)
  const to = addDaysToDateKey(today, 60)

  const mine = await fetchContentDeadlines(from, to, 'seth-burman', true, tz)
  assert.ok(mine.length > 0)
  for (const ev of mine) assert.equal(ev.coachSlug, 'seth-burman')

  const all = await fetchContentDeadlines(from, to, null, true, tz)
  assert.ok(new Set(all.map(e => e.coachSlug)).size > 1, 'the roster view should show more than one coach')

  // And every event still lands inside the asked-for window.
  for (const ev of all) {
    const key = dateKeyInTimeZone(new Date(ev.startsAt), tz)
    assert.ok(key >= from && key <= to, `${key} is outside ${from}..${to}`)
  }
})

test('fetchContentDeadlines refuses a malformed range without throwing', async () => {
  assert.deepEqual(await fetchContentDeadlines('not-a-date', '2026-08-31', null, true, 'UTC'), [])
  assert.deepEqual(await fetchContentDeadlines('2026-08-01', '31/08/2026', null, true, 'UTC'), [])
})
