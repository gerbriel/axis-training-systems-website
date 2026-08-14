import { useEffect, useState, useCallback } from 'react'
import DemoBanner from '../../../components/dashboard/DemoBanner'
import { fetchWaitlistSettings, saveWaitlistSettings, type WaitlistSettings } from '../../../lib/settings'
import { clampInt } from '../../../utils/sanitize'
import { SettingsSection, Field, Toggle, SaveButton, Flash, Loading, useFlash, pageStyle } from './_shared'

/**
 * Waitlist rules — one set for the studio. Whether a freed slot is offered to
 * the list automatically, how long each offer is held before it moves on, and
 * how long the list is allowed to grow.
 */
export default function WaitlistRulesPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [s, setS] = useState<WaitlistSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { flash, show } = useFlash()

  const load = useCallback(async () => {
    setLoading(true)
    setS(await fetchWaitlistSettings(isDemo))
    setLoading(false)
  }, [isDemo])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!s) return
    setSaving(true)
    const res = await saveWaitlistSettings(s, isDemo)
    setSaving(false)
    show(res.ok ? 'Waitlist rules saved.' : res.message, res.ok)
  }

  if (loading || !s) return <Loading />

  return (
    <div style={pageStyle}>
      {isDemo && <DemoBanner />}
      <Flash flash={flash} />
      <SettingsSection
        title="Waitlist Rules"
        intro="What happens when a booked slot frees up and someone is waiting for it."
      >
        <label style={{ display: 'flex', gap: '.9rem', alignItems: 'flex-start', marginBottom: '1.75rem', cursor: 'pointer', maxWidth: 560 }}>
          <Toggle on={s.auto_offer} onChange={v => setS({ ...s, auto_offer: v })} label="Auto-offer freed slots" />
          <span>
            <span style={{ display: 'block', color: 'var(--text)', fontSize: '.9rem', fontWeight: 700 }}>Offer freed slots automatically</span>
            <span style={{ display: 'block', color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.55, marginTop: '.25rem' }}>
              On, a cancellation is offered to the next person on the list without anyone lifting a finger. Off, a freed slot just reopens to everyone.
            </span>
          </span>
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', maxWidth: 560 }}>
          <Field label="Hold each offer for" hint="How long one person has to claim a freed slot before it moves to the next.">
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <input className="field" type="number" min={0} max={1440} value={s.hold_minutes}
                onChange={e => setS({ ...s, hold_minutes: clampInt(e.target.value, 0, 1440, 30) })} />
              <span style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>minutes</span>
            </div>
          </Field>
          <Field label="Maximum list size" hint="How long the waitlist may grow before it stops accepting new names. 0 means no limit.">
            <input className="field" type="number" min={0} max={1000} value={s.max_size}
              onChange={e => setS({ ...s, max_size: clampInt(e.target.value, 0, 1000, 10) })} />
          </Field>
        </div>

        <div style={{ marginTop: '1.75rem' }}>
          <SaveButton saving={saving} onClick={save}>Save rules</SaveButton>
        </div>
      </SettingsSection>
    </div>
  )
}
