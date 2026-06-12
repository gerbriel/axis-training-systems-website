const SERVICES = [
  {
    num: '01',
    title: ['1:1 Coaching', 'Full Service'],
    desc: 'The most popular service at Axis. Athletes receive daily communication, unlimited technique analysis, individualized programming, and meet day handling. A high-contact service that allows coaches and athletes to address issues as they arise — adjusting training stress or providing technique accountability in real time.',
    highlights: ['Daily coach communication', 'Unlimited technique analysis', 'Individualized programming', 'Meet day handling included'],
    cta: 'Apply Now',
    href: '#coaches',
  },
  {
    num: '02',
    title: ['Game Day', 'Coaching'],
    desc: 'For athletes who want an experienced Axis coach in their corner on competition day. Includes video review, scouting reports, a meet day planning call, and in-person or remote handling. Axis coaches are present at all National competitions in Powerlifting America and USAPL, and at most IPF World Championship events.',
    highlights: ['Video review & scouting report', 'Meet day planning call', 'In-person or remote handling', 'Present at PA/USAPL Nationals & IPF Worlds'],
    cta: 'Apply Now',
    href: '#coaches',
  },
  {
    num: '03',
    title: ['Coaching', 'Mentorship'],
    desc: 'Designed for coaches at all levels — whether established, on the rise, or just getting started. Tailored to your specific areas of improvement, with a structured curriculum available for full development. Sessions weekly, bi-weekly, monthly, or as a one-time consultation.',
    highlights: ['Programming & biomechanics', 'Athlete psychology', 'Building a coaching business', 'Meet day strategy & case studies'],
    cta: 'Book a Consultation',
    href: '#coaches',
  },
  {
    num: '04',
    title: ['Movement', 'Consulting'],
    desc: 'For athletes not seeking full programming or ongoing coaching, but wanting focused support on technique. We offer movement coaching and consultations to refine your lifts and optimize movement for better performance and efficiency — as standalone sessions or a short-term series.',
    highlights: ['Video breakdown & cues', 'Technique correction plan', 'Standalone or short-term series', 'No long-term commitment required'],
    cta: 'Apply Now',
    href: '#coaches',
  },
]

const Dot = () => (
  <span style={{ width: '.375rem', height: '.375rem', borderRadius: '50%', background: '#bfa162', flexShrink: 0, display: 'inline-block' }} />
)

const Arrow = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
)

export default function Services() {
  return (
    <section id="services" style={{ background: '#0a1a33', padding: '8rem 1.5rem' }}>
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16">
          <div>
            <p style={{ color: '#f5b935', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>What We Offer</p>
            <h2 style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: 0.9, fontSize: 'clamp(2.5rem,6vw,5.5rem)', color: '#fff' }}>Services</h2>
          </div>
          <p style={{ color: '#444', maxWidth: '18rem', fontSize: '.875rem', lineHeight: 1.7 }}>
            Four distinct tracks — each designed for a specific stage and goal in your powerlifting journey.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4" style={{ gap: 1, background: '#1c3a63' }}>
          {SERVICES.map(s => (
            <article
              key={s.num}
              className="flex flex-col transition-colors"
              style={{ background: '#0a1a33', padding: '2.5rem', cursor: 'default' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#15375f')}
              onMouseLeave={e => (e.currentTarget.style.background = '#0a1a33')}
            >
              <span style={{ color: '#f5b935', fontWeight: 900, fontSize: '4rem', lineHeight: 1, marginBottom: '1.5rem', opacity: 0.35 }}>{s.num}</span>
              <h3 className="text-white font-bold text-lg leading-tight mb-4">
                {s.title[0]}<br /><span style={{ color: '#555', fontSize: '.8rem', fontWeight: 600 }}>{s.title[1]}</span>
              </h3>
              <p style={{ color: '#444', fontSize: '.875rem', lineHeight: 1.7, flex: 1, marginBottom: '2rem' }}>{s.desc}</p>
              <ul style={{ marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
                {s.highlights.map(h => (
                  <li key={h} className="flex items-center gap-3" style={{ fontSize: '.8rem', color: '#666' }}>
                    <Dot /> {h}
                  </li>
                ))}
              </ul>
              <a
                href={s.href}
                target={s.href.startsWith('http') ? '_blank' : undefined}
                rel={s.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                className="inline-flex items-center gap-2 text-white text-xs font-black px-6 py-3 rounded tracking-widest uppercase transition-colors"
                style={{ border: '1px solid #1c3a63', width: 'fit-content' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#c8102e')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#1c3a63')}
              >
                {s.cta} <Arrow />
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
