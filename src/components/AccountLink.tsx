import { useAuth } from '../context/AuthContext'
import { homeFor } from '../lib/authRoute'
import { href } from '../utils/nav'

/**
 * The one entry point to an account from the public site.
 *
 * Three states, and it must not flicker between them: an invite-gated site
 * showing "Sign in" for half a second to somebody who is already signed in
 * reads as having been logged out, which is exactly the moment people go and
 * sign in again.
 *
 * So while the session is still resolving it renders NOTHING rather than a
 * guess. The gap is one paint on a warm session and the alternative is a wrong
 * answer.
 */
export default function AccountLink({ className, style }: {
  className?: string
  style?: React.CSSProperties
}) {
  const { loading, isSignedIn, profile } = useAuth()

  if (loading) return null

  const label = !isSignedIn
    ? 'Sign in'
    : profile?.status === 'active'
      ? (profile.role === 'athlete' ? 'My account' : 'Portal')
      // Signed in and not through the gate yet. Sending them to /pending is the
      // honest destination — homeFor knows that too, but naming the link
      // "Sign in" would be a lie and "My account" a bigger one.
      : 'Your status'

  return (
    <a href={isSignedIn ? homeFor(profile) : href('/signin')} className={className} style={style}>
      {label}
    </a>
  )
}
