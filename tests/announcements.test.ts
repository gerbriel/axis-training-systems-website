import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANONYMOUS_VIEWER,
  AUDIENCE_TYPES,
  DEFAULT_NEW_ACCOUNT_DAYS,
  FIRST_SEEN_KEY,
  RETURNING_AFTER_MS,
  isReturning,
  matchesAudience,
  parseAudience,
  readFirstSeen,
  recordFirstSeen,
  selectAnnouncement,
  type AnnouncementViewer,
  type AudienceTarget,
} from '../src/lib/announceTargeting.ts'

// Pure functions only, which is the whole point of announceTargeting: every
// rule the banner obeys is decided here and can be proved without a browser.
// The two localStorage helpers get a fake store hung off globalThis.

const NOW = new Date('2026-08-13T12:00:00.000Z')
const AT = NOW.getTime()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const viewer = (over: Partial<AnnouncementViewer> = {}): AnnouncementViewer => ({
  ...ANONYMOUS_VIEWER,
  ...over,
})

/** Signed in, account made `daysAgo` ago, and this browser has seen the site. */
const member = (
  role: AnnouncementViewer['role'],
  daysAgo = 100,
): AnnouncementViewer => viewer({
  userId: 'u-1',
  role,
  accountCreatedAt: new Date(AT - daysAgo * DAY).toISOString(),
  firstSeenAt: new Date(AT - daysAgo * DAY).toISOString(),
})

// ---------------------------------------------------------------------------
// 1. parseAudience: what comes back out of a jsonb column
// ---------------------------------------------------------------------------
test('parseAudience accepts every type the migration accepts', () => {
  for (const type of AUDIENCE_TYPES) {
    assert.deepEqual(parseAudience({ type }), { type })
  }
})

test('parseAudience refuses anything that is not one of them', () => {
  assert.equal(parseAudience(null), null)
  assert.equal(parseAudience(undefined), null)
  assert.equal(parseAudience({}), null)
  assert.equal(parseAudience({ type: 'vip' }), null)
  assert.equal(parseAudience({ type: 42 }), null)
  assert.equal(parseAudience('all'), null)
  assert.equal(parseAudience([{ type: 'all' }]), null)
  assert.equal(parseAudience(7), null)
})

test('parseAudience reads a target that arrived as a JSON string', () => {
  assert.deepEqual(parseAudience('{"type":"anonymous"}'), { type: 'anonymous' })
  assert.deepEqual(
    parseAudience('{"type":"role","roles":["coach"]}'),
    { type: 'role', roles: ['coach'] },
  )
  assert.equal(parseAudience('{not json'), null)
})

test('parseAudience keeps known roles, drops the rest, and keeps an empty list empty', () => {
  assert.deepEqual(parseAudience({ type: 'role', roles: ['coach', 'admin'] }),
    { type: 'role', roles: ['coach', 'admin'] })
  // Unknown names and duplicates are dropped; a non-array roles key is ignored.
  assert.deepEqual(parseAudience({ type: 'role', roles: ['coach', 'coach', 'wizard', 9] }),
    { type: 'role', roles: ['coach'] })
  assert.deepEqual(parseAudience({ type: 'role', roles: [] }), { type: 'role', roles: [] })
  assert.deepEqual(parseAudience({ type: 'role', roles: 'coach' }), { type: 'role' })
})

test('parseAudience clamps days into the range the check constraint allows', () => {
  assert.equal(parseAudience({ type: 'new_accounts', days: 14 })?.days, 14)
  assert.equal(parseAudience({ type: 'new_accounts', days: '30' })?.days, 30)
  assert.equal(parseAudience({ type: 'new_accounts', days: 7.9 })?.days, 7)
  assert.equal(parseAudience({ type: 'new_accounts', days: 0 })?.days, 1)
  assert.equal(parseAudience({ type: 'new_accounts', days: -5 })?.days, 1)
  assert.equal(parseAudience({ type: 'new_accounts', days: 4000 })?.days, 365)
  assert.equal(parseAudience({ type: 'new_accounts', days: 'soon' })?.days, undefined)
  assert.equal(parseAudience({ type: 'new_accounts' })?.days, undefined)
})

// ---------------------------------------------------------------------------
// 2. matchesAudience: one case per audience type
// ---------------------------------------------------------------------------
test('all shows to everybody', () => {
  const target: AudienceTarget = { type: 'all' }
  assert.equal(matchesAudience(target, ANONYMOUS_VIEWER, NOW), true)
  assert.equal(matchesAudience(target, member('athlete'), NOW), true)
  assert.equal(matchesAudience(target, member('admin'), NOW), true)
})

test('anonymous is the signed-out visitor only', () => {
  const target: AudienceTarget = { type: 'anonymous' }
  assert.equal(matchesAudience(target, ANONYMOUS_VIEWER, NOW), true)
  assert.equal(matchesAudience(target, member('athlete'), NOW), false)
})

test('authenticated is anybody with a session, whatever their role', () => {
  const target: AudienceTarget = { type: 'authenticated' }
  assert.equal(matchesAudience(target, ANONYMOUS_VIEWER, NOW), false)
  assert.equal(matchesAudience(target, member('athlete'), NOW), true)
  assert.equal(matchesAudience(target, member('coach'), NOW), true)
  // A session with no profile row yet still counts as signed in.
  assert.equal(matchesAudience(target, viewer({ userId: 'u-9' }), NOW), true)
})

test('role matches the listed roles and nobody else', () => {
  const target: AudienceTarget = { type: 'role', roles: ['coach', 'admin'] }
  assert.equal(matchesAudience(target, member('coach'), NOW), true)
  assert.equal(matchesAudience(target, member('admin'), NOW), true)
  assert.equal(matchesAudience(target, member('athlete'), NOW), false)
  assert.equal(matchesAudience(target, ANONYMOUS_VIEWER, NOW), false)
})

test('role with no roles picked matches nobody, which is the row being wrong', () => {
  assert.equal(matchesAudience({ type: 'role', roles: [] }, member('coach'), NOW), false)
  assert.equal(matchesAudience({ type: 'role' }, member('coach'), NOW), false)
  assert.equal(matchesAudience({ type: 'role', roles: ['wizard'] }, member('coach'), NOW), false)
})

test('new_accounts is inclusive at the day boundary and false one millisecond past', () => {
  const target: AudienceTarget = { type: 'new_accounts', days: 14 }
  const signedUp = (ms: number) => viewer({
    userId: 'u-1', role: 'athlete',
    accountCreatedAt: new Date(AT - ms).toISOString(),
  })

  assert.equal(matchesAudience(target, signedUp(0), NOW), true)
  assert.equal(matchesAudience(target, signedUp(13 * DAY), NOW), true)
  assert.equal(matchesAudience(target, signedUp(14 * DAY), NOW), true)
  assert.equal(matchesAudience(target, signedUp(14 * DAY + 1), NOW), false)
  assert.equal(matchesAudience(target, signedUp(90 * DAY), NOW), false)
})

test('new_accounts needs an account, and defaults its window when the row omits days', () => {
  const target: AudienceTarget = { type: 'new_accounts' }
  assert.equal(matchesAudience(target, ANONYMOUS_VIEWER, NOW), false)
  // Signed in but with no created_at to measure: not provably new, so no.
  assert.equal(matchesAudience(target, viewer({ userId: 'u-1', role: 'athlete' }), NOW), false)
  assert.equal(matchesAudience(target, viewer({ userId: 'u-1', accountCreatedAt: 'whenever' }), NOW), false)

  const inside = new Date(AT - (DEFAULT_NEW_ACCOUNT_DAYS - 1) * DAY).toISOString()
  const outside = new Date(AT - (DEFAULT_NEW_ACCOUNT_DAYS + 1) * DAY).toISOString()
  assert.equal(matchesAudience(target, viewer({ userId: 'u-1', accountCreatedAt: inside }), NOW), true)
  assert.equal(matchesAudience(target, viewer({ userId: 'u-1', accountCreatedAt: outside }), NOW), false)
})

test('new_accounts narrows by role when the row lists any', () => {
  const target: AudienceTarget = { type: 'new_accounts', days: 30, roles: ['athlete'] }
  const fresh = (role: AnnouncementViewer['role']) => viewer({
    userId: 'u-1', role,
    accountCreatedAt: new Date(AT - 3 * DAY).toISOString(),
  })

  assert.equal(matchesAudience(target, fresh('athlete'), NOW), true)
  assert.equal(matchesAudience(target, fresh('coach'), NOW), false)
  // An old athlete account fails the window even though the role fits.
  assert.equal(matchesAudience(target, member('athlete', 200), NOW), false)
})

test('returning needs twelve hours since this browser first showed up', () => {
  const target: AudienceTarget = { type: 'returning' }
  const seen = (ago: number) => viewer({ firstSeenAt: new Date(AT - ago).toISOString() })

  assert.equal(matchesAudience(target, ANONYMOUS_VIEWER, NOW), false)
  assert.equal(matchesAudience(target, seen(0), NOW), false)
  assert.equal(matchesAudience(target, seen(RETURNING_AFTER_MS - 1), NOW), false)
  assert.equal(matchesAudience(target, seen(RETURNING_AFTER_MS), NOW), true)
  assert.equal(matchesAudience(target, seen(9 * DAY), NOW), true)
})

test('isReturning falls back to the account age when the browser has no memory', () => {
  // New device, old account: still a returning person.
  const freshBrowser = viewer({
    userId: 'u-1', role: 'athlete',
    accountCreatedAt: new Date(AT - 5 * DAY).toISOString(),
    firstSeenAt: new Date(AT).toISOString(),
  })
  assert.equal(isReturning(freshBrowser, NOW), true)

  // Signed up ten minutes ago on a browser that has never been here: not yet.
  const brandNew = viewer({
    userId: 'u-2', role: 'athlete',
    accountCreatedAt: new Date(AT - 10 * 60 * 1000).toISOString(),
    firstSeenAt: new Date(AT).toISOString(),
  })
  assert.equal(isReturning(brandNew, NOW), false)

  // Garbage in either field is "no idea", never a match.
  assert.equal(isReturning(viewer({ firstSeenAt: 'yesterday-ish' }), NOW), false)
  assert.equal(isReturning(viewer({ accountCreatedAt: '' }), NOW), false)
})

test('returning_anonymous is the visitor who came back but never signed up', () => {
  const target: AudienceTarget = { type: 'returning_anonymous' }
  const old = new Date(AT - 3 * DAY).toISOString()

  assert.equal(matchesAudience(target, viewer({ firstSeenAt: old }), NOW), true)
  assert.equal(matchesAudience(target, viewer({ firstSeenAt: new Date(AT).toISOString() }), NOW), false)
  // Same browser history, but they have an account now.
  assert.equal(matchesAudience(target, viewer({ userId: 'u-1', role: 'athlete', firstSeenAt: old }), NOW), false)
})

test('an unknown or missing target fails open and shows to everybody', () => {
  for (const bad of [null, undefined, {}, { type: 'vip' }, { type: 'role ' }, 'all', 12, []]) {
    assert.equal(matchesAudience(bad, ANONYMOUS_VIEWER, NOW), true, `expected fail-open for ${JSON.stringify(bad)}`)
    assert.equal(matchesAudience(bad, member('athlete'), NOW), true)
  }
})

test('matchesAudience treats a missing viewer as anonymous rather than throwing', () => {
  const nobody = undefined as unknown as AnnouncementViewer
  assert.equal(matchesAudience({ type: 'anonymous' }, nobody, NOW), true)
  assert.equal(matchesAudience({ type: 'authenticated' }, nobody, NOW), false)
})

// ---------------------------------------------------------------------------
// 3. selectAnnouncement: one banner, several live rows
// ---------------------------------------------------------------------------
interface Row {
  id: string
  priority: number
  created_at: string
  target_audience: unknown
}

const row = (over: Partial<Row> & { id: string }): Row => ({
  priority: 0,
  created_at: '2026-08-01T10:00:00.000Z',
  target_audience: { type: 'all' },
  ...over,
})

test('selectAnnouncement takes the highest priority', () => {
  const rows = [
    row({ id: 'low', priority: 0 }),
    row({ id: 'high', priority: 9 }),
    row({ id: 'mid', priority: 3 }),
  ]
  assert.equal(selectAnnouncement(rows, ANONYMOUS_VIEWER, NOW, [])?.id, 'high')
})

test('selectAnnouncement breaks a priority tie on the newest row', () => {
  const rows = [
    row({ id: 'older', priority: 5, created_at: '2026-08-01T10:00:00.000Z' }),
    row({ id: 'newer', priority: 5, created_at: '2026-08-09T10:00:00.000Z' }),
    row({ id: 'newest-but-lower', priority: 4, created_at: '2026-08-12T10:00:00.000Z' }),
  ]
  assert.equal(selectAnnouncement(rows, ANONYMOUS_VIEWER, NOW, [])?.id, 'newer')
})

test('selectAnnouncement skips the rows this viewer is not for', () => {
  const rows = [
    row({ id: 'staff', priority: 100, target_audience: { type: 'role', roles: ['coach'] } }),
    row({ id: 'signed-in', priority: 50, target_audience: { type: 'authenticated' } }),
    row({ id: 'everyone', priority: 1 }),
  ]

  assert.equal(selectAnnouncement(rows, ANONYMOUS_VIEWER, NOW, [])?.id, 'everyone')
  assert.equal(selectAnnouncement(rows, member('athlete'), NOW, [])?.id, 'signed-in')
  assert.equal(selectAnnouncement(rows, member('coach'), NOW, [])?.id, 'staff')
})

test('selectAnnouncement passes over a dismissed row and shows the next one', () => {
  const rows = [
    row({ id: 'a', priority: 9 }),
    row({ id: 'b', priority: 5 }),
  ]
  assert.equal(selectAnnouncement(rows, ANONYMOUS_VIEWER, NOW, ['a'])?.id, 'b')
  assert.equal(selectAnnouncement(rows, ANONYMOUS_VIEWER, NOW, ['a', 'b']), null)
  assert.equal(selectAnnouncement(rows, ANONYMOUS_VIEWER, NOW, ['other'])?.id, 'a')
})

test('selectAnnouncement answers null for an empty list and never mutates its input', () => {
  assert.equal(selectAnnouncement([], ANONYMOUS_VIEWER, NOW, []), null)

  const rows = [row({ id: 'a', priority: 1 }), row({ id: 'b', priority: 8 })]
  const order = rows.map(r => r.id)
  selectAnnouncement(rows, ANONYMOUS_VIEWER, NOW, [])
  assert.deepEqual(rows.map(r => r.id), order)
})

test('selectAnnouncement shows an unparseable row rather than hiding it', () => {
  const rows = [row({ id: 'broken', priority: 2, target_audience: { type: 'members-only' } })]
  assert.equal(selectAnnouncement(rows, ANONYMOUS_VIEWER, NOW, [])?.id, 'broken')
})

test('selectAnnouncement also reads camelCase rows, which is what marketing.ts returns', () => {
  const mapped = [
    { id: 'x', priority: 2, createdAt: '2026-08-02T10:00:00.000Z', targetAudience: { type: 'anonymous' as const } },
    { id: 'y', priority: 1, createdAt: '2026-08-03T10:00:00.000Z', targetAudience: { type: 'all' as const } },
  ]
  assert.equal(selectAnnouncement(mapped, ANONYMOUS_VIEWER, NOW, [])?.id, 'x')
  assert.equal(selectAnnouncement(mapped, member('athlete'), NOW, [])?.id, 'y')
})

// ---------------------------------------------------------------------------
// 4. first seen: the only thing that touches storage
// ---------------------------------------------------------------------------
function withStore(store: unknown, fn: () => void): void {
  const g = globalThis as Record<string, unknown>
  const had = 'localStorage' in g
  const previous = g.localStorage
  g.localStorage = store
  try {
    fn()
  } finally {
    if (had) g.localStorage = previous
    else delete g.localStorage
  }
}

function fakeStore() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
  }
}

test('recordFirstSeen writes once and readFirstSeen reads it back', () => {
  const store = fakeStore()
  withStore(store, () => {
    assert.equal(readFirstSeen(), null)

    recordFirstSeen(NOW)
    assert.equal(store.map.get(FIRST_SEEN_KEY), NOW.toISOString())
    assert.equal(readFirstSeen(), NOW.toISOString())

    // A later visit must not move the stamp, or nobody is ever returning.
    recordFirstSeen(new Date(AT + 3 * DAY))
    assert.equal(readFirstSeen(), NOW.toISOString())
  })
})

test('readFirstSeen ignores a stamp that is not a date', () => {
  const store = fakeStore()
  store.map.set(FIRST_SEEN_KEY, 'once upon a time')
  withStore(store, () => assert.equal(readFirstSeen(), null))
})

test('the storage helpers survive a browser that refuses storage', () => {
  const hostile = {
    getItem: () => { throw new Error('SecurityError') },
    setItem: () => { throw new Error('QuotaExceededError') },
  }
  withStore(hostile, () => {
    assert.equal(readFirstSeen(), null)
    assert.doesNotThrow(() => recordFirstSeen(NOW))
  })
})

test('the storage helpers survive there being no storage at all', () => {
  withStore(undefined, () => {
    assert.equal(readFirstSeen(), null)
    assert.doesNotThrow(() => recordFirstSeen(NOW))
  })
})

// A viewer built from a browser with no memory is the anonymous one, which is
// what the banner uses while auth is still loading.
test('ANONYMOUS_VIEWER is empty in all four fields', () => {
  assert.deepEqual(ANONYMOUS_VIEWER, {
    userId: null, role: null, accountCreatedAt: null, firstSeenAt: null,
  })
})
