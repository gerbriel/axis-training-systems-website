import { useState } from 'react'
import { href } from '../../utils/nav'
import type { QuizContent } from '../../lib/guideContent'
import { ctaButton, hoverIn, hoverOut, outlineIn, outlineOut, resetButton, resultCard, scoreColor, tierColor } from './styles'

/** The best answer to a question is worth this. Zero when a question somehow
 *  has no answers at all, which the validator refuses but a view still divides
 *  by. */
function best(options: { points: number }[]): number {
  return options.reduce((a, o) => Math.max(a, o.points), 0)
}

/**
 * A scored quiz: one question at a time, then a tier and a breakdown.
 *
 * The total used to be the sum of the option INDEXES, which worked only because
 * every question happened to list its three answers worst-first. Points are
 * stored per answer now, so an owner can write a question whose middle answer is
 * the good one without the scoring quietly disagreeing with them.
 *
 * The denominator is the sum of each question's best answer, not the top tier's
 * cutoff: they agree for the quiz that ships, and when an owner edits one of
 * them the score out of the marks actually available is the one that is true.
 */
export default function QuizView({ content }: { content: QuizContent }) {
  const { questions, tiers } = content
  const [answers, setAnswers] = useState<number[]>([])
  const [current, setCurrent] = useState(0)
  const [complete, setComplete] = useState(false)

  const maxScore = questions.reduce((a, q) => a + best(q.options), 0)
  const score = answers.reduce((a, choice, i) => a + (questions[i]?.options[choice]?.points ?? 0), 0)
  // The first tier the total does not exceed. A total above every tier lands in
  // the top one rather than nowhere, which is what a tier list that stops short
  // of the marks available means.
  const found = tiers.findIndex(t => score <= t.maxPoints)
  const tierIndex = found >= 0 ? found : tiers.length - 1
  const tier = tiers[tierIndex]
  const color = tierColor(tierIndex, tiers.length)

  function answer(choice: number) {
    setAnswers(prev => [...prev, choice])
    if (current < questions.length - 1) {
      setCurrent(c => c + 1)
    } else {
      setComplete(true)
    }
  }

  function reset() { setAnswers([]); setCurrent(0); setComplete(false) }

  if (complete) {
    return (
      <div>
        <div style={resultCard(color)}>
          <p style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Your Score</p>
          <p style={{ color, fontWeight: 900, fontSize: '3rem', lineHeight: 1, marginBottom: '.25rem' }}>{score}<span style={{ fontSize: '1.5rem', color: 'var(--text-3)' }}>/{maxScore}</span></p>
          <p style={{ color, fontWeight: 900, fontSize: '.8rem', letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '1.25rem' }}>{tier.label}</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.9rem', lineHeight: 1.75, maxWidth: 500, margin: '0 auto' }}>{tier.note}</p>
        </div>
        {/* Per-question breakdown */}
        <div style={{ marginBottom: '1.5rem' }}>
          {questions.map((q, i) => {
            const chosen = q.options[answers[i]]
            const points = chosen?.points ?? 0
            return (
              <div key={i} style={{ padding: '.875rem 0', borderBottom: '1px solid var(--surface-2)' }}>
                <p style={{ color: 'var(--text-2)', fontSize: '.75rem', marginBottom: '.3rem' }}>{q.prompt}</p>
                <p style={{ color: scoreColor(points, best(q.options)), fontWeight: 700, fontSize: '.8rem' }}>
                  {chosen?.label} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>({points}/{best(q.options)})</span>
                </p>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <a
            href={href('/#coaches')}
            style={{ ...ctaButton, transition: 'background .15s' }}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            Work With a Coach →
          </a>
          <button
            onClick={reset}
            style={resetButton}
            onMouseEnter={outlineIn}
            onMouseLeave={outlineOut}
          >
            Retake
          </button>
        </div>
      </div>
    )
  }

  const q = questions[current]
  return (
    <div>
      {/* Progress */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.5rem' }}>
          <span style={{ color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>Question {current + 1} of {questions.length}</span>
          <span style={{ color: 'var(--text-3)', fontSize: '.65rem' }}>{Math.round((current / questions.length) * 100)}%</span>
        </div>
        <div style={{ height: 3, background: 'var(--surface)', borderRadius: 2 }}>
          <div style={{ height: '100%', width: `${(current / questions.length) * 100}%`, background: '#272C84', transition: 'width .3s' }} />
        </div>
      </div>

      <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '1rem', lineHeight: 1.55, marginBottom: '1.5rem' }}>{q.prompt}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {q.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => answer(i)}
            style={{ textAlign: 'left', background: 'transparent', border: '1px solid var(--border)', borderRadius: '.25rem', color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.6, padding: '.875rem 1rem', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#272C84'; e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'rgba(39,44,132,.05)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.background = 'transparent' }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
