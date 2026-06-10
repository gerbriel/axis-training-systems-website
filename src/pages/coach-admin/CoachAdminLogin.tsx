import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Coach } from '../../data/coaches'
import { href } from '../../utils/nav'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

interface Props {
  coach: Coach
  onDemo: () => void
  sessionMismatch?: boolean
  onSignOut?: () => void
}

export default function CoachAdminLogin({ coach, onDemo, sessionMismatch, onSignOut }: Props) {
  const [email, setEmail] = useState(coach.email)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(sessionMismatch
    ? `This portal is for ${coach.name} only. Please sign in with ${coach.email}.`
    : ''
  )

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    if (email.toLowerCase() !== coach.email.toLowerCase()) {
      setError(`This portal is for ${coach.name} only (${coach.email}).`)
      setLoading(false)
      return
    }
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) setError(err.message)
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#080808' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div className="text-center mb-8">
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 28, filter: 'brightness(0) invert(1)', margin: '0 auto 1.5rem' }} />
          <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.25rem' }}>Coach Portal</p>
          <h1 style={{ color: '#fff', fontWeight: 900, fontSize: '1.75rem', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '.5rem' }}>{coach.name}</h1>
          <p style={{ color: '#333', fontSize: '.75rem' }}>{coach.role}</p>
        </div>

        {sessionMismatch && onSignOut && (
          <div style={{ background: '#1a0808', border: '1px solid #4a1515', padding: '.875rem 1rem', borderRadius: '.25rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
            <p style={{ color: '#f87171', fontSize: '.8rem' }}>You're signed in with a different account.</p>
            <button
              onClick={onSignOut}
              style={{ background: 'none', border: '1px solid #4a1515', color: '#f87171', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.3rem .75rem', borderRadius: '.2rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Sign Out
            </button>
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="field-label">Email</label>
            <input
              type="email" className="field" placeholder={coach.email}
              value={email} onChange={e => setEmail(e.target.value)} required
              autoComplete="email"
            />
          </div>
          <div>
            <label className="field-label">Password</label>
            <input
              type="password" className="field" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)} required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div style={{ background: '#1a0808', border: '1px solid #4a1515', padding: '.875rem 1rem', borderRadius: '.25rem', color: '#f87171', fontSize: '.8rem' }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            style={{ background: loading ? '#7a1f1f' : '#e63e3e', border: 'none', color: '#fff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '1rem', borderRadius: '.25rem', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '.5rem' }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#c42e2e' }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#e63e3e' }}
          >
            {loading ? 'Signing In…' : 'Sign In'}
          </button>
        </form>

        {/* Demo button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '1.5rem 0' }}>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #1a1a1a' }} />
          <span style={{ color: '#2e2e2e', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>or</span>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #1a1a1a' }} />
        </div>
        <button
          type="button" onClick={onDemo}
          style={{ width: '100%', background: 'transparent', border: '1px solid #1e1e1e', color: '#666', fontWeight: 700, fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '.875rem', borderRadius: '.25rem', cursor: 'pointer', transition: 'border-color .15s, color .15s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.color = '#aaa' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e1e1e'; e.currentTarget.style.color = '#666' }}
        >
          View Demo →
        </button>

        <p style={{ color: '#222', fontSize: '.75rem', textAlign: 'center', marginTop: '2rem', lineHeight: 1.6 }}>
          This portal is for {coach.name} only.{' '}
          <a href={href('/')} style={{ color: '#333', textDecoration: 'underline' }}>← Back to site</a>
        </p>
      </div>
    </div>
  )
}
