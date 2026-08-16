/**
 * settings.ts
 *
 * CRUD for the admin Settings sub-tabs backed by migration 029, plus the
 * Scheduling area that reuses coach_public_settings (009). One module so the
 * panels share one demo story and one error translator.
 *
 * Commission lived here until 049 removed the feature. The rules table is gone,
 * so nothing in this file reads or writes it.
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
import { fetchCoachRoster } from './coachRoster'
import { DEMO_SERVICES } from './services'
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

  const [settings, roster] = await Promise.all([
    supabase
      .from('coach_public_settings')
      .select('coach_slug,min_lead_minutes,max_advance_days,buffer_minutes,auto_confirm'),
    fetchCoachRoster(isDemo, { includeHidden: true }).catch(() => []),
  ])
  if (settings.error) return []

  const bySlug = new Map((settings.data ?? []).map((r) => [(r as { coach_slug: string }).coach_slug, r as Partial<SchedulingRow>]))
  // Driven by the roster, not the table: a coach with no settings row yet still
  // appears, with the DDL defaults, so the panel can create one by saving. The
  // roster is the DATABASE's roster now, not the bundled five, or a coach
  // provisioned from the admin would have no way to be given booking rules. It
  // falls back to the five when the read answers with nothing.
  const list = roster.length > 0
    ? roster.map(c => ({ slug: c.slug, name: c.name }))
    : COACHES.map(c => ({ slug: c.slug as string, name: c.name }))

  return list.map(c => {
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
// SERVICES — public.booking_services + coach_booking_services (009)
// =============================================================================
//
// The catalog the booking pages sell from. The admin owns the menu itself —
// what exists, what it is called, how long it runs, what it costs — while each
// coach owns WHICH of those services appears on their own page (the same
// service can be on every coach's menu or only one). Both live here because
// the admin is allowed to manage both sides; a coach edits their own side from
// their portal (BookingPolicyPanel).

export interface AdminServiceRow {
  id: string
  slug: string
  name: string
  description: string | null
  duration_minutes: number
  price_cents: number | null
  price_note: string | null
  is_active: boolean
  sort_order: number
}

const SERVICE_COLUMNS = 'id,slug,name,description,duration_minutes,price_cents,price_note,is_active,sort_order'

/** The slug is minted once, from the first name. Renames leave it alone — it is
 *  the stable public handle, and changing it would orphan links and history. */
function slugFromName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

let demoServices: AdminServiceRow[] | null = null
function servicesStore(): AdminServiceRow[] {
  if (!demoServices) demoServices = DEMO_SERVICES.map((s, i) => ({
    id: s.id, slug: s.slug, name: s.name, description: s.description,
    duration_minutes: s.durationMinutes, price_cents: s.priceCents, price_note: s.priceNote,
    is_active: true, sort_order: (i + 1) * 10,
  }))
  return demoServices
}

/** The whole catalog, inactive rows included — the admin needs to see what is
 *  switched off in order to switch it back on. */
export async function fetchAdminServices(isDemo = false): Promise<AdminServiceRow[]> {
  if (offline(isDemo)) return servicesStore().map(r => ({ ...r }))
  const { data, error } = await supabase
    .from('booking_services').select(SERVICE_COLUMNS).order('sort_order').order('name')
  if (error) return []
  return (data ?? []) as unknown as AdminServiceRow[]
}

export async function createService(
  input: { name: string; description: string; duration_minutes: number; price_cents: number | null; price_note: string; sort_order: number },
  isDemo = false,
): Promise<WriteResult> {
  const name = sanitizeStrict(input.name)
  if (!name) return { ok: false, message: 'Give the service a name.' }
  const slug = slugFromName(name)
  if (!slug) return { ok: false, message: 'The name needs at least one letter or number.' }
  const row = {
    slug, name,
    description: sanitize(input.description, 500) || null,
    duration_minutes: clampInt(input.duration_minutes, 5, 480, 30),
    price_cents: input.price_cents === null ? null : clampInt(input.price_cents, 0, 10_000_000, 0),
    price_note: sanitizeStrict(input.price_note) || null,
    sort_order: clampInt(input.sort_order, 0, 100000, 0),
  }
  if (offline(isDemo)) {
    await beat()
    if (servicesStore().some(s => s.slug === slug)) return { ok: false, message: 'That would duplicate one that already exists.' }
    servicesStore().push({ id: genId(), ...row, is_active: true })
    return { ok: true }
  }
  const { error } = await supabase.from('booking_services').insert(row)
  return error ? { ok: false, message: writeMessage(error, 'Could not add that service.') } : { ok: true }
}

export async function updateService(
  id: string,
  patch: Partial<Pick<AdminServiceRow, 'name' | 'description' | 'duration_minutes' | 'price_cents' | 'price_note' | 'is_active' | 'sort_order'>>,
  isDemo = false,
): Promise<WriteResult> {
  const clean: Record<string, unknown> = {}
  if (patch.name !== undefined) { const n = sanitizeStrict(patch.name); if (!n) return { ok: false, message: 'A name cannot be blank.' }; clean.name = n }
  if (patch.description !== undefined) clean.description = sanitize(patch.description ?? '', 500) || null
  if (patch.duration_minutes !== undefined) clean.duration_minutes = clampInt(patch.duration_minutes, 5, 480, 30)
  if (patch.price_cents !== undefined) clean.price_cents = patch.price_cents === null ? null : clampInt(patch.price_cents, 0, 10_000_000, 0)
  if (patch.price_note !== undefined) clean.price_note = sanitizeStrict(patch.price_note ?? '') || null
  if (patch.is_active !== undefined) clean.is_active = !!patch.is_active
  if (patch.sort_order !== undefined) clean.sort_order = clampInt(patch.sort_order, 0, 100000, 0)
  if (offline(isDemo)) {
    await beat()
    const store = servicesStore(); const i = store.findIndex(s => s.id === id)
    if (i >= 0) store[i] = { ...store[i], ...(clean as Partial<AdminServiceRow>) }
    return { ok: true }
  }
  const { error } = await supabase.from('booking_services').update({ ...clean, updated_at: nowIso() }).eq('id', id)
  return error ? { ok: false, message: writeMessage(error, 'That did not save.') } : { ok: true }
}

/**
 * Deleting is safe for history: bookings snapshot the service name and price at
 * booking time and their service_id goes null (009), so receipts survive. The
 * coach offering rows cascade away with the service.
 */
export async function deleteService(id: string, isDemo = false): Promise<WriteResult> {
  if (offline(isDemo)) {
    await beat()
    demoServices = servicesStore().filter(s => s.id !== id)
    demoCoachOffers.forEach(m => m.delete(id))
    return { ok: true }
  }
  const { error } = await supabase.from('booking_services').delete().eq('id', id)
  return error ? { ok: false, message: writeMessage(error, 'Could not remove that service.') } : { ok: true }
}

// ── Who offers what ──────────────────────────────────────────────────────────
//
// One row per (coach, service). A coach with no row for a service simply does
// not offer it, so the admin toggling one ON has to upsert, not update.

export interface CoachOfferRow {
  service_id: string
  is_active: boolean
  duration_minutes_override: number | null
}

const demoCoachOffers = new Map<string, Map<string, boolean>>()
function coachOfferStore(coachSlug: string): Map<string, boolean> {
  let m = demoCoachOffers.get(coachSlug)
  if (!m) { m = new Map(servicesStore().map(s => [s.id, true])); demoCoachOffers.set(coachSlug, m) }
  return m
}

export async function fetchCoachOffers(coachSlug: string, isDemo = false): Promise<CoachOfferRow[]> {
  if (offline(isDemo)) {
    return [...coachOfferStore(coachSlug)].map(([service_id, is_active]) => ({
      service_id, is_active, duration_minutes_override: null,
    }))
  }
  const { data, error } = await supabase
    .from('coach_booking_services')
    .select('service_id,is_active,duration_minutes_override')
    .eq('coach_slug', coachSlug)
  if (error) return []
  return (data ?? []) as unknown as CoachOfferRow[]
}

export async function setCoachOffered(
  coachSlug: string, serviceId: string, offered: boolean, isDemo = false,
): Promise<WriteResult> {
  if (offline(isDemo)) {
    await beat()
    coachOfferStore(coachSlug).set(serviceId, offered)
    return { ok: true }
  }
  // The overrides are deliberately NOT sent: this control changes visibility,
  // and an upsert that omits a column leaves whatever the row already has.
  const { error } = await supabase
    .from('coach_booking_services')
    .upsert(
      { coach_slug: coachSlug, service_id: serviceId, is_active: offered },
      { onConflict: 'coach_slug,service_id' },
    )
  return error ? { ok: false, message: writeMessage(error, 'That did not save.') } : { ok: true }
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
