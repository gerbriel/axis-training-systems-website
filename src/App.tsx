import { useState, useEffect } from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Philosophy from './components/Philosophy'
import Services from './components/Services'
import HowItWorks from './components/HowItWorks'
import Testimonials from './components/Testimonials'
import Tools from './components/Tools'
import Coaches from './components/Coaches'
import UpcomingMeets from './components/UpcomingMeets'
import Footer from './components/Footer'
import PrivacyPolicy from './components/PrivacyPolicy'
import AnnouncementBanner from './components/AnnouncementBanner'
import AdminPortal from './pages/AdminPortal'
import ResetPassword from './pages/ResetPassword'
import CoachPage from './pages/CoachPage'
import ApplyPage from './pages/ApplyPage'
import CoachAdmin from './pages/CoachAdmin'
import BlogIndex from './pages/BlogIndex'
import BlogPostPage from './pages/BlogPostPage'
import GuidesPage from './pages/GuidesPage'
import Rankings from './pages/Rankings'
import BookPage from './pages/BookPage'
import ManageBookingPage from './pages/ManageBookingPage'
import ShopPage from './pages/ShopPage'
import IntakeForm from './components/IntakeForm'
import AccountPage from './pages/AccountPage'
import MessagesPage from './pages/MessagesPage'
import SignInPage from './pages/auth/SignInPage'
import InvitePage from './pages/auth/InvitePage'
import PendingPage from './pages/auth/PendingPage'
import AuthCallbackPage from './pages/auth/AuthCallbackPage'
import ToolPage from './pages/ToolPage'
import { AuthProvider, useAuth } from './context/AuthContext'
import { fetchSiteFlag } from './lib/siteSettings'
import { trackPageview } from './lib/analytics'
import { href } from './utils/nav'

// Apply the theme before first paint to prevent a flash.
//
// LIGHT is the default now. The `.light` class carries the light palette (dark
// lives on bare :root), so light = add the class. Dark is opt-in and remembered
// per browser: only an explicit 'dark' choice skips the class. A storage that
// throws (private mode) still lands on the light default rather than falling
// through to dark.
try {
  if (localStorage.getItem('axis-theme') !== 'dark') {
    document.documentElement.classList.add('light')
  }
} catch {
  document.documentElement.classList.add('light')
}

// ── Icons ──────────────────────────────────────────────────────────────────
const SunIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
)

const MoonIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
)

// ── Theme toggle ───────────────────────────────────────────────────────────
function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => !document.documentElement.classList.contains('light'))

  const toggle = () => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle('light', !next)
    try { localStorage.setItem('axis-theme', next ? 'dark' : 'light') } catch {}
  }

  return (
    <button
      onClick={toggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        position: 'fixed', bottom: '5rem', right: '1.5rem', zIndex: 9999,
        width: '2.2rem', height: '2.2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--surface)',
        border: '1px solid rgba(39,44,132,.35)',
        borderRadius: '.4rem',
        color: 'rgba(39,44,132,.9)',
        cursor: 'pointer',
        boxShadow: '0 4px 20px rgba(0,0,0,.4)',
        transition: 'background .15s, border-color .15s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(39,44,132,.7)'; e.currentTarget.style.background = 'var(--bg)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(39,44,132,.35)'; e.currentTarget.style.background = 'var(--surface)' }}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

// ── Demo widget ────────────────────────────────────────────────────────────
function DemoWidget() {
  const [hovered, setHovered] = useState(false)
  const { isAdmin } = useAuth()

  // Off for the public by default; an admin turns it on in Settings. The admin
  // themselves always sees it, so hiding it from visitors never hides it from
  // the person who controls the switch. Starts hidden and appears only once the
  // flag resolves true — no flash of a demo button on a live marketing page.
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let live = true
    fetchSiteFlag('demo_enabled').then(v => { if (live) setEnabled(v) })
    return () => { live = false }
  }, [])

  if (!enabled && !isAdmin) return null

  return (
    <a
      href={href('/admin?demo=1')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999,
        display: 'flex', alignItems: 'center', gap: '.5rem',
        background: hovered ? '#1a1a1a' : '#0a0a0a',
        border: '1px solid rgba(39,44,132,.35)',
        borderRadius: '.4rem', padding: '.55rem 1rem',
        textDecoration: 'none', transition: 'background .15s, border-color .15s',
        boxShadow: '0 4px 20px rgba(0,0,0,.6)',
        ...(hovered ? { borderColor: 'rgba(39,44,132,.65)' } : {}),
      }}
    >
      <span style={{ fontSize: '.7rem', color: 'rgba(39,44,132,.8)', fontWeight: 900, letterSpacing: '.08em' }}>▶</span>
      <span style={{ color: '#ffffff', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase' }}>View Demo</span>
    </a>
  )
}

// ── Routing ────────────────────────────────────────────────────────────────
const base = ((import.meta as any).env?.BASE_URL ?? '/').replace(/\/$/, '')
const rawPath = window.location.pathname
const path = rawPath.startsWith(base) ? rawPath.slice(base.length) || '/' : rawPath

function getRoute() {
  // Before the /admin matchers: the recovery link is followed by a signed-out
  // coach, and any admin route would bounce them to a login they cannot pass.
  if (path === '/reset-password') return { type: 'reset-password' }

  // Auth, also before /admin, and for the same reason — every one of these is
  // reached by somebody who is either signed out or not yet allowed in.
  //
  // /auth/callback is where Google, the magic link and the signup confirmation
  // all return to. supabase-js exchanges the `code` in the query string for a
  // session on its own; the page's job is to wait for it and then route by who
  // the person turned out to be.
  if (path === '/auth/callback') return { type: 'auth-callback' }
  if (path === '/signin' || path === '/login') return { type: 'signin' }
  if (path === '/pending') return { type: 'pending' }
  if (path === '/account') return { type: 'account' }
  // Before the /admin matchers, like everything else a signed-in athlete
  // reaches: /admin/<slug> would swallow any sub-path under /admin, which is
  // why the inbox is its own top-level route rather than /admin/messages.
  if (path === '/messages') return { type: 'messages' }
  // The token is base64url of 32 bytes — 43 characters. Matched strictly rather
  // than passed through as whatever happened to be in the path.
  const inviteMatch = path.match(/^\/invite\/([A-Za-z0-9_-]{16,400})$/)
  if (inviteMatch) return { type: 'invite', token: inviteMatch[1] }
  const coachAdminMatch = path.match(/^\/admin\/([^/]+)/)
  if (coachAdminMatch) return { type: 'coach-admin', slug: coachAdminMatch[1] }
  if (path === '/admin' || path.startsWith('/admin/')) return { type: 'admin' }
  const coachMatch = path.match(/^\/coaches\/([^/]+)/)
  if (coachMatch) return { type: 'coach', slug: coachMatch[1] }
  const applyMatch = path.match(/^\/apply\/([^/]+)/)
  if (applyMatch) return { type: 'apply', slug: applyMatch[1] }
  const blogPostMatch = path.match(/^\/blog\/([^/]+)/)
  if (blogPostMatch) return { type: 'blog-post', slug: blogPostMatch[1] }
  if (path === '/blog') return { type: 'blog' }
  if (path === '/guides') return { type: 'guides' }
  const toolMatch = path.match(/^\/tools\/([^/]+)/)
  if (toolMatch) return { type: 'tool', slug: toolMatch[1] }
  if (path === '/rankings') return { type: 'rankings' }
  if (path === '/book') return { type: 'book' }
  if (path === '/shop') return { type: 'shop' }
  // Intake: the general form, or a coach-specific one at /intake/<slug>.
  if (path === '/intake') return { type: 'intake' }
  const intakeMatch = path.match(/^\/intake\/([a-z0-9-]+)$/)
  if (intakeMatch) return { type: 'intake', slug: intakeMatch[1] }
  // The client's own booking, addressed by the manage_token from their
  // confirmation email (010). There are no accounts, so the link IS the
  // credential — which is why it is matched strictly as a uuid rather than
  // passed through as whatever happened to be in the path.
  const manageMatch = path.match(/^\/booking\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  if (manageMatch) return { type: 'manage-booking', token: manageMatch[1] }
  return { type: 'home' }
}

const route = getRoute()
trackPageview(path || '/')

// ── Page content (routing) ─────────────────────────────────────────────────
function AppContent() {
  if (route.type === 'reset-password') return <ResetPassword />
  if (route.type === 'auth-callback') return <AuthCallbackPage />
  if (route.type === 'signin') return <SignInPage />
  if (route.type === 'pending') return <PendingPage />
  if (route.type === 'account') return <AccountPage />
  if (route.type === 'messages') return <MessagesPage />
  if (route.type === 'invite') return <InvitePage token={route.token!} />
  if (route.type === 'coach-admin') return <CoachAdmin slug={route.slug!} />
  if (route.type === 'admin') return <AdminPortal />
  if (route.type === 'coach') return <CoachPage slug={route.slug!} />
  if (route.type === 'apply') return <ApplyPage slug={route.slug!} />
  if (route.type === 'blog') return <BlogIndex />
  if (route.type === 'blog-post') return <BlogPostPage slug={route.slug!} />
  if (route.type === 'guides') return <GuidesPage />
  if (route.type === 'tool') return <ToolPage slug={route.slug!} />
  if (route.type === 'rankings') return <Rankings />
  // The booking page carries its own in-flow header, so the banner simply sits
  // above it.
  if (route.type === 'book') return (
    <>
      <AnnouncementBanner />
      <BookPage />
    </>
  )
  if (route.type === 'shop') return <ShopPage />
  if (route.type === 'intake') return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', padding: '3rem 1.25rem' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <IntakeForm coachSlug={route.slug} />
      </div>
    </div>
  )
  if (route.type === 'manage-booking') return <ManageBookingPage token={route.token!} />

  // ── Home ─────────────────────────────────────────────────────────────────
  const [showPrivacy, setShowPrivacy] = useState(false)

  useEffect(() => {
    const handler = () => setShowPrivacy(true)
    window.addEventListener('open-privacy', handler)
    return () => window.removeEventListener('open-privacy', handler)
  }, [])

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Above the page flow, but clear of the navbar: that bar is fixed, so a
          banner at y=0 would render underneath it. */}
      <AnnouncementBanner offsetTop="4rem" />
      <Navbar />
      <Hero />
      <Philosophy />
      <Services />
      <HowItWorks />
      <Testimonials />
      <Coaches />
      <Tools />
      <UpcomingMeets />
      <Footer />
      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
      <DemoWidget />
    </div>
  )
}

export default function App() {
  return (
    // Wraps everything, not just the signed-in routes: the booking page and the
    // marketing pages both want to know whether somebody is signed in, and a
    // provider mounted per-route re-runs its session fetch on every navigation.
    <AuthProvider>
      <AppContent />
      <ThemeToggle />
    </AuthProvider>
  )
}
