/**
 * contentApi.ts
 *
 * Unified async API for pending content (blog posts + meets).
 *
 * Routing:
 *   isDemo=true  OR  !supabaseConfigured  →  localStorage (pendingContent.ts)
 *   supabaseConfigured + live session      →  Supabase `pending_content` table
 *
 * All functions are async so callers work the same way in both modes.
 */

import { supabase, supabaseConfigured } from './supabase'
import type { PendingContent, ContentStatus } from '../data/pendingContent'
import { sanitize } from '../utils/sanitize'
import { DEMO_CONTENT } from '../data/demoData'
import { POSTS } from '../data/blog'

// ── Static live-site content as PendingContent entries ──────────────────────
// These mirror exactly what the public blog page and upcoming meets section show,
// so the demo admin panel displays the same content the live site does.

const LIVE_BLOG_POSTS: PendingContent[] = POSTS.map(p => ({
  id: p.slug,
  type: 'blog',
  coachSlug: p.coachSlug ?? 'admin',
  coachName: p.coachName ?? 'Axis Admin',
  status: 'approved',
  submittedAt: new Date(p.date).toISOString(),
  reviewedAt:  new Date(p.date).toISOString(),
  title:    p.title,
  subtitle: p.subtitle,
  summary:  p.summary,
  tags:     p.tags.join(', '),
  content:  JSON.stringify(p.content),
}))

const LIVE_MEETS: PendingContent[] = [
  { id: 'static-meet-usapl-nationals-2026', type: 'meet', coachSlug: 'admin', coachName: 'Axis Admin', status: 'approved', submittedAt: '2026-01-01T00:00:00.000Z', reviewedAt: '2026-01-01T00:00:00.000Z', meetName: 'USAPL Raw Nationals', meetDate: 'July 24\u201327, 2026', meetLocation: 'Reno, NV', federation: 'USAPL', meetType: 'National', meetNote: 'Axis coaches attending & handling' },
  { id: 'static-meet-pa-nationals-2026',    type: 'meet', coachSlug: 'admin', coachName: 'Axis Admin', status: 'approved', submittedAt: '2026-01-02T00:00:00.000Z', reviewedAt: '2026-01-02T00:00:00.000Z', meetName: 'Powerlifting America Nationals', meetDate: 'August 2026', meetLocation: 'TBD', federation: 'PA', meetType: 'National', meetNote: 'Axis coaches attending & handling' },
  { id: 'static-meet-ipf-worlds-2026',      type: 'meet', coachSlug: 'admin', coachName: 'Axis Admin', status: 'approved', submittedAt: '2026-01-03T00:00:00.000Z', reviewedAt: '2026-01-03T00:00:00.000Z', meetName: 'IPF World Classic Championships', meetDate: 'September 2026', meetLocation: 'TBD', federation: 'IPF', meetType: 'World', meetNote: 'Team Axis athletes competing' },
]

// ── In-memory demo store ────────────────────────────────────────────────────
// Seeded from live static content + DEMO_CONTENT on first access. Resets on reload.
let _demoStore: PendingContent[] | null = null

function getDemoStore(): PendingContent[] {
  if (!_demoStore) _demoStore = [
    ...LIVE_BLOG_POSTS.map(c => ({ ...c })),
    ...LIVE_MEETS.map(c => ({ ...c })),
    ...DEMO_CONTENT.map(c => ({ ...c })),
  ]
  return _demoStore
}

// ── DB ↔ app field mapping ──────────────────────────────────────────────────

function rowToContent(row: Record<string, unknown>): PendingContent {
  const str = (v: unknown, max = 500) =>
    typeof v === 'string' && v ? sanitize(v, max) : undefined

  return {
    id:            String(row.id),
    type:          row.type as 'blog' | 'meet',
    coachSlug:     String(row.coach_slug),
    coachName:     String(row.coach_name),
    status:        row.status as ContentStatus,
    submittedAt:   String(row.submitted_at),
    reviewedAt:    typeof row.reviewed_at === 'string' ? row.reviewed_at : undefined,
    rejectionNote: str(row.rejection_note, 500),
    // Blog
    title:         str(row.title, 200),
    subtitle:      str(row.subtitle, 300),
    tags:          str(row.tags, 200),
    summary:       str(row.summary, 1000),
    content:       str(row.content, 8000),
    // Meet
    meetName:      str(row.meet_name, 200),
    meetDate:      str(row.meet_date, 100),
    meetLocation:  str(row.meet_location, 200),
    federation:    str(row.federation, 50),
    meetType:      typeof row.meet_type === 'string' ? row.meet_type : undefined,
    meetNote:      str(row.meet_note, 300),
  }
}

function contentToRow(item: Omit<PendingContent, 'id' | 'submittedAt' | 'status'>) {
  return {
    type:          item.type,
    coach_slug:    item.coachSlug,
    coach_name:    item.coachName,
    // Blog
    title:         item.title         ?? null,
    subtitle:      item.subtitle      ?? null,
    tags:          item.tags          ?? null,
    summary:       item.summary       ?? null,
    content:       item.content       ?? null,
    // Meet
    meet_name:     item.meetName      ?? null,
    meet_date:     item.meetDate      ?? null,
    meet_location: item.meetLocation  ?? null,
    federation:    item.federation    ?? null,
    meet_type:     item.meetType      ?? null,
    meet_note:     item.meetNote      ?? null,
  }
}

function useDB(isDemo: boolean): boolean {
  return supabaseConfigured && !isDemo
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Fetch ALL content submissions — used by admin approvals panel. */
export async function fetchAllContent(isDemo: boolean): Promise<PendingContent[]> {
  if (!useDB(isDemo)) return [...getDemoStore()]
  const { data, error } = await supabase
    .from('pending_content')
    .select('*')
    .order('submitted_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(r => rowToContent(r as Record<string, unknown>))
}

/** Fetch content submitted by a specific coach slug. */
export async function fetchMyContent(
  coachSlug: string,
  isDemo: boolean,
): Promise<PendingContent[]> {
  if (!useDB(isDemo)) {
    return getDemoStore().filter(c => c.coachSlug === coachSlug)
  }
  const { data, error } = await supabase
    .from('pending_content')
    .select('*')
    .eq('coach_slug', coachSlug)
    .order('submitted_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(r => rowToContent(r as Record<string, unknown>))
}

/** Submit a new blog post or meet for head-coach review. */
export async function submitContent(
  item: Omit<PendingContent, 'id' | 'submittedAt' | 'status'>,
  isDemo: boolean,
): Promise<PendingContent> {
  if (!useDB(isDemo)) {
    const newItem: PendingContent = {
      ...item,
      id: Math.random().toString(36).slice(2, 12),
      status: 'pending',
      submittedAt: new Date().toISOString(),
    }
    getDemoStore().push(newItem)
    return newItem
  }
  const { data, error } = await supabase
    .from('pending_content')
    .insert([contentToRow(item)])
    .select()
    .single()
  if (error) throw new Error(error.message)
  return rowToContent(data as Record<string, unknown>)
}

/** Approve or reject a pending item (head coach only). */
export async function reviewContent(
  id: string,
  status: ContentStatus,
  rejectionNote: string | undefined,
  isDemo: boolean,
): Promise<void> {
  if (!useDB(isDemo)) {
    const store = getDemoStore()
    const idx = store.findIndex(c => c.id === id)
    if (idx >= 0) store[idx] = { ...store[idx], status, reviewedAt: new Date().toISOString(), ...(rejectionNote ? { rejectionNote } : {}) }
    return
  }
  const update: Record<string, unknown> = {
    status,
    reviewed_at: new Date().toISOString(),
  }
  if (rejectionNote) update.rejection_note = sanitize(rejectionNote, 500)
  const { error } = await supabase
    .from('pending_content')
    .update(update)
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** Delete a content record (withdraw or admin cleanup). */
export async function removeContent(id: string, isDemo: boolean): Promise<void> {
  if (!useDB(isDemo)) {
    const store = getDemoStore()
    const idx = store.findIndex(c => c.id === id)
    if (idx >= 0) store.splice(idx, 1)
    return
  }
  const { error } = await supabase
    .from('pending_content')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** Update the fields of an existing content record (admin edit or direct publish). */
export async function updateContent(
  id: string,
  patch: Partial<Omit<PendingContent, 'id' | 'coachSlug' | 'coachName' | 'submittedAt'>>,
  isDemo: boolean,
): Promise<void> {
  if (!useDB(isDemo)) {
    const store = getDemoStore()
    const idx = store.findIndex(c => c.id === id)
    if (idx >= 0) store[idx] = { ...store[idx], ...patch }
    return
  }
  const row: Record<string, unknown> = {}
  if (patch.status      !== undefined) row.status        = patch.status
  if (patch.reviewedAt  !== undefined) row.reviewed_at   = patch.reviewedAt
  if (patch.title       !== undefined) row.title         = patch.title
  if (patch.subtitle    !== undefined) row.subtitle      = patch.subtitle
  if (patch.tags        !== undefined) row.tags          = patch.tags
  if (patch.summary     !== undefined) row.summary       = patch.summary
  if (patch.content     !== undefined) row.content       = patch.content
  if (patch.meetName    !== undefined) row.meet_name     = patch.meetName
  if (patch.meetDate    !== undefined) row.meet_date     = patch.meetDate
  if (patch.meetLocation !== undefined) row.meet_location = patch.meetLocation
  if (patch.federation  !== undefined) row.federation    = patch.federation
  if (patch.meetType    !== undefined) row.meet_type     = patch.meetType
  if (patch.meetNote    !== undefined) row.meet_note     = patch.meetNote
  if (patch.rejectionNote !== undefined) row.rejection_note = patch.rejectionNote
  const { error } = await supabase.from('pending_content').update(row).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Fetch approved blog posts for the public blog page.
 * isDemo is derived from !supabaseConfigured for public pages.
 */
export async function fetchApprovedPosts(isDemo: boolean): Promise<PendingContent[]> {
  if (!useDB(isDemo)) return getDemoStore().filter(c => c.type === 'blog' && c.status === 'approved')
  const { data, error } = await supabase
    .from('pending_content')
    .select('*')
    .eq('type', 'blog')
    .eq('status', 'approved')
    .order('submitted_at', { ascending: false })
  if (error) return getDemoStore().filter(c => c.type === 'blog' && c.status === 'approved') // graceful fallback
  return (data ?? []).map(r => rowToContent(r as Record<string, unknown>))
}

/**
 * Fetch approved meets for the public Upcoming Meets section.
 * isDemo is derived from !supabaseConfigured for public pages.
 */
export async function fetchApprovedMeets(isDemo: boolean): Promise<PendingContent[]> {
  if (!useDB(isDemo)) return getDemoStore().filter(c => c.type === 'meet' && c.status === 'approved')
  const { data, error } = await supabase
    .from('pending_content')
    .select('*')
    .eq('type', 'meet')
    .eq('status', 'approved')
    .order('submitted_at', { ascending: false })
  if (error) return getDemoStore().filter(c => c.type === 'meet' && c.status === 'approved') // graceful fallback
  return (data ?? []).map(r => rowToContent(r as Record<string, unknown>))
}
