const PILLARS = [
  { num: '01', title: 'Solution Focused', desc: 'Problems get solved. Obstacles are navigated. Progress is the point.' },
  { num: '02', title: 'Evidence Based',   desc: 'The science matters. We stay current and apply it practically.' },
  { num: '03', title: 'Transparent',      desc: 'You know the why behind every decision we make for your training.' },
  { num: '04', title: 'Everybody Eats',   desc: 'Every athlete on our roster gets the same level of attention and care.' },
]

export default function Philosophy() {
  return (
    <section id="philosophy" style={{ background: '#10131a', borderTop: '1px solid #0d2040', borderBottom: '1px solid #0d2040', padding: '8rem 1.5rem' }}>
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          {/* Left */}
          <div>
            <p style={{ color: '#c8102e', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '1.5rem' }}>
              Who We Are
            </p>
            <h2 style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: 0.9, fontSize: 'clamp(2rem,5vw,4rem)', color: '#fff', marginBottom: '2rem' }}>
              Coaching you can trust.
            </h2>
            <p style={{ color: '#555', fontSize: '.9rem', lineHeight: 1.8, marginBottom: '1.25rem' }}>
              Founded in 2021, Axis Training Systems was created with a mission of wholeheartedly investing in powerlifting athletes, regardless of background, level, or personality type. We believe that a strong coach-athlete rapport enables the athlete with intrinsic motivation, guidance, and support that drives them to reach their potential.
            </p>
            <p style={{ color: '#555', fontSize: '.9rem', lineHeight: 1.8, marginBottom: '2rem' }}>
              We focus on evidence-based premium coaching, utilizing lifter data to create individualized training protocols and provide mentorship in building a resilient mindset. Our goal is to help lifters reach their full potential on the platform and build the next generation of the powerlifting community.
            </p>
            {/* Real quote */}
            <blockquote style={{ borderLeft: '3px solid #c8102e', paddingLeft: '1.25rem' }}>
              <p style={{ color: '#888', fontSize: '.875rem', lineHeight: 1.8, fontStyle: 'italic', marginBottom: '.5rem' }}>
                "Our vision at Axis is one where everyone is treated equally no matter what level athlete they are. We believe coaching is more than just crunching numbers and critiquing form. We establish strong coach-athlete bonds that give the athlete a sense of intrinsic motivation."
              </p>
              <p style={{ color: '#c8102e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase' }}>— Ronnie Vallejo, Founder</p>
            </blockquote>
          </div>

          {/* Right column: photo + pillar grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '.15rem' }}>
              <img
                src="https://static.wixstatic.com/media/e99af3_5dba1d18186b43a686e4f40af779c1c1~mv2.jpg"
                alt="Axis athlete competing"
                loading="lazy"
                style={{
                  width: '100%',
                  height: '280px',
                  objectFit: 'cover',
                  objectPosition: 'center 30%',
                  display: 'block',
                  filter: 'grayscale(30%) brightness(0.75)',
                }}
              />
              {/* left-edge fade into bg */}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(10,31,60,0.55) 0%, transparent 40%)' }} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {PILLARS.map(p => (
                <div key={p.num} style={{ background: '#0e1c30', border: '1px solid #112038', padding: '2rem' }}>
                  <p style={{ color: '#c8102e', fontSize: '1.75rem', fontWeight: 900, marginBottom: '.75rem' }}>{p.num}</p>
                  <p className="text-white font-bold text-sm mb-2">{p.title}</p>
                  <p style={{ color: '#444', fontSize: '.8rem', lineHeight: 1.6 }}>{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
