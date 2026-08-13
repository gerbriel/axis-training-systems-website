import { useState, useEffect, useCallback } from 'react'
import { COACHES } from '../data/coaches'
import type { Coach } from '../data/coaches'
import {
  fetchOpenSlots, slotsByDate, fmtDate, fmtTimeInZone, fmtDateInZone, tzLabel,
  fmtDuration, fmtMoney, browserTimeZone,
} from '../lib/availability'
import type { TimeSlot, AvailabilityFailure } from '../lib/availability'
import { fetchCoachServices } from '../lib/services'
import type { BookingService } from '../lib/services'
import { dateKeyInTimeZone, addDaysToDateKey } from '../lib/tz'
import { createBooking, calendarErrorMessage } from '../lib/calendarSync'
import type { BookingCreateSuccess } from '../lib/calendarSync'
import { downloadCalendarFile } from '../lib/ics'
import { useBotTrap } from '../lib/botTrap'
import { trackBookingEvent } from '../lib/analytics'
import { href } from '../utils/nav'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

/**
 * How much calendar is fetched at a time. The grid renders exactly this span —
 * fetching less leaves the tail of the grid permanently, invisibly empty, and
 * fetching more is a bigger response for days nobody scrolled to.
 *
 * 28, not 70: the server caps a request at 42 days, and a month is the unit
 * people navigate in. "Later" pages forward from here.
 */
const WINDOW_DAYS = 28

type Step = 'service' | 'coach' | 'slot' | 'form' | 'done'

const STEPS: [Step, string][] = [
  ['service', 'Service'],
  ['coach', 'Coach'],
  ['slot', 'Date & Time'],
  ['form', 'Details'],
]

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const ACCENT = '#272C84'

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.5rem' }}>
      {children}
    </p>
  )
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.6rem,4vw,3rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: .95, marginBottom: '1.5rem' }}>
      {children}
    </h2>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '.5rem', fontFamily: 'inherit' }}>
      ← Back
    </button>
  )
}

/**
 * An outage is not an empty calendar.
 *
 * The page used to call the availability fetch with a bare `.then()` and no
 * `.catch()`, over a loader that deliberately throws on a read error — so any
 * hiccup left "Loading availability…" on screen for ever. The fix is not only
 * to catch it: it is to say which of the two things happened, because "nothing
 * is open" and "we could not find out" send a visitor to very different places.
 */
function OutagePanel({ reason, onRetry }: { reason: AvailabilityFailure; onRetry: () => void }) {
  const copy: Record<AvailabilityFailure, { head: string; body: string }> = {
    outage: {
      head: 'We couldn’t load the times just now.',
      body: 'That’s on our side, not yours — the calendar didn’t answer. Nothing is booked out.',
    },
    rate_limited: {
      head: 'Give it a moment.',
      body: 'That’s a lot of requests from one place in a short time. Wait a few seconds and try again.',
    },
    unknown_coach: {
      head: 'We couldn’t find that coach.',
      body: 'The link may be out of date. Head back and pick a coach from the list.',
    },
  }
  const { head, body } = copy[reason]

  return (
    <div style={{ marginTop: '1rem', padding: '2.5rem 2rem', background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', textAlign: 'center' }}>
      <p style={{ color: 'var(--text)', fontSize: '.95rem', fontWeight: 700, marginBottom: '.4rem' }}>{head}</p>
      <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.6, maxWidth: 380, margin: '0 auto' }}>{body}</p>
      <button
        onClick={onRetry}
        style={{ marginTop: '1.5rem', background: 'none', border: 'none', borderBottom: '1px solid var(--text)', color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '0 0 .3rem', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        Try again
      </button>
    </div>
  )
}

function StepIndicator({ step }: { step: Step }) {
  const idx = STEPS.findIndex(([s]) => s === step)
  return (
    <ol style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem 1.5rem', listStyle: 'none', padding: 0, margin: '0 0 2.5rem' }}>
      {STEPS.map(([s, label], i) => (
        <li key={s} style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span style={{
            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
            border: `1.5px solid ${i <= idx ? ACCENT : 'var(--border-mid)'}`,
            background: i === idx ? ACCENT : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '.6rem', fontWeight: 900,
            color: i === idx ? '#fff' : i < idx ? 'var(--text)' : 'var(--text-4)',
          }}>
            {i < idx ? '✓' : i + 1}
          </span>
          <span style={{ fontSize: '.55rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: i <= idx ? 'var(--text)' : 'var(--text-4)', whiteSpace: 'nowrap' }}>
            {label}
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * The running total, visible from step one.
 *
 * Someone four steps into a booking should never have to remember what they
 * picked in step one to know what they are agreeing to. It sits beside the flow
 * on a wide screen and above it on a narrow one.
 */
function SummaryRail({ service, coach, slot, viewerZone }: {
  service: BookingService | null
  coach: Coach | null
  slot: TimeSlot | null
  viewerZone: string
}) {
  const price = service ? fmtMoney(service.priceCents) : null

  return (
    <aside className="book-rail">
      <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem' }}>
        <p style={{ color: ACCENT, fontSize: '.6rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1.25rem' }}>
          Your booking
        </p>

        {!service && !coach ? (
          <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.6 }}>Choose a service to begin.</p>
        ) : (
          <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {service && (
              <div>
                <dt style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>Service</dt>
                <dd style={{ margin: '.25rem 0 0', color: 'var(--text)', fontSize: '.875rem', fontWeight: 700 }}>{service.name}</dd>
              </div>
            )}
            {coach && (
              <div>
                <dt style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>Coach</dt>
                <dd style={{ margin: '.25rem 0 0', color: 'var(--text)', fontSize: '.875rem', fontWeight: 700 }}>{coach.name}</dd>
              </div>
            )}
            {slot && (
              <div>
                <dt style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>When</dt>
                <dd style={{ margin: '.25rem 0 0', color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, lineHeight: 1.45 }}>
                  {fmtDateInZone(slot.start, viewerZone)}
                  <br />
                  {fmtTimeInZone(slot.start, viewerZone)} {tzLabel(slot.start, viewerZone)}
                </dd>
              </div>
            )}

            {service && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--surface-2)', paddingTop: '1rem' }}>
                <dt style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>Length</dt>
                <dd style={{ margin: 0, color: 'var(--text)', fontSize: '.8rem', fontWeight: 700 }}>
                  {fmtDuration(slot?.durationMinutes ?? service.durationMinutes)}
                </dd>
              </div>
            )}

            {/* A price is only shown when there is one. Most Axis coaching is a
                monthly arrangement, so "Contact for pricing" is the honest
                answer rather than a missing value dressed up as $0. */}
            {service && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <dt style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>Price</dt>
                <dd style={{ margin: 0, color: 'var(--text)', fontSize: '.8rem', fontWeight: 700, textAlign: 'right' }}>
                  {price ? `${price}${service.priceNote ?? ''}` : 'Discussed on the call'}
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </aside>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — service
// ─────────────────────────────────────────────────────────────────────────────

function ServicePicker({ services, loading, failure, selected, onSelect, onRetry, onSkip }: {
  services: BookingService[]
  loading: boolean
  failure: 'outage' | null
  selected: BookingService | null
  onSelect: (s: BookingService) => void
  onRetry: () => void
  onSkip: () => void
}) {
  return (
    <div>
      <Eyebrow>Step 01</Eyebrow>
      <Title>What do you want to talk about?</Title>
      <p style={{ color: 'var(--text-3)', fontSize: '.9rem', lineHeight: 1.6, marginBottom: '2rem', maxWidth: 520 }}>
        Each one is a different length. Pick the closest fit — your coach will steer it from there.
      </p>

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>
          Loading…
        </div>
      ) : failure ? (
        <OutagePanel reason="outage" onRetry={onRetry} />
      ) : services.length === 0 ? (
        // A coach with no catalog rows is a supported state, not a dead end:
        // they take calls at whatever their schedule window says, exactly as
        // every coach did before there was a catalog.
        <div style={{ padding: '2rem', background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem' }}>
          <p style={{ color: 'var(--text)', fontSize: '.9rem', fontWeight: 700, marginBottom: '.5rem' }}>No set session types yet.</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.6, marginBottom: '1.25rem' }}>
            You can still book a call — it will run to your coach’s standard length.
          </p>
          <button onClick={onSkip} style={primaryButton(false)}>Pick a time →</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 1, background: 'var(--surface-2)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden' }}>
          {services.map(s => {
            const isSelected = selected?.id === s.id
            const price = fmtMoney(s.priceCents)
            return (
              <button
                key={s.id}
                onClick={() => onSelect(s)}
                aria-pressed={isSelected}
                style={{
                  background: isSelected ? 'rgba(39,44,132,.12)' : 'var(--bg)',
                  border: 'none', borderLeft: `3px solid ${isSelected ? ACCENT : 'transparent'}`,
                  padding: '1.25rem 1.25rem', textAlign: 'left', cursor: 'pointer',
                  fontFamily: 'inherit', display: 'flex', gap: '1rem',
                  alignItems: 'flex-start', justifyContent: 'space-between',
                  transition: 'background .12s',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface)' }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg)' }}
              >
                <span style={{ display: 'block', minWidth: 0 }}>
                  <span style={{ display: 'block', color: 'var(--text)', fontWeight: 700, fontSize: '.95rem', marginBottom: '.3rem' }}>
                    {s.name}
                  </span>
                  {s.description && (
                    <span style={{ display: 'block', color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.55 }}>
                      {s.description}
                    </span>
                  )}
                </span>
                <span style={{ flexShrink: 0, textAlign: 'right' }}>
                  <span style={{ display: 'block', color: 'var(--text)', fontSize: '.75rem', fontWeight: 700 }}>
                    {fmtDuration(s.durationMinutes)}
                  </span>
                  <span style={{ display: 'block', color: 'var(--text-3)', fontSize: '.7rem', marginTop: '.2rem' }}>
                    {price ? `${price}${s.priceNote ?? ''}` : ''}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — coach
// ─────────────────────────────────────────────────────────────────────────────

function CoachPicker({ onSelect, onBack }: { onSelect: (c: Coach) => void; onBack: () => void }) {
  return (
    <div>
      <BackButton onClick={onBack} />
      <Eyebrow>Step 02</Eyebrow>
      <Title>Choose your coach</Title>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 1, background: 'var(--surface-2)' }}>
        {COACHES.map(c => (
          <button
            key={c.slug}
            onClick={() => onSelect(c)}
            style={{ background: 'var(--bg)', border: 'none', cursor: 'pointer', padding: 0, position: 'relative', aspectRatio: '3/4', overflow: 'hidden', display: 'block', textAlign: 'left' }}
            onMouseEnter={e => { const img = e.currentTarget.querySelector('img'); if (img) img.style.transform = 'scale(1.05)' }}
            onMouseLeave={e => { const img = e.currentTarget.querySelector('img'); if (img) img.style.transform = 'scale(1)' }}
          >
            <img
              src={c.photo || c.ctaBg}
              alt={c.name}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', filter: 'grayscale(20%) brightness(0.7)', transition: 'transform .4s ease' }}
            />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.9) 100%)' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '1.25rem 1rem' }}>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '.65rem', fontWeight: 700 }}>{c.firstName}</p>
              <p style={{ color: '#fff', fontWeight: 900, fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '-.01em', lineHeight: 1 }}>
                {c.name.split(' ').slice(1).join(' ')}
              </p>
              <p style={{ color: 'rgba(255,255,255,.75)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginTop: '.3rem' }}>{c.role}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — date & time
// ─────────────────────────────────────────────────────────────────────────────

function SlotPicker({ coach, service, notice, onSelect, onBack }: {
  coach: Coach
  service: BookingService | null
  notice: string | null
  onSelect: (slot: TimeSlot) => void
  onBack: () => void
}) {
  const viewerZone = browserTimeZone()

  /**
   * `windowStart` is what we ASK for; `firstKey` is what came back.
   *
   * They are two states rather than one because null is a meaningful request —
   * "whatever the coach's first page is" — and only the server can resolve it.
   * Writing the resolved key back into `windowStart` would re-run the effect
   * and fetch the same four weeks a second time on every coach selection.
   */
  const [windowStart, setWindowStart] = useState<string | null>(null)
  const [firstKey, setFirstKey] = useState<string | null>(null)
  const [slots, setSlots] = useState<Map<string, TimeSlot[]>>(new Map())
  const [coachZone, setCoachZone] = useState(viewerZone)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<AvailabilityFailure | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async (from: string | null) => {
    setLoading(true)
    const res = await fetchOpenSlots({
      coachSlug: coach.slug,
      serviceId: service?.id ?? null,
      fromDateKey: from ?? undefined,
      days: WINDOW_DAYS,
    })

    if (!res.ok) {
      setFailure(res.reason)
      setSlots(new Map())
      setLoading(false)
      return
    }

    setFailure(null)
    setCoachZone(res.timeZone)
    setSlots(slotsByDate(res.days))
    setFirstKey(res.days[0]?.dateKey ?? from)
    // A date that is no longer in the window cannot stay selected — its time
    // list would be empty and the header would name a day nobody can book.
    setSelectedDate(prev => (prev && res.days.some(d => d.dateKey === prev) ? prev : null))
    setLoading(false)
  }, [coach.slug, service?.id])

  useEffect(() => { void load(windowStart) }, [load, windowStart, reloadKey])

  const todayKey = dateKeyInTimeZone(new Date(), coachZone)
  const anchor   = firstKey ?? todayKey
  const atStart  = anchor <= todayKey
  const weeks    = buildWeeks(anchor, WINDOW_DAYS)

  const page = (delta: number) => setWindowStart(addDaysToDateKey(anchor, delta * WINDOW_DAYS))

  const daySlots = selectedDate ? slots.get(selectedDate) ?? [] : []

  return (
    <div>
      <BackButton onClick={onBack} />
      <Eyebrow>Step 03 · {coach.firstName}</Eyebrow>
      <Title>Pick a date & time</Title>

      {notice && (
        <div style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.75rem 1rem', marginBottom: '1.5rem' }}>
          <span style={{ color: '#c8102e', fontSize: '.8rem' }}>{notice}</span>
        </div>
      )}

      {/* Week navigation. Disabled rather than hidden at the near edge, so the
          control does not move under the cursor as you page back. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
        <button
          disabled={atStart || loading}
          onClick={() => page(-1)}
          style={navButton(atStart || loading)}
        >
          ← Earlier
        </button>
        <span style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>
          {firstKey ? rangeLabel(firstKey, WINDOW_DAYS) : ''}
        </span>
        <button
          disabled={loading}
          onClick={() => page(1)}
          style={navButton(loading)}
        >
          Later →
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>
          Loading availability…
        </div>
      ) : failure ? (
        <OutagePanel reason={failure} onRetry={() => setReloadKey(k => k + 1)} />
      ) : slots.size === 0 ? (
        // Genuinely nothing open — not an outage, and worded so the difference
        // is legible: the next window is one tap away rather than a dead end.
        <div style={{ padding: '2.5rem 2rem', background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.95rem', fontWeight: 700, marginBottom: '.4rem' }}>
            Nothing open in these four weeks.
          </p>
          <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.6, maxWidth: 380, margin: '0 auto 1.5rem' }}>
            {coach.firstName} is fully booked for this stretch. Try the next four weeks, or another coach.
          </p>
          <button
            onClick={() => page(1)}
            style={primaryButton(false)}
          >
            Look further ahead →
          </button>
        </div>
      ) : (
        <div className="book-calendar">
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
              {['M','T','W','T','F','S','S'].map((d, i) => (
                <div key={i} style={{ textAlign: 'center', color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', padding: '.4rem 0' }}>{d}</div>
              ))}
            </div>

            {weeks.map((week, wi) => {
              const monthOfWeek = Number(week[0].slice(5, 7)) - 1
              const prevMonth   = wi === 0 ? -1 : Number(weeks[wi - 1][0].slice(5, 7)) - 1
              const showMonth   = monthOfWeek !== prevMonth

              return (
                <div key={week[0]}>
                  {showMonth && (
                    <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', margin: '1rem 0 .4rem', paddingTop: wi > 0 ? '.5rem' : 0, borderTop: wi > 0 ? '1px solid var(--surface-2)' : 'none' }}>
                      {MONTHS[monthOfWeek]}
                    </p>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 2 }}>
                    {week.map(dateKey => {
                      // Both keys are 'YYYY-MM-DD' in the COACH's zone, so they
                      // compare as strings. Comparing a Date against the
                      // viewer's clock mis-greys the boundary day for anyone
                      // who is not standing where the coach is.
                      const isPast     = dateKey < todayKey
                      const hasSlots   = slots.has(dateKey)
                      const isSelected = selectedDate === dateKey
                      const isToday    = dateKey === todayKey

                      return (
                        <button
                          key={dateKey}
                          disabled={isPast || !hasSlots}
                          onClick={() => setSelectedDate(dateKey)}
                          aria-label={`${dateKey}${hasSlots ? '' : ', no times'}`}
                          style={{
                            background: isSelected ? ACCENT : hasSlots ? 'var(--surface)' : 'transparent',
                            border: isToday ? '1px solid var(--border-mid)' : '1px solid transparent',
                            borderRadius: '.2rem',
                            color: isSelected ? '#fff' : isPast ? 'var(--border-mid)' : hasSlots ? 'var(--text)' : 'var(--text-dim)',
                            fontWeight: isSelected || hasSlots ? 700 : 400,
                            fontSize: '.8rem', padding: '.55rem 0',
                            cursor: hasSlots && !isPast ? 'pointer' : 'default',
                            textAlign: 'center', position: 'relative', fontFamily: 'inherit',
                            transition: 'background .1s',
                          }}
                          onMouseEnter={e => { if (hasSlots && !isPast && !isSelected) e.currentTarget.style.background = 'var(--surface-2)' }}
                          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = hasSlots ? 'var(--surface)' : 'transparent' }}
                        >
                          {Number(dateKey.slice(8, 10))}
                          {hasSlots && !isSelected && (
                            <span style={{ position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: ACCENT, display: 'block' }} />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="book-times">
            {!selectedDate ? (
              <div style={{ paddingTop: '1rem', color: 'var(--text-4)', fontSize: '.8rem' }}>Select a date to see times.</div>
            ) : (
              <>
                <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.9rem', marginBottom: '.25rem' }}>
                  {fmtDate(new Date(selectedDate + 'T12:00:00'))}
                </p>
                {/* A bare time is ambiguous the moment the visitor is not standing
                    in the coach's zone, which is most of them. */}
                <p style={{ color: 'var(--text-3)', fontSize: '.7rem', marginBottom: '1rem' }}>
                  Times in your timezone ({tzLabel(new Date(selectedDate + 'T12:00:00'), viewerZone)})
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                  {daySlots.map((slot, i) => {
                    // The slot is GROUPED under the coach's calendar day but its
                    // TIME is rendered in the viewer's. Far enough east or west
                    // and that instant lands on a different day than the header
                    // says, so the slot names its own date when they disagree.
                    const crossesDay = dateKeyInTimeZone(slot.start, viewerZone) !== selectedDate
                    return (
                      <button
                        key={i}
                        onClick={() => onSelect(slot)}
                        style={{
                          background: 'var(--surface)', border: '1px solid var(--surface-2)', color: 'var(--text)',
                          fontSize: '.8rem', fontWeight: 700, padding: '.7rem 1rem', borderRadius: '.25rem',
                          cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'all .1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = ACCENT; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = ACCENT }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--surface-2)' }}
                      >
                        {crossesDay && (
                          <span style={{ color: 'inherit', opacity: .7, fontWeight: 700, marginRight: '.5rem', fontSize: '.7rem' }}>
                            {fmtDateInZone(slot.start, viewerZone)},
                          </span>
                        )}
                        {fmtTimeInZone(slot.start, viewerZone)}
                        <span style={{ opacity: .7, fontWeight: 400, marginLeft: '.5rem', fontSize: '.7rem' }}>
                          {fmtDuration(slot.durationMinutes)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — details
// ─────────────────────────────────────────────────────────────────────────────

function BookingForm({ coach, service, slot, onBack, onDone, onSlotTaken }: {
  coach: Coach
  service: BookingService | null
  slot: TimeSlot
  onBack: () => void
  onDone: (result: BookingCreateSuccess) => void
  onSlotTaken: (message: string) => void
}) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', goals: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const viewerZone = browserTimeZone()
  // Honeypot + time-trap. booking-create is rate-limited server-side already;
  // this stops a bot burning that budget (and a coach's calendar) before the
  // request is even made.
  const bot = useBotTrap()

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const complete = form.firstName.trim() && form.lastName.trim() && form.email.trim()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!complete || submitting) return
    // Suspected bot: silently drop it back to the slot picker, no booking made.
    // Not an error message — a honeypot that announces itself is a honeypot that
    // gets bypassed next time.
    if (bot.isSuspect()) { onSlotTaken(''); return }
    setSubmitting(true)
    setError(null)

    // booking-create owns the write: it re-derives the slot server-side, reads
    // the duration off the service, commits the row, and queues the Google
    // event. The client never inserts directly and never sends a duration.
    const res = await createBooking({
      coachSlug: coach.slug,
      startsAt:  slot.start,
      serviceId: service?.id ?? null,
      firstName: form.firstName.trim(),
      lastName:  form.lastName.trim(),
      email:     form.email.trim(),
      phone:     form.phone.trim(),
      goals:     form.goals.trim(),
    })

    if (!res.ok) {
      setSubmitting(false)
      trackBookingEvent('booking_failed', { coachSlug: coach.slug, serviceId: service?.id })
      // The slot went stale mid-flow. Send them back to a fresh calendar rather
      // than leaving them staring at a time that is gone.
      if (res.code === 'slot_taken' || res.code === 'slot_unavailable' || res.code === 'too_soon') {
        onSlotTaken(calendarErrorMessage(res.code))
        return
      }
      setError(calendarErrorMessage(res.code))
      return
    }

    trackBookingEvent('booking_completed', { coachSlug: coach.slug, serviceId: service?.id })
    onDone(res)
  }

  return (
    <div>
      <BackButton onClick={onBack} />
      <Eyebrow>Step 04</Eyebrow>
      <Title>Your information</Title>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1rem 1.25rem', marginBottom: '2rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        {[
          ['Coach', coach.name],
          ['Service', service?.name ?? 'Consultation'],
          ['When', `${fmtDateInZone(slot.start, viewerZone)}, ${fmtTimeInZone(slot.start, viewerZone)} ${tzLabel(slot.start, viewerZone)}`],
          ['Length', fmtDuration(slot.durationMinutes)],
        ].map(([label, value]) => (
          <div key={label}>
            <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.25rem' }}>{label}</p>
            <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.875rem' }}>{value}</p>
          </div>
        ))}
      </div>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 560 }}>
        {/* Off-screen honeypot — see botTrap.ts. A person never sees or tabs to it. */}
        <input {...bot.fieldProps} />
        <div className="book-field-pair">
          <div>
            <label className="field-label" htmlFor="bk-first">First name *</label>
            <input id="bk-first" className="field" value={form.firstName} onChange={set('firstName')} maxLength={80} required autoComplete="given-name" />
          </div>
          <div>
            <label className="field-label" htmlFor="bk-last">Last name *</label>
            <input id="bk-last" className="field" value={form.lastName} onChange={set('lastName')} maxLength={80} required autoComplete="family-name" />
          </div>
        </div>
        <div className="book-field-pair">
          <div>
            <label className="field-label" htmlFor="bk-email">Email *</label>
            <input id="bk-email" className="field" type="email" value={form.email} onChange={set('email')} maxLength={254} required autoComplete="email" />
          </div>
          <div>
            <label className="field-label" htmlFor="bk-phone">Phone</label>
            <input id="bk-phone" className="field" type="tel" value={form.phone} onChange={set('phone')} maxLength={40} autoComplete="tel" />
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="bk-goals">What are you working towards?</label>
          <textarea id="bk-goals" className="field" rows={4} value={form.goals} onChange={set('goals')} maxLength={2000} placeholder="Where you are now, and what you're aiming for…" />
        </div>

        {error && (
          <p role="alert" style={{ color: '#c8102e', fontSize: '.8rem', lineHeight: 1.5 }}>{error}</p>
        )}

        <button type="submit" disabled={submitting || !complete} style={primaryButton(submitting || !complete)}>
          {submitting ? 'Booking…' : 'Confirm booking →'}
        </button>

        <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.6 }}>
          We’ll email you a confirmation with a link to change or cancel it.
        </p>
      </form>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Done
// ─────────────────────────────────────────────────────────────────────────────

function BookingConfirmation({ coach, service, slot, result }: {
  coach: Coach
  service: BookingService | null
  slot: TimeSlot
  result: BookingCreateSuccess
}) {
  const viewerZone = browserTimeZone()

  /**
   * The DATABASE decides whether a booking is confirmed, not this component.
   * `auto_confirm` (009) is a per-coach setting, so an online booking may land
   * either way, and `status` on the response is what it landed as.
   *
   * This is the one screen where getting it wrong is unrecoverable: the client
   * reads it once, and if it says "confirmed" while the coach's portal says
   * "pending", only one of them is true.
   */
  const heldForReview = result.status === 'pending'
  const manageUrl = `${window.location.origin}${href(`/booking/${result.manageToken}`)}`

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center', paddingTop: '1rem' }}>
      <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(39,44,132,.12)', border: `2px solid ${ACCENT}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', fontSize: '1.4rem', color: 'var(--text)' }}>
        {heldForReview ? '◷' : '✓'}
      </div>

      <Eyebrow>{heldForReview ? 'Your time is held' : 'You’re booked'}</Eyebrow>
      <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.6rem,4vw,2.5rem)', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '2rem' }}>
        {heldForReview ? 'Nearly there' : 'See you soon'}
      </h2>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.75rem', marginBottom: '1.5rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {[
          ['Coach', coach.name],
          ['Service', service?.name ?? 'Consultation'],
          ['When', `${fmtDateInZone(slot.start, viewerZone)}, ${fmtTimeInZone(slot.start, viewerZone)} ${tzLabel(slot.start, viewerZone)}`],
          ['Length', fmtDuration(slot.durationMinutes)],
        ].map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline', borderBottom: '1px solid var(--surface-2)', paddingBottom: '1rem' }}>
            <span style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', flexShrink: 0 }}>{label}</span>
            <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.875rem', textAlign: 'right' }}>{value}</span>
          </div>
        ))}

        {/*
          Every claim here is one the code keeps. A pending booking really does
          hold its time: `bookings_no_overlap` (008) covers every status except
          cancelled, so nobody else can take it while the coach decides, and
          cancelling is what gives it back. The email really is sent —
          booking-notify drains the queue that migration 010's trigger fills.
        */}
        <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.7, margin: 0 }}>
          {heldForReview
            ? `${coach.firstName} will confirm within 24 hours. Your time is held on their calendar until then — nobody else can take it. We’ve emailed you a confirmation, and we’ll email again the moment it’s confirmed.`
            : `This one is confirmed. We’ve emailed you the details${result.meetLink ? ', including the video link' : ''}.`}
        </p>
      </div>

      {/* The link is shown, not only mailed. Someone who mistypes their address
          or loses the email still has the one route back to their booking — and
          this is the only place it is ever displayed. */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.25rem', marginBottom: '2rem', textAlign: 'left' }}>
        <p style={{ color: ACCENT, fontSize: '.6rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.6rem' }}>
          Need to change it?
        </p>
        <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.6, marginBottom: '1rem' }}>
          Move or cancel it yourself, any time up to two hours before. Bookmark this:
        </p>
        <a href={href(`/booking/${result.manageToken}`)} style={{ color: 'var(--text)', fontSize: '.75rem', wordBreak: 'break-all', textDecoration: 'underline', textUnderlineOffset: 3 }}>
          {manageUrl}
        </a>
      </div>

      <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => downloadCalendarFile({
            uid: `booking-${result.bookingId}@axistrainingsystems.com`,
            start: slot.start,
            end: slot.end,
            summary: `${service?.name ?? 'Axis call'} — ${coach.name}`,
            description: result.meetLink ? `Join: ${result.meetLink}` : `Manage: ${manageUrl}`,
            location: result.meetLink ?? undefined,
          })}
          style={primaryButton(false)}
        >
          Add to calendar
        </button>
        <a href={href(`/coaches/${coach.slug}`)} style={{ ...secondaryButton(), textDecoration: 'none', display: 'inline-block' }}>
          {coach.firstName}’s profile →
        </a>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles + date helpers
// ─────────────────────────────────────────────────────────────────────────────

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? 'var(--border)' : ACCENT,
    border: 'none', color: disabled ? 'var(--text-3)' : '#fff',
    fontWeight: 900, fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase',
    padding: '.85rem 2rem', borderRadius: '.25rem',
    cursor: disabled ? 'default' : 'pointer', alignSelf: 'flex-start',
    fontFamily: 'inherit', transition: 'background .15s',
  }
}

function secondaryButton(): React.CSSProperties {
  return {
    background: 'none', border: '1px solid var(--surface-2)', color: 'var(--text-2)',
    fontWeight: 700, fontSize: '.7rem', letterSpacing: '.1em', textTransform: 'uppercase',
    padding: '.85rem 1.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
  }
}

function navButton(disabled: boolean): React.CSSProperties {
  return {
    background: 'none', border: '1px solid var(--surface-2)',
    color: disabled ? 'var(--text-4)' : 'var(--text-2)',
    fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
    padding: '.5rem .9rem', borderRadius: '.2rem',
    cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
  }
}

/**
 * The grid, as date keys, starting on the Monday on or before `fromKey`.
 *
 * Built by pure string arithmetic through addDaysToDateKey rather than by
 * mutating a Date: `d.setDate(d.getDate() + 1)` is evaluated in the BROWSER's
 * zone, which is not the zone these keys are denominated in, and it slips a day
 * across a DST boundary.
 */
function buildWeeks(fromKey: string, days: number): string[][] {
  const [y, m, d] = fromKey.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  let cursor = addDaysToDateKey(fromKey, -(dow === 0 ? 6 : dow - 1))

  const weeks: string[][] = []
  const weekCount = Math.ceil((days + 6) / 7)
  for (let w = 0; w < weekCount; w++) {
    const week: string[] = []
    for (let i = 0; i < 7; i++) {
      week.push(cursor)
      cursor = addDaysToDateKey(cursor, 1)
    }
    weeks.push(week)
  }
  return weeks
}

function rangeLabel(fromKey: string, days: number): string {
  const toKey = addDaysToDateKey(fromKey, days - 1)
  const fmt = (key: string) => {
    const [y, m, d] = key.split('-').map(Number)
    // UTC in and UTC out: the key is a calendar date, not an instant, and
    // rendering it through local time shifts it for anyone east of Greenwich.
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
  }
  return `${fmt(fromKey)} – ${fmt(toKey)}`
}

// ─────────────────────────────────────────────────────────────────────────────

export default function BookPage() {
  // Deep links: ?coach=slug from a coach page, ?service=slug from a service
  // card. Resolved in the initialisers, not an effect — this is the starting
  // state, not a reaction to something changing, and doing it in an effect
  // renders the wrong step first and then corrects it.
  const params = new URLSearchParams(window.location.search)
  const preselectedCoach = (() => {
    const slug = params.get('coach')
    return slug ? COACHES.find(c => c.slug === slug) ?? null : null
  })()
  const serviceSlugParam = params.get('service')

  const [step, setStep]       = useState<Step>('service')
  const [coach, setCoach]     = useState<Coach | null>(preselectedCoach)
  const [service, setService] = useState<BookingService | null>(null)
  const [slot, setSlot]       = useState<TimeSlot | null>(null)
  const [result, setResult]   = useState<BookingCreateSuccess | null>(null)
  const [slotNotice, setSlotNotice] = useState<string | null>(null)

  const [services, setServices] = useState<BookingService[]>([])
  const [servicesLoading, setServicesLoading] = useState(true)
  const [servicesFailure, setServicesFailure] = useState<'outage' | null>(null)
  const [servicesKey, setServicesKey] = useState(0)

  const viewerZone = browserTimeZone()

  useEffect(() => { trackBookingEvent('booking_page_view') }, [])

  /**
   * The catalog is per-coach, so it can only be loaded once a coach is known.
   * With a coach deep-linked we can load it immediately; without one we load
   * the first coach's menu to render step 1, then reload for whoever is
   * actually chosen — the menu is the same for the whole roster today, and a
   * coach who has turned something off is caught on reload before any of it
   * reaches booking-create, which validates the pairing itself.
   */
  const catalogCoach = coach ?? COACHES[0]

  useEffect(() => {
    let live = true
    setServicesLoading(true)
    fetchCoachServices(catalogCoach.slug).then(res => {
      if (!live) return
      if (!res.ok) {
        setServicesFailure('outage')
        setServices([])
      } else {
        setServicesFailure(null)
        setServices(res.services)
        // Resolve ?service=slug against the menu we just loaded, once.
        setService(prev => {
          if (prev) {
            // Keep the selection across a coach change when the new coach
            // offers the same thing; drop it when they do not, rather than
            // carrying it into a booking that would be refused.
            return res.services.find(s => s.slug === prev.slug) ?? null
          }
          return serviceSlugParam ? res.services.find(s => s.slug === serviceSlugParam) ?? null : null
        })
      }
      setServicesLoading(false)
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogCoach.slug, servicesKey])

  const selectService = (s: BookingService) => {
    setService(s)
    setSlot(null)
    trackBookingEvent('service_selected', { coachSlug: coach?.slug, serviceId: s.id })
    // A deep-linked coach means the coach step is already answered.
    setStep(preselectedCoach ? 'slot' : 'coach')
  }

  const skipService = () => {
    setService(null)
    setStep(preselectedCoach ? 'slot' : 'coach')
  }

  const selectCoach = (c: Coach) => {
    setCoach(c)
    setSlot(null)
    trackBookingEvent('coach_selected', { coachSlug: c.slug, serviceId: service?.id })
    setStep('slot')
  }

  const selectSlot = (s: TimeSlot) => {
    setSlotNotice(null)
    setSlot(s)
    trackBookingEvent('slot_selected', { coachSlug: coach?.slug, serviceId: service?.id })
    setStep('form')
  }

  const slotTaken = (message: string) => {
    setSlot(null)
    setSlotNotice(message)
    setStep('slot')
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <style>{BOOK_CSS}</style>

      <header style={{ background: 'var(--bg)', borderBottom: '1px solid var(--surface)', padding: '0 1.25rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.25rem' }}>
        <a href={href('/')} style={{ display: 'flex', alignItems: 'center' }}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 22, filter: 'var(--logo-filter)' }} />
        </a>
        <span style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase' }}>Book a call</span>
      </header>

      <div className="book-shell">
        {step === 'done' && coach && slot && result ? (
          <BookingConfirmation coach={coach} service={service} slot={slot} result={result} />
        ) : (
          <>
            <StepIndicator step={step} />
            <div className="book-layout">
              <div style={{ minWidth: 0 }}>
                {step === 'service' && (
                  <ServicePicker
                    services={services}
                    loading={servicesLoading}
                    failure={servicesFailure}
                    selected={service}
                    onSelect={selectService}
                    onRetry={() => setServicesKey(k => k + 1)}
                    onSkip={skipService}
                  />
                )}
                {step === 'coach' && (
                  <CoachPicker onSelect={selectCoach} onBack={() => setStep('service')} />
                )}
                {step === 'slot' && coach && (
                  <SlotPicker
                    coach={coach}
                    service={service}
                    notice={slotNotice}
                    onSelect={selectSlot}
                    onBack={() => setStep(preselectedCoach ? 'service' : 'coach')}
                  />
                )}
                {step === 'form' && coach && slot && (
                  <BookingForm
                    coach={coach}
                    service={service}
                    slot={slot}
                    onBack={() => setStep('slot')}
                    onDone={r => { setResult(r); setStep('done') }}
                    onSlotTaken={slotTaken}
                  />
                )}
              </div>

              <SummaryRail service={service} coach={coach} slot={slot} viewerZone={viewerZone} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The layout rules that inline styles cannot express.
 *
 * The calendar and the time list used to be a hard two-column grid with no
 * breakpoint — `minmax(0,1fr) minmax(0,280px)` — because a style attribute
 * cannot hold a media query. On a phone that squeezed a seven-column month grid
 * and a time rail into the same row, which is the width most people book at.
 */
const BOOK_CSS = `
.book-shell { max-width: 1080px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
.book-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2rem; }
.book-calendar { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; }
.book-times { border-top: 1px solid var(--surface-2); padding-top: 1.5rem; }
.book-field-pair { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.book-rail { order: -1; }

@media (min-width: 640px) {
  .book-shell { padding: 3rem 2rem 5rem; }
  .book-field-pair { grid-template-columns: 1fr 1fr; }
  .book-calendar { grid-template-columns: minmax(0, 1fr) minmax(0, 260px); }
  .book-times { border-top: none; border-left: 1px solid var(--surface-2); padding-top: 0; padding-left: 1.75rem; }
}

@media (min-width: 960px) {
  .book-layout { grid-template-columns: minmax(0, 1fr) 260px; gap: 3rem; }
  /* Back into source order on a wide screen, where it sits alongside rather
     than on top of the step it is summarising. */
  .book-rail { order: 0; position: sticky; top: 2rem; align-self: start; }
}
`
