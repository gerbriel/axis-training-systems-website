import { useId } from 'react'
import type { CSSProperties } from 'react'
import { safeUrl } from '../../utils/sanitize'
import type { BlockKind } from '../../lib/siteContent'
import type { MediaFolder } from '../../lib/mediaUpload'
import PhotoUpload from '../dashboard/PhotoUpload'
import { fieldStyle, microLabel, humanize, ACCENT } from './kit'

/**
 * ValueEditor.tsx
 *
 * One editor for all six block kinds, driven by the SHIPPED DEFAULT rather than
 * by a form written per block.
 *
 * The default is the schema. A block's default value already says everything a
 * form needs to know: a string is a field, an array of four strings is four
 * fields, an array of objects is four cards with the same fields in each. So
 * this walks the default and the draft in lockstep and renders a control per
 * leaf, which means a block added next year gets an editor for free and no
 * block can be given a shape the code does not already handle. `kind` only
 * tunes presentation — one line or several, a photo, a link.
 *
 * AN OVERRIDE REPLACES TEXT, NEVER SHAPE. There is no add-a-row and no
 * remove-a-row here, and that is deliberate rather than unfinished: the fields
 * come from the default, so a list keeps its length, an object keeps its keys,
 * and the display ordinals that double as React keys on the live page ('01',
 * '02') can never be duplicated or renumbered by an owner. Adding a row means
 * ordinals, reordering and per-row deletion, and that is a separate piece of
 * work with its own decisions.
 *
 * NOTHING HERE RENDERS STORED TEXT AS MARKUP. Values go into inputs and into
 * React text nodes; a URL goes through safeUrl before it is allowed near an
 * href or a src, here and again at the render site.
 */

/**
 * The longest string the site ships is a service description around 340
 * characters, so this is generous rather than tight. It exists so a form cannot
 * accept something the validator will refuse; the validator in siteContent.ts
 * and the database are the ones that decide.
 */
export const FIELD_MAX = 2000

/**
 * Marketing photos live beside the other site media, in their own folder.
 *
 * MediaFolder does not name this one yet: the three folders in mediaUpload.ts
 * are testimonials, blog and coaches. A folder is a path prefix inside one
 * bucket and the bucket's policies gate the whole bucket on is_axis_staff(), so
 * the upload works today; when the type learns the fourth name this cast comes
 * out and nothing else changes.
 */
const MARKETING_FOLDER = 'marketing' as unknown as MediaFolder

type Control = 'line' | 'area' | 'url' | 'image'

const URL_KEY = /^(href|url|link|to)$/i
const IMAGE_KEY = /(^|_)(src|image|img|photo|picture|avatar|cover|logo)(_|$)/i

function controlFor(kind: BlockKind, key: string, def: string): Control {
  if (IMAGE_KEY.test(key)) return 'image'
  if (URL_KEY.test(key)) return 'url'
  if (kind === 'image' && !key) return 'image'
  if (kind === 'link' && !key) return 'url'
  if (kind === 'paragraph') return 'area'
  if (def.includes('\n') || def.length > 90) return 'area'
  return 'line'
}

/** A copy of `source` with one key replaced. The rest is carried, never rebuilt. */
function withKey(source: unknown, key: string, next: unknown): Record<string, unknown> {
  const base = (source && typeof source === 'object' && !Array.isArray(source))
    ? (source as Record<string, unknown>)
    : {}
  return { ...base, [key]: next }
}

/** A copy of `source` with one index replaced, at the default's length. */
function withIndex(source: unknown, index: number, next: unknown, length: number): unknown[] {
  const base = Array.isArray(source) ? source.slice() : []
  while (base.length < length) base.push(undefined)
  base[index] = next
  return base.slice(0, length)
}

export interface ValueEditorProps {
  kind: BlockKind
  /** The shipped value at this node. It decides the shape and every label. */
  def: unknown
  /** The draft at this node. */
  value: unknown
  onChange: (next: unknown) => void
  disabled?: boolean
  isDemo?: boolean
  /** From BlockDef.fields: the object keys an owner may touch. Empty means all. */
  fields?: string[]
  /** The key that led here, for the label and the control choice. */
  nodeKey?: string
  /** Set by a list, which labels its rows by position rather than by key. */
  labelOverride?: string
  depth?: number
}

/** 'Taglines' → 'Tagline'. Crude on purpose: it labels a row, it does not parse English. */
function singular(word: string): string {
  if (/(ss|us|is)$/i.test(word)) return word
  return word.endsWith('s') ? word.slice(0, -1) : word
}

export default function ValueEditor(props: ValueEditorProps) {
  const { kind, def, value, onChange, disabled, isDemo, fields, nodeKey = '', labelOverride, depth = 0 } = props

  // ── A leaf ────────────────────────────────────────────────────────────────
  if (typeof def === 'string') {
    const current = typeof value === 'string' ? value : def
    return (
      <Leaf
        control={controlFor(kind, nodeKey, def)}
        label={labelOverride ?? (nodeKey ? humanize(nodeKey) : 'Text')}
        value={current}
        shipped={def}
        onChange={onChange}
        disabled={disabled}
        isDemo={isDemo}
      />
    )
  }

  // ── A list ────────────────────────────────────────────────────────────────
  if (Array.isArray(def)) {
    const base = singular(humanize(nodeKey || 'Item'))
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        {def.map((childDef, index) => {
          const childValue = Array.isArray(value) ? value[index] : undefined
          const simple = typeof childDef === 'string'
          // Row numbers are DERIVED FROM POSITION and never stored. A hand typed
          // ordinal is how two rows end up sharing a React key on the live page.
          const rowLabel = `${base} ${index + 1}`
          const child = (
            <ValueEditor
              {...props}
              def={childDef}
              value={childValue}
              nodeKey={simple ? nodeKey : ''}
              labelOverride={simple ? rowLabel : undefined}
              depth={depth + 1}
              onChange={next => onChange(withIndex(value, index, next, def.length))}
            />
          )
          if (simple) return <div key={index}>{child}</div>
          return (
            <div
              key={index}
              style={{
                border: '1px solid var(--border)', borderRadius: '.25rem',
                padding: '.65rem', display: 'flex', flexDirection: 'column', gap: '.55rem',
              }}
            >
              <span style={{ ...microLabel, color: 'var(--text-4)' }}>{rowLabel}</span>
              {child}
            </div>
          )
        })}
      </div>
    )
  }

  // ── A group of named fields ───────────────────────────────────────────────
  if (def && typeof def === 'object') {
    // `fields` names what an owner may touch on the block and on each of its
    // rows. It stops there: a field list meant for a service card should not
    // silently filter something nested two levels below it.
    const filtering = !!fields && fields.length > 0 && depth <= 1
    const entries = Object.entries(def as Record<string, unknown>)
      .filter(([key]) => !filtering || (fields as string[]).includes(key))
    if (entries.length === 0) {
      return <p style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>Nothing on this one is editable here.</p>
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.7rem' }}>
        {entries.map(([key, childDef]) => (
          <ValueEditor
            {...props}
            key={key}
            def={childDef}
            value={(value && typeof value === 'object' && !Array.isArray(value))
              ? (value as Record<string, unknown>)[key]
              : undefined}
            nodeKey={key}
            labelOverride={undefined}
            depth={depth + 1}
            onChange={next => onChange(withKey(value, key, next))}
          />
        ))}
      </div>
    )
  }

  // ── Anything else ─────────────────────────────────────────────────────────
  // A number, a boolean, a null. Nothing on this site's public copy is one of
  // those today, and inventing a control for a shape the registry does not use
  // would be guessing at what it means.
  return (
    <p style={{ color: 'var(--text-4)', fontSize: '.72rem', lineHeight: 1.5 }}>
      {nodeKey ? `${humanize(nodeKey)} is ` : 'This is '}
      not text, so it is set in the site&rsquo;s code rather than here.
    </p>
  )
}

// ── The leaf controls ───────────────────────────────────────────────────────

const labelStyle: CSSProperties = { ...microLabel, color: 'var(--text-3)', display: 'block', marginBottom: '.3rem' }

function Leaf({ control, label, value, shipped, onChange, disabled, isDemo }: {
  control: Control
  label: string
  value: string
  shipped: string
  onChange: (next: string) => void
  disabled?: boolean
  isDemo?: boolean
}) {
  const id = useId()
  const changed = value !== shipped
  // The house rule bans em dashes in anything a visitor reads. Said here, while
  // it is being typed, rather than as a refusal after Save.
  const hasEmDash = value.includes('—')

  if (control === 'image') {
    return (
      <div>
        <PhotoUpload
          value={value}
          onChange={onChange}
          folder={MARKETING_FOLDER}
          label={label}
          hint="Wide photos read best here. JPG, PNG or WebP."
          shape="wide"
          isDemo={isDemo}
          disabled={disabled}
        />
        {changed && <Changed />}
      </div>
    )
  }

  if (control === 'url') {
    const safe = safeUrl(value)
    return (
      <div>
        <label htmlFor={id} style={labelStyle}>{label}</label>
        <input
          id={id}
          className="field"
          style={fieldStyle}
          value={value}
          maxLength={FIELD_MAX}
          disabled={disabled}
          spellCheck={false}
          onChange={e => onChange(e.target.value)}
        />
        <p style={{ color: safe ? 'var(--text-4)' : '#c8102e', fontSize: '.68rem', marginTop: '.25rem', lineHeight: 1.45 }}>
          {value.trim() === ''
            ? 'Empty. This link will go nowhere.'
            : safe
              ? `Goes to ${safe}`
              : 'That is not an address this site will link to. Use a page on this site, an anchor like #services, or a full https:// address.'}
        </p>
        {changed && <Changed />}
      </div>
    )
  }

  if (control === 'area') {
    return (
      <div>
        <label htmlFor={id} style={labelStyle}>{label}</label>
        <textarea
          id={id}
          className="field"
          style={{ ...fieldStyle, minHeight: '5.5rem', resize: 'vertical' }}
          value={value}
          maxLength={FIELD_MAX}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
        {hasEmDash && <DashNote />}
        {changed && <Changed />}
      </div>
    )
  }

  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <input
        id={id}
        className="field"
        style={fieldStyle}
        value={value}
        maxLength={FIELD_MAX}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
      />
      {hasEmDash && <DashNote />}
      {changed && <Changed />}
    </div>
  )
}

function DashNote() {
  return (
    <p style={{ color: 'var(--text-3)', fontSize: '.68rem', marginTop: '.25rem', lineHeight: 1.45 }}>
      Use a period, a comma or a colon instead of a long dash.
    </p>
  )
}

function Changed() {
  return (
    <p style={{ color: ACCENT, fontSize: '.65rem', marginTop: '.25rem', fontWeight: 700 }}>
      Different from the shipped copy.
    </p>
  )
}
