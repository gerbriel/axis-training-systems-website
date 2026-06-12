import { useEffect, useState, useCallback } from 'react'
import type { Lead, LeadStatus } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { DEMO_LEADS } from '../../data/demoData'
import LeadDetail from './LeadDetail'

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

export default function AdminDashboard({ isDemo = false }: { isDemo?: boolean }) {
  const [leads, setLeads] = useState<Lead[]>(isDemo ? DEMO_LEADS : [])
  const [loading, setLoading] = useState(!isDemo)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<LeadStatus | 'all'>('all')
  const [filterService, setFilterService] = useState('all')
  const [selected, setSelected] = useState<Lead | null>(null)

  const fetchLeads = useCallback(async () => {
    if (isDemo) { setLeads(DEMO_LEADS); return }
    setLoading(true)
    const { data } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) setLeads(data as Lead[])
    setLoading(false)
  }, [isDemo])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  const services = ['all', ...Array.from(new Set(leads.map(l => l.service).filter(Boolean)))]

  const filtered = leads.filter(l => {
    if (filterStatus !== 'all' && l.status !== filterStatus) return false
    if (filterService !== 'all' && l.service !== filterService) return false
    if (search) {
      const q = search.toLowerCase()
      return [l.first_name, l.last_name, l.email, l.coach_pref, l.service]
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
          <span style={{ color: '#7a6500', fontSize: '.75rem' }}>Showing sample data — no database connection required.</span>
        </div>
      )}
      {/* Toolbar */}
      <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid #0d2040', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
        {/* Search */}
        <input
          className="field" placeholder="Search name, email, coach…"
          value={search} onChange={e => { setSearch(e.target.value); if (e.target.value) setFilterStatus('all') }}
          style={{ maxWidth: 280, flex: 1 }}
        />

        {/* Status filter */}
        <div className="flex gap-2">
          {(['all', ...ALL_STATUSES] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                background: filterStatus === s ? (s === 'all' ? '#1c3255' : STATUS_COLORS[s as LeadStatus] + '22') : 'transparent',
                border: `1px solid ${filterStatus === s ? (s === 'all' ? '#444' : STATUS_COLORS[s as LeadStatus]) : '#152842'}`,
                color: filterStatus === s ? (s === 'all' ? '#fff' : STATUS_COLORS[s as LeadStatus]) : '#444',
                fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                padding: '.35rem .75rem', borderRadius: '.25rem', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {s} ({counts[s] ?? 0})
            </button>
          ))}
        </div>

        {/* Service filter */}
        <select
          className="field" value={filterService} onChange={e => setFilterService(e.target.value)}
          style={{ maxWidth: 220 }}
        >
          {services.map(s => <option key={s} value={s}>{s === 'all' ? 'All Services' : s}</option>)}
        </select>

        <button
          onClick={fetchLeads}
          style={{ background: 'none', border: '1px solid #152842', color: '#555', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.4rem .875rem', borderRadius: '.25rem', cursor: 'pointer', marginLeft: 'auto' }}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#444'}
          onMouseLeave={e => e.currentTarget.style.borderColor = '#152842'}
        >
          ↺ Refresh
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: '#3a3f47', fontSize: '.8rem' }}>Loading leads…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: '#3a3f47', fontSize: '.8rem' }}>No leads found.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #112038' }}>
                {['Submitted', 'Name', 'Email', 'Service', 'Coach', 'SBD', 'Status'].map(h => (
                  <th key={h} style={{ padding: '1rem 1.25rem', textAlign: 'left', color: '#3a3f47', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => (
                <tr
                  key={lead.id}
                  onClick={() => setSelected(lead)}
                  style={{ borderBottom: '1px solid #0a1f3c', cursor: 'pointer', transition: 'background .1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#0e1c30')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '1rem 1.25rem', color: '#555', whiteSpace: 'nowrap' }}>
                    {new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td style={{ padding: '1rem 1.25rem', color: '#fff', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {lead.first_name} {lead.last_name}
                  </td>
                  <td style={{ padding: '1rem 1.25rem', color: '#666' }}>{lead.email}</td>
                  <td style={{ padding: '1rem 1.25rem', color: '#aaa', whiteSpace: 'nowrap' }}>{lead.service}</td>
                  <td style={{ padding: '1rem 1.25rem', color: '#666', whiteSpace: 'nowrap' }}>{lead.coach_pref}</td>
                  <td style={{ padding: '1rem 1.25rem', color: '#555', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '.75rem' }}>
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
          <p style={{ padding: '.75rem 1.25rem', color: '#3a3f47', fontSize: '.7rem' }}>
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
