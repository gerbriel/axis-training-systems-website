import { useState, useEffect } from 'react'
import {
  type ReportConfig, type ChartKind,
  METRICS, metricMeta, rangeFor,
  BOOKING_STATUS_META, BOOKING_STATUS_ORDER, LEAD_STATUS_META, CATEGORICAL_VARS,
  bucketLabel, formatMoney, formatHours,
  fetchBookings, fetchFunnel, fetchLeads, fetchRevenue, fetchCoachHours, fetchSubmissions,
} from '../../lib/insights'
import { StackedBars, VBars, LineSeries, Funnel, Donut, HBars, type Bar, type HBar } from './Charts'

/**
 * One metric, fetched and drawn according to a ReportConfig. Both the standard
 * Reports overview and the Custom Reports preview are just ReportViews with
 * different configs, so the chart-selection logic lives here once.
 */

function rangeText(days: number): string {
  if (days === 1) return 'Today'
  return `Last ${days} days`
}

function chartFor(config: ReportConfig): ChartKind {
  const allowed = metricMeta(config.metric).charts
  return allowed.includes(config.chart) ? config.chart : allowed[0]
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.6rem', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub ? <span style={{ color: 'var(--text-3)', fontSize: '.72rem', marginLeft: '.5rem' }}>{sub}</span> : null}
      <div style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '.25rem' }}>{label}</div>
    </div>
  )
}

function Unavailable({ label }: { label: string }) {
  return (
    <div style={{ padding: '1.5rem', border: '1px dashed var(--surface-2)', borderRadius: '.25rem', color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.6 }}>
      <strong style={{ color: 'var(--text-2)' }}>{label} isn’t available yet.</strong><br />
      This report draws on a sibling module that hasn’t been set up in this workspace. It will populate automatically once that data exists.
    </div>
  )
}

export default function ReportView({ config, isDemo = false, title }: { config: ReportConfig; isDemo?: boolean; title?: string }) {
  const [loading, setLoading] = useState(true)
  const [node, setNode] = useState<React.ReactNode>(null)
  const [tile, setTile] = useState<React.ReactNode>(null)

  const kind = chartFor(config)
  const metric = config.metric
  const bucket = config.bucket

  useEffect(() => {
    let live = true
    setLoading(true)
    const range = rangeFor(config.rangeDays)

    async function run() {
      if (metric === 'bookings') {
        const d = await fetchBookings(range, bucket, isDemo)
        if (!live) return
        setTile(<Tile label="Bookings created" value={d.total.toLocaleString()} sub={rangeText(config.rangeDays)} />)
        const points = d.points.map(p => ({ key: p.key, label: bucketLabel(p.key, bucket), byStatus: p.byStatus, total: p.total }))
        if (kind === 'stackedBar') {
          setNode(<StackedBars points={points} order={BOOKING_STATUS_ORDER} meta={BOOKING_STATUS_META} />)
        } else {
          const bars: Bar[] = points.map(p => ({ key: p.key, label: p.label, value: p.total }))
          setNode(kind === 'line'
            ? <LineSeries points={bars} ariaLabel="Bookings per bucket" srCaption="Bookings per bucket" valueName="Bookings" />
            : <VBars bars={bars} ariaLabel="Bookings per bucket" srCaption="Bookings per bucket" valueName="Bookings" />)
        }
      } else if (metric === 'funnel') {
        const d = await fetchFunnel(range, isDemo)
        if (!live) return
        const conv = d.steps.length ? Math.round((d.steps[d.steps.length - 1].sessions / (d.top || 1)) * 100) : 0
        setTile(<Tile label="Open → booked" value={`${conv}%`} sub={`${d.top.toLocaleString()} opened`} />)
        if (kind === 'bar') {
          const bars: Bar[] = d.steps.map(s => ({ key: s.step, label: s.label, value: s.sessions }))
          setNode(<VBars bars={bars} ariaLabel="Booking funnel" srCaption="Booking funnel" valueName="Sessions" />)
        } else {
          setNode(<Funnel steps={d.steps} />)
        }
      } else if (metric === 'leads') {
        const d = await fetchLeads(range, isDemo)
        if (!live) return
        setTile(<Tile label="Applications" value={d.total.toLocaleString()} sub={rangeText(config.rangeDays)} />)
        if (kind === 'bar') {
          const rows: HBar[] = d.rows.map(r => ({ key: r.status, label: r.label, value: r.count, display: r.count.toLocaleString(), varName: LEAD_STATUS_META[r.status]?.varName ?? '--viz-neutral' }))
          setNode(<HBars rows={rows} ariaLabel="Applications by status" srCaption="Applications by status" valueName="Count" />)
        } else {
          setNode(<Donut slices={d.rows.map(r => ({ label: r.label, value: r.count, varName: LEAD_STATUS_META[r.status]?.varName ?? '--viz-neutral' }))} centerLabel="Applications" />)
        }
      } else if (metric === 'revenue') {
        const d = await fetchRevenue(range, bucket, isDemo)
        if (!live) return
        if (!d.available) { setTile(null); setNode(<Unavailable label="Revenue" />); setLoading(false); return }
        setTile(<Tile label="Revenue" value={formatMoney(d.totalCents)} sub={`${d.totalOrders.toLocaleString()} orders`} />)
        const bars: Bar[] = d.points.map(p => ({ key: p.key, label: bucketLabel(p.key, bucket), value: p.revenueCents, display: formatMoney(p.revenueCents) }))
        setNode(kind === 'line'
          ? <LineSeries points={bars} ariaLabel="Revenue over time" srCaption="Revenue over time" valueName="Revenue" format={formatMoney} />
          : <VBars bars={bars} ariaLabel="Revenue over time" srCaption="Revenue over time" valueName="Revenue" />)
      } else if (metric === 'coach_hours') {
        const d = await fetchCoachHours(range, isDemo)
        if (!live) return
        if (!d.available) { setTile(null); setNode(<Unavailable label="Coach hours" />); setLoading(false); return }
        setTile(<Tile label="Total hours" value={formatHours(d.totalMinutes)} sub={`${d.rows.length} coaches`} />)
        // Cap at 6 distinct series; fold the tail into a neutral "Other".
        let rows: HBar[]
        if (d.rows.length > 6) {
          const head = d.rows.slice(0, 5)
          const tail = d.rows.slice(5)
          const otherMin = tail.reduce((a, r) => a + r.minutes, 0)
          rows = [
            ...head.map((r, i) => ({ key: r.coachSlug, label: r.coachName, value: r.minutes, display: formatHours(r.minutes), varName: CATEGORICAL_VARS[i] })),
            { key: 'other', label: `Other (${tail.length})`, value: otherMin, display: formatHours(otherMin), varName: '--viz-neutral' },
          ]
        } else {
          rows = d.rows.map((r, i) => ({ key: r.coachSlug, label: r.coachName, value: r.minutes, display: formatHours(r.minutes), varName: CATEGORICAL_VARS[i] }))
        }
        setNode(<HBars rows={rows} ariaLabel="Hours logged per coach" srCaption="Hours logged per coach" valueName="Hours" />)
      } else {
        const d = await fetchSubmissions(range, bucket, isDemo)
        if (!live) return
        if (!d.available) { setTile(null); setNode(<Unavailable label="Form submissions" />); setLoading(false); return }
        setTile(<Tile label="Submissions" value={d.total.toLocaleString()} sub={rangeText(config.rangeDays)} />)
        const bars: Bar[] = d.points.map(p => ({ key: p.key, label: bucketLabel(p.key, bucket), value: p.submissions }))
        setNode(kind === 'line'
          ? <LineSeries points={bars} ariaLabel="Form submissions over time" srCaption="Form submissions over time" valueName="Submissions" />
          : <VBars bars={bars} ariaLabel="Form submissions over time" srCaption="Form submissions over time" valueName="Submissions" />)
      }
      setLoading(false)
    }

    run()
    return () => { live = false }
  }, [metric, kind, bucket, config.rangeDays, isDemo])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem' }}>
        <p className="ins-card-title" style={{ marginBottom: 0 }}>{title ?? metricMeta(metric).label}</p>
        <span style={{ color: 'var(--text-4)', fontSize: '.6rem', letterSpacing: '.1em', textTransform: 'uppercase' }}>{rangeText(config.rangeDays)}</span>
      </div>
      {loading
        ? <div style={{ padding: '2rem 0', color: 'var(--text-4)', fontSize: '.8rem' }}>Loading…</div>
        : <>{tile}{node}</>}
    </div>
  )
}

export { METRICS }
