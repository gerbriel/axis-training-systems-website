import { supabase, supabaseConfigured } from './supabase.ts'
import { MESSAGES_PAGE_SIZE } from '../types/messaging.ts'
import type {
  BroadcastNewsletter,
  ChatMessage,
  CoachAssignment,
  Conversation,
  ConversationMemberRow,
  ConversationSummary,
  MessagingContact,
  NewsletterRecipient,
  WriteResult,
} from '../types/messaging.ts'

/**
 * Conversations, messages, and who is allowed to start one.
 *
 * The security posture is worth reading before the code, because almost every
 * odd-looking decision below follows from it.
 *
 * WRITES GO THROUGH RPCs, NOT TABLES. `conversations` and `conversation_members`
 * carry no INSERT, UPDATE or DELETE policy at all — creating a DM, opening a
 * channel, adding somebody, leaving, marking read, every one of those is a
 * SECURITY DEFINER function in 021. That is a deliberate trade of round trips
 * for sentences: the function raises `P0001` with a line written for a person
 * ("You can only message the coaches you are assigned to"), where a direct
 * insert would be refused by RLS with "new row violates row-level security
 * policy for table conversations". `writeMessage` passes our own raised text
 * through verbatim; that is the whole point of the arrangement.
 *
 * `messages` IS written directly, and alone in that. An optimistic send needs
 * the inserted row back in one round trip, and the INSERT policy already says
 * exactly the right thing: you are the sender, you are active, you are in the
 * conversation, and since 033 the room is not a broadcast. A refusal arrives as
 * `42501` and means one of three things in practice: you were removed, your
 * account was suspended, or you typed into a newsletter. All three get a
 * sentence instead of the generic one.
 *
 * ONLY THREE COLUMNS EVER LEAVE HERE ON AN INSERT. 033 narrowed the grant on
 * `messages` to (conversation_id, sender_id, body), so `id` and `created_at` are
 * the database's to write and a client that supplies either is refused with
 * "permission denied for table messages" before RLS is even consulted. Adding a
 * fourth key to the insert below is therefore not a small change, it is an
 * outage.
 *
 * PROFILES ARE NOT JOINABLE. An athlete cannot read any other `profiles` row,
 * not even their coach's, so a PostgREST embed from a conversation to its
 * members comes back empty rather than wrong. Names and avatars arrive from the
 * `messaging_profiles` definer RPC and the client stitches them onto the
 * membership rows itself. `composeConversations` is that stitch, and it is a
 * pure function so it can be tested without a database.
 *
 * Nothing here throws. Reads answer `null` for an outage and `[]` for genuinely
 * empty, because a screen says something different for each. Writes answer a
 * `WriteResult` or a small payload. Every function routes on `offline(isDemo)`
 * first, so the whole surface works with no credentials at all.
 */

// ---------------------------------------------------------------------------
// The contract with migration 021
// ---------------------------------------------------------------------------

// Single string literals, never `.join(',')` — postgrest-js parses the select
// string at the type level and a computed one erases to `string`.
export const CONVERSATION_COLUMNS =
  'id,kind,title,created_by,newsletter_id,last_message_at,last_message_preview,last_message_from,created_at'
export const CONVERSATION_MEMBER_COLUMNS = 'conversation_id,profile_id,unread,joined_at'
export const MESSAGE_COLUMNS = 'id,conversation_id,sender_id,body,created_at'
export const COACH_ASSIGNMENT_COLUMNS = 'athlete_id,coach_id,assigned_at'

/** `messages.body` and `newsletters.body` share this cap on purpose: a newsletter is delivered AS a message. */
export const MESSAGE_BODY_LIMIT = 8000

/** `conversations.title`. Channel names and newsletter subjects both land here. */
export const CONVERSATION_TITLE_LIMIT = 200

/** The newest conversations only. The inbox does not paginate; history does. */
const CONVERSATION_LIST_LIMIT = 100

/**
 * Received newsletters, newest first. A recipient holds exactly one broadcast
 * conversation per newsletter, so this window counts newsletters, and a
 * hundred of them is an archive nobody scrolls.
 */
const RECEIVED_BROADCAST_LIMIT = 100

/**
 * The raw window over a sender's OWN fan-out copies, which arrive in blocks of
 * one-per-recipient sharing a single send-time timestamp. This only has to be
 * deep enough that `oneThreadPerNewsletter` finds at least one copy of each
 * recent send; at this studio's roster size it covers years of newsletters,
 * and older sends remain fully visible in the Newsletter panel's Sent list.
 */
const SENT_BROADCAST_RAW_LIMIT = 400

/**
 * Demo mode and "no credentials configured" are the same situation from a
 * screen's point of view: there is nothing to talk to, and the screen must
 * still render. Every function below routes on this, never on `isDemo` alone.
 */
const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

// ---------------------------------------------------------------------------
// Failure, in sentences
// ---------------------------------------------------------------------------

/**
 * What a PostgREST error becomes on screen.
 *
 * `P0001` and `22023` are `raise exception`s from our own functions, and 021
 * writes those as sentences aimed at a person. They are passed through
 * verbatim: nothing this function could invent beats "You can only message the
 * coaches you are assigned to." Everything else is plumbing and gets translated.
 */
function writeMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  const code = error.code ?? ''
  const msg = (error.message ?? '').replace(/^ERROR:\s*/i, '').trim()

  if ((code === 'P0001' || code === '22023') && msg) return msg
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'The database refused that change. Your account may not have permission any more. Sign out, sign back in, and try again.'
  }
  if (code === '23505') return 'That conversation already exists. Refresh and open it from your inbox.'
  if (code === '23514') {
    return 'That does not fit. A message caps at 8000 characters and a name at 200.'
  }
  if (code === '23503') return 'That person is no longer on the roster. Refresh the screen and try again.'
  if (code === 'PGRST301' || /jwt|token is expired/i.test(msg)) {
    return 'Your session expired. Sign in again and the change will go through.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection. Nothing was changed.'
  }
  return fallback
}

/**
 * Whether the database refused this on policy grounds rather than plumbing.
 *
 * For a message send that means one of two things and both read the same to the
 * person typing: they were removed from the conversation, or their account
 * stopped being active while the tab was open.
 */
function isPolicyRefusal(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  return error.code === '42501' || /row-level security|policy/i.test(error.message ?? '')
}

const NO_SESSION = 'Your session expired. Sign in again and your message will go through.'

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * What actually gets sent.
 *
 * Three jobs. Newlines are normalized, because a paste from Windows or from a
 * PDF arrives as `\r\n` or a bare `\r` and the second one renders as nothing at
 * all. Control characters are stripped except tab and newline, because a pasted
 * NUL or an ANSI escape is never something a person typed on purpose and the
 * database check would refuse some of them anyway. And the result is capped at
 * the column's own limit, so a long paste is shortened here rather than
 * bouncing off `messages_body_check` with `23514`.
 *
 * Trimmed at both ends, twice: once so a whitespace-only draft becomes the
 * empty string a caller can refuse, and once after the cap so the truncation
 * itself cannot leave a trailing space.
 */
export function cleanMessageBody(raw: string): string {
  return (raw ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MESSAGE_BODY_LIMIT)
    .trimEnd()
}

/** A channel name or newsletter subject: one line, no control characters, capped. */
export function cleanTitle(raw: string): string {
  return (raw ?? '')
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, CONVERSATION_TITLE_LIMIT)
    .trimEnd()
}

/**
 * Somebody who was in this conversation and whose profile we cannot see.
 *
 * Two ways to get here and neither is an error: the account was deleted, or the
 * viewer shares a conversation with somebody they are not otherwise allowed to
 * look up. `messaging_profiles` is generous enough that the second is rare, but
 * a roster with a blank in it is a bug report, and "Former member" is not.
 *
 * The role is the lowest one on purpose. It only ever labels a row, and
 * labelling an unknown as staff would be a claim we cannot support.
 */
function formerMember(id: string): MessagingContact {
  return {
    id,
    display_name: 'Former member',
    first_name: null,
    last_name: null,
    avatar_url: null,
    role: 'athlete',
    coach_slug: null,
  }
}

/**
 * Three queries into one list.
 *
 * Pure, and separate from the fetch that feeds it, because this is where every
 * "whose unread is that" and "who counts as the other person" decision lives
 * and those are worth testing without a network. Conversation order is the
 * server's (`last_message_at desc`) and is preserved; member order is sorted by
 * name here, because PostgREST returns membership rows in whatever order the
 * index hands over and a roster that reshuffles between refreshes looks broken.
 */
export function composeConversations(
  conversations: Conversation[],
  memberRows: ConversationMemberRow[],
  profiles: MessagingContact[],
  me: string,
): ConversationSummary[] {
  const byId = new Map(profiles.map(p => [p.id, p]))

  const roster = new Map<string, ConversationMemberRow[]>()
  for (const row of memberRows) {
    const list = roster.get(row.conversation_id)
    if (list) list.push(row)
    else roster.set(row.conversation_id, [row])
  }

  return conversations.map(conversation => {
    const rows = roster.get(conversation.id) ?? []
    const mine = rows.find(row => row.profile_id === me)
    const members = rows
      .filter(row => row.profile_id !== me)
      .map(row => byId.get(row.profile_id) ?? formerMember(row.profile_id))
      .sort((a, b) => a.display_name.localeCompare(b.display_name))

    return { ...conversation, members, unread: mine?.unread === true }
  })
}

// ---------------------------------------------------------------------------
// Who is asking
// ---------------------------------------------------------------------------

/**
 * The signed-in id, or null.
 *
 * `getSession` reads the stored session rather than calling out, so this is
 * cheap enough to do per fetch and always agrees with the token PostgREST will
 * see. RLS is what actually scopes every query below; this is only needed to
 * work out which membership row is mine.
 */
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

/**
 * The viewer, in demo mode. Exported because the newsletter module composes as
 * this person too, and a draft with a different author id than the broadcast it
 * produces would be a small lie that shows up on screen.
 */
export const DEMO_VIEWER_ID = 'demo-you'

const demoIso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()

/**
 * Four people, chosen so every branch of the picker has something in it: an
 * admin, two coaches, and another athlete. The ids match `userManagement`'s demo
 * roster, so a walk-through that crosses both screens sees the same people.
 */
const DEMO_CONTACTS: MessagingContact[] = [
  { id: 'demo-ronnie', display_name: 'Ronnie Vallejo', first_name: 'Ronnie', last_name: 'Vallejo', avatar_url: null, role: 'admin',   coach_slug: 'ronnie-vallejo' },
  { id: 'demo-seth',   display_name: 'Seth Burman',    first_name: 'Seth',   last_name: 'Burman',  avatar_url: null, role: 'coach',   coach_slug: 'seth-burman' },
  { id: 'demo-lucas',  display_name: 'Lucas Sison',    first_name: 'Lucas',  last_name: 'Sison',   avatar_url: null, role: 'coach',   coach_slug: 'lucas-sison' },
  { id: 'demo-devin',  display_name: 'Devin Cross',    first_name: 'Devin',  last_name: 'Cross',   avatar_url: null, role: 'athlete', coach_slug: null },
]

const DEMO_SELF: MessagingContact = {
  id: DEMO_VIEWER_ID,
  display_name: 'You',
  first_name: null,
  last_name: null,
  avatar_url: null,
  role: 'athlete',
  coach_slug: null,
}

interface DemoState {
  conversations: Conversation[]
  members: ConversationMemberRow[]
  messages: ChatMessage[]
  assignments: CoachAssignment[]
}

/**
 * One coach DM, one channel, one newsletter that landed in the inbox.
 *
 * Between them they cover every rendering branch the workspace has: a two-party
 * thread titled by the other person, a named channel with a roster and a kind
 * pill, and a broadcast that shows a subject and takes no reply at all. The
 * newsletter arrives unread so the badge is not a paragraph nobody sees, and it
 * is filtered out of the inbox by `fetchConversations` the way a live one is:
 * it belongs to the Newsletters tab now.
 */
function seedDemo(): DemoState {
  const dm = 'demo-conv-dm'
  const channel = 'demo-conv-channel'
  const broadcast = 'demo-conv-broadcast'

  const conversations: Conversation[] = [
    {
      id: dm,
      kind: 'dm',
      title: null,
      created_by: 'demo-ronnie',
      newsletter_id: null,
      last_message_at: demoIso(42),
      last_message_preview: 'Send me a video of the last set and I will look tonight.',
      last_message_from: 'demo-ronnie',
      created_at: demoIso(4_320),
    },
    {
      id: channel,
      kind: 'channel',
      title: 'Team Axis',
      created_by: 'demo-ronnie',
      newsletter_id: null,
      last_message_at: demoIso(180),
      last_message_preview: 'Bring your belt, we are working up to a heavy single.',
      last_message_from: 'demo-seth',
      created_at: demoIso(20_160),
    },
    {
      id: broadcast,
      kind: 'broadcast',
      title: 'Welcome to Axis news',
      created_by: 'demo-ronnie',
      newsletter_id: 'demo-news-1',
      last_message_at: demoIso(2_880),
      last_message_preview: 'This is where meet dates, schedule changes and programme notes will land.',
      last_message_from: 'demo-ronnie',
      created_at: demoIso(2_880),
    },
  ]

  const members: ConversationMemberRow[] = [
    { conversation_id: dm, profile_id: DEMO_VIEWER_ID, unread: false, joined_at: demoIso(4_320) },
    { conversation_id: dm, profile_id: 'demo-ronnie', unread: false, joined_at: demoIso(4_320) },

    { conversation_id: channel, profile_id: DEMO_VIEWER_ID, unread: true, joined_at: demoIso(20_160) },
    { conversation_id: channel, profile_id: 'demo-ronnie', unread: false, joined_at: demoIso(20_160) },
    { conversation_id: channel, profile_id: 'demo-seth', unread: false, joined_at: demoIso(20_160) },
    { conversation_id: channel, profile_id: 'demo-devin', unread: false, joined_at: demoIso(20_160) },

    { conversation_id: broadcast, profile_id: DEMO_VIEWER_ID, unread: true, joined_at: demoIso(2_880) },
    { conversation_id: broadcast, profile_id: 'demo-ronnie', unread: false, joined_at: demoIso(2_880) },
  ]

  const messages: ChatMessage[] = [
    { id: 'demo-msg-1', conversation_id: dm, sender_id: 'demo-ronnie', body: 'How did the top set feel on Tuesday?', created_at: demoIso(120) },
    { id: 'demo-msg-2', conversation_id: dm, sender_id: DEMO_VIEWER_ID, body: 'Moved well. Third rep slowed down but the bar path stayed honest.', created_at: demoIso(96) },
    { id: 'demo-msg-3', conversation_id: dm, sender_id: 'demo-ronnie', body: 'Send me a video of the last set and I will look tonight.', created_at: demoIso(42) },

    { id: 'demo-msg-4', conversation_id: channel, sender_id: 'demo-ronnie', body: 'Saturday session moves to 9am. The platform is booked until then.', created_at: demoIso(1_440) },
    { id: 'demo-msg-5', conversation_id: channel, sender_id: 'demo-devin', body: 'Works for me.', created_at: demoIso(900) },
    { id: 'demo-msg-6', conversation_id: channel, sender_id: DEMO_VIEWER_ID, body: 'Same here. I will be there a bit early to warm up.', created_at: demoIso(600) },
    { id: 'demo-msg-7', conversation_id: channel, sender_id: 'demo-seth', body: 'Bring your belt, we are working up to a heavy single.', created_at: demoIso(180) },

    {
      id: 'demo-msg-8',
      conversation_id: broadcast,
      sender_id: 'demo-ronnie',
      body: 'This is where meet dates, schedule changes and programme notes will land. These do not take replies. If you need something, message your coach directly.',
      created_at: demoIso(2_880),
    },
  ]

  const assignments: CoachAssignment[] = [
    { athlete_id: DEMO_VIEWER_ID, coach_id: 'demo-ronnie', assigned_at: demoIso(4_320) },
    { athlete_id: 'demo-devin', coach_id: 'demo-seth', assigned_at: demoIso(10_080) },
  ]

  return { conversations, members, messages, assignments }
}

// Seeded on first access and mutated in place, so a demo walk-through survives
// a tab change. Resets on reload, which is the promise the demo banner makes.
let demo: DemoState | null = null

function demoStore(): DemoState {
  if (!demo) demo = seedDemo()
  return demo
}

/** Demo writes are instant; a beat of latency keeps the sending states honest. */
const beat = () => new Promise<void>(r => setTimeout(r, 220))

const demoId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`

/** What 021's `message_after_insert` does, done locally. */
function demoRollup(state: DemoState, message: ChatMessage) {
  const conversation = state.conversations.find(c => c.id === message.conversation_id)
  if (conversation) {
    conversation.last_message_at = message.created_at
    conversation.last_message_preview = message.body.slice(0, 120)
    conversation.last_message_from = message.sender_id
  }
  for (const row of state.members) {
    if (row.conversation_id === message.conversation_id && row.profile_id !== message.sender_id) {
      row.unread = true
    }
  }
}

/**
 * Who a given audience actually reaches.
 *
 * The client half of `send_newsletter`'s audience clause (030), stated once so
 * the demo and any future screen that wants to say "this will go to 14 people"
 * cannot disagree with the database about what "staff" means. Pure, and tested.
 *
 * `staff` is coaches AND admins, which is the one that would be easy to get
 * wrong: an admin is staff, and a send addressed to the coaching team that
 * quietly skipped the head coach would be a bug nobody noticed for months.
 */
export function audienceIncludes(
  audience: BroadcastNewsletter['audience'],
  role: MessagingContact['role'],
): boolean {
  if (audience === 'all') return true
  if (audience === 'athletes') return role === 'athlete'
  return role === 'coach' || role === 'admin'
}

/**
 * The demo half of a newsletter send: one broadcast conversation per recipient
 * IN THE AUDIENCE, each carrying the body as its first message, exactly as
 * `send_newsletter` does server-side. Lives here rather than in the newsletter
 * module so both halves of demo mode read from one store and the sent
 * newsletter actually shows up in the inbox.
 *
 * The audience filter is not decoration. Without it the demo fans every send
 * out to all four contacts, so "Athletes" and "Coaches and admins" pick
 * differently in the composer and deliver identically, and the recipient list
 * the panel then shows is a straight lie about what the audience column does.
 */
export function deliverDemoBroadcast(
  newsletterId: string,
  subject: string,
  body: string,
  audience: BroadcastNewsletter['audience'] = 'all',
): number {
  const state = demoStore()
  const stamp = new Date().toISOString()
  let sent = 0

  for (const contact of DEMO_CONTACTS.filter(c => audienceIncludes(audience, c.role))) {
    const conversationId = demoId('demo-conv')
    state.conversations.unshift({
      id: conversationId,
      kind: 'broadcast',
      title: subject,
      created_by: DEMO_VIEWER_ID,
      newsletter_id: newsletterId,
      last_message_at: stamp,
      last_message_preview: body.slice(0, 120),
      last_message_from: DEMO_VIEWER_ID,
      created_at: stamp,
    })
    state.members.push(
      { conversation_id: conversationId, profile_id: DEMO_VIEWER_ID, unread: false, joined_at: stamp },
      { conversation_id: conversationId, profile_id: contact.id, unread: true, joined_at: stamp },
    )
    state.messages.push({
      id: demoId('demo-msg'),
      conversation_id: conversationId,
      sender_id: DEMO_VIEWER_ID,
      body,
      created_at: stamp,
    })
    sent += 1
  }

  return sent
}

/**
 * The demo answer to "who did this go to, and have they opened it".
 *
 * Two halves, and the first one is the honest one. If the demo viewer actually
 * SENT this newsletter, the rows are read back out of the store exactly as the
 * `newsletter_recipients` RPC reads them out of the database: every broadcast
 * conversation carrying that newsletter id, the member who is not the sender,
 * `seen` as the inverse of their unread flag. Send in the composer, expand the
 * row, and the two agree, audience and all.
 *
 * The fallback covers the newsletter seeded as already sent, which the demo
 * viewer RECEIVED rather than wrote. There is no sender's-eye view of it in the
 * store, only the viewer's own copy, and a list containing the single word
 * "You" under a row that says four recipients reads as a bug. So the audience
 * is projected onto the contact roster instead, with alternating seen states so
 * both pills are on screen.
 *
 * Which is also why the loop looks only at conversations the viewer created:
 * this call is sender-tier, and answering it from the recipient's half of the
 * store would be answering a different question.
 */
export function demoNewsletterRecipients(
  newsletterId: string,
  audience: BroadcastNewsletter['audience'] = 'all',
): NewsletterRecipient[] {
  const state = demoStore()
  const byId = new Map([DEMO_SELF, ...DEMO_CONTACTS].map(c => [c.id, c]))

  const delivered: NewsletterRecipient[] = []
  for (const conversation of state.conversations) {
    if (conversation.newsletter_id !== newsletterId || conversation.kind !== 'broadcast') continue
    if (conversation.created_by !== DEMO_VIEWER_ID) continue
    for (const row of state.members) {
      if (row.conversation_id !== conversation.id) continue
      if (row.profile_id === conversation.created_by) continue
      const contact = byId.get(row.profile_id)
      delivered.push({
        id: row.profile_id,
        display_name: contact?.display_name ?? 'Former member',
        avatar_url: contact?.avatar_url ?? null,
        role: contact?.role ?? 'athlete',
        seen: !row.unread,
        delivered_at: conversation.created_at,
      })
    }
  }

  if (delivered.length > 0) {
    return delivered.sort((a, b) => a.display_name.localeCompare(b.display_name))
  }

  return DEMO_CONTACTS.filter(c => audienceIncludes(audience, c.role))
    .map((contact, index) => ({
      id: contact.id,
      display_name: contact.display_name,
      avatar_url: contact.avatar_url,
      role: contact.role,
      seen: index % 2 === 0,
      delivered_at: demoIso(2_880),
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The three-query stitch both lists are built from.
 *
 * Three queries, deliberately. The conversations themselves are scoped by RLS
 * with one filter of ours, the kind (a member sees their own rows and nobody
 * else's regardless). The membership rows come back for those ids only, which
 * is both the roster and the viewer's unread flag. The profile projection is a
 * definer RPC because `profiles` is not readable across the roster and never
 * will be.
 *
 * `null` from any of the three is an outage: half an inbox with nameless rows
 * in it is worse than a "we could not load your conversations" line.
 */
async function fetchConversationList(limit: number): Promise<ConversationSummary[] | null> {
  const me = await currentUserId()
  if (!me) return null

  const { data: conversationRows, error } = await supabase
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .neq('kind', 'broadcast')
    .order('last_message_at', { ascending: false })
    .limit(limit)

  if (error) return null
  const conversations = (conversationRows ?? []) as unknown as Conversation[]
  return stitchSummaries(conversations, me)
}

/** The members-and-profiles join shared by every conversation list. */
async function stitchSummaries(
  conversations: Conversation[],
  me: string,
): Promise<ConversationSummary[] | null> {
  if (conversations.length === 0) return []

  const ids = conversations.map(c => c.id)
  const [memberResult, profileResult] = await Promise.all([
    supabase.from('conversation_members').select(CONVERSATION_MEMBER_COLUMNS).in('conversation_id', ids),
    supabase.rpc('messaging_profiles'),
  ])

  if (memberResult.error || profileResult.error) return null

  return composeConversations(
    conversations,
    (memberResult.data ?? []) as unknown as ConversationMemberRow[],
    (profileResult.data ?? []) as unknown as MessagingContact[],
    me,
  )
}

/** The same stitch over the demo store, split on the same boundary. */
function demoConversationList(broadcasts: boolean): ConversationSummary[] {
  const state = demoStore()
  const conversations = state.conversations
    .filter(c => (c.kind === 'broadcast') === broadcasts)
    .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))

  return composeConversations(
    conversations.map(c => ({ ...c })),
    state.members.map(m => ({ ...m })),
    [DEMO_SELF, ...DEMO_CONTACTS],
    DEMO_VIEWER_ID,
  )
}

/**
 * The inbox, newest conversation first. DMs and channels only.
 *
 * Broadcasts are excluded here and returned by `fetchBroadcastSummaries`
 * instead, because a newsletter is no longer a conversation you can answer
 * (033) and a thread with no composer in it does not belong in a list whose
 * whole promise is that you can reply. They keep their own membership rows, so
 * the unread badge still counts them: `fetchUnreadConversationCount` asks
 * `conversation_members` and is deliberately not filtered by kind.
 */
export async function fetchConversations(isDemo = false): Promise<ConversationSummary[] | null> {
  if (offline(isDemo)) return demoConversationList(false)
  return fetchConversationList(CONVERSATION_LIST_LIMIT)
}

/**
 * The other half: newsletters delivered to the viewer, newest first.
 *
 * Conversations only. Joining them to the newsletters and polls behind them is
 * `newsletterBroadcast.fetchNewsletterThreads`, which is where every other
 * newsletter read already lives. This module knows about rooms; that one knows
 * what was in them.
 *
 * Fetched as TWO windows, not one. A sender is a member of every fan-out copy
 * their send created, and those copies all share one send-time timestamp, so a
 * single flat newest-first window would be spent entirely on the latest send:
 * one newsletter to fifty people would evict every newsletter this person had
 * ever RECEIVED, along with the unread flags behind the header badge. Split by
 * `created_by`, the received window holds one row per newsletter by
 * construction, and the sent window only has to be deep enough that
 * `oneThreadPerNewsletter` finds one surviving copy of each recent send.
 * The null check on created_by keeps newsletters from a since-deleted sender
 * in the received pile rather than silently dropped.
 */
export async function fetchBroadcastSummaries(isDemo = false): Promise<ConversationSummary[] | null> {
  if (offline(isDemo)) return demoConversationList(true)

  const me = await currentUserId()
  if (!me) return null

  const [receivedResult, sentResult] = await Promise.all([
    supabase.from('conversations').select(CONVERSATION_COLUMNS)
      .eq('kind', 'broadcast')
      .or(`created_by.is.null,created_by.neq.${me}`)
      .order('last_message_at', { ascending: false })
      .limit(RECEIVED_BROADCAST_LIMIT),
    supabase.from('conversations').select(CONVERSATION_COLUMNS)
      .eq('kind', 'broadcast')
      .eq('created_by', me)
      .order('last_message_at', { ascending: false })
      .limit(SENT_BROADCAST_RAW_LIMIT),
  ])

  if (receivedResult.error || sentResult.error) return null

  const byId = new Map<string, Conversation>()
  for (const row of [
    ...((receivedResult.data ?? []) as unknown as Conversation[]),
    ...((sentResult.data ?? []) as unknown as Conversation[]),
  ]) {
    byId.set(row.id, row)
  }
  const merged = [...byId.values()].sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))

  return stitchSummaries(merged, me)
}

/**
 * One window of a conversation, oldest at the end.
 *
 * Fetched newest-first so the page is the RECENT fifty rather than the first
 * fifty ever sent, then reversed for rendering. `before` is the keyset cursor:
 * pass the oldest `created_at` currently on screen to walk backwards. A short
 * page means there is no more history, which is how a caller knows to stop
 * offering "load earlier".
 */
export async function fetchMessages(
  conversationId: string,
  before: string | null = null,
  isDemo = false,
): Promise<ChatMessage[] | null> {
  if (offline(isDemo)) {
    const rows = demoStore()
      .messages.filter(m => m.conversation_id === conversationId && (!before || m.created_at < before))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    return rows.slice(Math.max(0, rows.length - MESSAGES_PAGE_SIZE)).map(m => ({ ...m }))
  }

  let query = supabase.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', conversationId)
  if (before) query = query.lt('created_at', before)

  const { data, error } = await query.order('created_at', { ascending: false }).limit(MESSAGES_PAGE_SIZE)

  if (error) return null
  return ((data ?? []) as unknown as ChatMessage[]).reverse()
}

/** Who the viewer may START a conversation with. `null` is an outage, `[]` is genuinely nobody. */
export async function fetchContacts(isDemo = false): Promise<MessagingContact[] | null> {
  if (offline(isDemo)) return DEMO_CONTACTS.map(c => ({ ...c }))

  const { data, error } = await supabase.rpc('list_message_contacts')
  if (error) return null
  return (data ?? []) as unknown as MessagingContact[]
}

/**
 * Everybody the viewer shares a conversation with, plus themselves, plus
 * everybody they could start one with. The map a screen builds from this is
 * what turns a `sender_id` into a name.
 */
export async function fetchMessagingProfiles(isDemo = false): Promise<MessagingContact[] | null> {
  if (offline(isDemo)) return [DEMO_SELF, ...DEMO_CONTACTS].map(c => ({ ...c }))

  const { data, error } = await supabase.rpc('messaging_profiles')
  if (error) return null
  return (data ?? []) as unknown as MessagingContact[]
}

/**
 * Conversations with something unread in them, not messages.
 *
 * Unread is one boolean per membership row, so this is a head count and never
 * touches `messages`. A badge that has to be right within a second is worth
 * exactly one cheap query.
 */
export async function fetchUnreadConversationCount(isDemo = false): Promise<number | null> {
  if (offline(isDemo)) {
    return demoStore().members.filter(m => m.profile_id === DEMO_VIEWER_ID && m.unread).length
  }

  const me = await currentUserId()
  if (!me) return null

  const { count, error } = await supabase
    .from('conversation_members')
    .select('conversation_id', { count: 'exact', head: true })
    .eq('profile_id', me)
    .eq('unread', true)

  if (error) return null
  return count ?? 0
}

/**
 * Which coaches each athlete is assigned to.
 *
 * RLS narrows this by itself: an athlete sees their own rows, a coach sees
 * theirs, and only an admin or a holder of `manage_athletes` sees the whole
 * board. The staff screen is the caller that needs all of it.
 */
export async function fetchCoachAssignments(isDemo = false): Promise<CoachAssignment[] | null> {
  if (offline(isDemo)) return demoStore().assignments.map(a => ({ ...a }))

  const { data, error } = await supabase
    .from('athlete_coaches')
    .select(COACH_ASSIGNMENT_COLUMNS)
    .order('assigned_at', { ascending: false })
    .limit(2000)

  if (error) return null
  return (data ?? []) as unknown as CoachAssignment[]
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Send one message.
 *
 * The only direct table write in this file, and the only one that hands back a
 * row: an optimistic bubble has to be replaced by the real thing, with the real
 * id, or the realtime INSERT that follows would render it twice.
 *
 * `.select().single()` is not decoration. Without it an RLS refusal can come
 * back as a successful request that inserted nothing, and the person would
 * watch their message sit there looking sent.
 *
 * Three columns and no more. 033 narrowed the INSERT grant to exactly these,
 * so `id` and `created_at` come from the defaults and are read back out of the
 * row this returns. See the header.
 *
 * The signature deliberately does not learn about broadcasts. A newsletter has
 * no composer to type into, so the only ways to reach this with one are a stale
 * tab and a REST client, and both are answered by the policy. Screens that know
 * they are rendering a newsletter say so themselves rather than round-tripping
 * to be told.
 */
export async function sendMessage(
  conversationId: string,
  body: string,
  isDemo = false,
): Promise<{ ok: true; message: ChatMessage } | { ok: false; message: string }> {
  const clean = cleanMessageBody(body)
  if (!clean) return { ok: false, message: 'Type a message first.' }

  if (offline(isDemo)) {
    await beat()
    const state = demoStore()
    const conversation = state.conversations.find(c => c.id === conversationId)
    if (!conversation) {
      return { ok: false, message: 'That conversation is no longer in your inbox.' }
    }
    // What 033's fourth WITH CHECK clause does, done locally. A demo that let a
    // newsletter be answered would be teaching the wrong thing about the app.
    if (conversation.kind === 'broadcast') {
      return { ok: false, message: 'Newsletters do not take replies.' }
    }
    const message: ChatMessage = {
      id: demoId('demo-msg'),
      conversation_id: conversationId,
      sender_id: DEMO_VIEWER_ID,
      body: clean,
      created_at: new Date().toISOString(),
    }
    state.messages.push(message)
    demoRollup(state, message)
    return { ok: true, message: { ...message } }
  }

  const me = await currentUserId()
  if (!me) return { ok: false, message: NO_SESSION }

  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: me, body: clean })
    .select(MESSAGE_COLUMNS)
    .single()

  if (error) {
    // Removed from the channel, or suspended mid-session. Both refuse at the
    // INSERT policy and both read the same to the person typing.
    if (isPolicyRefusal(error)) {
      return { ok: false, message: 'You can no longer send messages in this conversation.' }
    }
    return { ok: false, message: writeMessage(error, 'Your message was not sent.') }
  }
  if (!data) return { ok: false, message: 'You can no longer send messages in this conversation.' }

  return { ok: true, message: data as unknown as ChatMessage }
}

/**
 * Open the DM with somebody, creating it if this is the first one.
 *
 * Find-then-insert from the client is racy — two people opening each other at
 * the same moment end up with two threads and half the history in each — so the
 * whole thing is one definer RPC over a normalized pair and a partial unique
 * index. `can_message` is checked inside it, which is also where the refusal
 * sentence comes from.
 */
export async function openDm(
  otherId: string,
  isDemo = false,
): Promise<{ ok: true; conversationId: string } | { ok: false; message: string }> {
  if (offline(isDemo)) {
    await beat()
    const state = demoStore()
    const existing = state.conversations.find(
      c =>
        c.kind === 'dm' &&
        state.members.some(m => m.conversation_id === c.id && m.profile_id === otherId) &&
        state.members.some(m => m.conversation_id === c.id && m.profile_id === DEMO_VIEWER_ID),
    )
    if (existing) return { ok: true, conversationId: existing.id }

    const stamp = new Date().toISOString()
    const conversationId = demoId('demo-conv')
    state.conversations.unshift({
      id: conversationId,
      kind: 'dm',
      title: null,
      created_by: DEMO_VIEWER_ID,
      newsletter_id: null,
      last_message_at: stamp,
      last_message_preview: null,
      last_message_from: null,
      created_at: stamp,
    })
    state.members.push(
      { conversation_id: conversationId, profile_id: DEMO_VIEWER_ID, unread: false, joined_at: stamp },
      { conversation_id: conversationId, profile_id: otherId, unread: false, joined_at: stamp },
    )
    return { ok: true, conversationId }
  }

  const { data, error } = await supabase.rpc('get_or_create_dm', { p_other: otherId })
  if (error) return { ok: false, message: writeMessage(error, 'Could not open that conversation.') }

  const conversationId = (data ?? null) as string | null
  if (!conversationId) return { ok: false, message: 'Could not open that conversation.' }
  return { ok: true, conversationId }
}

/**
 * Create a named channel.
 *
 * Gated on `manage_channels` (or being an admin) inside the RPC, which also
 * validates every member against the same `can_message` matrix a DM uses. A
 * coach cannot assemble a channel out of athletes who are not theirs.
 */
export async function createChannel(
  title: string,
  memberIds: string[],
  isDemo = false,
): Promise<{ ok: true; conversationId: string } | { ok: false; message: string }> {
  const name = cleanTitle(title)
  if (!name) return { ok: false, message: 'A channel needs a name.' }

  const members = [...new Set(memberIds.filter(Boolean))]

  if (offline(isDemo)) {
    await beat()
    const state = demoStore()
    const stamp = new Date().toISOString()
    const conversationId = demoId('demo-conv')
    state.conversations.unshift({
      id: conversationId,
      kind: 'channel',
      title: name,
      created_by: DEMO_VIEWER_ID,
      newsletter_id: null,
      last_message_at: stamp,
      last_message_preview: null,
      last_message_from: null,
      created_at: stamp,
    })
    state.members.push({ conversation_id: conversationId, profile_id: DEMO_VIEWER_ID, unread: false, joined_at: stamp })
    for (const id of members.filter(id => id !== DEMO_VIEWER_ID)) {
      state.members.push({ conversation_id: conversationId, profile_id: id, unread: false, joined_at: stamp })
    }
    return { ok: true, conversationId }
  }

  const { data, error } = await supabase.rpc('create_channel', { p_title: name, p_member_ids: members })
  if (error) return { ok: false, message: writeMessage(error, 'Could not create that channel.') }

  const conversationId = (data ?? null) as string | null
  if (!conversationId) return { ok: false, message: 'Could not create that channel.' }
  return { ok: true, conversationId }
}

/** Add and remove channel members in one call, so a swap is never half-applied. */
export async function updateChannelMembers(
  conversationId: string,
  add: string[],
  remove: string[],
  isDemo = false,
): Promise<WriteResult> {
  const toAdd = [...new Set(add.filter(Boolean))]
  const toRemove = [...new Set(remove.filter(Boolean))]
  if (toAdd.length === 0 && toRemove.length === 0) return { ok: true }

  if (offline(isDemo)) {
    await beat()
    const state = demoStore()
    const stamp = new Date().toISOString()
    state.members = state.members.filter(
      m => !(m.conversation_id === conversationId && toRemove.includes(m.profile_id)),
    )
    for (const id of toAdd) {
      const already = state.members.some(m => m.conversation_id === conversationId && m.profile_id === id)
      if (!already) state.members.push({ conversation_id: conversationId, profile_id: id, unread: false, joined_at: stamp })
    }
    return { ok: true }
  }

  const { error } = await supabase.rpc('update_channel_members', {
    p_conversation_id: conversationId,
    p_add: toAdd,
    p_remove: toRemove,
  })
  if (error) return { ok: false, message: writeMessage(error, 'Could not update who is in that channel.') }
  return { ok: true }
}

/** Rename a channel. Same authorization as changing its members. */
export async function renameChannel(conversationId: string, title: string, isDemo = false): Promise<WriteResult> {
  const name = cleanTitle(title)
  if (!name) return { ok: false, message: 'A channel needs a name.' }

  if (offline(isDemo)) {
    await beat()
    const conversation = demoStore().conversations.find(c => c.id === conversationId)
    if (!conversation) return { ok: false, message: 'That channel is no longer in your inbox.' }
    conversation.title = name
    return { ok: true }
  }

  const { error } = await supabase.rpc('rename_channel', { p_conversation_id: conversationId, p_title: name })
  if (error) return { ok: false, message: writeMessage(error, 'Could not rename that channel.') }
  return { ok: true }
}

/**
 * Leave a channel.
 *
 * Channels only. A DM has two people in it and leaving would delete half a
 * conversation for somebody who did not agree to that; a broadcast is a record
 * of what was sent. The RPC refuses both with a sentence of its own.
 */
export async function leaveConversation(conversationId: string, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) {
    await beat()
    const state = demoStore()
    const conversation = state.conversations.find(c => c.id === conversationId)
    if (!conversation) return { ok: false, message: 'That conversation is no longer in your inbox.' }
    if (conversation.kind !== 'channel') {
      return { ok: false, message: 'You can leave a channel. Direct messages and newsletters stay in your inbox.' }
    }
    state.members = state.members.filter(
      m => !(m.conversation_id === conversationId && m.profile_id === DEMO_VIEWER_ID),
    )
    state.conversations = state.conversations.filter(c => c.id !== conversationId)
    return { ok: true }
  }

  const { error } = await supabase.rpc('leave_conversation', { p_conversation_id: conversationId })
  if (error) return { ok: false, message: writeMessage(error, 'Could not leave that conversation.') }
  return { ok: true }
}

/**
 * Clear the viewer's own unread flag. Fire and forget on purpose.
 *
 * It runs on open and again on every message that arrives while the tab is
 * focused, so it is the most-called write in the feature and the least worth
 * interrupting anybody over. A failure means the badge stays up for another few
 * seconds and the next open tries again.
 */
export async function markConversationRead(conversationId: string, isDemo = false): Promise<void> {
  if (offline(isDemo)) {
    for (const row of demoStore().members) {
      if (row.conversation_id === conversationId && row.profile_id === DEMO_VIEWER_ID) row.unread = false
    }
    return
  }

  await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId })
}

/**
 * Assign an athlete to a coach, or take the assignment away.
 *
 * This is the table that decides who an athlete may message at all, so 033
 * gates the write on `manage_staff`, which only an admin can hand out, and the
 * trigger refuses a pairing that is not an active athlete and an active staff
 * member. It was `manage_athletes` until 033 and that was a hole: every coach
 * holds `manage_athletes` by role default (016), so any coach could assign
 * themselves any athlete and message them. Reading the board is still
 * `manage_athletes`, which is what the People panel's matrix needs.
 *
 * `.select()` on both halves, for the usual reason: an RLS refusal comes back
 * as zero rows rather than an error, and a screen that reads that as success
 * shows a toggle in a state the database never agreed to. A duplicate insert is
 * the exception. It means the row is already there, which is the end state the
 * caller asked for.
 */
export async function setCoachAssignment(
  athleteId: string,
  coachId: string,
  assigned: boolean,
  isDemo = false,
): Promise<WriteResult> {
  if (offline(isDemo)) {
    await beat()
    const state = demoStore()
    if (assigned) {
      const already = state.assignments.some(a => a.athlete_id === athleteId && a.coach_id === coachId)
      if (!already) {
        state.assignments.push({ athlete_id: athleteId, coach_id: coachId, assigned_at: new Date().toISOString() })
      }
    } else {
      state.assignments = state.assignments.filter(a => !(a.athlete_id === athleteId && a.coach_id === coachId))
    }
    return { ok: true }
  }

  const me = await currentUserId()

  if (assigned) {
    const { data, error } = await supabase
      .from('athlete_coaches')
      .insert({ athlete_id: athleteId, coach_id: coachId, assigned_by: me })
      .select('athlete_id')

    if (error) {
      if (error.code === '23505') return { ok: true }
      return { ok: false, message: writeMessage(error, 'Could not save that coach assignment.') }
    }
    if (!data || data.length === 0) {
      return { ok: false, message: 'That assignment was not saved. Changing who coaches an athlete needs an admin, or the manage staff permission.' }
    }
    return { ok: true }
  }

  const { data, error } = await supabase
    .from('athlete_coaches')
    .delete()
    .eq('athlete_id', athleteId)
    .eq('coach_id', coachId)
    .select('athlete_id')

  if (error) return { ok: false, message: writeMessage(error, 'Could not remove that coach assignment.') }
  if (!data || data.length === 0) {
    return { ok: false, message: 'That assignment was not removed. Changing who coaches an athlete needs an admin, or the manage staff permission.' }
  }
  return { ok: true }
}
