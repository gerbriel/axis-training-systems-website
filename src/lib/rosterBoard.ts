import type { Profile } from './account.ts'
import type { CoachAssignment } from '../types/messaging.ts'

/**
 * The roster board, as arithmetic.
 *
 * Everything in this file is pure. No Supabase, no React, no runtime import at
 * all: the only two imports are types and both are erased before the code runs,
 * so `node --test` can load this module directly and the board's real decisions
 * get tested without a database or a DOM.
 *
 * Three of those decisions are worth stating out loud, because each one is a
 * place where the obvious implementation is wrong.
 *
 * A CARD CAN BE IN TWO COLUMNS AT ONCE. `athlete_coaches` is a many-to-many
 * table with no ordering column and no notion of a primary coach, so "which
 * column is this athlete in" has no answer. The board answers "which columns",
 * plural, and an athlete with two coaches is drawn twice with a badge naming the
 * other one. Picking a winner would invent a fact the schema does not hold.
 *
 * A MOVE IS TWO WRITES, NOT ONE. There is no UPDATE grant on that table
 * anywhere, by design (023, tightened in 033), so moving somebody from one
 * column to another is an INSERT followed by a DELETE. `planMove` is where that
 * shape is decided, and it deliberately orders the INSERT first: if the pair
 * half-fails, an athlete with two coaches is a tidy-up, and an athlete with none
 * is somebody who has silently lost the ability to message anyone.
 *
 * UNASSIGNED MEANS "IN NO COLUMN", NOT "IN NO ROW". An athlete whose only coach
 * was suspended still has a row in `athlete_coaches`, but that coach has no
 * column, so filing them by row count would leave them drawn nowhere at all.
 * They land in Unassigned with their off-board coaches recorded on the card, so
 * the screen can say why they are there.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The Unassigned column's key. Not a coach id, and deliberately not a uuid. */
export const UNASSIGNED_KEY = 'unassigned'

/**
 * A name for a profile. Passed in rather than imported so this module stays
 * free of runtime dependencies: the panel hands over `personName` from
 * userManagement, which is the one place that decision is made.
 */
export type NameOf = (p: Profile) => string

export interface BoardCard {
  athlete: Profile
  /** Coaches with a column on this board, in column order. Empty on an Unassigned card. */
  coachIds: string[]
  /**
   * Coaches this athlete is assigned to who have no column, which in practice
   * means a suspended or demoted account. Rare, and the reason a card can sit
   * in Unassigned while rows exist for it.
   */
  offBoardCoachIds: string[]
}

export interface BoardColumn {
  /** `UNASSIGNED_KEY` or the coach's profile id. Stable across renders and drags. */
  key: string
  /** null on the Unassigned column. */
  coachId: string | null
  coach: Profile | null
  title: string
  cards: BoardCard[]
}

/** Who is looking. Every field here is signage; the database decides for real. */
export interface BoardViewer {
  id: string | null
  isDemo: boolean
  isAdmin: boolean
  canManageStaff: boolean
}

// ---------------------------------------------------------------------------
// Building the board
// ---------------------------------------------------------------------------

/**
 * Who gets a column.
 *
 * 023's validation trigger accepts an active `coach` or an active `admin` as the
 * coach half of an assignment, and nothing else, so those are the candidates.
 * Admins are then narrowed once more: an administrator who runs the place
 * without coaching anybody should not add an empty lane to every board, so they
 * appear only if they hold a coach page or already have an athlete. A coach with
 * no coach page still gets a column, because the trigger would still accept the
 * row and hiding the column would hide their athletes.
 */
export function columnCoaches(
  people: Profile[],
  assignments: CoachAssignment[],
  nameOf: NameOf,
): Profile[] {
  const holdsSomebody = new Set(assignments.map(a => a.coach_id))

  return people
    .filter(p => {
      if (p.status !== 'active') return false
      if (p.role === 'coach') return true
      return p.role === 'admin' && (!!p.coach_slug || holdsSomebody.has(p.id))
    })
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
}

/**
 * The whole board: Unassigned first, then one column per coach.
 *
 * Unassigned leads rather than trails because it is the queue. A new athlete
 * lands there the moment their account is approved and stays invisible to every
 * coach until somebody moves them, so it is the column with work in it.
 *
 * Cards are shared references: an athlete with two coaches is the SAME object in
 * both columns, which keeps `coachIds` identical wherever it is read and makes
 * the "also with" badge a filter rather than a second lookup.
 */
export function buildBoard(
  people: Profile[],
  assignments: CoachAssignment[],
  nameOf: NameOf,
): BoardColumn[] {
  const coaches = columnCoaches(people, assignments, nameOf)
  const order = new Map(coaches.map((c, i) => [c.id, i]))

  const byAthlete = new Map<string, string[]>()
  for (const row of assignments) {
    const list = byAthlete.get(row.athlete_id)
    if (!list) byAthlete.set(row.athlete_id, [row.coach_id])
    else if (!list.includes(row.coach_id)) list.push(row.coach_id)
  }

  const unassigned: BoardColumn = {
    key: UNASSIGNED_KEY,
    coachId: null,
    coach: null,
    title: 'Unassigned',
    cards: [],
  }
  const columns: BoardColumn[] = [
    unassigned,
    ...coaches.map(coach => ({
      key: coach.id,
      coachId: coach.id,
      coach,
      title: nameOf(coach),
      cards: [] as BoardCard[],
    })),
  ]
  const byKey = new Map(columns.map(c => [c.key, c]))

  const athletes = people
    .filter(p => p.role === 'athlete' && p.status === 'active')
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))

  for (const athlete of athletes) {
    const all = byAthlete.get(athlete.id) ?? []
    const coachIds = all
      .filter(id => order.has(id))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    const card: BoardCard = {
      athlete,
      coachIds,
      offBoardCoachIds: all.filter(id => !order.has(id)),
    }
    if (coachIds.length === 0) unassigned.cards.push(card)
    else for (const id of coachIds) byKey.get(id)?.cards.push(card)
  }

  return columns
}

/** The other coaches on a card, from one column's point of view. Drives "also with". */
export function alsoWith(card: BoardCard, columnCoachId: string | null): string[] {
  return card.coachIds.filter(id => id !== columnCoachId)
}

// ---------------------------------------------------------------------------
// Moving somebody
// ---------------------------------------------------------------------------

/** One write against `athlete_coaches`. `assigned` picks INSERT or DELETE. */
export interface MoveStep {
  athleteId: string
  coachId: string
  assigned: boolean
}

export type MoveKind = 'none' | 'add' | 'remove' | 'transfer'

export interface MovePlan {
  steps: MoveStep[]
  kind: MoveKind
}

/**
 * What a drop actually writes.
 *
 * `from` is the column the card was dragged OUT of, not "the athlete's coach",
 * and the difference is the whole reason this function exists. Dropping a
 * two-coach athlete onto Unassigned removes exactly the one lane they were
 * dragged from and leaves the other alone; reading the drop as "clear this
 * athlete's coaches" would quietly cut a second coach nobody touched.
 *
 * The insert comes first in a transfer, and `applySteps` preserves that order.
 * See the header: a half-applied transfer must leave a person with too many
 * coaches, never with none.
 *
 * Dragging onto a column the athlete is ALREADY in is not a no-op when it comes
 * from somewhere else. It means "stop being in the old one", so the plan is the
 * removal alone and no duplicate insert is attempted.
 */
export function planMove(
  athleteId: string,
  from: string | null,
  to: string | null,
  coachIds: string[],
): MovePlan {
  if (from === to) return { steps: [], kind: 'none' }

  if (to === null) {
    if (from === null) return { steps: [], kind: 'none' }
    return { steps: [{ athleteId, coachId: from, assigned: false }], kind: 'remove' }
  }

  const alreadyThere = coachIds.includes(to)

  if (from === null) {
    if (alreadyThere) return { steps: [], kind: 'none' }
    return { steps: [{ athleteId, coachId: to, assigned: true }], kind: 'add' }
  }

  if (alreadyThere) return { steps: [{ athleteId, coachId: from, assigned: false }], kind: 'remove' }

  return {
    steps: [
      { athleteId, coachId: to, assigned: true },
      { athleteId, coachId: from, assigned: false },
    ],
    kind: 'transfer',
  }
}

/** The same write, backwards. How a failed second half of a transfer is undone. */
export function invertStep(step: MoveStep): MoveStep {
  return { ...step, assigned: !step.assigned }
}

/**
 * The optimistic board, applied to the assignment rows themselves rather than to
 * the columns. Rebuilding the board from rows is cheap and keeps one source of
 * truth, so a rollback is "restore the rows", not "unpick the layout".
 *
 * An insert of a pair that already exists is a no-op here, matching
 * `setCoachAssignment`, which treats 23505 as success.
 */
export function applySteps(
  rows: CoachAssignment[],
  steps: MoveStep[],
  stamp = new Date().toISOString(),
): CoachAssignment[] {
  let next = rows
  for (const step of steps) {
    if (step.assigned) {
      const exists = next.some(r => r.athlete_id === step.athleteId && r.coach_id === step.coachId)
      next = exists
        ? next
        : [{ athlete_id: step.athleteId, coach_id: step.coachId, assigned_at: stamp }, ...next]
    } else {
      next = next.filter(r => !(r.athlete_id === step.athleteId && r.coach_id === step.coachId))
    }
  }
  return next
}

/**
 * The sentence for the state nobody should ever be left guessing at: the insert
 * landed, the delete did not, and the athlete now sits in two columns. Said in
 * full, with both names and the fix, because the alternative is a board that
 * looks wrong with no explanation on it.
 */
export function halfMoveWarning(athlete: string, fromCoach: string, toCoach: string): string {
  return `${athlete} is now with both ${toCoach} and ${fromCoach}. The new assignment saved, removing the old one did not. Take ${fromCoach} off by hand, either by dragging the card out of that column or from Users and permissions.`
}

/** Where a card may be sent, for the keyboard and click path. Never its own column. */
export function moveOptions(
  columns: BoardColumn[],
  currentKey: string,
): { key: string; coachId: string | null; label: string }[] {
  return columns
    .filter(c => c.key !== currentKey)
    .map(c => ({ key: c.key, coachId: c.coachId, label: c.title }))
}

// ---------------------------------------------------------------------------
// Signage
// ---------------------------------------------------------------------------

/**
 * Whether to offer a move at all.
 *
 * 033 gates every write on `athlete_coaches` behind `manage_staff` or admin,
 * and a coach does NOT hold it by role default: this is the table that decides
 * who may message whom, so a coach who could edit it could hand themselves
 * anybody. Showing drag handles to somebody the database will refuse is how a
 * board teaches people that it is broken.
 */
export function canMoveAthletes(viewer: BoardViewer): boolean {
  return viewer.isDemo || viewer.isAdmin || viewer.canManageStaff
}

/**
 * Whether to offer the phase controls on one card.
 *
 * Wider than moving on purpose, and it mirrors `can_manage_training` (044): a
 * coach may run the training blocks of the athletes assigned to them, which is
 * the daily job, without being able to change who those athletes are, which is
 * a staffing decision. `coachIds` is that card's on-board coaches, so this is
 * "am I one of this athlete's coaches" and nothing looser.
 */
export function canSetPhase(viewer: BoardViewer, coachIds: string[]): boolean {
  if (viewer.isDemo || viewer.isAdmin || viewer.canManageStaff) return true
  return viewer.id !== null && coachIds.includes(viewer.id)
}

// ---------------------------------------------------------------------------
// The drag payload
// ---------------------------------------------------------------------------

export interface DragPayload {
  athleteId: string
  fromCoachId: string | null
}

export function encodeDrag(payload: DragPayload): string {
  return JSON.stringify(payload)
}

/**
 * The dropped string, validated.
 *
 * A drop handler is an inbox open to the whole desktop: a file, a selection from
 * another tab, a link, all of them arrive at the same listener with whatever
 * `dataTransfer` they carry. So this parses defensively and answers null for
 * anything that is not our own payload, and the board ignores the drop rather
 * than firing a write built out of a stranger's JSON.
 */
export function parseDragPayload(raw: string | null | undefined): DragPayload | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const candidate = parsed as { athleteId?: unknown; fromCoachId?: unknown }
  if (typeof candidate.athleteId !== 'string' || candidate.athleteId === '') return null

  const from = candidate.fromCoachId
  if (from === null) return { athleteId: candidate.athleteId, fromCoachId: null }
  if (typeof from !== 'string' || from === '') return null

  return { athleteId: candidate.athleteId, fromCoachId: from }
}
