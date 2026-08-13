import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { homeFor } from './authRoute'
import { supabaseConfigured } from './supabase'

/**
 * Send somebody who does not belong on this screen somewhere that they do.
 *
 * THIS IS SIGNAGE, NOT SECURITY. Every table these portals read is governed by
 * RLS written against `current_coach_slug()` and `is_axis_admin()`, and an
 * athlete who ignores this and forces the route still sees nothing. What the
 * guard buys is the difference between "nothing" and "an explanation" — before
 * profiles existed, both portals gated on the SESSION alone, so any signed-in
 * person reaching /admin got the full chrome wrapped around a dozen silently
 * empty panels.
 *
 * `replace` rather than `assign`, so Back does not bounce them straight into
 * the screen they were just turned away from.
 */
export function useRequireRole(opts: {
  /** Skip entirely — demo mode is not signed in and is not meant to be. */
  skip?: boolean
  /** Which coach's portal this is. Undefined = the master admin. */
  coachSlug?: string
}): void {
  const { profile, loading, isSignedIn, isAdmin } = useAuth()
  const { skip = false, coachSlug } = opts

  useEffect(() => {
    // No backend at all: the portals run their own demo path and there is no
    // profile to check against.
    if (skip || !supabaseConfigured) return
    // Not signed in is the login screen's business, not ours — both portals
    // already render one, and redirecting would take away the form.
    if (loading || !isSignedIn || !profile) return

    if (profile.status !== 'active') { window.location.replace(homeFor(profile)); return }

    // An admin goes anywhere. A coach goes to their own calendar and nowhere
    // else — `coach_slug` is what every per-coach policy since 002 resolves,
    // so a coach on somebody else's portal is a coach reading zero rows.
    const allowed = isAdmin || (coachSlug !== undefined && profile.coach_slug === coachSlug)
    if (!allowed) window.location.replace(homeFor(profile))
  }, [skip, loading, isSignedIn, profile, isAdmin, coachSlug])
}
