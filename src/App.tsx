import { useState, useEffect } from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Philosophy from './components/Philosophy'
import PhotoStrip from './components/PhotoStrip'
import Services from './components/Services'
import HowItWorks from './components/HowItWorks'
import Testimonials from './components/Testimonials'
import Tools from './components/Tools'
import Coaches from './components/Coaches'
import Apply from './components/Apply'
import Footer from './components/Footer'
import PrivacyPolicy from './components/PrivacyPolicy'
import AdminPortal from './pages/AdminPortal'
import CoachPage from './pages/CoachPage'
import ApplyPage from './pages/ApplyPage'
import CoachAdmin from './pages/CoachAdmin'

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

  return { type: 'home' }
}

const route = getRoute()

export default function App() {
  if (route.type === 'coach-admin') return <CoachAdmin slug={route.slug!} />
  if (route.type === 'admin') return <AdminPortal />
  if (route.type === 'coach') return <CoachPage slug={route.slug!} />
  if (route.type === 'apply') return <ApplyPage slug={route.slug!} />

  // ── Home ──────────────────────────────────────────────────────────────────
  const [showPrivacy, setShowPrivacy] = useState(false)

  useEffect(() => {
    const handler = () => setShowPrivacy(true)
    window.addEventListener('open-privacy', handler)
    return () => window.removeEventListener('open-privacy', handler)
  }, [])

  return (
    <div style={{ background: '#080808', minHeight: '100vh' }}>
      <Navbar />
      <Hero />
      <Philosophy />
      <PhotoStrip />
      <Services />
      <HowItWorks />
      <Testimonials />
      <Tools />
      <Coaches />
      <Apply />
      <Footer />
      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
    </div>
  )
}
