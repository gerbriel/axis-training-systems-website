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
        background: hovered ? '#111' : '#0a0a0a',
        border: '1px solid rgba(245,185,53,.35)',
        borderRadius: '.4rem', padding: '.55rem 1rem',
        textDecoration: 'none', transition: 'background .15s, border-color .15s',
        boxShadow: '0 4px 20px rgba(0,0,0,.6)',
        ...(hovered ? { borderColor: 'rgba(245,185,53,.65)' } : {}),
      }}
    >
      <span style={{ fontSize: '.7rem', color: 'rgba(245,185,53,.8)', fontWeight: 900, letterSpacing: '.08em' }}>▶</span>
      <span style={{ color: '#fff', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase' }}>View Demo</span>
    </a>
  )
}

// ── Routing ────────────────────────────────────────────────────────────────
// Strip BASE_URL prefix so we always work with a clean path like /coaches/slug
const base = ((import.meta as any).env?.BASE_URL ?? '/').replace(/\/$/, '')
const rawPath = window.location.pathname
const path = rawPath.startsWith(base) ? rawPath.slice(base.length) || '/' : rawPath

function getRoute() {
  // /admin/:slug  — per-coach admin
  const coachAdminMatch = path.match(/^\/admin\/([^/]+)/)
  if (coachAdminMatch) return { type: 'coach-admin', slug: coachAdminMatch[1] }

  // /admin — master admin
  if (path === '/admin' || path.startsWith('/admin/')) return { type: 'admin' }

  // /coaches/:slug
  const coachMatch = path.match(/^\/coaches\/([^/]+)/)
  if (coachMatch) return { type: 'coach', slug: coachMatch[1] }

  // /apply/:slug
  const applyMatch = path.match(/^\/apply\/([^/]+)/)
  if (applyMatch) return { type: 'apply', slug: applyMatch[1] }

  // /blog/:slug
  const blogPostMatch = path.match(/^\/blog\/([^/]+)/)
  if (blogPostMatch) return { type: 'blog-post', slug: blogPostMatch[1] }

  // /blog
  if (path === '/blog') return { type: 'blog' }

  // /guides
  if (path === '/guides') return { type: 'guides' }

  // /rankings
  if (path === '/rankings') return { type: 'rankings' }

  // /book
  if (path === '/book') return { type: 'book' }

  return { type: 'home' }
}

const route = getRoute()

// Track this page load
trackPageview(path || '/')

export default function App() {
  if (route.type === 'coach-admin') return <CoachAdmin slug={route.slug!} />
  if (route.type === 'admin') return <AdminPortal />
  if (route.type === 'coach') return <CoachPage slug={route.slug!} />
  if (route.type === 'apply') return <ApplyPage slug={route.slug!} />
  if (route.type === 'blog') return <BlogIndex />
  if (route.type === 'blog-post') return <BlogPostPage slug={route.slug!} />
  if (route.type === 'guides') return <GuidesPage />
  if (route.type === 'rankings') return <Rankings />
  if (route.type === 'book') return <BookPage />

  // ── Home ──────────────────────────────────────────────────────────────────
  const [showPrivacy, setShowPrivacy] = useState(false)

  useEffect(() => {
    const handler = () => setShowPrivacy(true)
    window.addEventListener('open-privacy', handler)
    return () => window.removeEventListener('open-privacy', handler)
  }, [])

  return (
    <div style={{ background: '#000000', minHeight: '100vh' }}>
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
