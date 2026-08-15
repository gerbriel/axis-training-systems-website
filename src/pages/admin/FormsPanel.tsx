import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../lib/usePermissions'
import { useHashSubTab } from '../../lib/useHashSubTab'
import { useMediaQuery, MOBILE_QUERY } from '../../lib/dashboard'
import { COACHES } from '../../data/coaches'
import DemoBanner from '../../components/dashboard/DemoBanner'
import {
  fetchForms, saveForm,
  fetchAllSubmissions, updateSubmission, deleteSubmission, submissionsToCsv,
  FIELD_TYPES, FIELD_TYPE_LABELS,
  type IntakeForm, type FormField, type FormDraft, type FieldType,
  type SubmissionRow, type SubmissionStatus,
  cleanStaffNotes,
} from '../../lib/forms'

const ACCENT = '#272C84'
const DANGER = '#c8102e'
const GREEN = '#22c55e'
const PENDING = '#eab308'

const microLabel: React.CSSProperties = {
  color: 'var(--text)', fontSize: '.6rem', fontWeight: 900,
  letterSpacing: '.3em', textTransform: 'uppercase',
}
const heading: React.CSSProperties = {
  color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem',
  textTransform: 'uppercase', letterSpacing: '-.01em',
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ background: `${color}18`, border: `1px solid ${color}`, color, fontSize: '.55rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.2rem .55rem', borderRadius: '.2rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {text}
    </span>
  )
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.7rem 1rem' }}>
      <span style={{ color: DANGER, fontSize: '.8rem', lineHeight: 1.6 }}>{message}</span>
    </div>
  )
}

const btn = (variant: 'primary' | 'ghost' | 'danger', extra?: React.CSSProperties): React.CSSProperties => ({
  border: variant === 'primary' ? 'none' : `1px solid ${variant === 'danger' ? DANGER : 'var(--border)'}`,
  background: variant === 'primary' ? ACCENT : 'transparent',
  color: variant === 'primary' ? '#fff' : variant === 'danger' ? DANGER : 'var(--text-2)',
  fontSize: '.62rem', fontWeight: variant === 'primary' ? 900 : 700, letterSpacing: '.1em',
  textTransform: 'uppercase', padding: '.6rem 1.2rem', minHeight: '2.5rem', borderRadius: '.25rem',
  cursor: 'pointer', fontFamily: 'inherit', ...extra,
})

function scopeLabel(coachSlug: string | null): string {
  if (coachSlug === null) return 'General'
  return COACHES.find(c => c.slug === coachSlug)?.name ?? coachSlug
}

function blankDraft(coachSlug: string | null, createdBy: string | null): FormDraft {
  return {
    coachSlug, title: '', description: '', isActive: true, createdBy,
    fields: [{ key: '', label: '', type: 'text', required: false }],
  }
}

function formToDraft(form: IntakeForm): FormDraft {
  return {
    id: form.id,
    coachSlug: form.coachSlug,
    title: form.title,
    description: form.description ?? '',
    isActive: form.isActive,
    fields: form.fields.map(f => ({ ...f, options: f.options ? [...f.options] : undefined })),
  }
}

// ── Shell ─────────────────────────────────────────────────────────────────────

type Sub = 'forms' | 'responses'

const SUB_TABS: readonly { key: Sub; label: string }[] = [
  { key: 'forms', label: 'Forms' },
  { key: 'responses', label: 'Responses' },
]
const SUB_KEYS: readonly Sub[] = SUB_TABS.map(t => t.key)

/**
 * The forms vertical, for staff.
 *
 * Two halves behind one hash-persisted strip. FORMS is the list and the builder:
 * what a person is asked. RESPONSES is the manager: what they answered, across
 * every form the viewer may read, with filters, a status and a note per answer,
 * and an export.
 *
 * They were one screen and the responses half was a per-form afterthought, so a
 * coach with three forms had to open three editors to find this morning's
 * intake. Now the builder only links across ("View responses" pre-filters the
 * manager to that form) and the reading happens in one place.
 *
 * Who sees what is RLS's decision and this only mirrors it: an admin (or a
 * manage_forms holder) manages every form and reads every submission; a coach
 * manages their own form and reads its submissions, and sees the general form
 * read-only. The refusals here are signage — the write still meets migration
 * 024's and 043's policies whatever this file renders.
 */
export default function FormsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [sub, setSub] = useHashSubTab(SUB_KEYS, 'forms')
  const isMobile = useMediaQuery(MOBILE_QUERY)

  // The builder's cross-link. Set on the way over, so the manager opens filtered
  // to the form the person was just looking at; cleared when they pick the tab
  // themselves, because that reads as "show me everything".
  const [jumpFormId, setJumpFormId] = useState<string | null>(null)

  const pickTab = (t: Sub) => {
    if (t === 'responses') setJumpFormId(null)
    setSub(t)
  }

  return (
    <div>
      {/* Both halves pad themselves with .dash-pad, so only the strip needs a gutter. */}
      <div
        role="tablist"
        aria-label="Forms sections"
        style={{ display: 'flex', gap: '.25rem', padding: isMobile ? '0 1rem' : '0 2rem', borderBottom: '1px solid var(--surface)', flexWrap: 'wrap' }}
      >
        {SUB_TABS.map(t => {
          const active = sub === t.key
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => pickTab(t.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: active ? 'var(--text)' : 'var(--text-3)',
                fontSize: '.72rem', fontWeight: active ? 900 : 700,
                letterSpacing: '.1em', textTransform: 'uppercase',
                padding: '.9rem .4rem', marginRight: '1rem',
                borderBottom: `2px solid ${active ? ACCENT : 'transparent'}`,
                fontFamily: 'inherit',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {sub === 'forms'
        ? <FormsWorkspace isDemo={isDemo} onViewResponses={id => { setJumpFormId(id); setSub('responses') }} />
        : <ResponsesManager isDemo={isDemo} isMobile={isMobile} initialFormId={jumpFormId} />}
    </div>
  )
}

// ── Forms: list + builder ─────────────────────────────────────────────────────

function FormsWorkspace({ isDemo, onViewResponses }: { isDemo: boolean; onViewResponses: (formId: string) => void }) {
  const { profile, isAdmin: authIsAdmin } = useAuth()
  const perms = usePermissions()

  // Demo mode has no session; it runs as the head coach/admin so every control
  // is exercisable, matching the other panels.
  const isAdmin = isDemo ? true : authIsAdmin
  const viewerSlug = isDemo ? 'ronnie-vallejo' : (profile?.coach_slug ?? null)
  const viewerId = isDemo ? 'demo-ronnie' : (profile?.id ?? null)
  const canManageAll = isAdmin || perms.can('manage_forms')
  const canViewAllSubs = isAdmin || perms.can('view_form_submissions')

  const [forms, setForms] = useState<IntakeForm[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)

  // Editor state. `draft` non-null = the builder is open (new or existing).
  const [draft, setDraft] = useState<FormDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await fetchForms(isDemo)
    if (rows === null) { setOutage(true); setForms([]) }
    else { setOutage(false); setForms(rows) }
    setLoading(false)
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  const canEditForm = useCallback(
    (form: { coachSlug: string | null }) =>
      canManageAll || (!!form.coachSlug && form.coachSlug === viewerSlug),
    [canManageAll, viewerSlug],
  )
  const canViewSubs = useCallback(
    (form: { coachSlug: string | null }) =>
      canViewAllSubs || (!!form.coachSlug && form.coachSlug === viewerSlug),
    [canViewAllSubs, viewerSlug],
  )

  const readOnly = draft ? !canEditForm(draft) : false

  const openNew = () => {
    // A coach's new form is fixed to their slug; an admin defaults to general
    // and can switch scope in the builder.
    setDraft(blankDraft(canManageAll ? null : viewerSlug, viewerId))
    setSaved(false)
    setEditorError(null)
  }
  const openForm = (form: IntakeForm) => {
    setDraft(formToDraft(form))
    setSaved(false)
    setEditorError(null)
  }
  const closeEditor = () => { setDraft(null); setEditorError(null) }

  // ── Draft mutation ──────────────────────────────────────────────────────────
  const patch = (p: Partial<FormDraft>) => { setDraft(d => d ? { ...d, ...p } : d); setSaved(false) }
  const patchField = (i: number, p: Partial<FormField>) =>
    setDraft(d => {
      if (!d) return d
      const fields = d.fields.map((f, idx) => idx === i ? { ...f, ...p } : f)
      return { ...d, fields }
    })
  const addField = () => setDraft(d => d ? { ...d, fields: [...d.fields, { key: '', label: '', type: 'text', required: false }] } : d)
  const removeField = (i: number) => setDraft(d => d ? { ...d, fields: d.fields.filter((_, idx) => idx !== i) } : d)
  const moveField = (i: number, dir: -1 | 1) => setDraft(d => {
    if (!d) return d
    const j = i + dir
    if (j < 0 || j >= d.fields.length) return d
    const fields = [...d.fields]
    ;[fields[i], fields[j]] = [fields[j], fields[i]]
    return { ...d, fields }
  })

  const doSave = async () => {
    if (!draft || saving) return
    setSaving(true)
    setEditorError(null)
    const res = await saveForm(draft, isDemo)
    setSaving(false)
    if (!res.ok) { setEditorError(res.message); return }
    setSaved(true)
    // Reflect the saved row (new id, normalised fields) in the list and editor.
    setForms(list => {
      const exists = list.some(f => f.id === res.form.id)
      return exists ? list.map(f => f.id === res.form.id ? res.form : f) : [res.form, ...list]
    })
    setDraft(formToDraft(res.form))
  }

  const stats = useMemo(() => ({
    total: forms.length,
    active: forms.filter(f => f.isActive).length,
    general: forms.filter(f => f.coachSlug === null).length,
  }), [forms])

  // ── List ─────────────────────────────────────────────────────────────────────
  const list = (
    <section style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        {([
          ['Forms', stats.total, ACCENT],
          ['Active', stats.active, GREEN],
          ['General', stats.general, 'var(--text-4)'],
        ] as const).map(([label, value, color]) => (
          <div key={label}>
            <p style={{ color, fontWeight: 900, fontSize: '1.5rem', lineHeight: 1 }}>{value}</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '.25rem' }}>{label}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <p style={{ ...microLabel, marginBottom: '.4rem' }}>Intake</p>
          <h2 style={heading}>Forms</h2>
        </div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button onClick={() => void load()} style={btn('ghost')}>↺ Refresh</button>
          <button onClick={openNew} style={btn('primary')}>+ New form</button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading forms…</p>
      ) : outage ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>Couldn&rsquo;t load the forms.</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>That&rsquo;s on our side — nothing has changed.</p>
          <button onClick={() => void load()} style={btn('ghost')}>Try again</button>
        </div>
      ) : forms.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-3)', fontSize: '.85rem', marginBottom: '1rem' }}>No forms yet.</p>
          <button onClick={openNew} style={btn('primary')}>Build the first one</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {forms.map(form => (
            <button
              key={form.id}
              onClick={() => openForm(form)}
              style={{
                textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--surface-2)',
                borderRadius: '.25rem', padding: '1rem 1.1rem', cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.3rem' }}>
                  <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.9rem' }}>{form.title}</span>
                  <Badge text={scopeLabel(form.coachSlug)} color={form.coachSlug === null ? 'var(--text-4)' : ACCENT} />
                  <Badge text={form.isActive ? 'Active' : 'Off'} color={form.isActive ? GREEN : 'var(--text-4)'} />
                  {!canEditForm(form) && <Badge text="Read only" color="var(--text-4)" />}
                </div>
                <p style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>
                  {form.fields.length} {form.fields.length === 1 ? 'question' : 'questions'}
                </p>
              </div>
              <span aria-hidden style={{ color: 'var(--text-4)', fontSize: '1.2rem', lineHeight: 1 }}>›</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )

  if (!draft) {
    return (
      <div className="dash-pad">
        {isDemo && <DemoBanner note="Build forms, reorder fields and read sample responses — all against local data." />}
        {list}
      </div>
    )
  }

  // ── Editor ───────────────────────────────────────────────────────────────────
  const showResponsesLink = !!draft.id && canViewSubs(draft)

  return (
    <div className="dash-pad" style={{ maxWidth: 820 }}>
      {isDemo && <DemoBanner note="Changes here stay in this preview." />}

      <button onClick={closeEditor} style={{ ...btn('ghost', { border: 'none', padding: '.5rem 0', minHeight: 'auto', marginBottom: '1rem' }) }}>
        ← All forms
      </button>

      {/* The answers used to live behind a tab here, one form at a time. They
          live in the Responses half now, so this only points at them. */}
      {showResponsesLink && (
        <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.5rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--surface-2)' }}>
          <button onClick={() => onViewResponses(draft.id as string)} style={btn('ghost')}>
            View responses →
          </button>
          <span style={{ color: 'var(--text-4)', fontSize: '.7rem' }}>
            Opens the Responses tab filtered to this form.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {readOnly && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '.7rem 1rem' }}>
            <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.6 }}>
              This is the site-wide form. You can see it, but only an administrator can change it.
            </p>
          </div>
        )}

        {/* Scope + status */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '1rem' }}>
          <div>
            <label className="field-label" htmlFor="form-scope">Who this form is for</label>
            {canManageAll ? (
              <select
                id="form-scope" className="field" value={draft.coachSlug ?? ''}
                disabled={readOnly}
                onChange={e => patch({ coachSlug: e.target.value || null })}
              >
                <option value="">General (whole site)</option>
                {COACHES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            ) : (
              <div style={{ marginTop: '.35rem' }}>
                <Badge text={scopeLabel(draft.coachSlug)} color={ACCENT} />
              </div>
            )}
          </div>

          <div>
            <label className="field-label" htmlFor="form-active">Status</label>
            <button
              id="form-active" type="button" disabled={readOnly}
              onClick={() => patch({ isActive: !draft.isActive })}
              style={{
                display: 'flex', alignItems: 'center', gap: '.6rem', marginTop: '.35rem',
                background: 'var(--surface)', border: `1px solid ${draft.isActive ? GREEN : 'var(--border)'}`,
                borderRadius: '.25rem', padding: '.6rem 1rem', minHeight: '2.75rem', width: '100%',
                cursor: readOnly ? 'default' : 'pointer', fontFamily: 'inherit',
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: draft.isActive ? GREEN : 'var(--text-4)' }} />
              <span style={{ color: 'var(--text)', fontSize: '.78rem', fontWeight: 700 }}>
                {draft.isActive ? 'Active — accepting responses' : 'Off — hidden from athletes'}
              </span>
            </button>
          </div>
        </div>

        {/* Title + description */}
        <div>
          <label className="field-label" htmlFor="form-title">Form title *</label>
          <input
            id="form-title" className="field" maxLength={200} disabled={readOnly}
            value={draft.title} placeholder="e.g. New Athlete Intake"
            onChange={e => patch({ title: e.target.value })}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="form-desc">Description</label>
          <textarea
            id="form-desc" className="field" rows={2} maxLength={2000} disabled={readOnly}
            value={draft.description} placeholder="Shown above the form. Optional."
            onChange={e => patch({ description: e.target.value })}
          />
        </div>

        {/* Field builder */}
        <div>
          <p style={{ ...microLabel, marginBottom: '.75rem' }}>Questions</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {draft.fields.map((field, i) => (
              <FieldEditor
                key={i}
                field={field}
                index={i}
                total={draft.fields.length}
                readOnly={readOnly}
                onChange={p => patchField(i, p)}
                onRemove={() => removeField(i)}
                onMove={dir => moveField(i, dir)}
              />
            ))}
          </div>
          {!readOnly && (
            <button onClick={addField} style={{ ...btn('ghost', { marginTop: '.75rem' }) }}>+ Add question</button>
          )}
        </div>

        {editorError && <ErrorNote message={editorError} />}

        {!readOnly && (
          <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--surface-2)', paddingTop: '1.25rem' }}>
            <button onClick={() => void doSave()} disabled={saving} style={btn('primary', { opacity: saving ? 0.6 : 1 })}>
              {saving ? 'Saving…' : saved ? 'Saved ✓' : draft.id ? 'Save changes' : 'Create form'}
            </button>
            <button onClick={closeEditor} style={btn('ghost')}>Cancel</button>
            {draft.id && (
              <span style={{ color: 'var(--text-4)', fontSize: '.7rem' }}>
                Editing a form athletes have already answered can only change its title, description and status — not the questions.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── One field's editor row ────────────────────────────────────────────────────

function FieldEditor({ field, index, total, readOnly, onChange, onRemove, onMove }: {
  field: FormField
  index: number
  total: number
  readOnly: boolean
  onChange: (p: Partial<FormField>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.3rem', padding: '.9rem 1rem' }}>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-4)', fontSize: '.7rem', fontWeight: 900, marginTop: '.65rem', minWidth: '1.2rem' }}>{index + 1}.</span>

        <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          <input
            className="field" maxLength={200} disabled={readOnly}
            value={field.label} placeholder="Question label"
            onChange={e => onChange({ label: e.target.value })}
          />

          <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="field" value={field.type} disabled={readOnly}
              style={{ maxWidth: 170 }}
              onChange={e => onChange({ type: e.target.value as FieldType, options: e.target.value === 'select' ? (field.options ?? ['']) : undefined })}
            >
              {FIELD_TYPES.map(t => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
            </select>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: readOnly ? 'default' : 'pointer' }}>
              <input
                type="checkbox" checked={field.required} disabled={readOnly}
                onChange={e => onChange({ required: e.target.checked })}
                style={{ accentColor: ACCENT, width: '.9rem', height: '.9rem' }}
              />
              <span style={{ color: 'var(--text-3)', fontSize: '.72rem', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>Required</span>
            </label>
          </div>

          {field.type === 'select' && (
            <div>
              <label className="field-label">Options (one per line)</label>
              <textarea
                className="field" rows={3} disabled={readOnly}
                value={(field.options ?? []).join('\n')}
                placeholder={'First option\nSecond option'}
                onChange={e => onChange({ options: e.target.value.split('\n') })}
              />
            </div>
          )}
        </div>

        {!readOnly && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem', flexShrink: 0 }}>
            <button onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up"
              style={{ background: 'none', border: '1px solid var(--border)', color: index === 0 ? 'var(--text-4)' : 'var(--text-2)', borderRadius: '.2rem', width: '2rem', height: '1.8rem', cursor: index === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}>↑</button>
            <button onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move down"
              style={{ background: 'none', border: '1px solid var(--border)', color: index === total - 1 ? 'var(--text-4)' : 'var(--text-2)', borderRadius: '.2rem', width: '2rem', height: '1.8rem', cursor: index === total - 1 ? 'default' : 'pointer', fontFamily: 'inherit' }}>↓</button>
            <button onClick={onRemove} aria-label="Remove"
              style={{ background: 'none', border: `1px solid ${DANGER}`, color: DANGER, borderRadius: '.2rem', width: '2rem', height: '1.8rem', cursor: 'pointer', fontFamily: 'inherit' }}>×</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Responses: shared bits ────────────────────────────────────────────────────

const STATUS_META: Record<SubmissionStatus, { label: string; color: string }> = {
  new: { label: 'New', color: DANGER },
  reviewed: { label: 'Reviewed', color: ACCENT },
  archived: { label: 'Archived', color: 'var(--text-4)' },
}
const STATUS_KEYS: readonly SubmissionStatus[] = ['new', 'reviewed', 'archived']

/**
 * The chip for a row's OWN status. The column is NOT NULL with a checked set,
 * so this only ever falls back if a row arrives from somewhere the check did
 * not cover, and a stray value should read as unhandled rather than crash the
 * pane a person is trying to read.
 */
const statusMeta = (s: SubmissionStatus) => STATUS_META[s] ?? STATUS_META.new

const STATUS_FILTERS: readonly (SubmissionStatus | 'all')[] = ['all', 'new', 'reviewed', 'archived']

type WhoFilter = 'all' | 'member' | 'guest'
const WHO_FILTERS: readonly { key: WhoFilter; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'member', label: 'Members' },
  { key: 'guest', label: 'Guests' },
]

const NOTES_MAX = 4000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const pill = (active: boolean, color: string | null, isMobile: boolean): React.CSSProperties => ({
  background: active ? (color ? `${color}22` : 'var(--surface-2)') : 'transparent',
  border: `1px solid ${active ? (color ?? 'var(--text-dim)') : 'var(--border)'}`,
  color: active ? (color ?? 'var(--text)') : 'var(--text-4)',
  fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
  padding: isMobile ? '.55rem .8rem' : '.35rem .75rem', borderRadius: '.2rem',
  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
})

/** One answer as text. Booleans read as words, lists join, anything odd stringifies. */
function answerToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(answerToText).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return '' }
  }
  return String(value)
}

/** A key the form no longer explains, made readable rather than dumped raw. */
function prettifyKey(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key
}

/**
 * The LOCAL calendar day of a timestamp, for the date range inputs.
 *
 * Slicing the ISO string would compare the browser's date picker against UTC,
 * so a 5pm Pacific answer would land on tomorrow and drop out of a range the
 * person could see it inside. An unparseable stamp returns empty, which fails
 * every bound: a row with no readable date is not silently included in a range.
 */
function localDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function fmtStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function fmtShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Responses: the manager ────────────────────────────────────────────────────

/**
 * Every response the viewer is allowed to read, in one list.
 *
 * The rows come from RLS already scoped: an admin or a view_form_submissions
 * holder sees the lot, a coach sees their own form's. Nothing here re-decides
 * that, it only joins each row to its form for a title and a question label.
 */
function ResponsesManager({ isDemo, isMobile, initialFormId }: {
  isDemo: boolean
  isMobile: boolean
  initialFormId: string | null
}) {
  const { isAdmin: authIsAdmin } = useAuth()
  const perms = usePermissions()
  const isAdmin = isDemo ? true : authIsAdmin
  const canDelete = isAdmin || perms.can('manage_forms')

  const [rows, setRows] = useState<SubmissionRow[]>([])
  const [forms, setForms] = useState<IntakeForm[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [formFilter, setFormFilter] = useState<string>(initialFormId ?? 'all')
  const [statusFilter, setStatusFilter] = useState<SubmissionStatus | 'all'>('all')
  const [whoFilter, setWhoFilter] = useState<WhoFilter>('all')
  const [search, setSearch] = useState('')
  const [fromDay, setFromDay] = useState('')
  const [toDay, setToDay] = useState('')

  // The builder's cross-link lands here. Guarded on truthiness so a plain tab
  // switch never yanks the filter back.
  useEffect(() => { if (initialFormId) setFormFilter(initialFormId) }, [initialFormId])

  const load = useCallback(async () => {
    setLoading(true)
    const [subs, formRows] = await Promise.all([fetchAllSubmissions(isDemo), fetchForms(isDemo)])
    // Either read failing is an outage: a response list without its forms would
    // show every question as a raw key and every row as "Unknown form".
    if (subs === null || formRows === null) { setOutage(true); setRows([]); setForms([]) }
    else { setOutage(false); setRows(subs); setForms(formRows) }
    setLoading(false)
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  const formById = useMemo(() => new Map(forms.map(f => [f.id, f])), [forms])
  const formTitle = useCallback(
    (id: string) => formById.get(id)?.title ?? 'Unknown form',
    [formById],
  )

  // One lowercase haystack per row, rebuilt only when the rows change, so typing
  // in the search box does not restringify every answer blob per keystroke.
  const haystacks = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) {
      const answers = Object.entries(r.answers)
        .map(([k, v]) => `${k} ${answerToText(v)}`)
        .join(' ')
      m.set(r.id, `${r.client_email ?? ''} ${answers}`.toLowerCase())
    }
    return m
  }, [rows])

  const query = search.trim().toLowerCase()

  const filtered = useMemo(() => rows.filter(r => {
    if (formFilter !== 'all' && r.form_id !== formFilter) return false
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    if (whoFilter === 'member' && !r.client_id) return false
    if (whoFilter === 'guest' && r.client_id) return false
    if (fromDay || toDay) {
      const day = localDay(r.submitted_at)
      if (fromDay && (!day || day < fromDay)) return false
      if (toDay && (!day || day > toDay)) return false
    }
    if (query && !(haystacks.get(r.id) ?? '').includes(query)) return false
    return true
  }), [rows, formFilter, statusFilter, whoFilter, fromDay, toDay, query, haystacks])

  const stats = useMemo(() => {
    const since = Date.now() - WEEK_MS
    return {
      fresh: rows.filter(r => r.status === 'new').length,
      week: rows.filter(r => {
        const t = new Date(r.submitted_at).getTime()
        return !Number.isNaN(t) && t >= since
      }).length,
      total: rows.length,
    }
  }, [rows])

  // Looked up in the full set, not the filtered one: marking an open response
  // reviewed while the "New" pill is on would otherwise slam the pane shut
  // mid-edit.
  const selected = selectedId ? rows.find(r => r.id === selectedId) ?? null : null

  const filtersOn = formFilter !== 'all' || statusFilter !== 'all' || whoFilter !== 'all' || !!query || !!fromDay || !!toDay
  const clearFilters = () => {
    setFormFilter('all'); setStatusFilter('all'); setWhoFilter('all')
    setSearch(''); setFromDay(''); setToDay('')
  }

  const applySaved = (updated: SubmissionRow) =>
    setRows(list => list.map(r => r.id === updated.id ? updated : r))
  const applyDeleted = (id: string) => {
    setRows(list => list.filter(r => r.id !== id))
    setSelectedId(null)
  }

  /** The CSV is what is on screen: the current filters, in the current order. */
  const exportCsv = () => {
    if (filtered.length === 0) return
    const csv = submissionsToCsv(filtered, forms)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `axis_form_responses_${new Date().toISOString().split('T')[0]}.csv`
    // In the document before the click, revoked a tick after: revoking
    // synchronously races the browser's read of the blob and can save an
    // empty file. Same shape as downloadCalendarFile in src/lib/ics.ts.
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const detail = selected && (
    <SubmissionDetail
      key={selected.id}
      row={selected}
      form={formById.get(selected.form_id) ?? null}
      formTitle={formTitle(selected.form_id)}
      isDemo={isDemo}
      isMobile={isMobile}
      canDelete={canDelete}
      onSaved={applySaved}
      onDeleted={applyDeleted}
      onClose={() => setSelectedId(null)}
    />
  )

  return (
    <div className="dash-pad">
      {isDemo && <DemoBanner note="Sample responses across the demo forms. Statuses, notes and deletes work, and reset with the preview." />}

      {/* Stat trio */}
      <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        {([
          ['New', stats.fresh, DANGER],
          ['This week', stats.week, ACCENT],
          ['Total', stats.total, 'var(--text-4)'],
        ] as const).map(([label, value, color]) => (
          <div key={label}>
            <p style={{ color, fontWeight: 900, fontSize: '1.5rem', lineHeight: 1 }}>{value}</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '.25rem' }}>{label}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <p style={{ ...microLabel, marginBottom: '.4rem' }}>Intake</p>
          <h2 style={heading}>Responses</h2>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button onClick={() => void load()} style={btn('ghost')}>↺ Refresh</button>
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            title={filtered.length === 0 ? 'Nothing to export with these filters.' : `Exports the ${filtered.length} shown.`}
            style={btn('ghost', { opacity: filtered.length === 0 ? 0.5 : 1, cursor: filtered.length === 0 ? 'default' : 'pointer' })}
          >
            ↓ Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', marginBottom: '1.25rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--surface-2)' }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="field" maxLength={120} value={search}
            placeholder="Search email or answers…"
            aria-label="Search responses"
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: isMobile ? 'none' : 260, flex: isMobile ? '1 1 100%' : '0 0 auto' }}
          />
          <select
            className="field" value={formFilter} aria-label="Filter by form"
            onChange={e => setFormFilter(e.target.value)}
            style={{ maxWidth: isMobile ? 'none' : 260, flex: isMobile ? '1 1 100%' : '0 0 auto' }}
          >
            <option value="all">All forms</option>
            {forms.map(f => (
              <option key={f.id} value={f.id}>{f.title} ({scopeLabel(f.coachSlug)})</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              aria-pressed={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              style={pill(statusFilter === s, s === 'all' ? null : STATUS_META[s].color, isMobile)}
            >
              {s === 'all' ? 'All' : STATUS_META[s].label}
            </button>
          ))}
          <span aria-hidden style={{ width: 1, height: '1.1rem', background: 'var(--surface-2)', margin: '0 .35rem' }} />
          {WHO_FILTERS.map(w => (
            <button
              key={w.key}
              aria-pressed={whoFilter === w.key}
              onClick={() => setWhoFilter(w.key)}
              style={pill(whoFilter === w.key, w.key === 'member' ? ACCENT : null, isMobile)}
            >
              {w.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ color: 'var(--text-4)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }} htmlFor="sub-from">From</label>
          <input id="sub-from" className="field" type="date" value={fromDay} max={toDay || undefined} onChange={e => setFromDay(e.target.value)} style={{ maxWidth: 170 }} />
          <label style={{ color: 'var(--text-4)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }} htmlFor="sub-to">To</label>
          <input id="sub-to" className="field" type="date" value={toDay} min={fromDay || undefined} onChange={e => setToDay(e.target.value)} style={{ maxWidth: 170 }} />
          {filtersOn && (
            <button onClick={clearFilters} style={btn('ghost', { padding: '.45rem .9rem', minHeight: '2.2rem' })}>Clear filters</button>
          )}
        </div>
      </div>

      {/* The detail is a sibling of the list, not a child of the "has rows"
          branch: marking the open response archived under a New filter empties
          the list, and the pane a person is reading must not vanish with it. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: !isMobile && selected ? 'minmax(0,1fr) min(420px,42vw)' : '1fr',
        gap: !isMobile && selected ? '1.25rem' : 0,
        alignItems: 'start',
      }}>
        <div style={{ minWidth: 0 }}>
          {loading ? (
            <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading responses…</p>
          ) : outage ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>Couldn&rsquo;t load the responses.</p>
              <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>That&rsquo;s on our side. Nothing has been lost.</p>
              <button onClick={() => void load()} style={btn('ghost')}>Try again</button>
            </div>
          ) : rows.length === 0 ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-3)', fontSize: '.85rem', marginBottom: '.3rem' }}>No responses yet.</p>
              <p style={{ color: 'var(--text-4)', fontSize: '.75rem' }}>Every answered form lands here, whoever filled it in.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-3)', fontSize: '.85rem', marginBottom: '1rem' }}>No responses match these filters.</p>
              <button onClick={clearFilters} style={btn('ghost')}>Clear filters</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {filtered.map(r => (
                <SubmissionRowButton
                  key={r.id}
                  row={r}
                  title={formTitle(r.form_id)}
                  selected={selectedId === r.id}
                  isMobile={isMobile}
                  // On a phone the pane is a full-screen overlay with its own
                  // Back button, so tapping the row again should never close it.
                  onClick={() => setSelectedId(!isMobile && selectedId === r.id ? null : r.id)}
                />
              ))}
              <p style={{ color: 'var(--text-4)', fontSize: '.7rem', padding: '.25rem 0' }}>
                Showing {filtered.length} of {rows.length}
              </p>
            </div>
          )}
        </div>

        {!isMobile && detail}
      </div>

      {isMobile && detail}
    </div>
  )
}

// ── One row in the list ───────────────────────────────────────────────────────

function SubmissionRowButton({ row, title, selected, isMobile, onClick }: {
  row: SubmissionRow
  title: string
  selected: boolean
  isMobile: boolean
  onClick: () => void
}) {
  const meta = statusMeta(row.status)
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      style={{
        textAlign: 'left', background: selected ? 'var(--surface-2)' : 'var(--surface)',
        border: '1px solid var(--surface-2)', borderLeft: `3px solid ${row.status === 'new' ? DANGER : 'transparent'}`,
        borderRadius: '.25rem', padding: isMobile ? '.85rem 1rem' : '.85rem 1.1rem',
        cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.3rem' }}>
          <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.85rem', wordBreak: 'break-word' }}>
            {row.client_email || 'No email given'}
          </span>
          <Badge text={meta.label} color={meta.color} />
          <Badge text={row.client_id ? 'Member' : 'Guest'} color={row.client_id ? ACCENT : 'var(--text-4)'} />
          {row.staff_notes && <Badge text="Noted" color={PENDING} />}
        </div>
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>
          {title} · {fmtShort(row.submitted_at)}
        </p>
      </div>
      <span aria-hidden style={{ color: 'var(--text-4)', fontSize: '1.2rem', lineHeight: 1 }}>›</span>
    </button>
  )
}

// ── The detail pane ───────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function SubmissionDetail({ row, form, formTitle, isDemo, isMobile, canDelete, onSaved, onDeleted, onClose }: {
  row: SubmissionRow
  form: IntakeForm | null
  formTitle: string
  isDemo: boolean
  isMobile: boolean
  canDelete: boolean
  onSaved: (updated: SubmissionRow) => void
  onDeleted: (id: string) => void
  onClose: () => void
}) {
  const [status, setStatus] = useState<SubmissionStatus>(row.status)
  const [notes, setNotes] = useState(row.staff_notes ?? '')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Choose-then-save: the chips and the notes box are a draft until saved.
  const dirty = status !== row.status || notes !== (row.staff_notes ?? '')

  const markEdited = () => {
    setSaveState(s => (s === 'saved' || s === 'error') ? 'idle' : s)
    setError(null)
  }

  const save = async () => {
    if (saveState === 'saving' || !dirty) return
    setSaveState('saving')
    setError(null)
    // The same trim-and-cap the lib applies before writing, so the pane, the
    // list badge and the table all hold the identical value after a save.
    const staffNotes = cleanStaffNotes(notes)
    const res = await updateSubmission(row.id, { status, staffNotes }, isDemo)
    if (!res.ok) {
      setSaveState('error')
      setError(res.message)
      return
    }
    setNotes(staffNotes ?? '')
    onSaved({ ...row, status, staff_notes: staffNotes, updated_at: new Date().toISOString() })
    setSaveState('saved')
  }

  const doDelete = async () => {
    if (deleting) return
    setDeleting(true)
    setError(null)
    const res = await deleteSubmission(row.id, isDemo)
    setDeleting(false)
    if (!res.ok) {
      setArmed(false)
      setSaveState('error')
      setError(res.message)
      return
    }
    onDeleted(row.id)
  }

  // Answers in the form's own order first, then anything the form no longer
  // asks. A key with no field is still someone's answer: it gets a readable
  // label and a line saying why it has no question next to it.
  const fields = form?.fields ?? []
  const answered = fields.filter(f => row.answers[f.key] !== undefined)
  const orphanKeys = Object.keys(row.answers).filter(k => !fields.some(f => f.key === k))

  const shell: React.CSSProperties = isMobile
    // Full-screen on phones: a 420px side column leaves the list no room and
    // pushes the close button off the edge. Above panel content and the coach
    // bottom bar (z 50), below the admin nav sheet (z 60/61).
    ? { position: 'fixed', inset: 0, zIndex: 55, background: 'var(--bg)', overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column' }
    : { border: '1px solid var(--surface-2)', borderRadius: '.25rem', background: 'var(--surface)', position: 'sticky', top: '1rem', maxHeight: 'calc(100vh - 3rem)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }

  return (
    <div style={shell}>
      <div style={{ padding: isMobile ? '1rem' : '1.1rem 1.25rem', borderBottom: '1px solid var(--surface-2)', position: 'sticky', top: 0, background: isMobile ? 'var(--bg)' : 'var(--surface)', zIndex: 1 }}>
        {isMobile && (
          <button onClick={onClose} style={btn('ghost', { marginBottom: '.85rem' })}>← Back</button>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.5rem' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '.95rem', lineHeight: 1.3, wordBreak: 'break-word' }}>
              {row.client_email || 'No email given'}
            </p>
            <p style={{ color: 'var(--text-3)', fontSize: '.72rem', marginTop: '.25rem' }}>
              {formTitle}{form ? ` · ${scopeLabel(form.coachSlug)}` : ''}
            </p>
            <p style={{ color: 'var(--text-4)', fontSize: '.72rem', marginTop: '.15rem' }}>
              {fmtStamp(row.submitted_at)}
            </p>
            <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginTop: '.5rem' }}>
              <Badge text={statusMeta(row.status).label} color={statusMeta(row.status).color} />
              <Badge text={row.client_id ? 'Member' : 'Guest'} color={row.client_id ? ACCENT : 'var(--text-4)'} />
              {dirty && <Badge text="Unsaved" color={PENDING} />}
            </div>
          </div>
          {!isMobile && (
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.1rem', padding: '.25rem', lineHeight: 1, minWidth: '2.5rem', minHeight: '2.5rem' }}>×</button>
          )}
        </div>
      </div>

      <div style={{ padding: isMobile ? '1rem 1rem calc(1.5rem + env(safe-area-inset-bottom))' : '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', flex: 1 }}>

        {/* Who sent it */}
        <p style={{ color: 'var(--text-3)', fontSize: '.75rem', lineHeight: 1.6 }}>
          {row.client_id
            ? 'Sent while signed in, so this response is tied to their app account.'
            : 'Sent signed out. The only thing linking it to a person is the email typed into the form.'}
        </p>

        {/* Answers */}
        <div>
          <p style={{ ...microLabel, marginBottom: '.75rem' }}>Answers</p>
          {answered.length === 0 && orphanKeys.length === 0 ? (
            <p style={{ color: 'var(--text-4)', fontSize: '.78rem' }}>This response came in empty.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              {answered.map(f => (
                <div key={f.key}>
                  <p style={{ color: 'var(--text-4)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.2rem' }}>{f.label}</p>
                  <p style={{ color: 'var(--text)', fontSize: '.82rem', lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                    {answerToText(row.answers[f.key]) || 'Not answered'}
                  </p>
                </div>
              ))}
              {orphanKeys.map(k => (
                <div key={k}>
                  <p style={{ color: 'var(--text-4)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.2rem' }}>
                    {prettifyKey(k)}
                    <span style={{ marginLeft: '.4rem', color: PENDING, letterSpacing: '.05em' }}>Not on the form now</span>
                  </p>
                  <p style={{ color: 'var(--text)', fontSize: '.82rem', lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                    {answerToText(row.answers[k]) || 'Not answered'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Status */}
        <div>
          <p style={{ ...microLabel, marginBottom: '.5rem' }}>Status</p>
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            {STATUS_KEYS.map(s => (
              <button
                key={s}
                aria-pressed={status === s}
                onClick={() => { setStatus(s); markEdited() }}
                style={pill(status === s, STATUS_META[s].color, isMobile)}
              >
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
          <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.5rem', lineHeight: 1.6 }}>
            Archived keeps the response and takes it off the New count.
          </p>
        </div>

        {/* Staff notes */}
        <div>
          <p style={{ ...microLabel, marginBottom: '.5rem' }}>Staff notes</p>
          <textarea
            className="field" rows={4} maxLength={NOTES_MAX} value={notes}
            placeholder="Notes for the team. A member can read these on their own submission, so write nothing you would not say to them."
            aria-label="Staff notes"
            onChange={e => { setNotes(e.target.value); markEdited() }}
          />
        </div>

        {/* Save */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {dirty && saveState !== 'error' && (
            <p style={{ color: PENDING, fontSize: '.7rem' }}>Status and notes are not applied until you save.</p>
          )}
          <button
            onClick={() => void save()}
            disabled={saveState === 'saving' || !dirty}
            style={btn('primary', {
              width: '100%',
              opacity: saveState === 'saving' || !dirty ? 0.6 : 1,
              cursor: saveState === 'saving' || !dirty ? 'default' : 'pointer',
            })}
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' && !dirty ? 'Saved ✓' : 'Save changes'}
          </button>
          {error && <ErrorNote message={error} />}
          {row.updated_at && row.updated_at !== row.submitted_at && (
            <p style={{ color: 'var(--text-4)', fontSize: '.68rem' }}>Last touched {fmtStamp(row.updated_at)}</p>
          )}
        </div>

        {/* Delete. Signage only: the policy is 043's, whatever renders here. */}
        {canDelete && (
          <div style={{ borderTop: '1px solid var(--surface-2)', paddingTop: '1.25rem' }}>
            {armed ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                <p style={{ color: 'var(--text-3)', fontSize: '.75rem', lineHeight: 1.6 }}>
                  Delete this response for good? The answers, the status and the notes all go with it.
                </p>
                <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                  <button onClick={() => void doDelete()} disabled={deleting} style={btn('danger', { opacity: deleting ? 0.6 : 1 })}>
                    {deleting ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button onClick={() => setArmed(false)} style={btn('ghost')}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setArmed(true)} style={btn('danger')}>Delete response</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
