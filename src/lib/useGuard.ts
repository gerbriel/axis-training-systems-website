import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { homeFor } from './authRoute'
import { supabaseConfigured } from './supabase'
import type { Permissions } from './usePermissions'

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

/**
 * The same signage for a portal whose entry is a PERMISSION rather than a role.
 *
 * `useRequireRole` asks "does this person own this calendar", which is the right
 * question for /coach/<slug> and the wrong one for /admin: with no coachSlug it
 * resolves to `isAdmin` alone, so a head coach — a coach holding
 * `manage_permissions` plus whichever areas the admin delegated — was bounced
 * off the very screen those grants were made for. Nothing in the database said
 * so; the redirect did.
 *
 * Entry is now "an active coach holding at least one key that unlocks a tab".
 * Held as a separate hook rather than another optional field on
 * `useRequireRole`, because the two answer different questions and a guard that
 * means two things is a guard nobody reads twice.
 *
 * STILL SIGNAGE. Every panel behind this reads through RLS written against
 * `has_permission()`, so a coach who forces the route sees the tabs they hold
 * and empty panels behind the rest — which is what the tab filter in
 * AdminPortal exists to spare them.
 *
 * `permissions` is passed in rather than resolved here so the portal and the
 * guard share ONE `effective_permissions` round trip. Waiting on `settled` is
 * not cosmetic, and `ready` would not be enough: `ready` flips the moment the
 * role DEFAULT paints, and a head coach's entry comes from a per-person
 * override that only the server knows about, so deciding on the early set
 * would redirect exactly the person this hook was written for.
 */
export function useRequirePortalAccess(opts: {
  /** Skip entirely — demo mode is not signed in and is not meant to be. */
  skip?: boolean
  /** The portal's own `usePermissions()` result. */
  permissions: Permissions
  /** Every key that unlocks any tab here. Holding one is enough. */
  keys: readonly string[]
}): void {
  const { profile, loading, isSignedIn, isAdmin } = useAuth()
  const { skip = false, permissions, keys } = opts
  const { settled, can } = permissions

  useEffect(() => {
    if (skip || !supabaseConfigured) return
    if (loading || !isSignedIn || !profile) return
    if (!settled) return

    if (profile.status !== 'active') { window.location.replace(homeFor(profile)); return }

    // An admin goes anywhere (016 short-circuits every check on role='admin',
    // and usePermissions mirrors that with '*'). Everyone else needs a coach
    // account and one key.
    const allowed =
      isAdmin ||
      (profile.role === 'coach' && keys.some(k => can(k)))

    if (!allowed) window.location.replace(homeFor(profile))
  }, [skip, loading, isSignedIn, profile, isAdmin, settled, can, keys])
}
