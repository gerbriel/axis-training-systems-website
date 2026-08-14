import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  useUrlTab, useMediaQuery, MOBILE_QUERY,
  demoParamActive, setDemoParam, useDemoParamSync,
  fetchPendingCounts, ZERO_PENDING,
} from '../lib/dashboard'
import type { PendingCounts } from '../lib/dashboard'
import AdminLogin from './admin/AdminLogin'
import AdminSettings from './admin/AdminSettings'
import CRMPanel from './admin/CRMPanel'
import BlogPanel from './admin/BlogPanel'
import RotationPanel from './admin/RotationPanel'
import MeetsPanel from './admin/MeetsPanel'
import BookingsPanel from './admin/BookingsPanel'
import AnalyticsPanel from './admin/AnalyticsPanel'
import TestimonialsPanel from './admin/TestimonialsPanel'
import ApprovalsPanel from './admin/ApprovalsPanel'
import InvitationsPanel from './admin/InvitationsPanel'
import UserManagementPanel from './admin/UserManagementPanel'
import NewsletterPanel from './admin/NewsletterPanel'
import MessagingWorkspace from '../components/messaging/MessagingWorkspace'
import AvailabilityManager from './coach-admin/AvailabilityManager'
import { COACHES } from '../data/coaches'
import { useRequireRole } from '../lib/useGuard'
import { useUnreadCount } from '../lib/useUnreadCount'

type Tab =
  | 'crm' | 'bookings' | 'analytics'
  | 'messages' | 'newsletter'
  | 'approvals' | 'blog' | 'rotation' | 'meets' | 'testimonials'
  | 'invitations' | 'people' | 'availability' | 'settings'

const TABS: readonly Tab[] = [
  'crm', 'bookings', 'analytics',
  'messages', 'newsletter',
  'approvals', 'blog', 'rotation', 'meets', 'testimonials',
  'invitations', 'people', 'availability', 'settings',
]

const TITLES: Record<Tab, string> = {
  crm: 'CRM', bookings: 'Bookings', analytics: 'Analytics',
  messages: 'Messages', newsletter: 'Newsletter',
  approvals: 'Approvals', blog: 'Blog', rotation: 'Blog Rotation',
  meets: 'Meet Listings', testimonials: 'Testimonials',
  invitations: 'Invitations', people: 'People & Access',
  availability: 'Set Availability', settings: 'Settings',
}

// The old header was nine flat tabs in one row; the groups are the mental
// model the owner actually has: people to talk to, content to review, setup.
// 'people' — the accounts, roles and per-person permissions — sits under Setup:
// it is where the site is configured, not where the day's work happens, and it
// is the one tab whose own visibility the permission system gates (below).
const NAV_GROUPS: { label: string; tabs: Tab[] }[] = [
  { label: 'People',  tabs: ['crm', 'bookings', 'analytics', 'invitations'] },
  // Talking to people, as opposed to reviewing what they wrote: the inbox and
  // the newsletter are the same job aimed at one person or at everybody.
  { label: 'Comms',   tabs: ['messages', 'newsletter'] },
  { label: 'Content', tabs: ['approvals', 'blog', 'rotation', 'meets', 'testimonials'] },
  { label: 'Setup',   tabs: ['people', 'availability', 'settings'] },
]

function Nav({ tab, counts, unread, onSelect, onSignOut, signOutLabel }: {
  tab: Tab
  counts: PendingCounts
  unread: number
  onSelect: (t: Tab) => void
  onSignOut?: () => void
  signOutLabel?: string
}) {
  return (
    <>
      {NAV_GROUPS.map(group => (
        <div key={group.label}>
          <p className="dash-group-label">{group.label}</p>
          {group.tabs.map(t => (
            <button
              key={t}
              className="dash-navitem"
              data-active={tab === t}
              aria-current={tab === t ? 'page' : undefined}
              onClick={() => onSelect(t)}
            >
              {TITLES[t]}
              {t === 'approvals' && counts.total > 0 && (
                <span className="dash-badge">{counts.total}</span>
              )}
              {t === 'messages' && unread > 0 && (
                <span className="dash-badge">{unread}</span>
              )}
            </button>
          ))}
        </div>
      ))}
      {onSignOut && (
        <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--surface)' }}>
          <button className="dash-navitem" onClick={onSignOut}>{signOutLabel}</button>
        </div>
      )}
    </>
  )
}

export default function AdminPortal() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useUrlTab(TABS, 'crm')
  const [availCoach, setAvailCoach] = useState(COACHES[0].slug)
  const [isDemo, setIsDemo] = useState(demoParamActive)
  const [counts, setCounts] = useState<PendingCounts>(ZERO_PENDING)
  const [sheetOpen, setSheetOpen] = useState(false)
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const unread = useUnreadCount('admin-unread', isDemo)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useDemoParamSync(setIsDemo)

  // A signed-in athlete or coach reaching /admin is sent where they belong.
  // RLS already returns them nothing here; this is what turns that into a
  // sentence rather than a dozen empty panels.
  useRequireRole({ skip: isDemo })

  // Refetched on every tab change so approving/rejecting inside a panel is
  // reflected in the badge as soon as the owner navigates anywhere. Keyed on
  // the user id, not the session object — supabase mints a new session object
  // on every token refresh and each would refire both fetches.
  const userId = session?.user.id ?? null
  useEffect(() => {
    if (!userId && !isDemo) return
    let live = true
    fetchPendingCounts(isDemo).then(c => { if (live) setCounts(c) })
    return () => { live = false }
  }, [isDemo, userId, tab])

  // The sheet is a modal: page must not scroll under it, Escape closes it,
  // and Back (which changes the tab) should never leave it hanging open.
  useEffect(() => {
    if (!sheetOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheetOpen(false) }
    const onPop = () => setSheetOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPop)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
    }
  }, [sheetOpen])

  const enterDemo = () => { setDemoParam(true); setIsDemo(true) }

  const signOut = async () => {
    if (isDemo) { setDemoParam(false); setIsDemo(false); return }
    await supabase.auth.signOut()
    setSession(null)
  }

  if (loading && !isDemo) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
    </div>
  )

  if (!session && !isDemo) return <AdminLogin onDemo={enterDemo} />

  const signOutLabel = isDemo ? 'Exit Demo' : 'Sign Out'

  const selectTab = (t: Tab) => { setTab(t); setSheetOpen(false) }

  return (
    <div className="dash-shell">
      <header className="dash-topbar">
        {isMobile && (
          <button className="dash-menu-btn" aria-label="Open navigation" onClick={() => setSheetOpen(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </button>
        )}
        <a href={(import.meta as any).env?.BASE_URL ?? '/'}>
          <img src={`${(import.meta as any).env?.BASE_URL ?? '/'}logo.svg`} alt="Axis" style={{ height: 22, filter: 'var(--logo-filter)', display: 'block' }} />
        </a>
        <span style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.25em', textTransform: 'uppercase' }}>Admin</span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          {isDemo ? (
            <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.1em', textTransform: 'uppercase' }}>Demo Mode</span>
          ) : (
            <span className="dash-hide-mobile" style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>{session?.user.email}</span>
          )}
          <button
            className="dash-hide-mobile"
            onClick={signOut}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {signOutLabel}
          </button>
        </div>
      </header>

      {isMobile && sheetOpen && (
        <>
          <div className="dash-sheet-backdrop" onClick={() => setSheetOpen(false)} />
          <nav className="dash-sheet" aria-label="Admin navigation">
            <Nav tab={tab} counts={counts} unread={unread} onSelect={selectTab} onSignOut={signOut} signOutLabel={signOutLabel} />
          </nav>
        </>
      )}

      <div className="dash-layout">
        {!isMobile && (
          <nav className="dash-sidebar" aria-label="Admin navigation">
            <Nav tab={tab} counts={counts} unread={unread} onSelect={selectTab} />
          </nav>
        )}

        <main className="dash-main">
          <div className="dash-pagehead">
            <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em' }}>
              {TITLES[tab]}
            </h1>
          </div>

          {tab === 'crm'          && <CRMPanel isDemo={isDemo} />}
          {tab === 'bookings'     && <BookingsPanel isDemo={isDemo} />}
          {tab === 'analytics'    && <AnalyticsPanel isDemo={isDemo} />}
          {tab === 'messages'     && <MessagingWorkspace isDemo={isDemo} />}
          {tab === 'newsletter'   && <NewsletterPanel isDemo={isDemo} />}
          {tab === 'approvals'    && <ApprovalsPanel isDemo={isDemo} />}
          {tab === 'invitations'  && <InvitationsPanel isDemo={isDemo} />}
          {tab === 'people'       && <UserManagementPanel isDemo={isDemo} />}
          {tab === 'blog'         && <BlogPanel isDemo={isDemo} />}
          {tab === 'rotation'     && <RotationPanel isDemo={isDemo} />}
          {tab === 'meets'        && <MeetsPanel isDemo={isDemo} />}
          {tab === 'testimonials' && <TestimonialsPanel isDemo={isDemo} />}
          {tab === 'settings'     && <AdminSettings isDemo={isDemo} />}
          {tab === 'availability' && (
            <div>
              {/* AvailabilityManager pads itself with .dash-pad — a padded
                  wrapper here would double the inset to 4rem. Only the coach
                  picker needs its own gutter. */}
              <div className="dash-pad" style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', paddingBottom: 0 }}>
                {COACHES.map(c => (
                  <button
                    key={c.slug}
                    onClick={() => setAvailCoach(c.slug)}
                    style={{
                      background: availCoach === c.slug ? '#c8102e' : 'var(--surface)',
                      border: `1px solid ${availCoach === c.slug ? '#c8102e' : 'var(--border)'}`,
                      color: availCoach === c.slug ? 'var(--text)' : 'var(--text-3)',
                      borderRadius: '.3rem', padding: '.6rem 1.1rem', minHeight: '2.5rem',
                      fontSize: '.7rem', fontWeight: 700, letterSpacing: '.1em',
                      textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {c.firstName}
                  </button>
                ))}
              </div>
              <AvailabilityManager
                key={availCoach}
                coach={COACHES.find(c => c.slug === availCoach)!}
                isDemo={isDemo}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
