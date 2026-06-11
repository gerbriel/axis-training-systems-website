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

export function getPendingContent(): PendingContent[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}

export function addPendingContent(
  item: Omit<PendingContent, 'id' | 'submittedAt' | 'status'>
): PendingContent {
  const all = getPendingContent()
  const newItem: PendingContent = {
    ...item,
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
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
  const all = getPendingContent()
  const updated = all.map(item =>
    item.id === id
      ? { ...item, status, reviewedAt: new Date().toISOString(), ...(rejectionNote ? { rejectionNote } : {}) }
      : item
  )
  localStorage.setItem(KEY, JSON.stringify(updated))
}

export function deleteContent(id: string): void {
  const all = getPendingContent()
  localStorage.setItem(KEY, JSON.stringify(all.filter(i => i.id !== id)))
}

export function getApprovedPosts(): PendingContent[] {
  return getPendingContent().filter(c => c.type === 'blog' && c.status === 'approved')
}

export function getApprovedMeets(): PendingContent[] {
  return getPendingContent().filter(c => c.type === 'meet' && c.status === 'approved')
}
