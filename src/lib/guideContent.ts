/**
 * guideContent.ts — what a guide CONTAINS, as data.
 *
 * resourceLibrary.ts made the guide LIST editable: which cards exist, what they
 * are called, what order they come in, which of them ask for an email. The
 * bodies stayed in GuidesPage.tsx as five hardcoded arrays, so renaming a card
 * was a form and fixing a typo inside it was a deploy.
 *
 * Five shapes cover every guide the site ships:
 *
 *   checklist   a set of titled sections of tickable items
 *   quiz        scored questions and the tiers a total lands in
 *   reference   a table with a header row and an optional closing note
 *   sections    tabbed technique groups: labelled blocks plus common mistakes
 *   worksheet   scored categories and the tiers a percentage lands in
 *
 * A guide row stores one of them at `config.content`. The page renders it
 * through the matching component in src/components/guides; a row with no
 * content falls back to the built-in defaults below, which are the same strings
 * the page hardcoded before this change.
 *
 * The sixth built-in guide, the attempt calculator, has no content type. It is
 * a calculator reading `calculator_settings`, not copy, so `defaultContentFor`
 * answers null for it and the admin panel offers no editor.
 *
 * THIS IS SIGNAGE. `config` is a jsonb column an admin writes through RLS in
 * migration 041; nothing here stops a bad row reaching the table. What it does
 * is stop a bad row reaching a public page: `parseGuideContent` answers null for
 * anything it cannot vouch for and the card renders its built-in instead.
 *
 * Nothing here throws and nothing here repairs. A validator that quietly drops
 * the eleventh option or pads a short table row hands an owner a saved guide
 * that is not the guide they typed, so a malformed value is refused with the
 * first problem named and the save does not happen.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type GuideContentType = 'checklist' | 'quiz' | 'reference' | 'sections' | 'worksheet'

export interface ChecklistContent {
  type: 'checklist'
  sections: { title: string; items: string[] }[]
}

export interface QuizContent {
  type: 'quiz'
  questions: { prompt: string; options: { label: string; points: number }[] }[]
  /** Inclusive upper bounds, ascending: the first tier a total does not exceed. */
  tiers: { maxPoints: number; label: string; note: string }[]
}

export interface ReferenceContent {
  type: 'reference'
  columns: string[]
  rows: string[][]
  footnote?: string
}

export interface SectionsContent {
  type: 'sections'
  /** One group per tab. A block's `text` is one cue per line. */
  groups: { title: string; blocks: { label: string; text: string }[]; mistakes: string[] }[]
}

export interface WorksheetContent {
  type: 'worksheet'
  categories: { title: string; options: { label: string; points: number }[] }[]
  /** Inclusive lower bounds, ascending: the last tier a percentage reaches. */
  tiers: { minPct: number; label: string; note: string }[]
}

export type GuideContent =
  | ChecklistContent
  | QuizContent
  | ReferenceContent
  | SectionsContent
  | WorksheetContent

/** The pieces, named, for the editors and renderers that take one at a time. */
export type ChecklistSection = ChecklistContent['sections'][number]
export type QuizQuestion = QuizContent['questions'][number]
export type QuizOption = QuizQuestion['options'][number]
export type QuizTier = QuizContent['tiers'][number]
export type SectionGroup = SectionsContent['groups'][number]
export type SectionBlock = SectionGroup['blocks'][number]
export type WorksheetCategory = WorksheetContent['categories'][number]
export type WorksheetTier = WorksheetContent['tiers'][number]

export const CONTENT_TYPE_LABELS: Record<GuideContentType, string> = {
  checklist: 'Checklist',
  quiz: 'Scored quiz',
  reference: 'Reference table',
  sections: 'Technique sections',
  worksheet: 'Scored worksheet',
}

export const CONTENT_TYPES: GuideContentType[] = ['checklist', 'quiz', 'reference', 'sections', 'worksheet']

// ── Limits ───────────────────────────────────────────────────────────────────
//
// Exported because the admin editors put the same numbers on their inputs, and
// a maxLength that disagrees with the validator is a form that refuses a value
// it just let somebody type.
//
// The array caps are not a storage worry (a jsonb column swallows far more).
// They are a render worry: every one of these lists becomes DOM on a public
// page, and a pasted spreadsheet with 40 000 rows in it is an unusable card.

export const CONTENT_LIMITS = {
  /** A title, a column header, an answer label. */
  label: 200,
  /** A question, a tier note. */
  prompt: 500,
  /** A checklist item, a cue block, a table cell, a closing note. */
  text: 2000,
  /** Sections, questions, categories, groups; and items or options within one. */
  list: 50,
  /** Table columns. A widened table stops fitting a phone long before this. */
  columns: 26,
  /** Table rows. */
  rows: 500,
  /** What one answer can be worth. */
  points: 100,
} as const

/** The most a quiz can total: every question at full marks. A tier cutoff above
 *  this is unreachable rather than wrong, but it is almost always a typo. */
const TOTAL_POINTS_MAX = CONTENT_LIMITS.list * CONTENT_LIMITS.points

// ── Validation ───────────────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true; content: GuideContent }
  | { ok: false; message: string }

/** The first problem, thrown to the top of the walk and returned from there.
 *  Internal only: the exported functions never throw. */
class Refusal extends Error {}

function refuse(message: string): never {
  throw new Refusal(message)
}

/** 1-based, because "section 0" means nothing to the person reading it. */
function nth(i: number): number {
  return i + 1
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * One of the lists the guide is built out of: present, and one to `max` long.
 *
 * The singular is passed rather than derived, because the derivation everybody
 * writes turns "categories" into "categorie" and puts it in front of an owner.
 */
function topList(value: unknown, plural: string, singular: string, max: number): unknown[] {
  if (!Array.isArray(value)) refuse(`This guide has no ${plural} in it.`)
  if (value.length === 0) refuse(`Add at least one ${singular}.`)
  if (value.length > max) refuse(`There are more than ${max} ${plural}. Split the guide up or trim the list.`)
  return value
}

/** A list inside one of those, which may legitimately be empty. `what` names it
 *  the way the message will read: "Section 1 items has more than 50 entries." */
function subList(value: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(value)) refuse(`${what} needs to be a list.`)
  if (value.length > max) refuse(`${what} has more than ${max} entries. Trim the list.`)
  return value
}

/** Trimmed and capped, or a refusal. Blank is refused separately from missing
 *  because "you left the title empty" and "that is not text" are different
 *  mistakes with different fixes. */
function text(value: unknown, what: string, max: number, allowBlank = false): string {
  if (typeof value !== 'string') refuse(`${what} needs to be text.`)
  const trimmed = value.trim()
  if (!trimmed && !allowBlank) refuse(`${what} cannot be blank.`)
  if (trimmed.length > max) refuse(`${what} is longer than ${max} characters. Shorten it.`)
  return trimmed
}

function points(value: unknown, what: string, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) refuse(`${what} needs a number.`)
  if (!Number.isInteger(value)) refuse(`${what} needs a whole number, not ${value}.`)
  if (value < 0 || value > max) refuse(`${what} has to be between 0 and ${max}.`)
  return value
}

/** The answers under one question or one worksheet category. `what` is the
 *  thing they belong to, already capitalised: "Question 3", "Category 2". */
function readOptions(raw: unknown, what: string): { label: string; points: number }[] {
  if (!Array.isArray(raw)) refuse(`${what} has no answers to choose from.`)
  if (raw.length === 0) refuse(`${what} needs at least one answer.`)
  if (raw.length > CONTENT_LIMITS.list) {
    refuse(`${what} has more than ${CONTENT_LIMITS.list} answers. Trim the list.`)
  }
  return raw.map((o, i) => {
    if (!isObject(o)) refuse(`Answer ${nth(i)} of ${what.toLowerCase()} is not filled in.`)
    return {
      label: text(o.label, `Answer ${nth(i)} of ${what.toLowerCase()}`, CONTENT_LIMITS.label),
      points: points(o.points, `The score for answer ${nth(i)} of ${what.toLowerCase()}`, CONTENT_LIMITS.points),
    }
  })
}

function readChecklist(raw: Record<string, unknown>): ChecklistContent {
  const sections = topList(raw.sections, 'sections', 'section', CONTENT_LIMITS.list).map((s, i) => {
    if (!isObject(s)) refuse(`Section ${nth(i)} is not filled in.`)
    const title = text(s.title, `The title of section ${nth(i)}`, CONTENT_LIMITS.label)
    const items = subList(s.items, `Section ${nth(i)} items`, CONTENT_LIMITS.list)
      .map((it, j) => text(it, `Item ${nth(j)} of section ${nth(i)}`, CONTENT_LIMITS.text))
    return { title, items }
  })
  return { type: 'checklist', sections }
}

function readQuiz(raw: Record<string, unknown>): QuizContent {
  const questions = topList(raw.questions, 'questions', 'question', CONTENT_LIMITS.list).map((q, i) => {
    if (!isObject(q)) refuse(`Question ${nth(i)} is not filled in.`)
    return {
      prompt: text(q.prompt, `Question ${nth(i)}`, CONTENT_LIMITS.prompt),
      options: readOptions(q.options, `Question ${nth(i)}`),
    }
  })

  // A quiz with no tiers scores an athlete and then has nothing to tell them,
  // which is the one screen of this guide anybody remembers.
  const tiers = topList(raw.tiers, 'result tiers', 'result tier', CONTENT_LIMITS.list).map((t, i) => {
    if (!isObject(t)) refuse(`Result tier ${nth(i)} is not filled in.`)
    return {
      maxPoints: points(t.maxPoints, `The top score of tier ${nth(i)}`, TOTAL_POINTS_MAX),
      label: text(t.label, `The name of tier ${nth(i)}`, CONTENT_LIMITS.label),
      note: text(t.note, `The note on tier ${nth(i)}`, CONTENT_LIMITS.prompt),
    }
  })
  // Ascending, strictly: a tier that does not top out above the one before it
  // can never be the answer, so a score would silently skip it.
  tiers.forEach((t, i) => {
    if (i > 0 && t.maxPoints <= tiers[i - 1].maxPoints) {
      refuse(`Tier ${nth(i)} has to top out above tier ${i}. Put the tiers in order, lowest score first.`)
    }
  })

  return { type: 'quiz', questions, tiers }
}

function readReference(raw: Record<string, unknown>): ReferenceContent {
  const columns = topList(raw.columns, 'columns', 'column', CONTENT_LIMITS.columns)
    .map((c, i) => text(c, `The heading of column ${nth(i)}`, CONTENT_LIMITS.label))

  const rows = subList(raw.rows, 'The table', CONTENT_LIMITS.rows).map((r, i) => {
    if (!Array.isArray(r)) refuse(`Row ${nth(i)} is not a row of cells.`)
    // Exactly, not at least: a ragged row renders as a table with a hole in it,
    // and which cell is missing is a question only the author can answer.
    if (r.length !== columns.length) {
      refuse(`Row ${nth(i)} has ${r.length} cells but the table has ${columns.length} columns.`)
    }
    return r.map((cell, j) => text(cell, `Row ${nth(i)}, column ${nth(j)}`, CONTENT_LIMITS.text, true))
  })

  const content: ReferenceContent = { type: 'reference', columns, rows }
  if (raw.footnote !== undefined && raw.footnote !== null) {
    const footnote = text(raw.footnote, 'The closing note', CONTENT_LIMITS.text, true)
    if (footnote) content.footnote = footnote
  }
  return content
}

function readSections(raw: Record<string, unknown>): SectionsContent {
  const groups = topList(raw.groups, 'sections', 'section', CONTENT_LIMITS.list).map((g, i) => {
    if (!isObject(g)) refuse(`Section ${nth(i)} is not filled in.`)
    const title = text(g.title, `The title of section ${nth(i)}`, CONTENT_LIMITS.label)
    const blocks = subList(g.blocks, `Section ${nth(i)} blocks`, CONTENT_LIMITS.list).map((b, j) => {
      if (!isObject(b)) refuse(`Block ${nth(j)} of section ${nth(i)} is not filled in.`)
      return {
        label: text(b.label, `The heading of block ${nth(j)} in section ${nth(i)}`, CONTENT_LIMITS.label),
        text: text(b.text, `Block ${nth(j)} of section ${nth(i)}`, CONTENT_LIMITS.text),
      }
    })
    const mistakes = subList(g.mistakes, `Section ${nth(i)} mistakes`, CONTENT_LIMITS.list)
      .map((m, j) => text(m, `Mistake ${nth(j)} of section ${nth(i)}`, CONTENT_LIMITS.text))
    return { title, blocks, mistakes }
  })
  return { type: 'sections', groups }
}

function readWorksheet(raw: Record<string, unknown>): WorksheetContent {
  const categories = topList(raw.categories, 'categories', 'category', CONTENT_LIMITS.list).map((c, i) => {
    if (!isObject(c)) refuse(`Category ${nth(i)} is not filled in.`)
    return {
      title: text(c.title, `The title of category ${nth(i)}`, CONTENT_LIMITS.label),
      options: readOptions(c.options, `Category ${nth(i)}`),
    }
  })

  const tiers = topList(raw.tiers, 'result tiers', 'result tier', CONTENT_LIMITS.list).map((t, i) => {
    if (!isObject(t)) refuse(`Result tier ${nth(i)} is not filled in.`)
    const minPct = t.minPct
    if (typeof minPct !== 'number' || !Number.isFinite(minPct)) {
      refuse(`The starting percentage of tier ${nth(i)} needs a number.`)
    }
    if (minPct < 0 || minPct > 100) {
      refuse(`The starting percentage of tier ${nth(i)} has to be between 0 and 100.`)
    }
    return {
      minPct,
      label: text(t.label, `The name of tier ${nth(i)}`, CONTENT_LIMITS.label),
      note: text(t.note, `The note on tier ${nth(i)}`, CONTENT_LIMITS.prompt),
    }
  })
  tiers.forEach((t, i) => {
    if (i > 0 && t.minPct <= tiers[i - 1].minPct) {
      refuse(`Tier ${nth(i)} has to start above tier ${i}. Put the tiers in order, lowest percentage first.`)
    }
  })

  return { type: 'worksheet', categories, tiers }
}

/**
 * A stored value, checked and returned trimmed, or the first thing wrong with
 * it in a sentence an owner can act on.
 *
 * The returned content is a fresh object, so a caller may keep it, edit it, and
 * hand it back without the thing it was validated from changing underneath.
 */
export function validateGuideContent(value: unknown): ValidationResult {
  if (!isObject(value)) {
    return { ok: false, message: 'Guide content has to be a block of settings, not a single value.' }
  }
  const type = typeof value.type === 'string' ? value.type : ''
  try {
    switch (type) {
      case 'checklist': return { ok: true, content: readChecklist(value) }
      case 'quiz':      return { ok: true, content: readQuiz(value) }
      case 'reference': return { ok: true, content: readReference(value) }
      case 'sections':  return { ok: true, content: readSections(value) }
      case 'worksheet': return { ok: true, content: readWorksheet(value) }
      default:
        return {
          ok: false,
          message: 'That content does not say which kind of guide it is. Pick one of: checklist, quiz, reference, sections, worksheet.',
        }
    }
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, message: err.message }
    // Nothing above throws anything else, but a public page is not the place to
    // find out otherwise.
    return { ok: false, message: 'That content could not be read.' }
  }
}

/**
 * The content on a resource row, or null.
 *
 * Null means the card renders its built-in instead, which is why a malformed
 * value answers null rather than a half-built object: a guide that has always
 * worked should not go blank because somebody saved a broken draft over it.
 */
export function parseGuideContent(config: Record<string, unknown> | null | undefined): GuideContent | null {
  if (!config || typeof config !== 'object') return null
  const raw = (config as Record<string, unknown>).content
  if (raw === undefined || raw === null) return null
  const result = validateGuideContent(raw)
  return result.ok ? result.content : null
}

// ── The built-in content ─────────────────────────────────────────────────────
//
// The five arrays GuidesPage.tsx used to hold, verbatim, as the data the same
// components now read. Em dashes were the one edit: the house rule bans them in
// site copy, so they became the period, comma or colon the sentence wanted. En
// dashes inside number ranges (45 to 60 minutes, RPE 7 to 8) are left exactly as
// they render today.
//
// These are DEFAULTS, not the live copy. Once a guide has content in the
// database, that is what the page shows and this is only what a fresh row or a
// reset starts from.

const CHECKLIST: ChecklistContent = {
  type: 'checklist',
  sections: [
    {
      title: 'Night Before',
      items: [
        'Pack your gear bag completely. Don\'t leave anything for morning',
        'Confirm weigh-in time and location',
        'Eat the same foods you eat on training days. No experiments',
        'Prepare meet day meals and snacks (bring more than you think you need)',
        'Lay out your singlet, belt, shoes, wraps/sleeves, and lifting shoes',
        'Set two alarms: one for wake-up, one as backup',
        'Aim for 8+ hours of sleep; accept that nerves are normal',
      ],
    },
    {
      title: 'Gear Bag Essentials',
      items: [
        'Singlet (IPF/federation legal)',
        'Belt',
        'Knee sleeves or wraps',
        'Wrist wraps',
        'Squat shoes and deadlift shoes (or socks)',
        'Chalk (if allowed)',
        'Extra socks and underwear',
        'Ammonia (if used)',
        'Energy snacks: rice cakes, bananas, gummy bears, Bobo\'s, etc.',
        'Electrolyte drinks and plain water',
        'Pre-workout or caffeine source (match your training dose)',
        'Recovery tools: foam roller, lacrosse ball',
        'Headphones / playlist',
        'Printed attempts card (backup to the handler\'s copy)',
      ],
    },
    {
      title: 'Weigh-In',
      items: [
        'Arrive early. Rush and stress kill your warm-up',
        'Eat and rehydrate immediately after weigh-in',
        'If cutting water: 2 hrs minimum to rehydrate before first attempt',
        'Confirm your opening attempts with your handler before rack height setup',
        'Register equipment (belt, sleeves, wraps) with the expeditor',
      ],
    },
    {
      title: 'Warm-Up Room',
      items: [
        'Start warm-ups 45–60 minutes before your first flight',
        'Attempt 1 should feel like a warm-up: an easy single',
        'Don\'t go to failure in warm-ups. Leave something for the platform',
        'Warm-up timing: your last warm-up bar should land ~5–8 min before your first attempt',
        'Your handler manages timing. Trust them and stop watching the scoreboard',
        'Communicate RPE of every warm-up set to your handler',
      ],
    },
    {
      title: 'Between Attempts & Lifts',
      items: [
        'Eat fast carbs between lifts (gummies, bananas, rice cakes)',
        'Sip water or electrolytes constantly. Don\'t wait until you\'re thirsty',
        'Review your next attempt with your handler before it\'s called in',
        'Avoid social media and distractions between flights',
        'Keep warm: movement, light stretching, stay loose',
        'Trust your handler\'s attempt calls, they have the big picture',
      ],
    },
  ],
}

const QUIZ: QuizContent = {
  type: 'quiz',
  questions: [
    {
      prompt: 'How is your training structured?',
      options: [
        { label: 'I don\'t really plan ahead. I just train', points: 0 },
        { label: 'I follow a template or program I found online', points: 1 },
        { label: 'Periodized with planned phases, goals, and deloads', points: 2 },
      ],
    },
    {
      prompt: 'Do you track your training volume week to week?',
      options: [
        { label: 'No. I don\'t track sets and reps historically', points: 0 },
        { label: 'Sometimes. I look back occasionally', points: 1 },
        { label: 'Yes. I track and adjust based on trends', points: 2 },
      ],
    },
    {
      prompt: 'How do you manage intensity in training?',
      options: [
        { label: 'I go as heavy as I feel like that day', points: 0 },
        { label: 'I follow prescribed weights without much thought', points: 1 },
        { label: 'I use RPE or percentages with intentional progression', points: 2 },
      ],
    },
    {
      prompt: 'How many nights per week do you get 7+ hours of sleep?',
      options: [
        { label: '0–2 nights', points: 0 },
        { label: '3–4 nights', points: 1 },
        { label: '5–7 nights', points: 2 },
      ],
    },
    {
      prompt: 'How often do you review technique video of your lifts?',
      options: [
        { label: 'Never. I don\'t film myself', points: 0 },
        { label: 'Occasionally, when something feels off', points: 1 },
        { label: 'Regularly. I analyze video weekly or every session', points: 2 },
      ],
    },
    {
      prompt: 'How do you handle accumulated fatigue?',
      options: [
        { label: 'I train through it until I burn out or get hurt', points: 0 },
        { label: 'I take a week off when I feel terrible', points: 1 },
        { label: 'I plan deloads every 4–6 weeks regardless of how I feel', points: 2 },
      ],
    },
  ],
  tiers: [
    {
      maxPoints: 4,
      label: 'Leaving Major Gains Behind',
      note: 'Your training lacks the structure and intentionality needed to get the most out of your time under the bar. The good news: this is fixable fast. A coach can double your progress rate by addressing the root issues.',
    },
    {
      maxPoints: 8,
      label: 'Solid Base, Room to Optimize',
      note: 'You\'re doing the work, but there are clear gaps in structure, recovery, or intensity management that are limiting your ceiling. Closing those gaps is the difference between average progress and competitive results.',
    },
    {
      maxPoints: 12,
      label: 'Well-Optimized Athlete',
      note: 'Your process is strong. At this level, the next gains come from personalized periodization, technique refinement, and meet-specific coaching: the exact things a dedicated coach provides.',
    },
  ],
}

const RPE: ReferenceContent = {
  type: 'reference',
  columns: ['RPE', 'Reps left', 'What it feels like'],
  rows: [
    ['6', '4+', 'Comfortable. You could rep this many more times. Used for warm-ups, technique work, or very high volume. Doesn\'t feel like training.'],
    ['7', '3', 'Working hard but clearly could do more. Good for building work capacity. A common target for volume blocks. Breathing gets elevated.'],
    ['7.5', '2–3', 'Between RPE 7 and 8. Two reps clearly available, third is possible. Useful for moderate accumulation. A transition zone.'],
    ['8', '2', 'Hard. You could get two more reps if you had to. Common target for intensification blocks. This is where most meet-prep work lives.'],
    ['8.5', '1–2', 'One rep definitely left, a second is possible but uncertain. A daily max for many athletes. Harder to recover from than RPE 8.'],
    ['9', '1', 'One rep left in the tank. Very demanding. Use sparingly: a common target for peak week attempts to simulate meet conditions.'],
    ['9.5', '0–1', 'You might have gotten one more but aren\'t sure. Common after a hard daily max. Feels close to max effort but you didn\'t fully go there.'],
    ['10', '0', 'Absolute maximum: couldn\'t have gotten another rep. Reserve this for meet openers (intentionally conservative) or true 1RM tests.'],
  ],
  footnote: 'Beginner tip: If you\'re new to RPE, film your sets. Watch the bar speed: a fast bar is low RPE, a grinding, slow bar is RPE 9+. Over time, the calibration becomes instinctual. Most coaches recommend training primarily at RPE 7–8 for volume work, and 8.5–9 for peak/heavy work.',
}

const BIG_THREE: SectionsContent = {
  type: 'sections',
  groups: [
    {
      title: 'Squat',
      blocks: [
        {
          label: 'Setup',
          text: [
            'Bar over mid-foot (1–2 inches from shins for high bar)',
            'High bar: on traps / Low bar: rear delt shelf',
            'Brace hard before unracking: 360° of pressure',
            'Walk out: step back, feet just outside hip width, toes pointed out 30–45°',
          ].join('\n'),
        },
        {
          label: 'Descent',
          text: [
            'Big breath and brace before descent',
            'Push knees out in the direction of toes throughout',
            'Break at the hips and knees simultaneously',
            'Aim for depth just past parallel (crease of hip below top of knee)',
          ].join('\n'),
        },
        {
          label: 'Ascent / Press',
          text: [
            'Drive the floor apart. Don\'t let knees cave',
            'Lead with the chest on the way up, not the hips',
            'Maintain the brace all the way through lockout',
            'Squeeze glutes at the top before stepping forward',
          ].join('\n'),
        },
      ],
      mistakes: [
        'Knees caving on the ascent (valgus collapse)',
        'Good morning squat: hips rise faster than chest',
        'Losing upper back tightness at the bottom',
        'Incomplete depth: the lift won\'t count in competition',
      ],
    },
    {
      title: 'Bench Press',
      blocks: [
        {
          label: 'Setup',
          text: [
            'Eyes under the bar: wrists directly below the bar at setup',
            'Retract and depress scapulae: pull shoulder blades down and together',
            'Arch position: drive chest up, maintain contact with the bench',
            'Foot position: flat on floor or on toes. Build leg drive',
          ].join('\n'),
        },
        {
          label: 'Descent / Touch',
          text: [
            'Control the descent. Don\'t crash the bar',
            'Tuck the elbows slightly (45–60° from torso)',
            'Touch the lower chest / upper abs (not the neck)',
            'Pause briefly on touch. Don\'t bounce the bar off your chest',
          ].join('\n'),
        },
        {
          label: 'Ascent / Press',
          text: [
            'Drive the bar back toward your face as you press (bar path should arc)',
            'Push your body away from the bar. Think "push the bench away"',
            'Drive your feet into the floor to generate leg drive',
            'Maintain scapular position through the entire rep',
          ].join('\n'),
        },
      ],
      mistakes: [
        'Flared elbows: increases anterior shoulder stress',
        'Losing back tightness during the press',
        'Lifting the butt off the bench to use leg drive',
        'Touching too high (on the sternum instead of lower chest)',
      ],
    },
    {
      title: 'Deadlift',
      blocks: [
        {
          label: 'Setup',
          text: [
            'Bar over mid-foot (1 inch from shins)',
            'Push your hips back until your shins touch the bar',
            'Chest up, back flat. Eliminate any rounding in the lower back',
            'Grip: double overhand to start, switch to mixed or hook when needed',
          ].join('\n'),
        },
        {
          label: 'Off the Floor',
          text: [
            'Push the floor away. Don\'t think "pull up", think "push down"',
            'Bar stays in contact with the legs the entire way up',
            'Hips and shoulders rise at the same rate off the floor',
            'Once past the knee, drive your hips through and stand tall',
          ].join('\n'),
        },
        {
          label: 'Lockout',
          text: [
            'Lock out hips and knees simultaneously',
            'Don\'t hyperextend the lower back at the top',
            'Lower the bar with control. Don\'t drop unless on bumpers',
            'Reset position fully before your next rep',
          ].join('\n'),
        },
      ],
      mistakes: [
        'Bar drifting away from the body (increases leverage demands)',
        'Jerking the bar off the floor: the pull should be a smooth acceleration',
        'Rounding the lower back off the floor',
        'Looking up: keep a neutral neck, not extended',
      ],
    },
  ],
}

const AUDIT: WorksheetContent = {
  type: 'worksheet',
  categories: [
    {
      title: 'Volume Management',
      options: [
        { label: 'I had no idea what my volume was', points: 0 },
        { label: 'I tracked it roughly but didn\'t adjust', points: 1 },
        { label: 'I tracked, adjusted, and progressed intentionally', points: 2 },
      ],
    },
    {
      title: 'Intensity Progression',
      options: [
        { label: 'I lifted heavy when I felt like it, light when I didn\'t', points: 0 },
        { label: 'I followed percentages or RPE but loosely', points: 1 },
        { label: 'Systematic weekly progression with planned overloads', points: 2 },
      ],
    },
    {
      title: 'Specificity',
      options: [
        { label: 'Lots of non-specific exercises, low competition lift frequency', points: 0 },
        { label: 'Mostly specific with some filler', points: 1 },
        { label: 'High frequency on competition lifts with purposeful accessories', points: 2 },
      ],
    },
    {
      title: 'Recovery & Fatigue Management',
      options: [
        { label: 'Trained hard every week, no planned deloads', points: 0 },
        { label: 'Took time off when I felt beat up', points: 1 },
        { label: 'Planned recovery weeks at regular intervals', points: 2 },
      ],
    },
    {
      title: 'Technique Consistency',
      options: [
        { label: 'Form was inconsistent and I know it', points: 0 },
        { label: 'Mostly consistent but broke down under max loads', points: 1 },
        { label: 'Consistent mechanics across all intensity ranges', points: 2 },
      ],
    },
    {
      title: 'Program Compliance',
      options: [
        { label: 'I changed things frequently or skipped sessions often', points: 0 },
        { label: 'Followed it with some missed sessions', points: 1 },
        { label: 'Followed the program as written, consistent attendance', points: 2 },
      ],
    },
  ],
  tiers: [
    {
      minPct: 0,
      label: 'Major Programming Gaps',
      note: 'Multiple critical programming errors are limiting your progress. Addressing these, ideally with a coach, could dramatically accelerate your results.',
    },
    {
      minPct: 40,
      label: 'Developing Programmer',
      note: 'You have a partial grasp of training principles, but key gaps in structure, recovery, or specificity are costing you gains.',
    },
    {
      minPct: 70,
      label: 'Strong Programming Foundation',
      note: 'You\'re managing the programming fundamentals well. The next ceiling is personalization: a coach adds precision that general templates can\'t match.',
    },
  ],
}

const DEFAULTS: Record<string, GuideContent> = {
  checklist: CHECKLIST,
  quiz: QUIZ,
  rpe: RPE,
  big3: BIG_THREE,
  audit: AUDIT,
}

/** A deep copy, because a caller loading defaults into an editor will edit them,
 *  and JSON is the whole of what a content object can hold. */
function clone<T extends GuideContent>(content: T): T {
  return JSON.parse(JSON.stringify(content)) as T
}

/**
 * What a built-in guide shipped with, or null.
 *
 * Null for 'attempts': that card is the attempt calculator, whose numbers live
 * in `calculator_settings` and whose body is a form, not copy. Null too for a
 * key this file does not know, which is what a row pointing at a component that
 * no longer exists looks like.
 *
 * The keys here are the canonical ones calculators.ts resolves a builtin_key to
 * (its GUIDE_KEY_ALIASES does the spelling), so callers pass `guide.builtin`.
 */
export function defaultContentFor(builtinKey: string | null): GuideContent | null {
  if (!builtinKey) return null
  const found = DEFAULTS[builtinKey]
  return found ? clone(found) : null
}

/**
 * The skeleton a brand-new guide of each type starts from.
 *
 * Small on purpose: an owner deletes a placeholder faster than they invent a
 * structure, but a template with six worked examples in it gets published with
 * three of them still in place. Every one of these validates.
 */
export function blankContentFor(type: GuideContentType): GuideContent {
  switch (type) {
    case 'checklist':
      return {
        type: 'checklist',
        sections: [{ title: 'First section', items: ['First thing to tick off'] }],
      }
    case 'quiz':
      return {
        type: 'quiz',
        questions: [{
          prompt: 'First question',
          options: [
            { label: 'Not yet', points: 0 },
            { label: 'Sometimes', points: 1 },
            { label: 'Every time', points: 2 },
          ],
        }],
        tiers: [
          { maxPoints: 1, label: 'Room to work', note: 'What to fix first.' },
          { maxPoints: 2, label: 'Solid', note: 'What to sharpen next.' },
        ],
      }
    case 'reference':
      return {
        type: 'reference',
        columns: ['First column', 'Second column'],
        rows: [['First cell', 'Second cell']],
      }
    case 'sections':
      return {
        type: 'sections',
        groups: [{
          title: 'First section',
          blocks: [{ label: 'Setup', text: 'First cue' }],
          mistakes: ['A common mistake'],
        }],
      }
    case 'worksheet':
      return {
        type: 'worksheet',
        categories: [{
          title: 'First category',
          options: [
            { label: 'Not yet', points: 0 },
            { label: 'Getting there', points: 1 },
            { label: 'Dialed in', points: 2 },
          ],
        }],
        tiers: [
          { minPct: 0, label: 'Room to work', note: 'What to fix first.' },
          { minPct: 70, label: 'Solid', note: 'What to sharpen next.' },
        ],
      }
  }
}
