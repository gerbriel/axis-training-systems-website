import { useEffect, useState, useCallback } from 'react'
import DemoBanner from '../../../components/dashboard/DemoBanner'
import {
  fetchCommissionRules, createCommissionRule, setCommissionActive, deleteCommissionRule,
  fmtCommission, type CommissionRule, type CommissionKind, type CommissionAppliesTo, type CommissionInput,
} from '../../../lib/settings'
import { COACHES } from '../../../data/coaches'
import { ACCENT, SettingsSection, Field, Toggle, Flash, Loading, useFlash, pageStyle } from './_shared'

/**
 * Commission — the rules that pay coaches. A percent of what they take, or a
 * flat amount, on bookings or on sales. The rules only; what they pay out
 * against (time entries, orders) is a later migration's job.
 */
export default function CommissionPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [rows, setRows] = useState<CommissionRule[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const { flash, show } = useFlash()

  const [coachSlug, setCoachSlug] = useState<string>('')      // '' = all coaches
  const [kind, setKind] = useState<CommissionKind>('percent')
  const [appliesTo, setAppliesTo] = useState<CommissionAppliesTo>('bookings')
  const [percent, setPercent] = useState('60')
  const [dollars, setDollars] = useState('5')

  const load = useCallback(async () => {
    setLoading(true)
    setRows(await fetchCommissionRules(isDemo))
    setLoading(false)
  }, [isDemo])
  useEffect(() => { void load() }, [load])

  const add = async () => {
    setBusy(true)
    const input: CommissionInput = {
      coach_slug: coachSlug || null,
      kind, applies_to: appliesTo,
      percent: kind === 'percent' ? Number(percent) : undefined,
      dollars: kind === 'flat' ? Number(dollars) : undefined,
    }
    const res = await createCommissionRule(input, isDemo)
    setBusy(false)
    if (!res.ok) return show(res.message, false)
    await load()
    show('Rule added.')
  }

  const toggle = async (r: CommissionRule) => {
    setRows(rs => rs.map(x => (x.id === r.id ? { ...x, is_active: !x.is_active } : x)))
    const res = await setCommissionActive(r.id, !r.is_active, isDemo)
    if (!res.ok) { show(res.message, false); await load() }
  }

  const remove = async (r: CommissionRule) => {
    const res = await deleteCommissionRule(r.id, isDemo)
    if (!res.ok) return show(res.message, false)
    await load()
    show('Rule removed.')
  }

  if (loading) return <Loading />

  return (
    <div style={pageStyle}>
      {isDemo && <DemoBanner />}
      <Flash flash={flash} />
      <SettingsSection
        title="Commission"
        intro="What each coach earns. A percentage or a flat amount, applied to the bookings they take or the sales they make. A rule set to All coaches is the house default for anyone without their own."
      >
        {rows.length === 0 ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.85rem', marginBottom: '1.5rem' }}>No rules yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 1, background: 'var(--surface-2)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden', marginBottom: '1.75rem' }}>
            {rows.map(r => (
              <div key={r.id} style={{ background: 'var(--bg)', padding: '.9rem 1.1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <Toggle on={r.is_active} onChange={() => toggle(r)} label="Toggle rule" />
                <span style={{ flex: 1, minWidth: 200, color: r.is_active ? 'var(--text)' : 'var(--text-4)', fontSize: '.85rem', fontWeight: 600 }}>
                  {fmtCommission(r)}
                </span>
                <button onClick={() => remove(r)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)', fontSize: '.68rem', padding: '.35rem .7rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>Remove</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
          <h3 style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.85rem' }}>Add a rule</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', alignItems: 'end' }}>
            <Field label="Who">
              <select className="field" value={coachSlug} onChange={e => setCoachSlug(e.target.value)}>
                <option value="">All coaches</option>
                {COACHES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Kind">
              <select className="field" value={kind} onChange={e => setKind(e.target.value === 'flat' ? 'flat' : 'percent')}>
                <option value="percent">Percent</option>
                <option value="flat">Flat amount</option>
              </select>
            </Field>
            {kind === 'percent' ? (
              <Field label="Percent">
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                  <input className="field" type="number" min={0} max={100} value={percent} onChange={e => setPercent(e.target.value)} />
                  <span style={{ color: 'var(--text-3)' }}>%</span>
                </div>
              </Field>
            ) : (
              <Field label="Amount">
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                  <span style={{ color: 'var(--text-3)' }}>$</span>
                  <input className="field" type="number" min={0} step="0.01" value={dollars} onChange={e => setDollars(e.target.value)} />
                </div>
              </Field>
            )}
            <Field label="Applies to">
              <select className="field" value={appliesTo} onChange={e => setAppliesTo(e.target.value === 'sales' ? 'sales' : 'bookings')}>
                <option value="bookings">Bookings</option>
                <option value="sales">Sales</option>
              </select>
            </Field>
            <button
              onClick={add} disabled={busy}
              style={{ background: busy ? 'var(--border)' : ACCENT, border: 'none', color: busy ? 'var(--text-3)' : '#fff', fontWeight: 900, fontSize: '.68rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.75rem 1.3rem', borderRadius: '.25rem', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', height: 'fit-content' }}
            >
              {busy ? 'Adding…' : 'Add rule'}
            </button>
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}
