import { useState, useEffect, useCallback } from 'react'
import { supabase, supabaseConfigured } from '../../lib/supabase'
import { fetchNewsletterLeads } from '../../lib/newsletterApi'
import type { Lead, Booking } from '../../types/database'
import { BOOKING_STAFF_COLUMNS } from '../../types/database'
import type { NewsletterLead } from '../../types/newsletter'
import { DEMO_LEADS, DEMO_NEWSLETTER_LEADS, DEMO_BOOKINGS } from '../../data/demoData'
import { useMediaQuery, MOBILE_QUERY } from '../../lib/dashboard'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { sanitizeText, sanitizeEmail, isValidEmail } from '../../utils/sanitize'
import { useHashSubTab } from '../../lib/useHashSubTab'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../lib/usePermissions'
import { sendInvitation } from '../../lib/invitations'
import { fetchPeople, ROLE_LABELS, STATUS_LABELS, STATUS_COLORS as ACCOUNT_COLORS } from '../../lib/userManagement'
import type { Profile, ProfileStatus, UserRole } from '../../lib/account'
import RosterBoard from './RosterBoard'

// ── Types ──────────────────────────────────────────────────────────────────

/** Long enough for a real note, short enough that nobody can post a novel. */
const NOTES_MAX = 4000

/** `leads.first_name` / `last_name` are NOT NULL text with no length cap in the
 *  schema. The cap is ours, so a paste cannot turn a name column into an essay. */
const NAME_MAX = 80

/** `leads.social` is the one contact-handle column the table has. */
const HANDLE_MAX = 200

const ACCENT = '#272C84'
const DANGER = '#c8102e'
const GREEN  = '#22c55e'

/**
 * What a staff-added contact's `service` says.
 *
 * `leads.service` is NOT NULL (001) and every other row got its value from the
 * public application form. A row typed in by an admin never went through that
 * form, so inventing a service for it would be a lie in the one column a coach
 * reads to know what somebody asked for. This is the honest minimum: it names
 * where the row came from.
 */
const STAFF_ADDED_SERVICE = 'Added by staff'

type LeadSource = 'application' | 'newsletter' | 'booking'

/** The three facts about an account a contact list has any business holding. */
interface LeadAccount {
  id: string
  role: UserRole
  status: ProfileStatus
}

interface UnifiedLead {
  email: string
  firstName: string
  lastName: string
  sources: LeadSource[]
  application: Lead | null
  newsletter: NewsletterLead | null
  bookings: Booking[]
  /**
   * The `profiles` row at this address, when there is one.
   *
   * Deliberately NOT a fourth entry in `sources`: an account is not a way
   * somebody arrived, it is what happened after they did. Keeping it off that
   * list also keeps the source filters and badges saying exactly what they have
   * always said.
   */
  account: LeadAccount | null
  firstSeen: string
  lastSeen: string
}

/**
 * Demo mode and "no credentials configured" are the same situation from a
 * screen's point of view: there is nothing to talk to, and the screen must
 * still render. Every write below routes on this, never on `isDemo` alone.
 */
const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

/** Demo writes are instant; a beat of latency keeps the saving states honest. */
const beat = () => new Promise<void>(r => setTimeout(r, 300))

/**
 * The demo's application records, mutable.
 *
 * DEMO_LEADS is a module constant shared with every other demo surface, so a
 * demo add or delete cannot write to it. This is the local copy that demo
 * writes land in, seeded once and kept for the life of the tab, which is what
 * makes "add a contact" in the demo survive a Refresh the way a real one does.
 */
let demoLeads: Lead[] | null = null
function demoLeadStore(): Lead[] {
  if (!demoLeads) demoLeads = DEMO_LEADS.map(l => ({ ...l }))
  return demoLeads
}

/**
 * Every column of `leads`, at its schema default, so a demo row is the same
 * shape as one the database would have written. Only the fields the form
 * actually collects are passed in.
 */
function blankLead(patch: Partial<Lead>): Lead {
  return {
    id: '', created_at: new Date().toISOString(),
    first_name: '', last_name: '', email: '', social: null,
    service: STAFF_ADDED_SERVICE, coach_pref: 'No Preference',
    age: null, height: null, body_weight: null, weight_class: null,
    experience: null, injuries: null, train_days: null, occupation: null,
    squat_max: null, bench_max: null, dead_max: null,
    squat_freq: null, bench_freq: null, dead_freq: null,
    current_program: null, squat_style: null, bench_style: null, dead_style: null,
    weak_points: null, learning_style: null, sleep: null, nutrition: null,
    stress: null, recovery: null, expectations: null, goals: null,
    status: 'new', admin_notes: null,
    ...patch,
  }
}

/**
 * What a PostgREST failure on `leads` becomes on screen.
 *
 * `leads_admin_all` (017) is the only policy that permits an insert or a delete,
 * so a refusal here is nearly always "you are not an admin". A refused write
 * that changed nothing comes back as zero rows rather than as an error, which
 * is what every `.select('id')` below is for.
 */
function leadWriteRefusal(message: string | undefined, action: string): string {
  if (message && /row-level security|permission denied/i.test(message)) {
    return `The database refused that change. ${action} is an admin action.`
  }
  return message || 'Check your connection and try again.'
}

// ── Merge logic ────────────────────────────────────────────────────────────

function mergeToUnified(
  applications: Lead[],
  newsletters: NewsletterLead[],
  bookings: Booking[],
  people: Profile[] = [],
): UnifiedLead[] {
  const map = new Map<string, UnifiedLead>()

  const upsert = (email: string, patch: Partial<UnifiedLead>) => {
    const key = email.toLowerCase()
    const existing = map.get(key)
    if (existing) {
      if (patch.sources) existing.sources = [...new Set([...existing.sources, ...patch.sources])]
      if (patch.application && !existing.application) { existing.application = patch.application; existing.firstName = patch.application.first_name; existing.lastName = patch.application.last_name }
      if (patch.newsletter && !existing.newsletter) existing.newsletter = patch.newsletter
      if (patch.bookings?.length) existing.bookings.push(...patch.bookings)
      if (patch.firstSeen && patch.firstSeen < existing.firstSeen) existing.firstSeen = patch.firstSeen
      if (patch.lastSeen  && patch.lastSeen  > existing.lastSeen)  existing.lastSeen  = patch.lastSeen
    } else {
      map.set(key, {
        email: email.toLowerCase(),
        firstName: patch.firstName ?? '',
        lastName:  patch.lastName  ?? '',
        sources:   patch.sources   ?? [],
        application: patch.application ?? null,
        newsletter:  patch.newsletter  ?? null,
        bookings:    patch.bookings    ?? [],
        account:     null,
        firstSeen:   patch.firstSeen   ?? new Date().toISOString(),
        lastSeen:    patch.lastSeen    ?? new Date().toISOString(),
      })
    }
  }

  for (const a of applications) {
    upsert(a.email, { firstName: a.first_name, lastName: a.last_name, sources: ['application'], application: a, firstSeen: a.created_at, lastSeen: a.created_at })
  }
  for (const n of newsletters) {
    upsert(n.email, { firstName: n.firstName, lastName: n.lastName, sources: ['newsletter'], newsletter: n, firstSeen: n.createdAt, lastSeen: n.createdAt })
  }
  for (const b of bookings) {
    upsert(b.email, { firstName: b.first_name, lastName: b.last_name, sources: ['booking'], bookings: [b], firstSeen: b.created_at, lastSeen: b.booked_at })
  }

  /**
   * The fourth source, and the only one that ATTACHES rather than adds.
   *
   * A profile joins a contact that already exists; it never mints one. The CRM
   * is the record of people who came in from the outside, and a staff account
   * with no application, no signup and no booking is not a contact of the
   * business, it is a colleague. Settings > Users & permissions is where those
   * are managed and this panel says so rather than duplicating them.
   *
   * The join is the same one `bookings.client_id` uses: lower(email).
   */
  for (const p of people) {
    const row = map.get((p.email ?? '').toLowerCase())
    if (!row) continue
    row.account = { id: p.id, role: p.role, status: p.status }
    // A newsletter-only contact often has no name on it. The account does.
    if (!row.firstName && p.first_name) row.firstName = p.first_name
    if (!row.lastName  && p.last_name)  row.lastName  = p.last_name
  }

  return Array.from(map.values()).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
}

// ── Source badge ───────────────────────────────────────────────────────────

const SOURCE_META: Record<LeadSource, { label: string; color: string }> = {
  application: { label: 'Applied',     color: '#c8102e' },
  newsletter:  { label: 'Newsletter',  color: '#0d5bae' },
  booking:     { label: 'Booked Call', color: 'var(--text)' },
}

function SourceBadge({ source }: { source: LeadSource }) {
  const { label, color } = SOURCE_META[source]
  return (
    <span style={{ background: color + '18', border: `1px solid ${color}55`, color, fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.15rem .5rem', borderRadius: '.2rem', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

// ── Status badge ───────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = { new: '#c8102e', reviewed: '#272C84', accepted: '#22c55e', declined: 'var(--text-4)' }
// Bookings have their own status vocabulary — coloring them with the lead map
// sends every booking status to the gray fallback.
const BOOKING_STATUS_COLORS: Record<string, string> = { pending: '#eab308', confirmed: '#22c55e', completed: '#272C84', cancelled: '#c8102e' }

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? 'var(--text-4)'
  return (
    <span style={{ background: c + '18', border: `1px solid ${c}`, color: c, fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.15rem .5rem', borderRadius: '.2rem' }}>
      {status}
    </span>
  )
}

// ── Account badge ──────────────────────────────────────────────────────────

/**
 * Prefixed with "App" on purpose. An application status of `accepted` is green
 * too, and the two badges sit side by side on a phone card; without the word
 * they read as one fact stated twice.
 */
function AccountBadge({ account }: { account: LeadAccount }) {
  const c = ACCOUNT_COLORS[account.status]
  // `suspended` is a CSS variable, not a hex, and `var(--text-4)18` is not a
  // color at all: it is a declaration the browser drops, which is how a badge
  // ends up with no fill and no border. Only hexes get the alpha suffix.
  const hex = c.startsWith('#')
  return (
    <span
      title={`${ROLE_LABELS[account.role]} account, ${STATUS_LABELS[account.status].toLowerCase()}`}
      style={{ background: hex ? c + '18' : 'transparent', border: `1px solid ${hex ? c : 'var(--border-mid)'}`, color: c, fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.15rem .5rem', borderRadius: '.2rem', whiteSpace: 'nowrap' }}
    >
      App · {STATUS_LABELS[account.status]}
    </span>
  )
}

const titleizeSlug = (slug: string) => slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const microLabel = { color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' as const }

function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.7rem 1rem' }}>
      <span style={{ color: DANGER, fontSize: '.78rem', lineHeight: 1.6 }}>{message}</span>
    </div>
  )
}

const ghostButton = (mobile: boolean) => ({
  background: 'transparent', border: '1px solid var(--surface-2)', color: 'var(--text-3)',
  fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const,
  padding: mobile ? '.6rem 1rem' : '.5rem 1rem', minHeight: '2.5rem', borderRadius: '.2rem',
  cursor: 'pointer', fontFamily: 'inherit',
})

const solidButton = (color: string, mobile: boolean) => ({
  background: color, border: 'none', color: '#ffffff',
  fontSize: '.6rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase' as const,
  padding: mobile ? '.6rem 1.1rem' : '.5rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem',
  cursor: 'pointer', fontFamily: 'inherit',
})

// ── Lead detail panel ──────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function LeadDetail({ lead, onClose, onUpdateLead, onReload, isDemo, isMobile, canAdmin, canManagePeople, accountsKnown }: {
  lead: UnifiedLead
  onClose: () => void
  onUpdateLead: (updated: Lead) => void
  /** Re-reads every source and re-selects the given address, or clears the pane. */
  onReload: (selectEmail: string | null) => Promise<void>
  isDemo: boolean
  isMobile: boolean
  /** Signage only. `leads_admin_all` is what actually decides an insert or a delete. */
  canAdmin: boolean
  canManagePeople: boolean
  accountsKnown: boolean
}) {
  const [notes, setNotes] = useState(lead.application?.admin_notes ?? '')
  const [status, setStatus] = useState<Lead['status']>(lead.application?.status ?? 'new')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  // Identity edit — its own choose-then-save cycle, so the status/notes save
  // keeps meaning exactly what it always meant.
  const [editing, setEditing] = useState(false)
  const [idDraft, setIdDraft] = useState({ first: '', last: '', email: '', social: '' })
  const [idBusy, setIdBusy] = useState(false)
  const [idError, setIdError] = useState<string | null>(null)

  const [armedDelete, setArmedDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [armedInvite, setArmedInvite] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ link: string; emailed: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setNotes(lead.application?.admin_notes ?? '')
    setStatus(lead.application?.status ?? 'new')
    setSaveState('idle')
    setSaveError(null)
    setEditing(false)
    setIdError(null)
    setArmedDelete(false)
    setDeleteError(null)
    setArmedInvite(false)
    setInviteError(null)
    setIssued(null)
    setCopied(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.email])

  // Choose-then-save: status chips and notes are drafts until saved.
  const dirty = !!lead.application && (
    notes !== (lead.application.admin_notes ?? '') ||
    status !== lead.application.status
  )

  const markEdited = () => {
    setSaveState(s => (s === 'saved' || s === 'error') ? 'idle' : s)
    setSaveError(null)
  }

  const save = async () => {
    if (!lead.application || saveState === 'saving') return
    setSaveState('saving')
    setSaveError(null)
    try {
      if (!isDemo && supabaseConfigured) {
        // Bounded and stripped here, because the textarea's maxLength is a DOM
        // attribute and this is the last point the client controls.
        const { error } = await supabase.from('leads').update({ admin_notes: sanitizeText(notes, NOTES_MAX), status }).eq('id', lead.application.id)
        if (error) throw new Error(error.message)
      } else {
        await new Promise(r => setTimeout(r, 400)) // simulate latency in demo
        const row = demoLeadStore().find(l => l.id === lead.application?.id)
        if (row) { row.admin_notes = notes; row.status = status }
      }
      onUpdateLead({ ...lead.application, admin_notes: notes, status })
      setSaveState('saved')
    } catch (err) {
      setSaveState('error')
      setSaveError(err instanceof Error && err.message ? err.message : 'Check your connection and try again.')
    }
  }

  const beginEdit = () => {
    if (!lead.application) return
    setIdDraft({
      first:  lead.application.first_name,
      last:   lead.application.last_name,
      email:  lead.application.email,
      social: lead.application.social ?? '',
    })
    setIdError(null)
    setEditing(true)
  }

  /**
   * Correcting the contact details on the application record.
   *
   * The email is the CRM's merge key, so changing it re-groups this person's
   * bookings and newsletter signup against the new address. That is a re-read,
   * not a patch, which is why this ends in `onReload` rather than in a local
   * state update.
   */
  const saveIdentity = async () => {
    if (!lead.application || idBusy) return
    const first  = sanitizeText(idDraft.first, NAME_MAX)
    const last   = sanitizeText(idDraft.last, NAME_MAX)
    const email  = sanitizeEmail(idDraft.email).toLowerCase()
    const social = sanitizeText(idDraft.social, HANDLE_MAX)

    if (!first || !last) { setIdError('A first and a last name are both required. Neither column accepts a blank.'); return }
    if (!isValidEmail(email)) { setIdError('That does not look like an email address.'); return }

    setIdBusy(true)
    setIdError(null)

    if (offline(isDemo)) {
      await beat()
      const row = demoLeadStore().find(l => l.id === lead.application?.id)
      if (row) { row.first_name = first; row.last_name = last; row.email = email; row.social = social || null }
    } else {
      const { data, error } = await supabase
        .from('leads')
        .update({ first_name: first, last_name: last, email, social: social || null })
        .eq('id', lead.application.id)
        .select('id')
      if (error) { setIdBusy(false); setIdError(leadWriteRefusal(error.message, 'Editing an application record')); return }
      if (!data || data.length === 0) {
        setIdBusy(false)
        setIdError('That edit changed nothing. Correcting an application record is an admin action.')
        return
      }
    }

    setIdBusy(false)
    setEditing(false)
    await onReload(email)
  }

  /**
   * Deleting removes ONE row: the application. The booking rows carry their own
   * copy of the person's name and address, and a `profiles` account is a
   * different table under a different policy, so neither moves. The sentence
   * above the button says exactly that.
   */
  const removeLead = async () => {
    if (!lead.application || deleting) return
    setDeleting(true)
    setDeleteError(null)
    setArmedDelete(false)

    if (offline(isDemo)) {
      await beat()
      const store = demoLeadStore()
      const i = store.findIndex(l => l.id === lead.application?.id)
      if (i >= 0) store.splice(i, 1)
    } else {
      const { data, error } = await supabase.from('leads').delete().eq('id', lead.application.id).select('id')
      if (error) { setDeleting(false); setDeleteError(leadWriteRefusal(error.message, 'Removing an application record')); return }
      if (!data || data.length === 0) {
        setDeleting(false)
        setDeleteError('Nothing was removed. Deleting an application record is an admin action.')
        return
      }
    }

    setDeleting(false)
    await onReload(null)
  }

  /**
   * The explicit invitation, as opposed to the silent one.
   *
   * Accepting an application already leaves a LINKLESS invitation behind (013),
   * which only helps somebody who happens to sign up later. This one mints a
   * link and shows it once, which is what you want when you are onboarding a
   * client on purpose rather than waiting for them to wander in.
   */
  const invite = async () => {
    if (inviting) return
    setArmedInvite(false)
    setInviteError(null)
    setInviting(true)

    if (offline(isDemo)) {
      await beat()
      setInviting(false)
      setInviteError('Invitations are read only in the demo. Nothing was sent.')
      return
    }

    const res = await sendInvitation({
      email: lead.email,
      role: 'athlete',
      firstName: lead.firstName || undefined,
      lastName: lead.lastName || undefined,
      note: 'Client onboarding',
    })

    setInviting(false)
    if (!res.ok) { setInviteError(res.message); return }
    setIssued({ link: res.link, emailed: res.emailed })
    setCopied(false)
  }

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const fmtTime = (s: string) => new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  const fieldRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '.75rem' }
  const bodyLine: React.CSSProperties = { color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.6 }
  const hintLine: React.CSSProperties = { color: 'var(--text-4)', fontSize: '.72rem', lineHeight: 1.6, marginTop: '.35rem' }

  return (
    <div style={isMobile
      // Full-screen overlay on phones — the 420px side column collapsed the list to 0
      // and pushed the close button off-screen. Sits above panel content and the coach
      // bottom bar (z 50) but below the admin nav sheet (z 60/61).
      ? { position: 'fixed', inset: 0, zIndex: 55, background: 'var(--bg)', overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column' }
      : { borderLeft: '1px solid var(--surface-2)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }
    }>
      {/* Header */}
      <div style={{ padding: isMobile ? '1rem' : '1.25rem 1.5rem', borderBottom: '1px solid var(--surface-2)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
        {isMobile && (
          <button onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', borderRadius: '.25rem', padding: '.5rem .9rem', minHeight: '2.5rem', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit', marginBottom: '.85rem' }}>
            ← Back
          </button>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1rem', lineHeight: 1.2 }}>{lead.firstName} {lead.lastName}</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.75rem', marginTop: '.2rem', wordBreak: 'break-word' }}>{lead.email}</p>
            <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginTop: '.5rem' }}>
              {lead.sources.map(s => <SourceBadge key={s} source={s} />)}
              {lead.application && <StatusBadge status={lead.application.status} />}
              {lead.account && <AccountBadge account={lead.account} />}
              {dirty && (
                <span style={{ background: '#eab30818', border: '1px solid #eab30855', color: '#eab308', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.15rem .5rem', borderRadius: '.2rem', whiteSpace: 'nowrap' }}>
                  Unsaved changes
                </span>
              )}
            </div>
          </div>
          {!isMobile && (
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.1rem', padding: '.25rem', lineHeight: 1, minWidth: '2.5rem', minHeight: '2.5rem' }}>×</button>
          )}
        </div>
      </div>

      <div style={{ padding: isMobile ? '1rem 1rem calc(1.5rem + env(safe-area-inset-bottom))' : '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', flex: 1 }}>

        {/* Journey timeline */}
        <div>
          <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Journey</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {lead.newsletter && (
              <div style={{ display: 'flex', gap: '.875rem', alignItems: 'flex-start' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#0d5bae', flexShrink: 0, marginTop: '.3rem' }} />
                <div>
                  <p style={{ color: 'var(--text-2)', fontSize: '.8rem', fontWeight: 600 }}>Newsletter signup</p>
                  <p style={{ color: 'var(--text-3)', fontSize: '.7rem' }}>{fmtDate(lead.newsletter.createdAt)} · {lead.newsletter.source.replace(/_/g, ' ')}</p>
                </div>
              </div>
            )}
            {lead.bookings.map(b => (
              <div key={b.id} style={{ display: 'flex', gap: '.875rem', alignItems: 'flex-start' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#272C84', flexShrink: 0, marginTop: '.3rem' }} />
                <div>
                  <p style={{ color: 'var(--text-2)', fontSize: '.8rem', fontWeight: 600 }}>Booked a call · {titleizeSlug(b.coach_slug)}</p>
                  <p style={{ color: 'var(--text-3)', fontSize: '.7rem' }}>{fmtDate(b.booked_at)} at {fmtTime(b.booked_at)} · <span style={{ color: BOOKING_STATUS_COLORS[b.status] ?? 'var(--text-3)' }}>{b.status}</span></p>
                  {b.goals && <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.15rem', fontStyle: 'italic' }}>"{b.goals}"</p>}
                </div>
              </div>
            ))}
            {lead.application && (
              <div style={{ display: 'flex', gap: '.875rem', alignItems: 'flex-start' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#c8102e', flexShrink: 0, marginTop: '.3rem' }} />
                <div>
                  <p style={{ color: 'var(--text-2)', fontSize: '.8rem', fontWeight: 600 }}>Submitted application · {lead.application.service}</p>
                  <p style={{ color: 'var(--text-3)', fontSize: '.7rem' }}>{fmtDate(lead.application.created_at)} · Coach pref: {lead.application.coach_pref ?? 'No preference'}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* App account — the fourth source, and what to do about it */}
        <div>
          <p style={{ ...microLabel, marginBottom: '.5rem' }}>App Account</p>

          {!accountsKnown ? (
            <p style={{ color: 'var(--text-4)', fontSize: '.78rem', lineHeight: 1.6 }}>
              Accounts could not be read just now, so this contact may already have one. Reload before inviting anybody.
            </p>
          ) : lead.account ? (
            <>
              <p style={bodyLine}>
                {ROLE_LABELS[lead.account.role]} account, <span style={{ color: ACCOUNT_COLORS[lead.account.status], fontWeight: 700 }}>{STATUS_LABELS[lead.account.status].toLowerCase()}</span>.
              </p>
              <p style={hintLine}>
                {lead.account.status === 'active'
                  ? 'They are already in. There is nothing to send.'
                  : lead.account.status === 'pending'
                    ? 'They signed up and are waiting to be let in. Accepting their application activates the account, and so does approving them directly.'
                    : 'This account is suspended, so they cannot sign in. Reinstating is done from the account, not from here.'}
              </p>
              {lead.account.role === 'athlete' && canManagePeople && (
                <p style={hintLine}>{'Manage them under Settings > Users & permissions.'}</p>
              )}
            </>
          ) : (
            <>
              <p style={bodyLine}>No app account at this address yet.</p>
              {issued ? (
                /**
                 * The link, once. Only the SHA-256 of a token reaches the
                 * database, so there is no query that produces this value later.
                 * Same block, same warning, as the invitations panel, because it
                 * is the same one-shot secret.
                 */
                <div style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.35)', borderRadius: '.25rem', padding: '1rem', marginTop: '.75rem' }}>
                  <p style={{ color: GREEN, fontSize: '.82rem', fontWeight: 700, marginBottom: '.5rem' }}>
                    {issued.emailed ? 'Invitation sent.' : 'Invitation created, but the email did not go out.'}
                  </p>
                  <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.6, marginBottom: '.75rem' }}>
                    {issued.emailed
                      ? 'They can also use this link. It is shown once and cannot be retrieved later. Sending a new invitation replaces it.'
                      : 'Send them this link yourself. It is shown once and cannot be retrieved later.'}
                  </p>
                  <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <code style={{ flex: 1, minWidth: 180, background: 'var(--bg)', border: '1px solid var(--surface-2)', borderRadius: '.2rem', padding: '.5rem .6rem', color: 'var(--text-2)', fontSize: '.72rem', wordBreak: 'break-all' }}>
                      {issued.link}
                    </code>
                    <button
                      onClick={() => { void navigator.clipboard?.writeText(issued.link).then(() => setCopied(true)) }}
                      style={solidButton(ACCENT, isMobile)}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button onClick={() => setIssued(null)} style={ghostButton(isMobile)}>Done</button>
                  </div>
                </div>
              ) : armedInvite ? (
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '.75rem' }}>
                  <span style={{ color: 'var(--text-2)', fontSize: '.75rem', fontWeight: 600 }}>Send them an invitation?</span>
                  <button onClick={() => void invite()} disabled={inviting} style={{ ...solidButton(ACCENT, isMobile), opacity: inviting ? 0.6 : 1 }}>
                    {inviting ? 'Sending…' : 'Send invitation'}
                  </button>
                  <button onClick={() => setArmedInvite(false)} style={ghostButton(isMobile)}>Cancel</button>
                </div>
              ) : (
                <div style={{ marginTop: '.75rem' }}>
                  <button onClick={() => { setInviteError(null); setArmedInvite(true) }} disabled={inviting} style={{ ...solidButton(ACCENT, isMobile), opacity: inviting ? 0.6 : 1 }}>
                    Invite to the app
                  </button>
                  <p style={hintLine}>
                    Sends an athlete invitation to {lead.email} and shows the link once.
                    {lead.application ? ' Accepting their application leaves an invitation too, but without a link you can hand them.' : ''}
                  </p>
                </div>
              )}
              {inviteError && <div style={{ marginTop: '.75rem' }}><ErrorNote message={inviteError} /></div>}
            </>
          )}
        </div>

        {/* Contact details — the correctable half of the application record */}
        {lead.application && canAdmin && (
          <div>
            <p style={{ ...microLabel, marginBottom: '.5rem' }}>Contact Details</p>
            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                {idError && <ErrorNote message={idError} />}
                <div style={fieldRow}>
                  <div>
                    <label className="field-label" htmlFor="crm-edit-first">First name</label>
                    <input id="crm-edit-first" className="field" maxLength={NAME_MAX} value={idDraft.first} onChange={e => setIdDraft(d => ({ ...d, first: e.target.value }))} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="crm-edit-last">Last name</label>
                    <input id="crm-edit-last" className="field" maxLength={NAME_MAX} value={idDraft.last} onChange={e => setIdDraft(d => ({ ...d, last: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="field-label" htmlFor="crm-edit-email">Email</label>
                  <input id="crm-edit-email" className="field" type="email" maxLength={254} value={idDraft.email} onChange={e => setIdDraft(d => ({ ...d, email: e.target.value }))} />
                  <p style={hintLine}>The email is how this contact is matched to their bookings, their newsletter signup and their account. Changing it re-groups all of them.</p>
                </div>
                <div>
                  <label className="field-label" htmlFor="crm-edit-social">Phone or social handle</label>
                  <input id="crm-edit-social" className="field" maxLength={HANDLE_MAX} value={idDraft.social} onChange={e => setIdDraft(d => ({ ...d, social: e.target.value }))} placeholder="@handle or (559) 555 0100" />
                  {/* `leads` has no phone column (001, never altered since). `social`
                      is the only contact handle the application record carries, so a
                      phone number typed here lands there and the label says so. */}
                </div>
                <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                  <button onClick={() => void saveIdentity()} disabled={idBusy} style={{ ...solidButton(ACCENT, isMobile), opacity: idBusy ? 0.6 : 1 }}>
                    {idBusy ? 'Saving…' : 'Save contact details'}
                  </button>
                  <button onClick={() => { setEditing(false); setIdError(null) }} style={ghostButton(isMobile)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <p style={bodyLine}>{lead.application.first_name} {lead.application.last_name}</p>
                  <p style={{ color: 'var(--text-3)', fontSize: '.75rem', wordBreak: 'break-word' }}>{lead.application.email}</p>
                  {lead.application.social && <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>{lead.application.social}</p>}
                </div>
                <button onClick={beginEdit} style={ghostButton(isMobile)}>Edit</button>
              </div>
            )}
          </div>
        )}

        {/* Application data */}
        {lead.application && (
          <div>
            <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Application Details</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', background: 'var(--surface)', borderRadius: '.25rem', padding: '1rem' }}>
              {[
                ['Age',          lead.application.age],
                ['Body Weight',  lead.application.body_weight],
                ['Weight Class', lead.application.weight_class],
                ['Experience',   lead.application.experience],
                ['Train Days',   lead.application.train_days],
                ['Squat Max',    lead.application.squat_max],
                ['Bench Max',    lead.application.bench_max],
                ['Deadlift Max', lead.application.dead_max],
                ['Squat Style',  lead.application.squat_style],
                ['Bench Style',  lead.application.bench_style],
                ['Dead Style',   lead.application.dead_style],
                ['Sleep',        lead.application.sleep],
              ].filter(([, v]) => v).map(([label, val]) => (
                <div key={String(label)}>
                  <p style={{ color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.1rem' }}>{label as string}</p>
                  <p style={{ color: 'var(--text-2)', fontSize: '.8rem' }}>{val as string}</p>
                </div>
              ))}
            </div>
            {lead.application.goals && (
              <div style={{ marginTop: '.75rem' }}>
                <p style={{ color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.35rem' }}>Goals</p>
                <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.7 }}>{lead.application.goals}</p>
              </div>
            )}
            {lead.application.weak_points && (
              <div style={{ marginTop: '.75rem' }}>
                <p style={{ color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.35rem' }}>Weak Points</p>
                <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.7 }}>{lead.application.weak_points}</p>
              </div>
            )}
            {lead.application.expectations && (
              <div style={{ marginTop: '.75rem' }}>
                <p style={{ color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.35rem' }}>Expectations</p>
                <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.7 }}>{lead.application.expectations}</p>
              </div>
            )}
          </div>
        )}

        {/* Status control — only if they applied */}
        {lead.application && (
          <div>
            <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Application Status</p>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              {(['new', 'reviewed', 'accepted', 'declined'] as Lead['status'][]).map(s => (
                <button key={s} onClick={() => { setStatus(s); markEdited() }} style={{ background: status === s ? (STATUS_COLORS[s] + '22') : 'transparent', border: `1px solid ${status === s ? STATUS_COLORS[s] : 'var(--border-mid)'}`, color: status === s ? STATUS_COLORS[s] : 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: isMobile ? '.6rem .9rem' : '.3rem .75rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {s}
                </button>
              ))}
            </div>
            {/*
              The trigger nobody could see. `leads_invite_on_accept` (013) fires
              on status -> 'accepted' and quietly either activates a pending
              account at this address or leaves an athlete invitation for it, and
              it swallows its own failures. A door that opens itself deserves a
              sign in front of it.
            */}
            {status === 'accepted' && (
              <p style={{ color: 'var(--text-3)', fontSize: '.72rem', lineHeight: 1.6, marginTop: '.6rem' }}>
                Accepting also lets this email into the app: a pending account is activated, and a new signup with this address is admitted as an athlete.
              </p>
            )}
          </div>
        )}

        {/* Notes */}
        <div>
          <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Coach Notes</p>
          {lead.application ? (
            <textarea className="field" rows={4} maxLength={NOTES_MAX} value={notes} onChange={e => { setNotes(e.target.value); markEdited() }} placeholder="Internal notes visible to coaches…" />
          ) : (
            <p style={{ color: 'var(--text-4)', fontSize: '.8rem' }}>Notes available once the lead submits an application.</p>
          )}
        </div>

        {/* Save — the single save action for status + notes */}
        {lead.application && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {dirty && saveState !== 'error' && (
              <p style={{ color: '#eab308', fontSize: '.7rem' }}>Status and notes are not applied until you save.</p>
            )}
            <button onClick={save} disabled={saveState === 'saving'} style={{ background: saveState === 'saving' ? 'var(--border)' : '#272C84', border: 'none', color: '#ffffff', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.8rem 1.5rem', minHeight: '2.75rem', borderRadius: '.25rem', cursor: saveState === 'saving' ? 'default' : 'pointer', fontFamily: 'inherit', width: '100%' }}>
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' && !dirty ? 'Saved ✓' : 'Save Changes →'}
            </button>
            {saveState === 'error' && (
              <p role="alert" style={{ color: '#c8102e', fontSize: '.72rem', lineHeight: 1.5 }}>
                Couldn't save — your edits are still here. {saveError}
              </p>
            )}
          </div>
        )}

        {/* Delete — last, because it is the only thing here that cannot be undone */}
        {lead.application && canAdmin && (
          <div style={{ borderTop: '1px solid var(--surface-2)', paddingTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
            <p style={{ ...microLabel, color: DANGER }}>Remove</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.75rem', lineHeight: 1.6 }}>
              Removes the application record. Bookings and any app account are untouched.
            </p>
            {deleteError && <ErrorNote message={deleteError} />}
            {armedDelete ? (
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-2)', fontSize: '.75rem', fontWeight: 600 }}>Remove this application?</span>
                <button onClick={() => void removeLead()} disabled={deleting} style={{ ...solidButton(DANGER, isMobile), opacity: deleting ? 0.6 : 1 }}>
                  {deleting ? 'Removing…' : 'Remove'}
                </button>
                <button onClick={() => setArmedDelete(false)} style={ghostButton(isMobile)}>Cancel</button>
              </div>
            ) : (
              <div>
                <button
                  onClick={() => { setDeleteError(null); setArmedDelete(true) }}
                  disabled={deleting}
                  style={{ background: 'none', border: `1px solid ${DANGER}`, color: DANGER, fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: isMobile ? '.6rem 1.1rem' : '.5rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Delete application record
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Add a contact by hand ──────────────────────────────────────────────────

/**
 * The row a staff member types in.
 *
 * `leads` is the contact table this panel writes to, and 001 makes four of its
 * columns NOT NULL: first_name, last_name, email and service. The first three
 * are on the form. `service` is not, because nobody asked this person anything
 * yet, so it gets STAFF_ADDED_SERVICE rather than a guess. `coach_pref` is left
 * out entirely so the column default ('No Preference') applies, and `status` is
 * written as 'new' even though that is also its default, because a row in the
 * review queue should say what it is.
 */
function AddContactForm({ isDemo, isMobile, onCancel, onAdded }: {
  isDemo: boolean
  isMobile: boolean
  onCancel: () => void
  onAdded: (email: string) => Promise<void>
}) {
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (busy) return
    const firstName = sanitizeText(first, NAME_MAX)
    const lastName  = sanitizeText(last, NAME_MAX)
    const addr      = sanitizeEmail(email).toLowerCase()
    const social    = sanitizeText(handle, HANDLE_MAX)
    const note      = sanitizeText(notes, NOTES_MAX)

    if (!firstName || !lastName) { setError('A first and a last name are both required. Neither column accepts a blank.'); return }
    if (!isValidEmail(addr)) { setError('That does not look like an email address.'); return }

    setBusy(true)
    setError(null)

    if (offline(isDemo)) {
      await beat()
      demoLeadStore().unshift(blankLead({
        id: `demo-added-${Date.now()}`,
        first_name: firstName, last_name: lastName, email: addr,
        social: social || null, admin_notes: note || null,
      }))
    } else {
      const { data, error: err } = await supabase
        .from('leads')
        .insert({
          first_name: firstName,
          last_name: lastName,
          email: addr,
          social: social || null,
          admin_notes: note || null,
          service: STAFF_ADDED_SERVICE,
          status: 'new',
        })
        .select('id')
      if (err) { setBusy(false); setError(leadWriteRefusal(err.message, 'Adding a contact')); return }
      if (!data || data.length === 0) {
        setBusy(false)
        setError('Nothing was added. Adding a contact is an admin action.')
        return
      }
    }

    setBusy(false)
    await onAdded(addr)
  }

  const fieldRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '.75rem' }

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${ACCENT}55`, borderLeft: `3px solid ${ACCENT}`, borderRadius: '.25rem', padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
      <div>
        <p style={{ ...microLabel, marginBottom: '.35rem' }}>New contact</p>
        <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.6, maxWidth: 560 }}>
          Files an application record so somebody you met off the site lands in the same queue as everybody else. It does not create a login. Invite them from their detail pane once they are on the list.
        </p>
      </div>

      {error && <ErrorNote message={error} />}

      <div style={fieldRow}>
        <div>
          <label className="field-label" htmlFor="crm-add-first">First name *</label>
          <input id="crm-add-first" className="field" maxLength={NAME_MAX} value={first} onChange={e => setFirst(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="crm-add-last">Last name *</label>
          <input id="crm-add-last" className="field" maxLength={NAME_MAX} value={last} onChange={e => setLast(e.target.value)} />
        </div>
      </div>

      <div style={fieldRow}>
        <div>
          <label className="field-label" htmlFor="crm-add-email">Email *</label>
          <input id="crm-add-email" className="field" type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="crm-add-handle">Phone or social handle</label>
          <input id="crm-add-handle" className="field" maxLength={HANDLE_MAX} value={handle} onChange={e => setHandle(e.target.value)} placeholder="@handle or (559) 555 0100" />
        </div>
      </div>

      <div>
        <label className="field-label" htmlFor="crm-add-notes">Notes</label>
        <textarea id="crm-add-notes" className="field" rows={2} maxLength={NOTES_MAX} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Where they came from, what they asked for…" />
      </div>

      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <button onClick={() => void submit()} disabled={busy} style={{ ...solidButton(ACCENT, isMobile), opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Adding…' : 'Add contact'}
        </button>
        <button onClick={onCancel} style={ghostButton(isMobile)}>Cancel</button>
      </div>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────

const SOURCE_FILTERS: { label: string; value: LeadSource | 'all' }[] = [
  { label: 'All',         value: 'all' },
  { label: 'Applied',     value: 'application' },
  { label: 'Newsletter',  value: 'newsletter' },
  { label: 'Booked Call', value: 'booking' },
]

type Sub = 'contacts' | 'roster'

const SUB_TABS: readonly { key: Sub; label: string }[] = [
  { key: 'contacts', label: 'Contacts' },
  { key: 'roster',   label: 'Roster' },
]

// Module-level so the hash hook does not rebuild its listener every render.
const SUB_KEYS: readonly Sub[] = SUB_TABS.map(t => t.key)

export default function CRMPanel({ isDemo = false }: { isDemo?: boolean }) {
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [sub, setSub] = useHashSubTab(SUB_KEYS, 'contacts')
  const { isAdmin } = useAuth()
  const { can } = usePermissions()

  const [unified,  setUnified]  = useState<UnifiedLead[]>([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState<UnifiedLead | null>(null)
  const [search,   setSearch]   = useState('')
  const [srcFilter, setSrcFilter] = useState<LeadSource | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<Lead['status'] | 'all'>('all')
  /** False after a profiles outage: an absent badge would otherwise read as "no account". */
  const [accountsKnown, setAccountsKnown] = useState(true)
  const [adding, setAdding] = useState(false)

  /**
   * Signage, not security. `leads_admin_all` (017) is the only policy that
   * permits an insert or a delete on `leads`, and no permission key widens it,
   * so a `manage_leads` holder who is not an admin would be shown a button that
   * the database refuses. They are not shown one.
   */
  const canAdmin = offline(isDemo) || isAdmin
  /** The hint about Settings is only worth showing to somebody who can go there. */
  const canManagePeople = offline(isDemo) || isAdmin || can('manage_permissions')

  /**
   * Returns the merged list as well as setting it, so a caller that just wrote
   * can re-select the row it wrote by address rather than guessing at state.
   * `quiet` skips the loading state: a save should not blank the pane it is in.
   */
  const load = useCallback(async (opts?: { quiet?: boolean }): Promise<UnifiedLead[]> => {
    if (!opts?.quiet) setLoading(true)
    try {
      let applications: Lead[] = []
      let newsletters: NewsletterLead[] = []
      let bookings: Booking[] = []
      let people: Profile[] | null = null

      if (offline(isDemo)) {
        applications = demoLeadStore().map(l => ({ ...l }))
        newsletters  = DEMO_NEWSLETTER_LEADS.map(n => ({
          id: n.id, firstName: n.firstName, lastName: n.lastName,
          email: n.email, source: n.source, createdAt: n.createdAt,
        }))
        bookings = DEMO_BOOKINGS
        people   = await fetchPeople(isDemo)
      } else {
        const [aRes, bRes, pRes] = await Promise.all([
          supabase.from('leads').select('*').order('created_at', { ascending: false }),
          // Not select('*'): the CRM shows a booking, it does not administer one,
          // so it has no business pulling manage_token (a bearer credential) or
          // coach_notes (the coach's private assessment) into the browser. Same
          // column list every other staff booking read uses.
          supabase.from('bookings').select(BOOKING_STAFF_COLUMNS).order('created_at', { ascending: false }),
          // The fourth source. fetchPeople rather than a hand-rolled select:
          // it is already demo-aware, it already returns null for an outage
          // instead of an empty list, and it reads the one column set every
          // other people-reading screen reads. Its 500-row limit is the same
          // one Users & permissions works under.
          fetchPeople(false),
        ])
        applications = (aRes.data ?? []) as Lead[]
        bookings     = (bRes.data ?? []) as Booking[]
        people       = pRes
        newsletters  = await fetchNewsletterLeads(false)
      }

      setAccountsKnown(people !== null)
      const merged = mergeToUnified(applications, newsletters, bookings, people ?? [])
      setUnified(merged)
      return merged
    } finally {
      if (!opts?.quiet) setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  /** Re-read after a write, then land on the row that was written (or nothing). */
  const reload = useCallback(async (selectEmail: string | null) => {
    const next = await load({ quiet: true })
    setSelected(selectEmail ? (next.find(u => u.email === selectEmail.toLowerCase()) ?? null) : null)
  }, [load])

  // Update selected lead after a save
  const handleUpdateLead = (updated: Lead) => {
    setUnified(u => u.map(x => x.email === updated.email.toLowerCase()
      ? { ...x, application: updated }
      : x
    ))
    setSelected(s => s ? { ...s, application: updated } : s)
  }

  // Deduplication detection: same email appearing in newsletter + application
  const duplicates = unified.filter(u => u.sources.length > 1)

  // Filter — search NARROWS the source/status filters, it never resets them
  const filtered = unified.filter(u => {
    if (srcFilter !== 'all' && !u.sources.includes(srcFilter)) return false
    if (statusFilter !== 'all' && u.application?.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return [u.firstName, u.lastName, u.email].some(v => v?.toLowerCase().includes(q))
    }
    return true
  })

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const coachOf = (u: UnifiedLead) =>
    u.application?.coach_pref
    ?? (u.bookings[0] ? titleizeSlug(u.bookings[0].coach_slug) : null)

  const padX = isMobile ? '1rem' : '1.5rem'
  const pillStyle = (active: boolean, activeColor: string | null) => ({
    background: active ? (activeColor ? activeColor + '22' : 'var(--surface-2)') : 'transparent',
    border: `1px solid ${active ? (activeColor ?? 'var(--text-dim)') : 'var(--border)'}`,
    color: active ? (activeColor ?? 'var(--text)') : 'var(--text-4)',
    fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const,
    padding: isMobile ? '.55rem .8rem' : '.3rem .7rem', borderRadius: '.2rem',
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' as const,
  })

  const detail = selected && (
    <LeadDetail
      lead={selected}
      onClose={() => setSelected(null)}
      onUpdateLead={handleUpdateLead}
      onReload={reload}
      isDemo={isDemo}
      isMobile={isMobile}
      canAdmin={canAdmin}
      canManagePeople={canManagePeople}
      accountsKnown={accountsKnown}
    />
  )

  const contacts = (
    <>
      {isDemo && (
        <div style={{ padding: `1rem ${padX} 0`, flexShrink: 0 }}>
          <DemoBanner note="Contacts combine sample applications, newsletter signups, and booked calls." />
        </div>
      )}

      {/* Merge alert */}
      {duplicates.length > 0 && (
        <div style={{ background: 'rgba(13,91,174,.1)', borderBottom: '1px solid rgba(13,91,174,.25)', padding: `.6rem ${padX}`, display: 'flex', alignItems: 'center', gap: '.75rem', flexShrink: 0 }}>
          <span style={{ color: '#009dd6', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Multi-Source</span>
          <span style={{ color: 'var(--text-2)', fontSize: '.75rem' }}>{duplicates.length} contact{duplicates.length > 1 ? 's' : ''} appear in multiple sources — their profiles are automatically unified below.</span>
        </div>
      )}

      {/* Stats bar */}
      <div style={{ padding: `.875rem ${padX}`, borderBottom: '1px solid var(--surface)', display: 'flex', flexWrap: 'wrap', gap: isMobile ? '1rem 1.5rem' : '2rem', flexShrink: 0 }}>
        {[
          ['Total Contacts', unified.length],
          ['Applied', unified.filter(u => u.sources.includes('application')).length],
          ['Newsletter', unified.filter(u => u.sources.includes('newsletter')).length],
          ['Booked', unified.filter(u => u.sources.includes('booking')).length],
          // A dash, not a zero: with accounts unreadable, "0 with an account" is
          // a claim this panel is in no position to make.
          ['With account', accountsKnown ? unified.filter(u => u.account).length : '—'],
        ].map(([label, val]) => (
          <div key={String(label)}>
            <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.4rem', lineHeight: 1 }}>{val}</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginTop: '.15rem' }}>{label as string}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ padding: `.875rem ${padX}`, borderBottom: '1px solid var(--surface)', display: 'flex', gap: '.75rem', flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
        <input className="field" maxLength={120} placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: isMobile ? 'none' : 240, flex: isMobile ? '1 1 100%' : '0 0 auto' }} />

        {/* Source filter */}
        <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
          {SOURCE_FILTERS.map(f => (
            <button key={f.value} onClick={() => setSrcFilter(f.value)} style={pillStyle(srcFilter === f.value, null)}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Status filter (only meaningful for applications) */}
        <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
          {(['all', 'new', 'reviewed', 'accepted', 'declined'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={pillStyle(statusFilter === s, s === 'all' ? null : (STATUS_COLORS[s] ?? 'var(--text-dim)'))}>
              {s}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {canAdmin && (
            <button onClick={() => setAdding(a => !a)} aria-expanded={adding} style={{ background: adding ? 'var(--surface-2)' : 'none', border: `1px solid ${ACCENT}`, color: adding ? 'var(--text)' : ACCENT, fontSize: '.6rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', padding: isMobile ? '.55rem .875rem' : '.35rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              {adding ? 'Close' : '+ Add contact'}
            </button>
          )}
          <button onClick={() => void load()} style={{ background: 'none', border: '1px solid #222', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: isMobile ? '.55rem .875rem' : '.35rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            ↺ Refresh
          </button>
        </div>
      </div>

      {adding && canAdmin && (
        <div style={{ padding: `.875rem ${padX}`, borderBottom: '1px solid var(--surface)', flexShrink: 0 }}>
          <AddContactForm
            isDemo={isDemo}
            isMobile={isMobile}
            onCancel={() => setAdding(false)}
            onAdded={async (email) => { setAdding(false); await reload(email) }}
          />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading contacts…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>No contacts match.</div>
      ) : isMobile ? (
        /* Phone: stacked cards — the 5-column nowrap table forced sideways scrolling */
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          {filtered.map(u => (
            <button key={u.email} onClick={() => setSelected(u)} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', width: '100%', textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '.9rem 1rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.85rem' }}>
                    {u.firstName} {u.lastName}
                    {u.sources.length > 1 && <span style={{ marginLeft: '.4rem', color: '#009dd6', fontSize: '.6rem', fontWeight: 900 }}>✦</span>}
                  </span>
                  {u.application && <StatusBadge status={u.application.status} />}
                  {u.account && <AccountBadge account={u.account} />}
                </div>
                <span style={{ color: 'var(--text-2)', fontSize: '.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                <span style={{ color: 'var(--text-3)', fontSize: '.7rem' }}>
                  {fmtDate(u.lastSeen)}{coachOf(u) ? ` · ${coachOf(u)}` : ''}
                </span>
              </div>
              <span aria-hidden style={{ color: 'var(--text-4)', fontSize: '1.15rem', flexShrink: 0 }}>›</span>
            </button>
          ))}
          <p style={{ color: 'var(--text-3)', fontSize: '.7rem', padding: '.25rem 0' }}>Showing {filtered.length} of {unified.length} contacts</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? 'minmax(0,1fr) min(420px, 45vw)' : '1fr', flex: 1, minHeight: 0 }}>
          {/* List */}
          <div style={{ overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Name', 'Email', 'Sources', 'Status', 'Account', 'Last Activity'].map(h => (
                    <th key={h} style={{ padding: '.875rem 1.25rem', textAlign: 'left', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                  <th aria-hidden style={{ padding: '.875rem 1rem 0.875rem .25rem', width: '2rem' }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.email} onClick={() => setSelected(selected?.email === u.email ? null : u)}
                    style={{ borderBottom: '1px solid var(--surface)', cursor: 'pointer', background: selected?.email === u.email ? 'var(--surface)' : 'transparent' }}
                  >
                    <td style={{ padding: '1rem 1.25rem', color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {u.firstName} {u.lastName}
                      {u.sources.length > 1 && <span style={{ marginLeft: '.4rem', color: '#009dd6', fontSize: '.6rem', fontWeight: 900 }}>✦</span>}
                    </td>
                    <td style={{ padding: '1rem 1.25rem', color: 'var(--text-2)' }}>{u.email}</td>
                    <td style={{ padding: '1rem 1.25rem' }}>
                      <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                        {u.sources.map(s => <SourceBadge key={s} source={s} />)}
                      </div>
                    </td>
                    <td style={{ padding: '1rem 1.25rem' }}>
                      {u.application ? <StatusBadge status={u.application.status} /> : <span style={{ color: 'var(--border-mid)', fontSize: '.75rem' }}>—</span>}
                    </td>
                    <td style={{ padding: '1rem 1.25rem' }}>
                      {u.account
                        ? <AccountBadge account={u.account} />
                        : <span title={accountsKnown ? 'No app account' : 'Accounts could not be read just now'} style={{ color: 'var(--border-mid)', fontSize: '.75rem' }}>{accountsKnown ? '—' : '?'}</span>}
                    </td>
                    <td style={{ padding: '1rem 1.25rem', color: 'var(--text-3)', whiteSpace: 'nowrap', fontSize: '.75rem' }}>
                      {fmtDate(u.lastSeen)}
                    </td>
                    <td aria-hidden style={{ padding: '1rem 1rem 1rem .25rem', color: 'var(--text-4)', fontSize: '1rem', textAlign: 'right' }}>›</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ padding: '.75rem 1.25rem', color: 'var(--text-3)', fontSize: '.7rem' }}>Showing {filtered.length} of {unified.length} contacts</p>
          </div>

          {/* Detail — desktop side column */}
          {!isMobile && detail}
        </div>
      )}

      {/* Detail — phone full-screen overlay */}
      {isMobile && detail}
    </>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sub-tabs. Contacts is who wrote in; Roster is who is being coached and
          where they are in their training. Same hub, two questions. */}
      <div
        role="tablist"
        aria-label="Clients sections"
        style={{ display: 'flex', gap: '.25rem', padding: `0 ${padX}`, borderBottom: '1px solid var(--surface)', flexWrap: 'wrap', flexShrink: 0 }}
      >
        {SUB_TABS.map(t => {
          const active = sub === t.key
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setSub(t.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: active ? 'var(--text)' : 'var(--text-3)',
                fontSize: '.72rem', fontWeight: active ? 900 : 700,
                letterSpacing: '.1em', textTransform: 'uppercase',
                padding: '.9rem .4rem', marginRight: '1rem',
                borderBottom: `2px solid ${active ? ACCENT : 'transparent'}`,
                fontFamily: 'inherit',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {sub === 'contacts' ? contacts : (
        // RosterBoard pads itself with .dash-pad, so this wrapper only supplies
        // the scroll box the flex column needs.
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <RosterBoard isDemo={isDemo} />
        </div>
      )}
    </div>
  )
}
