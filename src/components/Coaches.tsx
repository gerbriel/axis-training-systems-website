import { COACHES } from '../data/coaches'
import { coachHref, applyHref, bookCoachHref } from '../utils/nav'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

export default function Coaches() {
  return (
    <section id="coaches" style={{ background: 'var(--bg)', padding: '8rem 1.5rem' }}>
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <div className="mb-12">
          <p className="label-rule" style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>
            The Team
          </p>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <h2 style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: 0.9, fontSize: 'clamp(2.5rem,6vw,5.5rem)', color: 'var(--text)' }}>Our Coaches</h2>
            <p style={{ color: 'var(--text-3)', fontSize: '.875rem', maxWidth: '22rem', lineHeight: 1.7 }}>
              Browse the team, view each coach's profile, and apply directly to the one that's the right fit for you.
            </p>
          </div>
        </div>

        {/* Full-bleed photo card grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {COACHES.map(c => {
            const photo = c.photo || c.ctaBg
            const [firstName, ...rest] = c.name.split(' ')
            const lastName = rest.join(' ')
            return (
              <div
                key={c.slug}
                style={{ position: 'relative', aspectRatio: '3/4', overflow: 'hidden', background: 'var(--surface)' }}
              >
                {/* Background photo */}
                {photo && (
                  <img
                    src={photo}
                    alt={c.name}
                    loading="lazy"
                    style={{
                      position: 'absolute', inset: 0,
                      width: '100%', height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'center top',
                      filter: 'grayscale(20%) brightness(0.75)',
                      transition: 'transform .4s ease',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.03)')}
                    onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                  />
                )}

                {/* Gradient overlay — purple secondary mid, black at bottom */}
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(15,9,107,0.25) 30%, rgba(59,47,133,0.35) 55%, rgba(0,0,0,0.88) 75%, rgba(0,0,0,0.98) 100%)',
                  pointerEvents: 'none',
                }} />

                {/* Top: label + logo stamp */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0,
                  padding: '1rem 1.25rem',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                }}>
                  <span style={{
                    color: 'rgba(255,255,255,0.65)',
                    fontSize: '.5rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase',
                    borderBottom: '1px solid rgba(255,255,255,0.25)', paddingBottom: '.2rem',
                  }}>
                    Meet The Team
                  </span>
                  <img
                    src={`${BASE}logo.svg`}
                    alt="Axis"
                    style={{ height: 16, width: 'auto', filter: 'brightness(0) invert(1)', opacity: 0.5 }}
                  />
                </div>

                {/* Bottom: name + role + actions */}
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '1.25rem' }}>
                  <p style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 900, fontSize: '.75rem', textTransform: 'uppercase', letterSpacing: '.05em', lineHeight: 1, marginBottom: '.1rem' }}>
                    {firstName}
                  </p>
                  <p style={{ color: '#ffffff', fontWeight: 900, fontSize: 'clamp(1.4rem,2.5vw,1.75rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: .9, marginBottom: '.75rem' }}>
                    {lastName}
                  </p>
                  <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase', marginBottom: '1rem' }}>
                    {c.role}
                  </p>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', marginBottom: '.875rem' }} />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                    <a
                      href={coachHref(c.slug)}
                      style={{
                        display: 'block', textAlign: 'center',
                        background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#ffffff', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase',
                        padding: '.5rem', borderRadius: '.2rem', textDecoration: 'none', transition: 'background .15s, border-color .15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
                    >
                      View Profile
                    </a>
                    <a
                      href={bookCoachHref(c.slug)}
                      style={{
                        display: 'block', textAlign: 'center',
                        background: 'transparent',
                        border: '1px solid rgba(245,185,53,.3)',
                        color: '#ffffff', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase',
                        padding: '.5rem', borderRadius: '.2rem', textDecoration: 'none', transition: 'background .15s, border-color .15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,185,53,.1)'; e.currentTarget.style.borderColor = '#f5b935' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(245,185,53,.3)' }}
                    >
                      Book a Call
                    </a>
                    <a
                      href={applyHref(c.slug)}
                      style={{
                        display: 'block', textAlign: 'center',
                        background: '#bfa162', border: 'none',
                        color: '#000000', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase',
                        padding: '.5rem', borderRadius: '.2rem', textDecoration: 'none', transition: 'background .15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#9a7c3a' }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#bfa162' }}
                    >
                      Choose This Coach
                    </a>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
