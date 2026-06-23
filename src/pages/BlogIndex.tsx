import { useState, useEffect } from 'react'
import { POSTS } from '../data/blog'
import type { BlogPost } from '../data/blog'
import { href } from '../utils/nav'
import { fetchApprovedPosts } from '../lib/contentApi'
import { supabaseConfigured } from '../lib/supabase'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

function coachHref(slug: string) {
  const base = (import.meta as any).env?.BASE_URL ?? '/'
  return `${base.replace(/\/$/, '')}/coaches/${slug}`
}

export default function BlogIndex() {
  const [allPosts, setAllPosts] = useState<BlogPost[]>(POSTS)

  useEffect(() => {
    fetchApprovedPosts(!supabaseConfigured).then(approved => {
      if (approved.length === 0) return
      const mapped: BlogPost[] = approved.map(p => ({
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
    }).catch(() => { /* fallback to static only */ })
  }, [])

  return (
    <div style={{ background: '#000000', minHeight: '100vh' }}>
      {/* Mini nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(0,0,0,0.95)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #222222', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 24, filter: 'brightness(0) invert(1)' }} />
        </a>
        <span style={{ color: '#888888' }}>›</span>
        <span style={{ color: '#c7c7c7', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>Blog</span>
      </nav>

      {/* Header */}
      <section style={{ padding: '6rem 2rem 4rem', borderBottom: '1px solid #0d0d0d' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <p style={{ color: '#fff', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Axis Blog</p>
          <h1 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(2.5rem, 7vw, 5rem)', textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: .9 }}>
            Meet Recaps &<br />Case Studies
          </h1>
          <p style={{ color: '#c7c7c7', fontSize: '.9rem', marginTop: '1.25rem', maxWidth: 480, lineHeight: 1.7 }}>
            In-depth breakdowns from the Axis coaching staff — programming decisions, injury management, meet strategy, and athlete outcomes.
          </p>
        </div>
      </section>

      {/* Post list */}
      <section style={{ padding: '4rem 2rem', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: '#0d0d0d' }}>
          {allPosts.map(post => (
            <a
              key={post.slug}
              href={href(`/blog/${post.slug}`)}
              style={{ display: 'block', background: '#000000', padding: '2.5rem 2rem', textDecoration: 'none', transition: 'background .15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
              onMouseLeave={e => (e.currentTarget.style.background = '#000000')}
            >
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.75rem' }}>
                {post.tags.map(t => (
                  <span key={t} style={{ background: 'rgba(245,185,53,.08)', border: '1px solid rgba(245,185,53,.2)', color: '#fff', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.2rem .6rem', borderRadius: '.15rem' }}>{t}</span>
                ))}
              </div>
              <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(1.25rem, 3vw, 1.75rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: 1.05, marginBottom: '.75rem' }}>
                {post.title}
              </h2>
              <p style={{ color: '#c7c7c7', fontSize: '.875rem', lineHeight: 1.7, marginBottom: '1.25rem', maxWidth: 600 }}>{post.summary}</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                  {post.coachSlug ? (
                    <a
                      href={coachHref(post.coachSlug)}
                      onClick={e => e.stopPropagation()}
                      style={{ color: '#fff', fontSize: '.7rem', fontWeight: 700, textDecoration: 'none' }}
                      onMouseEnter={el => el.currentTarget.style.textDecoration = 'underline'}
                      onMouseLeave={el => el.currentTarget.style.textDecoration = 'none'}
                    >
                      {post.author}
                    </a>
                  ) : (
                    <span style={{ color: '#888888', fontSize: '.7rem', fontWeight: 700 }}>{post.author}</span>
                  )}
                  <span style={{ color: '#888888' }}>·</span>
                  <span style={{ color: '#888888', fontSize: '.7rem' }}>{post.date}</span>
                </div>
                <span style={{ color: '#fff', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase' }}>Read →</span>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Footer strip */}
      <div style={{ background: '#000000', borderTop: '1px solid #0d0d0d', padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 20, filter: 'brightness(0) invert(1)' }} />
        </a>
        <a href={href('/')} style={{ color: '#888888', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', textDecoration: 'none' }}>← Back to site</a>
      </div>
    </div>
  )
}
