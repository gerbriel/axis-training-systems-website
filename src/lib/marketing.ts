/**
 * marketing.ts
 *
 * The Marketing vertical's data layer:
 *   - announcements  — the site-wide banner (public read + admin CRUD)
 *   - a small marketing-analytics summary (signups by source + conversion)
 *
 * No newsletter lives here. The one newsletter Axis has is composed and
 * delivered in `lib/newsletters.ts`, in the app, and this module never touches
 * it. There WAS a second thing here: a hand-kept log of marketing email sent
 * through a mailer that was never wired up. It delivered nothing, nobody ever
 * recorded a row in it, and migration 050 retired it.
 *
 * Demo mode  →  an in-memory store seeded from DEMO_ANNOUNCEMENTS below.
 * Live mode  →  Supabase (migration 028_marketing.sql).
 *
 * Mirrors newsletterApi.ts: sanitize before write, dedupe demo vs live on
 * `supabaseConfigured && !isDemo`, never throw from a public read.
 */

import { supabase, supabaseConfigured } from './supabase'
import { sanitize, sanitizeText, safeUrl } from '../utils/sanitize'
import { fetchNewsletterLeads } from './newsletterApi'
import { parseAudience, DEFAULT_NEW_ACCOUNT_DAYS, type AudienceTarget } from './announceTargeting'

// ── Types ───────────────────────────────────────────────────────────────────

export type AnnouncementKind = 'info' | 'promo' | 'alert'

export interface Announcement {
  id: string
  title: string
  body: string | null
  kind: AnnouncementKind
  isActive: boolean
  startsAt: string | null
  endsAt: string | null
  ctaLabel: string | null
  ctaUrl: string | null
  /**
   * Who the banner renders for (031). Presentation only: every live row is
   * readable by everybody, so this decides display and never confidentiality.
   * Always present, defaulting to `{ type: 'all' }`.
   */
  targetAudience: AudienceTarget
  /** Highest wins when several rows are live at once. Ties break on newest. */
  priority: number
  createdAt: string
  updatedAt: string
}

/** The fields an admin edits. Everything else is set by the database. */
export interface AnnouncementInput {
  title: string
  body?: string | null
  kind: AnnouncementKind
  isActive: boolean
  startsAt?: string | null
  endsAt?: string | null
  ctaLabel?: string | null
  ctaUrl?: string | null
  /** Omitted means everybody. Normalised on write, see cleanAudience. */
  targetAudience?: AudienceTarget | null
  /** Omitted means 0. */
  priority?: number | null
}

export interface MarketingSummary {
  totalSignups: number
  bySource: { source: string; count: number }[]
  /** Last-30-day signups, for the "recent" headline. */
  recentSignups: number
  /** Pageviews over the same 30-day window, when analytics are readable. */
  pageviews: number | null
  /** signups / pageviews as a percentage, or null when pageviews is null/0. */
  conversionRate: number | null
}

// ── Columns / mapping ────────────────────────────────────────────────────────

// created_by is intentionally absent — 028 does not grant it on select.
// target_audience and priority arrive with 031, which re-issues that same
// column grant; without the migration this select fails and the banner is
// simply absent (fetchLiveAnnouncements answers null rather than throwing).
// One string literal, not a concatenation: supabase-js infers the row type from
// the literal text of the select list, and an expression makes it give up.
const ANN_COLS =
  'id, title, body, kind, is_active, starts_at, ends_at, cta_label, cta_url, target_audience, priority, created_at, updated_at'

function toAnnouncement(row: Record<string, unknown>): Announcement {
  return {
    id:        String(row.id),
    title:     String(row.title ?? ''),
    body:      row.body == null ? null : String(row.body),
    kind:      (row.kind as AnnouncementKind) ?? 'info',
    isActive:  Boolean(row.is_active),
    startsAt:  row.starts_at == null ? null : String(row.starts_at),
    endsAt:    row.ends_at   == null ? null : String(row.ends_at),
    ctaLabel:  row.cta_label == null ? null : String(row.cta_label),
    ctaUrl:    row.cta_url   == null ? null : String(row.cta_url),
    // An unparseable or absent audience reads as "everybody", the same
    // fail-open announceTargeting applies at render time.
    targetAudience: parseAudience(row.target_audience) ?? { type: 'all' },
    priority:       cleanPriority(row.priority),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  }
}

// ── Demo seed ────────────────────────────────────────────────────────────────
//
// Local to this module — demoData.ts is not ours to edit. One live announcement
// (so the banner has something to render in the demo), one scheduled and one
// expired (so the panel's schedule states are visible without setup).

const DAY = 24 * 60 * 60 * 1000
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

const DEMO_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'ann-live', title: 'Spring Meet Prep is open',
    body: 'Eight-week peaking blocks with a coach. A few spots left before the March meet.',
    kind: 'promo', isActive: true,
    startsAt: iso(-2 * DAY), endsAt: iso(14 * DAY),
    ctaLabel: 'See the programs', ctaUrl: '/book',
    targetAudience: { type: 'all' }, priority: 10,
    createdAt: iso(-2 * DAY), updatedAt: iso(-2 * DAY),
  },
  {
    id: 'ann-scheduled', title: 'Gym closed for the holiday',
    body: 'The facility is closed Dec 25. Online coaching continues as normal.',
    kind: 'alert', isActive: true,
    startsAt: iso(20 * DAY), endsAt: iso(22 * DAY),
    ctaLabel: null, ctaUrl: null,
    // Signed-in only, so the demo panel has an audience chip to render.
    targetAudience: { type: 'authenticated' }, priority: 0,
    createdAt: iso(-5 * DAY), updatedAt: iso(-5 * DAY),
  },
  {
    id: 'ann-expired', title: 'New RPE guide is live',
    body: 'A free breakdown of autoregulated training. Grab it on the guides page.',
    kind: 'info', isActive: false,
    startsAt: iso(-40 * DAY), endsAt: iso(-20 * DAY),
    ctaLabel: 'Read it', ctaUrl: '/guides',
    targetAudience: { type: 'new_accounts', days: 14 }, priority: 0,
    createdAt: iso(-40 * DAY), updatedAt: iso(-20 * DAY),
  },
]

let _demoAnnouncements: Announcement[] | null = null

function annStore(): Announcement[] {
  if (!_demoAnnouncements) _demoAnnouncements = DEMO_ANNOUNCEMENTS.map(a => ({ ...a }))
  return _demoAnnouncements
}

function useDemo(isDemo: boolean): boolean {
  return isDemo || !supabaseConfigured
}

/** True when a row is `is_active` and now() is inside its optional window. */
export function isLive(a: Announcement, at: number = Date.now()): boolean {
  if (!a.isActive) return false
  const s = a.startsAt ? new Date(a.startsAt).getTime() : -Infinity
  const e = a.endsAt   ? new Date(a.endsAt).getTime()   :  Infinity
  return s <= at && at <= e
}

// ── Input cleaning ───────────────────────────────────────────────────────────

/** Throws on invalid input; returns the row shape 028 expects. */
function cleanAnnouncement(input: AnnouncementInput): Record<string, unknown> {
  const title = sanitizeText(String(input.title ?? '').trim(), 160)
  if (!title) throw new Error('An announcement needs a title.')

  const body = input.body ? sanitizeText(String(input.body).trim(), 600) : null
  const kind: AnnouncementKind =
    input.kind === 'promo' || input.kind === 'alert' ? input.kind : 'info'

  // safeUrl accepts http(s), mailto and rooted paths and rejects the rest; the
  // DB check is stricter (http(s) or `^/`), so narrow to that here for a clear
  // client-side error rather than a raw constraint violation.
  let ctaUrl: string | null = null
  if (input.ctaUrl && input.ctaUrl.trim()) {
    const safe = safeUrl(input.ctaUrl.trim())
    if (!safe || !/^(https?:\/\/|\/)/i.test(safe)) {
      throw new Error('The button link must be an https:// URL or a path starting with /.')
    }
    ctaUrl = safe
  }
  const ctaLabel = input.ctaLabel ? sanitizeText(String(input.ctaLabel).trim(), 60) : null

  const startsAt = normalizeTs(input.startsAt)
  const endsAt   = normalizeTs(input.endsAt)
  if (startsAt && endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
    throw new Error('The end date is before the start date.')
  }

  return {
    title,
    body,
    kind,
    is_active:  Boolean(input.isActive),
    starts_at:  startsAt,
    ends_at:    endsAt,
    cta_label:  ctaUrl ? ctaLabel : null,   // a label with no link is dropped
    cta_url:    ctaUrl,
    target_audience: cleanAudience(input.targetAudience),
    priority:        cleanPriority(input.priority),
  }
}

function normalizeTs(v: string | null | undefined): string | null {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/**
 * The audience, in the shape 031's `announcements_audience_shape` accepts.
 * Anything unrecognised becomes `{ type: 'all' }` rather than a 23514 the
 * panel would have to explain: a bad audience is a display bug, not a reason
 * to refuse somebody's announcement.
 *
 * `days` is always written for new_accounts because the check requires it, and
 * `roles` only where it means something, so no row carries a key the reader
 * would ignore.
 */
function cleanAudience(value: AudienceTarget | null | undefined): Record<string, unknown> {
  const target = parseAudience(value) ?? { type: 'all' as const }
  const row: Record<string, unknown> = { type: target.type }

  if ((target.type === 'role' || target.type === 'new_accounts')
      && target.roles && target.roles.length > 0) {
    row.roles = target.roles
  }
  if (target.type === 'new_accounts') {
    row.days = target.days ?? DEFAULT_NEW_ACCOUNT_DAYS
  }
  return row
}

/** A whole number, well inside int range so a typo cannot 22003 the insert. */
function cleanPriority(value: unknown): number {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return 0
  return Math.max(-9999, Math.min(9999, Math.trunc(n)))
}

// ── Announcements: public read ───────────────────────────────────────────────

/** At most this many live rows reach the client. A banner shows one. */
const LIVE_LIMIT = 20

/**
 * Every currently-live announcement, best first: priority descending, then
 * newest. Null means the read failed, which the banner treats exactly like an
 * empty list.
 *
 * Public, and it never throws, so a banner failure never blocks a page.
 *
 * The schedule window is re-checked here rather than in the query. RLS already
 * hides out-of-window rows from an ordinary visitor, but the admin policy does
 * not, so a signed-in admin would otherwise see tomorrow's banner today. The
 * fetch limit is generous for the same reason: it is applied before the window
 * filter, so it has to leave room for the scheduled rows it may pull back.
 */
export async function fetchLiveAnnouncements(isDemo = false): Promise<Announcement[] | null> {
  if (useDemo(isDemo)) {
    return annStore().filter(a => isLive(a)).sort(byPriorityDesc).slice(0, LIVE_LIMIT)
  }
  try {
    const { data, error } = await supabase
      .from('announcements')
      .select(ANN_COLS)
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIVE_LIMIT * 3)
    if (error || !data) return null
    return (data as Record<string, unknown>[])
      .map(toAnnouncement)
      .filter(a => isLive(a))
      .sort(byPriorityDesc)
      .slice(0, LIVE_LIMIT)
  } catch {
    return null
  }
}

/**
 * The single announcement to render in the site banner right now, or null.
 * Public — never throws, so a banner failure never blocks a page.
 *
 * Kept for callers that do not do their own targeting: it is the top of the
 * live list, so it now respects priority. A caller that knows who the viewer
 * is should read fetchLiveAnnouncements and pass the list to
 * selectAnnouncement in announceTargeting.ts instead.
 */
export async function fetchActiveAnnouncement(isDemo = false): Promise<Announcement | null> {
  const live = await fetchLiveAnnouncements(isDemo)
  return live?.[0] ?? null
}

function byCreatedDesc(a: Announcement, b: Announcement): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
}

function byPriorityDesc(a: Announcement, b: Announcement): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  return byCreatedDesc(a, b)
}

// ── Announcements: admin CRUD ────────────────────────────────────────────────

/** Every announcement, newest first — admin only (RLS). */
export async function listAnnouncements(isDemo = false): Promise<Announcement[]> {
  if (useDemo(isDemo)) return annStore().slice().sort(byCreatedDesc)

  const { data, error } = await supabase
    .from('announcements')
    .select(ANN_COLS)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(r => toAnnouncement(r as Record<string, unknown>))
}

export async function createAnnouncement(input: AnnouncementInput, isDemo = false): Promise<Announcement> {
  const row = cleanAnnouncement(input)

  if (useDemo(isDemo)) {
    const now = new Date().toISOString()
    const created: Announcement = toAnnouncement({ ...row, id: 'ann-' + rid(), created_at: now, updated_at: now })
    annStore().unshift(created)
    return created
  }

  const { data, error } = await supabase
    .from('announcements')
    .insert([row])
    .select(ANN_COLS)
    .single()
  if (error) throw new Error(error.message)
  return toAnnouncement(data as Record<string, unknown>)
}

export async function updateAnnouncement(id: string, input: AnnouncementInput, isDemo = false): Promise<Announcement> {
  const row = cleanAnnouncement(input)

  if (useDemo(isDemo)) {
    const store = annStore()
    const i = store.findIndex(a => a.id === id)
    if (i === -1) throw new Error('Announcement not found.')
    const updated = toAnnouncement({ ...row, id, created_at: store[i].createdAt, updated_at: new Date().toISOString() })
    store[i] = updated
    return updated
  }

  const { data, error } = await supabase
    .from('announcements')
    .update(row)
    .eq('id', id)
    .select(ANN_COLS)
    .single()
  if (error) throw new Error(error.message)
  return toAnnouncement(data as Record<string, unknown>)
}

/** Flip is_active without touching the rest of the row. */
export async function setAnnouncementActive(id: string, active: boolean, isDemo = false): Promise<void> {
  if (useDemo(isDemo)) {
    const a = annStore().find(x => x.id === id)
    if (a) { a.isActive = active; a.updatedAt = new Date().toISOString() }
    return
  }
  const { error } = await supabase.from('announcements').update({ is_active: active }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteAnnouncement(id: string, isDemo = false): Promise<void> {
  if (useDemo(isDemo)) {
    const store = annStore()
    const i = store.findIndex(a => a.id === id)
    if (i !== -1) store.splice(i, 1)
    return
  }
  const { error } = await supabase.from('announcements').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Marketing analytics summary ──────────────────────────────────────────────

/**
 * Signups by source + a conversion read. Reuses the newsletter list for the
 * signup side; reads `pageviews` for the denominator when it is readable
 * (admins only, RLS) and quietly reports null conversion when it is not.
 */
export async function fetchMarketingSummary(isDemo = false): Promise<MarketingSummary> {
  const leads = await fetchNewsletterLeads(isDemo)

  const counts = new Map<string, number>()
  for (const l of leads) counts.set(l.source, (counts.get(l.source) ?? 0) + 1)
  const bySource = Array.from(counts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)

  const since = Date.now() - 30 * DAY
  const recentSignups = leads.filter(l => new Date(l.createdAt).getTime() >= since).length

  let pageviews: number | null = null
  if (!useDemo(isDemo)) {
    try {
      const { count, error } = await supabase
        .from('pageviews')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', new Date(since).toISOString())
      if (!error && typeof count === 'number') pageviews = count
    } catch { /* not readable — leave null */ }
  } else {
    // A believable demo denominator so the conversion tile isn't blank.
    pageviews = 1200 + leads.length * 40
  }

  const conversionRate =
    pageviews && pageviews > 0 ? (recentSignups / pageviews) * 100 : null

  return {
    totalSignups: leads.length,
    bySource,
    recentSignups,
    pageviews,
    conversionRate,
  }
}

// ── misc ─────────────────────────────────────────────────────────────────────

function rid(): string {
  return Math.random().toString(36).slice(2, 12)
}

/** Human label for a newsletter source key, shared with the panels. */
export function sourceLabel(source: string): string {
  const LABELS: Record<string, string> = {
    guides_page:     'Guides Page',
    attempt_planner: 'Attempt Planner',
    meet_checklist:  'Meet Day Checklist',
    quiz:            'Training Quiz',
    rpe_guide:       'RPE Guide',
    big_three:       'Big Three Guide',
    audit_worksheet: 'Audit Worksheet',
  }
  return LABELS[source] ?? sanitize(source, 60)
}
