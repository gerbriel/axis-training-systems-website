/**
 * Shared presentation for the Settings sub-panels.
 *
 * Inline styles + CSS vars + the Axis accent, matching AdminSettings.tsx and
 * BookingPolicyPanel.tsx so a person cannot tell which agent built which tab.
 * Nothing here talks to a backend — these are dumb pieces the panels compose.
 */
import { useState, useCallback } from 'react'
import type { ReactNode, CSSProperties } from 'react'

export const ACCENT = '#272C84'

// ── A page section: title, one line of context, then the body ───────────────

export function SettingsSection({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ marginBottom: '2.5rem' }}>
      <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.5rem' }}>
        {title}
      </h2>
      {intro && (
        <p style={{ color: 'var(--text-2)', fontSize: '.85rem', lineHeight: 1.6, marginBottom: '1.5rem', maxWidth: 620 }}>
          {intro}
        </p>
      )}
      {children}
    </section>
  )
}

export function SubHead({ children }: { children: ReactNode }) {
  return (
    <h3 style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.75rem' }}>
      {children}
    </h3>
  )
}

// ── Labelled field ──────────────────────────────────────────────────────────

export function Field({ label, hint, children, style }: { label: string; hint?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={style}>
      <label className="field-label">{label}</label>
      {children}
      {hint && <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.5, marginTop: '.4rem' }}>{hint}</p>}
    </div>
  )
}

// ── Toggle switch ───────────────────────────────────────────────────────────

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      style={{
        flexShrink: 0, width: 46, height: 26, borderRadius: 999, padding: 0, position: 'relative',
        background: on ? ACCENT : 'var(--surface-2)',
        border: `1px solid ${on ? ACCENT : 'var(--border-mid)'}`,
        cursor: disabled ? 'default' : 'pointer', transition: 'background .15s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 22 : 2, width: 20, height: 20, borderRadius: '50%',
        background: on ? '#fff' : 'var(--text-4)', transition: 'left .15s',
      }} />
    </button>
  )
}

// ── Save button ─────────────────────────────────────────────────────────────

export function SaveButton({ saving, onClick, children = 'Save', disabled }: { saving: boolean; onClick: () => void; children?: ReactNode; disabled?: boolean }) {
  const off = saving || disabled
  return (
    <button
      onClick={onClick}
      disabled={off}
      style={{
        background: off ? 'var(--border)' : ACCENT, border: 'none', color: off ? 'var(--text-3)' : '#fff',
        fontWeight: 900, fontSize: '.7rem', letterSpacing: '.15em', textTransform: 'uppercase',
        padding: '.8rem 1.8rem', borderRadius: '.25rem', cursor: off ? 'default' : 'pointer', fontFamily: 'inherit',
      }}
    >
      {saving ? 'Saving…' : children}
    </button>
  )
}

// ── Flash message ───────────────────────────────────────────────────────────

export interface FlashState { text: string; ok: boolean }

export function Flash({ flash }: { flash: FlashState | null }) {
  if (!flash) return null
  return (
    <div style={{
      padding: '.75rem 1rem', borderRadius: '.25rem', fontSize: '.8rem', marginBottom: '1rem',
      background: flash.ok ? 'rgba(34,197,94,.08)' : 'rgba(200,16,46,.08)',
      border: `1px solid ${flash.ok ? 'rgba(34,197,94,.35)' : 'rgba(200,16,46,.35)'}`,
      color: flash.ok ? '#22c55e' : '#f87171',
    }}>
      {flash.text}
    </div>
  )
}

/** A flash that clears itself after a beat. */
export function useFlash() {
  const [flash, setFlash] = useState<FlashState | null>(null)
  const show = useCallback((text: string, ok = true) => {
    setFlash({ text, ok })
    if (ok) window.setTimeout(() => setFlash(f => (f && f.text === text ? null : f)), 2600)
  }, [])
  return { flash, show, clear: () => setFlash(null) }
}

export function Loading() {
  return (
    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>
      Loading…
    </div>
  )
}

// ── Common cell/card chrome ─────────────────────────────────────────────────

export const cardStyle: CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '1.1rem 1.25rem',
}

export const pageStyle: CSSProperties = { padding: '2rem', maxWidth: 760 }
