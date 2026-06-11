import { useState, useEffect } from 'react'
import { fetchApprovedMeets } from '../lib/contentApi'
import { supabaseConfigured } from '../lib/supabase'

const STATIC_MEETS = [
  {
    name: 'USAPL Raw Nationals',
    date: 'July 24–27, 2026',
    location: 'Reno, NV',
    federation: 'USAPL',
    type: 'National',
    note: 'Axis coaches attending & handling',
  },
  {
    name: 'Powerlifting America Nationals',
    date: 'August 2026',
    location: 'TBD',
    federation: 'PA',
    type: 'National',
    note: 'Axis coaches attending & handling',
  },
  {
    name: 'IPF World Classic Championships',
    date: 'September 2026',
    location: 'TBD',
    federation: 'IPF',
    type: 'World',
    note: 'Team Axis athletes competing',
  },
]

type Meet = typeof STATIC_MEETS[number]

const badgeColor: Record<string, string> = {
  National: 'rgba(230,62,62,.12)',
  World: 'rgba(255,160,0,.1)',
  Regional: 'rgba(100,180,255,.08)',
}
const badgeBorder: Record<string, string> = {
  National: 'rgba(230,62,62,.3)',
  World: 'rgba(255,160,0,.35)',
  Regional: 'rgba(100,180,255,.25)',
}
const badgeText: Record<string, string> = {
  National: '#e63e3e',
  World: '#ffa000',
  Regional: '#64b4ff',
}

export default function UpcomingMeets() {
  const [meets, setMeets] = useState<Meet[]>(STATIC_MEETS)

  useEffect(() => {
    fetchApprovedMeets(!supabaseConfigured).then(approved => {
      if (approved.length === 0) return
      const mapped: Meet[] = approved.map(m => ({
        name: m.meetName ?? '',
        date: m.meetDate ?? '',
        location: m.meetLocation ?? '',
        federation: m.federation ?? '',
        type: m.meetType ?? 'Local',
        note: m.meetNote ?? '',
      }))
      setMeets([...STATIC_MEETS, ...mapped])
    }).catch(() => { /* fallback to static only */ })
  }, [])

  return (
    <section id="upcoming-meets" style={{ background: '#030303', borderTop: '1px solid #0d0d0d', padding: '6rem 1.5rem' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1.5rem', marginBottom: '3rem' }}>
          <div>
            <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.6rem' }}>Competition Calendar</p>
            <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(2rem, 5vw, 3.5rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: .95 }}>
              Upcoming<br />Meets
            </h2>
          </div>
          <p style={{ color: '#444', fontSize: '.875rem', maxWidth: '22rem', lineHeight: 1.7 }}>
            Axis coaches are active competitors and handlers. You'll find us on the platform and in the warm-up room at every major meet.
          </p>
        </div>

        <div style={{ display: 'grid', gap: '1px', background: '#111' }}>
          {meets.map((m, i) => (
            <div
              key={i}
              style={{
                background: '#080808',
                padding: '1.75rem 2rem',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '1.5rem',
                transition: 'background .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#0d0d0d')}
              onMouseLeave={e => (e.currentTarget.style.background = '#080808')}
            >
              {/* Type badge */}
              <div style={{
                background: badgeColor[m.type] ?? 'rgba(255,255,255,.05)',
                border: `1px solid ${badgeBorder[m.type] ?? '#222'}`,
                borderRadius: '.2rem',
                padding: '.25rem .75rem',
                flexShrink: 0,
              }}>
                <span style={{ color: badgeText[m.type] ?? '#888', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase' }}>{m.type}</span>
              </div>

              {/* Name */}
              <div style={{ flex: '1 1 200px' }}>
                <p style={{ color: '#fff', fontWeight: 800, fontSize: '.95rem' }}>{m.name}</p>
                <p style={{ color: '#444', fontSize: '.75rem', marginTop: '.15rem' }}>{m.federation}</p>
              </div>

              {/* Date */}
              <div style={{ flexShrink: 0, minWidth: 160 }}>
                <p style={{ color: '#888', fontSize: '.8rem', fontWeight: 600 }}>{m.date}</p>
                <p style={{ color: '#333', fontSize: '.7rem', marginTop: '.15rem' }}>{m.location}</p>
              </div>

              {/* Note */}
              <div style={{ flexShrink: 0 }}>
                <p style={{ color: '#333', fontSize: '.7rem', fontWeight: 600, letterSpacing: '.05em' }}>{m.note}</p>
              </div>
            </div>
          ))}
        </div>

        <p style={{ color: '#222', fontSize: '.75rem', marginTop: '1.5rem' }}>
          Meet schedule subject to change. Follow{' '}
          <a href="https://www.instagram.com/axistrainingsystems/" target="_blank" rel="noopener" style={{ color: '#333', textDecoration: 'underline' }}>@axistrainingsystems</a>
          {' '}for real-time updates.
        </p>
      </div>
    </section>
  )
}
