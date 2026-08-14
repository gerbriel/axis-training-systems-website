import { useEffect, useState, useCallback } from 'react'
import DemoBanner from '../../../components/dashboard/DemoBanner'
import { fetchNotificationSettings, saveNotificationSettings, type NotificationSettings } from '../../../lib/settings'
import { clampInt } from '../../../utils/sanitize'
import { SettingsSection, Field, Toggle, SaveButton, Flash, Loading, useFlash, pageStyle } from './_shared'

/**
 * Client notifications — which booking emails go out, and how far ahead the
 * reminders fire. This is a SETTINGS surface, not the queue: booking_notifications
 * (010) still holds the messages and the trigger that schedules them. The
 * dispatcher reads these switches before it sends.
 */
export default function ClientNotificationsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [s, setS] = useState<NotificationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { flash, show } = useFlash()

  const load = useCallback(async () => {
    setLoading(true)
    setS(await fetchNotificationSettings(isDemo))
    setLoading(false)
  }, [isDemo])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!s) return
    setSaving(true)
    const res = await saveNotificationSettings(s, isDemo)
    setSaving(false)
    show(res.ok ? 'Notification settings saved.' : res.message, res.ok)
  }

  if (loading || !s) return <Loading />

  const Row = ({ on, onToggle, title, desc }: { on: boolean; onToggle: (v: boolean) => void; title: string; desc: string }) => (
    <label style={{ display: 'flex', gap: '.9rem', alignItems: 'flex-start', padding: '.9rem 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
      <Toggle on={on} onChange={onToggle} label={title} />
      <span>
        <span style={{ display: 'block', color: 'var(--text)', fontSize: '.88rem', fontWeight: 700 }}>{title}</span>
        <span style={{ display: 'block', color: 'var(--text-3)', fontSize: '.77rem', lineHeight: 1.5, marginTop: '.2rem' }}>{desc}</span>
      </span>
    </label>
  )

  return (
    <div style={pageStyle}>
      {isDemo && <DemoBanner />}
      <Flash flash={flash} />
      <SettingsSection
        title="Client Notifications"
        intro="The emails a client receives around a booking. Turn one off to stop sending it; the reminders below also let you set how far ahead they go out."
      >
        <div style={{ marginBottom: '1.75rem' }}>
          <Row on={s.confirmation_enabled} onToggle={v => setS({ ...s, confirmation_enabled: v })}
            title="Booking confirmation" desc="Sent the moment a booking is made — we have your request / your call is confirmed." />
          <Row on={s.reminder_24h_enabled} onToggle={v => setS({ ...s, reminder_24h_enabled: v })}
            title="First reminder" desc="A reminder ahead of the call, by default a day before." />
          <Row on={s.reminder_2h_enabled} onToggle={v => setS({ ...s, reminder_2h_enabled: v })}
            title="Second reminder" desc="A closer reminder, by default a couple of hours before." />
          <Row on={s.cancellation_enabled} onToggle={v => setS({ ...s, cancellation_enabled: v })}
            title="Cancellation notice" desc="Sent to the client and the coach when a booking is cancelled." />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', maxWidth: 560 }}>
          <Field label="First reminder — hours before" hint="Between 1 and 168 hours (a week).">
            <input className="field" type="number" min={2} max={168} value={s.reminder_24h_hours}
              disabled={!s.reminder_24h_enabled}
              onChange={e => setS({ ...s, reminder_24h_hours: clampInt(e.target.value, 2, 168, 24) })} />
          </Field>
          <Field label="Second reminder — hours before" hint="Must be closer to the call than the first reminder.">
            <input className="field" type="number" min={1} max={47} value={s.reminder_2h_hours}
              disabled={!s.reminder_2h_enabled}
              onChange={e => setS({ ...s, reminder_2h_hours: clampInt(e.target.value, 1, 47, 2) })} />
          </Field>
        </div>

        <div style={{ marginTop: '1.75rem' }}>
          <SaveButton saving={saving} onClick={save}>Save notifications</SaveButton>
        </div>
      </SettingsSection>
    </div>
  )
}
