/**
 * forms.ts — intake forms and their submissions.
 *
 * A form is a ROW now, not a hard-coded questionnaire: a coach builds their own,
 * an admin builds a general one, and the public /intake page renders whichever
 * applies. The answers land in `form_submissions`.
 *
 *   Demo mode  →  in-memory store seeded from DEMO_FORMS / DEMO_SUBMISSIONS
 *   Live mode  →  Supabase `intake_forms` + `form_submissions`
 *
 * Everything user-typed is sanitised and length-capped before it is written —
 * the builder labels, the form title, and every answer. Nothing here is the
 * security boundary: migration 024's RLS and the client_id stamp trigger are.
 * These functions hide controls that would fail and keep junk out of the table;
 * a caller who skips them still meets the same policies.
 *
 * Nothing throws. Every failure is a value, because every caller is a screen or
 * a public form that has to say something.
 *
 * Supabase migration: supabase/migrations/024_forms.sql
 */

import { supabase, supabaseConfigured } from './supabase'
import { sanitizeText, sanitizeShort, sanitizeEmail, isValidEmail, clampInt } from '../utils/sanitize'

// ── Types ───────────────────────────────────────────────────────────────────

export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'date'

export const FIELD_TYPES: FieldType[] = ['text', 'textarea', 'number', 'select', 'checkbox', 'date']

function isFieldType(v: unknown): v is FieldType {
  return typeof v === 'string' && (FIELD_TYPES as string[]).includes(v)
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  number: 'Number',
  select: 'Choose one',
  checkbox: 'Checkbox',
  date: 'Date',
}

/** One question on a form. `options` is only meaningful for `select`. */
export interface FormField {
  key: string
  label: string
  type: FieldType
  required: boolean
  options?: string[]
}

export interface IntakeForm {
  id: string
  /** null = the general, site-wide form. A slug = one coach's form. */
  coachSlug: string | null
  title: string
  description: string | null
  isActive: boolean
  fields: FormField[]
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface FormSubmission {
  id: string
  formId: string
  /** null = a guest submitted signed-out. */
  clientId: string | null
  clientEmail: string | null
  answers: Record<string, unknown>
  submittedAt: string
}

/** Draft shape the builder saves. `id` present = update, absent = create. */
export interface FormDraft {
  id?: string
  coachSlug: string | null
  title: string
  description: string
  isActive: boolean
  fields: FormField[]
  /** Stamped on create; ignored on update. */
  createdBy?: string | null
}

export type SaveResult =
  | { ok: true; form: IntakeForm }
  | { ok: false; message: string }

export type SubmitResult =
  | { ok: true }
  | { ok: false; message: string }

const FORM_COLUMNS =
  'id,coach_slug,title,description,is_active,fields,created_by,created_at,updated_at'
const SUBMISSION_COLUMNS =
  'id,form_id,client_id,client_email,answers,submitted_at'

// ── Field validation / normalisation ────────────────────────────────────────

const LABEL_MAX = 200
const OPTION_MAX = 120
const MAX_FIELDS = 100
const MAX_OPTIONS = 40
const ANSWER_MAX = 3000

/** A url/dom-safe key from a label, for a field the builder never named. */
function slugKey(label: string, index: number): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  return base || `field_${index + 1}`
}

/**
 * Clean a builder's fields into what the database will accept: labels and
 * options sanitised and capped, an unknown type coerced to text, empty options
 * dropped, and keys made unique so two questions never overwrite one answer.
 */
export function normalizeFields(fields: FormField[]): FormField[] {
  const seen = new Set<string>()
  const out: FormField[] = []

  for (let i = 0; i < fields.length && out.length < MAX_FIELDS; i++) {
    const f = fields[i]
    const label = sanitizeText(String(f?.label ?? ''), LABEL_MAX).trim()
    if (!label) continue

    const type: FieldType = isFieldType(f?.type) ? f.type : 'text'

    let key = sanitizeShort(String(f?.key ?? '')).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
    if (!key) key = slugKey(label, i)
    // Collisions would make two questions write the same answer slot.
    let unique = key
    let n = 2
    while (seen.has(unique)) unique = `${key}_${n++}`
    seen.add(unique)

    const field: FormField = { key: unique, label, type, required: !!f?.required }

    if (type === 'select') {
      const options = (Array.isArray(f?.options) ? f.options : [])
        .map(o => sanitizeText(String(o ?? ''), OPTION_MAX).trim())
        .filter(Boolean)
        .slice(0, MAX_OPTIONS)
      // A select with no options is an unanswerable question; keep the label but
      // let it fall back to a plain text box rather than storing a dead dropdown.
      if (options.length === 0) { field.type = 'text' }
      else field.options = options
    }

    out.push(field)
  }

  return out
}

/** The first thing wrong with a draft, or null if it is ready to save. */
export function draftProblem(draft: FormDraft): string | null {
  if (!draft.title.trim()) return 'Give the form a title.'
  const fields = normalizeFields(draft.fields)
  if (fields.length === 0) return 'Add at least one question.'
  return null
}

// ── Row mapping ─────────────────────────────────────────────────────────────

function asFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return []
  return normalizeFields(raw as FormField[])
}

function rowToForm(row: Record<string, unknown>): IntakeForm {
  return {
    id: String(row.id),
    coachSlug: (row.coach_slug as string | null) ?? null,
    title: String(row.title ?? ''),
    description: (row.description as string | null) ?? null,
    isActive: !!row.is_active,
    fields: asFields(row.fields),
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? row.created_at ?? ''),
  }
}

function rowToSubmission(row: Record<string, unknown>): FormSubmission {
  const answers = (row.answers && typeof row.answers === 'object')
    ? row.answers as Record<string, unknown>
    : {}
  return {
    id: String(row.id),
    formId: String(row.form_id),
    clientId: (row.client_id as string | null) ?? null,
    clientEmail: (row.client_email as string | null) ?? null,
    answers,
    submittedAt: String(row.submitted_at ?? ''),
  }
}

// ── In-memory demo store ─────────────────────────────────────────────────────

const DEMO_FORMS: IntakeForm[] = [
  {
    id: 'demo-form-general',
    coachSlug: null,
    title: 'General Intake',
    description: 'Tell us about yourself and your training. This helps us point you to the right coach and start your program on the right footing.',
    isActive: true,
    fields: [
      { key: 'full_name', label: 'Full name', type: 'text', required: true },
      { key: 'email', label: 'Email address', type: 'text', required: true },
      { key: 'phone', label: 'Phone number', type: 'text', required: false },
      { key: 'goals', label: 'What are your main training goals?', type: 'textarea', required: true },
      { key: 'experience', label: 'How long have you been training seriously?', type: 'select', required: true, options: ['Less than 1 year', '1 to 2 years', '2 to 4 years', '4 or more years'] },
      { key: 'injuries', label: 'Any past or current injuries or medical conditions we should know about?', type: 'textarea', required: false },
      { key: 'training_days', label: 'How many days a week can you train?', type: 'number', required: true },
      { key: 'consent', label: 'I understand Axis Training Systems will use this information to provide coaching.', type: 'checkbox', required: true },
    ],
    createdBy: null,
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
  },
  {
    id: 'demo-form-ronnie',
    coachSlug: 'ronnie-vallejo',
    title: 'Ronnie — Powerlifting Intake',
    description: 'A few extra questions before we build your first block together.',
    isActive: true,
    fields: [
      { key: 'full_name', label: 'Full name', type: 'text', required: true },
      { key: 'email', label: 'Email address', type: 'text', required: true },
      { key: 'best_total', label: 'Best competition or gym total (lbs)', type: 'number', required: false },
      { key: 'next_meet', label: 'Do you have a meet coming up? When?', type: 'text', required: false },
      { key: 'weak_point', label: 'Which lift needs the most work?', type: 'select', required: true, options: ['Squat', 'Bench', 'Deadlift', 'All three'] },
    ],
    createdBy: 'demo-ronnie',
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
  },
]

const DEMO_SUBMISSIONS: FormSubmission[] = [
  {
    id: 'demo-sub-1',
    formId: 'demo-form-general',
    clientId: null,
    clientEmail: 'jordan@example.com',
    answers: {
      full_name: 'Jordan Reyes',
      email: 'jordan@example.com',
      phone: '(559) 555-0142',
      goals: 'Compete in my first powerlifting meet within a year and hit a 1000 lb total.',
      experience: '1 to 2 years',
      injuries: 'Mild lower back tightness, nothing diagnosed.',
      training_days: 4,
      consent: true,
    },
    submittedAt: '2026-08-05T17:20:00.000Z',
  },
  {
    id: 'demo-sub-2',
    formId: 'demo-form-ronnie',
    clientId: null,
    clientEmail: 'sam@example.com',
    answers: {
      full_name: 'Sam Whitfield',
      email: 'sam@example.com',
      best_total: 1185,
      next_meet: 'USAPL state in November',
      weak_point: 'Bench',
    },
    submittedAt: '2026-08-09T15:05:00.000Z',
  },
]

let _demoForms: IntakeForm[] | null = null
let _demoSubs: FormSubmission[] | null = null

function demoForms(): IntakeForm[] {
  if (!_demoForms) _demoForms = DEMO_FORMS.map(f => ({ ...f, fields: f.fields.map(x => ({ ...x })) }))
  return _demoForms
}
function demoSubs(): FormSubmission[] {
  if (!_demoSubs) _demoSubs = DEMO_SUBMISSIONS.map(s => ({ ...s, answers: { ...s.answers } }))
  return _demoSubs
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The forms the current staff member may manage. RLS decides the rows: an admin
 * (or manage_forms holder) gets every form; a coach gets their own plus the
 * active general one. Null is an outage — kept distinct from "no forms" so a
 * failed read never reads as an empty roster.
 */
export async function fetchForms(isDemo: boolean): Promise<IntakeForm[] | null> {
  if (!supabaseConfigured || isDemo) {
    return demoForms().map(f => ({ ...f, fields: f.fields.map(x => ({ ...x })) }))
  }

  const { data, error } = await supabase
    .from('intake_forms')
    .select(FORM_COLUMNS)
    // General form first, then newest.
    .order('coach_slug', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })

  if (error) return null
  return (data ?? []).map(r => rowToForm(r as Record<string, unknown>))
}

/**
 * The single active form to render for a scope — a coach's slug, or null for the
 * general one. Null result = none published (or an outage). The public /intake
 * page and the post-booking step both start here.
 */
export async function fetchActiveForm(coachSlug: string | null, isDemo: boolean): Promise<IntakeForm | null> {
  if (!supabaseConfigured || isDemo) {
    const match = demoForms()
      .filter(f => f.isActive && f.coachSlug === coachSlug)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    return match ? { ...match, fields: match.fields.map(x => ({ ...x })) } : null
  }

  let q = supabase
    .from('intake_forms')
    .select(FORM_COLUMNS)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)

  q = coachSlug === null ? q.is('coach_slug', null) : q.eq('coach_slug', coachSlug)

  const { data, error } = await q.maybeSingle()
  if (error || !data) return null
  return rowToForm(data as Record<string, unknown>)
}

/**
 * The submissions to one form, newest first. Null = outage. RLS confines this to
 * the admin, a view_form_submissions holder, or the coach who owns the form.
 */
export async function fetchSubmissions(formId: string, isDemo: boolean): Promise<FormSubmission[] | null> {
  if (!supabaseConfigured || isDemo) {
    return demoSubs()
      .filter(s => s.formId === formId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .map(s => ({ ...s, answers: { ...s.answers } }))
  }

  const { data, error } = await supabase
    .from('form_submissions')
    .select(SUBMISSION_COLUMNS)
    .eq('form_id', formId)
    .order('submitted_at', { ascending: false })

  if (error) return null
  return (data ?? []).map(r => rowToSubmission(r as Record<string, unknown>))
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Create or update a form. `draft.id` present updates in place; absent creates.
 *
 * Fields are normalised before the write, so the row that lands is always clean.
 * The database may still refuse — a coach who is not the owner, or a change to
 * the questions of a form athletes have already answered — and that refusal is
 * returned as a sentence rather than thrown.
 */
export async function saveForm(draft: FormDraft, isDemo: boolean): Promise<SaveResult> {
  const problem = draftProblem(draft)
  if (problem) return { ok: false, message: problem }

  const title = sanitizeText(draft.title, 200).trim()
  const description = sanitizeText(draft.description ?? '', 2000).trim()
  const fields = normalizeFields(draft.fields)
  const coachSlug = draft.coachSlug
    ? sanitizeShort(draft.coachSlug).trim().toLowerCase()
    : null

  if (!supabaseConfigured || isDemo) {
    const store = demoForms()
    const now = new Date().toISOString()
    if (draft.id) {
      const idx = store.findIndex(f => f.id === draft.id)
      if (idx === -1) return { ok: false, message: 'That form no longer exists.' }
      // Mirror the answered-form guard so the demo behaves like production.
      const answered = demoSubs().some(s => s.formId === draft.id)
      const fieldsChanged = JSON.stringify(store[idx].fields) !== JSON.stringify(fields)
      if (answered && fieldsChanged) {
        return { ok: false, message: 'Athletes have already answered this form. Switch it off and build a new one rather than changing the questions.' }
      }
      const updated: IntakeForm = { ...store[idx], title, description, isActive: draft.isActive, fields, coachSlug, updatedAt: now }
      store[idx] = updated
      return { ok: true, form: { ...updated, fields: updated.fields.map(x => ({ ...x })) } }
    }
    const created: IntakeForm = {
      id: `demo-form-${Math.random().toString(36).slice(2, 10)}`,
      coachSlug, title, description, isActive: draft.isActive, fields,
      createdBy: draft.createdBy ?? null, createdAt: now, updatedAt: now,
    }
    store.unshift(created)
    return { ok: true, form: { ...created, fields: created.fields.map(x => ({ ...x })) } }
  }

  if (draft.id) {
    const { data, error } = await supabase
      .from('intake_forms')
      .update({ title, description: description || null, is_active: draft.isActive, coach_slug: coachSlug, fields })
      .eq('id', draft.id)
      .select(FORM_COLUMNS)
      .single()
    if (error) return { ok: false, message: saveError(error.message) }
    return { ok: true, form: rowToForm(data as Record<string, unknown>) }
  }

  const { data, error } = await supabase
    .from('intake_forms')
    .insert({ title, description: description || null, is_active: draft.isActive, coach_slug: coachSlug, fields, created_by: draft.createdBy ?? null })
    .select(FORM_COLUMNS)
    .single()
  if (error) return { ok: false, message: saveError(error.message) }
  return { ok: true, form: rowToForm(data as Record<string, unknown>) }
}

/** The most common refusals, turned into something a coach can act on. */
function saveError(raw: string): string {
  if (/row-level security|violates row-level/i.test(raw)) {
    return 'You can only edit your own form or the general one you have been given access to.'
  }
  if (/already answered|filled this form/i.test(raw)) return raw
  return 'Could not save the form. Please try again.'
}

/**
 * Submit a filled-in form. Public — the caller may be a guest. Answers are
 * sanitised and capped by field type; the email is validated. The database
 * stamps client_id from the session, so a signed-in submitter's answers become
 * readable to them and a guest's stay guest.
 */
export async function submitForm(
  formId: string,
  form: IntakeForm,
  rawAnswers: Record<string, unknown>,
  rawEmail: string,
  isDemo: boolean,
): Promise<SubmitResult> {
  const email = sanitizeEmail(String(rawEmail ?? ''))
  const answers = cleanAnswers(form.fields, rawAnswers)

  // Required-field check, mirroring what the DB does NOT enforce (a jsonb blob
  // has no per-key NOT NULL). The public component checks too; this is the seam
  // every caller passes through.
  for (const f of form.fields) {
    if (!f.required) continue
    const v = answers[f.key]
    const missing = f.type === 'checkbox' ? v !== true : (v === undefined || v === null || String(v).trim() === '')
    if (missing) return { ok: false, message: `Please answer: ${f.label}` }
  }

  // An email field, if the form has one, must be a real address.
  if (email && !isValidEmail(email)) return { ok: false, message: 'Enter a valid email address.' }

  if (!supabaseConfigured || isDemo) {
    demoSubs().unshift({
      id: `demo-sub-${Math.random().toString(36).slice(2, 10)}`,
      formId, clientId: null, clientEmail: email || null, answers,
      submittedAt: new Date().toISOString(),
    })
    return { ok: true }
  }

  const { error } = await supabase
    .from('form_submissions')
    .insert({ form_id: formId, client_email: email || null, answers })
  if (error) {
    if (/row-level security|violates row-level/i.test(error.message)) {
      return { ok: false, message: 'This form is no longer accepting responses.' }
    }
    return { ok: false, message: 'Could not send your response. Please try again.' }
  }
  return { ok: true }
}

/** Sanitise each answer by its field's type, dropping anything off-form. */
function cleanAnswers(fields: FormField[], raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const v = raw[f.key]
    if (v === undefined || v === null) continue
    switch (f.type) {
      case 'checkbox':
        out[f.key] = v === true || v === 'true'
        break
      case 'number': {
        const s = String(v).trim()
        if (s === '') break
        out[f.key] = clampInt(s, -1_000_000, 1_000_000, 0)
        break
      }
      case 'select': {
        const s = sanitizeText(String(v), OPTION_MAX).trim()
        // Only accept a value that is actually one of the offered options.
        if (f.options && f.options.includes(s)) out[f.key] = s
        break
      }
      case 'date': {
        const s = sanitizeShort(String(v)).trim()
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out[f.key] = s
        break
      }
      default: {
        const s = sanitizeText(String(v), ANSWER_MAX).trim()
        if (s) out[f.key] = s
      }
    }
  }
  return out
}

/** For the demo/reset seam and tests. */
export function _resetFormsDemoStore() {
  _demoForms = null
  _demoSubs = null
}
