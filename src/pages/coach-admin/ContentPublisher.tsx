import { useState } from 'react'
import type { Coach } from '../../data/coaches'
import { addPendingContent, getPendingContent, deleteContent } from '../../data/pendingContent'
import type { PendingContent } from '../../data/pendingContent'
import { isRateLimited, recordFailedAttempt, clearRateLimit, formatLockRemaining } from '../../utils/sanitize'

// Content submission rate limit: max 5 submissions per 30 minutes per coach
const SUBMIT_MAX      = 5
const SUBMIT_LOCK_MS  = 30 * 60 * 1000
const SUBMIT_WINDOW_MS = 30 * 60 * 1000

const inputStyle: React.CSSProperties = {
  background: '#0d0d0d',
  border: '1px solid #222',
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
  pending:  '#f59e0b',
  approved: '#22c55e',
  rejected: '#e63e3e',
}

interface Props {
  coach: Coach
  isDemo?: boolean
}

export default function ContentPublisher({ coach, isDemo = false }: Props) {
  const rlScope = `content_submit_${coach.slug}`
  const [contentType, setContentType] = useState<'blog' | 'meet'>('blog')
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [items, setItems] = useState<PendingContent[]>(() =>
    getPendingContent().filter(c => c.coachSlug === coach.slug)
  )

  // Blog form state
  const [blogTitle,    setBlogTitle]    = useState('')
  const [blogSubtitle, setBlogSubtitle] = useState('')
  const [blogTags,     setBlogTags]     = useState('')
  const [blogSummary,  setBlogSummary]  = useState('')
  const [blogContent,  setBlogContent]  = useState('')

  // Meet form state
  const [meetName,     setMeetName]     = useState('')
  const [meetDate,     setMeetDate]     = useState('')
  const [meetLocation, setMeetLocation] = useState('')
  const [federation,   setFederation]   = useState('')
  const [meetType,     setMeetType]     = useState('National')
  const [meetNote,     setMeetNote]     = useState('')

  function refreshItems() {
    setItems(getPendingContent().filter(c => c.coachSlug === coach.slug))
  }

  function checkAndSubmit(fn: () => void) {
    setSubmitError('')
    const { blocked, remainingMs } = isRateLimited(rlScope)
    if (blocked) {
      setSubmitError(`Too many submissions. Try again in ${formatLockRemaining(remainingMs)}.`)
      return
    }
    // Count this attempt before executing — deters repeated spam even on errors
    recordFailedAttempt(rlScope, SUBMIT_MAX, SUBMIT_LOCK_MS, SUBMIT_WINDOW_MS)
    try {
      fn()
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed. Please try again.')
      return
    }
    setSubmitted(true)
    refreshItems()
    setTimeout(() => setSubmitted(false), 3000)
  }

  function submitBlog() {
    if (!blogTitle.trim() || !blogSummary.trim() || !blogContent.trim()) return
    checkAndSubmit(() => {
      addPendingContent({
        type: 'blog',
        coachSlug: coach.slug,
        coachName: coach.name,
        title:     blogTitle.trim(),
        subtitle:  blogSubtitle.trim(),
        tags:      blogTags.trim(),
        summary:   blogSummary.trim(),
        content:   blogContent.trim(),
      })
      setBlogTitle(''); setBlogSubtitle(''); setBlogTags(''); setBlogSummary(''); setBlogContent('')
    })
  }

  function submitMeet() {
    if (!meetName.trim() || !meetDate.trim()) return
    checkAndSubmit(() => {
      addPendingContent({
        type: 'meet',
        coachSlug: coach.slug,
        coachName: coach.name,
        meetName:     meetName.trim(),
        meetDate:     meetDate.trim(),
        meetLocation: meetLocation.trim(),
        federation:   federation.trim(),
        meetType:     meetType,
        meetNote:     meetNote.trim(),
      })
      setMeetName(''); setMeetDate(''); setMeetLocation(''); setFederation(''); setMeetNote('')
    })
  }

  function handleDelete(id: string) {
    deleteContent(id)
    refreshItems()
  }

  const myItems = items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))

  return (
    <div style={{ padding: '2rem', maxWidth: 800 }}>
      {isDemo && (
        <div style={{ background: '#2d1f00', border: '1px solid #5c3d00', borderRadius: '.25rem', padding: '.75rem 1rem', marginBottom: '1.5rem' }}>
          <span style={{ color: '#f59e0b', fontSize: '.7rem', fontWeight: 700 }}>Demo Mode — </span>
          <span style={{ color: '#a06000', fontSize: '.75rem' }}>Submissions are stored in your browser and visible to Ronnie's demo admin for review.</span>
        </div>
      )}

      {/* Type toggle */}
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '2rem' }}>
        {(['blog', 'meet'] as const).map(t => (
          <button
            key={t}
            onClick={() => setContentType(t)}
            style={{
              background: contentType === t ? '#e63e3e' : 'transparent',
              border: `1px solid ${contentType === t ? '#e63e3e' : '#222'}`,
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
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '.25rem', padding: '2rem', marginBottom: '2rem' }}>
          <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '1.5rem' }}>New Blog Post</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={labelStyle}>Title <span style={{ color: '#e63e3e' }}>*</span></label>
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
              <label style={labelStyle}>Summary <span style={{ color: '#e63e3e' }}>*</span></label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                maxLength={1000}
                placeholder="2-3 sentence summary shown on the blog listing page…"
                value={blogSummary}
                onChange={e => setBlogSummary(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Content <span style={{ color: '#e63e3e' }}>*</span> <span style={{ color: '#333', fontWeight: 400 }}>— separate paragraphs with a blank line</span></label>
              <textarea
                style={{ ...inputStyle, minHeight: 260, resize: 'vertical', lineHeight: 1.7 }}
                maxLength={8000}
                placeholder="Write the full post here. Use a blank line to separate paragraphs."
                value={blogContent}
                onChange={e => setBlogContent(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button
                onClick={submitBlog}
                disabled={!blogTitle.trim() || !blogSummary.trim() || !blogContent.trim()}
                style={{
                  background: '#e63e3e',
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
                  opacity: (!blogTitle.trim() || !blogSummary.trim() || !blogContent.trim()) ? 0.4 : 1,
                  transition: 'opacity .15s',
                }}
              >
                Submit for Review →
              </button>
              {submitted && <span style={{ color: '#22c55e', fontSize: '.75rem', fontWeight: 700 }}>✓ Submitted — pending head coach review</span>}
              {submitError && <span style={{ color: '#e63e3e', fontSize: '.75rem', fontWeight: 700 }}>{submitError}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── Meet Form ─────────────────────────────────────────────────────── */}
      {contentType === 'meet' && (
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '.25rem', padding: '2rem', marginBottom: '2rem' }}>
          <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '1.5rem' }}>Add Meet / Event</p>
          <div style={{ display: 'grid', gap: '1.25rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Meet Name <span style={{ color: '#e63e3e' }}>*</span></label>
              <input style={inputStyle} maxLength={200} placeholder="e.g. USAPL Raw Nationals 2026" value={meetName} onChange={e => setMeetName(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Date <span style={{ color: '#e63e3e' }}>*</span></label>
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
              disabled={!meetName.trim() || !meetDate.trim()}
              style={{
                background: '#e63e3e',
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
                opacity: (!meetName.trim() || !meetDate.trim()) ? 0.4 : 1,
                transition: 'opacity .15s',
              }}
            >
              Submit for Review →
            </button>
            {submitted && <span style={{ color: '#22c55e', fontSize: '.75rem', fontWeight: 700 }}>✓ Submitted — pending head coach review</span>}
            {submitError && <span style={{ color: '#e63e3e', fontSize: '.75rem', fontWeight: 700 }}>{submitError}</span>}
          </div>
        </div>
      )}

      {/* ── Submission history ────────────────────────────────────────────── */}
      <div>
        <p style={{ color: '#333', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
          Your Submissions ({myItems.length})
        </p>
        {myItems.length === 0 ? (
          <p style={{ color: '#2a2a2a', fontSize: '.8rem' }}>No submissions yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: '#111' }}>
            {myItems.map(item => (
              <div key={item.id} style={{ background: '#080808', padding: '1.25rem 1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
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
                    <p style={{ color: '#e63e3e', fontSize: '.75rem', marginTop: '.35rem' }}>Note: {item.rejectionNote}</p>
                  )}
                  <p style={{ color: '#2a2a2a', fontSize: '.65rem', marginTop: '.4rem' }}>
                    Submitted {new Date(item.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                {item.status === 'pending' && (
                  <button
                    onClick={() => handleDelete(item.id)}
                    style={{ background: 'none', border: '1px solid #222', color: '#444', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .75rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#e63e3e'; e.currentTarget.style.color = '#e63e3e' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#222'; e.currentTarget.style.color = '#444' }}
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
