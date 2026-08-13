// Axis Training Systems — slot generation
//
// THE single answer to "is this time bookable", server-side. `booking-availability`
// calls it to decide what to offer; `booking-create` and `booking-manage` call it
// to decide what to accept. One implementation, so the times the browser is shown
// and the times the server will take cannot drift apart.
//
// Mirrored — deliberately, not accidentally — by computeOpenSlots() in
// src/lib/availability.ts, which exists only for demo mode (no Supabase
// configured, nothing to call). Keep the two in step; the browser copy is never
// authoritative for a real booking.
//
// Wall clock in, instants out:
//
//   coach_schedules.start_time / end_time      wall-clock in the coach's zone
//   coach_availability_blocks.block_date/times wall-clock in the coach's zone
//   everything this module returns             absolute instants (epoch ms)
//
// The one conversion happens here, once, with the coach's zone. Never via
// `new Date(...)` + setHours(), which silently uses whichever zone the runtime
// happens to be in.

import {
  addDaysToDateKey,
  dayOfWeekForDateKey,
  minutesToTime,
  timeToMinutes,
  zonedTimeToUtc,
  MINUTE_MS,
} from './tz.ts'

const DAY_MS = 86_400_000

export interface ScheduleWindow {
  day_of_week: number
  start_time: string
  end_time: string
  /**
   * How OFTEN a slot may start — 9:00, 9:30, 10:00 — not how long the booking
   * is. Migration 009 moved the length onto the service; this is the grid the
   * length is laid over. A 45-minute session on a 30-minute grid takes 9:00–9:45
   * and the 9:30 start is simply not offered.
   */
  slot_duration_minutes: number
}

export interface BlockRow {
  block_date: string
  /** Both null = the whole calendar day, in the coach's zone. */
  start_time: string | null
  end_time: string | null
}

/** An occupied stretch, absolute. Existing bookings + cached Google busy time. */
export interface Interval {
  start: number
  end: number
}

export interface SlotInput {
  /** The coach's IANA zone. Every wall-clock row above is read in it. */
  timeZone: string
  schedules: ScheduleWindow[]
  blocks: BlockRow[]
  busy: Interval[]
  /**
   * The service's length. `null` means the coach has no catalog rows yet, and
   * the window's own `slot_duration_minutes` is used as both step and length —
   * exactly the behaviour that predates migration 009, so an unconfigured coach
   * keeps taking bookings rather than going dark on deploy.
   */
  durationMinutes: number | null
  /** Idle held after every booking. Occupies the calendar; never part of a duration. */
  bufferMinutes: number
  /** Notice the coach needs. From coach_public_settings.min_lead_minutes. */
  minLeadMinutes: number
  /** How far out the calendar opens. From coach_public_settings.max_advance_days. */
  maxAdvanceDays: number
  /** Injected so the caller owns "now" and tests stay deterministic. */
  now: Date
}

export interface Slot {
  /** Absolute instant, epoch ms. */
  start: number
  /** start + durationMinutes. Excludes the buffer — that is calendar, not call. */
  end: number
  durationMinutes: number
}

export interface DaySlots {
  dateKey: string
  slots: Slot[]
}

/** The one overlap test in the system. Half-open: touching is not overlapping. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && a.end > b.start
}

/** Blocks resolved to absolute intervals. A row with null times covers the day. */
export function blockIntervals(blocks: BlockRow[], dateKey: string, timeZone: string): Interval[] | 'all-day' {
  const out: Interval[] = []

  for (const b of blocks) {
    if (b.block_date !== dateKey) continue
    if (!b.start_time || !b.end_time) return 'all-day'
    out.push({
      start: zonedTimeToUtc(dateKey, b.start_time, timeZone).getTime(),
      end:   zonedTimeToUtc(dateKey, b.end_time,   timeZone).getTime(),
    })
  }

  return out
}

/**
 * Every open start in [fromDateKey, fromDateKey + days), keyed by the calendar
 * date IN THE COACH'S ZONE.
 *
 * A slot is open when the coach works then, the whole service PLUS its buffer
 * fits inside that working window, and nothing already occupies any part of the
 * span. The buffer is inside the occupancy test and outside the returned `end`:
 * it is time the calendar loses, not time the client is on the call.
 */
export function generateSlots(input: SlotInput, fromDateKey: string, days: number): DaySlots[] {
  const { timeZone, schedules, blocks, busy, bufferMinutes, minLeadMinutes, maxAdvanceDays, now } = input

  const buffer   = Math.max(0, bufferMinutes)
  const earliest = now.getTime() + Math.max(0, minLeadMinutes) * MINUTE_MS
  const latest   = now.getTime() + maxAdvanceDays * DAY_MS

  const result: DaySlots[] = []

  for (let d = 0; d < days; d++) {
    const dateKey = addDaysToDateKey(fromDateKey, d)
    const dow     = dayOfWeekForDateKey(dateKey)

    const windows = schedules.filter(s => s.day_of_week === dow)
    if (windows.length === 0) {
      result.push({ dateKey, slots: [] })
      continue
    }

    const dayBlocks = blockIntervals(blocks, dateKey, timeZone)
    if (dayBlocks === 'all-day') {
      result.push({ dateKey, slots: [] })
      continue
    }

    const found = new Map<number, Slot>()

    for (const window of windows) {
      const openMin  = timeToMinutes(window.start_time)
      const closeMin = timeToMinutes(window.end_time)

      // The grid, and the length laid over it. A window with a nonsense step
      // would loop forever, so the step has a floor whatever the row says.
      const step   = Math.max(5, window.slot_duration_minutes)
      const length = input.durationMinutes ?? window.slot_duration_minutes
      if (!(length > 0)) continue

      const span = length + buffer

      // `m + span <= closeMin`: the last start that still lets the call AND the
      // idle after it finish before the coach's window closes.
      for (let m = openMin; m + span <= closeMin; m += step) {
        const start   = zonedTimeToUtc(dateKey, minutesToTime(m), timeZone)
        const startMs = start.getTime()
        const endMs   = startMs + length * MINUTE_MS

        if (startMs < earliest || startMs > latest) continue

        // Occupancy is tested against the span, not the call: with a buffer set,
        // a booking that ends at 10:00 keeps 10:00 off the market too.
        const occupied: Interval = { start: startMs, end: startMs + span * MINUTE_MS }
        if (dayBlocks.some(b => overlaps(occupied, b))) continue
        if (busy.some(b => overlaps(occupied, b))) continue

        // Overlapping windows can emit the same start twice.
        if (!found.has(startMs)) {
          found.set(startMs, { start: startMs, end: endMs, durationMinutes: length })
        }
      }
    }

    result.push({
      dateKey,
      slots: [...found.values()].sort((a, b) => a.start - b.start),
    })
  }

  return result
}

/**
 * Is `requestedMs` genuinely one of the starts this coach is offering?
 *
 * The authoritative check. An exact instant match against regenerated
 * availability — never a range test on bounds the caller supplied, which would
 * accept 9:07 on a 9:00 grid and any duration the request cared to name.
 *
 * A day either side of the requested date is regenerated as well: a slot at
 * 23:30 local can belong to the previous day's window as far as UTC is
 * concerned, and the caller derived `dateKey` from the instant, not the window.
 */
export function isSlotOffered(input: SlotInput, requestedMs: number, dateKey: string): Slot | null {
  const days = generateSlots(input, addDaysToDateKey(dateKey, -1), 3)
  for (const day of days) {
    const hit = day.slots.find(s => s.start === requestedMs)
    if (hit) return hit
  }
  return null
}
