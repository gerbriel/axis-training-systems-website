/**
 * editFlag.ts
 *
 * One string, one storage key, and no imports at all.
 *
 * Edit mode is a per-TAB flag in sessionStorage rather than React state, a
 * route, or a query param, and each of those three was rejected for a reason
 * worth keeping written down:
 *
 *   React state dies on every click. Every link on this site is a full page
 *   load through href() — there is no router — so a mode held in a component
 *   would switch itself off the moment the owner navigated from the home page
 *   to the blog.
 *
 *   A route (/edit) would change which branch AppContent returns from, and the
 *   useState/useEffect pair at the bottom of that function sits below twenty
 *   early returns. Changing the branch changes the hook order, which is a
 *   runtime crash, and this repo has no lint step that would have caught it.
 *
 *   A query param (?edit=1) is lost by the first href() navigation, and until
 *   then it rides along in every URL the owner copies out of the address bar
 *   and pastes to somebody else.
 *
 * sessionStorage survives the full page load, dies with the tab, and is
 * invisible to every other visitor. It is also readable SYNCHRONOUSLY at module
 * scope, the same trick the theme bootstrap in App.tsx uses, so the mode is
 * known before first paint and nothing flickers.
 *
 * This file has no imports so that the admin portal can arm the flag on its way
 * out to the public site without pulling the editor in behind it.
 *
 * THE FLAG IS NOT PERMISSION. It says what this tab wants, never what the
 * person may do: the bar re-derives that from useAuth and usePermissions on
 * every load, and RLS decides what a write actually does. Somebody who sets
 * this by hand in devtools gets an inert flag.
 */

/** The sessionStorage key. Namespaced like `axis-theme`, the other one. */
export const EDIT_FLAG = 'axis-edit'

/** Storage throws in private mode on some browsers. Off is the safe answer. */
export function readEditFlag(): boolean {
  try {
    return sessionStorage.getItem(EDIT_FLAG) === 'on'
  } catch {
    return false
  }
}

export function writeEditFlag(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(EDIT_FLAG, 'on')
    else sessionStorage.removeItem(EDIT_FLAG)
  } catch {
    /* private mode: the mode lasts as long as this page does, which is enough */
  }
}

/**
 * Turn edit mode on for the page we are about to load.
 *
 * Called by the portal's "View site" link, in its onClick, immediately before
 * the browser follows the href. The write lands before the navigation because
 * sessionStorage is synchronous, so the owner arrives already in edit mode,
 * which is the sentence the whole feature came from: click over to view site
 * and the bar is there.
 */
export function armEditMode(): void {
  writeEditFlag(true)
}
