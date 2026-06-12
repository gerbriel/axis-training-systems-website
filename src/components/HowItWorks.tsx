const STEPS = [
  { step: '01', title: 'Apply',   desc: 'Fill out the intake application. Tell us about your lifts, your schedule, your goals. We review every submission personally.' },
  { step: '02', title: 'Onboard', desc: "Once accepted, you'll be matched with your coach, added to a WhatsApp thread, and billed monthly through Zen Planner. You're in." },
  { step: '03', title: 'Train',   desc: 'Your program lives in a Google Sheet — updated each block, laid out clearly. Film your lifts, send them over WhatsApp, train to spec.' },
  { step: '04', title: 'Improve', desc: 'Your coach reviews every video and responds within 24 hours. Technique cues, load adjustments, programming tweaks — all handled in the thread.' },
]

const LOGISTICS = [
  {
    label: 'Pricing',
    value: '$165–$180',
    sub: 'Per month, depending on coach. Billed through Zen Planner.',
    icon: null,
  },
  {
    label: 'Communication',
    value: 'WhatsApp',
    sub: 'All coaching communication happens in a private WhatsApp thread. Direct access to your coach, no middleman.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#25D366" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
    ),
  },
  {
    label: 'Response Time',
    value: '24 hrs',
    sub: 'Guaranteed response within 24 hours. Send your training videos and questions — your coach has you covered.',
    icon: null,
  },
  {
    label: 'Your Program',
    value: 'Google Sheet',
    sub: 'Your training plan is delivered and updated in a shared Google Sheet. Clear, accessible, always up to date.',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34A853" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
        <line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/>
      </svg>
    ),
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" style={{ background: '#10131a', padding: '8rem 1.5rem' }}>
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <p style={{ color: '#c8102e', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>The Process</p>
            <h2 style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: 0.9, fontSize: 'clamp(2.5rem,6vw,5.5rem)', color: '#fff' }}>How It Works</h2>
          </div>
          <p style={{ color: '#444', maxWidth: '18rem', fontSize: '.875rem', lineHeight: 1.7 }}>
            Simple tools, direct communication, no bloated apps. Just you, your coach, and the work.
          </p>
        </div>

        {/* Action photo accent */}
        <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '.15rem', marginBottom: '1px' }}>
          <img
            src="https://static.wixstatic.com/media/c0cc37_796d8fc359f64ca8a68c705fc054c7d5~mv2.jpg"
            alt="Axis athlete on platform"
            loading="lazy"
            style={{
              width: '100%',
              height: 'clamp(180px, 22vw, 300px)',
              objectFit: 'cover',
              objectPosition: 'center 25%',
              display: 'block',
              filter: 'grayscale(40%) brightness(0.6)',
            }}
          />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(16,19,26,0.3), rgba(16,19,26,0.7))' }} />
        </div>

        {/* 4-step strip */}
        <div className="grid md:grid-cols-4 mb-16" style={{ gap: 1, background: '#152842' }}>
          {STEPS.map(s => (
            <div key={s.step} style={{ background: '#10131a', padding: '2.5rem' }}>
              <p style={{ color: '#c8102e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Step {s.step}</p>
              <h3 style={{ color: '#fff', fontWeight: 900, fontSize: '1.5rem', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: 1, marginBottom: '1rem' }}>{s.title}</h3>
              <p style={{ color: '#444', fontSize: '.875rem', lineHeight: 1.7 }}>{s.desc}</p>
            </div>
          ))}
        </div>

        {/* Logistics cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {LOGISTICS.map(l => (
            <div key={l.label} style={{ background: '#0e1c30', border: '1px solid #112038', padding: '1.75rem' }}>
              <p style={{ color: '#c8102e', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase', marginBottom: '.75rem' }}>{l.label}</p>
              <div className="flex items-center gap-2 mb-2">
                {l.icon}
                <p style={{ color: '#fff', fontWeight: 900, fontSize: l.icon ? '1.1rem' : '1.75rem', lineHeight: 1 }}>{l.value}</p>
              </div>
              <p style={{ color: '#444', fontSize: '.8rem', lineHeight: 1.5 }}>{l.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
