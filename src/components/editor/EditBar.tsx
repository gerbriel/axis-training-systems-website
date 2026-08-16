import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { adminHref } from '../../utils/nav'
import { safeUrl } from '../../utils/sanitize'
import { blockDef, useSiteContent } from '../../lib/siteContent'
import { recordTarget, recordTargets } from '../../lib/editTargets'
import { isEditableRoute, useEditAccess } from './editMode'
import type { EditAccess } from './editMode'
import { setEditMode, useEditModeFlag } from './editState'
import { sameKey } from './editKeys'
import type { EditTargetKey } from './editKeys'
import { useTargets } from './useTargets'
import type { ScannedTarget } from './useTargets'
import { canCreateInPlace } from './records'
import type { LiveRecordTarget } from './records'
import EditOverlay from './EditOverlay'
import EditPanel from './EditPanel'
import {
  ACCENT, BAR_Z, btn, btnGhost, chip, microLabel, preview, sameValue, Note,
} from './kit'

/**
 * EditBar.tsx
 *
 * The bar the owner asked for: fixed, bottom left, on the public site, holding
 * the controls for everything on the page he is looking at.
 *
 * MOUNT IT AS A SIBLING OF AppContent, beside <ThemeToggle /> in App.tsx. That
 * is one line, it touches neither getRoute() nor AppContent, and it therefore
 * never goes near the useState/useEffect that sit below twenty early returns at
 * the bottom of that function — changing which branch AppContent returns from
 * would change the hook order, which is a runtime crash this repo has no lint
 * step to catch. ThemeToggle is the precedent (every route, may call useAuth);
 * DemoWidget, rendered inside the home JSX, is the counter-example.
 *
 * WHAT AN ANONYMOUS VISITOR PAYS. Three gates, in this order, and the order is
 * the point:
 *
 *   1. `loading` → render nothing. Not a signed-out bar, nothing. Showing a
 *      signed-out state for one frame on an invite-gated site reads as having
 *      been logged out, which is the moment people go and sign in again. This
 *      is AccountLink's rule and the reason useEditAccess ANDs AuthContext's
 *      `loading` with usePermissions' `ready` rather than trusting `settled`,
 *      which answers the same "empty and settled" for a real stranger and for
 *      an admin whose profile fetch is still in flight.
 *   2. Nothing this viewer may edit → render nothing.
 *   3. A route where this does not belong → render nothing.
 *
 * A logged-out visitor stops at gate 2 having executed one component that reads
 * two contexts the page had already mounted, and having made NO request:
 * getSession resolves from localStorage with no token, the realtime channel is
 * gated on a user id, and usePermissions short-circuits at `if (!profileId)`
 * with no RPC. The heavier half of the editor lives under ActiveEditor, which
 * mounts only once edit mode is actually on, so even a signed-in admin browsing
 * normally pays no scan, no fetch and no listeners.
 *
 * WHY ONE BAR FOR TWO KINDS OF THING. A person fixing a typo does not know or
 * care which of their words live in a jsonb column and which live in the
 * bundle. So the outline list interleaves site copy and database rows in the
 * order a reader meets them on the page, each labelled with its noun, and one
 * click opens one panel. What stays separate is underneath: the copy store's
 * delete is an undo, and a record's delete is destruction, which is why Delete
 * is not on this bar at all. It lives in the panel, two-step and named, where
 * the row's identity is in front of you.
 *
 * PERMISSION BELONGS TO THE TARGET. Site copy is manage_content. A blog post is
 * manage_blog, a coach profile is manage_staff, a testimonial is
 * moderate_testimonials, because that is what each table's own policy demands.
 * The bar asks the target, never the other way round, so nothing here can widen
 * a gate by assuming one key covers everything. And all of it is signage:
 * docs/SECURITY.md is explicit that RLS is the boundary. A control drawn over a
 * write the database will refuse is worse than no control, which is why the
 * outline list hides what this viewer cannot open rather than greying it out.
 */

export default function EditBar() {
  const access = useEditAccess()

  // Gate 1: do not guess. See the header.
  if (access.loading) return null
  // Gate 2: nothing here is theirs. This is where every anonymous visitor stops.
  if (!access.available) return null
  // Gate 3: the portal already is this, with more room. Auth screens are somebody
  // signing in. Computed in render rather than at module scope because a route
  // only changes through a full page load here, so there is nothing to memoize.
  if (!isEditableRoute()) return null

  return <EditSurface access={access} />
}

/**
 * Off is genuinely off.
 *
 * The two states are two components rather than one with a flag, so that the
 * idle bar mounts no observer, scans no DOM and makes no request. Everything
 * that costs anything is inside ActiveEditor.
 */
function EditSurface({ access }: { access: EditAccess }) {
  const on = useEditModeFlag()
  return on ? <ActiveEditor access={access} /> : <IdleBar />
}

// ── Off ─────────────────────────────────────────────────────────────────────

function IdleBar() {
  return (
    <div style={shell}>
      <button
        onClick={() => setEditMode(true)}
        style={{ ...btn(ACCENT, '#fff'), display: 'inline-flex', alignItems: 'center', gap: '.45rem' }}
      >
        <Pencil />
        Edit site
      </button>
    </div>
  )
}

// ── On ──────────────────────────────────────────────────────────────────────

/**
 * Narrow enough that the bar and the panel cannot sit side by side.
 *
 * On a wide screen they never meet: the bar is bottom left and about 21rem
 * wide, the panel is top right and about 26rem. Below roughly 52rem both are
 * as wide as the viewport allows and they would stack on top of each other, so
 * the bar gives up its outline list while a panel is open and keeps only the
 * row with Done on it. Measured rather than assumed, because a phone held
 * sideways is not a phone.
 */
const NARROW_QUERY = '(max-width: 52rem)'

/** matchMedia, or null in an environment that does not have it. */
function media(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY) : null
  } catch {
    return null
  }
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => media()?.matches ?? false)

  useEffect(() => {
    const mq = media()
    if (!mq) return
    const onChange = () => setNarrow(mq.matches)
    // Once on mount as well, in case the viewport changed between the first
    // render and this effect.
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return narrow
}

function ActiveEditor({ access }: { access: EditAccess }) {
  const content = useSiteContent()
  const { targets } = useTargets(true)
  const narrow = useNarrow()

  const [expanded, setExpanded] = useState(true)
  const [current, setCurrent] = useState<EditTargetKey | null>(null)
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * Everything on this page this viewer may actually open, in reading order.
   *
   * Deduplicated by the attribute rather than by the element: the footer blurb
   * and the hero taglines are different blocks, but one block rendered in two
   * places is one thing to edit, and listing it twice would suggest otherwise.
   */
  const visible = useMemo(() => {
    const seen = new Set<string>()
    const out: ScannedTarget[] = []
    for (const target of targets) {
      if (seen.has(target.raw)) continue
      if (!access.mayEdit(target.key)) continue
      seen.add(target.raw)
      out.push(target)
    }
    return out
  }, [targets, access])

  /**
   * How many blocks on this page are showing something other than the words the
   * site shipped with.
   *
   * Read by comparing the resolved value against the shipped default rather
   * than by asking the table for its rows, which keeps it to zero extra
   * requests and answers the question somebody actually has: does this page
   * differ from the bundle. It is here because a second source of truth for the
   * copy should be visible, not discovered six weeks later by a developer
   * wondering why editing the headline in the code changed nothing.
   */
  const edited = useMemo(() => {
    if (!content.ready) return 0
    const seen = new Set<string>()
    let count = 0
    for (const target of visible) {
      const key = target.key
      if (key.kind !== 'block') continue
      if (seen.has(key.id)) continue
      seen.add(key.id)
      const def = blockDef(key.id)
      if (!def) continue
      if (!sameValue(content.value(key.id), def.default)) count += 1
    }
    return count
  }, [visible, content.value, content.ready])

  /** Targets a new row can be made of, gated on each one's OWN permission. */
  const addable = useMemo(
    () => recordTargets().filter(target =>
      target.actions.includes('create')
      && (access.isDemo || access.isAdmin || access.can(target.permission))),
    [access],
  )

  const closePanel = useCallback(() => {
    setCurrent(null)
    setReturnFocus(null)
    setDirty(false)
    setNotice(null)
  }, [])

  const onDirty = useCallback((next: boolean) => {
    setDirty(next)
    if (!next) setNotice(null)
  }, [])

  /**
   * Open one thing.
   *
   * Half-typed work is never thrown away by a click somewhere else on the page:
   * the second click is refused with a sentence in the panel instead, because
   * there is no router here and no undo. Clicking the target that is already
   * open is not a swap, so it always goes through.
   */
  const open = useCallback((key: EditTargetKey, el: HTMLElement | null) => {
    if (dirty && !sameKey(key, current)) {
      setNotice('Save or discard the change you are working on first, then open this one.')
      return
    }
    setNotice(null)
    setCurrent(key)
    setReturnFocus(el)
  }, [dirty, current])

  /** From the outline list: bring it into view first, then open it. */
  const jump = useCallback((target: ScannedTarget) => {
    try {
      target.el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch {
      /* an older browser scrolls when it focuses instead, which is enough */
    }
    open(target.key, target.el)
  }, [open])

  const leave = useCallback(() => {
    if (dirty) {
      setNotice('Save or discard the change you are working on before leaving edit mode.')
      return
    }
    closePanel()
    setEditMode(false)
  }, [dirty, closePanel])

  const portalUrl = safeUrl(adminHref())
  // See useNarrow. The panel wins the screen on a phone; Done stays reachable.
  const showOutline = expanded && !(narrow && current)

  return (
    <>
      <EditOverlay targets={targets} mayEdit={access.mayEdit} current={current} onOpen={open} />

      <div role="region" aria-label="Site editor" style={{ ...shell, maxWidth: 'min(21rem, calc(100vw - 3rem))' }}>
        {/* ── Who and what ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span aria-hidden="true" style={{ display: 'inline-flex', color: ACCENT }}><Pencil /></span>
          <span style={{ ...microLabel, flex: 1 }}>Editing this page</span>
          <button
            onClick={() => setExpanded(v => !v)}
            aria-expanded={showOutline}
            aria-label={showOutline ? 'Hide the list of editable parts' : 'Show the list of editable parts'}
            style={{
              background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer',
              padding: '.1rem .25rem', font: 'inherit', fontSize: '.8rem', lineHeight: 1,
            }}
          >
            {showOutline ? '▾' : '▴'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
          {visible.length > 0 && (
            <span style={chip('var(--text-4)')}>{visible.length} you can edit</span>
          )}
          {/* The second source of truth for the copy, in plain sight. Without
              this, a page quietly running on database overrides looks exactly
              like one running on the bundle. */}
          {content.ready && edited > 0 && (
            <span style={chip(ACCENT)}>{edited} changed from the original</span>
          )}
          {access.isDemo && <span style={chip('var(--text-4)')}>Demo, nothing saves</span>}
        </div>

        {showOutline && (
          <>
            {/* ── The outline: copy and rows interleaved, in reading order ─ */}
            {visible.length > 0 ? (
              <ul
                style={{
                  listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column',
                  gap: '.15rem', maxHeight: 'min(38vh, 15rem)', overflowY: 'auto',
                  borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                  paddingTop: '.4rem', paddingBottom: '.4rem',
                }}
              >
                {visible.map(target => (
                  <OutlineRow
                    key={target.raw}
                    target={target}
                    active={sameKey(target.key, current)}
                    onOpen={() => jump(target)}
                  />
                ))}
              </ul>
            ) : (
              <EmptyOutline anyTargets={targets.length > 0} portalUrl={portalUrl} />
            )}

            {/* ── Add: a row that does not exist has no element to click ─── */}
            {addable.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                <span style={{ ...microLabel, color: 'var(--text-4)' }}>Add</span>
                <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
                  {addable.map(target => (
                    <AddButton
                      key={target.key}
                      label={target.label}
                      href={safeUrl(target.adminHref())}
                      inPlace={canCreateInPlace(target as LiveRecordTarget)}
                      onOpen={() => open({ kind: 'record', target: target.key, id: null }, null)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Leave, and the way back to the full screens ──────────────── */}
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={leave} style={btn(ACCENT, '#fff')}>Done</button>
          {portalUrl && (
            <a
              href={portalUrl}
              style={{ ...btnGhost('var(--text-3)'), display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
            >
              Open portal
            </a>
          )}
        </div>
      </div>

      {current && (
        <EditPanel
          target={current}
          access={access}
          content={content}
          dirty={dirty}
          onDirty={onDirty}
          notice={notice}
          onClose={closePanel}
          returnFocus={returnFocus}
        />
      )}
    </>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/**
 * One line of the outline.
 *
 * The noun comes first and is the whole reason the two stores read as one
 * feature: "Site copy" beside "Blog post" beside "Coach profile", in the order
 * they appear on the page, so nobody has to know which of them is compiled in.
 * The text beside it is what the element actually says, read out of the DOM,
 * never rendered as markup.
 */
function OutlineRow({ target, active, onOpen }: {
  target: ScannedTarget
  active: boolean
  onOpen: () => void
}) {
  const key = target.key
  const def = key.kind === 'block' ? blockDef(key.id) : undefined
  const record = key.kind === 'record' ? recordTarget(key.target) : undefined

  const noun = key.kind === 'block' ? 'Site copy' : (record?.label ?? 'Content')
  // Its words if it has any, its registered name if it does not: an image or an
  // empty section has no text to show, and "hero.image" beats a blank row.
  const said = preview(target.text, 52)
  const label = said || def?.label || (key.kind === 'block' ? key.id : noun)

  return (
    <li>
      <button
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        style={{
          width: '100%', display: 'flex', gap: '.4rem', alignItems: 'baseline', textAlign: 'left',
          background: active ? 'rgba(39,44,132,.1)' : 'transparent',
          border: 'none', borderRadius: '.2rem', padding: '.3rem .35rem',
          cursor: 'pointer', font: 'inherit',
        }}
      >
        <span style={{ ...chip(active ? ACCENT : 'var(--text-4)'), flexShrink: 0 }}>{noun}</span>
        <span
          style={{
            color: active ? 'var(--text)' : 'var(--text-2)', fontSize: '.72rem', lineHeight: 1.4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}
        >
          {label}
        </span>
      </button>
    </li>
  )
}

/**
 * Add one of these.
 *
 * A target whose library has been wired into the panel gets a form on the page.
 * One that has not gets a link to the screen where the whole form already is,
 * labelled so, which is one click and not a lie. The alternative was a button
 * that opens a panel to say the same thing.
 */
function AddButton({ label, href, inPlace, onOpen }: {
  label: string
  href: string | undefined
  inPlace: boolean
  onOpen: () => void
}) {
  const text = `Add ${label.toLowerCase()}`

  if (inPlace) {
    return <button onClick={onOpen} style={btnGhost(ACCENT)}>{text}</button>
  }
  if (!href) return null
  return (
    <a
      href={href}
      style={{ ...btnGhost('var(--text-3)'), display: 'inline-flex', alignItems: 'center', gap: '.3rem', textDecoration: 'none' }}
    >
      {text}
      <span style={{ fontSize: '.5rem', opacity: .7 }}>IN PORTAL</span>
    </a>
  )
}

/**
 * Nothing to show, said out loud.
 *
 * Two different sentences for two different situations, because an empty bar
 * would leave a coach concluding the feature is broken rather than that this
 * page holds nothing they hold the key for.
 */
function EmptyOutline({ anyTargets, portalUrl }: { anyTargets: boolean; portalUrl: string | undefined }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.5rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
      <Note>
        {anyTargets
          ? 'There is nothing on this page you have the permission to change. An admin can hand you the key for it.'
          : 'Nothing on this page has been set up for editing yet. The words here are still in the site’s code.'}
      </Note>
      {portalUrl && <Note>Everything you can change is in the portal.</Note>}
    </div>
  )
}

/** The one mark. Inline so the bar carries no icon dependency. */
function Pencil() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

// ── The frame both states share ─────────────────────────────────────────────
//
// Bottom LEFT, which the owner asked for and which is also the only free
// corner: ThemeToggle sits bottom right at 5rem and the demo button at 1.5rem,
// both at z-index 9999. BAR_Z is 9990, under those and under any modal.

const shell: CSSProperties = {
  position: 'fixed',
  bottom: '1.5rem',
  left: '1.5rem',
  zIndex: BAR_Z,
  display: 'flex',
  flexDirection: 'column',
  gap: '.5rem',
  background: 'var(--bg)',
  border: '1px solid var(--border-mid)',
  borderRadius: '.35rem',
  boxShadow: '0 12px 40px rgba(0,0,0,.45)',
  padding: '.6rem',
}
