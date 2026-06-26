import { useState, useEffect } from 'react'
import { COACHES } from '../data/coaches'
import type { Coach } from '../data/coaches'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { fetchAvailableSlots, fmtTime, fmtDate } from '../lib/availability'
import type { TimeSlot } from '../lib/availability'
import { href } from '../utils/nav'
import { demoGetSchedules, demoGetBlocks } from '../lib/demoAvailabilityStore'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

type Step = 'coach' | 'slot' | 'form' | 'done'

const SERVICES = [
  '1:1 Coaching (Full Service)',
  'Game Day Coaching',
  'Coaching Mentorship',
  'Movement Consulting',
]

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function getCalendarWeeks(referenceDate: Date, count = 8): Date[][] {
  const weeks: Date[][] = []
  const cursor = new Date(referenceDate)
  cursor.setHours(0, 0, 0, 0)
  const dow = cursor.getDay()
  cursor.setDate(cursor.getDate() - (dow === 0 ? 6 : dow - 1)) // back to Monday
  for (let w = 0; w < count; w++) {
    const week: Date[] = []
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

function dateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function StepIndicator({ step }: { step: Step }) {
  const steps: [Step, string][] = [['coach', 'Coach'], ['slot', 'Date & Time'], ['form', 'Details'], ['done', 'Confirmed']]
  const idx = steps.findIndex(([s]) => s === step)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: '3rem' }}>
      {steps.map(([s, label], i) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : undefined }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.35rem' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', border: '2px solid',
              borderColor: i <= idx ? '#272C84' : 'var(--border-mid)',
              background: i === idx ? '#272C84' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '.65rem', fontWeight: 900,
              color: i === idx ? '#000' : i < idx ? 'var(--text)' : 'var(--text-4)',
            }}>
              {i < idx ? '✓' : i + 1}
            </div>
            <span style={{ fontSize: '.55rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: i <= idx ? 'var(--text)' : 'var(--text-4)', whiteSpace: 'nowrap' }}>{label}</span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 1, background: i < idx ? '#272C84' : 'var(--border-mid)', margin: '0 .5rem', marginBottom: '1.2rem' }} />
          )}
        </div>
      ))}
    </div>
  )
}

function CoachPicker({ onSelect }: { onSelect: (c: Coach) => void }) {
  return (
    <div>
      <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Step 01</p>
      <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.75rem,4vw,3rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: .95, marginBottom: '2.5rem' }}>Choose Your Coach</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1px', background: 'var(--surface-2)' }}>
        {COACHES.map(c => (
          <button
            key={c.slug}
            onClick={() => onSelect(c)}
            style={{ background: 'var(--bg)', border: 'none', cursor: 'pointer', padding: 0, position: 'relative', aspectRatio: '3/4', overflow: 'hidden', display: 'block', textAlign: 'left' }}
            onMouseEnter={e => { const img = e.currentTarget.querySelector('img') as HTMLImageElement | null; if (img) img.style.transform = 'scale(1.05)' }}
            onMouseLeave={e => { const img = e.currentTarget.querySelector('img') as HTMLImageElement | null; if (img) img.style.transform = 'scale(1)' }}
          >
            <img
              src={c.photo || c.ctaBg}
              alt={c.name}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', filter: 'grayscale(20%) brightness(0.7)', transition: 'transform .4s ease' }}
            />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.9) 100%)' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '1.25rem 1rem' }}>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '.65rem', fontWeight: 700 }}>{c.firstName}</p>
              <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '-.01em', lineHeight: 1 }}>
                {c.name.split(' ').slice(1).join(' ')}
              </p>
              <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginTop: '.3rem' }}>{c.role}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function SlotPicker({ coach, onSelect, onBack }: {
  coach: Coach
  onSelect: (slot: TimeSlot) => void
  onBack: () => void
}) {
  const [slots, setSlots] = useState<Map<string, TimeSlot[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const today = new Date()
  const weeks = getCalendarWeeks(today, 10)

  useEffect(() => {
    if (!supabaseConfigured) {
      // Build slots from the in-memory demo store (set by coach in their admin Availability tab)
      const schedules = demoGetSchedules(coach.slug)
      const blocks    = demoGetBlocks(coach.slug)
      const demoSlots = new Map<string, TimeSlot[]>()
      const now = new Date()
      const bufferMs = 2 * 60 * 60 * 1000 // 2hr booking buffer

      for (let d = 0; d <= 56; d++) {
        const day = new Date(now)
        day.setDate(day.getDate() + d)
        day.setHours(0, 0, 0, 0)
        const dow = day.getDay()
        const key = dateStr(day)

        // Check if fully blocked
        const fullDayBlock = blocks.find(b => b.block_date === key && !b.start_time)
        if (fullDayBlock) continue

        const daySchedules = schedules.filter(s => s.day_of_week === dow && s.is_active)
        if (!daySchedules.length) continue

        const daySlots: TimeSlot[] = []
        for (const sched of daySchedules) {
          const [sh, sm] = sched.start_time.split(':').map(Number)
          const [eh, em] = sched.end_time.split(':').map(Number)
          const windowStart = new Date(day); windowStart.setHours(sh, sm, 0, 0)
          const windowEnd   = new Date(day); windowEnd.setHours(eh, em, 0, 0)
          const dur = sched.slot_duration_minutes * 60000

          for (let t = windowStart.getTime(); t + dur <= windowEnd.getTime(); t += dur) {
            const start = new Date(t)
            const end   = new Date(t + dur)
            // Skip past slots (with 2hr buffer)
            if (start.getTime() < now.getTime() + bufferMs) continue
            // Skip time-specific blocks
            const blocked = blocks.some(b => {
              if (b.block_date !== key || !b.start_time || !b.end_time) return false
              const [bsh, bsm] = b.start_time.split(':').map(Number)
              const [beh, bem] = b.end_time.split(':').map(Number)
              const bs = new Date(day); bs.setHours(bsh, bsm, 0, 0)
              const be = new Date(day); be.setHours(beh, bem, 0, 0)
              return start < be && end > bs
            })
            if (!blocked) daySlots.push({ start, end, durationMinutes: sched.slot_duration_minutes })
          }
        }
        if (daySlots.length) demoSlots.set(key, daySlots)
      }
      setSlots(demoSlots)
      setLoading(false)
      return
    }
    fetchAvailableSlots(coach.slug).then(s => { setSlots(s); setLoading(false) })
  }, [coach.slug])

  const todayStr = dateStr(today)

  // Group weeks by month for headers
  let lastMonth = -1

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        ← Back
      </button>

      <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Step 02 · {coach.name}</p>
      <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.75rem,4vw,3rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: .95, marginBottom: '2rem' }}>Pick a Date & Time</h2>

      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem', letterSpacing: '.1em', textTransform: 'uppercase' }}>Loading availability…</div>
      ) : slots.size === 0 ? (
        <div style={{ padding: '2rem', background: 'var(--surface)', border: '1px solid #222', borderRadius: '.25rem', color: 'var(--text-3)', fontSize: '.875rem' }}>
          No availability set for {coach.firstName} yet. Check back soon or contact us directly.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 280px)', gap: '2rem' }}>
          {/* Calendar */}
          <div>
            {/* Day headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
              {['M','T','W','T','F','S','S'].map((d, i) => (
                <div key={i} style={{ textAlign: 'center', color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', padding: '.4rem 0' }}>{d}</div>
              ))}
            </div>

            {/* Week rows */}
            {weeks.map((week, wi) => {
              const firstOfWeek = week[0]
              const month = firstOfWeek.getMonth()
              const showMonthLabel = month !== lastMonth
              if (showMonthLabel) lastMonth = month

              return (
                <div key={wi}>
                  {showMonthLabel && (
                    <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', margin: '1rem 0 .4rem', paddingTop: wi > 0 ? '.5rem' : 0, borderTop: wi > 0 ? '1px solid var(--surface-2)' : 'none' }}>
                      {MONTHS[month]}
                    </p>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 2 }}>
                    {week.map((day, di) => {
                      const ds  = dateStr(day)
                      const isPast = day < today && ds !== todayStr
                      const hasSlots = slots.has(ds)
                      const isSelected = selectedDate === ds
                      const isToday = ds === todayStr

                      return (
                        <button
                          key={di}
                          disabled={isPast || !hasSlots}
                          onClick={() => setSelectedDate(ds)}
                          style={{
                            background: isSelected ? '#272C84' : hasSlots ? 'var(--surface)' : 'transparent',
                            border: isToday ? '1px solid #333' : '1px solid transparent',
                            borderRadius: '.2rem',
                            color: isSelected ? '#000' : isPast ? 'var(--border-mid)' : hasSlots ? 'var(--text)' : 'var(--text-dim)',
                            fontWeight: isSelected || hasSlots ? 700 : 400,
                            fontSize: '.8rem',
                            padding: '.5rem 0',
                            cursor: hasSlots && !isPast ? 'pointer' : 'default',
                            transition: 'all .1s',
                            textAlign: 'center',
                            position: 'relative',
                            fontFamily: 'inherit',
                          }}
                          onMouseEnter={e => { if (hasSlots && !isPast && !isSelected) e.currentTarget.style.background = 'var(--surface-2)' }}
                          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = hasSlots ? 'var(--surface)' : 'transparent' }}
                        >
                          {day.getDate()}
                          {hasSlots && !isSelected && (
                            <span style={{ position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: '#272C84', display: 'block' }} />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Time slots */}
          <div style={{ borderLeft: '1px solid var(--surface-2)', paddingLeft: '2rem' }}>
            {!selectedDate ? (
              <div style={{ paddingTop: '2rem', color: 'var(--text-4)', fontSize: '.8rem' }}>← Select a date</div>
            ) : (
              <>
                <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.9rem', marginBottom: '1rem' }}>
                  {fmtDate(new Date(selectedDate + 'T00:00:00'))}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                  {(slots.get(selectedDate) ?? []).map((slot, i) => (
                    <button
                      key={i}
                      onClick={() => onSelect(slot)}
                      style={{
                        background: 'var(--surface)', border: '1px solid #222', color: 'var(--text)',
                        fontSize: '.8rem', fontWeight: 700, padding: '.65rem 1rem', borderRadius: '.25rem',
                        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                        transition: 'all .1s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#272C84'; e.currentTarget.style.color = '#000'; e.currentTarget.style.borderColor = '#272C84' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                    >
                      {fmtTime(slot.start)}
                      <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: '.5rem', fontSize: '.7rem' }}>{slot.durationMinutes} min</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function BookingForm({ coach, slot, onBack, onDone }: {
  coach: Coach
  slot: TimeSlot
  onBack: () => void
  onDone: (bookingId: string) => void
}) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', service: '', goals: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.firstName || !form.lastName || !form.email) return
    setSubmitting(true)
    setError(null)

    if (!supabaseConfigured) {
      // Demo mode — simulate a small network delay then confirm
      await new Promise(r => setTimeout(r, 600))
      onDone('demo-' + Math.random().toString(36).slice(2, 10))
      return
    }

    const { data, error: err } = await supabase.from('bookings').insert({
      coach_slug:       coach.slug,
      booked_at:        slot.start.toISOString(),
      duration_minutes: slot.durationMinutes,
      first_name:       form.firstName,
      last_name:        form.lastName,
      email:            form.email,
      phone:            form.phone || null,
      service_interest: form.service || null,
      goals:            form.goals  || null,
    }).select('id').single()

    if (err || !data) {
      setError('Something went wrong. Please try again.')
      setSubmitting(false)
      return
    }
    onDone(data.id)
  }

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        ← Back
      </button>

      <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Step 03</p>
      <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.75rem,4vw,3rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: .95, marginBottom: '.75rem' }}>Your Information</h2>

      {/* Booking summary strip */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1rem 1.25rem', marginBottom: '2rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        <div>
          <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.25rem' }}>Coach</p>
          <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.875rem' }}>{coach.name}</p>
        </div>
        <div>
          <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.25rem' }}>Date</p>
          <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.875rem' }}>{fmtDate(slot.start)}</p>
        </div>
        <div>
          <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.25rem' }}>Time</p>
          <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.875rem' }}>{fmtTime(slot.start)} — {fmtTime(slot.end)}</p>
        </div>
      </div>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 560 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label className="field-label">First Name *</label>
            <input className="field" value={form.firstName} onChange={set('firstName')} required />
          </div>
          <div>
            <label className="field-label">Last Name *</label>
            <input className="field" value={form.lastName} onChange={set('lastName')} required />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label className="field-label">Email *</label>
            <input className="field" type="email" value={form.email} onChange={set('email')} required />
          </div>
          <div>
            <label className="field-label">Phone</label>
            <input className="field" type="tel" value={form.phone} onChange={set('phone')} />
          </div>
        </div>
        <div>
          <label className="field-label">Service Interest</label>
          <select className="field" value={form.service} onChange={set('service')}>
            <option value="">Select a service…</option>
            {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">What are your goals?</label>
          <textarea className="field" rows={4} value={form.goals} onChange={set('goals')} placeholder="Tell us where you are now and what you're aiming for…" />
        </div>

        {error && (
          <p style={{ color: '#c8102e', fontSize: '.8rem' }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting || !form.firstName || !form.lastName || !form.email}
          style={{
            background: submitting || !form.firstName || !form.lastName || !form.email ? 'var(--border)' : '#272C84',
            border: 'none', color: submitting ? 'var(--text-3)' : '#000', fontWeight: 900,
            fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase',
            padding: '.9rem 2.5rem', borderRadius: '.25rem', cursor: 'pointer',
            alignSelf: 'flex-start', fontFamily: 'inherit', transition: 'background .15s',
          }}
          onMouseEnter={e => { if (!submitting) e.currentTarget.style.background = '#ffd782' }}
          onMouseLeave={e => { if (!submitting) e.currentTarget.style.background = '#272C84' }}
        >
          {submitting ? 'Booking…' : 'Confirm Booking →'}
        </button>
      </form>
    </div>
  )
}

function BookingConfirmation({ coach, slot }: { coach: Coach; slot: TimeSlot }) {
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center', paddingTop: '2rem' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(39,44,132,.12)', border: '2px solid #272C84', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', fontSize: '1.5rem' }}>
        ✓
      </div>
      <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.5rem' }}>You're Booked</p>
      <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.75rem,4vw,2.5rem)', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '2rem' }}>See You Soon</h2>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '2rem', marginBottom: '2rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {[
          ['Coach',    coach.name],
          ['Date',     fmtDate(slot.start)],
          ['Time',     `${fmtTime(slot.start)} — ${fmtTime(slot.end)}`],
          ['Duration', `${slot.durationMinutes} minutes`],
        ].map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-2)', paddingBottom: '1.25rem' }}>
            <span style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>{label}</span>
            <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.875rem' }}>{value}</span>
          </div>
        ))}
        <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.7 }}>
          Your coach will confirm within 24 hours. Check your inbox — you may also receive a calendar invite once confirmed.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
        <a href={href('/')} style={{ background: 'none', border: '1px solid #222', color: 'var(--text-2)', fontWeight: 700, fontSize: '.7rem', letterSpacing: '.1em', textTransform: 'uppercase', padding: '.7rem 1.5rem', borderRadius: '.25rem', textDecoration: 'none', display: 'inline-block' }}>
          ← Home
        </a>
        <a href={href(`/coaches/${coach.slug}`)} style={{ background: '#272C84', border: '1px solid #272C84', color: '#ffffff', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.1em', textTransform: 'uppercase', padding: '.7rem 1.5rem', borderRadius: '.25rem', textDecoration: 'none', display: 'inline-block' }}>
          View {coach.firstName}'s Profile →
        </a>
      </div>
    </div>
  )
}

export default function BookPage() {
  // Pre-select a coach via ?coach=slug query param
  const preselectedCoach = (() => {
    const params = new URLSearchParams(window.location.search)
    const slug = params.get('coach')
    return slug ? COACHES.find(c => c.slug === slug) ?? null : null
  })()

  const [step, setStep]       = useState<Step>(preselectedCoach ? 'slot' : 'coach')
  const [coach, setCoach]     = useState<Coach | null>(preselectedCoach)
  const [slot, setSlot]       = useState<TimeSlot | null>(null)
  const [bookingId, setBookingId] = useState<string>('')

  const selectCoach = (c: Coach) => { setCoach(c); setStep('slot') }
  const selectSlot  = (s: TimeSlot) => { setSlot(s); setStep('form') }
  const done        = (id: string) => { setBookingId(id); setStep('done') }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Nav bar (minimal) */}
      <header style={{ background: 'var(--bg)', borderBottom: '1px solid var(--surface)', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 22, filter: 'var(--logo-filter)' }} />
        </a>
        <span style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase' }}>Book a Call</span>
      </header>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '4rem 2rem' }}>
        {step !== 'done' && <StepIndicator step={step} />}

        {step === 'coach' && <CoachPicker onSelect={selectCoach} />}
        {step === 'slot'  && coach && <SlotPicker coach={coach} onSelect={selectSlot} onBack={preselectedCoach ? () => window.history.back() : () => setStep('coach')} />}
        {step === 'form'  && coach && slot && <BookingForm coach={coach} slot={slot} onBack={() => setStep('slot')} onDone={done} />}
        {step === 'done'  && coach && slot && <BookingConfirmation coach={coach} slot={slot} />}
      </div>
    </div>
  )
}
