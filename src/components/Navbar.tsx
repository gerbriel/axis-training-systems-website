import { useState, useEffect } from 'react'
import { href, adminHref } from '../utils/nav'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

const NAV_LINKS = [
  { label: 'Services',     href: '#services' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Coaches',      href: '#coaches' },
  { label: 'Blog',         href: href('/blog') },
  { label: 'Free Guides',  href: href('/guides') },
  { label: 'Tools',        href: '#tools' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={scrolled ? {
        background: 'rgba(8,8,8,0.95)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #1e1e1e',
      } : {}}
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <a href={href('/')} className="inline-flex items-center">
          <img
            src={`${BASE}logo.svg`}
            alt="Axis Training Systems"
            style={{ height: 32, width: 'auto', filter: 'brightness(0) invert(1)' }}
          />
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map(link => (
            <a
              key={link.label}
              href={link.href}
              style={{ color: '#666', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', transition: 'color .2s' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={e => (e.currentTarget.style.color = '#666')}
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-5">
          <a
            href="#coaches"
            className="text-white text-xs font-black px-5 py-2.5 rounded tracking-widest uppercase transition-colors"
            style={{ border: '1px solid #2a2a2a' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#e63e3e')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2a2a')}
          >
            Book a Call
          </a>
          <a
            href="#coaches"
            className="text-white text-xs font-black px-5 py-2.5 rounded tracking-widest uppercase transition-colors"
            style={{ background: '#e63e3e' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#c42e2e')}
            onMouseLeave={e => (e.currentTarget.style.background = '#e63e3e')}
          >
            Work With Us
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-1 text-white"
          onClick={() => setMenuOpen(v => !v)}
          aria-label="Toggle menu"
        >
          {menuOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          )}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden px-6 pb-6 pt-2 flex flex-col gap-5" style={{ background: '#0a0a0a', borderTop: '1px solid #1e1e1e' }}>
          {NAV_LINKS.map(link => (
            <a
              key={link.label}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              style={{ color: '#fff', fontSize: '.875rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}
            >
              {link.label}
            </a>
          ))}
          <a
            href="#coaches"
            onClick={() => setMenuOpen(false)}
            style={{ color: '#fff', fontSize: '.875rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}
          >
            Book a Call
          </a>
          <a
            href="#coaches"
            onClick={() => setMenuOpen(false)}
            className="text-white text-xs font-black px-5 py-3 rounded text-center tracking-widest uppercase"
            style={{ background: '#e63e3e' }}
          >
            Work With Us
          </a>
        </div>
      )}
    </nav>
  )
}
