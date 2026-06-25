import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { Coach } from '../../data/coaches'
import { href } from '../../utils/nav'
import { sanitizeEmail, isRateLimited, recordFailedAttempt, clearRateLimit, formatLockRemaining } from '../../utils/sanitize'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

interface Props {
  coach: Coach
  onDemo: () => void
  sessionMismatch?: boolean
  onSignOut?: () => void
}

export default function CoachAdminLogin({ coach, onDemo, sessionMismatch, onSignOut }: Props) {
  const rlScope = `coach_login_${coach.slug}`
  const [email, setEmail] = useState(coach.email)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(sessionMismatch
    ? `This portal is for ${coach.name} only. Please sign in with ${coach.email}.`
    : ''
  )
  const [lockRemaining, setLockRemaining] = useState(0)

  useEffect(() => {
    const tick = () => {
      const { blocked, remainingMs } = isRateLimited(rlScope)
      setLockRemaining(blocked ? remainingMs : 0)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [rlScope])

  const isBlocked = lockRemaining > 0

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isBlocked) return
    setLoading(true)
    setError('')
    const cleanEmail = sanitizeEmail(email)
    if (cleanEmail.toLowerCase() !== coach.email.toLowerCase()) {
      recordFailedAttempt(rlScope)
      setError(`This portal is for ${coach.name} only (${coach.email}).`)
      setLoading(false)
      return
    }
    const { error: err } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
    if (err) {
      const result = recordFailedAttempt(rlScope)
      if (result.blocked) {
        setError(`Too many failed attempts. Locked for ${formatLockRemaining(result.lockedUntil! - Date.now())}.`)
      } else {
        setError(`${err.message} (${result.attempts}/5 attempts)`)
      }
    } else {
      clearRateLimit(rlScope)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div className="text-center mb-8">
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 28, filter: 'var(--logo-filter)', margin: '0 auto 1.5rem' }} />
          <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.25rem' }}>Coach Portal</p>
          <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.75rem', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '.5rem' }}>{coach.name}</h1>
          <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>{coach.role}</p>
        </div>

        {sessionMismatch && onSignOut && (
          <div style={{ background: '#1a0309', border: '1px solid #2d0810', padding: '.875rem 1rem', borderRadius: '.25rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
            <p style={{ color: '#f87171', fontSize: '.8rem' }}>You're signed in with a different account.</p>
            <button
              onClick={onSignOut}
              style={{ background: 'none', border: '1px solid #2d0810', color: '#f87171', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.3rem .75rem', borderRadius: '.2rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
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

          {isBlocked && (
            <div style={{ background: '#1a1600', border: '1px solid #5c4a00', padding: '.875rem 1rem', borderRadius: '.25rem', color: 'var(--text)', fontSize: '.8rem' }}>
              Too many failed attempts. Try again in {formatLockRemaining(lockRemaining)}.
            </div>
          )}
          {error && !isBlocked && (
            <div style={{ background: '#1a0309', border: '1px solid #2d0810', padding: '.875rem 1rem', borderRadius: '.25rem', color: '#f87171', fontSize: '.8rem' }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading || isBlocked}
            style={{ background: loading || isBlocked ? '#5c0e14' : '#c8102e', border: 'none', color: 'var(--text)', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '1rem', borderRadius: '.25rem', cursor: loading || isBlocked ? 'not-allowed' : 'pointer', marginTop: '.5rem' }}
            onMouseEnter={e => { if (!loading && !isBlocked) e.currentTarget.style.background = '#9a7c3a' }}
            onMouseLeave={e => { if (!loading && !isBlocked) e.currentTarget.style.background = '#bfa162' }}
          >
            {loading ? 'Signing In…' : 'Sign In'}
          </button>
        </form>

        {/* Demo button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '1.5rem 0' }}>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
          <span style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>or</span>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
        </div>
        <button
          type="button" onClick={onDemo}
          style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)', fontWeight: 700, fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '.875rem', borderRadius: '.25rem', cursor: 'pointer', transition: 'border-color .15s, color .15s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-dim)'; e.currentTarget.style.color = 'var(--text-dim)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
        >
          View Demo →
        </button>

        <p style={{ color: 'var(--text-3)', fontSize: '.75rem', textAlign: 'center', marginTop: '2rem', lineHeight: 1.6 }}>
          This portal is for {coach.name} only.{' '}
          <a href={href('/')} style={{ color: 'var(--text-3)', textDecoration: 'underline' }}>← Back to site</a>
        </p>
      </div>
    </div>
  )
}
