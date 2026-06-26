import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { sanitizeEmail, isRateLimited, recordFailedAttempt, clearRateLimit, formatLockRemaining } from '../../utils/sanitize'

const RL_SCOPE = 'admin_login'

interface Props { onDemo?: () => void }

export default function AdminLogin({ onDemo }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lockRemaining, setLockRemaining] = useState(0)

  // Poll lockout countdown every second
  useEffect(() => {
    const tick = () => {
      const { blocked, remainingMs } = isRateLimited(RL_SCOPE)
      setLockRemaining(blocked ? remainingMs : 0)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const isBlocked = lockRemaining > 0

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isBlocked) return
    setLoading(true)
    setError('')
    const cleanEmail = sanitizeEmail(email)
    const { error: err } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
    if (err) {
      const result = recordFailedAttempt(RL_SCOPE)
      if (result.blocked) {
        setError(`Too many failed attempts. Locked for ${formatLockRemaining(result.lockedUntil! - Date.now())}.`)
      } else {
        setError(`${err.message} (${result.attempts}/5 attempts)`)
      }
    } else {
      clearRateLimit(RL_SCOPE)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div className="text-center mb-10">
          <img src={`${ (import.meta as any).env?.BASE_URL ?? '/'}logo.svg`} alt="Axis" style={{ height: 28, filter: 'var(--logo-filter)', margin: '0 auto 1.5rem' }} />
          <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Admin</p>
          <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.75rem', textTransform: 'uppercase', letterSpacing: '-.02em' }}>Sign In</h1>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="field-label">Email</label>
            <input
              type="email" className="field" placeholder="admin@axistrainingsystems.com"
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
            style={{ background: loading ? '#5c0e14' : '#c8102e', border: 'none', color: 'var(--text)', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '1rem', borderRadius: '.25rem', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '.5rem' }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#1a1f6b' }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#272C84' }}
          >
            {loading ? 'Signing In…' : 'Sign In'}
          </button>
        </form>

        {/* Demo mode button */}
        {onDemo && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '1.5rem 0' }}>
              <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
              <span style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>or</span>
              <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
            </div>
            <button
              type="button"
              onClick={onDemo}
              style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)', fontWeight: 700, fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '.875rem', borderRadius: '.25rem', cursor: 'pointer', transition: 'border-color .15s, color .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-dim)'; e.currentTarget.style.color = 'var(--text-dim)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
            >
              View Demo →
            </button>
          </>
        )}

        <p style={{ color: 'var(--text-3)', fontSize: '.75rem', textAlign: 'center', marginTop: '2rem' }}>
          Admin access only.{' '}
          <a href={(import.meta as any).env?.BASE_URL ?? '/'} style={{ color: 'var(--text-2)', textDecoration: 'underline' }}>← Back to site</a>
        </p>
      </div>
    </div>
  )
}
