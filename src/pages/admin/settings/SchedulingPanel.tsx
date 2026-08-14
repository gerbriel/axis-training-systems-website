import { useEffect, useState, useCallback } from 'react'
import DemoBanner from '../../../components/dashboard/DemoBanner'
import { fetchScheduling, saveSchedulingRow, type SchedulingRow } from '../../../lib/settings'
import { clampInt } from '../../../utils/sanitize'
import { ACCENT, SettingsSection, Field, Flash, Loading, useFlash, pageStyle, cardStyle } from './_shared'

/**
 * Scheduling — the booking policy for every coach, in one screen.
 *
 * No new table: it edits coach_public_settings (009), the same four columns the
 * per-coach BookingPolicyPanel edits one calendar at a time. This is the roster
 * view of the same facts, for an admin setting the studio's defaults.
 */

const LEAD_CHOICES: [number, string][] = [
  [0, 'No notice'], [60, '1 hour'], [120, '2 hours'], [360, '6 hours'],
  [1440, '1 day'], [2880, '2 days'], [10080, '1 week'],
]
const ADVANCE_CHOICES: [number, string][] = [
  [14, '2 weeks'], [30, '1 month'], [70, '10 weeks'], [120, '4 months'], [365, '1 year'],
]
const BUFFER_CHOICES: [number, string][] = [
  [0, 'None'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'],
]

export default function SchedulingPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [rows, setRows] = useState<SchedulingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingSlug, setSavingSlug] = useState<string | null>(null)
  const { flash, show } = useFlash()

  const load = useCallback(async () => {
    setLoading(true)
    setRows(await fetchScheduling(isDemo))
    setLoading(false)
  }, [isDemo])
  useEffect(() => { void load() }, [load])

  const patch = (slug: string, field: keyof SchedulingRow, value: number | boolean) =>
    setRows(rs => rs.map(r => (r.coach_slug === slug ? { ...r, [field]: value } : r)))

  const save = async (row: SchedulingRow) => {
    setSavingSlug(row.coach_slug)
    const res = await saveSchedulingRow(row, isDemo)
    setSavingSlug(null)
    show(res.ok ? `${row.coach_name}'s booking policy saved.` : res.message, res.ok)
  }

  if (loading) return <Loading />

  return (
    <div style={pageStyle}>
      {isDemo && <DemoBanner />}
      <Flash flash={flash} />
      <SettingsSection
        title="Scheduling"
        intro="How each coach takes bookings — the notice they need, how far ahead their calendar opens, the gap held after a call, and whether a booking is confirmed on the spot. The booking page and the server that accepts a booking both read these."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {rows.map(r => (
            <div key={r.coach_slug} style={{ ...cardStyle }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.95rem' }}>{r.coach_name}</span>
                <span style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>{r.coach_slug}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                <Field label="Notice needed">
                  <select className="field" value={r.min_lead_minutes}
                    onChange={e => patch(r.coach_slug, 'min_lead_minutes', clampInt(e.target.value, 0, 20160, 120))}>
                    {LEAD_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="How far ahead">
                  <select className="field" value={r.max_advance_days}
                    onChange={e => patch(r.coach_slug, 'max_advance_days', clampInt(e.target.value, 1, 365, 70))}>
                    {ADVANCE_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Gap after a call">
                  <select className="field" value={r.buffer_minutes}
                    onChange={e => patch(r.coach_slug, 'buffer_minutes', clampInt(e.target.value, 0, 240, 0))}>
                    {BUFFER_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <label style={{ display: 'flex', gap: '.6rem', alignItems: 'center', alignSelf: 'end', paddingBottom: '.6rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={r.auto_confirm} style={{ width: 16, height: 16, accentColor: ACCENT }}
                    onChange={e => patch(r.coach_slug, 'auto_confirm', e.target.checked)} />
                  <span style={{ color: 'var(--text-2)', fontSize: '.8rem', fontWeight: 600 }}>Auto-confirm</span>
                </label>
              </div>

              <div style={{ marginTop: '1rem' }}>
                <button
                  onClick={() => save(r)}
                  disabled={savingSlug === r.coach_slug}
                  style={{
                    background: savingSlug === r.coach_slug ? 'var(--border)' : ACCENT, border: 'none',
                    color: savingSlug === r.coach_slug ? 'var(--text-3)' : '#fff', fontWeight: 900, fontSize: '.65rem',
                    letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1.3rem', borderRadius: '.25rem',
                    cursor: savingSlug === r.coach_slug ? 'default' : 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {savingSlug === r.coach_slug ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  )
}
