import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  fetchInvitations, sendInvitation, revokeInvitation, invitationState,
} from '../../lib/invitations'
import type { Invitation, InvitationState } from '../../lib/invitations'
import type { UserRole } from '../../lib/account'
import { fetchCoachDirectory } from '../../lib/coachRoster'
import type { CoachDirectoryEntry } from '../../lib/coachRoster'
import { COACHES } from '../../data/coaches'
import DemoBanner from '../../components/dashboard/DemoBanner'

const ACCENT = '#272C84'

const STATE_COLORS: Record<InvitationState, string> = {
  pending:  '#eab308',
  accepted: '#22c55e',
  revoked:  'var(--text-4)',
  expired:  'var(--text-4)',
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function Badge({ state }: { state: InvitationState }) {
  const c = STATE_COLORS[state]
  return (
    <span style={{ background: `${c}18`, border: `1px solid ${c}`, color: c, fontSize: '.55rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.2rem .55rem', borderRadius: '.2rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {state}
    </span>
  )
}

/**
 * Who has been invited, and the form to invite somebody.
 *
 * The one thing to understand before changing anything here: THE LINK IS SHOWN
 * ONCE. Only the SHA-256 of a token reaches the database, so there is no query
 * that can produce a pending invitation's link later. "Send a new link" issues a
 * fresh invitation that supersedes the old — which is a feature, because it
 * means a rotated link is also a revoked one — and that is why the panel makes
 * a point of the copy button rather than quietly dropping the value.
 */
export default function InvitationsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const { profile, isAdmin } = useAuth()

  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(!isDemo)
  const [outage, setOutage] = useState(false)
  // null until it answers, and null again if it cannot: the select falls back
  // to the bundled five rather than losing the ability to invite anyone.
  const [directory, setDirectory] = useState<CoachDirectoryEntry[] | null>(null)

  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [role, setRole] = useState<UserRole>('athlete')
  const [coachSlug, setCoachSlug] = useState('')
  const [note, setNote] = useState('')

  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ link: string; emailed: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (isDemo) { setLoading(false); return }
    setLoading(true)
    const rows = await fetchInvitations()
    if (rows === null) { setOutage(true); setInvitations([]) }
    else { setOutage(false); setInvitations(rows) }
    setLoading(false)
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  // Which calendars exist and who is on them. Refetched after an invitation is
  // issued, because issuing one is exactly what takes a calendar off the list.
  const loadDirectory = useCallback(async () => {
    setDirectory(await fetchCoachDirectory(isDemo))
  }, [isDemo])

  useEffect(() => { void loadDirectory() }, [loadDirectory])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (sending || isDemo) return
    setSending(true)
    setError(null)
    setIssued(null)
    setCopied(false)

    const res = await sendInvitation({
      email,
      role,
      coachSlug: role === 'athlete' ? null : coachSlug || null,
      firstName,
      note,
    })

    setSending(false)
    if (!res.ok) { setError(res.message); return }

    setIssued({ link: res.link, emailed: res.emailed })
    setEmail(''); setFirstName(''); setNote(''); setCoachSlug('')
    await load()
    await loadDirectory()
  }

  const doRevoke = async (id: number) => {
    if (!profile) return
    const ok = await revokeInvitation(id, profile.id)
    setConfirmRevoke(null)
    if (ok) await load()
    else setError('Could not revoke that invitation.')
  }

  // Only an admin may invite staff — the same rule the trigger enforces. Showing
  // a role picker a coach cannot use would produce a refusal after the fact.
  const canInviteStaff = isAdmin
  const takenSlugs = new Set(invitations.filter(i => invitationState(i) === 'pending' && i.coach_slug).map(i => i.coach_slug))

  /**
   * The calendars somebody can be invited to.
   *
   * A calendar is claimable when it exists in `coach_routing`, nobody's profile
   * holds its slug, and no live invitation is out for it. That is the same set
   * the trigger on `invitations` will accept, so the select cannot offer a
   * choice the database is about to refuse.
   *
   * Anything else is still listed, disabled, with the reason. A calendar that
   * silently vanishes reads as a bug; one that says "already taken" reads as an
   * answer. Without the directory this falls back to the bundled five and the
   * pending-invitation check alone, which is what it did before there was any
   * way to add a coach.
   */
  const calendarOptions: { slug: string; label: string; disabled: boolean }[] =
    directory
      ? directory
          .filter(entry => entry.hasRouting)
          .map(entry => {
            const invited = entry.invitation?.state === 'pending'
            const claimed = !!entry.account
            return {
              slug: entry.slug,
              label: entry.name
                + (claimed ? ' — already taken' : invited ? ' — already invited' : ''),
              disabled: claimed || invited,
            }
          })
      : COACHES.map(c => ({
          slug: c.slug,
          label: `${c.name}${takenSlugs.has(c.slug) ? ' — already invited' : ''}`,
          disabled: takenSlugs.has(c.slug),
        }))

  const nothingClaimable = calendarOptions.every(o => o.disabled)

  return (
    <div className="dash-pad" style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem', maxWidth: 760 }}>
      {isDemo && <DemoBanner note="Invitations are read-only in the demo." />}

      {/* ── Send one ─────────────────────────────────────────────────────── */}
      <section>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>Invite</p>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '.6rem' }}>
          Bring someone in
        </h2>
        <p style={{ color: 'var(--text-3)', fontSize: '.82rem', lineHeight: 1.65, marginBottom: '1.5rem', maxWidth: 520 }}>
          Accepting an application already invites that athlete automatically. This is for
          everyone else — a coach joining the roster, or an athlete who came to you some other way.
        </p>

        {error && (
          <div style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.7rem 1rem', marginBottom: '1rem' }}>
            <span style={{ color: '#c8102e', fontSize: '.82rem', lineHeight: 1.6 }}>{error}</span>
          </div>
        )}

        {issued && (
          <div style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.35)', borderRadius: '.25rem', padding: '1rem', marginBottom: '1.25rem' }}>
            <p style={{ color: '#22c55e', fontSize: '.82rem', fontWeight: 700, marginBottom: '.5rem' }}>
              {issued.emailed ? 'Invitation sent.' : 'Invitation created — but the email did not go out.'}
            </p>
            <p style={{ color: 'var(--text-3)', fontSize: '.78rem', lineHeight: 1.6, marginBottom: '.75rem' }}>
              {issued.emailed
                ? 'They can also use this link. It is shown once and cannot be retrieved later — sending a new invitation replaces it.'
                : 'Send them this link yourself. It is shown once and cannot be retrieved later.'}
            </p>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ flex: 1, minWidth: 220, background: 'var(--bg)', border: '1px solid var(--surface-2)', borderRadius: '.2rem', padding: '.5rem .6rem', color: 'var(--text-2)', fontSize: '.72rem', wordBreak: 'break-all' }}>
                {issued.link}
              </code>
              <button
                onClick={() => { void navigator.clipboard?.writeText(issued.link).then(() => setCopied(true)) }}
                style={{ background: ACCENT, border: 'none', color: '#fff', fontWeight: 900, fontSize: '.62rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 480 }}>
          <div>
            <label className="field-label" htmlFor="inv-email">Email *</label>
            <input id="inv-email" className="field" type="email" required maxLength={254} disabled={isDemo}
              value={email} onChange={e => setEmail(e.target.value)} />
          </div>

          <div>
            <label className="field-label" htmlFor="inv-first">First name</label>
            <input id="inv-first" className="field" maxLength={80} disabled={isDemo}
              value={firstName} onChange={e => setFirstName(e.target.value)} />
          </div>

          <div>
            <label className="field-label" htmlFor="inv-role">Joining as</label>
            <select id="inv-role" className="field" value={role} disabled={isDemo}
              onChange={e => setRole(e.target.value as UserRole)}>
              <option value="athlete">Athlete</option>
              {canInviteStaff && <option value="coach">Coach</option>}
              {canInviteStaff && <option value="admin">Administrator</option>}
            </select>
            {!canInviteStaff && (
              <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.4rem' }}>
                Only the head coach can invite staff.
              </p>
            )}
          </div>

          {role !== 'athlete' && (
            <div>
              <label className="field-label" htmlFor="inv-slug">Which calendar *</label>
              <select id="inv-slug" className="field" value={coachSlug} required disabled={isDemo}
                onChange={e => setCoachSlug(e.target.value)}>
                <option value="">Choose a coach profile…</option>
                {calendarOptions.map(o => (
                  <option key={o.slug} value={o.slug} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.4rem', lineHeight: 1.5 }}>
                {nothingClaimable
                  ? 'Every calendar already has somebody on it. Add a coach under Settings, Users, and they will appear here.'
                  : 'The calendar, schedule and bookings they take over. One person per calendar.'}
              </p>
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="inv-note">A line for them (optional)</label>
            <textarea id="inv-note" className="field" rows={2} maxLength={500} disabled={isDemo}
              value={note} onChange={e => setNote(e.target.value)}
              placeholder="Great talking today — here's your account." />
          </div>

          <button type="submit" disabled={sending || isDemo || !email}
            style={{
              alignSelf: 'flex-start',
              background: sending || isDemo || !email ? 'var(--border)' : ACCENT,
              border: 'none', color: sending || isDemo || !email ? 'var(--text-3)' : '#fff',
              fontWeight: 900, fontSize: '.7rem', letterSpacing: '.15em', textTransform: 'uppercase',
              padding: '.8rem 1.8rem', borderRadius: '.25rem',
              cursor: sending || isDemo || !email ? 'default' : 'pointer', fontFamily: 'inherit',
            }}>
            {sending ? 'Sending…' : 'Send invitation'}
          </button>
        </form>
      </section>

      {/* ── The list ─────────────────────────────────────────────────────── */}
      <section>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>History</p>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '1rem' }}>
          Invitations
        </h2>

        {loading ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
        ) : outage ? (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>Couldn&rsquo;t load invitations.</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>That&rsquo;s on our side — none have been cancelled.</p>
            <button onClick={() => void load()} style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--text)', color: 'var(--text)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '0 0 .25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              Try again
            </button>
          </div>
        ) : invitations.length === 0 ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.875rem' }}>Nobody has been invited yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {invitations.map(i => {
              const state = invitationState(i)
              const armed = confirmRevoke === i.id
              return (
                <div key={i.id} style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '.9rem 1.1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.25rem' }}>
                      <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.85rem', wordBreak: 'break-all' }}>{i.email}</span>
                      <Badge state={state} />
                    </div>
                    <p style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>
                      {i.role}{i.coach_slug ? ` · ${i.coach_slug}` : ''} · sent {fmtDate(i.created_at)}
                      {state === 'pending' ? ` · expires ${fmtDate(i.expires_at)}` : ''}
                      {state === 'accepted' && i.accepted_at ? ` · accepted ${fmtDate(i.accepted_at)}` : ''}
                    </p>
                  </div>

                  {state === 'pending' && !isDemo && (
                    armed ? (
                      <div style={{ display: 'flex', gap: '.4rem' }}>
                        <button onClick={() => void doRevoke(i.id)}
                          style={{ background: '#c8102e', border: 'none', color: '#fff', fontWeight: 900, fontSize: '.6rem', letterSpacing: '.1em', textTransform: 'uppercase', padding: '.5rem .9rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                          Revoke
                        </button>
                        <button onClick={() => setConfirmRevoke(null)}
                          style={{ background: 'none', border: '1px solid var(--surface-2)', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.5rem .9rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmRevoke(i.id)}
                        style={{ background: 'none', border: '1px solid var(--surface-2)', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.5rem .9rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                        Revoke
                      </button>
                    )
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
