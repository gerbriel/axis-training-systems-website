import { supabase, supabaseConfigured } from './supabase.ts'
import { sanitizeText, clampInt } from '../utils/sanitize.ts'
import type { WriteResult } from '../types/messaging.ts'

/**
 * resourceLibrary.ts
 *
 * The free resources area — five calculators, six guides, and anything the
 * owner adds — read and written as data instead of compiled in.
 *
 * Until migration 041 there were three hardcoded arrays: TOOL_LIST in
 * ToolPage, GUIDES in GuidesPage, and a third copy in the homepage Tools
 * strip. This module replaces the DATA in them, not the components: an RPE
 * calculator is code, so a built-in row carries `builtin_key` and the page
 * looks the component up by it. The three custom kinds (link, download,
 * article) have no component at all and render from `config` alone.
 *
 * Two contracts, deliberately different:
 *
 *   `fetchPublishedResources()` is the PUBLIC read, and it answers `null` for
 *   "I could not tell you" and `[]` for "there genuinely are none". A page
 *   that gets null falls back to its own built-in registry, so a database
 *   outage shows the site as it has always looked rather than an empty page
 *   where the free stuff used to be. That distinction is the whole reason the
 *   signature is nullable, so do not soften it to `[]` on error.
 *
 *   Everything else is the admin surface. Nothing throws — every failure is a
 *   WriteResult with a sentence a person can act on, because every caller is a
 *   screen that has to say something.
 *
 * Demo / no credentials  →  an in-memory store seeded from the same eleven
 *                           built-ins the migration seeds, mutated in place so
 *                           a walk-through survives a tab change.
 * Live                   →  Supabase, gated by the RLS in 041.
 *
 * THIS IS SIGNAGE. The refusals below (a built-in cannot be deleted, a slug
 * must be shaped, a link must not carry a javascript: scheme) all exist again
 * in the database or at the render site. A client that skipped this file still
 * meets them.
 */

export type { WriteResult }

// ── Types ────────────────────────────────────────────────────────────────────

export type ResourceKind = 'tool' | 'guide' | 'link' | 'download' | 'article'

export interface ResourceItem {
  id: string
  slug: string
  kind: ResourceKind
  /** The React component a built-in renders. Null for the custom kinds. */
  builtin_key: string | null
  title: string
  description: string
  tag: string | null
  sort_order: number
  is_published: boolean
  requires_signup: boolean
  config: Record<string, unknown>
  updated_at: string
}

export const RESOURCE_KINDS: ResourceKind[] = ['tool', 'guide', 'link', 'download', 'article']

/** The kinds an owner can create. A tool or a guide needs a component in the
 *  bundle, so those eleven are seeded and edited, never added from a form. */
export const CUSTOM_KINDS: ResourceKind[] = ['link', 'download', 'article']

export const KIND_LABELS: Record<ResourceKind, string> = {
  tool: 'Tool',
  guide: 'Guide',
  link: 'External link',
  download: 'Download',
  article: 'Article',
}

export interface NewResourceInput {
  kind: ResourceKind
  title: string
  /** Optional. Minted from the title when blank. */
  slug?: string
  description?: string
  tag?: string | null
  sort_order?: number
  is_published?: boolean
  requires_signup?: boolean
  config?: Record<string, unknown>
}

export type ResourcePatch = Partial<Pick<
  ResourceItem,
  'title' | 'slug' | 'description' | 'tag' | 'sort_order' | 'is_published' | 'requires_signup' | 'config'
>> & {
  /**
   * The row's kind. Never written — a resource cannot change kind, because the
   * config it carries and the way it renders are both decided by it. It rides
   * along so a `config` patch can be checked against the right rules without a
   * read-back first.
   */
  kind?: ResourceKind
}

// ── Shared plumbing ──────────────────────────────────────────────────────────

const TABLE = 'resource_library'

const COLUMNS =
  'id,kind,slug,builtin_key,title,description,tag,sort_order,is_published,requires_signup,config,updated_at'

/** Demo and "no credentials" are the same to a screen: nothing to talk to. */
const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

/** A beat of latency so demo saving-states read as honest, not instant. */
const beat = () => new Promise<void>(r => setTimeout(r, 220))

const nowIso = () => new Date().toISOString()

const genId = () => (globalThis.crypto?.randomUUID?.() ?? `local-${Math.random().toString(36).slice(2, 12)}`)

export const TITLE_LIMIT = 160
export const DESCRIPTION_LIMIT = 600
export const TAG_LIMIT = 60
export const ARTICLE_BODY_LIMIT = 50000
export const URL_LIMIT = 2000

/** A PostgREST error, in a sentence a person can act on. */
function writeMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  const code = error.code ?? ''
  const msg = (error.message ?? '').replace(/^ERROR:\s*/i, '').trim()
  // Our own triggers raise 22023 with a sentence already written for a person
  // (041 refusing to delete a built-in). Pass it through rather than paraphrase.
  if ((code === '22023' || code === 'P0001') && msg) return msg
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'The database refused that change. Your account may not have permission to manage the resource library.'
  }
  if (code === '23505') return 'Another resource of that kind already uses that slug.'
  if (code === '23514') return 'Those values are outside what the database allows. Check the slug and the title.'
  if (code === 'PGRST301' || /jwt|token is expired/i.test(msg)) {
    return 'Your session expired. Sign in again and the change will go through.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection, nothing was changed.'
  }
  return fallback
}

// ── Slugs ────────────────────────────────────────────────────────────────────

/** The same shape the CHECK constraint in 041 enforces. */
export const SLUG_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
export const SLUG_LIMIT = 60

export function isValidSlug(slug: string): boolean {
  return typeof slug === 'string' && slug.length <= SLUG_LIMIT && SLUG_SHAPE.test(slug)
}

/**
 * A slug from a title: lowercase, runs of anything else collapsed to one
 * hyphen, no hyphen at either end, capped.
 *
 * Empty for a title with no letters or numbers in it at all, which the callers
 * treat as "ask them to type one" rather than inventing something.
 */
export function slugFromTitle(title: string): string {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_LIMIT)
    .replace(/-+$/, '')
}

/** A slug a person typed, cleaned the same way before it is shape-checked. */
export function normalizeSlug(input: string): string {
  return slugFromTitle(input)
}

// ── URLs ─────────────────────────────────────────────────────────────────────

/**
 * A URL safe to put in an href, or undefined.
 *
 * The rule is `safeUrl` in utils/sanitize: an allow-list of schemes, because a
 * stored `javascript:` is a working script link the moment React renders it in
 * an anchor, and React only warns. Site-relative paths pass; a
 * protocol-relative `//evil.com` does not, being an absolute URL in a costume.
 *
 * It is written out here rather than imported because `safeUrl` resolves
 * against `window.location.origin`, and this validation has to give the same
 * answer with no window: it runs in `node --test` and would silently reject
 * every absolute URL there (the ReferenceError lands in safeUrl's own catch).
 * A validator that passes in the browser and fails in its tests is worse than
 * a duplicated eight lines.
 */
const URL_BASE = 'https://axis.local'

export function safeResourceUrl(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const raw = input.trim()
  if (!raw || raw.length > URL_LIMIT) return undefined
  // Control characters are how the classic bypass works: the tab in
  // "java\tscript:" is stripped by the URL parser but not by a prefix test.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return undefined
  // A backslash is a slash to the WHATWG parser on http(s) URLs, so "/\evil.com"
  // reads as site-relative here and as protocol-relative "//evil.com" in the
  // browser. No URL this site stores has a legitimate backslash in it.
  if (raw.includes('\\')) return undefined
  if (raw.startsWith('//')) return undefined
  if (raw.startsWith('/') || raw.startsWith('#') || raw.startsWith('?')) return raw
  try {
    const url = new URL(raw, URL_BASE)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? raw : undefined
  } catch {
    return undefined
  }
}

// ── Per-kind config ──────────────────────────────────────────────────────────

export type ConfigResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string }

/**
 * The payload a kind needs, checked and cleaned.
 *
 * A tool or a guide keeps nothing here: the component is the content. The
 * three custom kinds each need exactly one or two fields, and a row missing
 * them renders as a card that does nothing when clicked, so they are refused
 * at the form rather than stored and puzzled over later.
 *
 * Unknown keys are dropped rather than carried, so an article that used to be
 * a link does not keep a stale url in it.
 */
export function validateConfig(kind: ResourceKind, config: Record<string, unknown> | undefined): ConfigResult {
  const c = config ?? {}
  switch (kind) {
    case 'tool':
    case 'guide':
      return { ok: true, value: {} }

    case 'article': {
      const body = sanitizeText(typeof c.body === 'string' ? c.body : '', ARTICLE_BODY_LIMIT)
      if (!body) return { ok: false, message: 'An article needs some body text.' }
      return { ok: true, value: { body } }
    }

    case 'link': {
      const url = safeResourceUrl(c.url)
      if (!url) return { ok: false, message: 'Give the link a web address starting with https://, or a path on this site starting with /.' }
      return { ok: true, value: { url } }
    }

    case 'download': {
      const url = safeResourceUrl(c.url)
      if (!url) return { ok: false, message: 'Give the download a file address starting with https://, or a path on this site starting with /.' }
      const file_label = sanitizeText(typeof c.file_label === 'string' ? c.file_label : '', 80) || 'Download'
      return { ok: true, value: { url, file_label } }
    }

    default:
      return { ok: false, message: 'That is not a kind of resource this site knows about.' }
  }
}

// ── Ordering ─────────────────────────────────────────────────────────────────

/** The gap new rows leave between themselves, so one can be slotted between. */
export const SORT_STEP = 10

/**
 * Kind, then position, then title: the same ORDER BY the reads use, so the
 * demo store and the database agree about what "in order" means.
 */
export function compareResources(a: ResourceItem, b: ResourceItem): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
  return a.title.localeCompare(b.title)
}

export function sortResources(items: ResourceItem[]): ResourceItem[] {
  return [...items].sort(compareResources)
}

/** The next free position at the bottom of a kind's group. */
export function nextSortOrder(items: ResourceItem[], kind: ResourceKind): number {
  const group = items.filter(i => i.kind === kind)
  if (group.length === 0) return 0
  return Math.max(...group.map(i => i.sort_order)) + SORT_STEP
}

/**
 * Moving one row a slot within its own kind, as the set of rows whose
 * sort_order actually has to change. Null when it cannot move: no such row, or
 * it is already at the end it was asked to move toward.
 *
 * The group is renumbered 0, 10, 20 … rather than the two rows swapped,
 * because two rows sharing a sort_order (which the column permits, and which a
 * hand-typed order box produces) makes a swap a no-op. Renumbering is the same
 * two writes in the ordinary case and correct in the awkward one.
 */
export function planReorder(
  items: ResourceItem[],
  id: string,
  direction: 'up' | 'down',
): { id: string; sort_order: number }[] | null {
  const target = items.find(i => i.id === id)
  if (!target) return null

  const group = sortResources(items.filter(i => i.kind === target.kind))
  const from = group.findIndex(i => i.id === id)
  const to = direction === 'up' ? from - 1 : from + 1
  if (from < 0 || to < 0 || to >= group.length) return null

  const moved = [...group]
  const [row] = moved.splice(from, 1)
  moved.splice(to, 0, row)

  const changed: { id: string; sort_order: number }[] = []
  moved.forEach((r, i) => {
    const next = i * SORT_STEP
    if (r.sort_order !== next) changed.push({ id: r.id, sort_order: next })
  })
  return changed
}

// ── The eleven built-ins ─────────────────────────────────────────────────────
//
// Defined once, here. The demo store is seeded from it, and a page whose read
// came back null can render it as the registry it used to hardcode. Titles,
// descriptions, tags and positions match the seed in migration 041 exactly; if
// one changes, change both or the demo stops resembling the site.
//
// The ids are stable strings rather than uuids so a demo walk-through that
// edits a row and reloads the tab sees the same row.

const SEED_AT = '2026-01-01T00:00:00.000Z'

function builtin(
  kind: 'tool' | 'guide',
  slug: string,
  title: string,
  description: string,
  tag: string | null,
  sort_order: number,
  requires_signup: boolean,
): ResourceItem {
  return {
    id: `builtin-${kind}-${slug}`,
    kind,
    slug,
    builtin_key: slug,
    title,
    description,
    tag,
    sort_order,
    is_published: true,
    requires_signup,
    config: {},
    updated_at: SEED_AT,
  }
}

export const BUILTIN_RESOURCES: ResourceItem[] = [
  builtin('tool', 'rpe', 'RPE Calculator',
    'Estimate your 1RM or get a prescribed working weight from any RPE and rep target.',
    null, 0, false),
  builtin('tool', 'dots', 'Dots Score',
    'Calculate your Dots coefficient to compare performance across weight classes and sexes.',
    null, 10, false),
  builtin('tool', 'convert', 'Weight Converter',
    'Instantly convert between lbs and kg for any weight or total.',
    null, 20, false),
  builtin('tool', 'attempts', 'Attempt Planner',
    'Plan your opener, second, and third attempts based on your training maxes and meet strategy.',
    null, 30, true),
  builtin('tool', 'rankings', 'View Rankings',
    'Browse 3M+ powerlifting results worldwide. Filter by federation, weight class, and gender.',
    null, 40, false),

  builtin('guide', 'checklist', 'Meet Day Checklist',
    'Warmup timing, attempt strategy, gear bag essentials: everything you need the night before and on the day.',
    'Free Checklist', 0, true),
  builtin('guide', 'attempts', 'Attempt Selection Calculator',
    'Enter your training maxes and get your opener, second, and third attempt recommendations based on proven percentages.',
    'Interactive Tool', 10, true),
  builtin('guide', 'quiz', '"Is Your Training Leaving Gains on the Table?" Quiz',
    '6 questions. Score your programming, volume management, recovery habits, and more. Get your tier and a clear picture of what to fix.',
    'Scored Quiz', 20, true),
  builtin('guide', 'rpe', 'RPE Guide for Beginners',
    'What RPE 6 to 10 actually means, how many reps each level implies, and how to calibrate your own effort accurately.',
    'Reference Guide', 30, true),
  builtin('guide', 'big3', "Beginner's Guide to the Big Three",
    'Squat, bench, and deadlift cue breakdowns, phase-by-phase. Setup, execution, and the most common technical mistakes.',
    'Technical Guide', 40, true),
  builtin('guide', 'audit', 'Audit Your Last Training Block',
    'Rate your last block across 6 programming dimensions. Score your structure, specificity, recovery management, and compliance.',
    'Scored Worksheet', 50, true),
]

// ── The demo store ───────────────────────────────────────────────────────────

let demoRows: ResourceItem[] | null = null

function store(): ResourceItem[] {
  if (!demoRows) demoRows = BUILTIN_RESOURCES.map(r => ({ ...r, config: { ...r.config } }))
  return demoRows
}

const copy = (r: ResourceItem): ResourceItem => ({ ...r, config: { ...r.config } })

/** Forget the walk-through: the next read reseeds from the built-ins. */
export function resetDemoResources(): void {
  demoRows = null
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** A row off the wire, with every field defended. */
function toItem(row: Record<string, unknown>): ResourceItem {
  const kind = RESOURCE_KINDS.includes(row.kind as ResourceKind) ? (row.kind as ResourceKind) : 'link'
  const rawConfig = row.config
  const config = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
    ? (rawConfig as Record<string, unknown>)
    : {}
  return {
    id: String(row.id ?? ''),
    kind,
    slug: String(row.slug ?? ''),
    builtin_key: typeof row.builtin_key === 'string' ? row.builtin_key : null,
    title: String(row.title ?? ''),
    description: typeof row.description === 'string' ? row.description : '',
    tag: typeof row.tag === 'string' && row.tag ? row.tag : null,
    sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
    is_published: row.is_published !== false,
    requires_signup: row.requires_signup === true,
    config,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : SEED_AT,
  }
}

/**
 * Every published resource, in order.
 *
 * `null` means "could not tell you" — no credentials, or the read failed — and
 * the caller should keep showing whatever it has built in. `[]` means the table
 * really is empty, which is a legitimate answer an owner can produce by
 * unpublishing everything, and must not be confused with the first.
 */
export async function fetchPublishedResources(): Promise<ResourceItem[] | null> {
  if (!supabaseConfigured) return null
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(COLUMNS)
      .eq('is_published', true)
      .order('kind')
      .order('sort_order')
      .order('title')
    if (error || !Array.isArray(data)) return null
    return (data as Record<string, unknown>[]).map(toItem)
  } catch {
    return null
  }
}

/**
 * Everything, published or not, for the admin panel. Null on an outage, for the
 * same reason and with the same meaning as above: the panel shows "could not
 * load" rather than "you have no resources", which would invite an owner to
 * create the eleven they already have.
 */
export async function fetchAllResources(isDemo = false): Promise<ResourceItem[] | null> {
  if (offline(isDemo)) return sortResources(store().map(copy))
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(COLUMNS)
      .order('kind')
      .order('sort_order')
      .order('title')
    if (error || !Array.isArray(data)) return null
    return (data as Record<string, unknown>[]).map(toItem)
  } catch {
    return null
  }
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * A new custom resource.
 *
 * Only the three custom kinds: a tool or a guide is half a React component,
 * and a row claiming to be one that has nothing behind it renders as a card
 * that goes nowhere. Adding a real calculator is a deploy, and the migration
 * seeds its row.
 */
export async function createResource(input: NewResourceInput, isDemo = false): Promise<WriteResult> {
  const kind = input.kind
  if (!CUSTOM_KINDS.includes(kind)) {
    return { ok: false, message: 'Tools and guides are built into the site. You can edit the ones that exist, but new ones need a developer.' }
  }

  const title = sanitizeText(input.title ?? '', TITLE_LIMIT)
  if (!title) return { ok: false, message: 'Give the resource a title.' }

  const slug = input.slug?.trim() ? normalizeSlug(input.slug) : slugFromTitle(title)
  if (!isValidSlug(slug)) {
    return { ok: false, message: 'The web address needs lowercase letters or numbers. Type one in the slug box.' }
  }

  const cfg = validateConfig(kind, input.config)
  if (!cfg.ok) return cfg

  const row = {
    kind,
    slug,
    builtin_key: null as string | null,
    title,
    description: sanitizeText(input.description ?? '', DESCRIPTION_LIMIT),
    tag: sanitizeText(input.tag ?? '', TAG_LIMIT) || null,
    sort_order: clampInt(input.sort_order, 0, 100000, 0),
    is_published: input.is_published !== false,
    requires_signup: input.requires_signup === true,
    config: cfg.value,
  }

  if (offline(isDemo)) {
    await beat()
    if (store().some(r => r.kind === kind && r.slug === slug)) {
      return { ok: false, message: 'Another resource of that kind already uses that slug.' }
    }
    store().push({ id: genId(), ...row, updated_at: nowIso() })
    return { ok: true }
  }

  const { error } = await supabase.from(TABLE).insert(row)
  return error ? { ok: false, message: writeMessage(error, 'Could not add that resource.') } : { ok: true }
}

/**
 * Edit a row. Every kind, built-ins included: their title, description, badge,
 * position and gate are the owner's copy now.
 *
 * A built-in's SLUG is not offered by the panel, because it is the key the page
 * looks the component up by and a rename orphans a live URL. Nothing here
 * refuses it, because the harm is a broken link rather than a leak, and the
 * screen is where that decision belongs.
 */
export async function updateResource(id: string, patch: ResourcePatch, isDemo = false): Promise<WriteResult> {
  const clean: Record<string, unknown> = {}
  let nextSlug: string | undefined

  if (patch.title !== undefined) {
    const title = sanitizeText(patch.title, TITLE_LIMIT)
    if (!title) return { ok: false, message: 'A title cannot be blank.' }
    clean.title = title
  }
  if (patch.slug !== undefined) {
    nextSlug = normalizeSlug(patch.slug)
    if (!isValidSlug(nextSlug)) {
      return { ok: false, message: 'The web address needs lowercase letters or numbers, and hyphens between words.' }
    }
    clean.slug = nextSlug
  }
  if (patch.description !== undefined) clean.description = sanitizeText(patch.description, DESCRIPTION_LIMIT)
  if (patch.tag !== undefined) clean.tag = sanitizeText(patch.tag ?? '', TAG_LIMIT) || null
  if (patch.sort_order !== undefined) clean.sort_order = clampInt(patch.sort_order, 0, 100000, 0)
  if (patch.is_published !== undefined) clean.is_published = !!patch.is_published
  if (patch.requires_signup !== undefined) clean.requires_signup = !!patch.requires_signup

  if (patch.config !== undefined) {
    // Which rules apply is the ROW's kind, not the patch's guess. The caller
    // passes it (the panel is editing a row it has in hand); offline the store
    // knows it anyway. With neither, the config is refused rather than stored
    // unchecked, because an unvalidated url is the one that ends up in an href.
    const kind = patch.kind ?? (offline(isDemo) ? store().find(r => r.id === id)?.kind : undefined)
    if (!kind) return { ok: false, message: 'Could not tell what kind of resource that is. Reload the list and try again.' }
    const cfg = validateConfig(kind, patch.config)
    if (!cfg.ok) return cfg
    clean.config = cfg.value
  }

  if (Object.keys(clean).length === 0) return { ok: true }

  if (offline(isDemo)) {
    await beat()
    const rows = store()
    const i = rows.findIndex(r => r.id === id)
    if (i < 0) return { ok: false, message: 'That resource is no longer there. Reload the list.' }
    if (nextSlug && rows.some(r => r.id !== id && r.kind === rows[i].kind && r.slug === nextSlug)) {
      return { ok: false, message: 'Another resource of that kind already uses that slug.' }
    }
    rows[i] = { ...rows[i], ...(clean as Partial<ResourceItem>), updated_at: nowIso() }
    return { ok: true }
  }

  const { error } = await supabase.from(TABLE).update(clean).eq('id', id)
  return error ? { ok: false, message: writeMessage(error, 'That did not save.') } : { ok: true }
}

/** The publish switch on its own, because it is the one control used most. */
export async function setPublished(id: string, published: boolean, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) {
    await beat()
    const rows = store()
    const i = rows.findIndex(r => r.id === id)
    if (i < 0) return { ok: false, message: 'That resource is no longer there. Reload the list.' }
    rows[i] = { ...rows[i], is_published: published, updated_at: nowIso() }
    return { ok: true }
  }
  const { error } = await supabase.from(TABLE).update({ is_published: published }).eq('id', id)
  return error ? { ok: false, message: writeMessage(error, 'That did not save.') } : { ok: true }
}

/**
 * Remove a custom resource.
 *
 * The built-in refusal is here AND in a BEFORE DELETE trigger in 041. The
 * trigger is the one that matters; this one exists so the message arrives
 * without a round trip and reads the same in demo mode, where there is no
 * trigger to meet.
 */
export async function deleteResource(
  item: Pick<ResourceItem, 'id' | 'builtin_key' | 'kind'>,
  isDemo = false,
): Promise<WriteResult> {
  if (item.builtin_key !== null) {
    const what = (KIND_LABELS[item.kind] ?? 'resource').toLowerCase()
    return {
      ok: false,
      message: `That ${what} is built into the site and cannot be deleted. Unpublish it instead and it stops showing.`,
    }
  }
  if (offline(isDemo)) {
    await beat()
    demoRows = store().filter(r => r.id !== item.id)
    return { ok: true }
  }
  const { error } = await supabase.from(TABLE).delete().eq('id', item.id)
  return error ? { ok: false, message: writeMessage(error, 'Could not remove that resource.') } : { ok: true }
}

/**
 * Move a row one slot up or down within its own kind.
 *
 * `items` is the list the screen is currently showing, so the neighbour is the
 * one the person can see rather than whatever the table would say. Already at
 * the end is not a failure: the button should have been disabled, and saying
 * "no" to a no-op only puts a red box on the screen.
 */
export async function reorderResource(
  items: ResourceItem[],
  id: string,
  direction: 'up' | 'down',
  isDemo = false,
): Promise<WriteResult> {
  const plan = planReorder(items, id, direction)
  if (!plan || plan.length === 0) return { ok: true }

  if (offline(isDemo)) {
    await beat()
    const rows = store()
    for (const p of plan) {
      const i = rows.findIndex(r => r.id === p.id)
      if (i >= 0) rows[i] = { ...rows[i], sort_order: p.sort_order, updated_at: nowIso() }
    }
    return { ok: true }
  }

  const results = await Promise.all(
    plan.map(p => supabase.from(TABLE).update({ sort_order: p.sort_order }).eq('id', p.id)),
  )
  const failed = results.find(r => r.error)
  return failed?.error
    ? { ok: false, message: writeMessage(failed.error, 'Could not reorder those. Reload the list to see where they ended up.') }
    : { ok: true }
}
