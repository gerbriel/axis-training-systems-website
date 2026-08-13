import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  zonedTimeToUtc,
  zonedDateTimeToUtc,
  utcToZonedParts,
  getTimeZoneOffsetMs,
  dateKeyInTimeZone,
  dayOfWeekInTimeZone,
  addDaysToDateKey,
} from '../src/lib/timezone.ts'

const iso = (d: Date | null) => (d === null ? null : d.toISOString())

// ---------------------------------------------------------------------------
// 1. Ordinary times, known-good instants
// ---------------------------------------------------------------------------
test('normal times: coach 09:00 resolves to the right instant summer and winter', () => {
  // 09:00 PDT (UTC-7) -> 16:00Z
  assert.equal(iso(zonedDateTimeToUtc('2026-07-13', '09:00', 'America/Los_Angeles')), '2026-07-13T16:00:00.000Z')
  // 09:00 PST (UTC-8) -> 17:00Z  — SAME schedule row, one hour different in UTC
  assert.equal(iso(zonedDateTimeToUtc('2026-01-13', '09:00', 'America/Los_Angeles')), '2026-01-13T17:00:00.000Z')

  assert.equal(iso(zonedDateTimeToUtc('2026-07-13', '09:00', 'Europe/London')), '2026-07-13T08:00:00.000Z')
  assert.equal(iso(zonedDateTimeToUtc('2026-01-13', '09:00', 'Europe/London')), '2026-01-13T09:00:00.000Z')

  // Seconds precision (Postgres TIME can be 'HH:MM:SS')
  assert.equal(iso(zonedDateTimeToUtc('2026-07-13', '09:30:45', 'America/New_York')), '2026-07-13T13:30:45.000Z')
})

test('non-integer-hour offsets', () => {
  assert.equal(iso(zonedDateTimeToUtc('2026-07-13', '09:00', 'Asia/Kolkata')), '2026-07-13T03:30:00.000Z')   // +5:30
  assert.equal(iso(zonedDateTimeToUtc('2026-07-13', '09:00', 'Asia/Kathmandu')), '2026-07-13T03:15:00.000Z') // +5:45
  assert.equal(iso(zonedDateTimeToUtc('2026-07-13', '09:00', 'Australia/Eucla')), '2026-07-13T00:15:00.000Z') // +8:45
})

// ---------------------------------------------------------------------------
// 2. Spring forward — nonexistent wall times
// ---------------------------------------------------------------------------
test('spring forward: nonexistent wall time is rejected by default', () => {
  // America/Los_Angeles 2026-03-08: 02:00 -> 03:00. 02:00..02:59 never happen.
  assert.equal(zonedDateTimeToUtc('2026-03-08', '02:30', 'America/Los_Angeles'), null)
  assert.equal(zonedDateTimeToUtc('2026-03-08', '02:00', 'America/Los_Angeles'), null)
  assert.equal(zonedDateTimeToUtc('2026-03-08', '02:59', 'America/Los_Angeles'), null)
  // The boundaries themselves DO exist
  // 01:59 PST (-8) = 09:59Z, and the very next wall time that exists is 03:00 PDT (-7) = 10:00Z
  assert.equal(iso(zonedDateTimeToUtc('2026-03-08', '01:59', 'America/Los_Angeles')), '2026-03-08T09:59:00.000Z')
  assert.equal(iso(zonedDateTimeToUtc('2026-03-08', '03:00', 'America/Los_Angeles')), '2026-03-08T10:00:00.000Z')

  // Europe/Berlin 2026-03-29: 02:00 -> 03:00
  assert.equal(zonedDateTimeToUtc('2026-03-29', '02:30', 'Europe/Berlin'), null)
  assert.equal(iso(zonedDateTimeToUtc('2026-03-29', '03:00', 'Europe/Berlin')), '2026-03-29T01:00:00.000Z')
})

test('spring forward: nonexistent:forward shifts by the gap', () => {
  assert.equal(
    iso(zonedDateTimeToUtc('2026-03-08', '02:30', 'America/Los_Angeles', { nonexistent: 'forward' })),
    '2026-03-08T10:30:00.000Z' // = 03:30 PDT
  )
  assert.equal(
    utcToZonedParts(Date.parse('2026-03-08T10:30:00Z'), 'America/Los_Angeles').hour,
    3
  )
  assert.equal(
    iso(zonedDateTimeToUtc('2026-03-29', '02:30', 'Europe/Berlin', { nonexistent: 'forward' })),
    '2026-03-29T01:30:00.000Z' // = 03:30 CEST
  )
})

// ---------------------------------------------------------------------------
// 3. Fall back — ambiguous wall times
// ---------------------------------------------------------------------------
test('fall back: ambiguous wall time picks first occurrence by default', () => {
  // America/Los_Angeles 2026-11-01: 02:00 PDT -> 01:00 PST. 01:00..01:59 happen TWICE.
  const earlier = zonedDateTimeToUtc('2026-11-01', '01:30', 'America/Los_Angeles')
  const later = zonedDateTimeToUtc('2026-11-01', '01:30', 'America/Los_Angeles', { ambiguous: 'later' })
  assert.equal(iso(earlier), '2026-11-01T08:30:00.000Z') // 01:30 PDT (-7)
  assert.equal(iso(later), '2026-11-01T09:30:00.000Z') // 01:30 PST (-8)
  assert.equal(later!.getTime() - earlier!.getTime(), 3_600_000)

  // Both really do render as 01:30 local — that is what "ambiguous" means
  assert.equal(utcToZonedParts(earlier!.getTime(), 'America/Los_Angeles').hour, 1)
  assert.equal(utcToZonedParts(later!.getTime(), 'America/Los_Angeles').hour, 1)
})

test('fall back: 30-minute DST shift (Lord Howe) is handled', () => {
  // Australia/Lord_Howe shifts by only 30 min: +11:00 -> +10:30 on 2026-04-05 02:00
  const e = zonedDateTimeToUtc('2026-04-05', '01:45', 'Australia/Lord_Howe')
  const l = zonedDateTimeToUtc('2026-04-05', '01:45', 'Australia/Lord_Howe', { ambiguous: 'later' })
  assert.equal(l!.getTime() - e!.getTime(), 1_800_000) // exactly 30 minutes apart
})

// ---------------------------------------------------------------------------
// 4. DST transition AT MIDNIGHT — the case that breaks setHours(0,0,0,0)
// ---------------------------------------------------------------------------
test('midnight DST transition: local midnight can simply not exist', () => {
  // America/Santiago springs forward at 24:00 -> the next day has no 00:00.
  const noMidnight = zonedDateTimeToUtc('2026-09-06', '00:00', 'America/Santiago')
  assert.equal(noMidnight, null, 'expected 2026-09-06 00:00 to not exist in America/Santiago')
  // ...but the calendar day obviously still exists and must still be iterable.
  assert.equal(addDaysToDateKey('2026-09-05', 1), '2026-09-06')
  assert.equal(iso(zonedDateTimeToUtc('2026-09-06', '09:00', 'America/Santiago')), '2026-09-06T12:00:00.000Z')
})

// ---------------------------------------------------------------------------
// 5. Property test: exhaustive round-trip over 2 years, many zones
// ---------------------------------------------------------------------------
const ZONES = [
  'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'America/Santiago',
  'Europe/London', 'Europe/Berlin', 'Europe/Dublin', 'Asia/Tehran', 'Asia/Kolkata',
  'Asia/Tokyo', 'Australia/Sydney', 'Australia/Lord_Howe', 'Pacific/Chatham',
  'Pacific/Auckland', 'Africa/Cairo', 'UTC',
]

test('property: every resolvable wall time round-trips exactly (15-min grid, 2 years, 16 zones)', () => {
  let checked = 0, rejected = 0, ambiguousCount = 0
  for (const tz of ZONES) {
    for (let day = 0; day < 730; day++) {
      const key = addDaysToDateKey('2025-06-01', day)
      const [y, mo, d] = key.split('-').map(Number)
      for (let min = 0; min < 1440; min += 15) {
        const parts = { year: y, month: mo, day: d, hour: Math.floor(min / 60), minute: min % 60, second: 0 }
        const got = zonedTimeToUtc(parts, tz)
        if (got === null) { rejected++; continue }
        checked++
        const back = utcToZonedParts(got.getTime(), tz)
        assert.deepEqual(back, parts, `round-trip failed for ${tz} ${key} ${parts.hour}:${parts.minute}`)
        const later = zonedTimeToUtc(parts, tz, { ambiguous: 'later' })!
        if (later.getTime() !== got.getTime()) {
          ambiguousCount++
          assert.deepEqual(utcToZonedParts(later.getTime(), tz), parts, 'later candidate must also round-trip')
          assert.ok(later.getTime() > got.getTime(), 'later must be after earlier')
        }
      }
    }
  }
  console.log(`      round-tripped ${checked} wall times; ${rejected} nonexistent; ${ambiguousCount} ambiguous`)
  assert.ok(checked > 700_000)
  assert.ok(rejected > 0 && ambiguousCount > 0, 'test data must actually cover DST transitions')
})

test('property: monotonicity — instants are strictly increasing across a normal day', () => {
  for (const tz of ZONES) {
    let prev = -Infinity
    for (let min = 0; min < 1440; min += 15) {
      const got = zonedTimeToUtc(
        { year: 2026, month: 7, day: 13, hour: Math.floor(min / 60), minute: min % 60, second: 0 }, tz
      )!
      assert.ok(got.getTime() > prev, `${tz} not monotonic at ${min}`)
      prev = got.getTime()
    }
  }
})

// ---------------------------------------------------------------------------
// 6. INDEPENDENT ORACLE: system libc + tzdata (BSD `date`), not our own Intl code
// ---------------------------------------------------------------------------
test('oracle: agrees with system libc/tzdata (BSD date -j) on unambiguous times', () => {
  const samples: [string, string, string][] = []
  for (const tz of ['America/Los_Angeles', 'Europe/Berlin', 'Asia/Kolkata', 'Australia/Sydney', 'Pacific/Auckland', 'America/New_York']) {
    for (const key of ['2026-01-15', '2026-03-08', '2026-03-29', '2026-06-15', '2026-11-01', '2026-10-25', '2026-04-05', '2026-12-31']) {
      for (const t of ['00:30', '06:00', '09:00', '12:15', '17:45', '23:30']) samples.push([tz, key, t])
    }
  }
  let compared = 0, skipped = 0
  for (const [tz, key, t] of samples) {
    const mine = zonedDateTimeToUtc(key, t, tz) // null => nonexistent
    const laterMine = zonedDateTimeToUtc(key, t, tz, { ambiguous: 'later' })
    if (mine === null) { skipped++; continue }                       // gap: mktime() normalizes, not comparable
    if (laterMine!.getTime() !== mine.getTime()) { skipped++; continue } // ambiguous: mktime() picks arbitrarily
    const out = execFileSync('date', ['-j', '-f', '%Y-%m-%d %H:%M:%S', `${key} ${t}:00`, '+%s'], {
      env: { ...process.env, TZ: tz }, encoding: 'utf8',
    }).trim()
    assert.equal(mine.getTime(), Number(out) * 1000, `mismatch ${tz} ${key} ${t}: ours=${mine.toISOString()} libc=${new Date(Number(out) * 1000).toISOString()}`)
    compared++
  }
  console.log(`      cross-checked ${compared} instants against system tzdata (${skipped} skipped: DST gap/overlap)`)
  assert.ok(compared > 250)
})

// ---------------------------------------------------------------------------
// 7. Helpers used by the slot loop
// ---------------------------------------------------------------------------
test('dateKeyInTimeZone / dayOfWeekInTimeZone use the given zone, not the process zone', () => {
  // 2026-07-14T02:00Z is still Mon Jul 13 in Los Angeles, already Tue Jul 14 in Berlin.
  const i = Date.parse('2026-07-14T02:00:00Z')
  assert.equal(dateKeyInTimeZone(i, 'America/Los_Angeles'), '2026-07-13')
  assert.equal(dateKeyInTimeZone(i, 'Europe/Berlin'), '2026-07-14')
  assert.equal(dayOfWeekInTimeZone(i, 'America/Los_Angeles'), 1) // Monday
  assert.equal(dayOfWeekInTimeZone(i, 'Europe/Berlin'), 2) // Tuesday
})

test('addDaysToDateKey crosses DST, month and year boundaries without drifting', () => {
  assert.equal(addDaysToDateKey('2026-03-07', 1), '2026-03-08') // US spring forward
  assert.equal(addDaysToDateKey('2026-10-31', 1), '2026-11-01') // US fall back
  assert.equal(addDaysToDateKey('2026-12-31', 1), '2027-01-01')
  assert.equal(addDaysToDateKey('2028-02-28', 1), '2028-02-29') // leap
  let k = '2026-01-01'
  for (let i = 0; i < 365; i++) k = addDaysToDateKey(k, 1)
  assert.equal(k, '2027-01-01')
})

test('getTimeZoneOffsetMs sign convention: east positive, west negative', () => {
  assert.equal(getTimeZoneOffsetMs(Date.parse('2026-07-13T12:00:00Z'), 'America/Los_Angeles'), -7 * 3600_000)
  assert.equal(getTimeZoneOffsetMs(Date.parse('2026-01-13T12:00:00Z'), 'America/Los_Angeles'), -8 * 3600_000)
  assert.equal(getTimeZoneOffsetMs(Date.parse('2026-07-13T12:00:00Z'), 'Europe/Berlin'), 2 * 3600_000)
  assert.equal(getTimeZoneOffsetMs(Date.parse('2026-07-13T12:00:00Z'), 'Asia/Kolkata'), 5.5 * 3600_000)
})
