import { useRef, useState } from 'react'
import { sanitizeText, safeUrl } from '../../utils/sanitize'
import {
  uploadResourceFile,
  humanFileSize,
  RESOURCE_FILE_ACCEPT,
  RESOURCE_FILE_MAX_MB,
  type ResourceAttachment,
} from '../../lib/resourceFiles'

/**
 * The files hanging off one resource row.
 *
 * Mounted by the guide editors and by the library panel, wherever a resource
 * can carry documents. The list it edits is `config.attachments`, and the public
 * page renders the same array as a set of download links.
 *
 * IT OWNS NOTHING. Every change is handed straight back through `onChange` and
 * the parent form holds the state, so a panel that saves on change cannot save
 * half an upload: `uploadResourceFile` finishes before the row is appended.
 *
 * REMOVING A ROW DOES NOT DELETE THE FILE, and that is the deliberate choice
 * rather than a missing feature. The resource may already be published, the same
 * URL may have been pasted into an email, and a file with nothing pointing at it
 * costs a few megabytes while a link that 404s costs the reader's trust. 045
 * carries the delete policy so a sweep of unreferenced objects can be written
 * later; the button here edits the list and stops there.
 *
 * NO HAND ADDED URL ROW. Pointing at a file that is already hosted elsewhere is
 * what the library's `link` and `download` kinds are for, and duplicating that
 * here would give the owner two places to paste the same URL with different
 * validation behind each.
 *
 * Styling is inline against the theme tokens, which is the idiom the admin
 * panels use. Small and quiet, no modal: this sits inside a form that already
 * has a heading of its own.
 */

const ACCENT = '#272C84'
const DANGER = '#c8102e'

/**
 * Twenty files on one resource. Not a database rule, a legibility one: the
 * public page renders this array as a flat list and a card with fifty downloads
 * under it is not a resource, it is a folder somebody should have zipped.
 */
const MAX_ATTACHMENTS = 20

/** The label starts as the file's own name, which needs a length that fits a row. */
const LABEL_MAX = 120

const chip: React.CSSProperties = {
  color: 'var(--text-4)', fontSize: '.55rem', fontWeight: 900,
  letterSpacing: '.1em', textTransform: 'uppercase',
  border: '1px solid var(--border-mid)', padding: '.1rem .4rem',
  borderRadius: '.2rem', flexShrink: 0,
}

const btn = (bg: string, fg: string, on: boolean): React.CSSProperties => ({
  background: on ? bg : 'var(--surface-2)',
  border: 'none',
  color: on ? fg : 'var(--text-4)',
  fontWeight: 900, fontSize: '.62rem', letterSpacing: '.12em', textTransform: 'uppercase',
  padding: '.55rem 1.1rem', minHeight: '2.5rem', borderRadius: '.25rem',
  cursor: on ? 'pointer' : 'default', fontFamily: 'inherit',
})

const btnGhost = (color: string, on: boolean): React.CSSProperties => ({
  background: 'transparent',
  border: `1px solid ${on ? color : 'var(--border)'}`,
  color: on ? color : 'var(--text-4)',
  fontWeight: 700, fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase',
  padding: '.4rem .8rem', borderRadius: '.25rem',
  cursor: on ? 'pointer' : 'default', fontFamily: 'inherit',
})

/**
 * "Meet Day Checklist.pdf" becomes "Meet Day Checklist".
 *
 * The extension is dropped because the kind chip next to the label already says
 * what sort of file it is, and the label is what a visitor reads on the download
 * button. Sanitized because it is a name the uploader chose and it is rendered
 * as text on a public page; `sanitizeText` rather than `sanitize` for the reason
 * that function gives, since React escapes text nodes already and entity
 * escaping here would show a literal `&#x27;` in the middle of somebody's title.
 */
function labelFromFileName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '')
  return sanitizeText(base, LABEL_MAX) || 'Attachment'
}

/**
 * The href for the open link, or undefined if the row carries something that
 * should not be put in an anchor.
 *
 * `safeUrl` is the site-wide allow-list (http, https, mailto, site-relative),
 * and it refuses `blob:` along with everything else it does not know. That is
 * correct for a stored value and wrong for demo mode, where the URL a demo
 * upload mints IS a blob made by this tab moments ago, so that one scheme is
 * admitted here rather than losing the link on the walkthrough.
 */
function openHref(url: string, isDemo: boolean): string | undefined {
  if (isDemo && url.startsWith('blob:')) return url
  return safeUrl(url)
}

export interface AttachmentManagerProps {
  attachments: ResourceAttachment[]
  onChange: (next: ResourceAttachment[]) => void
  isDemo?: boolean
  /** Read-only viewers: the panel passes this and everything greys out. */
  disabled?: boolean
}

export default function AttachmentManager({
  attachments,
  onChange,
  isDemo = false,
  disabled = false,
}: AttachmentManagerProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const list = Array.isArray(attachments) ? attachments : []
  const full = list.length >= MAX_ATTACHMENTS
  const locked = disabled || busy

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Cleared so choosing the same file twice in a row still fires a change,
    // which is what happens after a failed upload the owner wants to retry.
    e.target.value = ''
    if (!file || full) return

    setBusy(true)
    setError(null)
    const res = await uploadResourceFile(file, isDemo)
    setBusy(false)

    // The failure stays on screen and the control stays open, which is the whole
    // contract of this component's error handling.
    if (!res.ok) { setError(res.message); return }

    onChange([
      ...list,
      { label: labelFromFileName(file.name), url: res.url, kind: res.kind, size: res.size },
    ])
  }

  /**
   * The label is edited raw and cleaned on blur, never per keystroke.
   * `sanitizeText` trims, so sanitizing on every change eats the space the
   * moment it is typed and "Meet day" comes out as "Meetday".
   */
  const setLabel = (index: number, value: string) => {
    onChange(list.map((a, i) => (i === index ? { ...a, label: value.slice(0, LABEL_MAX) } : a)))
  }
  const cleanLabel = (index: number) => {
    onChange(list.map((a, i) => (
      i === index ? { ...a, label: sanitizeText(a.label, LABEL_MAX) || 'Attachment' } : a
    )))
  }

  const remove = (index: number) => {
    setError(null)
    onChange(list.filter((_, i) => i !== index))
  }

  return (
    <div>
      <span className="field-label" style={{ marginBottom: '.25rem' }}>Attachments</span>
      <p style={{ color: 'var(--text-4)', fontSize: '.68rem', lineHeight: 1.5, marginBottom: '.6rem' }}>
        Files a visitor can download from this resource. PDF, JPG, PNG, WebP, CSV, DOC, or DOCX, up to {RESOURCE_FILE_MAX_MB} MB each.
      </p>

      {list.length > 0 && (
        <div style={{ border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden', marginBottom: '.75rem' }}>
          {list.map((a, i) => {
            const href = openHref(a.url ?? '', isDemo)
            const size = humanFileSize(a.size ?? null)
            return (
              <div
                key={`${a.url}-${i}`}
                style={{
                  borderBottom: i === list.length - 1 ? 'none' : '1px solid var(--surface)',
                  padding: '.7rem .9rem',
                  display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap',
                  opacity: disabled ? .6 : 1,
                }}
              >
                <span style={chip}>{a.kind}</span>

                <input
                  className="field"
                  style={{ flex: 1, minWidth: 160, margin: 0 }}
                  maxLength={LABEL_MAX}
                  value={a.label}
                  disabled={locked}
                  aria-label="Attachment label"
                  placeholder="What this file is called"
                  onChange={e => setLabel(i, e.target.value)}
                  onBlur={() => cleanLabel(i)}
                />

                {size && (
                  <span style={{ color: 'var(--text-4)', fontSize: '.72rem', flexShrink: 0 }}>{size}</span>
                )}

                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...btnGhost('var(--text-2)', true), textDecoration: 'none', display: 'inline-block', lineHeight: 1.6 }}
                  >
                    Open
                  </a>
                ) : (
                  <span style={{ color: 'var(--text-4)', fontSize: '.7rem' }}>No link</span>
                )}

                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={locked}
                  style={btnGhost(DANGER, !locked)}
                >
                  Remove
                </button>
              </div>
            )
          })}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={RESOURCE_FILE_ACCEPT}
        onChange={e => { void pick(e) }}
        disabled={locked || full}
        style={{ display: 'none' }}
      />

      {full ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', lineHeight: 1.5 }}>
          That is {MAX_ATTACHMENTS} files, which is as many as one resource carries. Remove one to add another.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={locked}
          style={btn(ACCENT, '#fff', !locked)}
        >
          {busy ? 'Uploading…' : list.length === 0 ? '+ Attach a file' : '+ Attach another'}
        </button>
      )}

      {error && (
        <p role="alert" style={{ color: DANGER, fontSize: '.72rem', lineHeight: 1.5, marginTop: '.5rem' }}>
          {error}
        </p>
      )}

      {isDemo && (
        <p style={{ color: 'var(--text-4)', fontSize: '.68rem', lineHeight: 1.5, marginTop: '.5rem' }}>
          Demo mode. A file you pick here stays in this browser tab and is never uploaded.
        </p>
      )}

      {!isDemo && list.length > 0 && (
        <p style={{ color: 'var(--text-4)', fontSize: '.68rem', lineHeight: 1.5, marginTop: '.5rem' }}>
          Removing a file here takes it off this resource. The uploaded copy stays where it is, so any link already
          shared keeps working.
        </p>
      )}
    </div>
  )
}
