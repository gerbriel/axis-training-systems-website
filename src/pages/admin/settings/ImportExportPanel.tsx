import { useState } from 'react'
import DemoBanner from '../../../components/dashboard/DemoBanner'
import { exportDataset, type ExportKind } from '../../../lib/settingsExport'
import { ACCENT, SettingsSection, Flash, useFlash, pageStyle } from './_shared'

/**
 * Import & Export — CSV out, client-side. No table of its own: it reads what the
 * other panels already own — applications, bookings, and athlete accounts — and
 * writes a file in the browser. The CSV escaping guards against a cell shifting
 * columns or a name executing as a spreadsheet formula (see settingsExport.ts).
 */

const EXPORTS: { kind: ExportKind; title: string; desc: string }[] = [
  { kind: 'leads',    title: 'Leads',    desc: 'Every application — contact details, the service requested, coach preference, and status.' },
  { kind: 'bookings', title: 'Bookings', desc: 'Every booking — who, which coach, the service, when it is for, and its status.' },
  { kind: 'clients',  title: 'Clients',  desc: 'Athlete accounts — name, email, phone, status and when they joined.' },
]

export default function ImportExportPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [busy, setBusy] = useState<ExportKind | null>(null)
  const { flash, show } = useFlash()

  const run = async (kind: ExportKind) => {
    setBusy(kind)
    const res = await exportDataset(kind, isDemo)
    setBusy(null)
    if (!res.ok) return show(res.message ?? 'Export failed.', false)
    show(res.count === 0 ? 'Nothing to export yet — an empty file was still saved.' : `Exported ${res.count} row${res.count === 1 ? '' : 's'}.`)
  }

  return (
    <div style={pageStyle}>
      {isDemo && <DemoBanner note="Exports here use the sample data." />}
      <Flash flash={flash} />
      <SettingsSection
        title="Import & Export"
        intro="Download your data as a CSV, ready for a spreadsheet. Each export is built in your browser from what the other panels already hold — nothing leaves for a third party."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {EXPORTS.map(e => (
            <div key={e.kind} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '1.1rem 1.25rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.9rem', marginBottom: '.25rem' }}>{e.title}</p>
                <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.5 }}>{e.desc}</p>
              </div>
              <button
                onClick={() => run(e.kind)}
                disabled={busy === e.kind}
                style={{ background: busy === e.kind ? 'var(--border)' : ACCENT, border: 'none', color: busy === e.kind ? 'var(--text-3)' : '#fff', fontWeight: 900, fontSize: '.68rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.7rem 1.4rem', borderRadius: '.25rem', cursor: busy === e.kind ? 'default' : 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
              >
                {busy === e.kind ? 'Exporting…' : 'Export CSV'}
              </button>
            </div>
          ))}
        </div>

        <p style={{ color: 'var(--text-4)', fontSize: '.75rem', lineHeight: 1.6, marginTop: '1.5rem' }}>
          Importing content the site launched with (meets and testimonials) lives on the main Settings screen. This tab is for taking your data out.
        </p>
      </SettingsSection>
    </div>
  )
}
