import { supabase, supabaseConfigured } from './supabase'
import type { UserRole } from './account'

/**
 * Issuing and revoking invitations, from a staff screen.
 *
 * Creating one goes through the `invite-send` edge function, because the TOKEN
 * IS GENERATED THERE and only its SHA-256 reaches the database. Revoking is a
 * plain PostgREST update under the RLS policy in 012 — no secret is involved,
 * so no function needs to be.
 */

export interface Invitation {
  id: number
  email: string
  first_name: string | null
  last_name: string | null
  note: string | null
  role: UserRole
  coach_slug: string | null
  invited_by: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  created_at: string
}

/** Never `token_hash`. It is of no use to a screen and every use to a leak. */
export const INVITATION_COLUMNS =
  'id,email,first_name,last_name,note,role,coach_slug,invited_by,expires_at,accepted_at,revoked_at,created_at'

export type InvitationState = 'pending' | 'accepted' | 'revoked' | 'expired'

/** Derived, never stored — an invitation expires by the passage of time. */
export function invitationState(i: Invitation): InvitationState {
  if (i.accepted_at) return 'accepted'
  if (i.revoked_at) return 'revoked'
  if (new Date(i.expires_at).getTime() <= Date.now()) return 'expired'
  return 'pending'
}

export interface SendInvitationInput {
  email: string
  role: UserRole
  coachSlug?: string | null
  firstName?: string
  lastName?: string
  note?: string
}

export type SendResult =
  | {
      ok: true
      /**
       * The ONE time this exists outside an inbox. It is not stored and cannot
       * be shown again — issuing another invitation for the same address
       * supersedes this one, which is what makes a rotated link also a revoked
       * link. The panel shows it once and says so.
       */
      link: string
      emailed: boolean
      expiresAt: string
    }
  | { ok: false; message: string }

export async function sendInvitation(input: SendInvitationInput): Promise<SendResult> {
  if (!supabaseConfigured) return { ok: false, message: 'Invitations are unavailable in preview mode.' }

  const { data, error } = await supabase.functions.invoke('invite-send', {
    body: {
      email:      input.email.trim().toLowerCase(),
      role:       input.role,
      coach_slug: input.coachSlug ?? null,
      first_name: input.firstName?.trim() || null,
      last_name:  input.lastName?.trim() || null,
      note:       input.note?.trim() || null,
    },
  })

  if (error) {
    // supabase-js does not parse a non-2xx body, so the reason is on the
    // attached Response. The `refused` case carries a sentence written by the
    // guards in 012 — "that email already has an account", "only an admin can
    // invite staff" — and those are exactly what the person needs to read.
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const payload = (await context.json()) as { error?: string; message?: string }
        if (payload?.error === 'refused' && payload.message) {
          return { ok: false, message: payload.message }
        }
        return { ok: false, message: invitationErrorMessage(payload?.error) }
      } catch {
        // Non-JSON body.
      }
    }
    return { ok: false, message: 'Could not send the invitation. Please try again.' }
  }

  const payload = data as { link?: string; emailed?: boolean; expires_at?: string } | null
  if (!payload?.link) return { ok: false, message: 'Could not send the invitation. Please try again.' }

  return {
    ok: true,
    link: payload.link,
    emailed: payload.emailed === true,
    expiresAt: payload.expires_at ?? '',
  }
}

function invitationErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'forbidden':        return 'You do not have permission to send that invitation.'
    case 'not_authenticated': return 'Your session expired. Sign in again.'
    case 'invalid_email':    return 'That does not look like an email address.'
    case 'rate_limited':     return 'That is a lot of invitations at once. Wait a few minutes.'
    default:                 return 'Could not send the invitation. Please try again.'
  }
}

export async function fetchInvitations(): Promise<Invitation[] | null> {
  if (!supabaseConfigured) return []
  const { data, error } = await supabase
    .from('invitations')
    .select(INVITATION_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(200)

  // null is the outage signal, [] is genuinely none sent. The panel says
  // something different for each.
  if (error) return null
  return (data ?? []) as unknown as Invitation[]
}

/**
 * Revoking is the only edit an invitation permits — `invitations_before_update`
 * (012) raises on any change to the email, the role, or the token.
 */
export async function revokeInvitation(id: number, byUserId: string): Promise<boolean> {
  if (!supabaseConfigured) return false
  const { error } = await supabase
    .from('invitations')
    .update({ revoked_at: new Date().toISOString(), revoked_by: byUserId })
    .eq('id', id)
    .is('accepted_at', null)
  return !error
}
