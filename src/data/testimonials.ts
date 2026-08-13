import { COACHES } from './coaches'

/**
 * Main-page placement state.
 *
 *   none      — coach never asked for the homepage
 *   pending   — coach requested it; waiting on the head coach
 *   approved  — head coach said yes; renders on the homepage
 *   rejected  — head coach said no (rejectionNote explains why)
 *
 * A coach can only ever move this to 'none' or 'pending'. The DB trigger
 * guard_testimonial_main_status() enforces that (see migration 004).
 */
export type MainStatus = 'none' | 'pending' | 'approved' | 'rejected'

export interface Testimonial {
  id: string
  coachSlug: string
  coachName: string

  quote: string
  athlete: string
  result: string
  photo?: string

  /** Renders on /coaches/<slug>. The coach controls this outright — no approval. */
  showOnCoach: boolean
  mainStatus: MainStatus
  rejectionNote?: string

  createdAt: string
  reviewedAt?: string
}

/** Athlete photos must come from a host allowed by the CSP img-src in index.html. */
export const ALLOWED_PHOTO_HOSTS = [
  'static.wixstatic.com',
  'i.imgur.com',
  'googleusercontent.com',
  'fbcdn.net',
]

export function isAllowedPhotoUrl(url: string): boolean {
  if (!url.trim()) return true // optional — empty is fine
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol !== 'https:') return false
    return ALLOWED_PHOTO_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

/**
 * Demo / fallback seed, derived from the static arrays in coaches.ts.
 *
 * This is what the site renders when Supabase env vars are absent — which is the
 * case for the GitHub Pages build. Without it, that deploy would show zero
 * testimonials. It also seeds the in-memory demo store used by the portal.
 *
 * Ordering mirrors migration 004's seed so demo mode and the DB agree: within a
 * coach, index 0 is newest; the 3 the homepage featured before this change are
 * pre-approved for the main page.
 */
const FEATURED_ON_MAIN = new Set(['ronnie-vallejo:0', 'lucas-sison:1', 'ronnie-vallejo:1'])
const SEED_BASE = Date.UTC(2026, 0, 10)
const HOUR = 3_600_000
const DAY  = 86_400_000

export const SEED_TESTIMONIALS: Testimonial[] = COACHES.flatMap((coach, ci) =>
  coach.testimonials.map((t, ti): Testimonial => ({
    id:          `seed-${coach.slug}-${ti}`,
    coachSlug:   coach.slug,
    coachName:   coach.name,
    quote:       t.quote,
    athlete:     t.athlete,
    result:      t.result,
    photo:       t.photo,
    showOnCoach: true,
    mainStatus:  FEATURED_ON_MAIN.has(`${coach.slug}:${ti}`) ? 'approved' : 'none',
    createdAt:   new Date(SEED_BASE + ci * HOUR - ti * DAY).toISOString(),
  })),
)
