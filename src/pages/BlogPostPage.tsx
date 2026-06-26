import { useState, useEffect } from 'react'
import { getPostBySlug, BlogSection } from '../data/blog'
import type { BlogPost } from '../data/blog'
import { href } from '../utils/nav'
import { fetchApprovedPosts } from '../lib/contentApi'
import { supabaseConfigured } from '../lib/supabase'
import type { PendingContent } from '../data/pendingContent'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

interface Props { slug: string }

function parseContent(raw: string | undefined): BlogSection[] {
  if (!raw) return []
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed) as BlogSection[] } catch { /* fallthrough */ }
  }
  return raw.split('\n\n').filter(Boolean).map(text => ({ type: 'paragraph' as const, text }))
}

function pendingToPost(p: PendingContent): BlogPost {
  return {
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
    content: parseContent(p.content),
  }
}

function renderSection(s: BlogSection, i: number) {
  switch (s.type) {
    case 'heading':
      return (
        <h2 key={i} style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.25rem, 3vw, 1.75rem)', textTransform: 'uppercase', letterSpacing: '-.02em', marginTop: '3rem', marginBottom: '1rem', borderTop: '1px solid var(--border)', paddingTop: '2rem' }}>
          {s.text}
        </h2>
      )
    case 'subheading':
      return (
        <h3 key={i} style={{ color: 'var(--text)', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.25em', textTransform: 'uppercase', marginTop: '2rem', marginBottom: '.75rem' }}>
          {s.text}
        </h3>
      )
    case 'paragraph':
      return (
        <p key={i} style={{ color: 'var(--text-3)', fontSize: '.975rem', lineHeight: 1.85, marginBottom: '1rem' }}>
          {s.text}
        </p>
      )
    case 'list':
      return (
        <ul key={i} style={{ listStyle: 'none', padding: 0, marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {s.items?.map((item, j) => (
            <li key={j} style={{ display: 'flex', gap: '.75rem', color: 'var(--text-3)', fontSize: '.9rem', lineHeight: 1.7 }}>
              <span style={{ color: 'var(--text)', flexShrink: 0, marginTop: '.35rem' }}>·</span>
              {item}
            </li>
          ))}
        </ul>
      )
    case 'week':
      return (
        <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.2rem', padding: '1.25rem 1.5rem', marginBottom: '1rem' }}>
          <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '.8rem', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.75rem' }}>{s.label}</p>
          <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
            {s.items?.map((item, j) => (
              <li key={j} style={{ color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.6, display: 'flex', gap: '.75rem' }}>
                <span style={{ color: 'var(--text)', flexShrink: 0 }}>·</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )
    case 'callout':
      return (
        <blockquote key={i} style={{ background: 'rgba(39,44,132,.06)', border: '1px solid rgba(39,44,132,.2)', borderLeft: '3px solid #272C84', borderRadius: '.2rem', padding: '1.5rem', margin: '2rem 0', color: 'var(--chalk)', fontSize: '1rem', lineHeight: 1.8, fontWeight: 600 }}>
          {s.text}
        </blockquote>
      )
    case 'divider':
      return <div key={i} style={{ height: 1, background: 'var(--surface)', margin: '2.5rem 0' }} />
    default:
      return null
  }
}

export default function BlogPostPage({ slug }: Props) {
  const staticPost = getPostBySlug(slug)
  const [dynPost, setDynPost] = useState<BlogPost | null>(null)
  const [loading, setLoading]  = useState(!staticPost)

  useEffect(() => {
    if (staticPost) return
    fetchApprovedPosts(!supabaseConfigured)
      .then(approved => {
        const found = approved.find(p => p.id === slug)
        setDynPost(found ? pendingToPost(found) : null)
      })
      .catch(() => setDynPost(null))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const post = staticPost ?? dynPost

  if (loading) return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
    </div>
  )

  if (!post) {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1.5rem' }}>
        <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.3em', textTransform: 'uppercase' }}>404</p>
        <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '2rem', textTransform: 'uppercase' }}>Post Not Found</h1>
        <a href={href('/blog')} style={{ color: 'var(--text-2)', fontSize: '.8rem', textDecoration: 'underline' }}>← Back to Blog</a>
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Mini nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--nav-overlay)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--border)', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 24, filter: 'var(--logo-filter)' }} />
        </a>
        <span style={{ color: 'var(--text-3)' }}>›</span>
        <a href={href('/blog')} style={{ color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', textDecoration: 'none', transition: 'color .15s' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-3)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-2)'}
        >
          Blog
        </a>
        <span style={{ color: 'var(--text-3)' }}>›</span>
        <span style={{ color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '30vw' }}>{post.title}</span>
      </nav>

      {/* Hero */}
      <section style={{ padding: '5rem 2rem 3rem', borderBottom: '1px solid var(--surface)', position: 'relative', overflow: 'hidden' }}>
        {post.coverImage && (
          <>
            <img src={post.coverImage} alt="" aria-hidden="true"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 20%', filter: 'grayscale(60%) brightness(0.2)', pointerEvents: 'none' }}
            />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), rgba(0,0,0,0.92))', pointerEvents: 'none' }} />
          </>
        )}
        <div style={{ position: 'relative', maxWidth: 760, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            {post.tags.map(t => (
              <span key={t} style={{ background: 'rgba(39,44,132,.1)', border: '1px solid rgba(39,44,132,.25)', color: 'var(--text)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.2rem .6rem', borderRadius: '.15rem' }}>{t}</span>
            ))}
          </div>
          <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.75rem, 5vw, 3rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: 1, marginBottom: '1rem' }}>
            {post.title}
          </h1>
          <p style={{ color: 'var(--text-2)', fontSize: '.95rem', lineHeight: 1.7, marginBottom: '2rem', maxWidth: 580 }}>{post.subtitle}</p>
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.8rem' }}>{post.author}</p>
              <p style={{ color: 'var(--text-2)', fontSize: '.7rem', marginTop: '.15rem' }}>{post.authorRole}</p>
            </div>
            <span style={{ color: 'var(--text-3)' }}>·</span>
            <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>{post.date}</p>
          </div>
        </div>
      </section>

      {/* Body */}
      <article style={{ maxWidth: 760, margin: '0 auto', padding: '3rem 2rem 5rem' }}>
        {post.content.map((s, i) => renderSection(s, i))}

        {/* CTA at bottom */}
        <div style={{ marginTop: '4rem', padding: '2.5rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.25rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Axis Training Systems</p>
          <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '.75rem' }}>Work With a Coach Like {post.author.split(' ')[0]}</p>
          <p style={{ color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.7, marginBottom: '1.5rem' }}>
            Results like this don't happen by accident. They're the product of evidence-based coaching, genuine investment in the athlete, and the trust to adapt when it matters.
          </p>
          <a
            href={href('/#coaches')}
            style={{ display: 'inline-block', background: '#272C84', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.2em', textTransform: 'uppercase', padding: '.875rem 2rem', borderRadius: '.25rem', textDecoration: 'none', transition: 'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = '#1a1f6b'}
            onMouseLeave={e => e.currentTarget.style.background = '#272C84'}
          >
            Choose Your Coach →
          </a>
        </div>
      </article>

      {/* Footer strip */}
      <div style={{ background: 'var(--bg)', borderTop: '1px solid var(--surface)', padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 20, filter: 'var(--logo-filter)' }} />
        </a>
        <a href={href('/blog')} style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', textDecoration: 'none' }}>← All Posts</a>
      </div>
    </div>
  )
}
