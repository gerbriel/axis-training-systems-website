import { useState, useEffect } from 'react'
import { href } from '../utils/nav'
import { getNewsletterAccess, subscribeNewsletter } from '../lib/newsletterApi'
import { useBotTrap } from '../lib/botTrap'
import { BuiltinTool, toolSignupSource } from '../components/Tools'
import { useResourceRegistry, FALLBACK_TOOLS, type ToolEntry } from '../lib/calculators'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

/**
 * The tool registry is the database's now (see src/lib/calculators.ts), so the
 * owner can rename a tool, reorder the strip or unpublish one from the admin
 * portal. This export is the FALLBACK the pages render when the library cannot
 * be reached, kept under its old name so nothing that imported it breaks.
 */
export const TOOL_LIST = FALLBACK_TOOLS

const inp: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.2rem',
  color: 'var(--text)', fontSize: '.875rem', padding: '.65rem .875rem',
  outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
}
const lbl: React.CSSProperties = {
  color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em',
  textTransform: 'uppercase', marginBottom: '.35rem', display: 'block',
}

function AttemptGate({ tool, onAccess }: { tool: ToolEntry; onAccess: () => void }) {
  const [first, setFirst] = useState('')
  const [last,  setLast]  = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const bot = useBotTrap()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Suspected bot: grant access silently, write nothing. See botTrap.ts.
    if (bot.isSuspect()) { onAccess(); return }
    setError('')
    setLoading(true)
    try {
      await subscribeNewsletter({ firstName: first, lastName: last, email, source: toolSignupSource(tool) }, false)
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
          Sign up with your email to unlock the {tool.label} and all free guides. No credit card, no spam.
        </p>
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
        <input {...bot.fieldProps} />
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
          style={{ background: '#272C84', border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.2em', textTransform: 'uppercase', padding: '.875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit', opacity: loading || !first.trim() || !email.trim() ? 0.5 : 1 }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#1a1f6b' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#272C84' }}
        >
          {loading ? 'Unlocking…' : `Unlock ${tool.label} →`}
        </button>
        <p style={{ color: 'var(--text-3)', fontSize: '.7rem', textAlign: 'center' }}>
          Also unlocks all <a href={href('/guides')} style={{ color: 'var(--text-2)', textDecoration: 'underline' }}>free guides</a>. No spam.
        </p>
      </form>
    </div>
  )
}

export default function ToolPage({ slug }: { slug: string }) {
  const { tools } = useResourceRegistry()
  const [hasAccess, setHasAccess] = useState(false)

  useEffect(() => {
    if (getNewsletterAccess()) setHasAccess(true)
  }, [])

  // An unknown slug has always fallen through to the first tool rather than to
  // a 404, and an UNPUBLISHED one is the same kind of nothing: the owner took it
  // down, so its old URL should land somewhere useful, not on an empty panel.
  const tool = tools.find(t => t.id === slug) ?? tools[0] ?? null
  if (!tool) return null
  const toolId = tool.id
  const gated = tool.requiresSignup && !hasAccess

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
          {tools.map(t => {
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
                  borderBottom: `2px solid ${active ? '#272C84' : 'transparent'}`,
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
      {tool.builtin === 'rankings' ? (
        <BuiltinTool tool={tool} />
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
            {gated
              ? <AttemptGate tool={tool} onAccess={() => setHasAccess(true)} />
              : <BuiltinTool tool={tool} />}
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
