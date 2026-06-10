const BASE = (import.meta as any).env?.BASE_URL ?? '/'

const NAV_LINKS = [
  { label: 'Services',     href: '#services' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Our Coaches',  href: '#coaches' },
  { label: 'Apply',        href: '#apply' },
]

const InstagramIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
  </svg>
)

const YoutubeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/>
    <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/>
  </svg>
)

function SocialLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href} target="_blank" rel="noopener" aria-label={label}
      style={{ color: '#333', transition: 'color .2s' }}
      onMouseEnter={e => (e.currentTarget.style.color = '#e63e3e')}
      onMouseLeave={e => (e.currentTarget.style.color = '#333')}
    >
      {children}
    </a>
  )
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <a
        href={href}
        style={{ color: '#444', fontSize: '.875rem', transition: 'color .2s', display: 'block' }}
        onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
        onMouseLeave={e => (e.currentTarget.style.color = '#444')}
      >
        {children}
      </a>
    </li>
  )
}

export default function Footer() {
  return (
    <footer style={{ background: '#030303', borderTop: '1px solid #141414', padding: '5rem 1.5rem 3rem' }}>
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-3 gap-12 mb-12">

          {/* Brand */}
          <div>
            <img
              src={`${BASE}logo.svg`}
              alt="Axis Training Systems"
              style={{ height: 28, width: 'auto', filter: 'brightness(0) invert(1)', marginBottom: '1rem' }}
            />
            <p style={{ color: '#333', fontSize: '.875rem', lineHeight: 1.7, maxWidth: '18rem', marginBottom: '1.5rem' }}>
              Solution focused. Evidence based. Transparent. Everybody eats.
            </p>
            <div className="flex gap-4">
              <SocialLink href="https://www.instagram.com/axistrainingsystems/" label="Instagram"><InstagramIcon /></SocialLink>
              <SocialLink href="https://www.youtube.com/@axistrainingsystems" label="YouTube"><YoutubeIcon /></SocialLink>
              <SocialLink href="https://linktr.ee/Axis.Training.Systems" label="Linktree">
                <span style={{ fontSize: '.65rem', fontWeight: 900, letterSpacing: '.05em' }}>Linktree</span>
              </SocialLink>
            </div>
          </div>

          {/* Navigate */}
          <div>
            <p style={{ color: '#222', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '1.25rem' }}>Navigate</p>
            <ul style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              {NAV_LINKS.map(l => <FooterLink key={l.label} href={l.href}>{l.label}</FooterLink>)}
            </ul>
          </div>

          {/* Connect */}
          <div>
            <p style={{ color: '#222', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '1.25rem' }}>Connect</p>
            <ul style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              <FooterLink href="https://www.instagram.com/axistrainingsystems/">Instagram</FooterLink>
              <FooterLink href="https://www.youtube.com/@axistrainingsystems">YouTube</FooterLink>
              <FooterLink href="https://linktr.ee/Axis.Training.Systems">Linktree</FooterLink>
            </ul>
          </div>
        </div>

        <div className="flex flex-col md:flex-row justify-between gap-4 pt-8" style={{ borderTop: '1px solid #141414', color: '#1e1e1e', fontSize: '.75rem' }}>
          <p>© {new Date().getFullYear()} Axis Training Systems. All rights reserved.</p>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('open-privacy'))}
            style={{ color: '#2e2e2e', background: 'none', border: 'none', cursor: 'pointer', fontSize: '.75rem', padding: 0, transition: 'color .2s' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#888')}
            onMouseLeave={e => (e.currentTarget.style.color = '#2e2e2e')}
          >
            Privacy Policy
          </button>
        </div>
      </div>
    </footer>
  )
}
