import { supabase, supabaseConfigured } from './supabase'

/**
 * The Insights read layer.
 *
 * Every standard report is one call to a SECURITY DEFINER function from
 * migration 027, which does the cross-table aggregation and re-imposes the
 * report gate (admin/analytics sees the business, a coach sees their slice).
 * This module normalises those rows into a shape the charts can draw, fills the
 * time axis so bars don't skip empty buckets, and — in demo/preview mode —
 * synthesises realistic numbers so the panels are never blank.
 *
 * Saved reports are plain CRUD over `public.saved_reports`; RLS decides which
 * rows come back (yours + shared). In demo mode they live in a module-local
 * array so the builder is fully usable without a backend.
 */

// ── Vocabulary ───────────────────────────────────────────────────────────────

export type Bucket = 'day' | 'week' | 'month'
export type ChartKind = 'bar' | 'line' | 'stackedBar' | 'donut' | 'funnel'
export type MetricKey =
  | 'bookings'
  | 'funnel'
  | 'leads'
  | 'revenue'
  | 'coach_hours'
  | 'form_submissions'

export interface ReportConfig {
  metric: MetricKey
  rangeDays: number
  bucket: Bucket
  chart: ChartKind
  filters?: Record<string, unknown>
}

export interface SavedReport {
  id: string
  owner_id: string | null
  name: string
  config: ReportConfig
  is_shared: boolean
  created_at: string
  updated_at?: string
}

export interface MetricMeta {
  key: MetricKey
  label: string
  description: string
  /** Chart kinds that make sense for this metric — the first is the default. */
  charts: ChartKind[]
  /** True for metrics that come from a sibling vertical and may be unbuilt. */
  guarded?: boolean
}

export const METRICS: MetricMeta[] = [
  { key: 'bookings',         label: 'Bookings',         description: 'Bookings created over time, by status.',        charts: ['stackedBar', 'bar', 'line'] },
  { key: 'funnel',           label: 'Booking funnel',   description: 'Sessions reaching each step of the booking flow.', charts: ['funnel', 'bar'] },
  { key: 'leads',            label: 'Applications',     description: 'Incoming applications, grouped by status.',      charts: ['donut', 'bar'] },
  { key: 'revenue',          label: 'Revenue',          description: 'Order revenue over time (sales vertical).',      charts: ['bar', 'line'], guarded: true },
  { key: 'coach_hours',      label: 'Coach hours',      description: 'Logged work-shift hours per coach.',             charts: ['bar'], guarded: true },
  { key: 'form_submissions', label: 'Form submissions', description: 'Intake form submissions over time.',            charts: ['bar', 'line'], guarded: true },
]

export function metricMeta(key: MetricKey): MetricMeta {
  return METRICS.find(m => m.key === key) ?? METRICS[0]
}

/** Status → human label + the palette CSS var that colours its mark. */
export const BOOKING_STATUS_META: Record<string, { label: string; varName: string }> = {
  pending:   { label: 'Pending',   varName: '--viz-warn' },
  confirmed: { label: 'Confirmed', varName: '--viz-good' },
  cancelled: { label: 'Cancelled', varName: '--viz-bad' },
}
export const BOOKING_STATUS_ORDER = ['confirmed', 'pending', 'cancelled']

export const LEAD_STATUS_META: Record<string, { label: string; varName: string }> = {
  new:      { label: 'New',      varName: '--viz-info' },
  reviewed: { label: 'Reviewed', varName: '--viz-warn' },
  accepted: { label: 'Accepted', varName: '--viz-good' },
  declined: { label: 'Declined', varName: '--viz-bad' },
}
export const LEAD_STATUS_ORDER = ['new', 'reviewed', 'accepted', 'declined']

export const FUNNEL_LABELS: Record<string, string> = {
  booking_page_view: 'Opened booking',
  service_selected:  'Chose service',
  coach_selected:    'Chose coach',
  slot_selected:     'Picked a time',
  booking_completed: 'Booked',
}

/** The 6 categorical palette vars, in fixed order — cap series at 6, then Other. */
export const CATEGORICAL_VARS = ['--viz-1', '--viz-2', '--viz-3', '--viz-4', '--viz-5', '--viz-6']

// ── Time axis ────────────────────────────────────────────────────────────────

export interface DateRange { from: string; to: string }

export function rangeFor(days: number): DateRange {
  const to = new Date()
  const from = new Date(to.getTime() - days * 86_400_000)
  return { from: from.toISOString(), to: to.toISOString() }
}

function dayKey(d: Date): string { return d.toISOString().slice(0, 10) }

function bucketStart(d: Date, bucket: Bucket): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  if (bucket === 'week') {
    const dow = (x.getUTCDay() + 6) % 7 // 0 = Monday, matching Postgres date_trunc('week')
    x.setUTCDate(x.getUTCDate() - dow)
  } else if (bucket === 'month') {
    x.setUTCDate(1)
  }
  return x
}

function advance(d: Date, bucket: Bucket): Date {
  const x = new Date(d)
  if (bucket === 'day') x.setUTCDate(x.getUTCDate() + 1)
  else if (bucket === 'week') x.setUTCDate(x.getUTCDate() + 7)
  else x.setUTCMonth(x.getUTCMonth() + 1)
  return x
}

/** Ordered bucket keys (YYYY-MM-DD of each bucket start) spanning the range. */
export function axisKeys(range: DateRange, bucket: Bucket): string[] {
  const keys: string[] = []
  let cur = bucketStart(new Date(range.from), bucket)
  const end = new Date(range.to)
  // Guard against an accidental unbounded loop.
  for (let i = 0; i < 400 && cur <= end; i++) {
    keys.push(dayKey(cur))
    cur = advance(cur, bucket)
  }
  return keys
}

export function bucketLabel(key: string, bucket: Bucket): string {
  if (bucket === 'month') return key.slice(0, 7)
  return key.slice(5) // MM-DD
}

// ── Result shapes ────────────────────────────────────────────────────────────

export interface BookingsResult {
  points: { key: string; byStatus: Record<string, number>; total: number }[]
  byStatus: Record<string, number>
  total: number
  statuses: string[]
}
export interface FunnelResult {
  steps: { step: string; label: string; sessions: number; rate: number }[]
  top: number
}
export interface LeadsResult {
  rows: { status: string; label: string; count: number }[]
  total: number
}
export interface RevenueResult {
  available: boolean
  points: { key: string; revenueCents: number; orders: number }[]
  totalCents: number
  totalOrders: number
}
export interface CoachHoursResult {
  available: boolean
  rows: { coachSlug: string; coachName: string; minutes: number; entries: number }[]
  totalMinutes: number
}
export interface SubmissionsResult {
  available: boolean
  points: { key: string; submissions: number }[]
  total: number
}

// ── Small helpers ────────────────────────────────────────────────────────────

const useDemo = (isDemo: boolean) => isDemo || !supabaseConfigured

// A cheap deterministic PRNG so demo charts look the same across re-renders
// rather than reshuffling on every keystroke.
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}
function seedFromKey(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error || !Array.isArray(data)) return []
  return data as T[]
}

// ── Bookings over time ───────────────────────────────────────────────────────

export async function fetchBookings(range: DateRange, bucket: Bucket, isDemo = false): Promise<BookingsResult> {
  const keys = axisKeys(range, bucket)
  const statuses = BOOKING_STATUS_ORDER
  const points = keys.map(key => ({ key, byStatus: {} as Record<string, number>, total: 0 }))
  const index = new Map(points.map(p => [p.key, p]))
  const byStatus: Record<string, number> = {}

  if (useDemo(isDemo)) {
    for (const p of points) {
      const rnd = seeded(seedFromKey('bk' + p.key))
      const conf = Math.floor(rnd() * 6) + 2
      const pend = Math.floor(rnd() * 3)
      const canc = Math.floor(rnd() * 2)
      p.byStatus = { confirmed: conf, pending: pend, cancelled: canc }
      p.total = conf + pend + canc
    }
  } else {
    const rows = await callRpc<{ bucket: string; status: string; bookings: number }>(
      'report_bookings_over_time', { p_from: range.from, p_to: range.to, p_bucket: bucket }
    )
    for (const r of rows) {
      const p = index.get((r.bucket ?? '').slice(0, 10))
      if (!p) continue
      p.byStatus[r.status] = (p.byStatus[r.status] ?? 0) + Number(r.bookings)
      p.total += Number(r.bookings)
    }
  }

  let total = 0
  for (const p of points) {
    total += p.total
    for (const s of statuses) byStatus[s] = (byStatus[s] ?? 0) + (p.byStatus[s] ?? 0)
  }
  return { points, byStatus, total, statuses }
}

// ── Booking funnel ───────────────────────────────────────────────────────────

export async function fetchFunnel(range: DateRange, isDemo = false): Promise<FunnelResult> {
  const order = ['booking_page_view', 'service_selected', 'coach_selected', 'slot_selected', 'booking_completed']
  let raw: { step: string; sessions: number }[]

  if (useDemo(isDemo)) {
    const rnd = seeded(seedFromKey('funnel' + range.from))
    let n = 400 + Math.floor(rnd() * 200)
    raw = order.map(step => {
      const keep = step === order[0] ? 1 : 0.55 + rnd() * 0.3
      n = Math.max(1, Math.round(n * keep))
      return { step, sessions: n }
    })
  } else {
    const rows = await callRpc<{ step: string; step_order: number; sessions: number }>(
      'report_booking_funnel', { p_from: range.from, p_to: range.to }
    )
    const map = new Map(rows.map(r => [r.step, Number(r.sessions)]))
    raw = order.map(step => ({ step, sessions: map.get(step) ?? 0 }))
  }

  const top = raw[0]?.sessions || 0
  return {
    top,
    steps: raw.map(r => ({
      step: r.step,
      label: FUNNEL_LABELS[r.step] ?? r.step,
      sessions: r.sessions,
      rate: top > 0 ? r.sessions / top : 0,
    })),
  }
}

// ── Applications by status ───────────────────────────────────────────────────

export async function fetchLeads(range: DateRange, isDemo = false): Promise<LeadsResult> {
  const counts: Record<string, number> = {}

  if (useDemo(isDemo)) {
    const rnd = seeded(seedFromKey('leads' + range.from))
    counts.new = Math.floor(rnd() * 12) + 6
    counts.reviewed = Math.floor(rnd() * 8) + 3
    counts.accepted = Math.floor(rnd() * 6) + 2
    counts.declined = Math.floor(rnd() * 5) + 1
  } else {
    const rows = await callRpc<{ status: string; leads: number }>(
      'report_leads_by_status', { p_from: range.from, p_to: range.to }
    )
    for (const r of rows) counts[r.status] = Number(r.leads)
  }

  const rows = LEAD_STATUS_ORDER.map(status => ({
    status,
    label: LEAD_STATUS_META[status]?.label ?? status,
    count: counts[status] ?? 0,
  }))
  return { rows, total: rows.reduce((a, r) => a + r.count, 0) }
}

// ── Revenue over time (guarded sibling: orders / 026) ────────────────────────

export async function fetchRevenue(range: DateRange, bucket: Bucket, isDemo = false): Promise<RevenueResult> {
  const keys = axisKeys(range, bucket)
  const points = keys.map(key => ({ key, revenueCents: 0, orders: 0 }))
  const index = new Map(points.map(p => [p.key, p]))

  if (useDemo(isDemo)) {
    for (const p of points) {
      const rnd = seeded(seedFromKey('rev' + p.key))
      const orders = Math.floor(rnd() * 5)
      p.orders = orders
      p.revenueCents = orders * (7900 + Math.floor(rnd() * 12000))
    }
  } else {
    const rows = await callRpc<{ bucket: string; revenue_cents: number; order_count: number }>(
      'report_revenue_over_time', { p_from: range.from, p_to: range.to, p_bucket: bucket }
    )
    // Empty rows === orders vertical not built (or coach scope): report unavailable.
    if (rows.length === 0) return { available: false, points: [], totalCents: 0, totalOrders: 0 }
    for (const r of rows) {
      const p = index.get((r.bucket ?? '').slice(0, 10))
      if (!p) continue
      p.revenueCents += Number(r.revenue_cents)
      p.orders += Number(r.order_count)
    }
  }

  return {
    available: true,
    points,
    totalCents: points.reduce((a, p) => a + p.revenueCents, 0),
    totalOrders: points.reduce((a, p) => a + p.orders, 0),
  }
}

// ── Coach hours (guarded sibling: time_entries / 022) ────────────────────────

export async function fetchCoachHours(range: DateRange, isDemo = false): Promise<CoachHoursResult> {
  let rows: { coachSlug: string; coachName: string; minutes: number; entries: number }[]

  if (useDemo(isDemo)) {
    const demo = ['Ronnie Vallejo', 'Seth Burman', 'Alex Rivera', 'Jordan Cole']
    const rnd = seeded(seedFromKey('hours' + range.from))
    rows = demo.map((coachName, i) => ({
      coachSlug: coachName.toLowerCase().replace(/\s+/g, '-'),
      coachName,
      minutes: Math.floor(rnd() * 1800) + 600,
      entries: Math.floor(rnd() * 20) + 8,
    })).sort((a, b) => b.minutes - a.minutes)
  } else {
    const data = await callRpc<{ coach_slug: string; coach_name: string; minutes: number; entries: number }>(
      'report_coach_hours', { p_from: range.from, p_to: range.to }
    )
    if (data.length === 0) return { available: false, rows: [], totalMinutes: 0 }
    rows = data.map(r => ({
      coachSlug: r.coach_slug,
      coachName: r.coach_name || r.coach_slug,
      minutes: Number(r.minutes),
      entries: Number(r.entries),
    }))
  }

  return { available: true, rows, totalMinutes: rows.reduce((a, r) => a + r.minutes, 0) }
}

// ── Form submissions over time (guarded sibling: form_submissions / 024) ─────

export async function fetchSubmissions(range: DateRange, bucket: Bucket, isDemo = false): Promise<SubmissionsResult> {
  const keys = axisKeys(range, bucket)
  const points = keys.map(key => ({ key, submissions: 0 }))
  const index = new Map(points.map(p => [p.key, p]))

  if (useDemo(isDemo)) {
    for (const p of points) {
      const rnd = seeded(seedFromKey('fs' + p.key))
      p.submissions = Math.floor(rnd() * 7)
    }
  } else {
    const rows = await callRpc<{ bucket: string; submissions: number }>(
      'report_form_submissions_over_time', { p_from: range.from, p_to: range.to, p_bucket: bucket }
    )
    if (rows.length === 0) return { available: false, points: [], total: 0 }
    for (const r of rows) {
      const p = index.get((r.bucket ?? '').slice(0, 10))
      if (p) p.submissions += Number(r.submissions)
    }
  }

  return { available: true, points, total: points.reduce((a, p) => a + p.submissions, 0) }
}

// ── Saved reports (CRUD) ─────────────────────────────────────────────────────

const demoStore: SavedReport[] = [
  {
    id: 'demo-1',
    owner_id: 'demo-user',
    name: 'Bookings, last 30 days',
    config: { metric: 'bookings', rangeDays: 30, bucket: 'day', chart: 'stackedBar' },
    is_shared: true,
    created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  },
  {
    id: 'demo-2',
    owner_id: 'demo-user',
    name: 'Applications this quarter',
    config: { metric: 'leads', rangeDays: 90, bucket: 'week', chart: 'donut' },
    is_shared: false,
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
]

export async function listSavedReports(isDemo = false): Promise<SavedReport[]> {
  if (useDemo(isDemo)) return [...demoStore].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const { data, error } = await supabase
    .from('saved_reports')
    .select('id, owner_id, name, config, is_shared, created_at, updated_at')
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return data as SavedReport[]
}

export async function createSavedReport(
  input: { name: string; config: ReportConfig; is_shared: boolean },
  isDemo = false
): Promise<SavedReport | null> {
  if (useDemo(isDemo)) {
    const row: SavedReport = {
      id: `demo-${Date.now()}`,
      owner_id: 'demo-user',
      name: input.name,
      config: input.config,
      is_shared: input.is_shared,
      created_at: new Date().toISOString(),
    }
    demoStore.push(row)
    return row
  }
  // owner_id defaults to auth.uid() in the database; never sent from the client.
  const { data, error } = await supabase
    .from('saved_reports')
    .insert({ name: input.name, config: input.config, is_shared: input.is_shared })
    .select('id, owner_id, name, config, is_shared, created_at, updated_at')
    .single()
  if (error || !data) return null
  return data as SavedReport
}

export async function updateSavedReport(
  id: string,
  patch: Partial<Pick<SavedReport, 'name' | 'config' | 'is_shared'>>,
  isDemo = false
): Promise<boolean> {
  if (useDemo(isDemo)) {
    const row = demoStore.find(r => r.id === id)
    if (row) Object.assign(row, patch)
    return !!row
  }
  const { error } = await supabase.from('saved_reports').update(patch).eq('id', id)
  return !error
}

export async function deleteSavedReport(id: string, isDemo = false): Promise<boolean> {
  if (useDemo(isDemo)) {
    const i = demoStore.findIndex(r => r.id === id)
    if (i >= 0) demoStore.splice(i, 1)
    return i >= 0
  }
  const { error } = await supabase.from('saved_reports').delete().eq('id', id)
  return !error
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
