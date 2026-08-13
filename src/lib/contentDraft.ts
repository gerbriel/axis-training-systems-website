/**
 * Local draft for the coach content editor.
 *
 * CoachAdmin renders its tabs conditionally, so switching to Leads unmounts
 * ContentPublisher and takes every keystroke with it — as did a reload, a
 * back-swipe, or a phone browser discarding the tab. A half-written blog post
 * is 20 minutes of a coach's evening, so the composer keeps a local draft and
 * restores it on the way back in.
 *
 * localStorage, not the server: a draft is not a submission. Nothing here is
 * reviewable, nothing enters the approval queue, and no RLS policy applies.
 */

const PREFIX = 'axis_content_draft'

/** `S` is the caller's section type — kept generic so this module does not
 *  reach back into the component for its editor types. */
export interface ContentDraft<S> {
  contentType: 'blog' | 'meet'
  /** The submission being revised, if any. Re-validated against the server on restore. */
  editingId: string | null
  blog: {
    title: string
    subtitle: string
    tags: string
    summary: string
    sections: S[]
  }
  meet: {
    name: string
    date: string
    location: string
    federation: string
    type: string
    note: string
  }
  savedAt: string
}

/** Demo drafts are kept apart so a preview never overwrites a coach's real work. */
function key(coachSlug: string, isDemo: boolean): string {
  return `${PREFIX}${isDemo ? '_demo' : ''}_${coachSlug}`
}

export function loadDraft<S>(coachSlug: string, isDemo: boolean): ContentDraft<S> | null {
  try {
    const raw = window.localStorage.getItem(key(coachSlug, isDemo))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ContentDraft<S>
    // A shape change or hand-edited storage must not brick the composer.
    if (!parsed?.blog || !parsed?.meet || !Array.isArray(parsed.blog.sections)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveDraft<S>(coachSlug: string, isDemo: boolean, draft: ContentDraft<S>): void {
  try {
    window.localStorage.setItem(key(coachSlug, isDemo), JSON.stringify(draft))
  } catch {
    // Private mode or a full quota — a lost draft must never break typing.
  }
}

export function clearDraft(coachSlug: string, isDemo: boolean): void {
  try {
    window.localStorage.removeItem(key(coachSlug, isDemo))
  } catch {
    // Ignore.
  }
}

/**
 * Is there anything worth keeping? An untouched composer (one blank paragraph,
 * every field empty) must not produce a draft — otherwise the coach gets a
 * "draft restored" banner for work they never did.
 */
export function draftHasContent<S extends { text?: string; items?: string; label?: string; type?: string }>(
  draft: ContentDraft<S>
): boolean {
  const b = draft.blog
  if (b.title.trim() || b.subtitle.trim() || b.tags.trim() || b.summary.trim()) return true
  if (b.sections.some(s => (s.text ?? '').trim() || (s.items ?? '').trim() || (s.label ?? '').trim())) return true

  const m = draft.meet
  return Boolean(m.name.trim() || m.date.trim() || m.location.trim() || m.federation.trim() || m.note.trim())
}

/**
 * A stable signature of the composer's *content*, for answering "has the coach
 * actually changed anything?" — as opposed to draftHasContent, which only asks
 * "is there text here at all". Loading a submission for editing fills the form
 * with that submission's own words; without a baseline to compare against, the
 * unsaved-work prompt would fire for work the coach never did.
 *
 * Section `_id`s are excluded: they are regenerated on every deserialize, so
 * they would make an untouched form look different from itself.
 */
export function draftFingerprint<S extends { _id?: string }>(draft: ContentDraft<S>): string {
  const sections = draft.blog.sections.map(({ _id: _ignored, ...rest }) => rest)
  return JSON.stringify([draft.contentType, { ...draft.blog, sections }, draft.meet])
}

/** "just now" / "12 minutes ago" / "3 hours ago" — no dependency for one string. */
export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
