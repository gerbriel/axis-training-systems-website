import { useEffect, useState, useCallback } from 'react'
import DemoBanner from '../../../components/dashboard/DemoBanner'
import {
  fetchLocations, createLocation, updateLocation, makeLocationPrimary, deleteLocation,
  TIMEZONE_CHOICES, type LocationRow,
} from '../../../lib/settings'
import { ACCENT, SettingsSection, Field, Toggle, Flash, Loading, useFlash, pageStyle } from './_shared'

/**
 * Locations — the studio's physical places. Public reads the active ones for a
 * contact/address block, so this is both a settings screen and the source of
 * what a visitor sees. Exactly one location may be primary.
 */
export default function LocationsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [rows, setRows] = useState<LocationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const { flash, show } = useFlash()

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [timezone, setTimezone] = useState('America/Los_Angeles')

  const load = useCallback(async () => {
    setLoading(true)
    setRows(await fetchLocations(isDemo))
    setLoading(false)
  }, [isDemo])
  useEffect(() => { void load() }, [load])

  const add = async () => {
    setBusy(true)
    const res = await createLocation({ name, address, timezone }, isDemo)
    setBusy(false)
    if (!res.ok) return show(res.message, false)
    setName(''); setAddress(''); setTimezone('America/Los_Angeles')
    await load()
    show('Location added.')
  }

  const toggleActive = async (r: LocationRow) => {
    setRows(rs => rs.map(x => (x.id === r.id ? { ...x, is_active: !x.is_active } : x)))
    const res = await updateLocation(r.id, { is_active: !r.is_active }, isDemo)
    if (!res.ok) { show(res.message, false); await load() }
  }

  const makePrimary = async (r: LocationRow) => {
    const res = await makeLocationPrimary(r.id, isDemo)
    if (!res.ok) return show(res.message, false)
    await load()
    show(`${r.name} is now the primary location.`)
  }

  const remove = async (r: LocationRow) => {
    const res = await deleteLocation(r.id, isDemo)
    if (!res.ok) return show(res.message, false)
    await load()
    show('Location removed.')
  }

  if (loading) return <Loading />

  return (
    <div style={pageStyle}>
      {isDemo && <DemoBanner />}
      <Flash flash={flash} />
      <SettingsSection
        title="Locations"
        intro="Where the studio is. The active locations show on the public site; the primary one leads. Switch a location off to keep the record without showing it."
      >
        {rows.length === 0 ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.85rem', marginBottom: '1.5rem' }}>No locations yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.75rem' }}>
            {rows.map(r => (
              <div key={r.id} style={{ background: 'var(--surface-2)', border: `1px solid ${r.is_primary ? ACCENT : 'var(--border)'}`, borderRadius: '.25rem', padding: '1.1rem 1.25rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.5rem' }}>
                  <Toggle on={r.is_active} onChange={() => toggleActive(r)} label={`Toggle ${r.name}`} />
                  <span style={{ flex: 1, minWidth: 160, color: r.is_active ? 'var(--text)' : 'var(--text-4)', fontWeight: 700, fontSize: '.92rem' }}>{r.name}</span>
                  {r.is_primary ? (
                    <span style={{ fontSize: '.58rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', color: ACCENT, border: `1px solid ${ACCENT}`, padding: '.25rem .55rem', borderRadius: 999 }}>Primary</span>
                  ) : (
                    <button onClick={() => makePrimary(r)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', fontSize: '.66rem', padding: '.35rem .7rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>Make primary</button>
                  )}
                  <button onClick={() => remove(r)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', fontSize: '.66rem', padding: '.35rem .7rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>Remove</button>
                </div>
                <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.5 }}>
                  {r.address || <span style={{ color: 'var(--text-4)' }}>No address</span>} · {r.timezone}
                </p>
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
          <h3 style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.85rem' }}>Add a location</h3>
          <div style={{ display: 'grid', gap: '1rem', maxWidth: 560 }}>
            <Field label="Name">
              <input className="field" value={name} maxLength={100} placeholder="Axis Fresno" onChange={e => setName(e.target.value)} />
            </Field>
            <Field label="Address">
              <input className="field" value={address} maxLength={300} placeholder="123 Blackstone Ave, Fresno, CA 93726" onChange={e => setAddress(e.target.value)} />
            </Field>
            <Field label="Time zone">
              <select className="field" value={timezone} onChange={e => setTimezone(e.target.value)}>
                {TIMEZONE_CHOICES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </Field>
            <div>
              <button
                onClick={add} disabled={busy}
                style={{ background: busy ? 'var(--border)' : ACCENT, border: 'none', color: busy ? 'var(--text-3)' : '#fff', fontWeight: 900, fontSize: '.68rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.75rem 1.4rem', borderRadius: '.25rem', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}
              >
                {busy ? 'Adding…' : 'Add location'}
              </button>
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}
