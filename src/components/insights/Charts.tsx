import { useId } from 'react'

/**
 * Hand-rolled, dependency-free charts for the Insights vertical.
 *
 * Rules held across all of them (see the dataviz skill):
 *   • Colour comes from the `--viz-*` CSS variables (insights.css), never a raw
 *     hex per series, so light/dark swap in one place.
 *   • Identity is never colour-alone: every chart ships a legend or direct
 *     labels, plus a visually-hidden data table for assistive tech.
 *   • Marks are thin with rounded data-ends, a 2px surface gap between stacked
 *     fills, recessive grid/axis in muted ink.
 */

// ── Shared bits ──────────────────────────────────────────────────────────────

function SrTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>{columns.map(c => <th key={c} scope="col">{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}</tr>
        ))}
      </tbody>
    </table>
  )
}

export function Legend({ items }: { items: { label: string; varName: string; note?: string }[] }) {
  return (
    <div className="ins-legend">
      {items.map(it => (
        <span key={it.label} className="ins-legend-item">
          <span className="ins-swatch" style={{ background: `var(${it.varName})` }} />
          {it.label}{it.note ? <span style={{ color: 'var(--text-3)' }}> · {it.note}</span> : null}
        </span>
      ))}
    </div>
  )
}

/** Thin an x-axis label list to ~`max` evenly spaced entries. */
function labelStride(n: number, max = 8): number {
  return Math.max(1, Math.ceil(n / max))
}

const AXIS_LABEL: React.CSSProperties = {
  color: 'var(--text-4)', fontSize: '.5rem', textAlign: 'center', lineHeight: 1,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}

// ── Stacked bars (bookings over time, by status) ─────────────────────────────

export interface StackPoint { key: string; label: string; byStatus: Record<string, number>; total: number }

export function StackedBars({
  points, order, meta, height = 150,
}: {
  points: StackPoint[]
  order: string[]
  meta: Record<string, { label: string; varName: string }>
  height?: number
}) {
  const max = Math.max(...points.map(p => p.total), 1)
  const stride = labelStride(points.length)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, borderBottom: '1px solid var(--viz-axis)' }} role="img"
           aria-label={`Bookings over time by status. Peak ${max} in one bucket.`}>
        {points.map((p, i) => (
          <div key={p.key} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 2 }}
               title={`${p.label}: ${p.total} booking${p.total === 1 ? '' : 's'}\n` + order.filter(s => p.byStatus[s]).map(s => `  ${meta[s]?.label ?? s}: ${p.byStatus[s]}`).join('\n')}>
            {order.map(s => {
              const v = p.byStatus[s] ?? 0
              if (!v) return null
              return (
                <div key={s} style={{
                  height: `${(v / max) * 100}%`,
                  background: `var(${meta[s]?.varName})`,
                  borderRadius: 2,
                  minHeight: 2,
                }} />
              )
            })}
            {p.total === 0 && <div style={{ height: 2, background: 'var(--viz-track)', borderRadius: 2 }} />}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 2, marginTop: '.4rem' }}>
        {points.map((p, i) => (
          <span key={p.key} style={{ ...AXIS_LABEL, flex: 1, minWidth: 0 }}>{i % stride === 0 ? p.label : ''}</span>
        ))}
      </div>
      <Legend items={order.map(s => ({ label: meta[s]?.label ?? s, varName: meta[s]?.varName ?? '--viz-neutral' }))} />
      <SrTable
        caption="Bookings by bucket and status"
        columns={['Bucket', ...order.map(s => meta[s]?.label ?? s), 'Total']}
        rows={points.map(p => [p.label, ...order.map(s => p.byStatus[s] ?? 0), p.total])}
      />
    </div>
  )
}

// ── Single-series vertical bars (revenue, submissions) ───────────────────────

export interface Bar { key: string; label: string; value: number; display?: string }

export function VBars({
  bars, colorVar = '--viz-accent', height = 150, ariaLabel, srCaption, valueName = 'Value',
}: {
  bars: Bar[]
  colorVar?: string
  height?: number
  ariaLabel: string
  srCaption: string
  valueName?: string
}) {
  const max = Math.max(...bars.map(b => b.value), 1)
  const stride = labelStride(bars.length)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height, borderBottom: '1px solid var(--viz-axis)' }} role="img" aria-label={ariaLabel}>
        {bars.map(b => (
          <div key={b.key} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end', height: '100%' }}
               title={`${b.label}: ${b.display ?? b.value}`}>
            <div style={{
              width: '100%',
              height: `${(b.value / max) * 100}%`,
              background: `var(${colorVar})`,
              borderRadius: '2px 2px 0 0',
              minHeight: b.value > 0 ? 2 : 0,
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 3, marginTop: '.4rem' }}>
        {bars.map((b, i) => (
          <span key={b.key} style={{ ...AXIS_LABEL, flex: 1, minWidth: 0 }}>{i % stride === 0 ? b.label : ''}</span>
        ))}
      </div>
      <SrTable caption={srCaption} columns={['Bucket', valueName]} rows={bars.map(b => [b.label, b.display ?? b.value])} />
    </div>
  )
}

// ── Single-series line (revenue, submissions alt) ────────────────────────────

export function LineSeries({
  points, colorVar = '--viz-accent', height = 150, ariaLabel, srCaption, valueName = 'Value', format,
}: {
  points: Bar[]
  colorVar?: string
  height?: number
  ariaLabel: string
  srCaption: string
  valueName?: string
  format?: (v: number) => string
}) {
  const gid = useId().replace(/:/g, '')
  const w = 100, h = 40
  const max = Math.max(...points.map(p => p.value), 1)
  const stride = labelStride(points.length)
  const stepX = points.length > 1 ? w / (points.length - 1) : 0
  const coords = points.map((p, i) => ({ x: i * stepX, y: h - (p.value / max) * h, p }))
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ')
  const area = coords.length ? `${line} L${w},${h} L0,${h} Z` : ''

  return (
    <div>
      <div style={{ height, position: 'relative' }} role="img" aria-label={ariaLabel}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
          <defs>
            <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: `var(${colorVar})`, stopOpacity: 0.22 }} />
              <stop offset="100%" style={{ stopColor: `var(${colorVar})`, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {area && <path d={area} style={{ fill: `url(#fill-${gid})` }} />}
          <path d={line} style={{ fill: 'none', stroke: `var(${colorVar})`, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' } as React.CSSProperties} />
          {coords.map((c) => (
            <circle key={c.p.key} cx={c.x} cy={c.y} r={1.6} style={{ fill: `var(${colorVar})` }} vectorEffect="non-scaling-stroke">
              <title>{`${c.p.label}: ${format ? format(c.p.value) : c.p.value}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <div style={{ display: 'flex', gap: 0, marginTop: '.4rem' }}>
        {points.map((p, i) => (
          <span key={p.key} style={{ ...AXIS_LABEL, flex: 1, minWidth: 0 }}>{i % stride === 0 ? p.label : ''}</span>
        ))}
      </div>
      <SrTable caption={srCaption} columns={['Bucket', valueName]} rows={points.map(p => [p.label, format ? format(p.value) : p.value])} />
    </div>
  )
}

// ── Funnel (decreasing horizontal bars) ──────────────────────────────────────

export interface FunnelStep { step: string; label: string; sessions: number; rate: number }

export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const top = steps[0]?.sessions || 1
  return (
    <div role="img" aria-label="Booking funnel from opened to booked">
      {steps.map((s, i) => {
        const prev = i === 0 ? s.sessions : steps[i - 1].sessions
        const stepDrop = prev > 0 ? Math.round((1 - s.sessions / prev) * 100) : 0
        return (
          <div key={s.step} style={{ marginBottom: '.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '.3rem' }}>
              <span style={{ color: 'var(--text-2)', fontSize: '.78rem', fontWeight: 600 }}>{i + 1}. {s.label}</span>
              <span style={{ color: 'var(--text)', fontSize: '.78rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {s.sessions.toLocaleString()}
                <span style={{ color: 'var(--text-3)', fontWeight: 500 }}> · {Math.round(s.rate * 100)}%</span>
              </span>
            </div>
            <div style={{ height: 12, background: 'var(--viz-track)', borderRadius: 3, overflow: 'hidden' }}
                 title={`${s.label}: ${s.sessions} sessions (${Math.round(s.rate * 100)}% of top${i > 0 ? `, ${stepDrop}% drop from previous` : ''})`}>
              <div style={{ width: `${Math.max((s.sessions / top) * 100, 1)}%`, height: '100%', background: 'var(--viz-accent)', borderRadius: 3 }} />
            </div>
          </div>
        )
      })}
      <SrTable caption="Booking funnel" columns={['Step', 'Sessions', '% of top']}
               rows={steps.map(s => [s.label, s.sessions, `${Math.round(s.rate * 100)}%`])} />
    </div>
  )
}

// ── Donut (applications by status) ───────────────────────────────────────────

export interface Slice { label: string; value: number; varName: string }

export function Donut({ slices, centerLabel }: { slices: Slice[]; centerLabel?: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0)
  const size = 132, stroke = 20, r = (size - stroke) / 2, c = 2 * Math.PI * r
  let offset = 0

  return (
    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }} role="img" aria-label={`Applications by status, ${total} total`}>
        <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--viz-track)' }} strokeWidth={stroke} />
          {total > 0 && slices.filter(s => s.value > 0).map(s => {
            const frac = s.value / total
            const dash = frac * c
            const el = (
              <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none"
                      style={{ stroke: `var(${s.varName})` }} strokeWidth={stroke}
                      strokeDasharray={`${Math.max(dash - 2, 0)} ${c - Math.max(dash - 2, 0)}`}
                      strokeDashoffset={-offset}>
                <title>{`${s.label}: ${s.value} (${Math.round(frac * 100)}%)`}</title>
              </circle>
            )
            offset += dash
            return el
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.4rem', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{total.toLocaleString()}</span>
          <span style={{ color: 'var(--text-3)', fontSize: '.55rem', letterSpacing: '.1em', textTransform: 'uppercase' }}>{centerLabel ?? 'Total'}</span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        {slices.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.35rem 0', borderBottom: '1px solid var(--surface-2)' }}>
            <span className="ins-swatch" style={{ background: `var(${s.varName})` }} />
            <span style={{ color: 'var(--text-2)', fontSize: '.78rem', flex: 1 }}>{s.label}</span>
            <span style={{ color: 'var(--text)', fontSize: '.78rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.value.toLocaleString()}</span>
            <span style={{ color: 'var(--text-3)', fontSize: '.7rem', minWidth: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
      <SrTable caption="Applications by status" columns={['Status', 'Count', 'Share']}
               rows={slices.map(s => [s.label, s.value, `${total > 0 ? Math.round((s.value / total) * 100) : 0}%`])} />
    </div>
  )
}

// ── Horizontal bars (coach hours; ranked categorical) ────────────────────────

export interface HBar { key: string; label: string; value: number; display: string; varName: string }

export function HBars({ rows, ariaLabel, srCaption, valueName }: { rows: HBar[]; ariaLabel: string; srCaption: string; valueName: string }) {
  const max = Math.max(...rows.map(r => r.value), 1)
  return (
    <div role="img" aria-label={ariaLabel}>
      {rows.map(r => (
        <div key={r.key} style={{ marginBottom: '.6rem' }} title={`${r.label}: ${r.display}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.25rem' }}>
            <span style={{ color: 'var(--text-2)', fontSize: '.78rem' }}>{r.label}</span>
            <span style={{ color: 'var(--text)', fontSize: '.78rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{r.display}</span>
          </div>
          <div style={{ height: 10, background: 'var(--viz-track)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.max((r.value / max) * 100, 1)}%`, height: '100%', background: `var(${r.varName})`, borderRadius: 3 }} />
          </div>
        </div>
      ))}
      <SrTable caption={srCaption} columns={['Name', valueName]} rows={rows.map(r => [r.label, r.display])} />
    </div>
  )
}
