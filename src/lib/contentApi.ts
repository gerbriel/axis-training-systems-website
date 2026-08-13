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
import { sanitizeText } from '../utils/sanitize'
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
  // sanitizeText, not sanitize: every one of these is rendered as a React TEXT
  // node, and React escapes those already. Escaping here as well double-encoded
  // them, so a post reading "it's a 8/9 week block" reached the blog as
  // "it&#x27;s a 8&#x2F;9 week block". Same call testimonialsApi makes, for the
  // same reason — the tag, protocol and handler stripping is unchanged.
  const str = (v: unknown, max = 500) =>
    typeof v === 'string' && v ? sanitizeText(v, max) : undefined

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

/**
 * The bound on what actually reaches Postgres.
 *
 * Until now the only length limit on any of these was the `maxLength` attribute
 * on the editor's inputs — a DOM property, one devtools edit or one paste-into-
 * a-reordered-array away from not existing, on a table any signed-in coach can
 * insert into. The numbers match what rowToContent truncates to on the way back
 * out, so nothing is stored that could never be displayed.
 *
 * `content` is a JSON blob of sections rather than prose, so it is capped but
 * not stripped — the strip happens per-field on read.
 */
const FIELD_MAX = {
  title: 200, subtitle: 300, tags: 200, summary: 1000, content: 8000,
  meetName: 200, meetDate: 100, meetLocation: 200, federation: 50, meetNote: 300,
  rejectionNote: 500,
} as const

const cap = (v: string | undefined, max: number): string | null =>
  typeof v === 'string' && v ? sanitizeText(v, max) || null : null

const capRaw = (v: string | undefined, max: number): string | null =>
  typeof v === 'string' && v ? v.slice(0, max) : null

function contentToRow(item: Omit<PendingContent, 'id' | 'submittedAt' | 'status'>) {
  return {
    type:          item.type,
    coach_slug:    item.coachSlug,
    coach_name:    item.coachName,
    // Blog
    title:         cap(item.title,        FIELD_MAX.title),
    subtitle:      cap(item.subtitle,     FIELD_MAX.subtitle),
    tags:          cap(item.tags,         FIELD_MAX.tags),
    summary:       cap(item.summary,      FIELD_MAX.summary),
    content:       capRaw(item.content,   FIELD_MAX.content),
    // Meet
    meet_name:     cap(item.meetName,     FIELD_MAX.meetName),
    meet_date:     cap(item.meetDate,     FIELD_MAX.meetDate),
    meet_location: cap(item.meetLocation, FIELD_MAX.meetLocation),
    federation:    cap(item.federation,   FIELD_MAX.federation),
    meet_type:     item.meetType      ?? null,
    meet_note:     cap(item.meetNote,     FIELD_MAX.meetNote),
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
  if (rejectionNote) update.rejection_note = sanitizeText(rejectionNote, 500)
  // .select() for the same reason as updateContent: RLS refuses by matching no
  // rows, which PostgREST reports as a 204 success. Without this, a signed-in
  // coach who is not a content admin can click Approve and be told it worked.
  const { data, error } = await supabase
    .from('pending_content')
    .update(update)
    .eq('id', id)
    .select('id')

  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('That review could not be applied — you may not have permission, or the item no longer exists.')
  }
}

/** Delete a content record (withdraw or admin cleanup). */
export async function removeContent(id: string, isDemo: boolean): Promise<void> {
  if (!useDB(isDemo)) {
    const store = getDemoStore()
    const idx = store.findIndex(c => c.id === id)
    if (idx < 0) throw new Error('That submission no longer exists.')
    store.splice(idx, 1)
    return
  }
  // coach_delete_own_pending only matches status='pending', so withdrawing an
  // already-reviewed item deletes nothing. Silently, until now: the row simply
  // reappeared on the next refresh.
  const { data, error } = await supabase
    .from('pending_content')
    .delete()
    .eq('id', id)
    .select('id')

  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('That submission could not be withdrawn — it has already been reviewed.')
  }
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
    if (idx < 0) throw new Error('That submission no longer exists.')
    store[idx] = { ...store[idx], ...patch }
    return
  }
  const row: Record<string, unknown> = {}
  if (patch.status      !== undefined) row.status        = patch.status
  if (patch.reviewedAt  !== undefined) row.reviewed_at   = patch.reviewedAt
  // Capped for the same reason contentToRow is — an edit is a write too.
  if (patch.title       !== undefined) row.title         = cap(patch.title,        FIELD_MAX.title)
  if (patch.subtitle    !== undefined) row.subtitle      = cap(patch.subtitle,     FIELD_MAX.subtitle)
  if (patch.tags        !== undefined) row.tags          = cap(patch.tags,         FIELD_MAX.tags)
  if (patch.summary     !== undefined) row.summary       = cap(patch.summary,      FIELD_MAX.summary)
  if (patch.content     !== undefined) row.content       = capRaw(patch.content,   FIELD_MAX.content)
  if (patch.meetName    !== undefined) row.meet_name     = cap(patch.meetName,     FIELD_MAX.meetName)
  if (patch.meetDate    !== undefined) row.meet_date     = cap(patch.meetDate,     FIELD_MAX.meetDate)
  if (patch.meetLocation !== undefined) row.meet_location = cap(patch.meetLocation, FIELD_MAX.meetLocation)
  if (patch.federation  !== undefined) row.federation    = cap(patch.federation,   FIELD_MAX.federation)
  if (patch.meetType    !== undefined) row.meet_type     = patch.meetType
  if (patch.meetNote    !== undefined) row.meet_note     = cap(patch.meetNote,     FIELD_MAX.meetNote)
  if (patch.rejectionNote !== undefined) row.rejection_note = cap(patch.rejectionNote, FIELD_MAX.rejectionNote)
  // .select() is load-bearing, not decoration. Without it PostgREST answers an
  // RLS-refused UPDATE with 204 and no error — so a coach editing a post the
  // head coach had just approved (coach_update_own_unapproved only matches
  // 'pending'/'rejected') got a cheerful "Saved", an empty form, and a rewrite
  // that reached nobody. A write that changed no rows is a failed write.
  const { data, error } = await supabase
    .from('pending_content')
    .update(row)
    .eq('id', id)
    .select('id')

  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('This submission can no longer be edited — it may have been approved or withdrawn. Copy your text somewhere safe and refresh.')
  }
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
  if (error) {
    // Keep the public blog rendering, but never fail silently — a swallowed
    // error here (e.g. missing table) looks identical to "no posts yet".
    console.error('[content] could not load approved posts:', error.message)
    return getDemoStore().filter(c => c.type === 'blog' && c.status === 'approved')
  }
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
  if (error) {
    console.error('[content] could not load approved meets:', error.message)
    return getDemoStore().filter(c => c.type === 'meet' && c.status === 'approved')
  }
  return (data ?? []).map(r => rowToContent(r as Record<string, unknown>))
}
