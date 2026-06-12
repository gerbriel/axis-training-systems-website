import Apply from '../components/Apply'
import PrivacyPolicy from '../components/PrivacyPolicy'
import { useState, useEffect } from 'react'
import { getCoachBySlug } from '../data/coaches'
import { href, coachHref } from '../utils/nav'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

interface Props { slug: string }

export default function ApplyPage({ slug }: Props) {
  const coach = getCoachBySlug(slug)
  const [showPrivacy, setShowPrivacy] = useState(false)

  useEffect(() => {
    const handler = () => setShowPrivacy(true)
    window.addEventListener('open-privacy', handler)
    return () => window.removeEventListener('open-privacy', handler)
  }, [])

  if (!coach) {
    return (
      <div style={{ background: '#0a1a33', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1.5rem' }}>
        <p style={{ color: '#f5b935', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.3em', textTransform: 'uppercase' }}>404</p>
        <h1 style={{ color: '#fff', fontWeight: 900, fontSize: '2rem', textTransform: 'uppercase' }}>Coach Not Found</h1>
        <a href={href('/')} style={{ color: '#c7d0de', fontSize: '.8rem', textDecoration: 'underline' }}>← Back to site</a>
      </div>
    )
  }

  return (
    <div style={{ background: '#0a1a33', minHeight: '100vh' }}>
      {/* ── Mini Nav ─────────────────────────────────────────────────────── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(10,26,51,0.95)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #1c3a63', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 24, filter: 'brightness(0) invert(1)' }} />
        </a>
        <span style={{ color: '#b8c2d4' }}>›</span>
        <a
          href={coachHref(coach.slug)}
          style={{ color: '#c7d0de', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', textDecoration: 'none', transition: 'color .15s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#b8c2d4'}
          onMouseLeave={e => e.currentTarget.style.color = '#c7d0de'}
        >
          {coach.name}
        </a>
        <span style={{ color: '#b8c2d4' }}>›</span>
        <span style={{ color: '#c7d0de', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>Apply</span>
      </nav>

      {/* Apply form — passes preselected coach name */}
      <Apply preselectedCoach={coach.name} />

      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}

      {/* Footer strip */}
      <div style={{ background: '#0a1a33', borderTop: '1px solid #0b2f5b', padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 20, filter: 'brightness(0) invert(1)' }} />
        </a>
        <a href={coachHref(coach.slug)} style={{ color: '#b8c2d4', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', textDecoration: 'none' }}>
          ← Back to {coach.firstName}'s Profile
        </a>
      </div>
    </div>
  )
}
