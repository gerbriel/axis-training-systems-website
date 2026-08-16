import { supabase, supabaseConfigured } from './supabase.ts'
import {
  cleanMessageBody,
  cleanTitle,
  deliverDemoBroadcast,
  demoNewsletterRecipients,
  fetchBroadcastSummaries,
  CONVERSATION_TITLE_LIMIT,
  DEMO_VIEWER_ID,
  MESSAGE_BODY_LIMIT,
} from './messagingApi.ts'
import type {
  BroadcastNewsletter,
  ConversationSummary,
  NewsletterRecipient,
  NewsletterThread,
  Poll,
  PollOption,
  PollState,
  WriteResult,
} from '../types/messaging.ts'

/**
 * Newsletters, which are messages wearing a hat.
 *
 * There is no email in this file and there is not meant to be. Sending a
 * newsletter fans it out IN THE APP: `send_newsletter` (030) writes one
 * broadcast conversation per recipient and drops the body into it as the first
 * message. That is the whole reason the feature is worth having over a mail
 * merge, and it is why `newsletters.body` and `messages.body` share one 8000
 * character cap. A body that fits the first table and not the second would fail
 * halfway through a fan-out and roll the entire send back.
 *
 * WHAT THE FAN-OUT IS FOR, since 033. Not the reply: a newsletter is an
 * announcement and the messages INSERT policy now refuses one into a broadcast
 * outright. What one conversation per recipient still buys is per-person
 * unread, per-person realtime, and a delivery record, which is exactly what
 * `fetchNewsletterThreads` reads back for the recipient and what
 * `fetchNewsletterRecipients` reads back for the sender. Somebody who needs to
 * ask their coach something has a DM with them one tab away.
 *
 * Two audiences read this module. STAFF holding `send_marketing` (admins
 * always) compose, save, attach a poll, and send. EVERYBODY reads the news feed
 * and votes. The database tells those apart by policy, not by which function
 * was called: a draft is invisible to a recipient, and a poll only becomes
 * readable once its newsletter is sent.
 *
 * Poll writes have no INSERT/UPDATE/DELETE policies at all. `upsert_newsletter_poll`
 * and `cast_vote` are the only ways in, and tallies come back from
 * `poll_results_multi`, a definer aggregate, so a count never carries the
 * identities behind it. A voter can read exactly one `poll_votes` row: their own.
 *
 * Nothing throws. Reads answer `null` for an outage and `[]` for genuinely
 * empty; writes answer a `WriteResult` or a small payload with a sentence.
 */

// ---------------------------------------------------------------------------
// The contract with migrations 030 and 033
// ---------------------------------------------------------------------------

export const NEWSLETTER_COLUMNS =
  'id,author_id,subject,body,audience,status,recipient_count,created_at,sent_at'
const POLL_COLUMNS = 'id,newsletter_id,question,closes_at,created_at'
const POLL_OPTION_COLUMNS = 'id,poll_id,label,position'

export type NewsletterAudience = BroadcastNewsletter['audience']

/** The three audiences, said the way a person would say them. */
export const AUDIENCE_LABELS: Record<NewsletterAudience, string> = {
  all: 'Everyone',
  athletes: 'Athletes',
  staff: 'Coaches and admins',
}

/**
 * Both borrowed from the messaging side rather than restated, because they are
 * not independent numbers. A newsletter subject becomes a conversation title
 * and a newsletter body becomes a message, so a limit that drifts apart here is
 * a fan-out that fails halfway through with `23514`.
 */
export const NEWSLETTER_SUBJECT_LIMIT = CONVERSATION_TITLE_LIMIT
export const NEWSLETTER_BODY_LIMIT = MESSAGE_BODY_LIMIT
export const POLL_MIN_OPTIONS = 2
export const POLL_MAX_OPTIONS = 8

/** The news feed is a feed, not an archive. Older sends live in the sent list. */
const NEWS_FEED_LIMIT = 50

/** Newsletters shown in the messaging Newsletters tab, counted AFTER the
 *  one-per-newsletter collapse so a big send cannot spend the window. */
const NEWSLETTER_THREAD_LIMIT = 100

const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

// ---------------------------------------------------------------------------
// Failure, in sentences
// ---------------------------------------------------------------------------

/**
 * The same translation `messagingApi` does, with this file's own vocabulary for
 * the constraint codes. `P0001` and `22023` are our own `raise exception`s from
 * 030 and 033 and pass through verbatim, which is why "You can only edit a poll
 * on a draft newsletter" and "Only newsletter senders can see recipients."
 * reach the screen intact.
 */
function writeMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  const code = error.code ?? ''
  const msg = (error.message ?? '').replace(/^ERROR:\s*/i, '').trim()

  if ((code === 'P0001' || code === '22023') && msg) return msg
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'The database refused that. Your account may not have permission to send newsletters any more.'
  }
  if (code === '23514') {
    return 'That does not fit. A subject caps at 200 characters and a newsletter at 8000.'
  }
  if (code === '23503') return 'That newsletter is no longer there. Refresh the screen and try again.'
  if (code === 'PGRST301' || /jwt|token is expired/i.test(msg)) {
    return 'Your session expired. Sign in again and the change will go through.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection. Nothing was changed.'
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * A poll, its options, its tallies and my pick, assembled from four separate
 * reads. Pure so the arithmetic is testable without a database.
 *
 * Every option starts at zero rather than being absent, because a bar chart
 * with a missing bar reads as a rendering bug and a bar at zero reads as an
 * option nobody picked. `totalVotes` counts only votes for options that still
 * exist, which is the same set the database can produce anyway (a deleted
 * option takes its votes with it).
 */
export function composePollState(
  poll: Poll,
  options: PollOption[],
  results: Array<{ poll_id: string; option_id: string; votes: number }>,
  myVotes: Array<{ poll_id: string; option_id: string }>,
): PollState {
  const mine = options
    .filter(option => option.poll_id === poll.id)
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label))

  const counts: Record<string, number> = {}
  for (const option of mine) counts[option.id] = 0

  let totalVotes = 0
  for (const row of results) {
    if (row.poll_id !== poll.id) continue
    if (!(row.option_id in counts)) continue
    const votes = Number(row.votes) || 0
    counts[row.option_id] = votes
    totalVotes += votes
  }

  const myVote = myVotes.find(vote => vote.poll_id === poll.id)

  return {
    poll,
    options: mine,
    counts,
    myOptionId: myVote?.option_id ?? null,
    totalVotes,
  }
}

/**
 * One thread per newsletter, keeping the newest.
 *
 * A RECIPIENT never needs this: the fan-out writes one broadcast conversation
 * per person and `send_newsletter` refuses to run twice on the same newsletter,
 * so their list is already one to one. The SENDER does. They are a member of
 * every conversation the fan-out created, which is what makes the reply thread
 * theirs and what `newsletter_recipients` counts, so a send to forty people
 * puts forty identically titled rows in their own Newsletters tab.
 *
 * Broadcasts with no newsletter behind them are all kept. Their newsletter was
 * deleted (`on delete set null`), there is no id to group on, and dropping all
 * but one would silently hide announcements that are still perfectly readable.
 *
 * Pure, and takes the list in the order it should keep, which is newest first.
 */
export function oneThreadPerNewsletter(summaries: ConversationSummary[]): ConversationSummary[] {
  const seen = new Set<string>()
  return summaries.filter(summary => {
    if (!summary.newsletter_id) return true
    if (seen.has(summary.newsletter_id)) return false
    seen.add(summary.newsletter_id)
    return true
  })
}

/** What the composer refuses before the round trip, or null. The RPC checks the same things. */
export function pollRefusal(question: string, options: string[]): string | null {
  const q = cleanTitle(question)
  const filled = options.map(option => cleanTitle(option)).filter(Boolean)

  // An empty question means "no poll", which is always allowed: it removes one.
  if (!q) return null
  if (filled.length < POLL_MIN_OPTIONS) return 'A poll needs a question and at least two options.'
  if (filled.length > POLL_MAX_OPTIONS) return 'A poll can have at most eight options.'
  return null
}

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

const demoIso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
const demoId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`

interface DemoNewsState {
  newsletters: BroadcastNewsletter[]
  polls: Poll[]
  options: PollOption[]
  /** Votes cast by everybody else, by option id. The viewer's own vote is added on top. */
  baseCounts: Record<string, number>
  /** The viewer's pick, by poll id. */
  myVotes: Record<string, string>
}

/**
 * One newsletter already sent, carrying a poll with real-looking numbers, and
 * one draft waiting in the composer. Between them the composer, the drafts
 * list, the sent list and the news feed all have something to render, and the
 * poll has an unvoted state to click.
 *
 * The sent one shares its id with the broadcast conversation seeded in
 * `messagingApi`, so opening it from the news feed and finding it in the inbox
 * are the same newsletter.
 */
function seedDemoNews(): DemoNewsState {
  const sentId = 'demo-news-1'
  const pollId = 'demo-poll-1'

  return {
    newsletters: [
      {
        id: sentId,
        author_id: 'demo-ronnie',
        subject: 'Welcome to Axis news',
        body: 'This is where meet dates, schedule changes and programme notes will land. These do not take replies. If you need something, message your coach directly.',
        audience: 'all',
        status: 'sent',
        recipient_count: 4,
        created_at: demoIso(3_000),
        sent_at: demoIso(2_880),
      },
      {
        id: 'demo-news-2',
        author_id: DEMO_VIEWER_ID,
        subject: 'Meet prep week',
        body: 'Openers are due Friday. Bring your singlet to Saturday session so we can check it against the rulebook.',
        audience: 'athletes',
        status: 'draft',
        recipient_count: 0,
        created_at: demoIso(90),
        sent_at: null,
      },
    ],
    polls: [
      {
        id: pollId,
        newsletter_id: sentId,
        question: 'Which day works best for the next team lift?',
        closes_at: null,
        created_at: demoIso(2_880),
      },
    ],
    options: [
      { id: 'demo-opt-1', poll_id: pollId, label: 'Friday evening', position: 0 },
      { id: 'demo-opt-2', poll_id: pollId, label: 'Saturday morning', position: 1 },
      { id: 'demo-opt-3', poll_id: pollId, label: 'Sunday morning', position: 2 },
    ],
    baseCounts: { 'demo-opt-1': 3, 'demo-opt-2': 9, 'demo-opt-3': 2 },
    myVotes: {},
  }
}

let demoNews: DemoNewsState | null = null

function newsStore(): DemoNewsState {
  if (!demoNews) demoNews = seedDemoNews()
  return demoNews
}

const beat = () => new Promise<void>(r => setTimeout(r, 220))

/** The demo equivalent of the four reads the news feed does live. */
function demoPollState(newsletterId: string): PollState | null {
  const state = newsStore()
  const poll = state.polls.find(p => p.newsletter_id === newsletterId)
  if (!poll) return null

  const results = Object.entries(state.baseCounts).map(([option_id, votes]) => ({
    poll_id: poll.id,
    option_id,
    votes,
  }))
  const mine = state.myVotes[poll.id]
  if (mine) {
    const row = results.find(r => r.option_id === mine)
    if (row) row.votes += 1
    else results.push({ poll_id: poll.id, option_id: mine, votes: 1 })
  }

  return composePollState(
    { ...poll },
    state.options.map(o => ({ ...o })),
    results,
    mine ? [{ poll_id: poll.id, option_id: mine }] : [],
  )
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Every newsletter the viewer may see, newest first.
 *
 * For staff that is drafts and sends together, which is what the composer
 * screen lists. For anybody else the policy narrows it to sent newsletters they
 * actually received, so the same call is safe to make from either place.
 */
export async function fetchNewsletters(isDemo = false): Promise<BroadcastNewsletter[] | null> {
  if (offline(isDemo)) {
    return [...newsStore().newsletters]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(n => ({ ...n }))
  }

  const { data, error } = await supabase
    .from('newsletters')
    .select(NEWSLETTER_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return null
  return (data ?? []) as unknown as BroadcastNewsletter[]
}

/**
 * Every poll on this set of newsletters, ready to render, keyed by newsletter id.
 *
 * Four reads behind one call, shared by the three surfaces that need polls: the
 * feed, the recipient's Newsletters tab, and the composer's results view. They
 * used to be inlined in `fetchNewsFeed` and copying them a second time is how
 * two screens end up disagreeing about a tally.
 *
 * DEGRADES RATHER THAN FAILS, and the return type says so: a newsletter with no
 * entry in the map is one with no poll OR one whose poll could not be read, and
 * both render as a card without a widget. A screenful of announcements should
 * not disappear over one missing count. The callers that need to distinguish
 * "nothing to show" from "nothing loaded" do it on the newsletters themselves.
 *
 * `poll_results_multi` is a definer aggregate and answers only for polls the
 * caller may read (033). `poll_votes` is narrowed by RLS to the viewer's own
 * rows, which is how "my pick" is highlighted without anybody learning who else
 * voted for what.
 */
async function loadPollStates(newsletterIds: string[]): Promise<Map<string, PollState>> {
  const states = new Map<string, PollState>()
  if (newsletterIds.length === 0) return states

  const { data: pollRows } = await supabase
    .from('polls')
    .select(POLL_COLUMNS)
    .in('newsletter_id', newsletterIds)

  const polls = (pollRows ?? []) as unknown as Poll[]
  if (polls.length === 0) return states

  const pollIds = polls.map(p => p.id)
  const [optionResult, countResult, voteResult] = await Promise.all([
    supabase.from('poll_options').select(POLL_OPTION_COLUMNS).in('poll_id', pollIds),
    supabase.rpc('poll_results_multi', { p_poll_ids: pollIds }),
    supabase.from('poll_votes').select('poll_id,option_id').in('poll_id', pollIds),
  ])

  const options = (optionResult.data ?? []) as unknown as PollOption[]
  const results = (countResult.data ?? []) as unknown as Array<{ poll_id: string; option_id: string; votes: number }>
  const myVotes = (voteResult.data ?? []) as unknown as Array<{ poll_id: string; option_id: string }>

  for (const poll of polls) {
    if (!poll.newsletter_id) continue
    states.set(poll.newsletter_id, composePollState(poll, options, results, myVotes))
  }
  return states
}

/**
 * The news feed: what was actually sent, with any poll attached.
 *
 * STILL EXPORTED, and deliberately. 033 moved the athlete-facing surface into
 * the messaging workspace's Newsletters tab, which reads
 * `fetchNewsletterThreads` below because it needs the per-person unread flag
 * and the delivery record that only the broadcast conversation carries. This
 * one answers a different question, "everything sent that I may read", with no
 * conversation behind it, and it is the shape any future digest or archive
 * screen wants. Deleting an export because today's only caller went away is how
 * a module ends up rewritten a fortnight later.
 *
 * Extra reads on top of the newsletters themselves degrade rather than fail: if
 * the poll queries error the cards still render without their polls. A failure
 * to read the NEWSLETTERS is different and returns `null`, because then there
 * is nothing to show.
 */
export async function fetchNewsFeed(
  isDemo = false,
): Promise<Array<{ newsletter: BroadcastNewsletter; poll: PollState | null }> | null> {
  if (offline(isDemo)) {
    return newsStore()
      .newsletters.filter(n => n.status === 'sent')
      .sort((a, b) => (b.sent_at ?? b.created_at).localeCompare(a.sent_at ?? a.created_at))
      .map(newsletter => ({ newsletter: { ...newsletter }, poll: demoPollState(newsletter.id) }))
  }

  const { data, error } = await supabase
    .from('newsletters')
    .select(NEWSLETTER_COLUMNS)
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(NEWS_FEED_LIMIT)

  if (error) return null
  const newsletters = (data ?? []) as unknown as BroadcastNewsletter[]
  if (newsletters.length === 0) return []

  const polls = await loadPollStates(newsletters.map(n => n.id))
  return newsletters.map(newsletter => ({ newsletter, poll: polls.get(newsletter.id) ?? null }))
}

/**
 * Every newsletter delivered to the viewer, as a thread they can open.
 *
 * The recipient's surface, and the reason the fan-out is still one conversation
 * per person: the unread flag, the delivery time and the realtime ping all live
 * on the broadcast conversation, not on the newsletter. So the conversations
 * come first, from `messagingApi`, and the newsletters are joined onto them.
 *
 * THREE LAYERS OF DEGRADATION, in the order that matters. `null` only when the
 * CONVERSATIONS could not be read, because then there is genuinely no list. A
 * newsletter row that does not come back leaves `newsletter: null` and the
 * screen falls back to the frozen `title` and `last_message_preview` the
 * fan-out wrote, which say the same thing. A poll that does not come back
 * leaves `poll: null` and the thread renders without its widget.
 *
 * The missing-newsletter case is ordinary rather than exceptional: 030's
 * recipient policy admits a newsletter only while it is `sent`, and deleting one
 * leaves its conversations behind on purpose.
 */
export async function fetchNewsletterThreads(isDemo = false): Promise<NewsletterThread[] | null> {
  const rows = await fetchBroadcastSummaries(isDemo)
  if (!rows) return null
  // The cap counts NEWSLETTERS, so it must land after the collapse: capping
  // the raw rows would spend the whole window on the latest send's fan-out
  // copies and evict everything this person had received.
  const summaries = oneThreadPerNewsletter(rows).slice(0, NEWSLETTER_THREAD_LIMIT)
  if (summaries.length === 0) return []

  if (offline(isDemo)) {
    const state = newsStore()
    return summaries.map(summary => {
      const newsletter = summary.newsletter_id
        ? state.newsletters.find(n => n.id === summary.newsletter_id) ?? null
        : null
      return {
        summary,
        newsletter: newsletter ? { ...newsletter } : null,
        poll: summary.newsletter_id ? demoPollState(summary.newsletter_id) : null,
      }
    })
  }

  const ids = [...new Set(summaries.map(s => s.newsletter_id).filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) return summaries.map(summary => ({ summary, newsletter: null, poll: null }))

  const { data } = await supabase.from('newsletters').select(NEWSLETTER_COLUMNS).in('id', ids)
  const newsletters = (data ?? []) as unknown as BroadcastNewsletter[]
  const byId = new Map(newsletters.map(n => [n.id, n]))

  const polls = await loadPollStates(ids)

  return summaries.map(summary => ({
    summary,
    newsletter: summary.newsletter_id ? byId.get(summary.newsletter_id) ?? null : null,
    poll: summary.newsletter_id ? polls.get(summary.newsletter_id) ?? null : null,
  }))
}

/**
 * Who a newsletter went to, and who has opened it.
 *
 * The sender's half of the same delivery record. Gated in the database on the
 * sender tier (admin, or a coach holding `send_marketing`), which answers a
 * refusal as a sentence rather than an empty list, because an empty list and
 * "you may not ask" look identical on screen and only one is worth showing.
 *
 * It carries delivery and seen state and NEVER a vote. Delivery was never
 * anonymous; a poll answer is, and the two meeting in one row would undo the
 * property the whole poll design rests on.
 */
export async function fetchNewsletterRecipients(
  newsletterId: string,
  isDemo = false,
): Promise<NewsletterRecipient[] | null> {
  if (offline(isDemo)) {
    const audience = newsStore().newsletters.find(n => n.id === newsletterId)?.audience ?? 'all'
    return demoNewsletterRecipients(newsletterId, audience)
  }

  const { data, error } = await supabase.rpc('newsletter_recipients', { p_newsletter_id: newsletterId })
  if (error) return null
  return (data ?? []) as unknown as NewsletterRecipient[]
}

/**
 * One newsletter's poll, ready to render, for a screen that has no thread in
 * hand: the composer's results view.
 *
 * Composer tier by construction rather than by a guard here. 030's SELECT
 * policy on `polls` admits the sender tier to every poll including a draft's,
 * and 033's `poll_results_multi` admits the same tier to the tallies, so this
 * answers for a newsletter the caller composed as readily as for one they
 * received. `null` covers "no poll" and "could not ask" together, which is what
 * a results panel wants: it renders nothing either way.
 */
export async function fetchPollStateForNewsletter(
  newsletterId: string,
  isDemo = false,
): Promise<PollState | null> {
  if (offline(isDemo)) return demoPollState(newsletterId)

  const polls = await loadPollStates([newsletterId])
  return polls.get(newsletterId) ?? null
}

/**
 * The poll on one newsletter, in the shape the composer edits.
 *
 * `null` covers both "there is no poll" and "we could not ask", on purpose: the
 * composer opens with an empty poll editor either way, and an empty editor
 * saves as "no poll" only if somebody presses save.
 */
export async function fetchPollForNewsletter(
  newsletterId: string,
  isDemo = false,
): Promise<{ question: string; options: string[] } | null> {
  if (offline(isDemo)) {
    const state = newsStore()
    const poll = state.polls.find(p => p.newsletter_id === newsletterId)
    if (!poll) return null
    return {
      question: poll.question,
      options: state.options
        .filter(o => o.poll_id === poll.id)
        .sort((a, b) => a.position - b.position)
        .map(o => o.label),
    }
  }

  const { data, error } = await supabase
    .from('polls')
    .select(POLL_COLUMNS)
    .eq('newsletter_id', newsletterId)
    .maybeSingle()

  if (error || !data) return null
  const poll = data as unknown as Poll

  const { data: optionRows } = await supabase
    .from('poll_options')
    .select(POLL_OPTION_COLUMNS)
    .eq('poll_id', poll.id)
    .order('position', { ascending: true })

  return {
    question: poll.question,
    options: ((optionRows ?? []) as unknown as PollOption[]).map(o => o.label),
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface NewsletterDraftInput {
  /** Absent creates a draft; present edits that one. */
  id?: string
  subject: string
  body: string
  audience: NewsletterAudience
}

/**
 * Save a draft, new or existing.
 *
 * The body is cleaned through the same helper a message uses, because it will
 * BECOME a message on send and the caps have to agree. `.select('id')` on both
 * paths so an RLS refusal arrives as zero rows rather than a silent success,
 * and so a new draft hands its id straight to the poll editor.
 */
export async function saveNewsletterDraft(
  input: NewsletterDraftInput,
  isDemo = false,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const subject = cleanTitle(input.subject).slice(0, NEWSLETTER_SUBJECT_LIMIT)
  const body = cleanMessageBody(input.body)

  if (!subject) return { ok: false, message: 'Give the newsletter a subject.' }
  if (!body) return { ok: false, message: 'Write something to send.' }

  if (offline(isDemo)) {
    await beat()
    const state = newsStore()
    if (input.id) {
      const existing = state.newsletters.find(n => n.id === input.id)
      if (!existing) return { ok: false, message: 'That newsletter is no longer in the list.' }
      if (existing.status === 'sent') return { ok: false, message: 'A sent newsletter cannot be edited.' }
      existing.subject = subject
      existing.body = body
      existing.audience = input.audience
      return { ok: true, id: existing.id }
    }
    const created: BroadcastNewsletter = {
      id: demoId('demo-news'),
      author_id: DEMO_VIEWER_ID,
      subject,
      body,
      audience: input.audience,
      status: 'draft',
      recipient_count: 0,
      created_at: new Date().toISOString(),
      sent_at: null,
    }
    state.newsletters.unshift(created)
    return { ok: true, id: created.id }
  }

  if (input.id) {
    const { data, error } = await supabase
      .from('newsletters')
      .update({ subject, body, audience: input.audience })
      .eq('id', input.id)
      .eq('status', 'draft')
      .select('id')

    if (error) return { ok: false, message: writeMessage(error, 'Could not save that draft.') }
    if (!data || data.length === 0) {
      return { ok: false, message: 'That draft was not saved. It may already have been sent.' }
    }
    return { ok: true, id: input.id }
  }

  const { data: session } = await supabase.auth.getSession()
  const { data, error } = await supabase
    .from('newsletters')
    .insert({
      subject,
      body,
      audience: input.audience,
      author_id: session.session?.user.id ?? null,
    })
    .select('id')
    .single()

  if (error) return { ok: false, message: writeMessage(error, 'Could not save that draft.') }
  const id = (data as { id?: string } | null)?.id
  if (!id) return { ok: false, message: 'Could not save that draft.' }
  return { ok: true, id }
}

/** Delete a draft. A sent newsletter is a record of what went out and stays. */
export async function deleteNewsletterDraft(id: string, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) {
    await beat()
    const state = newsStore()
    const existing = state.newsletters.find(n => n.id === id)
    if (!existing) return { ok: false, message: 'That newsletter is no longer in the list.' }
    if (existing.status === 'sent') return { ok: false, message: 'A sent newsletter cannot be deleted.' }
    state.newsletters = state.newsletters.filter(n => n.id !== id)
    state.polls = state.polls.filter(p => p.newsletter_id !== id)
    return { ok: true }
  }

  const { data, error } = await supabase
    .from('newsletters')
    .delete()
    .eq('id', id)
    .eq('status', 'draft')
    .select('id')

  if (error) return { ok: false, message: writeMessage(error, 'Could not delete that draft.') }
  if (!data || data.length === 0) {
    return { ok: false, message: 'That draft was not deleted. It may already have been sent.' }
  }
  return { ok: true }
}

/**
 * Attach, replace or remove the poll on a draft.
 *
 * An empty question removes the poll, which is the composer's "no poll" state
 * saving itself. Everything else replaces the options wholesale, so editing one
 * word of one option does not have to be an option-level diff.
 */
export async function saveNewsletterPoll(
  newsletterId: string,
  question: string,
  options: string[],
  isDemo = false,
): Promise<WriteResult> {
  const refusal = pollRefusal(question, options)
  if (refusal) return { ok: false, message: refusal }

  const q = cleanTitle(question)
  const labels = options.map(option => cleanTitle(option).slice(0, 100)).filter(Boolean)

  if (offline(isDemo)) {
    await beat()
    const state = newsStore()
    const newsletter = state.newsletters.find(n => n.id === newsletterId)
    if (!newsletter) return { ok: false, message: 'That newsletter is no longer in the list.' }
    if (newsletter.status !== 'draft') return { ok: false, message: 'You can only edit a poll on a draft newsletter.' }

    const existing = state.polls.find(p => p.newsletter_id === newsletterId)
    if (!q) {
      if (existing) {
        state.polls = state.polls.filter(p => p.id !== existing.id)
        state.options = state.options.filter(o => o.poll_id !== existing.id)
      }
      return { ok: true }
    }

    const pollId = existing?.id ?? demoId('demo-poll')
    if (existing) existing.question = q
    else state.polls.push({ id: pollId, newsletter_id: newsletterId, question: q, closes_at: null, created_at: new Date().toISOString() })

    state.options = state.options.filter(o => o.poll_id !== pollId)
    labels.forEach((label, position) => {
      state.options.push({ id: demoId('demo-opt'), poll_id: pollId, label, position })
    })
    return { ok: true }
  }

  const { error } = await supabase.rpc('upsert_newsletter_poll', {
    p_newsletter_id: newsletterId,
    p_question: q,
    p_options: labels,
  })
  if (error) return { ok: false, message: writeMessage(error, 'Could not save the poll.') }
  return { ok: true }
}

/**
 * Send it.
 *
 * One RPC, and everything that matters happens inside it: the audience is
 * resolved from `newsletters.audience`, a broadcast conversation is created per
 * recipient, the body lands as the first message, and 023's rollup trigger
 * flips each recipient's unread flag on the way past. It answers with the
 * number actually delivered, which is the only honest thing to put on screen.
 *
 * `send_newsletter` is SECURITY DEFINER, so 033's "no replies into a broadcast"
 * policy does not apply to its own message insert. The fan-out is the one
 * writer a broadcast ever has.
 *
 * The demo half takes the audience too. It used to fan every send out to all
 * four demo contacts, which made "Athletes" and "Coaches and admins" pick
 * differently in the composer and deliver identically, and then showed a
 * recipient list that contradicted the audience chip beside it.
 */
export async function sendNewsletter(
  id: string,
  isDemo = false,
): Promise<{ ok: true; sent: number } | { ok: false; message: string }> {
  if (offline(isDemo)) {
    await beat()
    const state = newsStore()
    const newsletter = state.newsletters.find(n => n.id === id)
    if (!newsletter) return { ok: false, message: 'That newsletter is no longer in the list.' }
    if (newsletter.status !== 'draft') return { ok: false, message: 'Newsletter was already sent.' }

    const sent = deliverDemoBroadcast(
      newsletter.id,
      newsletter.subject,
      newsletter.body,
      newsletter.audience,
    )
    if (sent === 0) {
      // 030 refuses a send with nobody in it rather than burning the draft,
      // because `status = 'sent'` is one way. The demo says the same sentence.
      return { ok: false, message: 'There is nobody in that audience yet, so nothing was sent.' }
    }
    newsletter.status = 'sent'
    newsletter.sent_at = new Date().toISOString()
    newsletter.recipient_count = sent
    return { ok: true, sent }
  }

  const { data, error } = await supabase.rpc('send_newsletter', { p_newsletter_id: id })
  if (error) return { ok: false, message: writeMessage(error, 'The newsletter was not sent.') }

  const payload = (data ?? null) as { sent?: number } | null
  return { ok: true, sent: payload?.sent ?? 0 }
}

/**
 * Cast or change a vote.
 *
 * One row per person per poll, so changing your mind is an update rather than a
 * second vote. The caller reconciles by reloading the feed either way, because
 * an optimistic tally that disagrees with the server is worse than a beat of
 * latency.
 */
export async function castPollVote(pollId: string, optionId: string, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) {
    const state = newsStore()
    const poll = state.polls.find(p => p.id === pollId)
    if (!poll) return { ok: false, message: 'That poll is no longer available.' }
    if (!state.options.some(o => o.id === optionId && o.poll_id === pollId)) {
      return { ok: false, message: 'That poll option is not available.' }
    }
    if (poll.closes_at && poll.closes_at < new Date().toISOString()) {
      return { ok: false, message: 'This poll is closed.' }
    }
    state.myVotes[pollId] = optionId
    return { ok: true }
  }

  const { error } = await supabase.rpc('cast_vote', { p_poll_id: pollId, p_option_id: optionId })
  if (error) return { ok: false, message: writeMessage(error, 'We could not record your vote.') }
  return { ok: true }
}
