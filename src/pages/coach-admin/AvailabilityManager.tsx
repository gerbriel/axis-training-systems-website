import { useState, useEffect, useCallback } from 'react'
import { supabase, supabaseConfigured } from '../../lib/supabase'
import type { CoachSchedule, CoachAvailabilityBlock, Booking } from '../../types/database'
import type { Coach } from '../../data/coaches'
import { fmtTime, fmtDate } from '../../lib/availability'
import { demoGetSchedules, demoAddSchedule, demoRemoveSchedule, demoGetBlocks, demoAddBlock, demoRemoveBlock } from '../../lib/demoAvailabilityStore'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SLOT_DURATIONS = [15, 30, 45, 60]

const TIMES: string[] = []
for (let h = 6; h <= 22; h++) {
  TIMES.push(`${String(h).padStart(2, '0')}:00`)
  TIMES.push(`${String(h).padStart(2, '0')}:30`)
}

function fmtTimePretty(t: string) {
  const [h, m] = t.split(':').map(Number)
  const period = h < 12 ? 'AM' : 'PM'
  const hr = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hr}:${String(m).padStart(2, '0')} ${period}`
}

export default function AvailabilityManager({ coach, isDemo = false }: { coach: Coach; isDemo?: boolean }) {
  const useDemoStore = isDemo || !supabaseConfigured
  const [schedules, setSchedules] = useState<CoachSchedule[]>(() => useDemoStore ? demoGetSchedules(coach.slug) : [])
  const [blocks,    setBlocks]    = useState<CoachAvailabilityBlock[]>(() => useDemoStore ? demoGetBlocks(coach.slug) : [])
  const [upcoming,  setUpcoming]  = useState<Booking[]>([])
  const [loading,   setLoading]   = useState(!useDemoStore)

  // Add schedule form
  const [addDay,      setAddDay]      = useState(1)
  const [addStart,    setAddStart]    = useState('09:00')
  const [addEnd,      setAddEnd]      = useState('11:00')
  const [addDuration, setAddDuration] = useState(30)
  const [adding,      setAdding]      = useState(false)

  // Block form
  const [blockDate,      setBlockDate]      = useState('')
  const [blockFullDay,   setBlockFullDay]   = useState(true)
  const [blockStartTime, setBlockStartTime] = useState('09:00')
  const [blockEndTime,   setBlockEndTime]   = useState('10:00')
  const [blockReason,    setBlockReason]    = useState('')
  const [blocking,       setBlocking]       = useState(false)

  const load = useCallback(async () => {
    if (useDemoStore) {
      setSchedules(demoGetSchedules(coach.slug))
      setBlocks(demoGetBlocks(coach.slug))
      setLoading(false)
      return
    }
    setLoading(true)

    const today = new Date().toISOString()
    const [sRes, bRes, upRes] = await Promise.all([
      supabase.from('coach_schedules').select('*').eq('coach_slug', coach.slug).eq('is_active', true),
      supabase.from('coach_availability_blocks').select('*').eq('coach_slug', coach.slug)
        .gte('block_date', today.split('T')[0]),
      supabase.from('bookings').select('*').eq('coach_slug', coach.slug)
        .neq('status', 'cancelled').gte('booked_at', today).order('booked_at'),
    ])

    if (sRes.data)  setSchedules(sRes.data as CoachSchedule[])
    if (bRes.data)  setBlocks(bRes.data   as CoachAvailabilityBlock[])
    if (upRes.data) setUpcoming(upRes.data as Booking[])
    setLoading(false)
  }, [coach.slug, useDemoStore])

  useEffect(() => { load() }, [load])

  const addSchedule = async () => {
    if (addEnd <= addStart) return
    setAdding(true)
    const base: Omit<CoachSchedule, 'id' | 'created_at'> = {
      coach_slug: coach.slug, day_of_week: addDay, start_time: addStart,
      end_time: addEnd, slot_duration_minutes: addDuration, is_active: true,
    }
    if (useDemoStore) {
      const item: CoachSchedule = { ...base, id: `demo-sched-${Date.now()}`, created_at: new Date().toISOString() }
      demoAddSchedule(item)
      setSchedules(demoGetSchedules(coach.slug))
    } else {
      const { data } = await supabase.from('coach_schedules').insert(base).select().single()
      if (data) setSchedules(s => [...s, data as CoachSchedule])
    }
    setAdding(false)
  }

  const removeSchedule = async (id: string) => {
    if (useDemoStore) {
      demoRemoveSchedule(id, coach.slug)
      setSchedules(demoGetSchedules(coach.slug))
    } else {
      await supabase.from('coach_schedules').update({ is_active: false }).eq('id', id)
      setSchedules(s => s.filter(x => x.id !== id))
    }
  }

  const addBlock = async () => {
    if (!blockDate) return
    setBlocking(true)
    const base: Omit<CoachAvailabilityBlock, 'id' | 'created_at'> = {
      coach_slug: coach.slug, block_date: blockDate,
      start_time: blockFullDay ? null : blockStartTime,
      end_time:   blockFullDay ? null : blockEndTime,
      reason:     blockReason || null,
    }
    if (useDemoStore) {
      const item: CoachAvailabilityBlock = { ...base, id: `demo-block-${Date.now()}`, created_at: new Date().toISOString() }
      demoAddBlock(item)
      setBlocks(demoGetBlocks(coach.slug))
    } else {
      const { data } = await supabase.from('coach_availability_blocks').insert(base).select().single()
      if (data) setBlocks(b => [...b, data as CoachAvailabilityBlock])
    }
    setBlockDate(''); setBlockReason('')
    setBlocking(false)
  }

  const removeBlock = async (id: string) => {
    if (useDemoStore) {
      demoRemoveBlock(id, coach.slug)
      setBlocks(demoGetBlocks(coach.slug))
    } else {
      await supabase.from('coach_availability_blocks').delete().eq('id', id)
      setBlocks(b => b.filter(x => x.id !== id))
    }
  }

  const updateBookingStatus = async (id: string, status: Booking['status']) => {
    if (!isDemo) await supabase.from('bookings').update({ status }).eq('id', id)
    setUpcoming(u => u.map(b => b.id === id ? { ...b, status } : b))
  }

  if (loading) return (
    <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading availability…</div>
  )


  // Group schedules by day
  const byDay = new Map<number, CoachSchedule[]>()
  schedules.forEach(s => {
    const arr = byDay.get(s.day_of_week) ?? []
    arr.push(s)
    byDay.set(s.day_of_week, arr)
  })

  const fieldStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid #222', color: 'var(--text)',
    padding: '.6rem .75rem', borderRadius: '.25rem', fontSize: '.8rem',
    outline: 'none', fontFamily: 'inherit', appearance: 'none' as const,
  }

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2.5rem', maxWidth: 760 }}>
      {useDemoStore && (
        <div style={{ background: '#2d2500', border: '1px solid #5c4800', borderRadius: '.25rem', padding: '.5rem 1rem', display: 'inline-flex', gap: '.75rem', alignItems: 'center', alignSelf: 'flex-start' }}>
          <span style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase' }}>Preview Mode</span>
          <span style={{ color: '#7a6500', fontSize: '.75rem' }}>Changes are in-memory — the booking page reflects them instantly for testing.</span>
        </div>
      )}

      {/* Weekly schedule */}
      <section>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>Weekly Schedule</p>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '1.5rem' }}>Recurring Availability</h2>

        {/* Existing schedule rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginBottom: '1.5rem' }}>
          {DAYS.map((dayName, dow) => {
            const daySched = byDay.get(dow) ?? []
            return (
              <div key={dow} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '.75rem 1rem', background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem' }}>
                <span style={{ color: 'var(--text-3)', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', minWidth: 80 }}>{dayName}</span>
                <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
                  {daySched.length === 0 ? (
                    <span style={{ color: 'var(--text-dim)', fontSize: '.75rem' }}>No availability</span>
                  ) : daySched.map(s => (
                    <span key={s.id} style={{ background: 'rgba(245,185,53,.1)', border: '1px solid rgba(245,185,53,.25)', borderRadius: '.2rem', padding: '.25rem .65rem', display: 'inline-flex', alignItems: 'center', gap: '.5rem' }}>
                      <span style={{ color: 'var(--text)', fontSize: '.72rem', fontWeight: 700 }}>
                        {fmtTimePretty(s.start_time)} – {fmtTimePretty(s.end_time)}
                        <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> · {s.slot_duration_minutes}min slots</span>
                      </span>
                      <button onClick={() => removeSchedule(s.id)} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '.75rem', padding: 0, lineHeight: 1, fontFamily: 'inherit' }}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Add hours form */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'flex-end' }}>
          <div>
            <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Day</label>
            <select value={addDay} onChange={e => setAddDay(Number(e.target.value))} style={fieldStyle}>
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div>
            <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>From</label>
            <select value={addStart} onChange={e => setAddStart(e.target.value)} style={fieldStyle}>
              {TIMES.map(t => <option key={t} value={t}>{fmtTimePretty(t)}</option>)}
            </select>
          </div>
          <div>
            <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>To</label>
            <select value={addEnd} onChange={e => setAddEnd(e.target.value)} style={fieldStyle}>
              {TIMES.map(t => <option key={t} value={t}>{fmtTimePretty(t)}</option>)}
            </select>
          </div>
          <div>
            <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Slot Length</label>
            <select value={addDuration} onChange={e => setAddDuration(Number(e.target.value))} style={fieldStyle}>
              {SLOT_DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
            </select>
          </div>
          <button onClick={addSchedule} disabled={adding || addEnd <= addStart} style={{ background: adding || addEnd <= addStart ? 'var(--border)' : '#bfa162', border: 'none', color: 'var(--text)', fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.65rem 1.25rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            {adding ? 'Adding…' : '+ Add Hours'}
          </button>
        </div>
      </section>

      {/* Block a date */}
      <section>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>Blocks</p>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '1.5rem' }}>Mark Time Off</h2>

        {/* Existing blocks */}
        {blocks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginBottom: '1.25rem' }}>
            {blocks.map(b => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '.75rem 1rem', background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem' }}>
                <span style={{ color: 'var(--text-2)', fontSize: '.8rem', fontWeight: 600 }}>
                  {new Date(b.block_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                <span style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>
                  {!b.start_time ? 'All day' : `${fmtTimePretty(b.start_time)} – ${fmtTimePretty(b.end_time!)}`}
                </span>
                {b.reason && <span style={{ color: 'var(--text-4)', fontSize: '.75rem', fontStyle: 'italic' }}>{b.reason}</span>}
                <button onClick={() => removeBlock(b.id)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #333', color: 'var(--text-4)', cursor: 'pointer', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.25rem .6rem', borderRadius: '.2rem', fontFamily: 'inherit' }}>Remove</button>
              </div>
            ))}
          </div>
        )}

        {/* Add block form */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'flex-end' }}>
          <div>
            <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Date</label>
            <input type="date" value={blockDate} onChange={e => setBlockDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              style={{ ...fieldStyle, colorScheme: 'dark' }} />
          </div>
          <div>
            <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Type</label>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              {[['Full Day', true], ['Time Range', false]].map(([label, val]) => (
                <button key={String(val)} onClick={() => setBlockFullDay(val as boolean)}
                  style={{ background: blockFullDay === val ? 'var(--surface-2)' : 'transparent', border: `1px solid ${blockFullDay === val ? '#f5b935' : 'var(--border-mid)'}`, color: blockFullDay === val ? 'var(--text)' : 'var(--text-4)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.5rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {label as string}
                </button>
              ))}
            </div>
          </div>
          {!blockFullDay && (
            <>
              <div>
                <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>From</label>
                <select value={blockStartTime} onChange={e => setBlockStartTime(e.target.value)} style={fieldStyle}>
                  {TIMES.map(t => <option key={t} value={t}>{fmtTimePretty(t)}</option>)}
                </select>
              </div>
              <div>
                <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>To</label>
                <select value={blockEndTime} onChange={e => setBlockEndTime(e.target.value)} style={fieldStyle}>
                  {TIMES.map(t => <option key={t} value={t}>{fmtTimePretty(t)}</option>)}
                </select>
              </div>
            </>
          )}
          <div>
            <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Reason (optional)</label>
            <input value={blockReason} onChange={e => setBlockReason(e.target.value)} placeholder="e.g. Competition weekend" style={{ ...fieldStyle, minWidth: 200 }} />
          </div>
          <button onClick={addBlock} disabled={blocking || !blockDate}
            style={{ background: blocking || !blockDate ? 'var(--border)' : '#c8102e', border: 'none', color: 'var(--text)', fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.65rem 1.25rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            {blocking ? 'Blocking…' : 'Block Date'}
          </button>
        </div>
      </section>

      {/* Upcoming bookings */}
      <section>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>Upcoming</p>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '1rem' }}>Booked Calls</h2>

        {upcoming.length === 0 ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.875rem' }}>No upcoming bookings.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {upcoming.map(b => {
              const dt = new Date(b.booked_at)
              const statusColor: Record<string, string> = { pending: '#f5b935', confirmed: '#22c55e', cancelled: 'var(--text-4)' }
              return (
                <div key={b.id} style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 140 }}>
                    <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.85rem' }}>{fmtDate(dt)}</p>
                    <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>{fmtTime(dt)} · {b.duration_minutes} min</p>
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ color: 'var(--text)', fontWeight: 600, fontSize: '.85rem' }}>{b.first_name} {b.last_name}</p>
                    <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>{b.email}</p>
                  </div>
                  <div style={{ display: 'flex', gap: '.5rem' }}>
                    {(['pending','confirmed','cancelled'] as Booking['status'][]).map(s => (
                      <button key={s} onClick={() => updateBookingStatus(b.id, s)}
                        style={{
                          background: b.status === s ? statusColor[s] + '20' : 'transparent',
                          border: `1px solid ${b.status === s ? statusColor[s] : 'var(--border-mid)'}`,
                          color: b.status === s ? statusColor[s] : 'var(--text-4)',
                          fontSize: '.55rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                          padding: '.25rem .6rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit',
                        }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
