import { useState, useEffect, useCallback } from 'react'
import { supabase, supabaseConfigured } from '../../lib/supabase'
import { fetchNewsletterLeads } from '../../lib/newsletterApi'
import type { Lead, Booking } from '../../types/database'
import type { NewsletterLead } from '../../types/newsletter'
import { DEMO_LEADS, DEMO_NEWSLETTER_LEADS } from '../../data/demoData'

// ── Types ──────────────────────────────────────────────────────────────────

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

// ── Demo bookings stub ─────────────────────────────────────────────────────

const DEMO_BOOKINGS_STUB: Booking[] = [
  { id: 'db1', coach_slug: 'ronnie-vallejo', booked_at: new Date(Date.now() - 2 * 86400000).toISOString(), duration_minutes: 30, first_name: 'Marcus', last_name: 'Rivera', email: 'marcus.r@gmail.com', phone: null, service_interest: '1:1 Coaching', goals: null, status: 'pending', coach_notes: null, created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
  { id: 'db2', coach_slug: 'seth-burman', booked_at: new Date(Date.now() - 5 * 86400000).toISOString(), duration_minutes: 30, first_name: 'Sophie', last_name: 'Kim', email: 'sophie.kim@gmail.com', phone: null, service_interest: 'Game Day Coaching', goals: null, status: 'confirmed', coach_notes: null, created_at: new Date(Date.now() - 5 * 86400000).toISOString() },
]

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
  booking:     { label: 'Booked Call', color: '#fff' },
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

const STATUS_COLORS: Record<string, string> = { new: '#c8102e', reviewed: '#f5b935', accepted: '#22c55e', declined: '#555' }

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? '#555'
  return (
    <span style={{ background: c + '18', border: `1px solid ${c}`, color: c, fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.15rem .5rem', borderRadius: '.2rem' }}>
      {status}
    </span>
  )
}

// ── Lead detail panel ──────────────────────────────────────────────────────

function LeadDetail({ lead, onClose, onUpdateLead, isDemo }: {
  lead: UnifiedLead
  onClose: () => void
  onUpdateLead: (updated: Lead) => void
  isDemo: boolean
}) {
  const [notes, setNotes] = useState(lead.application?.admin_notes ?? '')
  const [status, setStatus] = useState<Lead['status']>(lead.application?.status ?? 'new')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    setNotes(lead.application?.admin_notes ?? '')
    setStatus(lead.application?.status ?? 'new')
    setSavedAt(null)
  }, [lead.email])

  const save = async () => {
    if (!lead.application) return
    setSaving(true)
    if (!isDemo && supabaseConfigured) {
      await supabase.from('leads').update({ admin_notes: notes, status }).eq('id', lead.application.id)
    }
    onUpdateLead({ ...lead.application, admin_notes: notes, status })
    setSaving(false)
    setSavedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
  }

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const fmtTime = (s: string) => new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  return (
    <div style={{ borderLeft: '1px solid #1a1a1a', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'sticky', top: 0, background: '#000', zIndex: 1 }}>
        <div>
          <p style={{ color: '#fff', fontWeight: 900, fontSize: '1rem', lineHeight: 1.2 }}>{lead.firstName} {lead.lastName}</p>
          <p style={{ color: '#888', fontSize: '.75rem', marginTop: '.2rem' }}>{lead.email}</p>
          <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginTop: '.5rem' }}>
            {lead.sources.map(s => <SourceBadge key={s} source={s} />)}
            {lead.application && <StatusBadge status={lead.application.status} />}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '1.1rem', padding: '.25rem', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', flex: 1 }}>

        {/* Journey timeline */}
        <div>
          <p style={{ color: '#888', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Journey</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {lead.newsletter && (
              <div style={{ display: 'flex', gap: '.875rem', alignItems: 'flex-start' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#0d5bae', flexShrink: 0, marginTop: '.3rem' }} />
                <div>
                  <p style={{ color: '#c7c7c7', fontSize: '.8rem', fontWeight: 600 }}>Newsletter signup</p>
                  <p style={{ color: '#888', fontSize: '.7rem' }}>{fmtDate(lead.newsletter.createdAt)} · {lead.newsletter.source.replace(/_/g, ' ')}</p>
                </div>
              </div>
            )}
            {lead.bookings.map(b => (
              <div key={b.id} style={{ display: 'flex', gap: '.875rem', alignItems: 'flex-start' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f5b935', flexShrink: 0, marginTop: '.3rem' }} />
                <div>
                  <p style={{ color: '#c7c7c7', fontSize: '.8rem', fontWeight: 600 }}>Booked a call · {b.coach_slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
                  <p style={{ color: '#888', fontSize: '.7rem' }}>{fmtDate(b.booked_at)} at {fmtTime(b.booked_at)} · <span style={{ color: STATUS_COLORS[b.status] ?? '#888' }}>{b.status}</span></p>
                  {b.goals && <p style={{ color: '#555', fontSize: '.7rem', marginTop: '.15rem', fontStyle: 'italic' }}>"{b.goals}"</p>}
                </div>
              </div>
            ))}
            {lead.application && (
              <div style={{ display: 'flex', gap: '.875rem', alignItems: 'flex-start' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#c8102e', flexShrink: 0, marginTop: '.3rem' }} />
                <div>
                  <p style={{ color: '#c7c7c7', fontSize: '.8rem', fontWeight: 600 }}>Submitted application · {lead.application.service}</p>
                  <p style={{ color: '#888', fontSize: '.7rem' }}>{fmtDate(lead.application.created_at)} · Coach pref: {lead.application.coach_pref ?? 'No preference'}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Application data */}
        {lead.application && (
          <div>
            <p style={{ color: '#888', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Application Details</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', background: '#0d0d0d', borderRadius: '.25rem', padding: '1rem' }}>
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
                  <p style={{ color: '#555', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.1rem' }}>{label as string}</p>
                  <p style={{ color: '#c7c7c7', fontSize: '.8rem' }}>{val as string}</p>
                </div>
              ))}
            </div>
            {lead.application.goals && (
              <div style={{ marginTop: '.75rem' }}>
                <p style={{ color: '#555', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.35rem' }}>Goals</p>
                <p style={{ color: '#c7c7c7', fontSize: '.8rem', lineHeight: 1.7 }}>{lead.application.goals}</p>
              </div>
            )}
            {lead.application.weak_points && (
              <div style={{ marginTop: '.75rem' }}>
                <p style={{ color: '#555', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.35rem' }}>Weak Points</p>
                <p style={{ color: '#c7c7c7', fontSize: '.8rem', lineHeight: 1.7 }}>{lead.application.weak_points}</p>
              </div>
            )}
            {lead.application.expectations && (
              <div style={{ marginTop: '.75rem' }}>
                <p style={{ color: '#555', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.35rem' }}>Expectations</p>
                <p style={{ color: '#c7c7c7', fontSize: '.8rem', lineHeight: 1.7 }}>{lead.application.expectations}</p>
              </div>
            )}
          </div>
        )}

        {/* Status control — only if they applied */}
        {lead.application && (
          <div>
            <p style={{ color: '#888', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Application Status</p>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
              {(['new', 'reviewed', 'accepted', 'declined'] as Lead['status'][]).map(s => (
                <button key={s} onClick={() => setStatus(s)} style={{ background: status === s ? (STATUS_COLORS[s] + '22') : 'transparent', border: `1px solid ${status === s ? STATUS_COLORS[s] : '#333'}`, color: status === s ? STATUS_COLORS[s] : '#555', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.3rem .75rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <p style={{ color: '#888', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.5rem' }}>
            Coach Notes
            {savedAt && <span style={{ color: '#22c55e', fontWeight: 400, marginLeft: '.5rem' }}>Saved {savedAt}</span>}
          </p>
          {lead.application ? (
            <>
              <textarea className="field" rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes visible to coaches…" />
              <button onClick={save} disabled={saving || isDemo} style={{ marginTop: '.5rem', background: saving ? '#222' : '#bfa162', border: 'none', color: '#fff', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.4rem 1rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit', opacity: isDemo ? 0.5 : 1 }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <p style={{ color: '#555', fontSize: '.8rem' }}>Notes available once the lead submits an application.</p>
          )}
        </div>

        {/* Save status button */}
        {lead.application && (
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button onClick={save} disabled={saving} style={{ background: saving ? '#222' : '#f5b935', border: 'none', color: '#000', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.65rem 1.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit', flex: 1 }}>
              {saving ? 'Saving…' : 'Save Changes →'}
            </button>
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
        bookings = DEMO_BOOKINGS_STUB
      } else {
        const [aRes, bRes] = await Promise.all([
          supabase.from('leads').select('*').order('created_at', { ascending: false }),
          supabase.from('bookings').select('*').order('created_at', { ascending: false }),
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

  // Filter
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {isDemo && (
        <div style={{ background: '#2d2500', borderBottom: '1px solid #5c4800', padding: '.5rem 1.5rem', display: 'flex', gap: '.75rem', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ color: '#fff', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase' }}>Demo Mode</span>
          <span style={{ color: '#7a6500', fontSize: '.75rem' }}>Showing combined sample data from all lead sources.</span>
        </div>
      )}

      {/* Merge alert */}
      {duplicates.length > 0 && (
        <div style={{ background: 'rgba(13,91,174,.1)', borderBottom: '1px solid rgba(13,91,174,.25)', padding: '.6rem 1.5rem', display: 'flex', alignItems: 'center', gap: '.75rem', flexShrink: 0 }}>
          <span style={{ color: '#009dd6', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase' }}>Multi-Source</span>
          <span style={{ color: '#c7c7c7', fontSize: '.75rem' }}>{duplicates.length} contact{duplicates.length > 1 ? 's' : ''} appear in multiple sources — their profiles are automatically unified below.</span>
        </div>
      )}

      {/* Stats bar */}
      <div style={{ padding: '.875rem 1.5rem', borderBottom: '1px solid #0d0d0d', display: 'flex', gap: '2rem', flexShrink: 0 }}>
        {[
          ['Total Contacts', unified.length],
          ['Applied', unified.filter(u => u.sources.includes('application')).length],
          ['Newsletter', unified.filter(u => u.sources.includes('newsletter')).length],
          ['Booked', unified.filter(u => u.sources.includes('booking')).length],
        ].map(([label, val]) => (
          <div key={String(label)}>
            <p style={{ color: '#fff', fontWeight: 900, fontSize: '1.4rem', lineHeight: 1 }}>{val}</p>
            <p style={{ color: '#888', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginTop: '.15rem' }}>{label as string}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ padding: '.875rem 1.5rem', borderBottom: '1px solid #0d0d0d', display: 'flex', gap: '.75rem', flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
        <input className="field" placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 240, flex: '0 0 auto' }} />

        {/* Source filter */}
        <div style={{ display: 'flex', gap: '.35rem' }}>
          {SOURCE_FILTERS.map(f => (
            <button key={f.value} onClick={() => setSrcFilter(f.value)} style={{ background: srcFilter === f.value ? '#1a1a1a' : 'transparent', border: `1px solid ${srcFilter === f.value ? '#444' : '#222'}`, color: srcFilter === f.value ? '#fff' : '#555', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.3rem .7rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Status filter (only meaningful for applications) */}
        <div style={{ display: 'flex', gap: '.35rem' }}>
          {(['all', 'new', 'reviewed', 'accepted', 'declined'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{ background: statusFilter === s ? (s === 'all' ? '#1a1a1a' : (STATUS_COLORS[s] ?? '#888') + '22') : 'transparent', border: `1px solid ${statusFilter === s ? (s === 'all' ? '#444' : (STATUS_COLORS[s] ?? '#444')) : '#222'}`, color: statusFilter === s ? (s === 'all' ? '#fff' : STATUS_COLORS[s]) : '#555', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.3rem .7rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              {s}
            </button>
          ))}
        </div>

        <button onClick={load} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #222', color: '#c7c7c7', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
          ↺ Refresh
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: '#888', fontSize: '.8rem' }}>Loading contacts…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: '#888', fontSize: '.8rem' }}>No contacts match.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? 'minmax(0,1fr) 420px' : '1fr', flex: 1, minHeight: 0 }}>
          {/* List */}
          <div style={{ overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#000', zIndex: 1 }}>
                <tr style={{ borderBottom: '1px solid #222' }}>
                  {['Name', 'Email', 'Sources', 'Status', 'Last Activity'].map(h => (
                    <th key={h} style={{ padding: '.875rem 1.25rem', textAlign: 'left', color: '#888', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.email} onClick={() => setSelected(selected?.email === u.email ? null : u)}
                    style={{ borderBottom: '1px solid #0d0d0d', cursor: 'pointer', background: selected?.email === u.email ? '#0d0d0d' : 'transparent', transition: 'background .1s' }}
                    onMouseEnter={e => { if (selected?.email !== u.email) e.currentTarget.style.background = '#0d0d0d' }}
                    onMouseLeave={e => { if (selected?.email !== u.email) e.currentTarget.style.background = 'transparent' }}
                  >
                    <td style={{ padding: '1rem 1.25rem', color: '#fff', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {u.firstName} {u.lastName}
                      {u.sources.length > 1 && <span style={{ marginLeft: '.4rem', color: '#009dd6', fontSize: '.6rem', fontWeight: 900 }}>✦</span>}
                    </td>
                    <td style={{ padding: '1rem 1.25rem', color: '#c7c7c7' }}>{u.email}</td>
                    <td style={{ padding: '1rem 1.25rem' }}>
                      <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                        {u.sources.map(s => <SourceBadge key={s} source={s} />)}
                      </div>
                    </td>
                    <td style={{ padding: '1rem 1.25rem' }}>
                      {u.application ? <StatusBadge status={u.application.status} /> : <span style={{ color: '#333', fontSize: '.75rem' }}>—</span>}
                    </td>
                    <td style={{ padding: '1rem 1.25rem', color: '#888', whiteSpace: 'nowrap', fontSize: '.75rem' }}>
                      {fmtDate(u.lastSeen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ padding: '.75rem 1.25rem', color: '#888', fontSize: '.7rem' }}>Showing {filtered.length} of {unified.length} contacts</p>
          </div>

          {/* Detail */}
          {selected && (
            <LeadDetail
              lead={selected}
              onClose={() => setSelected(null)}
              onUpdateLead={handleUpdateLead}
              isDemo={isDemo}
            />
          )}
        </div>
      )}
    </div>
  )
}
