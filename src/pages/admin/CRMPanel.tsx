import { useState, useEffect, useCallback } from 'react'
import { supabase, supabaseConfigured } from '../../lib/supabase'
import { fetchNewsletterLeads } from '../../lib/newsletterApi'
import type { Lead, Booking } from '../../types/database'
import { BOOKING_STAFF_COLUMNS } from '../../types/database'
import type { NewsletterLead } from '../../types/newsletter'
import { DEMO_LEADS, DEMO_NEWSLETTER_LEADS, DEMO_BOOKINGS } from '../../data/demoData'
import { useMediaQuery, MOBILE_QUERY } from '../../lib/dashboard'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { sanitizeText } from '../../utils/sanitize'

// ── Types ──────────────────────────────────────────────────────────────────

/** Long enough for a real note, short enough that nobody can post a novel. */
const NOTES_MAX = 4000

type LeadSource = 'application' | 'newsletter' | 'booking'

interface UnifiedLead {
  email: string
  firstName: string
  lastName: string
  sources: LeadSource[]
  application: Lead | null
  newsletter: NewsletterLead | null
  bookings: Booking[]
  firstSeen: string
  lastSeen: string
}

// ── Merge logic ────────────────────────────────────────────────────────────

function mergeToUnified(
  applications: Lead[],
  newsletters: NewsletterLead[],
  bookings: Booking[],
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

const titleizeSlug = (slug: string) => slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

// ── Lead detail panel ──────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function LeadDetail({ lead, onClose, onUpdateLead, isDemo, isMobile }: {
  lead: UnifiedLead
  onClose: () => void
  onUpdateLead: (updated: Lead) => void
  isDemo: boolean
  isMobile: boolean
}) {
  const [notes, setNotes] = useState(lead.application?.admin_notes ?? '')
  const [status, setStatus] = useState<Lead['status']>(lead.application?.status ?? 'new')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setNotes(lead.application?.admin_notes ?? '')
    setStatus(lead.application?.status ?? 'new')
    setSaveState('idle')
    setSaveError(null)
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
      }
      onUpdateLead({ ...lead.application, admin_notes: notes, status })
      setSaveState('saved')
    } catch (err) {
      setSaveState('error')
      setSaveError(err instanceof Error && err.message ? err.message : 'Check your connection and try again.')
    }
  }

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const fmtTime = (s: string) => new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

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

export default function CRMPanel({ isDemo = false }: { isDemo?: boolean }) {
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [unified,  setUnified]  = useState<UnifiedLead[]>([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState<UnifiedLead | null>(null)
  const [search,   setSearch]   = useState('')
  const [srcFilter, setSrcFilter] = useState<LeadSource | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<Lead['status'] | 'all'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let applications: Lead[] = []
      let newsletters: NewsletterLead[] = []
      let bookings: Booking[] = []

      if (isDemo || !supabaseConfigured) {
        applications = DEMO_LEADS
        newsletters  = DEMO_NEWSLETTER_LEADS.map(n => ({
          id: n.id, firstName: n.firstName, lastName: n.lastName,
          email: n.email, source: n.source, createdAt: n.createdAt,
        }))
        bookings = DEMO_BOOKINGS
      } else {
        const [aRes, bRes] = await Promise.all([
          supabase.from('leads').select('*').order('created_at', { ascending: false }),
          // Not select('*'): the CRM shows a booking, it does not administer one,
          // so it has no business pulling manage_token (a bearer credential) or
          // coach_notes (the coach's private assessment) into the browser. Same
          // column list every other staff booking read uses.
          supabase.from('bookings').select(BOOKING_STAFF_COLUMNS).order('created_at', { ascending: false }),
        ])
        applications = (aRes.data ?? []) as Lead[]
        bookings     = (bRes.data ?? []) as Booking[]
        newsletters  = await fetchNewsletterLeads(false)
      }

      setUnified(mergeToUnified(applications, newsletters, bookings))
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { load() }, [load])

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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

        <button onClick={load} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #222', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: isMobile ? '.55rem .875rem' : '.35rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
          ↺ Refresh
        </button>
      </div>

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
                  {['Name', 'Email', 'Sources', 'Status', 'Last Activity'].map(h => (
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
          {selected && (
            <LeadDetail
              lead={selected}
              onClose={() => setSelected(null)}
              onUpdateLead={handleUpdateLead}
              isDemo={isDemo}
              isMobile={false}
            />
          )}
        </div>
      )}

      {/* Detail — phone full-screen overlay */}
      {isMobile && selected && (
        <LeadDetail
          lead={selected}
          onClose={() => setSelected(null)}
          onUpdateLead={handleUpdateLead}
          isDemo={isDemo}
          isMobile
        />
      )}
    </div>
  )
}
