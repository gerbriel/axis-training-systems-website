import { useEffect, useState } from 'react'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { updatePassword, clearLoginLockouts, MIN_PASSWORD_LENGTH } from '../lib/auth'
import { hasPasswordRecoveryGrant, endPasswordRecovery, urlLooksLikeRecoveryLink } from '../lib/recoveryUrl'
import { COACHES } from '../data/coaches'
import { href, adminHref } from '../utils/nav'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

/** The URL parse is local (implicit flow decodes the hash), but the session it
 *  produces is announced asynchronously. Generous, because the cost of being
 *  impatient is telling someone their valid link is broken. */
const SESSION_WAIT_MS = 10_000

type Phase = 'checking' | 'ready' | 'invalid' | 'not-recovery' | 'done'

/**
 * Where the emailed recovery link lands.
 *
 * supabase-js parses the token out of the URL on load (detectSessionInUrl is on
 * by default) and turns it into a session, announcing it as a PASSWORD_RECOVERY
 * event. That parse is asynchronous and can land either side of our first
 * render, so this waits on BOTH the event and a direct getSession() rather than
 * racing one of them.
 */
export default function ResetPassword() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!supabaseConfigured) { setPhase('invalid'); return }

    let settled = false
    const accept = (userEmail: string | undefined) => {
      if (settled) return
      settled = true
      setEmail(userEmail ?? null)
      setPhase('ready')
    }

    // Only the verified recovery grant opens this form. A session on its own
    // does NOT: an ordinary signed-in tab carries one, and accepting it would
    // let anyone at a shared machine change the coach's password.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') accept(session?.user.email)
    })

    // The grant may already have been recorded — the event fires during
    // supabase-js init, which can complete before React mounts this page, and
    // it is not re-emitted after a reload.
    if (hasPasswordRecoveryGrant()) {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) accept(data.session.user.email)
        else if (!settled) { settled = true; setPhase('invalid') }
      })
      return () => subscription.unsubscribe()
    }

    // No grant yet. If the URL doesn't even look like a recovery link, this is
    // someone who navigated here directly — say so instead of making them wait.
    if (!urlLooksLikeRecoveryLink) { setPhase('not-recovery'); return () => subscription.unsubscribe() }

    // It looks like a link, so give the token time to be verified. A forged
    // fragment ends up here too and simply times out: the grant never arrives.
    const timer = window.setTimeout(() => {
      if (!settled) { settled = true; setPhase('invalid') }
    }, SESSION_WAIT_MS)

    return () => { subscription.unsubscribe(); window.clearTimeout(timer) }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirm) { setError('The two passwords do not match.'); return }

    setSaving(true)
    const res = await updatePassword(password)
    setSaving(false)

    if (!res.ok) { setError(res.message); return }

    // The failed guesses that sent them here would otherwise still be holding
    // the login shut with a password that now works.
    clearLoginLockouts(email)
    // The grant is spent: a reload of this tab must not offer the form again.
    endPasswordRecovery()
    setPhase('done')
  }

  // Send the coach to their own portal, not the master admin login they cannot use.
  const coach = email ? COACHES.find(c => c.email.toLowerCase() === email.toLowerCase()) : undefined
  const destination = coach ? adminHref(coach.slug) : adminHref()

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div className="text-center mb-8">
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 28, filter: 'var(--logo-filter)', margin: '0 auto 1.5rem' }} />
          <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.5rem', textTransform: 'uppercase', letterSpacing: '-.02em' }}>Set a New Password</h1>
        </div>
        {children}
      </div>
    </div>
  )

  if (phase === 'checking') {
    return shell(
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', textAlign: 'center', letterSpacing: '.15em', textTransform: 'uppercase' }}>Checking your link…</p>
    )
  }

  // Reached without following a recovery link — including by an already
  // signed-in coach. Deliberately offers no password form.
  if (phase === 'not-recovery') {
    return shell(
      <div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '1rem 1.25rem', borderRadius: '.25rem', marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.6 }}>
            This page only works from the reset link we email you. Start a reset from the sign-in screen and we'll send you one.
          </p>
        </div>
        <a
          href={adminHref()}
          style={{ display: 'block', textAlign: 'center', background: '#c8102e', border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '1rem', borderRadius: '.25rem', textDecoration: 'none' }}
        >
          Go to sign in →
        </a>
      </div>
    )
  }

  if (phase === 'invalid') {
    return shell(
      <div>
        <div style={{ background: '#1a0309', border: '1px solid #2d0810', padding: '1rem 1.25rem', borderRadius: '.25rem', marginBottom: '1.5rem' }}>
          <p style={{ color: '#f87171', fontSize: '.8rem', lineHeight: 1.6 }}>
            {supabaseConfigured
              ? 'This reset link is invalid or has expired. Reset links can only be used once, and they expire after an hour.'
              : 'Password reset is unavailable in preview mode.'}
          </p>
        </div>
        <a
          href={adminHref()}
          style={{ display: 'block', textAlign: 'center', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)', fontWeight: 700, fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '.875rem', borderRadius: '.25rem', textDecoration: 'none' }}
        >
          Request a new link
        </a>
      </div>
    )
  }

  if (phase === 'done') {
    return shell(
      <div>
        <div style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.35)', padding: '1rem 1.25rem', borderRadius: '.25rem', marginBottom: '1.5rem' }}>
          <p style={{ color: '#22c55e', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Password updated</p>
          <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.6 }}>
            You're signed in{coach ? ` as ${coach.name}` : ''}. Use your new password next time.
          </p>
        </div>
        <a
          href={destination}
          style={{ display: 'block', textAlign: 'center', background: '#c8102e', border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '1rem', borderRadius: '.25rem', textDecoration: 'none' }}
        >
          {coach ? 'Go to your portal →' : 'Go to admin →'}
        </a>
      </div>
    )
  }

  return shell(
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {email && (
        <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.6 }}>
          Setting a new password for <strong style={{ color: 'var(--text)' }}>{email}</strong>.
        </p>
      )}

      <div>
        <label className="field-label">New Password</label>
        <input
          type="password" className="field" required minLength={MIN_PASSWORD_LENGTH}
          placeholder="••••••••" autoComplete="new-password"
          value={password} onChange={e => setPassword(e.target.value)}
        />
        <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.4rem' }}>At least {MIN_PASSWORD_LENGTH} characters.</p>
      </div>

      <div>
        <label className="field-label">Confirm Password</label>
        <input
          type="password" className="field" required minLength={MIN_PASSWORD_LENGTH}
          placeholder="••••••••" autoComplete="new-password"
          value={confirm} onChange={e => setConfirm(e.target.value)}
        />
      </div>

      {error && (
        <div style={{ background: '#1a0309', border: '1px solid #2d0810', padding: '.875rem 1rem', borderRadius: '.25rem', color: '#f87171', fontSize: '.8rem' }}>
          {error}
        </div>
      )}

      <button
        type="submit" disabled={saving}
        style={{ background: saving ? '#5c0e14' : '#c8102e', border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '1rem', borderRadius: '.25rem', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', marginTop: '.5rem' }}
      >
        {saving ? 'Saving…' : 'Update Password'}
      </button>

      <a href={href('/')} style={{ color: 'var(--text-3)', fontSize: '.75rem', textAlign: 'center', textDecoration: 'underline', marginTop: '.5rem' }}>← Back to site</a>
    </form>
  )
}
