import { useState, useEffect, useCallback, useMemo } from 'react'
import { COACHES, getCoachBySlug } from '../../data/coaches'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { fetchAllContent } from '../../lib/contentApi'
import type { PendingContent } from '../../data/pendingContent'
import {
  fetchRotation, deriveStatuses, waiveCycle, formatCycleDate,
  createCycle, updateCycle, deleteCycle,
  type RotationStatus, type CycleState, type RotationCycle, type CycleInput,
} from '../../lib/rotationApi'
import { sanitizeText } from '../../utils/sanitize'
import { usePermissions } from '../../lib/usePermissions'

/** A waive reason is a sentence. window.prompt cannot cap it, so this does. */
const WAIVE_NOTE_MAX = 500

const STATE_STYLE: Record<CycleState, { border: string; fg: string; label: string }> = {
  overdue:   { border: '#c8102e',        fg: '#f87171',        label: 'Overdue' },
  due:       { border: '#272C84',        fg: 'var(--text)',    label: 'Due' },
  submitted: { border: '#272C84',        fg: 'var(--text)',    label: 'In Review' },
  complete:  { border: '#22c55e',        fg: '#22c55e',        label: 'Complete' },
  upcoming:  { border: 'var(--border)',  fg: 'var(--text-3)',  label: 'Upcoming' },
  waived:    { border: 'var(--border)',  fg: 'var(--text-3)',  label: 'Waived' },
}

// Cycles a coach still owes something on — what the head coach actually chases.
const NEEDS_ACTION: CycleState[] = ['overdue', 'due', 'submitted']

interface Props { isDemo?: boolean }

export default function RotationPanel({ isDemo = false }: Props) {
  // The schedule is `view_blog`; adding, reassigning and waiving a cycle is
  // `manage_blog` — 040 widens content_rotation with that same pair. Seeing
  // whose turn is next was always the point of a rotation, so the read side
  // stays whole and only the write controls come off.
  const { can } = usePermissions()
  const canManage = isDemo || can('*') || can('manage_blog')

  const [statuses, setStatuses] = useState<RotationStatus[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [showAll, setShowAll]   = useState(false)
  const [busyId, setBusyId]     = useState<string | null>(null)

  // ── Create / edit a cycle ──────────────────────────────────────────────────
  type FormState = CycleInput
  const BLANK: FormState = {
    coachSlug: COACHES[0].slug, cycleStart: '', dueDate: '', waived: false, waiveNote: '',
  }
  const [formOpen, setFormOpen]   = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null) // null → creating
  const [form, setForm]           = useState<FormState>(BLANK)
  const [saving, setSaving]       = useState(false)

  const openCreate = () => { setEditingId(null); setForm(BLANK); setFormOpen(true); setError('') }
  const openEdit = (c: RotationCycle) => {
    setEditingId(c.id)
    setForm({
      coachSlug: c.coachSlug, cycleStart: c.cycleStart, dueDate: c.dueDate,
      waived: c.waived, waiveNote: c.waiveNote ?? '',
    })
    setFormOpen(true); setError('')
  }
  const closeForm = () => { setFormOpen(false); setEditingId(null) }

  const saveForm = async () => {
    setSaving(true); setError('')
    try {
      if (editingId === null) await createCycle(form, isDemo)
      else                    await updateCycle(editingId, form, isDemo)
      closeForm()
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save that cycle.')
    } finally {
      setSaving(false)
    }
  }

  const removeCycle = async (c: RotationCycle) => {
    const coach = getCoachBySlug(c.coachSlug)
    if (!confirm(`Delete ${coach?.name ?? c.coachSlug}'s cycle due ${formatCycleDate(c.dueDate)}?`)) return
    setBusyId(c.id); setError('')
    try {
      await deleteCycle(c.id, isDemo)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not delete that cycle.')
    } finally {
      setBusyId(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [cycles, content] = await Promise.all([
        fetchRotation(isDemo),
        fetchAllContent(isDemo) as Promise<PendingContent[]>,
      ])
      setStatuses(deriveStatuses(cycles, content))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load the rotation schedule.')
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { load() }, [load])

  async function toggleWaive(s: RotationStatus) {
    const next = !s.cycle.waived
    let note: string | undefined
    if (next) {
      // window.prompt has no maxLength to give, so the only bound on what
      // reaches content_rotation.waive_note is this one.
      const answer = window.prompt('Reason for waiving this cycle? (optional)') ?? ''
      note = sanitizeText(answer, WAIVE_NOTE_MAX) || undefined
    }
    setBusyId(s.cycle.id)
    try {
      await waiveCycle(s.cycle.id, next, note, isDemo)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update that cycle.')
    } finally {
      setBusyId(null)
    }
  }

  // Per coach: the cycle that matters now — the oldest one still outstanding,
  // else the next one on the calendar.
  const currentPerCoach = useMemo(() => {
    return COACHES.map(coach => {
      const mine = statuses
        .filter(s => s.cycle.coachSlug === coach.slug)
        .sort((a, b) => a.cycle.dueDate.localeCompare(b.cycle.dueDate))
      const current =
        mine.find(s => s.state === 'overdue') ??
        mine.find(s => s.state === 'due') ??
        mine.find(s => s.state === 'submitted') ??
        mine.find(s => s.state === 'upcoming') ??
        mine[mine.length - 1]
      const completed = mine.filter(s => s.state === 'complete').length
      return { coach, current, completed, total: mine.length }
    })
  }, [statuses])

  const upcoming = useMemo(() => {
    const rows = statuses
      .slice()
      .sort((a, b) => a.cycle.dueDate.localeCompare(b.cycle.dueDate))
    return showAll ? rows : rows.filter(s => NEEDS_ACTION.includes(s.state))
  }, [statuses, showAll])

  const overdueCount = statuses.filter(s => s.state === 'overdue').length

  // Only the very first load blanks the panel. Post-mutation reloads keep the
  // existing schedule on screen (statuses is non-empty) and update in place, so
  // a waive/edit/delete/create doesn't flash the whole panel to a placeholder.
  if (loading && statuses.length === 0) return <div style={{ padding: '2rem' }}><p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>Loading rotation…</p></div>

  return (
    <div style={{ padding: '2rem', maxWidth: 1000 }}>
      {isDemo && <DemoBanner />}
      {error && (
        <div style={{ background: 'rgba(200,16,46,.08)', border: '1px solid #c8102e', borderRadius: '.25rem', padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <p style={{ color: '#f87171', fontSize: '.8rem', fontWeight: 700 }}>{error}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.7, maxWidth: 620 }}>
          Every coach contributes one blog every two months. Turns are staggered two weeks apart,
          so a post lands roughly every fortnight rather than five arriving at once.
          {overdueCount > 0 && (
            <>
              {' '}
              <strong style={{ color: '#f87171' }}>
                {overdueCount} cycle{overdueCount === 1 ? ' is' : 's are'} overdue.
              </strong>
            </>
          )}
        </p>
        {canManage && (
          <button
            onClick={openCreate}
            disabled={saving}
            style={{ background: '#272C84', border: 'none', color: '#fff', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.55rem 1.1rem', borderRadius: '.2rem', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', flexShrink: 0, opacity: saving ? .5 : 1 }}
          >
            + New Cycle
          </button>
        )}
      </div>

      {canManage && formOpen && (
        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.4rem', padding: '1.5rem', marginBottom: '2rem', maxWidth: 620 }}>
          <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '1rem' }}>
            {editingId === null ? 'New cycle' : 'Edit cycle'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
            <label style={{ display: 'block' }}>
              <span style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Coach</span>
              <select value={form.coachSlug} onChange={e => setForm(f => ({ ...f, coachSlug: e.target.value }))}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '.2rem', color: 'var(--text)', fontSize: '.875rem', padding: '.6rem .75rem', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', appearance: 'none', cursor: 'pointer' }}>
                {COACHES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: '.85rem', flexWrap: 'wrap' }}>
              <label style={{ flex: 1, minWidth: 180 }}>
                <span style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Cycle start</span>
                <input type="date" value={form.cycleStart} onChange={e => setForm(f => ({ ...f, cycleStart: e.target.value }))}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '.2rem', color: 'var(--text)', fontSize: '.875rem', padding: '.55rem .75rem', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              </label>
              <label style={{ flex: 1, minWidth: 180 }}>
                <span style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Due date</span>
                <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '.2rem', color: 'var(--text)', fontSize: '.875rem', padding: '.55rem .75rem', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              </label>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', color: 'var(--text-2)', fontSize: '.8rem' }}>
              <input type="checkbox" checked={form.waived === true} onChange={e => setForm(f => ({ ...f, waived: e.target.checked }))} />
              Waived (excused — won't read as overdue)
            </label>
            {form.waived && (
              <label style={{ display: 'block' }}>
                <span style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Waive reason <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></span>
                <input maxLength={500} value={form.waiveNote ?? ''} onChange={e => setForm(f => ({ ...f, waiveNote: e.target.value }))} placeholder="e.g. On leave through March"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '.2rem', color: 'var(--text)', fontSize: '.875rem', padding: '.6rem .75rem', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              </label>
            )}
          </div>
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
            <button onClick={saveForm} disabled={saving}
              style={{ background: '#22c55e', border: 'none', color: '#04240f', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.55rem 1.1rem', borderRadius: '.2rem', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: saving ? .5 : 1 }}>
              {saving ? 'Saving…' : editingId === null ? 'Create Cycle' : 'Save Changes'}
            </button>
            <button onClick={closeForm} disabled={saving}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1.1rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Per-coach summary ─────────────────────────────────────────────── */}
      <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>
        Coaches
      </p>
      {/* Bordered cards rather than a 1px-gap grid: the roster is an odd number,
          so a gap-grid leaves the trailing empty cell rendering as a filled box. */}
      <div style={{ display: 'grid', gap: '.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', marginBottom: '2.5rem' }}>
        {currentPerCoach.map(({ coach, current, completed, total }) => {
          const st = current ? STATE_STYLE[current.state] : STATE_STYLE.upcoming
          return (
            <div key={coach.slug} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '1.25rem 1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.5rem', flexWrap: 'wrap' }}>
                <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.875rem' }}>{coach.name}</p>
                {current && (
                  <span style={{
                    background: st.border, color: '#fff',
                    fontSize: '.5rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
                    padding: '.15rem .45rem', borderRadius: '.15rem',
                  }}>{st.label}</span>
                )}
              </div>
              {current ? (
                <p style={{ color: st.fg, fontSize: '.75rem' }}>
                  Due {formatCycleDate(current.cycle.dueDate)}
                  {current.state === 'overdue' && ` · ${Math.abs(current.daysUntilDue)}d late`}
                  {current.state === 'due'     && ` · ${current.daysUntilDue}d left`}
                </p>
              ) : (
                <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>No cycles scheduled.</p>
              )}
              <p style={{ color: 'var(--text-3)', fontSize: '.65rem', marginTop: '.4rem' }}>
                {completed} of {total} cycles published
              </p>
            </div>
          )
        })}
      </div>

      {/* ── Schedule ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase' }}>
          {showAll ? `Full Schedule (${upcoming.length})` : `Needs Attention (${upcoming.length})`}
        </p>
        <button
          onClick={() => setShowAll(v => !v)}
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.35rem .75rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {showAll ? 'Show Needs Attention' : 'Show Full Schedule'}
        </button>
      </div>

      {upcoming.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>
          Nothing outstanding — every coach is current on their rotation.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--surface)' }}>
          {upcoming.map(s => {
            const st = STATE_STYLE[s.state]
            const coach = getCoachBySlug(s.cycle.coachSlug)
            // Also locked while a form save is mid-flight, so a save-completion
            // closeForm() can't tear down a form opened by a click during it.
            const rowBusy = busyId === s.cycle.id || saving
            return (
              <div key={s.cycle.id} style={{ background: 'var(--bg)', padding: '1rem 1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{
                  border: `1px solid ${st.border}`, color: st.fg,
                  fontSize: '.5rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
                  padding: '.2rem .5rem', borderRadius: '.15rem', flexShrink: 0, minWidth: 74, textAlign: 'center',
                }}>{st.label}</span>

                <div style={{ flex: 1, minWidth: 200 }}>
                  <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.8rem' }}>
                    {coach?.name ?? s.cycle.coachSlug}
                  </p>
                  <p style={{ color: 'var(--text-3)', fontSize: '.7rem', marginTop: '.15rem' }}>
                    {formatCycleDate(s.cycle.cycleStart)} → due {formatCycleDate(s.cycle.dueDate)}
                  </p>
                  {s.post && (
                    <p style={{ color: 'var(--text-2)', fontSize: '.72rem', marginTop: '.25rem' }}>
                      “{s.post.title}”
                    </p>
                  )}
                  {s.cycle.waived && s.cycle.waiveNote && (
                    <p style={{ color: 'var(--text-3)', fontSize: '.7rem', marginTop: '.25rem' }}>
                      Waived — {s.cycle.waiveNote}
                    </p>
                  )}
                </div>

                {/* Waive, edit and delete are all writes to content_rotation,
                    which is manage_blog. A view_blog holder keeps the row. */}
                {canManage && <div style={{ display: 'flex', gap: '.4rem', flexShrink: 0, flexWrap: 'wrap' }}>
                  {/* A published cycle is settled; waiving it would be meaningless. */}
                  {s.state !== 'complete' && (
                    <button
                      onClick={() => toggleWaive(s)}
                      disabled={rowBusy}
                      style={{
                        background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)',
                        fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                        padding: '.35rem .75rem', borderRadius: '.2rem', fontFamily: 'inherit',
                        cursor: rowBusy ? 'not-allowed' : 'pointer',
                        opacity: rowBusy ? .4 : 1,
                      }}
                    >
                      {busyId === s.cycle.id ? '…' : s.cycle.waived ? 'Un-waive' : 'Waive'}
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(s.cycle)}
                    disabled={rowBusy}
                    style={{
                      background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)',
                      fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                      padding: '.35rem .75rem', borderRadius: '.2rem', fontFamily: 'inherit',
                      cursor: rowBusy ? 'not-allowed' : 'pointer', opacity: rowBusy ? .5 : 1,
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => removeCycle(s.cycle)}
                    disabled={rowBusy}
                    style={{
                      background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)',
                      fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                      padding: '.35rem .75rem', borderRadius: '.2rem', fontFamily: 'inherit',
                      cursor: rowBusy ? 'not-allowed' : 'pointer',
                      opacity: rowBusy ? .4 : 1,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#c8102e'; e.currentTarget.style.color = '#c8102e' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-3)' }}
                  >
                    Delete
                  </button>
                </div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
