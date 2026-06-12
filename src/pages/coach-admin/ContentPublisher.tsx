import { useState, useEffect, useCallback } from 'react'
import type { Coach } from '../../data/coaches'
import { fetchMyContent, submitContent, removeContent } from '../../lib/contentApi'
import type { PendingContent } from '../../data/pendingContent'
import { isRateLimited, recordFailedAttempt, formatLockRemaining } from '../../utils/sanitize'

// ── Section editor types ─────────────────────────────────────────────────────

type SectionType = 'paragraph' | 'heading' | 'subheading' | 'list' | 'callout' | 'week' | 'divider'

interface EditorSection {
  _id:   string
  type:  SectionType
  text?: string
  items?: string  // newline-separated items for list/week
  label?: string  // week label
}

function uid() { return Math.random().toString(36).slice(2, 12) }

function serializeSections(sections: EditorSection[]): string {
  const normalized = sections.map(({ _id: _i, ...s }) => {
    if (s.type === 'list' || s.type === 'week') {
      return { ...s, items: (s.items ?? '').split('\n').map(i => i.trim()).filter(Boolean) }
    }
    return s
  })
  return JSON.stringify(normalized)
}

// Content submission rate limit: max 5 submissions per 30 minutes per coach
const SUBMIT_MAX      = 5
const SUBMIT_LOCK_MS  = 30 * 60 * 1000
const SUBMIT_WINDOW_MS = 30 * 60 * 1000

const inputStyle: React.CSSProperties = {
  background: '#0e1c30',
  border: '1px solid #1c3255',
  borderRadius: '.2rem',
  color: '#fff',
  fontSize: '.875rem',
  fontWeight: 500,
  padding: '.65rem .875rem',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}
const labelStyle: React.CSSProperties = {
  color: '#555',
  fontSize: '.6rem',
  fontWeight: 700,
  letterSpacing: '.15em',
  textTransform: 'uppercase',
  marginBottom: '.35rem',
  display: 'block',
}
const STATUS_COLORS: Record<string, string> = {
  pending:  '#f5b935',
  approved: '#22c55e',
  rejected: '#c8102e',
}

interface Props {
  coach: Coach
  isDemo?: boolean
}

export default function ContentPublisher({ coach, isDemo = false }: Props) {
  const rlScope = `content_submit_${coach.slug}`
  const [contentType, setContentType] = useState<'blog' | 'meet'>('blog')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<PendingContent[]>([])

  // Blog form state
  const [blogTitle,    setBlogTitle]    = useState('')
  const [blogSubtitle, setBlogSubtitle] = useState('')
  const [blogTags,     setBlogTags]     = useState('')
  const [blogSummary,  setBlogSummary]  = useState('')
  const [blogSections, setBlogSections] = useState<EditorSection[]>([
    { _id: uid(), type: 'paragraph', text: '' },
  ])

  function addSection(type: SectionType) {
    setBlogSections(prev => [...prev, { _id: uid(), type, text: '', items: '', label: '' }])
  }
  function updateSection(id: string, patch: Partial<EditorSection>) {
    setBlogSections(prev => prev.map(s => s._id === id ? { ...s, ...patch } : s))
  }
  function removeSection(id: string) {
    setBlogSections(prev => prev.filter(s => s._id !== id))
  }
  function moveSection(id: string, dir: -1 | 1) {
    setBlogSections(prev => {
      const idx = prev.findIndex(s => s._id === id)
      if (idx < 0 || idx + dir < 0 || idx + dir >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[idx + dir]] = [next[idx + dir], next[idx]]
      return next
    })
  }

  // Meet form state
  const [meetName,     setMeetName]     = useState('')
  const [meetDate,     setMeetDate]     = useState('')
  const [meetLocation, setMeetLocation] = useState('')
  const [federation,   setFederation]   = useState('')
  const [meetType,     setMeetType]     = useState('National')
  const [meetNote,     setMeetNote]     = useState('')

  const refreshItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchMyContent(coach.slug, isDemo)
      setItems(data)
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }, [coach.slug, isDemo])

  useEffect(() => { refreshItems() }, [refreshItems])

  async function checkAndSubmit(fn: () => Promise<void>) {
    setSubmitError('')
    const { blocked, remainingMs } = isRateLimited(rlScope)
    if (blocked) {
      setSubmitError(`Too many submissions. Try again in ${formatLockRemaining(remainingMs)}.`)
      return
    }
    recordFailedAttempt(rlScope, SUBMIT_MAX, SUBMIT_LOCK_MS, SUBMIT_WINDOW_MS)
    setSubmitting(true)
    try {
      await fn()
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed. Please try again.')
      setSubmitting(false)
      return
    }
    setSubmitting(false)
    setSubmitted(true)
    await refreshItems()
    setTimeout(() => setSubmitted(false), 3000)
  }

  function submitBlog() {
    const hasContent = blogSections.some(s => s.type === 'divider' || (s.type === 'list' || s.type === 'week' ? (s.items ?? '').trim() : (s.text ?? '').trim()))
    if (!blogTitle.trim() || !blogSummary.trim() || !hasContent) return
    checkAndSubmit(async () => {
      await submitContent({
        type: 'blog',
        coachSlug: coach.slug,
        coachName: coach.name,
        title:     blogTitle.trim(),
        subtitle:  blogSubtitle.trim(),
        tags:      blogTags.trim(),
        summary:   blogSummary.trim(),
        content:   serializeSections(blogSections),
      }, isDemo)
      setBlogTitle(''); setBlogSubtitle(''); setBlogTags(''); setBlogSummary('')
      setBlogSections([{ _id: uid(), type: 'paragraph', text: '' }])
    })
  }

  function submitMeet() {
    if (!meetName.trim() || !meetDate.trim()) return
    checkAndSubmit(async () => {
      await submitContent({
        type: 'meet',
        coachSlug: coach.slug,
        coachName: coach.name,
        meetName:     meetName.trim(),
        meetDate:     meetDate.trim(),
        meetLocation: meetLocation.trim(),
        federation:   federation.trim(),
        meetType:     meetType,
        meetNote:     meetNote.trim(),
      }, isDemo)
      setMeetName(''); setMeetDate(''); setMeetLocation(''); setFederation(''); setMeetNote('')
    })
  }

  async function handleDelete(id: string) {
    try { await removeContent(id, isDemo) } catch { /* ignore */ }
    await refreshItems()
  }

  const myItems = items.slice().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))

  return (
    <div style={{ padding: '2rem', maxWidth: 800 }}>
      {isDemo && (
        <div style={{ background: '#2d2500', border: '1px solid #5c4800', borderRadius: '.25rem', padding: '.75rem 1rem', marginBottom: '1.5rem' }}>
          <span style={{ color: '#f5b935', fontSize: '.7rem', fontWeight: 700 }}>Demo Mode — </span>
          <span style={{ color: '#a08c30', fontSize: '.75rem' }}>Submissions are stored in your browser and visible to Ronnie's demo admin for review.</span>
        </div>
      )}

      {/* Type toggle */}
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '2rem' }}>
        {(['blog', 'meet'] as const).map(t => (
          <button
            key={t}
            onClick={() => setContentType(t)}
            style={{
              background: contentType === t ? '#c8102e' : 'transparent',
              border: `1px solid ${contentType === t ? '#c8102e' : '#1c3255'}`,
              color: contentType === t ? '#fff' : '#555',
              borderRadius: '.2rem',
              padding: '.5rem 1.25rem',
              fontSize: '.65rem',
              fontWeight: 900,
              letterSpacing: '.15em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all .15s',
            }}
          >
            {t === 'blog' ? '📝 Blog Post' : '🏋️ Meet / Event'}
          </button>
        ))}
      </div>

      {/* ── Blog Form ─────────────────────────────────────────────────────── */}
      {contentType === 'blog' && (
        <div style={{ background: '#0c1827', border: '1px solid #112038', borderRadius: '.25rem', padding: '2rem', marginBottom: '2rem' }}>
          <p style={{ color: '#c8102e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '1.5rem' }}>New Blog Post</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={labelStyle}>Title <span style={{ color: '#c8102e' }}>*</span></label>
              <input style={inputStyle} maxLength={200} placeholder="e.g. Meet Recap — USAPL Raw Nationals 2026" value={blogTitle} onChange={e => setBlogTitle(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Subtitle</label>
              <input style={inputStyle} maxLength={300} placeholder="One-line description for the post header" value={blogSubtitle} onChange={e => setBlogSubtitle(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Tags <span style={{ color: '#444', fontWeight: 400 }}>(comma-separated)</span></label>
              <input style={inputStyle} maxLength={200} placeholder="e.g. Meet Recap, USAPL, Case Study" value={blogTags} onChange={e => setBlogTags(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Summary <span style={{ color: '#c8102e' }}>*</span></label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                maxLength={1000}
                placeholder="2-3 sentence summary shown on the blog listing page…"
                value={blogSummary}
                onChange={e => setBlogSummary(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Content <span style={{ color: '#c8102e' }}>*</span></label>

              {/* ── Section List ── */}
              {blogSections.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: '.75rem' }}>
                  {blogSections.map((sec, idx) => (
                    <div key={sec._id} style={{ background: '#10131a', border: '1px solid #152842', borderRadius: '.2rem', padding: '.75rem' }}>
                      {/* Row header */}
                      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: sec.type === 'divider' ? 0 : '.5rem', flexWrap: 'wrap' }}>
                        <select
                          value={sec.type}
                          onChange={e => updateSection(sec._id, { type: e.target.value as SectionType })}
                          style={{ ...inputStyle, width: 'auto', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.3rem .5rem', appearance: 'none', cursor: 'pointer', flex: 'none' }}
                        >
                          {(['paragraph','heading','subheading','list','callout','week','divider'] as SectionType[]).map(t => (
                            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                          ))}
                        </select>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.3rem' }}>
                          <button onClick={() => moveSection(sec._id, -1)} disabled={idx === 0} style={{ background: 'none', border: '1px solid #152842', color: '#444', fontSize: '.65rem', padding: '.2rem .5rem', borderRadius: '.15rem', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, fontFamily: 'inherit' }}>↑</button>
                          <button onClick={() => moveSection(sec._id,  1)} disabled={idx === blogSections.length - 1} style={{ background: 'none', border: '1px solid #152842', color: '#444', fontSize: '.65rem', padding: '.2rem .5rem', borderRadius: '.15rem', cursor: idx === blogSections.length - 1 ? 'default' : 'pointer', opacity: idx === blogSections.length - 1 ? 0.3 : 1, fontFamily: 'inherit' }}>↓</button>
                          <button onClick={() => removeSection(sec._id)} style={{ background: 'none', border: '1px solid #152842', color: '#555', fontSize: '.65rem', padding: '.2rem .5rem', borderRadius: '.15rem', cursor: 'pointer', fontFamily: 'inherit' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#c8102e'; e.currentTarget.style.color = '#c8102e' }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = '#152842'; e.currentTarget.style.color = '#555' }}
                          >✕</button>
                        </div>
                      </div>

                      {/* Divider — no input */}
                      {sec.type === 'divider' && (
                        <div style={{ height: 1, background: '#243650', margin: '.3rem 0' }} />
                      )}

                      {/* Single text input (heading, subheading, paragraph, callout) */}
                      {(sec.type === 'heading' || sec.type === 'subheading') && (
                        <input style={inputStyle} placeholder={sec.type === 'heading' ? 'Section heading' : 'Subheading text'} value={sec.text ?? ''} onChange={e => updateSection(sec._id, { text: e.target.value })} maxLength={200} />
                      )}
                      {sec.type === 'paragraph' && (
                        <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} placeholder="Write paragraph text here…" value={sec.text ?? ''} onChange={e => updateSection(sec._id, { text: e.target.value })} maxLength={2000} />
                      )}
                      {sec.type === 'callout' && (
                        <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} placeholder="Callout quote or highlight…" value={sec.text ?? ''} onChange={e => updateSection(sec._id, { text: e.target.value })} maxLength={1000} />
                      )}

                      {/* List — one item per line */}
                      {sec.type === 'list' && (
                        <>
                          <p style={{ color: '#3a3f47', fontSize: '.6rem', marginBottom: '.35rem' }}>One bullet item per line</p>
                          <textarea style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} placeholder={'Item one\nItem two\nItem three'} value={sec.items ?? ''} onChange={e => updateSection(sec._id, { items: e.target.value })} maxLength={4000} />
                        </>
                      )}

                      {/* Week — label + items */}
                      {sec.type === 'week' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                          <input style={inputStyle} placeholder="Week label (e.g. Week 1 — Accumulation)" value={sec.label ?? ''} onChange={e => updateSection(sec._id, { label: e.target.value })} maxLength={100} />
                          <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} placeholder={'Squat: 4×5 @ RPE 8\nBench: 5×4 @ RPE 8\nDeadlift: 4×3 @ RPE 8.5'} value={sec.items ?? ''} onChange={e => updateSection(sec._id, { items: e.target.value })} maxLength={2000} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Add Section Buttons ── */}
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                {[
                  { type: 'paragraph'  as SectionType, label: '+ Paragraph' },
                  { type: 'heading'    as SectionType, label: '+ Heading'   },
                  { type: 'subheading' as SectionType, label: '+ Subheading'},
                  { type: 'list'       as SectionType, label: '+ List'      },
                  { type: 'callout'    as SectionType, label: '+ Callout'   },
                  { type: 'week'       as SectionType, label: '+ Week Block'},
                  { type: 'divider'    as SectionType, label: '+ Divider'   },
                ].map(({ type, label }) => (
                  <button key={type} onClick={() => addSection(type)} style={{ background: 'transparent', border: '1px solid #1c3255', color: '#555', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .75rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.color = '#d6d6d6' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#1c3255'; e.currentTarget.style.color = '#555' }}
                  >{label}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button
                onClick={submitBlog}
                disabled={!blogTitle.trim() || !blogSummary.trim() || submitting}
                style={{
                  background: '#c8102e',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: '.7rem',
                  letterSpacing: '.15em',
                  textTransform: 'uppercase',
                  padding: '.75rem 1.5rem',
                  borderRadius: '.2rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  opacity: (!blogTitle.trim() || !blogSummary.trim() || submitting) ? 0.4 : 1,
                  transition: 'opacity .15s',
                }}
              >
                {submitting ? 'Submitting…' : 'Submit for Review →'}
              </button>
              {submitted && <span style={{ color: '#22c55e', fontSize: '.75rem', fontWeight: 700 }}>✓ Submitted — pending head coach review</span>}
              {submitError && <span style={{ color: '#c8102e', fontSize: '.75rem', fontWeight: 700 }}>{submitError}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── Meet Form ─────────────────────────────────────────────────────── */}
      {contentType === 'meet' && (
        <div style={{ background: '#0c1827', border: '1px solid #112038', borderRadius: '.25rem', padding: '2rem', marginBottom: '2rem' }}>
          <p style={{ color: '#c8102e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '1.5rem' }}>Add Meet / Event</p>
          <div style={{ display: 'grid', gap: '1.25rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Meet Name <span style={{ color: '#c8102e' }}>*</span></label>
              <input style={inputStyle} maxLength={200} placeholder="e.g. USAPL Raw Nationals 2026" value={meetName} onChange={e => setMeetName(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Date <span style={{ color: '#c8102e' }}>*</span></label>
              <input style={inputStyle} maxLength={100} placeholder="e.g. July 24–27, 2026" value={meetDate} onChange={e => setMeetDate(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Location</label>
              <input style={inputStyle} maxLength={200} placeholder="e.g. Reno, NV" value={meetLocation} onChange={e => setMeetLocation(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Federation</label>
              <input style={inputStyle} maxLength={50} placeholder="e.g. USAPL" value={federation} onChange={e => setFederation(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Type</label>
              <select
                style={{ ...inputStyle, appearance: 'none', cursor: 'pointer' }}
                value={meetType}
                onChange={e => setMeetType(e.target.value)}
              >
                <option>National</option>
                <option>Regional</option>
                <option>World</option>
                <option>Local</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Note <span style={{ color: '#444', fontWeight: 400 }}>(shown on site)</span></label>
              <input style={inputStyle} maxLength={300} placeholder="e.g. Axis coaches attending & handling" value={meetNote} onChange={e => setMeetNote(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1.5rem' }}>
            <button
              onClick={submitMeet}
              disabled={!meetName.trim() || !meetDate.trim() || submitting}
              style={{
                background: '#c8102e',
                border: 'none',
                color: '#fff',
                fontWeight: 900,
                fontSize: '.7rem',
                letterSpacing: '.15em',
                textTransform: 'uppercase',
                padding: '.75rem 1.5rem',
                borderRadius: '.2rem',
                cursor: 'pointer',
                fontFamily: 'inherit',
                opacity: (!meetName.trim() || !meetDate.trim() || submitting) ? 0.4 : 1,
                transition: 'opacity .15s',
              }}
            >
              {submitting ? 'Submitting…' : 'Submit for Review →'}
            </button>
            {submitted && <span style={{ color: '#22c55e', fontSize: '.75rem', fontWeight: 700 }}>✓ Submitted — pending head coach review</span>}
            {submitError && <span style={{ color: '#c8102e', fontSize: '.75rem', fontWeight: 700 }}>{submitError}</span>}
          </div>
        </div>
      )}

      {/* ── Submission history ────────────────────────────────────────────── */}
      <div>
        <p style={{ color: '#3a3f47', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
          Your Submissions ({loading ? '…' : myItems.length})
        </p>
        {loading ? (
          <p style={{ color: '#243650', fontSize: '.8rem' }}>Loading…</p>
        ) : myItems.length === 0 ? (
          <p style={{ color: '#243650', fontSize: '.8rem' }}>No submissions yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: '#0a1f3c' }}>
            {myItems.map(item => (
              <div key={item.id} style={{ background: '#10131a', padding: '1.25rem 1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.35rem', flexWrap: 'wrap' }}>
                    <span style={{ color: '#444', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                      {item.type === 'blog' ? '📝 Blog' : '🏋️ Meet'}
                    </span>
                    <span style={{
                      background: STATUS_COLORS[item.status] + '18',
                      border: `1px solid ${STATUS_COLORS[item.status]}`,
                      color: STATUS_COLORS[item.status],
                      fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
                      padding: '.15rem .5rem', borderRadius: '.15rem',
                    }}>{item.status}</span>
                  </div>
                  <p style={{ color: '#fff', fontWeight: 700, fontSize: '.875rem' }}>
                    {item.type === 'blog' ? item.title : item.meetName}
                  </p>
                  {item.type === 'meet' && item.meetDate && (
                    <p style={{ color: '#444', fontSize: '.75rem', marginTop: '.2rem' }}>{item.meetDate} · {item.meetLocation}</p>
                  )}
                  {item.status === 'rejected' && item.rejectionNote && (
                    <p style={{ color: '#c8102e', fontSize: '.75rem', marginTop: '.35rem' }}>Note: {item.rejectionNote}</p>
                  )}
                  <p style={{ color: '#243650', fontSize: '.65rem', marginTop: '.4rem' }}>
                    Submitted {new Date(item.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                {item.status === 'pending' && (
                  <button
                    onClick={() => handleDelete(item.id)}
                    style={{ background: 'none', border: '1px solid #1c3255', color: '#444', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .75rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#c8102e'; e.currentTarget.style.color = '#c8102e' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#1c3255'; e.currentTarget.style.color = '#444' }}
                  >
                    Withdraw
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
