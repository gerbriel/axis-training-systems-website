import { sanitize, sanitizeShort, sanitizeStrict } from '../utils/sanitize'

export type ContentType = 'blog' | 'meet'
export type ContentStatus = 'pending' | 'approved' | 'rejected'

export interface PendingContent {
  id: string
  type: ContentType
  coachSlug: string
  coachName: string
  status: ContentStatus
  submittedAt: string
  reviewedAt?: string
  rejectionNote?: string
  // Blog fields
  title?: string
  subtitle?: string
  tags?: string          // comma-separated
  summary?: string
  content?: string       // paragraphs separated by \n\n
  // Meet fields
  meetName?: string
  meetDate?: string
  meetLocation?: string
  federation?: string
  meetType?: string      // 'National' | 'Regional' | 'World' | 'Local'
  meetNote?: string
}

const KEY = 'axis_pending_content'

// Max number of items stored (prevents localStorage flooding)
const MAX_ITEMS = 200
// Max items per coach to prevent spam
const MAX_PER_COACH = 30

const VALID_TYPES    = new Set<string>(['blog', 'meet'])
const VALID_STATUSES = new Set<string>(['pending', 'approved', 'rejected'])
const VALID_MEET_TYPES = new Set<string>(['National', 'Regional', 'World', 'Local'])

/** Validate and sanitize a single item coming out of localStorage. */
function validateItem(raw: unknown): PendingContent | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  // Required fields with strict type and value checks
  if (typeof r.id !== 'string' || !/^[a-z0-9]{8,32}$/.test(r.id)) return null
  if (!VALID_TYPES.has(r.type as string))    return null
  if (!VALID_STATUSES.has(r.status as string)) return null
  if (typeof r.coachSlug !== 'string' || !/^[a-z0-9-]{2,50}$/.test(r.coachSlug)) return null
  if (typeof r.coachName !== 'string' || r.coachName.length < 1 || r.coachName.length > 100) return null
  if (typeof r.submittedAt !== 'string') return null

  // Validate date strings (ISO format)
  const dateOk = (v: unknown) => typeof v === 'string' && !isNaN(Date.parse(v as string))
  if (!dateOk(r.submittedAt)) return null
  if (r.reviewedAt !== undefined && !dateOk(r.reviewedAt)) return null

  // Sanitize all optional string fields
  const str = (v: unknown, max = 200) => (typeof v === 'string' ? sanitize(v, max) : undefined)

  return {
    id:          r.id,
    type:        r.type as ContentType,
    coachSlug:   r.coachSlug,
    coachName:   sanitizeStrict(r.coachName as string),
    status:      r.status as ContentStatus,
    submittedAt: r.submittedAt,
    reviewedAt:  typeof r.reviewedAt === 'string' ? r.reviewedAt : undefined,
    rejectionNote: str(r.rejectionNote, 500),
    // Blog fields
    title:     str(r.title, 200),
    subtitle:  str(r.subtitle, 300),
    tags:      str(r.tags, 200),
    summary:   str(r.summary, 1000),
    content:   str(r.content, 8000),
    // Meet fields
    meetName:     str(r.meetName, 200),
    meetDate:     str(r.meetDate, 100),
    meetLocation: str(r.meetLocation, 200),
    federation:   str(r.federation, 50),
    meetType:     VALID_MEET_TYPES.has(r.meetType as string) ? (r.meetType as string) : 'Local',
    meetNote:     str(r.meetNote, 300),
  }
}

export function getPendingContent(): PendingContent[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(validateItem).filter((x): x is PendingContent => x !== null)
  } catch {
    return []
  }
}

/** Sanitize all string fields of an item before writing to localStorage. */
function sanitizeItem(
  item: Omit<PendingContent, 'id' | 'submittedAt' | 'status'>
): Omit<PendingContent, 'id' | 'submittedAt' | 'status'> {
  return {
    type:        VALID_TYPES.has(item.type) ? item.type : 'blog' as ContentType,
    coachSlug:   sanitizeStrict(item.coachSlug ?? ''),
    coachName:   sanitizeStrict(item.coachName ?? ''),
    // Blog fields
    title:       item.title    ? sanitizeShort(item.title).slice(0, 200) : undefined,
    subtitle:    item.subtitle ? sanitize(item.subtitle, 300)  : undefined,
    tags:        item.tags     ? sanitize(item.tags, 200)      : undefined,
    summary:     item.summary  ? sanitize(item.summary, 1000)  : undefined,
    content:     item.content  ? sanitize(item.content, 8000)  : undefined,
    // Meet fields
    meetName:     item.meetName     ? sanitizeShort(item.meetName).slice(0, 200) : undefined,
    meetDate:     item.meetDate     ? sanitize(item.meetDate, 100)     : undefined,
    meetLocation: item.meetLocation ? sanitize(item.meetLocation, 200) : undefined,
    federation:   item.federation   ? sanitize(item.federation, 50)    : undefined,
    meetType:     VALID_MEET_TYPES.has(item.meetType ?? '') ? item.meetType : 'Local',
    meetNote:     item.meetNote     ? sanitize(item.meetNote, 300)     : undefined,
  }
}

export function addPendingContent(
  item: Omit<PendingContent, 'id' | 'submittedAt' | 'status'>
): PendingContent {
  const all = getPendingContent()

  // Enforce total item cap
  if (all.length >= MAX_ITEMS) {
    // Remove oldest approved/rejected to make room
    const pruned = all
      .filter(c => c.status !== 'pending')
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
    if (pruned.length > 0) {
      const keepIds = new Set(pruned.slice(1).map(c => c.id))
      const trimmed = all.filter(c => c.status === 'pending' || keepIds.has(c.id))
      if (trimmed.length >= MAX_ITEMS) throw new Error('Content limit reached')
    } else {
      throw new Error('Content limit reached')
    }
  }

  // Enforce per-coach cap
  const coachItems = all.filter(c => c.coachSlug === item.coachSlug && c.status === 'pending')
  if (coachItems.length >= MAX_PER_COACH) {
    throw new Error('Pending submission limit reached — wait for existing posts to be reviewed')
  }

  const sanitized = sanitizeItem(item)
  const newItem: PendingContent = {
    ...sanitized,
    id: crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 24) : Math.random().toString(36).slice(2) + Date.now().toString(36),
    status: 'pending',
    submittedAt: new Date().toISOString(),
  }

  localStorage.setItem(KEY, JSON.stringify([...all, newItem]))
  return newItem
}

export function updateContentStatus(
  id: string,
  status: ContentStatus,
  rejectionNote?: string
): void {
  if (!VALID_STATUSES.has(status)) return
  const safeId = typeof id === 'string' ? id : ''
  const safeNote = rejectionNote ? sanitize(rejectionNote, 500) : undefined
  const all = getPendingContent()
  const updated = all.map(item =>
    item.id === safeId
      ? { ...item, status, reviewedAt: new Date().toISOString(), ...(safeNote ? { rejectionNote: safeNote } : {}) }
      : item
  )
  localStorage.setItem(KEY, JSON.stringify(updated))
}

export function deleteContent(id: string): void {
  const safeId = typeof id === 'string' ? id : ''
  const all = getPendingContent()
  localStorage.setItem(KEY, JSON.stringify(all.filter(i => i.id !== safeId)))
}

export function getApprovedPosts(): PendingContent[] {
  return getPendingContent().filter(c => c.type === 'blog' && c.status === 'approved')
}

export function getApprovedMeets(): PendingContent[] {
  return getPendingContent().filter(c => c.type === 'meet' && c.status === 'approved')
}
