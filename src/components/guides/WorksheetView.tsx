import { useState } from 'react'
import type { ReactNode } from 'react'
import { href } from '../../utils/nav'
import type { WorksheetContent } from '../../lib/guideContent'
import { ctaButton, hoverIn, hoverOut, intro as introStyle, outlineIn, outlineOut, resetButton, resultCard, scoreColor, tierColor } from './styles'

function best(options: { points: number }[]): number {
  return options.reduce((a, o) => Math.max(a, o.points), 0)
}

/** ✕ for nothing scored, ✓ for full marks, ~ for anything between. Derived from
 *  the points rather than the option's position, so an owner can list the best
 *  answer first without the ticks disagreeing with the score. */
function mark(points: number, max: number): string {
  if (points <= 0) return '✕'
  return points >= max ? '✓' : '~'
}

interface Props {
  content: WorksheetContent
  /** The paragraph above the form. A prop for the same reason as the reference
   *  view's: it is framing for one guide, not part of the scored content. */
  intro?: ReactNode
  /** Optional prose under a category's title, keyed by that title. The audit
   *  worksheet ships with a question per category; a worksheet an owner writes
   *  has its title and its answers, which is enough to answer. */
  prompts?: Record<string, string>
}

/**
 * A scored worksheet: rate yourself in each category, get a percentage and the
 * tier it lands in.
 *
 * The percentage, not the raw total, is what picks the tier. That is what lets
 * an owner add a seventh category without every tier cutoff they wrote becoming
 * wrong by a sixth.
 */
export default function WorksheetView({ content, intro, prompts }: Props) {
  const { categories, tiers } = content
  const [scores, setScores] = useState<Record<number, number>>({})
  const [done, setDone] = useState(false)

  const answered = Object.keys(scores).length
  const total = categories.reduce((a, c, i) => a + (c.options[scores[i]]?.points ?? 0), 0)
  const maxScore = categories.reduce((a, c) => a + best(c.options), 0)
  const pct = maxScore > 0 ? Math.round((total / maxScore) * 100) : 0

  // The last tier the percentage reaches. Below every tier it is the first one,
  // which is where a worksheet whose lowest tier does not start at zero belongs.
  let tierIndex = 0
  tiers.forEach((t, i) => { if (pct >= t.minPct) tierIndex = i })
  const tier = tiers[tierIndex]
  const color = tierColor(tierIndex, tiers.length)

  if (done) {
    return (
      <div>
        <div style={resultCard(color)}>
          <p style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Block Score</p>
          <p style={{ color, fontWeight: 900, fontSize: '3rem', lineHeight: 1 }}>{total}<span style={{ fontSize: '1.5rem', color: 'var(--text-3)' }}>/{maxScore}</span></p>
          <p style={{ color, fontWeight: 900, fontSize: '.8rem', letterSpacing: '.15em', textTransform: 'uppercase', margin: '.5rem 0 1.25rem' }}>{tier.label}</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.75, maxWidth: 500, margin: '0 auto' }}>{tier.note}</p>
        </div>

        {/* Breakdown */}
        <div style={{ marginBottom: '1.5rem' }}>
          {categories.map((cat, i) => {
            const points = cat.options[scores[i]]?.points ?? 0
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.75rem 0', borderBottom: '1px solid var(--surface-2)', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <p style={{ color: 'var(--chalk)', fontWeight: 700, fontSize: '.8rem' }}>{cat.title}</p>
                  <p style={{ color: 'var(--text-2)', fontSize: '.75rem', marginTop: '.15rem' }}>{cat.options[scores[i] ?? 0]?.label}</p>
                </div>
                <span style={{ color: scoreColor(points, best(cat.options)), fontWeight: 900, fontSize: '.9rem', flexShrink: 0 }}>
                  {points}/{best(cat.options)}
                </span>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <a href={href('/#coaches')} style={ctaButton}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >Work With a Coach →</a>
          <button onClick={() => { setScores({}); setDone(false) }}
            style={resetButton}
            onMouseEnter={outlineIn}
            onMouseLeave={outlineOut}
          >Re-audit</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {intro && <p style={introStyle}>{intro}</p>}

      {/* Progress */}
      <div style={{ height: 3, background: 'var(--surface)', borderRadius: 2, marginBottom: '1.5rem', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(answered / categories.length) * 100}%`, background: '#272C84', transition: 'width .3s' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {categories.map((cat, ci) => {
          const chosen = scores[ci]
          const top = best(cat.options)
          const prompt = prompts?.[cat.title]
          return (
            <div key={ci} style={{ background: 'var(--bg)', border: `1px solid ${chosen !== undefined ? 'var(--border)' : 'var(--surface)'}`, borderRadius: '.25rem', padding: '1.25rem 1.5rem' }}>
              <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.5rem' }}>{cat.title}</p>
              {prompt && <p style={{ color: 'var(--chalk)', fontSize: '.875rem', lineHeight: 1.6, marginBottom: '1rem' }}>{prompt}</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                {cat.options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => setScores(s => ({ ...s, [ci]: i }))}
                    style={{ textAlign: 'left', background: chosen === i ? 'rgba(39,44,132,.08)' : 'transparent', border: `1px solid ${chosen === i ? 'rgba(39,44,132,.4)' : 'var(--border)'}`, borderRadius: '.2rem', color: chosen === i ? 'var(--text)' : 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.6, padding: '.75rem 1rem', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}
                    onMouseEnter={e => { if (chosen !== i) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-3)' } }}
                    onMouseLeave={e => { if (chosen !== i) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' } }}
                  >
                    <span style={{ color: scoreColor(opt.points, top), marginRight: '.5rem', fontWeight: 900 }}>
                      {mark(opt.points, top)}
                    </span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {answered === categories.length && (
        <button
          onClick={() => setDone(true)}
          style={{ marginTop: '1.5rem', background: '#272C84', border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.2em', textTransform: 'uppercase', padding: '.875rem 2rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          See My Score →
        </button>
      )}
    </div>
  )
}
