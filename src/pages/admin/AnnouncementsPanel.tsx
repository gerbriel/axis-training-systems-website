import { useState, useEffect, useCallback } from 'react'
import {
  listAnnouncements, createAnnouncement, updateAnnouncement,
  setAnnouncementActive, deleteAnnouncement, isLive,
  type Announcement, type AnnouncementInput, type AnnouncementKind,
} from '../../lib/marketing'
import {
  DEFAULT_NEW_ACCOUNT_DAYS, MAX_NEW_ACCOUNT_DAYS, MIN_NEW_ACCOUNT_DAYS,
  type AudienceTarget, type AudienceType, type ViewerRole,
} from '../../lib/announceTargeting'
import { usePermissions } from '../../lib/usePermissions'
import { AnnouncementView } from '../../components/AnnouncementBanner'
import DemoBanner from '../../components/dashboard/DemoBanner'

// ── datetime-local helpers ───────────────────────────────────────────────────

function toLocalInput(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Status ───────────────────────────────────────────────────────────────────

type Status = 'Live' | 'Scheduled' | 'Expired' | 'Inactive'

function statusOf(a: Announcement, now = Date.now()): Status {
  if (!a.isActive) return 'Inactive'
  if (isLive(a, now)) return 'Live'
  if (a.startsAt && new Date(a.startsAt).getTime() > now) return 'Scheduled'
  if (a.endsAt && new Date(a.endsAt).getTime() < now) return 'Expired'
  return 'Inactive'
}

const STATUS_COLOR: Record<Status, { bg: string; text: string }> = {
  Live:      { bg: 'rgba(30,140,70,.14)',  text: '#1e8c46' },
  Scheduled: { bg: 'rgba(39,44,132,.12)',  text: '#272C84' },
  Expired:   { bg: 'rgba(120,120,130,.14)', text: 'var(--text-3)' },
  Inactive:  { bg: 'rgba(120,120,130,.10)', text: 'var(--text-3)' },
}

const KIND_OPTIONS: { value: AnnouncementKind; label: string }[] = [
  { value: 'info',  label: 'Info' },
  { value: 'promo', label: 'Promo' },
  { value: 'alert', label: 'Alert' },
]

// ── Audience ─────────────────────────────────────────────────────────────────
//
// Targeting is decided in the browser, so it shapes what a visitor is SHOWN and
// nothing more. Every live announcement stays readable by anyone who asks the
// API for it, which is why the form says so out loud.

const AUDIENCE_OPTIONS: { value: AudienceType; label: string }[] = [
  { value: 'all',                 label: 'Everyone' },
  { value: 'anonymous',           label: 'Signed-out visitors' },
  { value: 'authenticated',       label: 'Anyone signed in' },
  { value: 'role',                label: 'Specific roles' },
  { value: 'new_accounts',        label: 'New accounts' },
  { value: 'returning',           label: 'Returning visitors' },
  { value: 'returning_anonymous', label: 'Returning signed-out visitors' },
]

const ROLE_OPTIONS: { value: ViewerRole; label: string }[] = [
  { value: 'athlete', label: 'Athletes' },
  { value: 'coach',   label: 'Coaches' },
  { value: 'admin',   label: 'Admins' },
]

const DEFAULT_TARGET: AudienceTarget = { type: 'all' }

/** Roles are meaningful for these two types only; the rest ignore them. */
function usesRoles(type: AudienceType): boolean {
  return type === 'role' || type === 'new_accounts'
}

/** Switching type keeps what the new type can use and drops the rest. */
function retarget(prev: AudienceTarget, type: AudienceType): AudienceTarget {
  const next: AudienceTarget = { type }
  if (usesRoles(type) && prev.roles && prev.roles.length > 0) next.roles = prev.roles
  if (type === 'new_accounts') next.days = clampInt(prev.days, MIN_NEW_ACCOUNT_DAYS, MAX_NEW_ACCOUNT_DAYS, DEFAULT_NEW_ACCOUNT_DAYS)
  return next
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

function roleLabels(roles: ViewerRole[]): string {
  return ROLE_OPTIONS.filter(o => roles.includes(o.value)).map(o => o.label).join(', ')
}

/** The one-line summary shown on a list row. */
function audienceLabel(target: AudienceTarget | null | undefined): string {
  const t = target ?? DEFAULT_TARGET
  const roles = t.roles ?? []
  switch (t.type) {
    case 'anonymous':           return 'Signed-out visitors'
    case 'authenticated':       return 'Anyone signed in'
    case 'role':                return roles.length > 0 ? roleLabels(roles) : 'No roles picked'
    case 'new_accounts':        return roles.length > 0
      ? `New ${roleLabels(roles).toLowerCase()}, ${clampInt(t.days, MIN_NEW_ACCOUNT_DAYS, MAX_NEW_ACCOUNT_DAYS, DEFAULT_NEW_ACCOUNT_DAYS)} days`
      : `New accounts, ${clampInt(t.days, MIN_NEW_ACCOUNT_DAYS, MAX_NEW_ACCOUNT_DAYS, DEFAULT_NEW_ACCOUNT_DAYS)} days`
    case 'returning':           return 'Returning visitors'
    case 'returning_anonymous': return 'Returning signed-out visitors'
    default:                    return 'Everyone'
  }
}

// ── Empty form ───────────────────────────────────────────────────────────────

function blankForm(): AnnouncementInput {
  return {
    title: '', body: '', kind: 'info', isActive: false, startsAt: null, endsAt: null,
    ctaLabel: '', ctaUrl: '', targetAudience: { ...DEFAULT_TARGET }, priority: 0,
  }
}

function toForm(a: Announcement): AnnouncementInput {
  return {
    title: a.title, body: a.body ?? '', kind: a.kind, isActive: a.isActive,
    startsAt: a.startsAt, endsAt: a.endsAt,
    ctaLabel: a.ctaLabel ?? '', ctaUrl: a.ctaUrl ?? '',
    targetAudience: a.targetAudience ?? { ...DEFAULT_TARGET },
    priority: a.priority ?? 0,
  }
}

// ── Preview shape ────────────────────────────────────────────────────────────

function previewAnnouncement(form: AnnouncementInput): Announcement {
  const now = new Date().toISOString()
  return {
    id: 'preview', title: form.title || 'Your announcement title',
    body: form.body || null, kind: form.kind, isActive: form.isActive,
    startsAt: form.startsAt ?? null, endsAt: form.endsAt ?? null,
    ctaLabel: form.ctaLabel || null, ctaUrl: form.ctaUrl || null,
    targetAudience: form.targetAudience ?? { ...DEFAULT_TARGET },
    priority: form.priority ?? 0,
    createdAt: now, updatedAt: now,
  }
}

// ── Small styled controls ────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700,
  letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.4rem',
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
  color: 'var(--text)', fontSize: '.85rem', padding: '.55rem .7rem',
  borderRadius: '.25rem', fontFamily: 'inherit',
}

function primaryBtn(disabled = false): React.CSSProperties {
  return {
    background: '#272C84', border: 'none', color: '#fff', fontSize: '.65rem',
    fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
    padding: '.5rem 1.1rem', borderRadius: '.25rem',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  }
}

const ghostBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)',
  fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
  padding: '.5rem 1rem', borderRadius: '.25rem', cursor: 'pointer',
}

/** A role toggle. Pressed state is carried by aria-pressed, not by colour alone. */
function pillBtn(on: boolean): React.CSSProperties {
  return {
    ...ghostBtn,
    padding: '.35rem .8rem',
    background: on ? 'rgba(39,44,132,.12)' : 'none',
    borderColor: on ? 'rgba(39,44,132,.45)' : 'var(--border)',
    color: on ? '#272C84' : 'var(--text-2)',
  }
}

const hintStyle: React.CSSProperties = {
  color: 'var(--text-3)', fontSize: '.7rem', marginTop: '.4rem',
}

const chipStyle: React.CSSProperties = {
  border: '1px solid var(--border)', color: 'var(--text-3)',
  fontSize: '.58rem', fontWeight: 700, letterSpacing: '.06em',
  padding: '.18rem .45rem', borderRadius: '.15rem', whiteSpace: 'nowrap',
}

// ── Panel ────────────────────────────────────────────────────────────────────

export default function AnnouncementsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const { can, ready } = usePermissions()
  // Demo always shows the controls (they drive the in-memory store); live is
  // optimistic until the permission set resolves, then gates on the real key.
  const canManage = isDemo || !ready || can('manage_announcements')

  const [items, setItems]     = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  // null = list view; otherwise editing (id === null means "new")
  const [editing, setEditing] = useState<{ id: string | null; form: AnnouncementInput } | null>(null)
  const [saving, setSaving]   = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setItems(await listAnnouncements(isDemo))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load announcements.')
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { refresh() }, [refresh])

  const startNew  = () => { setFormError(null); setEditing({ id: null, form: blankForm() }) }
  const startEdit = (a: Announcement) => { setFormError(null); setEditing({ id: a.id, form: toForm(a) }) }
  const cancel    = () => { setEditing(null); setFormError(null) }

  const patch = (p: Partial<AnnouncementInput>) =>
    setEditing(e => (e ? { ...e, form: { ...e.form, ...p } } : e))

  const patchTarget = (t: AudienceTarget) => patch({ targetAudience: t })

  const setAudienceType = (type: AudienceType) =>
    setEditing(e => (e
      ? { ...e, form: { ...e.form, targetAudience: retarget(e.form.targetAudience ?? DEFAULT_TARGET, type) } }
      : e))

  const toggleRole = (role: ViewerRole) =>
    setEditing(e => {
      if (!e) return e
      const t = e.form.targetAudience ?? DEFAULT_TARGET
      const roles = t.roles ?? []
      const next = roles.includes(role) ? roles.filter(r => r !== role) : [...roles, role]
      return { ...e, form: { ...e.form, targetAudience: { ...t, roles: next } } }
    })

  const save = async () => {
    if (!editing) return
    setSaving(true); setFormError(null)
    try {
      if (editing.id) await updateAnnouncement(editing.id, editing.form, isDemo)
      else            await createAnnouncement(editing.form, isDemo)
      setEditing(null)
      await refresh()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (a: Announcement) => {
    try {
      await setAnnouncementActive(a.id, !a.isActive, isDemo)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update.')
    }
  }

  const remove = async (a: Announcement) => {
    if (!window.confirm(`Delete "${a.title}"? This cannot be undone.`)) return
    try {
      await deleteAnnouncement(a.id, isDemo)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.')
    }
  }

  // ── Editing view ──────────────────────────────────────────────────────────
  if (editing) {
    const f = editing.form
    const target = f.targetAudience ?? DEFAULT_TARGET
    const roles = target.roles ?? []
    return (
      <div style={{ padding: '2rem', maxWidth: 720 }}>
        {isDemo && <DemoBanner />}
        <h3 style={{ color: 'var(--text)', fontSize: '.95rem', fontWeight: 800, marginBottom: '1.25rem' }}>
          {editing.id ? 'Edit announcement' : 'New announcement'}
        </h3>

        {/* Live preview */}
        <div style={{ marginBottom: '1.5rem' }}>
          <span style={{ ...labelStyle }}>Preview</span>
          <div style={{ border: '1px solid var(--border)', borderRadius: '.35rem', overflow: 'hidden' }}>
            <AnnouncementView announcement={previewAnnouncement(f)} preview />
          </div>
        </div>

        <div style={{ display: 'grid', gap: '1.1rem' }}>
          <div>
            <label style={labelStyle}>Title</label>
            <input style={inputStyle} value={f.title} maxLength={160}
              onChange={e => patch({ title: e.target.value })} placeholder="Spring meet prep is open" />
          </div>

          <div>
            <label style={labelStyle}>Body <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(optional)</span></label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={f.body ?? ''} maxLength={600}
              onChange={e => patch({ body: e.target.value })} placeholder="A short supporting line." />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Kind</label>
              <select style={inputStyle} value={f.kind}
                onChange={e => patch({ kind: e.target.value as AnnouncementKind })}>
                {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', color: 'var(--text)', fontSize: '.82rem', fontWeight: 600 }}>
                <input type="checkbox" checked={f.isActive} onChange={e => patch({ isActive: e.target.checked })} />
                Active (eligible to show)
              </label>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Starts <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(optional)</span></label>
              <input type="datetime-local" style={inputStyle} value={toLocalInput(f.startsAt ?? null)}
                onChange={e => patch({ startsAt: e.target.value || null })} />
            </div>
            <div>
              <label style={labelStyle}>Ends <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(optional)</span></label>
              <input type="datetime-local" style={inputStyle} value={toLocalInput(f.endsAt ?? null)}
                onChange={e => patch({ endsAt: e.target.value || null })} />
            </div>
          </div>
          <p style={{ color: 'var(--text-3)', fontSize: '.7rem', marginTop: '-.5rem' }}>
            Leave a bound empty for “no limit”. The banner shows only while active and inside this window.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Button label</label>
              <input style={inputStyle} value={f.ctaLabel ?? ''} maxLength={60}
                onChange={e => patch({ ctaLabel: e.target.value })} placeholder="See the programs" />
            </div>
            <div>
              <label style={labelStyle}>Button link</label>
              <input style={inputStyle} value={f.ctaUrl ?? ''}
                onChange={e => patch({ ctaUrl: e.target.value })} placeholder="/book or https://…" />
            </div>
          </div>

          {/* Who sees it */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.1rem' }}>
            <p style={{ color: 'var(--text)', fontSize: '.82rem', fontWeight: 800 }}>Who sees it</p>
            <p style={{ ...hintStyle, marginBottom: '1rem' }}>
              This decides who the banner is shown to. It is not a privacy setting. Anyone can read a live
              announcement, so keep staff-only detail out of it.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Audience</label>
                <select style={inputStyle} value={target.type}
                  onChange={e => setAudienceType(e.target.value as AudienceType)}>
                  {AUDIENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Priority</label>
                <input type="number" min={0} max={999} style={inputStyle} value={f.priority ?? 0}
                  onChange={e => patch({ priority: clampInt(e.target.value, 0, 999, 0) })} />
              </div>
            </div>
            <p style={hintStyle}>When several announcements are live, the highest number wins.</p>

            {usesRoles(target.type) && (
              <div style={{ marginTop: '1rem' }}>
                <label style={labelStyle}>Roles</label>
                <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                  {ROLE_OPTIONS.map(o => {
                    const on = roles.includes(o.value)
                    return (
                      <button key={o.value} type="button" aria-pressed={on}
                        onClick={() => toggleRole(o.value)} style={pillBtn(on)}>
                        {o.label}
                      </button>
                    )
                  })}
                </div>
                {target.type === 'role' && roles.length === 0 && (
                  <p style={{ ...hintStyle, color: '#b4232b' }}>
                    Pick at least one role. With none picked this announcement shows to nobody.
                  </p>
                )}
                {target.type === 'new_accounts' && (
                  <p style={hintStyle}>Leave every role off to include all new accounts.</p>
                )}
              </div>
            )}

            {target.type === 'new_accounts' && (
              <div style={{ marginTop: '1rem', maxWidth: 240 }}>
                <label style={labelStyle}>Within how many days of signup</label>
                <input type="number" min={MIN_NEW_ACCOUNT_DAYS} max={MAX_NEW_ACCOUNT_DAYS} style={inputStyle}
                  value={target.days ?? DEFAULT_NEW_ACCOUNT_DAYS}
                  onChange={e => patchTarget({ ...target, days: clampInt(e.target.value, MIN_NEW_ACCOUNT_DAYS, MAX_NEW_ACCOUNT_DAYS, DEFAULT_NEW_ACCOUNT_DAYS) })} />
              </div>
            )}

            <p style={{ ...hintStyle, marginTop: '1rem' }}>
              Shows to: <strong style={{ color: 'var(--text-2)', fontWeight: 700 }}>{audienceLabel(target)}</strong>
            </p>
          </div>
        </div>

        {formError && (
          <div style={{ marginTop: '1rem', padding: '.7rem 1rem', background: 'rgba(180,35,43,.08)', border: '1px solid rgba(180,35,43,.25)', borderRadius: '.25rem', color: '#b4232b', fontSize: '.8rem' }}>
            {formError}
          </div>
        )}

        <div style={{ display: 'flex', gap: '.75rem', marginTop: '1.5rem' }}>
          <button style={primaryBtn(saving)} disabled={saving} onClick={save}>
            {saving ? 'Saving…' : editing.id ? 'Save changes' : 'Create announcement'}
          </button>
          <button style={ghostBtn} onClick={cancel} disabled={saving}>Cancel</button>
        </div>
      </div>
    )
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div>
      {isDemo && <div style={{ padding: '0 2rem', paddingTop: '1.25rem' }}><DemoBanner /></div>}

      <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid var(--surface)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ flex: 1 }}>
          <p style={{ color: 'var(--text)', fontSize: '.9rem', fontWeight: 800 }}>Announcements</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.75rem', marginTop: '.15rem' }}>
            The site-wide banner. One announcement shows at a time. Each visitor sees the highest priority
            one they match.
          </p>
        </div>
        <button onClick={refresh} style={ghostBtn}>↺ Refresh</button>
        {canManage && <button onClick={startNew} style={primaryBtn()}>+ New</button>}
      </div>

      {error && (
        <div style={{ margin: '1.5rem 2rem', padding: '.75rem 1rem', background: 'rgba(180,35,43,.08)', border: '1px solid rgba(180,35,43,.25)', borderRadius: '.25rem', color: '#b4232b', fontSize: '.8rem' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading announcements…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>
          No announcements yet.{canManage ? ' Create one to show a banner on the site.' : ''}
        </div>
      ) : (
        <div style={{ padding: '1rem 2rem 2rem' }}>
          {items.map(a => {
            const s = statusOf(a)
            const c = STATUS_COLOR[s]
            return (
              <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: '.35rem', padding: '1rem 1.15rem', marginBottom: '.75rem', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.3rem' }}>
                    <span style={{ background: c.bg, color: c.text, fontSize: '.55rem', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', padding: '.2rem .5rem', borderRadius: '.15rem' }}>{s}</span>
                    <span style={{ color: 'var(--text-4)', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>{a.kind}</span>
                    <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.85rem' }}>{a.title}</span>
                    <span style={chipStyle}>{audienceLabel(a.targetAudience)}</span>
                    {(a.priority ?? 0) > 0 && <span style={chipStyle}>Priority {a.priority}</span>}
                  </div>
                  {a.body && <p style={{ color: 'var(--text-2)', fontSize: '.78rem', marginBottom: '.35rem' }}>{a.body}</p>}
                  <p style={{ color: 'var(--text-3)', fontSize: '.68rem' }}>
                    {a.startsAt ? new Date(a.startsAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No start'}
                    {'  →  '}
                    {a.endsAt ? new Date(a.endsAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No end'}
                    {a.ctaUrl ? `   ·   ${a.ctaLabel || 'Learn more'} → ${a.ctaUrl}` : ''}
                  </p>
                </div>
                {canManage && (
                  <div style={{ display: 'flex', gap: '.4rem', flexShrink: 0 }}>
                    <button onClick={() => toggleActive(a)} title={a.isActive ? 'Deactivate' : 'Activate'}
                      style={{ ...ghostBtn, padding: '.35rem .7rem' }}>
                      {a.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => startEdit(a)} style={{ ...ghostBtn, padding: '.35rem .7rem' }}>Edit</button>
                    <button onClick={() => remove(a)} style={{ ...ghostBtn, padding: '.35rem .7rem', color: '#b4232b', borderColor: 'rgba(180,35,43,.35)' }}>Delete</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
