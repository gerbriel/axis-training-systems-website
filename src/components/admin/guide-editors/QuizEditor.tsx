import type { QuizContent } from '../../../lib/guideContent'
import {
  CAPS, Card, Nested, RowTools, AddBtn, TextBox, AreaBox, NumberBox, Hint, headCell,
  moveAt, dropAt, putAt,
} from './_kit'

/**
 * A scored quiz: questions with weighted answers, and the tiers a total lands in.
 *
 * The two halves have to agree, and that is the only thing an editor can help
 * with here: a tier whose maxPoints sits above anything the questions can add
 * up to is unreachable, and one below the lowest possible score swallows
 * everyone. So the highest score the quiz can produce is worked out and shown
 * next to the tiers, live, as you change either side.
 *
 * Points are whole numbers because a quiz that scores 2.5 has to explain itself
 * on the results screen, and none of ours do.
 */
export default function QuizEditor({
  value, onChange, disabled,
}: {
  value: QuizContent
  onChange: (next: QuizContent) => void
  disabled?: boolean
}) {
  const { questions, tiers } = value
  const setQuestions = (next: QuizContent['questions']) => onChange({ ...value, questions: next })
  const setTiers = (next: QuizContent['tiers']) => onChange({ ...value, tiers: next })

  // The best a person can do: the top-scoring answer to every question.
  const best = questions.reduce(
    (sum, q) => sum + (q.options.length > 0 ? Math.max(...q.options.map(o => o.points)) : 0),
    0,
  )

  /**
   * What a new tier tops out at.
   *
   * Strictly ABOVE the highest ceiling already in the list, because the
   * validator refuses a tier that does not top out above the one before it, and
   * seeding the same number as the tier above turns the Add button into a save
   * that will not go through. Above `best` as well, so the ordinary case (the
   * last tier already catching the perfect score) still lands somewhere legal.
   */
  const nextTierMax = Math.max(best, ...tiers.map(t => t.maxPoints)) + 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Card
        label="Questions"
        hint="One question at a time, with an answer worth some number of points. The answers appear in the order they are listed here, so the weakest answer usually goes first."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          {questions.length === 0 && <Hint>No questions yet. Add the first one below.</Hint>}

          {questions.map((question, qi) => (
            <Nested key={qi}>
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end' }}>
                <AreaBox
                  label={`Question ${qi + 1}`}
                  value={question.prompt}
                  rows={2}
                  maxLength={CAPS.prompt}
                  disabled={disabled}
                  placeholder="How is your training structured?"
                  onChange={prompt => setQuestions(putAt(questions, qi, { ...question, prompt }))}
                />
                <RowTools
                  index={qi} count={questions.length} what={`question ${qi + 1}`} disabled={disabled}
                  onMove={dir => setQuestions(moveAt(questions, qi, dir))}
                  onRemove={() => setQuestions(dropAt(questions, qi))}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <span style={{ ...headCell, flex: 1 }}>Answer</span>
                  <span style={{ ...headCell, width: '5.5rem' }}>Points</span>
                  <span style={{ width: '5.75rem' }} />
                </div>
                {question.options.map((option, oi) => (
                  <div key={oi} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <TextBox
                      label={`Question ${qi + 1}, answer ${oi + 1}`}
                      hideLabel
                      value={option.label}
                      disabled={disabled}
                      placeholder="I follow a program I found online"
                      onChange={label => setQuestions(putAt(questions, qi, { ...question, options: putAt(question.options, oi, { ...option, label }) }))}
                    />
                    <NumberBox
                      label={`Points for question ${qi + 1}, answer ${oi + 1}`}
                      hideLabel
                      value={option.points}
                      disabled={disabled}
                      onChange={points => setQuestions(putAt(questions, qi, { ...question, options: putAt(question.options, oi, { ...option, points }) }))}
                    />
                    <RowTools
                      index={oi} count={question.options.length} what={`answer ${oi + 1} of question ${qi + 1}`} disabled={disabled}
                      onMove={dir => setQuestions(putAt(questions, qi, { ...question, options: moveAt(question.options, oi, dir) }))}
                      onRemove={() => setQuestions(putAt(questions, qi, { ...question, options: dropAt(question.options, oi) }))}
                    />
                  </div>
                ))}
              </div>

              <AddBtn
                disabled={disabled}
                full={question.options.length >= CAPS.entries}
                onClick={() => setQuestions(putAt(questions, qi, {
                  ...question,
                  options: [...question.options, { label: '', points: question.options.length }],
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
            full={questions.length >= CAPS.groups}
            onClick={() => setQuestions([...questions, { prompt: '', options: [{ label: '', points: 0 }] }])}
          >
            + Question
          </AddBtn>
        </div>
      </Card>

      <Card
        label="Scores"
        hint={`A total lands in the first tier it does not exceed, so list them low to high and give the last one the highest score the quiz can reach. Right now that is ${best}.`}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          {tiers.length === 0 && <Hint>No tiers yet, so every score would come back without a verdict.</Hint>}

          {tiers.map((tier, ti) => (
            <Nested key={ti}>
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <NumberBox
                  label="Up to"
                  value={tier.maxPoints}
                  disabled={disabled}
                  // A ceiling is a whole quiz's total, not one answer's worth.
                  max={CAPS.totalPoints}
                  suffix="pts"
                  width="6.5rem"
                  onChange={maxPoints => setTiers(putAt(tiers, ti, { ...tier, maxPoints }))}
                />
                <TextBox
                  label={`Tier ${ti + 1} name`}
                  value={tier.label}
                  disabled={disabled}
                  placeholder="Solid Base, Room to Optimize"
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
                placeholder="What this score means, and what to do about it."
                onChange={note => setTiers(putAt(tiers, ti, { ...tier, note }))}
              />
            </Nested>
          ))}
        </div>

        <div style={{ marginTop: '.9rem' }}>
          <AddBtn
            disabled={disabled}
            full={tiers.length >= CAPS.tiers}
            onClick={() => setTiers([...tiers, { maxPoints: nextTierMax, label: '', note: '' }])}
          >
            + Tier
          </AddBtn>
        </div>
      </Card>
    </div>
  )
}
