import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useBotTrap } from '../lib/botTrap'
import {
  fetchActiveForm, submitForm, type IntakeForm as IntakeFormDef, type FormField,
} from '../lib/forms'

const ACCENT = '#272C84'

/**
 * The public, dynamic intake form.
 *
 * Renders whichever active form applies — the general one, or a coach's, chosen
 * by `coachSlug` — and submits the answers. Mountable two ways: on its own page
 * (the /intake route) and inside the account area after a booking, which is why
 * it carries its own section chrome only when `embedded` is false.
 *
 * Every value is sanitised and length-capped in src/lib/forms.ts before it is
 * written; this component adds the bot trap and the required-field messaging.
 * A suspected bot is shown success and nothing is written — the honeypot is only
 * worth anything while it stays silent (see botTrap.ts).
 */
export default function IntakeForm({
  coachSlug = null,
  isDemo = false,
  embedded = false,
  onSubmitted,
}: {
  /** Which form to render: a coach's slug, or null for the general one. */
  coachSlug?: string | null
  isDemo?: boolean
  /** Drop the outer <section> + heading — for mounting inside the account area. */
  embedded?: boolean
  onSubmitted?: () => void
}) {
  const { profile } = useAuth()

  const [form, setForm] = useState<IntakeFormDef | null>(null)
  const [loading, setLoading] = useState(true)
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({})
  const [errorKeys, setErrorKeys] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const bot = useBotTrap()

  useEffect(() => {
    let live = true
    setLoading(true)
    fetchActiveForm(coachSlug, isDemo).then(f => {
      if (!live) return
      setForm(f)
      setLoading(false)
    })
    return () => { live = false }
  }, [coachSlug, isDemo])

  // The field whose answer doubles as the submission's contact email. Prefilled
  // for a signed-in athlete so the account area does not re-ask what we know.
  const emailKey = useMemo(
    () => form?.fields.find(f => /email/i.test(f.key) || /email/i.test(f.label))?.key ?? null,
    [form],
  )

  useEffect(() => {
    if (emailKey && profile?.email) {
      setAnswers(a => (a[emailKey] ? a : { ...a, [emailKey]: profile.email }))
    }
  }, [emailKey, profile?.email])

  const setAnswer = (key: string, value: string | boolean) => {
    setAnswers(a => ({ ...a, [key]: value }))
    setErrorKeys(s => {
      if (!s.has(key)) return s
      const next = new Set(s)
      next.delete(key)
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return

    // Silent success for a suspected bot. Never surface "you look like a bot".
    if (bot.isSuspect()) { setSubmitted(true); onSubmitted?.(); return }

    // Required-field pass, so the person sees every gap at once.
    const missing = new Set<string>()
    for (const f of form.fields) {
      if (!f.required) continue
      const v = answers[f.key]
      const empty = f.type === 'checkbox' ? v !== true : (v === undefined || String(v).trim() === '')
      if (empty) missing.add(f.key)
    }
    if (missing.size > 0) { setErrorKeys(missing); setError('Please fill in every required field.'); return }

    setSubmitting(true)
    setError('')

    const email = emailKey ? String(answers[emailKey] ?? '') : ''
    const res = await submitForm(form.id, form, answers, email, isDemo)
    setSubmitting(false)

    if (!res.ok) { setError(res.message); return }
    setSubmitted(true)
    onSubmitted?.()
  }

  // ── States ─────────────────────────────────────────────────────────────────
  const shell = (children: React.ReactNode) =>
    embedded
      ? <div>{children}</div>
      : (
        <section style={{ background: 'var(--bg)', padding: '6rem 1.5rem', minHeight: embedded ? undefined : '60vh' }}>
          <div style={{ maxWidth: 640, margin: '0 auto' }}>{children}</div>
        </section>
      )

  if (loading) {
    return shell(
      <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase', textAlign: 'center' }}>
        Loading form…
      </p>,
    )
  }

  if (!form) {
    return shell(
      <div style={{ textAlign: 'center' }}>
        <p style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.75rem' }}>No form yet</p>
        <p style={{ color: 'var(--text-2)', fontSize: '.85rem', lineHeight: 1.7 }}>
          There is no intake form to fill in right now. Please check back later.
        </p>
      </div>,
    )
  }

  if (submitted) {
    return shell(
      <div style={{ textAlign: 'center', padding: embedded ? '2rem 0' : '3rem 1rem' }}>
        <p style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '1rem' }}>Received</p>
        <h3 style={{ color: 'var(--text)', fontWeight: 900, fontSize: embedded ? '1.5rem' : '2.25rem', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '1rem' }}>
          Thank you.
        </h3>
        <p style={{ color: 'var(--text-2)', fontSize: '.9rem', lineHeight: 1.7 }}>
          Your intake has been submitted. Your coach will have it before your first session.
        </p>
      </div>,
    )
  }

  return shell(
    <>
      {!embedded && (
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <p style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '1rem' }}>Intake</p>
          <h2 style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: 0.95, fontSize: 'clamp(2rem,5vw,3.5rem)', color: 'var(--text)', marginBottom: '1rem' }}>
            {form.title}
          </h2>
          {form.description && (
            <p style={{ color: 'var(--text-2)', fontSize: '.9rem', lineHeight: 1.7 }}>{form.description}</p>
          )}
        </div>
      )}

      {embedded && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '-.01em' }}>{form.title}</h3>
          {form.description && (
            <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.6, marginTop: '.4rem' }}>{form.description}</p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        {/* Honeypot — bare input by design (see botTrap.ts). */}
        <input {...bot.fieldProps} />

        {form.fields.map(field => (
          <Field
            key={field.key}
            field={field}
            value={answers[field.key]}
            invalid={errorKeys.has(field.key)}
            onChange={v => setAnswer(field.key, v)}
          />
        ))}

        {error && (
          <p role="alert" style={{ color: '#f87171', fontSize: '.8rem' }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            alignSelf: 'flex-start',
            background: submitting ? '#7a6530' : ACCENT,
            border: 'none', color: '#ffffff',
            fontWeight: 900, fontSize: '.7rem', letterSpacing: '.15em', textTransform: 'uppercase',
            padding: '.85rem 2rem', borderRadius: '.25rem', minHeight: '2.75rem',
            cursor: submitting ? 'default' : 'pointer', fontFamily: 'inherit',
          }}
        >
          {submitting ? 'Sending…' : 'Submit'}
        </button>
      </form>
    </>,
  )
}

// ── One field ─────────────────────────────────────────────────────────────────

const CAP: Record<FormField['type'], number> = {
  text: 200, textarea: 3000, number: 12, select: 120, checkbox: 1, date: 10,
}

function Field({ field, value, invalid, onChange }: {
  field: FormField
  value: string | boolean | undefined
  invalid: boolean
  onChange: (v: string | boolean) => void
}) {
  const labelEl = (
    <label className="field-label" htmlFor={`intake-${field.key}`}>
      {field.label}{field.required && <span style={{ color: 'var(--text)' }}> *</span>}
    </label>
  )

  const outline = invalid ? { borderColor: '#f87171' } : undefined
  const strVal = typeof value === 'string' ? value : ''

  if (field.type === 'checkbox') {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem' }}>
        <input
          id={`intake-${field.key}`}
          type="checkbox"
          checked={value === true}
          onChange={e => onChange(e.target.checked)}
          style={{ marginTop: '.15rem', accentColor: ACCENT, width: '1rem', height: '1rem', flexShrink: 0, cursor: 'pointer', outline: invalid ? '1px solid #f87171' : undefined }}
        />
        <label htmlFor={`intake-${field.key}`} style={{ color: 'var(--text-2)', fontSize: '.85rem', lineHeight: 1.6, cursor: 'pointer' }}>
          {field.label}{field.required && <span style={{ color: 'var(--text)' }}> *</span>}
        </label>
      </div>
    )
  }

  if (field.type === 'textarea') {
    return (
      <div>
        {labelEl}
        <textarea
          id={`intake-${field.key}`} className="field" rows={4}
          value={strVal} maxLength={CAP.textarea} style={outline}
          onChange={e => onChange(e.target.value)}
        />
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <div>
        {labelEl}
        <select
          id={`intake-${field.key}`} className="field"
          value={strVal} style={outline}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {(field.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    )
  }

  const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'
  return (
    <div>
      {labelEl}
      <input
        id={`intake-${field.key}`} className="field" type={inputType}
        value={strVal} maxLength={CAP[field.type]} style={outline}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}
