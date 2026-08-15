import { supabase, supabaseConfigured } from './supabase.ts'
import type { WriteResult } from '../types/messaging.ts'

/**
 * Training blocks: what an athlete is working on, and what they were working on
 * before that.
 *
 * A BLOCK IS A ROW AND A PHASE CHANGE IS A NEW ROW. Migration 044 has no path
 * that rewrites the phase of a block that already exists, and neither does this
 * module: `startTrainingBlock` closes the open block and opens the next one,
 * `editTrainingBlock` touches the label and the notes and nothing else. That is
 * the whole design. A phase kept in one editable column answers "what now" and
 * destroys "what then", and "what then" is the question a coach actually cannot
 * answer today.
 *
 * WRITES GO THROUGH RPCs. `training_blocks` carries a SELECT policy and a SELECT
 * grant and nothing else at all, so every write below is a definer function.
 * That buys the sentences: the refusal for a coach reaching an athlete who is
 * not theirs arrives as `42501` with our own text on it, where a direct insert
 * would arrive as "new row violates row-level security policy". Both codes are
 * passed through verbatim by `writeMessage` for exactly that reason.
 *
 * WHO MAY WRITE, restated here because a screen has to decide what to render
 * before it round-trips: an admin, a holder of `manage_staff`, or a coach the
 * athlete is assigned to. The third tier is the point. Programming is a coach's
 * daily job and `manage_staff` is the sensitive key only an admin hands out, so
 * a feature that needed it would send every coach back to the whiteboard. The
 * server decides through `can_manage_training`; anything a screen does with this
 * paragraph is signage.
 *
 * Nothing here throws. Reads answer `null` for an outage and `[]` for genuinely
 * empty, because a board says something different for each. Writes answer a
 * `WriteResult`. Every function routes on `offline(isDemo)` first, so the whole
 * surface works with no credentials at all.
 *
 * IMPORT NOTE. `tests/training.test.ts` loads this module under `node --test`,
 * whose ESM resolver does not guess file extensions, so every runtime import
 * above names a `.ts` file.
 */

// ---------------------------------------------------------------------------
// The contract with migration 044
// ---------------------------------------------------------------------------

/**
 * The seven phases, spelled exactly as `training_blocks_phase_known` spells
 * them. A string that is not one of these is refused by the RPC with a sentence
 * naming all seven, so the type is the first line of that defence rather than
 * the only one.
 */
export type TrainingPhase =
  | 'development'
  | 'transition'
  | 'prep'
  | 'competition'
  | 'recovery'
  | 'injury'
  | 'off'

/**
 * The phases in the order a coach thinks about them, with the colour each chip
 * is drawn in.
 *
 * ORDER IS PROGRESSION, not the alphabet: build, carry it over, sharpen,
 * compete, come down, and then the two states that are not a plan at all. A
 * picker in this order reads as the year; in alphabetical order it reads as a
 * database.
 *
 * The colours are deliberately not the app's accent. Competition is the danger
 * red already in use for armed actions, because a competition block is the one
 * everything else is scheduled around; injury is a pink that is impossible to
 * mistake for it at a glance; off is the only grey, because "no plan" should
 * recede on a board where every other card is coloured. Nothing here is derived
 * from a scale, so a screen must render these values rather than compute its own.
 */
export const PHASES: Array<{ key: TrainingPhase; label: string; color: string }> = [
  { key: 'development', label: 'Development', color: '#3987e5' },
  { key: 'transition', label: 'Transition', color: '#9085e9' },
  { key: 'prep', label: 'Prep', color: '#c98500' },
  { key: 'competition', label: 'Competition', color: '#c8102e' },
  { key: 'recovery', label: 'Recovery', color: '#199e70' },
  { key: 'injury', label: 'Injury', color: '#d55181' },
  { key: 'off', label: 'Off', color: '#898781' },
]

/** Phase key to its row, for a chip that has an id and needs a label and a colour. */
const PHASE_BY_KEY = new Map(PHASES.map(p => [p.key, p]))

/** The label and colour for a phase, falling back to a readable grey chip. */
export function phaseMeta(phase: string): { key: TrainingPhase; label: string; color: string } {
  return PHASE_BY_KEY.get(phase as TrainingPhase) ?? { key: 'off', label: phase || 'Unknown', color: '#898781' }
}

/**
 * One block.
 *
 * `starts_on` and `ends_on` are dates and not timestamps, so they arrive as
 * 'YYYY-MM-DD' strings and are compared as such. `ends_on === null` is the whole
 * of the open state; there is no separate flag, in the client or in the column.
 *
 * `created_by` and `updated_at` exist on the row and are deliberately not
 * selected. Nothing on the board renders them, and a projection that grows to
 * match the table is a projection nobody prunes.
 */
export interface TrainingBlock {
  id: string
  athlete_id: string
  phase: TrainingPhase
  label: string | null
  notes: string | null
  starts_on: string
  ends_on: string | null
  created_at: string
}

// Single string literal, never `.join(',')`: postgrest-js parses the select
// string at the type level and a computed one erases to `string`.
export const TRAINING_BLOCK_COLUMNS =
  'id,athlete_id,phase,label,notes,starts_on,ends_on,created_at'

/** `training_blocks_label_len`. */
export const BLOCK_LABEL_LIMIT = 120

/** `training_blocks_notes_len`. */
export const BLOCK_NOTES_LIMIT = 2000

/**
 * The whole board, in one read. Every athlete's history, not just the open
 * blocks, because the card wants the current phase and the athlete's own page
 * wants the rest, and two thousand rows is years of programming at this
 * studio's roster size.
 */
const BLOCK_LIST_LIMIT = 2000

/**
 * Demo mode and "no credentials configured" are the same situation from a
 * screen's point of view: there is nothing to talk to, and the screen must still
 * render. Every function below routes on this, never on `isDemo` alone.
 */
const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

// ---------------------------------------------------------------------------
// Failure, in sentences
// ---------------------------------------------------------------------------

/**
 * What a PostgREST error becomes on screen.
 *
 * `P0001`, `22023` and `42501` are `raise exception`s from 044, and that file
 * writes them as sentences aimed at a person. They are passed through verbatim:
 * nothing this function could invent beats "Only an admin, a coach with Manage
 * staff, or one of this athlete's own coaches can change their training block."
 *
 * Note the `42501` branch reads the message first. A gate refusal from our own
 * function carries text; a bare grant refusal ("permission denied for function")
 * carries the plumbing message instead, and that one gets translated.
 */
function writeMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  const code = error.code ?? ''
  const msg = (error.message ?? '').replace(/^ERROR:\s*/i, '').trim()

  if ((code === 'P0001' || code === '22023') && msg) return msg
  if (code === '42501' && msg && !/permission denied for (function|table)/i.test(msg)) return msg
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'The database refused that change. Your account may not have permission any more. Sign out, sign back in, and try again.'
  }
  // 044 catches this inside `start_training_block` and re-raises it as a
  // sentence, so reaching here means a direct write somebody added later.
  if (code === '23505') {
    return 'This athlete already has an open block. Refresh the roster and try again.'
  }
  if (code === '23514') {
    return `That does not fit. A block name caps at ${BLOCK_LABEL_LIMIT} characters and notes at ${BLOCK_NOTES_LIMIT}.`
  }
  if (code === '23503') return 'That athlete is no longer on the roster. Refresh the screen and try again.'
  if (code === 'PGRST301' || /jwt|token is expired/i.test(msg)) {
    return 'Your session expired. Sign in again and the change will go through.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection. Nothing was changed.'
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * A block name: one line, no control characters, capped at the column's limit.
 *
 * The empty string comes back as null, because the column is nullable and a
 * block with a name of "" is a block whose card renders an empty line under the
 * chip. The RPC does the same `nullif(btrim(...), '')` server-side; this is so
 * the screen does not have to round-trip to find out that two spaces is nothing.
 */
export function cleanBlockLabel(raw: string | null | undefined): string | null {
  const clean = (raw ?? '')
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, BLOCK_LABEL_LIMIT)
    .trimEnd()
  return clean === '' ? null : clean
}

/**
 * The coach's note. Paragraphs survive, because this is where the intent of a
 * block gets written down and a note squashed onto one line is a note nobody
 * reads back.
 *
 * Newlines are normalized (a paste from a PDF arrives as `\r\n` or a bare `\r`,
 * and the second renders as nothing at all), control characters other than tab
 * and newline are stripped, and the result is capped here rather than bouncing
 * off `training_blocks_notes_len`.
 */
export function cleanBlockNotes(raw: string | null | undefined): string | null {
  const clean = (raw ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, BLOCK_NOTES_LIMIT)
    .trimEnd()
  return clean === '' ? null : clean
}

/**
 * Athlete id to their open block.
 *
 * The database allows exactly one open block per athlete (a partial unique index
 * on `athlete_id where ends_on is null`), so in practice the last-wins loop
 * below never has to choose. It chooses anyway, and it chooses the one that
 * started most recently, because the one place two open rows can coexist is a
 * client holding a stale list next to a fresh one, and a board that picks the
 * older block would show a phase the coach has already moved on from.
 *
 * Pure, and the reason this is a function rather than a `.find()` at the call
 * site: the board asks it once for every card it draws.
 */
export function currentBlocks(blocks: TrainingBlock[]): Map<string, TrainingBlock> {
  const open = new Map<string, TrainingBlock>()

  for (const block of blocks) {
    if (block.ends_on !== null) continue
    const held = open.get(block.athlete_id)
    if (!held || block.starts_on > held.starts_on) open.set(block.athlete_id, block)
  }

  return open
}

/**
 * Whole days in this phase, counting the day it started as day one.
 *
 * So a block started today reads 1 and a block started yesterday reads 2, which
 * is how a coach counts it out loud ("day 12 of prep") and never 0, which is
 * what an elapsed-time subtraction would print on the morning somebody starts a
 * block. A closed block counts through its last day inclusive, so a block opened
 * and closed the same day is one day rather than none.
 *
 * BOTH SIDES ARE CALENDAR DATES AND NEITHER IS A CLOCK. `starts_on` is a date
 * column with no zone attached; `now` is a moment in the viewer's zone. Comparing
 * them by parsing the first as UTC midnight and subtracting a local timestamp is
 * off by one all afternoon in California, which is where this studio is. So the
 * local calendar date of `now` is rebuilt as a UTC instant and the two are
 * compared as dates, which also makes the arithmetic immune to the hour that
 * daylight saving adds and removes.
 *
 * An unparseable date answers 1: the block exists, so it has been running for at
 * least the day somebody made it, and a NaN on a chip helps nobody.
 */
export function daysInPhase(block: TrainingBlock, now: Date = new Date()): number {
  const start = dateToUtc(block.starts_on)
  if (start === null) return 1

  const end =
    dateToUtc(block.ends_on) ?? Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())

  const days = Math.floor((end - start) / 86_400_000) + 1
  return days < 1 ? 1 : days
}

/** 'YYYY-MM-DD' as a UTC instant, or null for anything that is not one. */
function dateToUtc(value: string | null): number | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(stamp) ? null : stamp
}

/**
 * One athlete's history, newest block first.
 *
 * Pure, and it sorts rather than trusting the caller's order, because the board
 * fetch and any future athlete-facing page arrive at this list from different
 * queries and a history that reorders between screens looks like a bug.
 */
export function blocksForAthlete(blocks: TrainingBlock[], athleteId: string): TrainingBlock[] {
  return blocks
    .filter(block => block.athlete_id === athleteId)
    .sort((a, b) => (a.starts_on === b.starts_on
      ? b.created_at.localeCompare(a.created_at)
      : b.starts_on.localeCompare(a.starts_on)))
}

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

/**
 * A date this many days ago, as the 'YYYY-MM-DD' the column would hold.
 *
 * Built from the LOCAL calendar day for the same reason `daysInPhase` reads one:
 * a demo block seeded as "34 days ago" has to still read 35 days in phase at
 * four in the afternoon in California.
 */
function demoDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  const month = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

const demoIso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()

/**
 * Three athletes in three phases, plus one closed block behind the first of
 * them.
 *
 * The ids are `userManagement`'s demo roster, so a walk-through that crosses the
 * roster board and the People panel sees the same people. The closed block is
 * the part worth seeding: without it the demo shows a board and hides the reason
 * the table exists, which is that the phase before this one is still on record.
 */
function seedDemo(): TrainingBlock[] {
  return [
    {
      id: 'demo-block-1',
      athlete_id: 'demo-devin',
      phase: 'competition',
      label: 'Meet week',
      notes: 'Openers on Thursday, then travel. Nothing heavy after Tuesday.',
      starts_on: demoDate(9),
      ends_on: null,
      created_at: demoIso(9),
    },
    {
      id: 'demo-block-2',
      athlete_id: 'demo-marcus',
      phase: 'development',
      label: 'Base build',
      notes: 'Volume up, singles out. Reassess in four weeks.',
      starts_on: demoDate(34),
      ends_on: null,
      created_at: demoIso(34),
    },
    {
      id: 'demo-block-3',
      athlete_id: 'demo-bianca',
      phase: 'injury',
      label: 'Right wrist',
      notes: 'Cleared for lower body only until the follow-up on the 22nd.',
      starts_on: demoDate(3),
      ends_on: null,
      created_at: demoIso(3),
    },
    {
      id: 'demo-block-4',
      athlete_id: 'demo-devin',
      phase: 'prep',
      label: 'Spring meet prep',
      notes: 'Eight weeks out. Squat and bench priority, deadlift maintained.',
      starts_on: demoDate(65),
      ends_on: demoDate(10),
      created_at: demoIso(65),
    },
  ]
}

// Seeded on first access and mutated in place, so a demo walk-through survives a
// tab change. Resets on reload, which is the promise the demo banner makes.
let demo: TrainingBlock[] | null = null

function demoStore(): TrainingBlock[] {
  if (!demo) demo = seedDemo()
  return demo
}

/** Demo writes are instant; a beat of latency keeps the saving states honest. */
const beat = () => new Promise<void>(r => setTimeout(r, 220))

const demoId = () => `demo-block-${Math.random().toString(36).slice(2, 10)}`

/** What 044's close-then-insert does, done locally. */
function demoCloseOpen(athleteId: string): boolean {
  let closed = false
  for (const block of demoStore()) {
    if (block.athlete_id === athleteId && block.ends_on === null) {
      const today = demoDate(0)
      block.ends_on = block.starts_on > today ? block.starts_on : today
      closed = true
    }
  }
  return closed
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Every block a staff screen may see, newest first.
 *
 * RLS narrows this by itself and this module does not restate it: staff see the
 * whole board, an athlete sees their own history and nobody else's. So the same
 * call feeds the roster and an athlete's own page, and the second one cannot
 * accidentally be handed somebody else's rows by a missing filter here.
 *
 * Ordered by `starts_on` and then by `created_at`, both descending. The second
 * key is what keeps two blocks started on one day (a phase set and immediately
 * corrected) in a stable order, which `blocksForAthlete` then preserves.
 *
 * `null` is an outage. A board that draws every card with no chip because a
 * query failed is a board that says every athlete is between blocks, which is a
 * lie the screen has no way to notice.
 */
export async function fetchTrainingBlocks(isDemo = false): Promise<TrainingBlock[] | null> {
  if (offline(isDemo)) {
    return demoStore()
      .map(b => ({ ...b }))
      .sort((a, b) => (a.starts_on === b.starts_on
        ? b.created_at.localeCompare(a.created_at)
        : b.starts_on.localeCompare(a.starts_on)))
  }

  const { data, error } = await supabase
    .from('training_blocks')
    .select(TRAINING_BLOCK_COLUMNS)
    .order('starts_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(BLOCK_LIST_LIMIT)

  if (error) return null
  return (data ?? []) as unknown as TrainingBlock[]
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Move an athlete into a phase.
 *
 * One call, two writes, one transaction: 044 closes the open block and inserts
 * the new one. Doing that from here as two round trips would leave an athlete
 * with no block at all when the second one failed, and a card with no chip and
 * no explanation.
 *
 * The screen that calls this owes the person the sentence that starting a block
 * closes the current one. It is not a confirmation the server can ask for.
 */
export async function startTrainingBlock(
  athleteId: string,
  phase: TrainingPhase,
  label: string | null = null,
  notes: string | null = null,
  isDemo = false,
): Promise<WriteResult> {
  if (!PHASE_BY_KEY.has(phase)) return { ok: false, message: 'Pick a phase for this block.' }

  const cleanLabel = cleanBlockLabel(label)
  const cleanNotes = cleanBlockNotes(notes)

  if (offline(isDemo)) {
    await beat()
    demoCloseOpen(athleteId)
    demoStore().push({
      id: demoId(),
      athlete_id: athleteId,
      phase,
      label: cleanLabel,
      notes: cleanNotes,
      starts_on: demoDate(0),
      ends_on: null,
      created_at: new Date().toISOString(),
    })
    return { ok: true }
  }

  const { error } = await supabase.rpc('start_training_block', {
    p_athlete: athleteId,
    p_phase: phase,
    p_label: cleanLabel,
    p_notes: cleanNotes,
  })

  if (error) return { ok: false, message: writeMessage(error, 'Could not start that training block.') }
  return { ok: true }
}

/**
 * Close the open block and leave the athlete between blocks.
 *
 * A real state and not a gap: an athlete who has finished a block and has not
 * been given the next one draws no chip, which is honest. The RPC refuses with a
 * sentence when there is nothing open, and that refusal is worth showing rather
 * than swallowing: reaching it means the screen was stale.
 */
export async function endTrainingBlock(athleteId: string, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) {
    await beat()
    if (!demoCloseOpen(athleteId)) {
      return { ok: false, message: 'This athlete has no open training block.' }
    }
    return { ok: true }
  }

  const { error } = await supabase.rpc('end_training_block', { p_athlete: athleteId })
  if (error) return { ok: false, message: writeMessage(error, 'Could not end that training block.') }
  return { ok: true }
}

/**
 * Correct the label and the notes on a block, open or closed.
 *
 * THE PHASE IS NOT AN ARGUMENT, here or in the RPC. A block records that an
 * athlete spent those weeks doing that kind of work, and editing the phase
 * afterwards does not change what they did, it changes what the record says they
 * did. Moving somebody to a different phase is `startTrainingBlock`, which
 * closes this block and opens the next one today.
 *
 * Both fields are written every time, so passing null clears one. The editor
 * that calls this has both on screen already.
 */
export async function editTrainingBlock(
  blockId: string,
  label: string | null,
  notes: string | null,
  isDemo = false,
): Promise<WriteResult> {
  const cleanLabel = cleanBlockLabel(label)
  const cleanNotes = cleanBlockNotes(notes)

  if (offline(isDemo)) {
    await beat()
    const block = demoStore().find(b => b.id === blockId)
    if (!block) return { ok: false, message: 'That training block no longer exists.' }
    block.label = cleanLabel
    block.notes = cleanNotes
    return { ok: true }
  }

  const { error } = await supabase.rpc('edit_training_block', {
    p_block: blockId,
    p_label: cleanLabel,
    p_notes: cleanNotes,
  })

  if (error) return { ok: false, message: writeMessage(error, 'Could not save that training block.') }
  return { ok: true }
}
