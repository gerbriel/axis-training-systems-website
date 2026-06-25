import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type { Booking } from '../../types/database'
import { fmtTime, fmtDate } from '../../lib/availability'

type Status = Booking['status']

const STATUS_COLORS: Record<Status, string> = {
  pending:   '#f5b935',
  confirmed: '#22c55e',
  cancelled: 'var(--text-4)',
}

const DEMO_BOOKINGS: Booking[] = [
  {
    id: 'demo-b1',
    coach_slug: 'ronnie-vallejo',
    booked_at: new Date(Date.now() + 2 * 24 * 3600_000).toISOString(),
    duration_minutes: 30,
    first_name: 'Alex', last_name: 'Mercer',
    email: 'alex.mercer@gmail.com', phone: '555-0101',
    service_interest: '1:1 Coaching (Full Service)',
    goals: 'Hit 1400 total at 93kg before nationals.',
    status: 'pending', coach_notes: null,
    created_at: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    id: 'demo-b2',
    coach_slug: 'seth-burman',
    booked_at: new Date(Date.now() + 5 * 24 * 3600_000).toISOString(),
    duration_minutes: 30,
    first_name: 'Priya', last_name: 'Suresh',
    email: 'priya.suresh@outlook.com', phone: null,
    service_interest: 'Game Day Coaching',
    goals: 'First meet, need help with attempts and warm-ups.',
    status: 'confirmed', coach_notes: 'Meet is USPA Aug 3rd.',
    created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  {
    id: 'demo-b3',
    coach_slug: 'lucas-sison',
    booked_at: new Date(Date.now() + 10 * 24 * 3600_000).toISOString(),
    duration_minutes: 30,
    first_name: 'Jamie', last_name: 'Carter',
    email: 'jamiecarter@proton.me', phone: '555-0199',
    service_interest: 'Movement Consulting',
    goals: 'Fix squat depth issue before my next meet.',
    status: 'pending', coach_notes: null,
    created_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
  },
]

function Badge({ status }: { status: Status }) {
  const c = STATUS_COLORS[status]
  return (
    <span style={{ background: c + '18', border: `1px solid ${c}`, color: c, fontSize: '.6rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.2rem .55rem', borderRadius: '.2rem' }}>
      {status}
    </span>
  )
}

export default function BookingsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [bookings, setBookings] = useState<Booking[]>(isDemo ? DEMO_BOOKINGS : [])
  const [loading,  setLoading]  = useState(!isDemo)
  const [filter,   setFilter]   = useState<Status | 'all'>('all')
  const [selected, setSelected] = useState<Booking | null>(null)
  const [notes,    setNotes]    = useState('')
  const [saving,   setSaving]   = useState(false)

  const fetch = useCallback(async () => {
    if (isDemo) { setBookings(DEMO_BOOKINGS); return }
    setLoading(true)
    const { data } = await supabase.from('bookings').select('*').order('booked_at', { ascending: true })
    if (data) setBookings(data as Booking[])
    setLoading(false)
  }, [isDemo])

  useEffect(() => { fetch() }, [fetch])

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

  return (
    <>
      {isDemo && (
        <div style={{ background: '#2d2500', borderBottom: '1px solid #5c4800', padding: '.625rem 2rem', display: 'flex', gap: '.75rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase' }}>Demo Mode</span>
          <span style={{ color: '#7a6500', fontSize: '.75rem' }}>Sample bookings — no database connection.</span>
        </div>
      )}

      {/* Stats */}
      <div style={{ padding: '1.25rem 2rem', borderBottom: '1px solid var(--surface)', display: 'flex', gap: '2rem' }}>
        {[
          ['Upcoming', upcoming, '#f5b935'],
          ['Confirmed', counts.confirmed, '#22c55e'],
          ['Pending', counts.pending, '#f5b935'],
          ['Total', counts.all, 'var(--text-3)'],
        ].map(([label, val, color]) => (
          <div key={String(label)}>
            <p style={{ color: color as string, fontWeight: 900, fontSize: '1.5rem', lineHeight: 1 }}>{val}</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '.2rem' }}>{label as string}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ padding: '1rem 2rem', borderBottom: '1px solid var(--surface)', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          {(['all', 'pending', 'confirmed', 'cancelled'] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              style={{
                background: filter === s ? 'var(--surface-2)' : 'transparent',
                border: `1px solid ${filter === s ? 'var(--text-dim)' : 'var(--border)'}`,
                color: filter === s ? 'var(--text)' : 'var(--text-4)',
                fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                padding: '.3rem .75rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {s} ({counts[s] ?? 0})
            </button>
          ))}
        </div>
        <button onClick={fetch} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #222', color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
          ↺ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading bookings…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>No bookings found.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr' }}>
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
                {filtered.map(b => {
                  const dt = new Date(b.booked_at)
                  return (
                    <tr key={b.id} onClick={() => { setSelected(b); setNotes(b.coach_notes ?? '') }}
                      style={{ borderBottom: '1px solid var(--surface)', cursor: 'pointer', background: selected?.id === b.id ? 'var(--surface)' : 'transparent', transition: 'background .1s' }}
                      onMouseEnter={e => { if (selected?.id !== b.id) e.currentTarget.style.background = 'var(--surface)' }}
                      onMouseLeave={e => { if (selected?.id !== b.id) e.currentTarget.style.background = 'transparent' }}>
                      <td style={{ padding: '1rem 1.25rem', whiteSpace: 'nowrap' }}>
                        <p style={{ color: 'var(--text)', fontWeight: 600, fontSize: '.8rem' }}>{fmtDate(dt)}</p>
                        <p style={{ color: 'var(--text-3)', fontSize: '.7rem', marginTop: '.1rem' }}>{fmtTime(dt)}</p>
                      </td>
                      <td style={{ padding: '1rem 1.25rem', color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap' }}>{b.first_name} {b.last_name}</td>
                      <td style={{ padding: '1rem 1.25rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{b.coach_slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</td>
                      <td style={{ padding: '1rem 1.25rem', color: 'var(--text-3)', whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.service_interest ?? '—'}</td>
                      <td style={{ padding: '1rem 1.25rem' }}><Badge status={b.status} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Detail panel */}
          {selected && (
            <div style={{ borderLeft: '1px solid var(--surface-2)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1rem' }}>{selected.first_name} {selected.last_name}</p>
                  <p style={{ color: 'var(--text-3)', fontSize: '.75rem', marginTop: '.2rem' }}>{selected.email}</p>
                  {selected.phone && <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>{selected.phone}</p>}
                </div>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1rem' }}>×</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', background: 'var(--surface)', borderRadius: '.25rem', padding: '1rem' }}>
                {[
                  ['Date',    fmtDate(new Date(selected.booked_at))],
                  ['Time',    fmtTime(new Date(selected.booked_at))],
                  ['Coach',   selected.coach_slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())],
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
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  {(['pending','confirmed','cancelled'] as Status[]).map(s => (
                    <button key={s} onClick={() => updateStatus(selected.id, s)}
                      style={{
                        background: selected.status === s ? STATUS_COLORS[s] + '22' : 'transparent',
                        border: `1px solid ${selected.status === s ? STATUS_COLORS[s] : 'var(--border-mid)'}`,
                        color: selected.status === s ? STATUS_COLORS[s] : 'var(--text-4)',
                        fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                        padding: '.35rem .75rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
                      }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Coach notes */}
              <div>
                <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Coach Notes</p>
                <textarea className="field" rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes…" />
                <button onClick={saveNotes} disabled={saving}
                  style={{ marginTop: '.5rem', background: '#bfa162', border: 'none', color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.4rem 1rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit', opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Saving…' : 'Save Notes'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
