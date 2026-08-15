import { useState, useEffect, useCallback } from 'react'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { usePermissions } from '../../lib/usePermissions'
import { clampInt } from '../../utils/sanitize'
import {
  fetchCategories, createCategory, updateCategory, deleteCategory, slugify,
  type ProductCategory,
} from '../../lib/catalog'

/**
 * The groups the shop is sorted into — Apparel, Accessories.
 *
 * A category is small: a name, the slug the storefront reads, a sort position,
 * and whether it is live. Deleting one does not delete its products — the
 * database sets their category to null (on delete set null) — so the copy says
 * so, and this screen never pretends a delete is destructive when it is not.
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

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick} role="switch" aria-checked={on} aria-label={label}
      style={{
        flexShrink: 0, width: 38, height: 22, borderRadius: 999, padding: 0,
        background: on ? ACCENT : 'var(--surface-2)',
        border: `1px solid ${on ? ACCENT : 'var(--border-mid)'}`,
        cursor: 'pointer', position: 'relative', transition: 'background .15s',
      }}
    >
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: on ? '#fff' : 'var(--text-4)', transition: 'left .15s' }} />
    </button>
  )
}

interface Draft { name: string; slug: string; sortOrder: number; isActive: boolean }
const BLANK: Draft = { name: '', slug: '', sortOrder: 0, isActive: true }

export default function CategoriesPanel({ isDemo = false }: { isDemo?: boolean }) {
  // 025 gives the staff read to manage_categories OR manage_products and the
  // write to manage_categories alone; 040 adds view_store to the read. So the
  // list can be visible to somebody who may not touch a row, and this is that
  // person's version of the screen.
  const { can } = usePermissions()
  const canManage = isDemo || can('*') || can('manage_categories')

  const [cats, setCats] = useState<ProductCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState<Draft>(BLANK)
  const [busy, setBusy] = useState(false)
  const [armedDelete, setArmedDelete] = useState<string | null>(null)

  const say = (msg: string) => { setFlash(msg); window.setTimeout(() => setFlash(null), 2500) }

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await fetchCategories(isDemo)
    if (rows === null) { setOutage(true); setCats([]) }
    else { setOutage(false); setCats(rows) }
    setLoading(false)
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  const startEdit = (c: ProductCategory) => {
    setEditingId(c.id)
    setDraft({ name: c.name, slug: c.slug, sortOrder: c.sortOrder, isActive: c.isActive })
    setError(null)
    setArmedDelete(null)
  }

  const saveEdit = async () => {
    if (!editingId || busy) return
    setBusy(true); setError(null)
    const res = await updateCategory(editingId, draft, isDemo)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setCats(list => list.map(c => c.id === editingId ? { ...c, ...draft, slug: draft.slug.trim() || slugify(draft.name) } : c))
    setEditingId(null)
    say('Category saved.')
  }

  const add = async () => {
    if (busy) return
    setBusy(true); setError(null)
    const res = await createCategory(newDraft, isDemo)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setCats(list => [...list, res.value].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)))
    setNewDraft(BLANK)
    setAdding(false)
    say('Category added.')
  }

  const remove = async (id: string) => {
    setBusy(true); setError(null)
    const res = await deleteCategory(id, isDemo)
    setBusy(false)
    setArmedDelete(null)
    if (!res.ok) { setError(res.message); return }
    setCats(list => list.filter(c => c.id !== id))
    say('Category removed. Any products in it are now uncategorised.')
  }

  const draftFields = (d: Draft, set: (d: Draft) => void, idPrefix: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.75rem', alignItems: 'end' }}>
      <div>
        <label className="field-label" htmlFor={`${idPrefix}-name`}>Name</label>
        <input id={`${idPrefix}-name`} className="field" maxLength={80} value={d.name}
          placeholder="Apparel"
          onChange={e => set({ ...d, name: e.target.value, slug: d.slug || slugify(e.target.value) })} />
      </div>
      <div>
        <label className="field-label" htmlFor={`${idPrefix}-slug`}>Slug</label>
        <input id={`${idPrefix}-slug`} className="field" maxLength={60} value={d.slug}
          placeholder="apparel"
          onChange={e => set({ ...d, slug: e.target.value })} />
      </div>
      <div style={{ maxWidth: 110 }}>
        <label className="field-label" htmlFor={`${idPrefix}-sort`}>Order</label>
        <input id={`${idPrefix}-sort`} className="field" type="number" value={d.sortOrder}
          onChange={e => set({ ...d, sortOrder: clampInt(e.target.value, 0, 9999, 0) })} />
      </div>
      <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', cursor: 'pointer', paddingBottom: '.5rem' }}>
        <Switch on={d.isActive} onClick={() => set({ ...d, isActive: !d.isActive })} label="Active" />
        <span style={{ color: 'var(--text-3)', fontSize: '.75rem', fontWeight: 600 }}>{d.isActive ? 'Live' : 'Hidden'}</span>
      </label>
    </div>
  )

  return (
    <div className="dash-pad">
      {isDemo && <DemoBanner note="Add, rename and hide sample categories — nothing is saved." />}

      <p style={{ ...microLabel, marginBottom: '.4rem' }}>The shop, grouped</p>
      <h2 style={{ ...heading, marginBottom: '.6rem' }}>Categories</h2>
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.65, marginBottom: '1.25rem', maxWidth: 560 }}>
        How the merch is sorted for a shopper. A hidden category and its products drop off the storefront;
        removing one leaves its products in place, just uncategorised.
      </p>

      {error && <div role="alert" style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.7rem 1rem', marginBottom: '1rem' }}><span style={{ color: DANGER, fontSize: '.8rem' }}>{error}</span></div>}
      {flash && <div style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.35)', borderRadius: '.25rem', padding: '.7rem 1rem', marginBottom: '1rem' }}><span style={{ color: GREEN, fontSize: '.8rem' }}>{flash}</span></div>}

      {loading ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading categories…</p>
      ) : outage ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>Couldn&rsquo;t load categories.</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>That&rsquo;s on our side — nothing has changed.</p>
          <button onClick={() => void load()} style={btnGhost('var(--text)')}>Try again</button>
        </div>
      ) : (
        <div style={{ maxWidth: 760 }}>
          <div style={{ border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden', marginBottom: '1.25rem' }}>
            {cats.length === 0 && (
              <p style={{ padding: '1.25rem', color: 'var(--text-4)', fontSize: '.82rem', textAlign: 'center' }}>
                {canManage ? 'No categories yet. Add the first one below.' : 'No categories yet.'}
              </p>
            )}
            {cats.map(c => (
              <div key={c.id} style={{ borderBottom: '1px solid var(--surface)', padding: '.9rem 1.1rem', background: editingId === c.id ? 'var(--surface)' : 'transparent' }}>
                {canManage && editingId === c.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
                    {draftFields(draft, setDraft, `edit-${c.id}`)}
                    <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                      <button onClick={() => void saveEdit()} disabled={busy} style={btn(ACCENT, '#fff')}>{busy ? 'Saving…' : 'Save'}</button>
                      <button onClick={() => setEditingId(null)} style={btnGhost('var(--text-3)')}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                        <span style={{ color: c.isActive ? 'var(--text)' : 'var(--text-4)', fontWeight: 700, fontSize: '.9rem' }}>{c.name}</span>
                        {!c.isActive && <span style={{ color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', border: '1px solid var(--border-mid)', padding: '.1rem .4rem', borderRadius: '.2rem' }}>Hidden</span>}
                      </div>
                      <span style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>/{c.slug} · order {c.sortOrder}</span>
                    </div>
                    {!canManage ? null : armedDelete === c.id ? (
                      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-2)', fontSize: '.72rem' }}>Remove it?</span>
                        <button onClick={() => void remove(c.id)} disabled={busy} style={btn(DANGER, '#fff')}>Remove</button>
                        <button onClick={() => setArmedDelete(null)} style={btnGhost('var(--text-3)')}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
                        <button onClick={() => startEdit(c)} style={btnGhost('var(--text-2)')}>Edit</button>
                        <button onClick={() => setArmedDelete(c.id)} style={btnGhost(DANGER)}>Delete</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {!canManage ? null : adding ? (
            <div style={{ border: `1px solid ${ACCENT}55`, borderRadius: '.25rem', padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
              <p style={microLabel}>New category</p>
              {draftFields(newDraft, setNewDraft, 'new')}
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                <button onClick={() => void add()} disabled={busy || !newDraft.name.trim()} style={btn(newDraft.name.trim() ? ACCENT : 'var(--surface-2)', newDraft.name.trim() ? '#fff' : 'var(--text-4)')}>{busy ? 'Adding…' : 'Add category'}</button>
                <button onClick={() => { setAdding(false); setNewDraft(BLANK); setError(null) }} style={btnGhost('var(--text-3)')}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setAdding(true); setNewDraft(BLANK) }} style={btn(ACCENT, '#fff')}>+ Add category</button>
          )}
        </div>
      )}
    </div>
  )
}
