import { useEffect } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ACCENT, BTN, MICRO, initials } from './messagingUi'

/**
 * The small parts the messaging panes share: a pill, an avatar, the modal
 * frame, and the outage block. Components only, so the file stays a single
 * kind of export.
 */

export function Pill({ label, tone = 'muted' }: { label: string; tone?: 'accent' | 'muted' }) {
  const accent = tone === 'accent'
  return (
    <span
      style={{
        background: accent ? 'rgba(39,44,132,.18)' : 'var(--surface-2)',
        border: `1px solid ${accent ? 'rgba(39,44,132,.55)' : 'var(--border)'}`,
        color: accent ? 'var(--text)' : 'var(--text-3)',
        fontSize: '.5rem',
        fontWeight: 900,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        padding: '.15rem .45rem',
        borderRadius: '.2rem',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        lineHeight: 1.5,
      }}
    >
      {label}
    </span>
  )
}

export function Avatar({ name, url, size = 38 }: { name: string; url?: string | null; size?: number }) {
  const shared: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    objectFit: 'cover',
  }
  if (url) return <img src={url} alt="" style={shared} />
  return (
    <span
      aria-hidden="true"
      style={{
        ...shared,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(39,44,132,.22)',
        border: '1px solid rgba(39,44,132,.5)',
        color: 'var(--text-2)',
        fontSize: size >= 34 ? '.7rem' : '.6rem',
        fontWeight: 900,
        letterSpacing: '.05em',
      }}
    >
      {initials(name)}
    </span>
  )
}

export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p style={{ color: '#c8102e', fontSize: '.78rem', lineHeight: 1.6, margin: 0 }} role="alert">
      {children}
    </p>
  )
}

export function OutageBlock({ line, onRetry }: { line: string; onRetry: () => void }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--surface-2)',
        borderRadius: '.25rem',
        padding: '1.5rem',
        textAlign: 'center',
        margin: '1rem',
      }}
    >
      <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>{line}</p>
      <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>
        That is on our side. Nothing was lost.
      </p>
      <button
        onClick={onRetry}
        style={{
          ...BTN,
          background: 'none',
          border: 'none',
          borderBottom: '1px solid var(--text)',
          color: 'var(--text)',
          padding: '0 0 .25rem',
          borderRadius: 0,
        }}
      >
        Try again
      </button>
    </div>
  )
}

export function SolidButton({
  label,
  onClick,
  disabled = false,
  type = 'button',
  wide = false,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  wide?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...BTN,
        background: disabled ? 'var(--border)' : ACCENT,
        border: 'none',
        color: disabled ? 'var(--text-3)' : '#fff',
        padding: '.65rem 1.1rem',
        cursor: disabled ? 'default' : 'pointer',
        width: wide ? '100%' : undefined,
        minHeight: '2.4rem',
      }}
    >
      {label}
    </button>
  )
}

export function GhostButton({
  label,
  onClick,
  disabled = false,
  tone = 'neutral',
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'neutral' | 'danger'
}) {
  const danger = tone === 'danger'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...BTN,
        background: 'none',
        border: `1px solid ${danger ? 'rgba(200,16,46,.5)' : 'var(--surface-2)'}`,
        color: danger ? '#c8102e' : 'var(--text-3)',
        fontWeight: 700,
        padding: '.6rem .9rem',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        minHeight: '2.4rem',
      }}
    >
      {label}
    </button>
  )
}

/**
 * A centred card on desktop, a full screen on a phone. Escape and the backdrop
 * both close it, because a picker that traps someone is worse than no picker.
 */
export function ModalShell({
  title,
  onClose,
  isMobile,
  children,
}: {
  title: string
  onClose: () => void
  isMobile: boolean
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'var(--modal-overlay)',
        display: 'flex',
        alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : '1.5rem',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={event => event.stopPropagation()}
        style={{
          background: 'var(--bg)',
          border: isMobile ? 'none' : '1px solid var(--border)',
          borderRadius: isMobile ? 0 : '.25rem',
          width: isMobile ? '100%' : 'min(480px, 100%)',
          maxHeight: isMobile ? '100%' : 'min(680px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            padding: '1rem 1.1rem',
            borderBottom: '1px solid var(--surface)',
            flexShrink: 0,
          }}
        >
          <span style={{ ...MICRO, color: 'var(--text)' }}>{title}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-3)',
              fontSize: '1.1rem',
              lineHeight: 1,
              cursor: 'pointer',
              fontFamily: 'inherit',
              padding: '.4rem .5rem',
              minHeight: '2.2rem',
            }}
          >
            &times;
          </button>
        </div>
        <div
          style={{
            padding: '1.1rem',
            overflowY: 'auto',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            paddingBottom: isMobile ? 'calc(1.1rem + env(safe-area-inset-bottom))' : '1.1rem',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
