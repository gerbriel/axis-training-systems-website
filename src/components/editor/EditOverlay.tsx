import { useEffect, useRef } from 'react'
import { EDIT_ATTR, EDIT_SELECTOR, parseKey, sameKey } from './editKeys'
import type { EditTargetKey } from './editKeys'
import type { ScannedTarget } from './useTargets'
import { FRAME_Z } from './kit'

/**
 * EditOverlay.tsx
 *
 * What edit mode LOOKS like, and the one listener that makes it work.
 *
 * Three things happen when the mode comes on, and all three are DOM operations
 * on elements that already exist. No marketing component re-renders, none of
 * them learns that an editor is on the page, and turning the mode off puts the
 * page back exactly as it was:
 *
 *   1. One capture-phase click listener on document. It walks up from whatever
 *      was clicked with `closest('[data-axis-editable]')` and opens the panel.
 *      Capture, and preventDefault, because half of these targets are anchors
 *      and buttons: an editable "Book a Call" would otherwise navigate away
 *      mid-edit, and the footer's Privacy Policy button would fire its
 *      open-privacy event over the top of the panel. A target the viewer may
 *      NOT edit is left alone entirely, so the site still works normally around
 *      the parts they cannot change.
 *
 *   2. A marker attribute on every target this viewer is actually allowed to
 *      open, and a tabindex on the ones that are not already focusable. The
 *      outline hangs off the marker rather than off a prefix selector built
 *      from permission names, so what is outlined is exactly what will open,
 *      and a coach never sees a dashed box around a write RLS would refuse.
 *
 *   3. A frame around the viewport. The bar is bottom left and always visible,
 *      but somebody scrolled into the middle of a long page with nothing
 *      editable in view needs to know the mode is still on before they click.
 *
 * The stylesheet is one static <style> element. It uses outline rather than
 * border because a border changes the box model, and every marketing section
 * here is laid out to the pixel.
 */

const CSS = `
html[data-axis-edit="on"] [data-axis-edit-open] {
  outline: 1px dashed rgba(39,44,132,.9);
  outline-offset: 2px;
  cursor: pointer;
}
html[data-axis-edit="on"] [data-axis-edit-open]:hover {
  outline-style: solid;
  outline-color: #272C84;
  background-color: rgba(39,44,132,.06);
}
html[data-axis-edit="on"] [data-axis-edit-open]:focus-visible {
  outline: 2px solid #272C84;
  outline-offset: 3px;
}
html[data-axis-edit="on"] [data-axis-edit-open][data-axis-edit-current] {
  outline: 2px solid #272C84;
  outline-offset: 2px;
}
html[data-axis-edit="on"] [data-axis-edit-open][data-axis-editable-contents] {
  outline: none;
  background-color: transparent;
}
html[data-axis-edit="on"] [data-axis-edit-open][data-axis-editable-contents] > * {
  outline: 1px dashed rgba(39,44,132,.9);
  outline-offset: 2px;
  cursor: pointer;
}
`

const OPEN_ATTR = 'data-axis-edit-open'
const CURRENT_ATTR = 'data-axis-edit-current'
const ADDED_TAB_ATTR = 'data-axis-edit-tab'
const NATIVE_FOCUS = 'a[href], button, input, select, textarea, [tabindex]'

export interface EditOverlayProps {
  targets: ScannedTarget[]
  mayEdit: (key: EditTargetKey) => boolean
  /** The target whose panel is open, so it can be shown as the current one. */
  current: EditTargetKey | null
  onOpen: (key: EditTargetKey, el: HTMLElement) => void
}

export default function EditOverlay({ targets, mayEdit, current, onOpen }: EditOverlayProps) {
  // The handlers are registered once and read the latest props through refs.
  // Re-registering a capture listener on every render would be a new listener
  // every time the panel's draft changed a character.
  const mayEditRef = useRef(mayEdit)
  const onOpenRef = useRef(onOpen)
  mayEditRef.current = mayEdit
  onOpenRef.current = onOpen

  // ── The mode flag on <html>, which every rule above hangs off ─────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-axis-edit', 'on')
    return () => { document.documentElement.removeAttribute('data-axis-edit') }
  }, [])

  // ── Open on click, and on Enter for whoever is using a keyboard ───────────
  useEffect(() => {
    const handle = (target: EventTarget | null): HTMLElement | null => {
      const start = target instanceof Element ? target : null
      const el = start?.closest<HTMLElement>(EDIT_SELECTOR) ?? null
      if (!el) return null
      const key = parseKey(el.getAttribute(EDIT_ATTR))
      if (!key || !mayEditRef.current(key)) return null
      return el
    }

    const onClick = (e: MouseEvent) => {
      // A modified click is somebody opening a link in a new tab on purpose.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const el = handle(e.target)
      if (!el) return
      const key = parseKey(el.getAttribute(EDIT_ATTR))
      if (!key) return
      e.preventDefault()
      e.stopPropagation()
      onOpenRef.current(key, el)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const el = handle(document.activeElement)
      if (!el || el !== document.activeElement) return
      // Space belongs to a native control that is focused. Enter still opens.
      if (e.key === ' ' && el.matches('input, textarea, select, button, a[href]')) return
      const key = parseKey(el.getAttribute(EDIT_ATTR))
      if (!key) return
      e.preventDefault()
      e.stopPropagation()
      onOpenRef.current(key, el)
    }

    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  // ── Mark what may be opened, and make it reachable by keyboard ────────────
  useEffect(() => {
    const touched: HTMLElement[] = []

    for (const target of targets) {
      if (!mayEdit(target.key)) continue
      const el = target.el
      el.setAttribute(OPEN_ATTR, '')
      if (!el.matches(NATIVE_FOCUS)) {
        el.setAttribute('tabindex', '0')
        el.setAttribute(ADDED_TAB_ATTR, '')
      }
      if (sameKey(target.key, current)) el.setAttribute(CURRENT_ATTR, '')
      else el.removeAttribute(CURRENT_ATTR)
      touched.push(el)
    }

    return () => {
      for (const el of touched) {
        el.removeAttribute(OPEN_ATTR)
        el.removeAttribute(CURRENT_ATTR)
        if (el.hasAttribute(ADDED_TAB_ATTR)) {
          el.removeAttribute('tabindex')
          el.removeAttribute(ADDED_TAB_ATTR)
        }
      }
    }
  }, [targets, mayEdit, current])

  return (
    <>
      <style>{CSS}</style>
      <div
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, zIndex: FRAME_Z, pointerEvents: 'none',
          boxShadow: 'inset 0 0 0 2px rgba(39,44,132,.55)',
        }}
      />
      <p
        aria-live="polite"
        style={{
          position: 'absolute', width: 1, height: 1, overflow: 'hidden',
          clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
        }}
      >
        Edit mode is on. Editable parts of the page can be reached with Tab and opened with Enter.
      </p>
    </>
  )
}
