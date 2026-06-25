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
import AdminPortal from './pages/AdminPortal'
import CoachPage from './pages/CoachPage'
import ApplyPage from './pages/ApplyPage'
import CoachAdmin from './pages/CoachAdmin'
import BlogIndex from './pages/BlogIndex'
import BlogPostPage from './pages/BlogPostPage'
import GuidesPage from './pages/GuidesPage'
import Rankings from './pages/Rankings'
import BookPage from './pages/BookPage'
import { trackPageview } from './lib/analytics'
import { href } from './utils/nav'

// Apply saved theme before first paint to prevent flash
try {
  if (localStorage.getItem('axis-theme') === 'light') {
    document.documentElement.classList.add('light')
  }
} catch {}

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
        border: '1px solid rgba(245,185,53,.35)',
        borderRadius: '.4rem',
        color: 'rgba(245,185,53,.9)',
        cursor: 'pointer',
        boxShadow: '0 4px 20px rgba(0,0,0,.4)',
        transition: 'background .15s, border-color .15s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(245,185,53,.7)'; e.currentTarget.style.background = 'var(--bg)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(245,185,53,.35)'; e.currentTarget.style.background = 'var(--surface)' }}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

// ── Demo widget ────────────────────────────────────────────────────────────
function DemoWidget() {
  const [hovered, setHovered] = useState(false)
  return (
    <a
      href={href('/admin?demo=1')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999,
        display: 'flex', alignItems: 'center', gap: '.5rem',
        background: hovered ? 'var(--surface)' : '#0a0a0a',
        border: '1px solid rgba(245,185,53,.35)',
        borderRadius: '.4rem', padding: '.55rem 1rem',
        textDecoration: 'none', transition: 'background .15s, border-color .15s',
        boxShadow: '0 4px 20px rgba(0,0,0,.6)',
        ...(hovered ? { borderColor: 'rgba(245,185,53,.65)' } : {}),
      }}
    >
      <span style={{ fontSize: '.7rem', color: 'rgba(245,185,53,.8)', fontWeight: 900, letterSpacing: '.08em' }}>▶</span>
      <span style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase' }}>View Demo</span>
    </a>
  )
}

// ── Routing ────────────────────────────────────────────────────────────────
const base = ((import.meta as any).env?.BASE_URL ?? '/').replace(/\/$/, '')
const rawPath = window.location.pathname
const path = rawPath.startsWith(base) ? rawPath.slice(base.length) || '/' : rawPath

function getRoute() {
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
  if (path === '/rankings') return { type: 'rankings' }
  if (path === '/book') return { type: 'book' }
  return { type: 'home' }
}

const route = getRoute()
trackPageview(path || '/')

// ── Page content (routing) ─────────────────────────────────────────────────
function AppContent() {
  if (route.type === 'coach-admin') return <CoachAdmin slug={route.slug!} />
  if (route.type === 'admin') return <AdminPortal />
  if (route.type === 'coach') return <CoachPage slug={route.slug!} />
  if (route.type === 'apply') return <ApplyPage slug={route.slug!} />
  if (route.type === 'blog') return <BlogIndex />
  if (route.type === 'blog-post') return <BlogPostPage slug={route.slug!} />
  if (route.type === 'guides') return <GuidesPage />
  if (route.type === 'rankings') return <Rankings />
  if (route.type === 'book') return <BookPage />

  // ── Home ─────────────────────────────────────────────────────────────────
  const [showPrivacy, setShowPrivacy] = useState(false)

  useEffect(() => {
    const handler = () => setShowPrivacy(true)
    window.addEventListener('open-privacy', handler)
    return () => window.removeEventListener('open-privacy', handler)
  }, [])

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
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
    <>
      <AppContent />
      <ThemeToggle />
    </>
  )
}
