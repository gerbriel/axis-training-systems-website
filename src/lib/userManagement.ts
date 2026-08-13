import { supabase, supabaseConfigured } from './supabase'
import { PROFILE_COLUMNS } from './account'
import type { Profile, ProfileStatus, UserRole } from './account'

/**
 * People, and what each of them may do.
 *
 * Two jobs live here and they are not the same job. The first is the ACCOUNT:
 * a row in `profiles` with a role and a status, and on an invite-gated site the
 * status is the front door — `handle_new_user` (011) parks a stranger at
 * `pending` and somebody has to walk over and open it. The second is the
 * EXCEPTION: a permission a person holds, or is denied, against what their role
 * would give them on its own.
 *
 * The role is the baseline, always. `role_permissions` says what a coach gets
 * for being a coach; `staff_permissions` records the handful of times an admin
 * decided otherwise for one person. No row means "whatever the role says",
 * which is why clearing an exception is a DELETE and not a write of `false` —
 * a stored `false` is a decision someone made, and the screen has to be able to
 * tell those apart.
 *
 * Everything here is SIGNAGE. The refusals below are written so a person reads
 * a sentence instead of hitting a wall, but the wall is the RLS policy and the
 * `profiles_guard_privileges` trigger in 011 — a client that skipped every
 * check in this file would still be refused by the database. Nothing here is
 * load-bearing for security and nothing here should be treated as if it were.
 *
 * Nothing throws. Every failure is a value, because every caller is a screen
 * that has to say something.
 */

// ---------------------------------------------------------------------------
// The contract with migration 014
// ---------------------------------------------------------------------------

/** One row of `permissions`. Never more columns than a screen renders. */
export interface Permission {
  key: string
  label: string
  description: string
  /**
   * Admin-only to GRANT — a statement about whoever is handing it over, not
   * about who receives it. `can_grant_permission` lets an admin give one of
   * these to a coach; it refuses a coach doing the same, however many
   * permissions that coach holds. An unknown key counts as sensitive, so a
   * catalogue that has fallen behind fails closed.
   */
  is_sensitive: boolean
}

export const PERMISSION_COLUMNS = 'key,label,description,is_sensitive'
export const ROLE_PERMISSION_COLUMNS = 'role,permission'
export const STAFF_PERMISSION_COLUMNS = 'profile_id,permission,granted,granted_by,granted_at,note'

/** One row of `staff_permissions` — an exception, recorded against one person. */
export interface PermissionOverride {
  profile_id: string
  permission: string
  granted: boolean
  granted_by: string | null
  granted_at: string
  note: string | null
}

/**
 * Three states, not two. `default` is the ABSENCE of a row and it is the state
 * almost every cell is in; `allow` and `deny` are both rows, and a `deny` on a
 * permission the role already grants is the only way to take one thing away
 * without demoting somebody.
 */
export type PermissionState = 'default' | 'allow' | 'deny'

export const stateOf = (granted: boolean): PermissionState => (granted ? 'allow' : 'deny')

/**
 * The catalog, mirrored in code.
 *
 * `permissions` is the authority and `fetchPermissionCatalog` always prefers
 * it. This copy exists for two cases that would otherwise render an empty
 * editor: demo mode, which has no database at all, and the window between this
 * screen shipping and 014 being applied. A key here that 014 does not define
 * cannot be granted — the foreign key refuses the insert — so the worst this
 * can do is offer a switch that reports a clear failure when flipped.
 */
export const PERMISSION_CATALOG: Permission[] = [
  { key: 'view_own_calendar',       label: 'See their own calendar',        description: 'Their own bookings and working hours.', is_sensitive: false },
  { key: 'view_all_calendars',      label: 'See every calendar',            description: "The whole roster's day, not just their own column.", is_sensitive: false },
  { key: 'manage_own_availability', label: 'Set their own hours',           description: 'Their weekly schedule, blocks, and time off.', is_sensitive: false },
  { key: 'manage_bookings_all',     label: 'Manage every booking',          description: "Confirm, reschedule, annotate and cancel on anybody's calendar.", is_sensitive: false },
  { key: 'manage_services',         label: 'Edit what Axis offers',         description: 'Add, retire and reword services and their durations.', is_sensitive: false },
  { key: 'manage_pricing',          label: 'Change prices',                 description: 'What a service costs, including per-coach overrides.', is_sensitive: false },
  { key: 'manage_leads',            label: 'Work the application queue',    description: 'Triage, assign, annotate and close incoming applications.', is_sensitive: false },
  { key: 'view_lead_contact',       label: 'See applicant contact details', description: 'The email address, phone number and socials on an application. The rest of a lead, lifts and history and goals, is readable without this.', is_sensitive: false },
  { key: 'manage_athletes',         label: 'Manage athletes',               description: 'Athlete records: profile, history, and adding somebody new.', is_sensitive: false },
  { key: 'manage_staff',            label: 'Manage staff',                  description: 'Add and edit coach records, calendars and roster placement.', is_sensitive: true },
  { key: 'manage_permissions',      label: 'Manage permissions',            description: 'Change what other people may do. It is the power to grant everything else.', is_sensitive: true },
  { key: 'manage_content',          label: 'Edit the site',                 description: 'Public copy, programme pages and the media library.', is_sensitive: false },
  { key: 'moderate_testimonials',   label: 'Moderate testimonials',         description: 'Approve, hide and respond to what athletes have written.', is_sensitive: false },
  { key: 'view_analytics',          label: 'See analytics',                 description: 'Bookings, conversion, and where applications are coming from.', is_sensitive: false },
  { key: 'send_marketing',          label: 'Send marketing',                description: 'Newsletters and broadcast email.', is_sensitive: false },
  { key: 'manage_site_settings',    label: 'Change site settings',          description: 'Booking policy, coach routing, integrations and keys.', is_sensitive: true },
]

const ALL_KEYS = PERMISSION_CATALOG.map(p => p.key)

/**
 * What each role holds before anyone decides anything. Mirrors the seed rows in
 * `role_permissions` for the same reason the catalog is mirrored — and is
 * replaced by the table's own answer the moment one can be fetched.
 *
 * An athlete holds nothing, and 014 does not even write athlete rows into
 * `role_permissions` — a row saying "no" would be a second place the answer
 * could be edited. The guard refuses an override on an athlete outright:
 * permissions are for staff.
 */
export const ROLE_DEFAULTS: Record<UserRole, string[]> = {
  athlete: [],
  coach: [
    'view_own_calendar',
    'manage_own_availability',
    'manage_leads',
    'view_lead_contact',
    'manage_athletes',
    'manage_content',
    'view_analytics',
  ],
  admin: ALL_KEYS,
}

export type WriteResult = { ok: true } | { ok: false; message: string }

// ---------------------------------------------------------------------------
// Failure, in sentences
// ---------------------------------------------------------------------------

/**
 * What a PostgREST error becomes on screen.
 *
 * `P0001` and `22023` are `raise exception`s from our own triggers and
 * functions, and 014 writes those as sentences aimed at a person — "Permissions
 * are for staff. Make them a coach first." reads better than anything this
 * function could invent, so they are passed through verbatim. That is the whole
 * reason writes go through `set_staff_permission` rather than straight at the
 * table: the same refusal arrives as a sentence instead of "new row violates
 * row-level security policy for table staff_permissions". Everything else is
 * plumbing and gets translated.
 */
function writeMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  const code = error.code ?? ''
  const msg = (error.message ?? '').replace(/^ERROR:\s*/i, '').trim()

  if ((code === 'P0001' || code === '22023') && msg) return msg
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'The database refused that change. Your account may not have permission any more — sign out, sign back in, and try again.'
  }
  if (code === '23505') return 'That coach page name already belongs to somebody else. Pick another.'
  if (code === '23514') return 'That combination is not allowed. An athlete cannot hold a coach page, and a coach page can only contain lowercase letters, numbers and hyphens.'
  if (code === '23503') return 'That permission no longer exists. Refresh the screen and try again.'
  if (code === 'PGRST301' || /jwt|token is expired/i.test(msg)) {
    return 'Your session expired. Sign in again and the change will go through.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection — nothing was changed.'
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

const demoIso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()

/**
 * Eight people and one exception, chosen so every branch of the screen has
 * something to act on: two pending athletes and a pending coach for the
 * approval queue, three live staff, a suspended athlete to reinstate, and a
 * suspended administrator — which leaves exactly ONE active admin, so the
 * last-administrator refusal fires the first time anyone tries to demote
 * themselves rather than being a paragraph nobody ever sees.
 */
const DEMO_PEOPLE_SEED: Profile[] = [
  { id: 'demo-ronnie', email: 'ronnie@axistrainingsystems.com', first_name: 'Ronnie', last_name: 'Vallejo', display_name: 'Ronnie Vallejo', avatar_url: null, phone: '(559) 555-0114', role: 'admin',   status: 'active',    coach_slug: 'ronnie-vallejo', created_at: demoIso(420) },
  { id: 'demo-seth',   email: 'seth@axistrainingsystems.com',   first_name: 'Seth',   last_name: 'Burman',  display_name: 'Seth Burman',   avatar_url: null, phone: null,             role: 'coach',   status: 'active',    coach_slug: 'seth-burman',    created_at: demoIso(360) },
  { id: 'demo-lucas',  email: 'lucas@axistrainingsystems.com',  first_name: 'Lucas',  last_name: 'Sison',   display_name: 'Lucas Sison',   avatar_url: null, phone: null,             role: 'coach',   status: 'active',    coach_slug: 'lucas-sison',    created_at: demoIso(300) },
  { id: 'demo-aedan',  email: 'aedan@axistrainingsystems.com',  first_name: 'Aedan',  last_name: 'Nguyen',  display_name: 'Aedan Nguyen',  avatar_url: null, phone: null,             role: 'admin',   status: 'suspended', coach_slug: 'aedan-nguyen',   created_at: demoIso(280) },
  { id: 'demo-kobe',   email: 'kobe.pham@gmail.com',            first_name: 'Kobe',   last_name: 'Pham',    display_name: 'Kobe Pham',     avatar_url: null, phone: '(559) 555-0188', role: 'coach',   status: 'pending',   coach_slug: null,             created_at: demoIso(2) },
  { id: 'demo-marcus', email: 'marcus.r@gmail.com',             first_name: 'Marcus', last_name: 'Rivera',  display_name: 'Marcus Rivera', avatar_url: null, phone: '(559) 555-0132', role: 'athlete', status: 'pending',   coach_slug: null,             created_at: demoIso(0) },
  { id: 'demo-bianca', email: 'bianca.reyes@gmail.com',         first_name: 'Bianca', last_name: 'Reyes',   display_name: 'Bianca Reyes',  avatar_url: null, phone: null,             role: 'athlete', status: 'pending',   coach_slug: null,             created_at: demoIso(1) },
  { id: 'demo-devin',  email: 'devin.cross@gmail.com',          first_name: 'Devin',  last_name: 'Cross',   display_name: 'Devin Cross',   avatar_url: null, phone: '(559) 555-0177', role: 'athlete', status: 'active',    coach_slug: null,             created_at: demoIso(95) },
  { id: 'demo-tyler',  email: 'tyler.vance@gmail.com',          first_name: 'Tyler',  last_name: 'Vance',   display_name: 'Tyler Vance',   avatar_url: null, phone: null,             role: 'athlete', status: 'suspended', coach_slug: null,             created_at: demoIso(210) },
]

const DEMO_OVERRIDES_SEED: PermissionOverride[] = [
  // Lucas covers the whole roster's calendar while Ronnie is at a meet — a
  // grant of something his role does not give him.
  { profile_id: 'demo-lucas', permission: 'view_all_calendars', granted: true,  granted_by: 'demo-ronnie', granted_at: demoIso(12), note: 'Covering the roster during meet season.' },
  // Seth asked not to have client phone numbers on his screen — a denial of
  // something his role DOES give him, which is the direction people forget is
  // possible.
  { profile_id: 'demo-seth',  permission: 'view_lead_contact',  granted: false, granted_by: 'demo-ronnie', granted_at: demoIso(40), note: null },
]

// Seeded on first access and mutated in place, so a demo walk-through survives
// a tab change. Resets on reload, which is the promise the demo banner makes.
let demoPeople: Profile[] | null = null
let demoOverrides: PermissionOverride[] | null = null

function peopleStore(): Profile[] {
  if (!demoPeople) demoPeople = DEMO_PEOPLE_SEED.map(p => ({ ...p }))
  return demoPeople
}

function overrideStore(): PermissionOverride[] {
  if (!demoOverrides) demoOverrides = DEMO_OVERRIDES_SEED.map(o => ({ ...o }))
  return demoOverrides
}

/** Demo writes are instant; a beat of latency keeps the saving states honest. */
const beat = () => new Promise<void>(r => setTimeout(r, 260))

/**
 * Demo mode and "no credentials configured" are the same situation from a
 * screen's point of view: there is nothing to talk to, and the screen must
 * still render. Every function below routes on this, never on `isDemo` alone.
 */
const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Everybody, newest first.
 *
 * `null` is the outage signal and `[]` is genuinely nobody — the panel says
 * something different for each, because "no accounts" on a site with accounts
 * is a lie that looks like data.
 */
export async function fetchPeople(isDemo = false): Promise<Profile[] | null> {
  if (offline(isDemo)) return peopleStore().map(p => ({ ...p }))

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) return null
  return (data ?? []) as unknown as Profile[]
}

/** The catalog, preferring the table and falling back to the code copy. */
export async function fetchPermissionCatalog(isDemo = false): Promise<Permission[]> {
  if (offline(isDemo)) return PERMISSION_CATALOG.map(p => ({ ...p }))

  const { data, error } = await supabase
    .from('permissions')
    .select(PERMISSION_COLUMNS)
    .order('is_sensitive', { ascending: true })
    .order('key', { ascending: true })

  const rows = (data ?? []) as unknown as Permission[]
  if (error || rows.length === 0) return PERMISSION_CATALOG.map(p => ({ ...p }))
  return rows
}

/** What each role holds, preferring `role_permissions` over the code copy. */
export async function fetchRoleDefaults(isDemo = false): Promise<Record<UserRole, string[]>> {
  if (offline(isDemo)) return { athlete: [...ROLE_DEFAULTS.athlete], coach: [...ROLE_DEFAULTS.coach], admin: [...ROLE_DEFAULTS.admin] }

  const { data, error } = await supabase
    .from('role_permissions')
    .select(ROLE_PERMISSION_COLUMNS)

  const rows = (data ?? []) as unknown as { role: UserRole; permission: string }[]
  if (error || rows.length === 0) {
    return { athlete: [...ROLE_DEFAULTS.athlete], coach: [...ROLE_DEFAULTS.coach], admin: [...ROLE_DEFAULTS.admin] }
  }

  const out: Record<UserRole, string[]> = { athlete: [], coach: [], admin: [] }
  for (const row of rows) {
    if (row.role in out) out[row.role].push(row.permission)
  }
  return out
}

/** The exceptions recorded against one person. `null` is an outage. */
export async function fetchOverrides(profileId: string, isDemo = false): Promise<PermissionOverride[] | null> {
  if (offline(isDemo)) return overrideStore().filter(o => o.profile_id === profileId).map(o => ({ ...o }))

  const { data, error } = await supabase
    .from('staff_permissions')
    .select(STAFF_PERMISSION_COLUMNS)
    .eq('profile_id', profileId)

  if (error) return null
  return (data ?? []) as unknown as PermissionOverride[]
}

/**
 * Asks the database whether the SIGNED-IN person holds a permission.
 *
 * Returns `null` when the question could not be asked — 014 not applied yet, an
 * expired token, an outage — which a caller must not read as "no". A screen
 * that hides itself because it could not reach the server has turned a blip
 * into a lockout, so the panel falls back to the role it already knows.
 */
export async function hasPermission(key: string, isDemo = false): Promise<boolean | null> {
  if (offline(isDemo)) return true
  const { data, error } = await supabase.rpc('has_permission', { p_permission: key })
  if (error) return null
  return data === true
}

// ---------------------------------------------------------------------------
// Effective permissions
// ---------------------------------------------------------------------------

export interface PermissionRow {
  permission: Permission
  /** True when the role alone would grant this. */
  fromRole: boolean
  state: PermissionState
  /** What the person actually holds once the exception is applied. */
  effective: boolean
  /** The exception behind a non-default state, when there is a stored one. */
  override: PermissionOverride | null
  /** Non-null when the row must not be edited, and says why in one sentence. */
  lockedReason: string | null
}

/** Who is doing the editing. Every lock below is a fact about this person. */
export interface Viewer {
  id: string | null
  isAdmin: boolean
}

/**
 * Role default ∪ overrides, override wins.
 *
 * `draft` is what the editor currently shows, not what is stored — the editor
 * is choose-then-save, so this is called on every keystroke of the segmented
 * control and must stay cheap and pure.
 */
export function buildPermissionRows(
  target: Profile,
  catalog: Permission[],
  roleDefaults: Record<UserRole, string[]>,
  draft: Record<string, PermissionState>,
  stored: PermissionOverride[],
  viewer: Viewer,
): PermissionRow[] {
  const defaults = new Set(roleDefaults[target.role] ?? [])
  const storedByKey = new Map(stored.map(o => [o.permission, o]))

  return catalog.map(permission => {
    const fromRole = defaults.has(permission.key)
    const state = draft[permission.key] ?? 'default'
    return {
      permission,
      fromRole,
      state,
      effective: state === 'allow' ? true : state === 'deny' ? false : fromRole,
      override: storedByKey.get(permission.key) ?? null,
      lockedReason: permissionLock(permission, target, viewer),
    }
  })
}

/**
 * Why a row cannot be edited, or null. Every sentence here is one 014's guard
 * would raise anyway; saying it before the round trip is the only difference.
 *
 * The order matters, because the reasons are about different things. Whether an
 * override may exist AT ALL is a fact about the TARGET — the guard refuses one
 * on an athlete ("permissions are for staff") and on an admin (who
 * short-circuits every check in `profile_has_permission`, so a tick here would
 * hide a button and stop nothing, which is worse than doing nothing). Only a
 * coach can carry an exception.
 *
 * Whether THIS permission may be handed over is a fact about the VIEWER:
 * `is_sensitive` is admin-only to GRANT, not admin-only to hold. An admin may
 * give `manage_permissions` to a coach; a coach who already holds it may not
 * pass it on. Reading the flag as a rule about the target — which is the
 * intuitive misreading — would grey out rows an admin is entitled to use.
 */
export function permissionLock(permission: Permission, target: Profile, viewer: Viewer): string | null {
  if (target.role === 'athlete') {
    return 'Permissions are for staff. Make them a coach first.'
  }
  if (target.role === 'admin') {
    return 'An administrator already passes every check in the database, so a change here would hide a button without stopping anything. Change their role instead.'
  }
  if (viewer.id && target.id === viewer.id) {
    return 'You cannot change your own permissions. Somebody else has to.'
  }
  if (permission.is_sensitive && !viewer.isAdmin) {
    return 'Only an administrator can hand this one over.'
  }
  return null
}

/** The draft an editor opens with: every stored exception, nothing else. */
export function draftFromOverrides(overrides: PermissionOverride[]): Record<string, PermissionState> {
  const draft: Record<string, PermissionState> = {}
  for (const o of overrides) draft[o.permission] = stateOf(o.granted)
  return draft
}

/** Keys whose state differs between two drafts. Drives the unsaved badge. */
export function changedKeys(
  before: Record<string, PermissionState>,
  after: Record<string, PermissionState>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter(k => (before[k] ?? 'default') !== (after[k] ?? 'default'))
}

// ---------------------------------------------------------------------------
// Client-side refusals — signage, not security
// ---------------------------------------------------------------------------

export const COACH_SLUG_PATTERN = /^[a-z0-9-]+$/

/** Active administrators, counted from the list already on screen. */
export function countActiveAdmins(people: Profile[]): number {
  return people.filter(p => p.role === 'admin' && p.status === 'active').length
}

/**
 * Why a role change must not be attempted, or null.
 *
 * The case that matters is the last active administrator demoting themselves,
 * and it is one-way. `profiles_guard_privileges` (011) clamps `role` for anyone
 * who is not an active admin, so the moment the last one stops being one, the
 * only route back into the site's own controls is the SQL editor.
 *
 * READ THIS BEFORE TRUSTING IT. Every other refusal on this screen restates
 * something the database enforces anyway. This one does not: 011 deliberately
 * does NOT check that the writer is not the subject — "an admin editing their
 * own row is fine" — and nothing in 011 or 014 counts the admins that are left.
 * So this check is not signage over a wall, it is signage over a HOLE, and it
 * is defeated by a client that skips it, by two admins demoting each other in
 * the same second, and by a stale `people` list. The durable fix is a trigger
 * on `profiles` that refuses the last active admin's demotion or suspension;
 * until that migration exists, this stops the accident and nothing more.
 */
export function roleChangeRefusal(
  target: Profile,
  nextRole: UserRole,
  nextSlug: string | null,
  people: Profile[],
  viewerId: string | null,
): string | null {
  if (nextRole !== target.role && target.role === 'admin' && target.status === 'active' && countActiveAdmins(people) <= 1) {
    return target.id === viewerId
      ? 'You are the only active administrator. Make somebody else an administrator first — if you demote yourself now, nobody can approve accounts or change roles, including you.'
      : 'This is the only active administrator. Make somebody else an administrator first, or nobody can approve accounts or change roles.'
  }

  if (nextRole === 'athlete' && nextSlug) {
    return 'An athlete cannot hold a coach page. Clear the coach page name, or keep them on staff.'
  }

  if (nextRole === 'coach' && !nextSlug) {
    return 'A coach needs a coach page name — it is the calendar, schedule and bookings they take over.'
  }

  if (nextSlug !== null && nextSlug !== '' && !COACH_SLUG_PATTERN.test(nextSlug)) {
    return 'A coach page name can only contain lowercase letters, numbers and hyphens — like ronnie-vallejo.'
  }

  if (nextSlug) {
    const taken = people.find(p => p.id !== target.id && p.coach_slug === nextSlug)
    if (taken) return `${personName(taken)} already has that coach page. One person per calendar.`
  }

  return null
}

/**
 * Why a status change must not be attempted, or null. Suspending the last
 * active administrator ends in the same place demoting them does, and carries
 * the same caveat: no trigger enforces this yet.
 */
export function statusChangeRefusal(
  target: Profile,
  nextStatus: ProfileStatus,
  people: Profile[],
  viewerId: string | null,
): string | null {
  if (nextStatus === 'active') return null
  if (target.role !== 'admin' || target.status !== 'active') return null
  if (countActiveAdmins(people) > 1) return null

  return target.id === viewerId
    ? 'You are the only active administrator. Suspending your own account locks everyone out of these controls, including you.'
    : 'This is the only active administrator. Suspending them locks everyone out of these controls.'
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Approve, decline, suspend, reinstate — all one column.
 *
 * The caller applies the change locally first and reverts on a failure, so this
 * only has to answer honestly.
 */
export async function updateStatus(profileId: string, status: ProfileStatus, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) {
    await beat()
    const row = peopleStore().find(p => p.id === profileId)
    if (!row) return { ok: false, message: 'That account is no longer in the list.' }
    row.status = status
    return { ok: true }
  }

  const { error } = await supabase.from('profiles').update({ status }).eq('id', profileId)
  if (error) return { ok: false, message: writeMessage(error, 'Could not change that account. Please try again.') }
  return { ok: true }
}

/**
 * Role and coach page in one write, because they are one decision.
 *
 * Sending them separately means a window where a coach exists with no calendar
 * or an athlete still owns one, and `profiles_coach_slug_is_staff` (011) would
 * refuse the first half anyway.
 *
 * A ROLE CHANGE WIPES THEIR EXCEPTIONS. `clear_permission_overrides_on_role_change`
 * (014) deletes every `staff_permissions` row for the profile, on the reasoning
 * that an exception was granted against a role and means nothing once that role
 * is gone. Any screen showing permissions has to refetch after this returns, or
 * it is displaying a set the database has already thrown away.
 */
export async function updateRole(
  profileId: string,
  role: UserRole,
  coachSlug: string | null,
  isDemo = false,
): Promise<WriteResult> {
  const slug = role === 'athlete' ? null : (coachSlug?.trim() || null)

  if (offline(isDemo)) {
    await beat()
    const store = peopleStore()
    const row = store.find(p => p.id === profileId)
    if (!row) return { ok: false, message: 'That account is no longer in the list.' }
    if (slug && store.some(p => p.id !== profileId && p.coach_slug === slug)) {
      return { ok: false, message: 'That coach page name already belongs to somebody else. Pick another.' }
    }
    row.role = role
    row.coach_slug = slug
    return { ok: true }
  }

  const { error } = await supabase.from('profiles').update({ role, coach_slug: slug }).eq('id', profileId)
  if (error) return { ok: false, message: writeMessage(error, 'Could not change that role. Please try again.') }
  return { ok: true }
}

export interface OverrideChange {
  permission: string
  state: PermissionState
}

/**
 * Saves a batch of exceptions for one person, one call per change.
 *
 * `set_staff_permission` is the write path rather than the table, and that is a
 * deliberate trade of round trips for sentences: the guard raises with
 * `errcode 22023` and a line written for a human — "You cannot grant yourself a
 * permission", "Permissions are for staff. Make them a coach first." — where a
 * direct insert would be refused by RLS with "new row violates row-level
 * security policy". The RPC also stamps `granted_by` from `auth.uid()` itself,
 * which is exactly the signed-in admin and cannot be argued with; `grantedBy`
 * below is used only by the demo store, which has no session to read.
 *
 * `p_granted = null` CLEARS. The absence of a row is how the schema says
 * "whatever the role gives", so a cleared row must be deleted rather than
 * written as `false` — a stored `false` would pin the person to today's role
 * defaults for ever.
 *
 * Serial, not parallel, and it stops at the first refusal. Firing sixteen
 * mutations at once and reporting the last error to come back leaves nobody
 * able to say which ones landed.
 */
export async function savePermissionOverrides(
  profileId: string,
  changes: OverrideChange[],
  grantedBy: string | null,
  note: string | null,
  isDemo = false,
): Promise<WriteResult> {
  if (changes.length === 0) return { ok: true }

  const trimmedNote = note?.trim() ? note.trim().slice(0, 500) : null

  if (offline(isDemo)) {
    await beat()
    const stamp = new Date().toISOString()
    let store = overrideStore()
    const cleared = changes.filter(c => c.state === 'default').map(c => c.permission)
    store = store.filter(o => !(o.profile_id === profileId && cleared.includes(o.permission)))
    for (const c of changes.filter(c => c.state !== 'default')) {
      const next: PermissionOverride = {
        profile_id: profileId,
        permission: c.permission,
        granted: c.state === 'allow',
        granted_by: grantedBy,
        granted_at: stamp,
        note: trimmedNote,
      }
      const existing = store.find(o => o.profile_id === profileId && o.permission === c.permission)
      if (existing) Object.assign(existing, next)
      else store.push(next)
    }
    demoOverrides = store
    return { ok: true }
  }

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    const { error } = await supabase.rpc('set_staff_permission', {
      p_profile: profileId,
      p_permission: change.permission,
      // null clears, true grants, false takes away.
      p_granted: change.state === 'default' ? null : change.state === 'allow',
      p_note: change.state === 'default' ? null : trimmedNote,
    })

    if (error) {
      const said = writeMessage(error, 'Could not save that permission.')
      // Saying how far it got is the difference between "try again" and
      // "reopen this person and look" — and after a partial batch, only one of
      // those is honest.
      return {
        ok: false,
        message: i === 0
          ? `${said} Nothing was changed.`
          : `${said} The first ${i} change${i === 1 ? '' : 's'} did save.`,
      }
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** A name to put on a row. Falls back through display name, real name, mailbox. */
export function personName(p: Profile): string {
  const display = p.display_name?.trim()
  if (display) return display
  const full = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()
  if (full) return full
  return p.email.split('@')[0] || p.email
}

/** Two letters for the avatar circle. */
export function personInitials(p: Profile): string {
  const name = personName(p)
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

/**
 * Pending first, always. This list is an approval queue that happens to also be
 * a directory — somebody waiting on a human decision must never be below the
 * fold behind two hundred settled accounts.
 */
const STATUS_RANK: Record<ProfileStatus, number> = { pending: 0, active: 1, suspended: 2 }

export function sortPeople(people: Profile[]): Profile[] {
  return [...people].sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (rank !== 0) return rank
    return b.created_at.localeCompare(a.created_at)
  })
}

/** Name, email and coach page, case-insensitively. */
export function matchesSearch(p: Profile, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [personName(p), p.email, p.first_name, p.last_name, p.coach_slug]
    .some(v => v?.toLowerCase().includes(q))
}

export const ROLE_LABELS: Record<UserRole, string> = {
  athlete: 'Athlete',
  coach: 'Coach',
  admin: 'Administrator',
}

export const STATUS_LABELS: Record<ProfileStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  suspended: 'Suspended',
}

/** Yellow for waiting, green for in, grey for out. The same language the invitations panel speaks. */
export const STATUS_COLORS: Record<ProfileStatus, string> = {
  pending: '#eab308',
  active: '#22c55e',
  suspended: 'var(--text-4)',
}

export const ROLE_COLORS: Record<UserRole, string> = {
  athlete: 'var(--text-3)',
  coach: '#272C84',
  admin: '#c8102e',
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "3 days ago" for the approval queue, where age is the whole argument. */
export function waitingFor(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}
