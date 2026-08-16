import type { CSSProperties, ReactNode } from 'react'

/**
 * kit.tsx
 *
 * The five inline styles and four small controls the bar and the panel share.
 *
 * Same tokens and the same shapes as the admin panels, because the person using
 * this has seen those: ACCENT for the one primary action, DANGER for the one
 * that cannot be taken back, ghost buttons for everything else, and the theme
 * variables so the whole thing follows the site's light and dark without a
 * second palette. Nothing here is a new design language.
 */

export const ACCENT = '#272C84'
export const DANGER = '#c8102e'
export const GREEN = '#22c55e'

/** Above the bar and under any modal. ThemeToggle and the demo button own 9999. */
export const BAR_Z = 9990
export const PANEL_Z = 9992
/** The frame that says the mode is on. Under both, and never in the way. */
export const FRAME_Z = 9985

export const microLabel: CSSProperties = {
  color: 'var(--text)', fontSize: '.55rem', fontWeight: 900,
  letterSpacing: '.28em', textTransform: 'uppercase',
}

export const btn = (bg: string, fg: string): CSSProperties => ({
  background: bg, border: 'none', color: fg, fontWeight: 900, fontSize: '.6rem',
  letterSpacing: '.12em', textTransform: 'uppercase', padding: '.5rem .9rem',
  minHeight: '2.2rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
})

export const btnGhost = (color: string): CSSProperties => ({
  background: 'transparent', border: `1px solid ${color}`, color,
  fontWeight: 700, fontSize: '.58rem', letterSpacing: '.12em', textTransform: 'uppercase',
  padding: '.5rem .9rem', minHeight: '2.2rem', borderRadius: '.25rem', cursor: 'pointer',
  fontFamily: 'inherit',
})

/** A button that reads as a sentence, for the quiet non-destructive actions. */
export const btnText = (color: string): CSSProperties => ({
  background: 'none', border: 'none', color, padding: 0,
  font: 'inherit', fontSize: '.72rem', textDecoration: 'underline',
  textUnderlineOffset: '2px', cursor: 'pointer',
})

export const chip = (color: string): CSSProperties => ({
  color, fontSize: '.52rem', fontWeight: 700, letterSpacing: '.1em',
  textTransform: 'uppercase', border: `1px solid ${color}55`,
  padding: '.1rem .35rem', borderRadius: '.2rem', whiteSpace: 'nowrap',
})

export const fieldStyle: CSSProperties = {
  width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--text)', padding: '.5rem .65rem', borderRadius: '.25rem',
  fontSize: '.8rem', fontFamily: 'inherit', lineHeight: 1.5, outline: 'none',
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.55, margin: 0 }}>{children}</p>
  )
}

/**
 * A refusal, in the panel that caused it.
 *
 * role="alert" because the person pressed Save and is looking at the button,
 * not at the top of a page they may be a screen and a half below.
 */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)',
        borderRadius: '.25rem', padding: '.5rem .65rem',
      }}
    >
      <span style={{ color: DANGER, fontSize: '.75rem', lineHeight: 1.5 }}>{children}</span>
    </div>
  )
}

export function FlashNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      style={{
        background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.35)',
        borderRadius: '.25rem', padding: '.5rem .65rem',
      }}
    >
      <span style={{ color: GREEN, fontSize: '.75rem' }}>{children}</span>
    </div>
  )
}

/**
 * Two block values that say the same thing.
 *
 * Defined once because two screens ask the same question and a disagreement
 * between them is a bug nobody would think to look for: the bar counts how many
 * blocks on this page differ from the shipped copy, and the panel decides
 * whether to offer to put the shipped copy back. Serialized rather than walked,
 * which is exact for the shapes the registry holds (strings, arrays of strings,
 * arrays of flat records) because their keys are written in one order by one
 * validator. A value that cannot be serialized is not equal to anything, which
 * is the safe answer: it offers a restore that was not needed rather than
 * hiding one that was.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** 'titleTop' and 'role_title' both become 'Title top'. */
export function humanize(key: string): string {
  const spaced = key
    .replace(/[_.-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  if (!spaced) return key
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

/** One line of a value, for a list row. Never rendered as markup. */
export function preview(value: unknown, max = 64): string {
  if (typeof value === 'string') {
    const flat = value.replace(/\s+/g, ' ').trim()
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
  }
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (value && typeof value === 'object') return 'Several fields'
  if (value == null) return ''
  return String(value)
}
