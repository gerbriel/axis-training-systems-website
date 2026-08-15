import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  alsoWith,
  applySteps,
  buildBoard,
  canMoveAthletes,
  canSetPhase,
  columnCoaches,
  encodeDrag,
  halfMoveWarning,
  invertStep,
  moveOptions,
  parseDragPayload,
  planMove,
  UNASSIGNED_KEY,
} from '../src/lib/rosterBoard.ts'
import type { BoardViewer } from '../src/lib/rosterBoard.ts'
import type { Profile } from '../src/lib/account.ts'
import type { CoachAssignment } from '../src/types/messaging.ts'

// The board's arithmetic, without a database or a DOM. Everything tested here
// is a decision the screen makes on every render or on every drop: who gets a
// column, which column a card is drawn in, and exactly which two writes a move
// turns into. The drag-and-drop plumbing itself is not tested here, which is
// precisely why the keyboard path shares this same plan.

// `personName` lives in userManagement, which imports the Supabase client with
// an extensionless specifier and therefore cannot be loaded by `node --test`.
// The board takes its namer as a parameter for that reason; this is the test's.
const nameOf = (p: Profile) => p.display_name ?? p.email

function person(partial: Partial<Profile> & { id: string }): Profile {
  return {
    id: partial.id,
    email: partial.email ?? `${partial.id}@axistrainingsystems.com`,
    first_name: partial.first_name ?? null,
    last_name: partial.last_name ?? null,
    display_name: partial.display_name ?? partial.id,
    avatar_url: null,
    phone: null,
    role: partial.role ?? 'athlete',
    status: partial.status ?? 'active',
    coach_slug: partial.coach_slug ?? null,
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

const pair = (athlete: string, coach: string): CoachAssignment => ({
  athlete_id: athlete,
  coach_id: coach,
  assigned_at: '2026-01-01T00:00:00.000Z',
})

// Two coaches, an admin who coaches, an admin who does not, a suspended coach,
// and five athletes covering every filing rule the board has.
const RONNIE = person({ id: 'ronnie', display_name: 'Ronnie Vallejo', role: 'admin', coach_slug: 'ronnie-vallejo' })
const SETH = person({ id: 'seth', display_name: 'Seth Burman', role: 'coach', coach_slug: 'seth-burman' })
const LUCAS = person({ id: 'lucas', display_name: 'Lucas Sison', role: 'coach', coach_slug: 'lucas-sison' })
const OFFICE = person({ id: 'office', display_name: 'Office Admin', role: 'admin' })
const AEDAN = person({ id: 'aedan', display_name: 'Aedan Nguyen', role: 'coach', status: 'suspended', coach_slug: 'aedan-nguyen' })

const DEVIN = person({ id: 'devin', display_name: 'Devin Cross' })
const BIANCA = person({ id: 'bianca', display_name: 'Bianca Reyes' })
const MARCUS = person({ id: 'marcus', display_name: 'Marcus Rivera' })
const TYLER = person({ id: 'tyler', display_name: 'Tyler Vance', status: 'suspended' })
const ORPHAN = person({ id: 'orphan', display_name: 'Orphan Athlete' })

const PEOPLE = [RONNIE, SETH, LUCAS, OFFICE, AEDAN, DEVIN, BIANCA, MARCUS, TYLER, ORPHAN]

const ASSIGNMENTS = [
  pair(DEVIN.id, SETH.id),
  pair(DEVIN.id, LUCAS.id), // two coaches: one card, two columns
  pair(BIANCA.id, RONNIE.id),
  pair(TYLER.id, SETH.id), // suspended athlete: no card at all
  pair(ORPHAN.id, AEDAN.id), // only coach is suspended: no column to sit in
]

// ── Columns ──────────────────────────────────────────────────────────────────

test('columnCoaches takes active coaches and admins who actually coach', () => {
  const ids = columnCoaches(PEOPLE, ASSIGNMENTS, nameOf).map(c => c.id)
  // Lucas, Ronnie and Seth, by name. The office admin holds no coach page and no
  // athletes, and Aedan is suspended.
  assert.deepEqual(ids, ['lucas', 'ronnie', 'seth'])
})

test('an admin with no coach page still gets a column once somebody is assigned to them', () => {
  const ids = columnCoaches(PEOPLE, [...ASSIGNMENTS, pair(MARCUS.id, OFFICE.id)], nameOf).map(c => c.id)
  assert.ok(ids.includes('office'))
})

test('buildBoard leads with Unassigned and files every active athlete exactly once per coach', () => {
  const board = buildBoard(PEOPLE, ASSIGNMENTS, nameOf)

  assert.equal(board[0].key, UNASSIGNED_KEY)
  assert.equal(board[0].coachId, null)
  assert.deepEqual(board.map(c => c.key), [UNASSIGNED_KEY, 'lucas', 'ronnie', 'seth'])

  const seth = board.find(c => c.key === 'seth')
  const lucas = board.find(c => c.key === 'lucas')
  const ronnie = board.find(c => c.key === 'ronnie')

  assert.deepEqual(seth?.cards.map(c => c.athlete.id), ['devin'])
  assert.deepEqual(lucas?.cards.map(c => c.athlete.id), ['devin'])
  assert.deepEqual(ronnie?.cards.map(c => c.athlete.id), ['bianca'])

  // The two-coach athlete is one card object drawn twice, not two cards.
  assert.equal(seth?.cards[0], lucas?.cards[0])
  assert.deepEqual(seth?.cards[0].coachIds, ['lucas', 'seth'])
})

test('buildBoard puts nobody in Unassigned but athletes who are in no column', () => {
  const board = buildBoard(PEOPLE, ASSIGNMENTS, nameOf)
  const unassigned = board[0]

  // Marcus has no rows at all. Orphan has a row, pointing at a suspended coach.
  assert.deepEqual(unassigned.cards.map(c => c.athlete.id), ['marcus', 'orphan'])

  const marcus = unassigned.cards.find(c => c.athlete.id === 'marcus')
  assert.deepEqual(marcus?.coachIds, [])
  assert.deepEqual(marcus?.offBoardCoachIds, [])

  const orphan = unassigned.cards.find(c => c.athlete.id === 'orphan')
  assert.deepEqual(orphan?.coachIds, [])
  assert.deepEqual(orphan?.offBoardCoachIds, ['aedan'])
})

test('buildBoard leaves suspended and pending athletes off the board', () => {
  const board = buildBoard(PEOPLE, ASSIGNMENTS, nameOf)
  const everyone = board.flatMap(c => c.cards.map(card => card.athlete.id))
  assert.ok(!everyone.includes('tyler'))

  const pending = person({ id: 'pending-athlete', status: 'pending' })
  const withPending = buildBoard([...PEOPLE, pending], ASSIGNMENTS, nameOf)
  assert.ok(!withPending.flatMap(c => c.cards).some(card => card.athlete.id === 'pending-athlete'))
})

test('buildBoard tolerates a duplicated assignment row without drawing a card twice', () => {
  const board = buildBoard(PEOPLE, [...ASSIGNMENTS, pair(DEVIN.id, SETH.id)], nameOf)
  const seth = board.find(c => c.key === 'seth')
  assert.deepEqual(seth?.cards.map(c => c.athlete.id), ['devin'])
})

test('alsoWith names the other columns a card is in', () => {
  const board = buildBoard(PEOPLE, ASSIGNMENTS, nameOf)
  const card = board.find(c => c.key === 'seth')?.cards[0]
  assert.ok(card)
  assert.deepEqual(alsoWith(card, 'seth'), ['lucas'])
  assert.deepEqual(alsoWith(card, 'lucas'), ['seth'])
  assert.deepEqual(alsoWith(card, null), ['lucas', 'seth'])
})

test('moveOptions offers every column but the one the card is in', () => {
  const board = buildBoard(PEOPLE, ASSIGNMENTS, nameOf)
  assert.deepEqual(moveOptions(board, 'seth').map(o => o.key), [UNASSIGNED_KEY, 'lucas', 'ronnie'])
  assert.deepEqual(moveOptions(board, UNASSIGNED_KEY).map(o => o.coachId), ['lucas', 'ronnie', 'seth'])
  assert.equal(moveOptions(board, 'seth')[0].label, 'Unassigned')
})

// ── Planning a move ──────────────────────────────────────────────────────────

test('planMove onto the same column writes nothing', () => {
  assert.deepEqual(planMove('devin', 'seth', 'seth', ['seth']), { steps: [], kind: 'none' })
  assert.deepEqual(planMove('marcus', null, null, []), { steps: [], kind: 'none' })
})

test('planMove out of Unassigned is a single insert', () => {
  const plan = planMove('marcus', null, 'seth', [])
  assert.equal(plan.kind, 'add')
  assert.deepEqual(plan.steps, [{ athleteId: 'marcus', coachId: 'seth', assigned: true }])
})

test('planMove onto Unassigned removes only the column it came from', () => {
  const plan = planMove('devin', 'seth', null, ['lucas', 'seth'])
  assert.equal(plan.kind, 'remove')
  assert.deepEqual(plan.steps, [{ athleteId: 'devin', coachId: 'seth', assigned: false }])
})

test('planMove between coaches inserts before it deletes', () => {
  const plan = planMove('bianca', 'ronnie', 'seth', ['ronnie'])
  assert.equal(plan.kind, 'transfer')
  assert.deepEqual(plan.steps, [
    { athleteId: 'bianca', coachId: 'seth', assigned: true },
    { athleteId: 'bianca', coachId: 'ronnie', assigned: false },
  ])
})

test('planMove onto a coach the athlete already has just drops the old column', () => {
  const plan = planMove('devin', 'seth', 'lucas', ['lucas', 'seth'])
  assert.equal(plan.kind, 'remove')
  assert.deepEqual(plan.steps, [{ athleteId: 'devin', coachId: 'seth', assigned: false }])
})

test('planMove from Unassigned onto a coach the athlete already has writes nothing', () => {
  // Only reachable from a stale board, and a duplicate insert would be refused
  // by the primary key anyway.
  assert.deepEqual(planMove('devin', null, 'seth', ['seth']), { steps: [], kind: 'none' })
})

// ── Applying and undoing ─────────────────────────────────────────────────────

test('applySteps performs a transfer on the rows and buildBoard follows', () => {
  const plan = planMove('bianca', 'ronnie', 'seth', ['ronnie'])
  const rows = applySteps(ASSIGNMENTS, plan.steps, '2026-02-02T00:00:00.000Z')

  assert.ok(rows.some(r => r.athlete_id === 'bianca' && r.coach_id === 'seth'))
  assert.ok(!rows.some(r => r.athlete_id === 'bianca' && r.coach_id === 'ronnie'))
  // The source array is untouched, which is what makes a rollback a restore.
  assert.ok(ASSIGNMENTS.some(r => r.athlete_id === 'bianca' && r.coach_id === 'ronnie'))

  const board = buildBoard(PEOPLE, rows, nameOf)
  assert.deepEqual(board.find(c => c.key === 'seth')?.cards.map(c => c.athlete.id), ['bianca', 'devin'])
  assert.deepEqual(board.find(c => c.key === 'ronnie')?.cards, [])
})

test('applySteps never duplicates a pair that is already there', () => {
  const rows = applySteps(ASSIGNMENTS, [{ athleteId: 'devin', coachId: 'seth', assigned: true }])
  assert.equal(rows.filter(r => r.athlete_id === 'devin' && r.coach_id === 'seth').length, 1)
})

test('inverting the second step of a transfer leaves the half-applied state on screen', () => {
  const plan = planMove('bianca', 'ronnie', 'seth', ['ronnie'])
  const optimistic = applySteps(ASSIGNMENTS, plan.steps)
  // The insert landed, the delete was refused: put the old row back and leave
  // the new one, which is what the database now holds.
  const halfway = applySteps(optimistic, [invertStep(plan.steps[1])])

  assert.ok(halfway.some(r => r.athlete_id === 'bianca' && r.coach_id === 'seth'))
  assert.ok(halfway.some(r => r.athlete_id === 'bianca' && r.coach_id === 'ronnie'))

  const board = buildBoard(PEOPLE, halfway, nameOf)
  const card = board.find(c => c.key === 'seth')?.cards.find(c => c.athlete.id === 'bianca')
  assert.deepEqual(card?.coachIds, ['ronnie', 'seth'])
})

test('halfMoveWarning names both coaches and the fix', () => {
  const said = halfMoveWarning('Bianca Reyes', 'Ronnie Vallejo', 'Seth Burman')
  assert.ok(said.includes('Bianca Reyes'))
  assert.ok(said.includes('Ronnie Vallejo'))
  assert.ok(said.includes('Seth Burman'))
  assert.ok(!said.includes('—'))
})

// ── Signage ──────────────────────────────────────────────────────────────────

const viewer = (partial: Partial<BoardViewer>): BoardViewer => ({
  id: partial.id ?? null,
  isDemo: partial.isDemo ?? false,
  isAdmin: partial.isAdmin ?? false,
  canManageStaff: partial.canManageStaff ?? false,
})

test('moving is offered to admins, manage_staff holders and the demo', () => {
  assert.equal(canMoveAthletes(viewer({ isAdmin: true })), true)
  assert.equal(canMoveAthletes(viewer({ canManageStaff: true })), true)
  assert.equal(canMoveAthletes(viewer({ isDemo: true })), true)
  assert.equal(canMoveAthletes(viewer({ id: 'seth' })), false)
})

test('phase controls reach a coach on their own athletes and nobody else', () => {
  assert.equal(canSetPhase(viewer({ id: 'seth' }), ['seth']), true)
  assert.equal(canSetPhase(viewer({ id: 'seth' }), ['lucas']), false)
  assert.equal(canSetPhase(viewer({ id: null }), []), false)
  assert.equal(canSetPhase(viewer({ isAdmin: true }), []), true)
  assert.equal(canSetPhase(viewer({ canManageStaff: true }), ['lucas']), true)
})

// ── The drag payload ─────────────────────────────────────────────────────────

test('a drag payload survives the round trip', () => {
  assert.deepEqual(parseDragPayload(encodeDrag({ athleteId: 'devin', fromCoachId: 'seth' })), {
    athleteId: 'devin',
    fromCoachId: 'seth',
  })
  assert.deepEqual(parseDragPayload(encodeDrag({ athleteId: 'marcus', fromCoachId: null })), {
    athleteId: 'marcus',
    fromCoachId: null,
  })
})

test('anything else dropped on the board is ignored', () => {
  assert.equal(parseDragPayload(null), null)
  assert.equal(parseDragPayload(''), null)
  assert.equal(parseDragPayload('https://example.com/a-link'), null)
  assert.equal(parseDragPayload('[]'), null)
  assert.equal(parseDragPayload('"devin"'), null)
  assert.equal(parseDragPayload('{"athleteId":42,"fromCoachId":null}'), null)
  assert.equal(parseDragPayload('{"fromCoachId":"seth"}'), null)
  assert.equal(parseDragPayload('{"athleteId":"devin"}'), null)
  assert.equal(parseDragPayload('{"athleteId":"devin","fromCoachId":7}'), null)
})
