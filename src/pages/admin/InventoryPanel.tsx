import { useState, useEffect, useCallback, useMemo } from 'react'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { usePermissions } from '../../lib/usePermissions'
import { clampInt } from '../../utils/sanitize'
import {
  fetchProducts, adjustStock, isLowStock, totalStock, LOW_STOCK_THRESHOLD,
  type Product, type ProductVariant,
} from '../../lib/catalog'

/**
 * Stock, per size, and the one safe way to move it.
 *
 * The number on screen is never edited in place. A change is a DELTA with a
 * reason — "received 24", "damaged 2", "count correction" — handed to the
 * adjust_stock RPC, which writes the ledger and refuses to drop a count below
 * zero. So this screen cannot oversell and cannot lose the history of why a
 * number moved; both live in the database, not in this component.
 */

const ACCENT = '#272C84'
const DANGER = '#c8102e'
const GREEN = '#22c55e'
const WARN = '#eab308'

const microLabel: React.CSSProperties = {
  color: 'var(--text)', fontSize: '.6rem', fontWeight: 900,
  letterSpacing: '.3em', textTransform: 'uppercase',
}
const heading: React.CSSProperties = {
  color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem',
  textTransform: 'uppercase', letterSpacing: '-.01em',
}
const btn = (bg: string, fg: string): React.CSSProperties => ({
  background: bg, border: 'none', color: fg, fontWeight: 900, fontSize: '.62rem',
  letterSpacing: '.12em', textTransform: 'uppercase', padding: '.5rem 1rem',
  minHeight: '2.4rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
})
const btnGhost = (color: string): React.CSSProperties => ({
  background: 'transparent', border: `1px solid ${color}`, color,
  fontWeight: 700, fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase',
  padding: '.5rem 1rem', minHeight: '2.4rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
})

function StockBadge({ qty }: { qty: number }) {
  const low = isLowStock(qty)
  const color = qty === 0 ? DANGER : low ? WARN : GREEN
  return (
    <span style={{ background: `${color}18`, border: `1px solid ${color}`, color, fontSize: '.7rem', fontWeight: 900, padding: '.25rem .6rem', borderRadius: '.25rem', whiteSpace: 'nowrap', minWidth: 54, textAlign: 'center' }}>
      {qty} {qty === 1 ? 'unit' : 'units'}
    </span>
  )
}

function AdjustRow({ variant, isDemo, canManage, onApplied }: {
  variant: ProductVariant
  isDemo: boolean
  /** False leaves the count and the badge and takes away the delta form. */
  canManage: boolean
  onApplied: (variantId: string, newQty: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [delta, setDelta] = useState(0)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = async () => {
    if (busy) return
    if (delta === 0) { setError('Enter how many units to add or remove.'); return }
    setBusy(true); setError(null)
    const optimistic = Math.max(0, variant.stockQty + delta)
    const res = await adjustStock(variant.id, delta, reason, isDemo)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    onApplied(variant.id, isDemo ? optimistic : res.value)
    setOpen(false); setDelta(0); setReason('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.82rem' }}>{variant.name ?? 'Default'}</span>
          {variant.sku && <span style={{ color: 'var(--text-4)', fontSize: '.7rem', marginLeft: '.5rem' }}>{variant.sku}</span>}
        </div>
        <StockBadge qty={variant.stockQty} />
        {canManage && !open && <button onClick={() => { setOpen(true); setError(null) }} style={btnGhost('var(--text-2)')}>Adjust</button>}
      </div>

      {canManage && open && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '.85rem', display: 'flex', flexDirection: 'column', gap: '.7rem' }}>
          <div style={{ display: 'flex', gap: '.75rem', alignItems: 'end', flexWrap: 'wrap' }}>
            <div style={{ maxWidth: 150 }}>
              <label className="field-label" htmlFor={`d-${variant.id}`}>Change (+ in / − out)</label>
              <input id={`d-${variant.id}`} className="field" type="number" value={delta}
                onChange={e => setDelta(clampInt(e.target.value, -100000, 100000, 0))} />
            </div>
            <div style={{ display: 'flex', gap: '.35rem', paddingBottom: '.25rem' }}>
              {[-1, +1, +10].map(n => (
                <button key={n} onClick={() => setDelta(d => d + n)} style={{ ...btnGhost('var(--text-3)'), padding: '.5rem .7rem', minHeight: '2.4rem' }}>
                  {n > 0 ? `+${n}` : n}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label className="field-label" htmlFor={`r-${variant.id}`}>Reason</label>
              <input id={`r-${variant.id}`} className="field" maxLength={200} value={reason} placeholder="received shipment, damaged, count correction…"
                onChange={e => setReason(e.target.value)} />
            </div>
          </div>
          {delta !== 0 && (
            <p style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>
              {variant.stockQty} → <strong style={{ color: 'var(--text-2)' }}>{Math.max(0, variant.stockQty + delta)}</strong> units
            </p>
          )}
          {error && <span style={{ color: DANGER, fontSize: '.75rem' }}>{error}</span>}
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => void apply()} disabled={busy} style={btn(ACCENT, '#fff')}>{busy ? 'Saving…' : 'Apply change'}</button>
            <button onClick={() => { setOpen(false); setDelta(0); setReason(''); setError(null) }} style={btnGhost('var(--text-3)')}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function InventoryPanel({ isDemo = false }: { isDemo?: boolean }) {
  // `view_store` (040) reads the counts and the audit trail; moving stock stays
  // `manage_inventory`, which is what `adjust_stock()` itself checks — the RPC
  // is the only writer of `stock_adjustments`, so a hidden button here is a
  // hidden button in front of a definer function that would refuse anyway.
  const { can } = usePermissions()
  const canManage = isDemo || can('*') || can('manage_inventory')

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)
  const [lowOnly, setLowOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await fetchProducts(isDemo)
    if (rows === null) { setOutage(true); setProducts([]) }
    else { setOutage(false); setProducts(rows) }
    setLoading(false)
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  const applied = useCallback((variantId: string, newQty: number) => {
    setProducts(list => list.map(p => ({
      ...p,
      variants: p.variants.map(v => v.id === variantId ? { ...v, stockQty: newQty } : v),
    })))
  }, [])

  const lowCount = useMemo(
    () => products.reduce((n, p) => n + p.variants.filter(v => isLowStock(v.stockQty)).length, 0),
    [products]
  )
  const unitTotal = useMemo(() => products.reduce((n, p) => n + totalStock(p), 0), [products])

  const shown = useMemo(() => {
    if (!lowOnly) return products
    return products
      .map(p => ({ ...p, variants: p.variants.filter(v => isLowStock(v.stockQty)) }))
      .filter(p => p.variants.length > 0)
  }, [products, lowOnly])

  return (
    <div className="dash-pad">
      {isDemo && <DemoBanner note="Adjust sample stock — the ledger and counts reset with the preview." />}

      <p style={{ ...microLabel, marginBottom: '.4rem' }}>What is on the shelf</p>
      <h2 style={{ ...heading, marginBottom: '.6rem' }}>Inventory</h2>
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.65, marginBottom: '1.25rem', maxWidth: 560 }}>
        {canManage
          ? <>Stock lives per size. Every change is a reason, not an overwrite, so the count and the story of how it
              got there both hold up. {LOW_STOCK_THRESHOLD} units or fewer is flagged.</>
          : <>Stock lives per size. These are the current counts, read-only. {LOW_STOCK_THRESHOLD} units or fewer is flagged.</>}
      </p>

      {!loading && !outage && (
        <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          {([
            ['Units in stock', unitTotal, 'var(--text)'],
            ['Low or out', lowCount, lowCount > 0 ? WARN : 'var(--text-4)'],
          ] as const).map(([label, value, color]) => (
            <div key={label}>
              <p style={{ color, fontWeight: 900, fontSize: '1.5rem', lineHeight: 1 }}>{value}</p>
              <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '.25rem' }}>{label}</p>
            </div>
          ))}
          <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', cursor: 'pointer', marginLeft: 'auto', alignSelf: 'center' }}>
            <input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} style={{ width: 16, height: 16, accentColor: ACCENT }} />
            <span style={{ color: 'var(--text-3)', fontSize: '.72rem', fontWeight: 600 }}>Low stock only</span>
          </label>
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading stock…</p>
      ) : outage ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center', maxWidth: 760 }}>
          <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>Couldn&rsquo;t load inventory.</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>That&rsquo;s on our side — no counts were touched.</p>
          <button onClick={() => void load()} style={btnGhost('var(--text)')}>Try again</button>
        </div>
      ) : shown.length === 0 ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.85rem', maxWidth: 760 }}>
          {lowOnly ? 'Nothing is low. Everything is above the threshold.' : 'No products yet. Add one in the Catalog tab and it will appear here.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 760 }}>
          {shown.map(p => {
            const total = totalStock(p)
            return (
              <div key={p.id} style={{ border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden' }}>
                <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', padding: '.9rem 1.1rem', background: 'var(--surface)', borderBottom: '1px solid var(--surface-2)', flexWrap: 'wrap' }}>
                  <span style={{ color: p.isActive ? 'var(--text)' : 'var(--text-4)', fontWeight: 900, fontSize: '.92rem', flex: 1, minWidth: 160 }}>{p.name}</span>
                  {!p.isActive && <span style={{ color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', border: '1px solid var(--border-mid)', padding: '.1rem .4rem', borderRadius: '.2rem' }}>Hidden</span>}
                  <span style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>{total} total</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {p.variants.map((v, i) => (
                    <div key={v.id} style={{ padding: '.85rem 1.1rem', borderBottom: i < p.variants.length - 1 ? '1px solid var(--surface)' : 'none' }}>
                      <AdjustRow variant={v} isDemo={isDemo} canManage={canManage} onApplied={applied} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
