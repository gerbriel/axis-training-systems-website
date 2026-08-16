import { useState, useEffect, useCallback } from 'react'
import { href } from '../utils/nav'
import { subscribeNewsletter, getNewsletterAccess } from '../lib/newsletterApi'
import { useBotTrap } from '../lib/botTrap'
import type { NewsletterAccess } from '../types/newsletter'
import { useCalculatorConfig, useResourceRegistry, type GuideEntry } from '../lib/calculators'
import { safeResourceUrl, ATTACHMENT_LIMIT } from '../lib/resourceLibrary'
import { humanFileSize } from '../lib/resourceFiles'
import { defaultContentFor, parseGuideContent } from '../lib/guideContent'
import type {
  ChecklistContent, GuideContent, QuizContent, ReferenceContent, SectionsContent, WorksheetContent,
} from '../lib/guideContent'
import ChecklistView from '../components/guides/ChecklistView'
import GuideContentView from '../components/guides/GuideContentView'
import QuizView from '../components/guides/QuizView'
import ReferenceView from '../components/guides/ReferenceView'
import SectionsView from '../components/guides/SectionsView'
import WorksheetView from '../components/guides/WorksheetView'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

// ── Shared styles ────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.2rem',
  color: 'var(--text)', fontSize: '.875rem', fontWeight: 500, padding: '.65rem .875rem',
  outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
}
const lbl: React.CSSProperties = {
  color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em',
  textTransform: 'uppercase', marginBottom: '.35rem', display: 'block',
}
const sectionLabel: React.CSSProperties = {
  color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em',
  textTransform: 'uppercase', marginBottom: '.5rem', display: 'block',
}
const heading: React.CSSProperties = {
  color: 'var(--text)', fontWeight: 900, fontSize: '1.1rem', textTransform: 'uppercase',
  letterSpacing: '-.01em', marginBottom: '.6rem',
}
const listItem = (idx: number) => ({
  display: 'flex', gap: '.75rem', color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.75,
  padding: '.35rem 0', borderBottom: idx > 0 ? '1px solid var(--surface-2)' : 'none',
} as React.CSSProperties)

// ─────────────────────────────────────────────────────────────────────────────
// THE BUILT-IN GUIDE BODIES
// ─────────────────────────────────────────────────────────────────────────────
//
// What the six guides CONTAIN is data now. src/lib/guideContent.ts holds it,
// the five views in src/components/guides render it, and the admin panel edits
// it, so fixing a typo in the meet day checklist is a form rather than a deploy.
//
// What is left in this file is the wiring: which view each built-in feeds, and
// the attempt calculator, which is a form over `calculator_settings` rather than
// copy and has no content type at all.
//
// A built-in is the FALLBACK. A guide row carrying valid content in `config`
// renders that content instead, which is what makes these six editable.

/** A built-in's shipped content, or null. The key and the shape are named
 *  together here, so a key that stops resolving shows up as a card that renders
 *  nothing rather than as a view reading fields that are not there. */
function shippedContent<T extends GuideContent>(key: string, type: T['type']): T | null {
  const content = defaultContentFor(key)
  return content && content.type === type ? (content as T) : null
}

const CHECKLIST_CONTENT = shippedContent<ChecklistContent>('checklist', 'checklist')
const QUIZ_CONTENT      = shippedContent<QuizContent>('quiz', 'quiz')
const RPE_CONTENT       = shippedContent<ReferenceContent>('rpe', 'reference')
const BIG_THREE_CONTENT = shippedContent<SectionsContent>('big3', 'sections')
const AUDIT_CONTENT     = shippedContent<WorksheetContent>('audit', 'worksheet')

// ─────────────────────────────────────────────────────────────────────────────
// THE ATTEMPT SELECTION CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────

function roundToNearest(n: number, nearest: number) { return Math.round(n / nearest) * nearest }

/**
 * The same attempt calculator as the one in the tools strip.
 *
 * It used to carry its OWN copy of the percentages, typed out again a few
 * hundred lines from the original, so the site could quote a 90% opener on one
 * page and whatever the last edit left behind on the other. Both read one
 * config now, and the owner edits it in the admin portal.
 */
function AttemptCalcGuide() {
  const cfg = useCalculatorConfig()
  const [unit, setUnit]   = useState<'lbs' | 'kg'>('lbs')
  const [squat, setSquat] = useState('')
  const [bench, setBench] = useState('')
  const [dead,  setDead]  = useState('')
  const [style, setStyle] = useState<'conservative' | 'aggressive'>('conservative')

  const profiles = cfg.attempts.profiles
  const step = unit === 'kg' ? cfg.attempts.rounding.kg : cfg.attempts.rounding.lbs

  function conv(v: string, factor: number) {
    const n = parseFloat(v)
    return isNaN(n) || v === '' ? '' : String(parseFloat((n * factor).toFixed(2)))
  }
  function switchUnit(next: 'lbs' | 'kg') {
    const f = next === 'kg' ? 0.453592 : 2.20462
    setSquat(s => conv(s, f)); setBench(b => conv(b, f)); setDead(d => conv(d, f))
    setUnit(next)
  }

  function attempts(maxStr: string) {
    const max = parseFloat(maxStr)
    if (isNaN(max) || max <= 0) return null
    const p = profiles[style]
    return [
      roundToNearest(max * p.open,   step),
      roundToNearest(max * p.second, step),
      roundToNearest(max * p.third,  step),
    ]
  }

  const lifts = [
    { label: 'Squat',    val: squat, set: setSquat },
    { label: 'Bench',    val: bench, set: setBench },
    { label: 'Deadlift', val: dead,  set: setDead  },
  ]
  const hasAny = lifts.some(l => parseFloat(l.val) > 0)
  const p = profiles[style]

  const projectedTotal = lifts.reduce((acc, l) => {
    const n = parseFloat(l.val)
    if (isNaN(n) || n <= 0) return acc
    return acc + roundToNearest(n * p.second, step)
  }, 0)

  return (
    <div>
      <p style={{ color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.75, marginBottom: '1.5rem' }}>
        Enter your training max for each lift (the heaviest single you're confident you could hit on a good day). Conservative keeps your opener very safe; aggressive goes for a bigger PR third.
      </p>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginBottom: '1.5rem' }}>
        {[
          { label: 'Unit', el: <select style={{ ...inp, appearance: 'none', cursor: 'pointer' }} value={unit} onChange={e => switchUnit(e.target.value as 'lbs' | 'kg')}><option value="lbs">lbs</option><option value="kg">kg</option></select> },
          { label: 'Strategy', el: <select style={{ ...inp, appearance: 'none', cursor: 'pointer' }} value={style} onChange={e => setStyle(e.target.value as 'conservative' | 'aggressive')}><option value="conservative">Conservative</option><option value="aggressive">Aggressive</option></select> },
        ].map(({ label, el }) => (
          <div key={label}><label style={lbl}>{label}</label>{el}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: '1.5rem' }}>
        {lifts.map(({ label, val, set }) => (
          <div key={label}>
            <label style={lbl}>{label} Training Max</label>
            <input style={inp} type="number" min="1" placeholder={`e.g. ${label === 'Bench' ? '225' : '405'}`} value={val} onChange={e => set(e.target.value)} />
          </div>
        ))}
      </div>

      {hasAny && (
        <div>
          {lifts.map(({ label, val }) => {
            const atts = attempts(val)
            if (!atts) return null
            const [a1, a2, a3] = atts
            return (
              <div key={label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '1.5rem', marginBottom: '1rem' }}>
                <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>{label}</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.75rem' }}>
                  {[
                    { num: 1, w: a1, pct: Math.round(p.open   * 100), label: 'Opener'      },
                    { num: 2, w: a2, pct: Math.round(p.second * 100), label: '2nd Attempt' },
                    { num: 3, w: a3, pct: Math.round(p.third  * 100), label: '3rd Attempt' },
                  ].map(att => (
                    <div key={att.num} style={{ background: 'var(--surface-2)', border: `1px solid ${att.num === 3 ? 'rgba(39,44,132,.3)' : 'var(--surface)'}`, borderRadius: '.2rem', padding: '1rem .875rem', textAlign: 'center' }}>
                      <p style={{ color: 'var(--text-3)', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.3rem' }}>{att.label}</p>
                      <p style={{ color: att.num === 3 ? '#c8102e' : 'var(--text)', fontWeight: 900, fontSize: '1.2rem' }}>
                        {att.w} <span style={{ fontSize: '.65rem', fontWeight: 600, color: 'var(--text-2)' }}>{unit}</span>
                      </p>
                      <p style={{ color: 'var(--text-3)', fontSize: '.6rem', marginTop: '.2rem' }}>{att.pct}%</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {projectedTotal > 0 && (
            <div style={{ background: 'rgba(39,44,132,.06)', border: '1px solid rgba(39,44,132,.2)', borderRadius: '.25rem', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <span style={{ color: 'var(--text-2)', fontSize: '.75rem', fontWeight: 600 }}>Projected Meet Total (2nd attempts)</span>
              <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.5rem' }}>{projectedTotal} <span style={{ fontSize: '.7rem' }}>{unit}</span></span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO BUILT-INS WITH FRAMING PROSE
// ─────────────────────────────────────────────────────────────────────────────
//
// The other four feed a view and nothing else, so they are one line each in the
// switch below. These two carry a paragraph that is presentation rather than
// content: the RPE opener puts emphasis inside a sentence, which a stored string
// cannot hold without becoming markup we would then have to render from the
// database, and the audit's questions belong to the audit rather than to the
// worksheet type every scored worksheet shares.

/** The RPE guide's opener. */
const RPE_INTRO = (
  <>
    RPE (Rate of Perceived Exertion) is a scale from 1–10 that describes how hard a set felt relative to your maximum. In powerlifting, we typically work in the RPE 6–10 range. The key insight: <strong style={{ color: 'var(--chalk)' }}>RPE is about reps remaining, not how tired you feel.</strong>
  </>
)

function RPEGuide() {
  if (!RPE_CONTENT) return null
  return <ReferenceView content={RPE_CONTENT} intro={RPE_INTRO} />
}

const AUDIT_INTRO =
  'Rate each aspect of your most recent training block honestly, not how you hope it went, but how it actually went. One block = 4–12 weeks of training.'

/** The question under each audit category, by the title it belongs to. Keyed
 *  rather than positional so a category the owner moves keeps its question and
 *  a category they rename simply loses it, instead of borrowing its neighbour's. */
const AUDIT_PROMPTS: Record<string, string> = {
  'Volume Management': 'Did you progressively increase total sets/reps over the block, and did you know what your volume was week to week?',
  'Intensity Progression': 'Did the weights go up in a planned, structured way, not just whenever you felt good?',
  'Specificity': 'Was the majority of your training directly transferring to your competition lifts (squat, bench, deadlift)?',
  'Recovery & Fatigue Management': 'Did you manage accumulated fatigue with planned deloads or reduced weeks?',
  'Technique Consistency': 'Did your technique stay consistent across different intensities, or did your form break down under heavy load?',
  'Program Compliance': 'How closely did you follow the plan as written?',
}

function AuditWorksheet() {
  if (!AUDIT_CONTENT) return null
  return <WorksheetView content={AUDIT_CONTENT} intro={AUDIT_INTRO} prompts={AUDIT_PROMPTS} />
}

// ─────────────────────────────────────────────────────────────────────────────
// NEWSLETTER GATE
// ─────────────────────────────────────────────────────────────────────────────

interface GateProps {
  source?: string
  /** How many cards are actually behind the signup. The headline used to say
   *  "All 6 Guides" as a literal, which stopped being true the moment the owner
   *  could publish a seventh. */
  count?: number
  onAccess: (access: NewsletterAccess) => void
}

function NewsletterGate({ source = 'guides_page', count, onAccess }: GateProps) {
  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [email,     setEmail]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const bot = useBotTrap()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Suspected bot: grant access silently, write nothing. See botTrap.ts.
    if (bot.isSuspect()) { onAccess({ email, firstName, source, signedUpAt: new Date().toISOString() }); return }
    setError('')
    setLoading(true)
    try {
      await subscribeNewsletter({ firstName, lastName, email, source }, false)
      onAccess({ email, firstName, source, signedUpAt: new Date().toISOString() })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      if (msg.includes('already subscribed')) {
        // Still grant access
        onAccess({ email, firstName: firstName || 'Athlete', source, signedUpAt: new Date().toISOString() })
      } else {
        setError(msg)
        setLoading(false)
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.5rem', padding: '2.5rem', maxWidth: 480, margin: '0 auto' }}>
      <input {...bot.fieldProps} />
      <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Free Access</p>
      <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.4rem', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: 1.1, marginBottom: '.75rem' }}>
        {count && count > 0 ? `Unlock All ${count} Guides` : 'Unlock The Guides'}
      </h2>
      <p style={{ color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.7, marginBottom: '1.75rem' }}>Enter your name and email to get instant, free access to all guides, tools, and worksheets. No credit card, no spam.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.875rem', marginBottom: '.875rem' }}>
        <div>
          <label style={lbl}>First Name <span style={{ color: 'var(--text)' }}>*</span></label>
          <input style={inp} required placeholder="Jane" value={firstName} onChange={e => setFirstName(e.target.value)} maxLength={100} />
        </div>
        <div>
          <label style={lbl}>Last Name</label>
          <input style={inp} placeholder="Smith" value={lastName} onChange={e => setLastName(e.target.value)} maxLength={100} />
        </div>
      </div>
      <div style={{ marginBottom: '1.25rem' }}>
        <label style={lbl}>Email <span style={{ color: 'var(--text)' }}>*</span></label>
        <input style={inp} type="email" required placeholder="jane@example.com" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} />
      </div>
      {error && <p style={{ color: 'var(--text)', fontSize: '.8rem', marginBottom: '.875rem' }}>{error}</p>}
      <button
        type="submit"
        disabled={loading || !firstName.trim() || !email.trim()}
        style={{ width: '100%', background: '#272C84', border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.2em', textTransform: 'uppercase', padding: '.875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit', opacity: loading || !firstName.trim() || !email.trim() ? 0.5 : 1, transition: 'opacity .15s' }}
        onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#1a1f6b' }}
        onMouseLeave={e => e.currentTarget.style.background = '#272C84'}
      >
        {loading ? 'Unlocking…' : 'Get Free Access →'}
      </button>
      <p style={{ color: 'var(--text-3)', fontSize: '.7rem', textAlign: 'center', marginTop: '.875rem' }}>No spam. Unsubscribe any time.</p>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD BODIES
// ─────────────────────────────────────────────────────────────────────────────
//
// Which cards exist, what they are called and what order they come in is the
// database's business (src/lib/calculators.ts reads the library and falls back
// to the six built-ins when it cannot), and so is what a card CONTAINS: guide
// content off `config.content`, an article's body off `config.body`, an address
// off `config.url`. Code is only what a card falls back to.

/** The built-in a guide row names, rendered from the content it shipped with. */
function BuiltinGuide({ guide }: { guide: GuideEntry }) {
  switch (guide.builtin) {
    case 'checklist': return CHECKLIST_CONTENT ? <ChecklistView content={CHECKLIST_CONTENT} /> : null
    case 'attempts':  return <AttemptCalcGuide />
    case 'quiz':      return QUIZ_CONTENT ? <QuizView content={QUIZ_CONTENT} /> : null
    case 'rpe':       return <RPEGuide />
    case 'big3':      return BIG_THREE_CONTENT ? <SectionsView content={BIG_THREE_CONTENT} /> : null
    case 'audit':     return <AuditWorksheet />
    default:          return null
  }
}

/**
 * An owner-written article.
 *
 * Paragraphs split on blank lines and nothing else: no markdown library, and
 * emphatically no dangerouslySetInnerHTML. The body is stored text that an
 * admin typed, React escapes it on render, and that is the whole story.
 */
function ArticleBody({ body }: { body: string }) {
  const paragraphs = body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  if (paragraphs.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {paragraphs.map((p, i) => (
        <p key={i} style={{ color: 'var(--text-2)', fontSize: '.9rem', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{p}</p>
      ))}
    </div>
  )
}

/** The body of an expanded card, whichever kind it is. */
function GuideBody({ guide }: { guide: GuideEntry }) {
  if (guide.kind === 'article') {
    const body = typeof guide.config.body === 'string' ? guide.config.body : ''
    return body
      ? <ArticleBody body={body} />
      : <p style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>This one has not been written yet.</p>
  }
  // Stored content beats the built-in, which is the point of storing it: an
  // owner who rewrote the checklist expects to read their checklist. Content
  // that does not validate parses as null and the card falls back to what it
  // shipped with, rather than going blank over somebody's bad draft.
  const content = parseGuideContent(guide.config)
  if (!content) return <BuiltinGuide guide={guide} />

  // The framing prose is NOT stored content, so an override must not cost it.
  // These two guides carry a paragraph the content type has no field for (and
  // the audit its six questions), and they belong to the guide rather than to
  // the words an owner edits — so they are handed to the same view the built-in
  // path uses instead of being dropped on the way through GuideContentView.
  // The prompts are keyed by category title, so a category the owner renames
  // simply has no question under it, which is what AUDIT_PROMPTS documents.
  if (guide.builtin === 'rpe' && content.type === 'reference') {
    return <ReferenceView content={content} intro={RPE_INTRO} />
  }
  if (guide.builtin === 'audit' && content.type === 'worksheet') {
    return <WorksheetView content={content} intro={AUDIT_INTRO} prompts={AUDIT_PROMPTS} />
  }
  return <GuideContentView content={content} />
}

// ── Attachments ──────────────────────────────────────────────────────────────
//
// Files an admin uploaded against this resource, stored on `config.attachments`
// by the uploader in src/lib/resourceFiles.ts, which also owns how a size is
// written out: one formatter, so the admin panel and the public card cannot
// disagree about how big the same file is. Every url goes through
// safeResourceUrl on the way to an href for the reason its own comment gives: a
// stored `javascript:` is a working script link the moment React puts it in an
// anchor.

interface Attachment {
  label: string
  url: string
  kind: 'pdf' | 'image' | 'csv' | 'doc' | 'other'
  size: number | null
}

const ATTACHMENT_LABELS: Record<Attachment['kind'], string> = {
  pdf: 'PDF', image: 'Image', csv: 'CSV', doc: 'Doc', other: 'File',
}

/**
 * The attachments on a row, skipping anything malformed.
 *
 * Silently, on purpose: these are admin-authored and a public card is not where
 * a data problem should be reported. One bad entry costs that entry, not the
 * card, and the admin panel is where the same value gets refused out loud.
 *
 * The slice is the library's own ceiling on how many files one row carries, so
 * a hand-written config cannot put more on a card than the panel would let
 * anybody attach.
 */
function readAttachments(config: Record<string, unknown>): Attachment[] {
  const raw = config?.attachments
  if (!Array.isArray(raw)) return []
  const files: Attachment[] = []
  for (const entry of raw.slice(0, ATTACHMENT_LIMIT)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const e = entry as Record<string, unknown>
    const url = safeResourceUrl(e.url)
    if (!url) continue
    const kind = typeof e.kind === 'string' && e.kind in ATTACHMENT_LABELS
      ? (e.kind as Attachment['kind'])
      : 'other'
    const label = typeof e.label === 'string' && e.label.trim()
      ? e.label.trim().slice(0, 200)
      : ATTACHMENT_LABELS[kind]
    const size = typeof e.size === 'number' && Number.isFinite(e.size) ? e.size : null
    files.push({ label, url, kind, size })
  }
  return files
}

/** The files strip under an expanded card. Nothing at all when there are none,
 *  so a guide that has never had a file attached looks exactly as it did. */
function AttachedFiles({ config }: { config: Record<string, unknown> }) {
  const files = readAttachments(config)
  if (files.length === 0) return null

  return (
    <div style={{ marginTop: '2rem', borderTop: '1px solid var(--surface-2)', paddingTop: '1.25rem' }}>
      <span style={sectionLabel}>Attached Files</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
        {files.map((file, i) => {
          const size = humanFileSize(file.size)
          return (
            <a
              key={i}
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: '.75rem', textDecoration: 'none',
                background: 'var(--bg)', border: '1px solid var(--surface)', borderRadius: '.2rem',
                padding: '.6rem .875rem', transition: 'border-color .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#272C84'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--surface)'}
            >
              <span style={{ background: 'rgba(39,44,132,.1)', border: '1px solid rgba(39,44,132,.2)', color: 'var(--text)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.2rem .5rem', borderRadius: '.15rem', flexShrink: 0 }}>
                {ATTACHMENT_LABELS[file.kind]}
              </span>
              <span style={{ color: 'var(--text-2)', fontSize: '.8rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.label}
              </span>
              {size && <span style={{ color: 'var(--text-3)', fontSize: '.65rem', flexShrink: 0 }}>{size}</span>}
              <span style={{ color: 'var(--steel)', fontSize: '.9rem', flexShrink: 0 }}>↗</span>
            </a>
          )
        })}
      </div>
    </div>
  )
}

/** The address a link or download card points at, or nothing if it is not one
 *  we are willing to render. safeResourceUrl is the library's own check, so the
 *  form that stored the URL and the card that renders it agree on what is
 *  allowed rather than each having an opinion. */
function guideUrl(guide: GuideEntry): string | undefined {
  return safeResourceUrl(guide.config.url)
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function GuidesPage() {
  const { tools, guides } = useResourceRegistry()
  const [view,      setView]      = useState<'guides' | 'tools'>('guides')
  const [access,    setAccess]    = useState<NewsletterAccess | null>(null)
  const [expanded,  setExpanded]  = useState<string | null>(null)
  const [gateSource, setGateSource] = useState('guides_page')

  useEffect(() => {
    const saved = getNewsletterAccess()
    if (saved) setAccess(saved)
  }, [])

  const handleAccess = useCallback((a: NewsletterAccess) => {
    setAccess(a)
  }, [])

  /** Whether THIS card is behind the signup, rather than the whole page. The
   *  page used to gate everything; the flag is per row now, so the owner can
   *  put one guide out in the open as a taster. */
  const locked = (guide: GuideEntry) => guide.requiresSignup && !access

  const gatedCount = guides.filter(g => g.requiresSignup).length

  function sendToGate(source: string) {
    setGateSource(source)
    document.getElementById('guides-gate')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function toggleGuide(guide: GuideEntry) {
    if (locked(guide)) { sendToGate(guide.source); return }
    setExpanded(prev => prev === guide.id ? null : guide.id)
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--nav-overlay)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--border)', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 24, filter: 'var(--logo-filter)' }} />
        </a>
        <span style={{ color: 'var(--text-3)' }}>›</span>
        <span style={{ color: 'var(--text-2)', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>Free Stuff</span>
      </nav>

      {/* Hero */}
      <section style={{ padding: '6rem 2rem 3rem', borderBottom: '1px solid var(--surface)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Free Resources</p>
          <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(2.5rem, 7vw, 5rem)', textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: .9 }}>
            Free Stuff
          </h1>
          <p style={{ color: 'var(--text-2)', fontSize: '.9rem', marginTop: '1.25rem', maxWidth: 520, lineHeight: 1.75 }}>
            Free guides, calculators, and tools for powerlifters at every level. Sign up once to unlock everything.
          </p>
          {access && (
            <p style={{ color: '#22c55e', fontSize: '.75rem', fontWeight: 700, marginTop: '1rem' }}>
              ✓ Access active — welcome back{access.firstName ? `, ${access.firstName}` : ''}.
            </p>
          )}

          {/* View switcher */}
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '2rem' }}>
            {(['guides', 'tools'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  background: view === v ? 'var(--text)' : 'transparent',
                  border: `1px solid ${view === v ? 'var(--text)' : 'var(--border)'}`,
                  color: view === v ? 'var(--bg)' : 'var(--text-2)',
                  fontSize: '.65rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase',
                  padding: '.5rem 1.25rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all .15s',
                }}
              >
                {v === 'guides' ? 'Free Guides' : 'Free Tools'}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Tools grid */}
      {view === 'tools' && (
        <section style={{ padding: '4rem 2rem 6rem', maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1px', background: 'var(--surface)' }}>
            {tools.map(tool => (
              <div key={tool.id} style={{ background: 'var(--bg)', padding: '2rem' }}>
                <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '.95rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '.5rem' }}>{tool.label}</p>
                <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.65, marginBottom: '1.5rem' }}>{tool.desc}</p>
                <a
                  href={href(`/tools/${tool.id}`)}
                  style={{ display: 'inline-block', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', padding: '.5rem 1rem', borderRadius: '.2rem', textDecoration: 'none', transition: 'border-color .15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#272C84'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  Use Tool →
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Guide cards + gate + CTA — only in guides view */}
      {view === 'guides' && (<>
        <section style={{ padding: '4rem 2rem', maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--surface)' }}>
            {guides.map(guide => {
              const isOpen   = expanded === guide.id
              const isLocked = locked(guide)
              // A link or a download goes somewhere instead of opening in place,
              // so it is an anchor rather than an expander. Everything above the
              // marker is the same card either way.
              const leavesThePage = guide.kind === 'link' || guide.kind === 'download'
              const url = leavesThePage ? guideUrl(guide) : undefined
              const marker = leavesThePage ? (guide.kind === 'download' ? '↓' : '↗') : '›'

              const rowStyle: React.CSSProperties = {
                width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                padding: '1.75rem 2rem', cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', gap: '1.25rem', alignItems: 'flex-start',
                transition: 'background .15s', textDecoration: 'none',
              }

              const cardFace = (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.4rem' }}>
                      <span style={{ background: 'rgba(39,44,132,.1)', border: '1px solid rgba(39,44,132,.2)', color: 'var(--text)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.2rem .55rem', borderRadius: '.15rem', flexShrink: 0 }}>{guide.tag}</span>
                      {isLocked && <span style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700 }}>🔒 Sign up to unlock</span>}
                    </div>
                    <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '-.01em', lineHeight: 1.2, marginBottom: '.4rem' }}>{guide.label}</p>
                    <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.65 }}>{guide.description}</p>
                  </div>
                  <span style={{ color: isOpen ? '#272C84' : 'var(--steel)', fontSize: '1.2rem', flexShrink: 0, marginTop: '.2rem', transition: 'transform .2s, color .15s', transform: isOpen && !leavesThePage ? 'rotate(180deg)' : 'none' }}>{marker}</span>
                </>
              )

              return (
                <div key={guide.id} style={{ background: 'var(--bg)' }}>
                  {leavesThePage && url && !isLocked ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      {...(guide.kind === 'download' ? { download: '' } : {})}
                      style={rowStyle}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {cardFace}
                    </a>
                  ) : (
                    <button
                      // A card with no usable address still opens the gate when
                      // it is locked, and otherwise does nothing rather than
                      // navigating somewhere we refused to vouch for.
                      onClick={() => (leavesThePage && !isLocked ? undefined : toggleGuide(guide))}
                      style={rowStyle}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {cardFace}
                    </button>
                  )}
                  {isOpen && !isLocked && !leavesThePage && (
                    <div style={{ padding: '0 2rem 2rem', borderTop: '1px solid var(--surface-2)' }}>
                      <div style={{ paddingTop: '1.5rem' }}>
                        <GuideBody guide={guide} />
                        <AttachedFiles config={guide.config} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {guides.length === 0 && (
              <div style={{ background: 'var(--bg)', padding: '2rem' }}>
                <p style={{ color: 'var(--text-2)', fontSize: '.85rem', lineHeight: 1.7 }}>
                  No guides are published right now. Check back soon.
                </p>
              </div>
            )}
          </div>
        </section>

        {!access && gatedCount > 0 && (
          <section id="guides-gate" style={{ padding: '3rem 2rem 6rem' }}>
            <NewsletterGate source={gateSource} count={gatedCount} onAccess={handleAccess} />
          </section>
        )}

        {access && (
          <section style={{ padding: '4rem 2rem', borderTop: '1px solid var(--surface)', background: 'var(--bg)', textAlign: 'center' }}>
            <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Ready to Level Up?</p>
            <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.5rem, 4vw, 2.5rem)', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '.875rem' }}>Work With a Real Coach</h2>
            <p style={{ color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.75, maxWidth: 480, margin: '0 auto 1.75rem' }}>
              The guides give you the framework. A coach applies it to your training, your schedule, and your meet timeline.
            </p>
            <a href={href('/#coaches')} style={{ display: 'inline-block', background: '#272C84', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.2em', textTransform: 'uppercase', padding: '.875rem 2rem', borderRadius: '.25rem', textDecoration: 'none' }}
              onMouseEnter={e => e.currentTarget.style.background = '#1a1f6b'}
              onMouseLeave={e => e.currentTarget.style.background = '#272C84'}
            >
              Meet the Team →
            </a>
          </section>
        )}
      </>)}

      {/* Footer strip */}
      <div style={{ background: 'var(--bg)', borderTop: '1px solid var(--surface)', padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <a href={href('/')}><img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 20, filter: 'var(--logo-filter)' }} /></a>
        <a href={href('/')} style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', textDecoration: 'none' }}>← Home</a>
      </div>
    </div>
  )
}
