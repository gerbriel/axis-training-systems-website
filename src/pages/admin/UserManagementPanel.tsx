import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../../context/AuthContext'
import type { Profile, ProfileStatus, UserRole } from '../../lib/account'
import {
  fetchPeople, updateStatus, updateRole, hasPermission,
  roleChangeRefusal, statusChangeRefusal, countActiveAdmins,
  sortPeople, matchesSearch, personName, personInitials, waitingFor, fmtDate,
  ROLE_LABELS, STATUS_LABELS, STATUS_COLORS, ROLE_COLORS,
} from '../../lib/userManagement'
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

  // Demo mode has no session at all, so the seeded head coach stands in as the
  // person making the change — otherwise every demo grant is stamped by nobody.
  const viewerId = isDemo ? 'demo-ronnie' : (profile?.id ?? null)

  // Memoised because the permissions editor recomputes its rows from it. A
  // fresh object every render would rebuild sixteen rows on every keystroke in
  // the search box.
  const viewer = useMemo(
    () => ({ id: viewerId, isAdmin: isDemo ? true : isAdmin }),
    [viewerId, isDemo, isAdmin]
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

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await fetchPeople(isDemo)
    if (rows === null) { setOutage(true); setPeople([]) }
    else { setOutage(false); setPeople(rows) }
    setLoading(false)
  }, [isDemo])

  useEffect(() => { void load() }, [load])

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
      <div>
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
      </div>

      {/* Role --------------------------------------------------------------- */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
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
      </div>

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
            {queue}
            {directory}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr min(400px, 42vw)', gap: '1.5rem', alignItems: 'start' }}>
            <div style={{ minWidth: 0 }}>
              {queue}
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
