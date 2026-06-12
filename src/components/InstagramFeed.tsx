// ─── Instagram Feed via Behold.so ────────────────────────────────────────────
// Behold.so (free) serves real Instagram posts as an embeddable widget.
//
// TO ACTIVATE WITH REAL POSTS:
//   1. Sign up FREE at https://behold.so
//   2. Click "New Feed" → Connect → search @axistrainingsystems
//   3. Customize style (dark background, square grid recommended)
//   4. Copy the Feed ID shown in the embed code (looks like "abc123XYZ")
//   5. Paste it as the BEHOLD_FEED_ID value below — done!
//
// Note: Instagram blocks direct iframes (Meta policy). Behold.so is the
// cleanest free alternative — no API approval required.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'

// ← Paste your Behold.so feed ID here once you have it
const BEHOLD_FEED_ID = ''

function SetupCard() {
  return (
    <div style={{
      background: '#15375f', border: '1px dashed #1c3a63', borderRadius: '.5rem',
      padding: '3rem 2rem', textAlign: 'center', maxWidth: 520, margin: '0 auto',
    }}>
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'center' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#1c3a63" strokeWidth="1.25" style={{ width: 48, height: 48 }}>
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
          <circle cx="12" cy="12" r="4"/>
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
      </div>
      <p style={{ color: '#c7d0de', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase', marginBottom: '.75rem' }}>
        Instagram feed not yet connected
      </p>
      <p style={{ color: '#b8c2d4', fontSize: '.82rem', lineHeight: 1.7, marginBottom: '2rem' }}>
        Sign up free at{' '}
        <a href="https://behold.so" target="_blank" rel="noopener noreferrer" style={{ color: '#f5b935' }}>behold.so</a>
        , connect <strong style={{ color: '#c7d0de' }}>@axistrainingsystems</strong>, paste
        the Feed ID into <code style={{ color: '#c7d0de', background: '#0b2f5b', padding: '.1rem .4rem', borderRadius: '.2rem' }}>InstagramFeed.tsx</code>.
      </p>
      <a
        href="https://behold.so" target="_blank" rel="noopener noreferrer"
        style={{ display: 'inline-block', background: 'transparent', border: '1px solid #1c3a63', color: '#c7d0de', fontWeight: 700, fontSize: '.7rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '.75rem 1.75rem', borderRadius: '.25rem', textDecoration: 'none', transition: 'border-color .15s, color .15s' }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#c8102e'; e.currentTarget.style.color = '#fff' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#1c3a63'; e.currentTarget.style.color = '#c7d0de' }}
      >
        Set Up at behold.so →
      </a>
    </div>
  )
}

export default function InstagramFeed() {
  return (
    <section
      id="instagram"
      style={{ background: '#060606', padding: '6rem 0', borderTop: '1px solid #0b2f5b' }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 2rem' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <p style={{ color: '#f5b935', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>
            Follow Along
          </p>
          <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(2rem, 5vw, 3rem)', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '1rem' }}>
            @axistrainingsystems
          </h2>
        </div>

        {/* Real feed when BEHOLD_FEED_ID is set, setup card otherwise */}
        {BEHOLD_FEED_ID
          ? React.createElement('behold-widget', { 'feed-id': BEHOLD_FEED_ID })
          : <SetupCard />
        }

        {/* CTA */}
        <div style={{ textAlign: 'center', marginTop: '3rem' }}>
          <a
            href="https://www.instagram.com/axistrainingsystems/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '.625rem',
              background: 'transparent', border: '1.5px solid #c8102e', color: '#fff',
              fontWeight: 900, fontSize: '.75rem', letterSpacing: '.2em', textTransform: 'uppercase',
              padding: '.875rem 2.25rem', borderRadius: '.25rem', textDecoration: 'none',
              transition: 'background .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#bfa162' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
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
