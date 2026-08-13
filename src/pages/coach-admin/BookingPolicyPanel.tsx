import { useState, useEffect, useCallback } from 'react'
import { supabase, supabaseConfigured } from '../../lib/supabase'
import type { Coach } from '../../data/coaches'
import { fmtDuration, fmtMoney } from '../../lib/availability'
import { DEMO_SERVICES } from '../../lib/services'
import DemoBanner from '../../components/dashboard/DemoBanner'

/**
 * What this coach offers, and how they take bookings.
 *
 * Both halves used to be constants nobody could reach. The four services on
 * /book were a hard-coded array of strings in BookPage.tsx; the notice period
 * was 120 minutes in the browser and 90 in the edge function, in two files that
 * had to be kept in step by hand and were not. Migration 009 made both of them
 * rows, and this is where a coach changes them.
 *
 * The duration is the part that matters most. Before the catalog, every call
 * this coach took was as long as their schedule window said — usually 30
 * minutes, for everything, forever. Turning a service on here is what makes a
 * 45-minute movement screen actually occupy 45 minutes of their calendar.
 */

const ACCENT = '#272C84'

interface ServiceRow {
  id: string
  slug: string
  name: string
  description: string | null
  duration_minutes: number
  price_cents: number | null
  price_note: string | null
  sort_order: number
}

interface OfferRow {
  service_id: string
  duration_minutes_override: number | null
  price_cents_override: number | null
  is_active: boolean
}

interface Policy {
  min_lead_minutes: number
  max_advance_days: number
  buffer_minutes: number
  auto_confirm: boolean
}

const DEFAULT_POLICY: Policy = {
  min_lead_minutes: 120,
  max_advance_days: 70,
  buffer_minutes: 0,
  auto_confirm: false,
}

const LEAD_CHOICES: [number, string][] = [
  [0, 'No notice'],
  [60, '1 hour'],
  [120, '2 hours'],
  [360, '6 hours'],
  [1440, '1 day'],
  [2880, '2 days'],
  [10080, '1 week'],
]

const ADVANCE_CHOICES: [number, string][] = [
  [14, '2 weeks'],
  [30, '1 month'],
  [70, '10 weeks'],
  [120, '4 months'],
  [365, '1 year'],
]

const BUFFER_CHOICES: [number, string][] = [
  [0, 'None'],
  [10, '10 minutes'],
  [15, '15 minutes'],
  [30, '30 minutes'],
]

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
      {hint && (
        <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.5, marginTop: '.4rem' }}>{hint}</p>
      )}
    </div>
  )
}

export default function BookingPolicyPanel({ coach, isDemo = false }: { coach: Coach; isDemo?: boolean }) {
  const readOnly = isDemo || !supabaseConfigured

  const [services, setServices] = useState<ServiceRow[]>([])
  const [offers, setOffers]     = useState<Map<string, OfferRow>>(new Map())
  const [policy, setPolicy]     = useState<Policy>(DEFAULT_POLICY)
  const [loading, setLoading]   = useState(!readOnly)
  const [error, setError]       = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const [savingPolicy, setSavingPolicy] = useState(false)

  const flash = (msg: string) => {
    setSavedFlash(msg)
    window.setTimeout(() => setSavedFlash(null), 2500)
  }

  const load = useCallback(async () => {
    if (readOnly) {
      setServices(DEMO_SERVICES.map((s, i) => ({
        id: s.id, slug: s.slug, name: s.name, description: s.description,
        duration_minutes: s.durationMinutes, price_cents: s.priceCents,
        price_note: s.priceNote, sort_order: i,
      })))
      setOffers(new Map(DEMO_SERVICES.map(s => [s.id, {
        service_id: s.id, duration_minutes_override: null, price_cents_override: null, is_active: true,
      }])))
      return
    }

    setLoading(true)
    const [servicesRes, offersRes, settingsRes] = await Promise.all([
      supabase.from('booking_services')
        .select('id,slug,name,description,duration_minutes,price_cents,price_note,sort_order')
        .order('sort_order'),
      supabase.from('coach_booking_services')
        .select('service_id,duration_minutes_override,price_cents_override,is_active')
        .eq('coach_slug', coach.slug),
      supabase.from('coach_public_settings')
        .select('min_lead_minutes,max_advance_days,buffer_minutes,auto_confirm')
        .eq('coach_slug', coach.slug)
        .maybeSingle(),
    ])

    if (servicesRes.error) {
      setError('Could not load the service list. Reload and try again.')
      setLoading(false)
      return
    }

    setServices((servicesRes.data ?? []) as ServiceRow[])
    setOffers(new Map(((offersRes.data ?? []) as OfferRow[]).map(o => [o.service_id, o])))

    const s = settingsRes.data as Partial<Policy> | null
    setPolicy({
      // A settings row that predates migration 009 has nulls where these
      // columns are. The defaults here match the DDL defaults, so the form
      // never shows a coach a policy the database does not actually hold.
      min_lead_minutes: s?.min_lead_minutes ?? DEFAULT_POLICY.min_lead_minutes,
      max_advance_days: s?.max_advance_days ?? DEFAULT_POLICY.max_advance_days,
      buffer_minutes:   s?.buffer_minutes ?? DEFAULT_POLICY.buffer_minutes,
      auto_confirm:     s?.auto_confirm ?? DEFAULT_POLICY.auto_confirm,
    })
    setLoading(false)
  }, [coach.slug, readOnly])

  useEffect(() => { void load() }, [load])

  const toggleService = async (service: ServiceRow) => {
    if (readOnly) return
    const current = offers.get(service.id)
    const next = !(current?.is_active ?? false)

    // Optimistic, then reconciled: the switch has to move under the finger.
    setOffers(prev => {
      const m = new Map(prev)
      m.set(service.id, {
        service_id: service.id,
        duration_minutes_override: current?.duration_minutes_override ?? null,
        price_cents_override: current?.price_cents_override ?? null,
        is_active: next,
      })
      return m
    })
    setError(null)

    // Upsert, not update: a coach who has never touched this service has no row
    // to update, and "I cannot turn this on" is not an acceptable way to find
    // that out.
    const { error: writeError } = await supabase
      .from('coach_booking_services')
      .upsert(
        {
          coach_slug: coach.slug,
          service_id: service.id,
          is_active: next,
          duration_minutes_override: current?.duration_minutes_override ?? null,
          price_cents_override: current?.price_cents_override ?? null,
        },
        { onConflict: 'coach_slug,service_id' }
      )

    if (writeError) {
      setError('That did not save. Reload and try again.')
      await load()
      return
    }
    flash(next ? `${service.name} is on your booking page.` : `${service.name} removed from your booking page.`)
  }

  const setOverride = async (service: ServiceRow, minutes: number | null) => {
    if (readOnly) return
    const current = offers.get(service.id)

    setOffers(prev => {
      const m = new Map(prev)
      m.set(service.id, {
        service_id: service.id,
        duration_minutes_override: minutes,
        price_cents_override: current?.price_cents_override ?? null,
        is_active: current?.is_active ?? true,
      })
      return m
    })

    const { error: writeError } = await supabase
      .from('coach_booking_services')
      .upsert(
        {
          coach_slug: coach.slug,
          service_id: service.id,
          is_active: current?.is_active ?? true,
          duration_minutes_override: minutes,
          price_cents_override: current?.price_cents_override ?? null,
        },
        { onConflict: 'coach_slug,service_id' }
      )

    if (writeError) {
      setError('That did not save. Reload and try again.')
      await load()
      return
    }
    flash('Length updated.')
  }

  const savePolicy = async () => {
    if (readOnly || savingPolicy) return
    setSavingPolicy(true)
    setError(null)

    // Upsert for the same reason as above: the seeded roster has a settings row,
    // a coach onboarded later does not.
    const { error: writeError } = await supabase
      .from('coach_public_settings')
      .upsert(
        { coach_slug: coach.slug, ...policy, updated_at: new Date().toISOString() },
        { onConflict: 'coach_slug' }
      )

    setSavingPolicy(false)

    if (writeError) {
      // 23514 → the coach_public_settings_policy_sane CHECK rejected a value.
      setError(writeError.code === '23514'
        ? 'Those numbers are outside what the booking page can use.'
        : 'That did not save. Reload and try again.')
      return
    }
    flash('Booking policy saved.')
  }

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>
        Loading…
      </div>
    )
  }

  const activeCount = services.filter(s => offers.get(s.id)?.is_active).length

  return (
    <div>
      {readOnly && <DemoBanner />}

      {error && (
        <div style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.7rem 1rem', marginBottom: '1rem' }}>
          <span style={{ color: '#c8102e', fontSize: '.8rem' }}>{error}</span>
        </div>
      )}
      {savedFlash && (
        <div style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.35)', borderRadius: '.25rem', padding: '.7rem 1rem', marginBottom: '1rem' }}>
          <span style={{ color: '#22c55e', fontSize: '.8rem' }}>{savedFlash}</span>
        </div>
      )}

      {/* ── What you offer ──────────────────────────────────────────────── */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h3 style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.5rem' }}>
          What you offer
        </h3>
        <p style={{ color: 'var(--text-3)', fontSize: '.82rem', lineHeight: 1.6, marginBottom: '1.25rem', maxWidth: 520 }}>
          Each one is a different length, and the length is what your booking page reserves on your calendar.
          Turn off anything you don’t do.
        </p>

        {activeCount === 0 && (
          <p style={{ color: '#eab308', fontSize: '.8rem', lineHeight: 1.6, marginBottom: '1rem' }}>
            Nothing is switched on. Your booking page still works — calls will run to whatever length your
            weekly hours below are set to — but visitors won’t see a choice.
          </p>
        )}

        <div style={{ display: 'grid', gap: 1, background: 'var(--surface-2)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden' }}>
          {services.map(s => {
            const offer  = offers.get(s.id)
            const on     = offer?.is_active ?? false
            const length = offer?.duration_minutes_override ?? s.duration_minutes
            const price  = fmtMoney(offer?.price_cents_override ?? s.price_cents)

            return (
              <div key={s.id} style={{ background: 'var(--bg)', padding: '1rem 1.1rem', display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <button
                  onClick={() => toggleService(s)}
                  disabled={readOnly}
                  role="switch"
                  aria-checked={on}
                  aria-label={`${on ? 'Remove' : 'Offer'} ${s.name}`}
                  style={{
                    flexShrink: 0, width: 38, height: 22, borderRadius: 999, marginTop: 2,
                    background: on ? ACCENT : 'var(--surface-2)',
                    border: `1px solid ${on ? ACCENT : 'var(--border-mid)'}`,
                    cursor: readOnly ? 'default' : 'pointer', position: 'relative',
                    transition: 'background .15s', padding: 0,
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, left: on ? 18 : 2,
                    width: 16, height: 16, borderRadius: '50%',
                    background: on ? '#fff' : 'var(--text-4)', transition: 'left .15s',
                  }} />
                </button>

                <div style={{ flex: 1, minWidth: 180 }}>
                  <p style={{ color: on ? 'var(--text)' : 'var(--text-3)', fontWeight: 700, fontSize: '.9rem', marginBottom: '.2rem' }}>
                    {s.name}
                  </p>
                  <p style={{ color: 'var(--text-4)', fontSize: '.75rem', lineHeight: 1.5 }}>
                    {fmtDuration(length)}
                    {price ? ` · ${price}${s.price_note ?? ''}` : ' · price discussed on the call'}
                  </p>
                </div>

                {on && (
                  <div style={{ flexShrink: 0 }}>
                    <label className="field-label" style={{ fontSize: '.55rem' }}>Your length</label>
                    <select
                      className="field"
                      style={{ minWidth: 120 }}
                      disabled={readOnly}
                      value={offer?.duration_minutes_override ?? ''}
                      onChange={e => setOverride(s, e.target.value === '' ? null : Number(e.target.value))}
                    >
                      {/* Empty string, not 0: an override of 0 would be a
                          zero-length call, and null is what means "use the
                          catalog's length". */}
                      <option value="">Standard ({s.duration_minutes} min)</option>
                      {[15, 20, 30, 45, 60, 75, 90].map(m => (
                        <option key={m} value={m}>{m} min</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── How you take bookings ───────────────────────────────────────── */}
      <section>
        <h3 style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.5rem' }}>
          How you take bookings
        </h3>
        <p style={{ color: 'var(--text-3)', fontSize: '.82rem', lineHeight: 1.6, marginBottom: '1.25rem', maxWidth: 520 }}>
          These apply to every service. The booking page reads them, and so does the server that accepts the booking.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', maxWidth: 640 }}>
          <Field label="Notice you need" hint="Nothing sooner than this is offered.">
            <select
              className="field"
              disabled={readOnly}
              value={policy.min_lead_minutes}
              onChange={e => setPolicy(p => ({ ...p, min_lead_minutes: Number(e.target.value) }))}
            >
              {LEAD_CHOICES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </Field>

          <Field label="How far ahead" hint="How much calendar visitors can see.">
            <select
              className="field"
              disabled={readOnly}
              value={policy.max_advance_days}
              onChange={e => setPolicy(p => ({ ...p, max_advance_days: Number(e.target.value) }))}
            >
              {ADVANCE_CHOICES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </Field>

          <Field label="Gap after a call" hint="Held on your calendar. Never added to the call itself.">
            <select
              className="field"
              disabled={readOnly}
              value={policy.buffer_minutes}
              onChange={e => setPolicy(p => ({ ...p, buffer_minutes: Number(e.target.value) }))}
            >
              {BUFFER_CHOICES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </Field>
        </div>

        {/*
          The one setting that changes what the client is told. With it off, a
          booking lands 'pending' and the confirmation screen says the coach will
          confirm within 24 hours — which is a promise this coach then has to
          keep by hand. With it on, the booking is confirmed on the spot and the
          screen says so instead. Either is honest; the mismatch is not.
        */}
        <label style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start', marginTop: '1.5rem', cursor: readOnly ? 'default' : 'pointer', maxWidth: 520 }}>
          <input
            type="checkbox"
            disabled={readOnly}
            checked={policy.auto_confirm}
            onChange={e => setPolicy(p => ({ ...p, auto_confirm: e.target.checked }))}
            style={{ marginTop: 3, width: 16, height: 16, accentColor: ACCENT, flexShrink: 0 }}
          />
          <span>
            <span style={{ display: 'block', color: 'var(--text)', fontSize: '.85rem', fontWeight: 700 }}>
              Confirm bookings automatically
            </span>
            <span style={{ display: 'block', color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.55, marginTop: '.25rem' }}>
              Off, a booking arrives as pending and the visitor is told you’ll confirm within 24 hours — so you have to.
              On, it’s confirmed the moment they book and they’re told that instead.
            </span>
          </span>
        </label>

        {!readOnly && (
          <button
            onClick={savePolicy}
            disabled={savingPolicy}
            style={{
              marginTop: '1.75rem',
              background: savingPolicy ? 'var(--border)' : ACCENT,
              border: 'none', color: savingPolicy ? 'var(--text-3)' : '#fff',
              fontWeight: 900, fontSize: '.7rem', letterSpacing: '.15em', textTransform: 'uppercase',
              padding: '.8rem 1.8rem', borderRadius: '.25rem',
              cursor: savingPolicy ? 'default' : 'pointer', fontFamily: 'inherit',
            }}
          >
            {savingPolicy ? 'Saving…' : 'Save policy'}
          </button>
        )}
      </section>
    </div>
  )
}
