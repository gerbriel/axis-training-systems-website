/**
 * editKeys.ts
 *
 * The grammar of the one attribute this feature puts on the page, and the
 * parser that refuses everything else.
 *
 *   data-axis-editable="block:<blockId>"
 *   data-axis-editable="record:<targetKey>:<rowId>"
 *   data-axis-editable="record:<targetKey>:"     ← no row yet: this is an "add one here"
 *
 * WHY AN ATTRIBUTE AND NOT A CONTEXT. Edit mode is discovered by ONE
 * capture-phase click listener doing `closest('[data-axis-editable]')`, which
 * means a marketing component never learns that an edit mode exists: it never
 * imports a context, never subscribes to a store, never re-renders when the
 * mode is toggled, and never conditionally renders anything. The whole cost to
 * an anonymous visitor is roughly thirty bytes of HTML per marked element.
 *
 * WHY THE ATTRIBUTE SHIPS TO EVERYBODY. Rendering it only in edit mode would
 * force every marked element to subscribe to the mode, which is the cost above
 * paid a hundred and twenty times over to hide the names of copy slots. Under
 * docs/SECURITY.md the UI is signage: these strings identify text that is
 * already on the page for anyone to read, and they authorize nothing. RLS
 * decides what a write does.
 *
 * NO IMPORTS. This file is pulled in by every marked component through
 * Editable, so it stays free of libraries, React and anything that touches the
 * network.
 */

/** The attribute name, in one place, because a selector and a setter must agree. */
export const EDIT_ATTR = 'data-axis-editable'

/** The CSS selector for "anything the editor can open". */
export const EDIT_SELECTOR = `[${EDIT_ATTR}]`

/**
 * Set on the wrapper when Editable had no element to hang the attribute on and
 * had to make one. That wrapper is `display: contents`, so it draws no box and
 * cannot carry an outline: the stylesheet outlines its children instead.
 */
export const CONTENTS_ATTR = 'data-axis-editable-contents'

/** A block of site copy: text the bundle ships and the database may override. */
export interface BlockTarget {
  kind: 'block'
  /** The id in the block registry, e.g. 'hero.eyebrow'. */
  id: string
}

/** A row in a table that already has a library, a panel and its own permission. */
export interface RecordTarget {
  kind: 'record'
  /** The registered target key, e.g. 'blog'. */
  target: string
  /** The row, or null for "make a new one". */
  id: string | null
}

export type EditTargetKey = BlockTarget | RecordTarget

export function blockKey(id: string): string {
  return `block:${id}`
}

export function recordKey(target: string, id?: string | null): string {
  return `record:${target}:${id ?? ''}`
}

export function formatKey(key: EditTargetKey): string {
  return key.kind === 'block' ? blockKey(key.id) : recordKey(key.target, key.id)
}

/**
 * The attribute back into a target, or null.
 *
 * Strict on purpose. An unknown or malformed value is a no-op — the click falls
 * through and the page behaves as it always did — rather than a throw on the
 * marketing page, which is the one page where a crash costs money.
 */
export function parseKey(raw: string | null | undefined): EditTargetKey | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null

  if (value.startsWith('block:')) {
    const id = value.slice('block:'.length).trim()
    return id ? { kind: 'block', id } : null
  }

  if (value.startsWith('record:')) {
    const rest = value.slice('record:'.length)
    const cut = rest.indexOf(':')
    if (cut < 0) return null
    const target = rest.slice(0, cut).trim()
    const id = rest.slice(cut + 1).trim()
    if (!target) return null
    return { kind: 'record', target, id: id || null }
  }

  return null
}

/** Two targets naming the same thing. Used to keep one row highlighted. */
export function sameKey(a: EditTargetKey | null, b: EditTargetKey | null): boolean {
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'block') return a.id === (b as BlockTarget).id
  const other = b as RecordTarget
  return a.target === other.target && a.id === other.id
}
