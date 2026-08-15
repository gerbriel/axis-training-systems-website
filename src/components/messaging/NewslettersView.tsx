import { useEffect, useMemo, useState } from 'react'
import { castPollVote } from '../../lib/newsletterBroadcast'
import type { MessagingContact, NewsletterThread, PollState } from '../../types/messaging'
import { Avatar, ErrorLine, OutageBlock, Pill } from './MessagingChrome'
import PollWidget from './PollWidget'
import { ACCENT, MICRO, clockTime, conversationTitle, dayLabel, senderName, timeAgo } from './messagingUi'

/**
 * The Newsletters tab: everything the team has announced to this person, one
 * item per newsletter, in the same two-pane shape as the inbox.
 *
 * A newsletter is not a conversation. It arrives as its own broadcast thread so
 * that unread, delivery, and Realtime all keep working per person, but there is
 * nothing to write back into: the database refuses a reply to a broadcast, so
 * this view never offers a composer to be refused. The only thing a reader can
 * change is a vote, and a vote is aggregate. The tallies are the server's
 * answer, never this component's arithmetic, so a vote moves the bar at once
 * and then the refetch decides what was actually counted.
 *
 * Data lives one level up in the workspace, which loads it on mount for the
 * unread dot and refetches it on every Realtime ping. This file owns selection,
 * the vote in flight, and nothing else.
 */

interface Props {
  threads: NewsletterThread[]
  activeId: string | null
  loading: boolean
  outage: boolean
  profiles: Map<string, MessagingContact>
  meId: string | null
  isDemo: boolean
  isMobile: boolean
  showList: boolean
  showThread: boolean
  onRetry: () => void
  onSelect: (conversationId: string) => void
  onBack: () => void
  onMarkRead: (conversationId: string) => void
  /** Refetches the threads upstream. Awaited after a vote lands. */
  onReload: () => Promise<void>
}

/** The subject as sent, or whatever the conversation carried if the row is gone. */
function threadTitle(thread: NewsletterThread): string {
  return thread.newsletter?.subject?.trim() || conversationTitle(thread.summary)
}

/** The full text if we can read the newsletter, else the rollup preview. */
function threadBody(thread: NewsletterThread): string {
  const body = thread.newsletter?.body?.trim()
  if (body) return body
  return thread.summary.last_message_preview?.trim() || 'This newsletter is no longer available.'
}

function sentAt(thread: NewsletterThread): string {
  return thread.newsletter?.sent_at ?? thread.newsletter?.created_at ?? thread.summary.last_message_at
}

/**
 * Who this copy is between. A newsletter fans out into one conversation per
 * recipient, so a person who SENT one holds a copy of every single delivery.
 * Those read as "Sent to", not as mail from themselves.
 */
function counterpart(
  thread: NewsletterThread,
  profiles: Map<string, MessagingContact>,
  meId: string | null
): { name: string; avatar: string | null; caption: string; mine: boolean } {
  const mine = thread.summary.created_by !== null && thread.summary.created_by === meId
  if (mine) {
    // The data layer collapses a sender's fan-out copies to one row per
    // newsletter, so this single row stands for the whole delivery. Naming
    // the one surviving conversation's recipient would read as a send to
    // exactly that person; the count is the honest caption.
    const count = thread.newsletter?.recipient_count ?? 0
    if (count > 1) {
      const label = `${count} people`
      return { name: label, avatar: null, caption: `Sent to ${label}`, mine }
    }
    const recipient = thread.summary.members[0]
    const name = recipient?.display_name ?? 'a member'
    return { name, avatar: recipient?.avatar_url ?? null, caption: `Sent to ${name}`, mine }
  }
  const name = senderName(thread.summary.created_by, profiles)
  const avatar = profiles.get(thread.summary.created_by ?? '')?.avatar_url ?? null
  return { name, avatar, caption: `From ${name}`, mine }
}

/**
 * The vote as it will probably be counted: my pick moves, and the total only
 * grows if I had not voted before. Replaced by the refetch a moment later.
 */
function applyVote(state: PollState, optionId: string): PollState {
  if (state.myOptionId === optionId) return state
  const counts = { ...state.counts }
  if (state.myOptionId) counts[state.myOptionId] = Math.max(0, (counts[state.myOptionId] ?? 0) - 1)
  counts[optionId] = (counts[optionId] ?? 0) + 1
  return {
    ...state,
    counts,
    myOptionId: optionId,
    totalVotes: state.myOptionId ? state.totalVotes : state.totalVotes + 1,
  }
}

export default function NewslettersView({
  threads,
  activeId,
  loading,
  outage,
  profiles,
  meId,
  isDemo,
  isMobile,
  showList,
  showThread,
  onRetry,
  onSelect,
  onBack,
  onMarkRead,
  onReload,
}: Props) {
  // The fetch already orders by the conversation rollup, but a Realtime merge
  // can land a newer one anywhere, so the view sorts as well.
  const ordered = useMemo(
    () =>
      [...threads].sort(
        (a, b) =>
          new Date(b.summary.last_message_at).getTime() - new Date(a.summary.last_message_at).getTime()
      ),
    [threads]
  )

  const active = useMemo(
    () => ordered.find(thread => thread.summary.id === activeId) ?? null,
    [ordered, activeId]
  )

  return (
    <>
      {showList && (
        <div
          style={{
            width: isMobile ? '100%' : 320,
            flexShrink: 0,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            borderRight: isMobile ? 'none' : '1px solid var(--surface)',
          }}
        >
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {loading ? (
              <p style={{ ...MICRO, color: 'var(--text-4)', letterSpacing: '.15em', padding: '1.25rem 1rem' }}>
                Loading…
              </p>
            ) : outage ? (
              <OutageBlock line="We could not load your newsletters." onRetry={onRetry} />
            ) : ordered.length === 0 ? (
              <div style={{ padding: '1.5rem 1rem' }}>
                <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.4rem' }}>
                  No newsletters yet.
                </p>
                <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.65 }}>
                  Team announcements will show up here.
                </p>
              </div>
            ) : (
              ordered.map(thread => {
                const selected = thread.summary.id === activeId
                const title = threadTitle(thread)
                const other = counterpart(thread, profiles, meId)
                return (
                  <button
                    key={thread.summary.id}
                    onClick={() => onSelect(thread.summary.id)}
                    aria-current={selected ? 'true' : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '.7rem',
                      width: '100%',
                      textAlign: 'left',
                      background: selected ? 'var(--surface)' : 'none',
                      border: 'none',
                      borderBottom: '1px solid var(--surface)',
                      borderLeft: `2px solid ${selected ? ACCENT : 'transparent'}`,
                      padding: '.85rem 1rem',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      minHeight: '3.75rem',
                    }}
                  >
                    <Avatar name={other.name} url={other.avatar} size={38} />

                    <span style={{ flex: 1, minWidth: 0, display: 'block' }}>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '.4rem',
                          marginBottom: '.2rem',
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            color: 'var(--text)',
                            fontSize: '.85rem',
                            fontWeight: thread.summary.unread ? 900 : 700,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            minWidth: 0,
                          }}
                        >
                          {title}
                        </span>
                        {thread.poll && <Pill label="Poll" />}
                      </span>

                      <span
                        style={{
                          display: 'block',
                          color: thread.summary.unread ? 'var(--text-2)' : 'var(--text-4)',
                          fontWeight: thread.summary.unread ? 700 : 400,
                          fontSize: '.76rem',
                          lineHeight: 1.5,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {thread.summary.last_message_preview || threadBody(thread)}
                      </span>
                    </span>

                    <span
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: '.35rem',
                        flexShrink: 0,
                        paddingTop: '.1rem',
                      }}
                    >
                      <span style={{ color: 'var(--text-4)', fontSize: '.62rem', whiteSpace: 'nowrap' }}>
                        {timeAgo(sentAt(thread))}
                      </span>
                      {thread.summary.unread && (
                        <span
                          aria-label="Unread"
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: '50%',
                            background: ACCENT,
                            boxShadow: '0 0 0 2px rgba(39,44,132,.3)',
                          }}
                        />
                      )}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}

      {showThread && (
        <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
          {active ? (
            <NewsletterThreadView
              key={active.summary.id}
              thread={active}
              profiles={profiles}
              meId={meId}
              isDemo={isDemo}
              isMobile={isMobile}
              onBack={onBack}
              onMarkRead={onMarkRead}
              onReload={onReload}
            />
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2rem',
                textAlign: 'center',
              }}
            >
              <p style={{ ...MICRO, color: 'var(--text-4)', letterSpacing: '.2em' }}>
                {activeId ? 'Opening…' : 'Pick a newsletter'}
              </p>
            </div>
          )}
        </div>
      )}
    </>
  )
}

/**
 * One newsletter, read. Keyed on the conversation id by its parent, so opening
 * another one is a remount and no vote or error survives the move.
 */
function NewsletterThreadView({
  thread,
  profiles,
  meId,
  isDemo,
  isMobile,
  onBack,
  onMarkRead,
  onReload,
}: {
  thread: NewsletterThread
  profiles: Map<string, MessagingContact>
  meId: string | null
  isDemo: boolean
  isMobile: boolean
  onBack: () => void
  onMarkRead: (conversationId: string) => void
  onReload: () => Promise<void>
}) {
  const conversationId = thread.summary.id
  const other = counterpart(thread, profiles, meId)
  const author = other.mine ? 'You' : other.name
  const title = threadTitle(thread)
  const body = threadBody(thread)
  const sent = sentAt(thread)

  const [pending, setPending] = useState<PollState | null>(null)
  const [voting, setVoting] = useState(false)
  const [voteError, setVoteError] = useState<string | null>(null)

  const poll = pending ?? thread.poll

  // Opening a newsletter is reading it, the same as opening a conversation.
  useEffect(() => {
    if (thread.summary.unread) onMarkRead(conversationId)
  }, [conversationId, thread.summary.unread, onMarkRead])

  const vote = async (optionId: string) => {
    const state = poll
    if (!state || voting) return
    setVoting(true)
    setVoteError(null)
    setPending(applyVote(state, optionId))

    const result = await castPollVote(state.poll.id, optionId, isDemo)
    if (!result.ok) setVoteError(result.message)
    // Right or wrong, the refetch is what the bars end up showing.
    await onReload()
    setPending(null)
    setVoting(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, width: '100%' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '.7rem',
          padding: '.75rem 1rem',
          borderBottom: '1px solid var(--surface)',
          flexShrink: 0,
        }}
      >
        {isMobile && (
          <button
            onClick={onBack}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-2)',
              fontSize: '.7rem',
              fontWeight: 700,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              padding: '.5rem .3rem',
              minHeight: '2.4rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >
            ← Back
          </button>
        )}

        <Avatar name={other.name} url={other.avatar} size={34} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', minWidth: 0 }}>
            <span
              style={{
                color: 'var(--text)',
                fontSize: '.9rem',
                fontWeight: 900,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {title}
            </span>
            <Pill label="Newsletter" tone="accent" />
          </div>
          <p style={{ color: 'var(--text-4)', fontSize: '.66rem', marginTop: '.15rem' }}>{other.caption}</p>
        </div>
      </div>

      {/* ── The newsletter ─────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '.35rem',
        }}
      >
        <p
          style={{
            ...MICRO,
            color: 'var(--text-4)',
            letterSpacing: '.2em',
            textAlign: 'center',
            margin: '.2rem 0 .6rem',
          }}
        >
          {dayLabel(sent)}
        </p>

        <span
          style={{
            color: 'var(--text-4)',
            fontSize: '.62rem',
            fontWeight: 700,
            letterSpacing: '.08em',
            margin: '0 0 .2rem',
          }}
        >
          {author}
        </span>

        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <div
            style={{
              maxWidth: 'min(92%, 38rem)',
              padding: '.7rem .85rem',
              borderRadius: '.25rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontSize: '.85rem',
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {body}
          </div>
        </div>

        <span style={{ color: 'var(--text-4)', fontSize: '.6rem', marginTop: '.2rem' }}>{clockTime(sent)}</span>

        {poll && (
          <div style={{ marginTop: '1rem', maxWidth: 'min(92%, 38rem)' }}>
            {/* The sender is not a recipient (the fan-out excludes them), so
                their own consolidated copy shows results, never a ballot. */}
            <PollWidget state={poll} disabled={voting || other.mine} onVote={optionId => void vote(optionId)} />
            {other.mine && (
              <p style={{ color: 'var(--text-4)', fontSize: '.62rem', marginTop: '.4rem' }}>
                Results only. This poll went to your recipients.
              </p>
            )}
          </div>
        )}

        {voteError && (
          <div style={{ marginTop: '.6rem' }}>
            <ErrorLine>{voteError}</ErrorLine>
          </div>
        )}
      </div>

      {/* ── Where the composer would be ────────────────────────────────────── */}
      <div
        style={{
          borderTop: '1px solid var(--surface)',
          padding: '.75rem 1rem',
          paddingBottom: isMobile ? 'calc(.75rem + env(safe-area-inset-bottom))' : '.75rem',
          flexShrink: 0,
          background: 'var(--bg)',
        }}
      >
        <p style={{ color: 'var(--text-4)', fontSize: '.68rem', lineHeight: 1.5 }}>
          Newsletters do not take replies.
        </p>
      </div>
    </div>
  )
}
