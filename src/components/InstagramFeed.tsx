// Instagram Feed Section
// ─────────────────────────────────────────────────────────────────────────────
// "For now" implementation: branded placeholder grid with real profile stats +
// a CTA that links to the real account.
//
// UPGRADE PATH (when ready):
//   1. Sign up free at https://behold.so
//   2. Connect @axistrainingsystems
//   3. Copy your feed-id from the Behold dashboard
//   4. Replace the entire <PlaceholderGrid /> block below with:
//        <behold-widget feed-id="YOUR_FEED_ID" />
//      and add the script tag in index.html:
//        <script src="https://w.behold.so/widget.js" type="module"></script>
// ─────────────────────────────────────────────────────────────────────────────

const POST_ACCENTS = [
  { top: '#e63e3e', bottom: '#7a1f1f' },
  { top: '#1a1a1a', bottom: '#080808' },
  { top: '#7a1f1f', bottom: '#e63e3e' },
  { top: '#0d0d0d', bottom: '#1e1e1e' },
  { top: '#e63e3e', bottom: '#0d0d0d' },
  { top: '#1a1a1a', bottom: '#7a1f1f' },
  { top: '#080808', bottom: '#e63e3e' },
  { top: '#e63e3e', bottom: '#1a1a1a' },
  { top: '#0d0d0d', bottom: '#7a1f1f' },
]

const ICON_PATHS = [
  // barbell
  'M12 8H8m8 0h-3m0 0V5m0 3v3m-5-3V5m0 3v3M4 12h16M4 12v2m16-2v2M8 14H4m16 0h-4',
  // person lifting
  'M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6l-3 3 3 7 3-7-3-3zm-5 1h10',
  // chart up
  'M3 17l4-4 4 4 4-8 4 4',
  // medal
  'M12 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 0v4m-3-2h6',
  // dumbbell
  'M4 12h16M7 8v8m10-8v8M5 9v6m14-6v6',
  // target
  'M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0m-4 0a6 6 0 1 0 12 0 6 6 0 0 0-12 0m-2 0a8 8 0 1 0 16 0 8 8 0 0 0-16 0',
  // fire
  'M12 21c-4-4-4-8 0-10-1 3 2 5 3 3 2 3 0 5-3 7z',
  // trophy
  'M8 21h8m-4-4v4m-6-14H4a1 1 0 0 1-1-1V5h4m14 7h2a1 1 0 0 0 1-1V5h-4m-7 12a5 5 0 0 1-5-5V5h10v7a5 5 0 0 1-5 5z',
  // star
  'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
]

function PlaceholderPost({ index }: { index: number }) {
  const accent = POST_ACCENTS[index % POST_ACCENTS.length]
  const path = ICON_PATHS[index % ICON_PATHS.length]
  return (
    <div
      style={{
        aspectRatio: '1',
        background: `linear-gradient(135deg, ${accent.top}, ${accent.bottom})`,
        borderRadius: '.375rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'opacity .2s, transform .2s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.opacity = '.75'
        e.currentTarget.style.transform = 'scale(1.02)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.opacity = '1'
        e.currentTarget.style.transform = 'scale(1)'
      }}
      onClick={() => window.open('https://www.instagram.com/axistrainingsystems/', '_blank', 'noopener')}
      aria-label="View on Instagram"
    >
      {/* diagonal texture lines */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,.06) 10px, rgba(0,0,0,.06) 11px)',
        pointerEvents: 'none',
      }} />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="rgba(255,255,255,.18)"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ width: '40%', height: '40%', position: 'relative' }}
      >
        <path d={path} />
      </svg>
      {/* IG hover icon */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: 0, transition: 'opacity .2s',
      }}
        className="ig-overlay"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5" style={{ width: 28, height: 28 }}>
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
          <circle cx="12" cy="12" r="4"/>
          <circle cx="17.5" cy="6.5" r="0" fill="#fff" strokeWidth="2"/>
        </svg>
      </div>
    </div>
  )
}

export default function InstagramFeed() {
  return (
    <section
      id="instagram"
      style={{ background: '#060606', padding: '6rem 0', borderTop: '1px solid #111' }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 2rem' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>
            Follow Along
          </p>
          <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(2rem, 5vw, 3rem)', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '1rem' }}>
            @axistrainingsystems
          </h2>
          <p style={{ color: '#555', fontSize: '.9rem', marginBottom: '2rem' }}>
            1,490 followers · 122 posts
          </p>

          {/* TODO: Replace <PlaceholderGrid /> below with Behold widget once configured */}
          {/* See setup instructions in the file header comment above */}
        </div>

        {/* 3×3 placeholder grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '.5rem',
          maxWidth: 720,
          margin: '0 auto 3rem',
        }}>
          {Array.from({ length: 9 }, (_, i) => (
            <PlaceholderPost key={i} index={i} />
          ))}
        </div>

        {/* CTA */}
        <div style={{ textAlign: 'center' }}>
          <a
            href="https://www.instagram.com/axistrainingsystems/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '.625rem',
              background: 'transparent',
              border: '1.5px solid #e63e3e',
              color: '#fff',
              fontWeight: 900, fontSize: '.75rem', letterSpacing: '.2em', textTransform: 'uppercase',
              padding: '.875rem 2.25rem', borderRadius: '.25rem',
              textDecoration: 'none',
              transition: 'background .15s, color .15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#e63e3e'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {/* Instagram glyph */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" style={{ width: 18, height: 18, flexShrink: 0 }}>
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
              <circle cx="12" cy="12" r="4"/>
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            Follow on Instagram
          </a>
        </div>
      </div>
    </section>
  )
}
