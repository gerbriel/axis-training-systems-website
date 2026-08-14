import { supabase, supabaseConfigured } from './supabase'
import type { UserRole } from './account'

/**
 * The clock, for the UI.
 *
 * One table (`time_entries`, migration 022) serves two people: an athlete logs
 * a `gym_visit`, a coach or admin logs a `work_shift`. The role decides the
 * kind, and the database enforces it — a forged request that names the wrong
 * kind is refused by a trigger, so everything here is free to trust the role.
 *
 * The write path is the `clock_in` / `clock_out` RPCs, never the table: a punch
 * is "me, now", and the functions re-derive the actor from auth.uid() so nobody
 * can back-date their own arrival. The read path leans on RLS — a person sees
 * their own entries, an admin (or a coach with `view_timeclock_all`) sees
 * everyone — so the reports ask for everything and get back exactly what the
 * caller is allowed.
 *
 * Nothing throws. Every failure is a value, because every caller is a widget or
 * a panel that has to say something. `null` from a read is an OUTAGE; `[]` is
 * genuinely nobody — a panel says something different for each.
 */

export type TimeEntryKind = 'gym_visit' | 'work_shift'

export interface TimeEntry {
  id: string
  profile_id: string
  kind: TimeEntryKind
  clock_in: string
  clock_out: string | null
  note: string | null
  created_at: string
}

export const TIME_ENTRY_COLUMNS =
  'id,profile_id,kind,clock_in,clock_out,note,created_at'

/** A row from `timeclock_entries` / `timeclock_open` — an entry with its person. */
export interface TimeReportEntry {
  entry_id: string
  profile_id: string
  name: string | null
  role: UserRole
  kind: TimeEntryKind
  clock_in: string
  clock_out: string | null
  is_open: boolean
  elapsed_minutes: number
  note: string | null
}

/** Currently-open entries carry no clock_out and no note yet. */
export interface OpenEntry {
  entry_id: string
  profile_id: string
  name: string | null
  role: UserRole
  kind: TimeEntryKind
  clock_in: string
  elapsed_minutes: number
}

/** One person's hours over a range — the shape Commission will read later. */
export interface TimeTotal {
  profile_id: string
  name: string | null
  role: UserRole
  entry_count: number
  open_count: number
  total_minutes: number
}

export type ClockResult =
  | { ok: true; entry: TimeEntry }
  | { ok: false; message: string }

// ---------------------------------------------------------------------------
// Role ↔ kind, mirrored from the database
// ---------------------------------------------------------------------------

/**
 * Which kind a role clocks. The trigger in 022 is the authority; this is the
 * signage that picks the athlete or coach variant of the widget and passes the
 * right kind to `clock_in`. An admin is staff, so they log a work_shift too.
 */
export function kindForRole(role: UserRole | null | undefined): TimeEntryKind {
  return role === 'athlete' ? 'gym_visit' : 'work_shift'
}

export const KIND_LABELS: Record<TimeEntryKind, string> = {
  gym_visit: 'Gym visit',
  work_shift: 'Work shift',
}

// ---------------------------------------------------------------------------
// Failure, in sentences
// ---------------------------------------------------------------------------

/**
 * What a PostgREST error becomes on screen. The `22023` refusals from 022's RPCs
 * — "You are already clocked in", "You are not clocked in" — are written for a
 * person and passed through verbatim. Everything else is plumbing and gets a
 * plain translation.
 */
function clockMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  const code = error.code ?? ''
  const msg = (error.message ?? '').replace(/^ERROR:\s*/i, '').trim()

  if ((code === 'P0001' || code === '22023') && msg) return msg
  if (code === '23505' || /duplicate key|already clocked/i.test(msg)) {
    return 'You are already clocked in.'
  }
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'The database refused that. Sign out, sign back in, and try again.'
  }
  if (code === 'PGRST301' || /jwt|token is expired/i.test(msg)) {
    return 'Your session expired. Sign in again and try once more.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection — nothing was changed.'
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

/**
 * Demo mode and "no credentials configured" are the same situation from a
 * screen's point of view: there is nothing to talk to, and the screen must
 * still render. Every function routes on this, never on `isDemo` alone.
 */
const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
const HOUR = 3_600_000
const DAY = 86_400_000

interface DemoPerson { id: string; name: string; role: UserRole }

/**
 * A small demo roster whose ids echo the User Management demo so a walk-through
 * reads as one place. The signed-in demo athlete and demo coach ("me-*") are the
 * ones the widget punches; the rest give the admin rollup something to total.
 */
const DEMO_PEOPLE: DemoPerson[] = [
  { id: 'demo-me-athlete', name: 'You (Athlete)', role: 'athlete' },
  { id: 'demo-me-coach',   name: 'You (Coach)',   role: 'coach' },
  { id: 'demo-ronnie',     name: 'Ronnie Vallejo', role: 'admin' },
  { id: 'demo-seth',       name: 'Seth Burman',    role: 'coach' },
  { id: 'demo-lucas',      name: 'Lucas Sison',    role: 'coach' },
  { id: 'demo-devin',      name: 'Devin Cross',    role: 'athlete' },
  { id: 'demo-bianca',     name: 'Bianca Reyes',   role: 'athlete' },
]

const nameOf = (id: string) => DEMO_PEOPLE.find(p => p.id === id)?.name ?? null
const roleOf = (id: string): UserRole => DEMO_PEOPLE.find(p => p.id === id)?.role ?? 'athlete'

interface DemoRow {
  id: string
  profile_id: string
  kind: TimeEntryKind
  clock_in: string
  clock_out: string | null
  note: string | null
  created_at: string
}

/**
 * Seeded on first access and mutated in place, so a demo walk-through survives a
 * tab change. Resets on reload — the promise the demo banner makes. Includes two
 * OPEN entries (Ronnie on shift, Devin in the gym) so "who is clocked in now"
 * is never empty, and a spread of closed entries so the totals have shape.
 */
let demoRows: DemoRow[] | null = null

function demoSeed(): DemoRow[] {
  let n = 0
  const row = (
    profile_id: string, kind: TimeEntryKind,
    inAgo: number, outAgo: number | null, note: string | null,
  ): DemoRow => ({
    id: `demo-te-${n++}`, profile_id, kind,
    clock_in: iso(inAgo), clock_out: outAgo === null ? null : iso(outAgo),
    note, created_at: iso(inAgo),
  })
  return [
    // Open right now.
    row('demo-ronnie', 'work_shift', 3 * HOUR, null, null),
    row('demo-devin',  'gym_visit',  40 * 60_000, null, null),
    // Closed, this week.
    row('demo-me-athlete', 'gym_visit', 1 * DAY, 1 * DAY - 82 * 60_000, 'Squat day'),
    row('demo-me-athlete', 'gym_visit', 3 * DAY, 3 * DAY - 65 * 60_000, null),
    row('demo-me-coach',   'work_shift', 1 * DAY, 1 * DAY - 5 * HOUR, 'Coaching + programming'),
    row('demo-me-coach',   'work_shift', 2 * DAY, 2 * DAY - 4 * HOUR, null),
    row('demo-seth',   'work_shift', 1 * DAY, 1 * DAY - 6 * HOUR, null),
    row('demo-seth',   'work_shift', 4 * DAY, 4 * DAY - 5 * HOUR, null),
    row('demo-lucas',  'work_shift', 2 * DAY, 2 * DAY - 3 * HOUR, 'Half day'),
    row('demo-bianca', 'gym_visit',  2 * DAY, 2 * DAY - 55 * 60_000, null),
    row('demo-devin',  'gym_visit',  5 * DAY, 5 * DAY - 70 * 60_000, null),
  ]
}

function demoStore(): DemoRow[] {
  if (!demoRows) demoRows = demoSeed()
  return demoRows
}

const beat = () => new Promise<void>(r => setTimeout(r, 240))

const toEntry = (r: DemoRow): TimeEntry => ({
  id: r.id, profile_id: r.profile_id, kind: r.kind,
  clock_in: r.clock_in, clock_out: r.clock_out, note: r.note, created_at: r.created_at,
})

const minutesBetween = (from: string, to: string) =>
  Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 60_000))

/** The demo "me" whose punches the widget owns, one per kind. */
const demoMeId = (kind: TimeEntryKind) => kind === 'gym_visit' ? 'demo-me-athlete' : 'demo-me-coach'

// ---------------------------------------------------------------------------
// The punches
// ---------------------------------------------------------------------------

/**
 * Clock in for a kind. The kind comes from the role (see `kindForRole`); passing
 * it explicitly keeps the RPC signature honest and lets the demo widget punch
 * without a session.
 */
export async function clockIn(kind: TimeEntryKind, note?: string | null, isDemo = false): Promise<ClockResult> {
  if (offline(isDemo)) {
    await beat()
    const me = demoMeId(kind)
    const store = demoStore()
    if (store.some(r => r.profile_id === me && r.kind === kind && r.clock_out === null)) {
      return { ok: false, message: 'You are already clocked in.' }
    }
    const r: DemoRow = {
      id: `demo-te-${Date.now()}`, profile_id: me, kind,
      clock_in: new Date().toISOString(), clock_out: null,
      note: note?.trim() ? note.trim() : null, created_at: new Date().toISOString(),
    }
    store.unshift(r)
    return { ok: true, entry: toEntry(r) }
  }

  const { data, error } = await supabase.rpc('clock_in', { p_kind: kind, p_note: note ?? null })
  if (error) return { ok: false, message: clockMessage(error, 'Could not clock you in. Please try again.') }
  return { ok: true, entry: data as unknown as TimeEntry }
}

/** Close the caller's open entry. */
export async function clockOut(note?: string | null, isDemo = false, kind?: TimeEntryKind): Promise<ClockResult> {
  if (offline(isDemo)) {
    await beat()
    const store = demoStore()
    // With a kind hint (the widget always has one) close that kind's open entry;
    // otherwise close whichever "me" entry is open.
    const open = store.find(r =>
      r.clock_out === null &&
      (kind ? r.profile_id === demoMeId(kind) && r.kind === kind
            : (r.profile_id === 'demo-me-athlete' || r.profile_id === 'demo-me-coach')))
    if (!open) return { ok: false, message: 'You are not clocked in.' }
    open.clock_out = new Date().toISOString()
    if (note?.trim()) open.note = note.trim()
    return { ok: true, entry: toEntry(open) }
  }

  const { data, error } = await supabase.rpc('clock_out', { p_note: note ?? null })
  if (error) return { ok: false, message: clockMessage(error, 'Could not clock you out. Please try again.') }
  return { ok: true, entry: data as unknown as TimeEntry }
}

// ---------------------------------------------------------------------------
// The widget's own reads (a person, about themselves)
// ---------------------------------------------------------------------------

/**
 * This person's recent entries of one kind, newest first. `null` is an outage —
 * "you have no history" is a claim the widget must not make on a failed read.
 */
export async function fetchMyEntries(kind: TimeEntryKind, isDemo = false, limit = 20): Promise<TimeEntry[] | null> {
  if (offline(isDemo)) {
    const me = demoMeId(kind)
    return demoStore()
      .filter(r => r.profile_id === me && r.kind === kind)
      .sort((a, b) => b.clock_in.localeCompare(a.clock_in))
      .slice(0, limit)
      .map(toEntry)
  }

  const { data, error } = await supabase
    .from('time_entries')
    .select(TIME_ENTRY_COLUMNS)
    .eq('kind', kind)
    .order('clock_in', { ascending: false })
    .limit(limit)

  if (error) return null
  return (data ?? []) as unknown as TimeEntry[]
}

/** The caller's open entry of a kind, or null if they are not clocked in. */
export async function fetchOpenEntry(kind: TimeEntryKind, isDemo = false): Promise<TimeEntry | null> {
  if (offline(isDemo)) {
    const me = demoMeId(kind)
    const open = demoStore().find(r => r.profile_id === me && r.kind === kind && r.clock_out === null)
    return open ? toEntry(open) : null
  }

  const { data, error } = await supabase
    .from('time_entries')
    .select(TIME_ENTRY_COLUMNS)
    .eq('kind', kind)
    .is('clock_out', null)
    .order('clock_in', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return null
  return (data as unknown as TimeEntry) ?? null
}

// ---------------------------------------------------------------------------
// The admin rollup (everyone, if you are allowed)
// ---------------------------------------------------------------------------

/**
 * Every entry that STARTED in [from, to), each with its person and elapsed time.
 * RLS decides the rows: an admin or a coach with view_timeclock_all gets
 * everyone, anyone else gets only their own. `null` is an outage.
 */
export async function fetchAllEntries(
  from: Date, to: Date, kind: TimeEntryKind | null = null, isDemo = false,
): Promise<TimeReportEntry[] | null> {
  if (offline(isDemo)) {
    await beat()
    return demoStore()
      .filter(r => (!kind || r.kind === kind))
      .filter(r => new Date(r.clock_in) >= from && new Date(r.clock_in) < to)
      .sort((a, b) => b.clock_in.localeCompare(a.clock_in))
      .map(r => ({
        entry_id: r.id, profile_id: r.profile_id, name: nameOf(r.profile_id), role: roleOf(r.profile_id),
        kind: r.kind, clock_in: r.clock_in, clock_out: r.clock_out, is_open: r.clock_out === null,
        elapsed_minutes: minutesBetween(r.clock_in, r.clock_out ?? new Date().toISOString()), note: r.note,
      }))
  }

  const { data, error } = await supabase.rpc('timeclock_entries', {
    p_from: from.toISOString(), p_to: to.toISOString(), p_kind: kind,
  })
  if (error) return null
  return (data ?? []) as unknown as TimeReportEntry[]
}

/** Hours per person over [from, to). Feeds Commission later. `null` is an outage. */
export async function fetchTotals(
  from: Date, to: Date, kind: TimeEntryKind | null = null, isDemo = false,
): Promise<TimeTotal[] | null> {
  if (offline(isDemo)) {
    await beat()
    const acc = new Map<string, TimeTotal>()
    for (const r of demoStore()) {
      if (kind && r.kind !== kind) continue
      if (!(new Date(r.clock_in) >= from && new Date(r.clock_in) < to)) continue
      const t = acc.get(r.profile_id) ?? {
        profile_id: r.profile_id, name: nameOf(r.profile_id), role: roleOf(r.profile_id),
        entry_count: 0, open_count: 0, total_minutes: 0,
      }
      t.entry_count += 1
      if (r.clock_out === null) t.open_count += 1
      else t.total_minutes += minutesBetween(r.clock_in, r.clock_out)
      acc.set(r.profile_id, t)
    }
    return [...acc.values()].sort((a, b) => b.total_minutes - a.total_minutes)
  }

  const { data, error } = await supabase.rpc('timeclock_totals', {
    p_from: from.toISOString(), p_to: to.toISOString(), p_kind: kind,
  })
  if (error) return null
  return (data ?? []) as unknown as TimeTotal[]
}

/** Who is on the clock right now, regardless of when they started. `null` is an outage. */
export async function fetchOpen(isDemo = false): Promise<OpenEntry[] | null> {
  if (offline(isDemo)) {
    await beat()
    return demoStore()
      .filter(r => r.clock_out === null)
      .sort((a, b) => a.clock_in.localeCompare(b.clock_in))
      .map(r => ({
        entry_id: r.id, profile_id: r.profile_id, name: nameOf(r.profile_id), role: roleOf(r.profile_id),
        kind: r.kind, clock_in: r.clock_in,
        elapsed_minutes: minutesBetween(r.clock_in, new Date().toISOString()),
      }))
  }

  const { data, error } = await supabase.rpc('timeclock_open')
  if (error) return null
  return (data ?? []) as unknown as OpenEntry[]
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Live elapsed as H:MM:SS, from a clock-in instant to now. Ticks with a timer. */
export function elapsedClock(fromIso: string, nowMs: number = Date.now()): string {
  const secs = Math.max(0, Math.floor((nowMs - new Date(fromIso).getTime()) / 1000))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${h}:${pad(m)}:${pad(s)}`
}

/** Whole minutes as "3h 12m" / "48m" / "0m" — the same figure the totals report in. */
export function formatMinutes(mins: number): string {
  const m = Math.max(0, Math.round(mins))
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (h === 0) return `${rem}m`
  if (rem === 0) return `${h}h`
  return `${h}h ${rem}m`
}

/** Minutes as decimal hours, the shape a commission or payroll export wants. */
export function minutesToHours(mins: number): number {
  return Math.round((Math.max(0, mins) / 60) * 100) / 100
}

/** "Today · 3:14 PM" for a history row. */
export function formatWhen(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const yesterday = new Date(today.getTime() - DAY).toDateString() === d.toDateString()
  if (sameDay) return `Today · ${time}`
  if (yesterday) return `Yesterday · ${time}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${time}`
}
