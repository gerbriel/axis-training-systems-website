import type { RecordTargetDef } from '../../lib/editTargets'
import type { WriteResult } from '../../lib/resourceLibrary'

/**
 * records.ts
 *
 * How the editor talks to a database-backed row, and what it does when it
 * cannot.
 *
 * A record target is a row in a table that ALREADY has a library, an admin
 * panel and a permission of its own: a blog post, a coach profile, a
 * testimonial, a meet. Editing one in place must reuse that library and that
 * permission, never a second write path, because the second path is the one
 * that ends up with different validation, a different demo store and a
 * different idea of who is allowed.
 *
 * The registered shape — src/lib/editTargets.ts — is the frozen contract:
 *
 *   { key, label, permission, actions, adminHref }
 *
 * That is enough to say WHAT exists, WHO may change it and WHERE the full
 * editor for it lives, and with only that the panel offers a deep link into the
 * portal for the row that was clicked. It is a real answer for the heavy cases:
 * a resource library row has five nested content editors behind it, and
 * rebuilding those in a 420 pixel panel would be a worse version of a screen
 * that already exists. Saying "edit this in the portal" costs one line and is
 * not a lie.
 *
 * A target MAY also carry the four optional members below, and when it does the
 * panel edits the row in place instead. They are optional rather than required
 * so that this file never has to guess: a target that has not been given them
 * degrades to the link, and one that has been given them gets the full form,
 * with no version of the editor knowing anything about blogs or coaches.
 *
 * `save` handles create as well as edit — `id === null` IS the create form, so
 * CRUD's C needs no second code path and no third kind of target.
 */

export interface RecordFieldSpec {
  /** The column on the row. */
  key: string
  /** What to call it. Defaults to the key, humanized. */
  label?: string
  input?: 'line' | 'paragraph'
  max?: number
  /** Shown under the field, for the ones with a consequence. */
  hint?: string
}

export interface LiveRecordTarget extends RecordTargetDef {
  /** What the panel may show and write. Nothing outside this list is touched. */
  fields?: RecordFieldSpec[]
  /** The row as it stands. null means "could not tell you", not "empty". */
  load?: (id: string) => Promise<Record<string, unknown> | null>
  /** A blank row for the create form, with any required defaults filled in. */
  blank?: () => Record<string, unknown>
  /** id === null creates. Answers a WriteResult; nothing throws. */
  save?: (id: string | null, patch: Record<string, unknown>, isDemo?: boolean) => Promise<WriteResult>
  remove?: (id: string, isDemo?: boolean) => Promise<WriteResult>
  /**
   * A sentence instead of a button, for a row that cannot be deleted — the way
   * a built-in resource says "Unpublish it instead" rather than offering a
   * control the database will refuse.
   */
  refuseDelete?: (id: string) => string | null
  /** Drop whatever cache the library keeps, after a successful write. */
  invalidate?: () => void
}

/** True when this target can be edited on the page rather than in the portal. */
export function canEditInPlace(target: LiveRecordTarget): boolean {
  return typeof target.save === 'function'
    && typeof target.load === 'function'
    && Array.isArray(target.fields)
    && target.fields.length > 0
}

/** True when a new row can be made from the page. */
export function canCreateInPlace(target: LiveRecordTarget): boolean {
  return target.actions.includes('create')
    && typeof target.save === 'function'
    && Array.isArray(target.fields)
    && target.fields.length > 0
}

/** True when a row can be removed from the page. */
export function canDeleteInPlace(target: LiveRecordTarget): boolean {
  return target.actions.includes('delete') && typeof target.remove === 'function'
}

/**
 * Tell the page that a row changed.
 *
 * The existing precedent for a cross-component nudge with no router and no
 * store is the open-privacy CustomEvent App.tsx already listens for. A section
 * that re-fetches on this event shows the edit without a reload; one that does
 * not is no worse off than before.
 */
export function announceContentChange(source: string): void {
  try {
    window.dispatchEvent(new CustomEvent('axis-content-changed', { detail: { source } }))
  } catch {
    /* an environment without CustomEvent is one where nothing was listening */
  }
}
