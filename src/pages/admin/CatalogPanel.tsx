import { useState, useEffect, useCallback, useMemo } from 'react'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { usePermissions } from '../../lib/usePermissions'
import { clampInt, safeUrl } from '../../utils/sanitize'
import { fmtMoney } from '../../lib/availability'
import CategoriesPanel from './CategoriesPanel'
import InventoryPanel from './InventoryPanel'
import {
  fetchProducts, fetchCategories,
  createProduct, updateProduct, deleteProduct,
  createVariant, updateVariant, deleteVariant,
  dollarsToCents, centsToDollarString, slugify, totalStock,
  type Product, type ProductCategory, type ProductVariant, type VariantInput,
} from '../../lib/catalog'

/**
 * The merch catalog — the products, with their sizes and prices — and the home
 * of the Categories and Inventory screens as sub-tabs, so the whole shop lives
 * under one "Catalog" entry in the nav.
 *
 * A product's PRICE and its IDENTITY are edited here; its STOCK is not. Stock
 * only ever moves through the Inventory tab's adjust flow (the adjust_stock RPC),
 * so nothing on this screen can quietly rewrite a unit count while someone meant
 * to fix a typo. Money is entered in dollars and stored as integer cents.
 */

const ACCENT = '#272C84'
const DANGER = '#c8102e'
const GREEN = '#22c55e'

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
  letterSpacing: '.12em', textTransform: 'uppercase', padding: '.55rem 1.1rem',
  minHeight: '2.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
})
const btnGhost = (color: string): React.CSSProperties => ({
  background: 'transparent', border: `1px solid ${color}`, color,
  fontWeight: 700, fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase',
  padding: '.55rem 1.1rem', minHeight: '2.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
})

// ── The product form fields, shared by create and edit ─────────────────────────

interface Fields {
  name: string
  slug: string
  description: string
  categoryId: string
  priceDollars: string
  sku: string
  imageUrl: string
  isActive: boolean
}

const EMPTY_FIELDS: Fields = { name: '', slug: '', description: '', categoryId: '', priceDollars: '', sku: '', imageUrl: '', isActive: true }

function fieldsFromProduct(p: Product): Fields {
  return {
    name: p.name, slug: p.slug ?? '', description: p.description ?? '',
    categoryId: p.categoryId ?? '', priceDollars: centsToDollarString(p.priceCents),
    sku: p.sku ?? '', imageUrl: p.imageUrl ?? '', isActive: p.isActive,
  }
}

/** Client-side image URL guard, mirroring the DB CHECK (http/https only). */
function imageUrlError(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  if (!/^https?:\/\//i.test(trimmed) || !safeUrl(trimmed)) return 'The image link must start with http:// or https://'
  return null
}

function ProductFields({ fields, set, categories }: { fields: Fields; set: (f: Fields) => void; categories: ProductCategory[] }) {
  return (
    <div style={{ display: 'grid', gap: '.9rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.9rem' }}>
        <div>
          <label className="field-label">Name</label>
          <input className="field" maxLength={120} value={fields.name} placeholder="Team Axis Tee"
            onChange={e => set({ ...fields, name: e.target.value, slug: fields.slug || slugify(e.target.value) })} />
        </div>
        <div>
          <label className="field-label">Slug</label>
          <input className="field" maxLength={60} value={fields.slug} placeholder="team-axis-tee"
            onChange={e => set({ ...fields, slug: e.target.value })} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.9rem' }}>
        <div>
          <label className="field-label">Category</label>
          <select className="field" value={fields.categoryId} onChange={e => set({ ...fields, categoryId: e.target.value })}>
            <option value="">Uncategorised</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.isActive ? '' : ' (hidden)'}</option>)}
          </select>
        </div>
        <div style={{ maxWidth: 160 }}>
          <label className="field-label">Price (USD)</label>
          <input className="field" inputMode="decimal" value={fields.priceDollars} placeholder="25.00"
            onChange={e => set({ ...fields, priceDollars: e.target.value.replace(/[^0-9.]/g, '') })} />
        </div>
        <div>
          <label className="field-label">SKU</label>
          <input className="field" maxLength={60} value={fields.sku} placeholder="AXIS-TEE"
            onChange={e => set({ ...fields, sku: e.target.value })} />
        </div>
      </div>

      <div>
        <label className="field-label">Image URL</label>
        <input className="field" maxLength={500} value={fields.imageUrl} placeholder="https://…"
          onChange={e => set({ ...fields, imageUrl: e.target.value })} />
      </div>

      <div>
        <label className="field-label">Description</label>
        <textarea className="field" rows={3} maxLength={1000} value={fields.description} placeholder="What it is, how it fits."
          onChange={e => set({ ...fields, description: e.target.value })} />
      </div>

      <label style={{ display: 'flex', gap: '.6rem', alignItems: 'center', cursor: 'pointer' }}>
        <input type="checkbox" checked={fields.isActive} onChange={e => set({ ...fields, isActive: e.target.checked })} style={{ width: 16, height: 16, accentColor: ACCENT }} />
        <span style={{ color: 'var(--text-2)', fontSize: '.82rem', fontWeight: 600 }}>Live on the storefront</span>
      </label>
    </div>
  )
}

// ── Variant rows for the CREATE form ───────────────────────────────────────────

interface VRow { name: string; sku: string; priceDollars: string; stock: number }
const BLANK_VROW: VRow = { name: '', sku: '', priceDollars: '', stock: 0 }

function CreateVariantRows({ rows, set }: { rows: VRow[]; set: (r: VRow[]) => void }) {
  const update = (i: number, patch: Partial<VRow>) => set(rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px 80px auto', gap: '.5rem', alignItems: 'center' }}>
          <input className="field" placeholder="Size (M)" maxLength={40} value={r.name} onChange={e => update(i, { name: e.target.value })} />
          <input className="field" placeholder="SKU" maxLength={60} value={r.sku} onChange={e => update(i, { sku: e.target.value })} />
          <input className="field" placeholder="Price" inputMode="decimal" value={r.priceDollars} onChange={e => update(i, { priceDollars: e.target.value.replace(/[^0-9.]/g, '') })} title="Override price — leave blank to use the product price" />
          <input className="field" type="number" placeholder="Qty" value={r.stock} onChange={e => update(i, { stock: clampInt(e.target.value, 0, 1000000, 0) })} />
          <button onClick={() => set(rows.filter((_, j) => j !== i))} aria-label="Remove size" style={{ ...btnGhost(DANGER), padding: '.4rem .6rem', minHeight: '2.2rem' }}>×</button>
        </div>
      ))}
      <button onClick={() => set([...rows, { ...BLANK_VROW }])} style={{ ...btnGhost('var(--text-2)'), alignSelf: 'flex-start' }}>+ Add size</button>
      <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.5 }}>
        Leave a size price blank to use the product price. No sizes at all is fine — the product gets one default line to hold stock.
      </p>
    </div>
  )
}

// ── The CREATE editor ──────────────────────────────────────────────────────────

function CreateProduct({ categories, isDemo, onCreated, onCancel }: {
  categories: ProductCategory[]
  isDemo: boolean
  onCreated: (p: Product) => void
  onCancel: () => void
}) {
  const [fields, setFields] = useState<Fields>({ ...EMPTY_FIELDS })
  const [vrows, setVrows] = useState<VRow[]>([{ name: 'S', sku: '', priceDollars: '', stock: 0 }, { name: 'M', sku: '', priceDollars: '', stock: 0 }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (busy) return
    if (!fields.name.trim()) { setError('A product needs a name.'); return }
    const imgErr = imageUrlError(fields.imageUrl)
    if (imgErr) { setError(imgErr); return }

    setBusy(true); setError(null)
    const variants: VariantInput[] = vrows
      .filter(r => r.name.trim() || r.sku.trim() || r.stock > 0)
      .map(r => ({
        name: r.name.trim() || null,
        sku: r.sku.trim() || null,
        priceCentsOverride: r.priceDollars.trim() ? dollarsToCents(r.priceDollars) : null,
        stockQty: r.stock,
      }))

    const res = await createProduct({
      name: fields.name,
      slug: fields.slug.trim() || null,
      description: fields.description.trim() || null,
      categoryId: fields.categoryId || null,
      priceCents: dollarsToCents(fields.priceDollars),
      sku: fields.sku.trim() || null,
      imageUrl: fields.imageUrl.trim() || null,
      isActive: fields.isActive,
      variants,
    }, isDemo)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    onCreated(res.value)
  }

  return (
    <div style={{ border: `1px solid ${ACCENT}55`, borderRadius: '.25rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      <p style={microLabel}>New product</p>
      <ProductFields fields={fields} set={setFields} categories={categories} />
      <div>
        <p style={{ ...microLabel, marginBottom: '.6rem' }}>Sizes &amp; starting stock</p>
        <CreateVariantRows rows={vrows} set={setVrows} />
      </div>
      {error && <span style={{ color: DANGER, fontSize: '.78rem' }}>{error}</span>}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <button onClick={() => void submit()} disabled={busy} style={btn(ACCENT, '#fff')}>{busy ? 'Saving…' : 'Create product'}</button>
        <button onClick={onCancel} style={btnGhost('var(--text-3)')}>Cancel</button>
      </div>
    </div>
  )
}

// ── The EDIT editor ────────────────────────────────────────────────────────────

function EditVariant({ variant, product, isDemo, onChanged, onRemoved }: {
  variant: ProductVariant
  product: Product
  isDemo: boolean
  onChanged: (v: ProductVariant) => void
  onRemoved: (id: string) => void
}) {
  const [name, setName] = useState(variant.name ?? '')
  const [sku, setSku] = useState(variant.sku ?? '')
  const [price, setPrice] = useState(centsToDollarString(variant.priceCentsOverride))
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = name !== (variant.name ?? '') || sku !== (variant.sku ?? '') || price !== centsToDollarString(variant.priceCentsOverride)

  const save = async () => {
    if (busy) return
    setBusy(true); setError(null)
    const res = await updateVariant(variant.id, {
      name: name.trim() || null,
      sku: sku.trim() || null,
      priceCentsOverride: price.trim() ? dollarsToCents(price) : null,
    }, isDemo)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    onChanged({ ...variant, name: name.trim() || null, sku: sku.trim() || null, priceCentsOverride: price.trim() ? dollarsToCents(price) : null })
  }

  const remove = async () => {
    setBusy(true); setError(null)
    const res = await deleteVariant(variant.id, isDemo)
    setBusy(false); setArmed(false)
    if (!res.ok) { setError(res.message); return }
    onRemoved(variant.id)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', padding: '.6rem 0', borderTop: '1px solid var(--surface)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px auto', gap: '.5rem', alignItems: 'center' }}>
        <input className="field" placeholder="Size" maxLength={40} value={name} onChange={e => setName(e.target.value)} />
        <input className="field" placeholder="SKU" maxLength={60} value={sku} onChange={e => setSku(e.target.value)} />
        <input className="field" placeholder={centsToDollarString(product.priceCents) || 'Price'} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} title="Override price — blank uses the product price" />
        <span style={{ color: 'var(--text-4)', fontSize: '.7rem', whiteSpace: 'nowrap' }}>{variant.stockQty} in stock</span>
      </div>
      {error && <span style={{ color: DANGER, fontSize: '.72rem' }}>{error}</span>}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {dirty && <button onClick={() => void save()} disabled={busy} style={{ ...btn(ACCENT, '#fff'), padding: '.4rem .9rem', minHeight: '2.2rem' }}>{busy ? 'Saving…' : 'Save size'}</button>}
        {armed ? (
          <>
            <span style={{ color: 'var(--text-2)', fontSize: '.72rem' }}>Remove this size?</span>
            <button onClick={() => void remove()} disabled={busy} style={{ ...btn(DANGER, '#fff'), padding: '.4rem .9rem', minHeight: '2.2rem' }}>Remove</button>
            <button onClick={() => setArmed(false)} style={{ ...btnGhost('var(--text-3)'), padding: '.4rem .9rem', minHeight: '2.2rem' }}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setArmed(true)} style={{ ...btnGhost(DANGER), padding: '.4rem .9rem', minHeight: '2.2rem' }}>Delete size</button>
        )}
        <span style={{ color: 'var(--text-4)', fontSize: '.68rem', marginLeft: 'auto' }}>Stock is changed in Inventory</span>
      </div>
    </div>
  )
}

function EditProduct({ product, categories, isDemo, onPatched, onDeleted, onVariants, onClose }: {
  product: Product
  categories: ProductCategory[]
  isDemo: boolean
  onPatched: (id: string, fields: Fields) => void
  onDeleted: (id: string) => void
  onVariants: (productId: string, variants: ProductVariant[]) => void
  onClose: () => void
}) {
  const [fields, setFields] = useState<Fields>(fieldsFromProduct(product))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [armedDelete, setArmedDelete] = useState(false)
  const [newSize, setNewSize] = useState<VRow | null>(null)
  const [addBusy, setAddBusy] = useState(false)

  const say = (m: string) => { setFlash(m); window.setTimeout(() => setFlash(null), 2000) }

  const saveFields = async () => {
    if (busy) return
    const imgErr = imageUrlError(fields.imageUrl)
    if (imgErr) { setError(imgErr); return }
    setBusy(true); setError(null)
    const res = await updateProduct(product.id, {
      name: fields.name,
      slug: fields.slug.trim() || null,
      description: fields.description.trim() || null,
      categoryId: fields.categoryId || null,
      priceCents: dollarsToCents(fields.priceDollars),
      sku: fields.sku.trim() || null,
      imageUrl: fields.imageUrl.trim() || null,
      isActive: fields.isActive,
    }, isDemo)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    onPatched(product.id, fields)
    say('Product saved.')
  }

  const removeProduct = async () => {
    setBusy(true); setError(null)
    const res = await deleteProduct(product.id, isDemo)
    setBusy(false); setArmedDelete(false)
    if (!res.ok) { setError(res.message); return }
    onDeleted(product.id)
  }

  const addSize = async () => {
    if (!newSize || addBusy) return
    setAddBusy(true); setError(null)
    const res = await createVariant(product.id, {
      name: newSize.name.trim() || null,
      sku: newSize.sku.trim() || null,
      priceCentsOverride: newSize.priceDollars.trim() ? dollarsToCents(newSize.priceDollars) : null,
      stockQty: newSize.stock,
    }, isDemo)
    setAddBusy(false)
    if (!res.ok) { setError(res.message); return }
    onVariants(product.id, [...product.variants, res.value])
    setNewSize(null)
    say('Size added.')
  }

  return (
    <div style={{ border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.75rem' }}>
        <p style={microLabel}>Editing {product.name}</p>
        <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.1rem', fontFamily: 'inherit' }}>×</button>
      </div>

      <ProductFields fields={fields} set={setFields} categories={categories} />
      {error && <span style={{ color: DANGER, fontSize: '.78rem' }}>{error}</span>}
      {flash && <span style={{ color: GREEN, fontSize: '.78rem' }}>{flash}</span>}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <button onClick={() => void saveFields()} disabled={busy} style={btn(ACCENT, '#fff')}>{busy ? 'Saving…' : 'Save product'}</button>
        {armedDelete ? (
          <>
            <span style={{ color: 'var(--text-2)', fontSize: '.72rem', alignSelf: 'center' }}>Delete the whole product?</span>
            <button onClick={() => void removeProduct()} disabled={busy} style={btn(DANGER, '#fff')}>Delete</button>
            <button onClick={() => setArmedDelete(false)} style={btnGhost('var(--text-3)')}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setArmedDelete(true)} style={btnGhost(DANGER)}>Delete product</button>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--surface-2)', paddingTop: '1rem' }}>
        <p style={{ ...microLabel, marginBottom: '.5rem' }}>Sizes</p>
        {product.variants.map(v => (
          <EditVariant
            key={v.id}
            variant={v}
            product={product}
            isDemo={isDemo}
            onChanged={nv => onVariants(product.id, product.variants.map(x => x.id === nv.id ? nv : x))}
            onRemoved={id => onVariants(product.id, product.variants.filter(x => x.id !== id))}
          />
        ))}

        {newSize ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', paddingTop: '.7rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px 80px', gap: '.5rem' }}>
              <input className="field" placeholder="Size (XL)" maxLength={40} value={newSize.name} onChange={e => setNewSize({ ...newSize, name: e.target.value })} />
              <input className="field" placeholder="SKU" maxLength={60} value={newSize.sku} onChange={e => setNewSize({ ...newSize, sku: e.target.value })} />
              <input className="field" placeholder="Price" inputMode="decimal" value={newSize.priceDollars} onChange={e => setNewSize({ ...newSize, priceDollars: e.target.value.replace(/[^0-9.]/g, '') })} />
              <input className="field" type="number" placeholder="Qty" value={newSize.stock} onChange={e => setNewSize({ ...newSize, stock: clampInt(e.target.value, 0, 1000000, 0) })} />
            </div>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button onClick={() => void addSize()} disabled={addBusy} style={{ ...btn(ACCENT, '#fff'), padding: '.45rem 1rem', minHeight: '2.3rem' }}>{addBusy ? 'Adding…' : 'Add size'}</button>
              <button onClick={() => setNewSize(null)} style={{ ...btnGhost('var(--text-3)'), padding: '.45rem 1rem', minHeight: '2.3rem' }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setNewSize({ ...BLANK_VROW })} style={{ ...btnGhost('var(--text-2)'), marginTop: '.6rem' }}>+ Add size</button>
        )}
      </div>
    </div>
  )
}

// ── The panel ──────────────────────────────────────────────────────────────────

type SubTab = 'products' | 'categories' | 'inventory'

export default function CatalogPanel({ isDemo = false }: { isDemo?: boolean }) {
  // `view_store` (040) is the shop read: the catalog, the stock levels and the
  // takings, without a write anywhere. `manage_products` is what 025 has always
  // gated the catalog write on, and it is unchanged — so a view_store holder
  // browses the products and opens no editor.
  const { can } = usePermissions()
  const canManage = isDemo || can('*') || can('manage_products')

  const [tab, setTab] = useState<SubTab>('products')

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [prods, cats] = await Promise.all([fetchProducts(isDemo), fetchCategories(isDemo)])
    if (prods === null) { setOutage(true); setProducts([]) }
    else { setOutage(false); setProducts(prods) }
    setCategories(cats ?? [])
    setLoading(false)
  }, [isDemo])

  useEffect(() => { if (tab === 'products') void load() }, [load, tab])

  const catName = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])

  const editing = useMemo(() => products.find(p => p.id === editingId) ?? null, [products, editingId])

  const patchProductFields = (id: string, f: Fields) => {
    setProducts(list => list.map(p => p.id === id ? {
      ...p, name: f.name.trim(), slug: f.slug.trim() || slugify(f.name), description: f.description.trim() || null,
      categoryId: f.categoryId || null, priceCents: dollarsToCents(f.priceDollars),
      sku: f.sku.trim() || null, imageUrl: f.imageUrl.trim() || null, isActive: f.isActive,
    } : p))
  }
  const setVariants = (productId: string, variants: ProductVariant[]) =>
    setProducts(list => list.map(p => p.id === productId ? { ...p, variants } : p))

  const productsView = (
    <div className="dash-pad">
      {isDemo && <DemoBanner note="Create, edit and remove sample products — nothing is saved." />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <div>
          <p style={{ ...microLabel, marginBottom: '.4rem' }}>What Axis sells</p>
          <h2 style={heading}>Products</h2>
        </div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button onClick={() => void load()} style={btnGhost('var(--text-2)')}>↺ Refresh</button>
          {canManage && !creating && !editing && <button onClick={() => setCreating(true)} style={btn(ACCENT, '#fff')}>+ Add product</button>}
        </div>
      </div>
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.65, marginBottom: '1.25rem', maxWidth: 560 }}>
        {canManage
          ? 'Each product has one or more sizes. Price is set here in dollars and stored to the cent; stock is set in the Inventory tab.'
          : 'Every product and size, including the ones hidden from the storefront. Read-only.'}
      </p>

      {canManage && creating && (
        <div style={{ maxWidth: 760, marginBottom: '1.5rem' }}>
          <CreateProduct
            categories={categories}
            isDemo={isDemo}
            onCreated={p => { setProducts(list => [p, ...list]); setCreating(false) }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {canManage && editing && (
        <div style={{ maxWidth: 760, marginBottom: '1.5rem' }}>
          <EditProduct
            product={editing}
            categories={categories}
            isDemo={isDemo}
            onPatched={patchProductFields}
            onDeleted={id => { setProducts(list => list.filter(p => p.id !== id)); setEditingId(null) }}
            onVariants={setVariants}
            onClose={() => setEditingId(null)}
          />
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading products…</p>
      ) : outage ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center', maxWidth: 760 }}>
          <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>Couldn&rsquo;t load the catalog.</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>That&rsquo;s on our side — nothing has changed.</p>
          <button onClick={() => void load()} style={btnGhost('var(--text)')}>Try again</button>
        </div>
      ) : products.length === 0 && !creating ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.85rem', maxWidth: 760 }}>
          {canManage ? 'No products yet. Add the first one.' : 'No products yet.'}
        </p>
      ) : (
        <div style={{ border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden', maxWidth: 760 }}>
          {products.map(p => (
            <div key={p.id} onClick={canManage ? () => { setEditingId(p.id); setCreating(false) } : undefined}
              style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '.9rem 1.1rem', borderBottom: '1px solid var(--surface)', cursor: canManage ? 'pointer' : 'default', background: editingId === p.id ? 'var(--surface)' : 'transparent' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: p.isActive ? 'var(--text)' : 'var(--text-4)', fontWeight: 700, fontSize: '.9rem' }}>{p.name}</span>
                  {!p.isActive && <span style={{ color: 'var(--text-4)', fontSize: '.58rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', border: '1px solid var(--border-mid)', padding: '.1rem .4rem', borderRadius: '.2rem' }}>Hidden</span>}
                </div>
                <span style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>
                  {p.categoryId ? (catName.get(p.categoryId) ?? 'Uncategorised') : 'Uncategorised'} · {p.variants.length} {p.variants.length === 1 ? 'size' : 'sizes'} · {totalStock(p)} in stock
                </span>
              </div>
              <span style={{ color: 'var(--text-2)', fontWeight: 900, fontSize: '.85rem', whiteSpace: 'nowrap' }}>{fmtMoney(p.priceCents)}</span>
              {canManage && <span aria-hidden style={{ color: 'var(--text-4)', fontSize: '1.2rem', lineHeight: 1 }}>›</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const tabs: [SubTab, string][] = [['products', 'Products'], ['categories', 'Categories'], ['inventory', 'Inventory']]

  return (
    <div>
      {/* Sub-tab bar — Catalog is the top nav entry; these three live inside it. */}
      <div style={{ display: 'flex', gap: '.4rem', padding: '1rem 2rem 0', borderBottom: '1px solid var(--surface)', flexWrap: 'wrap' }}>
        {tabs.map(([key, label]) => {
          const on = tab === key
          return (
            <button key={key} onClick={() => { setTab(key); setCreating(false); setEditingId(null) }}
              style={{
                background: 'none', border: 'none', borderBottom: `2px solid ${on ? ACCENT : 'transparent'}`,
                color: on ? 'var(--text)' : 'var(--text-4)', fontSize: '.7rem', fontWeight: 900,
                letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem .9rem',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {label}
            </button>
          )
        })}
      </div>

      {tab === 'products' && productsView}
      {tab === 'categories' && <CategoriesPanel isDemo={isDemo} />}
      {tab === 'inventory' && <InventoryPanel isDemo={isDemo} />}
    </div>
  )
}
