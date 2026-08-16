/**
 * settingsExport.ts
 *
 * Client-side CSV export for the Import & Export settings panel — leads
 * (applications), bookings, and clients (athlete accounts). No new table: it
 * reads what already exists and writes a file in the browser.
 *
 * The CSV escaping mirrors newsletterApi.ts exactly, because the same two
 * hazards apply — a value with a quote shifting every later column, and a value
 * starting with =/+/-/@ executing as a formula when the admin opens the file.
 */

import { supabase, supabaseConfigured } from './supabase'
import { DEMO_LEADS, DEMO_BOOKINGS } from '../data/demoData'
import { fetchPeople } from './userManagement'
import { BOOKING_STAFF_COLUMNS } from '../types/database'
import { downloadText } from './fileDownload'
// The escaping moved to `dataImport.ts`, next to the reader that has to undo
// exactly it. A writer and a reader of the same format in two files drift the
// moment one of them is touched, and the drift shows up as somebody's export
// refusing to import.
import { toCsv } from './dataImport'

export type ExportKind = 'leads' | 'bookings' | 'clients'

export interface ExportResult { ok: boolean; count: number; message?: string }

const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

function download(filenameBase: string, csv: string): void {
  downloadText(
    `axis_${filenameBase}_${new Date().toISOString().split('T')[0]}.csv`,
    csv,
    'text/csv;charset=utf-8;',
  )
}

const date = (v: unknown) => (v ? new Date(String(v)).toLocaleString('en-US') : '')

// ── Leads (applications) ─────────────────────────────────────────────────────

async function leadRows(isDemo: boolean): Promise<Record<string, unknown>[]> {
  if (offline(isDemo)) return DEMO_LEADS as unknown as Record<string, unknown>[]
  const { data, error } = await supabase
    .from('leads')
    .select('first_name,last_name,email,social,service,coach_pref,status,created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Record<string, unknown>[]
}

// ── Bookings ─────────────────────────────────────────────────────────────────

async function bookingRows(isDemo: boolean): Promise<Record<string, unknown>[]> {
  if (offline(isDemo)) return DEMO_BOOKINGS as unknown as Record<string, unknown>[]
  const { data, error } = await supabase
    .from('bookings')
    .select(BOOKING_STAFF_COLUMNS)
    .order('booked_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Record<string, unknown>[]
}

// ── Clients (athlete accounts) ───────────────────────────────────────────────

async function clientRows(isDemo: boolean): Promise<Record<string, unknown>[]> {
  // fetchPeople handles demo/offline and returns the whole roster; clients are
  // the athletes on it. A null return is an outage, surfaced by the caller.
  const people = await fetchPeople(isDemo)
  if (people === null) throw new Error('outage')
  return people.filter(p => p.role === 'athlete') as unknown as Record<string, unknown>[]
}

/**
 * Export one dataset to a downloaded CSV. Returns a count for the panel to
 * report, or a message on failure. Never throws.
 */
export async function exportDataset(kind: ExportKind, isDemo = false): Promise<ExportResult> {
  try {
    if (kind === 'leads') {
      const rows = await leadRows(isDemo)
      const csv = toCsv(
        ['First name', 'Last name', 'Email', 'Social', 'Service', 'Coach preference', 'Status', 'Applied'],
        rows.map(r => [r.first_name, r.last_name, r.email, r.social, r.service, r.coach_pref, r.status, date(r.created_at)]),
      )
      download('leads', csv)
      return { ok: true, count: rows.length }
    }
    if (kind === 'bookings') {
      const rows = await bookingRows(isDemo)
      const csv = toCsv(
        ['First name', 'Last name', 'Email', 'Phone', 'Coach', 'Service', 'Booked for', 'Status', 'Created'],
        rows.map(r => [
          r.first_name, r.last_name, r.email, r.phone, r.coach_slug,
          r.service_name ?? r.service_interest ?? '', date(r.booked_at), r.status, date(r.created_at),
        ]),
      )
      download('bookings', csv)
      return { ok: true, count: rows.length }
    }
    // clients
    const rows = await clientRows(isDemo)
    const csv = toCsv(
      ['First name', 'Last name', 'Email', 'Phone', 'Status', 'Joined'],
      rows.map(r => [r.first_name, r.last_name, r.email, r.phone, r.status, date(r.created_at)]),
    )
    download('clients', csv)
    return { ok: true, count: rows.length }
  } catch {
    return { ok: false, count: 0, message: 'Could not build that export. Check your connection and try again.' }
  }
}
