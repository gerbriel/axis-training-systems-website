import { useEffect, useState, useCallback } from 'react'
import DemoBanner from '../../../components/dashboard/DemoBanner'
import { COACHES } from '../../../data/coaches'
import { fmtDuration, fmtMoney } from '../../../lib/availability'
import {
  fetchAdminServices, createService, updateService, deleteService,
  fetchCoachOffers, setCoachOffered,
  type AdminServiceRow,
} from '../../../lib/settings'
import { clampInt } from '../../../utils/sanitize'
import { ACCENT, SettingsSection, Field, Toggle, Flash, Loading, useFlash, pageStyle } from './_shared'

/**
 * Services — the catalog every booking page sells from, and who sells what.
 *
 * Top half is the menu itself (booking_services): name, length, price. The
 * length is the part with teeth — it is what a booking occupies on a calendar.
 * Bottom half is the per-coach side (coach_booking_services): the same catalog
 * can appear whole on one coach's page and half on another's. Coaches flip
 * their own switches in their portal; this panel is the admin reaching the
 * same rows on their behalf.
 */

/** '' → no price at booking time (renders "price discussed on the call"). */
function parsePriceCents(input: string): number | null | 'invalid' {
  const t = input.trim().replace(/^\$/, '')
  if (!t) return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'invalid'
  return Math.round(parseFloat(t) * 100)
}

function centsToInput(cents: number | null): string {
  if (cents === null) return ''
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)
}

interface Draft {
  name: string
  description: string
  duration: string
  price: string
  priceNote: string
  order: string
}

const EMPTY_DRAFT: Draft = { name: '', description: '', duration: '30', price: '', priceNote: '', order: '0' }

const inputBtn = (busy: boolean): React.CSSProperties => ({
  background: busy ? 'var(--border)' : ACCENT, border: 'none', color: busy ? 'var(--text-3)' : '#fff',
  fontWeight: 900, fontSize: '.68rem', letterSpacing: '.12em', textTransform: 'uppercase',
  padding: '.75rem 1.3rem', borderRadius: '.25rem', cursor: busy ? 'default' : 'pointer',
  fontFamily: 'inherit', height: 'fit-content',
})

const ghostBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', fontSize: '.68rem',
  padding: '.35rem .7rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit',
}

// Module-level, not inline in the panel: an inline component is a new type
// every render, and React would remount the inputs mid-keystroke.
function DraftFields({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
        <Field label="Name" style={{ gridColumn: '1 / -1' }}>
          <input className="field" value={draft.name} maxLength={100} placeholder="1:1 Coaching Consultation" onChange={e => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Length (minutes)" hint="What a booking reserves on the calendar.">
          <input className="field" type="number" min={5} max={480} value={draft.duration} onChange={e => setDraft({ ...draft, duration: e.target.value })} />
        </Field>
        <Field label="Price (USD)" hint="Blank shows 'price discussed on the call'. 0 shows Free.">
          <input className="field" inputMode="decimal" placeholder="150" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} />
        </Field>
        <Field label="Price note" hint="Qualifier after the number, like /mo.">
          <input className="field" value={draft.priceNote} maxLength={20} placeholder="/mo" onChange={e => setDraft({ ...draft, priceNote: e.target.value })} />
        </Field>
        <Field label="Order" hint="Lower numbers list first.">
          <input className="field" type="number" min={0} max={100000} value={draft.order} onChange={e => setDraft({ ...draft, order: e.target.value })} />
        </Field>
      </div>
      <Field label="Description" style={{ marginTop: '1rem' }}>
        <textarea className="field" rows={2} maxLength={500} value={draft.description} placeholder="What this call is for, in a sentence or two." onChange={e => setDraft({ ...draft, description: e.target.value })} />
      </Field>
    </>
  )
}

export default function ServicesPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [rows, setRows] = useState<AdminServiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const { flash, show } = useFlash()

  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT)
  const [savingEdit, setSavingEdit] = useState(false)

  const [coachSlug, setCoachSlug] = useState<string>(COACHES[0]?.slug ?? '')
  const [offers, setOffers] = useState<Map<string, { on: boolean; override: number | null }>>(new Map())
  const [offersLoading, setOffersLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setRows(await fetchAdminServices(isDemo))
    setLoading(false)
  }, [isDemo])
  useEffect(() => { void load() }, [load])

  const loadOffers = useCallback(async () => {
    if (!coachSlug) return
    setOffersLoading(true)
    const list = await fetchCoachOffers(coachSlug, isDemo)
    setOffers(new Map(list.map(o => [o.service_id, { on: o.is_active, override: o.duration_minutes_override }])))
    setOffersLoading(false)
  }, [coachSlug, isDemo])
  useEffect(() => { void loadOffers() }, [loadOffers])

  // ── Catalog operations ─────────────────────────────────────────────────────

  const draftToPatch = (d: Draft) => {
    const price = parsePriceCents(d.price)
    if (price === 'invalid') return null
    return {
      name: d.name,
      description: d.description,
      duration_minutes: clampInt(d.duration, 5, 480, 30),
      price_cents: price,
      price_note: d.priceNote,
      sort_order: clampInt(d.order, 0, 100000, 0),
    }
  }

  const add = async () => {
    const patch = draftToPatch(addDraft)
    if (!patch) return show('The price needs to be a plain number, like 150 or 79.50.', false)
    setAdding(true)
    // New rows land at the end of the menu unless the admin typed an order.
    const sort = addDraft.order !== '0' && addDraft.order.trim() !== ''
      ? patch.sort_order
      : Math.max(0, ...rows.map(r => r.sort_order)) + 10
    const res = await createService({ ...patch, sort_order: sort }, isDemo)
    setAdding(false)
    if (!res.ok) return show(res.message, false)
    setAddDraft(EMPTY_DRAFT)
    await load()
    await loadOffers()
    show('Service added. Coaches can now switch it on — or use "Who offers what" below.')
  }

  const startEdit = (s: AdminServiceRow) => {
    setEditingId(s.id)
    setEditDraft({
      name: s.name, description: s.description ?? '', duration: String(s.duration_minutes),
      price: centsToInput(s.price_cents), priceNote: s.price_note ?? '', order: String(s.sort_order),
    })
  }

  const saveEdit = async (s: AdminServiceRow) => {
    const patch = draftToPatch(editDraft)
    if (!patch) return show('The price needs to be a plain number, like 150 or 79.50.', false)
    setSavingEdit(true)
    const res = await updateService(s.id, patch, isDemo)
    setSavingEdit(false)
    if (!res.ok) return show(res.message, false)
    setEditingId(null)
    await load()
    show('Saved.')
  }

  const toggleActive = async (s: AdminServiceRow) => {
    setRows(rs => rs.map(x => (x.id === s.id ? { ...x, is_active: !x.is_active } : x)))
    const res = await updateService(s.id, { is_active: !s.is_active }, isDemo)
    if (!res.ok) { show(res.message, false); await load() }
  }

  const remove = async (s: AdminServiceRow) => {
    if (!window.confirm(`Delete "${s.name}"? It comes off every coach's booking page. Past bookings keep their records.`)) return
    const res = await deleteService(s.id, isDemo)
    if (!res.ok) return show(res.message, false)
    if (editingId === s.id) setEditingId(null)
    await load()
    await loadOffers()
    show('Removed.')
  }

  // ── Per-coach offering ─────────────────────────────────────────────────────

  const toggleOffer = async (s: AdminServiceRow) => {
    const current = offers.get(s.id)
    const next = !(current?.on ?? false)
    setOffers(prev => {
      const m = new Map(prev)
      m.set(s.id, { on: next, override: current?.override ?? null })
      return m
    })
    const res = await setCoachOffered(coachSlug, s.id, next, isDemo)
    if (!res.ok) { show(res.message, false); await loadOffers() }
  }

  if (loading) return <Loading />

  const coach = COACHES.find(c => c.slug === coachSlug)
  const activeRows = rows.filter(r => r.is_active)

  return (
    <div style={pageStyle}>
      {isDemo && <DemoBanner />}
      <Flash flash={flash} />

      {/* ── The catalog ─────────────────────────────────────────────────── */}
      <SettingsSection
        title="Services"
        intro="The menu every booking page sells from. The length is what a booking reserves on a coach's calendar. Switching one off hides it from every coach's page without losing it; deleting it removes it for good (past bookings keep their records either way)."
      >
        {rows.length === 0
          ? <p style={{ color: 'var(--text-4)', fontSize: '.8rem', marginBottom: '1.5rem' }}>No services yet — add the first one below.</p>
          : (
            <div style={{ display: 'grid', gap: 1, background: 'var(--surface-2)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden', marginBottom: '1.5rem' }}>
              {rows.map(s => {
                const price = fmtMoney(s.price_cents)
                const editing = editingId === s.id
                return (
                  <div key={s.id} style={{ background: 'var(--bg)', padding: '.9rem 1rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Toggle on={s.is_active} onChange={() => toggleActive(s)} label={`Toggle ${s.name}`} />
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <p style={{ color: s.is_active ? 'var(--text)' : 'var(--text-4)', fontWeight: 700, fontSize: '.88rem' }}>{s.name}</p>
                        <p style={{ color: 'var(--text-4)', fontSize: '.73rem', marginTop: '.15rem' }}>
                          {fmtDuration(s.duration_minutes)}
                          {price ? ` · ${price}${s.price_note ?? ''}` : ' · price discussed on the call'}
                          {!s.is_active && ' · hidden from booking pages'}
                        </p>
                      </div>
                      <button onClick={() => (editing ? setEditingId(null) : startEdit(s))} style={ghostBtn}>
                        {editing ? 'Close' : 'Edit'}
                      </button>
                      <button onClick={() => remove(s)} style={ghostBtn}>Delete</button>
                    </div>

                    {editing && (
                      <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                        <DraftFields draft={editDraft} setDraft={setEditDraft} />
                        <div style={{ marginTop: '1rem' }}>
                          <button onClick={() => saveEdit(s)} disabled={savingEdit} style={inputBtn(savingEdit)}>
                            {savingEdit ? 'Saving…' : 'Save changes'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
          <h3 style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.85rem' }}>Add a service</h3>
          <DraftFields draft={addDraft} setDraft={setAddDraft} />
          <div style={{ marginTop: '1rem' }}>
            <button onClick={add} disabled={adding} style={inputBtn(adding)}>{adding ? 'Adding…' : 'Add service'}</button>
          </div>
        </div>
      </SettingsSection>

      {/* ── Who offers what ─────────────────────────────────────────────── */}
      <SettingsSection
        title="Who offers what"
        intro="Every coach picks from the same catalog, and each can offer the same services or different ones. Coaches manage this themselves from their portal; this is the same set of switches, reachable by you."
      >
        <Field label="Coach" style={{ maxWidth: 280, marginBottom: '1.25rem' }}>
          <select className="field" value={coachSlug} onChange={e => setCoachSlug(e.target.value)}>
            {COACHES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </Field>

        {offersLoading
          ? <Loading />
          : activeRows.length === 0
            ? <p style={{ color: 'var(--text-4)', fontSize: '.8rem' }}>Nothing in the catalog is switched on, so there is nothing to offer.</p>
            : (
              <div style={{ display: 'grid', gap: 1, background: 'var(--surface-2)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden' }}>
                {activeRows.map(s => {
                  const offer = offers.get(s.id)
                  const on = offer?.on ?? false
                  const length = offer?.override ?? s.duration_minutes
                  return (
                    <div key={s.id} style={{ background: 'var(--bg)', padding: '.85rem 1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Toggle on={on} onChange={() => toggleOffer(s)} label={`${on ? 'Remove' : 'Offer'} ${s.name} for ${coach?.name ?? coachSlug}`} />
                      <span style={{ flex: 1, minWidth: 160, color: on ? 'var(--text)' : 'var(--text-4)', fontWeight: 700, fontSize: '.85rem' }}>{s.name}</span>
                      <span style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>
                        {fmtDuration(length)}
                        {offer?.override != null && offer.override !== s.duration_minutes ? ' (their length)' : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
      </SettingsSection>
    </div>
  )
}
