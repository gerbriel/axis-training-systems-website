import { useState, useEffect, useCallback } from 'react'
import DemoBanner from '../../components/dashboard/DemoBanner'
import PhotoUpload from '../../components/dashboard/PhotoUpload'
import type { CoachDisplay } from '../../lib/coachProfiles'
import type { Testimonial } from '../../data/testimonials'
import { isAllowedPhotoUrl, ALLOWED_PHOTO_HOSTS } from '../../data/testimonials'
import {
  fetchMyTestimonials,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
} from '../../lib/testimonialsApi'
import { isRateLimited, recordFailedAttempt, clearRateLimit, formatLockRemaining } from '../../utils/sanitize'

// Max 10 saves per 30 minutes per coach.
const SAVE_MAX       = 10
const SAVE_LOCK_MS   = 30 * 60 * 1000
const SAVE_WINDOW_MS = 30 * 60 * 1000

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: '.2rem',
  color: 'var(--text)',
  fontSize: '.875rem',
  fontWeight: 500,
  padding: '.65rem .875rem',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}
const labelStyle: React.CSSProperties = {
  color: 'var(--text-2)',
  fontSize: '.6rem',
  fontWeight: 700,
  letterSpacing: '.15em',
  textTransform: 'uppercase',
  marginBottom: '.35rem',
  display: 'block',
}

/** What the coach sees about where a testimonial currently lives. */
function placement(t: Testimonial): { label: string; color: string } {
  if (t.mainStatus === 'approved') {
    return t.showOnCoach
      ? { label: 'Live — main page + coach page', color: '#22c55e' }
      : { label: 'Live — main page',              color: '#22c55e' }
  }
  if (t.mainStatus === 'pending') {
    return { label: 'Main page — awaiting head coach', color: '#272C84' }
  }
  if (t.mainStatus === 'rejected') {
    return { label: 'Main page declined', color: '#c8102e' }
  }
  return t.showOnCoach
    ? { label: 'Live — coach page', color: '#22c55e' }
    : { label: 'Not shown anywhere', color: 'var(--text-3)' }
}

const EMPTY = { quote: '', athlete: '', result: '', photo: '', onCoach: true, onMain: false }

interface Props {
  coach: CoachDisplay
  isDemo?: boolean
}

export default function TestimonialsManager({ coach, isDemo = false }: Props) {
  const rlScope = `testimonial_save_${coach.slug}`

  const [items, setItems]   = useState<Testimonial[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [saved, setSaved]   = useState('')

  // null = creating a new one; otherwise the id being edited.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await fetchMyTestimonials(coach.slug, isDemo))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load testimonials.')
    } finally {
      setLoading(false)
    }
  }, [coach.slug, isDemo])

  useEffect(() => { refresh() }, [refresh])

  function resetForm() {
    setForm(EMPTY)
    setEditingId(null)
    setError('')
  }

  function startEdit(t: Testimonial) {
    setEditingId(t.id)
    setError('')
    setForm({
      quote:   t.quote,
      athlete: t.athlete,
      result:  t.result,
      photo:   t.photo ?? '',
      onCoach: t.showOnCoach,
      onMain:  t.mainStatus === 'pending' || t.mainStatus === 'approved',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const canSave = form.quote.trim() && form.athlete.trim() && (form.onCoach || form.onMain)

  async function save() {
    setError('')
    if (!canSave) return

    if (!isAllowedPhotoUrl(form.photo)) {
      setError(`That photo link is not allowed. Upload the photo here, or paste an https link from: ${ALLOWED_PHOTO_HOSTS.join(', ')}`)
      return
    }

    // The lockout is a brute-force/error deterrent: only consecutive FAILED
    // saves count toward it, and a success clears it. Counting every successful
    // save would lock a coach out of normal editing after SAVE_MAX edits.
    const { blocked, remainingMs } = isRateLimited(rlScope)
    if (blocked) {
      setError(`Too many failed attempts. Try again in ${formatLockRemaining(remainingMs)}.`)
      return
    }

    setSaving(true)
    try {
      const payload = {
        coachSlug:       coach.slug,
        coachName:       coach.name,
        quote:           form.quote.trim(),
        athlete:         form.athlete.trim(),
        result:          form.result.trim(),
        photo:           form.photo.trim() || undefined,
        showOnCoach:     form.onCoach,
        requestMainPage: form.onMain,
      }
      const wasEditing = editingId !== null
      if (wasEditing) await updateTestimonial(editingId, payload, isDemo)
      else            await createTestimonial(payload, isDemo)

      clearRateLimit(rlScope)
      resetForm()
      await refresh()
      setSaved(
        form.onMain
          ? wasEditing ? 'Saved — main-page changes go to the head coach for review.'
                       : 'Saved — sent to the head coach for main-page review.'
          : 'Saved — live on your coach page.',
      )
      setTimeout(() => setSaved(''), 4000)
    } catch (err) {
      recordFailedAttempt(rlScope, SAVE_MAX, SAVE_LOCK_MS, SAVE_WINDOW_MS)
      setError(err instanceof Error ? err.message : 'Save failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(t: Testimonial) {
    if (!confirm(`Delete the testimonial from ${t.athlete}? This cannot be undone.`)) return
    try {
      await deleteTestimonial(t.id, isDemo)
      if (editingId === t.id) resetForm()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 800 }}>
      {isDemo && (
        <DemoBanner />
      )}

      {/* ── Editor ────────────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '2rem', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase' }}>
            {editingId ? 'Edit Testimonial' : 'New Testimonial'}
          </p>
          {editingId && (
            <button
              onClick={resetForm}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.25rem .65rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Cancel edit
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={labelStyle}>Quote <span style={{ color: 'var(--text)' }}>*</span></label>
            <textarea
              style={{ ...inputStyle, minHeight: 120, resize: 'vertical', lineHeight: 1.7 }}
              maxLength={1500}
              placeholder="What the athlete said…"
              value={form.quote}
              onChange={e => setForm(f => ({ ...f, quote: e.target.value }))}
            />
          </div>

          <div style={{ display: 'grid', gap: '1.25rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div>
              <label style={labelStyle}>Athlete Name <span style={{ color: 'var(--text)' }}>*</span></label>
              <input
                style={inputStyle}
                maxLength={200}
                placeholder="e.g. Isaiah Salazar"
                value={form.athlete}
                onChange={e => setForm(f => ({ ...f, athlete: e.target.value }))}
              />
            </div>
            <div>
              <label style={labelStyle}>Result <span style={{ color: 'var(--text-2)', fontWeight: 400 }}>(badge on the card)</span></label>
              <input
                style={inputStyle}
                maxLength={200}
                placeholder="e.g. +400 lbs total in 7 months"
                value={form.result}
                onChange={e => setForm(f => ({ ...f, result: e.target.value }))}
              />
            </div>
          </div>

          <PhotoUpload
            value={form.photo}
            onChange={url => setForm(f => ({ ...f, photo: url }))}
            folder="testimonials"
            label="Athlete photo"
            shape="circle"
            hint={`Optional. Upload one, or paste a link hosted on ${ALLOWED_PHOTO_HOSTS.join(', ')}. Other hosts are blocked by the site's security policy. Leave it blank to show the athlete's initial instead.`}
            isDemo={isDemo}
          />

          {/* ── Page assignment ─────────────────────────────────────────── */}
          <div style={{ borderTop: '1px solid var(--surface)', paddingTop: '1.25rem' }}>
            <label style={labelStyle}>Where should this appear?</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', marginTop: '.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '.65rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.onCoach}
                  onChange={e => setForm(f => ({ ...f, onCoach: e.target.checked }))}
                  style={{ marginTop: '.15rem', accentColor: '#272C84', width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }}
                />
                <span>
                  <span style={{ color: 'var(--text)', fontSize: '.8rem', fontWeight: 700 }}>My coach page</span>
                  <span style={{ color: 'var(--text-3)', fontSize: '.7rem', display: 'block', marginTop: '.15rem' }}>
                    Publishes to /coaches/{coach.slug} immediately.
                  </span>
                </span>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '.65rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.onMain}
                  onChange={e => setForm(f => ({ ...f, onMain: e.target.checked }))}
                  style={{ marginTop: '.15rem', accentColor: '#272C84', width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }}
                />
                <span>
                  <span style={{ color: 'var(--text)', fontSize: '.8rem', fontWeight: 700 }}>Main page (homepage)</span>
                  <span style={{ color: 'var(--text-3)', fontSize: '.7rem', display: 'block', marginTop: '.15rem' }}>
                    Sent to the head coach for approval before it goes live.
                  </span>
                </span>
              </label>
            </div>
            {!form.onCoach && !form.onMain && (
              <p style={{ color: '#c8102e', fontSize: '.7rem', fontWeight: 700, marginTop: '.75rem' }}>
                Pick at least one page.
              </p>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <button
              onClick={save}
              disabled={!canSave || saving}
              style={{
                background: '#272C84',
                border: 'none',
                color: '#fff',
                fontWeight: 900,
                fontSize: '.7rem',
                letterSpacing: '.15em',
                textTransform: 'uppercase',
                padding: '.75rem 1.5rem',
                borderRadius: '.2rem',
                cursor: !canSave || saving ? 'default' : 'pointer',
                fontFamily: 'inherit',
                opacity: !canSave || saving ? 0.4 : 1,
                transition: 'opacity .15s',
              }}
            >
              {saving ? 'Saving…' : editingId ? 'Save Changes →' : 'Add Testimonial →'}
            </button>
            {saved && <span style={{ color: '#22c55e', fontSize: '.75rem', fontWeight: 700 }}>✓ {saved}</span>}
            {error && <span style={{ color: '#c8102e', fontSize: '.75rem', fontWeight: 700 }}>{error}</span>}
          </div>
        </div>
      </div>

      {/* ── Existing testimonials ─────────────────────────────────────────── */}
      <div>
        <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
          Your Testimonials ({loading ? '…' : items.length})
        </p>

        {loading ? (
          <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>No testimonials yet. Add your first one above.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--surface)' }}>
            {items.map(t => {
              const p = placement(t)
              return (
                <div key={t.id} style={{ background: 'var(--bg)', padding: '1.25rem 1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <span style={{
                      background: p.color + '18',
                      border: `1px solid ${p.color}`,
                      color: p.color,
                      fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
                      padding: '.15rem .5rem', borderRadius: '.15rem',
                      display: 'inline-block', marginBottom: '.5rem',
                    }}>{p.label}</span>

                    <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.7 }}>
                      "{t.quote.length > 160 ? t.quote.slice(0, 160).trimEnd() + '…' : t.quote}"
                    </p>
                    <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.8rem', marginTop: '.5rem' }}>
                      {t.athlete}
                      {t.result && <span style={{ color: 'var(--text-2)', fontWeight: 400 }}> · {t.result}</span>}
                    </p>

                    {t.mainStatus === 'rejected' && t.rejectionNote && (
                      <p style={{ color: '#c8102e', fontSize: '.75rem', marginTop: '.5rem' }}>
                        Head coach: {t.rejectionNote}
                      </p>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '.4rem', flexShrink: 0 }}>
                    <button
                      onClick={() => startEdit(t)}
                      style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .75rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#272C84'; e.currentTarget.style.color = '#272C84' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(t)}
                      style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .75rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#c8102e'; e.currentTarget.style.color = '#c8102e' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
