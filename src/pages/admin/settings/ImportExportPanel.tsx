import { useRef, useState } from 'react'
import DemoBanner from '../../../components/dashboard/DemoBanner'
import { useAuth } from '../../../context/AuthContext'
import { exportDataset, type ExportKind } from '../../../lib/settingsExport'
import { downloadText } from '../../../lib/fileDownload'
import {
  IMPORT_ACCEPT,
  INVITATION_DAYS,
  LEAD_FIELDS,
  fetchExistingLeadEmails,
  fetchExistingPeopleEmails,
  importLeads,
  parseTableFile,
  prepareInvites,
  prepareLeads,
  sendBulkInvites,
  templateCsv,
  templateSpreadsheetXml,
  type ImportKind,
  type InviteDraft,
  type LeadDraft,
  type PreparedInvites,
  type PreparedLeads,
  type RowIssue,
} from '../../../lib/dataImport'
import { ACCENT, SettingsSection, SubHead, Flash, useFlash, pageStyle, cardStyle } from './_shared'

/**
 * Import & Export.
 *
 * Out is the easy half: three CSVs built in the browser from what the other
 * panels already hold, with the escaping that stops a name executing as a
 * spreadsheet formula on the admin's machine.
 *
 * In is the half worth being careful about, and the care is all in the same
 * idea: NOTHING IS WRITTEN UNTIL A PERSON READS WHAT IS ABOUT TO HAPPEN AND
 * PRESSES A BUTTON. Picking a file parses it, maps the columns, validates every
 * row and checks the addresses against what is already on file. All of that is
 * shown, with the row numbers from their own spreadsheet, before there is
 * anything to press.
 *
 * Two kinds and only two. Applications are a plain insert. People are not: an
 * account cannot be made from a spreadsheet, so importing people means sending
 * each of them an invitation, and that puts an email in their inbox with their
 * name on it. The copy says so before the button, because there is no undo on a
 * sent email.
 *
 * Bookings are export-only. Creating one pushes an event to a real Google
 * Calendar, and a mis-mapped column would put fifty wrong appointments on a
 * coach's phone.
 */

const EXPORTS: { kind: ExportKind; title: string; desc: string }[] = [
  { kind: 'leads',    title: 'Applications', desc: 'Everyone who applied, with their contact details, the service they asked for, coach preference, and status.' },
  { kind: 'bookings', title: 'Bookings',     desc: 'Every booking: who it is with, which coach, the service, when it is for, and its status.' },
  { kind: 'clients',  title: 'Clients',      desc: 'Athlete accounts, with name, email, phone, status and when they joined.' },
]

const TEMPLATES: { kind: ImportKind; title: string; desc: string }[] = [
  {
    kind: 'leads',
    title: 'Applications',
    desc: `A column for every field an application can carry. Only the first four (${LEAD_FIELDS.filter(f => f.required).map(f => f.header).join(', ')}) have to be filled in. Delete any column you do not have.`,
  },
  {
    kind: 'invites',
    title: 'People to invite',
    desc: 'Email, first name, last name. One person per row. Everyone in it gets an invitation email.',
  },
]

const templateFile = (kind: ImportKind) => (kind === 'leads' ? 'axis_applications_template' : 'axis_invite_template')

// ── Small pieces ────────────────────────────────────────────────────────────

const btn = (on: boolean) => ({
  background: on ? ACCENT : 'var(--border)',
  border: 'none',
  color: on ? '#fff' : 'var(--text-3)',
  fontWeight: 900,
  fontSize: '.68rem',
  letterSpacing: '.12em',
  textTransform: 'uppercase' as const,
  padding: '.7rem 1.4rem',
  borderRadius: '.25rem',
  cursor: on ? 'pointer' : 'default',
  fontFamily: 'inherit',
  flexShrink: 0,
})

const ghost = (on: boolean) => ({
  background: 'transparent',
  border: '1px solid var(--border-mid)',
  color: on ? 'var(--text-2)' : 'var(--text-4)',
  fontWeight: 800,
  fontSize: '.66rem',
  letterSpacing: '.1em',
  textTransform: 'uppercase' as const,
  padding: '.6rem 1rem',
  borderRadius: '.25rem',
  cursor: on ? 'pointer' : 'default',
  fontFamily: 'inherit',
  flexShrink: 0,
})

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: 'var(--text-4)', fontSize: '.74rem', lineHeight: 1.6, marginTop: '.75rem' }}>{children}</p>
  )
}

/**
 * The per-row problems, with the row numbers from the person's own spreadsheet.
 *
 * Capped, because a file with the columns in the wrong order produces one issue
 * per row and a list of four hundred of them is not information.
 */
function Issues({ issues }: { issues: RowIssue[] }) {
  if (issues.length === 0) return null
  const shown = issues.slice(0, 10)
  return (
    <div style={{ background: 'rgba(234,179,8,.06)', border: '1px solid rgba(234,179,8,.3)', borderRadius: '.25rem', padding: '.85rem 1rem', marginTop: '1rem' }}>
      <p style={{ color: '#eab308', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: '.5rem' }}>
        {issues.length === 1 ? '1 thing to look at' : `${issues.length} things to look at`}
      </p>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
        {shown.map((issue, i) => (
          <li key={`${issue.row}-${i}`} style={{ color: 'var(--text-2)', fontSize: '.76rem', lineHeight: 1.55 }}>
            <span style={{ color: 'var(--text-4)', fontWeight: 800 }}>Row {issue.row}</span>{' '}{issue.message}
          </li>
        ))}
      </ul>
      {issues.length > shown.length && (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', marginTop: '.5rem' }}>
          And {issues.length - shown.length} more.
        </p>
      )}
    </div>
  )
}

function PreviewTable({ columns, rows }: { columns: { key: string; label: string }[]; rows: Record<string, string>[] }) {
  if (rows.length === 0) return null
  const shown = rows.slice(0, 10)
  return (
    <div style={{ marginTop: '1rem', border: '1px solid var(--border)', borderRadius: '.25rem', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.74rem' }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{ textAlign: 'left', padding: '.55rem .7rem', color: 'var(--text-4)', fontWeight: 900, fontSize: '.62rem', letterSpacing: '.12em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={`${r.email}-${i}`}>
              {columns.map(c => (
                <td key={c.key} style={{ padding: '.5rem .7rem', color: 'var(--text-2)', borderBottom: i === shown.length - 1 ? 'none' : '1px solid var(--surface-2)', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r[c.key] || <span style={{ color: 'var(--text-4)' }}>blank</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', padding: '.55rem .7rem', borderTop: '1px solid var(--surface-2)' }}>
          Showing the first {shown.length} of {rows.length}.
        </p>
      )}
    </div>
  )
}

// ── One import block ────────────────────────────────────────────────────────

type Prepared =
  | { kind: 'leads'; data: PreparedLeads }
  | { kind: 'invites'; data: PreparedInvites }

interface Preview {
  fileName: string
  prepared: Prepared
  /** Set when the duplicate check itself could not run, so the count is not trusted. */
  checkFailed: boolean
}

const LEAD_COLUMNS = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'email', label: 'Email' },
  { key: 'service', label: 'Service' },
  { key: 'coach_pref', label: 'Coach' },
]

const INVITE_COLUMNS = [
  { key: 'email', label: 'Email' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
]

function ImportBlock({ kind, isDemo, canImport }: { kind: ImportKind; isDemo: boolean; canImport: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [includeRepeats, setIncludeRepeats] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ text: string; ok: boolean } | null>(null)
  const [failures, setFailures] = useState<Array<{ email: string; message: string }>>([])
  /** This preview has been submitted once and must not be submitted again by accident. */
  const [spent, setSpent] = useState(false)

  const leads = kind === 'leads'

  const reset = () => {
    setProblem(null)
    setPreview(null)
    setIncludeRepeats(false)
    setOutcome(null)
    setFailures([])
    setSpent(false)
  }

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Cleared so picking the same file twice in a row still fires a change,
    // which is what happens after a fix and a re-save.
    e.target.value = ''
    if (!file) return

    reset()
    setReading(true)
    const parsed = await parseTableFile(file)
    if (!parsed.ok) { setReading(false); setProblem(parsed.message); return }

    const existing = leads ? await fetchExistingLeadEmails(isDemo) : await fetchExistingPeopleEmails(isDemo)
    setReading(false)

    const set = existing ?? new Set<string>()
    setPreview({
      fileName: file.name,
      checkFailed: existing === null,
      prepared: leads
        ? { kind: 'leads', data: prepareLeads(parsed.table, set) }
        : { kind: 'invites', data: prepareInvites(parsed.table, set) },
    })
  }

  const issues: RowIssue[] = preview ? preview.prepared.data.issues : []
  const repeats = preview
    ? (preview.prepared.kind === 'leads' ? preview.prepared.data.duplicateEmails : preview.prepared.data.alreadyIn)
    : []
  const repeated = new Set(repeats)
  /** A repeat is left out unless the checkbox says otherwise. */
  const skip = (email: string) => !includeRepeats && repeated.has(email)

  // Two shapes, one table. `LeadDraft` carries every optional column and
  // `InviteDraft` carries three fields, so the display rows are narrowed to the
  // handful of columns the preview actually shows.
  const displayRows: Record<string, string>[] = !preview
    ? []
    : preview.prepared.kind === 'leads'
      ? preview.prepared.data.rows
      : preview.prepared.data.rows.map(r => ({ email: r.email, first_name: r.first_name, last_name: r.last_name }))

  const readyCount = displayRows.length
  const sendingCount = displayRows.filter(r => !skip(r.email)).length

  const commit = async () => {
    const snapshot = preview
    if (!snapshot || sendingCount === 0 || spent) return
    setBusy(true)
    setFailures([])

    if (snapshot.prepared.kind === 'leads') {
      const rows: LeadDraft[] = snapshot.prepared.data.rows.filter(r => !skip(r.email))
      const res = await importLeads(rows, isDemo)
      setBusy(false)

      if (res.ok) {
        setOutcome({ ok: true, text: `Imported ${res.inserted} application${res.inserted === 1 ? '' : 's'}. They are in Applications now, all marked New.` })
        setPreview(null)
        return
      }
      // A refusal partway through has already written the chunks before it, and
      // the message says how many. Pressing the button again would write those
      // ones a second time, so it is spent: running it again means choosing the
      // file again, deliberately. Nothing was written in the demo, so nothing is
      // spent there either.
      setOutcome({ ok: false, text: res.message })
      if (!isDemo) setSpent(true)
      return
    }

    const rows: InviteDraft[] = snapshot.prepared.data.rows.filter(r => !skip(r.email))
    const res = await sendBulkInvites(rows, isDemo)
    setBusy(false)
    if (!res.ok) { setOutcome({ ok: false, text: res.message }); return }

    setFailures(res.failed)
    if (res.failed.length === 0) {
      setOutcome({ ok: true, text: `Sent ${res.sent} invitation${res.sent === 1 ? '' : 's'}.` })
      setPreview(null)
      return
    }

    setOutcome({ ok: false, text: `Sent ${res.sent} of ${res.sent + res.failed.length}. Everybody still waiting is listed below.` })
    // Whoever got theirs is taken out of the preview, so trying again cannot
    // email the same person twice. There is no unsend.
    const waiting = new Set(res.failed.map(f => f.email))
    const data = snapshot.prepared.data
    setPreview({
      ...snapshot,
      prepared: { kind: 'invites', data: { ...data, rows: data.rows.filter(r => waiting.has(r.email)), issues: [] } },
    })
  }

  const title = leads ? 'Applications' : 'Invite people'
  const label = leads
    ? `Import ${sendingCount} application${sendingCount === 1 ? '' : 's'}`
    : `Send ${sendingCount} invitation${sendingCount === 1 ? '' : 's'}`

  return (
    <div style={{ ...cardStyle, padding: '1.25rem 1.35rem' }}>
      <SubHead>{title}</SubHead>

      <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.6, marginBottom: '1rem' }}>
        {leads ? (
          <>
            A spreadsheet of people who applied somewhere other than the website. Every row lands in
            Applications marked New, so it goes through the same review as one that came in through
            the form. Nothing is written until you have read the preview and pressed the button.
          </>
        ) : (
          <>
            A spreadsheet of people you want in the athlete portal. This does not create accounts, it
            SENDS EACH PERSON AN EMAIL with a link to set their own password, so only upload addresses
            you have a reason to contact. Anybody who already has an account or a live invitation is
            skipped. A link expires after {INVITATION_DAYS} days.
          </>
        )}
      </p>

      {!canImport ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.76rem', lineHeight: 1.6 }}>
          {leads
            ? 'Only an admin can add applications, so this is switched off for your account. An admin can run the import for you.'
            : 'Only an admin can send invitations, so this is switched off for your account. An admin can send them for you.'}
        </p>
      ) : (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={IMPORT_ACCEPT}
            onChange={e => { void pick(e) }}
            disabled={reading || busy}
            style={{ display: 'none' }}
          />
          <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={reading || busy} style={btn(!reading && !busy)}>
              {reading ? 'Reading…' : preview ? 'Choose a different file' : 'Choose a file'}
            </button>
            {preview && (
              <span style={{ color: 'var(--text-3)', fontSize: '.76rem' }}>{preview.fileName}</span>
            )}
          </div>

          {problem && (
            <div style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.75rem 1rem', marginTop: '1rem' }}>
              <span style={{ color: '#f87171', fontSize: '.78rem', lineHeight: 1.6 }}>{problem}</span>
            </div>
          )}

          {outcome && (
            <div style={{
              background: outcome.ok ? 'rgba(34,197,94,.08)' : 'rgba(200,16,46,.08)',
              border: `1px solid ${outcome.ok ? 'rgba(34,197,94,.35)' : 'rgba(200,16,46,.35)'}`,
              borderRadius: '.25rem', padding: '.75rem 1rem', marginTop: '1rem',
            }}>
              <span style={{ color: outcome.ok ? '#22c55e' : '#f87171', fontSize: '.78rem', lineHeight: 1.6 }}>{outcome.text}</span>
            </div>
          )}

          {failures.length > 0 && (
            <ul style={{ listStyle: 'none', marginTop: '.75rem', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
              {failures.slice(0, 10).map((f, i) => (
                <li key={`${f.email}-${i}`} style={{ color: 'var(--text-3)', fontSize: '.74rem', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--text-2)', fontWeight: 700 }}>{f.email}</span>{' '}{f.message}
                </li>
              ))}
              {failures.length > 10 && (
                <li style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>And {failures.length - 10} more.</li>
              )}
            </ul>
          )}

          {preview && (
            <div style={{ marginTop: '1.1rem' }}>
              <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.6 }}>
                {readyCount === 0
                  ? 'Nothing in that file can be used yet. What is wrong with it is listed below.'
                  : `${readyCount} row${readyCount === 1 ? '' : 's'} read and ready.`}
              </p>

              {repeats.length > 0 && (
                <label style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', marginTop: '.6rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={includeRepeats}
                    onChange={e => setIncludeRepeats(e.target.checked)}
                    style={{ marginTop: '.2rem', accentColor: ACCENT }}
                  />
                  <span style={{ color: 'var(--text-3)', fontSize: '.76rem', lineHeight: 1.55 }}>
                    {leads
                      ? `${repeats.length} of them already ${repeats.length === 1 ? 'has an application' : 'have applications'} on file and will be skipped. Tick this to add them anyway as a second application.`
                      : `${repeats.length} of them already ${repeats.length === 1 ? 'has an account or a live invitation' : 'have an account or a live invitation'} and will be skipped. Tick this to try them anyway.`}
                  </span>
                </label>
              )}

              {preview.checkFailed && (
                <Note>
                  The list of who is already on file could not be loaded, so nothing here is marked as a
                  repeat. The database still refuses a genuine duplicate.
                </Note>
              )}

              <PreviewTable columns={leads ? LEAD_COLUMNS : INVITE_COLUMNS} rows={displayRows} />
              <Issues issues={issues} />

              <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '1.1rem' }}>
                <button type="button" onClick={() => { void commit() }} disabled={busy || spent || sendingCount === 0} style={btn(!busy && !spent && sendingCount > 0)}>
                  {busy ? (leads ? 'Importing…' : 'Sending…') : label}
                </button>
                <button type="button" onClick={reset} disabled={busy} style={ghost(!busy)}>
                  {spent ? 'Start over' : 'Cancel'}
                </button>
              </div>

              {spent && (
                <Note>
                  Some of those rows may already be in. Check Applications before you run this again,
                  then choose the file once more with only what is missing.
                </Note>
              )}

              {!leads && !spent && sendingCount > 0 && (
                <Note>
                  Pressing that sends {sendingCount} email{sendingCount === 1 ? '' : 's'}. There is no way to
                  unsend one, though an invitation can be revoked before it is used.
                </Note>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── The panel ───────────────────────────────────────────────────────────────

export default function ImportExportPanel({ isDemo = false }: { isDemo?: boolean }) {
  const { isAdmin } = useAuth()
  const [busy, setBusy] = useState<ExportKind | null>(null)
  const { flash, show } = useFlash()

  // Signage only. `leads` INSERT and `invite-send` are both admin-only on the
  // server, so this hides a control that would refuse rather than protecting
  // anything. The demo runs as an admin, which is what a demo is for.
  const canImport = isDemo || isAdmin

  const run = async (kind: ExportKind) => {
    setBusy(kind)
    const res = await exportDataset(kind, isDemo)
    setBusy(null)
    if (!res.ok) return show(res.message ?? 'Export failed.', false)
    show(res.count === 0 ? 'Nothing to export yet. An empty file was still saved.' : `Exported ${res.count} row${res.count === 1 ? '' : 's'}.`)
  }

  const saveTemplate = (kind: ImportKind, format: 'csv' | 'xls') => {
    if (format === 'csv') {
      downloadText(`${templateFile(kind)}.csv`, templateCsv(kind), 'text/csv;charset=utf-8;')
      return
    }
    // SpreadsheetML 2003: XML with an .xls name, which Excel, Numbers and
    // LibreOffice all open by double click. No library, no binary format.
    downloadText(`${templateFile(kind)}.xls`, templateSpreadsheetXml(kind), 'application/vnd.ms-excel;charset=utf-8;')
    show('Template saved. Open it in Excel, replace the example row, and save.')
  }

  return (
    <div style={pageStyle}>
      {isDemo && <DemoBanner note="Exports use the sample data, and an import here is previewed but never written." />}
      <Flash flash={flash} />

      <SettingsSection
        title="Export"
        intro="Download your data as a CSV, ready for a spreadsheet. Each file is built in your browser from what the other panels already hold, so nothing leaves for a third party."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {EXPORTS.map(e => (
            <div key={e.kind} style={{ ...cardStyle, display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.9rem', marginBottom: '.25rem' }}>{e.title}</p>
                <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.5 }}>{e.desc}</p>
              </div>
              <button onClick={() => { void run(e.kind) }} disabled={busy === e.kind} style={btn(busy !== e.kind)}>
                {busy === e.kind ? 'Exporting…' : 'Export CSV'}
              </button>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Templates"
        intro="A file with the right columns and one example row, so an import lands where you expect it to. Take one, replace the example, and upload it below."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {TEMPLATES.map(t => (
            <div key={t.kind} style={{ ...cardStyle, display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.9rem', marginBottom: '.25rem' }}>{t.title}</p>
                <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.5 }}>{t.desc}</p>
              </div>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => saveTemplate(t.kind, 'csv')} style={ghost(true)}>CSV template</button>
                <button type="button" onClick={() => saveTemplate(t.kind, 'xls')} style={ghost(true)}>Excel template</button>
              </div>
            </div>
          ))}
        </div>

        <Note>
          Bookings export for your records but cannot be imported. Creating one writes to a live Google
          Calendar, so a spreadsheet with a column in the wrong place would put real appointments on a
          coach's phone. Add a booking from the Bookings screen instead.
        </Note>
      </SettingsSection>

      <SettingsSection
        title="Import"
        intro="Upload a CSV or an Excel file. It is read in your browser, checked row by row against what is already here, and shown to you in full before anything is written."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <ImportBlock kind="leads" isDemo={isDemo} canImport={canImport} />
          <ImportBlock kind="invites" isDemo={isDemo} canImport={canImport} />
        </div>

        <Note>
          CSV is the format that always works. An .xlsx is read directly, and so is the Excel template
          above, but a workbook with formulas, several sheets or a password on it is safer saved as CSV
          first. Formatting is ignored either way: a cell Excel shows as a date arrives as the number
          underneath it.
        </Note>
      </SettingsSection>

      <p style={{ color: 'var(--text-4)', fontSize: '.75rem', lineHeight: 1.6 }}>
        Importing the content the site launched with, meets and testimonials, lives on the main Settings
        screen. This tab is for your own records going in and out.
      </p>
    </div>
  )
}
