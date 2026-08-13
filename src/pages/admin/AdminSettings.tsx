import { useEffect, useState } from 'react'
import type { CoachRouting } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { DEMO_ROUTING, DEMO_CONFIG } from '../../data/demoData'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { safeUrl, sanitizeEmail, isValidEmail } from '../../utils/sanitize'
import { fetchSiteFlag, setSiteFlag } from '../../lib/siteSettings'
import { importSiteContent } from '../../lib/seedContent'

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
  /**
   * WRITE-ONLY. The field starts empty and is never filled from the database,
   * because the value it would be filled with is a live third-party API secret:
   * fetching it copies the key out of Postgres into browser memory, into React
   * state, and onto a DOM node whose `value` any XSS on this page — or anyone
   * with the console open — can read. `type="password"` only hides it from the
   * person sitting in front of it.
   *
   * All the screen actually needs to know is WHETHER a key is stored, which is
   * one boolean and no secret. Leaving the box blank leaves the stored key
   * alone; typing in it replaces it.
   */
  const [resendKey, setResendKey] = useState('')
  const [hasResendKey, setHasResendKey] = useState(isDemo)
  const [loading, setLoading] = useState(!isDemo)
  const [savingRoutes, setSavingRoutes] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [routesMsg, setRoutesMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [configMsg, setConfigMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [demoEnabled, setDemoEnabled] = useState(isDemo)
  const [demoSaving, setDemoSaving] = useState(false)
  const [demoMsg, setDemoMsg] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    if (isDemo) return
    const load = async () => {
      const [{ data: routeData }, { data: configData }, { data: keyRow }, demoFlag] = await Promise.all([
        supabase.from('coach_routing').select('*').order('coach_name'),
        // Everything EXCEPT the API key. A `select('*')` here put the secret on
        // the wire and into this tab's memory every time an admin opened the
        // settings screen, whether or not they meant to touch it.
        supabase.from('admin_config').select('key,value').neq('key', 'resend_api_key'),
        // Existence only — the `key` column, never the `value`.
        supabase.from('admin_config').select('key').eq('key', 'resend_api_key').maybeSingle(),
        fetchSiteFlag('demo_enabled'),
      ])
      if (routeData) setRoutes(routeData as unknown as CoachRouting[])
      if (configData) {
        const cfg = configData as unknown as { key: string; value: string }[]
        setMasterEmail(cfg.find(c => c.key === 'master_notify_email')?.value ?? '')
      }
      setHasResendKey(!!keyRow)
      setDemoEnabled(demoFlag)
      setLoading(false)
    }
    load()
  }, [isDemo])

  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const runImport = async () => {
    if (importing) return
    setImporting(true)
    setImportMsg(null)
    if (isDemo) { setImporting(false); setImportMsg({ text: 'Demo mode — nothing imported.', ok: true }); return }
    const r = await importSiteContent()
    setImporting(false)
    if (!r.ok) { setImportMsg({ text: r.message ?? 'Import failed.', ok: false }); return }
    const parts: string[] = []
    if (r.meets.imported) parts.push(`${r.meets.imported} meet${r.meets.imported === 1 ? '' : 's'}`)
    if (r.testimonials.imported) parts.push(`${r.testimonials.imported} testimonial${r.testimonials.imported === 1 ? '' : 's'}`)
    setImportMsg({
      text: parts.length
        ? `Imported ${parts.join(' and ')}. They're now in the panels above and on the site — edit or remove them there.`
        : 'Everything is already imported — nothing to do.',
      ok: true,
    })
  }

  const toggleDemo = async (next: boolean) => {
    setDemoEnabled(next) // optimistic
    setDemoMsg(null)
    if (isDemo) { setDemoMsg({ text: 'Demo mode — not saved.', ok: true }); return }
    setDemoSaving(true)
    const res = await setSiteFlag('demo_enabled', next)
    setDemoSaving(false)
    if (!res.ok) {
      setDemoEnabled(!next) // roll back
      setDemoMsg({ text: res.message ?? 'Could not save.', ok: false })
    } else {
      setDemoMsg({ text: next ? 'Demo button is now visible to everyone.' : 'Demo button is hidden from the public (you still see it).', ok: true })
    }
  }

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
    // Checked before the write, not after: this column is documented to become
    // an `href` on a public coach profile, and a `javascript:` URI stored there
    // is stored XSS waiting for the day the field is wired up. safeUrl allows
    // http/https/mailto and refuses everything else.
    const badUrl = routes.find(r => r.calendly_url && !safeUrl(r.calendly_url))
    if (badUrl) {
      setRoutesMsg({ text: `${badUrl.coach_name}: that booking link is not a valid http(s) URL.`, ok: false })
      setSavingRoutes(false)
      return
    }
    const badEmail = routes.find(r => r.notify && r.email && !isValidEmail(sanitizeEmail(r.email)))
    if (badEmail) {
      setRoutesMsg({ text: `${badEmail.coach_name}: that does not look like an email address.`, ok: false })
      setSavingRoutes(false)
      return
    }

    const updates = routes.map(r =>
      supabase.from('coach_routing')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ email: sanitizeEmail(r.email), notify: r.notify, calendly_url: safeUrl(r.calendly_url) ?? null, updated_at: new Date().toISOString() } as any)
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
    const cleanEmail = sanitizeEmail(masterEmail)
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      setConfigMsg({ text: 'That does not look like an email address.', ok: false })
      setSavingConfig(false)
      return
    }

    const writes = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.from('admin_config').upsert({ key: 'master_notify_email', value: cleanEmail } as any),
    ]
    // An empty box means "leave the stored key alone", not "erase it" — the
    // field is write-only, so blank is its resting state and saving the rest of
    // this form must not wipe email delivery as a side effect.
    if (resendKey.trim()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writes.push(supabase.from('admin_config').upsert({ key: 'resend_api_key', value: resendKey.trim() } as any))
    }

    const results = await Promise.all(writes)
    const hasError = results.some(r => r.error)
    if (!hasError && resendKey.trim()) { setHasResendKey(true); setResendKey('') }
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
      {isDemo && <DemoBanner />}

      {/* ── Demo visibility ── */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.5rem' }}>
          Public Demo
        </h2>
        <p style={{ color: 'var(--text-2)', fontSize: '.85rem', lineHeight: 1.6, marginBottom: '1.25rem' }}>
          The “View Demo” button on the home page. When off, visitors don't see it —
          but you always do, so you can still open the demo any time.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: '.9rem', cursor: demoSaving ? 'default' : 'pointer' }}>
          <button
            type="button"
            role="switch"
            aria-checked={demoEnabled}
            aria-label="Show the demo button to everyone"
            disabled={demoSaving}
            onClick={() => toggleDemo(!demoEnabled)}
            style={{
              flexShrink: 0, width: 46, height: 26, borderRadius: 999, padding: 0, position: 'relative',
              background: demoEnabled ? '#272C84' : 'var(--surface-2)',
              border: `1px solid ${demoEnabled ? '#272C84' : 'var(--border-mid)'}`,
              cursor: demoSaving ? 'default' : 'pointer', transition: 'background .15s',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: demoEnabled ? 22 : 2,
              width: 20, height: 20, borderRadius: '50%',
              background: demoEnabled ? '#fff' : 'var(--text-4)', transition: 'left .15s',
            }} />
          </button>
          <span style={{ color: 'var(--text)', fontSize: '.9rem', fontWeight: 700 }}>
            {demoEnabled ? 'Visible to everyone' : 'Hidden from the public'}
          </span>
        </label>

        {demoMsg && <div style={{ marginTop: '.75rem' }}><StatusMsg msg={demoMsg.text} ok={demoMsg.ok} /></div>}
      </section>

      {/* ── Import built-in content ── */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.5rem' }}>
          Import Site Content
        </h2>
        <p style={{ color: 'var(--text-2)', fontSize: '.85rem', lineHeight: 1.6, marginBottom: '1.25rem' }}>
          The upcoming meets and testimonials the site launched with were built into the code, which is
          why they didn't appear in the panels here. This copies them into the database once, so you can
          edit and remove them like anything else. Safe to click more than once — it skips whatever's
          already imported. <strong style={{ color: 'var(--text-3)' }}>Blog posts aren't included</strong> —
          importing them would change their page URLs, so they stay as they are for now.
        </p>
        <button
          onClick={runImport}
          disabled={importing}
          style={{
            background: importing ? 'var(--border)' : '#272C84', border: 'none',
            color: importing ? 'var(--text-3)' : '#fff', fontWeight: 900, fontSize: '.75rem',
            letterSpacing: '.1em', textTransform: 'uppercase', padding: '.7rem 1.5rem',
            borderRadius: '.25rem', cursor: importing ? 'default' : 'pointer', fontFamily: 'inherit',
          }}
        >
          {importing ? 'Importing…' : 'Import meets & testimonials'}
        </button>
        {importMsg && <div style={{ marginTop: '.75rem' }}><StatusMsg msg={importMsg.text} ok={importMsg.ok} /></div>}
      </section>

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
                type="email" className="field" placeholder="coach@example.com" maxLength={254}
                value={r.email} onChange={e => updateRoute(r.id, 'email', e.target.value)}
                disabled={!r.notify}
                style={{ flex: 1, minWidth: 180, opacity: r.notify ? 1 : 0.4 }}
              />

              {/* Calendly URL */}
              <input
                type="url" className="field" placeholder="https://calendly.com/their-link (optional)" maxLength={500}
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
              type="email" className="field" placeholder="admin@axistrainingsystems.com" maxLength={254}
              value={masterEmail} onChange={e => setMasterEmail(e.target.value)}
            />
            <p style={{ color: 'var(--text-3)', fontSize: '.75rem', marginTop: '.4rem' }}>All leads will be CC'd to this address.</p>
          </div>
          <div>
            <label className="field-label">Resend API Key</label>
            <input
              type="password" className="field" maxLength={200}
              placeholder={hasResendKey ? 'A key is stored — type here to replace it' : 're_••••••••••••••••'}
              value={resendKey} onChange={e => setResendKey(e.target.value)}
              autoComplete="new-password"
            />
            <p style={{ color: 'var(--text-3)', fontSize: '.75rem', marginTop: '.4rem' }}>
              {hasResendKey
                ? 'A key is stored. It is never sent back to this page — leave this blank to keep it, or type a new one to replace it.'
                : 'No key stored yet.'}
              {' '}Get your API key at <a href="https://resend.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)' }}>resend.com</a>. Required for email delivery.
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
          <li>Create a free account at <a href="https://resend.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-2)' }}>resend.com</a> and verify your sending domain.</li>
          <li>Copy your API key and paste it above.</li>
          <li>Deploy the Supabase Edge Function from <code style={{ color: 'var(--text-2)', background: 'var(--surface)', padding: '.1rem .4rem', borderRadius: '.2rem' }}>supabase/functions/send-lead-email/</code>.</li>
          <li>Set the <code style={{ color: 'var(--text-2)', background: 'var(--surface)', padding: '.1rem .4rem', borderRadius: '.2rem' }}>RESEND_API_KEY</code> secret in your Supabase project dashboard.</li>
          <li>Set coach emails above and enable notifications per coach.</li>
        </ol>
      </div>
    </div>
  )
}
