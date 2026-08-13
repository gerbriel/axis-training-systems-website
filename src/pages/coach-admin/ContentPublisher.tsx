import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import DemoBanner from '../../components/dashboard/DemoBanner'
import type { Coach } from '../../data/coaches'
import { fetchMyContent, submitContent, removeContent, updateContent } from '../../lib/contentApi'
import type { PendingContent } from '../../data/pendingContent'
import { isRateLimited, recordFailedAttempt, formatLockRemaining } from '../../utils/sanitize'
import {
  fetchRotation, deriveStatuses, currentCycleFor, formatCycleDate,
  type RotationCycle, type RotationStatus,
} from '../../lib/rotationApi'
import {
  loadDraft, saveDraft, clearDraft, draftHasContent, draftFingerprint, relativeTime,
  type ContentDraft,
} from '../../lib/contentDraft'

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

function blankSection(): EditorSection {
  return { _id: uid(), type: 'paragraph', text: '' }
}

/**
 * Inverse of serializeSections — turns a stored post back into editable rows.
 * Falls back to \n\n-split paragraphs so posts written before the section
 * editor existed can still be opened and edited rather than 404-ing the form.
 */
function deserializeSections(raw: string | undefined): EditorSection[] {
  if (!raw?.trim()) return [blankSection()]

  const trimmed = raw.trimStart()
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Array<{
        type: SectionType; text?: string; items?: string[]; label?: string
      }>
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(s => ({
          _id:   uid(),
          type:  s.type,
          text:  s.text ?? '',
          items: Array.isArray(s.items) ? s.items.join('\n') : '',
          label: s.label ?? '',
        }))
      }
    } catch { /* not JSON — treat as plain text below */ }
  }

  return raw.split('\n\n').filter(Boolean).map(text => ({
    _id: uid(), type: 'paragraph' as SectionType, text, items: '', label: '',
  }))
}

// ── Rotation banner ──────────────────────────────────────────────────────────

const CYCLE_STYLES: Record<string, { bg: string; border: string; fg: string; label: string }> = {
  overdue:   { bg: 'rgba(200,16,46,.08)',  border: '#c8102e', fg: '#f87171', label: 'Overdue' },
  due:       { bg: 'rgba(39,44,132,.08)',  border: '#272C84', fg: 'var(--text)', label: 'Due' },
  submitted: { bg: 'rgba(39,44,132,.08)',  border: '#272C84', fg: 'var(--text)', label: 'In Review' },
  complete:  { bg: 'rgba(34,197,94,.08)',  border: '#22c55e', fg: '#22c55e', label: 'Complete' },
  upcoming:  { bg: 'var(--surface-2)',     border: 'var(--border)', fg: 'var(--text-2)', label: 'Upcoming' },
  waived:    { bg: 'var(--surface-2)',     border: 'var(--border)', fg: 'var(--text-2)', label: 'Waived' },
}

function cycleMessage(s: RotationStatus): string {
  const due = formatCycleDate(s.cycle.dueDate)
  const d = s.daysUntilDue
  switch (s.state) {
    case 'complete':  return `Your blog for this cycle is published. Next turn opens after ${due}.`
    case 'submitted': return `Submitted and awaiting head coach review — your ${due} cycle is covered.`
    case 'overdue':   return `Your blog was due ${due} — ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} ago.`
    case 'due':       return `Your next blog is due ${due} — ${d} day${d === 1 ? '' : 's'} left.`
    case 'waived':    return `This cycle was waived${s.cycle.waiveNote ? ` — ${s.cycle.waiveNote}` : ''}.`
    default:          return `Your next blog is due ${due}.`
  }
}

// Content submission rate limit: max 5 submissions per 30 minutes per coach
const SUBMIT_MAX      = 5
const SUBMIT_LOCK_MS  = 30 * 60 * 1000
const SUBMIT_WINDOW_MS = 30 * 60 * 1000

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: '.2rem',
  color: 'var(--text)',
  fontSize: '.875rem',
  fontWeight: 500,
  padding: '.65rem .875rem',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}
const labelStyle: React.CSSProperties = {
  color: 'var(--text-2)',
  fontSize: '.6rem',
  fontWeight: 700,
  letterSpacing: '.15em',
  textTransform: 'uppercase',
  marginBottom: '.35rem',
  display: 'block',
}
const STATUS_COLORS: Record<string, string> = {
  pending:  '#272C84',
  approved: '#22c55e',
  rejected: '#c8102e',
}

interface Props {
  coach: Coach
  isDemo?: boolean
}

/** Debounce on the autosave: a draft written on every keystroke is a lot of
 *  JSON.stringify for no benefit — a second of idle is well inside the window
 *  where a coach could switch tabs. */
const DRAFT_SAVE_MS = 800

export default function ContentPublisher({ coach, isDemo = false }: Props) {
  const rlScope = `content_submit_${coach.slug}`

  // Restored synchronously so the first paint already has the coach's text —
  // populating it in an effect would flash an empty composer first.
  const restored = useRef<ContentDraft<EditorSection> | null>(
    (() => {
      const d = loadDraft<EditorSection>(coach.slug, isDemo)
      return d && draftHasContent(d) ? d : null
    })()
  )
  const [draftNotice, setDraftNotice] = useState<string | null>(
    restored.current ? `Draft restored from ${relativeTime(restored.current.savedAt)}.` : null
  )

  const [contentType, setContentType] = useState<'blog' | 'meet'>(restored.current?.contentType ?? 'blog')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<PendingContent[]>([])

  // Editing an existing submission — null means "composing a new one".
  const [editingId, setEditingId] = useState<string | null>(restored.current?.editingId ?? null)

  // Rotation schedule
  const [cycles, setCycles] = useState<RotationCycle[]>([])

  // Blog form state
  const [blogTitle,    setBlogTitle]    = useState(restored.current?.blog.title ?? '')
  const [blogSubtitle, setBlogSubtitle] = useState(restored.current?.blog.subtitle ?? '')
  const [blogTags,     setBlogTags]     = useState(restored.current?.blog.tags ?? '')
  const [blogSummary,  setBlogSummary]  = useState(restored.current?.blog.summary ?? '')
  const [blogSections, setBlogSections] = useState<EditorSection[]>(
    restored.current?.blog.sections.length ? restored.current.blog.sections : [blankSection()]
  )

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
  const [meetName,     setMeetName]     = useState(restored.current?.meet.name ?? '')
  const [meetDate,     setMeetDate]     = useState(restored.current?.meet.date ?? '')
  const [meetLocation, setMeetLocation] = useState(restored.current?.meet.location ?? '')
  const [federation,   setFederation]   = useState(restored.current?.meet.federation ?? '')
  const [meetType,     setMeetType]     = useState(restored.current?.meet.type ?? 'National')
  const [meetNote,     setMeetNote]     = useState(restored.current?.meet.note ?? '')

  const currentDraft = useCallback((): ContentDraft<EditorSection> => ({
    contentType,
    editingId,
    blog: { title: blogTitle, subtitle: blogSubtitle, tags: blogTags, summary: blogSummary, sections: blogSections },
    meet: { name: meetName, date: meetDate, location: meetLocation, federation, type: meetType, note: meetNote },
    savedAt: new Date().toISOString(),
  }), [contentType, editingId, blogTitle, blogSubtitle, blogTags, blogSummary, blogSections,
       meetName, meetDate, meetLocation, federation, meetType, meetNote])

  /**
   * The composer's content as it stood the moment a submission was loaded into
   * it. `null` means "composing freely", where any text at all counts as work.
   * Captured in an effect rather than inline, because startEdit's setState calls
   * have not landed yet when it returns.
   */
  const editBaseline  = useRef<string | null>(null)
  const captureBaseline = useRef(false)
  useEffect(() => {
    if (!captureBaseline.current) return
    captureBaseline.current = false
    editBaseline.current = draftFingerprint(currentDraft())
  }, [currentDraft])

  /** Has the coach changed anything that is not saved anywhere? */
  const hasUnsavedWork = useCallback(() => {
    const draft = currentDraft()
    return editBaseline.current === null
      ? draftHasContent(draft)
      : draftFingerprint(draft) !== editBaseline.current
  }, [currentDraft])

  /** Cleared together: the draft only exists to survive an unmount, so once the
   *  work is submitted or abandoned it must not come back to haunt the coach. */
  const wipeDraft = useCallback(() => {
    clearDraft(coach.slug, isDemo)
    editBaseline.current = null
    setDraftNotice(null)
  }, [coach.slug, isDemo])

  // Autosave. An empty composer writes nothing (and clears any stale draft), so
  // a coach who never types never sees a restore banner.
  useEffect(() => {
    const draft = currentDraft()
    const id = window.setTimeout(() => {
      if (draftHasContent(draft)) saveDraft(coach.slug, isDemo, draft)
      else clearDraft(coach.slug, isDemo)
    }, DRAFT_SAVE_MS)
    return () => window.clearTimeout(id)
  }, [currentDraft, coach.slug, isDemo])

  const refreshItems = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const data = await fetchMyContent(coach.slug, isDemo)
      setItems(data)
    } catch (err: unknown) {
      // Previously swallowed — a broken backend rendered as "No submissions yet",
      // which is indistinguishable from a coach who simply hasn't written one.
      setLoadError(err instanceof Error ? err.message : 'Could not load your submissions.')
    } finally {
      setLoading(false)
    }
  }, [coach.slug, isDemo])

  useEffect(() => { refreshItems() }, [refreshItems])

  // A restored draft can point at a submission that was withdrawn, or approved
  // while the coach was away. Keep the words, drop the link, and say so.
  //
  // Two things this must NOT do. It must not run when the fetch FAILED —
  // `items` is [] on error, which would read as "everything you were editing is
  // gone" and turn the coach's next save into a duplicate submission. And
  // presence is not enough: RLS only lets a coach update a 'pending' or
  // 'rejected' row, so an approved one is still in the list yet no longer
  // editable, and saving into it would be refused.
  const staleChecked = useRef(false)
  useEffect(() => {
    if (staleChecked.current || loading || loadError) return
    staleChecked.current = true

    const wanted = restored.current?.editingId
    if (!wanted) return

    const target = items.find(i => i.id === wanted)
    const editable = target && (target.status === 'pending' || target.status === 'rejected')
    if (editable) return

    setEditingId(null)
    setDraftNotice(
      target
        ? 'The submission you were editing has already been approved and can no longer be changed. Your text was kept as a new draft.'
        : 'The submission you were editing is no longer available. Your text was kept as a new draft.'
    )
  }, [loading, loadError, items])

  useEffect(() => {
    fetchRotation(isDemo).then(setCycles).catch(() => setCycles([]))
  }, [isDemo])

  const myCycle = useMemo(() => {
    if (cycles.length === 0) return undefined
    return currentCycleFor(coach.slug, deriveStatuses(cycles, items))
  }, [cycles, items, coach.slug])

  function resetBlogForm() {
    setBlogTitle(''); setBlogSubtitle(''); setBlogTags(''); setBlogSummary('')
    setBlogSections([blankSection()])
  }
  function resetMeetForm() {
    setMeetName(''); setMeetDate(''); setMeetLocation(''); setFederation(''); setMeetType('National'); setMeetNote('')
  }

  function cancelEdit() {
    setEditingId(null)
    setSubmitError('')
    resetBlogForm()
    resetMeetForm()
    wipeDraft()
  }

  /** Load an existing submission back into the form. */
  function startEdit(item: PendingContent) {
    // Loading a submission overwrites the composer. Ask first whenever that
    // would destroy work — including a rejected post the coach is part-way
    // through reworking, which an earlier guard missed: twenty minutes of
    // revision, one tap on another item, gone.
    //
    // hasUnsavedWork, not "is the form non-empty": a freshly loaded submission
    // fills the form with its own words, and prompting about those would nag the
    // coach for work they never did every time they compared two posts.
    if (item.id !== editingId && hasUnsavedWork()) {
      const ok = window.confirm(
        'You have unsaved changes in the editor. Loading this submission will replace them. Continue?'
      )
      if (!ok) return
    }

    setSubmitError('')
    setDraftNotice(null)
    setEditingId(item.id)
    setContentType(item.type)
    // The form is about to become an untouched copy of `item` — snapshot that as
    // the baseline once React has applied the setters below.
    captureBaseline.current = true

    if (item.type === 'blog') {
      setBlogTitle(item.title ?? '')
      setBlogSubtitle(item.subtitle ?? '')
      setBlogTags(item.tags ?? '')
      setBlogSummary(item.summary ?? '')
      setBlogSections(deserializeSections(item.content))
    } else {
      setMeetName(item.meetName ?? '')
      setMeetDate(item.meetDate ?? '')
      setMeetLocation(item.meetLocation ?? '')
      setFederation(item.federation ?? '')
      setMeetType(item.meetType ?? 'National')
      setMeetNote(item.meetNote ?? '')
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /**
   * Rate limiting applies to NEW submissions only. Editing is how a coach fixes
   * a typo or acts on rejection feedback — locking them out after five saves
   * would punish exactly the behaviour we want.
   */
  async function runSave(fn: () => Promise<void>, isNew: boolean) {
    setSubmitError('')
    if (isNew) {
      const { blocked, remainingMs } = isRateLimited(rlScope)
      if (blocked) {
        setSubmitError(`Too many submissions. Try again in ${formatLockRemaining(remainingMs)}.`)
        return
      }
      recordFailedAttempt(rlScope, SUBMIT_MAX, SUBMIT_LOCK_MS, SUBMIT_WINDOW_MS)
    }

    setSubmitting(true)
    try {
      await fn()
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed. Please try again.')
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

    const fields = {
      title:    blogTitle.trim(),
      subtitle: blogSubtitle.trim(),
      tags:     blogTags.trim(),
      summary:  blogSummary.trim(),
      content:  serializeSections(blogSections),
    }
    const id = editingId

    runSave(async () => {
      if (id) {
        // Back to 'pending' on every coach edit: a reworked post must be
        // re-reviewed, and RLS refuses any coach write that isn't 'pending'.
        await updateContent(id, { ...fields, status: 'pending', rejectionNote: '' }, isDemo)
        setEditingId(null)
      } else {
        await submitContent({
          type: 'blog', coachSlug: coach.slug, coachName: coach.name, ...fields,
        }, isDemo)
      }
      resetBlogForm()
      // Only after the save actually resolved — clearing before would lose the
      // post if the request threw.
      wipeDraft()
    }, !id)
  }

  function submitMeet() {
    if (!meetName.trim() || !meetDate.trim()) return

    const fields = {
      meetName:     meetName.trim(),
      meetDate:     meetDate.trim(),
      meetLocation: meetLocation.trim(),
      federation:   federation.trim(),
      meetType:     meetType,
      meetNote:     meetNote.trim(),
    }
    const id = editingId

    runSave(async () => {
      if (id) {
        await updateContent(id, { ...fields, status: 'pending', rejectionNote: '' }, isDemo)
        setEditingId(null)
      } else {
        await submitContent({
          type: 'meet', coachSlug: coach.slug, coachName: coach.name, ...fields,
        }, isDemo)
      }
      resetMeetForm()
      wipeDraft()
    }, !id)
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Withdraw this submission? This cannot be undone.')) return
    setSubmitError('')
    try {
      await removeContent(id, isDemo)
      if (editingId === id) cancelEdit()
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Could not withdraw this submission.')
    }
    await refreshItems()
  }

  const myItems = items.slice().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  const editingItem = editingId ? items.find(i => i.id === editingId) : undefined

  return (
    <div style={{ padding: '2rem', maxWidth: 800 }}>
      {isDemo && <DemoBanner />}

      {draftNotice && (
        <div style={{ background: 'rgba(39,44,132,.1)', border: '1px solid rgba(39,44,132,.4)', borderRadius: '.25rem', padding: '.75rem 1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-2)', fontSize: '.8rem', flex: 1, minWidth: 200, lineHeight: 1.5 }}>{draftNotice}</span>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm('Discard this draft? Your unsaved text will be deleted.')) return
              resetBlogForm()
              resetMeetForm()
              setEditingId(null)
              wipeDraft()
            }}
            style={{ background: 'transparent', border: '1px solid var(--border-mid)', color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.5rem .875rem', minHeight: '2.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
          >
            Discard Draft
          </button>
          <button
            type="button" onClick={() => setDraftNotice(null)} aria-label="Dismiss"
            style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '.9rem', lineHeight: 1, fontFamily: 'inherit', minWidth: '2.5rem', minHeight: '2.5rem' }}
          >×</button>
        </div>
      )}

      {/* ── Rotation status ───────────────────────────────────────────────── */}
      {myCycle && (() => {
        const st = CYCLE_STYLES[myCycle.state] ?? CYCLE_STYLES.upcoming
        return (
          <div style={{ background: st.bg, border: `1px solid ${st.border}`, borderRadius: '.25rem', padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              background: st.border, color: '#fff',
              fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
              padding: '.2rem .55rem', borderRadius: '.15rem', flexShrink: 0,
            }}>{st.label}</span>
            <div style={{ flex: 1, minWidth: 240 }}>
              <p style={{ color: 'var(--text)', fontSize: '.8rem', fontWeight: 700 }}>Blog Rotation</p>
              <p style={{ color: st.fg, fontSize: '.75rem', marginTop: '.15rem' }}>{cycleMessage(myCycle)}</p>
            </div>
            <span style={{ color: 'var(--text-3)', fontSize: '.65rem', flexShrink: 0 }}>
              Every coach contributes one blog every 2 months
            </span>
          </div>
        )
      })()}

      {/* ── Editing banner ────────────────────────────────────────────────── */}
      {editingItem && (
        <div style={{ background: 'rgba(39,44,132,.08)', border: '1px solid #272C84', borderRadius: '.25rem', padding: '.875rem 1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <p style={{ color: 'var(--text)', fontSize: '.8rem', fontWeight: 700 }}>
              Editing “{editingItem.type === 'blog' ? editingItem.title : editingItem.meetName}”
            </p>
            <p style={{ color: 'var(--text-2)', fontSize: '.72rem', marginTop: '.15rem' }}>
              {editingItem.status === 'rejected'
                ? 'Saving your changes will resubmit this for head coach review.'
                : 'Saving will update your pending submission.'}
            </p>
          </div>
          <button
            onClick={cancelEdit}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.4rem .875rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
          >
            Cancel Edit
          </button>
        </div>
      )}

      {/* Type toggle */}
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '2rem' }}>
        {(['blog', 'meet'] as const).map(t => (
          <button
            key={t}
            onClick={() => { if (!editingId) setContentType(t) }}
            disabled={!!editingId}
            title={editingId ? 'Finish or cancel your edit first' : undefined}
            style={{
              opacity: editingId && contentType !== t ? .35 : 1,
              background: contentType === t ? '#272C84' : 'transparent',
              border: `1px solid ${contentType === t ? '#c8102e' : 'var(--border)'}`,
              color: contentType === t ? 'var(--text)' : 'var(--text-4)',
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
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '2rem', marginBottom: '2rem' }}>
          <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '1.5rem' }}>
            {editingId ? 'Edit Blog Post' : 'New Blog Post'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={labelStyle}>Title <span style={{ color: 'var(--text)' }}>*</span></label>
              <input style={inputStyle} maxLength={200} placeholder="e.g. Meet Recap — USAPL Raw Nationals 2026" value={blogTitle} onChange={e => setBlogTitle(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Subtitle</label>
              <input style={inputStyle} maxLength={300} placeholder="One-line description for the post header" value={blogSubtitle} onChange={e => setBlogSubtitle(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Tags <span style={{ color: 'var(--text-2)', fontWeight: 400 }}>(comma-separated)</span></label>
              <input style={inputStyle} maxLength={200} placeholder="e.g. Meet Recap, USAPL, Case Study" value={blogTags} onChange={e => setBlogTags(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Summary <span style={{ color: 'var(--text)' }}>*</span></label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                maxLength={1000}
                placeholder="2-3 sentence summary shown on the blog listing page…"
                value={blogSummary}
                onChange={e => setBlogSummary(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Content <span style={{ color: 'var(--text)' }}>*</span></label>

              {/* ── Section List ── */}
              {blogSections.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: '.75rem' }}>
                  {blogSections.map((sec, idx) => (
                    <div key={sec._id} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.2rem', padding: '.75rem' }}>
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
                          <button onClick={() => moveSection(sec._id, -1)} disabled={idx === 0} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.65rem', padding: '.2rem .5rem', borderRadius: '.15rem', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, fontFamily: 'inherit' }}>↑</button>
                          <button onClick={() => moveSection(sec._id,  1)} disabled={idx === blogSections.length - 1} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.65rem', padding: '.2rem .5rem', borderRadius: '.15rem', cursor: idx === blogSections.length - 1 ? 'default' : 'pointer', opacity: idx === blogSections.length - 1 ? 0.3 : 1, fontFamily: 'inherit' }}>↓</button>
                          <button onClick={() => removeSection(sec._id)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.65rem', padding: '.2rem .5rem', borderRadius: '.15rem', cursor: 'pointer', fontFamily: 'inherit' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#272C84'; e.currentTarget.style.color = '#272C84' }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
                          >✕</button>
                        </div>
                      </div>

                      {/* Divider — no input */}
                      {sec.type === 'divider' && (
                        <div style={{ height: 1, background: 'var(--border)', margin: '.3rem 0' }} />
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
                          <p style={{ color: 'var(--text-3)', fontSize: '.6rem', marginBottom: '.35rem' }}>One bullet item per line</p>
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
                  <button key={type} onClick={() => addSection(type)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .75rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-dim)'; e.currentTarget.style.color = 'var(--chalk)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
                  >{label}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button
                onClick={submitBlog}
                disabled={!blogTitle.trim() || !blogSummary.trim() || submitting}
                style={{
                  background: '#272C84',
                  border: 'none',
                  color: 'var(--text)',
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
                {submitting
                  ? (editingId ? 'Saving…' : 'Submitting…')
                  : (editingId ? 'Save Changes →' : 'Submit for Review →')}
              </button>
              {submitted && (
                <span style={{ color: '#22c55e', fontSize: '.75rem', fontWeight: 700 }}>
                  ✓ Saved — pending head coach review
                </span>
              )}
              {submitError && <span style={{ color: '#f87171', fontSize: '.75rem', fontWeight: 700 }}>{submitError}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── Meet Form ─────────────────────────────────────────────────────── */}
      {contentType === 'meet' && (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '2rem', marginBottom: '2rem' }}>
          <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '1.5rem' }}>
            {editingId ? 'Edit Meet / Event' : 'Add Meet / Event'}
          </p>
          <div style={{ display: 'grid', gap: '1.25rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Meet Name <span style={{ color: 'var(--text)' }}>*</span></label>
              <input style={inputStyle} maxLength={200} placeholder="e.g. USAPL Raw Nationals 2026" value={meetName} onChange={e => setMeetName(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Date <span style={{ color: 'var(--text)' }}>*</span></label>
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
              <label style={labelStyle}>Note <span style={{ color: 'var(--text-2)', fontWeight: 400 }}>(shown on site)</span></label>
              <input style={inputStyle} maxLength={300} placeholder="e.g. Axis coaches attending & handling" value={meetNote} onChange={e => setMeetNote(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1.5rem' }}>
            <button
              onClick={submitMeet}
              disabled={!meetName.trim() || !meetDate.trim() || submitting}
              style={{
                background: '#272C84',
                border: 'none',
                color: 'var(--text)',
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
              {submitting
                ? (editingId ? 'Saving…' : 'Submitting…')
                : (editingId ? 'Save Changes →' : 'Submit for Review →')}
            </button>
            {submitted && (
              <span style={{ color: '#22c55e', fontSize: '.75rem', fontWeight: 700 }}>
                ✓ Saved — pending head coach review
              </span>
            )}
            {submitError && <span style={{ color: '#f87171', fontSize: '.75rem', fontWeight: 700 }}>{submitError}</span>}
          </div>
        </div>
      )}

      {/* ── Submission history ────────────────────────────────────────────── */}
      <div>
        <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
          Your Submissions ({loading ? '…' : myItems.length})
        </p>
        {loading ? (
          <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>Loading…</p>
        ) : loadError ? (
          <div style={{ background: 'rgba(200,16,46,.08)', border: '1px solid #c8102e', borderRadius: '.25rem', padding: '1rem 1.25rem' }}>
            <p style={{ color: '#f87171', fontSize: '.8rem', fontWeight: 700 }}>Could not load your submissions</p>
            <p style={{ color: 'var(--text-2)', fontSize: '.75rem', marginTop: '.25rem' }}>{loadError}</p>
            <button
              onClick={refreshItems}
              style={{ marginTop: '.75rem', background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .75rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Retry
            </button>
          </div>
        ) : myItems.length === 0 ? (
          <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>No submissions yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--surface)' }}>
            {myItems.map(item => (
              <div key={item.id} style={{ background: 'var(--bg)', padding: '1.25rem 1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.35rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>
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
                  <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.875rem' }}>
                    {item.type === 'blog' ? item.title : item.meetName}
                  </p>
                  {item.type === 'meet' && item.meetDate && (
                    <p style={{ color: 'var(--text-2)', fontSize: '.75rem', marginTop: '.2rem' }}>{item.meetDate} · {item.meetLocation}</p>
                  )}
                  {item.status === 'rejected' && item.rejectionNote && (
                    <p style={{ color: 'var(--text)', fontSize: '.75rem', marginTop: '.35rem' }}>Note: {item.rejectionNote}</p>
                  )}
                  <p style={{ color: 'var(--text-3)', fontSize: '.65rem', marginTop: '.4rem' }}>
                    Submitted {new Date(item.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                {/* Approved posts are live on the site — a coach reopening one
                    would silently rewrite published content, so the DB refuses
                    it (see 004 RLS) and the buttons are hidden to match. */}
                <div style={{ display: 'flex', gap: '.4rem', flexShrink: 0 }}>
                  {(item.status === 'pending' || item.status === 'rejected') && (
                    <button
                      onClick={() => startEdit(item)}
                      disabled={editingId === item.id}
                      style={{ background: 'none', border: `1px solid ${editingId === item.id ? '#272C84' : 'var(--border)'}`, color: editingId === item.id ? '#272C84' : 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .75rem', borderRadius: '.2rem', cursor: editingId === item.id ? 'default' : 'pointer', fontFamily: 'inherit' }}
                      onMouseEnter={e => { if (editingId !== item.id) { e.currentTarget.style.borderColor = '#272C84'; e.currentTarget.style.color = '#272C84' } }}
                      onMouseLeave={e => { if (editingId !== item.id) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' } }}
                    >
                      {editingId === item.id ? 'Editing…' : item.status === 'rejected' ? 'Revise' : 'Edit'}
                    </button>
                  )}
                  {item.status === 'pending' && (
                    <button
                      onClick={() => handleDelete(item.id)}
                      style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .75rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#c8102e'; e.currentTarget.style.color = '#c8102e' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
