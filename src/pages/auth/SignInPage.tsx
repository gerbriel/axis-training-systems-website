import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  signInWithGoogle, signInWithPassword, signUpWithPassword, sendMagicLink,
  MIN_PASSWORD_LENGTH,
} from '../../lib/account'
import { sendPasswordReset } from '../../lib/auth'
import { homeFor, safeNext } from '../../lib/authRoute'
import { href } from '../../utils/nav'
import { AuthShell, Notice, GoogleButton, Divider, primaryButton, linkButton } from './AuthShell'

type Mode = 'signin' | 'signup' | 'magic' | 'reset'

const TITLES: Record<Mode, { eyebrow: string; title: string }> = {
  signin: { eyebrow: 'Axis', title: 'Sign in' },
  signup: { eyebrow: 'Axis', title: 'Create your account' },
  magic:  { eyebrow: 'Axis', title: 'Email me a link' },
  reset:  { eyebrow: 'Axis', title: 'Reset your password' },
}

export default function SignInPage() {
  const { session, profile, loading } = useAuth()

  const params = new URLSearchParams(window.location.search)
  const next = safeNext(params.get('next'))

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  /**
   * Somebody already signed in has no business on this page. Sent onward by
   * `homeFor`, which knows the difference between an active coach and a pending
   * athlete — the second lands on /pending rather than a portal full of
   * permission errors.
   */
  useEffect(() => {
    if (loading || !session) return
    window.location.replace(next ?? homeFor(profile))
  }, [loading, session, profile, next])

  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>, onOk?: () => void) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setSent(null)
    const res = await fn()
    setBusy(false)
    if (!res.ok) { setError(res.message ?? 'Something went wrong.'); return }
    onOk?.()
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'signin') {
      // No redirect here: the effect above fires as soon as the session lands,
      // and it knows where this person actually belongs.
      void run(() => signInWithPassword(email, password))
    } else if (mode === 'signup') {
      void run(
        () => signUpWithPassword(email, password, name),
        () => setSent('Check your inbox to confirm your address, then come back and sign in.')
      )
    } else if (mode === 'magic') {
      void run(
        () => sendMagicLink(email, next ?? undefined),
        () => setSent('If that address has an account, a sign-in link is on its way. It expires in an hour.')
      )
    } else {
      void run(
        () => sendPasswordReset(email),
        () => setSent('If that address has an account, a reset link is on its way.')
      )
    }
  }

  const { eyebrow, title } = TITLES[mode]

  return (
    <AuthShell
      eyebrow={eyebrow}
      title={title}
      footer={
        <p style={{ color: 'var(--text-4)', fontSize: '.75rem', lineHeight: 1.7 }}>
          Axis accounts are invitation-only. If you haven&rsquo;t been invited yet,{' '}
          <a href={href('/apply/ronnie-vallejo')} style={{ color: 'var(--text-2)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            apply to work with a coach
          </a>{' '}
          and we&rsquo;ll be in touch.
        </p>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {sent && <Notice tone="ok">{sent}</Notice>}

      {mode !== 'reset' && (
        <>
          <GoogleButton
            onClick={() => void run(() => signInWithGoogle(next ?? undefined))}
            disabled={busy}
            label={mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
          />
          <Divider>or</Divider>
        </>
      )}

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {mode === 'signup' && (
          <div>
            <label className="field-label" htmlFor="au-name">Your name</label>
            <input
              id="au-name" className="field" value={name} maxLength={120} required
              autoComplete="name" onChange={e => setName(e.target.value)}
            />
          </div>
        )}

        <div>
          <label className="field-label" htmlFor="au-email">Email</label>
          <input
            id="au-email" className="field" type="email" value={email} maxLength={254} required
            autoComplete="email" onChange={e => setEmail(e.target.value)}
          />
        </div>

        {(mode === 'signin' || mode === 'signup') && (
          <div>
            <label className="field-label" htmlFor="au-password">Password</label>
            <input
              id="au-password" className="field" type="password" value={password} required
              minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              onChange={e => setPassword(e.target.value)}
            />
            {mode === 'signup' && (
              <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.4rem' }}>
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            )}
          </div>
        )}

        <button type="submit" disabled={busy} style={{ ...primaryButton(busy), marginTop: '.25rem' }}>
          {busy ? 'Working…' : {
            signin: 'Sign in',
            signup: 'Create account',
            magic:  'Send me a link',
            reset:  'Send reset link',
          }[mode]}
        </button>
      </form>

      {/* Mode switching. Every one of these clears the transient state — an error
          about a wrong password has nothing to say about the reset form. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem', marginTop: '1.5rem', alignItems: 'flex-start' }}>
        {mode === 'signin' && (
          <>
            <button style={linkButton()} onClick={() => { setMode('magic'); setError(null); setSent(null) }}>
              Email me a sign-in link instead
            </button>
            <button style={linkButton()} onClick={() => { setMode('reset'); setError(null); setSent(null) }}>
              Forgot your password?
            </button>
            <button style={linkButton()} onClick={() => { setMode('signup'); setError(null); setSent(null) }}>
              Been invited? Create your account
            </button>
          </>
        )}
        {mode !== 'signin' && (
          <button style={linkButton()} onClick={() => { setMode('signin'); setError(null); setSent(null) }}>
            ← Back to sign in
          </button>
        )}
      </div>
    </AuthShell>
  )
}
