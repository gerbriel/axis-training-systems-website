import { useState } from 'react'
import { sendPasswordReset } from '../../lib/auth'

interface Props {
  /** Prefilled address. On a coach portal this is the only valid account. */
  defaultEmail: string
  /** Coach portals are single-account: the address is not the coach's to choose. */
  lockEmail?: boolean
  onBack: () => void
}

/**
 * The "forgot password" leg of both login screens. Shared rather than
 * duplicated because the two portals must not drift on the one flow a locked-out
 * coach will ever use.
 */
export default function ForgotPasswordForm({ defaultEmail, lockEmail = false, onBack }: Props) {
  const [email, setEmail] = useState(defaultEmail)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setError('')
    const res = await sendPasswordReset(email)
    setSending(false)
    if (res.ok) setSent(true)
    else setError(res.message)
  }

  if (sent) {
    return (
      <div>
        <div style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.35)', borderRadius: '.25rem', padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <p style={{ color: '#22c55e', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Check your email</p>
          <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.6 }}>
            If an account exists for <strong style={{ color: 'var(--text)' }}>{email}</strong>, a password reset link is on its way. The link expires in one hour.
          </p>
        </div>
        <button
          type="button" onClick={onBack}
          style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)', fontWeight: 700, fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '.875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          ← Back to sign in
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.6 }}>
        Enter your email and we'll send you a link to set a new password.
      </p>

      <div>
        <label className="field-label">Email</label>
        <input
          type="email" className="field" required maxLength={254}
          value={email}
          onChange={e => setEmail(e.target.value)}
          readOnly={lockEmail}
          autoComplete="email"
          style={lockEmail ? { color: 'var(--text-3)', cursor: 'not-allowed' } : undefined}
        />
      </div>

      {error && (
        <div style={{ background: '#1a0309', border: '1px solid #2d0810', padding: '.875rem 1rem', borderRadius: '.25rem', color: '#f87171', fontSize: '.8rem' }}>
          {error}
        </div>
      )}

      <button
        type="submit" disabled={sending}
        style={{ background: sending ? '#5c0e14' : '#c8102e', border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '1rem', borderRadius: '.25rem', cursor: sending ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
      >
        {sending ? 'Sending…' : 'Send Reset Link'}
      </button>

      <button
        type="button" onClick={onBack}
        style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: '.75rem', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', padding: '.5rem' }}
      >
        ← Back to sign in
      </button>
    </form>
  )
}
