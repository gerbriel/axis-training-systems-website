/**
 * The shapes messaging and newsletters speak in.
 *
 * Hand-written to match migrations 021 and 022 column for column, the way the
 * rest of `src/types` matches the tables it describes. The Supabase client is
 * not generically typed, so every read casts through `unknown` into one of
 * these and the cast is the only thing standing between a renamed column and a
 * screen full of undefined. Change a column, change the interface.
 *
 * Two of these are NOT table rows and are worth calling out:
 *
 * `ConversationSummary` is composed in the client from three separate queries
 * (conversations, conversation_members, and the `messaging_profiles` RPC),
 * because an athlete cannot read other people's `profiles` rows and PostgREST
 * embeds would therefore come back empty. `members` excludes the viewer and
 * `unread` is the viewer's own flag, so both are answers to "what does THIS
 * person see", not columns anybody could select.
 *
 * `PollState` is a poll plus its options, its tallies, and the one vote the
 * viewer is allowed to read. Tallies arrive from a definer RPC that aggregates,
 * so a count never carries the identities behind it.
 */

/**
 * The three kinds of room, exactly as `conversation_kind` (023) spells them.
 *
 * 'broadcast' IS THE NEWSLETTER KIND. The database has called it that since 023
 * and four shipped migrations (023, 030, 033, 040) name the value in policies
 * and functions, so the enum keeps its historical spelling; the product calls
 * it a newsletter everywhere a person can read. Compare against 'broadcast'
 * where the value is what Postgres will return, and say "newsletter" in every
 * label, sentence and identifier around it.
 */
export type ConversationKind = 'dm' | 'channel' | 'broadcast'

/**
 * The minimum needed to put a person on screen: a name, a face, and enough
 * role to label them. It comes from `messaging_profiles` / `list_message_contacts`,
 * never from a select on `profiles` — there is no broad read policy on that
 * table and there must not be one.
 */
export interface MessagingContact {
  id: string
  display_name: string
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
  role: 'athlete' | 'coach' | 'admin'
  coach_slug: string | null
}

/**
 * One row of `conversations`. The three `last_message_*` columns are the
 * trigger-maintained rollup, which is why an inbox list never has to join to
 * messages to render a preview.
 */
export interface Conversation {
  id: string
  kind: ConversationKind
  title: string | null
  created_by: string | null
  newsletter_id: string | null
  last_message_at: string
  last_message_preview: string | null
  last_message_from: string | null
  created_at: string
}

/** One row of `conversation_members`. `unread` is per person, not per message. */
export interface ConversationMemberRow {
  conversation_id: string
  profile_id: string
  unread: boolean
  joined_at: string
}

/** A conversation as one person sees it: everyone else in it, and their own unread flag. */
export interface ConversationSummary extends Conversation {
  members: MessagingContact[]
  unread: boolean
}

/** One row of `messages`. `sender_id` is null when the sender's profile is gone. */
export interface ChatMessage {
  id: string
  conversation_id: string
  sender_id: string | null
  body: string
  created_at: string
}

/** One row of `athlete_coaches`. Who an athlete is allowed to message. */
export interface CoachAssignment {
  athlete_id: string
  coach_id: string
  assigned_at: string
}

/**
 * One row of `newsletters`: what staff compose and send.
 *
 * `src/types/newsletter.ts` is the email SIGNUP side and owns `NewsletterLead`
 * and `NewsletterAccess`, not this word, so the two never collide on an import.
 */
export interface Newsletter {
  id: string
  author_id: string | null
  subject: string
  body: string
  audience: 'all' | 'athletes' | 'staff'
  status: 'draft' | 'sent'
  recipient_count: number
  created_at: string
  sent_at: string | null
}

export interface Poll {
  id: string
  newsletter_id: string | null
  question: string
  closes_at: string | null
  created_at: string
}

export interface PollOption {
  id: string
  poll_id: string
  label: string
  position: number
}

/** A poll ready to render: options in order, tallies by option id, and my pick. */
export interface PollState {
  poll: Poll
  options: PollOption[]
  counts: Record<string, number>
  myOptionId: string | null
  totalVotes: number
}

/**
 * One person a newsletter was delivered to, from the `newsletter_recipients`
 * RPC (033). Sender-tier only, and deliberately narrow: a name, a face, a role,
 * whether they have opened it, and when it landed.
 *
 * `seen` is `not conversation_members.unread`, which is the same boolean the
 * recipient's own badge reads, so there is no second read model to drift.
 *
 * There is no vote on this shape and there must not be one. Delivery is not
 * anonymous. A poll answer is, and the two meeting in one row would undo that.
 */
export interface NewsletterRecipient {
  id: string
  display_name: string
  avatar_url: string | null
  role: 'athlete' | 'coach' | 'admin'
  seen: boolean
  delivered_at: string
}

/**
 * A received newsletter as the Newsletters tab renders it: the conversation it
 * arrived in, the newsletter behind it, and its poll if it has one.
 *
 * `newsletter` is nullable because the join can legitimately come back empty.
 * The row is readable through 030's recipient policy, which asks whether the
 * newsletter is still `sent` and still delivered to you; a deleted newsletter
 * leaves its conversations behind by design (`on delete set null`). The screen
 * falls back to `summary.title` and `summary.last_message_preview`, which are
 * the frozen copies the fan-out wrote, so a thread never renders blank.
 */
export interface NewsletterThread {
  summary: ConversationSummary
  newsletter: Newsletter | null
  poll: PollState | null
}

/** One window of history. Older messages load on demand, newest first. */
export const MESSAGES_PAGE_SIZE = 50

export type WriteResult = { ok: true } | { ok: false; message: string }
