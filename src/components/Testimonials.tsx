import { COACHES } from '../data/coaches'
import type { Coach } from '../data/coaches'
import { applyHref } from '../utils/nav'

// Pick 3 featured testimonials (one per featured coach)
const featured = [
  { coachSlug: 'ronnie-vallejo', idx: 0 },
  { coachSlug: 'lucas-sison',    idx: 1 },
  { coachSlug: 'ronnie-vallejo', idx: 1 },
]

export default function Testimonials() {
  const items = featured.flatMap(({ coachSlug, idx }) => {
    const coach = COACHES.find((c: Coach) => c.slug === coachSlug)
    if (!coach) return []
    const t = coach.testimonials[idx]
    if (!t) return []
    return [{ ...t, coachName: coach.name, coachSlug }]
  })

  if (items.length === 0) return null

  return (
    <section id="testimonials" style={{ padding: '6rem 2rem', background: '#0a1a33', borderTop: '1px solid #15375f' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Header + feature photo */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'flex-end', gap: '2rem', marginBottom: '3rem', flexWrap: 'wrap' }}>
          <div>
            <p style={{ color: '#f5b935', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.6rem' }}>Results</p>
            <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(2rem, 5vw, 3.5rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: .95 }}>
              Athletes Who<br />Made The Move
            </h2>
          </div>
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '.15rem', flexShrink: 0 }}>
            <img
              src="https://static.wixstatic.com/media/e99af3_79e2b83391ac4e3dbd00da3383c2e8f1~mv2.jpg"
              alt="Axis athlete competing"
              loading="lazy"
              style={{
                width: 'clamp(120px, 18vw, 240px)',
                height: 'clamp(80px, 12vw, 160px)',
                objectFit: 'cover',
                objectPosition: 'center 20%',
                display: 'block',
                filter: 'grayscale(30%) brightness(0.7)',
              }}
            />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(10,26,51,0.5) 0%, transparent 50%)' }} />
          </div>
        </div>

        {/* Testimonial cards */}
        <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {items.map((t, i) => (
            <div
              key={i}
              style={{
                background: '#0a1a33',
                border: '1px solid #0b2f5b',
                borderRadius: '.25rem',
                padding: '2.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
              }}
            >
              {/* Red quote glyph */}
              <span style={{ color: '#f5b935', fontSize: '3rem', fontWeight: 900, lineHeight: 1, opacity: .45, marginBottom: '-.5rem' }}>"</span>

              <p style={{ color: '#b8c2d4', fontSize: '.9rem', lineHeight: 1.85, flex: 1 }}>{t.quote}</p>

              {/* Result badge */}
              <div style={{
                display: 'inline-flex',
                alignSelf: 'flex-start',
                background: 'rgba(245,185,53,.08)',
                border: '1px solid rgba(245,185,53,.18)',
                borderRadius: '.2rem',
                padding: '.3rem .75rem',
              }}>
                <span style={{ color: '#f5b935', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase' }}>{t.result}</span>
              </div>

              {/* Athlete row */}
              <div style={{ borderTop: '1px solid #0b2f5b', paddingTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '.875rem' }}>
                {t.photo ? (
                  <img
                    src={t.photo}
                    alt={t.athlete}
                    style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid #1c3a63' }}
                  />
                ) : (
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#0b2f5b', border: '2px solid #1c3a63', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ color: '#f5b935', fontWeight: 900, fontSize: '1.1rem' }}>{t.athlete[0]}</span>
                  </div>
                )}
                <div>
                  <p style={{ color: '#fff', fontWeight: 700, fontSize: '.8rem' }}>{t.athlete}</p>
                  <p style={{ color: '#c7d0de', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginTop: '.1rem' }}>
                    coached by {t.coachName}
                  </p>
                </div>
                {/* Apply link aligned to the right */}
                <a
                  href={applyHref(t.coachSlug)}
                  style={{ marginLeft: 'auto', color: '#b8c2d4', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', textDecoration: 'none', transition: 'color .15s', whiteSpace: 'nowrap' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#c8102e'}
                  onMouseLeave={e => e.currentTarget.style.color = '#b8c2d4'}
                >
                  Apply →
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
