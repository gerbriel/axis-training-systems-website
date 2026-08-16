import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import AvailabilityManager from '../../coach-admin/AvailabilityManager'
import CoachProfilesManager from '../CoachProfilesManager'
import { COACHES, getCoachBySlug } from '../../../data/coaches'
import { fetchCoachRoster } from '../../../lib/coachRoster'
import type { RosterCoach } from '../../../lib/coachRoster'
import type { CoachDisplay } from '../../../lib/coachProfiles'
import { ACCENT, SettingsSection } from './_shared'

/**
 * Set Availability — when each coach works, and who they are on the public site.
 *
 * This was a rail entry of its own in the admin portal, sitting under Setup
 * beside Invitations and Settings. It is scheduling setup, which is what the
 * Scheduling and Services tabs beside it here already are, so it moved in
 * rather than keeping a top-level slot for two hosted components. Its hash is
 * `#availability`, so `?tab=settings#availability` opens straight onto it.
 *
 * The panel itself owns nothing but the picker: `AvailabilityManager` holds the
 * weekly schedule, the blocked days and the booking policy, and
 * `CoachProfilesManager` holds the public page. Both are mounted unchanged.
 * `AvailabilityManager` is also mounted by CoachAdmin for a coach's own hours,
 * so its props stay exactly as they were.
 */

/**
 * The roster the picker starts with.
 *
 * The bundled five, so the row of buttons paints on the first frame exactly as
 * it always has. The database answer replaces it a moment later and adds
 * anybody provisioned since.
 */
const STATIC_ROSTER: RosterCoach[] = COACHES.map(c => ({
  slug: c.slug, name: c.name, firstName: c.firstName, roleTitle: c.role,
  photo: c.photo ?? null, email: c.email, bookable: true, source: 'static' as const,
}))

/**
 * A roster row as the shape AvailabilityManager takes.
 *
 * The static entry when there is one, so the five keep their full copy, and
 * otherwise the little the roster knows. The panel and the two it hosts read
 * `slug` and nothing else, which is why the thin version is enough.
 */
function asDisplay(c: RosterCoach): CoachDisplay {
  const staticCoach = getCoachBySlug(c.slug)
  if (staticCoach) return staticCoach
  return {
    slug: c.slug, name: c.name, firstName: c.firstName,
    email: c.email ?? '', photo: c.photo ?? undefined,
    role: c.roleTitle ?? '', tagline: '', bio: [], coachingPhilosophy: '',
    specialties: [], services: [], stats: [], testimonials: [],
  }
}

/**
 * `pageStyle`'s 2rem gutter without its 760px clamp.
 *
 * That clamp is sized for a column of form fields. The two components below
 * set their own widths (760 for the schedule, 900 for the profile list) and the
 * week grid needs every pixel of it, so this page keeps the gutter and lets
 * them decide how wide they are.
 */
const rootStyle: CSSProperties = { padding: '2rem' }

/**
 * AvailabilityManager and CoachProfilesManager both self-pad with `.dash-pad`,
 * because both were written for the portal's `<main class="dash-main">` slot
 * where the panel pays for its own gutter. This page already pays it, so
 * without this the two would land 4rem in from the rail. The negative margin
 * cancels the outer inset for their subtree and puts them on the same gridline
 * as the picker above.
 *
 * The top cancels SettingsSection's own 2.5rem trailing margin and nothing
 * more, so the wrapper cannot creep up over the picker buttons and swallow
 * their clicks.
 */
const UNPAD: CSSProperties = { margin: '-2.5rem -2rem -2rem' }

export default function AvailabilityPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [availCoach, setAvailCoach] = useState<string>(COACHES[0].slug)
  const [roster, setRoster] = useState<RosterCoach[]>(STATIC_ROSTER)

  // Every coach, bookable or not: setting somebody's hours is how a new coach
  // BECOMES bookable, so the one picker that must not be filtered is this one.
  // An empty answer keeps the bundled five rather than blanking the row.
  useEffect(() => {
    let live = true
    fetchCoachRoster(isDemo, { includeHidden: true })
      .then(list => { if (live && list.length > 0) setRoster(list) })
      .catch(() => { /* keep the static roster */ })
    return () => { live = false }
  }, [isDemo])

  return (
    <div style={rootStyle}>
      <SettingsSection
        title="Set Availability"
        intro="Pick a coach, then set the hours they work, block out the days they do not, and keep their public page current. Every coach on the roster is listed, bookable or not, because giving somebody hours is how a new coach becomes bookable in the first place."
      >
        <div role="group" aria-label="Coach" style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {roster.map(c => {
            const active = availCoach === c.slug
            return (
              <button
                key={c.slug}
                aria-pressed={active}
                onClick={() => setAvailCoach(c.slug)}
                style={{
                  background: active ? ACCENT : 'var(--surface)',
                  border: `1px solid ${active ? ACCENT : 'var(--border)'}`,
                  color: active ? '#fff' : 'var(--text-3)',
                  borderRadius: '.3rem', padding: '.6rem 1.1rem', minHeight: '2.5rem',
                  fontSize: '.7rem', fontWeight: 700, letterSpacing: '.1em',
                  textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {c.firstName}
              </button>
            )
          })}
        </div>
      </SettingsSection>

      <div style={UNPAD}>
        {/* No non-null assertion: the roster is loaded, not compiled in, and a
            coach hidden between two renders would have crashed the whole tab.
            Falling back to the first row keeps the panel on screen instead.

            The key is load-bearing: AvailabilityManager fetches on mount, so
            switching coach has to remount it or the hours on screen stay the
            previous coach's. */}
        <AvailabilityManager
          key={availCoach}
          coach={asDisplay(roster.find(c => c.slug === availCoach) ?? roster[0] ?? STATIC_ROSTER[0])}
          isDemo={isDemo}
        />
        {/* Who a coach is on the public site, below when they work.
            CoachProfilesManager pads itself too, so it mounts bare. */}
        <CoachProfilesManager isDemo={isDemo} />
      </div>
    </div>
  )
}
