import type { SectionsContent } from '../../../lib/guideContent'
import {
  CAPS, Card, Nested, RowTools, AddBtn, TextBox, AreaBox, Hint,
  moveAt, dropAt, putAt,
} from './_kit'

/**
 * A technical guide: the big three, and anything taught the same way.
 *
 * A group is the thing being taught (the squat), a block is one phase of it
 * with the cues written out (Setup, Descent, Ascent), and the mistakes are the
 * short list that goes at the bottom of every one of these. The three are
 * separate lists rather than one because they are three different reads: the
 * blocks are studied in order, and the mistakes are scanned.
 *
 * Each group renders as a tab on the public page, so the group order is the tab
 * order.
 */
export default function SectionsEditor({
  value, onChange, disabled,
}: {
  value: SectionsContent
  onChange: (next: SectionsContent) => void
  disabled?: boolean
}) {
  const groups = value.groups
  const set = (next: SectionsContent['groups']) => onChange({ ...value, groups: next })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Card
        label="Groups"
        hint="One group per lift or topic. Each becomes a tab, in this order."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          {groups.length === 0 && <Hint>No groups yet. Add the first one below.</Hint>}

          {groups.map((group, gi) => (
            <Nested key={gi}>
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end' }}>
                <TextBox
                  label={`Group ${gi + 1} name`}
                  value={group.title}
                  disabled={disabled}
                  placeholder="Squat"
                  onChange={title => set(putAt(groups, gi, { ...group, title }))}
                />
                <RowTools
                  index={gi} count={groups.length} what={`group ${gi + 1}`} disabled={disabled}
                  onMove={dir => set(moveAt(groups, gi, dir))}
                  onRemove={() => set(dropAt(groups, gi))}
                />
              </div>

              {/* ── The phases, each a heading and the coaching copy under it ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                {group.blocks.map((block, bi) => (
                  <div key={bi} style={{
                    border: '1px solid var(--border)', borderRadius: '.2rem', padding: '.6rem .7rem',
                    display: 'flex', flexDirection: 'column', gap: '.45rem',
                  }}>
                    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end' }}>
                      <TextBox
                        label={`Block ${bi + 1} heading`}
                        value={block.label}
                        disabled={disabled}
                        placeholder="Setup"
                        onChange={label => set(putAt(groups, gi, { ...group, blocks: putAt(group.blocks, bi, { ...block, label }) }))}
                      />
                      <RowTools
                        index={bi} count={group.blocks.length} what={`block ${bi + 1} of group ${gi + 1}`} disabled={disabled}
                        onMove={dir => set(putAt(groups, gi, { ...group, blocks: moveAt(group.blocks, bi, dir) }))}
                        onRemove={() => set(putAt(groups, gi, { ...group, blocks: dropAt(group.blocks, bi) }))}
                      />
                    </div>
                    <AreaBox
                      label={`Block ${bi + 1} copy`}
                      hideLabel
                      value={block.text}
                      rows={3}
                      disabled={disabled}
                      placeholder="Bar position, hand width, brace. What the lifter actually does."
                      onChange={text => set(putAt(groups, gi, { ...group, blocks: putAt(group.blocks, bi, { ...block, text }) }))}
                    />
                  </div>
                ))}
                <AddBtn
                  disabled={disabled}
                  full={group.blocks.length >= CAPS.entries}
                  onClick={() => set(putAt(groups, gi, { ...group, blocks: [...group.blocks, { label: '', text: '' }] }))}
                >
                  + Block
                </AddBtn>
              </div>

              {/* ── The mistakes list, which is always short and always last ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                <label className="field-label" style={{ fontSize: '.58rem' }}>Common mistakes</label>
                {group.mistakes.map((mistake, mi) => (
                  <div key={mi} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <TextBox
                      label={`Group ${gi + 1}, mistake ${mi + 1}`}
                      hideLabel
                      value={mistake}
                      disabled={disabled}
                      placeholder="Knees caving on the ascent"
                      onChange={text => set(putAt(groups, gi, { ...group, mistakes: putAt(group.mistakes, mi, text) }))}
                    />
                    <RowTools
                      index={mi} count={group.mistakes.length} what={`mistake ${mi + 1} of group ${gi + 1}`} disabled={disabled}
                      onMove={dir => set(putAt(groups, gi, { ...group, mistakes: moveAt(group.mistakes, mi, dir) }))}
                      onRemove={() => set(putAt(groups, gi, { ...group, mistakes: dropAt(group.mistakes, mi) }))}
                    />
                  </div>
                ))}
                <AddBtn
                  disabled={disabled}
                  full={group.mistakes.length >= CAPS.entries}
                  onClick={() => set(putAt(groups, gi, { ...group, mistakes: [...group.mistakes, ''] }))}
                >
                  + Mistake
                </AddBtn>
              </div>
            </Nested>
          ))}
        </div>

        <div style={{ marginTop: '.9rem' }}>
          <AddBtn
            disabled={disabled}
            full={groups.length >= CAPS.groups}
            onClick={() => set([...groups, { title: '', blocks: [{ label: '', text: '' }], mistakes: [] }])}
          >
            + Group
          </AddBtn>
        </div>
      </Card>
    </div>
  )
}
