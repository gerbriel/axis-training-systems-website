import { useState } from 'react'
import './insights.css'
import DemoBanner from '../../components/dashboard/DemoBanner'
import ReportView from '../../components/insights/ReportView'
import CustomReportsPanel from './CustomReportsPanel'
import { supabaseConfigured } from '../../lib/supabase'
import type { Bucket, MetricKey, ChartKind } from '../../lib/insights'

/**
 * Insights — the reporting home. A sub-tab strip switches between the standard
 * Reports overview (this file) and the Custom Reports builder. The integrator
 * wires a single "Insights" nav item to this panel; the sub-tabs live here.
 */

type Sub = 'reports' | 'custom'

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

function SubTabs({ sub, onChange }: { sub: Sub; onChange: (s: Sub) => void }) {
  return (
    <div className="ins-tabs" role="tablist" aria-label="Insights sections">
      {([['reports', 'Reports'], ['custom', 'Custom Reports']] as [Sub, string][]).map(([key, label]) => (
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
  const [sub, setSub] = useState<Sub>('reports')

  return (
    <div className="insights-root" style={{ padding: '2rem' }}>
      <SubTabs sub={sub} onChange={setSub} />
      {sub === 'reports' ? <Reports isDemo={isDemo} /> : <CustomReportsPanel isDemo={isDemo} embedded />}
    </div>
  )
}
