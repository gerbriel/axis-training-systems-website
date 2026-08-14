import { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchAllTestimonials, reviewTestimonial, deleteTestimonial, createTestimonial, updateTestimonial } from '../../lib/testimonialsApi'
import type { Testimonial, MainStatus } from '../../data/testimonials'
import { sanitizeText } from '../../utils/sanitize'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { COACHES } from '../../data/coaches'

/**
 * Head-coach view of every coach's testimonials.
 *
 * The only thing that needs approval here is MAIN-PAGE placement. A coach's own
 * page is theirs to manage, so those are shown read-only for oversight; the
 * queue at the top is what actually needs action.
 */

const STATUS_COLORS: Record<MainStatus, string> = {
  none:     'var(--text-3)',
  pending:  '#272C84',
  approved: '#22c55e',
  rejected: '#c8102e',
}

const MAIN_LABEL: Record<MainStatus, string> = {
  none:     'Coach page only',
  pending:  'Awaiting review',
  approved: 'On main page',
  rejected: 'Declined',
}

type Filter = 'pending' | 'approved' | 'all'

const inp: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.2rem',
  color: 'var(--text)', fontSize: '.875rem', fontWeight: 500, padding: '.65rem .875rem',
  outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
}
const btn: React.CSSProperties = {
  fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase',
  padding: '.5rem 1.1rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit',
  border: 'none',
}

export default function TestimonialsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [items, setItems]     = useState<Testimonial[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<Filter>('pending')
  const [coachFilter, setCoachFilter] = useState<string>('all')
  const [actionId, setActionId]       = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [rejectMode, setRejectMode]   = useState<Record<string, boolean>>({})
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setItems(await fetchAllTestimonials(isDemo)) }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Could not load testimonials.') }
    finally { setLoading(false) }
  }, [isDemo])

  useEffect(() => { refresh() }, [refresh])

  const approve = async (id: string) => {
    setActionId(id); setActionError('')
    try { await reviewTestimonial(id, 'approved', undefined, isDemo) }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Failed') }
    setActionId(null); await refresh()
  }

  const confirmReject = async (id: string) => {
    setActionId(id); setActionError('')
    try { await reviewTestimonial(id, 'rejected', sanitizeText(rejectNotes[id] ?? '', 500) || undefined, isDemo) }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Failed') }
    setRejectMode(p => ({ ...p, [id]: false }))
    setActionId(null); await refresh()
  }

  const handleDelete = async (t: Testimonial) => {
    if (!confirm(`Permanently delete ${t.coachName}'s testimonial from ${t.athlete}?`)) return
    setActionId(t.id); setActionError('')
    try { await deleteTestimonial(t.id, isDemo) }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Failed') }
    setActionId(null); await refresh()
  }

  // ── Create / edit form ──────────────────────────────────────────────────
  // The head coach can author or fix any coach's testimonial here. "Feature on
  // homepage" does the approval in the same step (create → request → approve),
  // so this panel is a full CRUD surface and not just a review queue.
  type FormState = {
    coachSlug: string; athlete: string; result: string; quote: string
    photo: string; showOnCoach: boolean; featureHome: boolean
  }
  const BLANK: FormState = {
    coachSlug: COACHES[0].slug, athlete: '', result: '', quote: '',
    photo: '', showOnCoach: true, featureHome: false,
  }
  const [editingId, setEditingId] = useState<string | null>(null) // null when adding
  const [formOpen, setFormOpen]   = useState(false)
  const [form, setForm]           = useState<FormState>(BLANK)
  const [saving, setSaving]       = useState(false)

  const openCreate = () => { setEditingId(null); setForm(BLANK); setFormOpen(true); setActionError('') }
  const openEdit = (t: Testimonial) => {
    setEditingId(t.id)
    setForm({
      coachSlug: t.coachSlug, athlete: t.athlete, result: t.result ?? '',
      quote: t.quote, photo: t.photo ?? '', showOnCoach: t.showOnCoach,
      featureHome: t.mainStatus === 'approved' || t.mainStatus === 'pending',
    })
    setFormOpen(true); setActionError('')
  }
  const closeForm = () => { setFormOpen(false); setEditingId(null) }

  const saveForm = async () => {
    if (!form.quote.trim() || !form.athlete.trim()) {
      setActionError('Athlete name and quote are both required.')
      return
    }
    const coach = COACHES.find(c => c.slug === form.coachSlug)
    const coachName = coach?.name ?? form.coachSlug
    const input = {
      coachSlug: form.coachSlug, coachName,
      quote: form.quote, athlete: form.athlete, result: form.result,
      photo: form.photo, showOnCoach: form.showOnCoach,
      requestMainPage: form.featureHome,
    }
    setSaving(true); setActionError('')
    try {
      if (editingId === null) {
        const created = await createTestimonial(input, isDemo)
        // Featuring puts it in the queue at 'pending'; as the reviewer, approve it now.
        if (form.featureHome) await reviewTestimonial(created.id, 'approved', undefined, isDemo)
      } else {
        await updateTestimonial(editingId, input, isDemo)
        if (form.featureHome) await reviewTestimonial(editingId, 'approved', undefined, isDemo)
      }
      closeForm()
      await refresh()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not save the testimonial.')
    } finally {
      setSaving(false)
    }
  }

  const pendingCount = useMemo(() => items.filter(t => t.mainStatus === 'pending').length, [items])

  const visible = useMemo(() => items.filter(t => {
    if (coachFilter !== 'all' && t.coachSlug !== coachFilter) return false
    if (filter === 'pending')  return t.mainStatus === 'pending'
    if (filter === 'approved') return t.mainStatus === 'approved'
    return true
  }), [items, filter, coachFilter])

  return (
    <div style={{ padding: '2rem', maxWidth: 900 }}>
      {isDemo && <DemoBanner />}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {(['pending', 'approved', 'all'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...btn,
              background: filter === f ? '#272C84' : 'transparent',
              border: `1px solid ${filter === f ? '#272C84' : 'var(--border)'}`,
              color: filter === f ? '#fff' : 'var(--text-2)',
            }}
          >
            {f === 'pending' ? `Needs Review${pendingCount ? ` (${pendingCount})` : ''}` : f === 'approved' ? 'On Main Page' : 'All'}
          </button>
        ))}

        <select
          value={coachFilter}
          onChange={e => setCoachFilter(e.target.value)}
          style={{ ...inp, width: 'auto', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.45rem .7rem', appearance: 'none', cursor: 'pointer' }}
        >
          <option value="all">All coaches</option>
          {COACHES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>

        <button
          onClick={openCreate}
          style={{ ...btn, background: '#272C84', color: '#fff', marginLeft: 'auto' }}
        >
          + New Testimonial
        </button>
        <button
          onClick={refresh}
          style={{ ...btn, background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)' }}
        >
          Refresh
        </button>
      </div>

      {formOpen && (
        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.4rem', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '1rem' }}>
            {editingId === null ? 'New testimonial' : 'Edit testimonial'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
            <label style={{ display: 'block' }}>
              <span style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Coach</span>
              <select value={form.coachSlug} onChange={e => setForm(f => ({ ...f, coachSlug: e.target.value }))} style={{ ...inp, appearance: 'none', cursor: 'pointer' }}>
                {COACHES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: '.85rem', flexWrap: 'wrap' }}>
              <label style={{ flex: 1, minWidth: 200 }}>
                <span style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Athlete</span>
                <input style={inp} maxLength={200} value={form.athlete} onChange={e => setForm(f => ({ ...f, athlete: e.target.value }))} placeholder="Athlete's name" />
              </label>
              <label style={{ flex: 1, minWidth: 200 }}>
                <span style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Result <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></span>
                <input style={inp} maxLength={200} value={form.result} onChange={e => setForm(f => ({ ...f, result: e.target.value }))} placeholder="e.g. +45lb total in 12 weeks" />
              </label>
            </div>
            <label style={{ display: 'block' }}>
              <span style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Quote</span>
              <textarea style={{ ...inp, minHeight: 90, resize: 'vertical' }} maxLength={1500} value={form.quote} onChange={e => setForm(f => ({ ...f, quote: e.target.value }))} placeholder="What the athlete said…" />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Photo URL <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></span>
              <input style={inp} maxLength={1000} value={form.photo} onChange={e => setForm(f => ({ ...f, photo: e.target.value }))} placeholder="https://…" />
            </label>
            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', color: 'var(--text-2)', fontSize: '.8rem' }}>
                <input type="checkbox" checked={form.showOnCoach} onChange={e => setForm(f => ({ ...f, showOnCoach: e.target.checked }))} />
                Show on coach page
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', color: 'var(--text-2)', fontSize: '.8rem' }}>
                <input type="checkbox" checked={form.featureHome} onChange={e => setForm(f => ({ ...f, featureHome: e.target.checked }))} />
                Feature on homepage
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
            <button onClick={saveForm} disabled={saving} style={{ ...btn, background: '#22c55e', color: '#04240f', opacity: saving ? 0.5 : 1 }}>
              {saving ? 'Saving…' : editingId === null ? 'Create' : 'Save Changes'}
            </button>
            <button onClick={closeForm} disabled={saving} style={{ ...btn, background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <p style={{ color: '#c8102e', fontSize: '.75rem', fontWeight: 700, marginBottom: '1rem' }}>{actionError}</p>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>Loading…</p>
      ) : visible.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>
          {filter === 'pending' ? 'Nothing waiting on you. 🎉' : 'No testimonials match this filter.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--surface)' }}>
          {visible.map(t => {
            const color = STATUS_COLORS[t.mainStatus]
            return (
              <div key={t.id} style={{ background: 'var(--bg)', padding: '1.5rem' }}>
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.75rem', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                    {t.coachName}
                  </span>
                  <span style={{
                    background: color + '18', border: `1px solid ${color}`, color,
                    fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
                    padding: '.15rem .5rem', borderRadius: '.15rem',
                  }}>{MAIN_LABEL[t.mainStatus]}</span>
                  {!t.showOnCoach && (
                    <span style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                      · not on coach page
                    </span>
                  )}
                </div>

                <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.8 }}>"{t.quote}"</p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginTop: '.85rem', flexWrap: 'wrap' }}>
                  {t.photo && (
                    <img src={t.photo} alt={t.athlete} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)' }} />
                  )}
                  <div>
                    <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.8rem' }}>{t.athlete}</p>
                    {t.result && (
                      <p style={{ color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginTop: '.1rem' }}>{t.result}</p>
                    )}
                  </div>
                </div>

                {t.mainStatus === 'rejected' && t.rejectionNote && (
                  <p style={{ color: '#c8102e', fontSize: '.75rem', marginTop: '.75rem' }}>Your note: {t.rejectionNote}</p>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {t.mainStatus === 'pending' && !rejectMode[t.id] && (
                    <>
                      <button onClick={() => approve(t.id)} disabled={actionId === t.id}
                        style={{ ...btn, background: '#22c55e', color: '#04240f', opacity: actionId === t.id ? 0.5 : 1 }}>
                        {actionId === t.id ? 'Saving…' : 'Approve for Main Page'}
                      </button>
                      <button onClick={() => setRejectMode(p => ({ ...p, [t.id]: true }))}
                        style={{ ...btn, background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                        Decline
                      </button>
                    </>
                  )}

                  {t.mainStatus === 'pending' && rejectMode[t.id] && (
                    <div style={{ display: 'flex', gap: '.5rem', width: '100%', flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        style={{ ...inp, flex: 1, minWidth: 220 }}
                        maxLength={500}
                        placeholder="Reason (shown to the coach) — optional"
                        value={rejectNotes[t.id] ?? ''}
                        onChange={e => setRejectNotes(p => ({ ...p, [t.id]: e.target.value }))}
                      />
                      <button onClick={() => confirmReject(t.id)} disabled={actionId === t.id}
                        style={{ ...btn, background: '#c8102e', color: '#fff', opacity: actionId === t.id ? 0.5 : 1 }}>
                        {actionId === t.id ? 'Saving…' : 'Confirm Decline'}
                      </button>
                      <button onClick={() => setRejectMode(p => ({ ...p, [t.id]: false }))}
                        style={{ ...btn, background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                        Cancel
                      </button>
                    </div>
                  )}

                  {t.mainStatus === 'approved' && (
                    <button onClick={() => confirmReject(t.id)}
                      disabled={actionId === t.id}
                      style={{ ...btn, background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', opacity: actionId === t.id ? 0.5 : 1 }}>
                      {actionId === t.id ? 'Saving…' : 'Remove from Main Page'}
                    </button>
                  )}

                  <button onClick={() => openEdit(t)} disabled={actionId === t.id}
                    style={{ ...btn, background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', marginLeft: 'auto' }}>
                    Edit
                  </button>

                  <button onClick={() => handleDelete(t)} disabled={actionId === t.id}
                    style={{ ...btn, background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#c8102e'; e.currentTarget.style.color = '#c8102e' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-3)' }}>
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
