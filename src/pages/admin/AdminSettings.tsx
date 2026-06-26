import { useEffect, useState } from 'react'
import type { CoachRouting } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { DEMO_ROUTING, DEMO_CONFIG } from '../../data/demoData'

function StatusMsg({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div style={{
      padding: '.75rem 1rem', borderRadius: '.25rem', fontSize: '.8rem',
      background: ok ? '#0a1f0a' : '#1a0309',
      border: `1px solid ${ok ? '#22c55e33' : '#2d0810'}`,
      color: ok ? '#4ade80' : '#f87171',
    }}>
      {msg}
    </div>
  )
}

export default function AdminSettings({ isDemo = false }: { isDemo?: boolean }) {
  const [routes, setRoutes] = useState<CoachRouting[]>(isDemo ? DEMO_ROUTING : [])
  const [masterEmail, setMasterEmail] = useState(isDemo ? (DEMO_CONFIG.find(c => c.key === 'master_notify_email')?.value ?? '') : '')
  const [resendKey, setResendKey] = useState(isDemo ? (DEMO_CONFIG.find(c => c.key === 'resend_api_key')?.value ?? '') : '')
  const [loading, setLoading] = useState(!isDemo)
  const [savingRoutes, setSavingRoutes] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [routesMsg, setRoutesMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [configMsg, setConfigMsg] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    if (isDemo) return
    const load = async () => {
      const [{ data: routeData }, { data: configData }] = await Promise.all([
        supabase.from('coach_routing').select('*').order('coach_name'),
        supabase.from('admin_config').select('*'),
      ])
      if (routeData) setRoutes(routeData as unknown as CoachRouting[])
      if (configData) {
        const cfg = configData as unknown as { key: string; value: string }[]
        setMasterEmail(cfg.find(c => c.key === 'master_notify_email')?.value ?? '')
        setResendKey(cfg.find(c => c.key === 'resend_api_key')?.value ?? '')
      }
      setLoading(false)
    }
    load()
  }, [isDemo])

  const updateRoute = (id: string, field: keyof CoachRouting, value: string | boolean) => {
    setRoutes(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  const saveRoutes = async () => {
    setSavingRoutes(true)
    setRoutesMsg(null)
    if (isDemo) {
      await new Promise(r => setTimeout(r, 500))
      setRoutesMsg({ text: 'Demo mode — routing saved to local state only.', ok: true })
      setSavingRoutes(false)
      return
    }
    const updates = routes.map(r =>
      supabase.from('coach_routing')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ email: r.email, notify: r.notify, calendly_url: r.calendly_url ?? null, updated_at: new Date().toISOString() } as any)
        .eq('id', r.id)
    )
    const results = await Promise.all(updates)
    const hasError = results.some(r => r.error)
    setRoutesMsg(hasError
      ? { text: 'Some updates failed. Check your connection.', ok: false }
      : { text: 'Email routing saved.', ok: true }
    )
    setSavingRoutes(false)
  }

  const saveConfig = async () => {
    setSavingConfig(true)
    setConfigMsg(null)
    if (isDemo) {
      await new Promise(r => setTimeout(r, 500))
      setConfigMsg({ text: 'Demo mode — config saved to local state only.', ok: true })
      setSavingConfig(false)
      return
    }
    const [r1, r2] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.from('admin_config').upsert({ key: 'master_notify_email', value: masterEmail } as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.from('admin_config').upsert({ key: 'resend_api_key', value: resendKey } as any),
    ])
    const hasError = r1.error || r2.error
    setConfigMsg(hasError
      ? { text: 'Failed to save. Check your connection.', ok: false }
      : { text: 'Configuration saved.', ok: true }
    )
    setSavingConfig(false)
  }

  if (loading) return (
    <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading settings…</div>
  )

  return (
    <div style={{ padding: '2rem', maxWidth: 720 }}>
      {/* Demo banner */}
      {isDemo && (
        <div style={{ background: '#2d2500', border: '1px solid #5c4800', padding: '.75rem 1.25rem', borderRadius: '.25rem', marginBottom: '2rem', display: 'flex', gap: '.75rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase', flexShrink: 0 }}>Demo Mode</span>
          <span style={{ color: '#7a6500', fontSize: '.8rem' }}>Changes are local only — nothing will be written to a database.</span>
        </div>
      )}

      {/* ── Email Routing ── */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.5rem' }}>
          Coach Email Routing
        </h2>
        <p style={{ color: 'var(--text-2)', fontSize: '.85rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
          When an athlete selects a coach preference, their application is emailed to that coach's address.
          Enable/disable per coach. Leave email blank to skip.
          The <strong style={{ color: 'var(--text-3)' }}>Calendly URL</strong> is shown as a “Book a Consultation” button on each coach's public profile — leave blank to hide it.
        </p>

        {/* Column headers */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', padding: '0 1.25rem', marginBottom: '.5rem' }}>
          <span style={{ width: '2.25rem', flexShrink: 0 }} />
          <span style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', minWidth: '9rem' }}>Coach</span>
          <span style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', flex: 1, minWidth: 180 }}>Notification Email</span>
          <span style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', flex: 2, minWidth: 220 }}>Calendly URL</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {routes.map(r => (
            <div key={r.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '1.25rem', borderRadius: '.25rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Toggle */}
              <button
                onClick={() => updateRoute(r.id, 'notify', !r.notify)}
                style={{
                  width: '2.25rem', height: '1.25rem', borderRadius: '9999px', border: 'none', cursor: 'pointer', flexShrink: 0, position: 'relative', transition: 'background .2s',
                  background: r.notify ? '#c8102e' : 'var(--border)',
                }}
                aria-label={r.notify ? 'Disable notifications' : 'Enable notifications'}
              >
                <span style={{
                  position: 'absolute', top: '50%', transform: `translate(${r.notify ? '0.875rem' : '0.125rem'}, -50%)`,
                  width: '1rem', height: '1rem', borderRadius: '50%', background: 'var(--text)', transition: 'transform .2s',
                  display: 'block',
                }} />
              </button>

              {/* Coach name */}
              <span style={{ color: r.notify ? 'var(--text)' : 'var(--text-dim)', fontWeight: 700, fontSize: '.875rem', minWidth: '9rem' }}>{r.coach_name}</span>

              {/* Email input */}
              <input
                type="email" className="field" placeholder="coach@example.com"
                value={r.email} onChange={e => updateRoute(r.id, 'email', e.target.value)}
                disabled={!r.notify}
                style={{ flex: 1, minWidth: 180, opacity: r.notify ? 1 : 0.4 }}
              />

              {/* Calendly URL */}
              <input
                type="url" className="field" placeholder="https://calendly.com/their-link (optional)"
                value={r.calendly_url ?? ''}
                onChange={e => updateRoute(r.id, 'calendly_url', e.target.value)}
                style={{ flex: 2, minWidth: 220 }}
              />
            </div>
          ))}
        </div>

        {routesMsg && <div style={{ marginTop: '1rem' }}><StatusMsg msg={routesMsg.text} ok={routesMsg.ok} /></div>}

        <button
          onClick={saveRoutes} disabled={savingRoutes}
          style={{ marginTop: '1.25rem', background: savingRoutes ? '#5c0e14' : '#c8102e', border: 'none', color: 'var(--text)', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '.875rem 2rem', borderRadius: '.25rem', cursor: 'pointer' }}
          onMouseEnter={e => { if (!savingRoutes) e.currentTarget.style.background = '#1a1f6b' }}
          onMouseLeave={e => { if (!savingRoutes) e.currentTarget.style.background = '#272C84' }}
        >
          {savingRoutes ? 'Saving…' : 'Save Routing'}
        </button>
      </section>

      <div style={{ borderTop: '1px solid var(--border)', marginBottom: '3rem' }} />

      {/* ── Master Config ── */}
      <section>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.5rem' }}>
          Notification Config
        </h2>
        <p style={{ color: 'var(--text-2)', fontSize: '.85rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
          The master email receives a copy of every lead regardless of coach preference.
          The Resend API key is used by the Edge Function to send notification emails.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="field-label">Master Notification Email</label>
            <input
              type="email" className="field" placeholder="admin@axistrainingsystems.com"
              value={masterEmail} onChange={e => setMasterEmail(e.target.value)}
            />
            <p style={{ color: 'var(--text-3)', fontSize: '.75rem', marginTop: '.4rem' }}>All leads will be CC'd to this address.</p>
          </div>
          <div>
            <label className="field-label">Resend API Key</label>
            <input
              type="password" className="field" placeholder="re_••••••••••••••••"
              value={resendKey} onChange={e => setResendKey(e.target.value)}
              autoComplete="new-password"
            />
            <p style={{ color: 'var(--text-3)', fontSize: '.75rem', marginTop: '.4rem' }}>
              Get your API key at <a href="https://resend.com" target="_blank" rel="noopener" style={{ color: 'var(--text)' }}>resend.com</a>. Required for email delivery.
            </p>
          </div>
        </div>

        {configMsg && <div style={{ marginTop: '1rem' }}><StatusMsg msg={configMsg.text} ok={configMsg.ok} /></div>}

        <button
          onClick={saveConfig} disabled={savingConfig}
          style={{ marginTop: '1.25rem', background: savingConfig ? '#5c0e14' : '#c8102e', border: 'none', color: 'var(--text)', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '.875rem 2rem', borderRadius: '.25rem', cursor: 'pointer' }}
          onMouseEnter={e => { if (!savingConfig) e.currentTarget.style.background = '#1a1f6b' }}
          onMouseLeave={e => { if (!savingConfig) e.currentTarget.style.background = '#272C84' }}
        >
          {savingConfig ? 'Saving…' : 'Save Config'}
        </button>
      </section>

      <div style={{ borderTop: '1px solid var(--border)', marginTop: '3rem', paddingTop: '2rem' }}>
        <h3 style={{ color: 'var(--text-3)', fontWeight: 700, fontSize: '.8rem', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '1rem' }}>Email Setup Instructions</h3>
        <ol style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 2, paddingLeft: '1.25rem' }}>
          <li>Create a free account at <a href="https://resend.com" target="_blank" rel="noopener" style={{ color: 'var(--text-2)' }}>resend.com</a> and verify your sending domain.</li>
          <li>Copy your API key and paste it above.</li>
          <li>Deploy the Supabase Edge Function from <code style={{ color: 'var(--text-2)', background: 'var(--surface)', padding: '.1rem .4rem', borderRadius: '.2rem' }}>supabase/functions/send-lead-email/</code>.</li>
          <li>Set the <code style={{ color: 'var(--text-2)', background: 'var(--surface)', padding: '.1rem .4rem', borderRadius: '.2rem' }}>RESEND_API_KEY</code> secret in your Supabase project dashboard.</li>
          <li>Set coach emails above and enable notifications per coach.</li>
        </ol>
      </div>
    </div>
  )
}
