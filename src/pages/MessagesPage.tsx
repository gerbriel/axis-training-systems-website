import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabaseConfigured } from '../lib/supabase'
import { signOut } from '../lib/account'
import { href } from '../utils/nav'
import { useUrlTab, demoParamActive, useDemoParamSync } from '../lib/dashboard'
import MessagingWorkspace from '../components/messaging/MessagingWorkspace'
import NewsFeed from '../components/messaging/NewsFeed'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'
const ACCENT = '#272C84'

/**
 * The athlete's inbox.
 *
 * Staff read their messages inside a dashboard, next to the leads and the
 * calendar. An athlete has no dashboard at all: /account is the whole of their
 * experience, so this page borrows its bare header and links straight back to
 * it rather than growing a second shell for two tabs.
 *
 * The guard is the one AccountPage runs, minus the role check. Coaches and
 * admins have their own copy of the workspace, but a coach who follows a link
 * here should read their messages, not get bounced to their calendar.
 *
 * Nothing here decides what comes back. Every conversation on screen arrives
 * through RLS written against `is_conversation_member()`.
 */

const MESSAGE_TABS = ['inbox', 'news'] as const
type MessageTab = (typeof MESSAGE_TABS)[number]

const TAB_LABELS: Record<MessageTab, string> = { inbox: 'Inbox', news: 'News' }

export default function MessagesPage() {
  const { profile, loading: authLoading, isSignedIn } = useAuth()
  const [isDemo, setIsDemo] = useState(demoParamActive)
  const [tab, setTab] = useUrlTab<MessageTab>(MESSAGE_TABS, 'inbox')

  // Tab changes push history entries carrying ?demo=1, so Back and Forward have
  // to be able to move the page in and out of demo with them.
  useDemoParamSync(setIsDemo)

  // Signage, not security. A person who ignores this and forces the route still
  // reads nothing: the policies on `conversations` and `messages` are what
  // decide, and they answer to auth.uid() rather than to this effect.
  useEffect(() => {
    if (isDemo || !supabaseConfigured) return
    if (authLoading) return
    if (!isSignedIn) { window.location.replace(href('/signin')); return }
    if (profile && profile.status !== 'active') { window.location.replace(href('/pending')) }
  }, [isDemo, authLoading, isSignedIn, profile])

  const ready = isDemo || !supabaseConfigured || (!authLoading && profile?.status === 'active')

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <header style={{ borderBottom: '1px solid var(--surface)', padding: '0 1.25rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1rem' }}>
        <a href={href('/')} style={{ display: 'flex', alignItems: 'center' }}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 22, filter: 'var(--logo-filter)' }} />
        </a>
        <span style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase' }}>
          Messages
        </span>
        <a
          href={href('/account')}
          style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', textDecoration: 'none' }}
        >
          Your account
        </a>
        <button
          onClick={() => void signOut().then(() => window.location.replace(href('/')))}
          style={{ background: 'none', border: 'none', color: 'var(--text-4)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Sign out
        </button>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1.25rem 4rem' }}>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.35rem' }}>
          Your coaches
        </p>
        <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.4rem,4.5vw,2rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: 1, marginBottom: '1.5rem' }}>
          Messages
        </h1>

        <nav aria-label="Messages navigation" style={{ display: 'flex', gap: '1.25rem', borderBottom: '1px solid var(--surface)', marginBottom: '1.5rem' }}>
          {MESSAGE_TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-current={tab === t ? 'page' : undefined}
              style={{
                background: 'none', border: 'none', fontFamily: 'inherit', cursor: 'pointer',
                color: tab === t ? 'var(--text)' : 'var(--text-4)',
                fontSize: '.65rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase',
                padding: '.6rem .1rem', minHeight: '2.5rem',
                borderBottom: `2px solid ${tab === t ? ACCENT : 'transparent'}`,
              }}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </nav>

        {!ready ? (
          <p style={{ color: 'var(--text-3)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
        ) : tab === 'inbox' ? (
          <MessagingWorkspace isDemo={isDemo} />
        ) : (
          <NewsFeed isDemo={isDemo} />
        )}
      </div>
    </div>
  )
}
