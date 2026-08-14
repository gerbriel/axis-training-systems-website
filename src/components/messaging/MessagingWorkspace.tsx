import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../lib/usePermissions'
import { MOBILE_QUERY, useMediaQuery } from '../../lib/dashboard'
import { useLive } from '../../lib/useLive'
import { supabaseConfigured } from '../../lib/supabase'
import {
  DEMO_VIEWER_ID,
  fetchContacts,
  fetchConversations,
  fetchMessagingProfiles,
  markConversationRead,
} from '../../lib/messagingApi'
import type { ConversationSummary, MessagingContact } from '../../types/messaging'
import DemoBanner from '../dashboard/DemoBanner'
import ChannelModal from './ChannelModal'
import ConversationList from './ConversationList'
import ConversationView from './ConversationView'
import NewMessageModal from './NewMessageModal'
import { MICRO, sortConversations } from './messagingUi'

/**
 * The whole messaging surface, mounted the same way in all three shells: the
 * admin portal, the coach portal, and the athlete's own page.
 *
 * Two panes on a desktop, one pane at a time on a phone. The list owns nothing
 * but presentation; this component owns the data, which matters because two
 * separate things change it. A write changes it directly, and Realtime changes
 * it because somebody else wrote. Both funnel into the same reload so there is
 * only ever one idea of what the inbox contains.
 *
 * Unread is a boolean per membership row, so "read" is a flip in two places at
 * once: the database, and the row already on screen. Waiting for the round trip
 * would leave a conversation you are plainly reading marked bold.
 */

export default function MessagingWorkspace({ isDemo = false }: { isDemo?: boolean }) {
  const { profile, isAdmin } = useAuth()
  const { can } = usePermissions()
  const isMobile = useMediaQuery(MOBILE_QUERY)

  // Realtime channel names collide server-side if two mounted components share
  // one, and nothing stops a shell from rendering this twice.
  const instanceId = useId().replace(/:/g, '')

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listOutage, setListOutage] = useState(false)

  const [contacts, setContacts] = useState<MessagingContact[] | null>(null)
  const [contactsLoading, setContactsLoading] = useState(true)
  const [contactsOutage, setContactsOutage] = useState(false)

  const [directory, setDirectory] = useState<MessagingContact[]>([])

  const [activeId, setActiveId] = useState<string | null>(null)
  const [pane, setPane] = useState<'list' | 'thread'>('list')
  const [modal, setModal] = useState<'dm' | 'channel' | null>(null)

  const live = useRef(true)
  useEffect(
    () => () => {
      live.current = false
    },
    []
  )

  const isAthlete = profile?.role === 'athlete'
  const canCreateChannels = isAdmin || can('manage_channels')

  // The demo store composes every thread around its own viewer id, so in demo
  // the signed-in profile is the wrong person to be. Getting this wrong would
  // put the owner's own sample messages on the left with somebody else's name.
  const offline = isDemo || !supabaseConfigured

  /** The signed-in person in the same shape as everybody else in the room. */
  const me = useMemo<MessagingContact | null>(() => {
    if (offline) {
      return {
        id: DEMO_VIEWER_ID,
        display_name: 'You',
        first_name: null,
        last_name: null,
        avatar_url: null,
        role: profile?.role ?? 'athlete',
        coach_slug: null,
      }
    }
    if (!profile) return null
    const fallbackName = [profile.first_name, profile.last_name].filter(Boolean).join(' ')
    return {
      id: profile.id,
      display_name: profile.display_name || fallbackName || 'You',
      first_name: profile.first_name,
      last_name: profile.last_name,
      avatar_url: profile.avatar_url,
      role: profile.role,
      coach_slug: profile.coach_slug,
    }
  }, [profile, offline])

  // ── Loading ───────────────────────────────────────────────────────────────
  /**
   * `quiet` is for reloads triggered by Realtime or by a send: the list is
   * already on screen and correct enough, so it must not blink through a
   * loading state, and a transient failure must not blank it.
   */
  const loadList = useCallback(
    async (quiet = false) => {
      if (!quiet) setListLoading(true)
      const rows = await fetchConversations(isDemo)
      if (!live.current) return
      if (rows === null) {
        if (!quiet) {
          setListOutage(true)
          setConversations([])
        }
      } else {
        setListOutage(false)
        setConversations(sortConversations(rows))
      }
      setListLoading(false)
    },
    [isDemo]
  )

  const loadContacts = useCallback(async () => {
    setContactsLoading(true)
    const rows = await fetchContacts(isDemo)
    if (!live.current) return
    if (rows === null) {
      setContactsOutage(true)
      setContacts(null)
    } else {
      setContactsOutage(false)
      setContacts(rows)
    }
    setContactsLoading(false)
  }, [isDemo])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  // Names and avatars for anyone the caller shares a conversation with. An
  // athlete cannot read other profiles rows, so this definer projection is the
  // only way a sender caption in a channel has a name on it.
  useEffect(() => {
    void fetchMessagingProfiles(isDemo).then(rows => {
      if (live.current && rows) setDirectory(rows)
    })
  }, [isDemo])

  const reloadList = useCallback(() => {
    void loadList(true)
  }, [loadList])

  useLive(
    `messaging-inbox-${instanceId}`,
    isDemo ? [] : [{ table: 'conversations' }, { table: 'conversation_members' }],
    reloadList
  )

  /** id → person, widest source first so a conversation member always wins. */
  const profiles = useMemo(() => {
    const map = new Map<string, MessagingContact>()
    for (const person of directory) map.set(person.id, person)
    for (const person of contacts ?? []) map.set(person.id, person)
    for (const conversation of conversations) {
      for (const member of conversation.members) map.set(member.id, member)
    }
    if (me) map.set(me.id, me)
    return map
  }, [directory, contacts, conversations, me])

  // ── Selection ─────────────────────────────────────────────────────────────
  const markRead = useCallback(
    (conversationId: string) => {
      setConversations(previous =>
        previous.map(row => (row.id === conversationId ? { ...row, unread: false } : row))
      )
      void markConversationRead(conversationId, isDemo)
    },
    [isDemo]
  )

  const select = useCallback((conversationId: string) => {
    setActiveId(conversationId)
    setPane('thread')
  }, [])

  /** A thread that was just created has to be in the list before it can be shown. */
  const openCreated = useCallback(
    async (conversationId: string) => {
      setModal(null)
      await loadList(true)
      if (!live.current) return
      select(conversationId)
    },
    [loadList, select]
  )

  const handleLeft = useCallback(
    (conversationId: string) => {
      setConversations(previous => previous.filter(row => row.id !== conversationId))
      setActiveId(null)
      setPane('list')
      void loadList(true)
    },
    [loadList]
  )

  const active = useMemo(
    () => conversations.find(row => row.id === activeId) ?? null,
    [conversations, activeId]
  )

  // ── Height ────────────────────────────────────────────────────────────────
  // A chat needs a bounded frame or the composer floats off the bottom of a
  // page that scrolls. The frame measures the room it was given rather than
  // assuming a shell, because it is mounted inside three different ones.
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [frameHeight, setFrameHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const measure = () => {
      const element = frameRef.current
      if (!element) return
      const top = element.getBoundingClientRect().top
      const gap = isMobile ? 88 : 32
      setFrameHeight(Math.max(360, Math.round(window.innerHeight - top - gap)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [isMobile, isDemo])

  const emptyHint =
    isAthlete && contacts !== null && contacts.length === 0
      ? 'No coach assigned yet. Your coach will appear here once the team sets you up.'
      : 'Start one with the New message button.'

  const showList = !isMobile || pane === 'list'
  const showThread = !isMobile || pane === 'thread'

  return (
    <div className="dash-pad" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {isDemo && <DemoBanner note="These conversations are samples and replies stay in this preview." />}

      <div
        ref={frameRef}
        style={{
          height: frameHeight ? `${frameHeight}px` : undefined,
          minHeight: 360,
          display: 'flex',
          minWidth: 0,
          border: '1px solid var(--border)',
          borderRadius: '.25rem',
          overflow: 'hidden',
          background: 'var(--bg)',
        }}
      >
        {showList && (
          <div
            style={{
              width: isMobile ? '100%' : 320,
              flexShrink: 0,
              minWidth: 0,
              display: 'flex',
              borderRight: isMobile ? 'none' : '1px solid var(--surface)',
            }}
          >
            <ConversationList
              conversations={conversations}
              activeId={activeId}
              loading={listLoading}
              outage={listOutage}
              onRetry={() => void loadList()}
              onSelect={select}
              onNewMessage={() => setModal('dm')}
              onNewChannel={canCreateChannels ? () => setModal('channel') : null}
              emptyHint={emptyHint}
            />
          </div>
        )}

        {showThread && (
          <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
            {active ? (
              <ConversationView
                key={active.id}
                conversation={active}
                me={me}
                profiles={profiles}
                contacts={contacts}
                contactsLoading={contactsLoading}
                contactsOutage={contactsOutage}
                onRetryContacts={() => void loadContacts()}
                isDemo={isDemo}
                isMobile={isMobile}
                isAdmin={isAdmin}
                canManageChannels={canCreateChannels}
                onBack={() => setPane('list')}
                onReloadList={reloadList}
                onMarkRead={markRead}
                onLeft={handleLeft}
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
                  {activeId ? 'Opening…' : 'Pick a conversation'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {modal === 'dm' && (
        <NewMessageModal
          contacts={contacts}
          loading={contactsLoading}
          outage={contactsOutage}
          isDemo={isDemo}
          isMobile={isMobile}
          isAthlete={!!isAthlete}
          onRetry={() => void loadContacts()}
          onClose={() => setModal(null)}
          onOpened={id => void openCreated(id)}
        />
      )}

      {modal === 'channel' && (
        <ChannelModal
          mode="create"
          isMobile={isMobile}
          isDemo={isDemo}
          contacts={contacts}
          contactsLoading={contactsLoading}
          contactsOutage={contactsOutage}
          onRetryContacts={() => void loadContacts()}
          onClose={() => setModal(null)}
          onCreated={id => void openCreated(id)}
        />
      )}
    </div>
  )
}
