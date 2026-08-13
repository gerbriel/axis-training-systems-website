import { supabase, supabaseConfigured } from './supabase'
import { demoGetSchedules, demoGetBlocks } from './demoAvailabilityStore'
import {
  addDaysToDateKey,
  dateKeyInTimeZone,
  dayOfWeekOfDateKey,
  formatDateInTimeZone,
  formatTimeInTimeZone,
  browserTimeZone,
  isValidTimeZone,
  minutesToTime,
  timeToMinutes,
  timeZoneAbbreviation,
  zonedDateTimeToUtc,
} from './tz'
import type { CoachSchedule, CoachAvailabilityBlock } from '../types/database'

export interface TimeSlot {
  start: Date
  end: Date
  durationMinutes: number
}

/** One calendar day in the COACH's zone, and what is open on it. */
export interface DaySlots {
  dateKey: string
  slots: TimeSlot[]
}

/**
 * Why there are no slots.
 *
 * `outage` is the one that matters and the one the old code could not express:
 * it means we do not KNOW what is open, as distinct from knowing that nothing
 * is. Rendering an empty calendar for an outage tells the visitor their coach
 * is fully booked for ten weeks, which is a fact we made up.
 */
export type AvailabilityFailure = 'outage' | 'unknown_coach' | 'rate_limited'

export type AvailabilityResult =
  | { ok: true; timeZone: string; days: DaySlots[]; durationMinutes: number | null }
  | { ok: false; reason: AvailabilityFailure }

/** Used when a coach has no coach_public_settings row. Axis is a California gym. */
export const DEFAULT_TIME_ZONE = 'America/Los_Angeles'

/** Half-open interval overlap on absolute instants. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart
}

function coerceTimeZone(tz: string | null | undefined): string {
  if (tz && isValidTimeZone(tz)) return tz
  return DEFAULT_TIME_ZONE
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export interface FetchSlotsOptions {
  coachSlug: string
  /** null = the coach has no catalog rows; the schedule window's own length is used. */
  serviceId: string | null
  /** 'YYYY-MM-DD' in the coach's zone. Omitted = the coach's today. */
  fromDateKey?: string
  days: number
}

/**
 * Open slots for a coach, from the server.
 *
 * The arithmetic used to happen here, in the browser, which meant the page had
 * to download the coach's whole schedule, their date blocks, and every busy
 * interval on their calendar for the next ten weeks — over the anon key, which
 * ships in the bundle. `booking-availability` does the computation now and
 * returns only the times that are open.
 *
 * It also closes the last gap between what the page offers and what the server
 * will take: booking-create re-derives through the same module this endpoint
 * uses, so "that slot is not available" can no longer greet someone who clicked
 * a slot the page itself drew.
 *
 * Never throws. Every failure is a value the caller has to handle, because the
 * caller is a component that must show something.
 */
export async function fetchOpenSlots(opts: FetchSlotsOptions): Promise<AvailabilityResult> {
  if (!supabaseConfigured) return demoSlots(opts)

  try {
    const { data, error } = await supabase.functions.invoke('booking-availability', {
      body: {
        coach_slug: opts.coachSlug,
        service_id: opts.serviceId,
        from:       opts.fromDateKey,
        days:       opts.days,
      },
    })

    if (error) {
      // supabase-js does not parse a non-2xx body, so the short code has to be
      // read off the attached Response.
      const context = (error as { context?: Response }).context
      if (context && typeof context.json === 'function') {
        try {
          const payload = (await context.json()) as { error?: string }
          if (payload?.error === 'unknown_coach')  return { ok: false, reason: 'unknown_coach' }
          if (payload?.error === 'rate_limited')   return { ok: false, reason: 'rate_limited' }
        } catch {
          // Non-JSON body. Falls through to outage, which is the honest answer.
        }
      }
      return { ok: false, reason: 'outage' }
    }

    const payload = data as {
      time_zone?: string
      duration_minutes?: number | null
      days?: { date: string; slots: { start: string; duration: number }[] }[]
    } | null

    if (!payload?.days) return { ok: false, reason: 'outage' }

    const timeZone = coerceTimeZone(payload.time_zone)

    return {
      ok: true,
      timeZone,
      durationMinutes: payload.duration_minutes ?? null,
      days: payload.days.map(d => ({
        dateKey: d.date,
        slots: d.slots.map(s => {
          const start = new Date(s.start)
          return {
            start,
            end: new Date(start.getTime() + s.duration * 60_000),
            durationMinutes: s.duration,
          }
        }),
      })),
    }
  } catch {
    // A network failure must land as the outage panel, not escape as an
    // unhandled rejection that leaves a spinner on screen for ever. That is
    // exactly what this page used to do.
    return { ok: false, reason: 'outage' }
  }
}

/** Flatten to the shape a month grid wants: dateKey -> slots, empty days omitted. */
export function slotsByDate(days: DaySlots[]): Map<string, TimeSlot[]> {
  const map = new Map<string, TimeSlot[]>()
  for (const d of days) if (d.slots.length > 0) map.set(d.dateKey, d.slots)
  return map
}

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

export type ScheduleWindow = Pick<
  CoachSchedule,
  'day_of_week' | 'start_time' | 'end_time' | 'slot_duration_minutes'
>

export type AvailabilityBlock = Pick<
  CoachAvailabilityBlock,
  'block_date' | 'start_time' | 'end_time'
>

export interface ComputeInput {
  timeZone: string
  schedules: ScheduleWindow[]
  blocks: AvailabilityBlock[]
  busy: { start: number; end: number }[]
  /** null = use each window's own slot_duration_minutes. */
  durationMinutes: number | null
  bufferMinutes: number
  minLeadMinutes: number
  maxAdvanceDays: number
  now: Date
}

/** Demo default, matching coach_public_settings.min_lead_minutes. */
export const DEMO_MIN_LEAD_MINUTES = 120

/**
 * The slot algorithm, in the browser.
 *
 * THIS IS NOT AUTHORITATIVE and is not used for a real booking. It exists so
 * the demo portal (no Supabase configured, no edge functions to call) draws a
 * working calendar from the in-memory store. It mirrors
 * supabase/functions/_shared/slots.ts; keep the two in step.
 */
export function computeOpenSlots(input: ComputeInput, fromDateKey: string, days: number): DaySlots[] {
  const tz       = coerceTimeZone(input.timeZone)
  const buffer   = Math.max(0, input.bufferMinutes)
  const earliest = input.now.getTime() + Math.max(0, input.minLeadMinutes) * 60_000
  const latest   = input.now.getTime() + input.maxAdvanceDays * 86_400_000

  const result: DaySlots[] = []

  for (let d = 0; d < days; d++) {
    const dateKey = addDaysToDateKey(fromDateKey, d)
    const dow     = dayOfWeekOfDateKey(dateKey)

    const windows = input.schedules.filter(s => s.day_of_week === dow)
    if (windows.length === 0) { result.push({ dateKey, slots: [] }); continue }

    const dayBlocks = input.blocks.filter(b => b.block_date === dateKey)
    if (dayBlocks.some(b => !b.start_time || !b.end_time)) { result.push({ dateKey, slots: [] }); continue }

    // A block is wall-clock in the coach's zone too. 'forward' rather than
    // 'reject': a block landing in a DST gap should still block, not vanish.
    const blockIntervals: { start: number; end: number }[] = []
    for (const b of dayBlocks) {
      const bs = zonedDateTimeToUtc(dateKey, b.start_time!, tz, { nonexistent: 'forward' })
      const be = zonedDateTimeToUtc(dateKey, b.end_time!,   tz, { nonexistent: 'forward' })
      if (bs && be) blockIntervals.push({ start: bs.getTime(), end: be.getTime() })
    }

    const found = new Map<number, TimeSlot>()

    for (const window of windows) {
      const startMin = timeToMinutes(window.start_time)
      const endMin   = timeToMinutes(window.end_time)
      const step     = Math.max(5, window.slot_duration_minutes)
      const length   = input.durationMinutes ?? window.slot_duration_minutes
      if (!(length > 0) || endMin <= startMin) continue

      const span = length + buffer

      for (let m = startMin; m + span <= endMin; m += step) {
        const startInstant = zonedDateTimeToUtc(dateKey, minutesToTime(m), tz, { nonexistent: 'reject' })
        // Nonexistent wall time (spring forward) — a slot nobody can attend.
        if (!startInstant) continue

        const startMs = startInstant.getTime()
        if (startMs < earliest || startMs > latest) continue

        const occupiedEnd = startMs + span * 60_000
        if (blockIntervals.some(b => overlaps(startMs, occupiedEnd, b.start, b.end))) continue
        if (input.busy.some(b => overlaps(startMs, occupiedEnd, b.start, b.end))) continue

        if (!found.has(startMs)) {
          found.set(startMs, {
            start: new Date(startMs),
            end: new Date(startMs + length * 60_000),
            durationMinutes: length,
          })
        }
      }
    }

    result.push({
      dateKey,
      slots: [...found.values()].sort((a, b) => a.start.getTime() - b.start.getTime()),
    })
  }

  return result
}

function demoSlots(opts: FetchSlotsOptions): AvailabilityResult {
  const now      = new Date()
  const timeZone = browserTimeZone()
  const from     = opts.fromDateKey ?? dateKeyInTimeZone(now, timeZone)

  // The demo store has no catalog, so the window's own length is used — which
  // is exactly the fallback a real coach with no services configured gets.
  const days = computeOpenSlots(
    {
      timeZone,
      schedules: demoGetSchedules(opts.coachSlug),
      blocks: demoGetBlocks(opts.coachSlug),
      busy: [],
      durationMinutes: null,
      bufferMinutes: 0,
      minLeadMinutes: DEMO_MIN_LEAD_MINUTES,
      maxAdvanceDays: 365,
      now,
    },
    from,
    opts.days
  )

  return { ok: true, timeZone, days, durationMinutes: null }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function fmtTimeInZone(d: Date, timeZone: string): string {
  return formatTimeInTimeZone(d, coerceTimeZone(timeZone))
}

export function fmtDateInZone(d: Date, timeZone: string): string {
  return formatDateInTimeZone(d, coerceTimeZone(timeZone))
}

/** 'PDT', 'GMT+1' — always render this next to a bare time. */
export function tzLabel(d: Date, timeZone: string): string {
  return timeZoneAbbreviation(d, coerceTimeZone(timeZone))
}

/** '45 min', '1 hr', '1 hr 30 min'. */
export function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest  = minutes % 60
  const h     = `${hours} hr`
  return rest === 0 ? h : `${h} ${rest} min`
}

/** Integer cents, never a float. `null` is a real value — most Axis coaching has no price yet. */
export function fmtMoney(cents: number | null): string | null {
  if (cents === null || cents === undefined) return null
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
}

export { browserTimeZone }
