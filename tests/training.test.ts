import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  blocksForAthlete,
  BLOCK_LABEL_LIMIT,
  BLOCK_NOTES_LIMIT,
  cleanBlockLabel,
  cleanBlockNotes,
  currentBlocks,
  daysInPhase,
  phaseMeta,
  PHASES,
} from '../src/lib/trainingApi.ts'
import type { TrainingBlock, TrainingPhase } from '../src/lib/trainingApi.ts'

// Pure functions only. Everything else in this module is a Supabase RPC and
// belongs to an integration test with a database behind it, not to `node --test`.
// Migration 044's own verify block is that test, and it was run.

const block = (over: Partial<TrainingBlock> & { id: string }): TrainingBlock => ({
  athlete_id: 'ath-1',
  phase: 'prep',
  label: null,
  notes: null,
  starts_on: '2026-08-01',
  ends_on: null,
  created_at: '2026-08-01T10:00:00Z',
  ...over,
})

// ---------------------------------------------------------------------------
// 1. PHASES — the list a chip is drawn from
// ---------------------------------------------------------------------------
// These seven strings are also the seven in `training_blocks_phase_known` (044).
// If this list and that CHECK ever disagree, the picker offers a phase the RPC
// refuses, and the refusal is a sentence about a phase the person just clicked.

test('PHASES carries the seven phases the CHECK constraint allows', () => {
  assert.equal(PHASES.length, 7)
  assert.deepEqual(PHASES.map(p => p.key), [
    'development',
    'transition',
    'prep',
    'competition',
    'recovery',
    'injury',
    'off',
  ])
})

test('PHASES is in progression order and not alphabetical', () => {
  // Build, carry over, sharpen, compete, come down, then the two states that are
  // not a plan. A picker in this order reads as the year.
  const alphabetical = [...PHASES.map(p => p.key)].sort()
  assert.notDeepEqual(PHASES.map(p => p.key), alphabetical)
  assert.equal(PHASES[0].key, 'development')
  assert.equal(PHASES.at(-1)?.key, 'off')
})

test('PHASES pins the exact colour of every chip', () => {
  // Screens render these values rather than deriving them, so a change here is a
  // change to every board at once and has to be deliberate.
  assert.deepEqual(
    PHASES.map(p => [p.key, p.color]),
    [
      ['development', '#3987e5'],
      ['transition', '#9085e9'],
      ['prep', '#c98500'],
      ['competition', '#c8102e'],
      ['recovery', '#199e70'],
      ['injury', '#d55181'],
      ['off', '#898781'],
    ],
  )
})

test('PHASES has a label for every key and no duplicates of either', () => {
  const keys = new Set(PHASES.map(p => p.key))
  const labels = new Set(PHASES.map(p => p.label))
  assert.equal(keys.size, PHASES.length)
  assert.equal(labels.size, PHASES.length)
  for (const phase of PHASES) {
    assert.ok(phase.label.length > 0)
    assert.match(phase.color, /^#[0-9a-f]{6}$/)
  }
})

test('phaseMeta finds a known phase and falls back for anything else', () => {
  assert.equal(phaseMeta('competition').label, 'Competition')
  assert.equal(phaseMeta('competition').color, '#c8102e')

  // A row written before a phase was retired, or by a REST caller. The chip
  // still draws, in grey, with the string on it rather than a blank.
  const unknown = phaseMeta('deload')
  assert.equal(unknown.label, 'deload')
  assert.equal(unknown.color, '#898781')
  assert.equal(phaseMeta('').label, 'Unknown')
})

// ---------------------------------------------------------------------------
// 2. currentBlocks — athlete id to the block they are in
// ---------------------------------------------------------------------------

test('currentBlocks keeps the open block and drops every closed one', () => {
  const blocks = [
    block({ id: 'b1', athlete_id: 'ath-1', ends_on: null, phase: 'competition' }),
    block({ id: 'b2', athlete_id: 'ath-1', ends_on: '2026-07-30', phase: 'prep' }),
    block({ id: 'b3', athlete_id: 'ath-2', ends_on: null, phase: 'injury' }),
  ]

  const open = currentBlocks(blocks)
  assert.equal(open.size, 2)
  assert.equal(open.get('ath-1')?.id, 'b1')
  assert.equal(open.get('ath-2')?.phase, 'injury')
})

test('currentBlocks answers nothing for an athlete between blocks', () => {
  const blocks = [block({ id: 'b1', athlete_id: 'ath-1', ends_on: '2026-08-10' })]
  const open = currentBlocks(blocks)

  assert.equal(open.size, 0)
  assert.equal(open.get('ath-1'), undefined)
  assert.equal(currentBlocks([]).size, 0)
})

test('currentBlocks picks the newest when a stale list holds two open rows', () => {
  // The database cannot produce this: a partial unique index allows one open
  // block per athlete. A client holding a stale list beside a fresh one can, and
  // showing the older phase would show one the coach has already moved on from.
  const blocks = [
    block({ id: 'stale', athlete_id: 'ath-1', starts_on: '2026-06-01', phase: 'development' }),
    block({ id: 'fresh', athlete_id: 'ath-1', starts_on: '2026-08-01', phase: 'prep' }),
  ]

  assert.equal(currentBlocks(blocks).get('ath-1')?.id, 'fresh')
  // And the same list in the other order answers the same way.
  assert.equal(currentBlocks([...blocks].reverse()).get('ath-1')?.id, 'fresh')
})

test('currentBlocks does not mutate what it was given', () => {
  const blocks = [block({ id: 'b1' }), block({ id: 'b2', ends_on: '2026-08-09' })]
  const open = currentBlocks(blocks)

  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].ends_on, null)
  assert.equal(open.get('ath-1'), blocks[0])
})

// ---------------------------------------------------------------------------
// 3. daysInPhase — what the chip counts
// ---------------------------------------------------------------------------
// The start day is day one, so a block started today reads 1 and never 0. Both
// sides are calendar dates: `starts_on` has no zone on it and `now` is a moment
// in the viewer's, and this studio is in California, where a naive subtraction
// of a UTC-parsed date from a local timestamp is off by one all afternoon.

const localDate = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)

test('daysInPhase counts the start day as day one', () => {
  const started = block({ id: 'b1', starts_on: '2026-08-15' })
  assert.equal(daysInPhase(started, localDate(2026, 8, 15)), 1)
  assert.equal(daysInPhase(started, localDate(2026, 8, 16)), 2)
  assert.equal(daysInPhase(started, localDate(2026, 8, 29)), 15)
})

test('daysInPhase is the same all day long', () => {
  // The failure this catches is the one that shows a different number to a coach
  // at breakfast and at dinner.
  const started = block({ id: 'b1', starts_on: '2026-08-01' })
  const first = daysInPhase(started, localDate(2026, 8, 15, 0))
  const last = daysInPhase(started, localDate(2026, 8, 15, 23))
  assert.equal(first, 15)
  assert.equal(last, 15)
})

test('daysInPhase counts a closed block through its last day', () => {
  const closed = block({ id: 'b1', starts_on: '2026-06-01', ends_on: '2026-06-30' })
  // 30 days, inclusive of both ends, and `now` is not consulted at all.
  assert.equal(daysInPhase(closed, localDate(2026, 12, 25)), 30)
  assert.equal(daysInPhase(closed, localDate(2026, 6, 2)), 30)
})

test('daysInPhase reads a block opened and closed the same day as one day', () => {
  // What correcting a mis-click leaves behind: a real row, one day long.
  const sameDay = block({ id: 'b1', starts_on: '2026-08-15', ends_on: '2026-08-15' })
  assert.equal(daysInPhase(sameDay, localDate(2026, 8, 20)), 1)
})

test('daysInPhase survives a daylight saving change', () => {
  // US daylight saving starts on 8 March 2026. A block spanning it must not gain
  // or lose a day to an hour.
  const spring = block({ id: 'b1', starts_on: '2026-03-01' })
  assert.equal(daysInPhase(spring, localDate(2026, 3, 15)), 15)

  const autumn = block({ id: 'b2', starts_on: '2026-10-25' })
  assert.equal(daysInPhase(autumn, localDate(2026, 11, 8)), 15)
})

test('daysInPhase never answers zero, a negative, or NaN', () => {
  // A block dated in the future is not something this app can create, but a
  // restore or a hand-written row could, and a chip reading "-3 days" is worse
  // than a chip reading "1 day".
  const future = block({ id: 'b1', starts_on: '2026-09-01' })
  assert.equal(daysInPhase(future, localDate(2026, 8, 15)), 1)

  const nonsense = block({ id: 'b2', starts_on: 'not a date' })
  assert.equal(daysInPhase(nonsense, localDate(2026, 8, 15)), 1)
  assert.equal(Number.isNaN(daysInPhase(nonsense, localDate(2026, 8, 15))), false)
})

test('daysInPhase reads a full timestamp if one ever arrives in the column', () => {
  // The column is a date and PostgREST returns 'YYYY-MM-DD'. A later migration
  // that widened it should not make every chip read 1.
  const stamped = block({ id: 'b1', starts_on: '2026-08-01T00:00:00Z' })
  assert.equal(daysInPhase(stamped, localDate(2026, 8, 15)), 15)
})

// ---------------------------------------------------------------------------
// 4. cleanBlockLabel and cleanBlockNotes — what leaves the editor
// ---------------------------------------------------------------------------

test('cleanBlockLabel collapses a name onto one line', () => {
  assert.equal(cleanBlockLabel('  Spring   meet prep  '), 'Spring meet prep')
  assert.equal(cleanBlockLabel('Spring\nmeet prep'), 'Spring meet prep')
  assert.equal(cleanBlockLabel('Spring\t\tprep'), 'Spring prep')
  assert.equal(cleanBlockLabel('Spring\u0000 prep'), 'Spring prep')
})

test('cleanBlockLabel answers null for anything with nothing in it', () => {
  // The column is nullable and a name of "" renders as an empty line under the
  // chip. The RPC does the same nullif server-side.
  assert.equal(cleanBlockLabel(''), null)
  assert.equal(cleanBlockLabel('   '), null)
  assert.equal(cleanBlockLabel('\n\t '), null)
  assert.equal(cleanBlockLabel(null), null)
  assert.equal(cleanBlockLabel(undefined), null)
  assert.equal(cleanBlockLabel('\u0000\u0007'), null)
})

test('cleanBlockLabel caps at the column limit with no trailing space', () => {
  const long = 'n'.repeat(BLOCK_LABEL_LIMIT + 40)
  assert.equal(cleanBlockLabel(long)?.length, BLOCK_LABEL_LIMIT)

  const spacey = `${'z'.repeat(BLOCK_LABEL_LIMIT - 1)} tail`
  const cleaned = cleanBlockLabel(spacey) ?? ''
  assert.ok(cleaned.length <= BLOCK_LABEL_LIMIT)
  assert.equal(cleaned, cleaned.trimEnd())
})

test('cleanBlockNotes keeps paragraphs and normalizes every newline flavour', () => {
  // Unlike the label, this is where the intent of a block gets written down, and
  // a note squashed onto one line is a note nobody reads back.
  assert.equal(cleanBlockNotes('first line\n\nsecond line'), 'first line\n\nsecond line')
  assert.equal(cleanBlockNotes('a\r\nb'), 'a\nb')
  assert.equal(cleanBlockNotes('a\rb'), 'a\nb')
  assert.equal(cleanBlockNotes('col1\tcol2'), 'col1\tcol2')
})

test('cleanBlockNotes strips control characters but not tab or newline', () => {
  assert.equal(cleanBlockNotes('he\u0000llo'), 'hello')
  assert.equal(cleanBlockNotes('he\u0007llo'), 'hello')
  assert.equal(cleanBlockNotes('he\u001Bllo'), 'hello')
  assert.equal(cleanBlockNotes('he\u007Fllo'), 'hello')
  assert.equal(cleanBlockNotes('keep\tthis\nand this'), 'keep\tthis\nand this')
})

test('cleanBlockNotes answers null for nothing and caps at the column limit', () => {
  assert.equal(cleanBlockNotes(''), null)
  assert.equal(cleanBlockNotes('   \n\t '), null)
  assert.equal(cleanBlockNotes(null), null)

  const long = 'y'.repeat(BLOCK_NOTES_LIMIT + 500)
  assert.equal(cleanBlockNotes(long)?.length, BLOCK_NOTES_LIMIT)
})

// ---------------------------------------------------------------------------
// 5. blocksForAthlete — one athlete's history, newest first
// ---------------------------------------------------------------------------

test('blocksForAthlete returns only that athlete, newest block first', () => {
  const blocks = [
    block({ id: 'old', athlete_id: 'ath-1', starts_on: '2026-01-01', ends_on: '2026-03-01' }),
    block({ id: 'theirs', athlete_id: 'ath-2', starts_on: '2026-07-01' }),
    block({ id: 'new', athlete_id: 'ath-1', starts_on: '2026-08-01' }),
  ]

  assert.deepEqual(blocksForAthlete(blocks, 'ath-1').map(b => b.id), ['new', 'old'])
  assert.deepEqual(blocksForAthlete(blocks, 'ath-2').map(b => b.id), ['theirs'])
  assert.deepEqual(blocksForAthlete(blocks, 'nobody'), [])
})

test('blocksForAthlete breaks a same-day tie on when the row was written', () => {
  // A phase set and corrected within the hour. Both rows are real and the newer
  // one goes on top, which is the order the board's own query returns.
  const blocks = [
    block({ id: 'first', starts_on: '2026-08-15', created_at: '2026-08-15T09:00:00Z', ends_on: '2026-08-15' }),
    block({ id: 'second', starts_on: '2026-08-15', created_at: '2026-08-15T09:40:00Z' }),
  ]

  assert.deepEqual(blocksForAthlete(blocks, 'ath-1').map(b => b.id), ['second', 'first'])
  assert.deepEqual(blocksForAthlete([...blocks].reverse(), 'ath-1').map(b => b.id), ['second', 'first'])
})

test('blocksForAthlete does not mutate what it was given', () => {
  const blocks = [
    block({ id: 'old', starts_on: '2026-01-01' }),
    block({ id: 'new', starts_on: '2026-08-01' }),
  ]
  const history = blocksForAthlete(blocks, 'ath-1')

  assert.deepEqual(blocks.map(b => b.id), ['old', 'new'])
  assert.notEqual(history, blocks)
})

// ---------------------------------------------------------------------------
// 6. The type and the constraint agree
// ---------------------------------------------------------------------------

test('every TrainingPhase in the union is present in PHASES', () => {
  // Written out rather than derived, so that adding a phase to the union without
  // adding it to the list fails here rather than on a blank picker.
  const union: TrainingPhase[] = [
    'development',
    'transition',
    'prep',
    'competition',
    'recovery',
    'injury',
    'off',
  ]
  const keys = new Set(PHASES.map(p => p.key))
  for (const phase of union) assert.ok(keys.has(phase), `${phase} is missing from PHASES`)
})
