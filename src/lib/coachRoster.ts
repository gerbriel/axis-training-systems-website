import { supabase, supabaseConfigured } from './supabase.ts'
import { COACHES } from '../data/coaches.ts'
import { fetchAllCoachProfiles, fetchVisibleCoachProfiles, saveCoachProfile, toCoachShape } from './coachProfiles.ts'
import type { CoachProfileRow } from './coachProfiles.ts'
import type { InvitationState } from './invitations.ts'
import type { ProfileStatus, UserRole } from './account.ts'
import type { WriteResult } from '../types/messaging.ts'
import { isValidEmail, sanitizeEmail } from '../utils/sanitize.ts'

/**
 * The roster, assembled from the four places a coach actually lives.
 *
 * There are four registries and nothing joins them:
 *
 *   `data/coaches.ts`      the static five. Still the fallback every public
 *                          surface paints while the database is answering, and
 *                          still the source of `email` for those five.
 *   `coach_routing`        which calendar a booking lands on, which inbox a lead
 *                          goes to, and the address `handle_new_user` (011) will
 *                          admit an account for.
 *   `coach_public_settings` the switch that makes a coach BOOKABLE. Without a
 *                          row, `loadCoachPolicy` returns null and both booking
 *                          edge functions answer 404 unknown_coach.
 *   `coach_profiles` (032) the public page: copy, photo, position, visibility.
 *
 * `profiles.coach_slug` is a fifth thing and is deliberately not written from
 * here: it is the AUTHORIZATION key (`current_coach_slug()`), and it is set by
 * claiming an invitation, which is the coach's own act.
 *
 * This module reads those four and offers two views of them:
 *
 *   `fetchCoachRoster`     what the PUBLIC site needs. Slug, name, photo, and
 *                          whether the Book button should be shown at all.
 *   `fetchCoachDirectory`  what a STAFF screen needs. The same people with the
 *                          state of their wiring and their account spelled out,
 *                          so "why can nobody book Nia" has an answer on screen.
 *
 * Nothing here throws. `fetchCoachDirectory` answers `null` for an outage,
 * because a staff screen that cannot read the truth must say so rather than
 * draw chips that are guesses. `fetchCoachRoster` never answers null and never
 * answers an empty list because of an outage: it falls back to the static five,
 * for exactly the reason `Coaches.tsx` already does. The roster section is above
 * the fold and does not get to be blank because a database was slow.
 *
 * IMPORT NOTE, worth knowing before adding one. `tests/coachRoster.test.ts`
 * loads this module under `node --test`, whose ESM resolver does not guess file
 * extensions. Every runtime import above therefore names a `.ts` file.
 * `invitations.ts` and `userManagement.ts` import `'./supabase'` without one, so
 * they are imported here for TYPES only (erased at build) and the two small
 * reads this module needs from their tables are written out below.
 */

// ---------------------------------------------------------------------------
// What a screen renders
// ---------------------------------------------------------------------------

/**
 * One coach, as a picker, a card or a roster row needs them.
 *
 * `email` is the STATIC entry's address for the five, and the directory's for
 * anybody else. It is null for a coach who exists only as a `coach_profiles`
 * row, and a null here is not a login: nothing authorizes anybody by comparing
 * this field. See the note on `toCoachShape` in coachProfiles.ts.
 *
 * `bookable` means "has a coach_public_settings row", which is the one fact that
 * decides whether /book can produce a slot for them.
 */
export interface RosterCoach {
  slug: string
  name: string
  firstName: string
  roleTitle: string | null
  photo: string | null
  email: string | null
  bookable: boolean
  source: 'db' | 'static'
}

/** One coach as a staff screen needs them: the wiring, and who holds it. */
export interface CoachDirectoryEntry {
  slug: string
  name: string
  email: string | null
  /**
   * The id of the `coach_routing` row this address came off, or null when there
   * is none. It is here because the address is EDITABLE from the directory and
   * an update needs a row to name; it is not an identifier a screen prints.
   */
  routingId: string | null
  hasRouting: boolean
  hasPublicProfile: boolean
  hasBookingSettings: boolean
  /**
   * Whether this coach has a Google Calendar connection (007), which is the one
   * thing that decides whether their bookings can carry a Meet link.
   *
   * Three values, and the third is the one that matters. `true` connected,
   * `false` not connected, `null` NOT KNOWN: the RPC was refused, failed, or was
   * never asked. A staff screen must draw nothing at all for null rather than
   * accusing a coach of a gap on the strength of an outage.
   *
   * Not the same question as `hasBookingSettings`. A coach can be perfectly
   * bookable and unconnected; their bookings go through and land as 'skipped'.
   */
  calendarConnected: boolean | null
  /** The `profiles` row carrying this slug. Null means nobody has claimed it. */
  account: { id: string; status: ProfileStatus; email: string } | null
  /** The newest invitation aimed at this calendar. Null means none was ever sent. */
  invitation: { id: number; state: InvitationState; expires_at: string; email: string } | null
}

/** What `provision_coach` (036) takes. Only slug, name and email are required. */
export interface ProvisionCoachInput {
  slug: string
  name: string
  firstName?: string
  email: string
  roleTitle?: string
  timeZone?: string
}

// ---------------------------------------------------------------------------
// The contract with the tables
// ---------------------------------------------------------------------------

/**
 * `coach_routing`, narrowed to what a directory draws.
 *
 * Not `select('*')`, which AdminSettings uses because it edits the whole row.
 * `notify` and `is_admin` are somebody else's screen.
 */
export interface CoachRoutingRow {
  id: string
  coach_name: string
  email: string | null
  coach_slug: string | null
}

export const COACH_ROUTING_COLUMNS = 'id,coach_name,email,coach_slug'

/** A `profiles` row that holds a coach slug. Four columns; a directory needs no more. */
export interface CoachAccountRow {
  id: string
  email: string
  status: ProfileStatus
  coach_slug: string | null
}

export const COACH_ACCOUNT_COLUMNS = 'id,email,status,coach_slug'

/**
 * An `invitations` row, as this module reads it.
 *
 * `token_hash` is not here for the reason 012 gives, and neither is anything
 * else a chip does not print. The state is derived rather than stored, exactly
 * as `invitationState` in invitations.ts derives it.
 */
export interface CoachInvitationRow {
  id: number
  email: string
  role: UserRole
  coach_slug: string | null
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  created_at: string
}

export const COACH_INVITATION_COLUMNS =
  'id,email,role,coach_slug,expires_at,accepted_at,revoked_at,created_at'

/** 036's shape check, restated so a typed slug is refused here rather than by the RPC. */
export const COACH_SLUG_SHAPE = /^[a-z0-9-]{1,64}$/

/** Demo mode and "no credentials" are the same situation to a screen: nothing to talk to. */
const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

/** Demo writes are instant; a beat of latency keeps the saving states honest. */
const beat = () => new Promise<void>(r => setTimeout(r, 220))

const STATIC_SLUGS = new Set<string>(COACHES.map(c => c.slug))
const STATIC_BY_SLUG = new Map<string, (typeof COACHES)[number]>(COACHES.map(c => [c.slug as string, c]))

const trimmed = (value: string | null | undefined): string | null => {
  const text = (value ?? '').trim()
  return text ? text : null
}

// ---------------------------------------------------------------------------
// The pure half
// ---------------------------------------------------------------------------
//
// Everything below this line is a join, and every join in this file is written
// as a function of its inputs so it can be tested without a network. The fetches
// further down do nothing but gather rows and hand them here.

/**
 * A static entry, as a roster row.
 *
 * `bookable` is not decided here. It is the caller's, because the same static
 * entry is bookable when the wiring says so and, during an outage when nothing
 * says anything, is assumed bookable: the five have taken bookings since before
 * any of these tables existed.
 */
function fromStatic(coach: (typeof COACHES)[number], bookable: boolean): RosterCoach {
  return {
    slug: coach.slug,
    name: coach.name,
    firstName: coach.firstName || coach.name.split(' ')[0] || coach.name,
    roleTitle: trimmed(coach.role),
    photo: coach.photo ?? null,
    email: trimmed(coach.email),
    bookable,
    source: 'static',
  }
}

/** A `coach_profiles` row, as a roster row. Identity comes off the static twin, as ever. */
function fromProfile(row: CoachProfileRow, bookable: boolean): RosterCoach {
  const coach = toCoachShape(row)
  return {
    slug: coach.slug,
    name: coach.name,
    firstName: coach.firstName,
    roleTitle: trimmed(coach.role),
    photo: coach.photo ?? null,
    // toCoachShape answers '' for a coach with no static entry. Null says the
    // same thing without pretending to be an address.
    email: trimmed(coach.email),
    bookable,
    source: 'db',
  }
}

/**
 * Every slug the roster will mention, database rows and static entries together.
 *
 * Asked before the wiring lookup, because that lookup takes the whole list and
 * answers in one round trip.
 */
export function rosterSlugs(rows: CoachProfileRow[] | null): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const row of rows ?? []) {
    if (!row.slug || seen.has(row.slug)) continue
    seen.add(row.slug)
    out.push(row.slug)
  }
  for (const coach of COACHES) {
    if (seen.has(coach.slug)) continue
    seen.add(coach.slug)
    out.push(coach.slug)
  }
  return out
}

/**
 * The roster: database rows first, in their own order, then any static coach the
 * table did not answer for.
 *
 * `rows === null` is an OUTAGE and answers the static five.
 *
 * THE FIVE ARE A FLOOR, NOT A MIRROR. A static coach missing from `rows` is
 * added back, and that is deliberate: this list replaces `COACHES` in a dozen
 * pickers, and a swap that could return fewer people than the array it replaced
 * would drop somebody's name out of a form nobody was watching. It has one
 * consequence worth stating, because it is a decision and not an accident: a
 * coach hidden from the public roster still appears in these lists. That is
 * 032's own rule, in 032's words, that hiding is presentation and not deletion.
 * It removes a coach from the roster section and their page; it does not revoke
 * their sign-in and does not close their calendar. `Coaches.tsx` reads
 * `coach_profiles` directly and is the surface where `is_visible` decides what
 * is drawn.
 *
 * `wiring === null` is the same shape of decision one level down: with no answer
 * about who is bookable, the five static coaches are assumed bookable and a
 * database-only coach is not. That is the state of the world before this module
 * existed, and it is the safe direction to be wrong in. Offering a Book button
 * that 404s is worse than hiding one that would have worked.
 */
export function composeRoster(rows: CoachProfileRow[] | null, wiring: Set<string> | null): RosterCoach[] {
  const bookable = (slug: string) => (wiring ? wiring.has(slug) : STATIC_SLUGS.has(slug))

  if (!rows) return COACHES.map(coach => fromStatic(coach, bookable(coach.slug)))

  const ordered = rows
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

  const seen = new Set(ordered.map(row => row.slug))
  const out = ordered.map(row => fromProfile(row, bookable(row.slug)))

  // A static coach with no row is either a table that has not been seeded or a
  // profile somebody deleted. Either way the person exists, has an inbox and may
  // still hold bookings, so they stay on the list.
  for (const coach of COACHES) {
    if (seen.has(coach.slug)) continue
    out.push(fromStatic(coach, bookable(coach.slug)))
  }
  return out
}

/**
 * What an invitation currently is. Derived, never stored, because an invitation
 * expires by the passage of time. Same four states and the same precedence as
 * `invitationState` in invitations.ts, which is the copy this one follows.
 */
export function coachInvitationState(row: CoachInvitationRow, now = Date.now()): InvitationState {
  if (row.accepted_at) return 'accepted'
  if (row.revoked_at) return 'revoked'
  if (new Date(row.expires_at).getTime() <= now) return 'expired'
  return 'pending'
}

/**
 * The one invitation worth showing for a calendar.
 *
 * Matched on the SLUG first and the address second. 012 refuses a staff
 * invitation without a slug, so the slug is the precise question ("has this
 * calendar been offered to anybody"), while the address catches an invitation
 * sent before the routing row was renamed. An athlete invitation to the same
 * person is not about this calendar and is ignored.
 *
 * A live one wins over a newer dead one: "invited, expires Friday" is the fact a
 * staff screen has to act on, and a revoked link from an hour ago is not.
 */
export function pickCoachInvitation(
  slug: string,
  email: string | null,
  invitations: CoachInvitationRow[],
  now = Date.now(),
): { id: number; state: InvitationState; expires_at: string; email: string } | null {
  const address = email?.toLowerCase() ?? null

  const candidates = invitations
    .filter(row => {
      if (row.coach_slug) return row.coach_slug === slug
      return row.role !== 'athlete' && !!address && row.email.toLowerCase() === address
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  if (candidates.length === 0) return null

  const chosen = candidates.find(row => coachInvitationState(row, now) === 'pending') ?? candidates[0]
  return { id: chosen.id, state: coachInvitationState(chosen, now), expires_at: chosen.expires_at, email: chosen.email }
}

export interface DirectoryInput {
  profiles: CoachProfileRow[]
  routing: CoachRoutingRow[]
  accounts: CoachAccountRow[]
  invitations: CoachInvitationRow[]
  /** Slugs with a `coach_public_settings` row. */
  wiring: Set<string>
  /**
   * Slug to "has a Google Calendar connection", from `fetchCalendarConnections`.
   *
   * Absent or null means NOBODY ASKED or the ask failed, and every entry comes
   * back with `calendarConnected: null`. A slug missing from a map that IS
   * present is false: 039 answers a row for every slug it was given, so an
   * absent slug is one the caller did not ask about.
   */
  calendars?: Map<string, boolean> | null
  now?: number
}

/**
 * Every slug the directory will mention, in the order it unions them.
 *
 * Asked BEFORE the join, because the calendar lookup takes the whole list and
 * answers in one round trip, and it cannot be run in the same parallel batch as
 * the reads that produce the list. `composeDirectory` uses this too, so there is
 * exactly one definition of "who is on this screen" and the two cannot drift.
 */
export function directorySlugs(profiles: CoachProfileRow[], routing: CoachRoutingRow[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (slug: string | null) => {
    if (!slug || seen.has(slug)) return
    seen.add(slug)
    out.push(slug)
  }

  for (const row of routing) add(trimmed(row.coach_slug))
  for (const row of profiles) add(row.slug || null)
  for (const slug of STATIC_SLUGS) add(slug)
  return out
}

/**
 * Five reads into one list, ordered by name.
 *
 * The spine is the union of the three registries rather than any one of them,
 * because every combination happens and each one means something different:
 *
 *   routing, no profile   provisioned before 032, or a page somebody deleted.
 *                         Bookable, invisible, and the roster manager is the fix.
 *   profile, no routing   added through the roster manager, which writes only
 *                         `coach_profiles`. Visible and unbookable, which is the
 *                         failure this whole round exists to make legible.
 *   neither               a static coach whose rows never made it into the
 *                         database. Shown so the gap is visible rather than
 *                         silently absent.
 *
 * The 'No Preference' routing row carries no slug and drops out here with every
 * other unslugged row, which is the same test rather than a special case.
 */
export function composeDirectory(input: DirectoryInput): CoachDirectoryEntry[] {
  const now = input.now ?? Date.now()

  const routingBySlug = new Map<string, CoachRoutingRow>()
  for (const row of input.routing) {
    const slug = trimmed(row.coach_slug)
    if (!slug || routingBySlug.has(slug)) continue
    routingBySlug.set(slug, row)
  }

  const profileBySlug = new Map<string, CoachProfileRow>()
  for (const row of input.profiles) {
    if (!row.slug || profileBySlug.has(row.slug)) continue
    profileBySlug.set(row.slug, row)
  }

  const accountBySlug = new Map<string, CoachAccountRow>()
  for (const row of input.accounts) {
    const slug = trimmed(row.coach_slug)
    if (!slug || accountBySlug.has(slug)) continue
    accountBySlug.set(slug, row)
  }

  const slugs = directorySlugs(input.profiles, input.routing)
  const calendars = input.calendars ?? null

  const entries: CoachDirectoryEntry[] = []
  for (const slug of slugs) {
    const routing = routingBySlug.get(slug) ?? null
    const profile = profileBySlug.get(slug) ?? null
    const account = accountBySlug.get(slug) ?? null
    const fallback = STATIC_BY_SLUG.get(slug) ?? null

    // The display name is the roster's when there is a roster row, because that
    // is the copy an admin edits. Routing's name is the identity `leads.coach_pref`
    // matches on and is what a coach with no page is known by.
    const name = trimmed(profile?.name) ?? trimmed(routing?.coach_name) ?? fallback?.name ?? slug

    // Strictly the routing address where there is a routing row: it is the one
    // an invitation must be sent to and the one `handle_new_user` matches. Only
    // a coach with no routing at all borrows the static entry's.
    const email = routing ? trimmed(routing.email) : trimmed(fallback?.email)

    entries.push({
      slug,
      name,
      email,
      routingId: routing?.id ?? null,
      hasRouting: !!routing,
      hasPublicProfile: !!profile,
      hasBookingSettings: input.wiring.has(slug),
      calendarConnected: calendars ? calendars.get(slug) === true : null,
      account: account ? { id: account.id, status: account.status, email: account.email } : null,
      invitation: pickCoachInvitation(slug, email, input.invitations, now),
    })
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * A name as an address. `Nia Adeyemi` becomes `nia-adeyemi`.
 *
 * Accents are folded rather than dropped so `Zoë` becomes `zoe` and not `zo`,
 * and the result is trimmed again after the length clamp so it can never end on
 * the hyphen the clamp created. A name with nothing alphanumeric in it answers
 * the empty string, and the caller refuses that with the same sentence 036 uses.
 */
export function coachSlugFromName(name: string): string {
  const slug = (name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug.replace(/-+$/, '')
}

/**
 * What is wrong with this form, in a sentence, or null.
 *
 * Every check here is one 036 makes again in the database, on purpose. This copy
 * is signage: it lets the panel refuse before a round trip and say which field.
 * The refusals it cannot make are the ones about other rows (this slug is taken,
 * that email already routes somewhere), because only the database knows those
 * and only the database can answer them without a race.
 */
export function provisionRefusal(input: ProvisionCoachInput): string | null {
  const slug = (input.slug ?? '').trim().toLowerCase()
  const name = (input.name ?? '').trim()
  const email = (input.email ?? '').trim().toLowerCase()

  if (!name) return 'A coach needs a name.'
  if (name.length > 120) return 'That name is too long. Keep it to 120 characters or fewer.'
  if (!slug) return 'A coach needs an address for their page, for example ronnie-vallejo.'
  if (!COACH_SLUG_SHAPE.test(slug)) {
    return 'The address can use lowercase letters, numbers and hyphens only, for example ronnie-vallejo.'
  }
  if (!email) {
    return 'A coach needs an email address. It is where their invitation and their lead notifications go.'
  }
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return 'That does not look like an email address.'
  }
  if ((input.firstName ?? '').trim().length > 120) {
    return 'That first name is too long. Keep it to 120 characters or fewer.'
  }
  if ((input.roleTitle ?? '').trim().length > 120) {
    return 'That role title is too long. Keep it to 120 characters or fewer.'
  }
  return null
}

// ---------------------------------------------------------------------------
// Failure, in sentences
// ---------------------------------------------------------------------------

/**
 * What a failed `provision_coach` call becomes on screen.
 *
 * 036 raises every refusal as `22023` (or `42501` for the gate) with a sentence
 * written for a person, so those are passed through verbatim. That is the whole
 * reason the checks live in the function body rather than in constraints.
 */
function rpcMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  const code = error.code ?? ''
  const msg = (error.message ?? '').replace(/^ERROR:\s*/i, '').trim()

  if ((code === 'P0001' || code === '22023') && msg) return msg
  if (code === '42501') {
    // The gate's own sentence, unless this is the grant refusing, which reads
    // like plumbing because it is.
    if (msg && !/permission denied for/i.test(msg)) return msg
    return 'Your account does not have permission to add a coach. An admin, or a coach with Manage staff, can do it.'
  }
  if (code === 'PGRST202' || /could not find the function/i.test(msg)) {
    return 'This database does not know how to add a coach yet. Apply migration 036 and try again.'
  }
  if (code === 'PGRST301' || /jwt|token is expired/i.test(msg)) {
    return 'Your session expired. Sign in again and it will go through.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection. Nothing was created.'
  }
  if (code === '23505') return 'Something with that address or name already exists. Pick a different one.'
  return fallback
}

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------
//
// The five static coaches plus one who has been provisioned and has not claimed
// their account, which is the state the Coaches section of User Management is
// built to act on. Four of the five are signed up, Aedan has a live invitation
// and no account, and the sixth has neither. Between them they exercise every
// chip and both actions without anybody having to set a database up.
//
// Mutated in place so a demo walk-through survives a tab change, and reset on
// reload, which is the promise the demo banner makes.

const DEMO_NEWCOMER = {
  id: 'demo-routing-nia-adeyemi',
  coach_name: 'Nia Adeyemi',
  email: 'nia@axistrainingsystems.com',
  coach_slug: 'nia-adeyemi',
}

let demoRouting: CoachRoutingRow[] | null = null
let demoAccounts: CoachAccountRow[] | null = null
let demoInvitations: CoachInvitationRow[] | null = null
let demoWiring: Set<string> | null = null

function demoRoutingStore(): CoachRoutingRow[] {
  if (!demoRouting) {
    demoRouting = [
      ...COACHES.map(coach => ({
        id: `demo-routing-${coach.slug}`,
        coach_name: coach.name,
        email: coach.email,
        coach_slug: coach.slug as string,
      })),
      { ...DEMO_NEWCOMER },
    ]
  }
  return demoRouting
}

function demoAccountStore(): CoachAccountRow[] {
  if (!demoAccounts) {
    demoAccounts = COACHES.filter(coach => coach.slug !== 'aedan-nguyen').map(coach => ({
      id: `demo-profile-${coach.slug}`,
      email: coach.email,
      status: 'active' as ProfileStatus,
      coach_slug: coach.slug as string,
    }))
  }
  return demoAccounts
}

function demoInvitationStore(): CoachInvitationRow[] {
  if (!demoInvitations) {
    const week = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    demoInvitations = [
      {
        id: 1,
        email: 'aedan@axistrainingsystems.com',
        role: 'coach',
        coach_slug: 'aedan-nguyen',
        expires_at: week,
        accepted_at: null,
        revoked_at: null,
        created_at: new Date().toISOString(),
      },
    ]
  }
  return demoInvitations
}

function demoWiringStore(): Set<string> {
  if (!demoWiring) demoWiring = new Set<string>(COACHES.map(c => c.slug))
  return demoWiring
}

/**
 * Who has connected Google, in the demo.
 *
 * Four of the five, and deliberately not Aedan. He is the one of the five with
 * a live invitation and no account, so he is already the row a walk-through
 * stops on, and leaving him unconnected is what puts the amber calendar chip on
 * a screen without anybody having to set a database up. He is bookable either
 * way, which is the whole point the chip has to make.
 *
 * The sixth coach, provisioned and unclaimed, is not in here either: nobody has
 * connected a calendar for a coach who has not signed in yet.
 */
const DEMO_UNCONNECTED = 'aedan-nguyen'

let demoCalendars: Set<string> | null = null

function demoCalendarStore(): Set<string> {
  if (!demoCalendars) {
    demoCalendars = new Set<string>(COACHES.map(c => c.slug).filter(slug => slug !== DEMO_UNCONNECTED))
  }
  return demoCalendars
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Which of these slugs can take a booking.
 *
 * `coach_booking_wiring` (036) is definer, anon-callable, and answers a slug and
 * a boolean for each one asked about. The public roster runs with no session, so
 * this cannot be a join against a staff-only table, and it is one round trip for
 * the whole list rather than one per coach.
 *
 * `null` is an outage and the callers decide what to assume; see `composeRoster`.
 *
 * 036 answers at most two hundred slugs per call. The roster is five, and a
 * studio that ever passes two hundred coaches has to ask in batches.
 */
export async function fetchBookingWiring(slugs: string[], isDemo = false): Promise<Set<string> | null> {
  const wanted = slugs.filter(slug => COACH_SLUG_SHAPE.test(slug))
  if (wanted.length === 0) return new Set<string>()

  if (offline(isDemo)) {
    const store = demoWiringStore()
    return new Set(wanted.filter(slug => store.has(slug)))
  }

  try {
    const { data, error } = await supabase.rpc('coach_booking_wiring', { p_slugs: wanted })
    if (error) return null
    const rows = (data ?? []) as unknown as { coach_slug: string; has_settings: boolean }[]
    return new Set(rows.filter(row => row.has_settings === true).map(row => String(row.coach_slug)))
  } catch {
    return null
  }
}

/**
 * Which of these coaches has a Google Calendar connected.
 *
 * `coach_calendar_connected` (039) is definer, gated on admin or manage_staff,
 * and answers a slug and a boolean for each one asked about. It has to be an
 * RPC: `private.coach_calendar_connections` is in a schema no browser role holds
 * USAGE on, which is where the encrypted refresh tokens live, and the function
 * is the one-bit door through it.
 *
 * `null` is an outage OR a refusal, and both mean the same thing to a screen:
 * this is not known, so draw nothing. The alternative, treating an unreadable
 * answer as "not connected", would print a gap chip against a coach who has
 * been connected for a year.
 *
 * 039 answers at most two hundred slugs per call, as 036 does.
 */
export async function fetchCalendarConnections(
  slugs: string[],
  isDemo = false,
): Promise<Map<string, boolean> | null> {
  const wanted = slugs.filter(slug => COACH_SLUG_SHAPE.test(slug))
  if (wanted.length === 0) return new Map<string, boolean>()

  if (offline(isDemo)) {
    const store = demoCalendarStore()
    return new Map<string, boolean>(wanted.map(slug => [slug, store.has(slug)]))
  }

  try {
    const { data, error } = await supabase.rpc('coach_calendar_connected', { p_slugs: wanted })
    if (error) return null
    const rows = (data ?? []) as unknown as { coach_slug: string; connected: boolean }[]
    return new Map<string, boolean>(rows.map(row => [String(row.coach_slug), row.connected === true]))
  } catch {
    return null
  }
}

/**
 * The public roster.
 *
 * Never null and never empty because of a failure: an outage answers the static
 * five. `includeHidden` is for staff surfaces that pick a coach to administer,
 * where a coach provisioned an hour ago has not been made visible yet and must
 * still be pickable. The public callers pass nothing and get the visible rows.
 */
export async function fetchCoachRoster(
  isDemo = false,
  options: { includeHidden?: boolean } = {},
): Promise<RosterCoach[]> {
  const rows = options.includeHidden
    ? await fetchAllCoachProfiles(isDemo)
    : await fetchVisibleCoachProfiles(isDemo)

  const wiring = await fetchBookingWiring(rosterSlugs(rows), isDemo)
  return composeRoster(rows, wiring)
}

/**
 * The staff view of the same people, with the state of their wiring.
 *
 * Five reads in parallel and `null` if ANY of them fails. A directory that
 * quietly drops the invitations it could not read would offer "Send invite" to
 * somebody who already holds a live link, and one that drops the accounts would
 * call a signed-up coach unclaimed. Half of this table is worse than none of it.
 *
 * The booking-settings read here is a plain select rather than the RPC the
 * public roster uses: staff hold SELECT on `coach_public_settings` (007), it
 * needs no slug list, and it joins the same parallel batch.
 *
 * The CALENDAR read is the one that cannot join that batch, because 039 takes
 * the slug list and the slug list is what the batch produces. So it is a sixth
 * round trip, after the other five, and a failure there is NOT an outage: it
 * costs one chip on a screen that still tells the truth about everything else.
 * `calendarConnected` comes back null and nothing is drawn for it.
 */
export async function fetchCoachDirectory(isDemo = false): Promise<CoachDirectoryEntry[] | null> {
  if (offline(isDemo)) {
    const profiles = (await fetchAllCoachProfiles(isDemo)) ?? []
    const routing = demoRoutingStore().map(row => ({ ...row }))
    return composeDirectory({
      profiles,
      routing,
      accounts: demoAccountStore().map(row => ({ ...row })),
      invitations: demoInvitationStore().map(row => ({ ...row })),
      wiring: new Set(demoWiringStore()),
      calendars: await fetchCalendarConnections(directorySlugs(profiles, routing), isDemo),
    })
  }

  try {
    const [profiles, routing, accounts, invitations, settings] = await Promise.all([
      fetchAllCoachProfiles(isDemo),
      supabase.from('coach_routing').select(COACH_ROUTING_COLUMNS).order('coach_name'),
      supabase.from('profiles').select(COACH_ACCOUNT_COLUMNS).not('coach_slug', 'is', null).limit(500),
      supabase
        .from('invitations')
        .select(COACH_INVITATION_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('coach_public_settings').select('coach_slug').limit(500),
    ])

    if (!profiles || routing.error || accounts.error || invitations.error || settings.error) return null

    const wiring = new Set<string>(
      ((settings.data ?? []) as unknown as { coach_slug: string }[]).map(row => String(row.coach_slug)),
    )

    const routingRows = (routing.data ?? []) as unknown as CoachRoutingRow[]
    const calendars = await fetchCalendarConnections(directorySlugs(profiles, routingRows), isDemo)

    return composeDirectory({
      profiles,
      routing: routingRows,
      accounts: (accounts.data ?? []) as unknown as CoachAccountRow[],
      invitations: (invitations.data ?? []) as unknown as CoachInvitationRow[],
      wiring,
      calendars,
    })
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Add a coach: routing, booking settings, the service menu, and a hidden page.
 *
 * One RPC, one transaction, one refusal sentence. It creates no ACCOUNT, which
 * is the next step and a separate act: the panel offers to send the invitation
 * straight afterwards, and `invite-send` is what mints it.
 *
 * The demo path writes the same four things into the demo stores, including a
 * hidden `coach_profiles` row through `saveCoachProfile`, so a demo walk-through
 * ends in exactly the state a real one does: a coach who is bookable, not yet
 * visible, and not yet claimed.
 */
export async function provisionCoach(
  input: ProvisionCoachInput,
  isDemo = false,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const refusal = provisionRefusal(input)
  if (refusal) return { ok: false, message: refusal }

  const slug = input.slug.trim().toLowerCase()
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  const firstName = (input.firstName ?? '').trim() || name.split(' ')[0] || name
  const roleTitle = (input.roleTitle ?? '').trim()
  const timeZone = (input.timeZone ?? '').trim() || 'America/Los_Angeles'

  if (offline(isDemo)) {
    await beat()
    const routing = demoRoutingStore()

    if (routing.some(row => row.coach_slug === slug)) {
      return { ok: false, message: `A coach already books under the address ${slug}. Pick a different one.` }
    }
    if (routing.some(row => (row.email ?? '').toLowerCase() === email)) {
      return { ok: false, message: 'That email address already routes to a coach. One address, one calendar.' }
    }
    if (routing.some(row => row.coach_name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, message: `A coach called ${name} is already on the routing list.` }
    }

    const created = await saveCoachProfile(
      { slug, name, first_name: firstName, role_title: roleTitle || null, is_visible: false },
      isDemo,
    )
    if (!created.ok) return created

    routing.push({ id: `demo-routing-${slug}`, coach_name: name, email, coach_slug: slug })
    demoWiringStore().add(slug)
    return { ok: true }
  }

  const { error } = await supabase.rpc('provision_coach', {
    p_slug: slug,
    p_name: name,
    p_first_name: firstName,
    p_email: email,
    p_role_title: roleTitle || null,
    p_time_zone: timeZone,
  })

  if (error) return { ok: false, message: rpcMessage(error, 'That coach was not added. Nothing was created.') }
  return { ok: true }
}

/**
 * Change the address a coach's calendar routes to.
 *
 * ONE COLUMN, THREE JOBS, which is why this is worth a control of its own on the
 * roster screen rather than a trip to Settings:
 *
 *   1. Lead notifications and booking notices are addressed to it (010's
 *      `coach_notify_email` reads this exact row).
 *   2. An invitation is sent to it, and the Coaches section offers that
 *      invitation one line above.
 *   3. `handle_new_user` (011) admits a sign-up at this address as staff, and
 *      `google-oauth` binds a Google account to a coach by case-folded match on
 *      it. A wrong address here is a coach who cannot connect their calendar and
 *      cannot sign in, with no error anywhere that says why.
 *
 * The validation is AdminSettings' idiom, unchanged: `sanitizeEmail` first
 * because the string is a credential and not markup, then `isValidEmail` for the
 * shape. An empty box is refused rather than written: this column is what an
 * invitation is addressed to, so blanking it is a silent way to strand somebody.
 *
 * `.select('id')` is load-bearing. 017's `coach_routing_admin_write` is an
 * ADMIN-only policy, and an RLS refusal on an UPDATE arrives as a successful
 * request that changed nothing. Without the select, a coach holding manage_staff
 * would see "Saved" over an address that never moved.
 */
export async function updateCoachRoutingEmail(
  routingId: string,
  email: string,
  isDemo = false,
): Promise<WriteResult> {
  const clean = sanitizeEmail(email)

  if (!clean) {
    return {
      ok: false,
      message: 'A coach needs an email address. It is where their invitation and their lead notifications go.',
    }
  }
  if (!isValidEmail(clean)) {
    return { ok: false, message: 'That does not look like an email address.' }
  }

  if (offline(isDemo)) {
    await beat()
    const store = demoRoutingStore()
    const row = store.find(r => r.id === routingId)
    if (!row) {
      return { ok: false, message: 'That coach is no longer on the routing list. Refresh the roster.' }
    }
    // 036 refuses a second coach on one address for a reason worth repeating
    // here: one address, one calendar, because the OAuth binding matches on it.
    if (store.some(r => r.id !== routingId && (r.email ?? '').toLowerCase() === clean.toLowerCase())) {
      return { ok: false, message: 'That email address already routes to a coach. One address, one calendar.' }
    }
    row.email = clean
    return { ok: true }
  }

  const { data, error } = await supabase
    .from('coach_routing')
    .update({ email: clean, updated_at: new Date().toISOString() })
    .eq('id', routingId)
    .select('id')

  // The grant refusing reads differently from the policy refusing, and only one
  // of `rpcMessage`'s sentences is about adding a coach, so that one case is
  // answered here rather than borrowed.
  if (error?.code === '42501') {
    return {
      ok: false,
      message: 'Your account does not have permission to change a coach’s address. An admin can do it from Settings, General.',
    }
  }
  if (error) return { ok: false, message: rpcMessage(error, 'That address was not saved.') }
  if (!data || data.length === 0) {
    return {
      ok: false,
      message: 'That address was not saved. The coach may have been removed from the routing list, or your account may not have permission to change it.',
    }
  }
  return { ok: true }
}
