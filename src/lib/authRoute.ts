import { href } from '../utils/nav'
import type { Profile } from './account'

/**
 * Where a signed-in person belongs.
 *
 * One function, because the answer is needed in four places — the callback
 * page, the sign-in page after a password, the invite page after a claim, and
 * the guards — and four copies of it would eventually disagree about where a
 * pending coach goes.
 *
 * The order of the tests is the whole logic:
 *
 *   status first. A suspended admin is not an admin, and a pending coach is not
 *   a coach. Sending somebody to a portal they cannot read produces an empty
 *   screen full of permission errors instead of the sentence explaining why.
 *
 *   role second, and staff before athlete, because an admin who is also a coach
 *   (Ronnie) should land in the admin portal rather than their own calendar.
 */
export function homeFor(profile: Profile | null): string {
  if (!profile) return href('/signin')

  if (profile.status !== 'active') return href('/pending')
  if (profile.role === 'admin') return href('/admin')
  if (profile.role === 'coach' && profile.coach_slug) return href(`/admin/${profile.coach_slug}`)
  return href('/account')
}

/**
 * Reads `?next=` and refuses anything that is not a path on this site.
 *
 * An unvalidated `next` is an open redirect, and an open redirect on a sign-in
 * page is a phishing primitive: the link genuinely is axistrainingsystems.com,
 * the sign-in genuinely is ours, and the landing afterwards is not.
 *
 * `//evil.com` is the case a naive `startsWith('/')` misses — browsers read it
 * as a protocol-relative absolute URL.
 */
export function safeNext(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  if (raw.includes('\\')) return null
  return raw
}
