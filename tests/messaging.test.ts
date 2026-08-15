import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  audienceIncludes,
  cleanMessageBody,
  cleanTitle,
  composeConversations,
  MESSAGE_BODY_LIMIT,
  CONVERSATION_TITLE_LIMIT,
} from '../src/lib/messagingApi.ts'
import { composePollState, oneThreadPerNewsletter, pollRefusal } from '../src/lib/newsletterBroadcast.ts'
import type {
  Conversation,
  ConversationMemberRow,
  ConversationSummary,
  MessagingContact,
  Poll,
  PollOption,
} from '../src/types/messaging.ts'

// Pure functions only. Everything else in these modules is a Supabase call and
// belongs to an integration test with a database behind it, not to `node --test`.

// ---------------------------------------------------------------------------
// 1. cleanMessageBody — what actually leaves the composer
// ---------------------------------------------------------------------------
test('cleanMessageBody trims the ends and keeps the middle', () => {
  assert.equal(cleanMessageBody('  hello  '), 'hello')
  assert.equal(cleanMessageBody('\n\n  hello\n\n'), 'hello')
  // Interior structure is the person's, not ours.
  assert.equal(cleanMessageBody('first line\n\nsecond line'), 'first line\n\nsecond line')
  assert.equal(cleanMessageBody('col1\tcol2'), 'col1\tcol2')
})

test('cleanMessageBody normalizes every newline flavour', () => {
  assert.equal(cleanMessageBody('a\r\nb'), 'a\nb')
  // A bare CR is the one that renders as nothing at all if it survives.
  assert.equal(cleanMessageBody('a\rb'), 'a\nb')
  assert.equal(cleanMessageBody('a\r\n\r\nb'), 'a\n\nb')
})

test('cleanMessageBody strips control characters but not tab or newline', () => {
  assert.equal(cleanMessageBody('he\u0000llo'), 'hello')
  assert.equal(cleanMessageBody('he\u0007llo'), 'hello')
  assert.equal(cleanMessageBody('he\u001Bllo'), 'hello')
  assert.equal(cleanMessageBody('he\u007Fllo'), 'hello')
  assert.equal(cleanMessageBody('he\u000Bllo'), 'hello')
  assert.equal(cleanMessageBody('keep\tthis\nand this'), 'keep\tthis\nand this')
})

test('cleanMessageBody answers the empty string for anything with nothing in it', () => {
  assert.equal(cleanMessageBody(''), '')
  assert.equal(cleanMessageBody('   \n\t  '), '')
  assert.equal(cleanMessageBody('\u0000\u0000'), '')
  // Callers refuse on this rather than posting a message the CHECK would reject.
  assert.equal(cleanMessageBody('\r\n'), '')
})

test('cleanMessageBody caps at the column limit and leaves no trailing whitespace', () => {
  const exact = 'x'.repeat(MESSAGE_BODY_LIMIT)
  assert.equal(cleanMessageBody(exact).length, MESSAGE_BODY_LIMIT)
  assert.equal(cleanMessageBody(exact), exact)

  const long = 'y'.repeat(MESSAGE_BODY_LIMIT + 500)
  assert.equal(cleanMessageBody(long).length, MESSAGE_BODY_LIMIT)

  // Truncating mid-space must not leave the string ending in one.
  const spacey = `${'z'.repeat(MESSAGE_BODY_LIMIT - 1)}   tail`
  const cleaned = cleanMessageBody(spacey)
  assert.ok(cleaned.length <= MESSAGE_BODY_LIMIT)
  assert.equal(cleaned, cleaned.trimEnd())
})

// ---------------------------------------------------------------------------
// 2. cleanTitle — channel names and newsletter subjects
// ---------------------------------------------------------------------------
test('cleanTitle collapses a title onto one line', () => {
  assert.equal(cleanTitle('  Team   Axis  '), 'Team Axis')
  assert.equal(cleanTitle('Team\nAxis'), 'Team Axis')
  assert.equal(cleanTitle('Team\t\tAxis'), 'Team Axis')
  assert.equal(cleanTitle('Team\u0000 Axis'), 'Team Axis')
  assert.equal(cleanTitle('   '), '')
})

test('cleanTitle caps at the column limit', () => {
  const long = 'n'.repeat(CONVERSATION_TITLE_LIMIT + 40)
  assert.equal(cleanTitle(long).length, CONVERSATION_TITLE_LIMIT)
})

// ---------------------------------------------------------------------------
// 3. composeConversations — three queries into one inbox
// ---------------------------------------------------------------------------
const ME = 'me-1'

const conversation = (over: Partial<Conversation> & { id: string }): Conversation => ({
  kind: 'dm',
  title: null,
  created_by: null,
  newsletter_id: null,
  last_message_at: '2026-08-13T10:00:00Z',
  last_message_preview: null,
  last_message_from: null,
  created_at: '2026-08-01T10:00:00Z',
  ...over,
})

const member = (conversation_id: string, profile_id: string, unread = false): ConversationMemberRow => ({
  conversation_id,
  profile_id,
  unread,
  joined_at: '2026-08-01T10:00:00Z',
})

const contact = (id: string, display_name: string, role: MessagingContact['role'] = 'coach'): MessagingContact => ({
  id,
  display_name,
  first_name: null,
  last_name: null,
  avatar_url: null,
  role,
  coach_slug: null,
})

test('composeConversations puts everyone except me in members, and my own flag in unread', () => {
  const conversations = [conversation({ id: 'c1' })]
  const members = [member('c1', ME, true), member('c1', 'coach-1', false)]
  const profiles = [contact(ME, 'Me', 'athlete'), contact('coach-1', 'Ronnie Vallejo')]

  const [summary] = composeConversations(conversations, members, profiles, ME)

  assert.equal(summary.unread, true)
  assert.deepEqual(summary.members.map(m => m.id), ['coach-1'])
  // Everything else on the row is carried through untouched.
  assert.equal(summary.id, 'c1')
  assert.equal(summary.kind, 'dm')
})

test('composeConversations reads unread from MY membership row, never the other member', () => {
  const conversations = [conversation({ id: 'c1' })]
  // The other person has not read it. That is not my badge.
  const members = [member('c1', ME, false), member('c1', 'coach-1', true)]
  const profiles = [contact('coach-1', 'Ronnie Vallejo')]

  const [summary] = composeConversations(conversations, members, profiles, ME)
  assert.equal(summary.unread, false)
})

test('composeConversations falls back to a placeholder for a profile it cannot see', () => {
  const conversations = [conversation({ id: 'c1', kind: 'channel', title: 'Team Axis' })]
  const members = [member('c1', ME), member('c1', 'ghost-1'), member('c1', 'coach-1')]
  const profiles = [contact('coach-1', 'Ronnie Vallejo')]

  const [summary] = composeConversations(conversations, members, profiles, ME)

  const ghost = summary.members.find(m => m.id === 'ghost-1')
  assert.ok(ghost, 'a member with no profile row must still appear in the roster')
  assert.equal(ghost.display_name, 'Former member')
  assert.equal(ghost.avatar_url, null)
  assert.equal(ghost.coach_slug, null)
})

test('composeConversations survives a conversation with no membership rows at all', () => {
  const conversations = [conversation({ id: 'c1' })]
  const [summary] = composeConversations(conversations, [], [], ME)

  assert.deepEqual(summary.members, [])
  assert.equal(summary.unread, false)
})

test('composeConversations keeps server order for conversations and sorts members by name', () => {
  const conversations = [
    conversation({ id: 'newest', last_message_at: '2026-08-13T12:00:00Z' }),
    conversation({ id: 'older', last_message_at: '2026-08-11T12:00:00Z' }),
  ]
  const members = [
    member('newest', ME),
    member('newest', 'p-3'),
    member('newest', 'p-1'),
    member('newest', 'p-2'),
    member('older', ME, true),
  ]
  const profiles = [
    contact('p-3', 'Zoe Vance'),
    contact('p-1', 'Aedan Nguyen'),
    contact('p-2', 'Marcus Rivera'),
  ]

  const summaries = composeConversations(conversations, members, profiles, ME)

  assert.deepEqual(summaries.map(s => s.id), ['newest', 'older'])
  assert.deepEqual(summaries[0].members.map(m => m.display_name), [
    'Aedan Nguyen',
    'Marcus Rivera',
    'Zoe Vance',
  ])
  assert.equal(summaries[1].unread, true)
})

test('composeConversations does not mutate what it was given', () => {
  const conversations = [conversation({ id: 'c1' })]
  const members = [member('c1', ME, true), member('c1', 'coach-1')]
  const profiles = [contact('coach-1', 'Ronnie Vallejo')]

  const summaries = composeConversations(conversations, members, profiles, ME)

  assert.equal(Object.hasOwn(conversations[0], 'members'), false)
  assert.equal(Object.hasOwn(conversations[0], 'unread'), false)
  assert.notEqual(summaries[0], conversations[0])
  assert.equal(members.length, 2)
})

// ---------------------------------------------------------------------------
// 4. composePollState — four reads into one widget
// ---------------------------------------------------------------------------
const POLL: Poll = {
  id: 'poll-1',
  newsletter_id: 'news-1',
  question: 'Which day works best?',
  closes_at: null,
  created_at: '2026-08-01T10:00:00Z',
}

const option = (id: string, label: string, position: number, poll_id = 'poll-1'): PollOption => ({
  id,
  poll_id,
  label,
  position,
})

test('composePollState orders options by position and starts every count at zero', () => {
  const options = [option('o-3', 'Sunday', 2), option('o-1', 'Friday', 0), option('o-2', 'Saturday', 1)]
  const state = composePollState(POLL, options, [], [])

  assert.deepEqual(state.options.map(o => o.label), ['Friday', 'Saturday', 'Sunday'])
  assert.deepEqual(state.counts, { 'o-1': 0, 'o-2': 0, 'o-3': 0 })
  assert.equal(state.totalVotes, 0)
  assert.equal(state.myOptionId, null)
})

test('composePollState tallies its own poll and ignores every other poll in the feed', () => {
  const options = [option('o-1', 'Friday', 0), option('o-2', 'Saturday', 1)]
  const results = [
    { poll_id: 'poll-1', option_id: 'o-1', votes: 3 },
    { poll_id: 'poll-1', option_id: 'o-2', votes: 9 },
    // Another poll in the same feed, and an option that no longer exists.
    { poll_id: 'poll-2', option_id: 'x-1', votes: 40 },
    { poll_id: 'poll-1', option_id: 'deleted', votes: 7 },
  ]

  const state = composePollState(POLL, options, results, [])

  assert.deepEqual(state.counts, { 'o-1': 3, 'o-2': 9 })
  assert.equal(state.totalVotes, 12)
})

test('composePollState picks out my vote for THIS poll only', () => {
  const options = [option('o-1', 'Friday', 0), option('o-2', 'Saturday', 1)]
  const myVotes = [
    { poll_id: 'poll-2', option_id: 'x-9' },
    { poll_id: 'poll-1', option_id: 'o-2' },
  ]

  const state = composePollState(POLL, options, [], myVotes)
  assert.equal(state.myOptionId, 'o-2')

  assert.equal(composePollState(POLL, options, [], []).myOptionId, null)
})

test('composePollState keeps options belonging to other polls out of the widget', () => {
  const options = [option('o-1', 'Friday', 0), option('z-1', 'Not mine', 0, 'poll-2')]
  const state = composePollState(POLL, options, [], [])

  assert.deepEqual(state.options.map(o => o.id), ['o-1'])
  assert.equal('z-1' in state.counts, false)
})

// ---------------------------------------------------------------------------
// 5. pollRefusal — what the composer says before the round trip
// ---------------------------------------------------------------------------
test('pollRefusal treats an empty question as "no poll", which is always allowed', () => {
  assert.equal(pollRefusal('', []), null)
  assert.equal(pollRefusal('   ', ['Friday', 'Saturday']), null)
})

test('pollRefusal needs two real options behind a question', () => {
  assert.equal(pollRefusal('Which day?', []), 'A poll needs a question and at least two options.')
  assert.equal(pollRefusal('Which day?', ['Friday']), 'A poll needs a question and at least two options.')
  // Blank rows in the option editor do not count towards the two.
  assert.equal(pollRefusal('Which day?', ['Friday', '   ']), 'A poll needs a question and at least two options.')
  assert.equal(pollRefusal('Which day?', ['Friday', 'Saturday']), null)
})

test('pollRefusal stops at eight options', () => {
  const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  assert.equal(pollRefusal('Which day?', eight), null)
  assert.equal(pollRefusal('Which day?', [...eight, 'i']), 'A poll can have at most eight options.')
})

// ---------------------------------------------------------------------------
// 6. audienceIncludes — who a newsletter actually reaches
// ---------------------------------------------------------------------------
// The client statement of `send_newsletter`'s audience clause (030). It decides
// the demo fan-out, and a screen that previews "this goes to 14 people" would
// read the same answer. If this drifts from the SQL, the composer promises one
// roster and the database delivers another.

test('audienceIncludes: "all" reaches every role', () => {
  assert.equal(audienceIncludes('all', 'athlete'), true)
  assert.equal(audienceIncludes('all', 'coach'), true)
  assert.equal(audienceIncludes('all', 'admin'), true)
})

test('audienceIncludes: "athletes" reaches athletes and nobody on staff', () => {
  assert.equal(audienceIncludes('athletes', 'athlete'), true)
  assert.equal(audienceIncludes('athletes', 'coach'), false)
  assert.equal(audienceIncludes('athletes', 'admin'), false)
})

test('audienceIncludes: "staff" is coaches AND admins', () => {
  // The one that is easy to get wrong. An admin is staff, and a send to the
  // coaching team that skipped the head coach would go unnoticed for months.
  assert.equal(audienceIncludes('staff', 'coach'), true)
  assert.equal(audienceIncludes('staff', 'admin'), true)
  assert.equal(audienceIncludes('staff', 'athlete'), false)
})

// ---------------------------------------------------------------------------
// 7. oneThreadPerNewsletter — the sender's own copies, collapsed
// ---------------------------------------------------------------------------
// A recipient holds one broadcast conversation per newsletter. The sender holds
// one per RECIPIENT, because the fan-out puts them in every room it makes, so
// their Newsletters tab would otherwise list a send to forty people forty times.

const summary = (id: string, newsletter_id: string | null, last_message_at: string): ConversationSummary => ({
  id,
  kind: 'broadcast',
  title: 'Meet week',
  created_by: 'sender-1',
  newsletter_id,
  last_message_at,
  last_message_preview: 'Weigh-ins move to Thursday.',
  last_message_from: 'sender-1',
  created_at: last_message_at,
  members: [],
  unread: false,
})

test('oneThreadPerNewsletter keeps the first row for each newsletter', () => {
  const rows = [
    summary('c1', 'news-1', '2026-08-13T12:00:00Z'),
    summary('c2', 'news-1', '2026-08-13T12:00:00Z'),
    summary('c3', 'news-1', '2026-08-13T12:00:00Z'),
    summary('c4', 'news-2', '2026-08-11T09:00:00Z'),
  ]

  const kept = oneThreadPerNewsletter(rows)
  assert.deepEqual(kept.map(s => s.id), ['c1', 'c4'])
  // Order is the caller's, which is newest first off the server.
  assert.deepEqual(kept.map(s => s.newsletter_id), ['news-1', 'news-2'])
})

test('oneThreadPerNewsletter leaves a recipient list alone', () => {
  const rows = [summary('c1', 'news-1', '2026-08-13T12:00:00Z'), summary('c2', 'news-2', '2026-08-12T12:00:00Z')]
  assert.deepEqual(oneThreadPerNewsletter(rows).map(s => s.id), ['c1', 'c2'])
})

test('oneThreadPerNewsletter keeps every broadcast whose newsletter is gone', () => {
  // `on delete set null`: the newsletter was deleted, the delivery stands. With
  // no id to group on, collapsing these would hide readable announcements.
  const rows = [
    summary('c1', null, '2026-08-13T12:00:00Z'),
    summary('c2', null, '2026-08-12T12:00:00Z'),
    summary('c3', 'news-1', '2026-08-11T12:00:00Z'),
  ]
  assert.deepEqual(oneThreadPerNewsletter(rows).map(s => s.id), ['c1', 'c2', 'c3'])
})

test('oneThreadPerNewsletter does not mutate what it was given', () => {
  const rows = [summary('c1', 'news-1', '2026-08-13T12:00:00Z'), summary('c2', 'news-1', '2026-08-13T12:00:00Z')]
  const kept = oneThreadPerNewsletter(rows)
  assert.equal(rows.length, 2)
  assert.notEqual(kept, rows)
})
