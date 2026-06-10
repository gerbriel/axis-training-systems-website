import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import AdminLogin from './admin/AdminLogin'
import AdminDashboard from './admin/AdminDashboard'
import AdminSettings from './admin/AdminSettings'

type Tab = 'leads' | 'settings'

export default function AdminPortal() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('leads')
  const [isDemo, setIsDemo] = useState(false)

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
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#080808' }}>
      <p style={{ color: '#333', fontSize: '.8rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
    </div>
  )

  if (!session && !isDemo) return <AdminLogin onDemo={() => setIsDemo(true)} />

  return (
    <div className="min-h-screen" style={{ background: '#080808', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <header style={{ background: '#030303', borderBottom: '1px solid #141414', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '2rem', flexShrink: 0 }}>
        <a href={(import.meta as any).env?.BASE_URL ?? '/'}>
          <img src="/logo.svg" alt="Axis" style={{ height: 22, filter: 'brightness(0) invert(1)' }} />
        </a>
        <span style={{ color: '#222', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.25em', textTransform: 'uppercase' }}>Admin</span>

        {/* Tabs */}
        <nav style={{ display: 'flex', gap: '1.5rem', marginLeft: '1rem' }}>
          {(['leads', 'settings'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: tab === t ? '#fff' : '#444',
                fontSize: '.7rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
                borderBottom: `2px solid ${tab === t ? '#e63e3e' : 'transparent'}`,
                paddingBottom: '1px', transition: 'color .15s',
              }}
              onMouseEnter={e => { if (tab !== t) e.currentTarget.style.color = '#888' }}
              onMouseLeave={e => { if (tab !== t) e.currentTarget.style.color = '#444' }}
            >
              {t}
            </button>
          ))}
        </nav>

        {/* Right side */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <span style={{ color: '#333', fontSize: '.75rem' }}>
            {isDemo ? <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '.7rem', letterSpacing: '.1em', textTransform: 'uppercase' }}>Demo Mode</span> : session?.user.email}
          </span>
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
        <h1 style={{ color: '#fff', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em' }}>
          {tab === 'leads' ? 'Leads' : 'Settings'}
        </h1>
      </div>

      {/* Content */}
      <main style={{ flex: 1, overflowX: 'auto' }}>
        {tab === 'leads'    && <AdminDashboard isDemo={isDemo} />}
        {tab === 'settings' && <AdminSettings isDemo={isDemo} />}
      </main>
    </div>
  )
}
