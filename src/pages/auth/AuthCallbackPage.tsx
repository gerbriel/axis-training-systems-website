import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { homeFor, safeNext } from '../../lib/authRoute'
import { href } from '../../utils/nav'
import { AuthShell, Notice, primaryButton } from './AuthShell'

/**
 * Where every provider comes back to.
 *
 * Google's redirect, the magic link and the signup confirmation all land here
 * with a `code` in the query string. supabase-js exchanges it for a session on
 * its own — `detectSessionInUrl` is on by default — so this page has no code to
 * write for that. What it has to do is WAIT for the exchange, then send the
 * person somewhere that makes sense for who they turned out to be.
 *
 * Without this page they would land on whatever URL the provider was told, with
 * a session that arrives a tick later, and a route guard that ran too early
 * would bounce them straight back to sign-in.
 *
 * Note the two failure modes it distinguishes. A provider that returns
 * `?error=` is one thing — the user declined the Google consent screen, say.
 * A callback that produces no session and no error is another, and it is nearly
 * always one cause: the redirect URL is not on the allow-list in the Supabase
 * dashboard, so the exchange never happened. Saying so beats a spinner.
 */
export default function AuthCallbackPage() {
  const { session, profile, loading } = useAuth()

  const params = new URLSearchParams(window.location.search)
  const next = safeNext(params.get('next'))
  const providerError = params.get('error_description') ?? params.get('error')

  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (providerError) return
    const timer = window.setTimeout(() => setTimedOut(true), 8_000)
    return () => window.clearTimeout(timer)
  }, [providerError])

  useEffect(() => {
    if (providerError || loading || !session) return
    // `next` carries an invite path when the sign-in started from one, so the
    // invitation page gets to run its claim and show who invited them rather
    // than dropping them at a portal with no explanation.
    window.location.replace(next ?? homeFor(profile))
  }, [providerError, loading, session, profile, next])

  if (providerError) {
    return (
      <AuthShell eyebrow="Sign in" title="That didn’t go through">
        <Notice tone="error">
          {/* The provider's own words, and they are safe to show: this string is
              about the sign-in attempt, not about whether an account exists. */}
          {providerError}
        </Notice>
        <a href={href('/signin')} style={{ ...primaryButton(), display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          Try again
        </a>
      </AuthShell>
    )
  }

  if (timedOut && !session) {
    return (
      <AuthShell eyebrow="Sign in" title="We didn’t get a session">
        <Notice tone="error">
          The sign-in came back but no session was created.
        </Notice>
        <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.7, marginBottom: '1.5rem' }}>
          This is nearly always one thing: this address isn’t on the redirect allow-list in
          Supabase (Authentication → URL Configuration). If you’re a visitor rather than the
          person who set this up, try signing in again.
        </p>
        <a href={href('/signin')} style={{ ...primaryButton(), display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          Back to sign in
        </a>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Signing you in">
      <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.7 }}>
        One moment…
      </p>
    </AuthShell>
  )
}
