/**
 * Timezone primitives for the booking system.
 *
 * The whole booking model rests on one rule:
 *
 *   A coach's availability is authored in WALL-CLOCK time in the coach's IANA zone.
 *   Everything stored, compared, or sent to Google Calendar is an ABSOLUTE INSTANT.
 *
 * Wall clock -> instant is a lossy, DST-dependent conversion, so it must be done
 * once, explicitly, with the coach's zone — never implicitly via `new Date(...)`
 * + `setHours()`, which silently uses whatever zone the *browser* happens to be in.
 *
 * No dependencies. Uses only Intl.DateTimeFormat, which ships the IANA tz database
 * in every browser we support, in Node, and in Deno (Supabase Edge Functions).
 */

/** Wall-clock date + time fields, zone-free. What a coach authors. */
export interface ZonedParts {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number // 0-23
  minute: number // 0-59
  second: number // 0-59
}

/** How to resolve a wall time that DST makes ambiguous or nonexistent. */
export interface ResolveOptions {
  /**
   * Fall-back: the wall time happens twice (e.g. 01:30 on 2026-11-01 in Los Angeles).
   * 'earlier' = first occurrence, still in DST. This matches how Google Calendar
   * resolves a tz-qualified dateTime, so it is the default.
   */
  ambiguous?: 'earlier' | 'later'
  /**
   * Spring-forward: the wall time does not exist (e.g. 02:30 on 2026-03-08 in
   * Los Angeles).  'reject' returns null — the correct choice for slot generation,
   * because a slot at a nonexistent time is a slot nobody can attend.
   * 'forward' shifts by the size of the gap (02:30 -> 03:30), matching RFC 5545.
   */
  nonexistent?: 'reject' | 'forward'
}

const MS_PER_DAY = 86_400_000

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      // hourCycle (not hour12) — with hour12:false some engines render midnight as "24".
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timeZone, f)
  }
  return f
}

/** Throws a clear error for a typo'd/unknown IANA zone instead of silently using UTC. */
export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
  } catch {
    throw new RangeError(`Invalid IANA time zone: ${JSON.stringify(timeZone)}`)
  }
}

/** The wall-clock fields shown in `timeZone` at absolute instant `ms`. */
export function utcToZonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms))
  const f: Record<string, number> = {}
  for (const p of parts) if (p.type !== 'literal') f[p.type] = Number(p.value)
  return {
    year: f.year,
    month: f.month,
    day: f.day,
    hour: f.hour === 24 ? 0 : f.hour, // belt-and-braces against h24 engines
    minute: f.minute,
    second: f.second,
  }
}

/**
 * UTC offset of `timeZone` at absolute instant `ms`, in milliseconds.
 * East of UTC is positive. e.g. Los Angeles in July -> -25_200_000 (-7h).
 */
export function getTimeZoneOffsetMs(ms: number, timeZone: string): number {
  const p = utcToZonedParts(ms, timeZone)
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  // Intl truncates to whole seconds, so compare against a second-floored instant.
  return asIfUtc - Math.floor(ms / 1000) * 1000
}

/**
 * THE function. Absolute UTC instant for "date D at wall-clock time T in zone Z".
 *
 * Returns null only when the wall time does not exist (spring-forward gap) and
 * `nonexistent: 'reject'` is set.
 *
 * How it works: we cannot invert the offset directly, because the offset is a
 * function OF the instant we are trying to find. So we:
 *   1. read the wall-clock fields as if they were UTC  -> `wallAsUtc`
 *   2. probe the zone's offset a day before / at / a day after that pretend instant;
 *      near a transition these disagree, giving us up to 3 candidate instants
 *   3. keep only candidates that ACTUALLY render back to the requested wall time
 *      in that zone (a full round-trip check — this is what makes it correct)
 *   4. 0 valid   -> nonexistent (spring forward)
 *      1 valid   -> the normal case
 *      2 valid   -> ambiguous (fall back), pick per options
 */
export function zonedTimeToUtc(
  parts: ZonedParts,
  timeZone: string,
  options: ResolveOptions = {}
): Date | null {
  const { ambiguous = 'earlier', nonexistent = 'reject' } = options
  const { year, month, day, hour, minute, second } = parts

  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second)

  const candidates = new Set<number>()
  for (const probe of [wallAsUtc - MS_PER_DAY, wallAsUtc, wallAsUtc + MS_PER_DAY]) {
    candidates.add(wallAsUtc - getTimeZoneOffsetMs(probe, timeZone))
  }

  const valid = [...candidates]
    .filter(ms => {
      const back = utcToZonedParts(ms, timeZone)
      return (
        back.year === year &&
        back.month === month &&
        back.day === day &&
        back.hour === hour &&
        back.minute === minute &&
        back.second === second
      )
    })
    .sort((a, b) => a - b)

  if (valid.length === 1) return new Date(valid[0])

  if (valid.length > 1) {
    // Fall back: the wall time occurred twice.
    return new Date(ambiguous === 'earlier' ? valid[0] : valid[valid.length - 1])
  }

  // Spring forward: the wall time never occurred.
  if (nonexistent === 'reject') return null
  // Shift forward by the gap: applying the PRE-transition offset lands past it.
  const offsetBefore = getTimeZoneOffsetMs(wallAsUtc - MS_PER_DAY, timeZone)
  return new Date(wallAsUtc - offsetBefore)
}

// ---------------------------------------------------------------------------
// Convenience wrappers shaped like the database columns
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' — the shape of coach_availability_blocks.block_date. */
export type DateKey = string

/** Parses a Postgres TIME ('HH:MM' or 'HH:MM:SS') into {hour,minute,second}. */
function parseTime(time: string): { hour: number; minute: number; second: number } {
  const [h, m, s] = time.split(':')
  return { hour: Number(h), minute: Number(m), second: Number(s ?? 0) }
}

/** Parses a 'YYYY-MM-DD' key. */
function parseDateKey(dateKey: DateKey): { year: number; month: number; day: number } {
  const [y, m, d] = dateKey.split('-').map(Number)
  return { year: y, month: m, day: d }
}

/**
 * The instant at which wall-clock `time` occurs on calendar date `dateKey` in `timeZone`.
 * This is exactly what coach_schedules.start_time / coach_availability_blocks.start_time mean
 * once we say they are authored in the coach's zone.
 */
export function zonedDateTimeToUtc(
  dateKey: DateKey,
  time: string,
  timeZone: string,
  options?: ResolveOptions
): Date | null {
  return zonedTimeToUtc({ ...parseDateKey(dateKey), ...parseTime(time) }, timeZone, options)
}

/** The calendar date ('YYYY-MM-DD') on which `instant` falls in `timeZone`. */
export function dateKeyInTimeZone(instant: Date | number, timeZone: string): DateKey {
  const p = utcToZonedParts(typeof instant === 'number' ? instant : instant.getTime(), timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Day of week (0=Sun..6=Sat, matching coach_schedules.day_of_week) of `instant` in `timeZone`. */
export function dayOfWeekInTimeZone(instant: Date | number, timeZone: string): number {
  const p = utcToZonedParts(typeof instant === 'number' ? instant : instant.getTime(), timeZone)
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
}

/** Day of week of a bare 'YYYY-MM-DD' key. Zone-free — a date has a weekday on its own. */
export function dayOfWeekOfDateKey(dateKey: DateKey): number {
  const { year, month, day } = parseDateKey(dateKey)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/**
 * Calendar-day arithmetic on a date key. Pure integer math via UTC — never touches
 * local time, so it cannot be perturbed by DST (unlike `d.setDate(d.getDate()+1)`).
 */
export function addDaysToDateKey(dateKey: DateKey, days: number): DateKey {
  const { year, month, day } = parseDateKey(dateKey)
  const ms = Date.UTC(year, month - 1, day) + days * MS_PER_DAY
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** The visitor's IANA zone, e.g. 'Europe/London'. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/**
 * Short zone label for the UI ('PDT', 'GMT+1'). Always show this next to a time —
 * a bare "9:00 AM" is the whole reason this class of bug ships to production.
 */
export function timeZoneAbbreviation(instant: Date | number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(
    new Date(typeof instant === 'number' ? instant : instant.getTime())
  )
  return parts.find(p => p.type === 'timeZoneName')?.value ?? ''
}

/** Format an instant as a wall-clock time in an explicit zone. */
export function formatTimeInTimeZone(instant: Date | number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(typeof instant === 'number' ? instant : instant.getTime()))
}

/** Format an instant as a wall-clock date in an explicit zone. */
export function formatDateInTimeZone(instant: Date | number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(typeof instant === 'number' ? instant : instant.getTime()))
}
