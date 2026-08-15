/**
 * announceTargeting.ts
 *
 * Who sees an announcement, decided in the browser.
 *
 * Migration 031 puts a small jsonb object on every announcement row saying who
 * it is for. This module is the other half: it reads that object, looks at the
 * viewer in front of it, and answers yes or no. Then it picks the one row to
 * render when several are live at once.
 *
 * PRESENTATION, NOT CONFIDENTIALITY. Every live announcement is readable by
 * anyone, signed in or not, because that is what a public banner is. Targeting
 * decides what gets rendered, nothing more. Never write an announcement that
 * would be a problem for the wrong person to read. 031's header says the same
 * thing at more length.
 *
 * Pure on purpose. No React, no Supabase, no imports at all, so every rule
 * below is a unit test in tests/announcements.test.ts rather than something
 * verified by clicking around a page. The only impurity is the pair of
 * localStorage helpers at the bottom, and both swallow every storage error:
 * private mode, a full quota and server-side rendering all read as "no idea
 * when this browser first showed up", which is the safe answer.
 *
 * FAILING OPEN IS THE HOUSE RULE. A target this module cannot parse, from a
 * hand-edited row or a type added later and deployed ahead of the client,
 * matches EVERYBODY. A banner that quietly shows up in the wrong place gets
 * reported in an hour. A banner that quietly disappears gets found in a month.
 */

// ── Vocabulary ───────────────────────────────────────────────────────────────

export type AudienceType =
  | 'all'
  | 'anonymous'
  | 'authenticated'
  | 'role'
  | 'new_accounts'
  | 'returning'
  | 'returning_anonymous'

/** The seven types 031's `announcements_audience_shape` check accepts. */
export const AUDIENCE_TYPES: readonly AudienceType[] = [
  'all', 'anonymous', 'authenticated', 'role',
  'new_accounts', 'returning', 'returning_anonymous',
]

export type ViewerRole = 'athlete' | 'coach' | 'admin'

export const VIEWER_ROLES: readonly ViewerRole[] = ['athlete', 'coach', 'admin']

export interface AudienceTarget {
  type: AudienceType
  /** Used by 'role', and optionally by 'new_accounts' to narrow it further. */
  roles?: ViewerRole[]
  /** Used by 'new_accounts': how many days after signup the row still shows. */
  days?: number
}

/**
 * Everything about the person in front of the banner. `firstSeenAt` is this
 * browser's own memory (see readFirstSeen); the other three come from the
 * session. A signed-out visitor is ANONYMOUS_VIEWER plus whatever localStorage
 * remembers.
 */
export interface AnnouncementViewer {
  userId: string | null
  role: ViewerRole | null
  accountCreatedAt: string | null
  firstSeenAt: string | null
}

export const ANONYMOUS_VIEWER: AnnouncementViewer = {
  userId: null,
  role: null,
  accountCreatedAt: null,
  firstSeenAt: null,
}

/**
 * A visit 12 hours or more after this browser was first seen counts as
 * returning. Long enough that a person who reads the home page, books, and
 * comes back to check the confirmation is still on their first visit. Short
 * enough that yesterday counts.
 */
export const RETURNING_AFTER_MS = 12 * 60 * 60 * 1000

/** What 'new_accounts' means when a row forgot to say. Matches the panel. */
export const DEFAULT_NEW_ACCOUNT_DAYS = 14

/** 031 refuses anything outside 1..365, so clamp rather than write a bad row. */
export const MIN_NEW_ACCOUNT_DAYS = 1
export const MAX_NEW_ACCOUNT_DAYS = 365

/** The one localStorage key this module owns. */
export const FIRST_SEEN_KEY = 'axis_first_seen'

const DAY_MS = 24 * 60 * 60 * 1000

// ── Parsing what the database handed us ──────────────────────────────────────

/**
 * A jsonb value from the row into an AudienceTarget, or null when it is not one
 * this build understands. Callers treat null as "matches everybody".
 *
 * Tolerant by design: the value may arrive as an object, or as a JSON string if
 * something along the way stringified it. Unknown keys are dropped, unknown
 * role names are dropped, and a `days` outside 1..365 is clamped rather than
 * thrown away.
 */
export function parseAudience(value: unknown): AudienceTarget | null {
  const raw = asObject(value)
  if (!raw) return null

  const type = typeof raw.type === 'string' ? raw.type : ''
  if (!AUDIENCE_TYPES.includes(type as AudienceType)) return null

  const target: AudienceTarget = { type: type as AudienceType }

  const roles = cleanRoles(raw.roles)
  if (roles) target.roles = roles

  const days = cleanDays(raw.days)
  if (days !== null) target.days = days

  return target
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null
  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value))
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * Undefined when the key is absent or not an array at all. An array that
 * survives is deduped and stripped of names this build does not know, so it may
 * legitimately come back empty, which means "nobody".
 */
function cleanRoles(value: unknown): ViewerRole[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ViewerRole[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const role = entry as ViewerRole
    if (VIEWER_ROLES.includes(role) && !out.includes(role)) out.push(role)
  }
  return out
}

function cleanDays(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(MAX_NEW_ACCOUNT_DAYS, Math.max(MIN_NEW_ACCOUNT_DAYS, Math.trunc(n)))
}

// ── The rules ────────────────────────────────────────────────────────────────

/**
 * Has this person been here before. Two signals, either one is enough.
 *
 * The browser's own first-seen stamp is the primary one and the only one a
 * signed-out visitor has. An account older than the threshold is the fallback:
 * somebody who signed up last week is plainly returning, whatever the browser
 * they are holding today remembers.
 */
export function isReturning(viewer: AnnouncementViewer, now: Date): boolean {
  const at = msOf(now)
  return elapsed(viewer?.firstSeenAt, at) >= RETURNING_AFTER_MS
      || elapsed(viewer?.accountCreatedAt, at) >= RETURNING_AFTER_MS
}

/**
 * Does this viewer match this target. `target` is normally an AudienceTarget or
 * the raw jsonb straight off the row; null, undefined and anything unparseable
 * all match, per the fail-open rule in the header.
 */
export function matchesAudience(
  target: AudienceTarget | null | undefined | unknown,
  viewer: AnnouncementViewer,
  now: Date,
): boolean {
  const t = parseAudience(target)
  if (!t) return true

  const v = viewer ?? ANONYMOUS_VIEWER

  switch (t.type) {
    case 'all':
      return true
    case 'anonymous':
      return v.userId === null
    case 'authenticated':
      return v.userId !== null
    case 'role':
      return hasRole(v, t.roles)
    case 'new_accounts': {
      if (!isNewAccount(v, t.days ?? DEFAULT_NEW_ACCOUNT_DAYS, now)) return false
      // Roles are optional here. No roles means every new account.
      return !t.roles || t.roles.length === 0 || hasRole(v, t.roles)
    }
    case 'returning':
      return isReturning(v, now)
    case 'returning_anonymous':
      return isReturning(v, now) && v.userId === null
    default:
      return true
  }
}

/** Missing or empty roles match nobody. "Some roles" with none picked is a bug
 *  in the row, and showing it to everybody would be the wrong fail-open. */
function hasRole(viewer: AnnouncementViewer, roles: ViewerRole[] | undefined): boolean {
  if (!roles || roles.length === 0) return false
  return viewer.role !== null && roles.includes(viewer.role)
}

function isNewAccount(viewer: AnnouncementViewer, days: number, now: Date): boolean {
  if (!viewer.accountCreatedAt) return false
  const created = Date.parse(viewer.accountCreatedAt)
  if (!Number.isFinite(created)) return false
  const age = msOf(now) - created
  const span = Math.max(MIN_NEW_ACCOUNT_DAYS, days) * DAY_MS
  // Inclusive at the boundary, and a clock that thinks the account was made
  // ten minutes from now still counts as new rather than as never.
  return age <= span
}

// ── Choosing the one to show ─────────────────────────────────────────────────

/**
 * The row shape selectAnnouncement needs. Database naming is the primary
 * spelling; the camelCase pair is accepted too so a caller holding mapped
 * `Announcement` objects from marketing.ts does not have to rename fields on
 * the way in.
 */
export interface SelectableAnnouncement {
  id: string
  priority: number
  target_audience?: unknown
  targetAudience?: unknown
  created_at?: string
  createdAt?: string
}

/**
 * The single announcement to render, or null.
 *
 * Dismissed rows are dropped first, then the ones this viewer does not match,
 * then the best of what is left wins: highest priority, and newest among equal
 * priorities. Never mutates the array it is given.
 */
export function selectAnnouncement<T extends SelectableAnnouncement>(
  live: T[],
  viewer: AnnouncementViewer,
  now: Date,
  dismissedIds: string[] = [],
): T | null {
  if (!Array.isArray(live) || live.length === 0) return null
  const dismissed = new Set(dismissedIds ?? [])

  const candidates = live.filter(a =>
    a != null
    && !dismissed.has(a.id)
    && matchesAudience(audienceOf(a), viewer, now),
  )

  candidates.sort(byPriorityThenNewest)
  return candidates[0] ?? null
}

function audienceOf(a: SelectableAnnouncement): unknown {
  return a.target_audience !== undefined ? a.target_audience : a.targetAudience
}

function createdOf(a: SelectableAnnouncement): number {
  const raw = a.created_at ?? a.createdAt
  const t = raw ? Date.parse(raw) : NaN
  return Number.isFinite(t) ? t : 0
}

function byPriorityThenNewest(a: SelectableAnnouncement, b: SelectableAnnouncement): number {
  const pa = Number.isFinite(a.priority) ? a.priority : 0
  const pb = Number.isFinite(b.priority) ? b.priority : 0
  if (pa !== pb) return pb - pa
  return createdOf(b) - createdOf(a)
}

// ── First seen (the only stateful thing here) ────────────────────────────────
//
// One key, one ISO timestamp, written the first time a browser lands on a page
// that mounts the banner and never rewritten. That is the entire basis for
// "returning visitor", and it is deliberately this cheap: no cookie, no
// fingerprint, nothing that leaves the device.

/** The stamp, or null when there is none, when it is unreadable, or when there
 *  is no storage to read (server render, private mode, a locked-down browser). */
export function readFirstSeen(): string | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(FIRST_SEEN_KEY)
    if (!raw) return null
    return Number.isFinite(Date.parse(raw)) ? raw : null
  } catch {
    return null
  }
}

/** Writes the stamp once. A second call is a no-op, which is what makes the
 *  value mean "first seen" and not "last seen". */
export function recordFirstSeen(now: Date): void {
  const store = storage()
  if (!store) return
  try {
    if (store.getItem(FIRST_SEEN_KEY)) return
    store.setItem(FIRST_SEEN_KEY, new Date(msOf(now)).toISOString())
  } catch {
    /* full, blocked, or not there at all. Nothing here is worth an error. */
  }
}

interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function storage(): KeyValueStore | null {
  try {
    const store = (globalThis as { localStorage?: KeyValueStore }).localStorage
    return store ?? null
  } catch {
    return null
  }
}

// ── misc ─────────────────────────────────────────────────────────────────────

/** Milliseconds from a Date the caller may have built from a bad string. An
 *  invalid Date reads as "right now" rather than poisoning every comparison
 *  with NaN, which would silently answer false to every rule. */
function msOf(now: Date | number): number {
  const t = typeof now === 'number' ? now : now instanceof Date ? now.getTime() : NaN
  return Number.isFinite(t) ? t : Date.now()
}

/** Milliseconds since an ISO stamp, or -1 when there is nothing usable to
 *  measure from. Negative so it never clears a threshold. */
function elapsed(iso: string | null | undefined, at: number): number {
  if (!iso) return -1
  const t = Date.parse(iso)
  return Number.isFinite(t) ? at - t : -1
}
