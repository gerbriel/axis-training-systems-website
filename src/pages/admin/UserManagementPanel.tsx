import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../../context/AuthContext'
import type { Profile, ProfileStatus, UserRole } from '../../lib/account'
import {
  fetchPeople, updateStatus, updateRole, hasPermission,
  roleChangeRefusal, statusChangeRefusal, countActiveAdmins,
  sortPeople, matchesSearch, personName, personInitials, waitingFor, fmtDate,
  ROLE_LABELS, STATUS_LABELS, STATUS_COLORS, ROLE_COLORS, COACH_SLUG_PATTERN,
} from '../../lib/userManagement'
import { fetchCoachAssignments, setCoachAssignment } from '../../lib/messagingApi'
import { fetchCoachDirectory, provisionCoach, updateCoachRoutingEmail } from '../../lib/coachRoster'
import type { CoachDirectoryEntry } from '../../lib/coachRoster'
import { sendInvitation, revokeInvitation } from '../../lib/invitations'
import { usePermissions } from '../../lib/usePermissions'
import { DEFAULT_TIME_ZONE } from '../../lib/availability'
import { useMediaQuery, MOBILE_QUERY } from '../../lib/dashboard'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { COACHES } from '../../data/coaches'
import PermissionsEditor from './PermissionsEditor'

const ACCENT = '#272C84'
const PENDING = '#eab308'
const DANGER = '#c8102e'

const ROLES: UserRole[] = ['athlete', 'coach', 'admin']
const STATUSES: ProfileStatus[] = ['pending', 'active', 'suspended']

/** Which button is armed. Two taps for anything that changes what a person can do. */
type Armed = { id: string; action: 'approve' | 'decline' | 'suspend' | 'reinstate' } | null

// ── Adding a coach ───────────────────────────────────────────────────────────

/** `provision_coach` (036) enforces the same shape. This is the sign in front of it. */
const SLUG_MAX = 64

/** Deliberately loose. The address is checked for real by the invitation, not here. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const slugify = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * Zones for the new-coach form. `Intl.supportedValuesOf` is the real list on
 * every engine we support; the short list is a fallback so an older browser
 * still gets a working select rather than an empty one. A coach changes this
 * later from their own calendar screen, so the default is what matters most.
 */
const FALLBACK_ZONES = [
  'America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago',
  'America/New_York', 'America/Anchorage', 'Pacific/Honolulu', 'UTC',
]

function timeZoneOptions(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  if (typeof supported === 'function') {
    try {
      const zones = supported('timeZone')
      if (zones.length > 0) return zones
    } catch {
      // Older engine. Fall through to the static list.
    }
  }
  return FALLBACK_ZONES
}

const ZONES = timeZoneOptions()

interface CoachDraft {
  name: string
  firstName: string
  email: string
  slug: string
  roleTitle: string
  timeZone: string
}

const blankCoach = (): CoachDraft => ({
  name: '', firstName: '', email: '', slug: '', roleTitle: '', timeZone: DEFAULT_TIME_ZONE,
})

/**
 * What is still missing before this coach is a working coach.
 *
 * Four registries have to agree before somebody can be booked, routed a lead,
 * found on the website and signed in: `coach_routing`, `coach_public_settings`,
 * `coach_profiles` and a `profiles` row carrying the slug. `provision_coach`
 * creates the first three in one go, so a gap here means either an older coach
 * who predates it or a piece somebody removed by hand. Each chip says which.
 *
 * The fourth chip is a different kind of gap and is worded like one. A missing
 * Google Calendar connection breaks NOTHING: the booking goes through, the time
 * is held, the emails are sent. What it costs is the video link, because a Meet
 * link is only ever minted when the booking is written to a real calendar. It is
 * also the only gap on this list the admin cannot close themselves, which is why
 * its hint says where the coach goes rather than where the admin does.
 *
 * `calendarConnected === false` and nothing else. A null there means the
 * connection could not be read, and an outage must not print an accusation.
 */
function wiringGaps(entry: CoachDirectoryEntry): { label: string; hint: string }[] {
  const gaps: { label: string; hint: string }[] = []
  if (!entry.hasPublicProfile) {
    gaps.push({
      label: 'No public profile',
      hint: 'Their page starts hidden. Fill out their profile under Set Availability, then show it.',
    })
  }
  if (!entry.hasBookingSettings) {
    gaps.push({
      label: 'Not bookable',
      hint: 'Booking turns everyone away until this coach has booking settings. A coach added here gets them automatically.',
    })
  }
  if (!entry.hasRouting) {
    gaps.push({
      label: 'No lead routing',
      hint: 'New leads and booking notices will not reach them until they are on the routing list.',
    })
  }
  if (entry.hasBookingSettings && entry.calendarConnected === false) {
    gaps.push({
      label: 'No Google Calendar',
      hint: 'Bookings with them go through, but without a Google Meet link. They connect their calendar from their portal under Set Availability.',
    })
  }
  return gaps
}

const microLabel: React.CSSProperties = {
  color: 'var(--text)', fontSize: '.6rem', fontWeight: 900,
  letterSpacing: '.3em', textTransform: 'uppercase',
}

const heading: React.CSSProperties = {
  color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem',
  textTransform: 'uppercase', letterSpacing: '-.01em',
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ background: `${color}18`, border: `1px solid ${color}`, color, fontSize: '.55rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.2rem .55rem', borderRadius: '.2rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {text}
    </span>
  )
}

function Avatar({ person }: { person: Profile }) {
  return (
    <div
      aria-hidden
      style={{
        width: 34, height: 34, flexShrink: 0, borderRadius: '50%',
        background: 'var(--surface-2)', border: '1px solid var(--border-mid)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-3)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.05em',
      }}
    >
      {personInitials(person)}
    </div>
  )
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.7rem 1rem' }}>
      <span style={{ color: DANGER, fontSize: '.8rem', lineHeight: 1.6 }}>{message}</span>
    </div>
  )
}

/**
 * Who this athlete may message.
 *
 * `athlete_coaches` is not a label on a relationship that already exists, it IS
 * the relationship: `can_message` reads it, so an athlete with nobody assigned
 * has an empty contact list and a coach cannot open a thread with them either.
 *
 * The database validates both ends (the athlete must be an athlete, the coach
 * must be active staff) and every refusal arrives here as its own sentence.
 */
function AssignedCoaches({ athlete, staff, isDemo, readOnly = false }: { athlete: Profile; staff: Profile[]; isDemo: boolean; readOnly?: boolean }) {
  const [assigned, setAssigned] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    void fetchCoachAssignments(isDemo).then(rows => {
      if (!live) return
      if (rows === null) { setOutage(true); setAssigned([]) }
      else {
        setOutage(false)
        setAssigned(rows.filter(r => r.athlete_id === athlete.id).map(r => r.coach_id))
      }
      setLoading(false)
    })
    return () => { live = false }
  }, [athlete.id, isDemo])

  const toggle = async (coachId: string) => {
    const next = !assigned.includes(coachId)
    setError(null)
    setBusyId(coachId)
    const res = await setCoachAssignment(athlete.id, coachId, next, isDemo)
    setBusyId(null)
    if (!res.ok) { setError(res.message); return }
    setAssigned(list => next ? [...list, coachId] : list.filter(id => id !== coachId))
  }

  return (
    <div style={{ borderTop: '1px solid var(--surface-2)', paddingTop: '1.25rem' }}>
      <p style={{ ...microLabel, marginBottom: '.4rem' }}>Assigned coaches</p>
      <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.6, marginBottom: '.75rem' }}>
        Who this athlete can message. They only see the coaches assigned to them.
      </p>

      {error && <div style={{ marginBottom: '.75rem' }}><ErrorNote message={error} /></div>}

      {loading ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
      ) : outage ? (
        <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.6 }}>
          We could not load the assignments. Nothing has been changed.
        </p>
      ) : readOnly ? (
        // Who may SEE an assignment and who may CHANGE one are different
        // questions: this block reaches anyone the Users entry admits, which
        // since the portal went permission-gated includes a head coach holding
        // only manage_permissions. The write is manage_athletes/admin territory
        // (023), so without the staff gate the chips render as facts, not
        // switches.
        assigned.length === 0 ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.78rem' }}>No coaches are assigned yet.</p>
        ) : (
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            {staff.filter(c => assigned.includes(c.id)).map(coach => (
              <span
                key={coach.id}
                style={{
                  background: `${ACCENT}22`, border: `1px solid ${ACCENT}`, color: 'var(--text)',
                  fontSize: '.62rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                  padding: '.5rem .8rem', borderRadius: '.25rem', whiteSpace: 'nowrap',
                }}
              >
                {personName(coach)}
              </span>
            ))}
          </div>
        )
      ) : staff.length === 0 ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.78rem' }}>There are no active coaches to assign yet.</p>
      ) : (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {staff.map(coach => {
            const on = assigned.includes(coach.id)
            const busy = busyId === coach.id
            return (
              <button
                key={coach.id}
                onClick={() => void toggle(coach.id)}
                disabled={busy}
                aria-pressed={on}
                style={{
                  background: on ? `${ACCENT}22` : 'transparent',
                  border: `1px solid ${on ? ACCENT : 'var(--border)'}`,
                  color: on ? 'var(--text)' : 'var(--text-4)',
                  fontSize: '.62rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                  padding: '.5rem .8rem', minHeight: '2.5rem', borderRadius: '.25rem',
                  cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
                  opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap',
                }}
              >
                {on ? '✓ ' : ''}{personName(coach)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Everybody with an account, and the one decision that matters most.
 *
 * An invite-gated site has a state a session cannot express: signed in, with a
 * real token, and allowed to see nothing. `handle_new_user` (011) parks every
 * new account at `pending` and NOTHING moves it but a person on this screen —
 * which is why the approval queue sits above the directory rather than behind a
 * filter chip. Someone waiting on a human is the most time-sensitive thing an
 * admin can be shown, and a list sorted by "newest" buries them the week after.
 *
 * Two kinds of write live here on purpose. Approving, declining, suspending and
 * reinstating are OPTIMISTIC: one column, one obvious outcome, and the row
 * snaps back with a sentence if the database disagrees. Changing a role is
 * CHOOSE-THEN-SAVE, because a role and a coach page are one decision written to
 * two columns, and half of it is worse than none of it.
 *
 * Every guard on this screen is SIGNAGE. `profiles_guard_privileges` (011)
 * clamps role, status and coach_slug for anyone who is not an active admin, and
 * that trigger is what actually stops a hostile client. The refusals here exist
 * so a head coach reads a sentence instead of walking into a wall.
 */
export default function UserManagementPanel({ isDemo = false }: { isDemo?: boolean }) {
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const { profile, isAdmin } = useAuth()
  const { can, granted, ready: permsReady } = usePermissions()

  // Demo mode has no session at all, so the seeded head coach stands in as the
  // person making the change — otherwise every demo grant is stamped by nobody.
  const viewerId = isDemo ? 'demo-ronnie' : (profile?.id ?? null)

  // Memoised because the permissions editor recomputes its rows from it. A
  // fresh object every render would rebuild forty rows on every keystroke in
  // the search box.
  //
  // `holds` is the viewer's OWN effective set, which the editor needs for
  // `can_grant_permission`'s "you may only pass on what you hold" rule. Left
  // undefined for an admin (who holds everything), for demo, and until the set
  // is known — undefined means "do not lock", so a slow read never greys out a
  // row somebody is entitled to use.
  const viewer = useMemo(
    () => ({
      id: viewerId,
      isAdmin: isDemo ? true : isAdmin,
      holds: isDemo || isAdmin || !permsReady || granted.has('*') ? undefined : granted,
    }),
    [viewerId, isDemo, isAdmin, permsReady, granted]
  )

  const [people, setPeople] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProfileStatus | 'all'>('all')
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [armed, setArmed] = useState<Armed>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [queueError, setQueueError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  // Role drafting, per the LeadDetail pattern: nothing is applied until saved.
  const [roleDraft, setRoleDraft] = useState<UserRole>('athlete')
  const [slugDraft, setSlugDraft] = useState('')
  const [savingRole, setSavingRole] = useState(false)
  const [roleSaved, setRoleSaved] = useState(false)

  // May the signed-in person edit permissions? Asked of the database, which is
  // the only thing that knows — but a null answer (014 not applied, token
  // expired, outage) falls back to the role we already have rather than hiding
  // the editor from the one person who needs it.
  const [canManagePermissions, setCanManagePermissions] = useState(true)

  // ── Coaches ────────────────────────────────────────────────────────────────
  // A separate registry from the one above. `profiles` says who has an account;
  // the coach directory says who has a CALENDAR, and the two only meet once an
  // invitation is claimed. Everything in this block is about that gap.
  //
  // This also decides whether the account controls in the detail drawer are
  // drawn at all: approving, suspending and role changes are 011's
  // `admin writes profiles`, which a head coach here on manage_permissions
  // alone does not pass.
  const canManageCoaches = isDemo || isAdmin || can('manage_staff')

  // Narrower than the section itself, and deliberately. 017's
  // `coach_routing_admin_write` is an ADMIN-only policy, so a coach holding
  // manage_staff would get a write that changes nothing rather than a refusal.
  // The database still has the last word; this only keeps a control off a screen
  // where it could not work.
  const canEditRouting = isDemo || isAdmin

  const [coaches, setCoaches] = useState<CoachDirectoryEntry[]>([])
  const [coachesLoading, setCoachesLoading] = useState(true)
  const [coachesOutage, setCoachesOutage] = useState(false)
  const [coachError, setCoachError] = useState<string | null>(null)

  const [armedInvite, setArmedInvite] = useState<string | null>(null)   // slug
  const [armedRevoke, setArmedRevoke] = useState<number | null>(null)   // invitation id
  const [coachBusy, setCoachBusy] = useState<string | null>(null)       // slug being written
  const [issued, setIssued] = useState<{ slug: string; link: string; emailed: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  // The routing address, edited in place. One row at a time: this is a
  // credential as much as a mailbox, and two half-typed addresses on one screen
  // is a way to save the wrong one.
  const [emailEdit, setEmailEdit] = useState<
    { slug: string; routingId: string; value: string; error: string | null } | null
  >(null)
  const [savingEmail, setSavingEmail] = useState(false)

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<CoachDraft>(blankCoach)
  const [slugTouched, setSlugTouched] = useState(false)
  const [provisioning, setProvisioning] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [added, setAdded] = useState<{ slug: string; name: string; email: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await fetchPeople(isDemo)
    if (rows === null) { setOutage(true); setPeople([]) }
    else { setOutage(false); setPeople(rows) }
    setLoading(false)
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  const loadCoaches = useCallback(async () => {
    if (!canManageCoaches) return
    setCoachesLoading(true)
    const rows = await fetchCoachDirectory(isDemo)
    if (rows === null) { setCoachesOutage(true); setCoaches([]) }
    else { setCoachesOutage(false); setCoaches(rows) }
    setCoachesLoading(false)
  }, [isDemo, canManageCoaches])

  useEffect(() => { void loadCoaches() }, [loadCoaches])

  useEffect(() => {
    let live = true
    void hasPermission('manage_permissions', isDemo).then(answer => {
      if (live) setCanManagePermissions(answer ?? isAdmin)
    })
    return () => { live = false }
  }, [isDemo, isAdmin])

  const selected = useMemo(
    () => people.find(p => p.id === selectedId) ?? null,
    [people, selectedId]
  )

  // The drawer opens on a snapshot of the role. Re-seeding on every people
  // change would wipe a half-typed coach page name the moment a realtime update
  // or a refresh landed.
  useEffect(() => {
    const person = people.find(p => p.id === selectedId)
    if (!person) return
    setRoleDraft(person.role)
    setSlugDraft(person.coach_slug ?? '')
    setRoleSaved(false)
    setDetailError(null)
    setArmed(null)
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lock background scroll while the mobile detail overlay is open.
  useEffect(() => {
    if (!(isMobile && selected)) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isMobile, selected])

  const sorted = useMemo(() => sortPeople(people), [people])
  const pending = useMemo(() => sorted.filter(p => p.status === 'pending'), [sorted])

  // Everybody an athlete could be handed to. The list this panel already loads
  // is every profile on the site, so the coach picker below needs no fetch of
  // its own — and the database refuses anyone who is not active staff anyway.
  const assignableCoaches = useMemo(
    () => people
      .filter(p => p.role !== 'athlete' && p.status === 'active')
      .sort((a, b) => personName(a).localeCompare(personName(b))),
    [people]
  )

  const filtered = useMemo(() => sorted.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (roleFilter !== 'all' && p.role !== roleFilter) return false
    return matchesSearch(p, search)
  }), [sorted, statusFilter, roleFilter, search])

  const counts: Record<string, number> = { all: people.length }
  STATUSES.forEach(s => { counts[s] = people.filter(p => p.status === s).length })
  const activeAdmins = countActiveAdmins(people)

  /**
   * Optimistic-then-reconcile. The row changes on tap, and a refusal puts it
   * back exactly where it was with a sentence — no spinner in between, because
   * a status change is one column and the common case is that it works.
   */
  const changeStatus = async (person: Profile, next: ProfileStatus, surface: 'queue' | 'detail') => {
    const setError = surface === 'queue' ? setQueueError : setDetailError
    setError(null)
    setArmed(null)

    const refusal = statusChangeRefusal(person, next, people, viewerId)
    if (refusal) { setError(refusal); return }

    const previous = person.status
    setBusyId(person.id)
    setPeople(list => list.map(p => p.id === person.id ? { ...p, status: next } : p))

    const res = await updateStatus(person.id, next, isDemo)
    setBusyId(null)

    if (!res.ok) {
      setPeople(list => list.map(p => p.id === person.id ? { ...p, status: previous } : p))
      setError(res.message)
    }
  }

  const saveRole = async () => {
    if (!selected || savingRole) return
    setDetailError(null)

    const slug = slugDraft.trim().toLowerCase()
    const refusal = roleChangeRefusal(selected, roleDraft, roleDraft === 'athlete' ? null : (slug || null), people, viewerId)
    if (refusal) { setDetailError(refusal); return }

    setSavingRole(true)
    const res = await updateRole(selected.id, roleDraft, roleDraft === 'athlete' ? null : slug, isDemo)
    setSavingRole(false)

    if (!res.ok) { setDetailError(res.message); return }

    const nextSlug = roleDraft === 'athlete' ? null : (slug || null)
    setPeople(list => list.map(p => p.id === selected.id ? { ...p, role: roleDraft, coach_slug: nextSlug } : p))
    setSlugDraft(nextSlug ?? '')
    setRoleSaved(true)
  }

  const roleDirty = !!selected && (roleDraft !== selected.role || (roleDraft === 'athlete' ? false : slugDraft.trim().toLowerCase() !== (selected.coach_slug ?? '')))

  /**
   * The invitation is what turns a calendar into a person.
   *
   * `provision_coach` builds the routing, the booking settings and the hidden
   * public page, and none of that lets anybody sign in. Only a claimed
   * invitation writes `profiles.coach_slug`, which is the column every database
   * policy actually reads. So this is the second half of adding a coach, and
   * the row says "Not claimed" until it happens.
   */
  const sendInvite = async (target: { slug: string; name: string; email: string }) => {
    if (isDemo || coachBusy) return
    setCoachError(null)
    setArmedInvite(null)
    setAdded(null)
    setCoachBusy(target.slug)

    const res = await sendInvitation({
      email: target.email,
      role: 'coach',
      coachSlug: target.slug,
      firstName: target.name.trim().split(/\s+/)[0] || undefined,
    })

    setCoachBusy(null)
    if (!res.ok) { setCoachError(res.message); return }

    setIssued({ slug: target.slug, link: res.link, emailed: res.emailed })
    setCopied(false)
    await loadCoaches()
  }

  const revokeInvite = async (slug: string, invitationId: number) => {
    if (isDemo || !profile || coachBusy) return
    setCoachError(null)
    setArmedRevoke(null)
    setCoachBusy(slug)

    const ok = await revokeInvitation(invitationId, profile.id)
    setCoachBusy(null)
    if (!ok) { setCoachError('Could not revoke that invitation.'); return }

    if (issued?.slug === slug) setIssued(null)
    await loadCoaches()
  }

  /**
   * Save the routing address.
   *
   * Three things hang off this one column: where their leads and booking notices
   * go, where their invitation is sent, and which Google account may bind itself
   * to their calendar. The library checks the shape and the database has the
   * last word; a refusal that changed nothing comes back as a sentence rather
   * than as a silent success, which is what the `.select('id')` is for.
   */
  const saveRoutingEmail = async () => {
    if (!emailEdit || savingEmail) return

    setSavingEmail(true)
    const res = await updateCoachRoutingEmail(emailEdit.routingId, emailEdit.value, isDemo)
    setSavingEmail(false)

    if (!res.ok) {
      setEmailEdit(edit => (edit ? { ...edit, error: res.message } : edit))
      return
    }

    setEmailEdit(null)
    await loadCoaches()
  }

  /**
   * Every refusal here is also a refusal in the database. `provision_coach`
   * checks the slug shape, the collisions and the email itself, and this only
   * exists so somebody reads a sentence before a round trip rather than after.
   */
  const addCoach = async () => {
    if (provisioning) return

    const name = draft.name.trim()
    const email = draft.email.trim().toLowerCase()
    const slug = draft.slug.trim().toLowerCase()

    if (!name) { setAddError('A name is required.'); return }
    if (!EMAIL_SHAPE.test(email)) { setAddError('That does not look like an email address.'); return }
    if (!COACH_SLUG_PATTERN.test(slug) || slug.length > SLUG_MAX) {
      setAddError(`The link name needs lowercase letters, numbers and dashes, and no more than ${SLUG_MAX} characters.`)
      return
    }
    const clash = coaches.find(c => c.slug === slug)
    if (clash) { setAddError(`That link name already belongs to ${clash.name}. Pick another one.`); return }

    setProvisioning(true)
    setAddError(null)

    const res = await provisionCoach({
      slug,
      name,
      firstName: draft.firstName.trim() || undefined,
      email,
      roleTitle: draft.roleTitle.trim() || undefined,
      timeZone: draft.timeZone,
    }, isDemo)

    setProvisioning(false)
    if (!res.ok) { setAddError(res.message); return }

    setAdding(false)
    setDraft(blankCoach())
    setSlugTouched(false)
    setIssued(null)
    setCoachError(null)
    setAdded({ slug, name, email })
    await loadCoaches()
  }

  /**
   * Two-tap confirm, shared by the queue and the drawer. Nothing that changes
   * what a person can do happens on a single tap — including Approve, which is
   * not destructive but is the moment a stranger becomes a member.
   */
  const confirmRow = (
    person: Profile,
    question: string,
    confirmLabel: string,
    confirmColor: string,
    next: ProfileStatus,
    surface: 'queue' | 'detail'
  ) => (
    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--text-2)', fontSize: '.75rem', fontWeight: 600 }}>{question}</span>
      <button
        onClick={() => void changeStatus(person, next, surface)}
        disabled={busyId === person.id}
        style={{ background: confirmColor, border: 'none', color: '#ffffff', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit', opacity: busyId === person.id ? 0.6 : 1 }}
      >
        {busyId === person.id ? 'Saving…' : confirmLabel}
      </button>
      <button
        onClick={() => setArmed(null)}
        style={{ background: 'transparent', border: '1px solid var(--surface-2)', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        Cancel
      </button>
    </div>
  )

  const isArmed = (id: string, action: NonNullable<Armed>['action']) => armed?.id === id && armed.action === action

  // ── The approval queue ─────────────────────────────────────────────────────
  const queue = (
    <section style={{ marginBottom: '2.25rem' }}>
      <p style={{ ...microLabel, marginBottom: '.4rem' }}>Waiting on you</p>
      <h2 style={{ ...heading, marginBottom: '.6rem' }}>
        {pending.length === 0 ? 'Nobody is waiting' : `${pending.length} ${pending.length === 1 ? 'account' : 'accounts'} to approve`}
      </h2>
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.65, marginBottom: '1.1rem', maxWidth: 560 }}>
        Anyone can create an account. Nobody gets in until you say so — a pending account can sign in and
        see nothing at all. Approving is the whole gate.
      </p>

      {queueError && <div style={{ marginBottom: '1rem' }}><ErrorNote message={queueError} /></div>}

      {pending.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>The queue is clear.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {pending.map(person => (
            <div
              key={person.id}
              style={{
                background: 'var(--surface)',
                border: `1px solid ${PENDING}55`,
                borderLeft: `3px solid ${PENDING}`,
                borderRadius: '.25rem', padding: '.9rem 1.1rem',
                display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap',
              }}
            >
              <Avatar person={person} />
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.2rem' }}>
                  <button
                    onClick={() => setSelectedId(person.id)}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text)', fontWeight: 700, fontSize: '.88rem', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                  >
                    {personName(person)}
                  </button>
                  <Badge text={ROLE_LABELS[person.role]} color={ROLE_COLORS[person.role]} />
                </div>
                <p style={{ color: 'var(--text-4)', fontSize: '.72rem', wordBreak: 'break-all' }}>
                  {person.email} · signed up {waitingFor(person.created_at)}
                </p>
              </div>

              {isArmed(person.id, 'approve')
                ? confirmRow(person, 'Let them in?', 'Approve', '#22c55e', 'active', 'queue')
                : isArmed(person.id, 'decline')
                  ? confirmRow(person, 'Turn them away?', 'Decline', DANGER, 'suspended', 'queue')
                  : (
                    <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setArmed({ id: person.id, action: 'approve' })}
                        style={{ background: '#22c55e', border: 'none', color: '#04240f', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1.4rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => setArmed({ id: person.id, action: 'decline' })}
                        style={{ background: 'none', border: `1px solid ${DANGER}`, color: DANGER, fontSize: '.62rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Decline
                      </button>
                    </div>
                  )}
            </div>
          ))}
        </div>
      )}
    </section>
  )

  // ── Coaches ────────────────────────────────────────────────────────────────

  /**
   * The link, once. Only the SHA-256 of a token reaches the database, so there
   * is no query that produces this value later. Same block, same warning, as
   * the invitations panel, because it is the same one-shot secret.
   */
  const issuedBlock = (link: string, emailed: boolean) => (
    <div style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.35)', borderRadius: '.25rem', padding: '1rem' }}>
      <p style={{ color: '#22c55e', fontSize: '.82rem', fontWeight: 700, marginBottom: '.5rem' }}>
        {emailed ? 'Invitation sent.' : 'Invitation created, but the email did not go out.'}
      </p>
      <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.6, marginBottom: '.75rem' }}>
        {emailed
          ? 'They can also use this link. It is shown once and cannot be retrieved later. Sending a new invitation replaces it.'
          : 'Send them this link yourself. It is shown once and cannot be retrieved later.'}
      </p>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <code style={{ flex: 1, minWidth: 200, background: 'var(--bg)', border: '1px solid var(--surface-2)', borderRadius: '.2rem', padding: '.5rem .6rem', color: 'var(--text-2)', fontSize: '.72rem', wordBreak: 'break-all' }}>
          {link}
        </code>
        <button
          onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)) }}
          style={{ background: ACCENT, border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '.62rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onClick={() => setIssued(null)}
          style={{ background: 'transparent', border: '1px solid var(--surface-2)', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.6rem 1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Done
        </button>
      </div>
    </div>
  )

  const hintLine: React.CSSProperties = {
    color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.4rem', lineHeight: 1.55,
  }

  const addForm = (
    <div style={{ background: 'var(--surface)', border: `1px solid ${ACCENT}55`, borderLeft: `3px solid ${ACCENT}`, borderRadius: '.25rem', padding: '1.1rem', marginBottom: '.75rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <p style={{ ...microLabel, marginBottom: '.4rem' }}>New coach</p>
        <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.6, maxWidth: 520 }}>
          This creates their calendar, their booking settings and a public page. It does not create a login:
          invite them once they are on the list.
        </p>
      </div>

      {addError && <ErrorNote message={addError} />}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: '1rem' }}>
        <div>
          <label className="field-label" htmlFor="um-coach-name">Name *</label>
          <input
            id="um-coach-name" className="field" maxLength={120} value={draft.name}
            placeholder="Ronnie Vallejo"
            onChange={e => {
              const next = e.target.value
              setAddError(null)
              setDraft(d => ({ ...d, name: next, slug: slugTouched ? d.slug : slugify(next) }))
            }}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="um-coach-first">First name</label>
          <input
            id="um-coach-first" className="field" maxLength={80} value={draft.firstName}
            placeholder="Ronnie"
            onChange={e => setDraft(d => ({ ...d, firstName: e.target.value }))}
          />
          <p style={hintLine}>Used in lines like &ldquo;Work With Ronnie&rdquo;.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
        <div>
          <label className="field-label" htmlFor="um-coach-email">Email *</label>
          <input
            id="um-coach-email" className="field" type="email" maxLength={254} value={draft.email}
            placeholder="ronnie@axistrainingsystems.com"
            onChange={e => { setAddError(null); setDraft(d => ({ ...d, email: e.target.value })) }}
          />
          <p style={hintLine}>Where leads and booking notices go, and the address their invitation is sent to.</p>
        </div>
        <div>
          <label className="field-label" htmlFor="um-coach-slug">Link name *</label>
          <input
            id="um-coach-slug" className="field" maxLength={SLUG_MAX} value={draft.slug}
            placeholder="ronnie-vallejo"
            onChange={e => {
              setAddError(null)
              setSlugTouched(true)
              setDraft(d => ({ ...d, slug: slugify(e.target.value) }))
            }}
          />
          <p style={hintLine}>
            The public address and the booking routing both point at this, for example /coaches/ronnie-vallejo.
            Lowercase letters, numbers and dashes. It cannot be changed later.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
        <div>
          <label className="field-label" htmlFor="um-coach-title">Role title</label>
          <input
            id="um-coach-title" className="field" maxLength={120} value={draft.roleTitle}
            placeholder="Strength Coach"
            onChange={e => setDraft(d => ({ ...d, roleTitle: e.target.value }))}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="um-coach-tz">Time zone</label>
          <select
            id="um-coach-tz" className="field" value={draft.timeZone}
            onChange={e => setDraft(d => ({ ...d, timeZone: e.target.value }))}
          >
            {ZONES.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
          <p style={hintLine}>They set their own hours after claiming their account. This only says which clock those hours are read in.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => void addCoach()}
          disabled={provisioning}
          style={{ background: provisioning ? 'var(--border-mid)' : ACCENT, border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.7rem 1.4rem', minHeight: '2.5rem', borderRadius: '.25rem', cursor: provisioning ? 'default' : 'pointer', fontFamily: 'inherit' }}
        >
          {provisioning ? 'Adding…' : 'Add coach'}
        </button>
        <button
          onClick={() => { setAdding(false); setAddError(null) }}
          style={{ background: 'transparent', border: '1px solid var(--surface-2)', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.7rem 1.2rem', minHeight: '2.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )

  /** Provisioning and inviting are two halves of one job, so the second half is offered on the spot. */
  const addedBlock = added && (
    <div style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.35)', borderRadius: '.25rem', padding: '1rem', marginBottom: '.75rem' }}>
      <p style={{ color: '#22c55e', fontSize: '.82rem', fontWeight: 700, marginBottom: '.5rem' }}>
        {added.name} is on the roster.
      </p>
      <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.6, marginBottom: '.85rem', maxWidth: 540 }}>
        Their page starts hidden. Fill out their profile under Set Availability, then show it.
        They set their own hours after claiming their account.
      </p>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-2)', fontSize: '.75rem', fontWeight: 600 }}>Send their invitation now?</span>
        <button
          onClick={() => void sendInvite(added)}
          disabled={isDemo || coachBusy === added.slug}
          style={{ background: isDemo ? 'var(--surface-2)' : ACCENT, border: 'none', color: isDemo ? 'var(--text-4)' : '#ffffff', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: isDemo ? 'default' : 'pointer', fontFamily: 'inherit', opacity: coachBusy === added.slug ? 0.6 : 1 }}
        >
          {coachBusy === added.slug ? 'Sending…' : 'Send invitation'}
        </button>
        <button
          onClick={() => setAdded(null)}
          style={{ background: 'transparent', border: '1px solid var(--surface-2)', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Not now
        </button>
      </div>
    </div>
  )

  const coachRow = (entry: CoachDirectoryEntry) => {
    const invite = entry.invitation && entry.invitation.state === 'pending' ? entry.invitation : null
    // An invitation is immutable and redeemable only at the address it was
    // sent to. Once the routing email is corrected, a live invitation to the
    // OLD address must not render as though it covers the new one: the row
    // says which inbox actually holds the link, and offers a fresh send.
    const rowAddress = (entry.account?.email ?? entry.email)?.toLowerCase() ?? null
    const staleInvite = !!invite && !!rowAddress && invite.email.toLowerCase() !== rowAddress
    const gaps = wiringGaps(entry)
    const busy = coachBusy === entry.slug
    const email = entry.account?.email ?? entry.email

    // The address being edited is the ROUTING one, which is not always the one
    // printed above it: a claimed coach shows the address on their account, and
    // the two are separate columns in separate tables. Only a coach with a
    // routing row has anything to edit.
    const editing = emailEdit?.slug === entry.slug ? emailEdit : null
    const routingId = entry.routingId
    const canEditEmail = canEditRouting && routingId !== null

    const actions = isDemo || entry.account ? null
      : invite && (!staleInvite || armedRevoke === invite.id) ? (
        armedRevoke === invite.id ? (
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-2)', fontSize: '.75rem', fontWeight: 600 }}>Cancel their invitation?</span>
            <button
              onClick={() => void revokeInvite(entry.slug, invite.id)}
              disabled={busy}
              style={{ background: DANGER, border: 'none', color: '#ffffff', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Revoking…' : 'Revoke'}
            </button>
            <button
              onClick={() => setArmedRevoke(null)}
              style={{ background: 'transparent', border: '1px solid var(--surface-2)', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setArmedInvite(null); setArmedRevoke(invite.id) }}
            style={{ background: 'transparent', border: '1px solid var(--surface-2)', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
          >
            Revoke invite
          </button>
        )
      ) : email ? (
        armedInvite === entry.slug ? (
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-2)', fontSize: '.75rem', fontWeight: 600 }}>Email {entry.name} a way in?</span>
            <button
              onClick={() => void sendInvite({ slug: entry.slug, name: entry.name, email })}
              disabled={busy}
              style={{ background: ACCENT, border: 'none', color: '#ffffff', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Sending…' : 'Send invitation'}
            </button>
            <button
              onClick={() => setArmedInvite(null)}
              style={{ background: 'transparent', border: '1px solid var(--surface-2)', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => { setArmedRevoke(null); setArmedInvite(entry.slug) }}
              style={{ background: ACCENT, border: 'none', color: '#ffffff', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1.2rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
            >
              Send invite
            </button>
            {staleInvite && invite && (
              <button
                onClick={() => { setArmedInvite(null); setArmedRevoke(invite.id) }}
                style={{ background: 'transparent', border: '1px solid var(--surface-2)', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
              >
                Revoke old invite
              </button>
            )}
          </div>
        )
      ) : null

    return (
      <div
        key={entry.slug}
        style={{
          background: 'var(--surface)', border: '1px solid var(--surface-2)',
          borderRadius: '.25rem', padding: '.9rem 1.1rem',
          display: 'flex', flexDirection: 'column', gap: '.5rem',
        }}
      >
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.25rem' }}>
              <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.88rem' }}>{entry.name}</span>
              {entry.account
                ? <Badge text={STATUS_LABELS[entry.account.status]} color={STATUS_COLORS[entry.account.status]} />
                : <Badge text="Not claimed" color="var(--text-4)" />}
              {gaps.map(g => <Badge key={g.label} text={g.label} color={PENDING} />)}
            </div>
            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem', marginTop: '.15rem' }}>
                <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-4)', fontSize: '.72rem', fontFamily: 'monospace', flexShrink: 0 }}>
                    /{entry.slug}
                  </span>
                  <input
                    className="field"
                    type="email"
                    maxLength={254}
                    autoFocus
                    aria-label={`Routing email for ${entry.name}`}
                    value={editing.value}
                    onChange={e => {
                      const next = e.target.value
                      setEmailEdit(edit => (edit ? { ...edit, value: next, error: null } : edit))
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); void saveRoutingEmail() }
                      if (e.key === 'Escape') setEmailEdit(null)
                    }}
                    style={{ flex: 1, minWidth: 200, maxWidth: 340 }}
                  />
                  <button
                    onClick={() => void saveRoutingEmail()}
                    disabled={savingEmail}
                    style={{ background: ACCENT, border: 'none', color: '#ffffff', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: savingEmail ? 'default' : 'pointer', fontFamily: 'inherit', opacity: savingEmail ? 0.6 : 1 }}
                  >
                    {savingEmail ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEmailEdit(null)}
                    style={{ background: 'transparent', border: '1px solid var(--surface-2)', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Cancel
                  </button>
                </div>
                {editing.error && <ErrorNote message={editing.error} />}
                <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.55, maxWidth: 460 }}>
                  Leads, booking notices and their invitation go here. A Google Calendar connection also matches on
                  this address.
                </p>
              </div>
            ) : (
              <p style={{ color: 'var(--text-4)', fontSize: '.72rem', wordBreak: 'break-all' }}>
                <span style={{ fontFamily: 'monospace' }}>/{entry.slug}</span>
                {' · '}{email ?? 'no email on file'}
                {invite && !staleInvite ? ` · invited, expires ${fmtDate(invite.expires_at)}` : ''}
                {canEditEmail && (
                  <button
                    onClick={() => setEmailEdit({
                      slug: entry.slug,
                      routingId,
                      value: entry.email ?? '',
                      error: null,
                    })}
                    style={{ background: 'none', border: 'none', padding: '.15rem .35rem', marginLeft: '.35rem', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Edit email
                  </button>
                )}
              </p>
            )}
            {staleInvite && invite && !editing && (
              <p style={{ color: PENDING, fontSize: '.72rem', marginTop: '.25rem' }}>
                Their invitation went to {invite.email}, not the address above. It only works
                from that inbox. Revoke it and send a new one.
              </p>
            )}
          </div>
          {actions}
        </div>

        {gaps.map(g => (
          <p key={g.label} style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.55 }}>
            {g.label}. {g.hint}
          </p>
        ))}

        {!entry.account && !invite && !email && (
          <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.55 }}>
            There is no address to invite them at. Add one on the routing list under Settings, General.
          </p>
        )}

        {issued?.slug === entry.slug && issuedBlock(issued.link, issued.emailed)}
      </div>
    )
  }

  const coachSection = !canManageCoaches ? null : (
    <section style={{ marginBottom: '2.25rem' }}>
      <p style={{ ...microLabel, marginBottom: '.4rem' }}>Roster</p>
      <h2 style={{ ...heading, marginBottom: '.6rem' }}>Coaches</h2>
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.65, marginBottom: '1.1rem', maxWidth: 560 }}>
        A calendar and an account are two different things. This is the calendar side: who exists as a coach,
        what is still missing from their setup, and whether they have claimed a login yet.
      </p>

      {coachError && <div style={{ marginBottom: '1rem' }}><ErrorNote message={coachError} /></div>}

      {isDemo && (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', lineHeight: 1.55, marginBottom: '1rem' }}>
          Invitations are read only in the demo. Adding a coach works here against the sample roster.
        </p>
      )}

      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {!adding && (
          <button
            onClick={() => {
              setAdding(true); setAddError(null); setAdded(null)
              setSlugTouched(false); setDraft(blankCoach())
            }}
            style={{ background: ACCENT, border: 'none', color: '#ffffff', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: isMobile ? '.6rem 1.2rem' : '.5rem 1.2rem', minHeight: '2.5rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            + Add coach
          </button>
        )}
        <button
          onClick={() => void loadCoaches()}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: isMobile ? '.55rem .875rem' : '.35rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          ↺ Refresh
        </button>
      </div>

      {adding && addForm}
      {addedBlock}

      {coachesLoading ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading coaches…</p>
      ) : coachesOutage ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>Couldn&rsquo;t load the coaches.</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>That&rsquo;s on our side. Nobody has been added, invited or removed.</p>
          <button onClick={() => void loadCoaches()} style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--text)', color: 'var(--text)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '0 0 .25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            Try again
          </button>
        </div>
      ) : coaches.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>Nobody is on the coaching roster yet.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {coaches.map(coachRow)}
        </div>
      )}
    </section>
  )

  // ── One person ─────────────────────────────────────────────────────────────
  const detailBody = selected && (
    <>
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start' }}>
        <Avatar person={selected} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1rem' }}>{personName(selected)}</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.75rem', marginTop: '.2rem', wordBreak: 'break-all' }}>{selected.email}</p>
          {selected.phone && <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>{selected.phone}</p>}
          <div style={{ display: 'flex', gap: '.35rem', marginTop: '.5rem', flexWrap: 'wrap' }}>
            <Badge text={STATUS_LABELS[selected.status]} color={STATUS_COLORS[selected.status]} />
            <Badge text={ROLE_LABELS[selected.role]} color={ROLE_COLORS[selected.role]} />
            {selected.id === viewerId && <Badge text="You" color={ACCENT} />}
          </div>
          <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.5rem' }}>
            Joined {fmtDate(selected.created_at)}
            {selected.coach_slug ? ` · /${selected.coach_slug}` : ''}
          </p>
        </div>
        {!isMobile && (
          <button onClick={() => setSelectedId(null)} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1rem', padding: '.25rem .5rem', fontFamily: 'inherit' }}>×</button>
        )}
      </div>

      {detailError && <ErrorNote message={detailError} />}

      {/* Status ------------------------------------------------------------- */}
      {/* Approving, suspending and reinstating are writes to `profiles`, and
          011's `admin writes profiles` is the only policy that admits one. A
          head coach reaches this screen on manage_permissions now, so the
          controls that would refuse them are not drawn. The list, the detail
          and the permissions editor below are all still theirs. */}
      {canManageCoaches && <div>
        <p style={{ ...microLabel, marginBottom: '.5rem' }}>Access</p>
        {selected.status === 'pending' ? (
          isArmed(selected.id, 'approve')
            ? confirmRow(selected, 'Let them in?', 'Approve', '#22c55e', 'active', 'detail')
            : isArmed(selected.id, 'decline')
              ? confirmRow(selected, 'Turn them away?', 'Decline', DANGER, 'suspended', 'detail')
              : (
                <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                  <button onClick={() => setArmed({ id: selected.id, action: 'approve' })}
                    style={{ background: '#22c55e', border: 'none', color: '#04240f', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1.4rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Approve
                  </button>
                  <button onClick={() => setArmed({ id: selected.id, action: 'decline' })}
                    style={{ background: 'none', border: `1px solid ${DANGER}`, color: DANGER, fontSize: '.62rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1.1rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Decline
                  </button>
                </div>
              )
        ) : selected.status === 'active' ? (
          isArmed(selected.id, 'suspend')
            ? confirmRow(selected, 'Suspend this account?', 'Suspend', DANGER, 'suspended', 'detail')
            : (
              <button onClick={() => setArmed({ id: selected.id, action: 'suspend' })}
                style={{ background: 'none', border: `1px solid ${DANGER}`, color: DANGER, fontSize: '.62rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1.2rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                Suspend
              </button>
            )
        ) : (
          isArmed(selected.id, 'reinstate')
            ? confirmRow(selected, 'Let them back in?', 'Reinstate', '#22c55e', 'active', 'detail')
            : (
              <button onClick={() => setArmed({ id: selected.id, action: 'reinstate' })}
                style={{ background: 'none', border: '1px solid #22c55e', color: '#22c55e', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1.2rem', minHeight: '2.5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                Reinstate
              </button>
            )
        )}
        <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.55, marginTop: '.5rem' }}>
          {selected.status === 'suspended'
            ? 'A suspended account can still sign in and is shown nothing. Their bookings and history are untouched.'
            : 'Suspending takes every power away without deleting anything.'}
        </p>
      </div>}

      {/* Role --------------------------------------------------------------- */}
      {/* Same policy, same reasoning as Access above. A role change also wipes
          every permission exception on the account (016), so it is doubly not
          something to offer somebody whose write would be refused halfway. */}
      {canManageCoaches && <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <p style={microLabel}>Role</p>

        <div>
          <label className="field-label" htmlFor="um-role">What they are</label>
          <select
            id="um-role" className="field" value={roleDraft}
            onChange={e => {
              setRoleDraft(e.target.value as UserRole)
              setRoleSaved(false)
              setDetailError(null)
            }}
          >
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>

        {roleDraft !== 'athlete' && (
          <div>
            <label className="field-label" htmlFor="um-slug">Coach page {roleDraft === 'coach' ? '*' : '(optional)'}</label>
            <input
              id="um-slug" className="field" list="um-slug-options" maxLength={60}
              value={slugDraft}
              placeholder="ronnie-vallejo"
              onChange={e => {
                setSlugDraft(e.target.value)
                setRoleSaved(false)
                setDetailError(null)
              }}
            />
            <datalist id="um-slug-options">
              {COACHES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </datalist>
            <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.4rem', lineHeight: 1.55 }}>
              The calendar, schedule and bookings they take over. Lowercase letters, numbers and hyphens.
              One person per calendar — an administrator can run the place without one.
            </p>
          </div>
        )}

        {roleDirty && (
          <p style={{ color: PENDING, fontSize: '.72rem', lineHeight: 1.5 }}>
            The role is not applied until you save. Saving a different role also clears every permission
            exception on this account — an exception was granted against a role, and means nothing once
            that role is gone.
          </p>
        )}

        <button
          onClick={() => void saveRole()}
          disabled={savingRole || !roleDirty}
          style={{
            alignSelf: 'flex-start',
            background: !roleDirty ? 'var(--surface-2)' : savingRole ? 'var(--border-mid)' : ACCENT,
            border: 'none', color: !roleDirty ? 'var(--text-4)' : '#ffffff',
            fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase',
            padding: '.7rem 1.4rem', borderRadius: '.25rem', minHeight: '2.5rem',
            cursor: savingRole || !roleDirty ? 'default' : 'pointer', fontFamily: 'inherit',
          }}
        >
          {savingRole ? 'Saving…' : roleDirty ? 'Save role' : roleSaved ? 'Saved ✓' : 'No changes'}
        </button>

        {selected.role === 'admin' && selected.status === 'active' && activeAdmins <= 1 && (
          <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.55 }}>
            This is the only active administrator on the site. Nothing here will let that number reach zero.
          </p>
        )}
      </div>}

      {/* Assigned coaches --------------------------------------------------- */}
      {selected.role === 'athlete' && (
        <AssignedCoaches athlete={selected} staff={assignableCoaches} isDemo={isDemo} readOnly={!canManageCoaches} />
      )}

      {/* Permissions -------------------------------------------------------- */}
      <div style={{ borderTop: '1px solid var(--surface-2)', paddingTop: '1.25rem' }}>
        {canManagePermissions ? (
          <PermissionsEditor
            person={selected}
            viewer={viewer}
            people={people}
            isDemo={isDemo}
          />
        ) : (
          <>
            <p style={{ ...microLabel, marginBottom: '.4rem' }}>Permissions</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.65 }}>
              You do not hold the permission to change what other people may do. An administrator can grant it.
            </p>
          </>
        )}
      </div>
    </>
  )

  // ── The directory ──────────────────────────────────────────────────────────
  const personRow = (person: Profile) => (
    <div
      key={person.id}
      onClick={() => setSelectedId(person.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: '.75rem',
        padding: '.85rem 1rem', borderBottom: '1px solid var(--surface)', cursor: 'pointer',
        background: selectedId === person.id ? 'var(--surface)' : 'transparent',
      }}
    >
      <Avatar person={person} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.75rem' }}>
          <p style={{ color: 'var(--text)', fontWeight: 600, fontSize: '.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {personName(person)}
          </p>
          <div style={{ display: 'flex', gap: '.3rem', flexShrink: 0 }}>
            <Badge text={ROLE_LABELS[person.role]} color={ROLE_COLORS[person.role]} />
            <Badge text={STATUS_LABELS[person.status]} color={STATUS_COLORS[person.status]} />
          </div>
        </div>
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', marginTop: '.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {person.email}{person.coach_slug ? ` · /${person.coach_slug}` : ''}
        </p>
      </div>
      <span aria-hidden style={{ color: 'var(--text-4)', fontSize: '1.2rem', lineHeight: 1, flexShrink: 0 }}>›</span>
    </div>
  )

  const directory = (
    <section>
      <p style={{ ...microLabel, marginBottom: '.4rem' }}>Everyone</p>
      <h2 style={{ ...heading, marginBottom: '1rem' }}>People</h2>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <input
          className="field"
          placeholder="Search name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 260, flex: 1, minWidth: 180 }}
        />

        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {(['all', ...STATUSES] as const).map(s => {
            const on = statusFilter === s
            const color = s === 'all' ? 'var(--text)' : STATUS_COLORS[s]
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  background: on ? (s === 'all' ? 'var(--surface-2)' : `${color}22`) : 'transparent',
                  border: `1px solid ${on ? (s === 'all' ? 'var(--text-dim)' : color) : 'var(--border)'}`,
                  color: on ? color : 'var(--text-4)',
                  fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                  padding: isMobile ? '.55rem .75rem' : '.35rem .75rem', borderRadius: '.25rem',
                  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >
                {s} ({counts[s] ?? 0})
              </button>
            )
          })}
        </div>

        <select
          className="field" value={roleFilter}
          onChange={e => setRoleFilter(e.target.value as UserRole | 'all')}
          style={{ maxWidth: 180 }}
        >
          <option value="all">All roles</option>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}s</option>)}
        </select>

        <button
          onClick={() => void load()}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: isMobile ? '.55rem .875rem' : '.35rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          ↺ Refresh
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading people…</p>
      ) : outage ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>Couldn&rsquo;t load the accounts.</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>That&rsquo;s on our side — nobody has been let in or turned away.</p>
          <button onClick={() => void load()} style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--text)', color: 'var(--text)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '0 0 .25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            Try again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.85rem' }}>
          {people.length === 0 ? 'Nobody has an account yet.' : 'Nobody matches that.'}
        </p>
      ) : (
        <div style={{ border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden' }}>
          {filtered.map(personRow)}
          <p style={{ padding: '.7rem 1rem', color: 'var(--text-4)', fontSize: '.7rem' }}>
            Showing {filtered.length} of {people.length}
          </p>
        </div>
      )}
    </section>
  )

  return (
    <>
      <div className="dash-pad" style={{ paddingBottom: isMobile ? '1rem' : '1.25rem' }}>
        {isDemo && <DemoBanner note="Approve, decline and permission changes all work here against sample accounts." />}

        {/* Stats */}
        <div style={{ display: 'flex', gap: isMobile ? '1.25rem 1.75rem' : '2.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
          {([
            ['Pending', counts.pending ?? 0, PENDING],
            ['Active', counts.active ?? 0, '#22c55e'],
            ['Suspended', counts.suspended ?? 0, 'var(--text-4)'],
            ['Administrators', activeAdmins, DANGER],
          ] as const).map(([label, value, color]) => (
            <div key={label}>
              <p style={{ color, fontWeight: 900, fontSize: '1.5rem', lineHeight: 1 }}>{value}</p>
              <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '.25rem' }}>{label}</p>
            </div>
          ))}
        </div>

        {isMobile || !selected ? (
          <div style={{ maxWidth: 860 }}>
            {canManageCoaches && queue}
            {coachSection}
            {directory}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr min(400px, 42vw)', gap: '1.5rem', alignItems: 'start' }}>
            <div style={{ minWidth: 0 }}>
              {canManageCoaches && queue}
              {coachSection}
              {directory}
            </div>
            {/* Sticky so the person under review stays put while the directory
                scrolls, and independently scrollable because the permission
                list is longer than the viewport on every account. */}
            <div style={{ borderLeft: '1px solid var(--surface-2)', paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', position: 'sticky', top: 0, maxHeight: 'calc(100vh - 6rem)', overflowY: 'auto' }}>
              {detailBody}
            </div>
          </div>
        )}
      </div>

      {/* Detail (mobile full-screen overlay) */}
      {selected && isMobile && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'var(--bg)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg)', borderBottom: '1px solid var(--surface)', padding: '.4rem .5rem' }}>
            <button
              onClick={() => setSelectedId(null)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', background: 'none', border: 'none', color: 'var(--text-2)', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.75rem .6rem', minHeight: '2.5rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              ← Back
            </button>
          </div>
          <div style={{ padding: '1rem 1rem calc(2.5rem + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {detailBody}
          </div>
        </div>
      )}
    </>
  )
}
