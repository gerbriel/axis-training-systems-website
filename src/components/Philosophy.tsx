const PILLARS = [
  { num: '01', title: 'Solution Focused', desc: 'Problems get solved. Obstacles are navigated. Progress is the point.' },
  { num: '02', title: 'Evidence Based',   desc: 'The science matters. We stay current and apply it practically.' },
  { num: '03', title: 'Transparent',      desc: 'You know the why behind every decision we make for your training.' },
  { num: '04', title: 'Everybody Eats',   desc: 'Every athlete on our roster gets the same level of attention and care.' },
]

export default function Philosophy() {
  return (
    <section id="philosophy" style={{ background: '#050505', borderTop: '1px solid #141414', borderBottom: '1px solid #141414', padding: '8rem 1.5rem' }}>
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          {/* Left */}
          <div>
            <p style={{ color: '#e63e3e', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '1.5rem' }}>
              Who We Are
            </p>
            <h2 style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: 0.9, fontSize: 'clamp(2rem,5vw,4rem)', color: '#fff', marginBottom: '2rem' }}>
              Coaching you can trust.
            </h2>
            <p style={{ color: '#555', fontSize: '.9rem', lineHeight: 1.8, marginBottom: '1.25rem' }}>
              Axis Training Systems is a team of competitive powerlifters and coaches who understand the sport from the inside. Every program we write reflects how the sport actually works — with RPE, block periodization, and real data at the center.
            </p>
            <p style={{ color: '#555', fontSize: '.9rem', lineHeight: 1.8 }}>
              We don't sell cookie-cutter plans. We work with individual athletes — your schedule, your lifts, your goals — and build programming that makes sense for where you actually are.
            </p>
          </div>

          {/* Right grid */}
          <div className="grid grid-cols-2 gap-4">
            {PILLARS.map(p => (
              <div key={p.num} style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', padding: '2rem' }}>
                <p style={{ color: '#e63e3e', fontSize: '1.75rem', fontWeight: 900, marginBottom: '.75rem' }}>{p.num}</p>
                <p className="text-white font-bold text-sm mb-2">{p.title}</p>
                <p style={{ color: '#444', fontSize: '.8rem', lineHeight: 1.6 }}>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
