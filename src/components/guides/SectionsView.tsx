import { useState } from 'react'
import type { SectionsContent } from '../../lib/guideContent'
import { sectionHeading } from './styles'

/** A block's text is one cue per line. Blank lines are dropped, so a stray
 *  return at the end of a textarea does not render an empty bullet. */
function cues(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean)
}

const bullet: React.CSSProperties = {
  display: 'flex', gap: '.75rem', color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.65,
}

const bulletList: React.CSSProperties = {
  listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.5rem',
}

/**
 * A technique guide: one tab per section, each a set of labelled cue blocks and
 * the mistakes that go with them.
 *
 * The tab index is the state, not the section's title, so a guide whose sections
 * are renamed or reordered in the portal opens on its first tab instead of on
 * nothing.
 */
export default function SectionsView({ content }: { content: SectionsContent }) {
  const [tab, setTab] = useState(0)
  const group = content.groups[Math.min(tab, content.groups.length - 1)]
  if (!group) return null

  return (
    <div>
      {/* Section tabs */}
      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '1.75rem', borderBottom: '1px solid var(--surface)', paddingBottom: 0, flexWrap: 'wrap' }}>
        {content.groups.map((g, i) => (
          <button
            key={i}
            onClick={() => setTab(i)}
            style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === i ? '#272C84' : 'transparent'}`, color: tab === i ? 'var(--text)' : 'var(--text-dim)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.75rem 1.25rem', cursor: 'pointer', fontFamily: 'inherit', marginBottom: '-1px', transition: 'color .15s' }}
            onMouseEnter={e => { if (tab !== i) e.currentTarget.style.color = 'var(--text-3)' }}
            onMouseLeave={e => { if (tab !== i) e.currentTarget.style.color = 'var(--text-2)' }}
          >
            {g.title}
          </button>
        ))}
      </div>

      {/* Blocks */}
      <div style={{ display: 'grid', gap: '1rem', marginBottom: group.mistakes.length > 0 ? '1.5rem' : 0 }}>
        {group.blocks.map((block, i) => (
          <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--surface)', borderRadius: '.25rem', padding: '1.25rem 1.5rem' }}>
            <p style={sectionHeading}>{block.label}</p>
            <ul style={bulletList}>
              {cues(block.text).map((cue, j) => (
                <li key={j} style={bullet}>
                  <span style={{ color: 'var(--text)', flexShrink: 0, marginTop: '.3rem' }}>·</span>
                  {cue}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Common mistakes */}
      {group.mistakes.length > 0 && (
        <div style={{ background: 'rgba(39,44,132,.05)', border: '1px solid rgba(39,44,132,.15)', borderRadius: '.25rem', padding: '1.25rem 1.5rem' }}>
          <p style={sectionHeading}>Common Mistakes</p>
          <ul style={bulletList}>
            {group.mistakes.map((m, i) => (
              <li key={i} style={bullet}>
                <span style={{ color: 'var(--text)', flexShrink: 0, marginTop: '.35rem', fontWeight: 900 }}>✕</span>
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
