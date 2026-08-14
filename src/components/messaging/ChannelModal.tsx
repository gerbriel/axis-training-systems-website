import { useMemo, useState } from 'react'
import type { MessagingContact } from '../../types/messaging'
import { createChannel, renameChannel, updateChannelMembers } from '../../lib/messagingApi'
import { ErrorLine, ModalShell, OutageBlock, SolidButton } from './MessagingChrome'
import { ACCENT, MICRO, ROLE_LABEL, matchesSearch, sortContacts } from './messagingUi'

/**
 * One form for both halves of a channel's life: naming it and choosing who is
 * in it. Creating and editing differ only in what the fields start as and
 * which RPC the save calls, and splitting them into two components would have
 * meant maintaining the same member picker twice.
 *
 * The picker never offers somebody the database would refuse. Every candidate
 * comes from `list_message_contacts`, plus whoever is already a member, since
 * an existing member has to be visible to be removable even if the caller
 * could not have added them.
 */

interface Props {
  mode: 'create' | 'manage'
  isMobile: boolean
  isDemo: boolean
  contacts: MessagingContact[] | null
  contactsLoading: boolean
  contactsOutage: boolean
  onRetryContacts: () => void
  onClose: () => void
  /** Create only. */
  onCreated?: (conversationId: string) => void
  /** Manage only. */
  conversationId?: string
  initialTitle?: string
  currentMembers?: MessagingContact[]
  /** The creator cannot be removed. The database says so too. */
  lockedIds?: string[]
  onSaved?: () => void
}

export default function ChannelModal({
  mode,
  isMobile,
  isDemo,
  contacts,
  contactsLoading,
  contactsOutage,
  onRetryContacts,
  onClose,
  onCreated,
  conversationId,
  initialTitle = '',
  currentMembers = [],
  lockedIds = [],
  onSaved,
}: Props) {
  const [title, setTitle] = useState(initialTitle)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(currentMembers.map(m => m.id)))

  const locked = useMemo(() => new Set(lockedIds), [lockedIds])

  /** Contacts plus anyone already in the room, deduped, in role order. */
  const candidates = useMemo(() => {
    const map = new Map<string, MessagingContact>()
    for (const person of currentMembers) map.set(person.id, person)
    for (const person of contacts ?? []) map.set(person.id, person)
    return sortContacts([...map.values()])
  }, [contacts, currentMembers])

  const results = useMemo(() => candidates.filter(person => matchesSearch(person, query)), [candidates, query])

  const toggle = (id: string) => {
    if (locked.has(id)) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async () => {
    if (saving) return
    const clean = title.trim()
    if (!clean) {
      setError('Give the channel a name.')
      return
    }

    if (mode === 'create') {
      if (selected.size === 0) {
        setError('Pick at least one person to add.')
        return
      }
      setSaving(true)
      setError(null)
      const result = await createChannel(clean, [...selected], isDemo)
      setSaving(false)
      if (!result.ok) {
        setError(result.message)
        return
      }
      onCreated?.(result.conversationId)
      return
    }

    if (!conversationId) return
    const current = new Set(currentMembers.map(person => person.id))
    const add = [...selected].filter(id => !current.has(id))
    const remove = [...current].filter(id => !selected.has(id))

    setSaving(true)
    setError(null)

    if (add.length > 0 || remove.length > 0) {
      const result = await updateChannelMembers(conversationId, add, remove, isDemo)
      if (!result.ok) {
        setSaving(false)
        setError(result.message)
        return
      }
    }

    if (clean !== initialTitle.trim()) {
      const result = await renameChannel(conversationId, clean, isDemo)
      if (!result.ok) {
        setSaving(false)
        setError(result.message)
        return
      }
    }

    setSaving(false)
    onSaved?.()
  }

  const chosen = selected.size

  return (
    <ModalShell
      title={mode === 'create' ? 'New channel' : 'Channel members'}
      onClose={onClose}
      isMobile={isMobile}
    >
      {error && <ErrorLine>{error}</ErrorLine>}

      <div>
        <label className="field-label" htmlFor="channel-title">
          Name
        </label>
        <input
          id="channel-title"
          className="field"
          maxLength={200}
          autoFocus={!isMobile && mode === 'create'}
          value={title}
          onChange={event => setTitle(event.target.value)}
          placeholder="Coach Sarah and her athletes"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '.75rem' }}>
          <span style={{ ...MICRO, color: 'var(--text-4)' }}>Members</span>
          <span style={{ color: 'var(--text-4)', fontSize: '.68rem' }}>
            {chosen} selected
          </span>
        </div>

        {contactsLoading ? (
          <p style={{ ...MICRO, color: 'var(--text-4)', letterSpacing: '.15em' }}>Loading…</p>
        ) : contactsOutage && candidates.length === 0 ? (
          <OutageBlock line="We could not load your contacts." onRetry={onRetryContacts} />
        ) : candidates.length === 0 ? (
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem', lineHeight: 1.7 }}>
            There is nobody you can add yet.
          </p>
        ) : (
          <>
            <input
              className="field"
              type="search"
              placeholder="Search by name"
              value={query}
              onChange={event => setQuery(event.target.value)}
              aria-label="Search people"
            />
            {results.length === 0 ? (
              <p style={{ color: 'var(--text-4)', fontSize: '.8rem' }}>Nobody matches that name.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                {results.map(person => {
                  const checked = selected.has(person.id)
                  const isLocked = locked.has(person.id)
                  return (
                    <label
                      key={person.id}
                      className={`pill-label${checked ? ' pill-checked' : ''}`}
                      style={{
                        width: '100%',
                        whiteSpace: 'normal',
                        justifyContent: 'flex-start',
                        cursor: isLocked ? 'default' : 'pointer',
                        opacity: isLocked ? 0.7 : 1,
                        minHeight: '2.75rem',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isLocked}
                        onChange={() => toggle(person.id)}
                        style={{ accentColor: ACCENT, width: '1rem', height: '1rem', flexShrink: 0 }}
                      />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {person.display_name}
                      </span>
                      <span style={{ color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', flexShrink: 0 }}>
                        {isLocked ? 'Owner' : ROLE_LABEL[person.role]}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', paddingTop: '.25rem' }}>
        <SolidButton
          label={saving ? 'Saving…' : mode === 'create' ? 'Create channel' : 'Save changes'}
          onClick={() => void submit()}
          disabled={saving || !title.trim()}
        />
      </div>
    </ModalShell>
  )
}
