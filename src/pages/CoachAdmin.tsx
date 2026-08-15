import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { getCoachBySlug, COACHES } from '../data/coaches'
import { fetchAllCoachProfiles, toCoachShape } from '../lib/coachProfiles'
import type { CoachDisplay } from '../lib/coachProfiles'
import { useAuth } from '../context/AuthContext'
import type { Profile } from '../lib/account'
import { href, adminHref } from '../utils/nav'
import { useRequireRole } from '../lib/useGuard'
import {
  useUrlTab, useMediaQuery, MOBILE_QUERY,
  demoParamActive, setDemoParam, useDemoParamSync,
} from '../lib/dashboard'
import { clearDraft } from '../lib/contentDraft'
import CoachAdminLogin from './coach-admin/CoachAdminLogin'
import CoachAdminDashboard from './coach-admin/CoachAdminDashboard'
import ContentPublisher from './coach-admin/ContentPublisher'
import AvailabilityManager from './coach-admin/AvailabilityManager'
import TestimonialsManager from './coach-admin/TestimonialsManager'
import MessagingWorkspace from '../components/messaging/MessagingWorkspace'
import CalendarPanel from './admin/CalendarPanel'
import TimeClock from '../components/TimeClock'
import { useUnreadCount } from '../lib/useUnreadCount'

type CoachTab = 'leads' | 'calendar' | 'availability' | 'content' | 'testimonials' | 'messages'

const COACH_TABS: readonly CoachTab[] = ['leads', 'calendar', 'availability', 'content', 'testimonials', 'messages']

// Short labels: 'Publish Content' was one of the reasons four tabs could not
// fit a phone header. The long form lives in the page heading instead.
const TAB_LABELS: Record<CoachTab, string> = {
  leads: 'Leads', calendar: 'Calendar', availability: 'Availability', content: 'Content', testimonials: 'Testimonials',
  messages: 'Messages',
}

const TAB_ICONS: Record<CoachTab, string> = {
  leads:        'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  calendar:     'M12 6v6l4 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z',
  availability: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  content:      'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',
  testimonials: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  messages:     'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
}

function TabIcon({ tab }: { tab: CoachTab }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={TAB_ICONS[tab]} />
    </svg>
  )
}

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

/** 'jamie-okafor' → 'Jamie Okafor'. The only name available before anyone signs in. */
function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * A portal for somebody whose public profile could not be read.
 *
 * Two situations reach this, and neither is an error worth a 404. Signed out,
 * nobody can say whether a slug is real: 032 shows an unfinished profile to
 * staff only, so a brand new coach and a guessed address look identical from
 * outside, and the screen names the address rather than a person. Signed in, it
 * means the account owns this slug (the database said so) while their
 * `coach_profiles` row is missing or briefly unreadable.
 *
 * Every panel behind this reads `slug`, `name` and `firstName` and nothing
 * else, so the portal works either way.
 */
function provisionalCoach(slug: string, profile: Profile | null): CoachDisplay {
  const fromProfile = profile?.display_name?.trim()
    || `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim()
  const name = fromProfile || titleFromSlug(slug)

  return {
    slug,
    name,
    firstName: profile?.first_name?.trim() || name.split(' ')[0] || name,
    // Empty on purpose. It is a PREFILL for the login field, never a
    // credential, and there is nothing here to prefill it from.
    email: '',
    role: 'Coach',
    tagline: '',
    bio: [],
    coachingPhilosophy: '',
    specialties: [],
    services: [],
    stats: [],
    testimonials: [],
  }
}

/** What the public roster had to say about this slug. */
type RosterLookup = {
  state: 'idle' | 'loading' | 'answered' | 'outage'
  coach: CoachDisplay | null
}

interface Props { slug: string }

export default function CoachAdmin({ slug }: Props) {
  // The bundled five ship with the app, so their portal resolves before the
  // first paint and never asks the database who they are. Anyone provisioned
  // from the admin exists only as a row, and is looked up below.
  const staticCoach = getCoachBySlug(slug)
  const { profile, isAdmin, loading: authLoading } = useAuth()
  const [roster, setRoster] = useState<RosterLookup>({ state: 'idle', coach: null })
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // ?demo=1 works here exactly like on the master admin — it used to silently
  // do nothing on the coach route, and a refresh mid-demo hit the login wall.
  const [isDemo, setIsDemo] = useState(demoParamActive)
  const [tab, setTab] = useUrlTab(COACH_TABS, 'leads')
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const unread = useUnreadCount('coach-unread', isDemo)

  useDemoParamSync(setIsDemo)

  // A coach may open their OWN portal. Anyone else signed in is sent home —
  // an admin passes, because the master portal renders this same component.
  useRequireRole({ skip: isDemo, coachSlug: slug })

  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // Boolean, not the session object: supabase mints a fresh one on every token
  // renewal, and the lookup below would refire on each of them.
  const signedIn = !!session

  /**
   * Who this slug belongs to, when the answer is not in the bundle.
   *
   * Only asked once there is somebody to ask it for. A newly provisioned coach
   * starts hidden (`is_visible` false), which 032 shows to staff and to nobody
   * else, so a signed-out read cannot tell "not a coach" from "not yet public"
   * and must not be allowed to answer either.
   */
  useEffect(() => {
    if (staticCoach) return
    if (!isDemo && !signedIn) return

    let live = true
    setRoster({ state: 'loading', coach: null })
    fetchAllCoachProfiles(isDemo)
      .then(rows => {
        if (!live) return
        // null is an outage, not an answer, and 404ing on one would tell a real
        // coach their own portal is gone.
        if (!rows) { setRoster({ state: 'outage', coach: null }); return }
        const row = rows.find(r => r.slug === slug)
        setRoster({ state: 'answered', coach: row ? toCoachShape(row) : null })
      })
      .catch(() => { if (live) setRoster({ state: 'outage', coach: null }) })

    return () => { live = false }
  }, [slug, staticCoach, isDemo, signedIn])

  const enterDemo = () => { setDemoParam(true); setIsDemo(true) }

  const signOut = async () => {
    if (isDemo) { setDemoParam(false); setIsDemo(false); return }
    await supabase.auth.signOut()
    // The draft goes with the session. ContentPublisher autosaves the coach's
    // unpublished post — title, body, and the id of the row it is editing —
    // into localStorage every 800ms, and signing out used to leave all of it on
    // the machine for whoever opens the console next. Signing out on a shared
    // laptop is exactly the moment somebody expects it gone.
    if (slug) clearDraft(slug, false)
    setSession(null)
  }

  // ── The gate ──────────────────────────────────────────────────────────────
  //
  // Three questions, in this order, and only one of them is about identity.
  //
  //   Who is this portal for?  The static entry, else the profile row, else
  //   nobody yet — and "nobody yet" is a state, not a 404.
  //
  //   May this account open it?  `profiles.coach_slug`, which is the same
  //   column `current_coach_slug()` resolves for every policy since 002. The
  //   session's EMAIL is not asked about at all any more: it used to be matched
  //   against the static array, which meant a coach who did not ship in the
  //   bundle could never open their own portal.
  //
  //   Does the slug exist?  Answered last, because it can only be answered by a
  //   read that a signed-out visitor is not allowed to make.
  //
  // `useRequireRole` above has already sent an active coach on somebody else's
  // portal home. This is what is left: the demo, the admin, the owner, and
  // everybody else looking at a login.
  const known = staticCoach ?? roster.coach
  const ownsThisPortal = !!profile && profile.status === 'active' && profile.coach_slug === slug
  const isAuthenticated = isDemo || isAdmin || ownsThisPortal

  // The profile is part of the wait now, not only the session. Rendering the
  // login for the half-second before it arrives would flash "you are signed in
  // with a different account" at the coach who owns the place.
  // AuthContext raises loading again while the post-sign-in profile fetch is
  // in flight, so authLoading covers the window that used to flash the
  // wrong-account banner at a coach who had just signed in correctly.
  const settling = (!isDemo && (loading || authLoading)) || roster.state === 'loading'

  if (settling) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
    </div>
  )

  if (!known && roster.state === 'answered' && !ownsThisPortal) {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1.5rem', padding: '1rem' }}>
        <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.3em', textTransform: 'uppercase' }}>404</p>
        <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.5rem', textTransform: 'uppercase' }}>Coach Not Found</h1>
        {/* A coach who guessed their slug ('/admin/ronnie') lands here — list
            the real portals instead of dead-ending them at the wrong login. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem 1.25rem', justifyContent: 'center' }}>
          {COACHES.map(c => (
            <a key={c.slug} href={adminHref(c.slug)} style={{ color: 'var(--text-2)', fontSize: '.85rem', textDecoration: 'underline', padding: '.25rem 0' }}>
              {c.name}
            </a>
          ))}
        </div>
        <a href={adminHref()} style={{ color: 'var(--text-3)', fontSize: '.75rem', textDecoration: 'underline' }}>← Master Admin</a>
      </div>
    )
  }

  const coach = known ?? provisionalCoach(slug, profile)

  if (!isAuthenticated) {
    return (
      <CoachAdminLogin
        coach={coach}
        onDemo={enterDemo}
        // Reaching this line with a session means that session is not this
        // coach and is not an admin. There is nothing else left for it to be.
        sessionMismatch={signedIn}
        onSignOut={signOut}
      />
    )
  }

  return (
    <div className="dash-shell">
      <header className="dash-topbar">
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 22, filter: 'var(--logo-filter)', display: 'block' }} />
        </a>
        <span style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{coach.name}</span>

        <nav className="dash-tabs" aria-label="Coach portal navigation">
          {COACH_TABS.map(t => (
            <button
              key={t}
              className="dash-tab"
              data-active={tab === t}
              aria-current={tab === t ? 'page' : undefined}
              onClick={() => setTab(t)}
            >
              {TAB_LABELS[t]}
              {t === 'messages' && unread > 0 && (
                <span aria-hidden style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#c8102e', marginLeft: '.35rem', verticalAlign: 'middle' }} />
              )}
            </button>
          ))}
        </nav>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {isDemo ? (
            <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: '.65rem', letterSpacing: '.2em', textTransform: 'uppercase' }}>Demo</span>
          ) : (
            /* Hidden below 1150px, not just on phones: name + 4 tabs + email +
               Sign Out overflow a single row anywhere under ~1100px. */
            <span className="dash-hide-narrow" style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>{session?.user.email}</span>
          )}
          <button
            onClick={signOut}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.5rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >
            {isDemo ? 'Exit Demo' : 'Sign Out'}
          </button>
        </div>
      </header>

      {/* Page header */}
      <div className="dash-pagehead">
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.25rem' }}>{coach.role}</p>
        <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em' }}>
          {{ leads: `${coach.firstName}'s Leads`, calendar: 'Calendar', availability: 'Availability', content: 'Publish Content', testimonials: 'Testimonials', messages: 'Messages' }[tab]}
        </h1>
      </div>

      {/* Content */}
      <main className={`dash-main${isMobile ? ' dash-has-bottombar' : ''}`}>
        {tab === 'leads'        && <CoachAdminDashboard coach={coach} isDemo={isDemo} />}
        {tab === 'calendar'     && (
          <div className="dash-pad" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* The coach's own work-hours clock, then their calendar locked to
                their slug — the server scopes it either way, lockCoach just
                hides the picker. */}
            <TimeClock variant="coach" isDemo={isDemo} />
            <CalendarPanel coachSlug={coach.slug} lockCoach isDemo={isDemo} />
          </div>
        )}
        {tab === 'availability' && <AvailabilityManager coach={coach} isDemo={isDemo} />}
        {tab === 'content'      && <ContentPublisher coach={coach} isDemo={isDemo} />}
        {tab === 'testimonials' && <TestimonialsManager coach={coach} isDemo={isDemo} />}
        {tab === 'messages'     && <MessagingWorkspace isDemo={isDemo} />}
      </main>

      {/* Phone navigation: thumb-reachable, always visible — the header tab
          strip is display:none below 768px. */}
      {isMobile && (
        <nav className="dash-bottombar" aria-label="Coach portal navigation">
          {COACH_TABS.map(t => (
            <button
              key={t}
              className="dash-bottombar-item"
              data-active={tab === t}
              aria-current={tab === t ? 'page' : undefined}
              onClick={() => setTab(t)}
              style={{ position: 'relative' }}
            >
              <TabIcon tab={t} />
              {t === 'messages' && unread > 0 && (
                <span aria-hidden style={{ position: 'absolute', top: '.3rem', left: 'calc(50% + .35rem)', width: 7, height: 7, borderRadius: '50%', background: '#c8102e' }} />
              )}
              {TAB_LABELS[t]}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
