import { useEffect, useState, useCallback } from 'react'
import DemoBanner from '../../../components/dashboard/DemoBanner'
import { fetchLegalDocuments, saveLegalDocument, LEGAL_SLUGS, type LegalDocument, type LegalSlug } from '../../../lib/settings'
import { ACCENT, SettingsSection, Field, SaveButton, Flash, Loading, useFlash, pageStyle } from './_shared'

/**
 * Legal — the privacy policy, terms of service, and liability waiver shown on
 * the site. Three documents, a fixed set, each with a title and a body. anon
 * reads them (the footer links render them); an admin writes them here.
 */
export default function LegalPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [docs, setDocs] = useState<LegalDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<LegalSlug>('privacy')
  const [saving, setSaving] = useState(false)
  const { flash, show } = useFlash()

  const load = useCallback(async () => {
    setLoading(true)
    setDocs(await fetchLegalDocuments(isDemo))
    setLoading(false)
  }, [isDemo])
  useEffect(() => { void load() }, [load])

  const current = docs.find(d => d.slug === active)

  const patch = (field: 'title' | 'body', value: string) =>
    setDocs(ds => ds.map(d => (d.slug === active ? { ...d, [field]: value } : d)))

  const save = async () => {
    if (!current) return
    setSaving(true)
    const res = await saveLegalDocument({ slug: current.slug, title: current.title, body: current.body }, isDemo)
    setSaving(false)
    show(res.ok ? 'Saved.' : res.message, res.ok)
  }

  if (loading || !current) return <Loading />

  return (
    <div style={pageStyle}>
      {isDemo && <DemoBanner />}
      <Flash flash={flash} />
      <SettingsSection
        title="Legal Documents"
        intro="The privacy policy, terms, and waiver on the site. Pick one, edit it, and save. An empty document is simply not shown."
      >
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {LEGAL_SLUGS.map(s => (
            <button
              key={s.slug}
              onClick={() => setActive(s.slug)}
              style={{
                background: active === s.slug ? ACCENT : 'var(--surface-2)', border: `1px solid ${active === s.slug ? ACCENT : 'var(--border)'}`,
                color: active === s.slug ? '#fff' : 'var(--text-2)', fontWeight: 700, fontSize: '.72rem',
                padding: '.5rem 1rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gap: '1rem', maxWidth: 640 }}>
          <Field label="Title">
            <input className="field" value={current.title} maxLength={100} onChange={e => patch('title', e.target.value)} />
          </Field>
          <Field label="Body" hint="Plain text. Rendered as-is on the site.">
            <textarea
              className="field" rows={16} value={current.body} maxLength={50000}
              placeholder="Write the document here…"
              onChange={e => patch('body', e.target.value)}
              style={{ lineHeight: 1.6, fontFamily: 'inherit' }}
            />
          </Field>
        </div>

        <div style={{ marginTop: '1.5rem' }}>
          <SaveButton saving={saving} onClick={save}>Save document</SaveButton>
        </div>
      </SettingsSection>
    </div>
  )
}
