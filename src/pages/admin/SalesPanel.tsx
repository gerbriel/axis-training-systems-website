import { useState, useEffect, useCallback } from 'react'
import { fetchSales, money } from '../../lib/store'
import type { SalesSummary } from '../../lib/store'
import { usePermissions } from '../../lib/usePermissions'
import OrdersPanel from './OrdersPanel'
import ExpensesPanel from './ExpensesPanel'

const ACCENT = '#272C84'

type Sub = 'overview' | 'orders' | 'expenses'

const SUB_LABELS: Record<Sub, string> = { overview: 'Overview', orders: 'Orders', expenses: 'Expenses' }

const daysAgoISO = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)

/**
 * The Sales home. "Sales" is the overview; Orders and Expenses are sub-tabs, so a
 * single nav entry (mount <SalesPanel/>) delivers all three. OrdersPanel and
 * ExpensesPanel are also independently mountable if an integrator prefers three
 * top-level nav items instead.
 */
export default function SalesPanel({ isDemo = false }: { isDemo?: boolean }) {
  const { can } = usePermissions()
  // `view_store` (040) is the read across the whole shop, so it opens the three
  // sub-tabs that were previously reachable only through a manage key or
  // `view_sales`. What each panel then LETS a person do is still its own
  // business: OrdersPanel keeps `manage_orders` on the status controls.
  // `isDemo` is ORed in because a demo session has no profile to resolve.
  const full = isDemo || can('*')
  const canSales    = full || can('view_store') || can('view_sales') || can('manage_orders')
  const canOrders   = full || can('view_store') || can('manage_orders') || can('view_sales')
  const canExpenses = full || can('view_store') || can('manage_expenses')

  const available = ([
    canSales    ? 'overview' : null,
    canOrders   ? 'orders'   : null,
    canExpenses ? 'expenses' : null,
  ].filter(Boolean) as Sub[])

  const [sub, setSub] = useState<Sub>('overview')

  // Keep the active sub-tab pointed at something the person may actually see.
  useEffect(() => {
    if (available.length > 0 && !available.includes(sub)) setSub(available[0])
  }, [available, sub])

  return (
    <>
      <div style={{ display: 'flex', gap: '.35rem', padding: '1rem 2rem 0', borderBottom: '1px solid var(--surface)', flexWrap: 'wrap' }}>
        {available.map((s) => (
          <button
            key={s}
            onClick={() => setSub(s)}
            style={{
              background: 'none', border: 'none', borderBottom: `2px solid ${sub === s ? ACCENT : 'transparent'}`,
              color: sub === s ? 'var(--text)' : 'var(--text-3)',
              fontSize: '.7rem', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
              padding: '.5rem .5rem .75rem', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {SUB_LABELS[s]}
          </button>
        ))}
      </div>

      {sub === 'overview'  && canSales    && <Overview isDemo={isDemo} />}
      {sub === 'orders'    && canOrders   && <OrdersPanel isDemo={isDemo} />}
      {sub === 'expenses'  && canExpenses && <ExpensesPanel isDemo={isDemo} />}

      {available.length === 0 && (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>
          You do not have access to any sales views.
        </div>
      )}
    </>
  )
}

function Overview({ isDemo }: { isDemo: boolean }) {
  const [from, setFrom] = useState(daysAgoISO(30))
  const [to, setTo]     = useState(daysAgoISO(0))
  const [summary, setSummary] = useState<SalesSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try { setSummary(await fetchSales(isDemo, { from, to })) }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load sales') }
    finally { setLoading(false) }
  }, [isDemo, from, to])

  useEffect(() => { refresh() }, [refresh])

  const maxDay = summary ? Math.max(1, ...summary.byDay.map((d) => d.cents)) : 1

  return (
    <>
      {isDemo && (
        <div style={{ background: '#2d2500', borderBottom: '1px solid #5c4800', padding: '.625rem 2rem', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <span style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase' }}>Demo Mode</span>
          <span style={{ color: '#7a6500', fontSize: '.75rem' }}>Sample sales from in-memory demo orders.</span>
        </div>
      )}

      {/* Date range */}
      <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid var(--surface)', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
        <label style={{ display: 'block' }}>
          <span style={rangeLabel}>From</span>
          <input className="field" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ display: 'block' }}>
          <span style={rangeLabel}>To</span>
          <input className="field" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: '.35rem' }}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => { setFrom(daysAgoISO(d)); setTo(daysAgoISO(0)) }}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', padding: '.4rem .7rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ margin: '1.5rem 2rem', padding: '.75rem 1rem', background: 'rgba(180,40,40,.08)', border: '1px solid rgba(180,40,40,.25)', borderRadius: '.25rem', color: 'var(--text)', fontSize: '.8rem' }}>
          {error}
        </div>
      )}

      {loading || !summary ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading sales…</div>
      ) : (
        <div style={{ padding: '2rem' }}>
          {/* Stat tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <Tile label="Revenue" value={money(summary.totalRevenueCents)} />
            <Tile label="Paid orders" value={String(summary.paidOrderCount)} />
            <Tile label="Avg order" value={money(summary.avgOrderCents)} />
            <Tile label="Units sold" value={String(summary.topProducts.reduce((s, p) => s + p.qty, 0))} />
          </div>

          {/* By-day bars */}
          <section style={{ marginBottom: '2rem' }}>
            <h3 style={sectionTitle}>Revenue by day</h3>
            {summary.byDay.length === 0 ? (
              <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>No paid orders in this range.</p>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '.35rem', overflowX: 'auto', paddingBottom: '.5rem' }}>
                {summary.byDay.map((d) => (
                  <div key={d.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.25rem', minWidth: 34 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', height: 100, width: '100%', justifyContent: 'center' }}>
                      <div
                        title={`${money(d.cents)} · ${d.orders} order${d.orders === 1 ? '' : 's'}`}
                        style={{ width: '70%', height: `${Math.max((d.cents / maxDay) * 100, 2)}%`, background: ACCENT, borderRadius: '.1rem .1rem 0 0', opacity: .75, minHeight: 2 }}
                      />
                    </div>
                    <span style={{ color: 'var(--text-4)', fontSize: '.5rem', textAlign: 'center', lineHeight: 1, whiteSpace: 'nowrap' }}>
                      {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Top products */}
          <section>
            <h3 style={sectionTitle}>Top products</h3>
            {summary.topProducts.length === 0 ? (
              <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>Nothing sold in this range.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem', maxWidth: 560 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Product', 'Units', 'Revenue'].map((h) => (
                      <th key={h} style={{ padding: '.6rem .75rem', textAlign: h === 'Product' ? 'left' : 'right', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.topProducts.slice(0, 10).map((p) => (
                    <tr key={p.name} style={{ borderBottom: '1px solid var(--surface-2)' }}>
                      <td style={{ padding: '.6rem .75rem', color: 'var(--text)' }}>{p.name}</td>
                      <td style={{ padding: '.6rem .75rem', color: 'var(--text-2)', textAlign: 'right' }}>{p.qty}</td>
                      <td style={{ padding: '.6rem .75rem', color: 'var(--text)', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(p.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </>
  )
}

const rangeLabel: React.CSSProperties = {
  display: 'block', color: 'var(--text-3)', fontSize: '.55rem', fontWeight: 700,
  letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.3rem',
}
const sectionTitle: React.CSSProperties = {
  color: 'var(--text-3)', fontSize: '.62rem', fontWeight: 800, letterSpacing: '.18em',
  textTransform: 'uppercase', marginBottom: '1rem',
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '.35rem', padding: '1.1rem 1.25rem' }}>
      <div style={{ color: 'var(--text-3)', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.4rem' }}>{label}</div>
      <div style={{ color: 'var(--text)', fontSize: '1.4rem', fontWeight: 900, letterSpacing: '-.01em' }}>{value}</div>
    </div>
  )
}
