import { supabase } from './supabase'

/**
 * Who is allowed to set a new password.
 *
 * The reset page cannot answer that from the session alone. supabase-js
 * persists sessions in localStorage, so an ordinary signed-in coach — a tab
 * left open on the gym's front-desk laptop — carries a perfectly good session.
 * Gating on "is there a session" would turn that tab into a takeover button:
 * no old password, no email round trip.
 *
 * Nor can the URL be the authority. Anyone can type `#type=recovery` into the
 * address bar; supabase-js ignores such a fragment (there is no token in it)
 * and simply restores the ambient session, so trusting the URL string would
 * hand the attacker exactly the same takeover through a longer door.
 *
 * The only thing that cannot be forged is the PASSWORD_RECOVERY event: auth-js
 * emits it only after parsing and verifying a real, single-use recovery token
 * out of the URL. That event — and nothing else — is the grant.
 */

const RECOVERY_FLAG = 'axis_password_recovery'

/**
 * NOT authorization. It only says the URL *looks* like a recovery link, so the
 * reset page knows to wait for the token to be verified instead of turning a
 * legitimate visitor away mid-parse. A forged fragment gets the same wait and
 * then the same refusal, because the grant below never arrives.
 */
export const urlLooksLikeRecoveryLink: boolean = (() => {
  if (typeof window === 'undefined') return false
  const hash = window.location.hash ?? ''
  // Implicit flow (the supabase-js default) carries `type=recovery` in the
  // hash; PKCE would use `?code=`. Both are watched so changing flowType later
  // cannot silently strand every reset link on the "invalid" screen.
  if (hash.includes('type=recovery')) return true
  return new URLSearchParams(window.location.search).has('code')
})()

let grantSeen = false

/**
 * Registered at module load, deliberately: auth-js initializes asynchronously,
 * so a listener attached here is always in place before the event can fire —
 * whereas one attached when React mounts the page could miss it entirely.
 */
supabase.auth.onAuthStateChange(event => {
  if (event !== 'PASSWORD_RECOVERY') return
  grantSeen = true
  try {
    // sessionStorage, not localStorage: the grant dies with the tab, but
    // survives a reload of the reset page — by which point auth-js has already
    // stripped the token from the URL and will never re-emit the event.
    window.sessionStorage.setItem(RECOVERY_FLAG, '1')
  } catch {
    // Private mode — grantSeen still covers this tab for as long as it lives.
  }
})

/** True only in a tab where a real recovery token was actually verified. */
export function hasPasswordRecoveryGrant(): boolean {
  if (grantSeen) return true
  try {
    return window.sessionStorage.getItem(RECOVERY_FLAG) === '1'
  } catch {
    return false
  }
}

/** Spend the grant: once the password is changed, the form must not reappear. */
export function endPasswordRecovery(): void {
  grantSeen = false
  try {
    window.sessionStorage.removeItem(RECOVERY_FLAG)
  } catch {
    // Ignore.
  }
}
