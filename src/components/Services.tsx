const SERVICES = [
  {
    num: '01',
    title: ['1:1 Coaching', 'Full Service'],
    desc: 'Full-service individualized programming. You get a dedicated coach, custom weekly training blocks built around your schedule and equipment, regular check-ins, form review, and meet prep.',
    highlights: ['Custom RPE-based blocks', 'Weekly coach check-ins', 'Video form review', 'Full meet prep included'],
    cta: 'Apply Now',
  },
  {
    num: '02',
    title: ['Meet Day', 'Coaching'],
    desc: 'An experienced Axis coach in your corner on competition day. Warm-up management, attempt selection, timing, and in-the-moment feedback — so you can focus entirely on lifting.',
    highlights: ['Warm-up management', 'Attempt selection strategy', 'In-person or remote', 'Pre-meet strategy call'],
    cta: 'Apply Now',
  },
  {
    num: '03',
    title: ['Movement', 'Coaching'],
    desc: "Technique-focused work for lifters who want to dial in their squat, bench, or deadlift mechanics. Ideal for newer competitors or anyone working through a technique bottleneck.",
    highlights: ['Video breakdown & cues', 'Technique correction plan', 'Accessory programming', 'Beginner-friendly'],
    cta: 'Apply Now',
  },
]

const Dot = () => (
  <span style={{ width: '.375rem', height: '.375rem', borderRadius: '50%', background: '#e63e3e', flexShrink: 0, display: 'inline-block' }} />
)

const Arrow = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
)

export default function Services() {
  return (
    <section id="services" style={{ background: '#080808', padding: '8rem 1.5rem' }}>
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16">
          <div>
            <p style={{ color: '#e63e3e', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>What We Offer</p>
            <h2 style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: 0.9, fontSize: 'clamp(2.5rem,6vw,5.5rem)', color: '#fff' }}>Services</h2>
          </div>
          <p style={{ color: '#444', maxWidth: '18rem', fontSize: '.875rem', lineHeight: 1.7 }}>
            Three distinct tracks — each designed for a specific stage and goal in your powerlifting journey.
          </p>
        </div>

        <div className="grid md:grid-cols-3" style={{ gap: 1, background: '#1e1e1e' }}>
          {SERVICES.map(s => (
            <article
              key={s.num}
              className="flex flex-col transition-colors"
              style={{ background: '#080808', padding: '2.5rem', cursor: 'default' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#0d0d0d')}
              onMouseLeave={e => (e.currentTarget.style.background = '#080808')}
            >
              <span style={{ color: '#e63e3e', fontWeight: 900, fontSize: '4rem', lineHeight: 1, marginBottom: '1.5rem', opacity: 0.35 }}>{s.num}</span>
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
                href="#apply"
                className="inline-flex items-center gap-2 text-white text-xs font-black px-6 py-3 rounded tracking-widest uppercase transition-colors"
                style={{ border: '1px solid #2a2a2a', width: 'fit-content' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#e63e3e')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2a2a')}
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
