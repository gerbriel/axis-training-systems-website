// Axis Training Systems — DST-safe IANA timezone helpers.
//
// Dependency-free standard TypeScript: no Deno globals, no npm imports. This
// file is imported by BOTH the edge functions and the browser bundle.
//
// Contract (spec §8.6): coach_schedules.start_time / coach_availability_blocks
// .start_time / .block_date are WALL-CLOCK in the coach's IANA zone. Everything
// else — anything stored, compared, or sent to Google — is an absolute instant.
// No setHours, no setDate, no toISOString().split('T')[0] anywhere.

export const MINUTE_MS = 60_000
export const DAY_MS = 86_400_000

const partsCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year:   'numeric',
      month:  '2-digit',
      day:    '2-digit',
      hour:   '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsCache.set(timeZone, f)
  }
  return f
}

export interface ZonedParts {
  year:   number
  month:  number // 1-12
  day:    number // 1-31
  hour:   number // 0-23
  minute: number
  second: number
}

/** Wall-clock fields of an instant, as observed in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant)
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  // en-US hour12:false renders midnight as '24' in some ICU versions
  const hour = get('hour') % 24
  return {
    year:   get('year'),
    month:  get('month'),
    day:    get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  }
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (east of UTC is positive). */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** 'YYYY-MM-DD' for an instant as observed in `timeZone`. Replaces toISOString().split('T')[0]. */
export function dateKeyInTimeZone(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone)
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`
}

/** 0 = Sunday … 6 = Saturday, as observed in `timeZone`. Matches coach_schedules.day_of_week. */
export function dayOfWeekInTimeZone(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  // Date.UTC of the zone's wall-clock fields has the same weekday as the wall clock.
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
}

/**
 * Wall clock in `timeZone` -> absolute instant. The DST-safe equivalent of
 * date-fns-tz's zonedTimeToUtc, with zero dependencies.
 *
 * `dateKey` is 'YYYY-MM-DD'; `time` is 'HH:MM' or 'HH:MM:SS' (Postgres TIME).
 *
 * Guess with the offset at the naive instant, then re-resolve with the offset
 * actually in force at the guessed instant. On a DST boundary the two disagree:
 *   • spring-forward gap (the wall time never happens) -> resolves FORWARD, the
 *     same choice Google Calendar makes;
 *   • fall-back overlap (it happens twice) -> resolves to the FIRST occurrence.
 */
export function zonedTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  const [y, mo, d] = dateKey.split('-').map(Number)
  const [h, mi, s] = timeToParts(time)
  const naive = Date.UTC(y, mo - 1, d, h, mi, s)

  const o1 = timeZoneOffsetMs(new Date(naive), timeZone)
  const o2 = timeZoneOffsetMs(new Date(naive - o1), timeZone)
  if (o1 === o2) return new Date(naive - o1)

  const o3 = timeZoneOffsetMs(new Date(naive - o2), timeZone)
  if (o2 === o3) return new Date(naive - o2)

  return new Date(naive - Math.min(o2, o3))
}

/** Minutes since midnight for a Postgres TIME string. */
export function timeToMinutes(time: string): number {
  const [h, mi] = timeToParts(time)
  return h * 60 + mi
}

/** Minutes since midnight -> 'HH:MM' wall clock. */
export function minutesToTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60), 2)}:${pad(m % 60, 2)}`
}

/** Calendar-day arithmetic on the date key itself — never on an instant. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, mo, d] = dateKey.split('-').map(Number)
  const t = new Date(Date.UTC(y, mo - 1, d) + days * DAY_MS)
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1, 2)}-${pad(t.getUTCDate(), 2)}`
}

/** 0 = Sunday … 6 = Saturday for a date key (no zone needed — it is already wall-clock). */
export function dayOfWeekForDateKey(dateKey: string): number {
  const [y, mo, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MINUTE_MS)
}

/** e.g. '9:00 AM' — an instant rendered in the coach's zone, not the viewer's. */
export function formatTimeInTimeZone(instant: Date, timeZone: string): string {
  return instant.toLocaleTimeString('en-US', {
    timeZone,
    hour:   'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/** e.g. 'Monday, March 10' — an instant rendered in the coach's zone. */
export function formatDateInTimeZone(instant: Date, timeZone: string): string {
  return instant.toLocaleDateString('en-US', {
    timeZone,
    weekday: 'long',
    month:   'long',
    day:     'numeric',
  })
}

/** Short zone label for UI, e.g. 'PDT'. */
export function timeZoneAbbreviation(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(instant)
  return parts.find(p => p.type === 'timeZoneName')?.value ?? timeZone
}

function timeToParts(time: string): [number, number, number] {
  const [h, mi, s] = time.split(':')
  return [Number(h) || 0, Number(mi) || 0, Number(s) || 0]
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}
