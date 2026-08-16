import { useCallback, useEffect, useState } from 'react'
import { supabase, supabaseConfigured } from './supabase.ts'
import { sanitizeText } from '../utils/sanitize.ts'
import type { WriteResult } from './resourceLibrary.ts'

/**
 * siteContent.ts
 *
 * The words on the public site, read as data instead of compiled in.
 *
 * Every headline, eyebrow, service description and pillar on the marketing
 * pages is a string literal in a React file today. This module is the registry
 * those literals become, and migration 048 is the one row per block that
 * OVERRIDES one of them. The code keeps its own copy either way:
 *
 *     no row  →  the page renders the shipped default, from right here
 *     a row   →  the page renders what the owner typed instead
 *
 * which makes "Restore original" a DELETE rather than a rewrite. That is 041's
 * shape (resource_library + guideContent.ts) applied to the copy itself, and
 * the reason it matters is written in ResourceLibraryPanel.tsx:354-374: a row
 * storing today's defaults is frozen at today, while a row that does not exist
 * reads its copy out of the bundle every time, so a later correction in the
 * bundle still reaches the page.
 *
 * THE ONE RULE THE VALIDATOR ENFORCES: an override may replace the TEXT of a
 * field, never the SHAPE of a block. The default IS the schema. A list of four
 * taglines stays four; an items block keeps exactly the fields it shipped with.
 * That is not a limitation working around a missing feature, it is what makes
 * the whole thing safe: the components below still lay these values out, still
 * derive their display ordinals ("01".."04") from position, and still key their
 * icons by index. An owner who could add a fifth service could also mint a
 * duplicate React key and a card with no icon, silently.
 *
 * Two contracts, deliberately different, both copied from resourceLibrary.ts:
 *
 *   `fetchSiteContent()` is the PUBLIC read and answers `null` for "could not
 *   tell you" and `{}` for "genuinely nothing overridden". A page that gets
 *   null keeps the shipped copy, so an outage shows the site exactly as it has
 *   always looked rather than blanking the one page that sells the business.
 *   Do not soften null to {} on error.
 *
 *   Every write answers a WriteResult with a sentence somebody can act on.
 *   Nothing here throws, including the validator.
 *
 * EM DASHES. The house rule bans them in user-facing copy, several shipped
 * strings had them, and they are rewritten below in the same commit that adds
 * this file. The validator refuses one on the way in, which is also why the
 * "every default validates against itself" test in tests/siteContent.test.ts is
 * load-bearing: it is the thing that would catch a new default arriving with a
 * dash in it, and a default that cannot be saved is a default that cannot be
 * restored.
 *
 * THIS IS SIGNAGE. docs/SECURITY.md is explicit: RLS is the boundary and the UI
 * is signage. A holder of manage_content can POST anything this file refuses
 * straight through PostgREST, so every url read back out of a stored block goes
 * through safeContentUrl AGAIN at the render site, and stored copy renders as a
 * React text node. Never dangerouslySetInnerHTML.
 *
 * Demo / no credentials  →  an in-memory map, empty to start, mutated in place,
 *                           because an empty override map is exactly what a
 *                           fresh site looks like.
 * Live                   →  Supabase, gated by the RLS in 048.
 */

export type { WriteResult }

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * What a block holds. The kind decides how it is validated and which editor the
 * drawer opens, and nothing else: the page still owns the markup.
 *
 *   text       a single line               "Powerlifting Coaching"
 *   paragraph  a block of prose            "Founded in 2021, Axis Training …"
 *   list       fixed-length strings        ["Solution Focused", …]
 *   items      fixed-length records        [{ title, desc }, …]
 *   image      { src, alt }
 *   link       { label, href }
 */
export type BlockKind = 'text' | 'paragraph' | 'list' | 'items' | 'image' | 'link'

export interface BlockDef {
  /** Lowercase, dot-separated, hyphens inside a segment. The primary key in 048. */
  id: string
  kind: BlockKind
  /** What the drawer calls it. Sentence case, no em dashes. */
  label: string
  /** The section it belongs to, for the outline list on the edit bar. */
  group: string
  /**
   * The keys inside one record, in the order they should be edited.
   *
   * Required for `items`, where it names the fields of every element. Supplied
   * for `image` and `link` too, so a form can iterate one list rather than
   * special-casing three kinds.
   */
  fields?: string[]
  /** The shipped copy. This is also the schema: see the header. */
  default: unknown
}

/** Block id to stored value. Missing key means "the shipped copy is showing". */
export interface SiteContentMap { [blockId: string]: unknown }

// ── Limits ───────────────────────────────────────────────────────────────────
//
// Exported because the drawer puts the same numbers on its inputs, and a
// maxLength that disagrees with the validator is a form that refuses a value it
// just let somebody type (the CONTENT_LIMITS rationale, guideContent.ts:100).

/** A headline, an eyebrow, a button label, a list entry, an alt text. */
export const LINE_LIMIT = 200
/** A section intro, a service description, a founding story. */
export const PARAGRAPH_LIMIT = 2000
/** Matches URL_LIMIT in resourceLibrary.ts, for the same reason. */
export const URL_LIMIT = 2000

/**
 * The most one block may weigh, serialized.
 *
 * The database refuses at 65536 (048 section 3). This is the courtesy and that
 * is the boundary. 16 KB is eight times the longest block that ships, which is
 * the four service cards with their descriptions, so nothing legitimate is
 * anywhere near it.
 */
export const BLOCK_BYTE_LIMIT = 16000

/** The shape 048's site_content_block_shape CHECK enforces. */
export const BLOCK_ID_SHAPE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/

// ── URLs ─────────────────────────────────────────────────────────────────────

const URL_BASE = 'https://axis.local'

/**
 * A URL safe to put in an href or a src, or undefined.
 *
 * Written out here rather than imported from utils/sanitize for the reason
 * resourceLibrary.ts:243-257 gives at length: `safeUrl` resolves against
 * `window.location.origin`, so under `node --test` the ReferenceError lands in
 * its own catch and it silently rejects every absolute URL. A validator that
 * passes in the browser and fails in its tests is worse than eight duplicated
 * lines. The rule is identical in both.
 */
export function safeContentUrl(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const raw = input.trim()
  if (!raw || raw.length > URL_LIMIT) return undefined
  // The tab in "java\tscript:" is stripped by the URL parser but not by a
  // prefix test, which is how the classic bypass works.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return undefined
  // A backslash is a slash to the WHATWG parser, so "/\evil.com" reads as
  // site-relative here and as protocol-relative "//evil.com" in the browser.
  if (raw.includes('\\')) return undefined
  if (raw.startsWith('//')) return undefined
  if (raw.startsWith('/') || raw.startsWith('#') || raw.startsWith('?')) return raw
  try {
    const url = new URL(raw, URL_BASE)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? raw : undefined
  } catch {
    return undefined
  }
}

// ── The registry ─────────────────────────────────────────────────────────────
//
// Every hardcoded, owner-editable block on the public site, with its shipped
// copy lifted from the component that holds it today. Two rules govern what is
// in here and what is not:
//
//   IN: a string a person would reasonably want to reword, that renders as a
//       text node or as a src/href on its own.
//
//   OUT: anything whose value is a KEY rather than copy. The display ordinals
//       ("01".."04" in Services, Philosophy and How It Works) are derived from
//       position at render and are not stored, because they double as React
//       keys and a hand-typed duplicate "03" is a silently wrong list. The
//       How It Works logistics icons are raw JSX and stay in code, looked up by
//       position; note HowItWorks.tsx:89 branches its font size on whether the
//       icon is null, so a lookup that misses changes the typography as well as
//       losing the mark. Nav hrefs, the Apply form's coach-preference labels
//       (which are routing keys: Apply.tsx:8-18) and the privacy policy are all
//       deferred with their reasons recorded in editTargets.ts.
//
// The strings are VERBATIM from the components, with one deliberate exception:
// em dashes are rewritten as periods, commas and colons per the house rule, in
// the same commit that lands this file, so the registry and the components
// agree from the first render. Nothing is seeded into the database (048 ships
// empty), so there is no third copy to drift.

const HERO_BLOCKS: BlockDef[] = [
  { id: 'hero.eyebrow', kind: 'text', label: 'Eyebrow', group: 'Hero',
    default: 'Powerlifting Coaching' },
  // Two fields rather than one string: Hero.tsx:36-37 renders these as separate
  // display:block spans, so a single value with a newline in it would not lay
  // out the same way.
  { id: 'hero.headline-1', kind: 'text', label: 'Headline, first line', group: 'Hero',
    default: 'Axis' },
  { id: 'hero.headline-2', kind: 'text', label: 'Headline, second line', group: 'Hero',
    default: 'Training.' },
  { id: 'hero.taglines', kind: 'list', label: 'Taglines', group: 'Hero',
    default: ['Solution Focused', 'Evidence Based', 'Transparent', 'Everybody Eats'] },
  // The labels only. Both destinations are code: the primary is bookHref() and
  // the secondary is the #coaches anchor. See editTargets.ts on why hrefs wait.
  { id: 'hero.primary-cta', kind: 'text', label: 'Primary button label', group: 'Hero',
    default: 'Book a Call' },
  { id: 'hero.secondary-cta', kind: 'text', label: 'Secondary button label', group: 'Hero',
    default: 'Work With Us' },
  // These four assert facts the database now owns: coach_profiles is live, and
  // the services list is editable a few blocks down. They are hand-maintained
  // on purpose, and the drawer should say so, because the hero starts lying the
  // day a sixth coach is added.
  { id: 'hero.stats', kind: 'items', label: 'Stats', group: 'Hero',
    fields: ['number', 'label'],
    default: [
      { number: '5', label: 'Coaches' },
      { number: '4', label: 'Services' },
      { number: '2021', label: 'Founded' },
      { number: 'PA / USAPL', label: 'Federations' },
    ] },
  { id: 'hero.scroll-cue', kind: 'text', label: 'Scroll cue', group: 'Hero',
    default: 'Scroll' },
]

const PHILOSOPHY_BLOCKS: BlockDef[] = [
  { id: 'philosophy.eyebrow', kind: 'text', label: 'Eyebrow', group: 'Philosophy',
    default: 'Who We Are' },
  { id: 'philosophy.heading', kind: 'text', label: 'Heading', group: 'Philosophy',
    default: 'Coaching you can trust.' },
  { id: 'philosophy.body-1', kind: 'paragraph', label: 'First paragraph', group: 'Philosophy',
    default: 'Founded in 2021, Axis Training Systems was created with a mission of wholeheartedly investing in powerlifting athletes, regardless of background, level, or personality type. We believe that a strong coach-athlete rapport enables the athlete with intrinsic motivation, guidance, and support that drives them to reach their potential.' },
  { id: 'philosophy.body-2', kind: 'paragraph', label: 'Second paragraph', group: 'Philosophy',
    default: 'We focus on evidence-based premium coaching, utilizing lifter data to create individualized training protocols and provide mentorship in building a resilient mindset. Our goal is to help lifters reach their full potential on the platform and build the next generation of the powerlifting community.' },
  { id: 'philosophy.quote', kind: 'paragraph', label: 'Pull quote', group: 'Philosophy',
    default: '"Our vision at Axis is one where everyone is treated equally no matter what level athlete they are. We believe coaching is more than just crunching numbers and critiquing form. We establish strong coach-athlete bonds that give the athlete a sense of intrinsic motivation."' },
  // Shipped as "— Ronnie Vallejo, Founder". The dash is a rule the component can
  // draw; the name and the role are the copy.
  { id: 'philosophy.attribution', kind: 'text', label: 'Quote attribution', group: 'Philosophy',
    default: 'Ronnie Vallejo, Founder' },
  // `num` is not here: the "01".."04" a card shows comes from its position.
  { id: 'philosophy.pillars', kind: 'items', label: 'Pillars', group: 'Philosophy',
    fields: ['title', 'desc'],
    default: [
      { title: 'Solution Focused', desc: 'Problems get solved. Obstacles are navigated. Progress is the point.' },
      { title: 'Evidence Based', desc: 'The science matters. We stay current and apply it practically.' },
      { title: 'Transparent', desc: 'You know the why behind every decision we make for your training.' },
      { title: 'Everybody Eats', desc: 'Every athlete on our roster gets the same level of attention and care.' },
    ] },
  { id: 'philosophy.image', kind: 'image', label: 'Section photo', group: 'Philosophy',
    fields: ['src', 'alt'],
    default: {
      src: 'https://static.wixstatic.com/media/e99af3_5dba1d18186b43a686e4f40af779c1c1~mv2.jpg',
      alt: 'Axis athlete competing',
    } },
]

const SERVICES_BLOCKS: BlockDef[] = [
  { id: 'services.eyebrow', kind: 'text', label: 'Eyebrow', group: 'Services',
    default: 'What We Offer' },
  { id: 'services.heading', kind: 'text', label: 'Heading', group: 'Services',
    default: 'Services' },
  { id: 'services.intro', kind: 'paragraph', label: 'Intro', group: 'Services',
    default: 'Four distinct tracks, each designed for a specific stage and goal in your powerlifting journey.' },
  // `title` shipped as a two-element array rendered around a <br/>, which is two
  // fields wearing one name. `num` and `href` are not stored: the ordinal comes
  // from position, and all four hrefs are the #coaches anchor in code.
  { id: 'services.items', kind: 'items', label: 'Service cards', group: 'Services',
    fields: ['titleTop', 'titleSub', 'desc', 'cta'],
    default: [
      {
        titleTop: '1:1 Coaching',
        titleSub: 'Full Service',
        desc: 'The most popular service at Axis. Athletes receive daily communication, unlimited technique analysis, individualized programming, and meet day handling. A high-contact service that allows coaches and athletes to address issues as they arise, adjusting training stress or providing technique accountability in real time.',
        cta: 'Apply Now',
      },
      {
        titleTop: 'Game Day',
        titleSub: 'Coaching',
        desc: 'For athletes who want an experienced Axis coach in their corner on competition day. Includes video review, scouting reports, a meet day planning call, and in-person or remote handling. Axis coaches are present at all National competitions in Powerlifting America and USAPL, and at most IPF World Championship events.',
        cta: 'Apply Now',
      },
      {
        titleTop: 'Coaching',
        titleSub: 'Mentorship',
        desc: 'Designed for coaches at all levels, whether established, on the rise, or just getting started. Tailored to your specific areas of improvement, with a structured curriculum available for full development. Sessions weekly, bi-weekly, monthly, or as a one-time consultation.',
        cta: 'Book a Consultation',
      },
      {
        titleTop: 'Movement',
        titleSub: 'Consulting',
        desc: 'For athletes not seeking full programming or ongoing coaching, but wanting focused support on technique. We offer movement coaching and consultations to refine your lifts and optimize movement for better performance and efficiency, as standalone sessions or a short-term series.',
        cta: 'Apply Now',
      },
    ] },
  // One list per card rather than a nested array inside the cards, because an
  // `items` element holds named strings and nothing else. The number in the id
  // is the card's position, which is also the only thing that binds them.
  { id: 'services.highlights-1', kind: 'list', label: 'Card 1 highlights', group: 'Services',
    default: ['Daily coach communication', 'Unlimited technique analysis', 'Individualized programming', 'Meet day handling included'] },
  { id: 'services.highlights-2', kind: 'list', label: 'Card 2 highlights', group: 'Services',
    default: ['Video review & scouting report', 'Meet day planning call', 'In-person or remote handling', 'Present at PA/USAPL Nationals & IPF Worlds'] },
  { id: 'services.highlights-3', kind: 'list', label: 'Card 3 highlights', group: 'Services',
    default: ['Programming & biomechanics', 'Athlete psychology', 'Building a coaching business', 'Meet day strategy & case studies'] },
  { id: 'services.highlights-4', kind: 'list', label: 'Card 4 highlights', group: 'Services',
    default: ['Video breakdown & cues', 'Technique correction plan', 'Standalone or short-term series', 'No long-term commitment required'] },
]

const HOW_IT_WORKS_BLOCKS: BlockDef[] = [
  { id: 'how-it-works.eyebrow', kind: 'text', label: 'Eyebrow', group: 'How It Works',
    default: 'The Process' },
  { id: 'how-it-works.heading', kind: 'text', label: 'Heading', group: 'How It Works',
    default: 'How It Works' },
  { id: 'how-it-works.intro', kind: 'paragraph', label: 'Intro', group: 'How It Works',
    default: 'Simple tools, direct communication, no bloated apps. Just you, your coach, and the work.' },
  // The literal word in front of every step number, easy to miss and awkward to
  // change without it: HowItWorks.tsx:75 renders `Step {s.step}`.
  { id: 'how-it-works.step-label', kind: 'text', label: 'Word before each step number', group: 'How It Works',
    default: 'Step' },
  { id: 'how-it-works.steps', kind: 'items', label: 'Steps', group: 'How It Works',
    fields: ['title', 'desc'],
    default: [
      { title: 'Apply', desc: 'Fill out the intake application. Tell us about your lifts, your schedule, your goals. We review every submission personally.' },
      { title: 'Onboard', desc: "Once accepted, you'll be matched with your coach, added to a WhatsApp thread, and billed monthly through Zen Planner. You're in." },
      { title: 'Train', desc: 'Your program lives in a Google Sheet, updated each block, laid out clearly. Film your lifts, send them over WhatsApp, train to spec.' },
      { title: 'Improve', desc: 'Your coach reviews every video and responds within 24 hours. Technique cues, load adjustments, programming tweaks: all handled in the thread.' },
    ] },
  // The icons stay in code and are keyed by position. Card 2 has none, and its
  // value renders larger because of it (HowItWorks.tsx:89), so the three rows
  // are not interchangeable even though they look it.
  { id: 'how-it-works.logistics', kind: 'items', label: 'Logistics cards', group: 'How It Works',
    fields: ['label', 'value', 'sub'],
    default: [
      { label: 'Communication', value: 'WhatsApp', sub: 'All coaching communication happens in a private WhatsApp thread. Direct access to your coach, no middleman.' },
      { label: 'Response Time', value: '24 hrs', sub: 'Guaranteed response within 24 hours. Send your training videos and questions. Your coach has you covered.' },
      { label: 'Your Program', value: 'Google Sheet', sub: 'Your training plan is delivered and updated in a shared Google Sheet. Clear, accessible, always up to date.' },
    ] },
  { id: 'how-it-works.image', kind: 'image', label: 'Section photo', group: 'How It Works',
    fields: ['src', 'alt'],
    default: {
      src: 'https://static.wixstatic.com/media/c0cc37_796d8fc359f64ca8a68c705fc054c7d5~mv2.jpg',
      alt: 'Axis athlete on platform',
    } },
]

const TESTIMONIALS_BLOCKS: BlockDef[] = [
  { id: 'testimonials.eyebrow', kind: 'text', label: 'Eyebrow', group: 'Testimonials',
    default: 'Results' },
  { id: 'testimonials.heading-1', kind: 'text', label: 'Heading, first line', group: 'Testimonials',
    default: 'Athletes Who' },
  { id: 'testimonials.heading-2', kind: 'text', label: 'Heading, second line', group: 'Testimonials',
    default: 'Made The Move' },
  { id: 'testimonials.image', kind: 'image', label: 'Section photo', group: 'Testimonials',
    fields: ['src', 'alt'],
    default: {
      src: 'https://static.wixstatic.com/media/e99af3_79e2b83391ac4e3dbd00da3383c2e8f1~mv2.jpg',
      alt: 'Axis athlete competing',
    } },
]

const COACHES_BLOCKS: BlockDef[] = [
  { id: 'coaches.eyebrow', kind: 'text', label: 'Eyebrow', group: 'Coaches',
    default: 'The Team' },
  { id: 'coaches.heading', kind: 'text', label: 'Heading', group: 'Coaches',
    default: 'Our Coaches' },
  { id: 'coaches.intro', kind: 'paragraph', label: 'Intro', group: 'Coaches',
    default: "Browse the team, view each coach's profile, and apply directly to the one that's the right fit for you." },
]

const TOOLS_BLOCKS: BlockDef[] = [
  { id: 'tools.eyebrow', kind: 'text', label: 'Eyebrow', group: 'Tools',
    default: 'Free Tools' },
  { id: 'tools.heading-1', kind: 'text', label: 'Heading, first line', group: 'Tools',
    default: 'Powerlifting' },
  { id: 'tools.heading-2', kind: 'text', label: 'Heading, second line', group: 'Tools',
    default: 'Calculators' },
  { id: 'tools.intro', kind: 'paragraph', label: 'Intro', group: 'Tools',
    default: 'Calculate your estimated max, plan training loads, set up meet attempts, and convert between lbs and kg, all in one place.' },
]

const MEETS_BLOCKS: BlockDef[] = [
  { id: 'meets.eyebrow', kind: 'text', label: 'Eyebrow', group: 'Upcoming Meets',
    default: 'Competition Calendar' },
  { id: 'meets.heading-1', kind: 'text', label: 'Heading, first line', group: 'Upcoming Meets',
    default: 'Upcoming' },
  { id: 'meets.heading-2', kind: 'text', label: 'Heading, second line', group: 'Upcoming Meets',
    default: 'Meets' },
  { id: 'meets.intro', kind: 'paragraph', label: 'Intro', group: 'Upcoming Meets',
    default: "Axis coaches are active competitors and handlers. You'll find us on the platform and in the warm-up room at every major meet." },
]

const FOOTER_BLOCKS: BlockDef[] = [
  // The same four words the hero lists as taglines, restated as a sentence.
  // They will drift if they are edited separately, and they are separate blocks
  // because one is a list of chips and the other is prose.
  { id: 'footer.blurb', kind: 'paragraph', label: 'Brand blurb', group: 'Footer',
    default: 'Solution focused. Evidence based. Transparent. Everybody eats.' },
  { id: 'footer.nav-heading', kind: 'text', label: 'Navigate column heading', group: 'Footer',
    default: 'Navigate' },
  { id: 'footer.connect-heading', kind: 'text', label: 'Connect column heading', group: 'Footer',
    default: 'Connect' },
  // One social list, two render sites. Footer.tsx holds these three addresses
  // TWICE today, twenty lines apart, with different labels: the icon row uses
  // them as aria-labels ("Instagram", "YouTube", "Linktree") and the Connect
  // column as link text ("@axistrainingsystems", "YouTube", "Linktree"). The
  // label here is the Connect column's; the icon row's accessible names stay in
  // code beside the icons they name.
  { id: 'footer.instagram', kind: 'link', label: 'Instagram', group: 'Footer',
    fields: ['label', 'href'],
    default: { label: '@axistrainingsystems', href: 'https://www.instagram.com/axistrainingsystems/' } },
  { id: 'footer.youtube', kind: 'link', label: 'YouTube', group: 'Footer',
    fields: ['label', 'href'],
    default: { label: 'YouTube', href: 'https://www.youtube.com/@axistrainingsystems' } },
  { id: 'footer.linktree', kind: 'link', label: 'Linktree', group: 'Footer',
    fields: ['label', 'href'],
    default: { label: 'Linktree', href: 'https://linktr.ee/Axis.Training.Systems' } },
]

/**
 * Every block, in page order.
 *
 * Deep-frozen at module load, because `blockDefs()` hands it out on every call
 * and a caller that edited a default in place would change what "Restore
 * original" means for every other component on the page.
 */
const BLOCK_DEFS: BlockDef[] = deepFreeze([
  ...HERO_BLOCKS,
  ...PHILOSOPHY_BLOCKS,
  ...SERVICES_BLOCKS,
  ...HOW_IT_WORKS_BLOCKS,
  ...TESTIMONIALS_BLOCKS,
  ...COACHES_BLOCKS,
  ...TOOLS_BLOCKS,
  ...MEETS_BLOCKS,
  ...FOOTER_BLOCKS,
])

const BY_ID = new Map<string, BlockDef>(BLOCK_DEFS.map(d => [d.id, d]))

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  }
  return value
}

/** A mutable copy, so a caller can edit a default without touching the registry. */
function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

// ── Lookups ──────────────────────────────────────────────────────────────────

/**
 * Every block, in page order.
 *
 * A fresh array each call, because the registry itself is deep-frozen and a
 * caller reaching for `.sort()` on a frozen array gets a TypeError rather than
 * a sorted list. The BlockDefs inside it are still the frozen originals, which
 * is the half that matters: nobody can edit a shipped default in place and
 * change what "Restore original" means for everybody else.
 */
export function blockDefs(): BlockDef[] {
  return [...BLOCK_DEFS]
}

export function blockDef(id: string): BlockDef | undefined {
  return BY_ID.get(id)
}

/** The shipped copy for a block, as a mutable copy. Undefined for an unknown id. */
export function defaultFor(id: string): unknown {
  const def = BY_ID.get(id)
  return def ? clone(def.default) : undefined
}

/** The groups the outline list draws, in page order, with no duplicates. */
export function blockGroups(): string[] {
  return [...new Set(BLOCK_DEFS.map(d => d.group))]
}

// ── Validation ───────────────────────────────────────────────────────────────
//
// One generic walk of (default, override), rather than a hand-written validator
// per block. guideContent.ts needs 200 lines because it validates a structure a
// person builds from nothing; here the default IS the schema, and every block
// added later is covered with no new validator code.
//
// It never repairs and never truncates. guideContent.ts:131 states the reason
// and it holds unchanged: a validator that quietly drops the eleventh option or
// pads a short row hands an owner a saved page that is not the page they typed.

export type BlockResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string }

/** The first problem, thrown to the top of the walk and returned from there.
 *  Internal only: nothing exported from this file throws. */
class Refusal extends Error {}

function refuse(message: string): never {
  throw new Refusal(message)
}

/** 1-based, because "item 0" means nothing to the person reading it. */
function nth(i: number): number {
  return i + 1
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * The em dash rule, in one place.
 *
 * A house rule about voice rather than about safety, which is exactly why it
 * belongs on THIS validator and not on a shared one: a blog post body may
 * legitimately contain a dash, and a headline may not.
 */
function noEmDash(value: string, what: string): void {
  if (value.includes('—')) {
    refuse(`${what} has a dash in it. Use a period, a comma or a colon instead of a dash.`)
  }
}

/** Trimmed, cleaned and capped, or a refusal naming the spot. */
function line(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string') refuse(`${what} needs to be text.`)
  // sanitizeText strips tags, javascript:, data:, vbscript:, on*= and comments
  // and does NOT entity-escape, because React escapes text nodes and encoding
  // here too renders a literal &#x27; on the page (utils/sanitize.ts:48-55).
  const cleaned = sanitizeText(value, max + 1)
  if (!cleaned) refuse(`${what} cannot be blank. Type something, or restore the original.`)
  if (cleaned.length > max) refuse(`${what} is longer than ${max} characters. Shorten it.`)
  noEmDash(cleaned, what)
  return cleaned
}

function url(value: unknown, what: string): string {
  const safe = safeContentUrl(value)
  if (!safe) {
    refuse(`${what} needs a web address starting with https://, or a path on this site starting with /.`)
  }
  return safe
}

/**
 * The gate a value passes twice: it has to fit.
 *
 * Measured on the serialized bytes, because that is what the column stores and
 * what every visitor's page load pays for. It runs FIRST on the raw incoming
 * value, before anything is looked at in detail, because there is no point
 * walking a megabyte to find out which field is malformed when the answer is no
 * either way. It runs again on the cleaned value that actually reaches the row.
 */
function sized(value: unknown, what: string): void {
  // A sentinel rather than a bare `let bytes: number`, because a value that
  // cannot be serialized at all (a cycle, a BigInt) is a refusal rather than a
  // throw, and this way the definite-assignment analysis has nothing to argue
  // with about what happens after the catch.
  let bytes = -1
  try {
    bytes = new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    bytes = -1
  }
  if (bytes < 0) {
    refuse(`${what} could not be saved. Something in it is not text this site can store.`)
  }
  if (bytes > BLOCK_BYTE_LIMIT) {
    refuse(`There is too much text in ${what.toLowerCase()} to save. One block holds about ${Math.round(BLOCK_BYTE_LIMIT / 1000)} KB, which is several pages of writing. Take some out and save again.`)
  }
}

/**
 * The fields of one record, against the field list the block shipped with.
 *
 * A key the default does not have is REFUSED rather than dropped, and a key it
 * has that the override omits is refused rather than filled in from the
 * default. Both are the same rule: an override replaces text, never shape, and
 * a caller sending half a record has lost track of what it is editing.
 */
function record(
  value: unknown,
  fields: string[],
  what: string,
  max: number,
  urlFields: string[] = [],
): Record<string, string> {
  if (!isRecord(value)) refuse(`${what} is not filled in.`)
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) {
      refuse(`${what} has a field this site does not know about: "${key}". Reload the page and try again.`)
    }
  }
  const out: Record<string, string> = {}
  for (const key of fields) {
    if (!(key in value)) refuse(`${what} is missing "${key}". Reload the page and try again.`)
    out[key] = urlFields.includes(key)
      ? url(value[key], `${what} "${key}"`)
      : line(value[key], `${what} "${key}"`, max)
  }
  return out
}

/**
 * An override for one block, checked against the shipped default.
 *
 * THE RULE: an override may replace the TEXT of a field, never the SHAPE of a
 * block. A list keeps its length, a record keeps its fields, and a value of the
 * wrong type is refused rather than coerced. See the file header for why that
 * is a feature and not a shortcut.
 *
 * Refuses rather than repairs, and names the first problem with its position.
 */
export function validateBlock(id: string, value: unknown): BlockResult {
  const def = BY_ID.get(id)
  if (!def) {
    return { ok: false, message: 'That is not a block this site knows about. Reload the page and try again.' }
  }
  try {
    sized(value, def.label)
    const cleaned = walk(def, value)
    sized(cleaned, def.label)
    return { ok: true, value: cleaned }
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, message: e.message }
    return { ok: false, message: 'That could not be saved. Reload the page and try again.' }
  }
}

function walk(def: BlockDef, value: unknown): unknown {
  const what = def.label

  switch (def.kind) {
    case 'text':
      return line(value, what, LINE_LIMIT)

    case 'paragraph':
      return line(value, what, PARAGRAPH_LIMIT)

    case 'list': {
      const shipped = def.default as string[]
      if (!Array.isArray(value)) refuse(`${what} needs to be a list.`)
      if (value.length !== shipped.length) {
        refuse(`${what} has ${value.length} entries and this section holds ${shipped.length}. Adding and removing entries is not something this editor does yet, so reword the ones that are there.`)
      }
      return value.map((v, i) => line(v, `Entry ${nth(i)} of ${what.toLowerCase()}`, LINE_LIMIT))
    }

    case 'items': {
      const shipped = def.default as Record<string, unknown>[]
      const fields = def.fields ?? []
      if (!Array.isArray(value)) refuse(`${what} needs to be a list.`)
      if (value.length !== shipped.length) {
        refuse(`${what} has ${value.length} entries and this section holds ${shipped.length}. Adding and removing entries is not something this editor does yet, so reword the ones that are there.`)
      }
      return value.map((v, i) =>
        record(v, fields, `Item ${nth(i)} of ${what.toLowerCase()}`, PARAGRAPH_LIMIT))
    }

    case 'image': {
      // The src is checked here AND again at the render site, because this file
      // is signage: a manage_content holder can POST anything straight through
      // PostgREST, and the value lands in an <img src>.
      return record(value, def.fields ?? ['src', 'alt'], what, LINE_LIMIT, ['src'])
    }

    case 'link': {
      // Same again for the href. Services.tsx:81-91 already flips an anchor to
      // target=_blank on an http prefix, so a stored address reaches a live
      // link the moment React renders it.
      return record(value, def.fields ?? ['label', 'href'], what, LINE_LIMIT, ['href'])
    }

    default:
      refuse('That is not a kind of block this site knows about.')
  }
}

// ── Resolving ────────────────────────────────────────────────────────────────

/**
 * The copy every block should render, given whatever the table answered.
 *
 * A stored value that no longer validates falls back to the shipped default
 * rather than rendering half of itself. That is guideContent.ts's posture
 * (parseGuideContent answers null and the page reads the bundle) and the reason
 * is the same: a section that has always worked should not go blank because
 * somebody saved a broken draft over it, or because a later release changed the
 * shape of a block underneath a row that is still in the table.
 *
 * Resolved ONCE per fetch rather than per read: `value(id)` is called well over
 * a hundred times on a homepage render, and re-validating on each one would put
 * a full walk of the registry inside the render path.
 */
export function resolveContent(map: SiteContentMap | null): SiteContentMap {
  const out: SiteContentMap = {}
  for (const def of BLOCK_DEFS) {
    const stored = map ? map[def.id] : undefined
    if (stored === undefined) {
      out[def.id] = def.default
      continue
    }
    const checked = validateBlock(def.id, stored)
    out[def.id] = checked.ok ? checked.value : def.default
  }
  return out
}

/** True when this block is showing something other than the shipped copy. The
 *  `Edited` chip and the bar's live override count both read this. */
export function hasOverride(map: SiteContentMap | null, id: string): boolean {
  return !!map && map[id] !== undefined
}

// ── Shared plumbing ──────────────────────────────────────────────────────────

const TABLE = 'site_content'

/**
 * Exactly the columns 048 grants to anon. A column added to the table and not
 * named in that grant does not read as null, it 403s the whole request for
 * logged-out visitors while working perfectly for a signed-in admin, which is
 * the failure that only shows up in production (035's header records it twice).
 */
export const COLUMNS = 'block,value,updated_at'

/** Demo and "no credentials" are the same to a screen: nothing to talk to. */
const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

/** A beat of latency so demo saving-states read as honest, not instant. */
const beat = () => new Promise<void>(r => setTimeout(r, 220))

/** A PostgREST error, in a sentence a person can act on. Same codes as
 *  resourceLibrary.ts:160-180, different nouns. */
function writeMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  const code = error.code ?? ''
  const msg = (error.message ?? '').replace(/^ERROR:\s*/i, '').trim()
  // 048's guard raises 22023 with a sentence already written for a person.
  // Pass it through rather than paraphrase it.
  if ((code === '22023' || code === 'P0001') && msg) return msg
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'The database refused that change. Your account may not have permission to edit the site copy.'
  }
  if (code === '23514') return 'Those values are outside what the database allows. Reload the page and try again.'
  if (code === 'PGRST301' || /jwt|token is expired/i.test(msg)) {
    return 'Your session expired. Sign in again and the change will go through.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection, nothing was changed.'
  }
  return fallback
}

// ── The demo store ───────────────────────────────────────────────────────────
//
// Seeded EMPTY rather than from the defaults, because an empty override map is
// exactly what a fresh site looks like: every block reads out of the bundle
// until somebody changes one. Mutated in place, so a walk-through that edits
// the hero and clicks through to another page still sees the edit.
//
// The hazard resourceLibrary.ts:533-542 warns about — a demo store and a
// migration seed being two copies of the same data bound only by a comment —
// does not exist here, because 048 seeds nothing.

let demoContent: SiteContentMap | null = null

function store(): SiteContentMap {
  if (!demoContent) demoContent = {}
  return demoContent
}

/** Forget the walk-through: the next read is a fresh site again. */
export function resetDemoContent(): void {
  demoContent = null
}

// ── Reading ──────────────────────────────────────────────────────────────────

/**
 * Every override on the site.
 *
 * `null` means "could not tell you" and the caller keeps the shipped copy. `{}`
 * means the table really is empty, which is the ordinary state of a site nobody
 * has edited yet, and must not be confused with the first.
 *
 * With no credentials this answers the demo store rather than null, because
 * there the demo store IS the truth: demo mode has to work everywhere, and a
 * null would throw away the edit somebody just made in the walk-through.
 */
export async function fetchSiteContent(): Promise<SiteContentMap | null> {
  if (!supabaseConfigured) return { ...store() }
  try {
    const { data, error } = await supabase.from(TABLE).select(COLUMNS)
    if (error || !Array.isArray(data)) return null
    const out: SiteContentMap = {}
    for (const row of data as Record<string, unknown>[]) {
      const block = typeof row.block === 'string' ? row.block : ''
      // Rows for blocks this build no longer has are carried rather than
      // dropped: resolveContent only ever looks up ids it knows, and an admin
      // screen listing orphans wants to see them.
      if (block && row.value !== undefined && row.value !== null) out[block] = row.value
    }
    return out
  } catch {
    return null
  }
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * Replace one block's copy.
 *
 * The whole block is written, which is correct here in a way it is not for
 * resource_library's `config`: a block IS the unit, one row holds one block,
 * and there are no sibling keys on the row to carry forward. That is the reason
 * the table is keyed by block rather than by section, and it removes the entire
 * class of bug that forced ResourceLibraryPanel into two compensating helpers
 * (configOf at 151-168, saveContent at 336-352).
 */
export async function saveBlock(id: string, value: unknown, isDemo = false): Promise<WriteResult> {
  const checked = validateBlock(id, value)
  if (!checked.ok) return { ok: false, message: checked.message }

  if (offline(isDemo)) {
    await beat()
    store()[id] = checked.value
    return { ok: true }
  }

  // An upsert on the primary key: the first edit of a block inserts, every one
  // after it updates, and the caller never has to know which.
  const { data, error } = await supabase
    .from(TABLE)
    .upsert({ block: id, value: checked.value }, { onConflict: 'block' })
    .select('block')

  if (error) return { ok: false, message: writeMessage(error, 'That did not save.') }
  // An RLS refusal on the update path arrives as a success with no rows rather
  // than an error, which is why every write in this repo asks for the row back
  // (contentApi.ts:289-336, siteSettings.ts:40-52).
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, message: 'That did not save. Your account may not have permission to edit the site copy.' }
  }
  return { ok: true }
}

/**
 * Put the shipped copy back.
 *
 * A DELETE, never a write of today's defaults. The reason is
 * ResourceLibraryPanel.tsx:354-374's, unchanged: a row storing today's defaults
 * is frozen at today, while a block with no row reads its copy out of the
 * bundle every time, so a later correction there still reaches the page.
 */
export async function resetBlock(id: string, isDemo = false): Promise<WriteResult> {
  if (!BY_ID.has(id)) {
    return { ok: false, message: 'That is not a block this site knows about. Reload the page and try again.' }
  }

  if (offline(isDemo)) {
    await beat()
    delete store()[id]
    return { ok: true }
  }

  const { data, error } = await supabase.from(TABLE).delete().eq('block', id).select('block')
  if (error) return { ok: false, message: writeMessage(error, 'Could not put the original copy back.') }
  if (Array.isArray(data) && data.length > 0) return { ok: true }

  // Zero rows is ambiguous on a delete in a way it is not on an update: it
  // means either "there was nothing to restore", which is a success, or "RLS
  // refused", which is not. The table is anon-readable, so one cheap read tells
  // the two apart rather than reporting a checkmark over a refusal.
  const check = await supabase.from(TABLE).select('block').eq('block', id).maybeSingle()
  if (check.data) {
    return { ok: false, message: 'The original copy is still overridden. Your account may not have permission to edit the site copy.' }
  }
  return { ok: true }
}

// ── The public read hook ─────────────────────────────────────────────────────

let shared: Promise<SiteContentMap | null> | null = null

/**
 * One request for the whole page.
 *
 * Ten marketing sections each fetching independently is ten identical PostgREST
 * round trips on the homepage. Memoized exactly as sharedPublishedResources is
 * at calculators.ts:956-1003.
 */
function sharedSiteContent(): Promise<SiteContentMap | null> {
  if (!shared) shared = fetchSiteContent().catch(() => null)
  return shared
}

/** Drop the cached read, so the next mount asks again. Call after a save. */
export function invalidateSiteContent(): void {
  shared = null
}

/**
 * The copy, for a component.
 *
 * State is seeded SYNCHRONOUSLY from the shipped defaults, so first paint never
 * waits on a fetch and an outage keeps the site looking exactly as it always
 * has. Every marketing section on this site already works this way (Coaches.tsx
 * 40-47, Testimonials.tsx:16-24, useResourceRegistry), and getting it wrong
 * here would regress LCP on the one page that sells the business.
 *
 * `ready` is false until the table has answered, so a screen can tell "nothing
 * is overridden" from "not asked yet". Nothing on the public site needs that
 * distinction; the edit bar's override count does.
 */
export function useSiteContent(): { value: (id: string) => unknown; ready: boolean; reload: () => void } {
  const [state, setState] = useState<{ resolved: SiteContentMap; ready: boolean }>(
    () => ({ resolved: resolveContent(null), ready: false }),
  )

  useEffect(() => {
    let live = true
    void sharedSiteContent().then(map => {
      if (!live) return
      setState({ resolved: resolveContent(map), ready: true })
    })
    return () => { live = false }
  }, [])

  const reload = useCallback(() => {
    invalidateSiteContent()
    void sharedSiteContent().then(map => setState({ resolved: resolveContent(map), ready: true }))
  }, [])

  const value = useCallback((id: string) => state.resolved[id], [state.resolved])

  return { value, ready: state.ready, reload }
}
