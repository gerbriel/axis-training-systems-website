/**
 * The handful of styles the five guide views share.
 *
 * They came out of GuidesPage.tsx with the markup and are kept here rather than
 * copied into each view, because the cards sit one above the other on the same
 * page and a heading that drifts half a rem in one of them is visible.
 */

export const sectionHeading: React.CSSProperties = {
  color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.2em',
  textTransform: 'uppercase', marginBottom: '.875rem',
}

export const intro: React.CSSProperties = {
  color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.75, marginBottom: '1.5rem',
}

/** The band above a scored result: what tier you landed in and what to do. */
export const resultCard = (color: string): React.CSSProperties => ({
  background: 'var(--bg)', border: `1px solid ${color}33`, borderRadius: '.25rem',
  padding: '2rem', marginBottom: '1.5rem', textAlign: 'center',
})

export const ctaButton: React.CSSProperties = {
  display: 'inline-block', background: '#272C84', color: '#ffffff', fontWeight: 900,
  fontSize: '.7rem', letterSpacing: '.2em', textTransform: 'uppercase',
  padding: '.75rem 1.5rem', borderRadius: '.2rem', textDecoration: 'none',
}

export const resetButton: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)',
  fontSize: '.7rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
  padding: '.75rem 1.25rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit',
}

/** Green only for the top tier, the way both scored guides have always read it.
 *  A tier's colour is not stored: it is the tier's POSITION, so an owner who
 *  adds a fourth tier gets the new top one in green rather than a stale one. */
export function tierColor(index: number, total: number): string {
  return index === total - 1 ? '#22c55e' : 'var(--text)'
}

/** The three-step answer colouring both scored guides use: full marks green,
 *  nothing red, anything between it neutral. */
export function scoreColor(points: number, max: number): string {
  if (max > 0 && points >= max) return '#22c55e'
  return points > 0 ? 'var(--text)' : '#c8102e'
}

export function hoverIn(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = '#1a1f6b'
}

export function hoverOut(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = '#272C84'
}

export function outlineIn(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--text-dim)'
  e.currentTarget.style.color = 'var(--text-3)'
}

export function outlineOut(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--border)'
  e.currentTarget.style.color = 'var(--text-2)'
}
