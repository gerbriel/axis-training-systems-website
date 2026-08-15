import { supabase, supabaseConfigured } from './supabase.ts'
import { COACHES } from '../data/coaches.ts'
import type { Coach, CoachService } from '../data/coaches.ts'
import type { WriteResult } from '../types/messaging.ts'

/**
 * The public roster, out of the bundle and into the database.
 *
 * `src/data/coaches.ts` is still there and still matters. It holds two things
 * this module deliberately does not touch:
 *
 *   `Coach.email` is a CREDENTIAL. CoachAdmin.tsx gates the per-coach portal on
 *   `session.user.email === coach.email`. If that comparison ever read a column
 *   an admin can type into, "manage staff" would quietly become "grant yourself
 *   somebody else's portal". Migration 032 has no email column, and
 *   `toCoachShape` copies the address off the static entry rather than inventing
 *   one. A DB-only coach with no static entry gets `email: ''`, which matches
 *   no session. See the note on that function.
 *
 *   Testimonials already live in `coach_testimonials` (006) with a moderation
 *   status. They are merged in from the static array here for rendering and are
 *   never written by anything below.
 *
 * So the file owns identity, the table owns presentation, and this module is
 * the seam. It is also the reason the roster cannot go blank: every read
 * answers `null` for an outage, and the components fall back to `COACHES`.
 *
 * Nothing here throws. Reads answer `null` for an outage and `[]` for genuinely
 * empty, because a screen says something different for each. Writes answer a
 * `WriteResult` or a small payload, with the database's own refusal sentence
 * passed through when it wrote one. Every function routes on `offline(isDemo)`
 * first, so the whole surface works with no credentials at all.
 */

export type { WriteResult }

// ---------------------------------------------------------------------------
// The contract with migration 032
// ---------------------------------------------------------------------------

/** One row of `stats`: a label and the number under it, both free text. */
export interface CoachStat {
  label: string
  value: string
}

/**
 * One row of `coach_profiles`. Hand-written to match 032 column for column;
 * change a column, change this. `updated_by` is absent on purpose: it is in no
 * insert or update grant, nothing on screen shows it, and the anon select grant
 * does not include it.
 */
export interface CoachProfileRow {
  id: string
  slug: string
  name: string
  first_name: string | null
  role_title: string | null
  tagline: string | null
  philosophy: string | null
  bio: string[]
  specialties: string[]
  stats: CoachStat[]
  services: CoachService[]
  photo_url: string | null
  cta_bg_url: string | null
  book_call_url: string | null
  is_visible: boolean
  sort_order: number
  updated_at: string
}

/**
 * A row rendered as the static `Coach` shape.
 *
 * `slug` widens to `string` and that is the whole difference: `CoachSlug` is a
 * union of the five people in the file, and a coach added from the portal is by
 * definition not one of them. Every `Coach` is assignable to this, so a
 * component can hold either and render one code path.
 */
export interface CoachDisplay extends Omit<Coach, 'slug'> {
  slug: string
}

// Single string literal, never `.join(',')`. postgrest-js parses the select
// string at the type level and a computed one erases to `string`.
export const COACH_PROFILE_COLUMNS =
  'id,slug,name,first_name,role_title,tagline,philosophy,bio,specialties,stats,services,photo_url,cta_bg_url,book_call_url,is_visible,sort_order,updated_at'

/** The column checks in 032, restated so a long paste is trimmed here rather than bouncing off `23514`. */
export const COACH_NAME_LIMIT = 120
export const COACH_ROLE_LIMIT = 120
export const COACH_TAGLINE_LIMIT = 300
export const COACH_PHILOSOPHY_LIMIT = 2000
export const COACH_SLUG_PATTERN = /^[a-z0-9-]+$/

/** No column check behind these four. They stop a paste accident becoming a page nobody can scroll. */
const BIO_PARAGRAPH_LIMIT = 2000
const BIO_PARAGRAPH_MAX = 12
const LIST_ITEM_LIMIT = 200
const LIST_MAX = 24

/**
 * Demo mode and "no credentials configured" are the same situation from a
 * screen's point of view: there is nothing to talk to, and the screen must
 * still render. Every function below routes on this, never on `isDemo` alone.
 */
const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

// ---------------------------------------------------------------------------
// Failure, in sentences
// ---------------------------------------------------------------------------

/**
 * What a PostgREST error becomes on screen.
 *
 * `P0001` is the guard trigger in 032 refusing a coach's attempt to change
 * their own slug, visibility or position, and it writes that refusal as a
 * sentence aimed at a person. It is passed through verbatim, which is the whole
 * reason the rule is a trigger and not a policy. Everything else is plumbing
 * and gets translated.
 */
function writeMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  const code = error.code ?? ''
  const msg = (error.message ?? '').replace(/^ERROR:\s*/i, '').trim()

  if ((code === 'P0001' || code === '22023') && msg) return msg
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'The database refused that change. Your account may not have permission to manage the roster. Sign out, sign back in, and try again.'
  }
  if (code === '23505') return 'Another coach profile already uses that address. Pick a different one.'
  if (code === '23514') {
    return 'That does not fit. Check the lengths, and that every link starts with https:// or with a single /.'
  }
  if (code === 'PGRST301' || /jwt|token is expired/i.test(msg)) {
    return 'Your session expired. Sign in again and the change will go through.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection. Nothing was changed.'
  }
  return fallback
}

/** Zero rows back from a write that named a row. RLS filtered it, or it is gone. */
const NOT_YOURS =
  'That change was not saved. The profile may have been removed, or your account may not have permission to edit it.'

// ---------------------------------------------------------------------------
// Reading a row, defensively
// ---------------------------------------------------------------------------
//
// The four jsonb columns are checked as arrays by 032 and by nothing else. What
// is INSIDE them is whatever the last writer put there, and this module is the
// only thing between that and a render. So every one of these parsers answers
// with a well-formed array or an empty one, and none of them throws: a coach
// whose stats got mangled loses their stats, not their page.

function parseStringArray(value: unknown, limit: number, max: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.trim().slice(0, limit)
    if (text) out.push(text)
    if (out.length >= max) break
  }
  return out
}

/**
 * A list, whatever arrived.
 *
 * The type says `string[]`, and a caller who reads a jsonb column out of one
 * screen and hands it to another can still pass a string. Nothing in this
 * module throws, so nothing in this module calls `.map` on a value it has not
 * checked.
 */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** An object entry, or null. Arrays are objects to `typeof` and are not what we want. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asText(value: unknown, limit: number): string {
  if (typeof value === 'string') return value.trim().slice(0, limit)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function parseStats(value: unknown): CoachStat[] {
  if (!Array.isArray(value)) return []
  const out: CoachStat[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const label = asText(record.label, LIST_ITEM_LIMIT)
    const statValue = asText(record.value, LIST_ITEM_LIMIT)
    if (!label && !statValue) continue
    out.push({ label, value: statValue })
    if (out.length >= LIST_MAX) break
  }
  return out
}

function parseServices(value: unknown): CoachService[] {
  if (!Array.isArray(value)) return []
  const out: CoachService[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const name = asText(record.name, LIST_ITEM_LIMIT)
    const price = asText(record.price, LIST_ITEM_LIMIT)
    const description = asText(record.description, BIO_PARAGRAPH_LIMIT)
    if (!name && !price && !description) continue
    out.push({ name, price, description })
    if (out.length >= LIST_MAX) break
  }
  return out
}

function nullableText(value: unknown): string | null {
  return value == null ? null : String(value)
}

function toRow(row: Record<string, unknown>): CoachProfileRow {
  return {
    id: String(row.id),
    slug: String(row.slug ?? ''),
    name: String(row.name ?? ''),
    first_name: nullableText(row.first_name),
    role_title: nullableText(row.role_title),
    tagline: nullableText(row.tagline),
    philosophy: nullableText(row.philosophy),
    bio: parseStringArray(row.bio, BIO_PARAGRAPH_LIMIT, BIO_PARAGRAPH_MAX),
    specialties: parseStringArray(row.specialties, LIST_ITEM_LIMIT, LIST_MAX),
    stats: parseStats(row.stats),
    services: parseServices(row.services),
    photo_url: nullableText(row.photo_url),
    cta_bg_url: nullableText(row.cta_bg_url),
    book_call_url: nullableText(row.book_call_url),
    is_visible: row.is_visible !== false,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    updated_at: String(row.updated_at ?? ''),
  }
}

/**
 * The roster order: `sort_order` first, then name.
 *
 * Applied client-side as well as in the query, because ties are allowed (there
 * is no unique index on `sort_order`) and PostgREST would otherwise hand back
 * tied rows in whatever order the index produced them, which reshuffles between
 * refreshes and looks broken.
 */
function byRosterOrder(a: CoachProfileRow, b: CoachProfileRow): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name)
}

// ---------------------------------------------------------------------------
// The static array, as rows and back
// ---------------------------------------------------------------------------

const COACH_BY_SLUG = new Map(COACHES.map(coach => [coach.slug as string, coach]))

/** A static entry as the row 032 seeds from it. The inverse of `toCoachShape`. */
function fromCoach(coach: Coach, index: number): CoachProfileRow {
  return {
    id: `demo-coach-${coach.slug}`,
    slug: coach.slug,
    name: coach.name,
    first_name: coach.firstName,
    role_title: coach.role,
    tagline: coach.tagline,
    philosophy: coach.coachingPhilosophy,
    bio: [...coach.bio],
    specialties: [...coach.specialties],
    stats: coach.stats.map(stat => ({ ...stat })),
    services: coach.services.map(service => ({ ...service })),
    photo_url: coach.photo ?? null,
    cta_bg_url: coach.ctaBg ?? null,
    book_call_url: coach.bookCallUrl ?? null,
    is_visible: true,
    sort_order: index,
    updated_at: new Date().toISOString(),
  }
}

/**
 * A row as the shape the public components already render.
 *
 * `email` and `testimonials` come from the static entry with the same slug,
 * because neither is in this table and neither should be. A profile created in
 * the portal has no static twin, so it gets `email: ''` and no testimonials.
 *
 * ⚠ An empty email is NOT a login. `CoachAdmin.tsx` compares
 * `session.user.email === coach.email` against the STATIC array and must keep
 * doing so. Nothing produced by this function should ever be fed to that check:
 * it would be comparing a session against a field an admin can edit.
 *
 * `firstName` falls back to the first word of the name rather than to null,
 * because it is rendered in sentences ("Book a call with Ronnie") where an
 * empty string reads as a bug.
 */
export function toCoachShape(row: CoachProfileRow): CoachDisplay {
  const staticCoach = COACH_BY_SLUG.get(row.slug)
  const name = row.name || staticCoach?.name || ''

  return {
    slug: row.slug,
    name,
    firstName: row.first_name?.trim() || staticCoach?.firstName || name.split(' ')[0] || name,
    email: staticCoach?.email ?? '',
    photo: row.photo_url ?? undefined,
    ctaBg: row.cta_bg_url ?? undefined,
    bookCallUrl: row.book_call_url ?? undefined,
    role: row.role_title ?? '',
    tagline: row.tagline ?? '',
    bio: row.bio,
    coachingPhilosophy: row.philosophy ?? '',
    specialties: row.specialties,
    services: row.services,
    stats: row.stats,
    testimonials: staticCoach?.testimonials.map(t => ({ ...t })) ?? [],
  }
}

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------
//
// Seeded from COACHES, which is the same copy migration 032 seeds the table
// with, so a demo walk-through of the manager shows the real roster and not
// four people called Coach One. Mutated in place, so a demo edit survives a tab
// change. Resets on reload, which is the promise the demo banner makes.

let demo: CoachProfileRow[] | null = null

function demoStore(): CoachProfileRow[] {
  if (!demo) demo = COACHES.map((coach, index) => fromCoach(coach, index))
  return demo
}

/** Demo writes are instant; a beat of latency keeps the saving states honest. */
const beat = () => new Promise<void>(r => setTimeout(r, 220))

const demoId = () => `demo-coach-${Math.random().toString(36).slice(2, 10)}`

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The public roster: visible profiles, in order.
 *
 * Anon-safe by construction. 032's public policy is `using (is_visible)` and
 * nothing else, so this runs with no session at all, and the filter below is
 * belt and braces rather than the thing enforcing it.
 *
 * `null` means "we could not load it", and every caller is expected to fall
 * back to the static array on that. The roster section is above the fold on the
 * home page; it does not get to be empty because a database was slow.
 */
export async function fetchVisibleCoachProfiles(isDemo = false): Promise<CoachProfileRow[] | null> {
  if (offline(isDemo)) {
    return demoStore()
      .filter(row => row.is_visible)
      .map(row => ({ ...row }))
      .sort(byRosterOrder)
  }

  try {
    const { data, error } = await supabase
      .from('coach_profiles')
      .select(COACH_PROFILE_COLUMNS)
      .eq('is_visible', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) return null
    return (data ?? []).map(row => toRow(row as unknown as Record<string, unknown>)).sort(byRosterOrder)
  } catch {
    return null
  }
}

/**
 * Every profile, hidden ones included, in the same order.
 *
 * Scoped by RLS with no filter of ours: staff get all of them, an athlete who
 * calls this gets the visible ones, and neither needs this function to know
 * which of those happened.
 */
export async function fetchAllCoachProfiles(isDemo = false): Promise<CoachProfileRow[] | null> {
  if (offline(isDemo)) {
    return demoStore()
      .map(row => ({ ...row }))
      .sort(byRosterOrder)
  }

  try {
    const { data, error } = await supabase
      .from('coach_profiles')
      .select(COACH_PROFILE_COLUMNS)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) return null
    return (data ?? []).map(row => toRow(row as unknown as Record<string, unknown>)).sort(byRosterOrder)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Cleaning what gets written
// ---------------------------------------------------------------------------

/** One line: no newlines, no control characters, capped. */
function cleanLine(raw: unknown, limit: number): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, limit)
    .trimEnd()
}

/** A paragraph: newlines survive, everything else that is not typed does not. */
function cleanBlock(raw: unknown, limit: number): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, limit)
    .trimEnd()
}

/**
 * A link, or a refusal.
 *
 * The check matches 032's: an absolute http(s) URL, or a rooted path whose
 * second character is not another slash. A protocol-relative `//evil.com` is an
 * absolute URL wearing a costume and is refused here as well as by `safeUrl` on
 * render. Refusing it in this module means the person gets a sentence about the
 * field they typed in, not a constraint violation.
 */
const URL_SHAPE = /^(https?:\/\/|\/[^/])/i

function cleanUrl(raw: unknown, allowBlob = false): { ok: true; value: string | null } | { ok: false } {
  const text = cleanLine(raw, 2000)
  if (!text) return { ok: true, value: null }
  // Demo uploads are object URLs. They never reach the live table (this branch
  // opens only on the offline path), so 032's shape check is not in play.
  if (allowBlob && text.startsWith('blob:')) return { ok: true, value: text }
  if (!URL_SHAPE.test(text)) return { ok: false }
  return { ok: true, value: text }
}

/** What the caller may set. Everything else on the row belongs to the database. */
export type CoachProfileInput = Partial<CoachProfileRow> & { slug: string; name: string }

type Payload = Record<string, unknown>

function has(input: CoachProfileInput, key: keyof CoachProfileRow): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

/**
 * The row 032 expects, or the sentence explaining why there isn't one.
 *
 * Only the keys the caller actually passed are included. A `Partial` that
 * mentions three fields must not blank out the other ten, and a coach editing
 * their own bio must not send a `sort_order` they never touched: 032's guard
 * raises on a CHANGE to that column, so the safest payload is the smallest one.
 */
function cleanProfile(input: CoachProfileInput, allowBlob = false): { ok: true; payload: Payload } | { ok: false; message: string } {
  const payload: Payload = {}

  const slug = cleanLine(input.slug, 80).toLowerCase()
  if (!slug) return { ok: false, message: 'A coach profile needs an address, for example ronnie-vallejo.' }
  if (!COACH_SLUG_PATTERN.test(slug)) {
    return { ok: false, message: 'The address can use lowercase letters, numbers and hyphens only.' }
  }
  payload.slug = slug

  const name = cleanLine(input.name, COACH_NAME_LIMIT)
  if (!name) return { ok: false, message: 'A coach profile needs a name.' }
  payload.name = name

  if (has(input, 'first_name')) payload.first_name = cleanLine(input.first_name, COACH_NAME_LIMIT) || null
  if (has(input, 'role_title')) payload.role_title = cleanLine(input.role_title, COACH_ROLE_LIMIT) || null
  if (has(input, 'tagline')) payload.tagline = cleanLine(input.tagline, COACH_TAGLINE_LIMIT) || null
  if (has(input, 'philosophy')) payload.philosophy = cleanBlock(input.philosophy, COACH_PHILOSOPHY_LIMIT) || null

  if (has(input, 'bio')) {
    payload.bio = parseStringArray(
      asArray(input.bio).map(paragraph => cleanBlock(paragraph, BIO_PARAGRAPH_LIMIT)),
      BIO_PARAGRAPH_LIMIT,
      BIO_PARAGRAPH_MAX,
    )
  }
  if (has(input, 'specialties')) {
    payload.specialties = parseStringArray(
      asArray(input.specialties).map(item => cleanLine(item, LIST_ITEM_LIMIT)),
      LIST_ITEM_LIMIT,
      LIST_MAX,
    )
  }
  if (has(input, 'stats')) {
    payload.stats = parseStats(
      asArray(input.stats).map(item => {
        const stat = asRecord(item)
        return {
          label: cleanLine(stat?.label, LIST_ITEM_LIMIT),
          value: cleanLine(stat?.value, LIST_ITEM_LIMIT),
        }
      }),
    )
  }
  if (has(input, 'services')) {
    payload.services = parseServices(
      asArray(input.services).map(item => {
        const service = asRecord(item)
        return {
          name: cleanLine(service?.name, LIST_ITEM_LIMIT),
          price: cleanLine(service?.price, LIST_ITEM_LIMIT),
          description: cleanBlock(service?.description, BIO_PARAGRAPH_LIMIT),
        }
      }),
    )
  }

  const urls: [keyof CoachProfileRow, string, string][] = [
    ['photo_url', 'photo_url', 'The photo link'],
    ['cta_bg_url', 'cta_bg_url', 'The background image link'],
    ['book_call_url', 'book_call_url', 'The booking link'],
  ]
  for (const [key, column, label] of urls) {
    if (!has(input, key)) continue
    const url = cleanUrl(input[key], allowBlob)
    if (!url.ok) {
      return { ok: false, message: `${label} must start with https:// or with a single /.` }
    }
    payload[column] = url.value
  }

  if (has(input, 'is_visible')) payload.is_visible = input.is_visible !== false
  if (has(input, 'sort_order')) {
    const order = Number(input.sort_order)
    payload.sort_order = Number.isFinite(order) ? Math.min(1000, Math.max(0, Math.round(order))) : 0
  }

  return { ok: true, payload }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Create a profile, or save an edit to one.
 *
 * `id` decides which: absent means insert, present means update. Both use
 * `.select('id')`, and that is not decoration. An RLS refusal on an UPDATE
 * comes back as a successful request that changed nothing, and a screen that
 * reads that as success shows a state the database never agreed to.
 *
 * A new profile with no `sort_order` goes to the END of the roster rather than
 * to position 0, which is what "add a coach" means to the person doing it. That
 * costs one small read; a failed read falls back to 0 rather than failing the
 * save.
 */
export async function saveCoachProfile(
  input: CoachProfileInput,
  isDemo = false,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const cleaned = cleanProfile(input, offline(isDemo))
  if (!cleaned.ok) return cleaned

  const payload = cleaned.payload
  const id = input.id ?? null

  if (offline(isDemo)) {
    await beat()
    const store = demoStore()

    if (id) {
      const existing = store.find(row => row.id === id)
      if (!existing) return { ok: false, message: NOT_YOURS }
      Object.assign(existing, toRow({ ...existing, ...payload } as unknown as Record<string, unknown>))
      existing.updated_at = new Date().toISOString()
      return { ok: true, id }
    }

    if (store.some(row => row.slug === payload.slug)) {
      return { ok: false, message: 'Another coach profile already uses that address. Pick a different one.' }
    }
    const created = toRow({
      is_visible: true,
      sort_order: store.reduce((max, row) => Math.max(max, row.sort_order + 1), 0),
      ...payload,
      id: demoId(),
      updated_at: new Date().toISOString(),
    } as unknown as Record<string, unknown>)
    store.push(created)
    return { ok: true, id: created.id }
  }

  if (id) {
    const { data, error } = await supabase
      .from('coach_profiles')
      .update(payload)
      .eq('id', id)
      .select('id')

    if (error) return { ok: false, message: writeMessage(error, 'That coach profile was not saved.') }
    if (!data || data.length === 0) return { ok: false, message: NOT_YOURS }
    return { ok: true, id }
  }

  if (payload.sort_order === undefined) {
    const { data } = await supabase
      .from('coach_profiles')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
    const last = (data ?? [])[0] as { sort_order?: number } | undefined
    payload.sort_order = Math.min(1000, Number(last?.sort_order ?? -1) + 1)
  }

  const { data, error } = await supabase
    .from('coach_profiles')
    .insert(payload)
    .select('id')
    .single()

  if (error) return { ok: false, message: writeMessage(error, 'That coach profile was not created.') }
  if (!data) return { ok: false, message: NOT_YOURS }
  return { ok: true, id: String((data as { id: string }).id) }
}

/**
 * Remove a profile.
 *
 * This deletes the PAGE, not the person: their sign-in, their calendar and
 * their bookings are all somewhere else and are all untouched. The UI says so
 * before it calls this.
 */
export async function deleteCoachProfile(id: string, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) {
    await beat()
    const store = demoStore()
    const index = store.findIndex(row => row.id === id)
    if (index === -1) return { ok: false, message: 'That coach profile is already gone. Refresh the list.' }
    store.splice(index, 1)
    return { ok: true }
  }

  const { data, error } = await supabase.from('coach_profiles').delete().eq('id', id).select('id')

  if (error) return { ok: false, message: writeMessage(error, 'That coach profile was not removed.') }
  if (!data || data.length === 0) {
    return {
      ok: false,
      message: 'That profile was not removed. It may already be gone, or your account may not have permission to delete it.',
    }
  }
  return { ok: true }
}

/**
 * Show a coach on the public site, or take them off it.
 *
 * One of the three columns 032's guard reserves for an admin, so a coach
 * pressing this on their own row gets the trigger's sentence back rather than a
 * silent no-op.
 */
export async function setCoachVisibility(id: string, visible: boolean, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) {
    await beat()
    const row = demoStore().find(r => r.id === id)
    if (!row) return { ok: false, message: NOT_YOURS }
    row.is_visible = visible
    row.updated_at = new Date().toISOString()
    return { ok: true }
  }

  const { data, error } = await supabase
    .from('coach_profiles')
    .update({ is_visible: visible })
    .eq('id', id)
    .select('id')

  if (error) return { ok: false, message: writeMessage(error, 'That change was not saved.') }
  if (!data || data.length === 0) return { ok: false, message: NOT_YOURS }
  return { ok: true }
}

/**
 * Move a coach one place up or down the roster.
 *
 * A swap of `sort_order` with the neighbour, which is two writes and not one
 * transaction. There is no RPC for this and it does not need one: the failure
 * mode is two rows sharing a position, they sort by name until somebody presses
 * the button again, and nobody is looking at a wrong number in the meantime.
 *
 * At either end this is a no-op that answers `{ ok: true }`. "Up" on the first
 * row is not an error, it is a button that had nothing to do, and a screen that
 * shows a refusal for it is a screen nobody trusts.
 *
 * `current` is the list the caller already has on screen. Passing it saves a
 * round trip and, more importantly, means the swap is computed against exactly
 * the order the person is looking at.
 */
export async function reorderCoach(
  id: string,
  direction: 'up' | 'down',
  isDemo = false,
  current?: CoachProfileRow[],
): Promise<WriteResult> {
  const list = (current ?? (await fetchAllCoachProfiles(isDemo)) ?? []).slice().sort(byRosterOrder)
  if (list.length === 0) {
    return { ok: false, message: 'Could not read the roster order. Refresh the screen and try again.' }
  }

  const index = list.findIndex(row => row.id === id)
  if (index === -1) {
    return { ok: false, message: 'That coach profile is no longer on the roster. Refresh the list.' }
  }

  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= list.length) return { ok: true }

  const mover = list[index]
  const neighbour = list[target]

  // Ties are allowed, and the seed makes them unlikely rather than impossible.
  // When two rows already share a number, swapping it changes nothing, so the
  // positions in the sorted list are used instead.
  let moverOrder = neighbour.sort_order
  let neighbourOrder = mover.sort_order
  if (moverOrder === neighbourOrder) {
    moverOrder = target
    neighbourOrder = index
  }

  if (offline(isDemo)) {
    await beat()
    const store = demoStore()
    const a = store.find(row => row.id === mover.id)
    const b = store.find(row => row.id === neighbour.id)
    if (!a || !b) return { ok: false, message: NOT_YOURS }
    a.sort_order = moverOrder
    b.sort_order = neighbourOrder
    return { ok: true }
  }

  const first = await supabase
    .from('coach_profiles')
    .update({ sort_order: moverOrder })
    .eq('id', mover.id)
    .select('id')

  if (first.error) return { ok: false, message: writeMessage(first.error, 'That coach was not moved.') }
  if (!first.data || first.data.length === 0) return { ok: false, message: NOT_YOURS }

  const second = await supabase
    .from('coach_profiles')
    .update({ sort_order: neighbourOrder })
    .eq('id', neighbour.id)
    .select('id')

  if (second.error) {
    return {
      ok: false,
      message: writeMessage(second.error, 'Only half of that move was saved. Press the button again.'),
    }
  }
  if (!second.data || second.data.length === 0) {
    return { ok: false, message: 'Only half of that move was saved. Press the button again.' }
  }
  return { ok: true }
}
