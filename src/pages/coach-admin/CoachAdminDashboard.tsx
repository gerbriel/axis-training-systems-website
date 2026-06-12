import { useEffect, useState, useCallback } from 'react'
import type { Lead, LeadStatus } from '../../types/database'
import type { Coach } from '../../data/coaches'
import { supabase } from '../../lib/supabase'
import { DEMO_LEADS } from '../../data/demoData'
import LeadDetail from '../admin/LeadDetail'

const STATUS_COLORS: Record<LeadStatus, string> = {
  new:      '#c8102e',
  reviewed: '#f5b935',
  accepted: '#22c55e',
  declined: '#555',
}

const ALL_STATUSES: LeadStatus[] = ['new', 'reviewed', 'accepted', 'declined']

function Badge({ status }: { status: LeadStatus }) {
  const c = STATUS_COLORS[status]
  return (
    <span style={{ background: c + '18', border: `1px solid ${c}`, color: c, fontSize: '.6rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.2rem .6rem', borderRadius: '.2rem', whiteSpace: 'nowrap' }}>
      {status}
    </span>
  )
}

interface Props {
  coach: Coach
  isDemo?: boolean
}

export default function CoachAdminDashboard({ coach, isDemo = false }: Props) {
  // In demo mode, only show leads that match this coach
  const demoLeads = DEMO_LEADS.filter(l => l.coach_pref === coach.name)

  const [leads, setLeads] = useState<Lead[]>(isDemo ? demoLeads : [])
  const [loading, setLoading] = useState(!isDemo)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<LeadStatus | 'all'>('all')
  const [selected, setSelected] = useState<Lead | null>(null)

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
  }

  return (
    <>
      {/* Demo banner */}
      {isDemo && (
        <div style={{ background: '#2d2500', borderBottom: '1px solid #5c4800', padding: '.625rem 2rem', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <span style={{ color: '#f5b935', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase' }}>Demo Mode</span>
          <span style={{ color: '#7a6500', fontSize: '.75rem' }}>
            Showing {demoLeads.length} sample lead{demoLeads.length !== 1 ? 's' : ''} for {coach.firstName}.
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid #0b2f5b', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
        <input
          className="field" placeholder="Search name or email…"
          value={search} onChange={e => { setSearch(e.target.value); if (e.target.value) setFilterStatus('all') }}
          style={{ maxWidth: 280, flex: 1 }}
        />

        {/* Status filter pills */}
        <div className="flex gap-2 flex-wrap">
          {(['all', ...ALL_STATUSES] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                background: filterStatus === s ? (s === 'all' ? '#1c3a63' : STATUS_COLORS[s as LeadStatus] + '22') : 'transparent',
                border: `1px solid ${filterStatus === s ? (s === 'all' ? '#444' : STATUS_COLORS[s as LeadStatus]) : '#1c3a63'}`,
                color: filterStatus === s ? (s === 'all' ? '#fff' : STATUS_COLORS[s as LeadStatus]) : '#444',
                fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                padding: '.35rem .75rem', borderRadius: '.25rem', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {s} ({counts[s] ?? 0})
            </button>
          ))}
        </div>

        {!isDemo && (
          <button
            onClick={fetchLeads}
            style={{ background: 'none', border: '1px solid #1c3a63', color: '#c7d0de', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.4rem .875rem', borderRadius: '.25rem', cursor: 'pointer', marginLeft: 'auto' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#444'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#1c3a63'}
          >
            ↺ Refresh
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: '#b8c2d4', fontSize: '.8rem' }}>Loading leads…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '4rem', textAlign: 'center' }}>
          <p style={{ color: '#b8c2d4', fontSize: '.8rem', marginBottom: '.5rem' }}>No leads found.</p>
          {leads.length === 0 && !isDemo && (
            <p style={{ color: '#b8c2d4', fontSize: '.75rem' }}>Leads submitted to {coach.firstName} will appear here.</p>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1c3a63' }}>
                {['Submitted', 'Name', 'Email', 'Service', 'SBD', 'Status'].map(h => (
                  <th key={h} style={{ padding: '1rem 1.25rem', textAlign: 'left', color: '#b8c2d4', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => (
                <tr
                  key={lead.id}
                  onClick={() => setSelected(lead)}
                  style={{ borderBottom: '1px solid #0b2f5b', cursor: 'pointer', transition: 'background .1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#15375f')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '1rem 1.25rem', color: '#c7d0de', whiteSpace: 'nowrap' }}>
                    {new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td style={{ padding: '1rem 1.25rem', color: '#fff', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {lead.first_name} {lead.last_name}
                  </td>
                  <td style={{ padding: '1rem 1.25rem', color: '#c7d0de' }}>{lead.email}</td>
                  <td style={{ padding: '1rem 1.25rem', color: '#aaa', whiteSpace: 'nowrap' }}>{lead.service}</td>
                  <td style={{ padding: '1rem 1.25rem', color: '#c7d0de', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '.75rem' }}>
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
          <p style={{ padding: '.75rem 1.25rem', color: '#b8c2d4', fontSize: '.7rem' }}>
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
    </>
  )
}
