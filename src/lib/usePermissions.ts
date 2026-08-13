import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, supabaseConfigured } from './supabase'
import { ROLE_DEFAULTS } from './userManagement'

/**
 * What the signed-in person may do, for the UI.
 *
 * THIS IS SIGNAGE. A permission decides which buttons render; the DATABASE
 * decides what a write does — migration 018 is where a permission starts
 * meaning something, and until a policy adopts one, granting it changes only
 * this hook's answer and nothing a person can actually do. So `can()` is for
 * hiding a control that would fail, never for protecting anything: a coach who
 * forges the request still meets the same RLS a hidden button was standing in
 * front of.
 *
 * It reads the whole effective set in one call rather than asking per key,
 * because a settings screen asks about a dozen permissions at once and a dozen
 * round trips to answer them is a dozen chances to render half-decided.
 */
export interface Permissions {
  /** True once the set is known — gate on this before trusting a `false`. */
  ready: boolean
  can: (key: string) => boolean
  /** The granted keys, for a screen that wants to enumerate rather than ask. */
  granted: Set<string>
}

export function usePermissions(): Permissions {
  const { profile, isAdmin } = useAuth()
  const [granted, setGranted] = useState<Set<string> | null>(null)

  const profileId = profile?.id ?? null
  const role = profile?.role ?? null

  useEffect(() => {
    let live = true

    // Demo / no backend: the demo portals run as an admin, so everything is on.
    // Returning an empty set here would hide every gated control in the demo,
    // which is the opposite of what a demo is for.
    if (!supabaseConfigured) { setGranted(new Set(['*'])); return }

    if (!profileId) { setGranted(new Set()); return }

    // An admin holds everything by definition — profile_has_permission
    // short-circuits on role='admin' in the database (016), so asking the server
    // is a round trip whose answer is already known. Mirror it exactly, or an
    // admin's screen flickers through a half-empty permission set on every load.
    if (isAdmin) { setGranted(new Set(['*'])); return }

    // A role default is knowable without a fetch too, and gives the UI a correct
    // first paint while the authoritative set (which includes per-person
    // overrides) is in flight. It is only ever a SUBSET of the truth, so it can
    // reveal a control late but never one that should have stayed hidden.
    if (role) setGranted(new Set(ROLE_DEFAULTS[role] ?? []))

    supabase
      .rpc('effective_permissions', { p_profile: profileId })
      .then(({ data, error }) => {
        if (!live) return
        // On a read failure keep the role-default first paint rather than
        // blanking the screen — the same "an outage is not an empty answer"
        // rule the rest of this codebase follows.
        if (error || !Array.isArray(data)) return
        const set = new Set<string>()
        for (const row of data as { permission: string; granted: boolean }[]) {
          if (row.granted) set.add(row.permission)
        }
        setGranted(set)
      })

    return () => { live = false }
  }, [supabaseConfigured, profileId, role, isAdmin])

  const can = useCallback(
    (key: string) => {
      if (!granted) return false
      return granted.has('*') || granted.has(key)
    },
    [granted]
  )

  return useMemo(
    () => ({ ready: granted !== null, can, granted: granted ?? new Set() }),
    [granted, can]
  )
}
