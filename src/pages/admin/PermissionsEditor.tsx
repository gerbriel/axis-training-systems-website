import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Profile } from '../../lib/account'
import {
  fetchPermissionCatalog, fetchRoleDefaults, fetchOverrides, savePermissionOverrides,
  buildPermissionRows, draftFromOverrides, changedKeys, personName, fmtDate,
  ROLE_LABELS,
} from '../../lib/userManagement'
import type {
  Permission, PermissionOverride, PermissionRow, PermissionState, OverrideChange, Viewer,
} from '../../lib/userManagement'
import type { UserRole } from '../../lib/account'

const ACCENT = '#272C84'
const ALLOW = '#22c55e'
const DENY = '#c8102e'

const STATE_ORDER: PermissionState[] = ['deny', 'default', 'allow']

const STATE_LABELS: Record<PermissionState, string> = {
  deny: 'Deny',
  default: 'Role default',
  allow: 'Allow',
}

const STATE_COLORS: Record<PermissionState, string> = {
  deny: DENY,
  default: 'var(--text-2)',
  allow: ALLOW,
}

/** "an administrator", "a coach" — for a sentence rather than a badge. */
const roleArticle = (role: UserRole): string =>
  `${role === 'admin' ? 'an' : 'a'} ${ROLE_LABELS[role].toLowerCase()}`

const microLabel: React.CSSProperties = {
  color: 'var(--text)', fontSize: '.6rem', fontWeight: 900,
  letterSpacing: '.3em', textTransform: 'uppercase',
}

const groupLabel: React.CSSProperties = {
  color: 'var(--text-4)', fontSize: '.55rem', fontWeight: 900,
  letterSpacing: '.25em', textTransform: 'uppercase',
}

function Segmented({
  value, locked, busy, onChange,
}: {
  value: PermissionState
  /** The schema will not let this person hold this one. */
  locked: boolean
  busy: boolean
  onChange: (next: PermissionState) => void
}) {
  return (
    <div role="group" style={{ display: 'flex', gap: '.25rem', flexShrink: 0, opacity: locked ? 0.55 : 1 }}>
      {STATE_ORDER.map(s => {
        const on = value === s
        const c = STATE_COLORS[s]
        // A locked row can still be CLEARED back to the role default. Demoting
        // an administrator leaves their sensitive exceptions behind, and a row
        // that cannot be put back is an exception nobody can ever remove.
        const disabled = busy || (locked && (s !== 'default' || value === 'default'))
        return (
          <button
            key={s}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(s)}
            style={{
              background: on ? (s === 'default' ? 'var(--surface-2)' : `${c}22`) : 'transparent',
              border: `1px solid ${on ? (s === 'default' ? 'var(--text-dim)' : c) : 'var(--border-mid)'}`,
              color: on ? c : 'var(--text-4)',
              fontSize: '.55rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase',
              padding: '.4rem .6rem', borderRadius: '.2rem', whiteSpace: 'nowrap',
              cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', minHeight: '2rem',
            }}
          >
            {STATE_LABELS[s]}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Where an exception is made, and unmade.
 *
 * THE ROLE IS THE BASELINE. Every row's middle option is "whatever this role
 * gives", and the two on either side are a decision somebody made about one
 * person: a grant for the coach covering the review queue this month, a denial
 * for the coach who asked not to see client phone numbers. Clearing a row back
 * to the middle deletes the exception rather than storing a `false`, so the
 * person follows their role again the next time the role's defaults change.
 *
 * Choose-then-save, deliberately. A permissions screen that writes on every tap
 * turns a mis-click into a live privilege change with no moment to reconsider,
 * and gives no way to review three related changes as one decision — which is
 * how they are almost always made.
 *
 * ONLY A COACH CAN CARRY ONE. 014's guard refuses an override on an athlete
 * outright, and refuses one on an administrator because an admin short-circuits
 * every check in `profile_has_permission` — a tick against an admin would hide
 * a button and stop nothing, which is worse than doing nothing. Both cases are
 * rendered here as locked rows with the reason on them rather than as a blank
 * section, because "there is nothing to see" and "there is nothing you may
 * change" are different things to be told.
 *
 * What is greyed out is a CONVENIENCE. Every lock repeats a sentence the guard
 * would raise anyway; saying it before the round trip is the only difference.
 * The rule lives in the database. This is the sign on the door.
 */
export default function PermissionsEditor({
  person, viewer, people = [], isDemo = false, onSaved,
}: {
  person: Profile
  /**
   * The signed-in admin. `set_staff_permission` stamps `granted_by` from
   * `auth.uid()` server-side, so this is what the screen reasons WITH, never
   * what the row is written from.
   */
  viewer: Viewer
  /** Used only to put a name on whoever made an existing exception. */
  people?: Profile[]
  isDemo?: boolean
  onSaved?: () => void
}) {
  const [catalog, setCatalog] = useState<Permission[]>([])
  const [roleDefaults, setRoleDefaults] = useState<Record<UserRole, string[]>>({ athlete: [], coach: [], admin: [] })
  const [stored, setStored] = useState<PermissionOverride[]>([])
  const [baseline, setBaseline] = useState<Record<string, PermissionState>>({})
  const [draft, setDraft] = useState<Record<string, PermissionState>>({})

  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const personId = person.id

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [cat, defaults, overrides] = await Promise.all([
      fetchPermissionCatalog(isDemo),
      fetchRoleDefaults(isDemo),
      fetchOverrides(personId, isDemo),
    ])

    setCatalog(cat)
    setRoleDefaults(defaults)

    // A null here is an outage, not "no exceptions". Rendering an empty editor
    // would invite an admin to re-grant something that is already granted.
    if (overrides === null) {
      setOutage(true)
      setStored([])
      setBaseline({})
      setDraft({})
    } else {
      setOutage(false)
      const next = draftFromOverrides(overrides)
      setStored(overrides)
      setBaseline(next)
      setDraft(next)
    }

    setNote('')
    setSaved(false)
    setLoading(false)
  }, [personId, isDemo])

  // Reloads whenever the drawer swings to a different person, and whenever the
  // role changes underneath it. The second is not a nicety: a role change fires
  // `clear_permission_overrides_on_role_change` (014), which deletes every
  // exception on the profile, so anything on screen from before the change is a
  // set the database has already thrown away.
  useEffect(() => { void load() }, [load, person.role])

  const rows = useMemo(
    () => buildPermissionRows(person, catalog, roleDefaults, draft, stored, viewer),
    [person, catalog, roleDefaults, draft, stored, viewer]
  )

  const dirty = changedKeys(baseline, draft)
  const everyday = rows.filter(r => !r.permission.is_sensitive)
  const sensitive = rows.filter(r => r.permission.is_sensitive)
  const heldCount = rows.filter(r => r.effective).length
  const exceptionCount = rows.filter(r => r.state !== 'default').length

  const setState = (key: string, next: PermissionState) => {
    setSaved(false)
    setError(null)
    setDraft(prev => {
      const copy = { ...prev }
      if (next === 'default') delete copy[key]
      else copy[key] = next
      return copy
    })
  }

  const revert = () => {
    setDraft(baseline)
    setNote('')
    setError(null)
    setSaved(false)
  }

  const save = async () => {
    if (saving || dirty.length === 0) return
    setSaving(true)
    setError(null)

    const changes: OverrideChange[] = dirty.map(key => ({ permission: key, state: draft[key] ?? 'default' }))
    const res = await savePermissionOverrides(personId, changes, viewer.id, note || null, isDemo)
    setSaving(false)

    if (!res.ok) {
      // The draft is left exactly as it was. Wiping somebody's considered set of
      // changes because the network blinked is its own small betrayal.
      setError(res.message)
      return
    }

    setSaved(true)
    setNote('')
    await load()
    onSaved?.()
  }

  const grantorName = (id: string | null): string => {
    if (!id) return 'someone'
    if (id === viewer.id) return 'you'
    const match = people.find(p => p.id === id)
    return match ? personName(match) : 'an administrator'
  }

  /**
   * Some locks are about the PERSON, not the permission — an athlete, an
   * administrator, or yourself. Those are said once in a banner above; repeating
   * the same sentence on all sixteen rows drowns out the one thing each row is
   * actually for, which is what they hold.
   */
  const personLevelLock = person.role !== 'coach' || (!!viewer.id && person.id === viewer.id)

  const row = (r: PermissionRow) => {
    const locked = r.lockedReason !== null
    const changed = (baseline[r.permission.key] ?? 'default') !== r.state
    return (
      <div
        key={r.permission.key}
        style={{
          display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap',
          padding: '.85rem 0', borderBottom: '1px solid var(--surface)',
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: r.effective ? 'var(--text)' : 'var(--text-4)', fontWeight: 700, fontSize: '.82rem' }}>
              {r.permission.label}
            </span>
            {r.permission.is_sensitive && (
              <span style={{ background: `${DENY}18`, border: `1px solid ${DENY}`, color: DENY, fontSize: '.5rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.15rem .4rem', borderRadius: '.15rem', whiteSpace: 'nowrap' }}>
                Sensitive
              </span>
            )}
            {changed && (
              <span style={{ background: '#eab30818', border: '1px solid #eab30855', color: '#eab308', fontSize: '.5rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.15rem .4rem', borderRadius: '.15rem', whiteSpace: 'nowrap' }}>
                Unsaved
              </span>
            )}
          </div>

          {r.permission.description && (
            <p style={{ color: 'var(--text-4)', fontSize: '.72rem', lineHeight: 1.55, marginTop: '.2rem' }}>
              {r.permission.description}
            </p>
          )}

          <p style={{ color: 'var(--text-4)', fontSize: '.66rem', marginTop: '.3rem' }}>
            {locked && !personLevelLock
              ? `${r.lockedReason}${r.state !== 'default' ? ' The exception below is left over — clearing it is the only change allowed here.' : ''}`
              : r.state === 'default'
                ? (r.fromRole ? `Held because they are ${roleArticle(person.role)}.` : 'Not part of this role.')
                : r.state === 'allow'
                  ? (r.fromRole ? 'Allowed — the role already gives this.' : 'Allowed as an exception.')
                  : (r.fromRole ? 'Denied — taken away from what the role gives.' : 'Denied.')}
            {r.override && r.state !== 'default' && !changed
              ? ` Set by ${grantorName(r.override.granted_by)} on ${fmtDate(r.override.granted_at)}.`
              : ''}
          </p>

          {r.override?.note && !changed && (
            <p style={{ color: 'var(--text-3)', fontSize: '.7rem', fontStyle: 'italic', marginTop: '.25rem' }}>
              &ldquo;{r.override.note}&rdquo;
            </p>
          )}
        </div>

        <Segmented value={r.state} locked={locked} busy={saving} onChange={next => setState(r.permission.key, next)} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <p style={microLabel}>Permissions</p>
        <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.65, marginTop: '.4rem' }}>
          The role is the baseline. Anything set to Allow or Deny is an exception recorded against{' '}
          {personName(person)} alone. Changing their role clears every one of them, on the reasoning that
          an exception was granted against a role and means nothing once that role is gone.
        </p>
      </div>

      {person.role === 'athlete' && (
        <div style={{ background: 'rgba(234,179,8,.08)', border: '1px solid rgba(234,179,8,.35)', borderRadius: '.25rem', padding: '.7rem .9rem' }}>
          <p style={{ color: 'var(--text-2)', fontSize: '.75rem', lineHeight: 1.6 }}>
            Permissions are for staff. This account is an athlete and holds none of them, and the database
            refuses an exception on an athlete outright. Make them a coach first.
          </p>
        </div>
      )}

      {person.role === 'admin' && (
        <div style={{ background: 'rgba(234,179,8,.08)', border: '1px solid rgba(234,179,8,.35)', borderRadius: '.25rem', padding: '.7rem .9rem' }}>
          <p style={{ color: 'var(--text-2)', fontSize: '.75rem', lineHeight: 1.6 }}>
            An administrator holds everything, and passes every check in the database before any of this is
            read. Denying one here would hide a button without stopping anything, so the database refuses
            it. To take something away from an administrator, change their role.
          </p>
        </div>
      )}

      {!!viewer.id && person.id === viewer.id && person.role === 'coach' && (
        <div style={{ background: 'rgba(234,179,8,.08)', border: '1px solid rgba(234,179,8,.35)', borderRadius: '.25rem', padding: '.7rem .9rem' }}>
          <p style={{ color: 'var(--text-2)', fontSize: '.75rem', lineHeight: 1.6 }}>
            This is your own account. Nobody grants themselves a permission, or lifts a restriction somebody
            else put on them — the database refuses both. Ask an administrator.
          </p>
        </div>
      )}

      {person.status !== 'active' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '.7rem .9rem' }}>
          <p style={{ color: 'var(--text-3)', fontSize: '.75rem', lineHeight: 1.6 }}>
            {person.status === 'pending'
              ? 'This account is still waiting to be let in. Permissions can be set now, and take effect the moment it is approved.'
              : 'This account is suspended. Nothing below applies until it is reinstated.'}
          </p>
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>
          Loading permissions&hellip;
        </p>
      ) : outage ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.25rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.82rem', fontWeight: 700, marginBottom: '.3rem' }}>
            Couldn&rsquo;t read their permissions.
          </p>
          <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.6, marginBottom: '1rem' }}>
            That&rsquo;s on our side, and nothing has changed. Editing is off until the list loads, so nothing
            gets overwritten from a blank slate.
          </p>
          <button
            onClick={() => void load()}
            style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--text)', color: 'var(--text)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '0 0 .25rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <p style={{ color: 'var(--text-4)', fontSize: '.66rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>
            Holds {heldCount} of {rows.length}
            {exceptionCount > 0 ? ` · ${exceptionCount} exception${exceptionCount === 1 ? '' : 's'}` : ' · no exceptions'}
          </p>

          <div>
            <p style={{ ...groupLabel, marginBottom: '.25rem' }}>Everyday</p>
            {everyday.map(row)}
          </div>

          <div>
            <p style={{ ...groupLabel, marginBottom: '.25rem', marginTop: '.5rem' }}>Administrator hands these over</p>
            <p style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.55, marginBottom: '.25rem' }}>
              A coach can hold these. Only an administrator can give them, which is what keeps the set of
              permissions in circulation from growing on its own: everyone else can pass on what they already
              hold, and nothing more.
            </p>
            {sensitive.map(row)}
          </div>

          {dirty.length > 0 && (
            <div>
              <label className="field-label" htmlFor={`perm-note-${personId}`}>Why (optional)</label>
              <input
                id={`perm-note-${personId}`}
                className="field"
                maxLength={500}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Covering the review queue during meet season."
              />
              <p style={{ color: 'var(--text-4)', fontSize: '.68rem', marginTop: '.35rem', lineHeight: 1.5 }}>
                Recorded with each change below, and shown to whoever reads this screen next.
              </p>
            </div>
          )}

          {error && (
            <p role="alert" style={{ color: '#c8102e', fontSize: '.75rem', lineHeight: 1.6 }}>
              {error} Your changes are still here.
            </p>
          )}

          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => void save()}
              disabled={saving || dirty.length === 0}
              style={{
                background: dirty.length === 0 ? 'var(--surface-2)' : saving ? 'var(--border-mid)' : ACCENT,
                border: 'none',
                color: dirty.length === 0 ? 'var(--text-4)' : '#ffffff',
                fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase',
                padding: '.7rem 1.4rem', borderRadius: '.25rem', minHeight: '2.5rem',
                cursor: saving || dirty.length === 0 ? 'default' : 'pointer', fontFamily: 'inherit',
              }}
            >
              {saving
                ? 'Saving…'
                : dirty.length === 0
                  ? (saved ? 'Saved ✓' : 'No changes')
                  : `Save ${dirty.length} change${dirty.length === 1 ? '' : 's'}`}
            </button>

            {dirty.length > 0 && !saving && (
              <button
                onClick={revert}
                style={{ background: 'none', border: '1px solid var(--surface-2)', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.7rem 1rem', borderRadius: '.25rem', minHeight: '2.5rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Discard
              </button>
            )}
          </div>

          {isDemo && (
            <p style={{ color: 'var(--text-4)', fontSize: '.68rem' }}>
              Demo mode — permission changes stay in this preview and reset on reload.
            </p>
          )}
        </>
      )}
    </div>
  )
}
