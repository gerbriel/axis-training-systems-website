/**
 * testimonialsApi.ts
 *
 * Unified async API for coach testimonials.
 *
 * Routing (same convention as contentApi.ts):
 *   isDemo=true  OR  !supabaseConfigured  →  in-memory demo store
 *   supabaseConfigured + live session      →  Supabase `coach_testimonials` table
 *
 * Page assignment:
 *   showOnCoach  → /coaches/<slug>. Coach controls it; publishes immediately.
 *   mainStatus   → homepage. Coach can only request ('pending'); the head coach
 *                  approves. Enforced server-side by a trigger (migration 004),
 *                  not just here.
 */

import { supabase, supabaseConfigured } from './supabase'
import { sanitizeText, safeUrl } from '../utils/sanitize'
import { SEED_TESTIMONIALS } from '../data/testimonials'
import type { Testimonial, MainStatus } from '../data/testimonials'

// Columns the public (anon) role is allowed to read. Deliberately omits
// rejection_note (the head coach's private feedback) and reviewed_at. Migration
// 006 revokes SELECT on rejection_note from anon, so a `select('*')` as anon
// would 403 — the public fetches below must request exactly these columns.
const PUBLIC_COLS = 'id, coach_slug, coach_name, quote, athlete, result, photo, show_on_coach, main_status, created_at'

// ── In-memory demo store ────────────────────────────────────────────────────
// Seeded from the static testimonials in coaches.ts. Resets on reload.
let _demoStore: Testimonial[] | null = null

function getDemoStore(): Testimonial[] {
  if (!_demoStore) _demoStore = SEED_TESTIMONIALS.map(t => ({ ...t }))
  return _demoStore
}

function useDB(isDemo: boolean): boolean {
  return supabaseConfigured && !isDemo
}

// ── DB ↔ app field mapping ──────────────────────────────────────────────────

function rowToTestimonial(row: Record<string, unknown>): Testimonial {
  // Display fields render as React text nodes → sanitizeText (no HTML escaping,
  // or apostrophes/slashes would show as literal &#x27;/&#x2F; entities).
  const txt = (v: unknown, max = 500) =>
    typeof v === 'string' && v ? sanitizeText(v, max) : undefined

  return {
    id:            String(row.id),
    coachSlug:     String(row.coach_slug),
    coachName:     String(row.coach_name),
    quote:         txt(row.quote, 1500) ?? '',
    athlete:       txt(row.athlete, 200) ?? '',
    result:        txt(row.result, 200) ?? '',
    // A coach types this one into their portal and four screens render it as an
    // `src`. Checked here rather than at each of them, so a scheme that should
    // never reach a DOM attribute cannot arrive through the one that was missed.
    photo:         safeUrl(row.photo),
    showOnCoach:   row.show_on_coach === true,
    mainStatus:    (row.main_status as MainStatus) ?? 'none',
    rejectionNote: txt(row.rejection_note, 500),
    createdAt:     String(row.created_at),
    reviewedAt:    typeof row.reviewed_at === 'string' ? row.reviewed_at : undefined,
  }
}

export type TestimonialInput = Pick<
  Testimonial,
  'coachSlug' | 'coachName' | 'quote' | 'athlete' | 'result' | 'photo' | 'showOnCoach'
> & {
  /** true → request the homepage (goes to 'pending'). false → coach page only. */
  requestMainPage: boolean
}

/**
 * The bound on what reaches Postgres. Previously the only length limit was the
 * `maxLength` attribute on the manager's inputs — a DOM property, and this
 * table takes inserts from any signed-in coach. The numbers match what
 * rowToTestimonial truncates to on the way back out.
 */
const FIELD_MAX = { quote: 1500, athlete: 200, result: 200, photo: 1000 } as const

function inputToRow(item: TestimonialInput) {
  return {
    coach_slug:    item.coachSlug,
    coach_name:    item.coachName,
    quote:         sanitizeText(item.quote,   FIELD_MAX.quote),
    athlete:       sanitizeText(item.athlete, FIELD_MAX.athlete),
    result:        sanitizeText(item.result,  FIELD_MAX.result),
    photo:         safeUrl(item.photo)?.slice(0, FIELD_MAX.photo) ?? null,
    show_on_coach: item.showOnCoach,
    // A coach can only ever REQUEST the main page. Never 'approved' from here.
    main_status:   item.requestMainPage ? 'pending' : 'none',
  }
}

// ── Coach portal ────────────────────────────────────────────────────────────

/** Every testimonial belonging to one coach, newest first. */
export async function fetchMyTestimonials(
  coachSlug: string,
  isDemo: boolean,
): Promise<Testimonial[]> {
  if (!useDB(isDemo)) {
    return getDemoStore()
      .filter(t => t.coachSlug === coachSlug)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  const { data, error } = await supabase
    .from('coach_testimonials')
    .select('*')
    .eq('coach_slug', coachSlug)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(r => rowToTestimonial(r as Record<string, unknown>))
}

export async function createTestimonial(
  item: TestimonialInput,
  isDemo: boolean,
): Promise<Testimonial> {
  if (!useDB(isDemo)) {
    const newItem: Testimonial = {
      id:          Math.random().toString(36).slice(2, 12),
      coachSlug:   item.coachSlug,
      coachName:   item.coachName,
      quote:       item.quote,
      athlete:     item.athlete,
      result:      item.result,
      photo:       item.photo,
      showOnCoach: item.showOnCoach,
      mainStatus:  item.requestMainPage ? 'pending' : 'none',
      createdAt:   new Date().toISOString(),
    }
    getDemoStore().unshift(newItem)
    return newItem
  }
  const { data, error } = await supabase
    .from('coach_testimonials')
    .insert([inputToRow(item)])
    .select()
    .single()
  if (error) throw new Error(error.message)
  return rowToTestimonial(data as Record<string, unknown>)
}

/**
 * Edit a testimonial the coach owns.
 *
 * Note: if the testimonial is already approved for the homepage and the coach
 * changes its visible copy, the DB trigger silently knocks main_status back to
 * 'pending'. Callers should re-fetch rather than assume their patch stuck.
 */
export async function updateTestimonial(
  id: string,
  patch: Partial<TestimonialInput>,
  isDemo: boolean,
): Promise<void> {
  if (!useDB(isDemo)) {
    const store = getDemoStore()
    const idx = store.findIndex(t => t.id === id)
    if (idx < 0) return
    const prev = store[idx]
    const next: Testimonial = { ...prev }
    if (patch.quote       !== undefined) next.quote       = patch.quote
    if (patch.athlete     !== undefined) next.athlete     = patch.athlete
    if (patch.result      !== undefined) next.result      = patch.result
    if (patch.photo       !== undefined) next.photo       = patch.photo
    if (patch.showOnCoach !== undefined) next.showOnCoach = patch.showOnCoach
    if (patch.requestMainPage !== undefined) {
      next.mainStatus = patch.requestMainPage
        // Asking for the main page again after a rejection re-queues it.
        ? (prev.mainStatus === 'approved' ? 'approved' : 'pending')
        : 'none'
      // Re-requesting clears any prior decline note (mirrors the DB write below).
      if (patch.requestMainPage) next.rejectionNote = undefined
    }
    // Mirror the DB trigger: editing approved homepage copy sends it back for
    // review — UNLESS the coach explicitly pulled it from the main page ('none').
    const copyChanged =
      next.quote !== prev.quote || next.athlete !== prev.athlete ||
      next.result !== prev.result || (next.photo ?? '') !== (prev.photo ?? '')
    if (prev.mainStatus === 'approved' && copyChanged && next.mainStatus !== 'none') {
      next.mainStatus = 'pending'
      next.reviewedAt = undefined
    }
    store[idx] = next
    return
  }

  const row: Record<string, unknown> = {}
  // Capped and scheme-checked for the same reason inputToRow is: an edit is a
  // write too, and the photo lands in an `img src` on four screens.
  if (patch.quote       !== undefined) row.quote         = sanitizeText(patch.quote,   FIELD_MAX.quote)
  if (patch.athlete     !== undefined) row.athlete       = sanitizeText(patch.athlete, FIELD_MAX.athlete)
  if (patch.result      !== undefined) row.result        = sanitizeText(patch.result,  FIELD_MAX.result)
  if (patch.photo       !== undefined) row.photo         = safeUrl(patch.photo)?.slice(0, FIELD_MAX.photo) ?? null
  if (patch.showOnCoach !== undefined) row.show_on_coach = patch.showOnCoach

  // Only ever downgrade to 'none' or request 'pending' from the coach side.
  // Re-approving is the head coach's job (and the trigger rejects it from here).
  if (patch.requestMainPage === false) row.main_status = 'none'

  const { error } = await supabase.from('coach_testimonials').update(row).eq('id', id)
  if (error) throw new Error(error.message)

  // Requesting the main page for a not-yet-approved testimonial is a separate,
  // trigger-safe transition ('none'/'rejected' → 'pending').
  if (patch.requestMainPage === true) {
    const { error: reqErr } = await supabase
      .from('coach_testimonials')
      .update({ main_status: 'pending', rejection_note: null })
      .eq('id', id)
      .neq('main_status', 'approved')
    if (reqErr) throw new Error(reqErr.message)
  }
}

export async function deleteTestimonial(id: string, isDemo: boolean): Promise<void> {
  if (!useDB(isDemo)) {
    const store = getDemoStore()
    const idx = store.findIndex(t => t.id === id)
    if (idx >= 0) store.splice(idx, 1)
    return
  }
  const { error } = await supabase.from('coach_testimonials').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Head coach (master admin) ───────────────────────────────────────────────

/** Every testimonial from every coach — the admin approval queue. */
export async function fetchAllTestimonials(isDemo: boolean): Promise<Testimonial[]> {
  if (!useDB(isDemo)) {
    return [...getDemoStore()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  const { data, error } = await supabase
    .from('coach_testimonials')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(r => rowToTestimonial(r as Record<string, unknown>))
}

/** Approve or reject a coach's request to put a testimonial on the homepage. */
export async function reviewTestimonial(
  id: string,
  status: Extract<MainStatus, 'approved' | 'rejected'>,
  rejectionNote: string | undefined,
  isDemo: boolean,
): Promise<void> {
  if (!useDB(isDemo)) {
    const store = getDemoStore()
    const idx = store.findIndex(t => t.id === id)
    if (idx >= 0) {
      store[idx] = {
        ...store[idx],
        mainStatus: status,
        reviewedAt: new Date().toISOString(),
        rejectionNote: rejectionNote || undefined,
      }
    }
    return
  }
  const update: Record<string, unknown> = {
    main_status: status,
    reviewed_at: new Date().toISOString(),
  }
  update.rejection_note = rejectionNote ? sanitizeText(rejectionNote, 500) : null

  const { error } = await supabase.from('coach_testimonials').update(update).eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Public site ─────────────────────────────────────────────────────────────
// Both fall back to the static seed on error so the public pages can never end
// up with an empty testimonials section (same posture as fetchApprovedPosts).

/** Testimonials for one coach's public page. */
export async function fetchCoachPageTestimonials(
  coachSlug: string,
  isDemo: boolean,
): Promise<Testimonial[]> {
  const fallback = () =>
    SEED_TESTIMONIALS
      .filter(t => t.coachSlug === coachSlug && t.showOnCoach)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  if (!useDB(isDemo)) {
    return getDemoStore()
      .filter(t => t.coachSlug === coachSlug && t.showOnCoach)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  const { data, error } = await supabase
    .from('coach_testimonials')
    .select(PUBLIC_COLS)
    .eq('coach_slug', coachSlug)
    .eq('show_on_coach', true)
    .order('created_at', { ascending: false })
  if (error) return fallback()
  return (data ?? []).map(r => rowToTestimonial(r as Record<string, unknown>))
}

/** Approved-for-homepage testimonials, newest first. */
export async function fetchMainPageTestimonials(isDemo: boolean): Promise<Testimonial[]> {
  const fallback = () =>
    SEED_TESTIMONIALS
      .filter(t => t.mainStatus === 'approved')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  if (!useDB(isDemo)) {
    return getDemoStore()
      .filter(t => t.mainStatus === 'approved')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  const { data, error } = await supabase
    .from('coach_testimonials')
    .select(PUBLIC_COLS)
    .eq('main_status', 'approved')
    .order('created_at', { ascending: false })
  if (error) return fallback()
  return (data ?? []).map(r => rowToTestimonial(r as Record<string, unknown>))
}
