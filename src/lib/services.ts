import { supabase, supabaseConfigured } from './supabase'

/**
 * The bookable catalog (migration 009).
 *
 * What the booking page shows, and — crucially — where the LENGTH of a call
 * comes from. The client sends a service id and nothing else about it; the edge
 * function reads the duration and the price back out of the database. This
 * module exists to render the menu, never to decide what is on it.
 */

export interface BookingService {
  id: string
  slug: string
  name: string
  description: string | null
  durationMinutes: number
  /** null is a real value: most Axis coaching has no price at booking time. */
  priceCents: number | null
  priceNote: string | null
}

export type ServicesResult =
  | { ok: true; services: BookingService[] }
  /**
   * Distinct from an empty list on purpose. Empty means this coach genuinely
   * offers nothing bookable; `outage` means we could not find out and the page
   * must not tell anyone their coach has nothing available.
   */
  | { ok: false; reason: 'outage' }

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
  sort_order: number
}

/**
 * What this coach offers, with their overrides applied.
 *
 * An empty array is a supported answer and the booking page handles it: a coach
 * with no `coach_booking_services` rows takes bookings at whatever length their
 * schedule window says, exactly as every coach did before there was a catalog.
 */
export async function fetchCoachServices(coachSlug: string): Promise<ServicesResult> {
  if (!supabaseConfigured) return { ok: true, services: DEMO_SERVICES }

  const [servicesRes, offersRes] = await Promise.all([
    supabase
      .from('booking_services')
      .select('id,slug,name,description,duration_minutes,price_cents,price_note,sort_order'),
    supabase
      .from('coach_booking_services')
      .select('service_id,duration_minutes_override,price_cents_override,sort_order')
      .eq('coach_slug', coachSlug),
  ])

  // Fail loud rather than rendering a shorter menu than the coach actually has.
  // RLS already filters both tables to active rows, so an error here is a real
  // one and not an empty result.
  if (servicesRes.error || offersRes.error) return { ok: false, reason: 'outage' }

  const catalog = new Map((servicesRes.data as ServiceRow[] ?? []).map(s => [s.id, s]))
  const offers  = (offersRes.data as OfferRow[] ?? [])

  const services = offers
    .map(offer => {
      const base = catalog.get(offer.service_id)
      if (!base) return null
      return {
        id:          base.id,
        slug:        base.slug,
        name:        base.name,
        description: base.description,
        // `??` and not `||`: an override of 0 is a free session, not a missing value.
        durationMinutes: offer.duration_minutes_override ?? base.duration_minutes,
        priceCents:      offer.price_cents_override ?? base.price_cents,
        priceNote:       base.price_note,
        sortOrder:       offer.sort_order || base.sort_order,
      }
    })
    .filter((s): s is BookingService & { sortOrder: number } => s !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(({ sortOrder: _sortOrder, ...service }) => service)

  return { ok: true, services }
}

/** The whole catalog, for the admin. Includes inactive rows for anyone allowed to see them. */
export async function fetchAllServices(): Promise<ServicesResult> {
  if (!supabaseConfigured) return { ok: true, services: DEMO_SERVICES }

  const { data, error } = await supabase
    .from('booking_services')
    .select('id,slug,name,description,duration_minutes,price_cents,price_note,sort_order')
    .order('sort_order')

  if (error) return { ok: false, reason: 'outage' }

  return {
    ok: true,
    services: (data as ServiceRow[] ?? []).map(s => ({
      id:              s.id,
      slug:            s.slug,
      name:            s.name,
      description:     s.description,
      durationMinutes: s.duration_minutes,
      priceCents:      s.price_cents,
      priceNote:       s.price_note,
    })),
  }
}

/** Mirrors the seed in migration 009 so the demo portal shows the real menu. */
export const DEMO_SERVICES: BookingService[] = [
  {
    id: 'demo-intro-call', slug: 'intro-call', name: 'Free Intro Call',
    description: 'A short call to talk through where you are, what you want, and whether Axis is the right fit. No commitment.',
    durationMinutes: 20, priceCents: 0, priceNote: null,
  },
  {
    id: 'demo-coaching-consult', slug: 'coaching-consult', name: '1:1 Coaching Consultation',
    description: 'For athletes considering full-service coaching. Training history, competition goals, and how the coach-athlete relationship would work.',
    durationMinutes: 30, priceCents: null, priceNote: null,
  },
  {
    id: 'demo-game-day-consult', slug: 'game-day-consult', name: 'Game Day Coaching Call',
    description: 'Meet-day handling: warm-up timing, attempt selection, and what having a coach in your corner on the platform looks like.',
    durationMinutes: 30, priceCents: null, priceNote: null,
  },
  {
    id: 'demo-movement-consult', slug: 'movement-consult', name: 'Movement Consulting Session',
    description: 'A movement screen and technical review. Bring video of your competition lifts if you have it.',
    durationMinutes: 45, priceCents: null, priceNote: null,
  },
  {
    id: 'demo-coach-mentorship', slug: 'coach-mentorship', name: 'Coaching Mentorship Call',
    description: 'For coaches. Programming philosophy, athlete management, and building a practice — mentorship rather than training.',
    durationMinutes: 45, priceCents: null, priceNote: null,
  },
]
