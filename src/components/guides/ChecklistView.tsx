import { useState } from 'react'
import type { ChecklistContent } from '../../lib/guideContent'

/**
 * A checklist guide: titled sections of items you tick off, with a progress bar
 * across the whole thing.
 *
 * The ticks live in this component and nowhere else. They are a reading aid on
 * a public page, not an account feature: nothing is stored, and closing the card
 * clears them, which is what has always happened and is the honest behaviour
 * for a page that does not know who you are.
 */
export default function ChecklistView({ content }: { content: ChecklistContent }) {
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const toggle = (key: string) =>
    setChecked(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const total = content.sections.reduce((a, s) => a + s.items.length, 0)
  const doneCount = checked.size
  // An empty checklist is a legitimate thing to save halfway through writing
  // one, and 0/0 is NaN%, which renders as a bar of literal "NaN%".
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0

  return (
    <div>
      {/* Progress bar */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.5rem' }}>
          <span style={{ color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>Progress</span>
          <span style={{ color: pct === 100 ? '#22c55e' : '#c8102e', fontSize: '.65rem', fontWeight: 900 }}>{doneCount}/{total}</span>
        </div>
        <div style={{ height: 4, background: 'var(--surface)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#22c55e' : '#c8102e', transition: 'width .3s' }} />
        </div>
      </div>

      {content.sections.map((section, si) => (
        <div key={`${si}:${section.title}`} style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase', marginBottom: '.75rem' }}>{section.title}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--surface)', borderRadius: '.25rem', overflow: 'hidden' }}>
            {section.items.map((item, ii) => {
              // Position, not text: two sections may name the same item, and an
              // owner may legitimately list the same thing twice in one of them.
              const key = `${si}:${ii}`
              const done = checked.has(key)
              return (
                <button
                  key={key}
                  onClick={() => toggle(key)}
                  style={{
                    display: 'flex', gap: '.875rem', alignItems: 'flex-start',
                    padding: '.875rem 1rem', background: done ? 'rgba(34,197,94,.04)' : 'transparent',
                    border: 'none', borderBottom: '1px solid var(--surface-2)', cursor: 'pointer',
                    textAlign: 'left', width: '100%', fontFamily: 'inherit',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => { if (!done) e.currentTarget.style.background = 'var(--bg)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = done ? 'rgba(34,197,94,.04)' : 'transparent' }}
                >
                  <span style={{
                    width: 18, height: 18, borderRadius: '.2rem', flexShrink: 0, marginTop: 1,
                    border: `1.5px solid ${done ? '#22c55e' : 'var(--border)'}`,
                    background: done ? '#22c55e' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all .1s',
                  }}>
                    {done && <span style={{ color: '#000', fontSize: 11, fontWeight: 900 }}>✓</span>}
                  </span>
                  <span style={{ color: done ? 'var(--text-dim)' : 'var(--text-4)', fontSize: '.85rem', lineHeight: 1.6, textDecoration: done ? 'line-through' : 'none', transition: 'color .1s' }}>
                    {item}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
