import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import AdminLogin from './admin/AdminLogin'
import AdminSettings from './admin/AdminSettings'
import CRMPanel from './admin/CRMPanel'
import BlogPanel from './admin/BlogPanel'
import MeetsPanel from './admin/MeetsPanel'
import BookingsPanel from './admin/BookingsPanel'
import AnalyticsPanel from './admin/AnalyticsPanel'
import AvailabilityManager from './coach-admin/AvailabilityManager'
import { COACHES } from '../data/coaches'
import { getPendingContent } from '../data/pendingContent'

type Tab = 'crm' | 'bookings' | 'analytics' | 'blog' | 'meets' | 'availability' | 'settings'

export default function AdminPortal() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('crm')
  const [availCoach, setAvailCoach] = useState(COACHES[0].slug)
  const [isDemo, setIsDemo] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('demo') === '1'
  })

  useEffect(() => {
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

  if (loading && !isDemo) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#000000' }}>
      <p style={{ color: '#888888', fontSize: '.8rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
    </div>
  )

  if (!session && !isDemo) return <AdminLogin onDemo={() => setIsDemo(true)} />

  return (
    <div className="min-h-screen" style={{ background: '#000000', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <header style={{ background: '#000000', borderBottom: '1px solid #0d0d0d', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '2rem', flexShrink: 0 }}>
        <a href={(import.meta as any).env?.BASE_URL ?? '/'}>
          <img src={`${ (import.meta as any).env?.BASE_URL ?? '/'}logo.svg`} alt="Axis" style={{ height: 22, filter: 'brightness(0) invert(1)' }} />
        </a>
        <span style={{ color: '#888888', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.25em', textTransform: 'uppercase' }}>Admin</span>

        {/* Tabs */}
        <nav style={{ display: 'flex', gap: '1.5rem', marginLeft: '1rem' }}>
        {(['crm', 'bookings', 'analytics', 'blog', 'meets', 'availability', 'settings'] as Tab[]).map(t => {
              const pending = getPendingContent().filter(c => c.status === 'pending')
              const pendingCount = t === 'blog' ? pending.filter(c => c.type === 'blog').length : t === 'meets' ? pending.filter(c => c.type === 'meet').length : 0
              return (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: tab === t ? '#fff' : '#444',
                fontSize: '.7rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
                borderBottom: `2px solid ${tab === t ? '#c8102e' : 'transparent'}`,
                paddingBottom: '1px', transition: 'color .15s',
                display: 'flex', alignItems: 'center', gap: '.35rem',
              }}
              onMouseEnter={e => { if (tab !== t) e.currentTarget.style.color = '#888888' }}
              onMouseLeave={e => { if (tab !== t) e.currentTarget.style.color = '#c7c7c7' }}
            >
              {{ crm: 'CRM', bookings: 'Bookings', analytics: 'Analytics', blog: 'Blog', meets: 'Meets', availability: 'Availability', settings: 'Settings' }[t]}
              {pendingCount > 0 && (
                <span style={{ background: '#bfa162', color: '#fff', fontSize: '.5rem', fontWeight: 900, borderRadius: '10rem', padding: '.1rem .4rem', lineHeight: 1.4 }}>{pendingCount}</span>
              )}
            </button>
              )
            })}
        </nav>

        {/* Right side */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <span style={{ color: '#888888', fontSize: '.75rem' }}>
            {isDemo ? <span style={{ color: '#fff', fontWeight: 700, fontSize: '.7rem', letterSpacing: '.1em', textTransform: 'uppercase' }}>Demo Mode</span> : session?.user.email}
          </span>
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
        <h1 style={{ color: '#fff', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em' }}>
          {{ crm: 'CRM', bookings: 'Bookings', analytics: 'Analytics', blog: 'Blog', meets: 'Meet Listings', availability: 'Set Availability', settings: 'Settings' }[tab]}
        </h1>
      </div>

      {/* Content */}
      <main style={{ flex: 1, overflowX: 'auto' }}>
        {tab === 'crm'          && <CRMPanel isDemo={isDemo} />}
        {tab === 'bookings'     && <BookingsPanel isDemo={isDemo} />}
        {tab === 'analytics'    && <AnalyticsPanel isDemo={isDemo} />}
        {tab === 'blog'         && <BlogPanel isDemo={isDemo} />}
        {tab === 'meets'        && <MeetsPanel isDemo={isDemo} />}
        {tab === 'settings'     && <AdminSettings isDemo={isDemo} />}
        {tab === 'availability' && (
          <div style={{ padding: '2rem' }}>
            {/* Coach picker */}
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
              {COACHES.map(c => (
                <button
                  key={c.slug}
                  onClick={() => setAvailCoach(c.slug)}
                  style={{
                    background: availCoach === c.slug ? '#c8102e' : '#0d0d0d',
                    border: `1px solid ${availCoach === c.slug ? '#c8102e' : '#222222'}`,
                    color: availCoach === c.slug ? '#fff' : '#888888',
                    borderRadius: '.3rem', padding: '.5rem 1.1rem',
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
  )
}
