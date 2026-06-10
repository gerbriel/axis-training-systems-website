const COACHES = [
  { initial: 'R', name: 'Ronnie Vallejo' },
  { initial: 'S', name: 'Seth Burman' },
  { initial: 'L', name: 'Lucas Sison' },
  { initial: 'K', name: 'Kobe Pham' },
  { initial: 'A', name: 'Aedan Nguyen' },
]

export default function Coaches() {
  return (
    <section id="coaches" style={{ background: '#050505', borderTop: '1px solid #141414', borderBottom: '1px solid #141414', padding: '8rem 1.5rem' }}>
      <div className="max-w-7xl mx-auto">
        <div className="mb-16">
          <p style={{ color: '#e63e3e', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>The Team</p>
          <h2 style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: 0.9, fontSize: 'clamp(2.5rem,6vw,5.5rem)', color: '#fff' }}>Our Coaches</h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {COACHES.map(c => (
            <div key={c.name} style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', padding: '2rem' }}>
              <div
                className="flex items-center justify-center mb-5"
                style={{ width: '3rem', height: '3rem', borderRadius: '50%', background: '#141414', border: '1px solid #222' }}
              >
                <span style={{ color: '#e63e3e', fontWeight: 900, fontSize: '1.1rem' }}>{c.initial}</span>
              </div>
              <p className="text-white font-bold text-sm mb-1">{c.name}</p>
              <p style={{ color: '#e63e3e', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Coach</p>
              <p style={{ color: '#444', fontSize: '.75rem', lineHeight: 1.6 }}>Competitive powerlifter &amp; full-service coach.</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
