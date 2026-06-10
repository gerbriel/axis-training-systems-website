import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { getCoachBySlug } from '../data/coaches'
import { href, adminHref } from '../utils/nav'
import CoachAdminLogin from './coach-admin/CoachAdminLogin'
import CoachAdminDashboard from './coach-admin/CoachAdminDashboard'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

interface Props { slug: string }

export default function CoachAdmin({ slug }: Props) {
  const coach = getCoachBySlug(slug)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    if (isDemo) { setIsDemo(false); return }
    await supabase.auth.signOut()
    setSession(null)
  }

  if (!coach) {
    return (
      <div style={{ background: '#080808', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1.5rem' }}>
        <p style={{ color: '#e63e3e', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.3em', textTransform: 'uppercase' }}>404</p>
        <h1 style={{ color: '#fff', fontWeight: 900, fontSize: '1.5rem', textTransform: 'uppercase' }}>Coach Not Found</h1>
        <a href={adminHref()} style={{ color: '#555', fontSize: '.8rem', textDecoration: 'underline' }}>← Master Admin</a>
      </div>
    )
  }

  if (loading && !isDemo) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#080808' }}>
      <p style={{ color: '#333', fontSize: '.8rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
    </div>
  )

  // Auth check: must be logged in AND email must match coach
  const sessionEmailMatches = session?.user?.email?.toLowerCase() === coach.email.toLowerCase()
  const isAuthenticated = (session && sessionEmailMatches) || isDemo

  if (!isAuthenticated) {
    return (
      <CoachAdminLogin
        coach={coach}
        onDemo={() => setIsDemo(true)}
        sessionMismatch={!!(session && !sessionEmailMatches)}
        onSignOut={signOut}
      />
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#080808', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <header style={{ background: '#030303', borderBottom: '1px solid #141414', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem', flexShrink: 0 }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 22, filter: 'brightness(0) invert(1)' }} />
        </a>
        <span style={{ color: '#1a1a1a', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase' }}>Coach Portal</span>
        <span style={{ color: '#2a2a2a' }}>›</span>
        <span style={{ color: '#e63e3e', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase' }}>{coach.name}</span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          {isDemo && (
            <span style={{ color: '#f59e0b', fontWeight: 900, fontSize: '.65rem', letterSpacing: '.2em', textTransform: 'uppercase' }}>Demo Mode</span>
          )}
          {!isDemo && session && (
            <span style={{ color: '#333', fontSize: '.75rem' }}>{session.user.email}</span>
          )}
          <button
            onClick={signOut}
            style={{ background: 'none', border: '1px solid #1e1e1e', color: '#555', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .875rem', borderRadius: '.25rem', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#e63e3e'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#1e1e1e'}
          >
            {isDemo ? 'Exit Demo' : 'Sign Out'}
          </button>
        </div>
      </header>

      {/* Page header */}
      <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid #141414', background: '#0a0a0a' }}>
        <p style={{ color: '#e63e3e', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.25rem' }}>{coach.role}</p>
        <h1 style={{ color: '#fff', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em' }}>
          {coach.firstName}'s Leads
        </h1>
      </div>

      {/* Content */}
      <main style={{ flex: 1, overflowX: 'auto' }}>
        <CoachAdminDashboard coach={coach} isDemo={isDemo} />
      </main>
    </div>
  )
}
