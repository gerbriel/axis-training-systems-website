const STATS = [
  { number: '5',    label: 'Coaches' },
  { number: '122',  label: 'Posts' },
  { number: '1.4K+', label: 'Followers' },
  { number: '3',    label: 'Services' },
]

export default function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col justify-center overflow-hidden" style={{ background: '#080808' }}>
      {/* Grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.025,
          backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      {/* Red glow */}
      <div
        className="absolute pointer-events-none"
        style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 700, height: 450, background: '#e63e3e', opacity: 0.04, filter: 'blur(140px)', borderRadius: '50%' }}
      />

      <div className="relative max-w-7xl mx-auto px-6" style={{ paddingTop: '9rem', paddingBottom: '6rem' }}>
        {/* Eyebrow */}
        <p style={{ color: '#e63e3e', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '2rem' }}>
          Powerlifting Coaching
        </p>

        {/* Headline */}
        <h1 style={{ fontWeight: 900, lineHeight: 0.88, letterSpacing: '-.03em', marginBottom: '2rem' }}>
          <span style={{ display: 'block', fontSize: 'clamp(3.5rem,10vw,9.5rem)', textTransform: 'uppercase', color: '#fff' }}>Axis</span>
          <span style={{ display: 'block', fontSize: 'clamp(3.5rem,10vw,9.5rem)', textTransform: 'uppercase', color: '#e63e3e' }}>Training.</span>
        </h1>

        {/* Taglines */}
        <div className="flex flex-wrap gap-x-8 gap-y-3 mb-10">
          {['Solution Focused', 'Evidence Based', 'Transparent', 'Everybody Eats'].map((tag, i, arr) => (
            <span key={tag} className="flex items-center gap-8">
              <span style={{ color: '#555', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.25em', textTransform: 'uppercase' }}>{tag}</span>
              {i < arr.length - 1 && <span style={{ color: '#333' }}>·</span>}
            </span>
          ))}
        </div>

        {/* CTAs */}
        <div className="flex flex-wrap gap-4">
          <a
            href="#apply"
            className="group inline-flex items-center gap-2 text-white text-xs font-black px-8 py-4 rounded tracking-widest uppercase transition-colors"
            style={{ background: '#e63e3e' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#c42e2e')}
            onMouseLeave={e => (e.currentTarget.style.background = '#e63e3e')}
          >
            Work With Us
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </a>
          <a
            href="#services"
            className="inline-flex items-center text-white text-xs font-bold px-8 py-4 rounded tracking-widest uppercase transition-colors"
            style={{ border: '1px solid #2a2a2a' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#444')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2a2a')}
          >
            Our Services
          </a>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap gap-x-14 gap-y-8 mt-20 pt-10" style={{ borderTop: '1px solid #1a1a1a' }}>
          {STATS.map(s => (
            <div key={s.label}>
              <p className="text-white font-black text-4xl leading-none">{s.number}</p>
              <p style={{ color: '#555', fontSize: '.65rem', marginTop: '.5rem', letterSpacing: '.2em', textTransform: 'uppercase' }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll cue */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2" style={{ color: '#2a2a2a' }}>
        <span style={{ fontSize: '.6rem', letterSpacing: '.3em', textTransform: 'uppercase' }}>Scroll</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-bounce"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </section>
  )
}
