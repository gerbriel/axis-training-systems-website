import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COACHES } from '../../data/coaches'
import { adminHref } from '../../utils/nav'
import ForgotPasswordForm from '../../components/dashboard/ForgotPasswordForm'
import { ADMIN_LOGIN_SCOPE } from '../../lib/auth'
import { authMessage } from '../../lib/account'
import { sanitizeEmail, isRateLimited, recordFailedAttempt, clearRateLimit, formatLockRemaining } from '../../utils/sanitize'

const RL_SCOPE = ADMIN_LOGIN_SCOPE

interface Props { onDemo?: () => void }

export default function AdminLogin({ onDemo }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lockRemaining, setLockRemaining] = useState(0)
  const [forgot, setForgot] = useState(false)

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
        // authMessage, not err.message. Supabase distinguishes "Invalid login
        // credentials" from "Email not confirmed", and repeating that verbatim
        // tells an attacker which addresses have accounts — the exact oracle
        // account.ts:60-67 exists to close.
        setError(`${authMessage(err, 'Could not sign you in.')} (${result.attempts}/5 attempts)`)
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

        {forgot ? (
          <ForgotPasswordForm defaultEmail={email} onBack={() => setForgot(false)} />
        ) : (
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="field-label">Email</label>
            <input
              type="email" className="field" maxLength={254} placeholder="admin@axistrainingsystems.com"
              value={email} onChange={e => setEmail(e.target.value)} required
              autoComplete="email"
            />
          </div>
          <div>
            <label className="field-label">Password</label>
            <input
              type="password" className="field" placeholder="••••••••" maxLength={200}
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
            style={{ background: loading ? '#5c0e14' : '#c8102e', border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '1rem', borderRadius: '.25rem', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '.5rem', fontFamily: 'inherit' }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#a30d26' }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#c8102e' }}
          >
            {loading ? 'Signing In…' : 'Sign In'}
          </button>

          <button
            type="button" onClick={() => setForgot(true)}
            style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: '.75rem', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', padding: '.5rem' }}
          >
            Forgot password?
          </button>
        </form>
        )}

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

        {/* Coaches land here via the footer's Admin link, then fail to log in —
            their credentials only work on their own portal. Hand them there. */}
        <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '.25rem' }}>
          <p style={{ color: 'var(--text-3)', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Coach? Sign in at your own portal:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem .9rem' }}>
            {COACHES.map(c => (
              <a key={c.slug} href={adminHref(c.slug)} style={{ color: 'var(--text-2)', fontSize: '.8rem', textDecoration: 'underline', padding: '.25rem 0' }}>
                {c.firstName}
              </a>
            ))}
          </div>
        </div>

        <p style={{ color: 'var(--text-3)', fontSize: '.75rem', textAlign: 'center', marginTop: '1.5rem' }}>
          Admin access only.{' '}
          <a href={(import.meta as any).env?.BASE_URL ?? '/'} style={{ color: 'var(--text-2)', textDecoration: 'underline' }}>← Back to site</a>
        </p>
      </div>
    </div>
  )
}
