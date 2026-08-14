import { useEffect, useState, useCallback } from 'react'
import DemoBanner from '../../../components/dashboard/DemoBanner'
import {
  fetchResources, createResource, updateResource, deleteResource,
  type ResourceRow, type ResourceKind,
} from '../../../lib/settings'
import { clampInt } from '../../../utils/sanitize'
import { ACCENT, SettingsSection, Field, Toggle, Flash, Loading, useFlash, pageStyle } from './_shared'

/**
 * Rooms & equipment — the things a booking can occupy. A room or a piece of
 * equipment, a count of how many exist, and whether it is in service.
 */
export default function ResourcesPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [rows, setRows] = useState<ResourceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const { flash, show } = useFlash()

  const [name, setName] = useState('')
  const [kind, setKind] = useState<ResourceKind>('room')
  const [quantity, setQuantity] = useState('1')

  const load = useCallback(async () => {
    setLoading(true)
    setRows(await fetchResources(isDemo))
    setLoading(false)
  }, [isDemo])
  useEffect(() => { void load() }, [load])

  const add = async () => {
    setBusy(true)
    const res = await createResource({ name, kind, quantity: clampInt(quantity, 0, 1000, 1) }, isDemo)
    setBusy(false)
    if (!res.ok) return show(res.message, false)
    setName(''); setQuantity('1'); setKind('room')
    await load()
    show('Added.')
  }

  const toggleActive = async (r: ResourceRow) => {
    setRows(rs => rs.map(x => (x.id === r.id ? { ...x, is_active: !x.is_active } : x)))
    const res = await updateResource(r.id, { is_active: !r.is_active }, isDemo)
    if (!res.ok) { show(res.message, false); await load() }
  }

  const remove = async (r: ResourceRow) => {
    const res = await deleteResource(r.id, isDemo)
    if (!res.ok) return show(res.message, false)
    await load()
    show('Removed.')
  }

  if (loading) return <Loading />

  const rooms = rows.filter(r => r.kind === 'room')
  const equipment = rows.filter(r => r.kind === 'equipment')

  const Group = ({ title, items }: { title: string; items: ResourceRow[] }) => (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ color: 'var(--text-3)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: '.6rem' }}>{title}</h3>
      {items.length === 0
        ? <p style={{ color: 'var(--text-4)', fontSize: '.8rem' }}>None yet.</p>
        : (
          <div style={{ display: 'grid', gap: 1, background: 'var(--surface-2)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden' }}>
            {items.map(r => (
              <div key={r.id} style={{ background: 'var(--bg)', padding: '.85rem 1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <Toggle on={r.is_active} onChange={() => toggleActive(r)} label={`Toggle ${r.name}`} />
                <span style={{ flex: 1, minWidth: 140, color: r.is_active ? 'var(--text)' : 'var(--text-4)', fontWeight: 700, fontSize: '.88rem' }}>{r.name}</span>
                <span style={{ color: 'var(--text-3)', fontSize: '.78rem' }}>Qty {r.quantity}</span>
                <button onClick={() => remove(r)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', fontSize: '.68rem', padding: '.35rem .7rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>Remove</button>
              </div>
            ))}
          </div>
        )}
    </div>
  )

  return (
    <div style={pageStyle}>
      {isDemo && <DemoBanner />}
      <Flash flash={flash} />
      <SettingsSection
        title="Rooms & Equipment"
        intro="The rooms and equipment a booking can occupy. Switch one off to keep it in the list without offering it while it is out of service."
      >
        <Group title="Rooms" items={rooms} />
        <Group title="Equipment" items={equipment} />

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem', marginTop: '.5rem' }}>
          <h3 style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.85rem' }}>Add one</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', alignItems: 'end' }}>
            <Field label="Name" style={{ gridColumn: 'span 1' }}>
              <input className="field" value={name} maxLength={100} placeholder="Main Platform" onChange={e => setName(e.target.value)} />
            </Field>
            <Field label="Type">
              <select className="field" value={kind} onChange={e => setKind(e.target.value === 'equipment' ? 'equipment' : 'room')}>
                <option value="room">Room</option>
                <option value="equipment">Equipment</option>
              </select>
            </Field>
            <Field label="Quantity">
              <input className="field" type="number" min={0} max={1000} value={quantity} onChange={e => setQuantity(e.target.value)} />
            </Field>
            <button
              onClick={add} disabled={busy}
              style={{ background: busy ? 'var(--border)' : ACCENT, border: 'none', color: busy ? 'var(--text-3)' : '#fff', fontWeight: 900, fontSize: '.68rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.75rem 1.3rem', borderRadius: '.25rem', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', height: 'fit-content' }}
            >
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}
