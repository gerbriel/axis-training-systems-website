import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { getCoachBySlug } from '../data/coaches'
import { href, adminHref } from '../utils/nav'
import CoachAdminLogin from './coach-admin/CoachAdminLogin'
import CoachAdminDashboard from './coach-admin/CoachAdminDashboard'
import ContentPublisher from './coach-admin/ContentPublisher'
import AvailabilityManager from './coach-admin/AvailabilityManager'

type CoachTab = 'leads' | 'availability' | 'content'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

interface Props { slug: string }

export default function CoachAdmin({ slug }: Props) {
  const coach = getCoachBySlug(slug)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isDemo, setIsDemo] = useState(false)
  const [tab, setTab] = useState<CoachTab>('leads')

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
      <div style={{ background: '#000000', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1.5rem' }}>
        <p style={{ color: '#fff', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.3em', textTransform: 'uppercase' }}>404</p>
        <h1 style={{ color: '#fff', fontWeight: 900, fontSize: '1.5rem', textTransform: 'uppercase' }}>Coach Not Found</h1>
        <a href={adminHref()} style={{ color: '#c7c7c7', fontSize: '.8rem', textDecoration: 'underline' }}>← Master Admin</a>
      </div>
    )
  }

  if (loading && !isDemo) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#000000' }}>
      <p style={{ color: '#888888', fontSize: '.8rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
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
    <div className="min-h-screen" style={{ background: '#000000', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <header style={{ background: '#000000', borderBottom: '1px solid #0d0d0d', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem', flexShrink: 0 }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 22, filter: 'brightness(0) invert(1)' }} />
        </a>
        <span style={{ color: '#888888', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase' }}>Coach Portal</span>
        <span style={{ color: '#888888' }}>›</span>
        <span style={{ color: '#fff', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase' }}>{coach.name}</span>

        {/* Tabs */}
        <nav style={{ display: 'flex', gap: '1.5rem', marginLeft: '1rem' }}>
          {([['leads', 'Leads'], ['availability', 'Availability'], ['content', 'Publish Content']] as [CoachTab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: tab === t ? '#fff' : '#444',
                fontSize: '.7rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
                borderBottom: `2px solid ${tab === t ? '#c8102e' : 'transparent'}`,
                paddingBottom: '1px', transition: 'color .15s', fontFamily: 'inherit',
              }}
              onMouseEnter={e => { if (tab !== t) e.currentTarget.style.color = '#888888' }}
              onMouseLeave={e => { if (tab !== t) e.currentTarget.style.color = '#c7c7c7' }}
            >
              {label}
            </button>
          ))}
        </nav>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          {isDemo && (
            <span style={{ color: '#fff', fontWeight: 900, fontSize: '.65rem', letterSpacing: '.2em', textTransform: 'uppercase' }}>Demo Mode</span>
          )}
          {!isDemo && session && (
            <span style={{ color: '#888888', fontSize: '.75rem' }}>{session.user.email}</span>
          )}
          <button
            onClick={signOut}
            style={{ background: 'none', border: '1px solid #222222', color: '#c7c7c7', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .875rem', borderRadius: '.25rem', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#c8102e'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#222222'}
          >
            {isDemo ? 'Exit Demo' : 'Sign Out'}
          </button>
        </div>
      </header>

      {/* Page header */}
      <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid #0d0d0d', background: '#000000' }}>
        <p style={{ color: '#fff', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.25rem' }}>{coach.role}</p>
        <h1 style={{ color: '#fff', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em' }}>
          {{ leads: `${coach.firstName}'s Leads`, availability: 'Availability', content: 'Publish Content' }[tab]}
        </h1>
      </div>

      {/* Content */}
      <main style={{ flex: 1, overflowX: 'auto' }}>
        {tab === 'leads'        && <CoachAdminDashboard coach={coach} isDemo={isDemo} />}
        {tab === 'availability' && <AvailabilityManager coach={coach} isDemo={isDemo} />}
        {tab === 'content'      && <ContentPublisher coach={coach} isDemo={isDemo} />}
      </main>
    </div>
  )
}
