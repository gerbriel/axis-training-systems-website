import type { ConversationSummary } from '../../types/messaging'
import { Avatar, OutageBlock, Pill } from './MessagingChrome'
import { ACCENT, BTN, MICRO, conversationTitle, timeAgo } from './messagingUi'

/**
 * The inbox side of the workspace: who has written, what they said last, and
 * how long ago. Everything here is presentation. The rows are already ordered
 * and already carry the caller's own unread flag, so nothing in this file has
 * to know who is signed in.
 */

interface Props {
  conversations: ConversationSummary[]
  activeId: string | null
  loading: boolean
  outage: boolean
  onRetry: () => void
  onSelect: (id: string) => void
  onNewMessage: () => void
  /** Null hides the button. Only admins and manage_channels holders get it. */
  onNewChannel: (() => void) | null
  /** Shown under the empty state when an athlete has nobody to write to yet. */
  emptyHint: string
}

export default function ConversationList({
  conversations,
  activeId,
  loading,
  outage,
  onRetry,
  onSelect,
  onNewMessage,
  onNewChannel,
  emptyHint,
}: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, width: '100%' }}>
      <div
        style={{
          padding: '.9rem 1rem',
          borderBottom: '1px solid var(--surface)',
          display: 'flex',
          flexDirection: 'column',
          gap: '.7rem',
          flexShrink: 0,
        }}
      >
        <span style={{ ...MICRO, color: 'var(--text-4)' }}>Inbox</span>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <button
            onClick={onNewMessage}
            style={{ ...BTN, background: ACCENT, border: 'none', color: '#fff', padding: '.55rem .85rem', minHeight: '2.3rem' }}
          >
            New message
          </button>
          {onNewChannel && (
            <button
              onClick={onNewChannel}
              style={{
                ...BTN,
                background: 'none',
                border: '1px solid var(--surface-2)',
                color: 'var(--text-3)',
                fontWeight: 700,
                padding: '.55rem .85rem',
                minHeight: '2.3rem',
              }}
            >
              New channel
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loading ? (
          <p style={{ ...MICRO, color: 'var(--text-4)', letterSpacing: '.15em', padding: '1.25rem 1rem' }}>Loading…</p>
        ) : outage ? (
          <OutageBlock line="We could not load your conversations." onRetry={onRetry} />
        ) : conversations.length === 0 ? (
          <div style={{ padding: '1.5rem 1rem' }}>
            <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.4rem' }}>
              No conversations yet.
            </p>
            <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.65 }}>{emptyHint}</p>
          </div>
        ) : (
          conversations.map(conversation => {
            const active = conversation.id === activeId
            const title = conversationTitle(conversation)
            return (
              <button
                key={conversation.id}
                onClick={() => onSelect(conversation.id)}
                aria-current={active ? 'true' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '.7rem',
                  width: '100%',
                  textAlign: 'left',
                  background: active ? 'var(--surface)' : 'none',
                  border: 'none',
                  borderBottom: '1px solid var(--surface)',
                  borderLeft: `2px solid ${active ? ACCENT : 'transparent'}`,
                  padding: '.85rem 1rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  minHeight: '3.75rem',
                }}
              >
                <Avatar
                  name={title}
                  url={conversation.kind === 'dm' ? conversation.members[0]?.avatar_url : null}
                  size={38}
                />

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
                        fontWeight: conversation.unread ? 900 : 700,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}
                    >
                      {title}
                    </span>
                    {/* 'broadcast' is the enum's name for the newsletter kind (023). */}
                    {conversation.kind === 'broadcast' && <Pill label="Newsletter" tone="accent" />}
                    {conversation.kind === 'channel' && <Pill label="Channel" />}
                  </span>

                  <span
                    style={{
                      display: 'block',
                      color: conversation.unread ? 'var(--text-2)' : 'var(--text-4)',
                      fontWeight: conversation.unread ? 700 : 400,
                      fontSize: '.76rem',
                      lineHeight: 1.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {conversation.last_message_preview || 'No messages yet.'}
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
                    {timeAgo(conversation.last_message_at)}
                  </span>
                  {conversation.unread && (
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
  )
}
