import { useState, useEffect } from 'react'
import { POSTS } from '../data/blog'
import type { BlogPost } from '../data/blog'
import { href } from '../utils/nav'
import { getApprovedPosts } from '../data/pendingContent'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

function coachHref(slug: string) {
  const base = (import.meta as any).env?.BASE_URL ?? '/'
  return `${base.replace(/\/$/, '')}/coaches/${slug}`
}

export default function BlogIndex() {
  const [allPosts, setAllPosts] = useState<BlogPost[]>(POSTS)

  useEffect(() => {
    const localApproved = getApprovedPosts()
    if (localApproved.length === 0) return
    const mapped: BlogPost[] = localApproved.map(p => ({
      slug: p.id,
      title: p.title ?? '',
      subtitle: p.subtitle ?? '',
      date: new Date(p.submittedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      author: p.coachName,
      authorRole: '',
      coachSlug: p.coachSlug,
      coachName: p.coachName,
      tags: (p.tags ?? '').split(',').map(t => t.trim()).filter(Boolean),
      summary: p.summary ?? '',
      content: (p.content ?? '').split('\n\n').map(text => ({ type: 'paragraph' as const, text })),
    }))
    setAllPosts([...POSTS, ...mapped])
  }, [])

  return (
    <div style={{ background: '#080808', minHeight: '100vh' }}>
      {/* Mini nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(8,8,8,0.95)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #1a1a1a', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 24, filter: 'brightness(0) invert(1)' }} />
        </a>
        <span style={{ color: '#1a1a1a' }}>›</span>
        <span style={{ color: '#555', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>Blog</span>
      </nav>

      {/* Header */}
      <section style={{ padding: '6rem 2rem 4rem', borderBottom: '1px solid #111' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Axis Blog</p>
          <h1 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(2.5rem, 7vw, 5rem)', textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: .9 }}>
            Meet Recaps &<br />Case Studies
          </h1>
          <p style={{ color: '#444', fontSize: '.9rem', marginTop: '1.25rem', maxWidth: 480, lineHeight: 1.7 }}>
            In-depth breakdowns from the Axis coaching staff — programming decisions, injury management, meet strategy, and athlete outcomes.
          </p>
        </div>
      </section>

      {/* Post list */}
      <section style={{ padding: '4rem 2rem', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: '#111' }}>
          {allPosts.map(post => (
            <a
              key={post.slug}
              href={href(`/blog/${post.slug}`)}
              style={{ display: 'block', background: '#080808', padding: '2.5rem 2rem', textDecoration: 'none', transition: 'background .15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#0d0d0d')}
              onMouseLeave={e => (e.currentTarget.style.background = '#080808')}
            >
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.75rem' }}>
                {post.tags.map(t => (
                  <span key={t} style={{ background: 'rgba(230,62,62,.08)', border: '1px solid rgba(230,62,62,.2)', color: '#e63e3e', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.2rem .6rem', borderRadius: '.15rem' }}>{t}</span>
                ))}
              </div>
              <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(1.25rem, 3vw, 1.75rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: 1.05, marginBottom: '.75rem' }}>
                {post.title}
              </h2>
              <p style={{ color: '#555', fontSize: '.875rem', lineHeight: 1.7, marginBottom: '1.25rem', maxWidth: 600 }}>{post.summary}</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                  {post.coachSlug ? (
                    <a
                      href={coachHref(post.coachSlug)}
                      onClick={e => e.stopPropagation()}
                      style={{ color: '#e63e3e', fontSize: '.7rem', fontWeight: 700, textDecoration: 'none' }}
                      onMouseEnter={el => el.currentTarget.style.textDecoration = 'underline'}
                      onMouseLeave={el => el.currentTarget.style.textDecoration = 'none'}
                    >
                      {post.author}
                    </a>
                  ) : (
                    <span style={{ color: '#333', fontSize: '.7rem', fontWeight: 700 }}>{post.author}</span>
                  )}
                  <span style={{ color: '#1e1e1e' }}>·</span>
                  <span style={{ color: '#2a2a2a', fontSize: '.7rem' }}>{post.date}</span>
                </div>
                <span style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase' }}>Read →</span>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Footer strip */}
      <div style={{ background: '#030303', borderTop: '1px solid #111', padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 20, filter: 'brightness(0) invert(1)' }} />
        </a>
        <a href={href('/')} style={{ color: '#333', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', textDecoration: 'none' }}>← Back to site</a>
      </div>
    </div>
  )
}
