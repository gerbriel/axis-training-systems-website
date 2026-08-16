import type { WorksheetContent } from '../../../lib/guideContent'
import {
  CAPS, Card, Nested, RowTools, AddBtn, TextBox, AreaBox, NumberBox, Hint, headCell,
  moveAt, dropAt, putAt,
} from './_kit'

/**
 * A scored worksheet: the training block audit, and anything rated the same way.
 *
 * The difference from the quiz is what the tiers are measured in. A quiz totals
 * points and the tiers are point ceilings; a worksheet is scored as a PERCENTAGE
 * of the best possible answer to every category, so its tiers are floors on that
 * percentage. That means adding a category does not silently re-tier everyone:
 * eighty percent is eighty percent whether there are six categories or nine.
 *
 * The best possible total is shown anyway, because it is the number the
 * percentage is taken against and a category whose answers are all worth zero
 * is otherwise invisible.
 */
export default function WorksheetEditor({
  value, onChange, disabled,
}: {
  value: WorksheetContent
  onChange: (next: WorksheetContent) => void
  disabled?: boolean
}) {
  const { categories, tiers } = value
  const setCategories = (next: WorksheetContent['categories']) => onChange({ ...value, categories: next })
  const setTiers = (next: WorksheetContent['tiers']) => onChange({ ...value, tiers: next })

  const best = categories.reduce(
    (sum, c) => sum + (c.options.length > 0 ? Math.max(...c.options.map(o => o.points)) : 0),
    0,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Card
        label="Categories"
        hint={`One thing being rated per category, and an answer for each level of it. Every top answer added together comes to ${best}, which is what a score is measured against.`}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          {categories.length === 0 && <Hint>No categories yet. Add the first one below.</Hint>}

          {categories.map((category, ci) => (
            <Nested key={ci}>
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end' }}>
                <TextBox
                  label={`Category ${ci + 1}`}
                  value={category.title}
                  disabled={disabled}
                  placeholder="Volume Management"
                  onChange={title => setCategories(putAt(categories, ci, { ...category, title }))}
                />
                <RowTools
                  index={ci} count={categories.length} what={`category ${ci + 1}`} disabled={disabled}
                  onMove={dir => setCategories(moveAt(categories, ci, dir))}
                  onRemove={() => setCategories(dropAt(categories, ci))}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <span style={{ ...headCell, flex: 1 }}>Answer</span>
                  <span style={{ ...headCell, width: '5.5rem' }}>Points</span>
                  <span style={{ width: '5.75rem' }} />
                </div>
                {category.options.map((option, oi) => (
                  <div key={oi} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <TextBox
                      label={`Category ${ci + 1}, answer ${oi + 1}`}
                      hideLabel
                      value={option.label}
                      disabled={disabled}
                      placeholder="I tracked it roughly but did not adjust"
                      onChange={label => setCategories(putAt(categories, ci, { ...category, options: putAt(category.options, oi, { ...option, label }) }))}
                    />
                    <NumberBox
                      label={`Points for category ${ci + 1}, answer ${oi + 1}`}
                      hideLabel
                      value={option.points}
                      disabled={disabled}
                      onChange={points => setCategories(putAt(categories, ci, { ...category, options: putAt(category.options, oi, { ...option, points }) }))}
                    />
                    <RowTools
                      index={oi} count={category.options.length} what={`answer ${oi + 1} of category ${ci + 1}`} disabled={disabled}
                      onMove={dir => setCategories(putAt(categories, ci, { ...category, options: moveAt(category.options, oi, dir) }))}
                      onRemove={() => setCategories(putAt(categories, ci, { ...category, options: dropAt(category.options, oi) }))}
                    />
                  </div>
                ))}
              </div>

              <AddBtn
                disabled={disabled}
                full={category.options.length >= CAPS.entries}
                onClick={() => setCategories(putAt(categories, ci, {
                  ...category,
                  options: [...category.options, { label: '', points: category.options.length }],
                }))}
              >
                + Answer
              </AddBtn>
            </Nested>
          ))}
        </div>

        <div style={{ marginTop: '.9rem' }}>
          <AddBtn
            disabled={disabled}
            full={categories.length >= CAPS.groups}
            onClick={() => setCategories([...categories, { title: '', options: [{ label: '', points: 0 }] }])}
          >
            + Category
          </AddBtn>
        </div>
      </Card>

      <Card
        label="Scores"
        hint="A score falls in the highest tier it reaches, so list them low to high and start the first one at 0 to catch everybody."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          {tiers.length === 0 && <Hint>No tiers yet, so every score would come back without a verdict.</Hint>}

          {tiers.map((tier, ti) => (
            <Nested key={ti}>
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <NumberBox
                  label="From"
                  value={tier.minPct}
                  disabled={disabled}
                  min={0}
                  max={100}
                  suffix="%"
                  width="6rem"
                  onChange={minPct => setTiers(putAt(tiers, ti, { ...tier, minPct }))}
                />
                <TextBox
                  label={`Tier ${ti + 1} name`}
                  value={tier.label}
                  disabled={disabled}
                  placeholder="Well-Structured Block"
                  onChange={label => setTiers(putAt(tiers, ti, { ...tier, label }))}
                />
                <RowTools
                  index={ti} count={tiers.length} what={`tier ${ti + 1}`} disabled={disabled}
                  onMove={dir => setTiers(moveAt(tiers, ti, dir))}
                  onRemove={() => setTiers(dropAt(tiers, ti))}
                />
              </div>
              <AreaBox
                label={`Tier ${ti + 1} verdict`}
                value={tier.note}
                rows={2}
                maxLength={CAPS.prompt}
                disabled={disabled}
                placeholder="What this score means, and what to fix first."
                onChange={note => setTiers(putAt(tiers, ti, { ...tier, note }))}
              />
            </Nested>
          ))}
        </div>

        <div style={{ marginTop: '.9rem' }}>
          <AddBtn
            disabled={disabled}
            full={tiers.length >= CAPS.tiers}
            onClick={() => setTiers([...tiers, { minPct: 0, label: '', note: '' }])}
          >
            + Tier
          </AddBtn>
        </div>
      </Card>
    </div>
  )
}
