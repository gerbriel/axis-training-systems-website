import { useMemo, useState } from 'react'
import type { MessagingContact } from '../../types/messaging'
import { openDm } from '../../lib/messagingApi'
import { Avatar, ErrorLine, ModalShell, OutageBlock } from './MessagingChrome'
import { MICRO, ROLE_LABEL, matchesSearch, sortContacts } from './messagingUi'

/**
 * Who this person is allowed to write to, and one tap to open that thread.
 *
 * The list is whatever `list_message_contacts` returns, which is the same
 * matrix `can_message` enforces on the way in. Nothing is filtered here that
 * the database would have allowed, and nothing shown here can be refused
 * later, so a pick that fails is a real failure and gets a real sentence.
 */

interface Props {
  contacts: MessagingContact[] | null
  loading: boolean
  outage: boolean
  isDemo: boolean
  isMobile: boolean
  /** An athlete with nobody to write to is waiting on an assignment, not broken. */
  isAthlete: boolean
  onRetry: () => void
  onClose: () => void
  onOpened: (conversationId: string) => void
}

export default function NewMessageModal({
  contacts,
  loading,
  outage,
  isDemo,
  isMobile,
  isAthlete,
  onRetry,
  onClose,
  onOpened,
}: Props) {
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const results = useMemo(() => {
    if (!contacts) return []
    return sortContacts(contacts).filter(contact => matchesSearch(contact, query))
  }, [contacts, query])

  const pick = async (contact: MessagingContact) => {
    if (opening) return
    setOpening(contact.id)
    setError(null)
    const result = await openDm(contact.id, isDemo)
    setOpening(null)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onOpened(result.conversationId)
  }

  return (
    <ModalShell title="New message" onClose={onClose} isMobile={isMobile}>
      {error && <ErrorLine>{error}</ErrorLine>}

      {loading ? (
        <p style={{ ...MICRO, color: 'var(--text-4)', letterSpacing: '.15em' }}>Loading…</p>
      ) : outage || contacts === null ? (
        <OutageBlock line="We could not load your contacts." onRetry={onRetry} />
      ) : contacts.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: '.82rem', lineHeight: 1.7 }}>
          {isAthlete
            ? 'No coach assigned yet. Your coach will appear here once the team sets you up.'
            : 'There is nobody to message yet.'}
        </p>
      ) : (
        <>
          <input
            className="field"
            type="search"
            autoFocus={!isMobile}
            placeholder="Search by name"
            value={query}
            onChange={event => setQuery(event.target.value)}
            aria-label="Search contacts"
          />

          {results.length === 0 ? (
            <p style={{ color: 'var(--text-4)', fontSize: '.8rem' }}>Nobody matches that name.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {results.map(contact => (
                <button
                  key={contact.id}
                  onClick={() => void pick(contact)}
                  disabled={opening !== null}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '.7rem',
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    borderBottom: '1px solid var(--surface)',
                    padding: '.7rem .2rem',
                    cursor: opening ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    minHeight: '3.25rem',
                    opacity: opening && opening !== contact.id ? 0.5 : 1,
                  }}
                >
                  <Avatar name={contact.display_name} url={contact.avatar_url} size={34} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        color: 'var(--text)',
                        fontSize: '.85rem',
                        fontWeight: 700,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {contact.display_name}
                    </span>
                    <span style={{ display: 'block', color: 'var(--text-4)', fontSize: '.68rem', marginTop: '.15rem' }}>
                      {ROLE_LABEL[contact.role]}
                    </span>
                  </span>
                  {opening === contact.id && (
                    <span style={{ ...MICRO, color: 'var(--text-4)', letterSpacing: '.15em' }}>Opening…</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </ModalShell>
  )
}
