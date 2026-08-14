import { useState, useEffect, useCallback } from 'react'
import './insights.css'
import DemoBanner from '../../components/dashboard/DemoBanner'
import ReportView from '../../components/insights/ReportView'
import { supabaseConfigured } from '../../lib/supabase'
import {
  type ReportConfig, type MetricKey, type Bucket, type ChartKind, type SavedReport,
  METRICS, metricMeta,
  listSavedReports, createSavedReport, updateSavedReport, deleteSavedReport,
} from '../../lib/insights'

/**
 * Custom Reports — pick a metric, a range, and a chart; preview it live; save
 * the definition to `saved_reports` (yours, optionally shared with staff) and
 * load it back later. The saved row is a definition, never SQL — the preview is
 * produced by the same gated reporting functions the standard reports use.
 */

const RANGE_OPTIONS = [7, 30, 90, 180] as const
const BUCKET_OPTIONS: Bucket[] = ['day', 'week', 'month']
const CHART_LABEL: Record<ChartKind, string> = {
  bar: 'Bars', line: 'Line', stackedBar: 'Stacked bars', donut: 'Donut', funnel: 'Funnel',
}
// Metrics whose shape is not a time series ignore the bucket entirely.
const BUCKETLESS: MetricKey[] = ['funnel', 'leads', 'coach_hours']

const labelStyle: React.CSSProperties = {
  color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em',
  textTransform: 'uppercase', marginBottom: '.35rem', display: 'block',
}

export default function CustomReportsPanel({ isDemo = false, embedded = false }: { isDemo?: boolean; embedded?: boolean }) {
  const preview = isDemo || !supabaseConfigured

  const [metric, setMetric] = useState<MetricKey>('bookings')
  const [rangeDays, setRangeDays] = useState<number>(30)
  const [bucket, setBucket] = useState<Bucket>('day')
  const [chart, setChart] = useState<ChartKind>('stackedBar')
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [loadedId, setLoadedId] = useState<string | null>(null)

  const [saved, setSaved] = useState<SavedReport[]>([])
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const allowedCharts = metricMeta(metric).charts

  const refresh = useCallback(async () => {
    setSaved(await listSavedReports(isDemo))
  }, [isDemo])

  useEffect(() => { refresh() }, [refresh])

  // Keep chart valid when the metric changes.
  useEffect(() => {
    if (!allowedCharts.includes(chart)) setChart(allowedCharts[0])
  }, [metric]) // eslint-disable-line react-hooks/exhaustive-deps

  const config: ReportConfig = { metric, rangeDays, bucket, chart }

  function loadInto(r: SavedReport) {
    setMetric(r.config.metric)
    setRangeDays(r.config.rangeDays)
    setBucket(r.config.bucket)
    setChart(r.config.chart)
    setName(r.name)
    setShared(r.is_shared)
    setLoadedId(r.id)
    setFlash(`Loaded “${r.name}”`)
  }

  function resetForm() {
    setLoadedId(null); setName(''); setShared(false)
    setFlash(null)
  }

  async function saveNew() {
    if (!name.trim()) { setFlash('Give the report a name first.'); return }
    setBusy(true)
    const row = await createSavedReport({ name: name.trim(), config, is_shared: shared }, isDemo)
    setBusy(false)
    if (row) { setLoadedId(row.id); setFlash(`Saved “${row.name}”`); refresh() }
    else setFlash('Could not save the report.')
  }

  async function saveUpdate() {
    if (!loadedId) return
    setBusy(true)
    const ok = await updateSavedReport(loadedId, { name: name.trim(), config, is_shared: shared }, isDemo)
    setBusy(false)
    setFlash(ok ? 'Report updated.' : 'Could not update the report.')
    if (ok) refresh()
  }

  async function remove(id: string) {
    setBusy(true)
    await deleteSavedReport(id, isDemo)
    setBusy(false)
    if (loadedId === id) resetForm()
    refresh()
  }

  const body = (
    <div>
      {preview && <DemoBanner note="Saved reports are kept only in this preview." />}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Builder */}
        <div className="ins-card" style={{ margin: 0 }}>
          <p className="ins-card-title">Build a report</p>

          <label style={labelStyle} htmlFor="cr-metric">Metric</label>
          <select id="cr-metric" className="field" value={metric} onChange={e => setMetric(e.target.value as MetricKey)} style={{ marginBottom: '1rem' }}>
            {METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <p style={{ color: 'var(--text-3)', fontSize: '.72rem', lineHeight: 1.5, marginTop: '-.5rem', marginBottom: '1rem' }}>{metricMeta(metric).description}</p>

          <label style={labelStyle} htmlFor="cr-range">Date range</label>
          <select id="cr-range" className="field" value={rangeDays} onChange={e => setRangeDays(Number(e.target.value))} style={{ marginBottom: '1rem' }}>
            {RANGE_OPTIONS.map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>

          <label style={labelStyle} htmlFor="cr-bucket">Group by</label>
          <select id="cr-bucket" className="field" value={bucket} disabled={BUCKETLESS.includes(metric)}
                  onChange={e => setBucket(e.target.value as Bucket)} style={{ marginBottom: BUCKETLESS.includes(metric) ? '.35rem' : '1rem', opacity: BUCKETLESS.includes(metric) ? 0.5 : 1 }}>
            {BUCKET_OPTIONS.map(b => <option key={b} value={b}>{b[0].toUpperCase() + b.slice(1)}</option>)}
          </select>
          {BUCKETLESS.includes(metric) && <p style={{ color: 'var(--text-4)', fontSize: '.65rem', marginBottom: '1rem' }}>This metric isn’t a time series.</p>}

          <label style={labelStyle} htmlFor="cr-chart">Chart</label>
          <select id="cr-chart" className="field" value={chart} onChange={e => setChart(e.target.value as ChartKind)} style={{ marginBottom: '1.25rem' }}>
            {allowedCharts.map(c => <option key={c} value={c}>{CHART_LABEL[c]}</option>)}
          </select>

          <div style={{ borderTop: '1px solid var(--surface-2)', paddingTop: '1rem' }}>
            <label style={labelStyle} htmlFor="cr-name">Report name</label>
            <input id="cr-name" className="field" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Bookings, last 30 days" maxLength={120} style={{ marginBottom: '.75rem' }} />

            <label className="pill-label" data-active={shared} style={{ marginBottom: '1rem', ...(shared ? { borderColor: 'var(--gold)', color: 'var(--text)', background: 'var(--viz-accent-soft)' } : {}) }}>
              <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} />
              Share with staff
            </label>

            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              <button className="scale-btn" onClick={saveNew} disabled={busy}
                      style={{ width: 'auto', padding: '0 1rem', borderColor: 'var(--gold)', color: 'var(--text)', background: 'var(--viz-accent-soft)' }}>
                Save report
              </button>
              {loadedId && (
                <button className="scale-btn" onClick={saveUpdate} disabled={busy} style={{ width: 'auto', padding: '0 1rem' }}>Update</button>
              )}
              {loadedId && (
                <button className="scale-btn" onClick={resetForm} disabled={busy} style={{ width: 'auto', padding: '0 1rem' }}>New</button>
              )}
            </div>
            {flash && <p style={{ color: 'var(--text-3)', fontSize: '.72rem', marginTop: '.6rem' }}>{flash}</p>}
          </div>
        </div>

        {/* Live preview */}
        <div className="ins-card" style={{ margin: 0 }}>
          <ReportView isDemo={isDemo} config={config} title={`Preview · ${metricMeta(metric).label}`} />
        </div>
      </div>

      {/* Saved reports */}
      <div className="ins-card" style={{ marginTop: '1.5rem' }}>
        <p className="ins-card-title">Saved reports</p>
        {saved.length === 0 ? (
          <p className="ins-empty">No saved reports yet. Build one above and hit Save.</p>
        ) : (
          <div>
            {saved.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.6rem 0', borderBottom: '1px solid var(--surface-2)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text)', fontSize: '.82rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.name}
                    {r.is_shared && <span style={{ marginLeft: '.5rem', color: 'var(--viz-good)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase' }}>Shared</span>}
                  </div>
                  <div style={{ color: 'var(--text-3)', fontSize: '.68rem' }}>
                    {metricMeta(r.config.metric).label} · last {r.config.rangeDays} days · {CHART_LABEL[r.config.chart] ?? r.config.chart}
                  </div>
                </div>
                <button className="scale-btn" onClick={() => loadInto(r)} style={{ width: 'auto', padding: '0 .8rem', height: '2rem', fontSize: '.7rem' }}>Load</button>
                <button className="scale-btn" onClick={() => remove(r.id)} disabled={busy}
                        style={{ width: 'auto', padding: '0 .8rem', height: '2rem', fontSize: '.7rem', color: 'var(--viz-bad)' }} aria-label={`Delete ${r.name}`}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  if (embedded) return body
  return <div className="insights-root" style={{ padding: '2rem' }}>{body}</div>
}
