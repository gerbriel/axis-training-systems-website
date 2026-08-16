import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTENT_LIMITS,
  CONTENT_TYPE_LABELS,
  CONTENT_TYPES,
  blankContentFor,
  defaultContentFor,
  parseGuideContent,
  validateGuideContent,
} from '../src/lib/guideContent.ts'
import type { GuideContent, GuideContentType } from '../src/lib/guideContent.ts'

// Guide content is a jsonb blob an admin writes and a PUBLIC page renders, so
// this validator is the only thing between a half-finished draft and a card
// that shows nothing. Two properties matter more than the rest:
//
//   Nothing is repaired. A guide that saved is the guide that was typed, so a
//   value that is wrong comes back refused with the first problem named rather
//   than trimmed to fit and stored as something else.
//
//   Nothing throws. parseGuideContent runs at render time on data nobody
//   checked, and a card falling back to its built-in is the failure we want.

const BUILTIN_KEYS = ['checklist', 'quiz', 'rpe', 'big3', 'audit']

/** Every string anywhere in a content object, for the sweeps below. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach(v => strings(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach(v => strings(v, out))
  return out
}

/** The message a refusal came back with, or a failure if it was accepted. */
function refusal(value: unknown): string {
  const result = validateGuideContent(value)
  // String() first: JSON.stringify(undefined) is undefined, not a string.
  assert.equal(result.ok, false, `expected a refusal, got: ${String(JSON.stringify(value)).slice(0, 120)}`)
  return result.ok ? '' : result.message
}

function accepted(value: unknown): GuideContent {
  const result = validateGuideContent(value)
  assert.equal(result.ok, true, result.ok ? '' : result.message)
  if (!result.ok) throw new Error(result.message)
  return result.content
}

// ---------------------------------------------------------------------------
// 1. The content the site ships with
// ---------------------------------------------------------------------------

test('every built-in guide has content, and every one of them validates', () => {
  for (const key of BUILTIN_KEYS) {
    const content = defaultContentFor(key)
    assert.ok(content, `${key} has no default content`)
    const back = accepted(content)
    // Byte for byte: validation of the shipped copy is a check, not a clean-up.
    assert.deepEqual(back, content)
  }
})

test('the attempt calculator and anything unknown have no content at all', () => {
  // That card is a form over calculator_settings, not copy, and the admin panel
  // reads this null as "there is nothing here to edit".
  assert.equal(defaultContentFor('attempts'), null)
  assert.equal(defaultContentFor('time_machine'), null)
  assert.equal(defaultContentFor(''), null)
  assert.equal(defaultContentFor(null), null)
})

test('the built-ins land on the content type each guide is', () => {
  assert.equal(defaultContentFor('checklist')?.type, 'checklist')
  assert.equal(defaultContentFor('quiz')?.type, 'quiz')
  assert.equal(defaultContentFor('rpe')?.type, 'reference')
  assert.equal(defaultContentFor('big3')?.type, 'sections')
  assert.equal(defaultContentFor('audit')?.type, 'worksheet')
})

test('defaults come back as a copy, so an editor cannot rewrite what ships', () => {
  const first = defaultContentFor('checklist')
  assert.ok(first && first.type === 'checklist')
  first.sections[0].title = 'Edited in a form somewhere'
  const second = defaultContentFor('checklist')
  assert.ok(second && second.type === 'checklist')
  assert.notEqual(second.sections[0].title, 'Edited in a form somewhere')
})

test('no em dash survived the move out of the page', () => {
  // The house rule for site copy. The originals had a dozen of them.
  for (const key of BUILTIN_KEYS) {
    for (const s of strings(defaultContentFor(key))) {
      assert.equal(s.includes('—'), false, `em dash in ${key}: ${s}`)
    }
  }
})

// ---------------------------------------------------------------------------
// 2. Starters
// ---------------------------------------------------------------------------

test('a blank of every type validates, and is the type it was asked for', () => {
  for (const type of CONTENT_TYPES) {
    const blank = blankContentFor(type)
    assert.equal(blank.type, type)
    accepted(blank)
  }
})

test('every content type has a name a person can read in a picker', () => {
  for (const type of CONTENT_TYPES) {
    assert.equal(typeof CONTENT_TYPE_LABELS[type], 'string')
    assert.ok(CONTENT_TYPE_LABELS[type].length > 0)
  }
})

// ---------------------------------------------------------------------------
// 3. The type tag
// ---------------------------------------------------------------------------

test('content with no type, or a type we do not have, is refused', () => {
  assert.match(refusal({ sections: [] }), /which kind of guide/)
  assert.match(refusal({ type: 'podcast', sections: [] }), /which kind of guide/)
  assert.match(refusal({ type: 'checklist ', sections: [] }), /which kind of guide/)
})

test('a value that is not a block of settings at all is refused', () => {
  for (const value of ['checklist', 42, null, undefined, [], true]) {
    assert.match(refusal(value), /block of settings/)
  }
})

// ---------------------------------------------------------------------------
// 4. Shape, size and the spot the message names
// ---------------------------------------------------------------------------

const checklist = (sections: unknown) => ({ type: 'checklist', sections })

test('a list is refused when it is missing, empty, or over the cap', () => {
  assert.match(refusal(checklist(undefined)), /no sections/)
  assert.match(refusal(checklist('Night before')), /no sections/)
  assert.match(refusal(checklist([])), /at least one section/)

  const many = Array.from({ length: CONTENT_LIMITS.list + 1 }, (_, i) => ({ title: `S${i}`, items: [] }))
  assert.match(refusal(checklist(many)), new RegExp(`more than ${CONTENT_LIMITS.list} sections`))
})

test('an over-long string is refused, and the message says which one', () => {
  const long = 'x'.repeat(CONTENT_LIMITS.label + 1)
  assert.match(refusal(checklist([{ title: long, items: [] }])), /title of section 1/)

  const item = 'y'.repeat(CONTENT_LIMITS.text + 1)
  assert.match(refusal(checklist([{ title: 'Fine', items: ['ok'] }, { title: 'Fine', items: [item] }])), /Item 1 of section 2/)
})

test('a blank title is refused separately from a missing one', () => {
  assert.match(refusal(checklist([{ title: '   ', items: [] }])), /cannot be blank/)
  assert.match(refusal(checklist([{ title: 7, items: [] }])), /needs to be text/)
  assert.match(refusal(checklist(['Night before'])), /Section 1 is not filled in/)
})

test('strings are trimmed on the way in', () => {
  const content = accepted(checklist([{ title: '  Night Before  ', items: ['  Pack the bag  '] }]))
  assert.deepEqual(content, { type: 'checklist', sections: [{ title: 'Night Before', items: ['Pack the bag'] }] })
})

// ---------------------------------------------------------------------------
// 5. Tables
// ---------------------------------------------------------------------------

const table = (over: Record<string, unknown> = {}) => ({
  type: 'reference',
  columns: ['RPE', 'Reps left', 'What it feels like'],
  rows: [['8', '2', 'Hard.']],
  ...over,
})

test('a row with the wrong number of cells is refused, not padded', () => {
  const message = refusal(table({ rows: [['8', '2', 'Hard.'], ['9', '1']] }))
  assert.match(message, /Row 2/)
  assert.match(message, /2 cells/)
  assert.match(message, /3 columns/)
})

test('a table needs a header, and an empty cell is a cell', () => {
  assert.match(refusal(table({ columns: [] })), /at least one column/)
  assert.match(refusal(table({ rows: [['8', '2']] })), /Row 1/)
  const content = accepted(table({ rows: [['8', '', 'Hard.']] }))
  assert.equal(content.type === 'reference' && content.rows[0][1], '')
})

test('the columns are capped tighter than the rows, because a card has a width', () => {
  const wide = Array.from({ length: CONTENT_LIMITS.columns + 1 }, (_, i) => `C${i}`)
  assert.match(refusal(table({ columns: wide, rows: [] })), new RegExp(`more than ${CONTENT_LIMITS.columns} columns`))

  const tall = Array.from({ length: CONTENT_LIMITS.rows + 1 }, () => ['8', '2', 'Hard.'])
  assert.match(refusal(table({ rows: tall })), new RegExp(`more than ${CONTENT_LIMITS.rows} entries`))
})

test('an empty closing note is left off rather than stored as an empty line', () => {
  const content = accepted(table({ footnote: '   ' }))
  assert.equal('footnote' in content, false)
  const kept = accepted(table({ footnote: '  Film your sets.  ' }))
  assert.equal(kept.type === 'reference' && kept.footnote, 'Film your sets.')
})

// ---------------------------------------------------------------------------
// 6. Scoring
// ---------------------------------------------------------------------------

const quiz = (over: Record<string, unknown> = {}) => ({
  type: 'quiz',
  questions: [{ prompt: 'How is your training structured?', options: [{ label: 'No plan', points: 0 }, { label: 'A plan', points: 2 }] }],
  tiers: [{ maxPoints: 1, label: 'Room to work', note: 'Start here.' }, { maxPoints: 2, label: 'Strong', note: 'Keep going.' }],
  ...over,
})

test('points have to be whole numbers inside the range', () => {
  assert.match(refusal(quiz({ questions: [{ prompt: 'Q', options: [{ label: 'A', points: 1.5 }] }] })), /whole number/)
  assert.match(refusal(quiz({ questions: [{ prompt: 'Q', options: [{ label: 'A', points: '2' }] }] })), /needs a number/)
  assert.match(refusal(quiz({ questions: [{ prompt: 'Q', options: [{ label: 'A', points: -1 }] }] })), /between 0 and 100/)
  assert.match(refusal(quiz({ questions: [{ prompt: 'Q', options: [{ label: 'A', points: 101 }] }] })), /between 0 and 100/)
  // And the message says which answer of which question.
  assert.match(
    refusal(quiz({ questions: [{ prompt: 'Q', options: [{ label: 'A', points: 0 }, { label: 'B', points: 1.5 }] }] })),
    /answer 2 of question 1/,
  )
})

test('a question with nothing to pick is refused', () => {
  assert.match(refusal(quiz({ questions: [{ prompt: 'Q', options: [] }] })), /Question 1 needs at least one answer/)
  assert.match(refusal(quiz({ questions: [{ prompt: 'Q' }] })), /no answers to choose from/)
})

test('quiz tiers have to climb, so a score cannot skip one', () => {
  const unsorted = quiz({
    tiers: [
      { maxPoints: 12, label: 'Top', note: 'Nice.' },
      { maxPoints: 4, label: 'Bottom', note: 'Work.' },
    ],
  })
  assert.match(refusal(unsorted), /Tier 2/)
  const tied = quiz({
    tiers: [
      { maxPoints: 4, label: 'One', note: 'a' },
      { maxPoints: 4, label: 'Two', note: 'b' },
    ],
  })
  assert.match(refusal(tied), /Tier 2/)
})

test('a scored guide needs somewhere for a score to land', () => {
  assert.match(refusal(quiz({ tiers: [] })), /at least one result tier/)
})

const worksheet = (over: Record<string, unknown> = {}) => ({
  type: 'worksheet',
  categories: [{ title: 'Volume', options: [{ label: 'None', points: 0 }, { label: 'All of it', points: 2 }] }],
  tiers: [{ minPct: 0, label: 'Gaps', note: 'Fix these.' }, { minPct: 70, label: 'Solid', note: 'Sharpen these.' }],
  ...over,
})

test('worksheet tiers are percentages, in range and in order', () => {
  assert.match(refusal(worksheet({ tiers: [{ minPct: 101, label: 'x', note: 'y' }] })), /between 0 and 100/)
  assert.match(refusal(worksheet({ tiers: [{ minPct: -1, label: 'x', note: 'y' }] })), /between 0 and 100/)
  assert.match(refusal(worksheet({ tiers: [{ minPct: 'high', label: 'x', note: 'y' }] })), /needs a number/)
  const backwards = worksheet({
    tiers: [{ minPct: 70, label: 'Solid', note: 'a' }, { minPct: 40, label: 'Gaps', note: 'b' }],
  })
  assert.match(refusal(backwards), /Tier 2/)
})

test('a worksheet category is named and answerable', () => {
  assert.match(refusal(worksheet({ categories: [] })), /at least one category/)
  assert.match(refusal(worksheet({ categories: [{ title: 'Volume', options: [] }] })), /Category 1 needs at least one answer/)
})

// ---------------------------------------------------------------------------
// 7. Technique sections
// ---------------------------------------------------------------------------

const sections = (over: Record<string, unknown> = {}) => ({
  type: 'sections',
  groups: [{ title: 'Squat', blocks: [{ label: 'Setup', text: 'Bar over mid-foot' }], mistakes: ['Knees caving'] }],
  ...over,
})

test('a section carries a title, its blocks and its mistakes', () => {
  const content = accepted(sections())
  assert.equal(content.type === 'sections' && content.groups[0].blocks[0].label, 'Setup')
  // Blocks and mistakes may both be empty: that is a section somebody is still
  // writing, not a section that is wrong.
  accepted(sections({ groups: [{ title: 'Squat', blocks: [], mistakes: [] }] }))
  assert.match(refusal(sections({ groups: [{ title: 'Squat', blocks: [{ label: 'Setup' }], mistakes: [] }] })), /Block 1 of section 1/)
  assert.match(refusal(sections({ groups: [{ title: '', blocks: [], mistakes: [] }] })), /title of section 1/)
})

// ---------------------------------------------------------------------------
// 8. Reading a row
// ---------------------------------------------------------------------------

test('a config with no content is no content, not an error', () => {
  assert.equal(parseGuideContent(null), null)
  assert.equal(parseGuideContent(undefined), null)
  assert.equal(parseGuideContent({}), null)
  assert.equal(parseGuideContent({ content: null }), null)
  assert.equal(parseGuideContent({ body: 'An article, not a guide.' }), null)
})

test('content that does not validate reads as no content, so the card falls back', () => {
  assert.equal(parseGuideContent({ content: 'a checklist, honest' }), null)
  assert.equal(parseGuideContent({ content: { type: 'checklist' } }), null)
  assert.equal(parseGuideContent({ content: { type: 'quiz', questions: [], tiers: [] } }), null)
})

test('valid content comes back trimmed and typed', () => {
  const content = parseGuideContent({ content: { type: 'checklist', sections: [{ title: ' Gear ', items: [' Belt '] }] } })
  assert.deepEqual(content, { type: 'checklist', sections: [{ title: 'Gear', items: ['Belt'] }] })
})

test('every built-in round-trips through a stored config', () => {
  for (const key of BUILTIN_KEYS) {
    const content = defaultContentFor(key)
    // What the admin panel writes and what the page reads back, on one row.
    const stored = JSON.parse(JSON.stringify({ content })) as Record<string, unknown>
    assert.deepEqual(parseGuideContent(stored), content)
  }
})

// ---------------------------------------------------------------------------
// 9. The refusals are readable
// ---------------------------------------------------------------------------

test('every refusal is a sentence, and no refusal uses an em dash', () => {
  const broken: unknown[] = [
    'nope',
    { type: 'podcast' },
    checklist([]),
    checklist([{ title: 'x'.repeat(CONTENT_LIMITS.label + 1), items: [] }]),
    table({ rows: [['8', '2']] }),
    quiz({ questions: [{ prompt: 'Q', options: [{ label: 'A', points: 1.5 }] }] }),
    quiz({ tiers: [{ maxPoints: 9, label: 'a', note: 'b' }, { maxPoints: 1, label: 'c', note: 'd' }] }),
    worksheet({ categories: [] }),
    sections({ groups: [{ title: '', blocks: [], mistakes: [] }] }),
  ]
  for (const value of broken) {
    const message = refusal(value)
    assert.equal(message.includes('—'), false, `em dash in: ${message}`)
    assert.match(message, /^[A-Z].*[.?]$/s, `not a sentence: ${message}`)
  }
})

test('a type the union gains has to be handled here too', () => {
  // The five the editors offer and the five blankContentFor answers are the same
  // five, which is what stops a picker offering a type nothing can render.
  const types: GuideContentType[] = ['checklist', 'quiz', 'reference', 'sections', 'worksheet']
  assert.deepEqual([...CONTENT_TYPES].sort(), [...types].sort())
})
