import { useState, useEffect, useCallback } from 'react'
import { fetchAllContent, reviewContent } from '../../lib/contentApi'
import { fetchAllTestimonials, reviewTestimonial } from '../../lib/testimonialsApi'
import type { PendingContent } from '../../data/pendingContent'
import type { Testimonial } from '../../data/testimonials'
import { sanitizeText } from '../../utils/sanitize'
import { useMediaQuery, MOBILE_QUERY } from '../../lib/dashboard'
import DemoBanner from '../../components/dashboard/DemoBanner'

/**
 * The unified review queue: every pending blog post, meet, and homepage
 * testimonial request in one newest-first list. Approve / Reject sit on the
 * row itself — the expandable preview is optional context, never a gate.
 * Authoring and management of published items live in the Blog / Meets /
 * Testimonials tabs; this panel only decides what gets through.
 */

type QueueItem =
  | { key: string; kind: 'blog' | 'meet'; submittedAt: string; content: PendingContent }
  | { key: string; kind: 'testimonial'; submittedAt: string; testimonial: Testimonial }

const lbl: React.CSSProperties = {
  color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700,
  letterSpacing: '.15em', textTransform: 'uppercase',
  marginBottom: '.35rem', display: 'block',
}
const inp: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.2rem',
  color: 'var(--text)', fontSize: '.875rem', fontWeight: 500,
  padding: '.65rem .875rem', outline: 'none',
  width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
}
const btn: React.CSSProperties = {
  fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase',
  padding: '.5rem 1.1rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit',
  border: 'none', minHeight: '2.5rem',
}
const chipBase: React.CSSProperties = {
  fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
  padding: '.15rem .5rem', borderRadius: '.15rem', flexShrink: 0,
}

function KindChip({ kind }: { kind: QueueItem['kind'] }) {
  if (kind === 'testimonial') {
    return <span style={{ ...chipBase, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>Testimonial</span>
  }
  const color = kind === 'blog' ? '#272C84' : '#c8102e'
  return <span style={{ ...chipBase, background: color + '18', border: `1px solid ${color}`, color }}>{kind === 'blog' ? 'Blog' : 'Meet'}</span>
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function BlogPreview({ content }: { content: string }) {
  const trimmed = (content ?? '').trimStart()
  if (trimmed.startsWith('[')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sections = JSON.parse(trimmed) as any[]
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {sections.map((s: any, i: number) => {
            if (s.type === 'divider') return <div key={i} style={{ height: 1, background: 'var(--border)', margin: '.25rem 0' }} />
            if (s.type === 'heading') return <p key={i} style={{ color: 'var(--text)', fontWeight: 900, fontSize: '.9rem', textTransform: 'uppercase' }}>{s.text}</p>
            if (s.type === 'subheading') return <p key={i} style={{ color: '#c8102e', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.2em', textTransform: 'uppercase' }}>{s.text}</p>
            if (s.type === 'paragraph') return <p key={i} style={{ color: 'var(--text-3)', fontSize: '.825rem', lineHeight: 1.65 }}>{s.text}</p>
            if (s.type === 'callout') return <blockquote key={i} style={{ borderLeft: '3px solid #c8102e', paddingLeft: '.875rem', color: 'var(--text-3)', fontSize: '.875rem', fontWeight: 600, lineHeight: 1.7 }}>{s.text}</blockquote>
            if (s.type === 'list') return <ul key={i} style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.3rem' }}>{(Array.isArray(s.items) ? s.items : []).map((item: string, j: number) => <li key={j} style={{ display: 'flex', gap: '.5rem', color: 'var(--text-3)', fontSize: '.825rem', lineHeight: 1.6 }}><span style={{ color: '#c8102e', flexShrink: 0 }}>·</span>{item}</li>)}</ul>
            if (s.type === 'week') return <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.2rem', padding: '.875rem 1rem' }}><p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.75rem', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.5rem' }}>{s.label}</p><ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.25rem' }}>{(Array.isArray(s.items) ? s.items : []).map((item: string, j: number) => <li key={j} style={{ color: 'var(--text-4)', fontSize: '.8rem', display: 'flex', gap: '.5rem' }}><span style={{ color: '#c8102e' }}>·</span>{item}</li>)}</ul></div>
            return null
          })}
        </div>
      )
    } catch { /* fallthrough */ }
  }
  return <>{(content ?? '').split('\n\n').filter(Boolean).map((p, i) => <p key={i} style={{ color: 'var(--text-3)', fontSize: '.825rem', lineHeight: 1.65, marginBottom: '.5rem' }}>{p}</p>)}</>
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <p style={{ ...lbl, marginBottom: '.2rem' }}>{label}</p>
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.5 }}>{value}</p>
    </div>
  )
}

export default function ApprovalsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [items,        setItems]        = useState<QueueItem[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [busyKey,      setBusyKey]      = useState<string | null>(null)
  const [expandedKey,  setExpandedKey]  = useState<string | null>(null)
  const [rejectingKey, setRejectingKey] = useState<string | null>(null)
  const [rejectNote,   setRejectNote]   = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const [content, testimonials] = await Promise.all([
        fetchAllContent(isDemo),
        fetchAllTestimonials(isDemo),
      ])
      const queue: QueueItem[] = [
        ...content
          .filter(c => c.status === 'pending')
          .map((c): QueueItem => ({ key: `${c.type}-${c.id}`, kind: c.type, submittedAt: c.submittedAt, content: c })),
        ...testimonials
          .filter(t => t.mainStatus === 'pending')
          .map((t): QueueItem => ({ key: `testimonial-${t.id}`, kind: 'testimonial', submittedAt: t.createdAt, testimonial: t })),
      ].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      setItems(queue)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the review queue.')
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { setLoading(true); load() }, [load])

  async function approve(q: QueueItem) {
    setBusyKey(q.key); setError(null)
    try {
      if (q.kind === 'testimonial') await reviewTestimonial(q.testimonial.id, 'approved', undefined, isDemo)
      else await reviewContent(q.content.id, 'approved', undefined, isDemo)
      setItems(prev => prev.filter(i => i.key !== q.key))
      if (rejectingKey === q.key) { setRejectingKey(null); setRejectNote('') }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed.')
    } finally {
      setBusyKey(null)
    }
  }

  function armReject(q: QueueItem) {
    setRejectingKey(q.key)
    setRejectNote('')
  }

  async function confirmReject(q: QueueItem) {
    const note = sanitizeText(rejectNote, 500)
    if (q.kind !== 'testimonial' && !note) return
    setBusyKey(q.key); setError(null)
    try {
      if (q.kind === 'testimonial') await reviewTestimonial(q.testimonial.id, 'rejected', note || undefined, isDemo)
      else await reviewContent(q.content.id, 'rejected', note, isDemo)
      setItems(prev => prev.filter(i => i.key !== q.key))
      setRejectingKey(null); setRejectNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reject failed.')
    } finally {
      setBusyKey(null)
    }
  }

  const nBlog = items.filter(i => i.kind === 'blog').length
  const nMeet = items.filter(i => i.kind === 'meet').length
  const nTest = items.filter(i => i.kind === 'testimonial').length
  const breakdown = [
    nBlog ? `${nBlog} blog` : '',
    nMeet ? `${nMeet} meet${nMeet === 1 ? '' : 's'}` : '',
    nTest ? `${nTest} testimonial${nTest === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div className="dash-pad" style={{ maxWidth: 960 }}>
      {isDemo && <DemoBanner note="Approve or reject an item to walk the full flow — decisions apply to the sample data instantly." />}

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <p style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>
          {loading
            ? 'Loading queue'
            : items.length === 0
              ? 'Nothing awaiting review'
              : `${items.length} awaiting review — ${breakdown}`}
        </p>
        <button
          onClick={load}
          style={{ ...btn, background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', marginLeft: 'auto', padding: '.5rem 1rem' }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ background: '#1a0309', border: '1px solid #2d0810', borderRadius: '.25rem', padding: '.75rem 1rem', marginBottom: '1.25rem', color: '#f87171', fontSize: '.8rem' }}>{error}</div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>Loading…</p>
      ) : items.length === 0 ? (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--surface)', borderRadius: '.25rem', padding: '3rem 1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '.8rem', letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.6rem' }}>Queue Clear</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.6, maxWidth: 460, margin: '0 auto' }}>
            Nothing is waiting on review. Published posts, meets, and homepage testimonials are managed from the Blog, Meets, and Testimonials tabs.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: '.25rem', overflow: 'hidden' }}>
          {items.map(q => {
            const expanded  = expandedKey === q.key
            const rejecting = rejectingKey === q.key
            const busy      = busyKey === q.key
            const title = q.kind === 'testimonial'
              ? q.testimonial.athlete
              : (q.kind === 'blog' ? q.content.title : q.content.meetName) ?? 'Untitled'
            const coach = q.kind === 'testimonial' ? q.testimonial.coachName : q.content.coachName
            const noteMissing = q.kind !== 'testimonial' && !rejectNote.trim()

            return (
              <div key={q.key} style={{ background: 'var(--bg)', padding: isMobile ? '1rem' : '1.25rem 1.5rem' }}>
                <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '.85rem' : '1.25rem', alignItems: isMobile ? 'stretch' : 'flex-start' }}>

                  {/* Meta — tapping toggles the preview; actions never live in here */}
                  <div onClick={() => setExpandedKey(expanded ? null : q.key)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.4rem', flexWrap: 'wrap' }}>
                      <KindChip kind={q.kind} />
                      <span style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 600 }}>
                        by {coach} · submitted {fmtDate(q.submittedAt)}
                      </span>
                    </div>
                    <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.925rem' }}>{title}</p>

                    {q.kind === 'blog' && q.content.summary && (
                      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', marginTop: '.35rem', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{q.content.summary}</p>
                    )}
                    {q.kind === 'meet' && (
                      <p style={{ color: 'var(--text-dim)', fontSize: '.75rem', marginTop: '.25rem' }}>
                        {q.content.meetDate}{q.content.meetLocation ? ' · ' + q.content.meetLocation : ''}{q.content.federation ? ' · ' + q.content.federation : ''}{q.content.meetType ? ' · ' + q.content.meetType : ''}
                      </p>
                    )}
                    {q.kind === 'testimonial' && (
                      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', marginTop: '.35rem', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        "{q.testimonial.quote}"
                      </p>
                    )}

                    <p style={{ color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '.5rem' }}>
                      {expanded ? 'Hide preview ▴' : 'Preview ▾'}
                    </p>
                  </div>

                  {/* Actions — always visible, no expansion required */}
                  {!rejecting && (
                    <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
                      <button
                        onClick={() => approve(q)}
                        disabled={busy}
                        style={{ ...btn, background: '#22c55e', color: '#04240f', opacity: busy ? 0.5 : 1, flex: isMobile ? 1 : 'none' }}
                      >
                        {busy ? 'Saving…' : 'Approve'}
                      </button>
                      <button
                        onClick={() => armReject(q)}
                        disabled={busy}
                        style={{ ...btn, background: 'none', border: '1px solid #c8102e', color: '#c8102e', opacity: busy ? 0.5 : 1, flex: isMobile ? 1 : 'none' }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                {/* Inline rejection note — appears on demand, replaces the button pair */}
                {rejecting && (
                  <div style={{ marginTop: '.85rem', display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '.5rem', alignItems: isMobile ? 'stretch' : 'center' }}>
                    <input
                      style={{ ...inp, flex: 1, minWidth: isMobile ? 0 : 220 }}
                      maxLength={500}
                      autoFocus
                      placeholder={q.kind === 'testimonial' ? 'Reason (optional — shown to the coach)' : 'Reason (required — shown to the coach)'}
                      value={rejectNote}
                      onChange={e => setRejectNote(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: '.5rem' }}>
                      <button
                        onClick={() => confirmReject(q)}
                        disabled={busy || noteMissing}
                        style={{ ...btn, background: '#c8102e', color: '#fff', opacity: busy || noteMissing ? 0.5 : 1, flex: isMobile ? 1 : 'none' }}
                      >
                        {busy ? 'Saving…' : 'Confirm Reject'}
                      </button>
                      <button
                        onClick={() => { setRejectingKey(null); setRejectNote('') }}
                        disabled={busy}
                        style={{ ...btn, background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', flex: isMobile ? 1 : 'none' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Expandable preview */}
                {expanded && (
                  <div style={{ marginTop: '1rem', borderTop: '1px solid var(--surface)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {q.kind === 'blog' && (
                      <>
                        {q.content.subtitle && <Field label="Subtitle" value={q.content.subtitle} />}
                        {q.content.content && (
                          <div>
                            <p style={{ ...lbl, marginBottom: '.5rem' }}>Content Preview</p>
                            <div style={{ border: '1px solid var(--surface)', borderRadius: '.2rem', padding: '1.25rem', maxHeight: 320, overflow: 'auto' }}>
                              <BlogPreview content={q.content.content} />
                            </div>
                          </div>
                        )}
                        {q.content.tags && <Field label="Tags" value={q.content.tags} />}
                      </>
                    )}

                    {q.kind === 'meet' && (
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.85rem' }}>
                        <Field label="Date" value={q.content.meetDate} />
                        <Field label="Location" value={q.content.meetLocation} />
                        <Field label="Federation" value={q.content.federation} />
                        <Field label="Type" value={q.content.meetType} />
                        <Field label="Note" value={q.content.meetNote} />
                      </div>
                    )}

                    {q.kind === 'testimonial' && (
                      <>
                        <blockquote style={{ borderLeft: '3px solid #c8102e', paddingLeft: '.875rem', color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.8 }}>
                          "{q.testimonial.quote}"
                        </blockquote>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                          {q.testimonial.photo && (
                            <img src={q.testimonial.photo} alt={q.testimonial.athlete} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)', maxWidth: '100%' }} />
                          )}
                          <div>
                            <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.8rem' }}>{q.testimonial.athlete}</p>
                            {q.testimonial.result && (
                              <p style={{ color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginTop: '.1rem' }}>{q.testimonial.result}</p>
                            )}
                          </div>
                        </div>
                        <p style={{ color: 'var(--text-4)', fontSize: '.7rem' }}>
                          Requesting homepage placement · {q.testimonial.showOnCoach ? 'also shown on the coach page' : 'not shown on the coach page'}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
