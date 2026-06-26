import { useState, useEffect } from 'react'
import { href } from '../utils/nav'
import { getNewsletterAccess, subscribeNewsletter } from '../lib/newsletterApi'
import { RPECalc, DotsCalc, WeightConverter, AttemptPlanner } from '../components/Tools'
import Rankings from './Rankings'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

export const TOOL_LIST = [
  {
    id: 'rpe',
    label: 'RPE Calculator',
    desc: 'Estimate your 1RM or get a prescribed working weight from any RPE and rep target.',
  },
  {
    id: 'dots',
    label: 'Dots Score',
    desc: 'Calculate your Dots coefficient to compare performance across weight classes and sexes.',
  },
  {
    id: 'convert',
    label: 'Weight Converter',
    desc: 'Instantly convert between lbs and kg for any weight or total.',
  },
  {
    id: 'attempts',
    label: 'Attempt Planner',
    desc: 'Plan your opener, second, and third attempts based on your training maxes and meet strategy.',
  },
  {
    id: 'rankings',
    label: 'View Rankings',
    desc: 'Browse 3M+ powerlifting results worldwide. Filter by federation, weight class, and gender.',
  },
] as const

type ToolId = typeof TOOL_LIST[number]['id']

const inp: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.2rem',
  color: 'var(--text)', fontSize: '.875rem', padding: '.65rem .875rem',
  outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
}
const lbl: React.CSSProperties = {
  color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em',
  textTransform: 'uppercase', marginBottom: '.35rem', display: 'block',
}

function AttemptGate({ onAccess }: { onAccess: () => void }) {
  const [first, setFirst] = useState('')
  const [last,  setLast]  = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await subscribeNewsletter({ firstName: first, lastName: last, email, source: 'attempt_planner' }, false)
      onAccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error'
      if (msg.includes('already subscribed')) { onAccess(); return }
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingTop: '1rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h3 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '.5rem' }}>Free Access Required</h3>
        <p style={{ color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.75 }}>
          Sign up with your email to unlock the Attempt Planner and all free guides — no credit card, no spam.
        </p>
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <div>
            <label style={lbl}>First Name <span style={{ color: 'var(--text)' }}>*</span></label>
            <input style={inp} required placeholder="Jane" value={first} onChange={e => setFirst(e.target.value)} maxLength={100} />
          </div>
          <div>
            <label style={lbl}>Last Name</label>
            <input style={inp} placeholder="Smith" value={last} onChange={e => setLast(e.target.value)} maxLength={100} />
          </div>
        </div>
        <div>
          <label style={lbl}>Email <span style={{ color: 'var(--text)' }}>*</span></label>
          <input style={inp} type="email" required placeholder="jane@example.com" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} />
        </div>
        {error && <p style={{ color: '#c8102e', fontSize: '.8rem' }}>{error}</p>}
        <button
          type="submit"
          disabled={loading || !first.trim() || !email.trim()}
          style={{ background: '#bfa162', border: 'none', color: '#000', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.2em', textTransform: 'uppercase', padding: '.875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit', opacity: loading || !first.trim() || !email.trim() ? 0.5 : 1 }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#9a7c3a' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#bfa162' }}
        >
          {loading ? 'Unlocking…' : 'Unlock Attempt Planner →'}
        </button>
        <p style={{ color: 'var(--text-3)', fontSize: '.7rem', textAlign: 'center' }}>
          Also unlocks all <a href={href('/guides')} style={{ color: 'var(--text-2)', textDecoration: 'underline' }}>free guides</a>. No spam.
        </p>
      </form>
    </div>
  )
}

export default function ToolPage({ slug }: { slug: string }) {
  const toolId = (TOOL_LIST.some(t => t.id === slug) ? slug : 'rpe') as ToolId
  const tool = TOOL_LIST.find(t => t.id === toolId)!
  const [hasAccess, setHasAccess] = useState(false)

  useEffect(() => {
    if (getNewsletterAccess()) setHasAccess(true)
  }, [])

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* Mini nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--nav-overlay)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--border)', padding: '0 1.5rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1rem', flexWrap: 'nowrap' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 22, filter: 'var(--logo-filter)', flexShrink: 0 }} />
        </a>
        <span style={{ color: 'var(--text-3)' }}>›</span>
        <a href={href('/guides')} style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', textDecoration: 'none', whiteSpace: 'nowrap' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-2)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}
        >Free Stuff</a>
        <span style={{ color: 'var(--text-3)' }}>›</span>
        <span style={{ color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{tool.label}</span>
      </nav>

      {/* Tool tabs */}
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)', overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: 0, padding: '0 1.5rem', minWidth: 'max-content' }}>
          {TOOL_LIST.map(t => {
            const active = t.id === toolId
            return (
              <a
                key={t.id}
                href={href(`/tools/${t.id}`)}
                style={{
                  display: 'block',
                  padding: '.75rem 1.25rem',
                  fontSize: '.65rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase',
                  textDecoration: 'none',
                  color: active ? 'var(--text)' : 'var(--text-3)',
                  borderBottom: `2px solid ${active ? '#c8102e' : 'transparent'}`,
                  marginBottom: '-1px',
                  whiteSpace: 'nowrap',
                  transition: 'color .15s',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text-2)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-3)' }}
              >
                {t.label}
              </a>
            )
          })}
        </div>
      </div>

      {/* Content */}
      {toolId === 'rankings' ? (
        <Rankings embedded />
      ) : (
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '3rem 1.5rem 6rem' }}>
          {/* Tool header */}
          <div style={{ marginBottom: '2.5rem' }}>
            <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.6rem, 4vw, 2.5rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: 1, marginBottom: '.75rem' }}>
              {tool.label}
            </h1>
            <p style={{ color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.7, maxWidth: 520 }}>{tool.desc}</p>
          </div>

          {/* Tool panel */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--surface)', borderRadius: '.25rem', padding: '2rem' }}>
            {toolId === 'rpe'      && <RPECalc />}
            {toolId === 'dots'     && <DotsCalc />}
            {toolId === 'convert'  && <WeightConverter />}
            {toolId === 'attempts' && (
              hasAccess
                ? <AttemptPlanner />
                : <AttemptGate onAccess={() => setHasAccess(true)} />
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ background: 'var(--bg)', borderTop: '1px solid var(--surface)', padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <a href={href('/')}><img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 18, filter: 'var(--logo-filter)' }} /></a>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <a href={href('/guides')} style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', textDecoration: 'none' }}>← Free Stuff</a>
          <a href={href('/')} style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', textDecoration: 'none' }}>Home</a>
        </div>
      </div>
    </div>
  )
}
