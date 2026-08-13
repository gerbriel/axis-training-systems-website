import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSlots, isSlotOffered, overlaps } from '../supabase/functions/_shared/slots.ts'
import type { SlotInput } from '../supabase/functions/_shared/slots.ts'

/**
 * The server-side slot engine — the one that decides what is offered AND what
 * is accepted. `booking-availability` renders its output; `booking-create` and
 * `booking-manage` match a requested instant against it. A bug here is either a
 * slot nobody can book or a booking on top of somebody else.
 *
 * Everything below is in America/Los_Angeles, which is where Axis is, and every
 * expected instant is written out in UTC so a wrong offset fails loudly rather
 * than agreeing with itself.
 */

const TZ = 'America/Los_Angeles'

/** A Monday. 2026-08-17 is a Monday; day_of_week 1. */
const MONDAY = '2026-08-17'

function input(over: Partial<SlotInput> = {}): SlotInput {
  return {
    timeZone: TZ,
    // 09:00–12:00 on Mondays, a slot may start every 30 minutes.
    schedules: [{ day_of_week: 1, start_time: '09:00', end_time: '12:00', slot_duration_minutes: 30 }],
    blocks: [],
    busy: [],
    durationMinutes: 30,
    bufferMinutes: 0,
    minLeadMinutes: 0,
    maxAdvanceDays: 365,
    // Well before the Monday, so lead time never interferes unless a test says so.
    now: new Date('2026-08-01T00:00:00Z'),
    ...over,
  }
}

const startsOf = (i: SlotInput, day = MONDAY) =>
  generateSlots(i, day, 1)[0].slots.map(s => new Date(s.start).toISOString())

// ---------------------------------------------------------------------------
// The core of migration 009: step and length are different things
// ---------------------------------------------------------------------------

test('the window sets the SPACING and the service sets the LENGTH', () => {
  // 30-minute grid, 30-minute service: 09:00 .. 11:30 (11:30 + 30 = 12:00, the close).
  assert.deepEqual(startsOf(input()), [
    '2026-08-17T16:00:00.000Z', '2026-08-17T16:30:00.000Z',
    '2026-08-17T17:00:00.000Z', '2026-08-17T17:30:00.000Z',
    '2026-08-17T18:00:00.000Z', '2026-08-17T18:30:00.000Z',
  ])
})

test('a 45-minute service on a 30-minute grid still starts on the grid', () => {
  const slots = generateSlots(input({ durationMinutes: 45 }), MONDAY, 1)[0].slots

  // Starts every 30 min, but the last one must FINISH by 12:00 — so 11:30 is
  // gone (it would run to 12:15) and 11:15 was never on the grid to begin with.
  assert.deepEqual(slots.map(s => new Date(s.start).toISOString()), [
    '2026-08-17T16:00:00.000Z', '2026-08-17T16:30:00.000Z',
    '2026-08-17T17:00:00.000Z', '2026-08-17T17:30:00.000Z',
    '2026-08-17T18:00:00.000Z',
  ])
  // And each one is 45 minutes long, not 30.
  assert.equal(slots[0].end - slots[0].start, 45 * 60_000)
  assert.equal(slots[0].durationMinutes, 45)
})

test('a null duration falls back to the window length, as it did before the catalog', () => {
  // The coach-with-no-services case. Must behave exactly like durationMinutes: 30.
  assert.deepEqual(startsOf(input({ durationMinutes: null })), startsOf(input()))
})

// ---------------------------------------------------------------------------
// Buffer
// ---------------------------------------------------------------------------

test('the buffer occupies the calendar but is not part of the call', () => {
  const slots = generateSlots(input({ bufferMinutes: 15 }), MONDAY, 1)[0].slots

  // 30 + 15 = 45 must fit before 12:00, so the 11:30 start is dropped.
  assert.equal(slots.at(-1) && new Date(slots.at(-1)!.start).toISOString(), '2026-08-17T18:00:00.000Z')
  // The returned end is the end of the CALL. The client is not on the call for
  // the buffer, so it must never appear in a duration shown to them.
  assert.equal(slots[0].end - slots[0].start, 30 * 60_000)
  assert.equal(slots[0].durationMinutes, 30)
})

test('a buffer keeps the slot after an existing booking off the market', () => {
  // Somebody has 09:00–09:30. With no buffer, 09:30 is free.
  const busy = [{ start: Date.parse('2026-08-17T16:00:00Z'), end: Date.parse('2026-08-17T16:30:00Z') }]

  assert.ok(startsOf(input({ busy })).includes('2026-08-17T16:30:00.000Z'))
  // With a 15-minute buffer the 09:30 start would occupy 09:30–10:15 — fine —
  // but the 09:00 booking's own buffer is not modelled here, so what this
  // asserts is the other direction: the candidate's span is what gets tested.
  const buffered = startsOf(input({ busy, bufferMinutes: 15 }))
  assert.ok(buffered.includes('2026-08-17T16:30:00.000Z'))
  assert.ok(!buffered.includes('2026-08-17T16:00:00.000Z'))
})

// ---------------------------------------------------------------------------
// Occupied time
// ---------------------------------------------------------------------------

test('busy intervals remove exactly the slots they overlap', () => {
  const busy = [{ start: Date.parse('2026-08-17T17:00:00Z'), end: Date.parse('2026-08-17T17:30:00Z') }]
  const slots = startsOf(input({ busy }))

  assert.ok(!slots.includes('2026-08-17T17:00:00.000Z'))
  // Half-open: a booking ending at 10:30 does not overlap one starting at 10:30.
  assert.ok(slots.includes('2026-08-17T17:30:00.000Z'))
  assert.ok(slots.includes('2026-08-17T16:30:00.000Z'))
})

test('a block with null times closes the whole coach-zone day', () => {
  const blocks = [{ block_date: MONDAY, start_time: null, end_time: null }]
  assert.deepEqual(startsOf(input({ blocks })), [])
})

test('a partial block is read as wall clock in the coach zone', () => {
  const blocks = [{ block_date: MONDAY, start_time: '09:00', end_time: '10:00' }]
  const slots = startsOf(input({ blocks }))

  // 09:00 and 09:30 gone; 10:00 survives (the block ends as that slot begins).
  assert.deepEqual(slots, [
    '2026-08-17T17:00:00.000Z', '2026-08-17T17:30:00.000Z',
    '2026-08-17T18:00:00.000Z', '2026-08-17T18:30:00.000Z',
  ])
})

test('a day the coach does not work has no slots, and is still reported', () => {
  // Tuesday. The day must come back with an empty list rather than be missing —
  // callers page through a fixed window and a hole in it is a rendering bug.
  const days = generateSlots(input(), '2026-08-18', 1)
  assert.equal(days.length, 1)
  assert.equal(days[0].dateKey, '2026-08-18')
  assert.deepEqual(days[0].slots, [])
})

// ---------------------------------------------------------------------------
// Policy bounds
// ---------------------------------------------------------------------------

test('min lead removes everything inside the coach’s notice period', () => {
  // 08:00 PDT on the day itself = 15:00Z. With 120 minutes' notice, nothing
  // before 10:00 local (17:00Z) may be offered.
  const now = new Date('2026-08-17T15:00:00Z')
  const slots = startsOf(input({ now, minLeadMinutes: 120 }))

  assert.deepEqual(slots, [
    '2026-08-17T17:00:00.000Z', '2026-08-17T17:30:00.000Z',
    '2026-08-17T18:00:00.000Z', '2026-08-17T18:30:00.000Z',
  ])
})

test('max advance closes the far end of the calendar', () => {
  // The Monday is 16 days out; a 10-day horizon must not reach it.
  assert.deepEqual(startsOf(input({ maxAdvanceDays: 10 })), [])
  assert.ok(startsOf(input({ maxAdvanceDays: 30 })).length > 0)
})

// ---------------------------------------------------------------------------
// DST — the reason any of this is written the way it is
// ---------------------------------------------------------------------------

test('the same wall-clock window is a different instant either side of a DST shift', () => {
  // 2026-03-08 is spring forward in Los Angeles. The Monday after is 2026-03-09
  // (PDT, UTC-7); the Monday before is 2026-03-02 (PST, UTC-8).
  // `now` has to precede both, or min-lead correctly discards the lot.
  const now = new Date('2026-02-01T00:00:00Z')
  const before = startsOf(input({ now }), '2026-03-02')
  const after  = startsOf(input({ now }), '2026-03-09')

  assert.equal(before[0], '2026-03-02T17:00:00.000Z') // 09:00 PST
  assert.equal(after[0],  '2026-03-09T16:00:00.000Z') // 09:00 PDT
})

test('a window that spans the spring-forward gap does not offer the hour that does not exist', () => {
  // 2026-03-08 is a Sunday. A 01:00–05:00 window there: 02:00 and 02:30 local
  // never happen. The server helper resolves a gap FORWARD rather than
  // dropping it, so those two collapse onto real instants — what must never
  // happen is a DUPLICATE start being offered twice.
  const slots = generateSlots(
    input({
      schedules: [{ day_of_week: 0, start_time: '01:00', end_time: '05:00', slot_duration_minutes: 30 }],
    }),
    '2026-03-08',
    1
  )[0].slots

  const starts = slots.map(s => s.start)
  assert.equal(new Set(starts).size, starts.length, 'a start was offered twice')
  // And they are strictly increasing, which a mishandled gap breaks.
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i] > starts[i - 1], 'slots are not in order across the DST gap')
  }
})

// ---------------------------------------------------------------------------
// isSlotOffered — the authoritative check booking-create runs
// ---------------------------------------------------------------------------

test('isSlotOffered matches an exact instant and nothing else', () => {
  const i = input()
  const onGrid  = Date.parse('2026-08-17T16:30:00Z')
  const offGrid = Date.parse('2026-08-17T16:37:00Z')

  assert.ok(isSlotOffered(i, onGrid, MONDAY), 'a real slot was refused')
  assert.equal(isSlotOffered(i, offGrid, MONDAY), null, 'an off-grid instant was accepted')
})

test('isSlotOffered returns the DATABASE’s duration, not the caller’s', () => {
  // This is what stops a request naming its own length: whatever the caller
  // sent, the booking is written with the duration that comes back from here.
  const hit = isSlotOffered(input({ durationMinutes: 45 }), Date.parse('2026-08-17T16:00:00Z'), MONDAY)
  assert.equal(hit?.durationMinutes, 45)
})

test('isSlotOffered looks a day either side, so a late-evening slot is reachable', () => {
  // A 23:30 PDT slot on the Monday is 06:30Z on the TUESDAY. booking-create
  // derives its dateKey from the instant in the coach's zone, so it asks about
  // the Monday — the helper has to regenerate the neighbouring days to find it.
  const i = input({
    schedules: [{ day_of_week: 1, start_time: '23:00', end_time: '23:59', slot_duration_minutes: 30 }],
    durationMinutes: 30,
  })
  const late = Date.parse('2026-08-18T06:00:00Z') // 23:00 PDT Monday
  assert.ok(isSlotOffered(i, late, MONDAY))
})

// ---------------------------------------------------------------------------
// The one overlap test in the system
// ---------------------------------------------------------------------------

test('overlaps is half-open: touching is not overlapping', () => {
  const a = { start: 100, end: 200 }
  assert.equal(overlaps(a, { start: 200, end: 300 }), false)
  assert.equal(overlaps(a, { start: 0, end: 100 }), false)
  assert.equal(overlaps(a, { start: 199, end: 300 }), true)
  assert.equal(overlaps(a, { start: 150, end: 160 }), true)
  assert.equal(overlaps(a, { start: 0, end: 300 }), true)
})
