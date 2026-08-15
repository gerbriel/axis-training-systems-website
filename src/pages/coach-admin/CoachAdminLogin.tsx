import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { CoachDisplay } from '../../lib/coachProfiles'
import { href } from '../../utils/nav'
import ForgotPasswordForm from '../../components/dashboard/ForgotPasswordForm'
import { coachLoginScope } from '../../lib/auth'
import { authMessage } from '../../lib/account'
import {
  isRateLimited, recordFailedAttempt, clearRateLimit, formatLockRemaining,
  sanitizeEmail, isValidEmail,
} from '../../utils/sanitize'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

interface Props {
  /**
   * Who the portal is for. `email` is a PREFILL and nothing more — the five
   * bundled coaches carry theirs, a coach provisioned from the admin has none
   * yet, and neither answer decides anything. What may be opened is
   * `profiles.coach_slug`, checked by the caller and by every policy since 002.
   */
  coach: CoachDisplay
  onDemo: () => void
  sessionMismatch?: boolean
  onSignOut?: () => void
}

export default function CoachAdminLogin({ coach, onDemo, sessionMismatch, onSignOut }: Props) {
  const rlScope = coachLoginScope(coach.slug)
  const [email, setEmail] = useState(coach.email)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(sessionMismatch
    ? coach.email
      ? `This portal is for ${coach.name} only. Please sign in with ${coach.email}.`
      : `This portal is for ${coach.name} only. Please sign in with their account.`
    : ''
  )
  const [lockRemaining, setLockRemaining] = useState(0)
  const [forgot, setForgot] = useState(false)

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
    const typed = sanitizeEmail(email)

    /**
     * A malformed address is not a failed attempt.
     *
     * The field was read-only for exactly one reason: it used to be editable
     * over a CLIENT-SIDE comparison against the static entry, so a typo burned
     * a lockout attempt against a check that never reached Supabase and three
     * fat-fingered emails locked a coach out for 15 minutes. The field is back
     * because a coach who is not in the bundle has no fixed address to fix it
     * to — and the trap is gone with it: every attempt that is counted is one
     * the auth server actually refused.
     */
    if (!typed || !isValidEmail(typed)) {
      setError('Enter the email address for your account.')
      return
    }

    setLoading(true)
    setError('')
    const { error: err } = await supabase.auth.signInWithPassword({ email: typed, password })
    if (err) {
      const result = recordFailedAttempt(rlScope)
      if (result.blocked) {
        setError(`Too many failed attempts. Locked for ${formatLockRemaining(result.lockedUntil! - Date.now())}.`)
      } else {
        // authMessage, not err.message — see AdminLogin. The provider's own
        // wording distinguishes "no such user" from "wrong password".
        setError(`${authMessage(err, 'Could not sign you in.')} (${result.attempts}/5 attempts)`)
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

        {forgot ? (
          /* A bundled coach has one valid address and it stays locked. A coach
             provisioned from the admin types theirs, and gets to correct it. */
          <ForgotPasswordForm
            defaultEmail={coach.email || email}
            lockEmail={!!coach.email}
            onBack={() => setForgot(false)}
          />
        ) : (
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="field-label" htmlFor="coach-email">Email</label>
            <input
              id="coach-email" type="email" className="field" maxLength={254}
              value={email} onChange={e => setEmail(e.target.value)} required
              placeholder="you@axistrainingsystems.com"
              autoComplete="username"
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
            style={{ background: loading || isBlocked ? '#5c0e14' : '#c8102e', border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '1rem', borderRadius: '.25rem', cursor: loading || isBlocked ? 'not-allowed' : 'pointer', marginTop: '.5rem', fontFamily: 'inherit' }}
          >
            {loading ? 'Signing In…' : 'Sign In'}
          </button>

          {/* The only way out of a forgotten password — without it, five wrong
              guesses meant a 15-minute lockout and a text to the owner. */}
          <button
            type="button" onClick={() => setForgot(true)}
            style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: '.75rem', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', padding: '.5rem' }}
          >
            Forgot password?
          </button>
        </form>
        )}

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
