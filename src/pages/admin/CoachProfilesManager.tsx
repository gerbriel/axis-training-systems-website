import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../lib/usePermissions'
import DemoBanner from '../../components/dashboard/DemoBanner'
import PhotoUpload from '../../components/dashboard/PhotoUpload'
import {
  fetchAllCoachProfiles, saveCoachProfile, deleteCoachProfile,
  setCoachVisibility, reorderCoach,
  type CoachProfileRow,
} from '../../lib/coachProfiles'

const ACCENT = '#272C84'

/**
 * What a coach profile row is FOR, so nobody wires the wrong thing to it.
 *
 * This table is display copy. It decides what the public roster and the public
 * coach page say, and nothing else. Sign-in still runs off the static roster in
 * data/coaches.ts (CoachAdmin matches on email), and booking still routes
 * through coach_routing. Hiding a profile here takes a face off the website; it
 * does not close an account and it does not stop a booking. That is why the
 * caveat line below is repeated in the two flows where somebody is most likely
 * to assume otherwise: creating a profile, and deleting one.
 */
const SCOPE_CAVEAT = 'This controls the public site only. Sign-in access and booking routing are separate.'

// ── Text conventions between the form and the row ────────────────────────────
// Bio is a list of paragraphs, edited as one textarea split on blank lines.
// Specialties are short lines, edited one per line. Both round-trip cleanly.

const splitParagraphs = (t: string) => t.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
const joinParagraphs  = (p: string[]) => p.join('\n\n')
const splitLines      = (t: string) => t.split('\n').map(s => s.trim()).filter(Boolean)
const joinLines       = (l: string[]) => l.join('\n')

const slugify = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// ── Form shape ───────────────────────────────────────────────────────────────

interface StatRow { label: string; value: string }
interface ServiceRow { name: string; price: string; description: string }

interface ProfileForm {
  slug: string
  name: string
  firstName: string
  roleTitle: string
  tagline: string
  philosophy: string
  bioText: string
  specialtiesText: string
  stats: StatRow[]
  services: ServiceRow[]
  photoUrl: string
  ctaBgUrl: string
  bookCallUrl: string
}

function blankForm(): ProfileForm {
  return {
    slug: '', name: '', firstName: '', roleTitle: '', tagline: '', philosophy: '',
    bioText: '', specialtiesText: '', stats: [], services: [],
    photoUrl: '', ctaBgUrl: '', bookCallUrl: '',
  }
}

function toForm(row: CoachProfileRow): ProfileForm {
  return {
    slug: row.slug,
    name: row.name ?? '',
    firstName: row.first_name ?? '',
    roleTitle: row.role_title ?? '',
    tagline: row.tagline ?? '',
    philosophy: row.philosophy ?? '',
    bioText: joinParagraphs(row.bio ?? []),
    specialtiesText: joinLines(row.specialties ?? []),
    stats: (row.stats ?? []).map(s => ({ label: s.label ?? '', value: s.value ?? '' })),
    services: (row.services ?? []).map(s => ({
      name: s.name ?? '', price: s.price ?? '', description: s.description ?? '',
    })),
    photoUrl: row.photo_url ?? '',
    ctaBgUrl: row.cta_bg_url ?? '',
    bookCallUrl: row.book_call_url ?? '',
  }
}

// ── Small styled controls, matching the other admin panels ───────────────────

const microLabel: React.CSSProperties = {
  display: 'block', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700,
  letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.4rem',
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
  color: 'var(--text)', fontSize: '.85rem', padding: '.55rem .7rem',
  borderRadius: '.25rem', fontFamily: 'inherit',
}

const ghostBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)',
  fontSize: '.62rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
  padding: '.45rem .8rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
}

function primaryBtn(disabled = false): React.CSSProperties {
  return {
    background: ACCENT, border: 'none', color: '#fff', fontSize: '.65rem',
    fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
    padding: '.55rem 1.1rem', borderRadius: '.25rem', fontFamily: 'inherit',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
  }
}

const iconBtn: React.CSSProperties = {
  ...ghostBtn, padding: '.35rem .55rem', minWidth: '2rem', lineHeight: 1,
}

const hintStyle: React.CSSProperties = {
  color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.5, marginTop: '.35rem',
}

function Caveat() {
  return (
    <p style={{ color: 'var(--text-3)', fontSize: '.72rem', lineHeight: 1.6, marginTop: '.5rem' }}>
      {SCOPE_CAVEAT}
    </p>
  )
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.7rem 1rem', marginBottom: '1rem' }}>
      <span style={{ color: '#c8102e', fontSize: '.82rem', lineHeight: 1.6 }}>{text}</span>
    </div>
  )
}

function Thumb({ src, name }: { src: string | null | undefined; name: string }) {
  if (src) {
    return (
      <img
        src={src} alt="" aria-hidden="true" loading="lazy"
        style={{ width: 44, height: 44, borderRadius: '.25rem', objectFit: 'cover', objectPosition: 'center top', flexShrink: 0, border: '1px solid var(--surface-2)' }}
      />
    )
  }
  return (
    <div style={{ width: 44, height: 44, borderRadius: '.25rem', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ color: 'var(--text-3)', fontWeight: 900, fontSize: '1rem' }}>{name.charAt(0).toUpperCase() || '?'}</span>
    </div>
  )
}

function VisibilityPill({ visible }: { visible: boolean }) {
  const c = visible ? '#22c55e' : 'var(--text-4)'
  return (
    <span style={{ background: visible ? 'rgba(34,197,94,.12)' : 'rgba(120,120,130,.12)', border: `1px solid ${c}`, color: c, fontSize: '.53rem', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase', padding: '.2rem .5rem', borderRadius: '.2rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {visible ? 'Visible' : 'Hidden on the site'}
    </span>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

export default function CoachProfilesManager({ isDemo = false }: { isDemo?: boolean }) {
  const { profile, isAdmin } = useAuth()
  const { can } = usePermissions()

  // Who may rearrange the roster. A coach who is neither of these still gets to
  // edit the one profile that is theirs, because that is their own copy on the
  // public site. Everything structural stays with an admin.
  const canManage = isDemo || isAdmin || can('manage_staff')
  const ownSlug = profile?.coach_slug ?? null

  const [items, setItems]     = useState<CoachProfileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [busy, setBusy]       = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // null = list view. id === null inside means "creating a new one".
  const [editing, setEditing] = useState<{ id: string | null; form: ProfileForm } | null>(null)
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await fetchAllCoachProfiles(isDemo)
    if (rows === null) { setOutage(true); setItems([]) }
    else { setOutage(false); setItems(rows) }
    setLoading(false)
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  const startNew = () => {
    setFormError(null); setSlugTouched(false); setConfirmDelete(null)
    setEditing({ id: null, form: blankForm() })
  }
  const startEdit = (row: CoachProfileRow) => {
    setFormError(null); setSlugTouched(true); setConfirmDelete(null)
    setEditing({ id: row.id, form: toForm(row) })
  }
  const cancel = () => { setEditing(null); setFormError(null) }

  const patch = (p: Partial<ProfileForm>) =>
    setEditing(e => (e ? { ...e, form: { ...e.form, ...p } } : e))

  const save = async () => {
    if (!editing || saving) return
    const f = editing.form
    const name = f.name.trim()
    const slug = f.slug.trim()

    if (!name) { setFormError('A name is required.'); return }
    if (!editing.id && !/^[a-z0-9-]+$/.test(slug)) {
      setFormError('The link name needs lowercase letters, numbers and dashes only.')
      return
    }

    setSaving(true); setFormError(null)
    const res = await saveCoachProfile({
      id: editing.id ?? undefined,
      slug,
      name,
      first_name: f.firstName.trim() || null,
      role_title: f.roleTitle.trim() || null,
      tagline: f.tagline.trim() || null,
      philosophy: f.philosophy.trim() || null,
      bio: splitParagraphs(f.bioText),
      specialties: splitLines(f.specialtiesText),
      stats: f.stats
        .map(s => ({ label: s.label.trim(), value: s.value.trim() }))
        .filter(s => s.label || s.value),
      services: f.services
        .map(s => ({ name: s.name.trim(), price: s.price.trim(), description: s.description.trim() }))
        .filter(s => s.name || s.price || s.description),
      photo_url: f.photoUrl.trim() || null,
      cta_bg_url: f.ctaBgUrl.trim() || null,
      book_call_url: f.bookCallUrl.trim() || null,
    }, isDemo)
    setSaving(false)

    if (!res.ok) { setFormError(res.message); return }
    setEditing(null)
    await load()
  }

  const toggleVisible = async (row: CoachProfileRow) => {
    if (busy) return
    setBusy(row.id); setError(null)
    const res = await setCoachVisibility(row.id, !row.is_visible, isDemo)
    setBusy(null)
    if (!res.ok) { setError(res.message); return }
    await load()
  }

  const move = async (row: CoachProfileRow, direction: 'up' | 'down') => {
    if (busy) return
    setBusy(row.id); setError(null)
    const res = await reorderCoach(row.id, direction, isDemo, items)
    setBusy(null)
    if (!res.ok) { setError(res.message); return }
    await load()
  }

  const remove = async (row: CoachProfileRow) => {
    if (busy) return
    setBusy(row.id); setError(null)
    const res = await deleteCoachProfile(row.id, isDemo)
    setBusy(null)
    setConfirmDelete(null)
    if (!res.ok) { setError(res.message); return }
    await load()
  }

  // ── Edit / create view ────────────────────────────────────────────────────
  if (editing) {
    const f = editing.form
    const creating = editing.id === null

    return (
      <div className="dash-pad" style={{ maxWidth: 760 }}>
        {isDemo && <DemoBanner note="Coach profiles reset when you leave the demo." />}

        <p style={{ ...microLabel, color: 'var(--text)', letterSpacing: '.3em' }}>Public site</p>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '.5rem' }}>
          {creating ? 'New coach profile' : `Edit ${f.name || 'profile'}`}
        </h2>
        {creating && <Caveat />}

        {formError && <div style={{ marginTop: '1rem' }}><ErrorBox text={formError} /></div>}

        <div style={{ display: 'grid', gap: '1.1rem', marginTop: '1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
            <div>
              <label style={microLabel} htmlFor="cp-name">Name</label>
              <input id="cp-name" style={inputStyle} value={f.name} maxLength={120}
                onChange={e => {
                  const next = e.target.value
                  patch(creating && !slugTouched ? { name: next, slug: slugify(next) } : { name: next })
                }}
                placeholder="Ronnie Vallejo" />
            </div>
            <div>
              <label style={microLabel} htmlFor="cp-first">First name</label>
              <input id="cp-first" style={inputStyle} value={f.firstName} maxLength={80}
                onChange={e => patch({ firstName: e.target.value })} placeholder="Ronnie" />
              <p style={hintStyle}>Used in lines like &ldquo;Work With Ronnie&rdquo;.</p>
            </div>
          </div>

          <div>
            <label style={microLabel} htmlFor="cp-slug">Link name</label>
            <input id="cp-slug" style={{ ...inputStyle, opacity: creating ? 1 : .6 }} value={f.slug}
              maxLength={60} disabled={!creating}
              onChange={e => { setSlugTouched(true); patch({ slug: slugify(e.target.value) }) }}
              placeholder="ronnie-vallejo" />
            <p style={hintStyle}>
              {creating
                ? 'This becomes the public address, for example /coaches/ronnie-vallejo. Lowercase letters, numbers and dashes.'
                : 'Locked after the profile is created, because the public link and the booking routing both point at it.'}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={microLabel} htmlFor="cp-role">Role title</label>
              <input id="cp-role" style={inputStyle} value={f.roleTitle} maxLength={120}
                onChange={e => patch({ roleTitle: e.target.value })} placeholder="Head Coach & Founder" />
            </div>
            <div>
              <label style={microLabel} htmlFor="cp-tagline">Tagline</label>
              <input id="cp-tagline" style={inputStyle} value={f.tagline} maxLength={300}
                onChange={e => patch({ tagline: e.target.value })} placeholder="Strength built on intention, not ego." />
            </div>
          </div>

          <div>
            <label style={microLabel} htmlFor="cp-philosophy">Coaching philosophy</label>
            <textarea id="cp-philosophy" style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
              value={f.philosophy} maxLength={2000}
              onChange={e => patch({ philosophy: e.target.value })}
              placeholder="The pull quote on the coach page." />
          </div>

          <div>
            <label style={microLabel} htmlFor="cp-bio">Bio</label>
            <textarea id="cp-bio" style={{ ...inputStyle, minHeight: 160, resize: 'vertical' }}
              value={f.bioText}
              onChange={e => patch({ bioText: e.target.value })}
              placeholder={'First paragraph.\n\nSecond paragraph.'} />
            <p style={hintStyle}>Leave a blank line between paragraphs. Each block becomes its own paragraph on the page.</p>
          </div>

          <div>
            <label style={microLabel} htmlFor="cp-specialties">Specialties</label>
            <textarea id="cp-specialties" style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
              value={f.specialtiesText}
              onChange={e => patch({ specialtiesText: e.target.value })}
              placeholder={'Full meet prep\nAttempt selection strategy'} />
            <p style={hintStyle}>One per line.</p>
          </div>

          {/* Stats */}
          <div>
            <span style={microLabel}>Stats</span>
            {f.stats.length === 0 && (
              <p style={{ ...hintStyle, marginTop: 0, marginBottom: '.5rem' }}>The number strip under the hero. Nothing here means no strip.</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {f.stats.map((s, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '.5rem', alignItems: 'center' }}>
                  <input style={inputStyle} value={s.label} maxLength={60} placeholder="Athletes Coached"
                    aria-label={`Stat ${i + 1} label`}
                    onChange={e => patch({ stats: f.stats.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                  <input style={inputStyle} value={s.value} maxLength={40} placeholder="50+"
                    aria-label={`Stat ${i + 1} value`}
                    onChange={e => patch({ stats: f.stats.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} />
                  <button style={iconBtn} aria-label={`Remove stat ${i + 1}`}
                    onClick={() => patch({ stats: f.stats.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              ))}
            </div>
            <button style={{ ...ghostBtn, marginTop: '.6rem' }}
              onClick={() => patch({ stats: [...f.stats, { label: '', value: '' }] })}>
              + Add stat
            </button>
          </div>

          {/* Services */}
          <div>
            <span style={microLabel}>Services</span>
            {f.services.length === 0 && (
              <p style={{ ...hintStyle, marginTop: 0, marginBottom: '.5rem' }}>What somebody can buy, shown as cards on the coach page.</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              {f.services.map((s, i) => (
                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: '.3rem', padding: '.75rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '.5rem', alignItems: 'center' }}>
                    <input style={inputStyle} value={s.name} maxLength={120} placeholder="1:1 Coaching (Full Service)"
                      aria-label={`Service ${i + 1} name`}
                      onChange={e => patch({ services: f.services.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
                    <input style={inputStyle} value={s.price} maxLength={60} placeholder="$180/mo"
                      aria-label={`Service ${i + 1} price`}
                      onChange={e => patch({ services: f.services.map((x, j) => j === i ? { ...x, price: e.target.value } : x) })} />
                    <button style={iconBtn} aria-label={`Remove service ${i + 1}`}
                      onClick={() => patch({ services: f.services.filter((_, j) => j !== i) })}>Remove</button>
                  </div>
                  <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={s.description}
                    maxLength={600} placeholder="What is included."
                    aria-label={`Service ${i + 1} description`}
                    onChange={e => patch({ services: f.services.map((x, j) => j === i ? { ...x, description: e.target.value } : x) })} />
                </div>
              ))}
            </div>
            <button style={{ ...ghostBtn, marginTop: '.6rem' }}
              onClick={() => patch({ services: [...f.services, { name: '', price: '', description: '' }] })}>
              + Add service
            </button>
          </div>

          <PhotoUpload
            value={f.photoUrl}
            onChange={url => patch({ photoUrl: url })}
            folder="coaches"
            label="Photo"
            shape="circle"
            hint="The headshot on the roster card and the coach page."
            isDemo={isDemo}
            disabled={saving}
          />

          <PhotoUpload
            value={f.ctaBgUrl}
            onChange={url => patch({ ctaBgUrl: url })}
            folder="coaches"
            label="Background photo"
            shape="wide"
            hint="Sits behind the closing call to action. Also stands in for the headshot when there is none."
            isDemo={isDemo}
            disabled={saving}
          />

          <div>
            <label style={microLabel} htmlFor="cp-book">Book a call URL</label>
            <input id="cp-book" style={inputStyle} value={f.bookCallUrl}
              onChange={e => patch({ bookCallUrl: e.target.value })} placeholder="https://calendly.com/..." />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '.75rem', marginTop: '1.75rem' }}>
          <button style={primaryBtn(saving)} disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving...' : creating ? 'Create profile' : 'Save changes'}
          </button>
          <button style={ghostBtn} onClick={cancel} disabled={saving}>Cancel</button>
        </div>
      </div>
    )
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="dash-pad" style={{ maxWidth: 900 }}>
      {isDemo && <DemoBanner note="Coach profiles reset when you leave the demo." />}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <p style={{ ...microLabel, color: 'var(--text)', letterSpacing: '.3em' }}>Public site</p>
          <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '.4rem' }}>
            Coach profiles
          </h2>
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem', lineHeight: 1.65, maxWidth: 520 }}>
            How each coach appears on the public site.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
          <button style={ghostBtn} onClick={() => void load()}>Refresh</button>
          {canManage && <button style={primaryBtn()} onClick={startNew}>+ Add coach profile</button>}
        </div>
      </div>

      {error && <ErrorBox text={error} />}

      {loading ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading...</p>
      ) : outage ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>Could not load coach profiles.</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>
            That is on our side. Nothing changed, and the site is still showing the last saved version.
          </p>
          <button onClick={() => void load()} style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--text)', color: 'var(--text)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '0 0 .25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.875rem', lineHeight: 1.6 }}>
          No coach profiles yet.{canManage ? ' Add one and it shows up on the public roster.' : ''}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {items.map((row, i) => {
            const mine = ownSlug !== null && row.slug === ownSlug
            const armed = confirmDelete === row.id
            const working = busy === row.id

            return (
              <div key={row.id} style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '.85rem 1rem', display: 'flex', gap: '.9rem', alignItems: 'center', flexWrap: 'wrap', opacity: row.is_visible ? 1 : .72 }}>
                {/* The same fallback the public card uses: headshot, then background photo. */}
                <Thumb src={row.photo_url || row.cta_bg_url} name={row.name ?? ''} />

                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.2rem' }}>
                    <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.9rem' }}>{row.name}</span>
                    <VisibilityPill visible={!!row.is_visible} />
                    {mine && !canManage && (
                      <span style={{ color: 'var(--text-4)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase' }}>Yours</span>
                    )}
                  </div>
                  <p style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>
                    {row.role_title || 'No role title'} · /coaches/{row.slug}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {canManage && (
                    <>
                      <button style={iconBtn} disabled={working || i === 0} aria-label={`Move ${row.name} up`}
                        onClick={() => void move(row, 'up')}
                        title="Move up">↑</button>
                      <button style={iconBtn} disabled={working || i === items.length - 1} aria-label={`Move ${row.name} down`}
                        onClick={() => void move(row, 'down')}
                        title="Move down">↓</button>
                      <button style={ghostBtn} disabled={working} onClick={() => void toggleVisible(row)}>
                        {row.is_visible ? 'Hide' : 'Show'}
                      </button>
                    </>
                  )}
                  {(canManage || mine) && (
                    <button style={ghostBtn} onClick={() => startEdit(row)}>Edit</button>
                  )}
                  {canManage && !armed && (
                    <button style={{ ...ghostBtn, color: '#c8102e', borderColor: 'rgba(200,16,46,.35)' }}
                      onClick={() => { setError(null); setConfirmDelete(row.id) }}>
                      Delete
                    </button>
                  )}
                </div>

                {canManage && armed && (
                  <div style={{ width: '100%', borderTop: '1px solid var(--surface-2)', marginTop: '.35rem', paddingTop: '.7rem' }}>
                    <p style={{ color: 'var(--text-2)', fontSize: '.78rem', lineHeight: 1.6 }}>
                      Delete this profile? {row.name} comes off the public site right away. Hiding keeps the copy for later.
                    </p>
                    <Caveat />
                    <div style={{ display: 'flex', gap: '.4rem', marginTop: '.7rem' }}>
                      <button disabled={working} onClick={() => void remove(row)}
                        style={{ background: '#c8102e', border: 'none', color: '#fff', fontWeight: 900, fontSize: '.6rem', letterSpacing: '.1em', textTransform: 'uppercase', padding: '.5rem .9rem', borderRadius: '.2rem', cursor: working ? 'default' : 'pointer', fontFamily: 'inherit', opacity: working ? .5 : 1 }}>
                        {working ? 'Deleting...' : 'Delete profile'}
                      </button>
                      <button onClick={() => setConfirmDelete(null)} style={ghostBtn}>Keep</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!loading && !outage && items.length > 0 && (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', lineHeight: 1.6, marginTop: '1rem' }}>
          The order here is the order on the public roster. {SCOPE_CAVEAT}
        </p>
      )}
    </div>
  )
}
