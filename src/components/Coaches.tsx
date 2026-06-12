import { COACHES } from '../data/coaches'
import { coachHref, applyHref } from '../utils/nav'

export default function Coaches() {
  return (
    <section id="coaches" style={{ background: '#10131a', borderTop: '1px solid #0d2040', borderBottom: '1px solid #0d2040', padding: '8rem 1.5rem' }}>
      <div className="max-w-7xl mx-auto">
        <div className="mb-16">
          <p style={{ color: '#c8102e', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>The Team</p>
          <h2 style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: 0.9, fontSize: 'clamp(2.5rem,6vw,5.5rem)', color: '#fff', marginBottom: '1.25rem' }}>Our Coaches</h2>
          <p style={{ color: '#444', fontSize: '.9rem', maxWidth: '28rem' }}>Browse the team, view each coach's profile, and apply directly to the one that's the right fit for you.</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {COACHES.map(c => (
            <div key={c.slug} style={{ background: '#0e1c30', border: '1px solid #112038', padding: '2rem', display: 'flex', flexDirection: 'column' }}>
              {/* Avatar */}
              {c.photo ? (
                <img
                  src={c.photo} alt={c.name}
                  style={{ width: '4rem', height: '4rem', borderRadius: '50%', objectFit: 'cover', marginBottom: '1.25rem', flexShrink: 0, border: '2px solid #152842', background: '#112038' }}
                  loading="lazy"
                />
              ) : (
                <div
                  className="flex items-center justify-center mb-5"
                  style={{ width: '3rem', height: '3rem', borderRadius: '50%', background: '#0d2040', border: '1px solid #1c3255', flexShrink: 0 }}
                >
                  <span style={{ color: '#c8102e', fontWeight: 900, fontSize: '1.1rem' }}>{c.firstName[0]}</span>
                </div>
              )}
              <p className="text-white font-bold text-sm mb-1">{c.name}</p>
              <p style={{ color: '#c8102e', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase', marginBottom: '.75rem' }}>{c.role}</p>
              <p style={{ color: '#444', fontSize: '.75rem', lineHeight: 1.6, marginBottom: '1.25rem', flex: 1 }}>{c.tagline}</p>
              {/* Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginTop: 'auto' }}>
                <a
                  href={coachHref(c.slug)}
                  style={{ display: 'block', textAlign: 'center', background: 'transparent', border: '1px solid #243650', color: '#888', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.5rem', borderRadius: '.2rem', textDecoration: 'none', transition: 'border-color .15s, color .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#555'; e.currentTarget.style.color = '#fff' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#243650'; e.currentTarget.style.color = '#888' }}
                >
                  View Profile
                </a>
                <a
                  href={c.bookCallUrl ?? 'https://calendly.com/ronnie-axistrainingsystems'}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'block', textAlign: 'center', background: 'transparent', border: '1px solid rgba(200,16,46,.25)', color: '#c8102e', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.5rem', borderRadius: '.2rem', textDecoration: 'none', transition: 'border-color .15s, background .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#c8102e'; e.currentTarget.style.background = 'rgba(200,16,46,.08)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(200,16,46,.25)'; e.currentTarget.style.background = 'transparent' }}
                >
                  Book a Call
                </a>
                <a
                  href={applyHref(c.slug)}
                  style={{ display: 'block', textAlign: 'center', background: '#c8102e', border: 'none', color: '#fff', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.5rem', borderRadius: '.2rem', textDecoration: 'none', transition: 'background .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#a30c26' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#c8102e' }}
                >
                  Choose This Coach
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
