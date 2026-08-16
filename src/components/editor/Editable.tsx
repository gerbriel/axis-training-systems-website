import { createElement } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { EDIT_ATTR, CONTENTS_ATTR, blockKey, recordKey } from './editKeys'
import { useEditModeFlag } from './editState'

/**
 * Editable.tsx
 *
 * The marker a marketing component puts around something the owner may change.
 *
 *   <Editable id="hero.eyebrow" as="p" style={eyebrowStyle}>{copy.eyebrow}</Editable>
 *   <Editable record={{ target: 'blog', id: post.id }} as="article" className="card">…</Editable>
 *
 * WHAT IT IS NOT. It is not a wrapper, not a context, not a hook into edit
 * state, and it renders no chrome of its own. Outside edit mode the page's DOM
 * is what it was before this feature existed plus one attribute, and that
 * attribute is the whole mechanism: ONE capture-phase click listener on
 * document does `closest('[data-axis-editable]')` and opens the panel. Nothing
 * on the page listens for anything, so toggling edit mode re-renders no
 * marketing component and an anonymous visitor pays about thirty bytes of HTML
 * for each marked element and not one line of executed editor code.
 *
 * PASS `as` WHENEVER THERE IS AN ELEMENT TO PASS. The element the page was
 * already rendering becomes the marked element and no node is added:
 *
 *   before   <p style={s}>{copy.eyebrow}</p>
 *   after    <Editable id="hero.eyebrow" as="p" style={s}>{copy.eyebrow}</Editable>
 *
 * That form subscribes to nothing. The other form — children with no `as`, for
 * a fragment of a sentence or a list of siblings — has to make a wrapper to
 * hang the attribute on, so it watches edit mode and adds a `display: contents`
 * span only while the mode is on. `display: contents` generates no box, so it
 * shifts no layout; it also draws no outline, which is why it is tagged and the
 * stylesheet outlines its children instead. Outside edit mode that form renders
 * a bare fragment: zero extra DOM, zero risk to a `> * + *` sibling selector.
 *
 * The two forms are two components on purpose. If they were one, an `as` that
 * changed between renders would change how many hooks ran and crash the page,
 * and no lint step in this repo would have caught it.
 *
 * THE ATTRIBUTE IS NOT PERMISSION. It names a copy slot or a row that is
 * already on the page for anyone to read. What may be edited is decided by
 * useEditAccess from the viewer's real permissions, and what a write does is
 * decided by RLS. See docs/SECURITY.md.
 */

export interface EditableProps {
  /** A block of site copy: an id in the block registry, e.g. 'services.intro'. */
  id?: string
  /** A database-backed row. Omit `id` to mark a place where one can be added. */
  record?: { target: string; id?: string }
  children?: ReactNode
  /** The element the page was already rendering. Strongly preferred. */
  as?: keyof React.JSX.IntrinsicElements
  className?: string
  style?: CSSProperties
}

function keyFor(props: EditableProps): string | null {
  if (props.id) return blockKey(props.id)
  if (props.record?.target) return recordKey(props.record.target, props.record.id ?? null)
  return null
}

/** The form with an element of its own: no hooks, no subscription, no new node. */
function TaggedEditable({ tag, editKey, className, style, children }: {
  tag: string
  editKey: string | null
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  const attrs: Record<string, unknown> = { className, style }
  if (editKey) attrs[EDIT_ATTR] = editKey
  // Cast because the tag is chosen by the caller at runtime. The props are the
  // three this component accepts plus one data attribute, so there is nothing
  // here for the element type to disagree with.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createElement(tag as any, attrs as any, children)
}

/** The form with nothing to mark: a wrapper that draws no box, and only in edit mode. */
function BareEditable({ editKey, children }: { editKey: string | null; children?: ReactNode }) {
  const on = useEditModeFlag()
  if (!on || !editKey) return <>{children}</>
  const attrs: Record<string, unknown> = {
    style: { display: 'contents' },
    [EDIT_ATTR]: editKey,
    [CONTENTS_ATTR]: 'true',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createElement('span' as any, attrs as any, children)
}

export default function Editable(props: EditableProps) {
  const editKey = keyFor(props)

  // A className or a style with no `as` is a caller who meant to render an
  // element and forgot to say which. A span is the honest guess, and saying so
  // in the DOM beats silently dropping their styling.
  const tag = props.as ?? ((props.className || props.style) ? 'span' : null)

  if (tag) {
    return (
      <TaggedEditable
        tag={tag}
        editKey={editKey}
        className={props.className}
        style={props.style}
      >
        {props.children}
      </TaggedEditable>
    )
  }

  return <BareEditable editKey={editKey}>{props.children}</BareEditable>
}
