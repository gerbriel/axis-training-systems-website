import { useState, useEffect, useCallback } from 'react'
import {
  fetchMarketingSummary, sourceLabel,
  type MarketingSummary,
} from '../../lib/marketing'
import DemoBanner from '../../components/dashboard/DemoBanner'

/**
 * Marketing, the reach numbers, as an Insights sub-tab. How many people have
 * left an address on the site, how that is trending, and which page they came
 * from.
 *
 * READ-ONLY, AND THAT IS THE POINT. Nothing on this screen writes, and the two
 * neighbours it could have had live elsewhere on purpose: the signup list
 * itself is folded into the newsletter desk (Messages ▸ Newsletters), which is
 * the room people look in for a mailing list, and announcements are their own
 * Insights sub-tab. This screen counts and never composes.
 */

export default function MarketingInsights({ isDemo = false }: { isDemo?: boolean }) {
  // Nothing here writes, so nothing here asks about `send_marketing`. The whole
  // screen is `view_marketing`, which 040 widened `newsletter_leads` to, and
  // the signup rows behind every number below are read under it.
  const [summary, setSummary] = useState<MarketingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setSummary(await fetchMarketingSummary(isDemo))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load marketing analytics.')
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { refresh() }, [refresh])

  if (loading) return (
    <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading marketing analytics…</div>
  )

  const maxSrc = Math.max(1, ...(summary?.bySource.map(s => s.count) ?? [1]))

  return (
    <div style={{ padding: '2rem' }}>
      {isDemo && <DemoBanner />}

      {error && (
        <div style={{ marginBottom: '1.5rem', padding: '.75rem 1rem', background: 'rgba(180,35,43,.08)', border: '1px solid rgba(180,35,43,.25)', borderRadius: '.25rem', color: '#b4232b', fontSize: '.8rem' }}>
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1px', background: 'var(--surface-2)', marginBottom: '2rem' }}>
        {[
          ['Total signups',   summary ? summary.totalSignups.toLocaleString() : '—', 'all time'],
          ['Last 30 days',    summary ? summary.recentSignups.toLocaleString() : '—', 'new signups'],
          ['Conversion',      summary?.conversionRate != null ? `${summary.conversionRate.toFixed(2)}%` : '—',
                              summary?.pageviews != null ? `${summary.pageviews.toLocaleString()} views` : 'no view data'],
        ].map(([label, value, sub]) => (
          <div key={label} style={{ background: 'var(--bg)', padding: '1.5rem' }}>
            <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.5rem' }}>{label}</p>
            <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '2rem', lineHeight: 1 }}>{value}</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.7rem', marginTop: '.25rem' }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Signups by source. One card, so it is sized to the list it holds
          rather than stretched across a grid that no longer has a neighbour. */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', maxWidth: 640 }}>
        <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.4rem' }}>Signups by Source</p>
        <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.6, marginBottom: '1rem' }}>
          Which page somebody left their address on. The list itself is under
          Email signups on the newsletter page in Messages.
        </p>
        {!summary || summary.bySource.length === 0 ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.8rem' }}>No signups yet.</p>
        ) : summary.bySource.map(({ source, count }) => (
          <div key={source} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.6rem 0', borderBottom: '1px solid var(--surface-2)' }}>
            <span style={{ color: 'var(--text-2)', fontSize: '.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{sourceLabel(source)}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
              <div style={{ width: 70, height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(count / maxSrc) * 100}%`, height: '100%', background: '#272C84', borderRadius: 2 }} />
              </div>
              <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.75rem', minWidth: 24, textAlign: 'right' }}>{count}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
