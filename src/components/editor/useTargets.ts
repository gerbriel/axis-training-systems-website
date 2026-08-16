import { useCallback, useEffect, useRef, useState } from 'react'
import { EDIT_ATTR, EDIT_SELECTOR, parseKey } from './editKeys'
import type { EditTargetKey } from './editKeys'

/**
 * useTargets.ts
 *
 * Everything editable on the page right now, in the order a reader meets it.
 *
 * FOUND BY QUERYING THE DOM, not by a registry components sign into. A registry
 * would mean an effect inside every marked element on the page — a hundred and
 * twenty subscriptions to keep a list that `querySelectorAll` already answers
 * in document order, for free, and only when somebody opens the bar. The DOM is
 * the registry.
 *
 * IT RESCANS, because half of this page is asynchronous. Coaches, testimonials,
 * meets and tools all paint from their shipped fallback and then swap in
 * database rows a moment later, so the blog cards a moment ago did not exist.
 * A childList observer over the body, debounced, keeps the list honest without
 * polling. Attribute changes are deliberately not observed: edit mode itself
 * sets tabindex on these elements, and an attribute observer would watch itself
 * work.
 */

export interface ScannedTarget {
  /** Its position in the document, and its identity in the list. */
  index: number
  /** The attribute value, verbatim. */
  raw: string
  key: EditTargetKey
  el: HTMLElement
  /** What it says on the page, for the outline list. Text, never markup. */
  text: string
}

const DEBOUNCE_MS = 200

function scan(): ScannedTarget[] {
  const out: ScannedTarget[] = []
  const nodes = document.querySelectorAll<HTMLElement>(EDIT_SELECTOR)
  nodes.forEach(el => {
    const raw = el.getAttribute(EDIT_ATTR) ?? ''
    const key = parseKey(raw)
    // An unreadable attribute is a no-op rather than a throw. This runs on the
    // page that sells the business.
    if (!key) return
    out.push({
      index: out.length,
      raw,
      key,
      el,
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })
  })
  return out
}

export function useTargets(enabled: boolean): { targets: ScannedTarget[]; rescan: () => void } {
  const [targets, setTargets] = useState<ScannedTarget[]>([])
  const timer = useRef<number | null>(null)

  const rescan = useCallback(() => {
    setTargets(enabled ? scan() : [])
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setTargets([])
      return
    }

    setTargets(scan())

    const later = () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        timer.current = null
        setTargets(scan())
      }, DEBOUNCE_MS)
    }

    const observer = new MutationObserver(later)
    observer.observe(document.body, { childList: true, subtree: true })

    // A save anywhere reloads a section, and the section that reloads may be one
    // whose rows are the targets. Same event the record adapters announce with.
    window.addEventListener('axis-content-changed', later)

    return () => {
      observer.disconnect()
      window.removeEventListener('axis-content-changed', later)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [enabled])

  return { targets, rescan }
}
