import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  planAssignments,
  savePlan,
  createCycle,
  createCycles,
  deleteCycles,
  fetchPlan,
  fetchRotation,
  generateSchedule,
  waiveCycles,
  type RotationPlan,
} from '../src/lib/rotationApi.ts'

// The pure half of the rotation plan, plus the refusals that run before anything
// touches the network. The reads and writes themselves are Supabase calls gated
// by the policies in migrations 005, 040 and 046, and belong to an integration
// test with a database behind it rather than to `node --test`.
//
// Everything here that is not pure runs in DEMO mode, which needs no
// credentials. Demo mode keeps one plan and one schedule in module memory for
// the life of the process, so the few tests that write to them are written to
// tolerate each other's leftovers and never assert on a total row count.

const plan = (over: Partial<RotationPlan> = {}): RotationPlan => ({
  members: ['ronnie-vallejo', 'seth-burman', 'lucas-sison'],
  everyCount: 2,
  everyUnit: 'week',
  anchor: '2026-08-01',
  ...over,
})

const due = (rows: { dueDate: string }[]) => rows.map(r => r.dueDate)

// ---------------------------------------------------------------------------
// 1. Round robin — the order of the array is the order of the rotation
// ---------------------------------------------------------------------------

test('assignments follow the member order and wrap at the end of the list', () => {
  const rows = planAssignments(plan(), 7)

  assert.deepEqual(rows.map(r => r.coachSlug), [
    'ronnie-vallejo', 'seth-burman', 'lucas-sison',
    'ronnie-vallejo', 'seth-burman', 'lucas-sison',
    'ronnie-vallejo',
  ])
})

test('reordering the members reorders the turns and nothing else', () => {
  const forward = planAssignments(plan(), 3)
  const reversed = planAssignments(
    plan({ members: ['lucas-sison', 'seth-burman', 'ronnie-vallejo'] }),
    3,
  )

  // Same dates, different names against them: the grid is the cadence and the
  // anchor, and the member list only decides whose turn each slot is.
  assert.deepEqual(due(forward), due(reversed))
  assert.deepEqual(reversed.map(r => r.coachSlug), ['lucas-sison', 'seth-burman', 'ronnie-vallejo'])
})

// ---------------------------------------------------------------------------
// 2. Step arithmetic — days and weeks
// ---------------------------------------------------------------------------

test('a day step advances by exactly that many days', () => {
  const rows = planAssignments(plan({ everyCount: 3, everyUnit: 'day', anchor: '2026-03-01' }), 4)
  assert.deepEqual(due(rows), ['2026-03-01', '2026-03-04', '2026-03-07', '2026-03-10'])
})

test('a week step advances by seven days a time and crosses a month end', () => {
  const rows = planAssignments(plan({ everyCount: 1, everyUnit: 'week', anchor: '2026-01-25' }), 3)
  assert.deepEqual(due(rows), ['2026-01-25', '2026-02-01', '2026-02-08'])
})

test('a day step crosses a leap day without losing one', () => {
  // 2028 is a leap year; February has 29 days and the step must count it.
  const rows = planAssignments(plan({ everyCount: 1, everyUnit: 'day', anchor: '2028-02-28' }), 3)
  assert.deepEqual(due(rows), ['2028-02-28', '2028-02-29', '2028-03-01'])
})

test('the founding five stepping fortnightly reproduce the schedule 005 seeded', () => {
  const rows = planAssignments(
    plan({
      members: ['ronnie-vallejo', 'seth-burman', 'lucas-sison', 'kobe-pham', 'aedan-nguyen'],
      everyCount: 2,
      everyUnit: 'week',
      anchor: '2026-08-01',
    }),
    6,
  )

  assert.deepEqual(due(rows), [
    '2026-08-01', '2026-08-15', '2026-08-29', '2026-09-12', '2026-09-26', '2026-10-10',
  ])
  // Six turns in, the rotation is back on the coach it started with.
  assert.equal(rows[5].coachSlug, 'ronnie-vallejo')
})

// ---------------------------------------------------------------------------
// 3. Month arithmetic — clamp, then continue from the ORIGINAL day of the month
// ---------------------------------------------------------------------------
//
// Every offset is computed from the anchor as `i * step`, never from the
// previous result. That is what makes the clamp temporary: February borrows the
// 28th because it has no 31st, and March hands the 31st straight back. Stepping
// cumulatively would clamp once and then carry the shortened day forward for
// ever, and a monthly rotation anchored on the 31st would quietly slide to the
// 28th within one year.

test('a month step clamps to the last day of a short month', () => {
  const rows = planAssignments(plan({ members: ['solo'], everyCount: 1, everyUnit: 'month', anchor: '2026-01-31' }), 5)

  assert.deepEqual(due(rows), [
    '2026-01-31',
    '2026-02-28',  // clamped: February has no 31st, and NOT rolled to March 3
    '2026-03-31',  // and the original day of the month comes straight back
    '2026-04-30',  // clamped again, because April has 30 days
    '2026-05-31',
  ])
})

test('the clamp respects a leap February', () => {
  const rows = planAssignments(plan({ members: ['solo'], everyCount: 1, everyUnit: 'month', anchor: '2028-01-30' }), 2)
  assert.deepEqual(due(rows), ['2028-01-30', '2028-02-29'])
})

test('a multi-month step counts from the anchor and carries the year', () => {
  const rows = planAssignments(plan({ members: ['solo'], everyCount: 3, everyUnit: 'month', anchor: '2026-11-30' }), 4)
  assert.deepEqual(due(rows), ['2026-11-30', '2027-02-28', '2027-05-30', '2027-08-30'])
})

// ---------------------------------------------------------------------------
// 4. The window — cycleStart is one full loop before the due date
// ---------------------------------------------------------------------------

test('cycleStart is a full loop before the due date', () => {
  // Three members stepping a fortnight: a loop is 6 weeks, so every window is
  // 42 days long and opens where that coach's previous turn was due.
  const rows = planAssignments(plan(), 5)

  assert.equal(rows[0].dueDate, '2026-08-01')
  assert.equal(rows[0].cycleStart, '2026-06-20')   // 42 days earlier
  assert.equal(rows[3].coachSlug, rows[0].coachSlug)
  assert.equal(rows[3].cycleStart, rows[0].dueDate) // the window opens on the last turn
})

test('the window uses the same clamped arithmetic as the due date', () => {
  const rows = planAssignments(
    plan({ members: ['a', 'b'], everyCount: 1, everyUnit: 'month', anchor: '2026-03-31' }),
    3,
  )

  // A loop is two months here, so the window opens two months before the due
  // date, clamped the same way: 2026-01-31 for March 31, and 2026-02-28 for the
  // April 30 turn (which is itself a clamp of the 31st).
  assert.deepEqual(rows.map(r => [r.cycleStart, r.dueDate]), [
    ['2026-01-31', '2026-03-31'],
    ['2026-02-28', '2026-04-30'],
    ['2026-03-31', '2026-05-31'],
  ])
})

test('a single-coach rotation has a window exactly one step long', () => {
  const rows = planAssignments(plan({ members: ['solo'], everyCount: 3, everyUnit: 'day', anchor: '2026-03-01' }), 2)

  assert.deepEqual(rows, [
    { coachSlug: 'solo', cycleStart: '2026-02-26', dueDate: '2026-03-01' },
    { coachSlug: 'solo', cycleStart: '2026-03-01', dueDate: '2026-03-04' },
  ])
})

test('every window opens strictly before it closes, which is 005 own CHECK', () => {
  // content_rotation_window_valid is `due_date > cycle_start`. Nothing the
  // generator produces may fail it, month clamping included.
  for (const unit of ['day', 'week', 'month'] as const) {
    for (const anchor of ['2026-01-31', '2026-02-28', '2026-12-31', '2028-02-29']) {
      for (const members of [['a'], ['a', 'b'], ['a', 'b', 'c', 'd', 'e']]) {
        const rows = planAssignments(plan({ members, everyCount: 1, everyUnit: unit, anchor }), 12)
        for (const row of rows) {
          assert.ok(row.dueDate > row.cycleStart, `${unit} ${anchor}: ${row.cycleStart} -> ${row.dueDate}`)
        }
      }
    }
  }
})

// ---------------------------------------------------------------------------
// 5. The edges of planAssignments
// ---------------------------------------------------------------------------

test('a rotation with nobody in it produces nothing', () => {
  assert.deepEqual(planAssignments(plan({ members: [] }), 10), [])
})

test('an unset anchor produces nothing rather than NaN dates', () => {
  // The panel previews live, and its date input is empty for as long as it takes
  // somebody to pick a new one.
  assert.deepEqual(planAssignments(plan({ anchor: '' }), 5), [])
  assert.deepEqual(planAssignments(plan({ anchor: '2026-02-30' }), 5), [])
})

test('the count is capped at 60 however many are asked for', () => {
  assert.equal(planAssignments(plan(), 200).length, 60)
  assert.equal(planAssignments(plan(), 60).length, 60)
  assert.equal(planAssignments(plan(), 61).length, 60)
  assert.equal(planAssignments(plan(), 8).length, 8)
})

test('a count of zero or less produces nothing', () => {
  assert.deepEqual(planAssignments(plan(), 0), [])
  assert.deepEqual(planAssignments(plan(), -3), [])
})

test('a broken cadence falls back to a step of one rather than repeating a date', () => {
  // A row written before 046 CHECK existed, or a caller that skipped savePlan.
  const rows = planAssignments(plan({ members: ['solo'], everyCount: 0, everyUnit: 'day', anchor: '2026-03-01' }), 3)
  assert.deepEqual(due(rows), ['2026-03-01', '2026-03-02', '2026-03-03'])
})

// ---------------------------------------------------------------------------
// 6. savePlan — shape refusals, in sentences
// ---------------------------------------------------------------------------
//
// Shape only. Whether a slug still names a working coach is the panel question,
// asked against the live roster, and it cannot be asked here: a coach who has
// left is exactly who an admin has opened the panel to remove.

const refuses = (p: RotationPlan, match: RegExp) =>
  assert.rejects(() => savePlan(p, true), match)

test('an empty rotation is refused', async () => {
  await refuses(plan({ members: [] }), /at least one coach/i)
})

test('more than fifty coaches is refused', async () => {
  const many = Array.from({ length: 51 }, (_, i) => `coach-${i}`)
  await refuses(plan({ members: many }), /at most 50 coaches/i)
  // And fifty exactly is fine.
  await savePlan(plan({ members: many.slice(0, 50) }), true)
})

test('a blank or malformed member is refused', async () => {
  await refuses(plan({ members: ['ronnie-vallejo', ''] }), /valid address/i)
  await refuses(plan({ members: ['ronnie-vallejo', '   '] }), /valid address/i)
  await refuses(plan({ members: ['Ronnie Vallejo'] }), /valid address/i)
  await refuses(plan({ members: ['-leading-hyphen'] }), /valid address/i)
})

test('the same coach twice is refused rather than quietly deduped', async () => {
  // Deduping would save an order different from the one on screen when Save was
  // pressed, which is the kind of silence that gets noticed two months later.
  await refuses(
    plan({ members: ['seth-burman', 'ronnie-vallejo', 'seth-burman'] }),
    /seth-burman is in the rotation twice/i,
  )
})

test('a cadence outside 1 to 365 is refused, and so is a fractional one', async () => {
  await refuses(plan({ everyCount: 0 }), /whole number between 1 and 365/i)
  await refuses(plan({ everyCount: 366 }), /whole number between 1 and 365/i)
  await refuses(plan({ everyCount: Number.NaN }), /whole number between 1 and 365/i)
})

test('a unit outside days, weeks and months is refused', async () => {
  await refuses(plan({ everyUnit: 'fortnight' as unknown as RotationPlan['everyUnit'] }), /days, weeks or months/i)
})

test('an unreal anchor is refused', async () => {
  await refuses(plan({ anchor: '' }), /valid date for the first turn/i)
  await refuses(plan({ anchor: '2026-02-30' }), /valid date for the first turn/i)
  await refuses(plan({ anchor: 'next tuesday' }), /valid date for the first turn/i)
})

test('a saved plan comes back with its members trimmed and in order', async () => {
  await savePlan(plan({ members: [' kobe-pham ', 'aedan-nguyen'], everyCount: 5, everyUnit: 'day' }), true)
  const saved = await fetchPlan(true)

  assert.deepEqual(saved.members, ['kobe-pham', 'aedan-nguyen'])
  assert.equal(saved.everyCount, 5)
  assert.equal(saved.everyUnit, 'day')
})

// ---------------------------------------------------------------------------
// 7. The slug-shape rule that replaced the static COACHES check
// ---------------------------------------------------------------------------
//
// validateCycle used to ask `COACHES.some(c => c.slug === input.coachSlug)`,
// which is the five people in src/data/coaches.ts. A coach provisioned through
// 036 exists in every registry that matters, takes bookings, and could not be
// given a blog cycle: the refusal read "Pick a coach for this cycle" over a form
// where a coach was plainly picked. The API keeps the shape; the panel checks
// the live roster and can name the person it is refusing.

test('a coach who is not one of the static five can be scheduled', async () => {
  const cycle = await createCycle(
    { coachSlug: 'nia-adeyemi', cycleStart: '2027-01-01', dueDate: '2027-03-01' },
    true,
  )
  assert.equal(cycle.coachSlug, 'nia-adeyemi')
  assert.equal(cycle.dueDate, '2027-03-01')
})

test('a malformed slug is still refused', async () => {
  const bad = ['', '   ', 'Nia Adeyemi', 'nia_adeyemi', '-nia', 'x'.repeat(61)]
  for (const coachSlug of bad) {
    await assert.rejects(
      () => createCycle({ coachSlug, cycleStart: '2027-01-01', dueDate: '2027-03-01' }, true),
      /pick a coach/i,
      coachSlug,
    )
  }
})

test('a multi-coach create refuses the same shapes and the same broken windows', async () => {
  await assert.rejects(
    () => createCycles([], { cycleStart: '2027-01-01', dueDate: '2027-03-01' }, true),
    /at least one coach/i,
  )
  await assert.rejects(
    () => createCycles(['Nia Adeyemi'], { cycleStart: '2027-01-01', dueDate: '2027-03-01' }, true),
    /at least one coach/i,
  )
  await assert.rejects(
    () => createCycles(['nia-adeyemi'], { cycleStart: '2027-01-01', dueDate: '2026-01-01' }, true),
    /due date must come after/i,
  )
  await assert.rejects(
    () => createCycles(['nia-adeyemi'], { cycleStart: '2027-01-01', dueDate: '2027-02-30' }, true),
    /valid start and due dates/i,
  )
})

test('a multi-coach create counts what it wrote and what was already there', async () => {
  const window = { cycleStart: '2027-06-01', dueDate: '2027-08-01' }

  const first = await createCycles(['dana-okafor', 'nia-adeyemi'], window, true)
  assert.deepEqual(first, { created: 2, skipped: 0 })

  // Idempotent: the same window again adds nothing and says so.
  const again = await createCycles(['dana-okafor', 'nia-adeyemi'], window, true)
  assert.deepEqual(again, { created: 0, skipped: 2 })

  // And a batch that names one new coach alongside two existing ones.
  const mixed = await createCycles(['dana-okafor', 'rae-lindqvist', 'nia-adeyemi'], window, true)
  assert.deepEqual(mixed, { created: 1, skipped: 2 })
})

test('the same coach named twice in one batch is one cycle and one skip', async () => {
  const result = await createCycles(
    ['tom-echeverria', 'tom-echeverria'],
    { cycleStart: '2027-09-01', dueDate: '2027-11-01' },
    true,
  )
  assert.deepEqual(result, { created: 1, skipped: 1 })
})

// ---------------------------------------------------------------------------
// 8. Generating, waiving and deleting in bulk, against the demo store
// ---------------------------------------------------------------------------
//
// Far-future dates and a slug nobody else in this file uses, so these run
// wherever in the sequence the runner puts them and never collide with the
// seeded demo schedule.

const ONLY_ZED = (rows: { coachSlug: string }[]) => rows.filter(r => r.coachSlug === 'zed-quill')

test('generating writes the plan out and a second run adds nothing', async () => {
  const monthly = plan({ members: ['zed-quill'], everyCount: 1, everyUnit: 'month', anchor: '2029-01-31' })

  assert.deepEqual(await generateSchedule(monthly, 3, true), { created: 3, skipped: 0 })
  assert.deepEqual(await generateSchedule(monthly, 3, true), { created: 0, skipped: 3 })

  const rows = ONLY_ZED(await fetchRotation(true))
  assert.deepEqual(rows.map(r => r.dueDate), ['2029-01-31', '2029-02-28', '2029-03-31'])
  // The window on the first turn opens a full loop back, clamped the same way.
  assert.equal(rows[0].cycleStart, '2028-12-31')
})

test('a plan with nobody in it generates nothing rather than failing', async () => {
  assert.deepEqual(await generateSchedule(plan({ members: [] }), 10, true), { created: 0, skipped: 0 })
})

test('cycles waive and un-waive in bulk, with one shared reason', async () => {
  const ids = ONLY_ZED(await fetchRotation(true)).map(r => r.id)
  assert.equal(ids.length, 3)

  assert.equal(await waiveCycles(ids, true, '  On leave through March  ', true), 3)
  let rows = ONLY_ZED(await fetchRotation(true))
  assert.ok(rows.every(r => r.waived && r.waiveNote === 'On leave through March'))

  // Un-waiving drops the note with it: the reason belonged to the excuse.
  assert.equal(await waiveCycles(ids, false, undefined, true), 3)
  rows = ONLY_ZED(await fetchRotation(true))
  assert.ok(rows.every(r => !r.waived && r.waiveNote === undefined))

  assert.equal(await waiveCycles([], true, 'nobody', true), 0)
})

test('deleting in bulk answers how many rows actually went', async () => {
  const ids = ONLY_ZED(await fetchRotation(true)).map(r => r.id)

  // An id that is not on the schedule is not a deletion, and must not be counted
  // as one: the panel prints this number back to the admin.
  assert.equal(await deleteCycles([...ids, 'no-such-cycle'], true), 3)
  assert.equal(ONLY_ZED(await fetchRotation(true)).length, 0)
  assert.equal(await deleteCycles([], true), 0)
})
