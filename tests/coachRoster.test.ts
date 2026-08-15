import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coachInvitationState,
  coachSlugFromName,
  composeDirectory,
  composeRoster,
  directorySlugs,
  pickCoachInvitation,
  provisionRefusal,
  rosterSlugs,
  COACH_SLUG_SHAPE,
} from '../src/lib/coachRoster.ts'
import type { CoachAccountRow, CoachInvitationRow, CoachRoutingRow } from '../src/lib/coachRoster.ts'
import type { CoachProfileRow } from '../src/lib/coachProfiles.ts'
import { COACHES } from '../src/data/coaches.ts'

// Pure functions only. Everything else in this module is a Supabase call or an
// RPC and belongs to an integration test with a database behind it, not to
// `node --test`. The four joins below are where every "who is on the roster",
// "can they take a booking" and "has anybody claimed this calendar" decision
// actually gets made, which is why they are functions of their inputs.

const SLUGS = COACHES.map(c => c.slug as string)

function profile(partial: Partial<CoachProfileRow> & { slug: string }): CoachProfileRow {
  return {
    id: `id-${partial.slug}`,
    slug: partial.slug,
    name: partial.name ?? 'A Coach',
    first_name: partial.first_name ?? null,
    role_title: partial.role_title ?? null,
    tagline: null,
    philosophy: null,
    bio: [],
    specialties: [],
    stats: [],
    services: [],
    photo_url: partial.photo_url ?? null,
    cta_bg_url: null,
    is_visible: partial.is_visible ?? true,
    sort_order: partial.sort_order ?? 0,
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function invitation(partial: Partial<CoachInvitationRow> & { id: number }): CoachInvitationRow {
  return {
    id: partial.id,
    email: partial.email ?? 'someone@example.com',
    role: partial.role ?? 'coach',
    coach_slug: partial.coach_slug ?? null,
    expires_at: partial.expires_at ?? '2099-01-01T00:00:00.000Z',
    accepted_at: partial.accepted_at ?? null,
    revoked_at: partial.revoked_at ?? null,
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// 1. composeRoster — an outage is not an empty roster
// ---------------------------------------------------------------------------
test('composeRoster answers the static five when the table could not be read', () => {
  const roster = composeRoster(null, null)
  assert.deepEqual(roster.map(c => c.slug), SLUGS)
  assert.ok(roster.every(c => c.source === 'static'))
  // Nothing said who is bookable, so the five who always were still are.
  assert.ok(roster.every(c => c.bookable))
  // The static entry is where the five get their address, and it is a real one.
  assert.equal(roster[0].email, COACHES[0].email)
})

test('composeRoster trusts the wiring over the static assumption, even during a profile outage', () => {
  const roster = composeRoster(null, new Set(['kobe-pham']))
  assert.deepEqual(
    roster.filter(c => c.bookable).map(c => c.slug),
    ['kobe-pham'],
  )
})

test('composeRoster orders by sort_order, then by name for a tie', () => {
  const rows = [
    profile({ slug: 'zoe-adams', name: 'Zoe Adams', sort_order: 2 }),
    profile({ slug: 'ana-diaz', name: 'Ana Diaz', sort_order: 2 }),
    profile({ slug: 'first-coach', name: 'First Coach', sort_order: 0 }),
  ]
  const roster = composeRoster(rows, new Set())
  assert.deepEqual(roster.slice(0, 3).map(c => c.slug), ['first-coach', 'ana-diaz', 'zoe-adams'])
})

test('composeRoster marks a database row db and carries the static email across for the five', () => {
  const rows = [profile({ slug: 'kobe-pham', name: 'Kobe Pham', role_title: 'Performance Coach' })]
  const roster = composeRoster(rows, new Set(['kobe-pham']))
  const kobe = roster.find(c => c.slug === 'kobe-pham')

  assert.ok(kobe)
  assert.equal(kobe.source, 'db')
  assert.equal(kobe.roleTitle, 'Performance Coach')
  assert.equal(kobe.bookable, true)
  assert.equal(kobe.email, COACHES.find(c => c.slug === 'kobe-pham')?.email)
})

test('composeRoster answers a null email for a coach who exists only in the database', () => {
  const rows = [profile({ slug: 'nia-adeyemi', name: 'Nia Adeyemi', sort_order: 9 })]
  const nia = composeRoster(rows, new Set(['nia-adeyemi'])).find(c => c.slug === 'nia-adeyemi')

  assert.ok(nia)
  // Not the empty string toCoachShape hands out. Null says "we do not have one"
  // rather than pretending to be an address, and nothing authorizes on it.
  assert.equal(nia.email, null)
  // Rendered in sentences, so it falls back to the first word rather than ''.
  assert.equal(nia.firstName, 'Nia')
})

test('composeRoster keeps the static five as a floor when the table answers with fewer', () => {
  const rows = [profile({ slug: 'kobe-pham', name: 'Kobe Pham' })]
  const roster = composeRoster(rows, new Set(['kobe-pham']))

  assert.equal(roster.length, COACHES.length)
  assert.equal(roster[0].slug, 'kobe-pham')
  assert.equal(roster[0].source, 'db')
  // The other four come back from the file, in the file's order, and are not
  // duplicated by the one that did answer.
  assert.deepEqual(
    roster.slice(1).map(c => c.slug),
    SLUGS.filter(slug => slug !== 'kobe-pham'),
  )
  assert.ok(roster.slice(1).every(c => c.source === 'static'))
})

test('composeRoster answers the static five for an empty table and adds nothing twice', () => {
  const roster = composeRoster([], new Set())
  assert.deepEqual(roster.map(c => c.slug), SLUGS)
  assert.ok(roster.every(c => c.bookable === false))
})

test('composeRoster with no wiring answer assumes the five, and only the five, are bookable', () => {
  const rows = [
    profile({ slug: 'kobe-pham', name: 'Kobe Pham', sort_order: 0 }),
    profile({ slug: 'nia-adeyemi', name: 'Nia Adeyemi', sort_order: 1 }),
  ]
  const roster = composeRoster(rows, null)

  assert.equal(roster.find(c => c.slug === 'kobe-pham')?.bookable, true)
  // A coach the static array has never heard of gets no Book button on a guess.
  assert.equal(roster.find(c => c.slug === 'nia-adeyemi')?.bookable, false)
})

// ---------------------------------------------------------------------------
// 2. rosterSlugs — one list, asked once
// ---------------------------------------------------------------------------
test('rosterSlugs is the union of the table and the file, in that order, without repeats', () => {
  const slugs = rosterSlugs([
    profile({ slug: 'nia-adeyemi' }),
    profile({ slug: 'kobe-pham' }),
    profile({ slug: 'nia-adeyemi' }),
  ])

  assert.equal(slugs[0], 'nia-adeyemi')
  assert.equal(slugs[1], 'kobe-pham')
  assert.equal(new Set(slugs).size, slugs.length)
  for (const slug of SLUGS) assert.ok(slugs.includes(slug))
})

test('rosterSlugs answers the static five when there is nothing to read', () => {
  assert.deepEqual(rosterSlugs(null), SLUGS)
})

// ---------------------------------------------------------------------------
// 3. Invitation state — derived, never stored
// ---------------------------------------------------------------------------
test('coachInvitationState reads the four states in the order 012 defines them', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z')

  assert.equal(coachInvitationState(invitation({ id: 1 }), now), 'pending')
  assert.equal(
    coachInvitationState(invitation({ id: 2, expires_at: '2026-01-01T00:00:00.000Z' }), now),
    'expired',
  )
  assert.equal(
    coachInvitationState(invitation({ id: 3, revoked_at: '2026-05-01T00:00:00.000Z' }), now),
    'revoked',
  )
  // Accepted wins over everything: it is a record of what happened.
  assert.equal(
    coachInvitationState(
      invitation({
        id: 4,
        accepted_at: '2026-02-01T00:00:00.000Z',
        expires_at: '2026-01-01T00:00:00.000Z',
      }),
      now,
    ),
    'accepted',
  )
})

// ---------------------------------------------------------------------------
// 4. pickCoachInvitation — which link a staff screen has to act on
// ---------------------------------------------------------------------------
test('pickCoachInvitation matches the calendar by slug, whoever it was sent to', () => {
  const rows = [invitation({ id: 7, coach_slug: 'nia-adeyemi', email: 'someone.else@example.com' })]
  const picked = pickCoachInvitation('nia-adeyemi', 'nia@axistrainingsystems.com', rows)

  assert.equal(picked?.id, 7)
  assert.equal(picked?.state, 'pending')
})

test('pickCoachInvitation falls back to the address for a slugless staff invitation', () => {
  const rows = [invitation({ id: 8, coach_slug: null, role: 'admin', email: 'nia@axistrainingsystems.com' })]
  assert.equal(pickCoachInvitation('nia-adeyemi', 'NIA@axistrainingsystems.com', rows)?.id, 8)
})

test('pickCoachInvitation ignores an athlete invitation to the same person', () => {
  const rows = [invitation({ id: 9, coach_slug: null, role: 'athlete', email: 'nia@axistrainingsystems.com' })]
  assert.equal(pickCoachInvitation('nia-adeyemi', 'nia@axistrainingsystems.com', rows), null)
})

test('pickCoachInvitation ignores an invitation for a different calendar', () => {
  const rows = [invitation({ id: 10, coach_slug: 'someone-else', email: 'nia@axistrainingsystems.com' })]
  assert.equal(pickCoachInvitation('nia-adeyemi', 'nia@axistrainingsystems.com', rows), null)
})

test('pickCoachInvitation prefers the live link over a newer dead one', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z')
  const rows = [
    invitation({
      id: 11,
      coach_slug: 'nia-adeyemi',
      created_at: '2026-05-30T00:00:00.000Z',
      revoked_at: '2026-05-30T01:00:00.000Z',
    }),
    invitation({
      id: 12,
      coach_slug: 'nia-adeyemi',
      created_at: '2026-05-01T00:00:00.000Z',
      expires_at: '2026-07-01T00:00:00.000Z',
    }),
  ]

  // "Invited, expires 1 July" is the fact the screen has to act on.
  assert.equal(pickCoachInvitation('nia-adeyemi', null, rows, now)?.id, 12)
})

test('pickCoachInvitation falls back to the newest when none of them is live', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z')
  const rows = [
    invitation({ id: 13, coach_slug: 'nia-adeyemi', created_at: '2026-01-01T00:00:00.000Z', revoked_at: '2026-01-02T00:00:00.000Z' }),
    invitation({ id: 14, coach_slug: 'nia-adeyemi', created_at: '2026-05-01T00:00:00.000Z', accepted_at: '2026-05-02T00:00:00.000Z' }),
  ]

  const picked = pickCoachInvitation('nia-adeyemi', null, rows, now)
  assert.equal(picked?.id, 14)
  assert.equal(picked?.state, 'accepted')
})

// ---------------------------------------------------------------------------
// 5. composeDirectory — the staff join
// ---------------------------------------------------------------------------
const ROUTING: CoachRoutingRow[] = [
  { id: 'r1', coach_name: 'Kobe Pham', email: 'kobe@axistrainingsystems.com', coach_slug: 'kobe-pham' },
  { id: 'r2', coach_name: 'Nia Adeyemi', email: 'nia@axistrainingsystems.com', coach_slug: 'nia-adeyemi' },
  // 001 seeds this one and it is not a person.
  { id: 'r3', coach_name: 'No Preference', email: '', coach_slug: null },
]

const ACCOUNTS: CoachAccountRow[] = [
  { id: 'p1', email: 'kobe@axistrainingsystems.com', status: 'active', coach_slug: 'kobe-pham' },
]

function directory(overrides: Partial<Parameters<typeof composeDirectory>[0]> = {}) {
  return composeDirectory({
    profiles: overrides.profiles ?? [profile({ slug: 'kobe-pham', name: 'Kobe Pham' })],
    routing: overrides.routing ?? ROUTING,
    accounts: overrides.accounts ?? ACCOUNTS,
    invitations: overrides.invitations ?? [],
    wiring: overrides.wiring ?? new Set(['kobe-pham', 'nia-adeyemi']),
    // Passed through as given, undefined included: "nobody asked about calendars"
    // and "the ask failed" are both null on the way out and the tests below
    // check that they stay that way.
    calendars: overrides.calendars,
    now: overrides.now,
  })
}

test('composeDirectory drops the No Preference row with every other unslugged one', () => {
  assert.equal(directory().some(entry => entry.name === 'No Preference'), false)
})

test('composeDirectory unions the three registries and sorts by name', () => {
  const entries = directory()
  assert.deepEqual(entries.map(e => e.name), [...entries.map(e => e.name)].sort((a, b) => a.localeCompare(b)))
  // Every static coach is present even with one profile row and two routing rows.
  for (const slug of SLUGS) assert.ok(entries.some(e => e.slug === slug), slug)
  assert.ok(entries.some(e => e.slug === 'nia-adeyemi'))
})

test('composeDirectory reports each half of the wiring separately', () => {
  const nia = directory().find(e => e.slug === 'nia-adeyemi')

  assert.ok(nia)
  assert.equal(nia.hasRouting, true)
  assert.equal(nia.hasBookingSettings, true)
  // Provisioned, page never written. This is the state the Coaches section exists to show.
  assert.equal(nia.hasPublicProfile, false)
  assert.equal(nia.account, null)
  assert.equal(nia.invitation, null)
})

test('composeDirectory shows a page with no routing behind it, which is unbookable', () => {
  const entries = directory({
    profiles: [profile({ slug: 'orphan-page', name: 'Orphan Page' })],
    routing: [],
    wiring: new Set(),
  })
  const orphan = entries.find(e => e.slug === 'orphan-page')

  assert.ok(orphan)
  assert.equal(orphan.hasPublicProfile, true)
  assert.equal(orphan.hasRouting, false)
  assert.equal(orphan.hasBookingSettings, false)
  assert.equal(orphan.email, null)
})

test('composeDirectory prefers the roster name and the routing address', () => {
  const entries = directory({
    profiles: [profile({ slug: 'kobe-pham', name: 'Kobe P.' })],
    routing: [{ id: 'r1', coach_name: 'Kobe Pham', email: '  KOBE@axistrainingsystems.com ', coach_slug: 'kobe-pham' }],
  })
  const kobe = entries.find(e => e.slug === 'kobe-pham')

  assert.equal(kobe?.name, 'Kobe P.')
  assert.equal(kobe?.email, 'KOBE@axistrainingsystems.com')
})

test('composeDirectory answers a null email for a routing row that never got one', () => {
  const entries = directory({
    routing: [{ id: 'r1', coach_name: 'Kobe Pham', email: '', coach_slug: 'kobe-pham' }],
  })
  assert.equal(entries.find(e => e.slug === 'kobe-pham')?.email, null)
})

test('composeDirectory borrows the static address only when there is no routing row at all', () => {
  const entries = directory({ routing: [] })
  const kobe = entries.find(e => e.slug === 'kobe-pham')

  assert.equal(kobe?.hasRouting, false)
  assert.equal(kobe?.email, COACHES.find(c => c.slug === 'kobe-pham')?.email)
})

test('composeDirectory attaches the account that holds the slug', () => {
  const kobe = directory().find(e => e.slug === 'kobe-pham')

  assert.deepEqual(kobe?.account, {
    id: 'p1',
    status: 'active',
    email: 'kobe@axistrainingsystems.com',
  })
})

test('composeDirectory attaches the live invitation for an unclaimed calendar', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z')
  const entries = directory({
    invitations: [
      invitation({
        id: 21,
        coach_slug: 'nia-adeyemi',
        expires_at: '2026-06-10T00:00:00.000Z',
        created_at: '2026-05-27T00:00:00.000Z',
      }),
    ],
    now,
  })
  const nia = entries.find(e => e.slug === 'nia-adeyemi')

  assert.equal(nia?.account, null)
  assert.deepEqual(nia?.invitation, {
    id: 21,
    state: 'pending',
    expires_at: '2026-06-10T00:00:00.000Z',
    // Carried so the row can tell when a corrected routing address no longer
    // matches the inbox the live invitation actually went to.
    email: 'someone@example.com',
  })
})

test('composeDirectory is the claimable set an invite screen needs: routing, no account, no live link', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z')
  const entries = directory({
    routing: [
      ...ROUTING,
      { id: 'r4', coach_name: 'Theo Mbeki', email: 'theo@axistrainingsystems.com', coach_slug: 'theo-mbeki' },
    ],
    invitations: [invitation({ id: 22, coach_slug: 'nia-adeyemi', expires_at: '2026-06-10T00:00:00.000Z' })],
    now,
  })

  const claimable = entries
    .filter(e => e.hasRouting && !e.account && (!e.invitation || e.invitation.state !== 'pending'))
    .map(e => e.slug)

  // Kobe has an account, Nia holds a live link. Theo is the one left to invite.
  assert.deepEqual(claimable, ['theo-mbeki'])
})

// ---------------------------------------------------------------------------
// 6. coachSlugFromName — the address the form suggests
// ---------------------------------------------------------------------------
test('coachSlugFromName turns a name into the address 036 will accept', () => {
  assert.equal(coachSlugFromName('Nia Adeyemi'), 'nia-adeyemi')
  assert.equal(coachSlugFromName('  Ronnie   Vallejo  '), 'ronnie-vallejo')
  assert.equal(coachSlugFromName("Se'an O'Brien"), 'sean-obrien')
  assert.equal(coachSlugFromName('Zoë Fernández'), 'zoe-fernandez')
  assert.equal(coachSlugFromName('J. R. Smith Jr.'), 'j-r-smith-jr')
  assert.equal(coachSlugFromName('Kobe  --  Pham'), 'kobe-pham')
})

test('coachSlugFromName answers something the shape check accepts, or nothing at all', () => {
  const long = coachSlugFromName('A'.repeat(200))
  assert.ok(long.length <= 64)
  assert.ok(COACH_SLUG_SHAPE.test(long))
  // Clamping must not leave the hyphen the clamp created on the end.
  const clamped = coachSlugFromName(`${'a'.repeat(63)} bcd`)
  assert.equal(clamped.endsWith('-'), false)
  assert.ok(COACH_SLUG_SHAPE.test(clamped))
  // Nothing alphanumeric is not an address, and the caller refuses it.
  assert.equal(coachSlugFromName('!!!'), '')
  assert.equal(coachSlugFromName(''), '')
})

// ---------------------------------------------------------------------------
// 7. provisionRefusal — the same checks 036 makes, one round trip earlier
// ---------------------------------------------------------------------------
const GOOD = {
  slug: 'nia-adeyemi',
  name: 'Nia Adeyemi',
  firstName: 'Nia',
  email: 'nia@axistrainingsystems.com',
  roleTitle: 'Team Axis Coach',
  timeZone: 'America/Los_Angeles',
}

test('provisionRefusal passes a complete form', () => {
  assert.equal(provisionRefusal(GOOD), null)
  // The three optional fields really are optional.
  assert.equal(provisionRefusal({ slug: 'nia-adeyemi', name: 'Nia Adeyemi', email: 'nia@axis.com' }), null)
})

test('provisionRefusal names the field that is wrong', () => {
  assert.match(provisionRefusal({ ...GOOD, name: '   ' }) ?? '', /needs a name/)
  assert.match(provisionRefusal({ ...GOOD, slug: '' }) ?? '', /needs an address/)
  assert.match(provisionRefusal({ ...GOOD, slug: 'Nia Adeyemi' }) ?? '', /lowercase letters, numbers and hyphens/)
  assert.match(provisionRefusal({ ...GOOD, slug: 'nia_adeyemi' }) ?? '', /lowercase letters, numbers and hyphens/)
  assert.match(provisionRefusal({ ...GOOD, email: '' }) ?? '', /needs an email address/)
  assert.match(provisionRefusal({ ...GOOD, email: 'nia at axis.com' }) ?? '', /does not look like an email/)
  assert.match(provisionRefusal({ ...GOOD, email: 'nia@axis' }) ?? '', /does not look like an email/)
  assert.match(provisionRefusal({ ...GOOD, name: 'N'.repeat(121) }) ?? '', /name is too long/)
  assert.match(provisionRefusal({ ...GOOD, firstName: 'N'.repeat(121) }) ?? '', /first name is too long/)
  assert.match(provisionRefusal({ ...GOOD, roleTitle: 'R'.repeat(121) }) ?? '', /role title is too long/)
})

test('provisionRefusal accepts what the database accepts, and no more', () => {
  // 64 characters is the ceiling 036 states and the one booking-availability's
  // own SLUG_RE enforces on the way in.
  assert.equal(provisionRefusal({ ...GOOD, slug: 'a'.repeat(64) }), null)
  assert.match(provisionRefusal({ ...GOOD, slug: 'a'.repeat(65) }) ?? '', /lowercase letters/)
  // Trimmed and lower-cased before the shape check, exactly as the RPC does it.
  assert.equal(provisionRefusal({ ...GOOD, slug: '  NIA-ADEYEMI  ', email: '  NIA@Axis.com ' }), null)
})

// ---------------------------------------------------------------------------
// 8. directorySlugs — the list the calendar lookup is asked about
// ---------------------------------------------------------------------------
//
// This has to be exactly the set composeDirectory renders. A slug it forgets is
// a coach whose calendar state is never asked about and therefore never known,
// which draws as "not connected" nowhere and as nothing at all on the row.

test('directorySlugs unions routing, profiles and the static five, in that order', () => {
  const slugs = directorySlugs(
    [profile({ slug: 'orphan-page' })],
    [{ id: 'r1', coach_name: 'Nia Adeyemi', email: 'nia@axis.com', coach_slug: 'nia-adeyemi' }],
  )

  assert.equal(slugs[0], 'nia-adeyemi')
  assert.equal(slugs[1], 'orphan-page')
  assert.equal(new Set(slugs).size, slugs.length)
  for (const slug of SLUGS) assert.ok(slugs.includes(slug), slug)
})

test('directorySlugs drops the unslugged routing rows and never repeats one', () => {
  const slugs = directorySlugs(
    [profile({ slug: 'kobe-pham' })],
    [
      ...ROUTING,
      { id: 'r9', coach_name: 'Kobe Again', email: 'k2@axis.com', coach_slug: '  kobe-pham  ' },
    ],
  )

  // 'No Preference' carries no slug and is not a person; the whitespace spelling
  // of an existing slug is the same coach.
  assert.equal(slugs.filter(slug => slug === 'kobe-pham').length, 1)
  assert.equal(slugs.includes(''), false)
})

test('directorySlugs answers the static five for two empty tables', () => {
  assert.deepEqual(directorySlugs([], []), SLUGS)
})

test('directorySlugs is exactly the set composeDirectory renders', () => {
  const profiles = [profile({ slug: 'orphan-page', name: 'Orphan Page' })]
  const entries = composeDirectory({
    profiles,
    routing: ROUTING,
    accounts: ACCOUNTS,
    invitations: [],
    wiring: new Set(),
  })

  assert.deepEqual(
    [...entries.map(e => e.slug)].sort(),
    [...directorySlugs(profiles, ROUTING)].sort(),
  )
})

// ---------------------------------------------------------------------------
// 9. composeDirectory — the calendar connection, and the difference between
//    "not connected" and "we could not find out"
// ---------------------------------------------------------------------------

test('composeDirectory answers null for every coach when nobody asked about calendars', () => {
  // The default. A screen must draw no chip at all for this.
  assert.ok(directory().every(entry => entry.calendarConnected === null))
})

test('composeDirectory answers null for every coach when the calendar lookup failed', () => {
  // fetchCalendarConnections answers null for an outage AND for a refusal, and
  // both mean the same thing here: unknown, so say nothing.
  assert.ok(directory({ calendars: null }).every(entry => entry.calendarConnected === null))
})

test('composeDirectory carries the connection through for each coach that has one', () => {
  const entries = directory({
    calendars: new Map([['kobe-pham', true], ['nia-adeyemi', false]]),
  })

  assert.equal(entries.find(e => e.slug === 'kobe-pham')?.calendarConnected, true)
  assert.equal(entries.find(e => e.slug === 'nia-adeyemi')?.calendarConnected, false)
})

test('composeDirectory reads a slug missing from an answered map as not connected', () => {
  // 039 returns a row per slug it was given, so a slug absent from a map that
  // exists was either never asked about or came back false. Both are "no Meet
  // link", and only a null MAP means "we do not know".
  const entries = directory({ calendars: new Map([['kobe-pham', true]]) })
  assert.equal(entries.find(e => e.slug === 'aedan-nguyen')?.calendarConnected, false)
})

test('composeDirectory keeps bookable and connected as separate facts', () => {
  // The state the amber chip exists for: wired up to take bookings, with no
  // calendar behind them, so every booking lands without a video link.
  const entries = directory({
    wiring: new Set(['kobe-pham', 'nia-adeyemi']),
    calendars: new Map([['kobe-pham', false], ['nia-adeyemi', true]]),
  })
  const kobe = entries.find(e => e.slug === 'kobe-pham')

  assert.equal(kobe?.hasBookingSettings, true)
  assert.equal(kobe?.calendarConnected, false)
  // And the other direction: connected, with no booking settings, is a coach
  // nobody can book at all, which is a different chip and a different fix.
  const entries2 = directory({
    wiring: new Set(),
    calendars: new Map([['nia-adeyemi', true]]),
  })
  const nia = entries2.find(e => e.slug === 'nia-adeyemi')
  assert.equal(nia?.hasBookingSettings, false)
  assert.equal(nia?.calendarConnected, true)
})

// ---------------------------------------------------------------------------
// 10. composeDirectory — the routing row id the inline editor writes to
// ---------------------------------------------------------------------------

test('composeDirectory carries the routing row id, and only where there is a routing row', () => {
  const entries = directory()

  assert.equal(entries.find(e => e.slug === 'kobe-pham')?.routingId, 'r1')
  assert.equal(entries.find(e => e.slug === 'nia-adeyemi')?.routingId, 'r2')
  // A static coach with no routing row has nothing to edit, and the panel hides
  // the control rather than writing to an id it guessed.
  const noRouting = entries.find(e => e.slug === 'seth-burman')
  assert.equal(noRouting?.hasRouting, false)
  assert.equal(noRouting?.routingId, null)
})

test('composeDirectory pairs the routing id with the routing address, not the account one', () => {
  const entries = directory({
    routing: [{ id: 'r1', coach_name: 'Kobe Pham', email: 'routing@axistrainingsystems.com', coach_slug: 'kobe-pham' }],
    accounts: [{ id: 'p1', email: 'personal@gmail.com', status: 'active', coach_slug: 'kobe-pham' }],
  })
  const kobe = entries.find(e => e.slug === 'kobe-pham')

  // The editor seeds from `email`, so the two must be halves of one row: it is
  // the routing address that google-oauth and handle_new_user match on.
  assert.equal(kobe?.routingId, 'r1')
  assert.equal(kobe?.email, 'routing@axistrainingsystems.com')
  assert.equal(kobe?.account?.email, 'personal@gmail.com')
})
