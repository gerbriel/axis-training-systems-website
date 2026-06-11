import { useState } from 'react'
import { getPendingContent, updateContentStatus, deleteContent } from '../../data/pendingContent'
import type { PendingContent, ContentStatus } from '../../data/pendingContent'
import { sanitize } from '../../utils/sanitize'

const STATUS_COLORS: Record<ContentStatus, string> = {
  pending:  '#f59e0b',
  approved: '#22c55e',
  rejected: '#e63e3e',
}
const labelStyle: React.CSSProperties = {
  color: '#555',
  fontSize: '.6rem',
  fontWeight: 700,
  letterSpacing: '.15em',
  textTransform: 'uppercase',
  marginBottom: '.35rem',
  display: 'block',
}
const inputStyle: React.CSSProperties = {
  background: '#0d0d0d',
  border: '1px solid #222',
  borderRadius: '.2rem',
  color: '#fff',
  fontSize: '.875rem',
  fontWeight: 500,
  padding: '.65rem .875rem',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}

type FilterType = 'all' | 'blog' | 'meet'
type FilterStatus = 'pending' | 'reviewed'

interface Props {
  isDemo?: boolean
}

export default function ApprovalsPanel({ isDemo = false }: Props) {
  const [filterType,   setFilterType]   = useState<FilterType>('all')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending')
  const [items,        setItems]        = useState<PendingContent[]>(() => getPendingContent())
  const [expandedId,   setExpandedId]   = useState<string | null>(null)
  const [rejectNotes,  setRejectNotes]  = useState<Record<string, string>>({})
  const [rejectMode,   setRejectMode]   = useState<Record<string, boolean>>({})

  function refresh() { setItems(getPendingContent()) }

  function approve(id: string) {
    updateContentStatus(id, 'approved')
    refresh()
  }

  function startReject(id: string) {
    setRejectMode(prev => ({ ...prev, [id]: true }))
  }

  function confirmReject(id: string) {
    const safeNote = sanitize(rejectNotes[id] ?? '', 500)
    updateContentStatus(id, 'rejected', safeNote)
    setRejectMode(prev => ({ ...prev, [id]: false }))
    refresh()
  }

  function handleDelete(id: string) {
    deleteContent(id)
    refresh()
  }

  const filtered = items
    .filter(c => filterType === 'all' || c.type === filterType)
    .filter(c => filterStatus === 'pending' ? c.status === 'pending' : c.status !== 'pending')
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))

  const pendingCount = items.filter(c => c.status === 'pending').length

  return (
    <div style={{ padding: '2rem', maxWidth: 900 }}>
      {isDemo && (
        <div style={{ background: '#2d1f00', border: '1px solid #5c3d00', borderRadius: '.25rem', padding: '.75rem 1rem', marginBottom: '1.5rem' }}>
          <span style={{ color: '#f59e0b', fontSize: '.7rem', fontWeight: 700 }}>Demo Mode — </span>
          <span style={{ color: '#a06000', fontSize: '.75rem' }}>Content submissions are stored in browser localStorage and visible across coach/admin demos in the same browser session.</span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ color: '#fff', fontSize: '1.25rem', fontWeight: 900, marginBottom: '.25rem' }}>
            Content Approvals
            {pendingCount > 0 && (
              <span style={{ background: '#e63e3e', color: '#fff', fontSize: '.6rem', fontWeight: 900, borderRadius: '10rem', padding: '.15rem .55rem', marginLeft: '.5rem', verticalAlign: 'middle' }}>
                {pendingCount}
              </span>
            )}
          </h2>
          <p style={{ color: '#333', fontSize: '.8rem' }}>Review and approve coach-submitted blog posts and meet listings.</p>
        </div>
        <button
          onClick={refresh}
          style={{ background: 'none', border: '1px solid #222', color: '#555', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.45rem .9rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {/* Status */}
        {(['pending', 'reviewed'] as FilterStatus[]).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            style={{
              background: filterStatus === s ? '#141414' : 'transparent',
              border: `1px solid ${filterStatus === s ? '#333' : '#1a1a1a'}`,
              color: filterStatus === s ? '#fff' : '#333',
              borderRadius: '.2rem', padding: '.4rem .9rem',
              fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
            }}
          >
            {s === 'pending' ? `⏳ Pending (${items.filter(c => c.status === 'pending').length})` : `✓ Reviewed`}
          </button>
        ))}
        <div style={{ width: 1, background: '#1a1a1a', flexShrink: 0 }} />
        {(['all', 'blog', 'meet'] as FilterType[]).map(t => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            style={{
              background: filterType === t ? '#141414' : 'transparent',
              border: `1px solid ${filterType === t ? '#333' : '#1a1a1a'}`,
              color: filterType === t ? '#fff' : '#333',
              borderRadius: '.2rem', padding: '.4rem .9rem',
              fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
            }}
          >
            {t === 'all' ? 'All' : t === 'blog' ? '📝 Blog' : '🏋️ Meets'}
          </button>
        ))}
      </div>

      {/* Items */}
      {filtered.length === 0 ? (
        <div style={{ background: '#0a0a0a', border: '1px solid #111', borderRadius: '.25rem', padding: '3rem 2rem', textAlign: 'center' }}>
          <p style={{ color: '#2a2a2a', fontSize: '.875rem' }}>
            {filterStatus === 'pending' ? 'No pending submissions.' : 'No reviewed items.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: '#111' }}>
          {filtered.map(item => {
            const isExpanded = expandedId === item.id
            return (
              <div key={item.id} style={{ background: '#080808' }}>
                {/* Row */}
                <div
                  style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', padding: '1.25rem 1.5rem', cursor: 'pointer', flexWrap: 'wrap' }}
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.35rem', flexWrap: 'wrap' }}>
                      <span style={{ color: '#444', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                        {item.type === 'blog' ? '📝 Blog' : '🏋️ Meet'}
                      </span>
                      <span style={{
                        background: STATUS_COLORS[item.status] + '18',
                        border: `1px solid ${STATUS_COLORS[item.status]}`,
                        color: STATUS_COLORS[item.status],
                        fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
                        padding: '.15rem .5rem', borderRadius: '.15rem',
                      }}>{item.status}</span>
                      <span style={{ color: '#222', fontSize: '.65rem', fontWeight: 600 }}>by {item.coachName}</span>
                    </div>
                    <p style={{ color: '#fff', fontWeight: 700, fontSize: '.925rem' }}>
                      {item.type === 'blog' ? item.title : item.meetName}
                    </p>
                    {item.type === 'meet' && (
                      <p style={{ color: '#444', fontSize: '.75rem', marginTop: '.2rem' }}>
                        {item.meetDate}{item.meetLocation ? ` · ${item.meetLocation}` : ''}
                        {item.federation ? ` · ${item.federation}` : ''} · {item.meetType}
                      </p>
                    )}
                    {item.type === 'blog' && item.summary && (
                      <p style={{ color: '#333', fontSize: '.8rem', marginTop: '.35rem', lineHeight: 1.5 }}>{item.summary}</p>
                    )}
                    <p style={{ color: '#1e1e1e', fontSize: '.65rem', marginTop: '.4rem' }}>
                      Submitted {new Date(item.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {item.reviewedAt && ` · Reviewed ${new Date(item.reviewedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </p>
                    {item.status === 'rejected' && item.rejectionNote && (
                      <p style={{ color: '#e63e3e', fontSize: '.75rem', marginTop: '.4rem' }}>Rejection note: {item.rejectionNote}</p>
                    )}
                  </div>
                  <span style={{ color: '#222', fontSize: '.7rem', flexShrink: 0, paddingTop: '.2rem' }}>{isExpanded ? '▲' : '▼'}</span>
                </div>

                {/* Expanded */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid #111', padding: '1.5rem' }}>
                    {/* Blog content preview */}
                    {item.type === 'blog' && item.content && (
                      <div style={{ marginBottom: '1.5rem' }}>
                        <p style={labelStyle}>Content Preview</p>
                        <div style={{ background: '#050505', border: '1px solid #111', borderRadius: '.2rem', padding: '1.25rem', maxHeight: 280, overflow: 'auto' }}>
                          {item.content.split('\n\n').map((para, i) => (
                            <p key={i} style={{ color: '#666', fontSize: '.825rem', lineHeight: 1.7, marginBottom: '.75rem' }}>{para}</p>
                          ))}
                        </div>
                        {item.tags && (
                          <p style={{ color: '#333', fontSize: '.7rem', marginTop: '.5rem' }}>Tags: {item.tags}</p>
                        )}
                      </div>
                    )}

                    {/* Meet extra details */}
                    {item.type === 'meet' && item.meetNote && (
                      <div style={{ marginBottom: '1.5rem' }}>
                        <p style={labelStyle}>Note</p>
                        <p style={{ color: '#666', fontSize: '.8rem' }}>{item.meetNote}</p>
                      </div>
                    )}

                    {/* Actions */}
                    {item.status === 'pending' && !rejectMode[item.id] && (
                      <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
                        <button
                          onClick={e => { e.stopPropagation(); approve(item.id) }}
                          style={{ background: '#22c55e18', border: '1px solid #22c55e', color: '#22c55e', fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.55rem 1.25rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          ✓ Approve
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); startReject(item.id) }}
                          style={{ background: '#e63e3e18', border: '1px solid #e63e3e', color: '#e63e3e', fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.55rem 1.25rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          ✕ Reject
                        </button>
                      </div>
                    )}
                    {item.status === 'pending' && rejectMode[item.id] && (
                      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', maxWidth: 480 }}>
                        <div>
                          <label style={labelStyle}>Rejection Note <span style={{ color: '#444', fontWeight: 400 }}>(visible to coach)</span></label>
                          <input
                            style={inputStyle}
                            maxLength={500}
                            placeholder="Explain why this is being rejected…"
                            value={rejectNotes[item.id] ?? ''}
                            onChange={e => setRejectNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: '.5rem' }}>
                          <button
                            onClick={() => confirmReject(item.id)}
                            style={{ background: '#e63e3e', border: 'none', color: '#fff', fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.55rem 1.25rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            Confirm Reject
                          </button>
                          <button
                            onClick={() => setRejectMode(prev => ({ ...prev, [item.id]: false }))}
                            style={{ background: 'none', border: '1px solid #222', color: '#444', fontWeight: 700, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.55rem 1.25rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {item.status !== 'pending' && (
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(item.id) }}
                        style={{ background: 'none', border: '1px solid #1a1a1a', color: '#333', fontWeight: 700, fontSize: '.6rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.45rem .9rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = '#e63e3e'; e.currentTarget.style.color = '#e63e3e' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.color = '#333' }}
                      >
                        Delete Record
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
