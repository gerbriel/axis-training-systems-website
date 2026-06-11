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
import {
  getPendingContent,
  addPendingContent,
  updateContentStatus,
  deleteContent,
  getApprovedPosts,
  getApprovedMeets,
} from '../data/pendingContent'
import type { PendingContent, ContentStatus } from '../data/pendingContent'
import { sanitize } from '../utils/sanitize'

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
  if (!useDB(isDemo)) return getPendingContent()
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
    return getPendingContent().filter(c => c.coachSlug === coachSlug)
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
  if (!useDB(isDemo)) return addPendingContent(item)
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
    updateContentStatus(id, status, rejectionNote)
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
  if (!useDB(isDemo)) { deleteContent(id); return }
  const { error } = await supabase
    .from('pending_content')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Fetch approved blog posts for the public blog page.
 * isDemo is derived from !supabaseConfigured for public pages.
 */
export async function fetchApprovedPosts(isDemo: boolean): Promise<PendingContent[]> {
  if (!useDB(isDemo)) return getApprovedPosts()
  const { data, error } = await supabase
    .from('pending_content')
    .select('*')
    .eq('type', 'blog')
    .eq('status', 'approved')
    .order('submitted_at', { ascending: false })
  if (error) return getApprovedPosts() // graceful fallback
  return (data ?? []).map(r => rowToContent(r as Record<string, unknown>))
}

/**
 * Fetch approved meets for the public Upcoming Meets section.
 * isDemo is derived from !supabaseConfigured for public pages.
 */
export async function fetchApprovedMeets(isDemo: boolean): Promise<PendingContent[]> {
  if (!useDB(isDemo)) return getApprovedMeets()
  const { data, error } = await supabase
    .from('pending_content')
    .select('*')
    .eq('type', 'meet')
    .eq('status', 'approved')
    .order('submitted_at', { ascending: false })
  if (error) return getApprovedMeets() // graceful fallback
  return (data ?? []).map(r => rowToContent(r as Record<string, unknown>))
}
