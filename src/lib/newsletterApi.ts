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
 * Supabase migration: CREATE_NEWSLETTER_LEADS.sql
 */

import { supabase, supabaseConfigured } from './supabase'
import { sanitize, sanitizeStrict } from '../utils/sanitize'
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

export function getNewsletterAccess(): NewsletterAccess | null {
  try {
    const raw = localStorage.getItem(ACCESS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<NewsletterAccess>
    if (
      typeof parsed.email === 'string' && parsed.email.length > 0 &&
      typeof parsed.firstName === 'string'
    ) {
      return parsed as NewsletterAccess
    }
    return null
  } catch { return null }
}

function writeAccess(access: NewsletterAccess) {
  localStorage.setItem(ACCESS_KEY, JSON.stringify(access))
}

export function clearNewsletterAccess() {
  localStorage.removeItem(ACCESS_KEY)
}

// ── Validation ──────────────────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
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
  const email     = sanitize(data.email.trim().toLowerCase(), 254)
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

/** Generate and download a CSV of newsletter leads. */
export function exportNewsletterCsv(leads: NewsletterLead[]) {
  const headers = ['First Name', 'Last Name', 'Email', 'Source', 'Signed Up'].join(',')
  const rows = leads.map(l => [
    `"${l.firstName}"`,
    `"${l.lastName}"`,
    `"${l.email}"`,
    `"${l.source}"`,
    `"${new Date(l.createdAt).toLocaleDateString('en-US')}"`,
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
