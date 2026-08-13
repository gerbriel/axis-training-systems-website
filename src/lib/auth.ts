import { supabase, supabaseConfigured } from './supabase'
import { sanitizeEmail, clearRateLimit } from '../utils/sanitize'
import { COACHES } from '../data/coaches'

/**
 * Password recovery.
 *
 * Both portals previously had no way out of a forgotten password: five wrong
 * guesses locked the account for 15 minutes and the only recourse was texting
 * the owner. Supabase mails a one-time recovery link; the link lands on
 * /reset-password, where supabase-js turns it into a short-lived session that
 * authorizes exactly one thing — setting a new password.
 */

export const MIN_PASSWORD_LENGTH = 8

/**
 * Login rate-limiter scopes. Centralized because the reset flow has to be able
 * to CLEAR the very lockout that sent the user here — see clearLoginLockouts.
 */
export const ADMIN_LOGIN_SCOPE = 'admin_login'
export function coachLoginScope(coachSlug: string): string {
  return `coach_login_${coachSlug}`
}

/**
 * The lockout is client-side (localStorage) and keyed by scope, so it survives
 * the password change that was supposed to resolve it: a coach who locked
 * themselves out, reset their password, and later signed out would find the
 * portal still refusing them for the rest of the 15 minutes — with a password
 * that now works. Proving control of the mailbox is a stronger signal than the
 * failed guesses, so a completed reset clears the lock.
 */
export function clearLoginLockouts(email: string | null | undefined): void {
  clearRateLimit(ADMIN_LOGIN_SCOPE)
  if (!email) return
  const coach = COACHES.find(c => c.email.toLowerCase() === email.toLowerCase())
  if (coach) clearRateLimit(coachLoginScope(coach.slug))
}

export type AuthResult =
  | { ok: true }
  | { ok: false; message: string }

/**
 * Where Supabase sends the coach back to. Must be registered in the Supabase
 * dashboard under Authentication → URL Configuration → Redirect URLs, or the
 * link silently bounces to the site root with no session.
 */
export function passwordResetRedirectTo(): string {
  const base = ((import.meta as any).env?.BASE_URL ?? '/') as string
  return `${window.location.origin}${base}reset-password`
}

/**
 * Deliberately does not reveal whether the address has an account — a reset
 * form that says "no such user" is an account-enumeration oracle. The caller
 * shows the same "check your email" either way.
 */
export async function sendPasswordReset(rawEmail: string): Promise<AuthResult> {
  if (!supabaseConfigured) {
    return { ok: false, message: 'Password reset is unavailable in preview mode.' }
  }

  const email = sanitizeEmail(rawEmail)
  if (!email) return { ok: false, message: 'Enter the email address for your account.' }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: passwordResetRedirectTo(),
  })

  // Rate limiting is the one failure worth surfacing — it is actionable and
  // leaks nothing about whether the account exists.
  if (error) {
    const tooMany = error.status === 429 || /rate|too many/i.test(error.message)
    if (tooMany) return { ok: false, message: 'Too many reset emails requested. Please wait a few minutes and try again.' }
    return { ok: false, message: 'Could not send the reset email. Please try again.' }
  }

  return { ok: true }
}

/** Consumes the recovery session created by the emailed link. */
export async function updatePassword(password: string): Promise<AuthResult> {
  if (!supabaseConfigured) {
    return { ok: false, message: 'Password reset is unavailable in preview mode.' }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    return { ok: false, message: error.message || 'Could not update your password. The link may have expired.' }
  }
  return { ok: true }
}
