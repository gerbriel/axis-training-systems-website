import { useId, useRef, useState } from 'react'
import { uploadSiteImage, ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '../../lib/mediaUpload'
import type { MediaFolder } from '../../lib/mediaUpload'

const ACCENT = '#272C84'

export interface PhotoUploadProps {
  /** The URL in use right now. '' means there is no photo. */
  value: string
  onChange: (url: string) => void
  folder: MediaFolder
  /** The uppercase micro-label above the control, e.g. 'Athlete photo'. */
  label: string
  hint?: string
  /** circle: a 72px round face. wide: a 16/9 banner. */
  shape?: 'circle' | 'wide'
  isDemo?: boolean
  disabled?: boolean
}

/**
 * The one photo field, shared by the testimonial editors, the coach profile
 * manager and the blog.
 *
 * WHAT IT REPLACED, because the shape follows from it. Every one of those
 * screens had a text input labelled "Photo URL", which meant the product's real
 * instruction to a coach was "host this somewhere else first". This component is
 * the upload path plus that same text input, kept, behind a toggle: pasting a
 * URL is still the right answer for an image that is already hosted, and taking
 * it away would have been a regression for the four hosts the CSP has always
 * allowed. The toggle starts collapsed because it is now the uncommon case.
 *
 * IT ALWAYS SHOWS THE PHOTO IN USE. The old inputs showed a URL, which is not
 * the same thing: a coach editing a testimonial could not tell whether the
 * string in the box was the picture they meant. The preview is the value, at the
 * shape it will be rendered at, or a placeholder saying there is none. A URL
 * that will not load falls back to the placeholder rather than a broken-image
 * glyph, because "no photo" and "a photo that 404s" need the same next action.
 *
 * THE VALUE IS A URL AND THE PARENT OWNS IT. Nothing here holds a File or a
 * pending upload: `uploadSiteImage` finishes before `onChange` fires, so a form
 * that saves the moment its state changes cannot save half an upload. In demo
 * mode that URL is a local `blob:` (see mediaUpload), which renders because the
 * CSP allows blob and never reaches the database because `safeUrl()` drops it on
 * the live write path.
 *
 * Styling is inline against the theme tokens, which is the house idiom in the
 * dashboard panels this drops into.
 */
export default function PhotoUpload({
  value,
  onChange,
  folder,
  label,
  hint,
  shape = 'circle',
  isDemo = false,
  disabled = false,
}: PhotoUploadProps) {
  const urlId = useId()
  const fileRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUrl, setShowUrl] = useState(false)
  // The URL that failed to load, so a later value gets a fresh chance without an
  // effect to reset a boolean.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)

  const has = value.trim().length > 0
  const showsImage = has && brokenUrl !== value
  const locked = disabled || busy

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Cleared so choosing the same file twice in a row still fires a change,
    // which is what happens after a Remove.
    e.target.value = ''
    if (!file) return

    setBusy(true)
    setError(null)
    const res = await uploadSiteImage(file, folder, isDemo)
    setBusy(false)

    if (!res.ok) { setError(res.message); return }
    setBrokenUrl(null)
    onChange(res.url)
  }

  const remove = () => {
    setError(null)
    setBrokenUrl(null)
    onChange('')
  }

  // The preview box: same border and background either way, different geometry.
  const box: React.CSSProperties = shape === 'circle'
    ? { width: 72, height: 72, borderRadius: '50%', flexShrink: 0 }
    : { width: '100%', maxWidth: 320, aspectRatio: '16 / 9', borderRadius: '.25rem' }

  const frame: React.CSSProperties = {
    ...box,
    background: 'var(--surface)',
    border: showsImage ? '1px solid var(--border)' : '1px dashed var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  }

  const btn = (primary: boolean): React.CSSProperties => ({
    background: primary ? (locked ? 'var(--border)' : ACCENT) : 'none',
    border: primary ? 'none' : '1px solid var(--border)',
    color: primary ? (locked ? 'var(--text-3)' : '#fff') : 'var(--text-3)',
    fontWeight: 900,
    fontSize: '.62rem',
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    padding: '.55rem 1rem',
    borderRadius: '.2rem',
    cursor: locked ? 'default' : 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  })

  return (
    <div>
      <span className="field-label" style={{ marginBottom: hint ? '.25rem' : '.5rem' }}>{label}</span>
      {hint && (
        <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.5, marginBottom: '.5rem' }}>{hint}</p>
      )}

      <div style={{
        display: 'flex',
        gap: '1rem',
        alignItems: shape === 'circle' ? 'center' : 'flex-start',
        flexDirection: shape === 'circle' ? 'row' : 'column',
      }}>
        <div style={frame}>
          {showsImage ? (
            <img
              src={value}
              alt=""
              onError={() => setBrokenUrl(value)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <span style={{ color: 'var(--text-4)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', textAlign: 'center', padding: '.25rem' }}>
              {has ? 'Broken' : 'No photo'}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            ref={fileRef}
            type="file"
            accept={ALLOWED_UPLOAD_TYPES.join(',')}
            onChange={e => { void pick(e) }}
            disabled={locked}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={locked}
            style={btn(true)}
          >
            {busy ? 'Uploading…' : has ? 'Replace' : 'Upload'}
          </button>

          {has && !busy && (
            <button type="button" onClick={remove} disabled={disabled} style={btn(false)}>
              Remove
            </button>
          )}
        </div>
      </div>

      {error && (
        <p style={{ color: '#c8102e', fontSize: '.72rem', lineHeight: 1.5, marginTop: '.5rem' }}>{error}</p>
      )}

      <div style={{ marginTop: '.6rem' }}>
        <button
          type="button"
          onClick={() => setShowUrl(v => !v)}
          style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '0 0 .2rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {showUrl ? 'Hide URL field' : 'Paste a URL instead'}
        </button>

        {showUrl && (
          <div style={{ marginTop: '.5rem' }}>
            <label className="field-label" htmlFor={urlId} style={{ fontSize: '.6rem' }}>Image URL</label>
            <input
              id={urlId}
              className="field"
              type="url"
              inputMode="url"
              maxLength={1000}
              disabled={disabled}
              value={value}
              onChange={e => { setBrokenUrl(null); onChange(e.target.value) }}
              placeholder="https://…"
            />
            <p style={{ color: 'var(--text-4)', fontSize: '.68rem', lineHeight: 1.5, marginTop: '.35rem' }}>
              For a picture that is already online. Uploading is easier for anything on your phone.
            </p>
          </div>
        )}
      </div>

      {isDemo && (
        <p style={{ color: 'var(--text-4)', fontSize: '.68rem', lineHeight: 1.5, marginTop: '.5rem' }}>
          Demo mode. A photo you pick here stays in this browser tab and is never uploaded.
        </p>
      )}

      {!isDemo && (
        <p style={{ color: 'var(--text-4)', fontSize: '.68rem', lineHeight: 1.5, marginTop: '.5rem' }}>
          JPG, PNG, or WebP, up to {Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.
        </p>
      )}
    </div>
  )
}
