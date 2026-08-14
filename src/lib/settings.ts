/**
 * settings.ts
 *
 * CRUD for the admin Settings sub-tabs backed by migration 029, plus the
 * Scheduling area that reuses coach_public_settings (009). One module so the
 * nine panels share one demo story and one error translator.
 *
 * Demo / no-backend  →  in-memory stores seeded below, mutated in place so a
 *                       walk-through survives a tab change and resets on reload.
 * Live               →  Supabase, gated by RLS from 029.
 *
 * Nothing throws. Every failure is a value, because every caller is a screen
 * that has to say something. This is SIGNAGE — the database (RLS in 029) is
 * what actually refuses a write; a client that skipped this file still hits it.
 */

import { supabase, supabaseConfigured } from './supabase'
import { COACHES } from '../data/coaches'
import { sanitize, sanitizeStrict, clampInt } from '../utils/sanitize'

// ── Shared ──────────────────────────────────────────────────────────────────

export type WriteResult = { ok: true } | { ok: false; message: string }

/** Demo and "no credentials" are the same to a screen: nothing to talk to. */
const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

/** A beat of latency so demo saving-states read as honest, not instant. */
const beat = () => new Promise<void>(r => setTimeout(r, 220))

const genId = () => (crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 12))
const nowIso = () => new Date().toISOString()

/** A PostgREST error, in a sentence a person can act on. */
function writeMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  const code = error.code ?? ''
  const msg = (error.message ?? '').replace(/^ERROR:\s*/i, '').trim()
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'The database refused that change. Your account may not have permission — sign out, sign back in, and try again.'
  }
  if (code === '23514') return 'Those values are outside the allowed range. Check the numbers and try again.'
  if (code === '23505') return 'That would duplicate one that already exists.'
  if (code === 'PGRST301' || /jwt|token is expired/i.test(msg)) {
    return 'Your session expired. Sign in again and the change will go through.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection — nothing was changed.'
  }
  return fallback
}

// =============================================================================
// SCHEDULING — reuses coach_public_settings (009), edited across the roster
// =============================================================================

export interface SchedulingRow {
  coach_slug: string
  coach_name: string
  min_lead_minutes: number
  max_advance_days: number
  buffer_minutes: number
  auto_confirm: boolean
}

const SCHED_DEFAULTS = { min_lead_minutes: 120, max_advance_days: 70, buffer_minutes: 0, auto_confirm: false }

let demoSchedule: SchedulingRow[] | null = null
function scheduleStore(): SchedulingRow[] {
  if (!demoSchedule) demoSchedule = COACHES.map(c => ({ coach_slug: c.slug, coach_name: c.name, ...SCHED_DEFAULTS }))
  return demoSchedule
}

/** Every coach's booking policy, ordered by the roster. */
export async function fetchScheduling(isDemo = false): Promise<SchedulingRow[]> {
  if (offline(isDemo)) return scheduleStore().map(r => ({ ...r }))

  const { data, error } = await supabase
    .from('coach_public_settings')
    .select('coach_slug,min_lead_minutes,max_advance_days,buffer_minutes,auto_confirm')
  if (error) return []

  const bySlug = new Map((data ?? []).map((r) => [(r as { coach_slug: string }).coach_slug, r as Partial<SchedulingRow>]))
  // Driven by the roster, not the table: a coach with no settings row yet still
  // appears, with the DDL defaults, so the panel can create one by saving.
  return COACHES.map(c => {
    const s = bySlug.get(c.slug)
    return {
      coach_slug: c.slug,
      coach_name: c.name,
      min_lead_minutes: s?.min_lead_minutes ?? SCHED_DEFAULTS.min_lead_minutes,
      max_advance_days: s?.max_advance_days ?? SCHED_DEFAULTS.max_advance_days,
      buffer_minutes:   s?.buffer_minutes ?? SCHED_DEFAULTS.buffer_minutes,
      auto_confirm:     s?.auto_confirm ?? SCHED_DEFAULTS.auto_confirm,
    }
  })
}

export async function saveSchedulingRow(row: SchedulingRow, isDemo = false): Promise<WriteResult> {
  const clean = {
    coach_slug: row.coach_slug,
    min_lead_minutes: clampInt(row.min_lead_minutes, 0, 20160, SCHED_DEFAULTS.min_lead_minutes),
    max_advance_days: clampInt(row.max_advance_days, 1, 365, SCHED_DEFAULTS.max_advance_days),
    buffer_minutes:   clampInt(row.buffer_minutes, 0, 240, 0),
    auto_confirm:     !!row.auto_confirm,
  }
  if (offline(isDemo)) {
    await beat()
    const store = scheduleStore()
    const i = store.findIndex(r => r.coach_slug === row.coach_slug)
    if (i >= 0) store[i] = { ...store[i], ...clean }
    return { ok: true }
  }
  const { error } = await supabase
    .from('coach_public_settings')
    .upsert({ ...clean, updated_at: nowIso() }, { onConflict: 'coach_slug' })
  return error ? { ok: false, message: writeMessage(error, 'That did not save.') } : { ok: true }
}

// =============================================================================
// ROOMS & EQUIPMENT — public.resources
// =============================================================================

export type ResourceKind = 'room' | 'equipment'
export interface ResourceRow {
  id: string
  name: string
  kind: ResourceKind
  quantity: number
  is_active: boolean
  created_at: string
}

const RESOURCE_COLUMNS = 'id,name,kind,quantity,is_active,created_at'

let demoResources: ResourceRow[] | null = null
function resourceStore(): ResourceRow[] {
  if (!demoResources) demoResources = [
    { id: 'demo-res-1', name: 'Main Platform',   kind: 'room',      quantity: 1, is_active: true,  created_at: nowIso() },
    { id: 'demo-res-2', name: 'Coaching Room A', kind: 'room',      quantity: 1, is_active: true,  created_at: nowIso() },
    { id: 'demo-res-3', name: 'Competition Bar', kind: 'equipment', quantity: 4, is_active: true,  created_at: nowIso() },
    { id: 'demo-res-4', name: 'Overhead Rig',    kind: 'equipment', quantity: 2, is_active: false, created_at: nowIso() },
  ]
  return demoResources
}

export async function fetchResources(isDemo = false): Promise<ResourceRow[]> {
  if (offline(isDemo)) return resourceStore().map(r => ({ ...r }))
  const { data, error } = await supabase
    .from('resources').select(RESOURCE_COLUMNS).order('kind').order('name')
  if (error) return []
  return (data ?? []) as unknown as ResourceRow[]
}

export async function createResource(
  input: { name: string; kind: ResourceKind; quantity: number }, isDemo = false,
): Promise<WriteResult> {
  const name = sanitizeStrict(input.name)
  if (!name) return { ok: false, message: 'Give the room or piece of equipment a name.' }
  const quantity = clampInt(input.quantity, 0, 1000, 1)
  const kind: ResourceKind = input.kind === 'equipment' ? 'equipment' : 'room'
  if (offline(isDemo)) {
    await beat()
    resourceStore().push({ id: genId(), name, kind, quantity, is_active: true, created_at: nowIso() })
    return { ok: true }
  }
  const { error } = await supabase.from('resources').insert({ name, kind, quantity })
  return error ? { ok: false, message: writeMessage(error, 'Could not add that.') } : { ok: true }
}

export async function updateResource(
  id: string, patch: Partial<Pick<ResourceRow, 'name' | 'kind' | 'quantity' | 'is_active'>>, isDemo = false,
): Promise<WriteResult> {
  const clean: Record<string, unknown> = {}
  if (patch.name !== undefined) { const n = sanitizeStrict(patch.name); if (!n) return { ok: false, message: 'A name cannot be blank.' }; clean.name = n }
  if (patch.kind !== undefined) clean.kind = patch.kind === 'equipment' ? 'equipment' : 'room'
  if (patch.quantity !== undefined) clean.quantity = clampInt(patch.quantity, 0, 1000, 1)
  if (patch.is_active !== undefined) clean.is_active = !!patch.is_active
  if (offline(isDemo)) {
    await beat()
    const store = resourceStore(); const i = store.findIndex(r => r.id === id)
    if (i >= 0) store[i] = { ...store[i], ...(clean as Partial<ResourceRow>) }
    return { ok: true }
  }
  const { error } = await supabase.from('resources').update(clean).eq('id', id)
  return error ? { ok: false, message: writeMessage(error, 'That did not save.') } : { ok: true }
}

export async function deleteResource(id: string, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) {
    await beat()
    demoResources = resourceStore().filter(r => r.id !== id)
    return { ok: true }
  }
  const { error } = await supabase.from('resources').delete().eq('id', id)
  return error ? { ok: false, message: writeMessage(error, 'Could not remove that.') } : { ok: true }
}

// =============================================================================
// WAITLIST RULES — public.waitlist_settings (singleton)
// =============================================================================

export interface WaitlistSettings {
  auto_offer: boolean
  hold_minutes: number
  max_size: number
}
const WAITLIST_DEFAULTS: WaitlistSettings = { auto_offer: false, hold_minutes: 30, max_size: 10 }

let demoWaitlist: WaitlistSettings | null = null
function waitlistStore(): WaitlistSettings {
  if (!demoWaitlist) demoWaitlist = { ...WAITLIST_DEFAULTS }
  return demoWaitlist
}

export async function fetchWaitlistSettings(isDemo = false): Promise<WaitlistSettings> {
  if (offline(isDemo)) return { ...waitlistStore() }
  const { data, error } = await supabase
    .from('waitlist_settings').select('auto_offer,hold_minutes,max_size').eq('id', true).maybeSingle()
  if (error || !data) return { ...WAITLIST_DEFAULTS }
  const d = data as Partial<WaitlistSettings>
  return {
    auto_offer:   d.auto_offer ?? WAITLIST_DEFAULTS.auto_offer,
    hold_minutes: d.hold_minutes ?? WAITLIST_DEFAULTS.hold_minutes,
    max_size:     d.max_size ?? WAITLIST_DEFAULTS.max_size,
  }
}

export async function saveWaitlistSettings(next: WaitlistSettings, isDemo = false): Promise<WriteResult> {
  const clean = {
    auto_offer:   !!next.auto_offer,
    hold_minutes: clampInt(next.hold_minutes, 0, 1440, WAITLIST_DEFAULTS.hold_minutes),
    max_size:     clampInt(next.max_size, 0, 1000, WAITLIST_DEFAULTS.max_size),
  }
  if (offline(isDemo)) { await beat(); demoWaitlist = { ...clean }; return { ok: true } }
  const { error } = await supabase
    .from('waitlist_settings').upsert({ id: true, ...clean }, { onConflict: 'id' })
  return error ? { ok: false, message: writeMessage(error, 'That did not save.') } : { ok: true }
}

// =============================================================================
// CLIENT NOTIFICATIONS — public.notification_settings (singleton)
// =============================================================================

export interface NotificationSettings {
  confirmation_enabled: boolean
  reminder_24h_enabled: boolean
  reminder_2h_enabled: boolean
  cancellation_enabled: boolean
  reminder_24h_hours: number
  reminder_2h_hours: number
}
const NOTIF_DEFAULTS: NotificationSettings = {
  confirmation_enabled: true, reminder_24h_enabled: true, reminder_2h_enabled: true,
  cancellation_enabled: true, reminder_24h_hours: 24, reminder_2h_hours: 2,
}
const NOTIF_COLUMNS =
  'confirmation_enabled,reminder_24h_enabled,reminder_2h_enabled,cancellation_enabled,reminder_24h_hours,reminder_2h_hours'

let demoNotif: NotificationSettings | null = null
function notifStore(): NotificationSettings {
  if (!demoNotif) demoNotif = { ...NOTIF_DEFAULTS }
  return demoNotif
}

export async function fetchNotificationSettings(isDemo = false): Promise<NotificationSettings> {
  if (offline(isDemo)) return { ...notifStore() }
  const { data, error } = await supabase
    .from('notification_settings').select(NOTIF_COLUMNS).eq('id', true).maybeSingle()
  if (error || !data) return { ...NOTIF_DEFAULTS }
  const d = data as Partial<NotificationSettings>
  return { ...NOTIF_DEFAULTS, ...d }
}

export async function saveNotificationSettings(next: NotificationSettings, isDemo = false): Promise<WriteResult> {
  const h24 = clampInt(next.reminder_24h_hours, 1, 168, NOTIF_DEFAULTS.reminder_24h_hours)
  const h2  = clampInt(next.reminder_2h_hours, 1, 47, NOTIF_DEFAULTS.reminder_2h_hours)
  // The DB CHECK requires the 2h reminder to fire strictly after the 24h one.
  // Catch it here so the message is about the reminders, not a raw 23514.
  if (h2 >= h24) return { ok: false, message: 'The second reminder must be closer to the call than the first.' }
  const clean = {
    confirmation_enabled: !!next.confirmation_enabled,
    reminder_24h_enabled: !!next.reminder_24h_enabled,
    reminder_2h_enabled:  !!next.reminder_2h_enabled,
    cancellation_enabled: !!next.cancellation_enabled,
    reminder_24h_hours: h24,
    reminder_2h_hours: h2,
  }
  if (offline(isDemo)) { await beat(); demoNotif = { ...clean }; return { ok: true } }
  const { error } = await supabase
    .from('notification_settings').upsert({ id: true, ...clean }, { onConflict: 'id' })
  return error ? { ok: false, message: writeMessage(error, 'That did not save.') } : { ok: true }
}

// =============================================================================
// COMMISSION — public.commission_rules
// =============================================================================

export type CommissionKind = 'percent' | 'flat'
export type CommissionAppliesTo = 'bookings' | 'sales'
export interface CommissionRule {
  id: string
  coach_slug: string | null
  kind: CommissionKind
  rate_bps: number | null
  amount_cents: number | null
  applies_to: CommissionAppliesTo
  is_active: boolean
  created_at: string
}
const COMMISSION_COLUMNS = 'id,coach_slug,kind,rate_bps,amount_cents,applies_to,is_active,created_at'

let demoCommission: CommissionRule[] | null = null
function commissionStore(): CommissionRule[] {
  if (!demoCommission) demoCommission = [
    { id: 'demo-com-1', coach_slug: 'seth-burman', kind: 'percent', rate_bps: 6000, amount_cents: null, applies_to: 'bookings', is_active: true, created_at: nowIso() },
    { id: 'demo-com-2', coach_slug: null,          kind: 'flat',    rate_bps: null, amount_cents: 500,  applies_to: 'sales',    is_active: true, created_at: nowIso() },
  ]
  return demoCommission
}

export async function fetchCommissionRules(isDemo = false): Promise<CommissionRule[]> {
  if (offline(isDemo)) return commissionStore().map(r => ({ ...r }))
  const { data, error } = await supabase
    .from('commission_rules').select(COMMISSION_COLUMNS).order('created_at', { ascending: false })
  if (error) return []
  return (data ?? []) as unknown as CommissionRule[]
}

export interface CommissionInput {
  coach_slug: string | null
  kind: CommissionKind
  applies_to: CommissionAppliesTo
  /** For percent rules: whole-percent value the UI collects (e.g. 60 → 6000 bps). */
  percent?: number
  /** For flat rules: dollar amount the UI collects (e.g. 5 → 500 cents). */
  dollars?: number
}

function normalizeCommission(input: CommissionInput): { ok: true; row: Omit<CommissionRule, 'id' | 'created_at' | 'is_active'> } | { ok: false; message: string } {
  const kind: CommissionKind = input.kind === 'flat' ? 'flat' : 'percent'
  const applies_to: CommissionAppliesTo = input.applies_to === 'sales' ? 'sales' : 'bookings'
  const coach_slug = input.coach_slug && /^[a-z0-9-]+$/.test(input.coach_slug) ? input.coach_slug : null
  if (kind === 'percent') {
    const pct = clampInt(input.percent, 0, 1000, -1)
    if (pct < 0) return { ok: false, message: 'Enter a percentage.' }
    return { ok: true, row: { coach_slug, kind, rate_bps: Math.round(pct * 100), amount_cents: null, applies_to } }
  }
  const dollars = typeof input.dollars === 'number' && Number.isFinite(input.dollars) ? input.dollars : NaN
  if (!Number.isFinite(dollars) || dollars < 0) return { ok: false, message: 'Enter a dollar amount.' }
  const cents = clampInt(Math.round(dollars * 100), 0, 100000000, -1)
  if (cents < 0) return { ok: false, message: 'Enter a dollar amount.' }
  return { ok: true, row: { coach_slug, kind, rate_bps: null, amount_cents: cents, applies_to } }
}

export async function createCommissionRule(input: CommissionInput, isDemo = false): Promise<WriteResult> {
  const n = normalizeCommission(input)
  if (!n.ok) return n
  if (offline(isDemo)) {
    await beat()
    commissionStore().unshift({ id: genId(), created_at: nowIso(), is_active: true, ...n.row })
    return { ok: true }
  }
  const { error } = await supabase.from('commission_rules').insert(n.row)
  return error ? { ok: false, message: writeMessage(error, 'Could not add that rule.') } : { ok: true }
}

export async function setCommissionActive(id: string, is_active: boolean, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) {
    await beat()
    const store = commissionStore(); const i = store.findIndex(r => r.id === id)
    if (i >= 0) store[i] = { ...store[i], is_active }
    return { ok: true }
  }
  const { error } = await supabase.from('commission_rules').update({ is_active }).eq('id', id)
  return error ? { ok: false, message: writeMessage(error, 'That did not save.') } : { ok: true }
}

export async function deleteCommissionRule(id: string, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) { await beat(); demoCommission = commissionStore().filter(r => r.id !== id); return { ok: true } }
  const { error } = await supabase.from('commission_rules').delete().eq('id', id)
  return error ? { ok: false, message: writeMessage(error, 'Could not remove that rule.') } : { ok: true }
}

// =============================================================================
// LOCATIONS — public.locations
// =============================================================================

export interface LocationRow {
  id: string
  name: string
  address: string | null
  timezone: string
  is_primary: boolean
  is_active: boolean
  created_at: string
}
const LOCATION_COLUMNS = 'id,name,address,timezone,is_primary,is_active,created_at'

/** A small, safe menu — the panel offers these rather than a free-text zone. */
export const TIMEZONE_CHOICES: string[] = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
]

let demoLocations: LocationRow[] | null = null
function locationStore(): LocationRow[] {
  if (!demoLocations) demoLocations = [
    { id: 'demo-loc-1', name: 'Axis Fresno', address: '123 Blackstone Ave, Fresno, CA 93726', timezone: 'America/Los_Angeles', is_primary: true, is_active: true, created_at: nowIso() },
  ]
  return demoLocations
}

export async function fetchLocations(isDemo = false): Promise<LocationRow[]> {
  if (offline(isDemo)) return locationStore().map(r => ({ ...r }))
  const { data, error } = await supabase
    .from('locations').select(LOCATION_COLUMNS).order('is_primary', { ascending: false }).order('name')
  if (error) return []
  return (data ?? []) as unknown as LocationRow[]
}

export async function createLocation(
  input: { name: string; address: string; timezone: string }, isDemo = false,
): Promise<WriteResult> {
  const name = sanitizeStrict(input.name)
  if (!name) return { ok: false, message: 'Give the location a name.' }
  const address = sanitize(input.address, 300) || null
  const timezone = TIMEZONE_CHOICES.includes(input.timezone) ? input.timezone : 'America/Los_Angeles'
  if (offline(isDemo)) {
    await beat()
    const store = locationStore()
    store.push({ id: genId(), name, address, timezone, is_primary: store.length === 0, is_active: true, created_at: nowIso() })
    return { ok: true }
  }
  const { error } = await supabase.from('locations').insert({ name, address, timezone })
  return error ? { ok: false, message: writeMessage(error, 'Could not add that location.') } : { ok: true }
}

export async function updateLocation(
  id: string, patch: Partial<Pick<LocationRow, 'name' | 'address' | 'timezone' | 'is_active'>>, isDemo = false,
): Promise<WriteResult> {
  const clean: Record<string, unknown> = {}
  if (patch.name !== undefined) { const n = sanitizeStrict(patch.name); if (!n) return { ok: false, message: 'A name cannot be blank.' }; clean.name = n }
  if (patch.address !== undefined) clean.address = sanitize(patch.address ?? '', 300) || null
  if (patch.timezone !== undefined) clean.timezone = TIMEZONE_CHOICES.includes(patch.timezone) ? patch.timezone : 'America/Los_Angeles'
  if (patch.is_active !== undefined) clean.is_active = !!patch.is_active
  if (offline(isDemo)) {
    await beat()
    const store = locationStore(); const i = store.findIndex(r => r.id === id)
    if (i >= 0) store[i] = { ...store[i], ...(clean as Partial<LocationRow>) }
    return { ok: true }
  }
  const { error } = await supabase.from('locations').update(clean).eq('id', id)
  return error ? { ok: false, message: writeMessage(error, 'That did not save.') } : { ok: true }
}

/**
 * Make one location primary. The DB has a partial unique index over the primary
 * rows, so two trues cannot coexist — clear the others FIRST, then set this one,
 * or the second update collides with the first.
 */
export async function makeLocationPrimary(id: string, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) {
    await beat()
    locationStore().forEach(r => { r.is_primary = r.id === id })
    return { ok: true }
  }
  const clearRes = await supabase.from('locations').update({ is_primary: false }).eq('is_primary', true).neq('id', id)
  if (clearRes.error) return { ok: false, message: writeMessage(clearRes.error, 'That did not save.') }
  const { error } = await supabase.from('locations').update({ is_primary: true }).eq('id', id)
  return error ? { ok: false, message: writeMessage(error, 'That did not save.') } : { ok: true }
}

export async function deleteLocation(id: string, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) { await beat(); demoLocations = locationStore().filter(r => r.id !== id); return { ok: true } }
  const { error } = await supabase.from('locations').delete().eq('id', id)
  return error ? { ok: false, message: writeMessage(error, 'Could not remove that location.') } : { ok: true }
}

// =============================================================================
// LEGAL — public.legal_documents
// =============================================================================

export type LegalSlug = 'privacy' | 'terms' | 'waiver'
export interface LegalDocument {
  slug: LegalSlug
  title: string
  body: string
  updated_at: string
}
export const LEGAL_SLUGS: { slug: LegalSlug; label: string }[] = [
  { slug: 'privacy', label: 'Privacy Policy' },
  { slug: 'terms',   label: 'Terms of Service' },
  { slug: 'waiver',  label: 'Liability Waiver' },
]

let demoLegal: LegalDocument[] | null = null
function legalStore(): LegalDocument[] {
  if (!demoLegal) demoLegal = LEGAL_SLUGS.map(s => ({ slug: s.slug, title: s.label, body: '', updated_at: nowIso() }))
  return demoLegal
}

export async function fetchLegalDocuments(isDemo = false): Promise<LegalDocument[]> {
  if (offline(isDemo)) return legalStore().map(d => ({ ...d }))
  const { data, error } = await supabase
    .from('legal_documents').select('slug,title,body,updated_at')
  if (error) return legalStore().map(d => ({ ...d }))
  const bySlug = new Map((data ?? []).map((r) => [(r as LegalDocument).slug, r as LegalDocument]))
  // Roster of slugs, not of rows: a doc missing from the table still shows,
  // empty, so it can be written for the first time by saving.
  return LEGAL_SLUGS.map(s => bySlug.get(s.slug) ?? { slug: s.slug, title: s.label, body: '', updated_at: nowIso() })
}

export async function saveLegalDocument(
  doc: { slug: LegalSlug; title: string; body: string }, isDemo = false,
): Promise<WriteResult> {
  const title = sanitizeStrict(doc.title) || LEGAL_SLUGS.find(s => s.slug === doc.slug)?.label || 'Document'
  const body = sanitize(doc.body, 50000)
  if (offline(isDemo)) {
    await beat()
    const store = legalStore(); const i = store.findIndex(d => d.slug === doc.slug)
    if (i >= 0) store[i] = { ...store[i], title, body, updated_at: nowIso() }
    return { ok: true }
  }
  const { error } = await supabase
    .from('legal_documents').upsert({ slug: doc.slug, title, body }, { onConflict: 'slug' })
  return error ? { ok: false, message: writeMessage(error, 'That did not save.') } : { ok: true }
}

// =============================================================================
// TEAM — reads profiles (011) + coach_routing (001); no new table
// =============================================================================

export interface TeamMember {
  id: string
  name: string
  email: string
  role: 'athlete' | 'coach' | 'admin'
  status: 'pending' | 'active' | 'suspended'
  coach_slug: string | null
}

const demoTeam: TeamMember[] = COACHES.map((c, i) => ({
  id: `demo-team-${c.slug}`,
  name: c.name,
  email: c.email,
  role: i === 0 ? 'admin' : 'coach',
  status: 'active',
  coach_slug: c.slug,
}))

/**
 * The staff roster — coaches and admins only. Reads a NARROW column set from
 * profiles (never select('*') on a table that also holds athletes' contact
 * details), and only the staff rows. The role itself is changed in Users; this
 * is a read/link surface.
 */
export async function fetchTeam(isDemo = false): Promise<TeamMember[]> {
  if (offline(isDemo)) return demoTeam.map(m => ({ ...m }))
  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,first_name,last_name,display_name,role,status,coach_slug')
    .in('role', ['coach', 'admin'])
    .order('role')
    .order('created_at', { ascending: true })
  if (error) return []
  return (data ?? []).map((r) => {
    const p = r as { id: string; email: string; first_name: string | null; last_name: string | null; display_name: string | null; role: TeamMember['role']; status: TeamMember['status']; coach_slug: string | null }
    const name = p.display_name?.trim() || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email
    return { id: p.id, name, email: p.email, role: p.role, status: p.status, coach_slug: p.coach_slug }
  })
}

// ── Display helpers ──────────────────────────────────────────────────────────

export function fmtCommission(rule: CommissionRule): string {
  const target = rule.coach_slug
    ? (COACHES.find(c => c.slug === rule.coach_slug)?.name ?? rule.coach_slug)
    : 'All coaches'
  const amount = rule.kind === 'percent'
    ? `${((rule.rate_bps ?? 0) / 100).toFixed(rule.rate_bps && rule.rate_bps % 100 ? 2 : 0)}%`
    : `$${((rule.amount_cents ?? 0) / 100).toFixed(2)}`
  return `${target} · ${amount} of ${rule.applies_to}`
}
