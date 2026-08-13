import { useCallback, useEffect, useState } from 'react'
import { fetchAllContent } from './contentApi'
import { fetchAllTestimonials } from './testimonialsApi'

/**
 * Shared state helpers for the two dashboards (master admin + coach portal).
 *
 * The router in App.tsx is path-based and evaluated once at load, so dashboard
 * navigation state lives in QUERY PARAMS (?tab=, ?demo=1) — a path like
 * /admin/crm would collide with the /admin/<coach-slug> route.
 */

export const MOBILE_QUERY = '(max-width: 767px)'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', onChange)
    setMatches(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/**
 * Tab state that survives refresh and participates in browser history:
 * selecting a tab pushes ?tab=<t>, Back/Forward walk through tabs instead of
 * ejecting the user from the dashboard, and any tab is deep-linkable.
 *
 * `valid` must be a module-level constant — it is read on every popstate.
 */
export function useUrlTab<T extends string>(valid: readonly T[], fallback: T): [T, (t: T) => void] {
  const read = useCallback((): T => {
    const t = new URLSearchParams(window.location.search).get('tab')
    return (valid as readonly string[]).includes(t ?? '') ? (t as T) : fallback
  }, [valid, fallback])

  const [tab, setTabState] = useState<T>(read)

  useEffect(() => {
    const onPop = () => setTabState(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [read])

  const setTab = useCallback((t: T) => {
    setTabState(t)
    const url = new URL(window.location.href)
    if (t === fallback) url.searchParams.delete('tab')
    else url.searchParams.set('tab', t)
    // Re-selecting the active tab must not push a duplicate entry — Back would
    // appear to do nothing until the stack of identical URLs is unwound.
    if (url.href !== window.location.href) window.history.pushState({}, '', url)
  }, [fallback])

  return [tab, setTab]
}

/**
 * Keeps a shell's isDemo state honest against Back/Forward: tab changes push
 * history entries that CARRY the ?demo=1 param, so navigating back into one
 * must re-enter demo (and back out of one must leave it) — otherwise the URL
 * and the mode silently disagree and the next refresh flips the mode.
 */
export function useDemoParamSync(setter: (active: boolean) => void): void {
  useEffect(() => {
    const onPop = () => setter(demoParamActive())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [setter])
}

/**
 * Demo mode is URL-addressable on BOTH dashboards: ?demo=1 enters it, refresh
 * keeps it (an accidental refresh must not dump the owner on the login wall
 * mid-demo), and exiting strips the param — previously "Exit Demo" only
 * flipped React state, so a ?demo=1 URL silently re-entered demo on reload.
 */
export function demoParamActive(): boolean {
  return new URLSearchParams(window.location.search).get('demo') === '1'
}

export function setDemoParam(on: boolean): void {
  const url = new URL(window.location.href)
  if (on) url.searchParams.set('demo', '1')
  else url.searchParams.delete('demo')
  window.history.replaceState({}, '', url)
}

export interface PendingCounts {
  blog: number
  meets: number
  testimonials: number
  total: number
}

export const ZERO_PENDING: PendingCounts = { blog: 0, meets: 0, testimonials: 0, total: 0 }

/**
 * Live pending-review counts for the admin nav badges. The old header badges
 * read a localStorage store that nothing writes in live mode, so they were
 * permanently 0; these come from the same APIs the panels themselves render.
 * Failures count as zero — a badge is never worth an error state.
 */
export async function fetchPendingCounts(isDemo: boolean): Promise<PendingCounts> {
  const [content, testimonials] = await Promise.all([
    fetchAllContent(isDemo).catch(() => []),
    fetchAllTestimonials(isDemo).catch(() => []),
  ])
  const blog  = content.filter(c => c.type === 'blog' && c.status === 'pending').length
  const meets = content.filter(c => c.type === 'meet' && c.status === 'pending').length
  const tst   = testimonials.filter(t => t.mainStatus === 'pending').length
  return { blog, meets, testimonials: tst, total: blog + meets + tst }
}
