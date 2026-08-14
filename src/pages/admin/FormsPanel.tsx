import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../lib/usePermissions'
import { COACHES } from '../../data/coaches'
import DemoBanner from '../../components/dashboard/DemoBanner'
import {
  fetchForms, fetchSubmissions, saveForm,
  FIELD_TYPES, FIELD_TYPE_LABELS,
  type IntakeForm, type FormField, type FormSubmission, type FormDraft, type FieldType,
} from '../../lib/forms'

const ACCENT = '#272C84'
const DANGER = '#c8102e'
const GREEN = '#22c55e'

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

/**
 * The forms vertical, for staff.
 *
 * Three surfaces in one panel: the LIST of forms a person may touch, the BUILDER
 * that adds, reorders and removes fields, and the RESPONSES viewer per form.
 *
 * Who sees what is RLS's decision and this only mirrors it: an admin (or a
 * manage_forms holder) manages every form and reads every submission; a coach
 * manages their own form and reads its submissions, and sees the general form
 * read-only. The refusals here are signage — the write still meets migration
 * 024's policies whatever this file renders.
 */
export default function FormsPanel({ isDemo = false }: { isDemo?: boolean }) {
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
  const [view, setView] = useState<'edit' | 'responses'>('edit')
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
    setView('edit')
    setSaved(false)
    setEditorError(null)
  }
  const openForm = (form: IntakeForm) => {
    setDraft(formToDraft(form))
    setView('edit')
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
  const showResponsesTab = !!draft.id && canViewSubs(draft)

  return (
    <div className="dash-pad" style={{ maxWidth: 820 }}>
      {isDemo && <DemoBanner note="Changes here stay in this preview." />}

      <button onClick={closeEditor} style={{ ...btn('ghost', { border: 'none', padding: '.5rem 0', minHeight: 'auto', marginBottom: '1rem' }) }}>
        ← All forms
      </button>

      {/* Tabs */}
      {showResponsesTab && (
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--surface-2)' }}>
          {(['edit', 'responses'] as const).map(t => (
            <button
              key={t}
              onClick={() => setView(t)}
              style={{
                background: 'none', border: 'none', borderBottom: `2px solid ${view === t ? ACCENT : 'transparent'}`,
                color: view === t ? 'var(--text)' : 'var(--text-4)', fontSize: '.7rem', fontWeight: 900,
                letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem .4rem', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {t === 'edit' ? 'Builder' : 'Responses'}
            </button>
          ))}
        </div>
      )}

      {view === 'responses' && draft.id
        ? <Responses formId={draft.id} form={forms.find(f => f.id === draft.id) ?? null} isDemo={isDemo} />
        : (
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
        )}
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

// ── Responses ─────────────────────────────────────────────────────────────────

function Responses({ formId, form, isDemo }: { formId: string; form: IntakeForm | null; isDemo: boolean }) {
  const [subs, setSubs] = useState<FormSubmission[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    fetchSubmissions(formId, isDemo).then(rows => {
      if (!live) return
      setSubs(rows)
      setLoading(false)
    })
    return () => { live = false }
  }, [formId, isDemo])

  const labelFor = (key: string) => form?.fields.find(f => f.key === key)?.label ?? key

  if (loading) {
    return <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading responses…</p>
  }
  if (subs === null) {
    return <ErrorNote message="Couldn't load the responses. That's on our side." />
  }
  if (subs.length === 0) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>No responses yet.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ color: 'var(--text-4)', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>
        {subs.length} {subs.length === 1 ? 'response' : 'responses'}
      </p>
      {subs.map(sub => (
        <div key={sub.id} style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1rem 1.1rem' }}>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.75rem' }}>
            <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.8rem' }}>{sub.clientEmail || 'No email'}</span>
            <Badge text={sub.clientId ? 'Member' : 'Guest'} color={sub.clientId ? ACCENT : 'var(--text-4)'} />
            <span style={{ color: 'var(--text-4)', fontSize: '.7rem', marginLeft: 'auto' }}>
              {new Date(sub.submittedAt).toLocaleString('en-US')}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
            {Object.entries(sub.answers).map(([key, value]) => (
              <div key={key} style={{ display: 'flex', gap: '.75rem', fontSize: '.78rem', alignItems: 'baseline' }}>
                <span style={{ minWidth: '9rem', maxWidth: '9rem', color: 'var(--text-3)', flexShrink: 0 }}>{labelFor(key)}</span>
                <span style={{ color: 'var(--text)', wordBreak: 'break-word' }}>
                  {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
