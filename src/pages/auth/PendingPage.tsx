import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { claimPendingInvite, signOut } from '../../lib/account'
import { homeFor } from '../../lib/authRoute'
import { href } from '../../utils/nav'
import { AuthShell, Notice, primaryButton, linkButton } from './AuthShell'

/**
 * Signed in, and not yet allowed in.
 *
 * This state exists because signup is open and admission is not: anyone may
 * create an account, and `handle_new_user` (011) parks it at `pending` unless an
 * invitation or the roster vouches for the address. Refusing the signup instead
 * would make the form an oracle for which addresses have been invited.
 *
 * So the honest thing is a screen that says so. It does three things:
 *
 *   1. Calls `claim_pending_invite()` on load. That closes the ordering gap the
 *      signup trigger cannot: an invitation issued AFTER the account was made is
 *      never looked at again by a trigger that fires once.
 *   2. Listens for their own profile row changing, through AuthContext's
 *      realtime subscription — so an admin activating them takes effect here
 *      without a reload.
 *   3. Offers "check again", because realtime is a convenience and a button
 *      that visibly does something is what people actually reach for.
 */
export default function PendingPage() {
  const { profile, loading, isActive, refresh } = useAuth()

  const [checking, setChecking] = useState(false)
  const [checkedOnce, setCheckedOnce] = useState(false)

  // The claim on load. Guarded to fire once — a pending account that has nothing
  // to claim would otherwise re-ask on every render the context triggers.
  useEffect(() => {
    if (loading || !profile || profile.status !== 'pending' || checkedOnce) return
    setCheckedOnce(true)
    void claimPendingInvite().then(changed => { if (changed) void refresh() })
  }, [loading, profile, checkedOnce, refresh])

  // Activated — by the claim, by an admin, or by an accepted application.
  useEffect(() => {
    if (isActive && profile) window.location.replace(homeFor(profile))
  }, [isActive, profile])

  if (loading) {
    return (
      <AuthShell title="One moment">
        <p style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>Checking your account…</p>
      </AuthShell>
    )
  }

  if (!profile) {
    return (
      <AuthShell eyebrow="Axis" title="Sign in">
        <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.7, marginBottom: '1.5rem' }}>
          You&rsquo;re not signed in.
        </p>
        <a href={href('/signin')} style={{ ...primaryButton(), display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          Go to sign in
        </a>
      </AuthShell>
    )
  }

  if (profile.status === 'suspended') {
    return (
      <AuthShell eyebrow="Account" title="Account suspended">
        <Notice tone="error">
          This account has been suspended. If you think that&rsquo;s a mistake, reply to any email
          from us and we&rsquo;ll sort it out.
        </Notice>
        <button style={primaryButton()} onClick={() => void signOut().then(() => window.location.replace(href('/')))}>
          Sign out
        </button>
      </AuthShell>
    )
  }

  const check = async () => {
    setChecking(true)
    const changed = await claimPendingInvite()
    await refresh()
    setChecking(false)
    // No message on the failure path beyond the screen already showing: if
    // nothing changed, the honest answer is the one they are already reading.
    if (changed && profile) window.location.replace(homeFor(profile))
  }

  return (
    <AuthShell
      eyebrow="Almost there"
      title="Waiting on approval"
      footer={
        <button style={linkButton()} onClick={() => void signOut().then(() => window.location.replace(href('/')))}>
          Sign out
        </button>
      }
    >
      <p style={{ color: 'var(--text-2)', fontSize: '.9rem', lineHeight: 1.75, marginBottom: '1.25rem' }}>
        Your account is created and signed in as <strong>{profile.email}</strong> — it just
        isn&rsquo;t open yet.
      </p>

      {/*
        Every claim here is one the system keeps. An accepted application really
        does open the account: the trigger in migration 013 fires on the leads
        row and either activates the profile directly or leaves an invitation
        that the next sign-in consumes. And this page really does notice —
        AuthContext subscribes to this one profile row.
      */}
      <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.75, marginBottom: '1.75rem' }}>
        Axis accounts are invitation-only. If you&rsquo;ve applied to work with a coach, your
        account opens the moment they accept — you don&rsquo;t need to do anything, and this page
        will move on by itself. If you were sent an invitation, make sure you signed in with
        the address it went to.
      </p>

      <button style={primaryButton(checking)} disabled={checking} onClick={check}>
        {checking ? 'Checking…' : 'Check again'}
      </button>

      <p style={{ color: 'var(--text-4)', fontSize: '.75rem', lineHeight: 1.7, marginTop: '1.5rem' }}>
        Haven&rsquo;t applied yet?{' '}
        <a href={href('/apply/ronnie-vallejo')} style={{ color: 'var(--text-3)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
          Start an application
        </a>
        {' '}— or{' '}
        <a href={href('/book')} style={{ color: 'var(--text-3)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
          book a call
        </a>
        , which you can do without an account.
      </p>
    </AuthShell>
  )
}
