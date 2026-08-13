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
  if (!useDB(isDemo)) return generateCycles()

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
  if (!useDB(isDemo)) return
  const { error } = await supabase
    .from('content_rotation')
    .update({ waived, waive_note: note ?? null })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export function formatCycleDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}
