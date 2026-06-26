import { useState, useEffect, useCallback } from 'react'
import { fetchNewsletterLeads, exportNewsletterCsv } from '../../lib/newsletterApi'
import type { NewsletterLead } from '../../types/newsletter'

const SOURCE_LABELS: Record<string, string> = {
  guides_page:      'Guides Page',
  attempt_planner:  'Attempt Planner',
  meet_checklist:   'Meet Day Checklist',
  quiz:             'Training Quiz',
  rpe_guide:        'RPE Guide',
  big_three:        'Big Three Guide',
  audit_worksheet:  'Audit Worksheet',
}

function sourceLabel(source: string) {
  return SOURCE_LABELS[source] ?? source
}

export default function NewsletterLeadsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [leads,   setLeads]   = useState<NewsletterLead[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [error,   setError]   = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchNewsletterLeads(isDemo)
      setLeads(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads')
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { refresh() }, [refresh])

  const filtered = leads.filter(l => {
    if (!search) return true
    const q = search.toLowerCase()
    return [l.firstName, l.lastName, l.email, l.source]
      .some(v => v?.toLowerCase().includes(q))
  })

  // Count by source
  const bySrc: Record<string, number> = {}
  leads.forEach(l => { bySrc[l.source] = (bySrc[l.source] ?? 0) + 1 })

  return (
    <>
      {isDemo && (
        <div style={{ background: '#2d2500', borderBottom: '1px solid #5c4800', padding: '.625rem 2rem', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <span style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase' }}>Demo Mode</span>
          <span style={{ color: '#7a6500', fontSize: '.75rem' }}>{leads.length} sample newsletter leads.</span>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid var(--surface)', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
        <input
          className="field"
          placeholder="Search name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 280, flex: 1 }}
        />

        <button
          onClick={refresh}
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.4rem .875rem', borderRadius: '.25rem', cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text-dim)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
        >
          ↺ Refresh
        </button>

        <button
          onClick={() => exportNewsletterCsv(filtered)}
          disabled={filtered.length === 0}
          style={{ background: '#272C84', border: 'none', color: '#ffffff', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.4rem 1rem', borderRadius: '.25rem', cursor: filtered.length === 0 ? 'not-allowed' : 'pointer', opacity: filtered.length === 0 ? 0.4 : 1, marginLeft: 'auto' }}
          onMouseEnter={e => { if (filtered.length > 0) e.currentTarget.style.background = '#1a1f6b' }}
          onMouseLeave={e => e.currentTarget.style.background = '#272C84'}
        >
          ↓ Export CSV ({filtered.length})
        </button>
      </div>

      {/* Source breakdown chips */}
      {!loading && leads.length > 0 && (
        <div style={{ padding: '.75rem 2rem', borderBottom: '1px solid var(--surface-2)', display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginRight: '.25rem' }}>By Source:</span>
          {Object.entries(bySrc).sort((a, b) => b[1] - a[1]).map(([src, count]) => (
            <span key={src} style={{ background: 'rgba(39,44,132,.08)', border: '1px solid rgba(39,44,132,.15)', color: 'var(--text)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.2rem .6rem', borderRadius: '.15rem' }}>
              {sourceLabel(src)} · {count}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div style={{ margin: '1.5rem 2rem', padding: '.75rem 1rem', background: 'rgba(39,44,132,.08)', border: '1px solid rgba(39,44,132,.25)', borderRadius: '.25rem', color: 'var(--text)', fontSize: '.8rem' }}>
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading newsletter leads…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>
          {leads.length === 0 ? 'No newsletter signups yet.' : 'No results for that search.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Signed Up', 'Name', 'Email', 'Source'].map(h => (
                  <th key={h} style={{ padding: '1rem 1.25rem', textAlign: 'left', color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => (
                <tr
                  key={lead.id}
                  style={{ borderBottom: '1px solid var(--surface-2)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '1rem 1.25rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                    {new Date(lead.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td style={{ padding: '1rem 1.25rem', color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {lead.firstName} {lead.lastName}
                  </td>
                  <td style={{ padding: '1rem 1.25rem', color: 'var(--text-2)' }}>{lead.email}</td>
                  <td style={{ padding: '1rem 1.25rem' }}>
                    <span style={{ background: 'rgba(39,44,132,.08)', border: '1px solid rgba(39,44,132,.15)', color: 'var(--text)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.2rem .55rem', borderRadius: '.15rem' }}>
                      {sourceLabel(lead.source)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ padding: '.75rem 1.25rem', color: 'var(--text-3)', fontSize: '.7rem' }}>
            Showing {filtered.length} of {leads.length} subscribers
          </p>
        </div>
      )}
    </>
  )
}
