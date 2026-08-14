import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { supabase, supabaseConfigured } from '../../lib/supabase'
import { cleanMessageBody, fetchMessages, leaveConversation, sendMessage } from '../../lib/messagingApi'
import { MESSAGES_PAGE_SIZE } from '../../types/messaging'
import type { ChatMessage, ConversationSummary, MessagingContact } from '../../types/messaging'
import ChannelModal from './ChannelModal'
import { Avatar, ErrorLine, GhostButton, OutageBlock, Pill } from './MessagingChrome'
import type { LocalMessage } from './messagingUi'
import {
  ACCENT,
  BTN,
  CRIMSON,
  MICRO,
  ROLE_LABEL,
  clockTime,
  conversationTitle,
  dayLabel,
  newTempId,
  sameDay,
  senderName,
} from './messagingUi'

/**
 * One open conversation: its history, its people, and the box you type in.
 *
 * Two rules run through the whole file. The first is that a message you sent
 * appears the instant you send it and stays visible if the send fails, because
 * a thread that silently swallows a message is worse than one that admits it
 * did. The second is that history loading must never move the view: sticking
 * to the bottom is the default, and prepending an older page restores the
 * exact scroll offset it was read at.
 *
 * The component is keyed on the conversation id by its parent, so every piece
 * of state here belongs to exactly one thread and switching threads is a
 * remount rather than a reset nobody remembered to write.
 */

interface Props {
  conversation: ConversationSummary
  me: MessagingContact | null
  profiles: Map<string, MessagingContact>
  contacts: MessagingContact[] | null
  contactsLoading: boolean
  contactsOutage: boolean
  onRetryContacts: () => void
  isDemo: boolean
  isMobile: boolean
  isAdmin: boolean
  canManageChannels: boolean
  onBack: () => void
  onReloadList: () => void
  onMarkRead: (conversationId: string) => void
  onLeft: (conversationId: string) => void
}

const COMPOSER_MAX_HEIGHT = 140
const BODY_LIMIT = 8000
const COUNTER_FROM = 7500

export default function ConversationView({
  conversation,
  me,
  profiles,
  contacts,
  contactsLoading,
  contactsOutage,
  onRetryContacts,
  isDemo,
  isMobile,
  isAdmin,
  canManageChannels,
  onBack,
  onReloadList,
  onMarkRead,
  onLeft,
}: Props) {
  const meId = me?.id ?? null
  const conversationId = conversation.id
  const isChannel = conversation.kind === 'channel'
  const isBroadcast = conversation.kind === 'broadcast'
  const showSenderNames = conversation.kind !== 'dm'

  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [hasEarlier, setHasEarlier] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [earlierError, setEarlierError] = useState<string | null>(null)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const [rosterOpen, setRosterOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [leaveArmed, setLeaveArmed] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [rosterError, setRosterError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const stickToBottomRef = useRef(true)
  /** Distance from the bottom to restore after a page of history is prepended. */
  const anchorRef = useRef<number | null>(null)

  // Realtime handlers must not resubscribe every time a parent callback is
  // rebuilt, so the channel effect reads them through a ref instead of a dep.
  const latest = useRef({ meId, onMarkRead, onReloadList })
  useEffect(() => {
    latest.current = { meId, onMarkRead, onReloadList }
  })

  /** Everyone in the room, me first, for the roster popover and the pickers. */
  const roster = useMemo(() => {
    const rows: MessagingContact[] = []
    if (me) rows.push(me)
    for (const member of conversation.members) rows.push(member)
    return rows
  }, [me, conversation.members])

  const title = conversationTitle(conversation)
  const otherPerson = conversation.kind === 'dm' ? conversation.members[0] : undefined

  // A channel can be renamed and re-staffed by whoever made it, by an admin, or
  // by a coach holding manage_channels. The RPC decides for real; this only
  // decides whether offering the button would be a lie.
  const canManageThis =
    isChannel && (isAdmin || canManageChannels || (meId !== null && conversation.created_by === meId))

  // ── History ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      const rows = await fetchMessages(conversationId, null, isDemo)
      if (cancelled) return
      if (rows === null) {
        setOutage(true)
        setMessages([])
        setHasEarlier(false)
      } else {
        setOutage(false)
        stickToBottomRef.current = true
        anchorRef.current = null
        setMessages(rows)
        setHasEarlier(rows.length === MESSAGES_PAGE_SIZE)
      }
      setLoading(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [conversationId, isDemo, reloadNonce])

  const loadEarlier = async () => {
    const oldest = messages[0]
    if (!oldest || loadingEarlier) return
    setLoadingEarlier(true)
    setEarlierError(null)

    const element = scrollRef.current
    anchorRef.current = element ? element.scrollHeight - element.scrollTop : null

    const rows = await fetchMessages(conversationId, oldest.created_at, isDemo)
    setLoadingEarlier(false)
    if (rows === null) {
      anchorRef.current = null
      setEarlierError('We could not load earlier messages.')
      return
    }
    stickToBottomRef.current = false
    setMessages(previous => {
      const seen = new Set(previous.map(message => message.id))
      return [...rows.filter(row => !seen.has(row.id)), ...previous]
    })
    setHasEarlier(rows.length === MESSAGES_PAGE_SIZE)
  }

  // Anchoring runs before paint: restore the read position when history was
  // prepended, otherwise follow the bottom if that is where the reader was.
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const anchor = anchorRef.current
    if (anchor !== null) {
      element.scrollTop = element.scrollHeight - anchor
      anchorRef.current = null
      return
    }
    if (stickToBottomRef.current) element.scrollTop = element.scrollHeight
  }, [messages, loading])

  const onScroll = () => {
    const element = scrollRef.current
    if (!element) return
    stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60
  }

  // ── Read state ────────────────────────────────────────────────────────────
  // Opening a thread is reading it. The flip is local as well as remote so the
  // list stops shouting before the round trip lands.
  useEffect(() => {
    if (conversation.unread) onMarkRead(conversationId)
  }, [conversationId, conversation.unread, onMarkRead])

  // ── Live appends ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (isDemo || !supabaseConfigured) return
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        payload => {
          const incoming = payload.new as unknown as ChatMessage
          setMessages(previous =>
            previous.some(message => message.id === incoming.id) ? previous : [...previous, incoming]
          )
          // Someone else wrote while I am looking at the thread: that counts as
          // read, and the list needs the new preview either way.
          if (incoming.sender_id !== latest.current.meId) latest.current.onMarkRead(conversationId)
          latest.current.onReloadList()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [conversationId, isDemo])

  // ── Composer ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
  }, [draft])

  const send = async (override?: string, retryId?: string) => {
    const body = cleanMessageBody(override ?? draft)
    if (!body || sending) return

    setSending(true)
    setSendError(null)
    if (override === undefined) setDraft('')

    const tempId = newTempId()
    const optimistic: LocalMessage = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: meId,
      body,
      created_at: new Date().toISOString(),
      pending: true,
    }
    stickToBottomRef.current = true
    setMessages(previous => [...previous.filter(message => message.id !== retryId), optimistic])

    const result = await sendMessage(conversationId, body, isDemo)
    setSending(false)

    if (!result.ok) {
      setMessages(previous =>
        previous.map(message =>
          message.id === tempId ? { ...message, pending: false, failed: true } : message
        )
      )
      setSendError(result.message)
      return
    }

    const saved = result.message
    setMessages(previous => {
      const withoutTemp = previous.filter(message => message.id !== tempId)
      return withoutTemp.some(message => message.id === saved.id) ? withoutTemp : [...withoutTemp, saved]
    })
    onReloadList()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }

  // ── Leaving ───────────────────────────────────────────────────────────────
  const doLeave = async () => {
    if (leaving) return
    setLeaving(true)
    setRosterError(null)
    const result = await leaveConversation(conversationId, isDemo)
    setLeaving(false)
    if (!result.ok) {
      setRosterError(result.message)
      return
    }
    setRosterOpen(false)
    onLeft(conversationId)
  }

  const remaining = BODY_LIMIT - draft.length
  const canSend = draft.trim().length > 0 && !sending

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
          position: 'relative',
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

        <Avatar name={title} url={otherPerson?.avatar_url} size={34} />

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
            {isBroadcast && <Pill label="Newsletter" tone="accent" />}
            {isChannel && <Pill label="Channel" />}
          </div>
          <p style={{ color: 'var(--text-4)', fontSize: '.66rem', marginTop: '.15rem' }}>
            {conversation.kind === 'dm'
              ? otherPerson
                ? ROLE_LABEL[otherPerson.role]
                : 'Former member'
              : isBroadcast
                ? conversation.created_by === meId
                  ? `Sent to ${conversation.members[0]?.display_name ?? 'a member'}`
                  : `From ${senderName(conversation.created_by, profiles)}`
                : `${roster.length} ${roster.length === 1 ? 'member' : 'members'}`}
          </p>
        </div>

        {isChannel && (
          <button
            onClick={() => {
              setRosterError(null)
              setLeaveArmed(false)
              setRosterOpen(open => !open)
            }}
            aria-expanded={rosterOpen}
            style={{
              ...BTN,
              background: 'none',
              border: '1px solid var(--surface-2)',
              color: 'var(--text-3)',
              fontWeight: 700,
              padding: '.5rem .75rem',
              minHeight: '2.3rem',
              flexShrink: 0,
            }}
          >
            Members
          </button>
        )}

        {rosterOpen && (
          <>
            <div
              onClick={() => setRosterOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            />
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: '1rem',
                marginTop: '.35rem',
                zIndex: 41,
                width: 'min(300px, calc(100vw - 2rem))',
                maxHeight: 380,
                overflowY: 'auto',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: '.25rem',
                boxShadow: '0 14px 34px rgba(0,0,0,.45)',
                padding: '.9rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '.75rem',
              }}
            >
              <span style={{ ...MICRO, color: 'var(--text-4)' }}>In this channel</span>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                {roster.map(person => (
                  <div key={person.id} style={{ display: 'flex', alignItems: 'center', gap: '.55rem' }}>
                    <Avatar name={person.display_name} url={person.avatar_url} size={26} />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        color: 'var(--text-2)',
                        fontSize: '.78rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {person.id === meId ? 'You' : person.display_name}
                    </span>
                    <span style={{ color: 'var(--text-4)', fontSize: '.58rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', flexShrink: 0 }}>
                      {person.id === conversation.created_by ? 'Owner' : ROLE_LABEL[person.role]}
                    </span>
                  </div>
                ))}
              </div>

              {rosterError && <ErrorLine>{rosterError}</ErrorLine>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', borderTop: '1px solid var(--surface)', paddingTop: '.75rem' }}>
                {canManageThis && (
                  <GhostButton
                    label="Rename or add people"
                    onClick={() => {
                      setRosterOpen(false)
                      setManageOpen(true)
                    }}
                  />
                )}
                {leaveArmed ? (
                  <div style={{ display: 'flex', gap: '.4rem' }}>
                    <button
                      onClick={() => void doLeave()}
                      disabled={leaving}
                      style={{ ...BTN, background: CRIMSON, border: 'none', color: '#fff', padding: '.6rem .9rem', flex: 1, minHeight: '2.4rem' }}
                    >
                      {leaving ? 'Leaving…' : 'Leave'}
                    </button>
                    <GhostButton label="Stay" onClick={() => setLeaveArmed(false)} disabled={leaving} />
                  </div>
                ) : (
                  <GhostButton label="Leave channel" tone="danger" onClick={() => setLeaveArmed(true)} />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── History ────────────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
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
        {loading ? (
          <p style={{ ...MICRO, color: 'var(--text-4)', letterSpacing: '.15em' }}>Loading…</p>
        ) : outage ? (
          <OutageBlock line="We could not load this conversation." onRetry={() => setReloadNonce(n => n + 1)} />
        ) : (
          <>
            {hasEarlier && (
              <button
                onClick={() => void loadEarlier()}
                disabled={loadingEarlier}
                style={{
                  ...BTN,
                  alignSelf: 'center',
                  background: 'none',
                  border: '1px solid var(--surface-2)',
                  color: 'var(--text-3)',
                  fontWeight: 700,
                  padding: '.45rem .9rem',
                  marginBottom: '.5rem',
                  minHeight: '2.2rem',
                }}
              >
                {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
              </button>
            )}
            {earlierError && (
              <p style={{ color: CRIMSON, fontSize: '.75rem', textAlign: 'center', marginBottom: '.5rem' }}>
                {earlierError}
              </p>
            )}

            {messages.length === 0 ? (
              <p style={{ color: 'var(--text-4)', fontSize: '.82rem', margin: 'auto 0', textAlign: 'center' }}>
                No messages yet. Say hello.
              </p>
            ) : (
              messages.map((message, index) => {
                const previous = index > 0 ? messages[index - 1] : null
                const newDay = !previous || !sameDay(previous.created_at, message.created_at)
                const mine = message.sender_id !== null && message.sender_id === meId
                const nameChanged = !previous || previous.sender_id !== message.sender_id
                const showName = showSenderNames && !mine && (newDay || nameChanged)

                const bubbleStyle: React.CSSProperties = {
                  maxWidth: 'min(82%, 34rem)',
                  padding: '.55rem .75rem',
                  borderRadius: '.25rem',
                  fontSize: '.85rem',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  background: message.failed
                    ? 'rgba(200,16,46,.08)'
                    : mine
                      ? ACCENT
                      : 'var(--surface)',
                  border: message.failed
                    ? `1px solid ${CRIMSON}`
                    : mine
                      ? '1px solid transparent'
                      : '1px solid var(--border)',
                  color: message.failed ? 'var(--text)' : mine ? '#fff' : 'var(--text)',
                  opacity: message.pending ? 0.6 : 1,
                }

                return (
                  <div key={message.id} style={{ display: 'flex', flexDirection: 'column' }}>
                    {newDay && (
                      <p
                        style={{
                          ...MICRO,
                          color: 'var(--text-4)',
                          letterSpacing: '.2em',
                          textAlign: 'center',
                          margin: '.9rem 0 .6rem',
                        }}
                      >
                        {dayLabel(message.created_at)}
                      </p>
                    )}

                    {showName && (
                      <span style={{ color: 'var(--text-4)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.08em', margin: '.35rem 0 .2rem' }}>
                        {senderName(message.sender_id, profiles)}
                      </span>
                    )}

                    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                      {message.failed ? (
                        <button onClick={() => void send(message.body, message.id)} style={{ ...bubbleStyle, cursor: 'pointer' }}>
                          {message.body}
                        </button>
                      ) : (
                        <div style={bubbleStyle}>{message.body}</div>
                      )}
                    </div>

                    <span
                      style={{
                        color: message.failed ? CRIMSON : 'var(--text-4)',
                        fontSize: '.6rem',
                        marginTop: '.2rem',
                        alignSelf: mine ? 'flex-end' : 'flex-start',
                      }}
                    >
                      {message.failed
                        ? 'Not sent. Tap the message to try again.'
                        : message.pending
                          ? 'Sending…'
                          : clockTime(message.created_at)}
                    </span>
                  </div>
                )
              })
            )}
          </>
        )}
      </div>

      {/* ── Composer ───────────────────────────────────────────────────────── */}
      <div
        style={{
          borderTop: '1px solid var(--surface)',
          padding: '.75rem 1rem',
          paddingBottom: isMobile ? 'calc(.75rem + env(safe-area-inset-bottom))' : '.75rem',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '.5rem',
          background: 'var(--bg)',
        }}
      >
        {isBroadcast && (
          <p style={{ color: 'var(--text-4)', fontSize: '.68rem', lineHeight: 1.5 }}>
            Your reply goes back to the sender as a direct message.
          </p>
        )}
        {sendError && <ErrorLine>{sendError}</ErrorLine>}

        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            className="field"
            rows={1}
            maxLength={BODY_LIMIT}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Write a message"
            aria-label="Write a message"
            style={{ resize: 'none', maxHeight: COMPOSER_MAX_HEIGHT, overflowY: 'auto', padding: '.6rem .75rem' }}
          />
          <button
            onClick={() => void send()}
            disabled={!canSend}
            style={{
              ...BTN,
              background: canSend ? ACCENT : 'var(--border)',
              border: 'none',
              color: canSend ? '#fff' : 'var(--text-3)',
              padding: '.7rem 1.1rem',
              cursor: canSend ? 'pointer' : 'default',
              flexShrink: 0,
              minHeight: '2.6rem',
            }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>

        {draft.length > COUNTER_FROM && (
          <p style={{ color: remaining <= 0 ? CRIMSON : 'var(--text-4)', fontSize: '.65rem' }}>
            {remaining <= 0 ? 'That is the limit for one message.' : `${remaining} characters left.`}
          </p>
        )}
        {!isMobile && (
          <p style={{ color: 'var(--text-4)', fontSize: '.62rem' }}>Enter sends. Shift and Enter make a new line.</p>
        )}
      </div>

      {manageOpen && (
        <ChannelModal
          mode="manage"
          isMobile={isMobile}
          isDemo={isDemo}
          contacts={contacts}
          contactsLoading={contactsLoading}
          contactsOutage={contactsOutage}
          onRetryContacts={onRetryContacts}
          conversationId={conversationId}
          initialTitle={conversation.title ?? ''}
          currentMembers={conversation.members}
          lockedIds={conversation.created_by ? [conversation.created_by] : []}
          onClose={() => setManageOpen(false)}
          onSaved={() => {
            setManageOpen(false)
            onReloadList()
          }}
        />
      )}
    </div>
  )
}
