import { useState, useEffect, useCallback, useMemo } from 'react'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { clampInt } from '../../utils/sanitize'
import { usePermissions } from '../../lib/usePermissions'
import {
  fetchAllResources, createResource, updateResource, deleteResource, duplicateResource,
  setPublished, reorderResource, planReorder,
  slugFromTitle, nextSortOrder, sortResources,
  CREATABLE_KINDS, KIND_LABELS,
  type ResourceItem, type ResourceKind,
} from '../../lib/resourceLibrary'
import {
  parseGuideContent, defaultContentFor, blankContentFor, CONTENT_TYPE_LABELS,
  type GuideContent, type GuideContentType,
} from '../../lib/guideContent'
import type { ResourceAttachment } from '../../lib/resourceFiles'
import AttachmentManager from '../../components/admin/AttachmentManager'
import GuideContentEditor from '../../components/admin/guide-editors'

/**
 * The free resources area, managed.
 *
 * Everything under "Free Stuff" is a row now (migration 041): the five
 * calculators, the six guides, and anything the owner adds. What is editable
 * differs by what is behind the row, and the screen says so rather than
 * offering a control that would fail:
 *
 *   A built-in tool or guide is half a React component. Its copy, badge,
 *   position, signup gate and published state are the owner's; its slug is not
 *   (it is the key the page looks the component up by), and it cannot be
 *   deleted at all. Unpublishing is the reversible way to take one down, and
 *   the database refuses the delete regardless of what this file renders.
 *
 *   A custom resource (link, download, article) is wholly content. Everything
 *   about it is editable and it can be removed.
 *
 * Two things a row now carries beyond its own copy, both under `config` and
 * both edited in the expandable panel behind the Content button rather than in
 * the metadata form:
 *
 *   A guide's CONTENT — the checklist items, the quiz questions, the reference
 *   table. A built-in guide with nothing stored renders what it shipped with,
 *   so opening the editor shows those defaults and saving turns them into an
 *   override the owner keeps. Restore original takes the override away again;
 *   it does not write the defaults back, it removes the key, which is what
 *   makes a later correction in the bundle still reach the page.
 *
 *   FILES, on a guide or an article. Same panel, same save. Not on a link or a
 *   download: those cards are anchors that leave the site rather than expanding
 *   in place, so there is nowhere on the page for the list to appear.
 *
 * The permission notice is SIGNAGE. RLS in 041 is what actually refuses a
 * write from someone without manage_resource_library; this only spares them a
 * screen of red boxes. The sibling tab does the gating that hides the tab.
 */

const ACCENT = '#272C84'
const DANGER = '#c8102e'
const GREEN = '#22c55e'

const microLabel: React.CSSProperties = {
  color: 'var(--text)', fontSize: '.6rem', fontWeight: 900,
  letterSpacing: '.3em', textTransform: 'uppercase',
}
const heading: React.CSSProperties = {
  color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem',
  textTransform: 'uppercase', letterSpacing: '-.01em',
}
const btn = (bg: string, fg: string): React.CSSProperties => ({
  background: bg, border: 'none', color: fg, fontWeight: 900, fontSize: '.62rem',
  letterSpacing: '.12em', textTransform: 'uppercase', padding: '.55rem 1.1rem',
  minHeight: '2.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
})
const btnGhost = (color: string): React.CSSProperties => ({
  background: 'transparent', border: `1px solid ${color}`, color,
  fontWeight: 700, fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase',
  padding: '.55rem 1.1rem', minHeight: '2.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
})
const arrowBtn = (enabled: boolean): React.CSSProperties => ({
  background: 'transparent', border: '1px solid var(--border-mid)',
  color: enabled ? 'var(--text-2)' : 'var(--text-4)',
  width: '2rem', minHeight: '2.5rem', borderRadius: '.25rem', fontSize: '.7rem',
  cursor: enabled ? 'pointer' : 'default', fontFamily: 'inherit', padding: 0,
})
const chip = (color: string): React.CSSProperties => ({
  color, fontSize: '.55rem', fontWeight: 700, letterSpacing: '.1em',
  textTransform: 'uppercase', border: `1px solid ${color}55`,
  padding: '.1rem .4rem', borderRadius: '.2rem', whiteSpace: 'nowrap',
})

function Switch({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick} role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      style={{
        flexShrink: 0, width: 38, height: 22, borderRadius: 999, padding: 0,
        background: on ? ACCENT : 'var(--surface-2)',
        border: `1px solid ${on ? ACCENT : 'var(--border-mid)'}`,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        position: 'relative', transition: 'background .15s',
      }}
    >
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: on ? '#fff' : 'var(--text-4)', transition: 'left .15s' }} />
    </button>
  )
}

// ── The draft a form holds ───────────────────────────────────────────────────

interface Draft {
  kind: ResourceKind
  title: string
  slug: string
  description: string
  tag: string
  sortOrder: number
  requiresSignup: boolean
  isPublished: boolean
  /** config, flattened: link/download use url, download adds fileLabel, article uses body. */
  url: string
  fileLabel: string
  body: string
  /** New interactive guides only: which of the five a blank one is built from. */
  contentType: GuideContentType
}

const BLANK: Draft = {
  kind: 'link', title: '', slug: '', description: '', tag: '',
  sortOrder: 0, requiresSignup: false, isPublished: true,
  url: '', fileLabel: '', body: '', contentType: 'checklist',
}

function draftOf(item: ResourceItem): Draft {
  const c = item.config ?? {}
  return {
    kind: item.kind,
    title: item.title,
    slug: item.slug,
    description: item.description,
    tag: item.tag ?? '',
    sortOrder: item.sort_order,
    requiresSignup: item.requires_signup,
    isPublished: item.is_published,
    url: typeof c.url === 'string' ? c.url : '',
    fileLabel: typeof c.file_label === 'string' ? c.file_label : '',
    body: typeof c.body === 'string' ? c.body : '',
    contentType: 'checklist',
  }
}

/**
 * The draft as a config, with the parts this form does not edit carried over.
 *
 * `base` is the row's config as it stands. A guide's content and any resource's
 * files are edited in the other panel, and a metadata save must not be the
 * thing that removes them — an update writes `config` whole, so anything left
 * out of this object is deleted from the row.
 */
function configOf(d: Draft, base: Record<string, unknown> = {}): Record<string, unknown> {
  const carried: Record<string, unknown> = {}
  if (base.content !== undefined) carried.content = base.content
  if (Array.isArray(base.attachments) && base.attachments.length > 0) carried.attachments = base.attachments

  if (d.kind === 'article') return { ...carried, body: d.body }
  if (d.kind === 'link') return { ...carried, url: d.url }
  if (d.kind === 'download') return { ...carried, url: d.url, file_label: d.fileLabel }
  return carried
}

/** The files on a row, as the manager wants them. */
function filesOf(item: ResourceItem): ResourceAttachment[] {
  const raw = item.config?.attachments
  return Array.isArray(raw) ? (raw as ResourceAttachment[]) : []
}

/**
 * What the content editor should open with, or null for a guide that has none.
 *
 * The order matters: what the owner has written, then what the guide ships
 * with, then nothing. Null is the attempt planner, whose numbers live in the
 * calculator settings rather than on this row.
 */
function contentOf(item: ResourceItem): GuideContent | null {
  if (item.kind !== 'guide') return null
  return parseGuideContent(item.config) ?? defaultContentFor(item.builtin_key)
}

/** A built-in guide whose shipped content has been written over. */
function hasOverride(item: ResourceItem): boolean {
  return item.kind === 'guide' && item.builtin_key !== null && parseGuideContent(item.config) !== null
}

/** Every kind but a tool can be copied, and a guide only if there is content to
 *  copy: see duplicateResource, which refuses both with a sentence. */
function canCopy(item: ResourceItem): boolean {
  if (item.kind === 'tool') return false
  return item.kind !== 'guide' || contentOf(item) !== null
}

/**
 * Which rows have something behind the Content / Files button.
 *
 * A guide and an article, because those are the two whose card OPENS on the
 * public page and so has somewhere to put a list of files under it. A link and
 * a download are plain anchors that go straight off the site: a file attached
 * to one saves and then renders nowhere, which is a promise this panel should
 * not make. `validateConfig` still accepts attachments on all four, so a row
 * that already carries one stays valid and nothing is thrown away behind
 * anyone's back.
 */
function hasEditor(item: ResourceItem): boolean {
  return item.kind === 'guide' || item.kind === 'article'
}

const KIND_ADD_LABELS: Partial<Record<ResourceKind, string>> = { guide: 'Interactive guide' }

const CONTENT_TYPES: GuideContentType[] = ['checklist', 'quiz', 'reference', 'sections', 'worksheet']

const GROUPS: { key: string; label: string; blurb: string; kinds: ResourceKind[] }[] = [
  {
    key: 'tools', label: 'Tools', kinds: ['tool'],
    blurb: 'The calculators at /tools. Each one is a built-in, so the copy and the order are yours to change and the tool itself stays put.',
  },
  {
    key: 'guides', label: 'Guides', kinds: ['guide'],
    blurb: 'The guides on the free stuff page, and what is inside them. Content opens the checklist, the questions or the table behind a guide; Copy makes an independent draft of one. New guides are added with the button at the bottom of this page.',
  },
  {
    key: 'custom', label: 'Custom resources', kinds: ['link', 'download', 'article'],
    blurb: 'Anything you add: a link out, a file to download, or an article written here. These can be removed.',
  },
]

export default function ResourceLibraryPanel({ isDemo = false }: { isDemo?: boolean }) {
  const { ready, can } = usePermissions()
  const canManage = isDemo || can('manage_resource_library') || can('*')

  const [items, setItems] = useState<ResourceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState<Draft>(BLANK)
  const [busy, setBusy] = useState(false)
  const [armedDelete, setArmedDelete] = useState<string | null>(null)

  // The content and files panel, which is a second expandable on the same rows
  // rather than a page of its own: what is being edited only makes sense next
  // to the row it belongs to.
  const [contentId, setContentId] = useState<string | null>(null)
  const [contentDraft, setContentDraft] = useState<GuideContent | null>(null)
  const [fileDraft, setFileDraft] = useState<ResourceAttachment[]>([])
  // A refusal from THIS panel stays in it. The banner at the top of the page is
  // level with the first row, and a guide edited eight rows down is a screen and
  // a half away from it: pressing Save and seeing nothing happen is how a person
  // decides the button is broken. Row-level operations keep the banner, because
  // their button is up there with it.
  const [contentError, setContentError] = useState<string | null>(null)

  const say = (msg: string) => { setFlash(msg); window.setTimeout(() => setFlash(null), 2500) }

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    const rows = await fetchAllResources(isDemo)
    if (rows === null) { setOutage(true); setItems([]) }
    else { setOutage(false); setItems(sortResources(rows)) }
    setLoading(false)
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  const sorted = useMemo(() => sortResources(items), [items])

  const startEdit = (item: ResourceItem) => {
    setEditingId(item.id)
    setDraft(draftOf(item))
    setError(null)
    setArmedDelete(null)
    setAdding(false)
    setContentId(null)
  }

  const saveEdit = async (item: ResourceItem) => {
    if (busy) return
    setBusy(true); setError(null)
    const isBuiltin = item.builtin_key !== null
    const res = await updateResource(item.id, {
      kind: item.kind,
      title: draft.title,
      description: draft.description,
      tag: draft.tag,
      sort_order: draft.sortOrder,
      requires_signup: draft.requiresSignup,
      is_published: draft.isPublished,
      // A built-in keeps its slug: it is the route the bundle knows, and this
      // form is not where a live URL gets renamed. The config goes with the
      // slug for built-ins because a built-in's content is edited in the other
      // panel, and configOf carries the rest of it across for everyone else.
      ...(isBuiltin ? {} : {
        slug: draft.slug || slugFromTitle(draft.title),
        config: configOf(draft, item.config ?? {}),
      }),
    }, isDemo)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setEditingId(null)
    say('Saved.')
    await load(true)
  }

  // ── Content and files ──────────────────────────────────────────────────────

  const startContent = (item: ResourceItem) => {
    setContentId(item.id)
    setContentDraft(contentOf(item))
    setFileDraft(filesOf(item))
    setEditingId(null)
    setAdding(false)
    setError(null)
    setContentError(null)
    setArmedDelete(null)
  }

  const closeContent = () => {
    setContentId(null)
    setContentDraft(null)
    setFileDraft([])
    setError(null)
    setContentError(null)
  }

  /** Both halves of the panel go in one write, on top of whatever else the row
   *  is carrying, because `config` is replaced whole rather than merged. */
  const saveContent = async (item: ResourceItem) => {
    if (busy) return
    setBusy(true); setContentError(null)
    const next: Record<string, unknown> = { ...(item.config ?? {}) }
    if (contentDraft) next.content = contentDraft
    if (fileDraft.length > 0) next.attachments = fileDraft
    else delete next.attachments

    const res = await updateResource(item.id, { kind: item.kind, config: next }, isDemo)
    setBusy(false)
    if (!res.ok) { setContentError(res.message); return }
    closeContent()
    say('Saved.')
    await load(true)
  }

  /**
   * Back to the guide as it shipped.
   *
   * The content KEY is removed rather than the defaults written into it. A row
   * with no content reads its copy out of the bundle every time, so a later
   * correction there still reaches the page; a row storing today's defaults is
   * frozen at today.
   */
  const restoreContent = async (item: ResourceItem) => {
    if (busy) return
    setBusy(true); setContentError(null)
    const next: Record<string, unknown> = { ...(item.config ?? {}) }
    delete next.content

    const res = await updateResource(item.id, { kind: item.kind, config: next }, isDemo)
    setBusy(false)
    if (!res.ok) { setContentError(res.message); return }
    closeContent()
    say('Back to the guide as it shipped.')
    await load(true)
  }

  const copy = async (item: ResourceItem) => {
    if (busy) return
    setBusy(true); setError(null)
    const res = await duplicateResource(item, isDemo)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    say('Copied. The copy is hidden until you publish it.')
    await load(true)
  }

  const togglePublished = async (item: ResourceItem) => {
    if (busy) return
    setBusy(true); setError(null)
    const res = await setPublished(item.id, !item.is_published, isDemo)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    say(item.is_published ? 'Hidden from the site.' : 'Live on the site.')
    await load(true)
  }

  const move = async (item: ResourceItem, direction: 'up' | 'down') => {
    if (busy) return
    setBusy(true); setError(null)
    const res = await reorderResource(sorted, item.id, direction, isDemo)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    await load(true)
  }

  const add = async () => {
    if (busy) return
    setBusy(true); setError(null)
    const res = await createResource({
      kind: newDraft.kind,
      title: newDraft.title,
      slug: newDraft.slug,
      description: newDraft.description,
      tag: newDraft.tag,
      sort_order: newDraft.sortOrder,
      is_published: newDraft.isPublished,
      requires_signup: newDraft.requiresSignup,
      // A new guide is born empty in the shape it was asked for, and is filled
      // in from its own Content button once it exists. Everything it needs to
      // render is in there, which is what lets it have no builtin_key at all.
      config: newDraft.kind === 'guide'
        ? { content: blankContentFor(newDraft.contentType) }
        : configOf(newDraft),
    }, isDemo)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setNewDraft(BLANK)
    setAdding(false)
    say(newDraft.kind === 'guide' ? 'Guide added. Open Content to write it.' : 'Resource added.')
    await load(true)
  }

  const remove = async (item: ResourceItem) => {
    if (busy) return
    setBusy(true); setError(null)
    const res = await deleteResource(item, isDemo)
    setBusy(false)
    setArmedDelete(null)
    if (!res.ok) { setError(res.message); return }
    if (contentId === item.id) closeContent()
    say('Resource removed.')
    await load(true)
  }

  const openAdd = () => {
    setAdding(true)
    setEditingId(null)
    setContentId(null)
    setError(null)
    setNewDraft({ ...BLANK, sortOrder: nextSortOrder(items, 'link') })
  }

  /**
   * Picking a kind in the add form re-homes the new row at the bottom of that
   * kind's group and rebuilds every default that depends on the kind, rather
   * than layering one kind's answers over another's.
   *
   * A guide arrives hidden, because it has no content in it yet. Everything
   * else arrives live. Switching Guide → Link has to put the switch BACK, or
   * the link inherits a guide's reason for being hidden and the owner adds a
   * card they cannot find on the site. What a person typed (title, badge,
   * description, address) is theirs and is carried across untouched.
   */
  const pickNewKind = (kind: ResourceKind) => {
    setNewDraft({
      ...newDraft,
      kind,
      sortOrder: nextSortOrder(items, kind),
      isPublished: kind === 'guide' ? false : BLANK.isPublished,
    })
  }

  // ── Form fields ────────────────────────────────────────────────────────────

  const commonFields = (d: Draft, set: (d: Draft) => void, prefix: string, editable: { slug: boolean }) => (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '.75rem', alignItems: 'end' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="field-label" htmlFor={`${prefix}-title`}>Title</label>
          <input id={`${prefix}-title`} className="field" maxLength={160} value={d.title}
            placeholder="Meet Day Checklist"
            onChange={e => set({
              ...d,
              title: e.target.value,
              slug: editable.slug && (!d.slug || d.slug === slugFromTitle(d.title)) ? slugFromTitle(e.target.value) : d.slug,
            })} />
        </div>
        {editable.slug && (
          <div>
            <label className="field-label" htmlFor={`${prefix}-slug`}>Slug</label>
            <input id={`${prefix}-slug`} className="field" maxLength={60} value={d.slug}
              placeholder="meet-day-checklist"
              onChange={e => set({ ...d, slug: e.target.value })} />
          </div>
        )}
        <div>
          <label className="field-label" htmlFor={`${prefix}-tag`}>Badge</label>
          <input id={`${prefix}-tag`} className="field" maxLength={60} value={d.tag}
            placeholder="Free Checklist"
            onChange={e => set({ ...d, tag: e.target.value })} />
        </div>
        <div style={{ maxWidth: 120 }}>
          <label className="field-label" htmlFor={`${prefix}-sort`}>Order</label>
          <input id={`${prefix}-sort`} className="field" type="number" value={d.sortOrder}
            onChange={e => set({ ...d, sortOrder: clampInt(e.target.value, 0, 100000, 0) })} />
        </div>
      </div>

      <div>
        <label className="field-label" htmlFor={`${prefix}-desc`}>Description</label>
        <textarea id={`${prefix}-desc`} className="field" rows={2} maxLength={600} value={d.description}
          placeholder="What a visitor gets out of it."
          onChange={e => set({ ...d, description: e.target.value })} />
      </div>

      {d.kind === 'link' && (
        <div>
          <label className="field-label" htmlFor={`${prefix}-url`}>Link address</label>
          <input id={`${prefix}-url`} className="field" maxLength={2000} value={d.url}
            placeholder="https://example.com/rulebook"
            onChange={e => set({ ...d, url: e.target.value })} />
        </div>
      )}

      {d.kind === 'download' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '.75rem' }}>
          <div>
            <label className="field-label" htmlFor={`${prefix}-file`}>File address</label>
            <input id={`${prefix}-file`} className="field" maxLength={2000} value={d.url}
              placeholder="https://example.com/checklist.pdf"
              onChange={e => set({ ...d, url: e.target.value })} />
          </div>
          <div>
            <label className="field-label" htmlFor={`${prefix}-filelabel`}>Button label</label>
            <input id={`${prefix}-filelabel`} className="field" maxLength={80} value={d.fileLabel}
              placeholder="Download the PDF"
              onChange={e => set({ ...d, fileLabel: e.target.value })} />
          </div>
        </div>
      )}

      {d.kind === 'article' && (
        <div>
          <label className="field-label" htmlFor={`${prefix}-body`}>Article body</label>
          <textarea id={`${prefix}-body`} className="field" rows={10} maxLength={50000} value={d.body}
            placeholder={'Markdown. ## A heading, **bold**, and a list:\n- one\n- two'}
            onChange={e => set({ ...d, body: e.target.value })} />
          <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.3rem' }}>
            Markdown. Headings, bold, lists and links. HTML is stripped out before it is saved.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', cursor: 'pointer' }}>
          <Switch on={d.requiresSignup} onClick={() => set({ ...d, requiresSignup: !d.requiresSignup })} label="Ask for an email" />
          <span style={{ color: 'var(--text-3)', fontSize: '.75rem', fontWeight: 600 }}>
            {d.requiresSignup ? 'Asks for an email first' : 'Open to everyone'}
          </span>
        </label>
        <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', cursor: 'pointer' }}>
          <Switch on={d.isPublished} onClick={() => set({ ...d, isPublished: !d.isPublished })} label="Published" />
          <span style={{ color: 'var(--text-3)', fontSize: '.75rem', fontWeight: 600 }}>{d.isPublished ? 'Live' : 'Hidden'}</span>
        </label>
      </div>
    </>
  )

  // ── The content and files panel ────────────────────────────────────────────
  //
  // One expandable, two jobs, because they save together: a guide's content and
  // the files hanging off any row both live in `config` and both go through one
  // update. A guide with no content of its own (the attempt planner) gets the
  // note instead of a form, and keeps its files.

  const renderContentPanel = (item: ResourceItem) => {
    const editable = contentDraft !== null
    const isGuide = item.kind === 'guide'

    return (
      <div style={{
        marginTop: '.9rem', borderTop: '1px solid var(--surface-2)', paddingTop: '.9rem',
        display: 'flex', flexDirection: 'column', gap: '.9rem',
      }}>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <p style={microLabel}>{isGuide ? 'Guide content' : 'Files'}</p>
          {editable && contentDraft && (
            <span style={{ color: 'var(--text-4)', fontSize: '.7rem' }}>
              {CONTENT_TYPE_LABELS[contentDraft.type]}
            </span>
          )}
        </div>

        {isGuide && !editable && (
          <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.65, maxWidth: 560 }}>
            {item.builtin_key === 'attempts' ? (
              <>
                This one is the attempt planner, and it has no words to edit: it is built out of the
                percentages the calculator uses. Change those on the Calculators tab and this guide
                follows them. Its title, badge and gate are still yours, on the Edit button above.
              </>
            ) : (
              <>
                There is nothing stored on this guide to edit, and no shipped version to fall back on.
                Reload the page, and if it is still empty it needs a developer. You can still attach
                files to it below.
              </>
            )}
          </p>
        )}

        {editable && contentDraft && (
          <GuideContentEditor value={contentDraft} onChange={setContentDraft} disabled={!canManage} />
        )}

        <div>
          {isGuide && <p style={{ ...microLabel, marginBottom: '.5rem' }}>Attached files</p>}
          <AttachmentManager
            attachments={fileDraft}
            onChange={setFileDraft}
            isDemo={isDemo}
            disabled={!canManage}
          />
        </div>

        {canManage && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={() => void saveContent(item)} disabled={busy} style={btn(ACCENT, '#fff')}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button onClick={closeContent} style={btnGhost('var(--text-3)')}>Cancel</button>
              {hasOverride(item) && (
                <>
                  <button onClick={() => void restoreContent(item)} disabled={busy} style={btnGhost(DANGER)}>
                    Restore original
                  </button>
                  <span style={{ color: 'var(--text-4)', fontSize: '.68rem' }}>
                    Puts back the version this guide shipped with and drops your edits.
                  </span>
                </>
              )}
            </div>
            {contentError && (
              <div role="alert" style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.6rem .8rem' }}>
                <span style={{ color: DANGER, fontSize: '.78rem', lineHeight: 1.55 }}>{contentError}</span>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── One row ────────────────────────────────────────────────────────────────

  const renderRow = (item: ResourceItem) => {
    const isBuiltin = item.builtin_key !== null
    const canUp = !!planReorder(sorted, item.id, 'up')
    const canDown = !!planReorder(sorted, item.id, 'down')
    const editing = editingId === item.id
    const openContent = contentId === item.id

    return (
      <div key={item.id} style={{ borderBottom: '1px solid var(--surface)', padding: '.9rem 1.1rem', background: editing || openContent ? 'var(--surface)' : 'transparent' }}>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
            {commonFields(draft, setDraft, `edit-${item.id}`, { slug: !isBuiltin })}
            {isBuiltin && (
              <p style={{ color: 'var(--text-4)', fontSize: '.7rem' }}>
                Built into the site. Its address stays <code>{item.slug}</code>, because that is how the page finds it,
                and it cannot be removed. Unpublish it to take it down.
              </p>
            )}
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              <button onClick={() => void saveEdit(item)} disabled={busy} style={btn(ACCENT, '#fff')}>{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={() => setEditingId(null)} style={btnGhost('var(--text-3)')}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: item.is_published ? 'var(--text)' : 'var(--text-4)', fontWeight: 700, fontSize: '.9rem' }}>{item.title}</span>
                  {item.tag && <span style={chip('var(--text-3)')}>{item.tag}</span>}
                  {!item.is_published && <span style={chip('var(--text-4)')}>Hidden</span>}
                  {item.requires_signup && <span style={chip(ACCENT)}>Email first</span>}
                  {hasOverride(item) && <span style={chip(ACCENT)}>Edited</span>}
                </div>
                <span style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>
                  {KIND_LABELS[item.kind]} · /{item.slug} · order {item.sort_order}
                  {isBuiltin ? ' · built in' : ''}
                  {filesOf(item).length > 0 ? ` · ${filesOf(item).length} file${filesOf(item).length === 1 ? '' : 's'}` : ''}
                </span>
              </div>

              {canManage && armedDelete === item.id ? (
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-2)', fontSize: '.72rem' }}>Remove it?</span>
                  <button onClick={() => void remove(item)} disabled={busy} style={btn(DANGER, '#fff')}>Remove</button>
                  <button onClick={() => setArmedDelete(null)} style={btnGhost('var(--text-3)')}>Cancel</button>
                </div>
              ) : canManage ? (
                <div style={{ display: 'flex', gap: '.4rem', flexShrink: 0, flexWrap: 'wrap' }}>
                  <button onClick={() => void move(item, 'up')} disabled={!canUp || busy} style={arrowBtn(canUp)} aria-label={`Move ${item.title} up`}>↑</button>
                  <button onClick={() => void move(item, 'down')} disabled={!canDown || busy} style={arrowBtn(canDown)} aria-label={`Move ${item.title} down`}>↓</button>
                  <button onClick={() => startEdit(item)} style={btnGhost('var(--text-2)')}>Edit</button>
                  {hasEditor(item) && (
                    <button
                      onClick={() => (openContent ? closeContent() : startContent(item))}
                      style={btnGhost(openContent ? ACCENT : 'var(--text-2)')}
                    >
                      {item.kind === 'guide' ? 'Content' : 'Files'}
                    </button>
                  )}
                  {canCopy(item) && (
                    <button onClick={() => void copy(item)} disabled={busy} style={btnGhost('var(--text-2)')}>Copy</button>
                  )}
                  <button onClick={() => void togglePublished(item)} disabled={busy} style={btnGhost(item.is_published ? 'var(--text-3)' : GREEN)}>
                    {item.is_published ? 'Unpublish' : 'Publish'}
                  </button>
                  {isBuiltin
                    ? <span style={{ color: 'var(--text-4)', fontSize: '.65rem', alignSelf: 'center' }}>Unpublish instead</span>
                    : <button onClick={() => setArmedDelete(item.id)} style={btnGhost(DANGER)}>Delete</button>}
                </div>
              ) : null}
            </div>

            {openContent && renderContentPanel(item)}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="dash-pad">
      {isDemo && <DemoBanner note="Edit, hide and add sample resources. Nothing is saved." />}

      <p style={{ ...microLabel, marginBottom: '.4rem' }}>Free stuff, managed</p>
      <h2 style={{ ...heading, marginBottom: '.6rem' }}>Resources &amp; tools</h2>
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.65, marginBottom: '1.25rem', maxWidth: 620 }}>
        Every card under Free Stuff: what it is called, what it says, what badge it wears, where it sits, and whether
        a visitor has to leave an email first. Unpublishing takes something off the site without losing the copy.
        Content opens what is inside a guide, Files attaches a PDF to a guide or an article, and Copy gives you a
        draft to change without touching the original.
      </p>

      {ready && !canManage && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '.7rem 1rem', marginBottom: '1rem' }}>
          <span style={{ color: 'var(--text-3)', fontSize: '.78rem' }}>
            You can see the library but not change it. An admin can hand you the Manage resource library permission.
          </span>
        </div>
      )}

      {error && <div role="alert" style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.7rem 1rem', marginBottom: '1rem' }}><span style={{ color: DANGER, fontSize: '.8rem' }}>{error}</span></div>}
      {flash && <div style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.35)', borderRadius: '.25rem', padding: '.7rem 1rem', marginBottom: '1rem' }}><span style={{ color: GREEN, fontSize: '.8rem' }}>{flash}</span></div>}

      {loading ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading resources…</p>
      ) : outage ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>Couldn&rsquo;t load the resource library.</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>That&rsquo;s on our side, and nothing has changed. The site is still showing what it always did.</p>
          <button onClick={() => void load()} style={btnGhost('var(--text)')}>Try again</button>
        </div>
      ) : (
        <div style={{ maxWidth: 860, display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {GROUPS.map(g => {
            const group = sorted.filter(i => g.kinds.includes(i.kind))
            return (
              <section key={g.key}>
                <p style={{ ...microLabel, marginBottom: '.35rem' }}>{g.label}</p>
                <p style={{ color: 'var(--text-4)', fontSize: '.75rem', lineHeight: 1.6, marginBottom: '.75rem', maxWidth: 560 }}>{g.blurb}</p>
                <div style={{ border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden' }}>
                  {group.length === 0 && (
                    <p style={{ padding: '1.25rem', color: 'var(--text-4)', fontSize: '.82rem', textAlign: 'center' }}>
                      {g.key === 'custom' ? 'Nothing added yet. Links, downloads and articles you make show up here.' : 'None yet.'}
                    </p>
                  )}
                  {group.map(item => renderRow(item))}
                </div>

                {g.key === 'custom' && canManage && (
                  <div style={{ marginTop: '1rem' }}>
                    {adding ? (
                      <div style={{ border: `1px solid ${ACCENT}55`, borderRadius: '.25rem', padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
                        <p style={microLabel}>New resource</p>
                        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                          {CREATABLE_KINDS.map(k => (
                            <button
                              key={k}
                              onClick={() => pickNewKind(k)}
                              style={newDraft.kind === k ? btn(ACCENT, '#fff') : btnGhost('var(--text-3)')}
                            >
                              {KIND_ADD_LABELS[k] ?? KIND_LABELS[k]}
                            </button>
                          ))}
                        </div>

                        {newDraft.kind === 'guide' && (
                          <div>
                            <label className="field-label">What kind of guide</label>
                            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.35rem' }}>
                              {CONTENT_TYPES.map(t => (
                                <button
                                  key={t}
                                  onClick={() => setNewDraft({ ...newDraft, contentType: t })}
                                  style={newDraft.contentType === t ? btn(ACCENT, '#fff') : btnGhost('var(--text-3)')}
                                >
                                  {CONTENT_TYPE_LABELS[t]}
                                </button>
                              ))}
                            </div>
                            <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.5rem', lineHeight: 1.6, maxWidth: 520 }}>
                              This picks how the guide behaves on the page, and it is the one thing you cannot change
                              later. The guide arrives empty and hidden. Open Content on its row to write it, then
                              publish it when it reads the way you want.
                            </p>
                          </div>
                        )}

                        {commonFields(newDraft, setNewDraft, 'new', { slug: true })}
                        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => void add()}
                            disabled={busy || !newDraft.title.trim()}
                            style={btn(newDraft.title.trim() ? ACCENT : 'var(--surface-2)', newDraft.title.trim() ? '#fff' : 'var(--text-4)')}
                          >
                            {busy ? 'Adding…' : newDraft.kind === 'guide' ? 'Add guide' : 'Add resource'}
                          </button>
                          <button onClick={() => { setAdding(false); setNewDraft(BLANK); setError(null) }} style={btnGhost('var(--text-3)')}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={openAdd} style={btn(ACCENT, '#fff')}>+ Add a resource</button>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
