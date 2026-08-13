import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { signOut } from '../lib/account'
import { fmtDateInZone, fmtTimeInZone, tzLabel, fmtDuration, browserTimeZone } from '../lib/availability'
import { homeFor } from '../lib/authRoute'
import { COACHES } from '../data/coaches'
import { href } from '../utils/nav'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'
const ACCENT = '#272C84'

/**
 * The athlete's page: their calls, past and future.
 *
 * Reads `my_bookings` (013) rather than `bookings`. The view exists because RLS
 * is row-level and cannot withhold a COLUMN — a policy that lets a client read
 * their own booking row also hands them `coach_notes`, which is the coach's
 * private assessment of the person reading it. The view is the projection; the
 * policy underneath it is still what decides which rows come back.
 */

interface MyBooking {
  id: string
  coach_slug: string
  booked_at: string
  duration_minutes: number
  status: 'pending' | 'confirmed' | 'cancelled'
  service_name: string | null
  google_meet_url: string | null
  manage_token: string
  cancelled_at: string | null
}

const MY_BOOKING_COLUMNS =
  'id,coach_slug,booked_at,duration_minutes,status,service_name,google_meet_url,manage_token,cancelled_at'

function coachName(slug: string): string {
  return COACHES.find(c => c.slug === slug)?.name
    ?? slug.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

function StatusPill({ booking, isPast }: { booking: MyBooking; isPast: boolean }) {
  const [text, color] =
    booking.status === 'cancelled' ? ['Cancelled', 'var(--text-4)'] :
    isPast                         ? ['Done', 'var(--text-4)'] :
    booking.status === 'confirmed' ? ['Confirmed', '#22c55e'] :
                                     ['Awaiting confirmation', '#eab308']
  return (
    <span style={{ display: 'inline-block', padding: '.2rem .55rem', borderRadius: 999, border: `1px solid ${color}`, color, fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {text}
    </span>
  )
}

function BookingRow({ booking }: { booking: MyBooking }) {
  const zone  = browserTimeZone()
  const start = new Date(booking.booked_at)
  const isPast = start.getTime() + booking.duration_minutes * 60_000 < Date.now()
  const live   = booking.status !== 'cancelled' && !isPast

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.1rem 1.25rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ minWidth: 200, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.4rem', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.9rem' }}>
            {booking.service_name ?? 'Consultation'}
          </span>
          <StatusPill booking={booking} isPast={isPast} />
        </div>
        <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.6 }}>
          {fmtDateInZone(start, zone)} · {fmtTimeInZone(start, zone)} {tzLabel(start, zone)}
          {' · '}{fmtDuration(booking.duration_minutes)}
        </p>
        <p style={{ color: 'var(--text-4)', fontSize: '.75rem', marginTop: '.2rem' }}>
          with {coachName(booking.coach_slug)}
        </p>
      </div>

      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        {live && booking.google_meet_url && (
          <a href={booking.google_meet_url} target="_blank" rel="noopener noreferrer" style={{ background: ACCENT, color: '#fff', fontWeight: 900, fontSize: '.62rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1rem', borderRadius: '.25rem', textDecoration: 'none' }}>
            Join
          </a>
        )}
        {live && (
          // The same manage link that goes in the confirmation email. The token
          // is this person's own, for this person's own booking — showing it to
          // them is not a disclosure, it is the whole point of the column.
          <a href={href(`/booking/${booking.manage_token}`)} style={{ background: 'none', border: '1px solid var(--surface-2)', color: 'var(--text-2)', fontWeight: 700, fontSize: '.62rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1rem', borderRadius: '.25rem', textDecoration: 'none' }}>
            Change
          </a>
        )}
      </div>
    </div>
  )
}

export default function AccountPage() {
  const { profile, loading: authLoading, isSignedIn } = useAuth()
  const [bookings, setBookings] = useState<MyBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  // Guards are UX, not security: the policies on `bookings` and the projection
  // in `my_bookings` are what actually decide what comes back.
  useEffect(() => {
    if (authLoading) return
    if (!isSignedIn) { window.location.replace(href('/signin')); return }
    if (profile && profile.status !== 'active') { window.location.replace(href('/pending')); return }
    if (profile && profile.role !== 'athlete') { window.location.replace(homeFor(profile)) }
  }, [authLoading, isSignedIn, profile])

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('my_bookings')
      .select(MY_BOOKING_COLUMNS)
      .order('booked_at', { ascending: false })

    // An empty list and a failed read look identical on screen unless one of
    // them says so. "You have no bookings" is a claim; this is not.
    if (error) { setFailed(true); setBookings([]) }
    else { setFailed(false); setBookings((data ?? []) as unknown as MyBooking[]) }
    setLoading(false)
  }, [])

  useEffect(() => { if (profile?.status === 'active') void load() }, [profile?.status, load])

  const now = Date.now()
  const upcoming = bookings.filter(b => b.status !== 'cancelled' && new Date(b.booked_at).getTime() + b.duration_minutes * 60_000 >= now)
  const past     = bookings.filter(b => !upcoming.includes(b))

  const displayName = profile?.display_name || profile?.first_name || 'there'

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <header style={{ borderBottom: '1px solid var(--surface)', padding: '0 1.25rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1rem' }}>
        <a href={href('/')} style={{ display: 'flex', alignItems: 'center' }}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 22, filter: 'var(--logo-filter)' }} />
        </a>
        <span style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase' }}>
          Your account
        </span>
        <button
          onClick={() => void signOut().then(() => window.location.replace(href('/')))}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-4)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Sign out
        </button>
      </header>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2.5rem 1.25rem 5rem' }}>
        <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.6rem,5vw,2.4rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: 1, marginBottom: '.5rem' }}>
          Hey {displayName}
        </h1>
        <p style={{ color: 'var(--text-3)', fontSize: '.9rem', marginBottom: '2.5rem' }}>
          {profile?.email}
        </p>

        {loading ? (
          <p style={{ color: 'var(--text-3)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
        ) : failed ? (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '2rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text)', fontSize: '.9rem', fontWeight: 700, marginBottom: '.4rem' }}>
              We couldn&rsquo;t load your bookings.
            </p>
            <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.6, marginBottom: '1.25rem' }}>
              That&rsquo;s on our side. Nothing has been cancelled.
            </p>
            <button onClick={() => void load()} style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--text)', color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '0 0 .3rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <section style={{ marginBottom: '3rem' }}>
              <h2 style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase', marginBottom: '1rem' }}>
                Coming up
              </h2>
              {upcoming.length === 0 ? (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.75rem', textAlign: 'center' }}>
                  <p style={{ color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.65, marginBottom: '1.25rem' }}>
                    Nothing booked right now.
                  </p>
                  <a href={href('/book')} style={{ background: ACCENT, color: '#fff', fontWeight: 900, fontSize: '.68rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '.8rem 1.6rem', borderRadius: '.25rem', textDecoration: 'none', display: 'inline-block' }}>
                    Book a call →
                  </a>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                  {upcoming.map(b => <BookingRow key={b.id} booking={b} />)}
                </div>
              )}
            </section>

            {past.length > 0 && (
              <section>
                <h2 style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase', marginBottom: '1rem' }}>
                  Past
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem', opacity: .72 }}>
                  {past.map(b => <BookingRow key={b.id} booking={b} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
