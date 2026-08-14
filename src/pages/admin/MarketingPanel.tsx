import { useState, useEffect, useCallback } from 'react'
import {
  fetchMarketingSummary, listBroadcasts, recordBroadcast, sourceLabel,
  type MarketingSummary, type Broadcast, type BroadcastAudience,
} from '../../lib/marketing'
import { usePermissions } from '../../lib/usePermissions'
import NewsletterLeadsPanel from './NewsletterLeadsPanel'
import AnnouncementsPanel from './AnnouncementsPanel'
import DemoBanner from '../../components/dashboard/DemoBanner'

// ── Sub-tabs ─────────────────────────────────────────────────────────────────

type SubTab = 'analytics' | 'newsletter' | 'announcements'

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'analytics',     label: 'Analytics' },
  { key: 'newsletter',    label: 'Newsletter' },
  { key: 'announcements', label: 'Announcements' },
]

// Keep the chosen sub-tab in the URL hash so a refresh / back button lands where
// the studio left off, mirroring how the top-level tabs persist.
function useHashSubTab(fallback: SubTab): [SubTab, (t: SubTab) => void] {
  const read = (): SubTab => {
    const h = window.location.hash.replace(/^#/, '') as SubTab
    return SUB_TABS.some(t => t.key === h) ? h : fallback
  }
  const [tab, setTab] = useState<SubTab>(read)
  useEffect(() => {
    const onHash = () => setTab(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const select = (t: SubTab) => {
    try { window.location.hash = t } catch { /* ignore */ }
    setTab(t)
  }
  return [tab, select]
}

// ── Panel ────────────────────────────────────────────────────────────────────

export default function MarketingPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [tab, setTab] = useHashSubTab('analytics')

  return (
    <div>
      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: '.25rem', padding: '0 2rem', borderBottom: '1px solid var(--surface)', flexWrap: 'wrap' }}>
        {SUB_TABS.map(t => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-current={active ? 'page' : undefined}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: active ? 'var(--text)' : 'var(--text-3)',
                fontSize: '.72rem', fontWeight: active ? 900 : 700,
                letterSpacing: '.1em', textTransform: 'uppercase',
                padding: '.9rem .4rem', marginRight: '1rem',
                borderBottom: `2px solid ${active ? '#272C84' : 'transparent'}`,
                fontFamily: 'inherit',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'analytics'     && <MarketingAnalytics isDemo={isDemo} />}
      {tab === 'newsletter'    && <NewsletterLeadsPanel isDemo={isDemo} />}
      {tab === 'announcements' && <AnnouncementsPanel isDemo={isDemo} />}
    </div>
  )
}

// ── Marketing analytics sub-view ─────────────────────────────────────────────

function MarketingAnalytics({ isDemo }: { isDemo: boolean }) {
  const { can, ready } = usePermissions()
  const canSend = !ready || can('send_marketing') // optimistic until known

  const [summary, setSummary]       = useState<MarketingSummary | null>(null)
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [s, b] = await Promise.all([fetchMarketingSummary(isDemo), listBroadcasts(isDemo)])
      setSummary(s); setBroadcasts(b)
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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '1.5rem' }}>
        {/* Signups by source */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem' }}>
          <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '1rem' }}>Signups by Source</p>
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

        {/* Broadcasts */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>Broadcasts</p>
          </div>

          {canSend && <BroadcastComposer isDemo={isDemo} onSent={refresh} subscriberCount={summary?.totalSignups ?? 0} />}

          {broadcasts.length === 0 ? (
            <p style={{ color: 'var(--text-4)', fontSize: '.8rem', marginTop: canSend ? '1rem' : 0 }}>No broadcasts recorded yet.</p>
          ) : (
            <div style={{ marginTop: canSend ? '1.25rem' : 0 }}>
              {broadcasts.map(b => (
                <div key={b.id} style={{ padding: '.7rem 0', borderBottom: '1px solid var(--surface-2)' }}>
                  <p style={{ color: 'var(--text)', fontSize: '.8rem', fontWeight: 600 }}>{b.subject}</p>
                  <p style={{ color: 'var(--text-3)', fontSize: '.68rem', marginTop: '.2rem' }}>
                    {b.sentAt ? new Date(b.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Draft'}
                    {'  ·  '}{b.audience === 'all' ? 'Everyone' : 'Newsletter'}
                    {'  ·  '}{b.sentCount.toLocaleString()} recipients
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Broadcast composer ───────────────────────────────────────────────────────
//
// Records the intent of a send — the actual mailer (Resend) is out of scope, so
// this stores the subject/audience and the current subscriber count. The button
// says "Record" rather than "Send" for exactly that reason.

function BroadcastComposer({ isDemo, onSent, subscriberCount }: { isDemo: boolean; onSent: () => void; subscriberCount: number }) {
  const [open, setOpen]         = useState(false)
  const [subject, setSubject]   = useState('')
  const [body, setBody]         = useState('')
  const [audience, setAudience] = useState<BroadcastAudience>('newsletter')
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  const submit = async () => {
    setSaving(true); setErr(null)
    try {
      await recordBroadcast({ subject, body, audience }, isDemo)
      setSubject(''); setBody(''); setAudience('newsletter'); setOpen(false)
      onSent()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record broadcast.')
    } finally {
      setSaving(false)
    }
  }

  const input: React.CSSProperties = {
    width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
    color: 'var(--text)', fontSize: '.82rem', padding: '.5rem .65rem',
    borderRadius: '.25rem', fontFamily: 'inherit', marginBottom: '.6rem',
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        style={{ background: '#272C84', border: 'none', color: '#fff', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.45rem .9rem', borderRadius: '.25rem', cursor: 'pointer' }}>
        + Record a send
      </button>
    )
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '.3rem', padding: '.9rem' }}>
      <input style={input} placeholder="Subject" value={subject} maxLength={160} onChange={e => setSubject(e.target.value)} />
      <textarea style={{ ...input, minHeight: 56, resize: 'vertical' }} placeholder="Body (optional)" value={body} maxLength={4000} onChange={e => setBody(e.target.value)} />
      <select style={input} value={audience} onChange={e => setAudience(e.target.value as BroadcastAudience)}>
        <option value="newsletter">Newsletter subscribers ({subscriberCount})</option>
        <option value="all">Everyone ({subscriberCount})</option>
      </select>
      <p style={{ color: 'var(--text-3)', fontSize: '.65rem', marginBottom: '.6rem' }}>
        Recording logs this send and its recipient count. Delivery is handled separately.
      </p>
      {err && <p style={{ color: '#b4232b', fontSize: '.72rem', marginBottom: '.6rem' }}>{err}</p>}
      <div style={{ display: 'flex', gap: '.5rem' }}>
        <button onClick={submit} disabled={saving || !subject.trim()}
          style={{ background: '#272C84', border: 'none', color: '#fff', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.45rem .9rem', borderRadius: '.25rem', cursor: saving || !subject.trim() ? 'not-allowed' : 'pointer', opacity: saving || !subject.trim() ? 0.5 : 1 }}>
          {saving ? 'Recording…' : 'Record send'}
        </button>
        <button onClick={() => { setOpen(false); setErr(null) }} disabled={saving}
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.45rem .9rem', borderRadius: '.25rem', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
