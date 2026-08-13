import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, supabaseConfigured } from '../../lib/supabase'
import { BOOKING_STAFF_COLUMNS } from '../../types/database'
import type { CoachSchedule, CoachAvailabilityBlock, Booking } from '../../types/database'
import type { Coach } from '../../data/coaches'
import { fmtTime, fmtDate } from '../../lib/availability'
import { demoGetSchedules, demoAddSchedule, demoRemoveSchedule, demoGetBlocks, demoAddBlock, demoRemoveBlock } from '../../lib/demoAvailabilityStore'
import { DEMO_BOOKINGS } from '../../data/demoData'
import { dateKeyInTimeZone } from '../../lib/timezone'
import { DEFAULT_TIME_ZONE } from '../../lib/availability'
import { updateBooking, calendarErrorMessage } from '../../lib/calendarSync'
import { useMediaQuery, MOBILE_QUERY } from '../../lib/dashboard'
import DemoBanner from '../../components/dashboard/DemoBanner'
import CalendarSyncPanel from './CalendarSyncPanel'
import BookingPolicyPanel from './BookingPolicyPanel'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/**
 * How OFTEN a slot may start, not how long a booking is.
 *
 * Migration 009 moved the length onto the service, so `slot_duration_minutes`
 * is now the granularity of the grid — 9:00, 9:30, 10:00 — and the service
 * decides how much of that grid one booking consumes. A 45-minute session on a
 * 30-minute grid takes 9:00–9:45 and the 9:30 start is simply not offered.
 *
 * A coach with no services switched on still gets the old behaviour: the window
 * length is used as both step and duration.
 */
const SLOT_DURATIONS = [15, 20, 30, 45, 60]

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

/** How long a two-tap delete stays armed before reverting on its own. */
const CONFIRM_ARM_MS = 4000

function ErrorBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.6rem .9rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
      <span style={{ color: '#c8102e', fontSize: '.8rem', flex: 1, lineHeight: 1.5 }}>{text}</span>
      <button onClick={onDismiss} aria-label="Dismiss error"
        style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '.9rem', lineHeight: 1, fontFamily: 'inherit', padding: 0, minWidth: '2.5rem', minHeight: '2.5rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '-.6rem -.5rem -.6rem 0', flexShrink: 0 }}>×</button>
    </div>
  )
}

export default function AvailabilityManager({ coach, isDemo = false }: { coach: Coach; isDemo?: boolean }) {
  const useDemoStore = isDemo || !supabaseConfigured
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [schedules, setSchedules] = useState<CoachSchedule[]>(() => useDemoStore ? demoGetSchedules(coach.slug) : [])
  const [blocks,    setBlocks]    = useState<CoachAvailabilityBlock[]>(() => useDemoStore ? demoGetBlocks(coach.slug) : [])
  const [upcoming,  setUpcoming]  = useState<Booking[]>([])
  const [loading,   setLoading]   = useState(!useDemoStore)
  const [coachTz,   setCoachTz]   = useState(DEFAULT_TIME_ZONE)
  const [statusErr, setStatusErr] = useState<string | null>(null)
  const [schedErr,  setSchedErr]  = useState<string | null>(null)
  const [blockErr,  setBlockErr]  = useState<string | null>(null)

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

  // Two-tap confirm for destructive taps: first tap arms ('sched:<id>' /
  // 'block:<id>' / 'cancel:<id>'), then ✓ fires or ✕ / a 4s timeout disarms.
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const confirmTimer = useRef<number | null>(null)
  const armConfirm = (key: string) => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    setConfirmKey(key)
    confirmTimer.current = window.setTimeout(() => setConfirmKey(null), CONFIRM_ARM_MS)
  }
  const disarmConfirm = () => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    confirmTimer.current = null
    setConfirmKey(null)
  }
  useEffect(() => () => { if (confirmTimer.current) window.clearTimeout(confirmTimer.current) }, [])

  const load = useCallback(async () => {
    if (useDemoStore) {
      setSchedules(demoGetSchedules(coach.slug))
      setBlocks(demoGetBlocks(coach.slug))
      // Booked Calls leads this page — an always-empty demo section would hide
      // the feature the owner most needs to show. Same filter as the live query.
      setUpcoming(
        DEMO_BOOKINGS
          .filter(b => b.coach_slug === coach.slug && b.status !== 'cancelled' && new Date(b.booked_at) > new Date())
          .sort((a, b) => a.booked_at.localeCompare(b.booked_at))
      )
      setLoading(false)
      return
    }
    setLoading(true)

    const now      = new Date()
    const todayKey = dateKeyInTimeZone(now, coachTz)
    const [sRes, bRes, upRes] = await Promise.all([
      supabase.from('coach_schedules').select('*').eq('coach_slug', coach.slug).eq('is_active', true),
      supabase.from('coach_availability_blocks').select('*').eq('coach_slug', coach.slug)
        .gte('block_date', todayKey),
      supabase.from('bookings').select(BOOKING_STAFF_COLUMNS).eq('coach_slug', coach.slug)
        .neq('status', 'cancelled').gte('booked_at', now.toISOString()).order('booked_at'),
    ])

    if (sRes.data)  setSchedules(sRes.data as CoachSchedule[])
    if (bRes.data)  setBlocks(bRes.data   as CoachAvailabilityBlock[])
    if (upRes.data) setUpcoming(upRes.data as Booking[])
    setLoading(false)
  }, [coach.slug, useDemoStore, coachTz])

  useEffect(() => { load() }, [load])

  const addSchedule = async () => {
    if (addEnd <= addStart) return
    setAdding(true)
    setSchedErr(null)
    const base: Omit<CoachSchedule, 'id' | 'created_at'> = {
      coach_slug: coach.slug, day_of_week: addDay, start_time: addStart,
      end_time: addEnd, slot_duration_minutes: addDuration, is_active: true,
    }
    if (useDemoStore) {
      const item: CoachSchedule = { ...base, id: `demo-sched-${Date.now()}`, created_at: new Date().toISOString() }
      demoAddSchedule(item)
      setSchedules(demoGetSchedules(coach.slug))
    } else {
      const { data, error } = await supabase.from('coach_schedules').insert(base).select().single()
      if (error || !data) setSchedErr('Those hours could not be saved. Check your connection and try again.')
      else setSchedules(s => [...s, data as CoachSchedule])
    }
    setAdding(false)
  }

  const removeSchedule = async (id: string) => {
    setSchedErr(null)
    if (useDemoStore) {
      demoRemoveSchedule(id, coach.slug)
      setSchedules(demoGetSchedules(coach.slug))
    } else {
      const { error } = await supabase.from('coach_schedules').update({ is_active: false }).eq('id', id)
      if (error) setSchedErr('Those hours could not be removed. Check your connection and try again.')
      else setSchedules(s => s.filter(x => x.id !== id))
    }
  }

  const addBlock = async () => {
    if (!blockDate) return
    setBlocking(true)
    setBlockErr(null)
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
      const { data, error } = await supabase.from('coach_availability_blocks').insert(base).select().single()
      if (error || !data) {
        // Keep the form as typed so the coach can just retry.
        setBlockErr('That date could not be blocked. Your entries were kept — try again.')
        setBlocking(false)
        return
      }
      setBlocks(b => [...b, data as CoachAvailabilityBlock])
    }
    setBlockDate(''); setBlockReason('')
    setBlocking(false)
  }

  const removeBlock = async (id: string) => {
    setBlockErr(null)
    if (useDemoStore) {
      demoRemoveBlock(id, coach.slug)
      setBlocks(demoGetBlocks(coach.slug))
    } else {
      const { error } = await supabase.from('coach_availability_blocks').delete().eq('id', id)
      if (error) setBlockErr('That block could not be removed. Check your connection and try again.')
      else setBlocks(b => b.filter(x => x.id !== id))
    }
  }

  // Goes through booking-update (not a direct table write) so the coach's Google
  // Calendar event is updated or cancelled alongside the row.
  const updateBookingStatus = async (id: string, status: Booking['status']) => {
    const prev = upcoming.find(b => b.id === id)?.status
    setStatusErr(null)
    setUpcoming(u => u.map(b => b.id === id ? { ...b, status } : b))
    if (isDemo || !supabaseConfigured) return

    const res = await updateBooking({ bookingId: id, status })
    if (!res.ok) {
      if (prev) setUpcoming(u => u.map(b => b.id === id ? { ...b, status: prev } : b))
      setStatusErr(calendarErrorMessage(res.code))
    }
  }

  if (loading) return (
    <div style={{ padding: '4rem 1rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading availability…</div>
  )


  // Group schedules by day
  const byDay = new Map<number, CoachSchedule[]>()
  schedules.forEach(s => {
    const arr = byDay.get(s.day_of_week) ?? []
    arr.push(s)
    byDay.set(s.day_of_week, arr)
  })

  const sortedBlocks = [...blocks].sort((a, b) => a.block_date.localeCompare(b.block_date))

  const invalidHours = addEnd <= addStart

  const fieldStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid #222', color: 'var(--text)',
    padding: '.6rem .75rem', borderRadius: '.25rem', fontSize: '.8rem',
    outline: 'none', fontFamily: 'inherit', appearance: 'none' as const,
  }

  // ≥2.5rem tap target that stays visually small inside a chip: the negative
  // vertical margins let the hit area overflow the chip without growing it.
  const chipTapBtn: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: '.8rem', lineHeight: 1, padding: 0,
    minWidth: '2.5rem', minHeight: '2.5rem',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    marginTop: '-.75rem', marginBottom: '-.75rem',
  }
  const confirmYesBtn: React.CSSProperties = {
    background: '#c8102e', border: 'none', color: 'var(--text)', fontWeight: 900,
    fontSize: '.75rem', lineHeight: 1, borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
    minWidth: '2.5rem', minHeight: '2.5rem', padding: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
  const confirmNoBtn: React.CSSProperties = {
    background: 'transparent', border: '1px solid var(--border-mid)', color: 'var(--text-3)', fontWeight: 700,
    fontSize: '.75rem', lineHeight: 1, borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
    minWidth: '2.5rem', minHeight: '2.5rem', padding: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }

  return (
    <div className="dash-pad" style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem', maxWidth: 760 }}>
      {useDemoStore && <DemoBanner note="The booking page reflects availability changes instantly for testing." />}

      <CalendarSyncPanel coach={coach} isDemo={useDemoStore} onTimeZoneChange={setCoachTz} />

      {/* What is bookable and on what terms (009). It lives in this tab rather
          than a fifth one because it is the same question as the weekly hours
          below — "when and for how long am I available" — and the header could
          not carry another tab. */}
      <section>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>Your booking page</p>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '1rem' }}>Services &amp; Policy</h2>
        <BookingPolicyPanel coach={coach} isDemo={useDemoStore} />
      </section>

      {/* Upcoming bookings — the thing a coach checks most, so it sits right under the connection status. */}
      <section>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>Upcoming</p>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '1rem' }}>Booked Calls</h2>

        {statusErr && <ErrorBanner text={statusErr} onDismiss={() => setStatusErr(null)} />}

        {upcoming.length === 0 ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.875rem' }}>No upcoming bookings.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {upcoming.map(b => {
              const dt = new Date(b.booked_at)
              const statusColor: Record<string, string> = { pending: '#272C84', confirmed: '#22c55e', cancelled: 'var(--text-4)' }
              const cancelArmed = confirmKey === `cancel:${b.id}`
              return (
                <div key={b.id} style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: isMobile ? '.75rem 1rem' : '1.5rem', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 140 }}>
                    <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.85rem' }}>{fmtDate(dt)}</p>
                    <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>{fmtTime(dt)} · {b.duration_minutes} min</p>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <p style={{ color: 'var(--text)', fontWeight: 600, fontSize: '.85rem' }}>{b.first_name} {b.last_name}</p>
                    <p style={{ color: 'var(--text-3)', fontSize: '.75rem', overflowWrap: 'anywhere' }}>{b.email}</p>
                  </div>
                  {cancelArmed ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                      <span style={{ color: '#c8102e', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Cancel call?</span>
                      <button onClick={() => { disarmConfirm(); updateBookingStatus(b.id, 'cancelled') }} aria-label="Confirm cancel" style={confirmYesBtn}>✓</button>
                      <button onClick={disarmConfirm} aria-label="Keep booking" style={confirmNoBtn}>✕</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                      {(['pending','confirmed','cancelled'] as Booking['status'][]).map(s => (
                        <button key={s}
                          onClick={() => {
                            if (b.status === s) return
                            if (s === 'cancelled') armConfirm(`cancel:${b.id}`)
                            else updateBookingStatus(b.id, s)
                          }}
                          style={{
                            background: b.status === s ? statusColor[s] + '20' : 'transparent',
                            border: `1px solid ${b.status === s ? statusColor[s] : 'var(--border-mid)'}`,
                            color: b.status === s ? statusColor[s] : 'var(--text-4)',
                            fontSize: '.55rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                            padding: '.25rem .75rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit',
                          }}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Weekly schedule */}
      <section>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>Weekly Schedule</p>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '1.5rem' }}>Recurring Availability</h2>

        {schedErr && <ErrorBanner text={schedErr} onDismiss={() => setSchedErr(null)} />}

        {/* Existing schedule rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginBottom: '1.5rem' }}>
          {DAYS.map((dayName, dow) => {
            const daySched = byDay.get(dow) ?? []
            return (
              <div key={dow} style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', gap: isMobile ? '.6rem' : '1rem', padding: '.75rem 1rem', background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem' }}>
                <span style={{ color: 'var(--text-3)', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', minWidth: isMobile ? 0 : 80 }}>{dayName}</span>
                <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '.5rem', minWidth: 0 }}>
                  {daySched.length === 0 ? (
                    <span style={{ color: 'var(--text-dim)', fontSize: '.75rem' }}>No availability</span>
                  ) : daySched.map(s => {
                    const armed = confirmKey === `sched:${s.id}`
                    return (
                      <span key={s.id} style={{
                        background: armed ? 'rgba(200,16,46,.08)' : 'rgba(39,44,132,.1)',
                        border: `1px solid ${armed ? 'rgba(200,16,46,.4)' : 'rgba(39,44,132,.25)'}`,
                        borderRadius: '.2rem', padding: '.25rem .65rem', display: 'inline-flex', alignItems: 'center', gap: '.5rem', maxWidth: '100%',
                      }}>
                        {armed ? (
                          <>
                            <span style={{ color: '#c8102e', fontSize: '.72rem', fontWeight: 700 }}>Remove?</span>
                            <button onClick={() => { disarmConfirm(); removeSchedule(s.id) }} aria-label="Confirm remove"
                              style={{ ...chipTapBtn, color: '#c8102e', fontWeight: 900 }}>✓</button>
                            <button onClick={disarmConfirm} aria-label="Keep hours"
                              style={{ ...chipTapBtn, color: 'var(--text-3)', marginRight: '-.65rem' }}>✕</button>
                          </>
                        ) : (
                          <>
                            <span style={{ color: 'var(--text)', fontSize: '.72rem', fontWeight: 700 }}>
                              {fmtTimePretty(s.start_time)} – {fmtTimePretty(s.end_time)}
                              <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> · starts every {s.slot_duration_minutes}min</span>
                            </span>
                            <button onClick={() => armConfirm(`sched:${s.id}`)} aria-label="Remove hours"
                              style={{ ...chipTapBtn, color: 'var(--text-4)', marginLeft: '-.5rem', marginRight: '-.65rem' }}>×</button>
                          </>
                        )}
                      </span>
                    )
                  })}
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
            <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }} title="How often a call may start. The service decides how long it runs.">Start Every</label>
            <select value={addDuration} onChange={e => setAddDuration(Number(e.target.value))} style={fieldStyle}>
              {SLOT_DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
            </select>
          </div>
          <button onClick={addSchedule} disabled={adding || invalidHours} style={{ background: adding || invalidHours ? 'var(--border)' : '#272C84', border: 'none', color: 'var(--text)', fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.65rem 1.25rem', minHeight: '2.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            {adding ? 'Adding…' : '+ Add Hours'}
          </button>
          {invalidHours && (
            <p style={{ flexBasis: '100%', color: '#c8102e', fontSize: '.7rem', margin: 0 }}>End time must be after start time.</p>
          )}
        </div>
      </section>

      {/* Block a date */}
      <section>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>Blocks</p>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '1.5rem' }}>Mark Time Off</h2>

        {blockErr && <ErrorBanner text={blockErr} onDismiss={() => setBlockErr(null)} />}

        {/* Existing blocks, soonest first */}
        {sortedBlocks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginBottom: '1.25rem' }}>
            {sortedBlocks.map(b => {
              const armed = confirmKey === `block:${b.id}`
              return (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem 1rem', padding: '.5rem 1rem', background: 'var(--surface)', border: `1px solid ${armed ? 'rgba(200,16,46,.4)' : 'var(--surface-2)'}`, borderRadius: '.25rem', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-2)', fontSize: '.8rem', fontWeight: 600 }}>
                    {new Date(b.block_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                  <span style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>
                    {!b.start_time ? 'All day' : `${fmtTimePretty(b.start_time)} – ${fmtTimePretty(b.end_time!)}`}
                  </span>
                  {b.reason && <span style={{ color: 'var(--text-4)', fontSize: '.75rem', fontStyle: 'italic' }}>{b.reason}</span>}
                  {armed ? (
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                      <span style={{ color: '#c8102e', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Remove?</span>
                      <button onClick={() => { disarmConfirm(); removeBlock(b.id) }} aria-label="Confirm remove" style={confirmYesBtn}>✓</button>
                      <button onClick={disarmConfirm} aria-label="Keep block" style={confirmNoBtn}>✕</button>
                    </div>
                  ) : (
                    <button onClick={() => armConfirm(`block:${b.id}`)}
                      style={{ marginLeft: 'auto', background: 'none', border: '1px solid #333', color: 'var(--text-4)', cursor: 'pointer', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.25rem .75rem', minHeight: '2.5rem', borderRadius: '.2rem', fontFamily: 'inherit' }}>Remove</button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Add block form */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'flex-end' }}>
          <div>
            <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Date</label>
            <input type="date" value={blockDate} onChange={e => setBlockDate(e.target.value)}
              min={dateKeyInTimeZone(new Date(), coachTz)}
              style={{ ...fieldStyle, colorScheme: 'dark' }} />
          </div>
          <div>
            <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Type</label>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              {[['Full Day', true], ['Time Range', false]].map(([label, val]) => (
                <button key={String(val)} onClick={() => setBlockFullDay(val as boolean)}
                  style={{ background: blockFullDay === val ? 'var(--surface-2)' : 'transparent', border: `1px solid ${blockFullDay === val ? '#272C84' : 'var(--border-mid)'}`, color: blockFullDay === val ? 'var(--text)' : 'var(--text-4)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.5rem .875rem', minHeight: '2.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
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
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Reason (optional)</label>
            <input value={blockReason} onChange={e => setBlockReason(e.target.value)} placeholder="e.g. Competition weekend" style={{ ...fieldStyle, width: '100%', boxSizing: 'border-box' }} />
          </div>
          <button onClick={addBlock} disabled={blocking || !blockDate}
            style={{ background: blocking || !blockDate ? 'var(--border)' : '#c8102e', border: 'none', color: 'var(--text)', fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.65rem 1.25rem', minHeight: '2.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            {blocking ? 'Blocking…' : 'Block Date'}
          </button>
        </div>
      </section>
    </div>
  )
}
