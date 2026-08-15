import { Fragment, useState, useEffect, useCallback } from 'react'
import {
  fetchOrders, updateOrderStatus, markPaid, money, orderStatusLabel,
  ORDER_STATUSES,
} from '../../lib/store'
import type { Order, OrderStatus } from '../../lib/store'
import { usePermissions } from '../../lib/usePermissions'

const ACCENT = '#272C84'

const STATUS_STYLE: Record<OrderStatus, { bg: string; fg: string; bd: string }> = {
  pending:   { bg: 'rgba(180,120,0,.12)',  fg: '#b47800', bd: 'rgba(180,120,0,.35)' },
  paid:      { bg: 'rgba(39,44,132,.10)',  fg: ACCENT,    bd: 'rgba(39,44,132,.30)' },
  fulfilled: { bg: 'rgba(20,120,60,.12)',  fg: '#14783c', bd: 'rgba(20,120,60,.35)' },
  cancelled: { bg: 'rgba(120,120,120,.12)',fg: '#6b6b6b', bd: 'rgba(120,120,120,.35)' },
  refunded:  { bg: 'rgba(180,40,40,.12)',  fg: '#b42828', bd: 'rgba(180,40,40,.35)' },
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <span style={{ background: s.bg, border: `1px solid ${s.bd}`, color: s.fg, fontSize: '.6rem', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.2rem .55rem', borderRadius: '.15rem', whiteSpace: 'nowrap' }}>
      {orderStatusLabel(status)}
    </span>
  )
}

const FILTERS: readonly (OrderStatus | 'all')[] = ['all', ...ORDER_STATUSES]

export default function OrdersPanel({ isDemo = false }: { isDemo?: boolean }) {
  const { can } = usePermissions()
  // 026 already reads to `manage_orders` OR `view_sales`, and 040 adds
  // `view_store` beside them, so this list has three ways to be visible and one
  // to be editable. `isDemo` is ORed in because a demo session on a configured
  // deployment has no profile, so `can()` answers no to everything and the
  // status controls would vanish from the preview.
  const canManage = isDemo || can('*') || can('manage_orders')

  const [orders, setOrders]   = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [search, setSearch]   = useState('')
  const [filter, setFilter]   = useState<OrderStatus | 'all'>('all')
  const [openId, setOpenId]   = useState<string | null>(null)
  const [busyId, setBusyId]   = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try { setOrders(await fetchOrders(isDemo)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load orders') }
    finally { setLoading(false) }
  }, [isDemo])

  useEffect(() => { refresh() }, [refresh])

  const changeStatus = async (order: Order, status: OrderStatus) => {
    setBusyId(order.id); setError(null)
    try {
      if (status === 'paid') await markPaid(order.id, isDemo)
      else await updateOrderStatus(order.id, status, isDemo)
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status } : o)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the order')
    } finally { setBusyId(null) }
  }

  const filtered = orders.filter((o) => {
    if (filter !== 'all' && o.status !== filter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return [o.orderNumber, o.customerEmail, o.customerName]
      .some((v) => v?.toLowerCase().includes(q))
  })

  const revenue = orders
    .filter((o) => o.status === 'paid' || o.status === 'fulfilled')
    .reduce((sum, o) => sum + o.totalCents, 0)

  return (
    <>
      {isDemo && (
        <div style={{ background: '#2d2500', borderBottom: '1px solid #5c4800', padding: '.625rem 2rem', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <span style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase' }}>Demo Mode</span>
          <span style={{ color: '#7a6500', fontSize: '.75rem' }}>{orders.length} sample orders. Status changes are in-memory.</span>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid var(--surface)', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
        <input
          className="field"
          placeholder="Search order #, name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280, flex: 1 }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? ACCENT : 'transparent',
                border: `1px solid ${filter === f ? ACCENT : 'var(--border)'}`,
                color: filter === f ? '#fff' : 'var(--text-3)',
                fontSize: '.6rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                padding: '.35rem .7rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {f === 'all' ? 'All' : orderStatusLabel(f)}
            </button>
          ))}
        </div>
        <button
          onClick={refresh}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.4rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          ↺ Refresh
        </button>
      </div>

      {/* Summary strip */}
      {!loading && orders.length > 0 && (
        <div style={{ padding: '.75rem 2rem', borderBottom: '1px solid var(--surface-2)', display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'center' }}>
          <Stat label="Orders" value={String(orders.length)} />
          <Stat label="Paid revenue" value={money(revenue)} />
          <Stat label="Awaiting" value={String(orders.filter((o) => o.status === 'pending').length)} />
        </div>
      )}

      {error && (
        <div style={{ margin: '1.5rem 2rem', padding: '.75rem 1rem', background: 'rgba(180,40,40,.08)', border: '1px solid rgba(180,40,40,.25)', borderRadius: '.25rem', color: 'var(--text)', fontSize: '.8rem' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading orders…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>
          {orders.length === 0 ? 'No orders yet.' : 'No orders match that filter.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Order', 'Date', 'Customer', 'Items', 'Total', 'Status', ''].map((h) => (
                  <th key={h} style={{ padding: '.9rem 1.25rem', textAlign: 'left', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const open = openId === o.id
                const itemCount = o.items.reduce((s, it) => s + it.qty, 0)
                return (
                  <Fragment key={o.id}>
                    <tr
                      onClick={() => setOpenId(open ? null : o.id)}
                      style={{ borderBottom: '1px solid var(--surface-2)', cursor: 'pointer', background: open ? 'var(--bg)' : 'transparent' }}
                    >
                      <td style={{ padding: '.9rem 1.25rem', color: 'var(--text)', fontWeight: 700, whiteSpace: 'nowrap' }}>{o.orderNumber ?? o.id.slice(0, 8)}</td>
                      <td style={{ padding: '.9rem 1.25rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td style={{ padding: '.9rem 1.25rem', color: 'var(--text)' }}>
                        <div style={{ fontWeight: 600 }}>{o.customerName ?? '—'}</div>
                        <div style={{ color: 'var(--text-3)', fontSize: '.72rem' }}>{o.customerEmail ?? ''}</div>
                      </td>
                      <td style={{ padding: '.9rem 1.25rem', color: 'var(--text-2)' }}>{itemCount}</td>
                      <td style={{ padding: '.9rem 1.25rem', color: 'var(--text)', fontWeight: 700, whiteSpace: 'nowrap' }}>{money(o.totalCents)}</td>
                      <td style={{ padding: '.9rem 1.25rem' }}><StatusBadge status={o.status} /></td>
                      <td style={{ padding: '.9rem 1.25rem', color: 'var(--text-3)' }}>{open ? '▲' : '▼'}</td>
                    </tr>
                    {open && (
                      <tr style={{ background: 'var(--bg)' }}>
                        <td colSpan={7} style={{ padding: '0 1.25rem 1.25rem' }}>
                          <OrderDetail
                            order={o}
                            canManage={canManage}
                            busy={busyId === o.id}
                            onStatus={(status) => changeStatus(o, status)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          <p style={{ padding: '.75rem 1.25rem', color: 'var(--text-3)', fontSize: '.7rem' }}>
            Showing {filtered.length} of {orders.length} orders
          </p>
        </div>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: 'var(--text-3)', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: 'var(--text)', fontSize: '1rem', fontWeight: 800 }}>{value}</div>
    </div>
  )
}

function OrderDetail({ order, canManage, busy, onStatus }: {
  order: Order
  canManage: boolean
  busy: boolean
  onStatus: (status: OrderStatus) => void
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '.35rem', padding: '1rem 1.25rem', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', marginBottom: '1rem' }}>
        <Field label="Customer" value={order.customerName ?? '—'} />
        <Field label="Email" value={order.customerEmail ?? '—'} />
        <Field label="Placed" value={new Date(order.createdAt).toLocaleString('en-US')} />
        <Field label="Stripe" value={order.stripePaymentIntent ? 'Paid via Stripe' : (order.stripeSessionId ? 'Session created' : 'Records-only')} />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem', marginBottom: '1rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--surface-2)' }}>
            {['Item', 'Unit', 'Qty', 'Line'].map((h) => (
              <th key={h} style={{ padding: '.5rem .75rem', textAlign: h === 'Item' ? 'left' : 'right', color: 'var(--text-3)', fontSize: '.58rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.items.map((it) => (
            <tr key={it.id} style={{ borderBottom: '1px solid var(--surface-2)' }}>
              <td style={{ padding: '.5rem .75rem', color: 'var(--text)' }}>{it.nameSnapshot}</td>
              <td style={{ padding: '.5rem .75rem', color: 'var(--text-2)', textAlign: 'right', whiteSpace: 'nowrap' }}>{money(it.unitPriceCents)}</td>
              <td style={{ padding: '.5rem .75rem', color: 'var(--text-2)', textAlign: 'right' }}>{it.qty}</td>
              <td style={{ padding: '.5rem .75rem', color: 'var(--text)', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{money(it.lineTotalCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} style={{ padding: '.6rem .75rem', textAlign: 'right', color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>Total</td>
            <td style={{ padding: '.6rem .75rem', textAlign: 'right', color: 'var(--text)', fontWeight: 900 }}>{money(order.totalCents)}</td>
          </tr>
        </tfoot>
      </table>

      {canManage ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>Set status:</span>
          {ORDER_STATUSES.map((st) => (
            <button
              key={st}
              disabled={busy || st === order.status}
              onClick={() => onStatus(st)}
              style={{
                background: st === order.status ? ACCENT : 'transparent',
                border: `1px solid ${st === order.status ? ACCENT : 'var(--border)'}`,
                color: st === order.status ? '#fff' : 'var(--text-2)',
                fontSize: '.6rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                padding: '.35rem .7rem', borderRadius: '.2rem',
                cursor: busy || st === order.status ? 'default' : 'pointer',
                opacity: busy ? 0.5 : 1, fontFamily: 'inherit',
              }}
            >
              {orderStatusLabel(st)}
            </button>
          ))}
          {order.status === 'pending' && !order.stripePaymentIntent && (
            <span style={{ color: 'var(--text-3)', fontSize: '.68rem', marginLeft: '.25rem' }}>
              Marking paid decrements stock.
            </span>
          )}
        </div>
      ) : (
        <p style={{ color: 'var(--text-3)', fontSize: '.72rem' }}>You have read-only access to orders.</p>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: 'var(--text-3)', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.15rem' }}>{label}</div>
      <div style={{ color: 'var(--text)', fontSize: '.8rem' }}>{value}</div>
    </div>
  )
}
