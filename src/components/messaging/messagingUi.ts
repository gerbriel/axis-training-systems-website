import type { CSSProperties } from 'react'
import type { ChatMessage, ConversationSummary, MessagingContact } from '../../types/messaging'

/**
 * The shared vocabulary of the messaging surface: the accent, the two label
 * styles every Axis panel already uses, and the handful of formatters a chat
 * needs that nothing else in the app does.
 *
 * Deliberately JSX-free so a component importing one date helper does not drag
 * a component tree along with it.
 */

export const ACCENT = '#272C84'
export const CRIMSON = '#c8102e'

/** The uppercase micro-label the dashboards stamp on every section. */
export const MICRO: CSSProperties = {
  fontSize: '.6rem',
  fontWeight: 900,
  letterSpacing: '.25em',
  textTransform: 'uppercase',
}

/** The uppercase button face, shared by the solid and ghost variants. */
export const BTN: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '.62rem',
  fontWeight: 900,
  letterSpacing: '.15em',
  textTransform: 'uppercase',
  borderRadius: '.25rem',
  cursor: 'pointer',
}

/**
 * A message plus the two states that only ever exist in the browser: in flight,
 * and refused. Neither is ever read back from the database.
 */
export type LocalMessage = ChatMessage & { pending?: boolean; failed?: boolean }

export const ROLE_LABEL: Record<MessagingContact['role'], string> = {
  athlete: 'Athlete',
  coach: 'Coach',
  admin: 'Admin',
}

/**
 * What a conversation is called in the list and the header. A direct message
 * is named after the other person, everything else carries its own title, and
 * a title that went missing still has to render as something.
 *
 * `kind === 'broadcast'` is the newsletter kind under the name 023 gave the
 * enum. The fallback a person sees says newsletter, like everything else.
 */
export function conversationTitle(conversation: ConversationSummary): string {
  if (conversation.kind === 'dm') return conversation.members[0]?.display_name ?? 'Former member'
  const title = conversation.title?.trim()
  if (title) return title
  return conversation.kind === 'broadcast' ? 'Newsletter' : 'Channel'
}

/** A sender whose profile row was deleted still has messages in the thread. */
export function senderName(id: string | null, profiles: Map<string, MessagingContact>): string {
  if (!id) return 'Former member'
  return profiles.get(id)?.display_name ?? 'Former member'
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** Compact enough to sit at the end of a list row: now, 9m, 4h, 3d, Mar 4. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const ms = Date.now() - then
  if (ms < MINUTE) return 'now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d`
  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function clockTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function dayLabel(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today.getTime() - DAY)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

/**
 * The id an optimistic bubble carries until the server hands back a real one.
 * Prefixed so a stray temporary id can never be mistaken for a row id.
 */
export function newTempId(): string {
  const source = globalThis.crypto
  if (source && typeof source.randomUUID === 'function') return `pending-${source.randomUUID()}`
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Newest conversation first. The API already orders, but realtime merges and
 * an optimistic send both reorder the list under it, so the view sorts too.
 */
export function sortConversations(rows: ConversationSummary[]): ConversationSummary[] {
  return [...rows].sort(
    (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
  )
}

/** Role first, then name: the order the contact RPC returns and the pickers keep. */
const ROLE_ORDER: Record<MessagingContact['role'], number> = { admin: 0, coach: 1, athlete: 2 }

export function sortContacts(rows: MessagingContact[]): MessagingContact[] {
  return [...rows].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.display_name.localeCompare(b.display_name)
  )
}

export function matchesSearch(contact: MessagingContact, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = [contact.display_name, contact.first_name, contact.last_name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}
