import type { CSSProperties, ReactNode } from 'react'
import { CONTENT_LIMITS } from '../../../lib/guideContent'

/**
 * guide-editors/_kit
 *
 * The parts all five guide editors need: a card to sit in, a box to type in,
 * and the three controls every list row wants (up, down, remove).
 *
 * The look is the calculator settings panel's — the same cell borders, the same
 * uppercase micro-labels, the same "add a row" ghost button — written out again
 * here rather than imported from it. That panel's chrome is private to it, and
 * promoting it to a shared admin-controls module is a bigger decision than five
 * editors should make on their way past.
 *
 * ABOUT THE CAPS. The numbers below are what the inputs enforce while a person
 * types: a maxLength on a box, an Add button that stops adding. They are a
 * courtesy, not the rule. `validateGuideContent` is what decides whether a
 * guide saves and its sentence is what the panel shows when it says no, so
 * nothing here truncates a list that is already too long — it only declines to
 * make it longer. Where the two disagree the validator wins, which is the right
 * way round: one of them runs in the browser a person happens to be using, and
 * the other runs on the way to the column.
 *
 * Which is why the ones that MEASURE THE SAME THING are read off CONTENT_LIMITS
 * rather than typed out again. A local number is free to drift above the
 * validator's, and a form that accepts sixty answers and then refuses to save
 * them is worse than one that stopped at fifty: the person has already done the
 * typing. The handful left as literals are deliberately TIGHTER than the
 * validator, which is the safe direction, and they are marked as such.
 */

export const CAPS = {
  /** Sections, questions, groups, categories: the top-level list of a guide.
   *  Tighter than the validator's 50 on purpose: forty tabs is already a guide
   *  that should have been two. */
  groups: 40,
  /** Checklist items, answer options, cue blocks, mistakes: a list inside one. */
  entries: CONTENT_LIMITS.list,
  /** Scoring tiers. Tighter on purpose: a dozen verdicts is plenty. */
  tiers: 12,
  /** Reference table shape. Both tighter on purpose: a table wider than a dozen
   *  columns stopped fitting a phone long ago. */
  columns: 12,
  rows: 200,
  /** A heading, a label, a table cell. */
  short: CONTENT_LIMITS.label,
  /** A paragraph of coaching copy. */
  long: CONTENT_LIMITS.text,
  /** A question, and the sentence under a tier: the validator measures the two
   *  the same way, so one number covers both. */
  prompt: CONTENT_LIMITS.prompt,
  /** Points on one answer. Whole numbers. */
  points: CONTENT_LIMITS.points,
  /** The most a whole quiz can total, which is what a TIER ceiling is measured
   *  against rather than one answer's worth. The validator's own number for it,
   *  arrived at the same way. */
  totalPoints: CONTENT_LIMITS.list * CONTENT_LIMITS.points,
} as const

// ── Immutable list edits ─────────────────────────────────────────────────────
//
// Every editor holds its value in the panel's state and hands back a whole new
// object, so these return new arrays rather than mutating. Moving past either
// end returns the list unchanged instead of throwing: the arrow is disabled
// there anyway, and a keyboard repeat should not be able to lose a row.

export function moveAt<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  const [row] = next.splice(index, 1)
  next.splice(to, 0, row)
  return next
}

export function dropAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index)
}

export function putAt<T>(list: T[], index: number, value: T): T[] {
  return list.map((v, i) => (i === index ? value : v))
}

/** A whole number from a box, clamped, for the points and percent fields. An
 *  empty box reads as 0 rather than NaN, which is what a half-typed "-" is. */
export function wholeNumber(text: string, min: number, max: number): number {
  const n = parseInt(text, 10)
  if (!Number.isFinite(n)) return min > 0 ? min : 0
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

// ── Chrome ───────────────────────────────────────────────────────────────────

const cellBase: CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '.45rem .55rem',
  borderRadius: '.2rem',
  fontSize: '.78rem',
  lineHeight: 1.5,
  textAlign: 'left',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

export function cellStyle(disabled: boolean, extra?: CSSProperties): CSSProperties {
  return {
    ...cellBase,
    color: disabled ? 'var(--text-3)' : 'var(--text)',
    cursor: disabled ? 'default' : 'text',
    ...extra,
  }
}

export const ghostBtn: CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--text-3)',
  fontSize: '.62rem',
  fontWeight: 700,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  padding: '.5rem .9rem',
  borderRadius: '.25rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

export function iconBtn(enabled: boolean): CSSProperties {
  return {
    background: 'none',
    border: '1px solid var(--border)',
    color: enabled ? 'var(--text-3)' : 'var(--text-4)',
    width: '1.75rem',
    height: '1.75rem',
    lineHeight: 1,
    fontSize: '.75rem',
    borderRadius: '.2rem',
    cursor: enabled ? 'pointer' : 'default',
    fontFamily: 'inherit',
    padding: 0,
    flexShrink: 0,
  }
}

export const microLabel: CSSProperties = {
  color: 'var(--text)',
  fontSize: '.65rem',
  fontWeight: 900,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
}

export const headCell: CSSProperties = {
  color: 'var(--text-4)',
  fontSize: '.58rem',
  fontWeight: 700,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
}

export function Hint({ children }: { children: ReactNode }) {
  return <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.55 }}>{children}</p>
}

/** One block of the editor: a titled card, the shape the calculator settings
 *  panel uses for a section of related boxes. */
export function Card({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: '.25rem', padding: '1rem 1.1rem',
    }}>
      <p style={{ ...microLabel, marginBottom: hint ? '.2rem' : '.75rem' }}>{label}</p>
      {hint && <div style={{ marginBottom: '.75rem' }}><Hint>{hint}</Hint></div>}
      {children}
    </div>
  )
}

/** A card nested inside a card: one checklist section, one quiz question. */
export function Nested({ children }: { children: ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: '.25rem', padding: '.8rem .9rem',
      display: 'flex', flexDirection: 'column', gap: '.6rem',
    }}>
      {children}
    </div>
  )
}

/**
 * Up, down and remove for one row of a list.
 *
 * `what` goes into the aria-label, so a screen reader hears "Move section 2 up"
 * rather than three unlabelled arrows repeated forty times down the page.
 */
export function RowTools({
  index, count, what, disabled, onMove, onRemove,
}: {
  index: number
  count: number
  what: string
  disabled?: boolean
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const upOk = !disabled && index > 0
  const downOk = !disabled && index < count - 1
  return (
    <div style={{ display: 'flex', gap: '.25rem', flexShrink: 0 }}>
      <button type="button" onClick={() => onMove(-1)} disabled={!upOk}
        aria-label={`Move ${what} up`} title="Move up" style={iconBtn(upOk)}>↑</button>
      <button type="button" onClick={() => onMove(1)} disabled={!downOk}
        aria-label={`Move ${what} down`} title="Move down" style={iconBtn(downOk)}>↓</button>
      <button type="button" onClick={onRemove} disabled={disabled}
        aria-label={`Remove ${what}`} title="Remove" style={iconBtn(!disabled)}>×</button>
    </div>
  )
}

/**
 * The button at the bottom of a list.
 *
 * `full` is the cap being reached, and it disables the button and says so
 * instead of hiding it, because a control that vanishes reads as a bug.
 */
export function AddBtn({
  onClick, disabled, full, children,
}: {
  onClick: () => void
  disabled?: boolean
  full?: boolean
  children: ReactNode
}) {
  const off = disabled || full
  return (
    <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={onClick}
        disabled={off}
        style={{ ...ghostBtn, opacity: off ? 0.5 : 1, cursor: off ? 'default' : 'pointer' }}
      >
        {children}
      </button>
      {full && <span style={{ color: 'var(--text-4)', fontSize: '.68rem' }}>That is as many as one guide holds.</span>}
    </div>
  )
}

/** A one-line box with its label above it. */
export function TextBox({
  label, value, onChange, disabled, placeholder, maxLength = CAPS.short, hideLabel,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  placeholder?: string
  maxLength?: number
  /** The label becomes the aria-label only, for a row whose column heading
   *  already says what the box is. */
  hideLabel?: boolean
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {!hideLabel && <label className="field-label" style={{ fontSize: '.58rem', marginBottom: '.3rem' }}>{label}</label>}
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        onChange={e => onChange(e.target.value)}
        style={cellStyle(!!disabled)}
      />
    </div>
  )
}

/** A box for a paragraph. */
export function AreaBox({
  label, value, onChange, disabled, placeholder, rows = 3, maxLength = CAPS.long, hideLabel,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  placeholder?: string
  rows?: number
  maxLength?: number
  hideLabel?: boolean
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {!hideLabel && <label className="field-label" style={{ fontSize: '.58rem', marginBottom: '.3rem' }}>{label}</label>}
      <textarea
        value={value}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        onChange={e => onChange(e.target.value)}
        style={cellStyle(!!disabled, { resize: 'vertical' })}
      />
    </div>
  )
}

/** A whole-number box: points, a maximum, a percentage. */
export function NumberBox({
  label, value, onChange, disabled, min = 0, max = CAPS.points, width = '5.5rem', hideLabel, suffix,
}: {
  label: string
  value: number
  onChange: (next: number) => void
  disabled?: boolean
  min?: number
  max?: number
  width?: string
  hideLabel?: boolean
  suffix?: string
}) {
  return (
    <div style={{ width, flexShrink: 0 }}>
      {!hideLabel && <label className="field-label" style={{ fontSize: '.58rem', marginBottom: '.3rem' }}>{label}</label>}
      <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
        <input
          type="number"
          step={1}
          min={min}
          max={max}
          value={String(value)}
          disabled={disabled}
          aria-label={label}
          onChange={e => onChange(wholeNumber(e.target.value, min, max))}
          style={cellStyle(!!disabled, { textAlign: 'right' })}
        />
        {suffix && <span style={{ color: 'var(--text-4)', fontSize: '.7rem' }}>{suffix}</span>}
      </div>
    </div>
  )
}
