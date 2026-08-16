import { useSyncExternalStore } from 'react'
import { readEditFlag, writeEditFlag } from './editFlag'

/**
 * editState.ts
 *
 * Whether this tab is in edit mode, as a store rather than a context.
 *
 * A context provider would have to sit above the marketing tree, and every
 * component that wanted the flag would re-render when it changed. Almost
 * nothing wants the flag: the bar wants it, the overlay wants it, and Editable
 * wants it only in the one shape where it has no element of its own to mark.
 * A store with useSyncExternalStore lets exactly those three subscribe and
 * leaves the rest of the page alone.
 *
 * The initial value is read SYNCHRONOUSLY at module scope, so the very first
 * render already knows. Nothing flashes into edit mode a beat after the page
 * settles, which on a marketing page reads as the site glitching.
 *
 * React + editFlag only. This module is on the path of every marked component,
 * so it stays clear of libraries, permissions and the network.
 */

let on = readEditFlag()

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The flag, for code that is not a component. */
export function editModeOn(): boolean {
  return on
}

/**
 * Turn it on or off, and remember it for the rest of the tab's life.
 *
 * Idempotent: setting it to what it already is notifies nobody, so a component
 * that calls this in an effect cannot start a loop.
 */
export function setEditMode(next: boolean): void {
  if (on === next) return
  on = next
  writeEditFlag(next)
  emit()
}

/** The flag, for a component. Subscribes; use it only where it is needed. */
export function useEditModeFlag(): boolean {
  return useSyncExternalStore(subscribe, editModeOn, () => false)
}
