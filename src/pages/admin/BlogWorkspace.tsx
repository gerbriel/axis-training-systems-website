import { useState } from 'react'
import BlogPanel from './BlogPanel'
import RotationPanel from './RotationPanel'

/**
 * Blog, with the publishing rotation folded in behind a dropdown.
 *
 * The two used to be separate top-level tabs, but they are the same job seen
 * twice — the posts themselves, and the schedule of whose turn it is to write
 * one — so this pairs them under one entry and lets the dropdown switch view.
 */
type View = 'posts' | 'rotation'

export default function BlogWorkspace({ isDemo = false }: { isDemo?: boolean }) {
  const [view, setView] = useState<View>('posts')

  return (
    <div>
      <div className="dash-pad" style={{ display: 'flex', alignItems: 'center', gap: '.75rem', paddingBottom: 0 }}>
        <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>
          Viewing
        </label>
        <select
          className="field"
          value={view}
          onChange={e => setView(e.target.value as View)}
          style={{ maxWidth: 260, minHeight: '2.5rem' }}
        >
          <option value="posts">Blog posts</option>
          <option value="rotation">Publishing rotation</option>
        </select>
      </div>

      {view === 'posts' ? <BlogPanel isDemo={isDemo} /> : <RotationPanel isDemo={isDemo} />}
    </div>
  )
}
