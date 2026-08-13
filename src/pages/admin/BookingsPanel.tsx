import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { BOOKING_STAFF_COLUMNS } from '../../types/database'
import type { Booking } from '../../types/database'
import { fmtTime, fmtDate } from '../../lib/availability'
import { useMediaQuery, MOBILE_QUERY } from '../../lib/dashboard'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { DEMO_BOOKINGS } from '../../data/demoData'

type Status = Booking['status']

const STATUS_COLORS: Record<Status, string> = {
  pending:   '#272C84',
  confirmed: '#22c55e',
  cancelled: 'var(--text-4)',
}

const coachName = (slug: string) => slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

function Badge({ status }: { status: Status }) {
  const c = STATUS_COLORS[status]
  return (
    <span style={{ background: c + '18', border: `1px solid ${c}`, color: c, fontSize: '.6rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.2rem .55rem', borderRadius: '.2rem', whiteSpace: 'nowrap' }}>
      {status}
    </span>
  )
}

export default function BookingsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [bookings, setBookings] = useState<Booking[]>(isDemo ? DEMO_BOOKINGS : [])
  const [loading,  setLoading]  = useState(!isDemo)
  const [filter,   setFilter]   = useState<Status | 'all'>('all')
  const [selected, setSelected] = useState<Booking | null>(null)
  const [notes,    setNotes]    = useState('')
  const [saving,   setSaving]   = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  const fetch = useCallback(async () => {
    if (isDemo) { setBookings(DEMO_BOOKINGS); return }
    setLoading(true)
    const { data } = await supabase.from('bookings').select(BOOKING_STAFF_COLUMNS).order('booked_at', { ascending: true })
    if (data) setBookings(data as Booking[])
    setLoading(false)
  }, [isDemo])

  useEffect(() => { fetch() }, [fetch])

  // Lock background scroll while the mobile detail overlay is open.
  useEffect(() => {
    if (!(isMobile && selected)) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isMobile, selected])

  const openDetail  = (b: Booking) => { setSelected(b); setNotes(b.coach_notes ?? ''); setConfirmingCancel(false) }
  const closeDetail = () => { setSelected(null); setConfirmingCancel(false) }

  const updateStatus = async (id: string, status: Status) => {
    if (isDemo) {
      setBookings(bs => bs.map(b => b.id === id ? { ...b, status } : b))
      if (selected?.id === id) setSelected(b => b ? { ...b, status } : b)
      return
    }
    await supabase.from('bookings').update({ status }).eq('id', id)
    setBookings(bs => bs.map(b => b.id === id ? { ...b, status } : b))
    if (selected?.id === id) setSelected(b => b ? { ...b, status } : b)
  }

  const saveNotes = async () => {
    if (!selected) return
    setSaving(true)
    if (!isDemo) await supabase.from('bookings').update({ coach_notes: notes }).eq('id', selected.id)
    setBookings(bs => bs.map(b => b.id === selected.id ? { ...b, coach_notes: notes } : b))
    setSelected(b => b ? { ...b, coach_notes: notes } : b)
    setSaving(false)
  }

  const filtered = bookings.filter(b => filter === 'all' || b.status === filter)
  const counts: Record<string, number> = { all: bookings.length }
  ;(['pending','confirmed','cancelled'] as Status[]).forEach(s => { counts[s] = bookings.filter(b => b.status === s).length })

  const upcoming = bookings.filter(b => b.status !== 'cancelled' && new Date(b.booked_at) > new Date()).length

  // Upcoming first ascending (soonest at top), past bookings descending below a divider —
  // the next call must never be buried under history.
  const now = Date.now()
  const upcomingList = filtered
    .filter(b => new Date(b.booked_at).getTime() >= now)
    .sort((a, b) => new Date(a.booked_at).getTime() - new Date(b.booked_at).getTime())
  const pastList = filtered
    .filter(b => new Date(b.booked_at).getTime() < now)
    .sort((a, b) => new Date(b.booked_at).getTime() - new Date(a.booked_at).getTime())

  const pastLabel = (
    <span style={{ color: 'var(--text-4)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase' }}>Past</span>
  )

  const tableRow = (b: Booking) => {
    const dt = new Date(b.booked_at)
    return (
      <tr key={b.id} onClick={() => openDetail(b)}
        style={{ borderBottom: '1px solid var(--surface)', cursor: 'pointer', background: selected?.id === b.id ? 'var(--surface)' : 'transparent' }}>
        <td style={{ padding: '1rem 1.25rem', whiteSpace: 'nowrap' }}>
          <p style={{ color: 'var(--text)', fontWeight: 600, fontSize: '.8rem' }}>{fmtDate(dt)}</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.7rem', marginTop: '.1rem' }}>{fmtTime(dt)}</p>
        </td>
        <td style={{ padding: '1rem 1.25rem', color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap' }}>{b.first_name} {b.last_name}</td>
        <td style={{ padding: '1rem 1.25rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{coachName(b.coach_slug)}</td>
        <td style={{ padding: '1rem 1.25rem', color: 'var(--text-3)', whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.service_interest ?? '—'}</td>
        <td style={{ padding: '1rem 1.25rem' }}><Badge status={b.status} /></td>
      </tr>
    )
  }

  const card = (b: Booking) => {
    const dt = new Date(b.booked_at)
    return (
      <div key={b.id} onClick={() => openDetail(b)}
        style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '1rem', borderBottom: '1px solid var(--surface)', cursor: 'pointer', background: selected?.id === b.id ? 'var(--surface)' : 'transparent' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.75rem' }}>
            <p style={{ color: 'var(--text)', fontWeight: 600, fontSize: '.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.first_name} {b.last_name}</p>
            <Badge status={b.status} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.75rem', marginTop: '.4rem' }}>
            <p style={{ color: 'var(--text-3)', fontSize: '.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{coachName(b.coach_slug)}</p>
            <p style={{ color: 'var(--text-2)', fontSize: '.72rem', whiteSpace: 'nowrap' }}>{fmtDate(dt)} · {fmtTime(dt)}</p>
          </div>
        </div>
        <span aria-hidden style={{ color: 'var(--text-4)', fontSize: '1.2rem', lineHeight: 1, flexShrink: 0 }}>›</span>
      </div>
    )
  }

  const detailBody = selected && (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
        <div>
          <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1rem' }}>{selected.first_name} {selected.last_name}</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.75rem', marginTop: '.2rem' }}>{selected.email}</p>
          {selected.phone && <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>{selected.phone}</p>}
        </div>
        {!isMobile && (
          <button onClick={closeDetail} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1rem', padding: '.25rem .5rem', fontFamily: 'inherit' }}>×</button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', background: 'var(--surface)', borderRadius: '.25rem', padding: '1rem' }}>
        {[
          ['Date',    fmtDate(new Date(selected.booked_at))],
          ['Time',    fmtTime(new Date(selected.booked_at))],
          ['Coach',   coachName(selected.coach_slug)],
          ['Service', selected.service_interest ?? '—'],
        ].map(([l, v]) => (
          <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem' }}>
            <span style={{ color: 'var(--text-3)' }}>{l}</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </div>

      {selected.goals && (
        <div>
          <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Goals</p>
          <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.7 }}>{selected.goals}</p>
        </div>
      )}

      {/* Status actions */}
      <div>
        <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Status</p>
        {confirmingCancel ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-2)', fontSize: '.78rem', fontWeight: 600 }}>Cancel this booking?</span>
            <button onClick={() => { updateStatus(selected.id, 'cancelled'); setConfirmingCancel(false) }}
              style={{ background: '#c8102e', border: '1px solid #c8102e', color: '#ffffff', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.5rem 1.25rem', minHeight: '2.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              Yes
            </button>
            <button onClick={() => setConfirmingCancel(false)}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.5rem 1.25rem', minHeight: '2.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              No
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            {(['pending','confirmed','cancelled'] as Status[]).map(s => (
              <button key={s}
                onClick={() => {
                  if (s === 'cancelled') {
                    if (selected.status !== 'cancelled') setConfirmingCancel(true)
                  } else {
                    updateStatus(selected.id, s)
                  }
                }}
                style={{
                  background: selected.status === s ? STATUS_COLORS[s] + '22' : 'transparent',
                  border: `1px solid ${selected.status === s ? STATUS_COLORS[s] : 'var(--border-mid)'}`,
                  color: selected.status === s ? STATUS_COLORS[s] : 'var(--text-4)',
                  fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                  padding: isMobile ? '.6rem .75rem' : '.35rem .75rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Coach notes */}
      <div>
        <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Coach Notes</p>
        <textarea className="field" rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes…" />
        <button onClick={saveNotes} disabled={saving}
          style={{ marginTop: '.5rem', background: '#272C84', border: 'none', color: '#ffffff', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.55rem 1rem', minHeight: '2.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save Notes'}
        </button>
      </div>
    </>
  )

  return (
    <>
      {isDemo && (
        <div className="dash-pad" style={{ paddingBottom: 0 }}>
          <DemoBanner />
        </div>
      )}

      {/* Stats */}
      <div style={{ padding: isMobile ? '1rem' : '1.25rem 2rem', borderBottom: '1px solid var(--surface)', display: 'flex', gap: isMobile ? '1.25rem 1.75rem' : '2rem', flexWrap: 'wrap' }}>
        {[
          ['Upcoming', upcoming, '#272C84'],
          ['Confirmed', counts.confirmed, '#22c55e'],
          ['Pending', counts.pending, '#272C84'],
          ['Total', counts.all, 'var(--text-3)'],
        ].map(([label, val, color]) => (
          <div key={String(label)}>
            <p style={{ color: color as string, fontWeight: 900, fontSize: '1.5rem', lineHeight: 1 }}>{val}</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '.2rem' }}>{label as string}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ padding: isMobile ? '.75rem 1rem' : '1rem 2rem', borderBottom: '1px solid var(--surface)', display: 'flex', gap: isMobile ? '.75rem' : '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {(['all', 'pending', 'confirmed', 'cancelled'] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              style={{
                background: filter === s ? 'var(--surface-2)' : 'transparent',
                border: `1px solid ${filter === s ? 'var(--text-dim)' : 'var(--border)'}`,
                color: filter === s ? 'var(--text)' : 'var(--text-4)',
                fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                padding: isMobile ? '.55rem .75rem' : '.3rem .75rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {s} ({counts[s] ?? 0})
            </button>
          ))}
        </div>
        <button onClick={fetch} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #222', color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: isMobile ? '.55rem .875rem' : '.35rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
          ↺ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading bookings…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>No bookings found.</div>
      ) : isMobile ? (
        /* Stacked cards on phones */
        <div>
          {upcomingList.map(card)}
          {pastList.length > 0 && (
            <div style={{ padding: '1rem 1rem .5rem', borderBottom: '1px solid var(--surface)' }}>{pastLabel}</div>
          )}
          {pastList.map(card)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr min(380px, 45vw)' : '1fr' }}>
          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Date & Time', 'Name', 'Coach', 'Service', 'Status'].map(h => (
                    <th key={h} style={{ padding: '1rem 1.25rem', textAlign: 'left', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {upcomingList.map(tableRow)}
                {pastList.length > 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '.75rem 1.25rem', borderBottom: '1px solid var(--surface)' }}>{pastLabel}</td>
                  </tr>
                )}
                {pastList.map(tableRow)}
              </tbody>
            </table>
          </div>

          {/* Detail panel (desktop column) */}
          {selected && (
            <div style={{ borderLeft: '1px solid var(--surface-2)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', overflowY: 'auto' }}>
              {detailBody}
            </div>
          )}
        </div>
      )}

      {/* Detail panel (mobile full-screen overlay) */}
      {selected && isMobile && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'var(--bg)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg)', borderBottom: '1px solid var(--surface)', padding: '.4rem .5rem' }}>
            <button onClick={closeDetail}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', background: 'none', border: 'none', color: 'var(--text-2)', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.75rem .6rem', minHeight: '2.5rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              ← Back
            </button>
          </div>
          <div style={{ padding: '1rem 1rem calc(2.5rem + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {detailBody}
          </div>
        </div>
      )}
    </>
  )
}
