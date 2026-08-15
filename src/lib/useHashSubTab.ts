import { useCallback, useEffect, useState } from 'react'

/**
 * Keeps a panel's sub-tab in the URL hash so a refresh or the Back button lands
 * where the studio left off, mirroring how the top-level tabs persist in
 * `?tab=` (see useUrlTab in ./dashboard).
 *
 * Every caller validates against its OWN list. Two panels now use this hook and
 * they share one hash slot, so leaving Messages on #newsletter and opening
 * Insights hands Insights a hash it does not own. Falling back to that panel's
 * default is the whole point: an unrecognised hash is never an error, it is
 * just somebody else's bookmark.
 *
 * Pass a module-level `valid` array. A fresh array literal on every render
 * would rebuild the hashchange listener on every render for no gain.
 */
export function useHashSubTab<T extends string>(valid: readonly T[], fallback: T): [T, (t: T) => void] {
  const read = useCallback((): T => {
    const h = window.location.hash.replace(/^#/, '')
    return (valid as readonly string[]).includes(h) ? (h as T) : fallback
  }, [valid, fallback])

  const [tab, setTab] = useState<T>(read)

  useEffect(() => {
    const onHash = () => setTab(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [read])

  // Writing the hash fires hashchange, which re-reads and lands on the same
  // value. Setting state here too keeps the switch instant rather than waiting
  // a frame for the event.
  const select = useCallback((t: T) => {
    try { window.location.hash = t } catch { /* ignore */ }
    setTab(t)
  }, [])

  return [tab, select]
}
