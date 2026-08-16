/**
 * rotationApi.ts
 *
 * The editorial rotation: every coach owes one blog every two months.
 *
 * The `content_rotation` table stores assignments only — who owes a post, by
 * when. Whether a cycle was actually *satisfied* is derived here by matching it
 * against the coach's real blog submissions, so the two can never drift apart.
 *
 * Mirrors contentApi's routing: demo / no-Supabase → generated in memory;
 * live → the `content_rotation` table.
 *
 * WHO IS IN THE ROTATION is no longer written down here. Migration 046 adds
 * `rotation_plans`, a singleton the head coach edits: an ordered list of coach
 * slugs, a cadence, and the anchor date the counting starts from. The constants
 * below survive only as the seed for that plan and for demo mode, which is the
 * one place a schedule still has to exist with no database behind it.
 *
 * IMPORT NOTE. `tests/rotationApi.test.ts` loads this module under `node --test`,
 * whose ESM resolver does not guess file extensions, so every RUNTIME import
 * here names a `.ts` file. `coachRoster.ts` carries the same note for the same
 * reason. Type-only imports are erased before node sees them and may stay bare.
 */

import { supabase, supabaseConfigured } from './supabase.ts'
import { sanitizeText } from '../utils/sanitize.ts'
import type { PendingContent } from '../data/pendingContent'

// Must match the roster ordinals seeded in 005_content_rotation.sql — the
// stagger is what spaces posts ~2 weeks apart instead of all five landing at once.
const ROTATION_ORDER = [
  'ronnie-vallejo',
  'seth-burman',
  'lucas-sison',
  'kobe-pham',
  'aedan-nguyen',
] as const

const ANCHOR = '2026-08-01'
const STAGGER_DAYS = 14
const CADENCE_MONTHS = 2
const CYCLES_AHEAD = 6

export interface RotationCycle {
  id: string
  coachSlug: string
  cycleStart: string   // YYYY-MM-DD — window opens
  dueDate: string      // YYYY-MM-DD — post owed by this date
  waived: boolean
  waiveNote?: string
}

/**
 * complete  — an approved blog landed in this window
 * submitted — a blog is in the window awaiting review; the coach has done their part
 * due       — window is open, nothing submitted yet
 * overdue   — window closed with nothing submitted
 * upcoming  — window has not opened yet
 * waived    — admin excused this cycle
 */
export type CycleState = 'complete' | 'submitted' | 'due' | 'overdue' | 'upcoming' | 'waived'

export interface RotationStatus {
  cycle: RotationCycle
  state: CycleState
  post?: PendingContent
  /** Negative when the due date has passed. */
  daysUntilDue: number
}

// ── date helpers (date-only, no timezone drift) ──────────────────────────────

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function parseISODate(s: string): Date {
  // Force UTC midnight so day arithmetic never slips across a DST boundary.
  return new Date(`${s.slice(0, 10)}T00:00:00Z`)
}

function addDays(s: string, days: number): string {
  const d = parseISODate(s)
  d.setUTCDate(d.getUTCDate() + days)
  return toISODate(d)
}

function addMonths(s: string, months: number): string {
  const d = parseISODate(s)
  d.setUTCMonth(d.getUTCMonth() + months)
  return toISODate(d)
}

/**
 * Add months and CLAMP to the last day of the target month.
 *
 *   2026-01-31 + 1 month → 2026-02-28   (not 2026-03-03)
 *   2026-01-31 + 3 month → 2026-04-30
 *
 * `addMonths` above cannot do this and is left exactly as it is. `setUTCMonth`
 * rolls a day that does not exist forward into the next month, so Jan 31 becomes
 * Mar 3, and every legacy path that calls it (the demo seed, which is anchored
 * on the 1st and the 15th and can never hit the case) keeps the behaviour it has
 * always had. Plan arithmetic must not roll: a monthly rotation anchored on the
 * 31st that drifted a day further into the next month on every February would
 * stop being monthly within a few turns.
 */
function addMonthsClamped(s: string, months: number): string {
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(5, 7))
  const d = Number(s.slice(8, 10))

  // Zero-based month arithmetic, carried into the year by floor division so a
  // negative step (cycleStart is a loop BEFORE the anchor) works the same way.
  const total = (y * 12) + (m - 1) + months
  const targetY = Math.floor(total / 12)
  const targetM = total - (targetY * 12)          // 0..11

  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)

  const mm = String(targetM + 1).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${String(targetY).padStart(4, '0')}-${mm}-${dd}`
}

function daysBetween(from: string, to: string): number {
  const ms = parseISODate(to).getTime() - parseISODate(from).getTime()
  return Math.round(ms / 86_400_000)
}

function todayISO(): string {
  return toISODate(new Date())
}

// ── demo generation ──────────────────────────────────────────────────────────
// Reproduces the SQL seed so demo mode shows the same schedule the live DB has.

function generateCycles(): RotationCycle[] {
  const out: RotationCycle[] = []
  ROTATION_ORDER.forEach((coachSlug, ordinal) => {
    for (let n = 0; n < CYCLES_AHEAD; n++) {
      const dueDate = addMonths(
        addDays(ANCHOR, ordinal * STAGGER_DAYS),
        n * CADENCE_MONTHS,
      )
      out.push({
        id: `${coachSlug}-${dueDate}`,
        coachSlug,
        cycleStart: addMonths(dueDate, -CADENCE_MONTHS),
        dueDate,
        waived: false,
      })
    }
  })
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

// A single persistent demo store so create/edit/delete/waive actually stick for
// the length of the session (the old code regenerated the schedule on every
// read, which silently discarded every write). Resets on reload.
let _demoCycles: RotationCycle[] | null = null
function getDemoCycles(): RotationCycle[] {
  if (!_demoCycles) _demoCycles = generateCycles()
  return _demoCycles
}

// ── DB mapping ───────────────────────────────────────────────────────────────

function rowToCycle(row: Record<string, unknown>): RotationCycle {
  return {
    id:         String(row.id),
    coachSlug:  String(row.coach_slug),
    cycleStart: String(row.cycle_start).slice(0, 10),
    dueDate:    String(row.due_date).slice(0, 10),
    waived:     row.waived === true,
    waiveNote:  typeof row.waive_note === 'string' ? row.waive_note : undefined,
  }
}

function useDB(isDemo: boolean): boolean {
  return supabaseConfigured && !isDemo
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Every cycle for every coach, oldest due date first. */
export async function fetchRotation(isDemo: boolean): Promise<RotationCycle[]> {
  if (!useDB(isDemo)) {
    return [...getDemoCycles()].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }

  const { data, error } = await supabase
    .from('content_rotation')
    .select('*')
    .order('due_date', { ascending: true })

  if (error) {
    // Deliberately NOT a fallback to generateCycles(): once cycles can be
    // created/edited/deleted, the seeded schedule no longer matches the DB, so
    // fabricating it on a transient read error would resurrect deleted cycles,
    // hide created ones, and hand the admin phantom rows whose slug-date ids
    // 404 against the uuid column the moment they Edit/Delete. An honest throw
    // lets RotationPanel show its error banner instead of a healthy-looking lie.
    throw new Error(error.message || 'Could not load the rotation schedule.')
  }
  return (data ?? []).map(r => rowToCycle(r as Record<string, unknown>))
}

/**
 * Decide what actually happened in each cycle by matching it against the
 * coach's real blog submissions. A blog counts for a cycle if it was submitted
 * inside that cycle's window.
 *
 * A rejected post deliberately does NOT satisfy a cycle — the coach still owes
 * a usable blog, so the cycle stays due/overdue until they resubmit.
 */
export function deriveStatuses(
  cycles: RotationCycle[],
  posts: PendingContent[],
  now: string = todayISO(),
): RotationStatus[] {
  const blogs = posts.filter(p => p.type === 'blog')

  return cycles.map(cycle => {
    const daysUntilDue = daysBetween(now, cycle.dueDate)

    if (cycle.waived) return { cycle, state: 'waived' as const, daysUntilDue }

    const inWindow = blogs.filter(p => {
      if (p.coachSlug !== cycle.coachSlug) return false
      const at = p.submittedAt.slice(0, 10)
      return at >= cycle.cycleStart && at <= cycle.dueDate
    })

    const approved = inWindow.find(p => p.status === 'approved')
    if (approved) return { cycle, state: 'complete' as const, post: approved, daysUntilDue }

    const pending = inWindow.find(p => p.status === 'pending')
    if (pending) return { cycle, state: 'submitted' as const, post: pending, daysUntilDue }

    if (now > cycle.dueDate)     return { cycle, state: 'overdue'  as const, daysUntilDue }
    if (now >= cycle.cycleStart) return { cycle, state: 'due'      as const, daysUntilDue }
    return { cycle, state: 'upcoming' as const, daysUntilDue }
  })
}

/**
 * The one cycle a coach should care about right now: their oldest unsatisfied
 * cycle if they have one, otherwise whatever is next on their schedule.
 */
export function currentCycleFor(
  coachSlug: string,
  statuses: RotationStatus[],
): RotationStatus | undefined {
  const mine = statuses
    .filter(s => s.cycle.coachSlug === coachSlug)
    .sort((a, b) => a.cycle.dueDate.localeCompare(b.cycle.dueDate))

  return (
    mine.find(s => s.state === 'overdue') ??
    mine.find(s => s.state === 'due') ??
    mine.find(s => s.state === 'submitted') ??
    mine.find(s => s.state === 'upcoming') ??
    mine[mine.length - 1]
  )
}

/** Admin: excuse a cycle (injury, leave) so it stops reading as overdue. */
export async function waiveCycle(
  id: string,
  waived: boolean,
  note: string | undefined,
  isDemo: boolean,
): Promise<void> {
  if (!useDB(isDemo)) {
    const c = getDemoCycles().find(x => x.id === id)
    if (c) { c.waived = waived; c.waiveNote = waived ? (note || undefined) : undefined }
    return
  }
  const { error } = await supabase
    .from('content_rotation')
    .update({ waived, waive_note: note ?? null })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Create / edit / delete a cycle (admin) ───────────────────────────────────
// The `content_rotation` RLS policy is `for all` to the content admin, so these
// writes reach the same table the seed does. Everything a caller can send is
// re-checked here so the DB's own guards (due_date > cycle_start, one cycle per
// coach per due date) are never the first line of defence.

const WAIVE_NOTE_MAX = 500

export interface CycleInput {
  coachSlug: string
  cycleStart: string   // YYYY-MM-DD
  dueDate: string      // YYYY-MM-DD
  waived?: boolean
  waiveNote?: string
}

/** A real calendar date in YYYY-MM-DD form (rejects 2026-13-40 and the like). */
function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * A well-shaped coach slug. Lowercase letters, digits and hyphens, starting on a
 * letter or a digit, 60 characters at most.
 *
 * THIS REPLACED A MEMBERSHIP TEST, and the swap is the point. Until now the
 * check here was `COACHES.some(c => c.slug === input.coachSlug)` — the static
 * founding five in src/data/coaches.ts. That array stopped being the roster the
 * day 036 shipped `provision_coach`: a coach added through the roster manager
 * exists in coach_routing, coach_public_settings and coach_profiles, takes
 * bookings, and could not be given a blog cycle, because a file compiled into
 * the bundle had never heard of them. The refusal read "Pick a coach for this
 * cycle" over a form where a coach was plainly picked.
 *
 * So the API keeps the SHAPE and the panel keeps the MEANING. RotationPanel
 * checks the chosen slugs against the live roster (fetchCoachRoster) before
 * calling anything here, which is the only place that knows who currently
 * exists, and it can say so about a specific name. What is left here is the
 * check that stops a malformed string reaching a text column, which is worth
 * keeping precisely because it does not go stale.
 */
const COACH_SLUG_SHAPE = /^[a-z0-9][a-z0-9-]*$/

function isCoachSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 60 && COACH_SLUG_SHAPE.test(value)
}

/** Throws a human-readable error if the input could not become a valid row. */
function validateCycle(input: CycleInput): void {
  if (!isCoachSlug(input.coachSlug)) {
    throw new Error('Pick a coach for this cycle.')
  }
  if (!isRealDate(input.cycleStart) || !isRealDate(input.dueDate)) {
    throw new Error('Enter valid start and due dates.')
  }
  // Mirrors the content_rotation_window_valid check constraint.
  if (!(input.dueDate > input.cycleStart)) {
    throw new Error('The due date must come after the cycle start.')
  }
}

function cleanNote(waived: boolean | undefined, note: string | undefined): string | undefined {
  if (!waived) return undefined
  const t = sanitizeText(note ?? '', WAIVE_NOTE_MAX)
  return t || undefined
}

/** Admin: schedule a new cycle. */
export async function createCycle(input: CycleInput, isDemo: boolean): Promise<RotationCycle> {
  validateCycle(input)
  const waived = input.waived === true
  const waiveNote = cleanNote(waived, input.waiveNote)

  if (!useDB(isDemo)) {
    const store = getDemoCycles()
    // Mirror the unique (coach_slug, due_date) constraint.
    if (store.some(c => c.coachSlug === input.coachSlug && c.dueDate === input.dueDate)) {
      throw new Error('That coach already has a cycle due on this date.')
    }
    const cycle: RotationCycle = {
      id: `${input.coachSlug}-${input.dueDate}-${store.length}`,
      coachSlug: input.coachSlug,
      cycleStart: input.cycleStart,
      dueDate: input.dueDate,
      waived,
      waiveNote,
    }
    store.push(cycle)
    return cycle
  }

  const { data, error } = await supabase
    .from('content_rotation')
    .insert({
      coach_slug:  input.coachSlug,
      cycle_start: input.cycleStart,
      due_date:    input.dueDate,
      waived,
      waive_note:  waiveNote ?? null,
    })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('That coach already has a cycle due on this date.')
    throw new Error(error.message)
  }
  return rowToCycle(data as Record<string, unknown>)
}

/** Admin: edit an existing cycle (coach, window, or waive state). */
export async function updateCycle(id: string, input: CycleInput, isDemo: boolean): Promise<void> {
  validateCycle(input)
  const waived = input.waived === true
  const waiveNote = cleanNote(waived, input.waiveNote)

  if (!useDB(isDemo)) {
    const store = getDemoCycles()
    if (store.some(c => c.id !== id && c.coachSlug === input.coachSlug && c.dueDate === input.dueDate)) {
      throw new Error('That coach already has a cycle due on this date.')
    }
    const c = store.find(x => x.id === id)
    if (c) {
      c.coachSlug = input.coachSlug
      c.cycleStart = input.cycleStart
      c.dueDate = input.dueDate
      c.waived = waived
      c.waiveNote = waiveNote
    }
    return
  }

  const { error } = await supabase
    .from('content_rotation')
    .update({
      coach_slug:  input.coachSlug,
      cycle_start: input.cycleStart,
      due_date:    input.dueDate,
      waived,
      waive_note:  waiveNote ?? null,
    })
    .eq('id', id)
  if (error) {
    if (error.code === '23505') throw new Error('That coach already has a cycle due on this date.')
    throw new Error(error.message)
  }
}

/** Admin: remove a cycle from the schedule. */
export async function deleteCycle(id: string, isDemo: boolean): Promise<void> {
  if (!useDB(isDemo)) {
    const store = getDemoCycles()
    const idx = store.findIndex(c => c.id === id)
    if (idx >= 0) store.splice(idx, 1)
    return
  }
  const { error } = await supabase.from('content_rotation').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── The rotation plan (migration 046) ────────────────────────────────────────
//
// The plan is a TEMPLATE and the schedule is the RECORD. `rotation_plans` holds
// who is in the rotation, in what order, how often a turn comes round and where
// the counting starts; `content_rotation` holds the assignments that have
// actually been made. Editing the plan changes nothing that already exists —
// generating from it is a separate, explicit act, and it only ever adds.
//
// Everything below throws on refusal, like its neighbours above and unlike the
// WriteResult convention new code in settings.ts follows. One file, one contract:
// RotationPanel already wraps every call here in try/catch and paints a single
// error banner, and half a module answering `{ ok: false }` while the other half
// throws is a worse thing to maintain than a convention that is merely older.

export type RotationUnit = 'day' | 'week' | 'month'

export interface RotationPlan {
  /** Ordered coach slugs. THE ORDER IS THE ROTATION ORDER. */
  members: string[]
  /** How many `everyUnit`s between one turn and the next. 1..365. */
  everyCount: number
  everyUnit: RotationUnit
  /** YYYY-MM-DD — the first due date the generator counts from. */
  anchor: string
}

/**
 * What the plan is before anybody edits it, and what a database with no
 * `rotation_plans` row answers.
 *
 * Built from the constants at the top of this file rather than repeated, so the
 * demo schedule, the 005 seed and the 046 seed cannot drift into three different
 * stories. STAGGER_DAYS is 14, which is `every 2 week` said the other way round.
 */
const PLAN_DEFAULT: RotationPlan = {
  members: [...ROTATION_ORDER],
  everyCount: STAGGER_DAYS / 7,
  everyUnit: 'week',
  anchor: ANCHOR,
}

/** At most this many assignments per generate, whatever the caller asks for. */
const MAX_PLAN_ASSIGNMENTS = 60

const PLAN_MAX_MEMBERS = 50

const clonePlan = (p: RotationPlan): RotationPlan => ({ ...p, members: [...p.members] })

let _demoPlan: RotationPlan | null = null
function getDemoPlan(): RotationPlan {
  if (!_demoPlan) _demoPlan = clonePlan(PLAN_DEFAULT)
  return _demoPlan
}

function rowToPlan(row: Record<string, unknown>): RotationPlan {
  const raw = Array.isArray(row.members) ? row.members : []
  const unit = String(row.every_unit ?? 'week')
  return {
    members: raw.filter((m): m is string => typeof m === 'string' && m.trim() !== '').map(m => m.trim()),
    everyCount: Number(row.every_count) || PLAN_DEFAULT.everyCount,
    everyUnit: unit === 'day' || unit === 'month' ? unit : 'week',
    anchor: String(row.anchor ?? PLAN_DEFAULT.anchor).slice(0, 10),
  }
}

/** A PostgREST error that means "046 has not been applied here yet". */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  return /could not find the table|does not exist/i.test(error.message ?? '')
}

/**
 * The rotation plan. Demo mode keeps one in memory for the session.
 *
 * A MISSING ROW answers the default, and so does a database that has not had 046
 * applied. Both are "nobody has written a plan here", and a panel that refused to
 * draw over either would be broken on every environment that is one migration
 * behind. ANY OTHER read error throws, and that distinction is load-bearing: if
 * a plan exists and could not be read, handing back the founding five would put
 * the wrong list on screen next to a Save button, and the first click would
 * overwrite the real plan with a default nobody chose.
 */
export async function fetchPlan(isDemo: boolean): Promise<RotationPlan> {
  if (!useDB(isDemo)) return clonePlan(getDemoPlan())

  const { data, error } = await supabase
    .from('rotation_plans')
    .select('members,every_count,every_unit,anchor')
    .eq('id', true)
    .maybeSingle()

  if (error) {
    if (isMissingTable(error)) return clonePlan(PLAN_DEFAULT)
    throw new Error(error.message || 'Could not load the rotation plan.')
  }
  if (!data) return clonePlan(PLAN_DEFAULT)
  return rowToPlan(data as Record<string, unknown>)
}

/**
 * SHAPE ONLY, and deliberately so. Whether `seth-burman` is still a coach is a
 * question only the live roster can answer, and RotationPanel asks it before
 * calling this. What is checked here is what the row itself has to satisfy: a
 * non-empty list of well-shaped slugs with nobody in it twice, a cadence inside
 * the range 046's CHECK allows, and a real anchor date.
 *
 * Returns the CLEANED plan (members trimmed) so the caller writes exactly what
 * was validated.
 */
function validatePlan(plan: RotationPlan): RotationPlan {
  const members = (Array.isArray(plan.members) ? plan.members : [])
    .map(m => (typeof m === 'string' ? m.trim() : ''))

  if (members.length === 0) {
    throw new Error('Add at least one coach to the rotation.')
  }
  if (members.length > PLAN_MAX_MEMBERS) {
    throw new Error(`A rotation holds at most ${PLAN_MAX_MEMBERS} coaches.`)
  }
  for (const slug of members) {
    if (!isCoachSlug(slug)) {
      throw new Error('Every coach in the rotation needs a valid address. Remove the blank entry and add them again.')
    }
  }
  // Refused rather than silently deduped: a name in the list twice is somebody's
  // mistake, and quietly dropping half of it would leave the saved order
  // different from the one they were looking at when they pressed Save.
  const seen = new Set<string>()
  for (const slug of members) {
    if (seen.has(slug)) {
      throw new Error(`${slug} is in the rotation twice. Each coach takes one turn per loop.`)
    }
    seen.add(slug)
  }

  const everyCount = Math.floor(Number(plan.everyCount))
  if (!Number.isFinite(everyCount) || everyCount < 1 || everyCount > 365) {
    throw new Error('How often a turn comes round must be a whole number between 1 and 365.')
  }
  if (plan.everyUnit !== 'day' && plan.everyUnit !== 'week' && plan.everyUnit !== 'month') {
    throw new Error('Pick days, weeks or months for how often a turn comes round.')
  }
  if (!isRealDate(plan.anchor)) {
    throw new Error('Enter a valid date for the first turn.')
  }

  return { members, everyCount, everyUnit: plan.everyUnit, anchor: plan.anchor }
}

/** Admin: save the rotation plan. Throws a sentence if it could not be saved. */
export async function savePlan(plan: RotationPlan, isDemo: boolean): Promise<void> {
  const clean = validatePlan(plan)

  if (!useDB(isDemo)) {
    _demoPlan = clonePlan(clean)
    return
  }

  const { error } = await supabase
    .from('rotation_plans')
    .upsert(
      {
        id: true,
        members:     clean.members,
        every_count: clean.everyCount,
        every_unit:  clean.everyUnit,
        anchor:      clean.anchor,
      },
      { onConflict: 'id' },
    )

  if (error) {
    if (isMissingTable(error)) {
      throw new Error('This database does not know about the rotation plan yet. Apply migration 046 and try again.')
    }
    throw new Error(error.message || 'Could not save the rotation plan.')
  }
}

/** One slot the plan produces. Not yet a cycle: nothing has been written. */
export interface PlannedAssignment {
  coachSlug: string
  cycleStart: string
  dueDate: string
}

/**
 * How far from the anchor assignment `i` sits, in the plan's own units.
 *
 * ALWAYS COMPUTED FROM THE ANCHOR, never from the previous result. That is the
 * whole of the clamping story for months. Anchored on 2026-01-31 and stepping a
 * month at a time, cumulative arithmetic would clamp January to February 28 and
 * then step from THAT, giving Mar 28, Apr 28, and a rotation that has quietly
 * lost three days a year. Counting `i` months from the original 31st every time
 * gives Jan 31, Feb 28, Mar 31, Apr 30: each turn clamps only where the calendar
 * forces it, and the day of the month comes straight back afterwards.
 *
 * `i` may be negative, which is how a cycle start is found (a full loop back).
 */
function planOffset(plan: RotationPlan, everyCount: number, i: number): string {
  if (plan.everyUnit === 'month') return addMonthsClamped(plan.anchor, everyCount * i)
  const days = plan.everyUnit === 'week' ? everyCount * 7 : everyCount
  return addDays(plan.anchor, days * i)
}

/**
 * The next `count` assignments the plan produces. PURE: it writes nothing and
 * reads nothing, so the panel can preview with it while the admin is still
 * typing.
 *
 * Round robin. Assignment `i` is due at `anchor + i * step` and falls to
 * `members[i % members.length]`, so the order of the array is the order of the
 * rotation. `cycleStart` is a FULL LOOP before the due date — `step * members`,
 * in the same clamped arithmetic — because that is the window in which the coach
 * writes: it opens the moment their previous turn was due and closes on this
 * one. A five-person rotation stepping fortnightly gives every coach a ten-week
 * window, which is the shape the schedule has always had.
 *
 * Empty members answers []. An anchor that is not a real date answers [] as
 * well, rather than a list of `NaN-NaN-NaN`: the panel's date input is empty
 * for as long as it takes somebody to pick a new one.
 */
export function planAssignments(plan: RotationPlan, count: number): PlannedAssignment[] {
  const members = (plan.members ?? []).filter(m => typeof m === 'string' && m !== '')
  if (members.length === 0) return []
  if (!isRealDate(plan.anchor)) return []

  const wanted = Math.floor(Number(count))
  if (!Number.isFinite(wanted) || wanted <= 0) return []
  const n = Math.min(wanted, MAX_PLAN_ASSIGNMENTS)

  // A row written before 046's CHECK existed, or a caller that skipped savePlan,
  // must not turn into a zero step and an infinite pile of same-day assignments.
  const everyCount = Math.max(1, Math.floor(Number(plan.everyCount)) || 1)
  const loop = members.length

  const out: PlannedAssignment[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      coachSlug:  members[i % loop],
      cycleStart: planOffset(plan, everyCount, i - loop),
      dueDate:    planOffset(plan, everyCount, i),
    })
  }
  return out
}

/**
 * Write a batch of cycles, skipping the ones already on the schedule.
 *
 * One statement, not one per row. `on conflict do nothing` against 005's unique
 * (coach_slug, due_date) is exactly the "skip what exists" rule, and PostgREST
 * returns only the rows it actually inserted, so `created` is counted rather
 * than guessed and `skipped` is the remainder. Sixty round trips would be the
 * alternative, and each one could fail separately.
 *
 * The batch is deduplicated first so demo and live agree on the counts: asking
 * to create the same coach twice in one window is one cycle and one skip in both.
 */
async function insertCycles(
  rows: PlannedAssignment[],
  isDemo: boolean,
): Promise<{ created: number; skipped: number }> {
  const wanted: PlannedAssignment[] = []
  const seen = new Set<string>()
  let skipped = 0

  for (const row of rows) {
    const key = `${row.coachSlug}|${row.dueDate}`
    if (seen.has(key)) { skipped++; continue }
    seen.add(key)
    wanted.push(row)
  }
  if (wanted.length === 0) return { created: 0, skipped }

  if (!useDB(isDemo)) {
    const store = getDemoCycles()
    let created = 0
    for (const row of wanted) {
      if (store.some(c => c.coachSlug === row.coachSlug && c.dueDate === row.dueDate)) { skipped++; continue }
      store.push({
        id: `${row.coachSlug}-${row.dueDate}-${store.length}`,
        coachSlug: row.coachSlug,
        cycleStart: row.cycleStart,
        dueDate: row.dueDate,
        waived: false,
      })
      created++
    }
    return { created, skipped }
  }

  const { data, error } = await supabase
    .from('content_rotation')
    .upsert(
      wanted.map(row => ({
        coach_slug:  row.coachSlug,
        cycle_start: row.cycleStart,
        due_date:    row.dueDate,
      })),
      { onConflict: 'coach_slug,due_date', ignoreDuplicates: true },
    )
    .select('id')

  if (error) throw new Error(error.message || 'Could not add those cycles to the schedule.')

  const created = (data ?? []).length
  return { created, skipped: skipped + (wanted.length - created) }
}

/**
 * Turn the plan into real assignments. Idempotent: a cycle that already exists
 * for that coach on that date is counted as skipped and left exactly as it is,
 * so pressing the button twice costs nothing and re-planning only adds turns.
 */
export async function generateSchedule(
  plan: RotationPlan,
  count: number,
  isDemo: boolean,
): Promise<{ created: number; skipped: number }> {
  const rows = planAssignments(plan, count)
  if (rows.length === 0) return { created: 0, skipped: 0 }
  return insertCycles(rows, isDemo)
}

/**
 * Admin: schedule the same window for several coaches at once — the whole roster
 * owes a post by the end of the quarter, and that is one act rather than eight
 * trips through the form.
 */
export async function createCycles(
  coachSlugs: string[],
  window: { cycleStart: string; dueDate: string },
  isDemo: boolean,
): Promise<{ created: number; skipped: number }> {
  const slugs = (coachSlugs ?? []).map(s => (typeof s === 'string' ? s.trim() : ''))

  if (slugs.length === 0) throw new Error('Pick at least one coach for this cycle.')
  if (slugs.some(s => !isCoachSlug(s))) throw new Error('Pick at least one coach for this cycle.')
  if (!isRealDate(window.cycleStart) || !isRealDate(window.dueDate)) {
    throw new Error('Enter valid start and due dates.')
  }
  if (!(window.dueDate > window.cycleStart)) {
    throw new Error('The due date must come after the cycle start.')
  }

  return insertCycles(
    slugs.map(coachSlug => ({ coachSlug, cycleStart: window.cycleStart, dueDate: window.dueDate })),
    isDemo,
  )
}

/** Admin: remove several cycles. Answers how many rows actually went. */
export async function deleteCycles(ids: string[], isDemo: boolean): Promise<number> {
  const wanted = [...new Set((ids ?? []).filter(id => typeof id === 'string' && id !== ''))]
  if (wanted.length === 0) return 0

  if (!useDB(isDemo)) {
    const store = getDemoCycles()
    let gone = 0
    for (const id of wanted) {
      const idx = store.findIndex(c => c.id === id)
      if (idx >= 0) { store.splice(idx, 1); gone++ }
    }
    return gone
  }

  // `.select('id')` for the reason updateCoachRoutingEmail spells out: an RLS
  // refusal on a DELETE arrives as a successful request that removed nothing, and
  // "Deleted 6 cycles" over a schedule that still has all six is the worst
  // possible answer.
  const { data, error } = await supabase.from('content_rotation').delete().in('id', wanted).select('id')
  if (error) throw new Error(error.message || 'Could not delete those cycles.')
  return (data ?? []).length
}

/** Admin: waive or un-waive several cycles at once, with one shared reason. */
export async function waiveCycles(
  ids: string[],
  waived: boolean,
  note: string | undefined,
  isDemo: boolean,
): Promise<number> {
  const wanted = [...new Set((ids ?? []).filter(id => typeof id === 'string' && id !== ''))]
  if (wanted.length === 0) return 0

  const waiveNote = cleanNote(waived, note)

  if (!useDB(isDemo)) {
    const store = getDemoCycles()
    let touched = 0
    for (const id of wanted) {
      const c = store.find(x => x.id === id)
      if (!c) continue
      c.waived = waived
      c.waiveNote = waived ? waiveNote : undefined
      touched++
    }
    return touched
  }

  const { data, error } = await supabase
    .from('content_rotation')
    .update({ waived, waive_note: waiveNote ?? null })
    .in('id', wanted)
    .select('id')
  if (error) throw new Error(error.message || 'Could not update those cycles.')
  return (data ?? []).length
}

export function formatCycleDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}
