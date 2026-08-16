import type { ChecklistContent } from '../../../lib/guideContent'
import {
  CAPS, Card, Nested, RowTools, AddBtn, TextBox, Hint,
  moveAt, dropAt, putAt,
} from './_kit'

/**
 * The meet day checklist, and anything shaped like it.
 *
 * Sections of tick-boxes, where the section is a heading a person reads on the
 * day ("Night Before", "Gear Bag Essentials") and an item is one thing to do.
 * Both lists reorder, because a checklist is read top to bottom and the order
 * IS the content: "pack the bag" belongs above "set two alarms".
 *
 * An empty item is left in the list rather than dropped as you type, so a blank
 * row you just added does not vanish when you tab away from it before typing.
 * `validateGuideContent` is what refuses one at save.
 */
export default function ChecklistEditor({
  value, onChange, disabled,
}: {
  value: ChecklistContent
  onChange: (next: ChecklistContent) => void
  disabled?: boolean
}) {
  const sections = value.sections
  const set = (next: ChecklistContent['sections']) => onChange({ ...value, sections: next })

  const total = sections.reduce((sum, s) => sum + s.items.length, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Card
        label="Sections"
        hint={`Each section is a heading on the checklist, and each item is one tick-box under it. ${total} ${total === 1 ? 'item' : 'items'} in total, which is the number the progress bar counts against.`}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          {sections.length === 0 && <Hint>No sections yet. Add the first one below.</Hint>}

          {sections.map((section, si) => (
            <Nested key={si}>
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end' }}>
                <TextBox
                  label={`Section ${si + 1} heading`}
                  value={section.title}
                  disabled={disabled}
                  placeholder="Night Before"
                  onChange={title => set(putAt(sections, si, { ...section, title }))}
                />
                <RowTools
                  index={si} count={sections.length} what={`section ${si + 1}`} disabled={disabled}
                  onMove={dir => set(moveAt(sections, si, dir))}
                  onRemove={() => set(dropAt(sections, si))}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                {section.items.map((item, ii) => (
                  <div key={ii} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <TextBox
                      label={`Section ${si + 1}, item ${ii + 1}`}
                      hideLabel
                      value={item}
                      disabled={disabled}
                      placeholder="Pack your gear bag completely"
                      onChange={text => set(putAt(sections, si, { ...section, items: putAt(section.items, ii, text) }))}
                    />
                    <RowTools
                      index={ii} count={section.items.length} what={`item ${ii + 1} of section ${si + 1}`} disabled={disabled}
                      onMove={dir => set(putAt(sections, si, { ...section, items: moveAt(section.items, ii, dir) }))}
                      onRemove={() => set(putAt(sections, si, { ...section, items: dropAt(section.items, ii) }))}
                    />
                  </div>
                ))}
              </div>

              <AddBtn
                disabled={disabled}
                full={section.items.length >= CAPS.entries}
                onClick={() => set(putAt(sections, si, { ...section, items: [...section.items, ''] }))}
              >
                + Item
              </AddBtn>
            </Nested>
          ))}
        </div>

        <div style={{ marginTop: '.9rem' }}>
          <AddBtn
            disabled={disabled}
            full={sections.length >= CAPS.groups}
            onClick={() => set([...sections, { title: '', items: [''] }])}
          >
            + Section
          </AddBtn>
        </div>
      </Card>
    </div>
  )
}
