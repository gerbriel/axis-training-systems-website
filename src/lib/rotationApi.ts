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
 */

import { supabase, supabaseConfigured } from './supabase'
import { sanitizeText } from '../utils/sanitize'
import { COACHES } from '../data/coaches'
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
    console.error('[rotation] could not load schedule:', error.message)
    return generateCycles()
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

/** Throws a human-readable error if the input could not become a valid row. */
function validateCycle(input: CycleInput): void {
  if (!COACHES.some(c => c.slug === input.coachSlug)) {
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

export function formatCycleDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}
