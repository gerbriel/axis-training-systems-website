import { useState, useEffect, useCallback } from 'react'
import {
  listAnnouncements, createAnnouncement, updateAnnouncement,
  setAnnouncementActive, deleteAnnouncement, isLive,
  type Announcement, type AnnouncementInput, type AnnouncementKind,
} from '../../lib/marketing'
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

// ── Empty form ───────────────────────────────────────────────────────────────

function blankForm(): AnnouncementInput {
  return { title: '', body: '', kind: 'info', isActive: false, startsAt: null, endsAt: null, ctaLabel: '', ctaUrl: '' }
}

function toForm(a: Announcement): AnnouncementInput {
  return {
    title: a.title, body: a.body ?? '', kind: a.kind, isActive: a.isActive,
    startsAt: a.startsAt, endsAt: a.endsAt,
    ctaLabel: a.ctaLabel ?? '', ctaUrl: a.ctaUrl ?? '',
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
            The site-wide banner. One live announcement shows at a time — the newest wins.
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
