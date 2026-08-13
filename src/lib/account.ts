import { supabase, supabaseConfigured } from './supabase'
import { sanitizeEmail } from '../utils/sanitize'
import { href } from '../utils/nav'

/**
 * Sign-in, three ways, one gate.
 *
 * Google, a password, and a one-time email link all end at the same place: an
 * `auth.users` row, which fires `handle_new_user` (011), which decides whether
 * the account is `active` or `pending`. There is no provider-specific path
 * through that trigger, so there is no provider-specific way around the
 * invitation.
 *
 * Nothing here throws. Every failure is a value, because every caller is a form
 * that has to say something.
 */

export type UserRole = 'athlete' | 'coach' | 'admin'
export type ProfileStatus = 'pending' | 'active' | 'suspended'

export interface Profile {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  display_name: string | null
  avatar_url: string | null
  phone: string | null
  role: UserRole
  status: ProfileStatus
  coach_slug: string | null
  created_at: string
}

export const PROFILE_COLUMNS =
  'id,email,first_name,last_name,display_name,avatar_url,phone,role,status,coach_slug,created_at'

export type AuthOutcome =
  | { ok: true }
  | { ok: false; message: string }

export const MIN_PASSWORD_LENGTH = 8

/**
 * Where a provider sends the browser back to.
 *
 * Every one of these must be registered in the Supabase dashboard under
 * Authentication → URL Configuration → Redirect URLs, or the link silently
 * bounces to the site root with no session and the user is told nothing.
 *
 * `window.location.origin` rather than a build-time constant so the same bundle
 * works on localhost, on a preview deploy, and in production.
 */
export function callbackUrl(next?: string): string {
  const url = new URL(`${window.location.origin}${href('/auth/callback')}`)
  if (next) url.searchParams.set('next', next)
  return url.toString()
}

/**
 * The message a Supabase auth error becomes.
 *
 * Deliberately narrow. Passing `error.message` through verbatim leaks whether
 * an address has an account, which turns any sign-in form into an enumeration
 * oracle — so "Invalid login credentials" is answered with one sentence that
 * covers both a wrong password and no such user.
 */
function authMessage(error: { message?: string; status?: number } | null, fallback: string): string {
  if (!error) return fallback
  if (error.status === 429 || /rate|too many/i.test(error.message ?? '')) {
    return 'Too many attempts. Wait a few minutes and try again.'
  }
  if (/invalid login credentials/i.test(error.message ?? '')) {
    return 'That email and password do not match.'
  }
  if (/email not confirmed/i.test(error.message ?? '')) {
    return 'Check your inbox and confirm your email address first.'
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

/**
 * Navigates away on success, so a resolved promise here is a FAILURE that
 * happened before the redirect. Callers should treat the `ok: true` case as
 * "we are leaving" and not, say, close the dialog on it.
 *
 * Setup, once, in the Supabase dashboard: Authentication → Providers → Google,
 * with the client ID and secret from Google Cloud, and Supabase's callback URL
 * (`https://<ref>.supabase.co/auth/v1/callback`) registered as an authorised
 * redirect URI on the Google side.
 */
export async function signInWithGoogle(next?: string): Promise<AuthOutcome> {
  if (!supabaseConfigured) return { ok: false, message: 'Sign-in is unavailable in preview mode.' }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callbackUrl(next),
      // Forces the account chooser. Without it, anyone on a shared machine is
      // silently signed in as whoever used it last — which on an invite-gated
      // site means being told their invitation does not match an address they
      // never chose.
      queryParams: { prompt: 'select_account' },
    },
  })

  if (error) return { ok: false, message: authMessage(error, 'Could not reach Google. Please try again.') }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export async function signInWithPassword(rawEmail: string, password: string): Promise<AuthOutcome> {
  if (!supabaseConfigured) return { ok: false, message: 'Sign-in is unavailable in preview mode.' }

  const email = sanitizeEmail(rawEmail)
  if (!email) return { ok: false, message: 'Enter the email address for your account.' }

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { ok: false, message: authMessage(error, 'Could not sign you in. Please try again.') }
  return { ok: true }
}

/**
 * Creating an account is allowed for anyone. Being let IN is not.
 *
 * This is the part of an invite-gated site that surprises people: signup is
 * open, and `handle_new_user` parks the profile at `pending` unless something
 * vouches for the address. Refusing the signup instead would mean the form has
 * to tell a stranger whether an invitation exists for an address they typed,
 * which is an invitation oracle — and it would break the ordinary case where
 * somebody signs up first and is accepted afterwards.
 */
export async function signUpWithPassword(
  rawEmail: string,
  password: string,
  displayName: string
): Promise<AuthOutcome> {
  if (!supabaseConfigured) return { ok: false, message: 'Sign-up is unavailable in preview mode.' }

  const email = sanitizeEmail(rawEmail)
  if (!email) return { ok: false, message: 'Enter a valid email address.' }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read by handle_new_user. Google sends `full_name`; a password signup
      // has to say so itself or the profile is named after the mailbox.
      data: { display_name: displayName.trim().slice(0, 120) },
      emailRedirectTo: callbackUrl(),
    },
  })

  if (error) return { ok: false, message: authMessage(error, 'Could not create the account. Please try again.') }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Magic link
// ---------------------------------------------------------------------------

/**
 * For the athlete who books twice a year and will not remember a password.
 *
 * `shouldCreateUser: true` makes this a signup path too, which is what allows
 * an invited athlete to go from the email straight to an account without ever
 * choosing a password. The gate is unchanged — the trigger still decides.
 *
 * Says the same thing whether or not the address exists, for the same reason
 * the password reset does.
 */
export async function sendMagicLink(rawEmail: string, next?: string): Promise<AuthOutcome> {
  if (!supabaseConfigured) return { ok: false, message: 'Sign-in is unavailable in preview mode.' }

  const email = sanitizeEmail(rawEmail)
  if (!email) return { ok: false, message: 'Enter a valid email address.' }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl(next), shouldCreateUser: true },
  })

  if (error) return { ok: false, message: authMessage(error, 'Could not send the link. Please try again.') }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export async function signOut(): Promise<void> {
  if (!supabaseConfigured) return
  await supabase.auth.signOut()
}

/** The signed-in user's profile, or null. */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!supabaseConfigured) return null
  const { data } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle()
  return (data as Profile | null) ?? null
}

/**
 * "Check again" on the pending screen.
 *
 * Closes the ordering gap `handle_new_user` cannot: it fires once, at signup,
 * so an invitation issued AFTERWARDS is never looked at again and the account
 * sits pending for ever. Takes no arguments — the address it matches on is the
 * signed-in user's own, read server-side.
 *
 * Returns true when something changed, so the caller knows to refetch rather
 * than guess.
 */
export async function claimPendingInvite(): Promise<boolean> {
  if (!supabaseConfigured) return false
  const { data, error } = await supabase.rpc('claim_pending_invite')
  if (error) return false
  return data === true
}

// ---------------------------------------------------------------------------
// Invitations, from the invitee's side
// ---------------------------------------------------------------------------

export interface InvitationPreview {
  email: string
  role: UserRole
  coachSlug: string | null
  firstName: string | null
  lastName: string | null
  note: string | null
  invitedByName: string | null
  expiresAt: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
}

/**
 * Anon-callable, and safe because the TOKEN IS THE ARGUMENT: without the
 * 256-bit secret it returns nothing, and it can never return a different
 * invitation than the one asked for.
 */
export async function previewInvitation(token: string): Promise<InvitationPreview | null> {
  if (!supabaseConfigured) return null

  const { data, error } = await supabase.rpc('invitation_preview', { p_token: token })
  if (error || !Array.isArray(data) || data.length === 0) return null

  const row = data[0] as {
    email: string; role: UserRole; coach_slug: string | null
    first_name: string | null; last_name: string | null; note: string | null
    invited_by_name: string | null; expires_at: string; status: string
  }

  return {
    email: row.email,
    role: row.role,
    coachSlug: row.coach_slug,
    firstName: row.first_name,
    lastName: row.last_name,
    note: row.note,
    invitedByName: row.invited_by_name,
    expiresAt: row.expires_at,
    status: row.status as InvitationPreview['status'],
  }
}

export type ClaimResult =
  | 'claimed' | 'already_active' | 'already_yours'
  | 'wrong_email' | 'already_used' | 'revoked' | 'expired' | 'invalid'
  | 'suspended' | 'not_signed_in' | 'no_profile' | 'error'

/** Redeems the link for the signed-in user. The role comes from the row, never from here. */
export async function claimInvitationToken(token: string): Promise<ClaimResult> {
  if (!supabaseConfigured) return 'error'
  const { data, error } = await supabase.rpc('claim_invitation_token', { p_token: token })
  if (error) return 'error'
  return (data as ClaimResult) ?? 'error'
}

/** What the invitee should read for each outcome. */
export function claimMessage(result: ClaimResult, invitedEmail?: string | null): string {
  switch (result) {
    case 'wrong_email':
      return invitedEmail
        ? `This invitation was sent to ${maskEmail(invitedEmail)}. Sign out and sign back in with that address.`
        : 'This invitation was sent to a different email address. Sign out and sign back in with that one.'
    case 'already_used':
      return 'This invitation has already been used by someone else.'
    case 'revoked':
      return 'This invitation has been revoked. Ask whoever sent it for a new one.'
    case 'expired':
      return 'This invitation has expired. Ask whoever sent it for a new one.'
    case 'invalid':
      return 'This link is not valid. It may have been superseded by a newer invitation.'
    case 'suspended':
      return 'This account has been suspended. Get in touch and we will sort it out.'
    case 'no_profile':
      return 'We could not find your account. Try signing out and back in.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

/** 'ronnie@axis.com' -> 'r*****@axis.com'. Enough to recognise, not enough to learn. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return email
  const head = local.slice(0, 1)
  return `${head}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`
}
