import { useEffect, useState } from 'react'
import './insights.css'
import DemoBanner from '../../components/dashboard/DemoBanner'
import ReportView from '../../components/insights/ReportView'
import CustomReportsPanel from './CustomReportsPanel'
import AnalyticsPanel from './AnalyticsPanel'
import MarketingInsights from './MarketingInsights'
import AnnouncementsPanel from './AnnouncementsPanel'
import { supabaseConfigured } from '../../lib/supabase'
import { usePermissions } from '../../lib/usePermissions'
import { useHashSubTab } from '../../lib/useHashSubTab'
import type { Bucket, MetricKey, ChartKind } from '../../lib/insights'

/**
 * Insights — the reporting home, and now every surface that answers "how are we
 * doing". A sub-tab strip switches between the standard Reports overview (this
 * file), site Analytics, the Custom Reports builder, Marketing reach, and the
 * Announcements banner. The integrator wires a single "Insights" nav item to
 * this panel; the sub-tabs live here.
 */

type Sub = 'reports' | 'analytics' | 'custom' | 'marketing' | 'announcements'

const SUB_TABS: readonly { key: Sub; label: string }[] = [
  { key: 'reports',       label: 'Reports' },
  { key: 'analytics',     label: 'Analytics' },
  { key: 'custom',        label: 'Custom Reports' },
  { key: 'marketing',     label: 'Marketing' },
  { key: 'announcements', label: 'Announcements' },
]

// Module-level so the hash hook does not rebuild its listener every render.
const SUB_KEYS: readonly Sub[] = SUB_TABS.map(t => t.key)

/**
 * Which key opens which sub-tab. ANY of them is enough.
 *
 * The three report surfaces share `view_analytics` because they share the gate
 * that actually enforces it: `reports_can_view()` (027) is one function in
 * front of all six report RPCs, and 040 deliberately did NOT widen it, because
 * one of those six is every coach's worked hours. So an area reader lands on
 * Marketing or Announcements and never on a Reports tab that would raise 42501
 * behind every card.
 */
const SUB_PERMS: Record<Sub, readonly string[]> = {
  reports:       ['view_analytics'],
  analytics:     ['view_analytics'],
  custom:        ['view_analytics'],
  marketing:     ['view_marketing', 'send_marketing'],
  announcements: ['manage_announcements'],
}

// AnalyticsPanel, MarketingInsights and AnnouncementsPanel all lay themselves
// out for a bare tab slot with their own 2rem gutter, which would land 4rem in
// on top of this panel's padding. The negative margin cancels the outer inset
// for those subtrees so they sit on the same gridline as the Reports view. The
// top only cancels the strip's 1.5rem, never more, so the wrapper cannot creep
// up over the tab buttons and swallow their clicks.
const UNPAD: React.CSSProperties = { margin: '-1.5rem -2rem -2rem' }

const RANGE_PRESETS = [7, 30, 90] as const

// The standard report set, in reading order. `chart` is each metric's most
// legible default; bucket is derived from the chosen range below.
const STANDARD: { metric: MetricKey; chart: ChartKind; wide?: boolean }[] = [
  { metric: 'bookings',         chart: 'stackedBar', wide: true },
  { metric: 'funnel',           chart: 'funnel' },
  { metric: 'leads',            chart: 'donut' },
  { metric: 'revenue',          chart: 'bar' },
  { metric: 'coach_hours',      chart: 'bar' },
  { metric: 'form_submissions', chart: 'bar' },
]

function bucketFor(days: number): Bucket {
  return days > 45 ? 'week' : 'day'
}

function SubTabs({ sub, tabs, onChange }: { sub: Sub; tabs: readonly { key: Sub; label: string }[]; onChange: (s: Sub) => void }) {
  return (
    <div className="ins-tabs" role="tablist" aria-label="Insights sections">
      {tabs.map(({ key, label }) => (
        <button key={key} role="tab" aria-selected={sub === key} className="ins-subtab" data-active={sub === key} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Reports({ isDemo }: { isDemo: boolean }) {
  const [rangeDays, setRangeDays] = useState<number>(30)
  const preview = isDemo || !supabaseConfigured
  const bucket = bucketFor(rangeDays)

  return (
    <div>
      {preview && <DemoBanner note="Reports read live from the database once connected." />}

      <div className="ins-controls" role="group" aria-label="Date range">
        <span style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', alignSelf: 'center' }}>Range</span>
        {RANGE_PRESETS.map(d => (
          <button key={d} className="pill-label" data-active={rangeDays === d} onClick={() => setRangeDays(d)}
                  style={rangeDays === d ? { borderColor: 'var(--gold)', color: 'var(--text)', background: 'var(--viz-accent-soft)' } : undefined}>
            {d} days
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {STANDARD.map(s => (
          <div key={s.metric} className="ins-card" style={{ margin: 0, gridColumn: s.wide ? '1 / -1' : undefined }}>
            <ReportView isDemo={isDemo} config={{ metric: s.metric, chart: s.chart, rangeDays, bucket }} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function InsightsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const { can } = usePermissions()
  const fullAccess = isDemo || can('*')
  const allow = (s: Sub) => fullAccess || SUB_PERMS[s].some(k => can(k))

  const available = SUB_TABS.filter(t => allow(t.key))

  // insights-root is required here: it defines the --viz-* chart variables.
  // The hook still validates against the FULL key list, because a hash is a
  // bookmark and what a person may open is decided separately, below.
  const [sub, setSub] = useHashSubTab(SUB_KEYS, 'reports')

  // 'reports' is the default and needs view_analytics, so it is the wrong
  // landing for anybody let in on a single area key.
  useEffect(() => {
    if (available.length > 0 && !available.some(t => t.key === sub)) setSub(available[0].key)
  }, [available, sub, setSub])

  if (available.length === 0) {
    return (
      <div className="insights-root" style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>
        You do not have access to any insights view.
      </div>
    )
  }

  return (
    <div className="insights-root" style={{ padding: '2rem' }}>
      <SubTabs sub={sub} tabs={available} onChange={setSub} />
      {sub === 'reports'       && allow('reports')       && <Reports isDemo={isDemo} />}
      {sub === 'analytics'     && allow('analytics')     && <div style={UNPAD}><AnalyticsPanel isDemo={isDemo} /></div>}
      {sub === 'custom'        && allow('custom')        && <CustomReportsPanel isDemo={isDemo} embedded />}
      {sub === 'marketing'     && allow('marketing')     && <div style={UNPAD}><MarketingInsights isDemo={isDemo} /></div>}
      {sub === 'announcements' && allow('announcements') && <div style={UNPAD}><AnnouncementsPanel isDemo={isDemo} /></div>}
    </div>
  )
}
