import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { safeUrl } from '../../utils/sanitize'
import { blockDef, defaultFor, validateBlock, saveBlock, resetBlock } from '../../lib/siteContent'
import { recordTarget } from '../../lib/editTargets'
import type { EditTargetKey } from './editKeys'
import { formatKey } from './editKeys'
import type { EditAccess } from './editMode'
import ValueEditor from './ValueEditor'
import { announceContentChange, canCreateInPlace, canDeleteInPlace, canEditInPlace } from './records'
import type { LiveRecordTarget, RecordFieldSpec } from './records'
import {
  ACCENT, DANGER, PANEL_Z, btn, btnGhost, btnText, chip, microLabel,
  fieldStyle, humanize, sameValue, ErrorNote, FlashNote, Note,
} from './kit'

/**
 * EditPanel.tsx
 *
 * The one panel, for both kinds of thing that can be clicked.
 *
 * A person fixing a typo does not know or care which of their words live in a
 * jsonb column and which live in the bundle, so there is one click, one panel,
 * one busy flag and one place a refusal appears. What is NOT unified is the
 * store underneath, because absence means opposite things on the two sides: no
 * row in the copy table means the shipped words are showing, and no row in
 * coach_testimonials means the testimonial is gone. So the panel dispatches
 * once, at the top, and the two halves never share a write path.
 *
 * That difference is visible in exactly one place, and deliberately:
 *
 *   THE DESTRUCTIVE SLOT IS NOT SHARED. Site copy gets a quiet line above the
 *   footer offering to put the shipped words back, which takes nothing away
 *   that cannot be typed again. A row gets a danger-styled, two-step Delete in
 *   the footer, naming what it is about to remove. The same position on the
 *   screen never means both "undo" and "permanent".
 *
 * It is a NON-modal dialog on purpose: no backdrop, so the page it is editing
 * stays readable and clickable behind it. It sits on the RIGHT, opposite the
 * bar: the bar is bottom left and its outline list is tall when expanded, and
 * two panels stacked in one corner would cover each other. Below the navbar's
 * 4rem band, because that bar is fixed and anything at y=0 renders underneath
 * it. Clicking another editable part of the page while this is open moves the
 * panel to that one, which is what "edit as you go" means. Escape closes it,
 * unsaved work is guarded on both close and page unload — this site has no
 * router, so an ordinary link would otherwise take a half-typed headline with
 * it.
 */

export interface ContentAccess {
  value: (id: string) => unknown
  ready: boolean
  reload: () => void
}

export interface EditPanelProps {
  target: EditTargetKey
  access: EditAccess
  content: ContentAccess
  /**
   * Unsaved work is the BAR's business as well as this panel's: it is what
   * stops a second click on the page swapping the panel out from under a
   * half-typed headline, and there is no router here to warn about the rest.
   */
  dirty: boolean
  onDirty: (dirty: boolean) => void
  /** A sentence from the bar, e.g. why a click on something else was ignored. */
  notice?: string | null
  onClose: () => void
  /** The element that was clicked, so focus goes back where it came from. */
  returnFocus: HTMLElement | null
}

/** A private copy, so a draft can never write through to the shared store. */
function clone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

export default function EditPanel({
  target, access, content, dirty, onDirty, notice, onClose, returnFocus,
}: EditPanelProps) {
  const setDirty = onDirty
  const [askDiscard, setAskDiscard] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const requestClose = useCallback(() => {
    if (dirty) { setAskDiscard(true); return }
    onClose()
  }, [dirty, onClose])

  // Escape closes, and asks first when there is something to lose.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      requestClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [requestClose])

  // There is no router here. Every link is a full page load, so without this a
  // half-written headline dies on a click nobody meant as "discard".
  useEffect(() => {
    if (!dirty) return
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [dirty])

  // Focus lands in the panel when it opens and goes back to the clicked element
  // when it closes, so a keyboard never loses its place on the page.
  useEffect(() => {
    const node = panelRef.current
    const first = node?.querySelector<HTMLElement>('input, textarea, button, a[href]')
    first?.focus()
    return () => { returnFocus?.focus?.() }
  }, [returnFocus])

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Edit this part of the page"
      style={{
        position: 'fixed', right: '1.5rem', top: '4.75rem', zIndex: PANEL_Z,
        width: 'min(26rem, calc(100vw - 3rem))', maxHeight: 'min(74vh, 42rem)',
        overflowY: 'auto', background: 'var(--bg)', border: '1px solid var(--border-mid)',
        borderRadius: '.35rem', boxShadow: '0 18px 50px rgba(0,0,0,.45)',
        padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.85rem',
      }}
    >
      {notice && <ErrorNote>{notice}</ErrorNote>}

      {target.kind === 'block' ? (
        <BlockPanel
          key={formatKey(target)}
          id={target.id}
          access={access}
          content={content}
          setDirty={setDirty}
          onRequestClose={requestClose}
        />
      ) : (
        <RecordPanel
          key={formatKey(target)}
          targetKey={target.target}
          rowId={target.id}
          access={access}
          setDirty={setDirty}
          onRequestClose={requestClose}
          onClose={onClose}
        />
      )}

      {askDiscard && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.7rem', display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-2)', fontSize: '.75rem' }}>Close without saving?</span>
          <button onClick={() => { setDirty(false); setAskDiscard(false); onClose() }} style={btnGhost(DANGER)}>Discard</button>
          <button onClick={() => setAskDiscard(false)} style={btnGhost('var(--text-3)')}>Keep editing</button>
        </div>
      )}
    </div>
  )
}

// ── Header, shared by both halves ───────────────────────────────────────────

function PanelHead({ noun, title, group, onClose }: {
  noun: string
  title: string
  group?: string
  onClose: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.25rem' }}>
          <span style={chip(ACCENT)}>{noun}</span>
          {group && <span style={{ color: 'var(--text-4)', fontSize: '.62rem', letterSpacing: '.1em', textTransform: 'uppercase' }}>{group}</span>}
        </div>
        <p style={{ color: 'var(--text)', fontWeight: 800, fontSize: '.95rem', lineHeight: 1.3, margin: 0 }}>{title}</p>
      </div>
      <button onClick={onClose} aria-label="Close the editor" style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: '.15rem', lineHeight: 1, fontSize: '1.1rem', fontFamily: 'inherit' }}>
        ×
      </button>
    </div>
  )
}

function NoPermission({ permission }: { permission: string | null }) {
  return (
    <Note>
      You can see this but not change it.
      {permission ? ` An admin can hand you the ${humanize(permission)} permission.` : ' Nobody has been given the key for it yet.'}
    </Note>
  )
}

// ── Site copy ───────────────────────────────────────────────────────────────

function BlockPanel({ id, access, content, setDirty, onRequestClose }: {
  id: string
  access: EditAccess
  content: ContentAccess
  setDirty: (v: boolean) => void
  onRequestClose: () => void
}) {
  const def = blockDef(id)
  const shipped = useMemo(() => defaultFor(id), [id])
  const mayEdit = access.mayEdit({ kind: 'block', id })

  const [draft, setDraft] = useState<unknown>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [askRestore, setAskRestore] = useState(false)

  const say = (message: string) => {
    setFlash(message)
    window.setTimeout(() => setFlash(null), 2500)
  }

  // Wait for the store before taking a copy. Opening while the read is in
  // flight would seed the form from the shipped words and then save them over
  // an override that was about to arrive.
  useEffect(() => {
    if (loaded || !content.ready) return
    const live = content.value(id)
    setDraft(clone(live === undefined || live === null ? shipped : live))
    setLoaded(true)
  }, [loaded, content, id, shipped])

  const update = (next: unknown) => {
    setDraft(next)
    setDirty(true)
    setError(null)
  }

  const overridden = loaded && content.ready && !sameValue(content.value(id), shipped)

  const save = async () => {
    if (busy || !mayEdit) return
    const checked = validateBlock(id, draft)
    if (!checked.ok) { setError(checked.message); return }
    setBusy(true); setError(null)
    const result = await saveBlock(id, checked.value, access.isDemo)
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setDraft(clone(checked.value))
    setDirty(false)
    content.reload()
    announceContentChange('site-copy')
    say(access.isDemo ? 'Saved for this demo. Nothing was written.' : 'Saved. The page is showing it now.')
  }

  const restore = async () => {
    if (busy || !mayEdit) return
    setBusy(true); setError(null)
    const result = await resetBlock(id, access.isDemo)
    setBusy(false)
    setAskRestore(false)
    if (!result.ok) { setError(result.message); return }
    setDraft(clone(shipped))
    setDirty(false)
    content.reload()
    announceContentChange('site-copy')
    say('Back to the words the site shipped with.')
  }

  if (!def) {
    return (
      <>
        <PanelHead noun="Site copy" title="Not in the registry" onClose={onRequestClose} />
        <Note>
          This part of the page is marked as editable but the block <code>{id}</code> is not registered,
          so there is nothing to edit. That needs a developer.
        </Note>
      </>
    )
  }

  return (
    <>
      <PanelHead noun="Site copy" title={def.label} group={def.group} onClose={onRequestClose} />

      {!mayEdit && <NoPermission permission={access.permissionFor({ kind: 'block', id })} />}

      {!loaded ? (
        <Note>Reading the saved copy. If this does not clear, reload the page.</Note>
      ) : (
        <ValueEditor
          kind={def.kind}
          def={shipped}
          value={draft}
          fields={def.fields}
          isDemo={access.isDemo}
          disabled={!mayEdit || busy}
          onChange={update}
        />
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
      {flash && <FlashNote>{flash}</FlashNote>}

      {/* Non-destructive, so it sits above the footer as a sentence rather than
          in the row where a permanent action would be. */}
      {mayEdit && overridden && (
        askRestore ? (
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-2)', fontSize: '.74rem' }}>Drop your version?</span>
            <button onClick={() => void restore()} disabled={busy} style={btnGhost(DANGER)}>Put it back</button>
            <button onClick={() => setAskRestore(false)} style={btnGhost('var(--text-3)')}>Cancel</button>
          </div>
        ) : (
          <p style={{ color: 'var(--text-3)', fontSize: '.72rem', lineHeight: 1.5, margin: 0 }}>
            This differs from the copy the site shipped with.{' '}
            <button onClick={() => setAskRestore(true)} style={btnText('var(--text-2)')}>Put it back.</button>
          </p>
        )
      )}

      {mayEdit && (
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: '.75rem' }}>
          <button onClick={() => void save()} disabled={busy || !loaded} style={btn(ACCENT, '#fff')}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onRequestClose} style={btnGhost('var(--text-3)')}>Close</button>
        </div>
      )}
    </>
  )
}

// ── A row in a table that already has a library ─────────────────────────────

function RecordPanel({ targetKey, rowId, access, setDirty, onRequestClose, onClose }: {
  targetKey: string
  rowId: string | null
  access: EditAccess
  setDirty: (v: boolean) => void
  onRequestClose: () => void
  onClose: () => void
}) {
  const found = recordTarget(targetKey) as LiveRecordTarget | undefined
  const key: EditTargetKey = { kind: 'record', target: targetKey, id: rowId }
  const mayEdit = access.mayEdit(key)
  const creating = rowId === null

  const [row, setRow] = useState<Record<string, unknown> | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const [outage, setOutage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)

  const inPlace = !!found && (creating ? canCreateInPlace(found) : canEditInPlace(found))

  const say = (message: string) => {
    setFlash(message)
    window.setTimeout(() => setFlash(null), 2500)
  }

  useEffect(() => {
    if (!found || !inPlace) return
    if (creating) {
      setDraft({ ...(found.blank?.() ?? {}) })
      return
    }
    let live = true
    setLoading(true)
    void found.load!(rowId as string).then(answer => {
      if (!live) return
      setLoading(false)
      // null is "could not tell you", which is not the same as a blank row.
      if (answer === null) { setOutage(true); return }
      setRow(answer)
      const next: Record<string, unknown> = {}
      for (const field of found.fields ?? []) next[field.key] = answer[field.key] ?? ''
      setDraft(next)
    })
    return () => { live = false }
  }, [found, inPlace, creating, rowId])

  if (!found) {
    return (
      <>
        <PanelHead noun="Content" title="Not set up" onClose={onRequestClose} />
        <Note>
          This is marked as editable but nothing is registered under <code>{targetKey}</code>, so there is
          no library to write through and no permission to check. That needs a developer.
        </Note>
      </>
    )
  }

  const portalUrl = safeUrl(found.adminHref(rowId ?? undefined))
  const title = creating ? `New ${found.label.toLowerCase()}` : found.label
  const label = (field: RecordFieldSpec) => field.label ?? humanize(field.key)

  const write = async () => {
    if (busy || !mayEdit || !found.save) return
    setBusy(true); setError(null)
    const result = await found.save(creating ? null : rowId, draft, access.isDemo)
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setDirty(false)
    found.invalidate?.()
    announceContentChange(found.key)
    if (creating) { onClose(); return }
    say(access.isDemo ? 'Saved for this demo. Nothing was written.' : 'Saved.')
  }

  const remove = async () => {
    if (busy || !mayEdit || !found.remove || !rowId) return
    setBusy(true); setError(null)
    const result = await found.remove(rowId, access.isDemo)
    setBusy(false)
    if (!result.ok) { setError(result.message); setArmed(false); return }
    setDirty(false)
    found.invalidate?.()
    announceContentChange(found.key)
    onClose()
  }

  const refusal = !creating && rowId && found.refuseDelete ? found.refuseDelete(rowId) : null

  return (
    <>
      <PanelHead noun={found.label} title={title} onClose={onRequestClose} />

      {!mayEdit && <NoPermission permission={access.permissionFor(key)} />}

      {outage && (
        <Note>
          Could not read this one just now, and nothing has changed. Try again in a moment, or open it in the portal.
        </Note>
      )}

      {loading && <Note>Loading…</Note>}

      {inPlace && !outage && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.7rem' }}>
          {(found.fields ?? []).map(field => (
            <RecordField
              key={field.key}
              field={field}
              label={label(field)}
              value={typeof draft[field.key] === 'string' ? (draft[field.key] as string) : ''}
              disabled={!mayEdit || busy}
              onChange={next => {
                setDraft(prev => ({ ...prev, [field.key]: next }))
                setDirty(true)
                setError(null)
              }}
            />
          ))}
        </div>
      )}

      {!inPlace && (
        <Note>
          {creating
            ? `Adding a ${found.label.toLowerCase()} is done in the portal, where the whole form is.`
            : `This one is edited in the portal, where its full editor is. Everything about it lives there, including the parts that do not fit on this page.`}
        </Note>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
      {flash && <FlashNote>{flash}</FlashNote>}

      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: '.75rem', alignItems: 'center' }}>
        {inPlace && mayEdit && (
          <button onClick={() => void write()} disabled={busy || loading || outage} style={btn(ACCENT, '#fff')}>
            {busy ? 'Saving…' : creating ? 'Add it' : 'Save'}
          </button>
        )}
        <button onClick={onRequestClose} style={btnGhost('var(--text-3)')}>Close</button>

        {portalUrl && (
          <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={{ ...btnGhost('var(--text-2)'), display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
            Open in portal
          </a>
        )}

        {/* Permanent, so it is the only thing down here that is red, it names
            what it removes, and it takes two presses. */}
        {mayEdit && !creating && found.actions.includes('delete') && (
          refusal ? (
            <span style={{ color: 'var(--text-4)', fontSize: '.68rem', lineHeight: 1.4 }}>{refusal}</span>
          ) : canDeleteInPlace(found) ? (
            armed ? (
              <span style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-2)', fontSize: '.72rem' }}>Remove this {found.label.toLowerCase()}?</span>
                <button onClick={() => void remove()} disabled={busy} style={btn(DANGER, '#fff')}>Remove</button>
                <button onClick={() => setArmed(false)} style={btnGhost('var(--text-3)')}>Cancel</button>
              </span>
            ) : (
              <button onClick={() => setArmed(true)} disabled={busy} style={btnGhost(DANGER)}>Delete</button>
            )
          ) : null
        )}
      </div>
    </>
  )
}

function RecordField({ field, label, value, disabled, onChange }: {
  field: RecordFieldSpec
  label: string
  value: string
  disabled?: boolean
  onChange: (next: string) => void
}) {
  const id = useId()
  const max = field.max ?? 2000
  const area = field.input === 'paragraph'
  return (
    <div>
      <label htmlFor={id} style={{ ...microLabel, color: 'var(--text-3)', display: 'block', marginBottom: '.3rem' }}>{label}</label>
      {area ? (
        <textarea
          id={id}
          className="field"
          style={{ ...fieldStyle, minHeight: '5.5rem', resize: 'vertical' }}
          value={value}
          maxLength={max}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="field"
          style={fieldStyle}
          value={value}
          maxLength={max}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
      )}
      {field.hint && (
        <p style={{ color: 'var(--text-4)', fontSize: '.68rem', marginTop: '.25rem', lineHeight: 1.45 }}>{field.hint}</p>
      )}
    </div>
  )
}
