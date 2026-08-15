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
import { fetchNewsletterThreads } from '../../lib/newsletterBroadcast'
import type { ConversationSummary, MessagingContact, NewsletterThread } from '../../types/messaging'
import DemoBanner from '../dashboard/DemoBanner'
import ChannelModal from './ChannelModal'
import ConversationList from './ConversationList'
import ConversationView from './ConversationView'
import NewMessageModal from './NewMessageModal'
import NewslettersView from './NewslettersView'
import { ACCENT, MICRO, sortConversations } from './messagingUi'

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
 * There are two things to read here, so there is a strip of two tabs above the
 * panes. Inbox is conversation: direct messages and channels, with a composer.
 * Newsletters is announcement: one item per newsletter that reached this
 * person, votable when it carries a poll, and closed to replies. Both sets of
 * rows are loaded on mount rather than on first click, because the unread dot
 * on the Newsletters tab has to be honest before anybody presses it.
 *
 * Unread is a boolean per membership row, so "read" is a flip in two places at
 * once: the database, and the row already on screen. Waiting for the round trip
 * would leave a conversation you are plainly reading marked bold.
 */

type Mode = 'inbox' | 'newsletters'

const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'newsletters', label: 'Newsletters' },
]

export default function MessagingWorkspace({ isDemo = false }: { isDemo?: boolean }) {
  const { profile, isAdmin } = useAuth()
  const { can } = usePermissions()
  const isMobile = useMediaQuery(MOBILE_QUERY)

  // Realtime channel names collide server-side if two mounted components share
  // one, and nothing stops a shell from rendering this twice.
  const instanceId = useId().replace(/:/g, '')

  const [mode, setMode] = useState<Mode>('inbox')

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listOutage, setListOutage] = useState(false)

  const [threads, setThreads] = useState<NewsletterThread[]>([])
  const [threadsLoading, setThreadsLoading] = useState(true)
  const [threadsOutage, setThreadsOutage] = useState(false)

  const [contacts, setContacts] = useState<MessagingContact[] | null>(null)
  const [contactsLoading, setContactsLoading] = useState(true)
  const [contactsOutage, setContactsOutage] = useState(false)

  const [directory, setDirectory] = useState<MessagingContact[]>([])

  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeNewsletterId, setActiveNewsletterId] = useState<string | null>(null)
  const [pane, setPane] = useState<'list' | 'thread'>('list')
  const [modal, setModal] = useState<'dm' | 'channel' | null>(null)

  // "Is this component still on screen", asked by every await below before it
  // writes what it fetched. It is armed at the start of the mount effect and
  // not only at the initial ref value, because StrictMode mounts, tears down,
  // and mounts again in development: a guard that is only ever set false in
  // cleanup would stay false for the second mount and the panes would load
  // rows and then throw every one of them away.
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

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

  /** The same contract as `loadList`, for the newsletters a person received. */
  const loadNewsletters = useCallback(
    async (quiet = false) => {
      if (!quiet) setThreadsLoading(true)
      const rows = await fetchNewsletterThreads(isDemo)
      if (!live.current) return
      if (rows === null) {
        if (!quiet) {
          setThreadsOutage(true)
          setThreads([])
        }
      } else {
        setThreadsOutage(false)
        setThreads(rows)
      }
      setThreadsLoading(false)
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
    void loadNewsletters()
  }, [loadNewsletters])

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

  /** Voting refetches through this, so the tallies on screen are the server's. */
  const reloadNewsletters = useCallback(() => loadNewsletters(true), [loadNewsletters])

  // One subscription feeds both tabs: a newsletter arriving is a conversation
  // row and a membership row, the same two tables an ordinary message touches.
  const reloadAll = useCallback(() => {
    void loadList(true)
    void loadNewsletters(true)
  }, [loadList, loadNewsletters])

  useLive(
    `messaging-inbox-${instanceId}`,
    isDemo ? [] : [{ table: 'conversations' }, { table: 'conversation_members' }],
    reloadAll
  )

  /** id → person, widest source first so a conversation member always wins. */
  const profiles = useMemo(() => {
    const map = new Map<string, MessagingContact>()
    for (const person of directory) map.set(person.id, person)
    for (const person of contacts ?? []) map.set(person.id, person)
    for (const conversation of conversations) {
      for (const member of conversation.members) map.set(member.id, member)
    }
    for (const thread of threads) {
      for (const member of thread.summary.members) map.set(member.id, member)
    }
    if (me) map.set(me.id, me)
    return map
  }, [directory, contacts, conversations, threads, me])

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

  const markNewsletterRead = useCallback(
    (conversationId: string) => {
      setThreads(previous =>
        previous.map(thread =>
          thread.summary.id === conversationId
            ? { ...thread, summary: { ...thread.summary, unread: false } }
            : thread
        )
      )
      void markConversationRead(conversationId, isDemo)
    },
    [isDemo]
  )

  const select = useCallback((conversationId: string) => {
    setActiveId(conversationId)
    setPane('thread')
  }, [])

  const selectNewsletter = useCallback((conversationId: string) => {
    setActiveNewsletterId(conversationId)
    setPane('thread')
  }, [])

  /** Switching tabs always lands on the list, on a phone as well as a desktop. */
  const switchMode = useCallback((next: Mode) => {
    setMode(next)
    setPane('list')
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

  const newslettersUnread = useMemo(() => threads.some(thread => thread.summary.unread), [threads])

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
  // On a phone the strip belongs to the list screen. Reading takes the whole
  // height, and Back is what comes out of it.
  const showModes = !isMobile || pane === 'list'

  return (
    <div className="dash-pad" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {isDemo && (
        <DemoBanner
          note={
            mode === 'newsletters'
              ? 'These newsletters are samples and votes stay in this preview.'
              : 'These conversations are samples and replies stay in this preview.'
          }
        />
      )}

      <div
        ref={frameRef}
        style={{
          height: frameHeight ? `${frameHeight}px` : undefined,
          minHeight: 360,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          border: '1px solid var(--border)',
          borderRadius: '.25rem',
          overflow: 'hidden',
          background: 'var(--bg)',
        }}
      >
        {showModes && (
          <div
            role="tablist"
            aria-label="Messages sections"
            style={{
              display: 'flex',
              gap: '1.25rem',
              padding: '0 1rem',
              borderBottom: '1px solid var(--surface)',
              flexShrink: 0,
            }}
          >
            {MODES.map(entry => {
              const selected = mode === entry.id
              return (
                <button
                  key={entry.id}
                  role="tab"
                  id={`${instanceId}-tab-${entry.id}`}
                  aria-selected={selected}
                  aria-controls={`${instanceId}-panel-${entry.id}`}
                  onClick={() => switchMode(entry.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '.4rem',
                    background: 'none',
                    border: 'none',
                    borderBottom: `2px solid ${selected ? ACCENT : 'transparent'}`,
                    color: selected ? 'var(--text)' : 'var(--text-4)',
                    fontFamily: 'inherit',
                    fontSize: '.72rem',
                    fontWeight: 900,
                    letterSpacing: '.15em',
                    textTransform: 'uppercase',
                    padding: '.7rem .1rem',
                    minHeight: '2.6rem',
                    cursor: 'pointer',
                  }}
                >
                  {entry.label}
                  {entry.id === 'newsletters' && newslettersUnread && (
                    <span
                      aria-label="Unread newsletters"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: ACCENT,
                        boxShadow: '0 0 0 2px rgba(39,44,132,.3)',
                      }}
                    />
                  )}
                </button>
              )
            })}
          </div>
        )}

        <div
          role="tabpanel"
          id={`${instanceId}-panel-${mode}`}
          aria-labelledby={showModes ? `${instanceId}-tab-${mode}` : undefined}
          style={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}
        >
          {mode === 'newsletters' ? (
            <NewslettersView
              threads={threads}
              activeId={activeNewsletterId}
              loading={threadsLoading}
              outage={threadsOutage}
              profiles={profiles}
              meId={me?.id ?? null}
              isDemo={isDemo}
              isMobile={isMobile}
              showList={showList}
              showThread={showThread}
              onRetry={() => void loadNewsletters()}
              onSelect={selectNewsletter}
              onBack={() => setPane('list')}
              onMarkRead={markNewsletterRead}
              onReload={reloadNewsletters}
            />
          ) : (
            <>
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
            </>
          )}
        </div>
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
