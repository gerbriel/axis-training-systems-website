import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  useUrlTab, useMediaQuery, MOBILE_QUERY,
  demoParamActive, setDemoParam, useDemoParamSync,
  fetchPendingCounts, ZERO_PENDING,
} from '../lib/dashboard'
import type { PendingCounts } from '../lib/dashboard'
import AdminLogin from './admin/AdminLogin'
import CRMPanel from './admin/CRMPanel'
import BlogWorkspace from './admin/BlogWorkspace'
import MeetsPanel from './admin/MeetsPanel'
import BookingsPanel from './admin/BookingsPanel'
import TestimonialsPanel from './admin/TestimonialsPanel'
import ApprovalsPanel from './admin/ApprovalsPanel'
import InvitationsPanel from './admin/InvitationsPanel'
import MessagesHub from './admin/MessagesHub'      // hosts Inbox / Newsletters
// ── Wave-1 verticals ──
import CalendarPanel from './admin/CalendarPanel'
import TimeClockPanel from './admin/TimeClockPanel'
import FormsPanel from './admin/FormsPanel'
import CatalogPanel from './admin/CatalogPanel'   // hosts Products / Categories / Inventory
import SalesPanel from './admin/SalesPanel'        // hosts Sales / Orders / Expenses
import InsightsPanel from './admin/InsightsPanel'  // hosts Reports / Analytics / Custom Reports / Marketing / Announcements
import SettingsPanel from './admin/SettingsPanel'  // hosts General + Users + the settings sub-tabs
import ResourcesHub from './admin/ResourcesHub'   // hosts Resource Library / Calculator Settings
import { useRequirePortalAccess } from '../lib/useGuard'
import { usePermissions } from '../lib/usePermissions'
import { useAuth } from '../context/AuthContext'
import { useUnreadCount } from '../lib/useUnreadCount'

// Marketing, Analytics and Newsletter are no longer tabs of their own: the
// first two are Insights sub-tabs and the newsletter sits beside the inbox
// under Messages. An old ?tab=marketing bookmark is not a valid tab any more,
// so useUrlTab drops it back to Clients rather than showing an empty shell.
//
// Set Availability went the same way: it is a Settings sub-tab now, at
// ?tab=settings#availability, sitting with the Scheduling and Services setup it
// belongs with rather than holding a rail slot for two hosted components. An old
// ?tab=availability bookmark falls back to Clients exactly like ?tab=marketing.
type Tab =
  | 'calendar' | 'crm' | 'bookings' | 'messages' | 'timeclock' | 'forms'
  | 'approvals' | 'blog' | 'meets' | 'testimonials' | 'resources'
  | 'catalog' | 'sales'
  | 'insights'
  | 'invitations' | 'settings'

const TABS: readonly Tab[] = [
  'calendar', 'crm', 'bookings', 'messages', 'timeclock', 'forms',
  'approvals', 'blog', 'meets', 'testimonials', 'resources',
  'catalog', 'sales',
  'insights',
  'invitations', 'settings',
]

const TITLES: Record<Tab, string> = {
  calendar: 'Calendar', crm: 'Clients', bookings: 'Bookings',
  messages: 'Messages', timeclock: 'Time Clock', forms: 'Forms',
  approvals: 'Waiting on you', blog: 'Blog',
  meets: 'Meet Listings', testimonials: 'Testimonials',
  resources: 'Resources & Tools',
  catalog: 'Catalog', sales: 'Sales',
  insights: 'Insights',
  invitations: 'Invitations', settings: 'Settings',
}

/**
 * What each tab needs. ANY of the listed keys is enough — a tab is a surface,
 * and several of them serve two jobs that were granted separately (Catalog is
 * products, categories and stock; Sales is orders, expenses and the takings).
 *
 * An EMPTY list means "no key of its own": Messages is the staff inbox, and
 * anybody who cleared the portal guard at all belongs in it. `invitations` is
 * the one entry with no key at all — issuing a staff invitation is how an
 * account becomes staff, so it stays where 012 put it, with the admin.
 *
 * THIS IS SIGNAGE. Every panel behind these reads through RLS; the list decides
 * which rail entries render, never what a request returns. A key that appears
 * here and is not yet adopted by a policy (016 says a permission is inert until
 * one is) hides a tab and grants nothing.
 */
const TAB_KEYS: Record<Tab, readonly string[]> = {
  calendar:     ['view_all_calendars', 'manage_bookings_all'],
  crm:          ['manage_leads'],
  bookings:     ['manage_bookings_all'],
  messages:     [],
  timeclock:    ['view_timeclock_all'],
  forms:        ['manage_forms', 'view_form_submissions'],
  // The approvals queue is mostly pending_content, but ApprovalsPanel also
  // surfaces the testimonial queue, so a moderator-only holder gets the tab.
  approvals:    ['view_blog', 'manage_blog', 'moderate_testimonials'],
  blog:         ['view_blog', 'manage_blog'],
  meets:        ['manage_content'],
  testimonials: ['moderate_testimonials'],
  resources:    ['manage_resource_library', 'manage_calculators'],
  catalog:      ['view_store', 'manage_products', 'manage_categories', 'manage_inventory'],
  sales:        ['view_store', 'view_sales', 'manage_orders', 'manage_expenses'],
  insights:     ['view_analytics', 'view_marketing', 'send_marketing', 'manage_announcements'],
  invitations:  [],
  // `manage_staff` is still here because Users and Set Availability are both
  // Settings sub-tabs, so it is still a key that opens this tab.
  settings: [
    'manage_site_settings', 'manage_scheduling', 'manage_services', 'manage_waitlist',
    'manage_notifications', 'manage_legal', 'manage_staff', 'manage_permissions',
  ],
}

/** Admin-only however the roster is configured. See TAB_KEYS. */
const ADMIN_ONLY_TABS: readonly Tab[] = ['invitations']

/**
 * Every key that opens the front door. A coach holding none of these has no tab
 * to land on, so the portal is an empty shell and the guard sends them home.
 * Derived rather than listed so a tab added above cannot be unreachable.
 */
const PORTAL_KEYS: readonly string[] = [...new Set(Object.values(TAB_KEYS).flat())]

// The sidebar groups mirror the reference studio's information architecture:
// the day's work up top, then content to review, the merch store, the
// grow/reporting surfaces, and setup last. Sub-tabbed areas (Messages, Catalog,
// Sales, Insights, Settings) are ONE entry each — the panel behind it hosts its
// own sub-navigation, so Users/Permissions live inside Settings and
// Categories/Inventory inside Catalog rather than crowding the rail. Grow is a
// single entry for the same reason: every reporting surface is an Insights
// sub-tab now.
const NAV_GROUPS: { label: string; tabs: Tab[] }[] = [
  { label: 'Business', tabs: ['calendar', 'crm', 'bookings', 'messages', 'timeclock', 'forms'] },
  { label: 'Content',  tabs: ['approvals', 'blog', 'meets', 'testimonials', 'resources'] },
  { label: 'Store',    tabs: ['catalog', 'sales'] },
  { label: 'Grow',     tabs: ['insights'] },
  { label: 'Setup',    tabs: ['invitations', 'settings'] },
]

function Nav({ tab, groups, counts, unread, onSelect, onSignOut, signOutLabel }: {
  tab: Tab
  /** Already filtered to what this person may open. */
  groups: { label: string; tabs: Tab[] }[]
  counts: PendingCounts
  unread: number
  onSelect: (t: Tab) => void
  onSignOut?: () => void
  signOutLabel?: string
}) {
  return (
    <>
      {groups.map(group => (
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
  const [isDemo, setIsDemo] = useState(demoParamActive)
  const [counts, setCounts] = useState<PendingCounts>(ZERO_PENDING)
  const [sheetOpen, setSheetOpen] = useState(false)
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const unread = useUnreadCount('admin-unread', isDemo)

  // One resolution of the effective set, shared by the entry guard and the rail,
  // so the portal makes a single `effective_permissions` round trip rather than
  // one per consumer.
  //
  // `can('*')` is usePermissions' admin short-circuit, mirroring 016. Demo is
  // ORed separately because a demo session on a CONFIGURED deployment has no
  // profile at all, so the hook answers with the empty set and every tab would
  // vanish from the demo.
  const permissions = usePermissions()
  const { can } = permissions
  const fullAccess = isDemo || can('*')

  // THE SET IS NOT MEANINGFUL UNTIL THE PROFILE IS. usePermissions answers with
  // the EMPTY set while `profile` is still in flight, and empty is a real
  // answer for a signed-out visitor, so the two are indistinguishable from
  // inside the hook. Without this an admin's first frame filters the rail down
  // to Messages and the fallback below rewrites their ?tab= before the true set
  // lands. AuthContext's `loading` is documented as "true until the first
  // profile fetch settles", and `permissions.settled` is the authoritative-set
  // flag — `ready` would flip on the role-default first paint, and a head
  // coach's ?tab= bookmark would be rewritten on a set that is missing the very
  // override that makes the bookmark valid.
  const { loading: authLoading } = useAuth()
  const settled = isDemo || (!authLoading && permissions.settled)

  // A tab is visible when the person could do something on it. The rail is
  // recomputed as the authoritative set lands: usePermissions paints the role
  // default first, so an entry can appear a beat late, which is the direction
  // that hook was written to fail in.
  const visible = useMemo<Tab[]>(
    () => TABS.filter(t => {
      if (fullAccess) return true
      if (ADMIN_ONLY_TABS.includes(t)) return false
      const keys = TAB_KEYS[t]
      return keys.length === 0 || keys.some(k => can(k))
    }),
    [can, fullAccess]
  )

  const groups = useMemo(
    () => NAV_GROUPS
      .map(g => ({ label: g.label, tabs: g.tabs.filter(t => visible.includes(t)) }))
      .filter(g => g.tabs.length > 0),
    [visible]
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useDemoParamSync(setIsDemo)

  // A signed-in athlete reaching /admin is sent where they belong. RLS already
  // returns them nothing here; this is what turns that into a sentence rather
  // than a dozen empty panels.
  //
  // A COACH IS NO LONGER TURNED AWAY ON SIGHT. useRequireRole with no coachSlug
  // resolves to `isAdmin`, which meant the head coach — a coach granted
  // manage_permissions plus some areas — was redirected off the one screen
  // those grants exist for. Entry is now the union of the tab keys.
  useRequirePortalAccess({ skip: isDemo, permissions, keys: PORTAL_KEYS })

  // useUrlTab defaults to 'crm', which needs manage_leads. Somebody who was let
  // in on view_blog alone would land on a tab that is not in their rail, so the
  // first visible one takes over. Also covers a stale ?tab= bookmark from
  // before a permission was revoked.
  useEffect(() => {
    if (!settled) return
    if (visible.length > 0 && !visible.includes(tab)) setTab(visible[0])
  }, [settled, visible, tab, setTab])

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

  const waiting = (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
    </div>
  )

  if (loading && !isDemo) return waiting

  if (!session && !isDemo) return <AdminLogin onDemo={enterDemo} />

  // The rail is drawn FROM the permission set, so painting the shell before the
  // set is known shows a person tabs that are about to disappear and lands them
  // on one of them. One more beat on the screen they were already looking at.
  if (!settled) return waiting

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
            <Nav tab={tab} groups={groups} counts={counts} unread={unread} onSelect={selectTab} onSignOut={signOut} signOutLabel={signOutLabel} />
          </nav>
        </>
      )}

      <div className="dash-layout">
        {!isMobile && (
          <nav className="dash-sidebar" aria-label="Admin navigation">
            <Nav tab={tab} groups={groups} counts={counts} unread={unread} onSelect={selectTab} />
          </nav>
        )}

        <main className="dash-main">
          <div className="dash-pagehead">
            <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em' }}>
              {TITLES[tab]}
            </h1>
          </div>

          {tab === 'calendar'     && <CalendarPanel isDemo={isDemo} />}
          {tab === 'crm'          && <CRMPanel isDemo={isDemo} />}
          {tab === 'bookings'     && <BookingsPanel isDemo={isDemo} />}
          {tab === 'messages'     && <MessagesHub isDemo={isDemo} />}
          {tab === 'timeclock'    && <TimeClockPanel isDemo={isDemo} />}
          {tab === 'forms'        && <FormsPanel isDemo={isDemo} />}
          {tab === 'approvals'    && <ApprovalsPanel isDemo={isDemo} />}
          {tab === 'invitations'  && <InvitationsPanel isDemo={isDemo} />}
          {tab === 'blog'         && <BlogWorkspace isDemo={isDemo} />}
          {tab === 'meets'        && <MeetsPanel isDemo={isDemo} />}
          {tab === 'testimonials' && <TestimonialsPanel isDemo={isDemo} />}
          {tab === 'resources'    && <ResourcesHub isDemo={isDemo} />}
          {tab === 'catalog'      && <CatalogPanel isDemo={isDemo} />}
          {tab === 'sales'        && <SalesPanel isDemo={isDemo} />}
          {tab === 'insights'     && <InsightsPanel isDemo={isDemo} />}
          {tab === 'settings'     && <SettingsPanel isDemo={isDemo} />}
        </main>
      </div>
    </div>
  )
}
