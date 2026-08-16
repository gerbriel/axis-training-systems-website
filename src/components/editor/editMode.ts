import { useMemo } from 'react'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../lib/usePermissions'
import { supabaseConfigured } from '../../lib/supabase'
import { recordTargets, recordTarget } from '../../lib/editTargets'
import type { EditTargetKey } from './editKeys'

/**
 * editMode.ts
 *
 * Who is allowed to open the bar, and which of the things on this page they are
 * allowed to open.
 *
 * TWO CLASSES OF TARGET, ONE CLICK, TWO GATES. Site copy — the headline, the
 * service descriptions, the philosophy paragraphs — is text the bundle ships
 * and the database may override, and it is gated on `manage_content`. A record
 * — a blog post, a coach profile, a testimonial — is a row in a table that
 * already has a library, an admin panel and a permission of its own, and it
 * keeps that permission. A viewer who may edit copy but not blog posts sees a
 * dashed box around the headline and nothing around the blog cards, because a
 * control that renders over a write RLS will refuse is worse than no control.
 *
 * The permission belongs to the TARGET, never to the caller. Nothing here lets
 * a call site claim that manage_content covers a testimonial.
 *
 * THE GATE IS `loading` AND `ready`, NEVER `settled` ALONE. usePermissions
 * answers "empty, and settled" both for a real anonymous visitor and for a
 * signed-in person whose profile fetch is still in flight — it reads `profile`
 * from useAuth and cannot tell those apart. So this ANDs with AuthContext's
 * `loading` exactly as AdminPortal does, and watches `ready` rather than
 * `settled` because a control appearing a beat late is the direction this is
 * allowed to fail in.
 *
 * THIS IS SIGNAGE. docs/SECURITY.md: RLS is the boundary, the UI is the sign in
 * front of it. Everything below decides what renders and nothing below decides
 * what a write is permitted to do.
 */

/**
 * The permission behind every block of site copy.
 *
 * Migration 048 is the first policy anywhere to adopt this key. It is a COACH
 * ROLE DEFAULT (016), which is exactly what the owner meant by "coaches if they
 * have permissions to edit content" — and it means every coach can rewrite the
 * home page headline the day 048 runs.
 */
export const COPY_PERMISSION = 'manage_content'

/**
 * The current path with the deploy's base prefix removed.
 *
 * App.tsx computes this at module scope and does not export it, and importing
 * App.tsx from here would be a cycle. utils/nav.ts already duplicates `base`
 * for the same reason, so this is the second copy of three lines rather than
 * the first.
 */
export function currentPath(): string {
  const base = ((import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/').replace(/\/$/, '')
  const raw = window.location.pathname
  return raw.startsWith(base) ? raw.slice(base.length) || '/' : raw
}

/** The demo walk-through, addressed the way both dashboards address it. */
export function demoActive(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('demo') === '1'
  } catch {
    return false
  }
}

/**
 * Routes the bar stays off.
 *
 * The portal is where all of this already exists in full, with more room and
 * better controls; the auth screens are somebody signing in or being told they
 * cannot. Everything else is the public site, which is the whole point: the
 * owner asked to edit the page he is looking at.
 */
const CLOSED_PREFIXES = [
  '/admin',
  '/signin',
  '/login',
  '/auth/',
  '/invite/',
  '/reset-password',
  '/pending',
  '/account',
  '/messages',
]

export function isEditableRoute(path = currentPath()): boolean {
  return !CLOSED_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))
}

export interface EditAccess {
  /** True until who this is, and what they hold, are both known. Render nothing. */
  loading: boolean
  /** Demo or a build with no credentials. Everything is on and nothing is saved. */
  isDemo: boolean
  isAdmin: boolean
  can: (key: string) => boolean
  /** True when this viewer could edit SOMETHING on this site. */
  available: boolean
  /** The permission a target demands, or null when nothing claims it. */
  permissionFor: (key: EditTargetKey) => string | null
  /** Whether this viewer may open that target. */
  mayEdit: (key: EditTargetKey) => boolean
  /** Every permission key that unlocks something, for the stylesheet and the bar. */
  heldKeys: string[]
}

export function useEditAccess(): EditAccess {
  const { loading: authLoading, isAdmin } = useAuth()
  const perms = usePermissions()

  // Demo and "no credentials" are the same situation to a screen: there is
  // nothing to talk to, and the walk-through has to work anyway. usePermissions
  // already answers the wildcard set in that case; this mirrors it so the bar
  // does not sit waiting on an auth load that will never happen.
  const isDemo = !supabaseConfigured || demoActive()

  const can = perms.can
  const loading = isDemo ? false : (authLoading || !perms.ready)

  return useMemo(() => {
    const permissionFor = (key: EditTargetKey): string | null => {
      if (key.kind === 'block') return COPY_PERMISSION
      return recordTarget(key.target)?.permission ?? null
    }

    const mayEdit = (key: EditTargetKey): boolean => {
      if (loading) return false
      if (isDemo || isAdmin) return true
      const permission = permissionFor(key)
      // A record target nobody registered is not editable. Guessing a
      // permission for it would be inventing a gate.
      return permission !== null && can(permission)
    }

    const heldKeys: string[] = []
    const claimed = [COPY_PERMISSION, ...recordTargets().map(t => t.permission)]
    for (const key of claimed) {
      if (key && !heldKeys.includes(key) && (isDemo || isAdmin || can(key))) heldKeys.push(key)
    }

    return {
      loading,
      isDemo,
      isAdmin,
      can,
      available: !loading && heldKeys.length > 0,
      permissionFor,
      mayEdit,
      heldKeys,
    }
  }, [loading, isDemo, isAdmin, can])
}
