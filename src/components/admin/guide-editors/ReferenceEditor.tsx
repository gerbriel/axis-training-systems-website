import { Fragment } from 'react'
import type { ReferenceContent } from '../../../lib/guideContent'
import {
  CAPS, Card, RowTools, AddBtn, AreaBox, Hint, cellStyle, iconBtn, headCell,
  moveAt, dropAt, putAt,
} from './_kit'

/**
 * A reference table: the RPE chart, and anything else that is a grid.
 *
 * Columns and rows are edited separately because they fail differently. A row
 * is a record and can be added, moved and thrown away freely. A COLUMN is part
 * of the table's shape, and removing one has to take that column's cell out of
 * every row with it, or the grid stops lining up with its own headings from
 * that point down.
 *
 * Rows arriving shorter or longer than the header (a hand-edited config, or a
 * column added by another tab) are fitted to it on the way through rather than
 * refused, so a mismatch shows as empty boxes to fill in instead of a table
 * that cannot be opened.
 */
export default function ReferenceEditor({
  value, onChange, disabled,
}: {
  value: ReferenceContent
  onChange: (next: ReferenceContent) => void
  disabled?: boolean
}) {
  const { columns, rows } = value
  const width = columns.length

  /** A row, at exactly the width the header says. */
  const fit = (row: string[]): string[] => {
    const next = row.slice(0, width)
    while (next.length < width) next.push('')
    return next
  }

  const setColumns = (nextColumns: string[], nextRows: string[][]) =>
    onChange({ ...value, columns: nextColumns, rows: nextRows })
  const setRows = (next: string[][]) => onChange({ ...value, rows: next })

  const addColumn = () => setColumns([...columns, ''], rows.map(r => [...fit(r), '']))
  const removeColumn = (ci: number) => setColumns(dropAt(columns, ci), rows.map(r => dropAt(fit(r), ci)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Card
        label="Table"
        hint="The first column is usually the thing being looked up and the rest describe it. Removing a column takes that cell out of every row."
      >
        {width === 0 ? (
          <Hint>No columns yet. A table needs at least one before it has anywhere to put a row.</Hint>
        ) : (
          <div style={{ overflowX: 'auto', paddingBottom: '.4rem' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${width}, minmax(150px, 1fr)) auto`,
              gap: '.4rem',
              alignItems: 'start',
              minWidth: `${width * 160 + 100}px`,
            }}>
              {/* Column headings, each with the control that deletes its column */}
              {columns.map((column, ci) => (
                <div key={`h-${ci}`} style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={column}
                    maxLength={CAPS.short}
                    disabled={disabled}
                    placeholder={ci === 0 ? 'RPE' : 'What it means'}
                    aria-label={`Column ${ci + 1} heading`}
                    onChange={e => setColumns(putAt(columns, ci, e.target.value), rows)}
                    style={cellStyle(!!disabled, { fontWeight: 700 })}
                  />
                  <button
                    type="button"
                    onClick={() => removeColumn(ci)}
                    disabled={disabled}
                    aria-label={`Remove column ${ci + 1}`}
                    title="Remove this column from every row"
                    style={iconBtn(!disabled)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <span style={{ ...headCell, alignSelf: 'center' }}>Row</span>

              {/* One line per row, then its own up/down/remove. A Fragment per
                  row keeps every cell a direct child of the grid, so the
                  columns line up across rows rather than nesting. */}
              {rows.map((row, ri) => {
                const cells = fit(row)
                return (
                  <Fragment key={ri}>
                    {cells.map((cell, ci) => (
                      <input
                        key={ci}
                        type="text"
                        value={cell}
                        maxLength={CAPS.short}
                        disabled={disabled}
                        aria-label={`Row ${ri + 1}, ${columns[ci] || `column ${ci + 1}`}`}
                        onChange={e => setRows(putAt(rows, ri, putAt(cells, ci, e.target.value)))}
                        style={cellStyle(!!disabled)}
                      />
                    ))}
                    <RowTools
                      index={ri} count={rows.length} what={`row ${ri + 1}`} disabled={disabled}
                      onMove={dir => setRows(moveAt(rows, ri, dir))}
                      onRemove={() => setRows(dropAt(rows, ri))}
                    />
                  </Fragment>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '.9rem' }}>
          <AddBtn disabled={disabled} full={width >= CAPS.columns} onClick={addColumn}>+ Column</AddBtn>
          <AddBtn
            disabled={disabled || width === 0}
            full={rows.length >= CAPS.rows}
            onClick={() => setRows([...rows, Array.from({ length: width }, () => '')])}
          >
            + Row
          </AddBtn>
        </div>
      </Card>

      <Card label="Footnote" hint="Optional. A line under the table, for the caveat every chart needs.">
        <AreaBox
          label="Footnote"
          hideLabel
          value={value.footnote ?? ''}
          rows={2}
          // A footnote is measured as a paragraph, not as a tier's sentence.
          maxLength={CAPS.long}
          disabled={disabled}
          placeholder="These percentages are a starting point, not a prescription."
          onChange={text => onChange({ ...value, footnote: text })}
        />
      </Card>
    </div>
  )
}
