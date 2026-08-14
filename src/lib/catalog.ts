import { supabase, supabaseConfigured } from './supabase'

/**
 * The merch catalog (migration 025).
 *
 * Team-branded merchandise — tees, hoodies — grouped into categories, each with
 * one or more size VARIANTS that carry the stock. This module is the whole data
 * layer the admin panels sit on, plus `fetchStorefrontProducts` for the public
 * shop that 026 builds on top.
 *
 * Two rules from the database are mirrored here so the UI never lies about them:
 *   • Money is integer cents. A price is never a float, and never divided until
 *     it is being formatted for display (see fmtMoney in lib/availability).
 *   • Stock moves ONLY through `adjustStock`, which calls the SECURITY DEFINER
 *     `adjust_stock` RPC. Nothing in this module writes `stock_qty` directly.
 *
 * Every function takes `isDemo`. In demo mode (or with no Supabase configured)
 * reads return the sample catalog and writes succeed locally without a round
 * trip — the panels hold the optimistic state, exactly as the rest of the
 * dashboard does. Nothing is persisted.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProductCategory {
  id: string
  name: string
  slug: string
  sortOrder: number
  isActive: boolean
  createdAt: string
}

export interface ProductVariant {
  id: string
  productId: string
  /** 'S' | 'M' | … | 'Default' for a product with no real sizes. */
  name: string | null
  sku: string | null
  /** null = inherit the product's price. Integer cents when set. */
  priceCentsOverride: number | null
  stockQty: number
  createdAt: string
}

export interface Product {
  id: string
  name: string
  slug: string | null
  description: string | null
  categoryId: string | null
  /** The default price in integer cents. A variant may override it. */
  priceCents: number
  sku: string | null
  imageUrl: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  variants: ProductVariant[]
}

export type Result<T> = { ok: true; value: T } | { ok: false; message: string }

/** At or below this many units, a variant is flagged low in the inventory panel. */
export const LOW_STOCK_THRESHOLD = 5

export function isLowStock(qty: number): boolean {
  return qty <= LOW_STOCK_THRESHOLD
}

/** The effective price of a variant: its override, or the product's own price. */
export function variantPriceCents(product: Product, variant: ProductVariant): number {
  return variant.priceCentsOverride ?? product.priceCents
}

/** Total units of a product across its variants. */
export function totalStock(product: Product): number {
  return product.variants.reduce((sum, v) => sum + v.stockQty, 0)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const isDemoMode = (isDemo: boolean) => isDemo || !supabaseConfigured

/** A url-safe slug from a name. Empty for a name that is all punctuation. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * A dollars string from a text field to integer cents, clamped. The float is
 * transient — only ever the value being typed; what this returns and what is
 * stored is always a whole number of cents, never a float on a price.
 */
export function dollarsToCents(input: string): number {
  const n = parseFloat(String(input ?? '').replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(Math.round(n * 100), 100_000_00) // cap at $100k, defensive
}

/** Integer cents to a plain dollars string for an input field ('25', '25.50'). */
export function centsToDollarString(cents: number | null): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}

/** Turn a PostgREST error into a sentence a person can act on. */
function messageFor(error: { code?: string; message?: string } | null): string {
  if (!error) return 'That did not save. Reload and try again.'
  switch (error.code) {
    case '23505': return 'That slug or SKU is already in use. Pick another.'
    case '23514': return 'One of those values is out of range — a price cannot be negative.'
    case '42501': return 'You do not have permission to make that change.'
    default:      return 'That did not save. Reload and try again.'
  }
}

// ── Row mappers ────────────────────────────────────────────────────────────────

interface CategoryRow { id: string; name: string; slug: string; sort_order: number; is_active: boolean; created_at: string }
interface VariantRow { id: string; product_id: string; name: string | null; sku: string | null; price_cents_override: number | null; stock_qty: number; created_at: string }
interface ProductRow {
  id: string; name: string; slug: string | null; description: string | null
  category_id: string | null; price_cents: number; sku: string | null; image_url: string | null
  is_active: boolean; created_at: string; updated_at: string
  product_variants?: VariantRow[]
}

const CATEGORY_COLS = 'id,name,slug,sort_order,is_active,created_at'
const VARIANT_COLS  = 'id,product_id,name,sku,price_cents_override,stock_qty,created_at'
const PRODUCT_COLS  =
  `id,name,slug,description,category_id,price_cents,sku,image_url,is_active,created_at,updated_at,product_variants(${VARIANT_COLS})`

function mapCategory(r: CategoryRow): ProductCategory {
  return { id: r.id, name: r.name, slug: r.slug, sortOrder: r.sort_order, isActive: r.is_active, createdAt: r.created_at }
}

function mapVariant(r: VariantRow): ProductVariant {
  return {
    id: r.id, productId: r.product_id, name: r.name, sku: r.sku,
    priceCentsOverride: r.price_cents_override, stockQty: r.stock_qty, createdAt: r.created_at,
  }
}

function mapProduct(r: ProductRow): Product {
  const variants = (r.product_variants ?? [])
    .map(mapVariant)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return {
    id: r.id, name: r.name, slug: r.slug, description: r.description,
    categoryId: r.category_id, priceCents: r.price_cents, sku: r.sku, imageUrl: r.image_url,
    isActive: r.is_active, createdAt: r.created_at, updatedAt: r.updated_at, variants,
  }
}

// ── Categories ─────────────────────────────────────────────────────────────────

/** All categories, sorted. `null` is an outage — never render it as "empty". */
export async function fetchCategories(isDemo = false): Promise<ProductCategory[] | null> {
  if (isDemoMode(isDemo)) return DEMO_CATEGORIES.map(c => ({ ...c }))

  const { data, error } = await supabase
    .from('product_categories')
    .select(CATEGORY_COLS)
    .order('sort_order')
    .order('name')

  if (error) return null
  return (data as CategoryRow[]).map(mapCategory)
}

export interface CategoryInput {
  name: string
  slug: string
  sortOrder: number
  isActive: boolean
}

export async function createCategory(input: CategoryInput, isDemo = false): Promise<Result<ProductCategory>> {
  const row = {
    name: input.name.trim(),
    slug: (input.slug.trim() || slugify(input.name)),
    sort_order: input.sortOrder,
    is_active: input.isActive,
  }
  if (!row.name) return { ok: false, message: 'A category needs a name.' }
  if (!row.slug) return { ok: false, message: 'A category needs a slug.' }

  if (isDemoMode(isDemo)) {
    return { ok: true, value: { id: newId(), name: row.name, slug: row.slug, sortOrder: row.sort_order, isActive: row.is_active, createdAt: new Date().toISOString() } }
  }

  const { data, error } = await supabase.from('product_categories').insert(row).select(CATEGORY_COLS).single()
  if (error) return { ok: false, message: messageFor(error) }
  return { ok: true, value: mapCategory(data as CategoryRow) }
}

export async function updateCategory(id: string, patch: Partial<CategoryInput>, isDemo = false): Promise<Result<void>> {
  if (isDemoMode(isDemo)) return { ok: true, value: undefined }

  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name.trim()
  if (patch.slug !== undefined) row.slug = patch.slug.trim()
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder
  if (patch.isActive !== undefined) row.is_active = patch.isActive

  const { error } = await supabase.from('product_categories').update(row).eq('id', id)
  if (error) return { ok: false, message: messageFor(error) }
  return { ok: true, value: undefined }
}

export async function deleteCategory(id: string, isDemo = false): Promise<Result<void>> {
  if (isDemoMode(isDemo)) return { ok: true, value: undefined }
  const { error } = await supabase.from('product_categories').delete().eq('id', id)
  if (error) return { ok: false, message: messageFor(error) }
  return { ok: true, value: undefined }
}

// ── Products ───────────────────────────────────────────────────────────────────

/** Every product with its variants, for the admin. `null` is an outage. */
export async function fetchProducts(isDemo = false): Promise<Product[] | null> {
  if (isDemoMode(isDemo)) return DEMO_PRODUCTS.map(cloneProduct)

  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_COLS)
    .order('name')

  if (error) return null
  return (data as ProductRow[]).map(mapProduct)
}

/** Active products with variants, for the public shop 026 builds. `null` is an outage. */
export async function fetchStorefrontProducts(): Promise<Product[] | null> {
  if (!supabaseConfigured) return DEMO_PRODUCTS.filter(p => p.isActive).map(cloneProduct)

  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_COLS)
    .eq('is_active', true)
    .order('name')

  if (error) return null
  return (data as ProductRow[]).map(mapProduct)
}

export interface VariantInput {
  name: string | null
  sku: string | null
  priceCentsOverride: number | null
  stockQty: number
}

export interface ProductInput {
  name: string
  slug: string | null
  description: string | null
  categoryId: string | null
  priceCents: number
  sku: string | null
  imageUrl: string | null
  isActive: boolean
  /** Sizes. Empty = the product gets a single implicit 'Default' variant. */
  variants: VariantInput[]
}

/** The single implicit variant a product with no real sizes gets. */
function defaultVariants(variants: VariantInput[]): VariantInput[] {
  return variants.length > 0
    ? variants
    : [{ name: 'Default', sku: null, priceCentsOverride: null, stockQty: 0 }]
}

export async function createProduct(input: ProductInput, isDemo = false): Promise<Result<Product>> {
  const name = input.name.trim()
  if (!name) return { ok: false, message: 'A product needs a name.' }
  if (!(input.priceCents >= 0)) return { ok: false, message: 'A price cannot be negative.' }

  const slug = (input.slug?.trim() || slugify(name)) || null
  const variants = defaultVariants(input.variants)

  if (isDemoMode(isDemo)) {
    const pid = newId()
    const now = new Date().toISOString()
    return {
      ok: true,
      value: {
        id: pid, name, slug, description: input.description, categoryId: input.categoryId,
        priceCents: input.priceCents, sku: input.sku, imageUrl: input.imageUrl,
        isActive: input.isActive, createdAt: now, updatedAt: now,
        variants: variants.map((v, i) => ({
          id: newId(), productId: pid, name: v.name, sku: v.sku,
          priceCentsOverride: v.priceCentsOverride, stockQty: v.stockQty,
          createdAt: new Date(Date.now() + i).toISOString(),
        })),
      },
    }
  }

  const { data, error } = await supabase
    .from('products')
    .insert({
      name, slug, description: input.description, category_id: input.categoryId,
      price_cents: input.priceCents, sku: input.sku, image_url: input.imageUrl, is_active: input.isActive,
    })
    .select(PRODUCT_COLS)
    .single()

  if (error) return { ok: false, message: messageFor(error) }
  const product = mapProduct(data as ProductRow)

  // Variants are a second write so a failure here is legible rather than a
  // partial row inside one opaque insert. Stock starts here at the seeded level;
  // every change AFTER creation goes through adjustStock so it lands in the log.
  const variantRows = variants.map(v => ({
    product_id: product.id, name: v.name, sku: v.sku,
    price_cents_override: v.priceCentsOverride, stock_qty: v.stockQty,
  }))
  const { data: vData, error: vError } = await supabase
    .from('product_variants')
    .insert(variantRows)
    .select(VARIANT_COLS)

  if (vError) return { ok: false, message: messageFor(vError) }
  product.variants = (vData as VariantRow[]).map(mapVariant).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return { ok: true, value: product }
}

export type ProductPatch = Partial<Omit<ProductInput, 'variants'>>

export async function updateProduct(id: string, patch: ProductPatch, isDemo = false): Promise<Result<void>> {
  if (patch.priceCents !== undefined && !(patch.priceCents >= 0)) {
    return { ok: false, message: 'A price cannot be negative.' }
  }
  if (isDemoMode(isDemo)) return { ok: true, value: undefined }

  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name.trim()
  if (patch.slug !== undefined) row.slug = patch.slug?.trim() || null
  if (patch.description !== undefined) row.description = patch.description
  if (patch.categoryId !== undefined) row.category_id = patch.categoryId
  if (patch.priceCents !== undefined) row.price_cents = patch.priceCents
  if (patch.sku !== undefined) row.sku = patch.sku
  if (patch.imageUrl !== undefined) row.image_url = patch.imageUrl
  if (patch.isActive !== undefined) row.is_active = patch.isActive

  const { error } = await supabase.from('products').update(row).eq('id', id)
  if (error) return { ok: false, message: messageFor(error) }
  return { ok: true, value: undefined }
}

export async function deleteProduct(id: string, isDemo = false): Promise<Result<void>> {
  if (isDemoMode(isDemo)) return { ok: true, value: undefined }
  // Variants cascade in the database (on delete cascade).
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) return { ok: false, message: messageFor(error) }
  return { ok: true, value: undefined }
}

// ── Variants ───────────────────────────────────────────────────────────────────

export async function createVariant(productId: string, input: VariantInput, isDemo = false): Promise<Result<ProductVariant>> {
  if (input.priceCentsOverride !== null && !(input.priceCentsOverride >= 0)) {
    return { ok: false, message: 'A price cannot be negative.' }
  }
  if (isDemoMode(isDemo)) {
    return { ok: true, value: { id: newId(), productId, name: input.name, sku: input.sku, priceCentsOverride: input.priceCentsOverride, stockQty: input.stockQty, createdAt: new Date().toISOString() } }
  }

  const { data, error } = await supabase
    .from('product_variants')
    .insert({ product_id: productId, name: input.name, sku: input.sku, price_cents_override: input.priceCentsOverride, stock_qty: input.stockQty })
    .select(VARIANT_COLS)
    .single()

  if (error) return { ok: false, message: messageFor(error) }
  return { ok: true, value: mapVariant(data as VariantRow) }
}

export type VariantPatch = Partial<Pick<VariantInput, 'name' | 'sku' | 'priceCentsOverride'>>

/**
 * Edit a variant's IDENTITY — its size name, SKU or price override. Note it does
 * not touch stock_qty: that only ever moves through adjustStock, so an edit form
 * here can never silently rewrite a unit count.
 */
export async function updateVariant(id: string, patch: VariantPatch, isDemo = false): Promise<Result<void>> {
  if (patch.priceCentsOverride !== undefined && patch.priceCentsOverride !== null && !(patch.priceCentsOverride >= 0)) {
    return { ok: false, message: 'A price cannot be negative.' }
  }
  if (isDemoMode(isDemo)) return { ok: true, value: undefined }

  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.sku !== undefined) row.sku = patch.sku
  if (patch.priceCentsOverride !== undefined) row.price_cents_override = patch.priceCentsOverride

  const { error } = await supabase.from('product_variants').update(row).eq('id', id)
  if (error) return { ok: false, message: messageFor(error) }
  return { ok: true, value: undefined }
}

export async function deleteVariant(id: string, isDemo = false): Promise<Result<void>> {
  if (isDemoMode(isDemo)) return { ok: true, value: undefined }
  const { error } = await supabase.from('product_variants').delete().eq('id', id)
  if (error) return { ok: false, message: messageFor(error) }
  return { ok: true, value: undefined }
}

// ── Stock ──────────────────────────────────────────────────────────────────────

/**
 * Move a variant's stock by `delta`, recording the reason in the audit trail.
 * Wraps the `adjust_stock` RPC, which is where the authorisation check and the
 * ledger write actually live — this is only the seam the UI calls. Returns the
 * new balance so a caller can reconcile without a re-read.
 */
export async function adjustStock(variantId: string, delta: number, reason: string, isDemo = false): Promise<Result<number>> {
  if (!Number.isInteger(delta) || delta === 0) {
    return { ok: false, message: 'Enter a whole number of units to add or remove.' }
  }
  if (isDemoMode(isDemo)) {
    // The panel holds the running balance in demo mode; echo a non-negative one.
    return { ok: true, value: Math.max(0, delta) }
  }

  const { data, error } = await supabase.rpc('adjust_stock', {
    p_variant: variantId,
    p_delta: delta,
    p_reason: reason.trim() || null,
  })

  if (error) {
    if (error.code === '23514') return { ok: false, message: 'That would drop the count below zero — there is not that much in stock.' }
    if (error.code === '42501') return { ok: false, message: 'You do not have permission to change stock.' }
    return { ok: false, message: 'That did not save. Reload and try again.' }
  }
  return { ok: true, value: Number(data) }
}

// ── Demo seed (mirrors migration 025) ──────────────────────────────────────────

function cloneProduct(p: Product): Product {
  return { ...p, variants: p.variants.map(v => ({ ...v })) }
}

const DEMO_CAT_APPAREL = 'demo-cat-apparel'
const DEMO_CAT_ACCESS  = 'demo-cat-accessories'

export const DEMO_CATEGORIES: ProductCategory[] = [
  { id: DEMO_CAT_APPAREL, name: 'Apparel',     slug: 'apparel',     sortOrder: 10, isActive: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: DEMO_CAT_ACCESS,  name: 'Accessories', slug: 'accessories', sortOrder: 20, isActive: true, createdAt: '2026-01-01T00:00:00Z' },
]

function demoVariant(productId: string, i: number, name: string, sku: string, stock: number): ProductVariant {
  return {
    id: `demo-var-${productId}-${name.toLowerCase()}`,
    productId, name, sku, priceCentsOverride: null, stockQty: stock,
    createdAt: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 1000).toISOString(),
  }
}

export const DEMO_PRODUCTS: Product[] = [
  {
    id: 'demo-team-axis-tee', name: 'Team Axis Tee', slug: 'team-axis-tee',
    description: 'Soft cotton training tee with the Axis mark across the chest. Runs true to size.',
    categoryId: DEMO_CAT_APPAREL, priceCents: 2500, sku: 'AXIS-TEE', imageUrl: null,
    isActive: true, createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    variants: [
      demoVariant('demo-team-axis-tee', 0, 'S',  'AXIS-TEE-S',  12),
      demoVariant('demo-team-axis-tee', 1, 'M',  'AXIS-TEE-M',  20),
      demoVariant('demo-team-axis-tee', 2, 'L',  'AXIS-TEE-L',  18),
      demoVariant('demo-team-axis-tee', 3, 'XL', 'AXIS-TEE-XL',  8),
    ],
  },
  {
    id: 'demo-axis-hoodie', name: 'Axis Hoodie', slug: 'axis-hoodie',
    description: 'Midweight fleece hoodie for warm-ups and the drive home. Embroidered logo.',
    categoryId: DEMO_CAT_APPAREL, priceCents: 5500, sku: 'AXIS-HOOD', imageUrl: null,
    isActive: true, createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z',
    variants: [
      demoVariant('demo-axis-hoodie', 0, 'M',  'AXIS-HOOD-M', 10),
      demoVariant('demo-axis-hoodie', 1, 'L',  'AXIS-HOOD-L', 14),
      demoVariant('demo-axis-hoodie', 2, 'XL', 'AXIS-HOOD-XL', 3),
    ],
  },
]
