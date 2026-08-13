import type { ReactNode, CSSProperties } from 'react'
import { href } from '../../utils/nav'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

export const ACCENT = '#272C84'

/**
 * The frame every auth screen sits in.
 *
 * Deliberately not the site chrome: sign-in, the pending screen and the invite
 * landing are all single-decision pages, and a nav bar full of somewhere else to
 * go is the wrong furniture for one.
 */
export function AuthShell({ eyebrow, title, children, footer }: {
  eyebrow?: string
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ borderBottom: '1px solid var(--surface)', padding: '0 1.25rem', display: 'flex', alignItems: 'center', height: '3.5rem' }}>
        <a href={href('/')} style={{ display: 'flex', alignItems: 'center' }}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 22, filter: 'var(--logo-filter)' }} />
        </a>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3rem 1.25rem 4rem' }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          {eyebrow && (
            <p style={{ color: ACCENT, fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.6rem' }}>
              {eyebrow}
            </p>
          )}
          <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.6rem,6vw,2.2rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: 1, marginBottom: '1.75rem' }}>
            {title}
          </h1>
          {children}
          {footer && (
            <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--surface-2)' }}>
              {footer}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export function Notice({ tone, children }: { tone: 'error' | 'ok' | 'info'; children: ReactNode }) {
  const palette = {
    error: { bg: 'rgba(200,16,46,.08)', border: 'rgba(200,16,46,.35)', fg: '#c8102e' },
    ok:    { bg: 'rgba(34,197,94,.08)', border: 'rgba(34,197,94,.35)', fg: '#22c55e' },
    info:  { bg: 'var(--surface)',      border: 'var(--surface-2)',    fg: 'var(--text-2)' },
  }[tone]

  return (
    <div role={tone === 'error' ? 'alert' : undefined} style={{ background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: '.25rem', padding: '.8rem 1rem', marginBottom: '1.25rem' }}>
      <span style={{ color: palette.fg, fontSize: '.82rem', lineHeight: 1.6, display: 'block' }}>{children}</span>
    </div>
  )
}

export function primaryButton(disabled = false): CSSProperties {
  return {
    width: '100%',
    background: disabled ? 'var(--border)' : ACCENT,
    border: 'none',
    color: disabled ? 'var(--text-3)' : '#fff',
    fontWeight: 900, fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase',
    padding: '.9rem 1.5rem', borderRadius: '.25rem',
    cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
  }
}

export function linkButton(): CSSProperties {
  return {
    background: 'none', border: 'none', padding: 0,
    color: 'var(--text-3)', fontSize: '.78rem', fontFamily: 'inherit',
    cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3,
  }
}

/**
 * Google's mark, inline.
 *
 * Not a remote image: the brand guidelines require the four-colour G, and
 * hotlinking it from Google's CDN puts a third-party request on the sign-in
 * page of an app whose whole point is that you are about to hand it an identity.
 */
export function GoogleButton({ onClick, disabled, label = 'Continue with Google' }: {
  onClick: () => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.7rem',
        background: 'var(--surface)', border: '1px solid var(--border-mid)', borderRadius: '.25rem',
        padding: '.85rem 1.5rem', cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
        color: 'var(--text)', fontSize: '.82rem', fontWeight: 700,
        opacity: disabled ? .6 : 1,
      }}
    >
      <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden focusable="false">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      {label}
    </button>
  )
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.9rem', margin: '1.5rem 0' }}>
      <span style={{ flex: 1, height: 1, background: 'var(--surface-2)' }} />
      <span style={{ color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>
        {children}
      </span>
      <span style={{ flex: 1, height: 1, background: 'var(--surface-2)' }} />
    </div>
  )
}
