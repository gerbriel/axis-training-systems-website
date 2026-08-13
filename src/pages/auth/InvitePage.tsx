import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  previewInvitation, claimInvitationToken, claimMessage,
  signInWithGoogle, sendMagicLink, signOut,
} from '../../lib/account'
import type { InvitationPreview, ClaimResult } from '../../lib/account'
import { homeFor } from '../../lib/authRoute'
import { href } from '../../utils/nav'
import { AuthShell, Notice, GoogleButton, Divider, primaryButton, linkButton, ACCENT } from './AuthShell'

const ROLE_COPY: Record<InvitationPreview['role'], string> = {
  athlete: 'as an athlete',
  coach:   'as a coach',
  admin:   'as an administrator',
}

/**
 * The landing page for an invitation link.
 *
 * It exists for one reason the email match cannot cover: to SAY WHO INVITED YOU
 * before you hand over an identity. "Ronnie invited you to coach at Axis" is a
 * different proposition from an unexplained sign-in box, and on an invite-only
 * site the unexplained box is the one people bounce off.
 *
 * The claim itself is mostly redundant, and that is by design. Signing in with
 * the invited address activates the account through `handle_new_user` (011)
 * whether or not this page is ever opened. What the token adds is the preview
 * above, and one precise refusal below: signed in as the wrong person, this can
 * say which address the invitation was actually for.
 */
export default function InvitePage({ token }: { token: string }) {
  const { session, profile, loading: authLoading, refresh } = useAuth()

  const [invite, setInvite] = useState<InvitationPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [claim, setClaim] = useState<ClaimResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [magicSent, setMagicSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    previewInvitation(token).then(res => {
      if (!live) return
      setInvite(res)
      setLoading(false)
    })
    return () => { live = false }
  }, [token])

  /**
   * Redeem as soon as somebody is signed in and the invitation is still live.
   *
   * Runs for an ALREADY-ACTIVE account too, and returns 'already_active' — which
   * is not a failure and is not shown as one. It is the ordinary path: they
   * signed up with the invited address, the trigger let them in, and by the time
   * they got back here there was nothing left to do.
   */
  const attempt = useCallback(async () => {
    if (!session || busy) return
    setBusy(true)
    const result = await claimInvitationToken(token)
    setClaim(result)
    if (result === 'claimed') await refresh()
    setBusy(false)
  }, [session, busy, token, refresh])

  useEffect(() => {
    if (authLoading || loading || !session || claim) return
    if (invite && invite.status !== 'pending') return
    void attempt()
  }, [authLoading, loading, session, claim, invite, attempt])

  // ── Nothing behind the link ───────────────────────────────────────────────
  if (loading || authLoading) {
    return (
      <AuthShell title="One moment">
        <p style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>Checking your invitation…</p>
      </AuthShell>
    )
  }

  if (!invite) {
    return (
      <AuthShell eyebrow="Invitation" title="This link isn’t valid">
        <Notice tone="error">
          We couldn’t find an invitation for this link. It may have been superseded by a newer
          one — issuing a new invitation cancels the old link.
        </Notice>
        <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.7 }}>
          Ask whoever invited you to send another, or{' '}
          <a href={href('/signin')} style={{ color: 'var(--text-2)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            sign in
          </a>{' '}
          if you already have an account.
        </p>
      </AuthShell>
    )
  }

  if (invite.status !== 'pending') {
    const copy = {
      accepted: 'This invitation has already been used. If that was you, just sign in.',
      revoked:  'This invitation was revoked. Ask whoever sent it for a new one.',
      expired:  'This invitation has expired. Ask whoever sent it for a new one.',
      pending:  '',
    }[invite.status]

    return (
      <AuthShell eyebrow="Invitation" title={invite.status === 'accepted' ? 'Already claimed' : 'No longer valid'}>
        <Notice tone={invite.status === 'accepted' ? 'info' : 'error'}>{copy}</Notice>
        <a href={href('/signin')} style={{ ...primaryButton(), display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          Go to sign in
        </a>
      </AuthShell>
    )
  }

  // ── Claimed ───────────────────────────────────────────────────────────────
  if (claim === 'claimed' || claim === 'already_active' || claim === 'already_yours') {
    return (
      <AuthShell eyebrow="Welcome" title="You’re in">
        <Notice tone="ok">
          Your account is set up{invite.role !== 'athlete' ? ` ${ROLE_COPY[invite.role]}` : ''}.
        </Notice>
        <a href={homeFor(profile)} style={{ ...primaryButton(), display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          Continue →
        </a>
      </AuthShell>
    )
  }

  // ── Signed in as somebody else ────────────────────────────────────────────
  // The one thing the email match genuinely cannot do: explain itself. An
  // invitation is not transferable, so this refuses — and says which address to
  // use, masked, so it is recognisable without being readable off the screen.
  if (claim === 'wrong_email') {
    return (
      <AuthShell eyebrow="Invitation" title="Wrong account">
        <Notice tone="error">{claimMessage('wrong_email', invite.email)}</Notice>
        <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.7, marginBottom: '1.5rem' }}>
          You’re currently signed in as {profile?.email ?? 'someone else'}.
        </p>
        <button
          style={primaryButton(busy)}
          disabled={busy}
          onClick={async () => { setBusy(true); await signOut(); window.location.reload() }}
        >
          Sign out and try again
        </button>
      </AuthShell>
    )
  }

  if (claim && claim !== 'not_signed_in') {
    return (
      <AuthShell eyebrow="Invitation" title="We hit a snag">
        <Notice tone="error">{claimMessage(claim, invite.email)}</Notice>
        <a href={href('/signin')} style={{ ...primaryButton(), display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          Go to sign in
        </a>
      </AuthShell>
    )
  }

  // ── The invitation, and the ways in ───────────────────────────────────────
  const inviteHref = `/invite/${token}`

  return (
    <AuthShell
      eyebrow="You’re invited"
      title={invite.firstName ? `Welcome, ${invite.firstName}` : 'Welcome to Axis'}
    >
      <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderLeft: `3px solid ${ACCENT}`, borderRadius: '.25rem', padding: '1.25rem', marginBottom: '1.75rem' }}>
        <p style={{ color: 'var(--text)', fontSize: '.9rem', lineHeight: 1.7 }}>
          <strong>{invite.invitedByName ?? 'Axis Training Systems'}</strong> invited you to join{' '}
          {ROLE_COPY[invite.role]}
          {invite.coachSlug ? ` on the ${invite.coachSlug.replace(/-/g, ' ')} calendar` : ''}.
        </p>
        {invite.note && (
          <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.65, marginTop: '.75rem', fontStyle: 'italic' }}>
            “{invite.note}”
          </p>
        )}
        <p style={{ color: 'var(--text-4)', fontSize: '.75rem', marginTop: '.9rem' }}>
          Sent to {invite.email}
        </p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {magicSent && (
        <Notice tone="ok">
          Link sent to {invite.email}. Open it on this device and you’ll be signed straight in.
        </Notice>
      )}

      {/* The address is fixed and shown, not typed. Whoever holds this link was
          invited at ONE address, and letting them type another only produces the
          "wrong account" screen above a minute later. */}
      <GoogleButton
        onClick={async () => {
          setError(null)
          const res = await signInWithGoogle(inviteHref)
          if (!res.ok) setError(res.message)
        }}
        disabled={busy}
        label="Continue with Google"
      />

      <Divider>or</Divider>

      <button
        style={primaryButton(busy || magicSent)}
        disabled={busy || magicSent}
        onClick={async () => {
          setBusy(true)
          setError(null)
          const res = await sendMagicLink(invite.email, inviteHref)
          setBusy(false)
          if (res.ok) setMagicSent(true)
          else setError(res.message)
        }}
      >
        {magicSent ? 'Link sent' : `Email a link to ${invite.email}`}
      </button>

      <div style={{ marginTop: '1.25rem' }}>
        <a href={`${href('/signin')}?mode=signup&next=${encodeURIComponent(inviteHref)}`} style={linkButton()}>
          I’d rather set a password
        </a>
      </div>

      <p style={{ color: 'var(--text-4)', fontSize: '.72rem', lineHeight: 1.65, marginTop: '1.5rem' }}>
        Whichever you choose, use <strong style={{ color: 'var(--text-3)' }}>{invite.email}</strong> — that’s
        the address this invitation was issued to, and it’s what lets you in.
      </p>
    </AuthShell>
  )
}
