import { useEffect, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import type { Lead, LeadStatus } from '../../types/database'
import type { CoachDisplay } from '../../lib/coachProfiles'
import { supabase } from '../../lib/supabase'
import { DEMO_LEADS } from '../../data/demoData'
import { useMediaQuery, MOBILE_QUERY } from '../../lib/dashboard'
import DemoBanner from '../../components/dashboard/DemoBanner'
import LeadDetail from '../admin/LeadDetail'

const STATUS_COLORS: Record<LeadStatus, string> = {
  new:      '#c8102e',
  reviewed: '#272C84',
  accepted: '#22c55e',
  declined: 'var(--text-4)',
}

const ALL_STATUSES: LeadStatus[] = ['new', 'reviewed', 'accepted', 'declined']

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function Badge({ status }: { status: LeadStatus }) {
  const c = STATUS_COLORS[status]
  return (
    <span style={{ background: c + '18', border: `1px solid ${c}`, color: c, fontSize: '.6rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.2rem .6rem', borderRadius: '.2rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {status}
    </span>
  )
}

/** Contactable email — stopPropagation so tapping it doesn't open the detail modal. */
function EmailLink({ email, style }: { email: string; style?: CSSProperties }) {
  return (
    <a
      // Encoded, because an address is a DB value and `a@b.com?bcc=…` in an
      // unencoded mailto: is a header the visitor never typed.
      href={`mailto:${encodeURIComponent(email)}`}
      onClick={e => e.stopPropagation()}
      style={{ color: 'var(--text-2)', textDecoration: 'underline', textUnderlineOffset: '3px', wordBreak: 'break-all', ...style }}
    >
      {email}
    </a>
  )
}

interface Props {
  coach: CoachDisplay
  isDemo?: boolean
}

export default function CoachAdminDashboard({ coach, isDemo = false }: Props) {
  const isMobile = useMediaQuery(MOBILE_QUERY)

  // In demo mode, only show leads that match this coach
  const demoLeads = DEMO_LEADS.filter(l => l.coach_pref === coach.name)

  const [leads, setLeads] = useState<Lead[]>(isDemo ? demoLeads : [])
  const [loading, setLoading] = useState(!isDemo)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<LeadStatus | 'all'>('all')
  const [selected, setSelected] = useState<Lead | null>(null)

  // Save confirmation: LeadDetail only calls onUpdate after a confirmed write
  // (live mode returns the persisted row), so a flash here is an honest "Saved".
  const [savedFlash, setSavedFlash] = useState(false)
  const flashTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  const fetchLeads = useCallback(async () => {
    if (isDemo) { setLeads(demoLeads); return }
    setLoading(true)
    // Only fetch leads for this coach
    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('coach_pref', coach.name)
      .order('created_at', { ascending: false })
    if (data) setLeads(data as Lead[])
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, coach.name])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  // Search filters WITHIN the selected status — typing must never clear the pill.
  const filtered = leads.filter(l => {
    if (filterStatus !== 'all' && l.status !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      return [l.first_name, l.last_name, l.email, l.service]
        .some(v => v?.toLowerCase().includes(q))
    }
    return true
  })

  const counts: Record<string, number> = { all: leads.length }
  ALL_STATUSES.forEach(s => { counts[s] = leads.filter(l => l.status === s).length })

  const handleUpdate = (updated: Lead) => {
    setLeads(ls => ls.map(l => l.id === updated.id ? updated : l))
    setSelected(updated)
    setSavedFlash(true)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setSavedFlash(false), 2500)
  }

  return (
    <>
      {isDemo && (
        <div style={{ padding: isMobile ? '1rem 1rem 0' : '1.5rem 2rem 0' }}>
          <DemoBanner note="Sample leads shown for this coach." />
        </div>
      )}

      {/* Toolbar */}
      <div style={{ padding: isMobile ? '1rem' : '1.5rem 2rem', borderBottom: '1px solid var(--surface)', display: 'flex', flexWrap: 'wrap', gap: isMobile ? '.75rem' : '1rem', alignItems: 'center' }}>
        <input
          maxLength={120}
          className="field" placeholder="Search name or email…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: isMobile ? 'none' : 280, flex: isMobile ? '1 1 100%' : 1 }}
        />

        {/* Status filter pills */}
        <div className="flex gap-2 flex-wrap">
          {(['all', ...ALL_STATUSES] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                background: filterStatus === s ? (s === 'all' ? 'var(--border)' : STATUS_COLORS[s as LeadStatus] + '22') : 'transparent',
                border: `1px solid ${filterStatus === s ? (s === 'all' ? 'var(--text-dim)' : STATUS_COLORS[s as LeadStatus]) : 'var(--border)'}`,
                color: filterStatus === s ? (s === 'all' ? 'var(--text)' : STATUS_COLORS[s as LeadStatus]) : 'var(--text-dim)',
                fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                padding: '.35rem .75rem', borderRadius: '.25rem', cursor: 'pointer', whiteSpace: 'nowrap',
                minHeight: isMobile ? '2.5rem' : undefined,
              }}
            >
              {s} ({counts[s] ?? 0})
            </button>
          ))}
        </div>

        {!isDemo && (
          <button
            onClick={fetchLeads}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.4rem .875rem', borderRadius: '.25rem', cursor: 'pointer', marginLeft: 'auto', minHeight: isMobile ? '2.5rem' : undefined }}
          >
            ↺ Refresh
          </button>
        )}
      </div>

      {/* Leads */}
      {loading ? (
        <div style={{ padding: isMobile ? '3rem 1.5rem' : '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading leads…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: isMobile ? '3rem 1.5rem' : '4rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-3)', fontSize: '.8rem', marginBottom: '.5rem' }}>No leads found.</p>
          {leads.length === 0 && !isDemo && (
            <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>Leads submitted to {coach.firstName} will appear here.</p>
          )}
        </div>
      ) : isMobile ? (
        /* Phone: stacked cards instead of a horizontally-scrolling table */
        <div style={{ padding: '1rem', display: 'grid', gap: '.75rem' }}>
          {filtered.map(lead => (
            <div
              key={lead.id}
              onClick={() => setSelected(lead)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '.875rem 1rem', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem' }}>
                <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: '.85rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lead.first_name} {lead.last_name}
                </span>
                <Badge status={lead.status} />
              </div>
              <EmailLink email={lead.email} style={{ display: 'inline-block', fontSize: '.8rem', padding: '.4rem 0 .1rem' }} />
              <div style={{ color: 'var(--text-3)', fontSize: '.7rem', marginTop: '.25rem' }}>
                {fmtDate(lead.created_at)} · {lead.coach_pref}
              </div>
            </div>
          ))}
          <p style={{ color: 'var(--text-3)', fontSize: '.7rem', padding: '.25rem 0' }}>
            Showing {filtered.length} of {leads.length} leads
          </p>
        </div>
      ) : (
        /* Desktop: table */
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Submitted', 'Name', 'Email', 'Service', 'SBD', 'Status'].map(h => (
                  <th key={h} style={{ padding: '1rem 1.25rem', textAlign: 'left', color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => (
                <tr
                  key={lead.id}
                  onClick={() => setSelected(lead)}
                  style={{ borderBottom: '1px solid var(--surface)', cursor: 'pointer' }}
                >
                  <td style={{ padding: '1rem 1.25rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                    {fmtDate(lead.created_at)}
                  </td>
                  <td style={{ padding: '1rem 1.25rem', color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {lead.first_name} {lead.last_name}
                  </td>
                  <td style={{ padding: '1rem 1.25rem' }}>
                    <EmailLink email={lead.email} />
                  </td>
                  <td style={{ padding: '1rem 1.25rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{lead.service}</td>
                  <td style={{ padding: '1rem 1.25rem', color: 'var(--text-2)', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '.75rem' }}>
                    {lead.squat_max && lead.bench_max && lead.dead_max
                      ? `${lead.squat_max} / ${lead.bench_max} / ${lead.dead_max}`
                      : '—'}
                  </td>
                  <td style={{ padding: '1rem 1.25rem' }}>
                    <Badge status={lead.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ padding: '.75rem 1.25rem', color: 'var(--text-3)', fontSize: '.7rem' }}>
            Showing {filtered.length} of {leads.length} leads
          </p>
        </div>
      )}

      {selected && (
        <LeadDetail
          lead={selected}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
          isDemo={isDemo}
        />
      )}

      {/* Save confirmation — fixed so it is visible above the LeadDetail modal
          (z-50); lifted above the bottom tab bar on phones. */}
      {savedFlash && (
        <div
          role="status"
          style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: isMobile ? '5.5rem' : '1.5rem', zIndex: 70, background: 'var(--bg)', border: '1px solid #22c55e', color: '#22c55e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', padding: '.65rem 1.25rem', borderRadius: '.25rem', pointerEvents: 'none', whiteSpace: 'nowrap' }}
        >
          Saved
        </div>
      )}
    </>
  )
}
