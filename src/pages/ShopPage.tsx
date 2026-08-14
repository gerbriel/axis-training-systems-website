import { useState, useEffect, useMemo, useCallback } from 'react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import {
  fetchStoreProducts, checkout, money, variantPriceCents, checkoutErrorMessage,
} from '../lib/store'
import type { StoreProduct, StoreVariant, CartLine } from '../lib/store'
import { demoParamActive } from '../lib/dashboard'

const ACCENT = '#272C84'
const CART_KEY = 'axis_shop_cart'

interface VariantRef { product: StoreProduct; variant: StoreVariant }

function readInitialCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(CART_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((l): l is CartLine => l && typeof l.variantId === 'string' && typeof l.qty === 'number' && l.qty > 0)
      .slice(0, 50)
  } catch { return [] }
}

export default function ShopPage() {
  const isDemo = demoParamActive()

  const [products, setProducts] = useState<StoreProduct[]>([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cart, setCart]         = useState<CartLine[]>(readInitialCart)

  const [email, setEmail]   = useState('')
  const [name, setName]     = useState('')
  const [placing, setPlacing] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [placed, setPlaced] = useState<{ orderNumber?: string } | null>(null)

  // Post-Stripe landing: ?status=success|cancelled.
  const urlStatus = useMemo(() => new URLSearchParams(window.location.search).get('status'), [])

  useEffect(() => {
    let live = true
    setLoading(true); setLoadError(null)
    fetchStoreProducts(isDemo)
      .then((p) => { if (live) setProducts(p) })
      .catch((err) => { if (live) setLoadError(err instanceof Error ? err.message : 'Could not load the shop') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [isDemo])

  // A completed Stripe checkout should not leave a stale cart behind.
  useEffect(() => {
    if (urlStatus === 'success') { setCart([]); try { localStorage.removeItem(CART_KEY) } catch { /* ignore */ } }
  }, [urlStatus])

  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)) } catch { /* ignore */ }
  }, [cart])

  const variantIndex = useMemo(() => {
    const map = new Map<string, VariantRef>()
    for (const p of products) for (const v of p.variants) map.set(v.id, { product: p, variant: v })
    return map
  }, [products])

  const addToCart = useCallback((variantId: string, qty = 1) => {
    setPlaced(null)
    setCart((prev) => {
      const existing = prev.find((l) => l.variantId === variantId)
      if (existing) return prev.map((l) => (l.variantId === variantId ? { ...l, qty: l.qty + qty } : l))
      return [...prev, { variantId, qty }]
    })
  }, [])

  const setQty = useCallback((variantId: string, qty: number) => {
    setCart((prev) => prev.flatMap((l) => {
      if (l.variantId !== variantId) return [l]
      if (qty <= 0) return []
      return [{ ...l, qty }]
    }))
  }, [])

  const cartLines = cart
    .map((l) => ({ line: l, ref: variantIndex.get(l.variantId) }))
    .filter((x): x is { line: CartLine; ref: VariantRef } => !!x.ref)

  const subtotal = cartLines.reduce((s, { line, ref }) => s + variantPriceCents(ref.product, ref.variant) * line.qty, 0)
  const cartCount = cart.reduce((s, l) => s + l.qty, 0)

  const canPlace = cartLines.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && name.trim().length > 0

  const placeOrder = async () => {
    setCheckoutError(null); setPlacing(true)
    try {
      const result = await checkout(cart, { email: email.trim(), name: name.trim() }, isDemo)
      if (result.url) { window.location.href = result.url; return }
      // Records-only (no Stripe): the order is logged for the team to confirm.
      setCart([]); try { localStorage.removeItem(CART_KEY) } catch { /* ignore */ }
      setPlaced({ orderNumber: result.orderNumber })
    } catch (err) {
      const code = err instanceof Error ? err.message : 'checkout_failed'
      setCheckoutError(checkoutErrorMessage(code))
    } finally { setPlacing(false) }
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar />

      <main style={{ flex: 1, maxWidth: 1200, width: '100%', margin: '0 auto', padding: '6rem 1.5rem 4rem' }}>
        <header style={{ marginBottom: '2.5rem' }}>
          <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Axis Shop</p>
          <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.8rem,4vw,3rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: .95 }}>Team Merch</h1>
        </header>

        {urlStatus === 'success' && (
          <Banner tone="ok">Payment received. Thank you. Your order is confirmed and on its way.</Banner>
        )}
        {urlStatus === 'cancelled' && (
          <Banner tone="warn">Checkout cancelled. Your cart is still here whenever you are ready.</Banner>
        )}
        {placed && (
          <Banner tone="ok">
            Order placed{placed.orderNumber ? ` (${placed.orderNumber})` : ''}. We will be in touch to arrange payment and pickup.
          </Banner>
        )}

        {loading ? (
          <p style={{ color: 'var(--text-3)', fontSize: '.85rem', padding: '3rem 0' }}>Loading the shop…</p>
        ) : loadError ? (
          <Banner tone="warn">{loadError}</Banner>
        ) : products.length === 0 ? (
          <p style={{ color: 'var(--text-3)', fontSize: '.85rem', padding: '3rem 0' }}>Nothing in the shop right now. Check back soon.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)', gap: '2.5rem', alignItems: 'start' }} className="shop-grid">
            {/* Products */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1.5rem' }}>
              {products.map((p) => (
                <ProductCard key={p.id} product={p} onAdd={addToCart} />
              ))}
            </div>

            {/* Cart */}
            <aside style={{ position: 'sticky', top: '5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '.5rem', padding: '1.5rem' }}>
              <h2 style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
                Cart{cartCount > 0 ? ` · ${cartCount}` : ''}
              </h2>

              {cartLines.length === 0 ? (
                <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>Your cart is empty.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', marginBottom: '1rem' }}>
                    {cartLines.map(({ line, ref }) => {
                      const unit = variantPriceCents(ref.product, ref.variant)
                      const vn = ref.variant.name && ref.variant.name !== 'Default' ? ` · ${ref.variant.name}` : ''
                      const maxQty = Math.max(1, ref.variant.stockQty)
                      return (
                        <div key={line.variantId} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: 'var(--text)', fontSize: '.8rem', fontWeight: 600 }}>{ref.product.name}<span style={{ color: 'var(--text-3)' }}>{vn}</span></div>
                            <div style={{ color: 'var(--text-3)', fontSize: '.72rem' }}>{money(unit)} each</div>
                          </div>
                          <input
                            className="field"
                            type="number"
                            min={1}
                            max={maxQty}
                            value={line.qty}
                            onChange={(e) => setQty(line.variantId, Math.min(maxQty, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
                            style={{ width: 56, padding: '.35rem', textAlign: 'center' }}
                            aria-label={`Quantity of ${ref.product.name}${vn}`}
                          />
                          <button
                            onClick={() => setQty(line.variantId, 0)}
                            aria-label="Remove"
                            style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '.25rem' }}
                          >
                            ×
                          </button>
                        </div>
                      )
                    })}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '.75rem', marginBottom: '1rem' }}>
                    <span style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>Subtotal</span>
                    <span style={{ color: 'var(--text)', fontWeight: 900 }}>{money(subtotal)}</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem', marginBottom: '1rem' }}>
                    <input className="field" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                    <input className="field" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                  </div>

                  {checkoutError && (
                    <p style={{ color: '#b42828', fontSize: '.75rem', marginBottom: '.75rem' }}>{checkoutError}</p>
                  )}

                  <button
                    onClick={placeOrder}
                    disabled={!canPlace || placing}
                    style={{
                      width: '100%', background: ACCENT, border: 'none', color: '#fff',
                      fontSize: '.7rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
                      padding: '.85rem 1rem', borderRadius: '.3rem',
                      cursor: !canPlace || placing ? 'not-allowed' : 'pointer',
                      opacity: !canPlace || placing ? 0.5 : 1, fontFamily: 'inherit',
                    }}
                  >
                    {placing ? 'Working…' : 'Checkout'}
                  </button>
                  <p style={{ color: 'var(--text-4)', fontSize: '.65rem', marginTop: '.6rem', textAlign: 'center' }}>
                    Secure payment by Stripe. Prices are confirmed at checkout.
                  </p>
                </>
              )}
            </aside>
          </div>
        )}
      </main>

      <Footer />

      {/* Single-column on narrow screens. */}
      <style>{`@media (max-width: 860px){ .shop-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}

function ProductCard({ product, onAdd }: { product: StoreProduct; onAdd: (variantId: string) => void }) {
  const sellable = product.variants.filter((v) => v.stockQty > 0)
  const [selected, setSelected] = useState<string | null>(sellable[0]?.id ?? null)

  const current = product.variants.find((v) => v.id === selected) ?? null
  const price = current ? variantPriceCents(product, current) : product.priceCents
  const soldOut = sellable.length === 0

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '.5rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
      {product.imageUrl && (
        <img src={product.imageUrl} alt={product.name} style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: '.3rem', background: 'var(--bg)' }} />
      )}
      <div>
        <h3 style={{ color: 'var(--text)', fontSize: '.95rem', fontWeight: 800 }}>{product.name}</h3>
        <div style={{ color: 'var(--text)', fontSize: '.85rem', fontWeight: 700, marginTop: '.15rem' }}>{money(price)}</div>
      </div>
      {product.description && (
        <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.5, flex: 1 }}>{product.description}</p>
      )}

      {product.variants.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
          {product.variants.map((v) => {
            const out = v.stockQty <= 0
            const active = v.id === selected
            return (
              <button
                key={v.id}
                disabled={out}
                onClick={() => setSelected(v.id)}
                title={out ? 'Out of stock' : undefined}
                style={{
                  background: active ? ACCENT : 'transparent',
                  border: `1px solid ${active ? ACCENT : 'var(--border)'}`,
                  color: out ? 'var(--text-4)' : active ? '#fff' : 'var(--text-2)',
                  fontSize: '.65rem', fontWeight: 700, letterSpacing: '.05em',
                  padding: '.35rem .6rem', borderRadius: '.2rem',
                  cursor: out ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  textDecoration: out ? 'line-through' : 'none',
                }}
              >
                {v.name ?? 'One size'}
              </button>
            )
          })}
        </div>
      )}

      <button
        onClick={() => selected && onAdd(selected)}
        disabled={soldOut || !selected}
        style={{
          background: soldOut ? 'var(--surface-2)' : 'transparent',
          border: `1px solid ${soldOut ? 'var(--border)' : ACCENT}`,
          color: soldOut ? 'var(--text-4)' : ACCENT,
          fontSize: '.68rem', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
          padding: '.6rem', borderRadius: '.3rem',
          cursor: soldOut || !selected ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
        }}
      >
        {soldOut ? 'Sold out' : 'Add to cart'}
      </button>
    </div>
  )
}

function Banner({ tone, children }: { tone: 'ok' | 'warn'; children: React.ReactNode }) {
  const colors = tone === 'ok'
    ? { bg: 'rgba(20,120,60,.10)', bd: 'rgba(20,120,60,.35)' }
    : { bg: 'rgba(180,120,0,.10)', bd: 'rgba(180,120,0,.35)' }
  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.bd}`, borderRadius: '.35rem', padding: '.85rem 1.1rem', color: 'var(--text)', fontSize: '.82rem', marginBottom: '1.5rem' }}>
      {children}
    </div>
  )
}
