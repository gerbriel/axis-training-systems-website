import { useState, useEffect, useCallback } from 'react'
import { supabase, supabaseConfigured } from '../../lib/supabase'
import type { Pageview } from '../../types/database'

interface DayStat { date: string; views: number; sessions: Set<string> }

function useDemoData(): Pageview[] {
  const now = Date.now()
  const views: Pageview[] = []
  const pages = ['/', '/coaches', '/blog', '/guides', '/rankings', '/coaches/ronnie-vallejo', '/coaches/seth-burman']
  const refs   = ['', '', '', 'https://instagram.com', 'https://google.com', '']
  let id = 0
  for (let d = 29; d >= 0; d--) {
    const dayBase = now - d * 86_400_000
    const count = Math.floor(Math.random() * 30) + 5
    for (let i = 0; i < count; i++) {
      views.push({
        id: String(id++),
        path: pages[Math.floor(Math.random() * pages.length)],
        referrer: refs[Math.floor(Math.random() * refs.length)] || null,
        session_id: `demo-${d}-${Math.floor(Math.random() * 12)}`,
        created_at: new Date(dayBase + Math.random() * 86_400_000).toISOString(),
      })
    }
  }
  return views
}

function Bar({ height, label, value }: { height: number; label: string; value: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.25rem', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', height: 80, width: '100%', justifyContent: 'center' }}>
        <div
          title={`${value} views`}
          style={{ width: '80%', height: `${Math.max(height * 100, 2)}%`, background: '#272C84', borderRadius: '.1rem .1rem 0 0', opacity: .7, transition: 'height .3s', minHeight: 2 }}
        />
      </div>
      <span style={{ color: 'var(--text-4)', fontSize: '.5rem', textAlign: 'center', lineHeight: 1 }}>{label}</span>
    </div>
  )
}

export default function AnalyticsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [views,   setViews]   = useState<Pageview[]>([])
  const [loading, setLoading] = useState(true)

  const demoViews = useDemoData()

  const fetch = useCallback(async () => {
    if (isDemo) { setViews(demoViews); setLoading(false); return }
    if (!supabaseConfigured) { setLoading(false); return }
    setLoading(true)
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const { data } = await supabase.from('pageviews').select('*').gte('created_at', since).order('created_at', { ascending: true })
    if (data) setViews(data as Pageview[])
    setLoading(false)
  }, [isDemo])

  useEffect(() => { fetch() }, [fetch])

  if (loading) return (
    <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading analytics…</div>
  )

  if (!supabaseConfigured && !isDemo) return (
    <div style={{ padding: '2rem' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid #222', borderRadius: '.25rem', padding: '2rem', maxWidth: 560, color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.7 }}>
        <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Setup Required</p>
        Run <code style={{ background: 'var(--surface-2)', padding: '.1rem .4rem', borderRadius: '.2rem', fontSize: '.8rem' }}>supabase/migrations/003_bookings_analytics.sql</code> and add your Supabase env vars to enable real analytics. The tracker records pageviews automatically once connected.
      </div>
    </div>
  )

  const now = Date.now()
  const today     = views.filter(v => Date.now() - new Date(v.created_at).getTime() < 86_400_000)
  const thisWeek  = views.filter(v => Date.now() - new Date(v.created_at).getTime() < 7 * 86_400_000)
  const allSessions   = new Set(views.map(v => v.session_id))
  const weekSessions  = new Set(thisWeek.map(v => v.session_id))

  // 30-day chart
  const dayMap = new Map<string, DayStat>()
  for (let d = 29; d >= 0; d--) {
    const dt = new Date(now - d * 86_400_000)
    const key = dt.toISOString().split('T')[0]
    dayMap.set(key, { date: key, views: 0, sessions: new Set() })
  }
  views.forEach(v => {
    const key = v.created_at.split('T')[0]
    const s = dayMap.get(key)
    if (s) { s.views++; s.sessions.add(v.session_id) }
  })
  const days = Array.from(dayMap.values())
  const maxViews = Math.max(...days.map(d => d.views), 1)

  // Top pages
  const pageMap = new Map<string, number>()
  views.forEach(v => pageMap.set(v.path, (pageMap.get(v.path) ?? 0) + 1))
  const topPages = Array.from(pageMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)

  // Top referrers
  const refMap = new Map<string, number>()
  views.forEach(v => {
    if (!v.referrer) return
    try {
      const host = new URL(v.referrer).hostname.replace('www.', '')
      refMap.set(host, (refMap.get(host) ?? 0) + 1)
    } catch {}
  })
  const topRefs = Array.from(refMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6)

  return (
    <div style={{ padding: '2rem' }}>
      {isDemo && (
        <div style={{ background: '#2d2500', border: '1px solid #5c4800', borderRadius: '.25rem', padding: '.5rem 1rem', marginBottom: '1.5rem', display: 'inline-flex', gap: '.75rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase' }}>Demo</span>
          <span style={{ color: '#7a6500', fontSize: '.75rem' }}>Showing generated sample data.</span>
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1px', background: 'var(--surface-2)', marginBottom: '2rem' }}>
        {[
          ['Today',           today.length,                   new Set(today.map(v => v.session_id)).size],
          ['This Week',       thisWeek.length,                weekSessions.size],
          ['Last 30 Days',    views.length,                   allSessions.size],
        ].map(([label, views, sessions]) => (
          <div key={String(label)} style={{ background: 'var(--bg)', padding: '1.5rem' }}>
            <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.5rem' }}>{label as string}</p>
            <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '2rem', lineHeight: 1 }}>{(views as number).toLocaleString()}</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.7rem', marginTop: '.25rem' }}>{(sessions as number).toLocaleString()} unique sessions</p>
          </div>
        ))}
      </div>

      {/* 30-day bar chart */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', marginBottom: '2rem' }}>
        <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '1rem' }}>30-Day Pageviews</p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2 }}>
          {days.map(d => (
            <Bar key={d.date} height={d.views / maxViews} label={d.date.slice(5)} value={d.views} />
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Top pages */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem' }}>
          <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '1rem' }}>Top Pages</p>
          {topPages.length === 0 ? (
            <p style={{ color: 'var(--text-4)', fontSize: '.8rem' }}>No data yet.</p>
          ) : topPages.map(([page, count]) => (
            <div key={page} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.6rem 0', borderBottom: '1px solid var(--surface-2)' }}>
              <span style={{ color: 'var(--text-2)', fontSize: '.8rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{page}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                <div style={{ width: 60, height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${(count / (topPages[0][1] as number)) * 100}%`, height: '100%', background: '#272C84', borderRadius: 2 }} />
                </div>
                <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.75rem', minWidth: 24, textAlign: 'right' }}>{count as number}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Top referrers */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem' }}>
          <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '1rem' }}>Top Referrers</p>
          {topRefs.length === 0 ? (
            <p style={{ color: 'var(--text-4)', fontSize: '.8rem' }}>No referrer data yet — most traffic is direct.</p>
          ) : topRefs.map(([ref, count]) => (
            <div key={ref} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.6rem 0', borderBottom: '1px solid var(--surface-2)' }}>
              <span style={{ color: 'var(--text-2)', fontSize: '.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{ref}</span>
              <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.75rem' }}>{count as number}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
