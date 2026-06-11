import { getCoachBySlug } from '../data/coaches'
import { href, applyHref, adminHref } from '../utils/nav'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

interface Props { slug: string }

export default function CoachPage({ slug }: Props) {
  const coach = getCoachBySlug(slug)

  if (!coach) {
    return (
      <div style={{ background: '#080808', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1.5rem' }}>
        <p style={{ color: '#e63e3e', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.3em', textTransform: 'uppercase' }}>404</p>
        <h1 style={{ color: '#fff', fontWeight: 900, fontSize: '2rem', textTransform: 'uppercase' }}>Coach Not Found</h1>
        <a href={href('/')} style={{ color: '#555', fontSize: '.8rem', textDecoration: 'underline' }}>← Back to site</a>
      </div>
    )
  }

  return (
    <div style={{ background: '#080808', minHeight: '100vh' }}>
      {/* ── Mini Nav ─────────────────────────────────────────────────────── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(8,8,8,0.95)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #1a1a1a', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 24, filter: 'brightness(0) invert(1)' }} />
        </a>
        <span style={{ color: '#222', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase' }}>Coaches</span>
        <span style={{ color: '#1a1a1a' }}>›</span>
        <span style={{ color: '#555', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>{coach.name}</span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <a
            href={href('/')}
            style={{ color: '#444', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', textDecoration: 'none', transition: 'color .15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#888'}
            onMouseLeave={e => e.currentTarget.style.color = '#444'}
          >
            All Coaches
          </a>
          <a
            href={applyHref(coach.slug)}
            style={{ background: '#e63e3e', color: '#fff', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.4rem 1rem', borderRadius: '.2rem', textDecoration: 'none', transition: 'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = '#c42e2e'}
            onMouseLeave={e => e.currentTarget.style.background = '#e63e3e'}
          >
            Apply
          </a>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section style={{ padding: '6rem 2rem 4rem', borderBottom: '1px solid #141414' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3rem', alignItems: 'flex-start' }}>
            {/* Avatar */}
            <div style={{ flexShrink: 0 }}>
              {coach.photo ? (
                <img
                  src={coach.photo} alt={coach.name}
                  style={{ width: 140, height: 140, borderRadius: '50%', objectFit: 'cover', border: '3px solid #1e1e1e' }}
                />
              ) : (
                <div style={{ width: 120, height: 120, borderRadius: '50%', background: '#141414', border: '2px solid #1e1e1e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#e63e3e', fontWeight: 900, fontSize: '3rem' }}>{coach.firstName[0]}</span>
                </div>
              )}
            </div>
            {/* Name + role */}
            <div style={{ flex: 1, minWidth: 260 }}>
              <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.5rem' }}>{coach.role}</p>
              <h1 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(2.5rem, 7vw, 5rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: 0.9, marginBottom: '1.25rem' }}>
                {coach.name}
              </h1>
              <p style={{ color: '#555', fontSize: '1rem', lineHeight: 1.6, maxWidth: 520, marginBottom: '2rem' }}>{coach.tagline}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem' }}>
                <a
                  href={applyHref(coach.slug)}
                  style={{ background: '#e63e3e', color: '#fff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.2em', textTransform: 'uppercase', padding: '.875rem 2rem', borderRadius: '.25rem', textDecoration: 'none', transition: 'background .15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#c42e2e'}
                  onMouseLeave={e => e.currentTarget.style.background = '#e63e3e'}
                >
                  Apply to Work With {coach.firstName}
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────────────────── */}
      <section style={{ borderBottom: '1px solid #141414', background: '#050505' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 2rem', display: 'flex', flexWrap: 'wrap' }}>
          {coach.stats.map((s, i) => (
            <div key={i} style={{ flex: '1 1 120px', padding: '2rem 1.5rem', borderRight: i < coach.stats.length - 1 ? '1px solid #111' : 'none' }}>
              <p style={{ color: '#fff', fontWeight: 900, fontSize: '1.6rem', letterSpacing: '-.02em', marginBottom: '.25rem' }}>{s.value}</p>
              <p style={{ color: '#333', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Bio ──────────────────────────────────────────────────────────── */}
      <section style={{ padding: '5rem 2rem', borderBottom: '1px solid #111' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gap: '3rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <div>
            <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '1.5rem' }}>About</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {coach.bio.map((p, i) => (
                <p key={i} style={{ color: '#888', fontSize: '.95rem', lineHeight: 1.8 }}>{p}</p>
              ))}
            </div>
          </div>
          <div>
            {/* Philosophy pull-quote */}
            <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '1.5rem' }}>Coaching Philosophy</p>
            <blockquote style={{ borderLeft: '3px solid #e63e3e', paddingLeft: '1.5rem', marginBottom: '2.5rem' }}>
              <p style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700, lineHeight: 1.6, fontStyle: 'italic' }}>"{coach.coachingPhilosophy}"</p>
            </blockquote>
            {/* Specialties */}
            <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '1rem' }}>Specialties</p>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
              {coach.specialties.map((s, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', color: '#666', fontSize: '.875rem' }}>
                  <span style={{ width: 4, height: 4, background: '#e63e3e', borderRadius: '50%', flexShrink: 0 }} />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Services ─────────────────────────────────────────────────────── */}
      <section style={{ padding: '5rem 2rem', background: '#050505', borderBottom: '1px solid #111' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Services</p>
          <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(1.75rem, 4vw, 3rem)', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '3rem' }}>
            Work With {coach.firstName}
          </h2>
          <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {coach.services.map((s, i) => (
              <div key={i} style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '2rem', borderRadius: '.25rem', display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                  <p style={{ color: '#fff', fontWeight: 900, fontSize: '.9rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>{s.name}</p>
                  <span style={{ color: '#e63e3e', fontWeight: 900, fontSize: '.875rem', whiteSpace: 'nowrap' }}>{s.price}</span>
                </div>
                <p style={{ color: '#555', fontSize: '.85rem', lineHeight: 1.7 }}>{s.description}</p>
                <a
                  href={applyHref(coach.slug)}
                  style={{ marginTop: 'auto', display: 'inline-block', background: 'transparent', border: '1px solid #2a2a2a', color: '#888', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.6rem 1.25rem', borderRadius: '.2rem', textDecoration: 'none', transition: 'border-color .15s, color .15s', alignSelf: 'flex-start' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#e63e3e'; e.currentTarget.style.color = '#fff' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#888' }}
                >
                  Apply for this service →
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ─────────────────────────────────────────────────── */}
      <section style={{ padding: '5rem 2rem', borderBottom: '1px solid #111' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Results</p>
          <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(1.75rem, 4vw, 3rem)', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '3rem' }}>
            Athlete Outcomes
          </h2>
          <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {coach.testimonials.map((t, i) => (
              <div key={i} style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '2rem', borderRadius: '.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Quote mark */}
                <span style={{ color: '#e63e3e', fontSize: '2rem', fontWeight: 900, lineHeight: 1, opacity: .6 }}>"</span>
                <p style={{ color: '#aaa', fontSize: '.875rem', lineHeight: 1.8, flex: 1 }}>{t.quote}</p>
                <div style={{ borderTop: '1px solid #141414', paddingTop: '1rem', display: 'flex', alignItems: 'center', gap: '.875rem' }}>
                  {t.photo ? (
                    <img
                      src={t.photo}
                      alt={t.athlete}
                      style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid #1e1e1e' }}
                    />
                  ) : (
                    <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#141414', border: '2px solid #1e1e1e', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ color: '#e63e3e', fontWeight: 900, fontSize: '1rem' }}>{t.athlete[0]}</span>
                    </div>
                  )}
                  <div>
                    <p style={{ color: '#fff', fontWeight: 700, fontSize: '.8rem', marginBottom: '.2rem' }}>{t.athlete}</p>
                    <p style={{ color: '#e63e3e', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>{t.result}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section style={{ position: 'relative', padding: '7rem 2rem', overflow: 'hidden' }}>
        {/* Background image */}
        {coach.ctaBg && (
          <img
            src={coach.ctaBg}
            alt=""
            aria-hidden="true"
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'center 30%',
              filter: 'grayscale(50%) brightness(0.35)',
              pointerEvents: 'none',
            }}
          />
        )}
        {/* Dark overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(5,5,5,0.55) 0%, rgba(5,5,5,0.75) 60%, rgba(5,5,5,0.95) 100%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
          <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '1rem' }}>Ready to Start?</p>
          <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(2rem, 5vw, 3.5rem)', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '1.5rem' }}>
            Apply to Work With {coach.name}
          </h2>
          <p style={{ color: '#aaa', fontSize: '.95rem', lineHeight: 1.7, marginBottom: '2.5rem', maxWidth: 480, margin: '0 auto 2.5rem' }}>
            Fill out the application form. {coach.firstName} reviews every submission personally and will reach out within 24 hours.
          </p>
          <a
            href={applyHref(coach.slug)}
            style={{ display: 'inline-block', background: '#e63e3e', color: '#fff', fontWeight: 900, fontSize: '.8rem', letterSpacing: '.2em', textTransform: 'uppercase', padding: '1.125rem 2.5rem', borderRadius: '.25rem', textDecoration: 'none', transition: 'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = '#c42e2e'}
            onMouseLeave={e => e.currentTarget.style.background = '#e63e3e'}
          >
            Start Your Application →
          </a>
        </div>
      </section>

      {/* ── Footer strip ─────────────────────────────────────────────────── */}
      <div style={{ background: '#030303', borderTop: '1px solid #111', padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 20, filter: 'brightness(0) invert(1)' }} />
        </a>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <a href={href('/')} style={{ color: '#333', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', textDecoration: 'none' }}>← All Coaches</a>
          <a href={adminHref(coach.slug)} style={{ color: '#222', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', textDecoration: 'none' }}>Coach Admin</a>
        </div>
      </div>
    </div>
  )
}
