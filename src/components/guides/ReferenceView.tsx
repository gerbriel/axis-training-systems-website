import type { ReactNode } from 'react'
import type { ReferenceContent } from '../../lib/guideContent'
import { intro as introStyle } from './styles'

/**
 * A reference table: a header row, rows of cells, and an optional closing note.
 *
 * The first column is the one you look a row up BY (the RPE number, the weight
 * class, the federation), so it is set large and centred and the rest of the row
 * reads across from it. That is the shape the RPE chart has always had; naming
 * the columns is what makes the same layout work for a table an owner writes.
 *
 * `intro` is the paragraph above the table. It is a prop rather than part of the
 * content because the RPE guide's opener carries emphasis inside the sentence,
 * and a stored string cannot hold that without becoming markup we would then
 * have to render.
 */
export default function ReferenceView({ content, intro }: { content: ReferenceContent; intro?: ReactNode }) {
  const { columns, rows, footnote } = content
  // The last column takes the slack, because on every table the site has it is
  // the prose one. The rest sit at their natural width with a floor.
  const gridTemplateColumns = columns.length > 1
    ? `repeat(${columns.length - 1}, minmax(60px, auto)) 1fr`
    : '1fr'

  return (
    <div>
      {intro && <p style={{ ...introStyle, marginBottom: '1.75rem' }}>{intro}</p>}

      {/* A wide table scrolls inside its own card rather than widening the page. */}
      <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--surface)', borderRadius: '.25rem', overflow: 'hidden', minWidth: columns.length > 3 ? 520 : undefined }}>
          <div style={{ display: 'grid', gridTemplateColumns, gap: '1rem', padding: '.75rem 1.25rem', background: 'var(--bg)' }}>
            {columns.map((col, i) => (
              <p
                key={i}
                style={{ color: 'var(--text-3)', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', textAlign: i === 0 ? 'center' : 'left' }}
              >
                {col}
              </p>
            ))}
          </div>
          {rows.map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns, gap: '1rem', alignItems: 'start', padding: '1rem 1.25rem', background: 'var(--bg)' }}>
              {row.map((cell, j) => (
                j === 0
                  ? <p key={j} style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', lineHeight: 1, textAlign: 'center' }}>{cell}</p>
                  : <p key={j} style={{ color: 'var(--text-2)', fontSize: '.85rem', lineHeight: 1.7 }}>{cell}</p>
              ))}
            </div>
          ))}
        </div>
      </div>

      {footnote && (
        <div style={{ background: 'var(--bg)', border: '1px solid rgba(39,44,132,.2)', borderLeft: '3px solid #272C84', borderRadius: '.2rem', padding: '1.25rem 1.5rem' }}>
          <p style={{ color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.75 }}>{footnote}</p>
        </div>
      )}
    </div>
  )
}
