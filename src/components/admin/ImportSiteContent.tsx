import { useState } from 'react'
import { importSiteContent } from '../../lib/seedContent'
import type { ImportResult } from '../../lib/seedContent'

/**
 * Inline "pull the site's built-in content into the database" banner.
 *
 * The meets, blog posts and testimonials the public site shows have always
 * lived in code, so an admin panel that reads the database sees nothing until
 * that content is imported once. The import has always existed (Settings →
 * General), but it is easy to miss — so this puts the very same one-click,
 * idempotent import right in the empty panel where the gap is felt, and shows
 * exactly what happened (or the real error) instead of failing silently.
 *
 * importSiteContent() brings in ALL three types at once and skips anything
 * already there, so running it from the Blog panel also lands the meets, and
 * a second run imports nothing.
 */
interface Props {
  /** Tunes the wording to the panel it sits in. */
  kind: 'blog' | 'meets'
  /** Re-fetch the panel after a run so the freshly imported rows appear. */
  onImported: () => void
}

const NOUN: Record<Props['kind'], string> = { blog: 'blog posts', meets: 'meets' }

export default function ImportSiteContent({ kind, onImported }: Props) {
  const [busy, setBusy]     = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError]   = useState('')

  const run = async () => {
    setBusy(true); setError(''); setResult(null)
    try {
      const r = await importSiteContent()
      setResult(r)
      if (!r.ok && r.message) setError(r.message)
      onImported()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  const summary = result && result.ok
    ? (result.blog.imported + result.meets.imported + result.testimonials.imported === 0
        ? 'Everything from the site is already imported.'
        : `Imported ${result.blog.imported} ${result.blog.imported === 1 ? 'post' : 'posts'}, ` +
          `${result.meets.imported} ${result.meets.imported === 1 ? 'meet' : 'meets'}, ` +
          `${result.testimonials.imported} ${result.testimonials.imported === 1 ? 'testimonial' : 'testimonials'}.`)
    : ''

  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.4rem', padding: '1.5rem', marginBottom: '1.5rem' }}>
      <p style={{ color: 'var(--text)', fontSize: '.8rem', fontWeight: 700, marginBottom: '.35rem' }}>
        The {NOUN[kind]} on the live site aren’t in the database yet.
      </p>
      <p style={{ color: 'var(--text-2)', fontSize: '.78rem', lineHeight: 1.6, maxWidth: 560, marginBottom: '1rem' }}>
        They’re still built into the site’s code, which is why they show publicly but not here.
        Import them once — keeping the same content and URLs — and they become fully editable below.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', flexWrap: 'wrap' }}>
        <button
          onClick={run}
          disabled={busy}
          style={{ background: '#272C84', border: 'none', color: '#fff', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1.2rem', borderRadius: '.2rem', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy ? .6 : 1 }}
        >
          {busy ? 'Importing…' : 'Import from site'}
        </button>
        {summary && <span style={{ color: '#22c55e', fontSize: '.78rem', fontWeight: 600 }}>{summary}</span>}
        {error && <span style={{ color: '#c8102e', fontSize: '.78rem', fontWeight: 600 }}>{error}</span>}
      </div>
    </div>
  )
}
