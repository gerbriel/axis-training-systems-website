import { useState, useEffect, useCallback, useMemo } from 'react'
import type { CSSProperties } from 'react'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { fetchAllContent } from '../../lib/contentApi'
import type { PendingContent } from '../../data/pendingContent'
import {
  fetchRotation, deriveStatuses, waiveCycle, formatCycleDate,
  updateCycle, deleteCycle,
  fetchPlan, savePlan, planAssignments, generateSchedule,
  createCycles, deleteCycles, waiveCycles,
  type RotationStatus, type CycleState, type RotationCycle,
  type RotationPlan, type RotationUnit,
} from '../../lib/rotationApi'
import { fetchCoachRoster, type RosterCoach } from '../../lib/coachRoster'
import { sanitizeText } from '../../utils/sanitize'
import { usePermissions } from '../../lib/usePermissions'

/** A waive reason is a sentence. window.prompt cannot cap it, so this does. */
const WAIVE_NOTE_MAX = 500

/** planAssignments caps at 60, and so does the box that asks for a number. */
const MAX_GENERATE = 60

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

// The panel's existing visual idioms, named once rather than retyped at every
// new control. Same values the form below has always used inline.
const LABEL: CSSProperties = {
  color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em',
  textTransform: 'uppercase', display: 'block', marginBottom: '.35rem',
}
const INPUT: CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '.2rem',
  color: 'var(--text)', fontSize: '.875rem', padding: '.55rem .75rem',
  width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
}
const GHOST: CSSProperties = {
  background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)',
  fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
  padding: '.35rem .75rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit',
}
const SECTION: CSSProperties = {
  color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.2em',
  textTransform: 'uppercase',
}
const CARD: CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)',
  borderRadius: '.4rem', padding: '1.5rem', marginBottom: '2rem',
}

const UNITS: { value: RotationUnit; one: string; many: string }[] = [
  { value: 'day',   one: 'day',   many: 'days' },
  { value: 'week',  one: 'week',  many: 'weeks' },
  { value: 'month', one: 'month', many: 'months' },
]

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function cadenceSentence(plan: RotationPlan): string {
  const unit = UNITS.find(u => u.value === plan.everyUnit) ?? UNITS[1]
  return `Every ${plural(plan.everyCount, unit.one, unit.many)}`
}

/** Comparable form of a plan, so "has this been edited" is one string compare. */
const planKey = (p: RotationPlan | null): string =>
  p ? JSON.stringify([p.members, p.everyCount, p.everyUnit, p.anchor]) : ''

interface Props { isDemo?: boolean }

export default function RotationPanel({ isDemo = false }: Props) {
  // The schedule is `view_blog`; adding, reassigning and waiving a cycle is
  // `manage_blog` — 040 widens content_rotation with that same pair, and 046
  // gives rotation_plans the same two depths. Seeing whose turn is next was
  // always the point of a rotation, so the read side stays whole and only the
  // write controls come off.
  const { can } = usePermissions()
  const canManage = isDemo || can('*') || can('manage_blog')

  const [statuses, setStatuses] = useState<RotationStatus[]>([])
  const [roster, setRoster]     = useState<RosterCoach[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [notice, setNotice]     = useState('')
  const [showAll, setShowAll]   = useState(false)
  const [busyId, setBusyId]     = useState<string | null>(null)

  // ── The plan (046) ─────────────────────────────────────────────────────────
  // `plan` is what is saved, `draft` is what is on screen. They are compared to
  // decide whether there are unsaved changes, and the preview always reads the
  // draft so the calendar moves while the admin is still choosing.
  const [plan, setPlan]           = useState<RotationPlan | null>(null)
  const [draft, setDraft]         = useState<RotationPlan | null>(null)
  const [planSaving, setPlanSaving] = useState(false)
  const [addOpen, setAddOpen]     = useState(false)
  const [addPicks, setAddPicks]   = useState<string[]>([])
  const [genCount, setGenCount]   = useState('10')
  const [generating, setGenerating] = useState(false)

  // ── Bulk selection on the schedule ─────────────────────────────────────────
  const [selected, setSelected] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)

  const rosterBySlug = useMemo(
    () => new Map(roster.map(c => [c.slug, c])),
    [roster],
  )

  /**
   * A coach's name from the LIVE roster, falling back to their slug.
   *
   * Not `getCoachBySlug` any more. That reads src/data/coaches.ts, the founding
   * five, and a coach provisioned through 036 rendered as a raw slug in every
   * row of this panel.
   */
  const coachName = useCallback(
    (slug: string) => rosterBySlug.get(slug)?.name ?? slug,
    [rosterBySlug],
  )

  // ── Create / edit a cycle ──────────────────────────────────────────────────
  // Creating takes a LIST of coaches (one cycle each, same window); editing an
  // existing cycle stays single, because a cycle belongs to one person.
  interface FormState {
    coachSlugs: string[]
    cycleStart: string
    dueDate: string
    waived: boolean
    waiveNote: string
  }
  const BLANK: FormState = { coachSlugs: [], cycleStart: '', dueDate: '', waived: false, waiveNote: '' }
  const [formOpen, setFormOpen]   = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null) // null → creating
  const [form, setForm]           = useState<FormState>(BLANK)
  const [saving, setSaving]       = useState(false)

  const clearBanners = () => { setError(''); setNotice('') }

  const openCreate = () => { setEditingId(null); setForm(BLANK); setFormOpen(true); clearBanners() }
  const openEdit = (c: RotationCycle) => {
    setEditingId(c.id)
    setForm({
      coachSlugs: [c.coachSlug], cycleStart: c.cycleStart, dueDate: c.dueDate,
      waived: c.waived, waiveNote: c.waiveNote ?? '',
    })
    setFormOpen(true); clearBanners()
  }
  const closeForm = () => { setFormOpen(false); setEditingId(null) }

  // Everything except the plan. Run after every schedule write, so an unsaved
  // plan edit is never wiped by a waive or a delete somewhere else on screen.
  const reload = useCallback(async () => {
    const [cycles, content] = await Promise.all([
      fetchRotation(isDemo),
      fetchAllContent(isDemo) as Promise<PendingContent[]>,
    ])
    setStatuses(deriveStatuses(cycles, content))
    // A selected row that has just been deleted is not a selection any more.
    setSelected(prev => prev.filter(id => cycles.some(c => c.id === id)))
  }, [isDemo])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [cycles, content, people, saved] = await Promise.all([
        fetchRotation(isDemo),
        fetchAllContent(isDemo) as Promise<PendingContent[]>,
        // includeHidden: a coach provisioned an hour ago has not been made
        // visible on the public site yet and must still be schedulable.
        fetchCoachRoster(isDemo, { includeHidden: true }),
        fetchPlan(isDemo),
      ])
      setStatuses(deriveStatuses(cycles, content))
      setRoster(people)
      setPlan(saved)
      setDraft(saved)
      setGenCount(String(Math.min(MAX_GENERATE, Math.max(1, saved.members.length * 2))))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load the rotation schedule.')
    } finally {
      setLoading(false)
    }
  }, [isDemo])

  useEffect(() => { load() }, [load])

  const saveForm = async () => {
    setSaving(true); clearBanners()
    try {
      if (editingId === null) {
        // Checked against the LIVE roster here, which is the only place that
        // knows who currently exists. rotationApi keeps the slug shape only.
        const strangers = form.coachSlugs.filter(s => !rosterBySlug.has(s))
        if (strangers.length > 0) {
          throw new Error(`${strangers.join(', ')} is no longer on the roster. Refresh and pick again.`)
        }
        const result = await createCycles(
          form.coachSlugs,
          { cycleStart: form.cycleStart, dueDate: form.dueDate },
          isDemo,
        )
        setNotice(`Created ${result.created}, skipped ${result.skipped} already scheduled.`)
      } else {
        // No roster check on an edit: the coach on an existing cycle may have
        // left, and moving that cycle's dates must not be blocked by it.
        await updateCycle(
          editingId,
          {
            coachSlug: form.coachSlugs[0] ?? '',
            cycleStart: form.cycleStart,
            dueDate: form.dueDate,
            waived: form.waived,
            waiveNote: form.waiveNote,
          },
          isDemo,
        )
      }
      closeForm()
      await reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save that cycle.')
    } finally {
      setSaving(false)
    }
  }

  const removeCycle = async (c: RotationCycle) => {
    if (!confirm(`Delete ${coachName(c.coachSlug)}'s cycle due ${formatCycleDate(c.dueDate)}?`)) return
    setBusyId(c.id); clearBanners()
    try {
      await deleteCycle(c.id, isDemo)
      await reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not delete that cycle.')
    } finally {
      setBusyId(null)
    }
  }

  async function toggleWaive(s: RotationStatus) {
    const next = !s.cycle.waived
    let note: string | undefined
    if (next) {
      // window.prompt has no maxLength to give, so the only bound on what
      // reaches content_rotation.waive_note is this one.
      const answer = window.prompt('Reason for waiving this cycle? (optional)') ?? ''
      note = sanitizeText(answer, WAIVE_NOTE_MAX) || undefined
    }
    setBusyId(s.cycle.id); clearBanners()
    try {
      await waiveCycle(s.cycle.id, next, note, isDemo)
      await reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update that cycle.')
    } finally {
      setBusyId(null)
    }
  }

  // ── Plan editing ───────────────────────────────────────────────────────────

  const patchPlan = (patch: Partial<RotationPlan>) =>
    setDraft(d => (d ? { ...d, ...patch } : d))

  const moveMember = (index: number, by: number) => {
    setDraft(d => {
      if (!d) return d
      const next = [...d.members]
      const to = index + by
      if (to < 0 || to >= next.length) return d
      const [moved] = next.splice(index, 1)
      next.splice(to, 0, moved)
      return { ...d, members: next }
    })
  }

  const removeMember = (slug: string) =>
    setDraft(d => (d ? { ...d, members: d.members.filter(m => m !== slug) } : d))

  const addMembers = () => {
    setDraft(d => (d ? { ...d, members: [...d.members, ...addPicks.filter(s => !d.members.includes(s))] } : d))
    setAddPicks([])
    setAddOpen(false)
  }

  const planDirty = planKey(draft) !== planKey(plan)

  const savePlanNow = async () => {
    if (!draft) return
    setPlanSaving(true); clearBanners()
    try {
      await savePlan(draft, isDemo)
      // Read it back rather than trusting the draft: savePlan trims, and a
      // silent RLS refusal on the write would otherwise leave the screen
      // claiming a plan the database never took.
      const fresh = await fetchPlan(isDemo)
      setPlan(fresh)
      setDraft(fresh)
      setNotice('Rotation plan saved.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save the rotation plan.')
    } finally {
      setPlanSaving(false)
    }
  }

  const runGenerate = async () => {
    if (!draft) return
    setGenerating(true); clearBanners()
    try {
      const wanted = Math.min(MAX_GENERATE, Math.max(1, Math.floor(Number(genCount)) || 0))
      const result = await generateSchedule(draft, wanted, isDemo)
      setNotice(`Created ${result.created}, skipped ${result.skipped} already scheduled.`)
      // New turns are all in the future, and the default view only lists what
      // needs attention. Show the full schedule so the work is visible.
      if (result.created > 0) setShowAll(true)
      await reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not generate those assignments.')
    } finally {
      setGenerating(false)
    }
  }

  // ── Bulk actions ───────────────────────────────────────────────────────────

  const bulkWaive = async (waived: boolean) => {
    let note: string | undefined
    if (waived) {
      const answer = window.prompt(
        `Reason for waiving ${plural(selected.length, 'cycle', 'cycles')}? (optional)`,
      )
      // Cancel aborts. On a single row a stray cancel waives one cycle with no
      // note; on a batch it would waive every one of them.
      if (answer === null) return
      note = sanitizeText(answer, WAIVE_NOTE_MAX) || undefined
    }
    setBulkBusy(true); clearBanners()
    try {
      const n = await waiveCycles(selected, waived, note, isDemo)
      setSelected([])
      setNotice(`${waived ? 'Waived' : 'Un-waived'} ${plural(n, 'cycle', 'cycles')}.`)
      await reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update those cycles.')
    } finally {
      setBulkBusy(false)
    }
  }

  const bulkDelete = async () => {
    if (!confirm(`Delete ${plural(selected.length, 'cycle', 'cycles')} from the schedule? This cannot be undone.`)) return
    setBulkBusy(true); clearBanners()
    try {
      const n = await deleteCycles(selected, isDemo)
      setSelected([])
      setNotice(`Deleted ${plural(n, 'cycle', 'cycles')}.`)
      await reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not delete those cycles.')
    } finally {
      setBulkBusy(false)
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  // Per coach: the cycle that matters now — the oldest one still outstanding,
  // else the next one on the calendar. Over the live roster, so a coach added
  // last week has a card instead of being invisible here.
  const currentPerCoach = useMemo(() => {
    return roster.map(coach => {
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
  }, [statuses, roster])

  const upcoming = useMemo(() => {
    const rows = statuses
      .slice()
      .sort((a, b) => a.cycle.dueDate.localeCompare(b.cycle.dueDate))
    return showAll ? rows : rows.filter(s => NEEDS_ACTION.includes(s.state))
  }, [statuses, showAll])

  const overdueCount = statuses.filter(s => s.state === 'overdue').length

  const preview = useMemo(() => (draft ? planAssignments(draft, 8) : []), [draft])

  const addable = useMemo(
    () => roster.filter(c => !(draft?.members ?? []).includes(c.slug)),
    [roster, draft],
  )

  const strayMembers = useMemo(
    () => (draft?.members ?? []).filter(slug => !rosterBySlug.has(slug)),
    [draft, rosterBySlug],
  )

  const visibleIds = upcoming.map(s => s.cycle.id)
  const allShownSelected = visibleIds.length > 0 && visibleIds.every(id => selected.includes(id))
  const toggleRow = (id: string) =>
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  const toggleAllShown = () => setSelected(allShownSelected ? [] : visibleIds)

  // The coach on an existing cycle may have left the roster since it was
  // scheduled. They stay in the select, named as themselves, so their dates can
  // still be moved and their cycle reassigned to somebody who is still here.
  const editingSlug = editingId !== null ? (form.coachSlugs[0] ?? '') : ''
  const editOptions: { slug: string; name: string }[] =
    editingSlug !== '' && !rosterBySlug.has(editingSlug)
      ? [{ slug: editingSlug, name: `${editingSlug} (not on the roster)` }, ...roster]
      : roster

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
      {notice && (
        <div style={{ background: 'rgba(34,197,94,.08)', border: '1px solid #22c55e', borderRadius: '.25rem', padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <p style={{ color: '#22c55e', fontSize: '.8rem', fontWeight: 700 }}>{notice}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.7, maxWidth: 620 }}>
          Coaches take turns writing the blog. The plan below sets who is in the rotation,
          the order they go in, and how often a turn comes round.
          {plan && ` Right now: ${cadenceSentence(plan).toLowerCase()}, ${plural(plan.members.length, 'coach', 'coaches')} in the loop.`}
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

      {/* ── Rotation plan ─────────────────────────────────────────────────── */}
      {draft && (
        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase' }}>
              Rotation plan
            </p>
            {planDirty && (
              <span style={{ color: '#f87171', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                Unsaved changes
              </span>
            )}
          </div>

          <p style={{ color: 'var(--text-3)', fontSize: '.72rem', lineHeight: 1.7, marginBottom: '1.25rem' }}>
            Turns go in this order, top to bottom, then back to the top. Editing the plan
            changes nothing already on the schedule. Generating from it only ever adds.
          </p>

          {/* Members, in rotation order */}
          <p style={{ ...SECTION, marginBottom: '.6rem' }}>Order</p>
          {draft.members.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: '.8rem', marginBottom: '1rem' }}>
              Nobody is in the rotation yet. Add a coach to start one.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--border)', marginBottom: '1rem', borderRadius: '.2rem', overflow: 'hidden' }}>
              {draft.members.map((slug, i) => {
                const known = rosterBySlug.get(slug)
                return (
                  <div key={slug} style={{ background: 'var(--bg)', padding: '.6rem .85rem', display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-3)', fontSize: '.7rem', fontWeight: 700, minWidth: 18 }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <p style={{ color: 'var(--text)', fontSize: '.8rem', fontWeight: 700 }}>{known?.name ?? slug}</p>
                      {!known && (
                        <p style={{ color: '#f87171', fontSize: '.65rem', marginTop: '.1rem' }}>
                          Not on the roster
                        </p>
                      )}
                    </div>
                    {canManage && (
                      <div style={{ display: 'flex', gap: '.3rem', flexShrink: 0 }}>
                        <button onClick={() => moveMember(i, -1)} disabled={i === 0}
                          title="Move up"
                          style={{ ...GHOST, padding: '.25rem .55rem', opacity: i === 0 ? .3 : 1, cursor: i === 0 ? 'not-allowed' : 'pointer' }}>
                          ↑
                        </button>
                        <button onClick={() => moveMember(i, 1)} disabled={i === draft.members.length - 1}
                          title="Move down"
                          style={{ ...GHOST, padding: '.25rem .55rem', opacity: i === draft.members.length - 1 ? .3 : 1, cursor: i === draft.members.length - 1 ? 'not-allowed' : 'pointer' }}>
                          ↓
                        </button>
                        <button onClick={() => removeMember(slug)} style={{ ...GHOST, padding: '.25rem .55rem', color: 'var(--text-3)' }}>
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {strayMembers.length > 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: '.7rem', marginBottom: '1rem', lineHeight: 1.6 }}>
              {plural(strayMembers.length, 'coach', 'coaches')} in this rotation
              {strayMembers.length === 1 ? ' is' : ' are'} no longer on the roster. They keep their
              place until you remove them, and turns will still be generated for them.
            </p>
          )}

          {/* Add coaches: a checkbox list, one Add button */}
          {canManage && (
            <div style={{ marginBottom: '1.25rem' }}>
              {!addOpen ? (
                <button
                  onClick={() => { setAddOpen(true); setAddPicks([]) }}
                  disabled={addable.length === 0}
                  style={{ ...GHOST, opacity: addable.length === 0 ? .4 : 1, cursor: addable.length === 0 ? 'not-allowed' : 'pointer' }}
                >
                  {addable.length === 0 ? 'Every coach is in the rotation' : '+ Add coaches'}
                </button>
              ) : (
                <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '1rem' }}>
                  <p style={{ ...LABEL, marginBottom: '.6rem' }}>Add to the rotation</p>
                  <div style={{ display: 'grid', gap: '.4rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: '.9rem' }}>
                    {addable.map(c => (
                      <label key={c.slug} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', color: 'var(--text-2)', fontSize: '.8rem' }}>
                        <input
                          type="checkbox"
                          checked={addPicks.includes(c.slug)}
                          onChange={e => setAddPicks(prev => (e.target.checked ? [...prev, c.slug] : prev.filter(s => s !== c.slug)))}
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '.5rem' }}>
                    <button onClick={addMembers} disabled={addPicks.length === 0}
                      style={{ ...GHOST, borderColor: '#272C84', color: 'var(--text)', opacity: addPicks.length === 0 ? .4 : 1, cursor: addPicks.length === 0 ? 'not-allowed' : 'pointer' }}>
                      Add {addPicks.length > 0 ? `(${addPicks.length})` : ''}
                    </button>
                    <button onClick={() => { setAddOpen(false); setAddPicks([]) }} style={GHOST}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Frequency + anchor */}
          {canManage ? (
            <div style={{ display: 'flex', gap: '.85rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
              <label style={{ flex: '0 0 120px' }}>
                <span style={LABEL}>Every</span>
                <input
                  type="number" min={1} max={365}
                  value={draft.everyCount || ''}
                  onChange={e => patchPlan({ everyCount: Math.floor(Number(e.target.value)) || 0 })}
                  style={INPUT}
                />
              </label>
              <label style={{ flex: '0 0 160px' }}>
                <span style={LABEL}>Unit</span>
                <select
                  value={draft.everyUnit}
                  onChange={e => patchPlan({ everyUnit: e.target.value as RotationUnit })}
                  style={{ ...INPUT, appearance: 'none', cursor: 'pointer' }}
                >
                  {UNITS.map(u => <option key={u.value} value={u.value}>{u.many}</option>)}
                </select>
              </label>
              <label style={{ flex: 1, minWidth: 180 }}>
                <span style={LABEL}>First turn due</span>
                <input
                  type="date"
                  value={draft.anchor}
                  onChange={e => patchPlan({ anchor: e.target.value })}
                  style={INPUT}
                />
              </label>
            </div>
          ) : (
            <p style={{ color: 'var(--text-2)', fontSize: '.8rem', marginBottom: '1.25rem' }}>
              {cadenceSentence(draft)}, counting from {draft.anchor ? formatCycleDate(draft.anchor) : 'no start date yet'}.
            </p>
          )}

          {/* Preview */}
          <p style={{ ...SECTION, marginBottom: '.6rem' }}>Next 8 turns</p>
          {preview.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>
              Add a coach and pick a start date to see the rotation.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--border)', borderRadius: '.2rem', overflow: 'hidden' }}>
              {preview.map((a, i) => (
                <div key={`${a.coachSlug}-${a.dueDate}-${i}`} style={{ background: 'var(--bg)', padding: '.55rem .85rem', display: 'flex', gap: '.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-3)', fontSize: '.7rem', fontWeight: 700, minWidth: 18 }}>{i + 1}</span>
                  <span style={{ color: 'var(--text)', fontSize: '.8rem', fontWeight: 700, flex: 1, minWidth: 140 }}>
                    {coachName(a.coachSlug)}
                  </span>
                  <span style={{ color: 'var(--text-2)', fontSize: '.75rem' }}>
                    due {formatCycleDate(a.dueDate)}
                  </span>
                  <span style={{ color: 'var(--text-3)', fontSize: '.7rem' }}>
                    window opens {formatCycleDate(a.cycleStart)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Save + generate */}
          {canManage && (
            <div style={{ display: 'flex', gap: '.75rem', marginTop: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <button
                onClick={savePlanNow}
                disabled={planSaving || !planDirty}
                style={{ background: '#22c55e', border: 'none', color: '#04240f', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.55rem 1.1rem', borderRadius: '.2rem', cursor: planSaving || !planDirty ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: planSaving || !planDirty ? .5 : 1 }}
              >
                {planSaving ? 'Saving…' : 'Save Plan'}
              </button>

              <label style={{ width: 90 }}>
                <span style={LABEL}>How many</span>
                <input
                  type="number" min={1} max={MAX_GENERATE}
                  value={genCount}
                  onChange={e => setGenCount(e.target.value)}
                  style={INPUT}
                />
              </label>
              <button
                onClick={runGenerate}
                disabled={generating || planDirty || draft.members.length === 0 || preview.length === 0}
                title={planDirty ? 'Save the plan first' : undefined}
                style={{ ...GHOST, borderColor: '#272C84', color: 'var(--text)', padding: '.55rem 1.1rem', opacity: generating || planDirty || preview.length === 0 ? .4 : 1, cursor: generating || planDirty || preview.length === 0 ? 'not-allowed' : 'pointer' }}
              >
                {generating ? 'Generating…' : 'Generate Assignments'}
              </button>
              {planDirty && (
                <p style={{ color: 'var(--text-3)', fontSize: '.7rem', paddingBottom: '.6rem' }}>
                  Save the plan before generating from it.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {canManage && formOpen && (
        <div style={{ ...CARD, maxWidth: 620 }}>
          <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '1rem' }}>
            {editingId === null ? 'New cycles' : 'Edit cycle'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
            {editingId === null ? (
              <div>
                <span style={LABEL}>Coaches <span style={{ textTransform: 'none', fontWeight: 400 }}>(one cycle each, same window)</span></span>
                <div style={{ display: 'grid', gap: '.4rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.2rem', padding: '.75rem' }}>
                  {roster.map(c => (
                    <label key={c.slug} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', color: 'var(--text-2)', fontSize: '.8rem' }}>
                      <input
                        type="checkbox"
                        checked={form.coachSlugs.includes(c.slug)}
                        onChange={e => setForm(f => ({
                          ...f,
                          coachSlugs: e.target.checked
                            ? [...f.coachSlugs, c.slug]
                            : f.coachSlugs.filter(s => s !== c.slug),
                        }))}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
                  <button onClick={() => setForm(f => ({ ...f, coachSlugs: roster.map(c => c.slug) }))} style={GHOST}>
                    Select all
                  </button>
                  <button onClick={() => setForm(f => ({ ...f, coachSlugs: [] }))} style={GHOST}>
                    Clear
                  </button>
                  {draft && draft.members.length > 0 && (
                    <button onClick={() => setForm(f => ({ ...f, coachSlugs: [...draft.members] }))} style={GHOST}>
                      Everyone in the plan
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <label style={{ display: 'block' }}>
                <span style={LABEL}>Coach</span>
                <select
                  value={form.coachSlugs[0] ?? ''}
                  onChange={e => setForm(f => ({ ...f, coachSlugs: [e.target.value] }))}
                  style={{ ...INPUT, padding: '.6rem .75rem', appearance: 'none', cursor: 'pointer' }}
                >
                  {editOptions.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                </select>
              </label>
            )}
            <div style={{ display: 'flex', gap: '.85rem', flexWrap: 'wrap' }}>
              <label style={{ flex: 1, minWidth: 180 }}>
                <span style={LABEL}>Cycle start</span>
                <input type="date" value={form.cycleStart} onChange={e => setForm(f => ({ ...f, cycleStart: e.target.value }))} style={INPUT} />
              </label>
              <label style={{ flex: 1, minWidth: 180 }}>
                <span style={LABEL}>Due date</span>
                <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} style={INPUT} />
              </label>
            </div>
            {/* Waiving is per cycle and belongs to a cycle that exists. A batch
                created pre-excused would be a schedule nobody owes anything on. */}
            {editingId !== null && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', color: 'var(--text-2)', fontSize: '.8rem' }}>
                  <input type="checkbox" checked={form.waived} onChange={e => setForm(f => ({ ...f, waived: e.target.checked }))} />
                  Waived (excused, will not read as overdue)
                </label>
                {form.waived && (
                  <label style={{ display: 'block' }}>
                    <span style={LABEL}>Waive reason <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></span>
                    <input maxLength={500} value={form.waiveNote} onChange={e => setForm(f => ({ ...f, waiveNote: e.target.value }))} placeholder="e.g. On leave through March" style={{ ...INPUT, padding: '.6rem .75rem' }} />
                  </label>
                )}
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem', alignItems: 'center' }}>
            <button onClick={saveForm} disabled={saving || (editingId === null && form.coachSlugs.length === 0)}
              style={{ background: '#22c55e', border: 'none', color: '#04240f', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.55rem 1.1rem', borderRadius: '.2rem', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: saving || (editingId === null && form.coachSlugs.length === 0) ? .5 : 1 }}>
              {saving
                ? 'Saving…'
                : editingId === null
                  ? `Create ${plural(form.coachSlugs.length, 'Cycle', 'Cycles')}`
                  : 'Save Changes'}
            </button>
            <button onClick={closeForm} disabled={saving} style={{ ...GHOST, padding: '.55rem 1.1rem' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Per-coach summary ─────────────────────────────────────────────── */}
      <p style={{ ...SECTION, marginBottom: '1rem' }}>
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
        <p style={SECTION}>
          {showAll ? `Full Schedule (${upcoming.length})` : `Needs Attention (${upcoming.length})`}
        </p>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {canManage && upcoming.length > 0 && (
            <button onClick={toggleAllShown} style={GHOST}>
              {allShownSelected ? 'Clear Selection' : `Select All (${upcoming.length})`}
            </button>
          )}
          <button onClick={() => setShowAll(v => !v)} style={GHOST}>
            {showAll ? 'Show Needs Attention' : 'Show Full Schedule'}
          </button>
        </div>
      </div>

      {/* Bulk action bar. Only when something is selected, so it never occupies
          the schedule's header on a screen nobody is acting on. */}
      {canManage && selected.length > 0 && (
        <div style={{ background: 'var(--surface-2)', border: '1px solid #272C84', borderRadius: '.25rem', padding: '.75rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text)', fontSize: '.75rem', fontWeight: 700, marginRight: '.25rem' }}>
            {plural(selected.length, 'cycle', 'cycles')} selected
          </span>
          <button onClick={() => bulkWaive(true)} disabled={bulkBusy} style={{ ...GHOST, opacity: bulkBusy ? .4 : 1, cursor: bulkBusy ? 'not-allowed' : 'pointer' }}>
            Waive Selected
          </button>
          <button onClick={() => bulkWaive(false)} disabled={bulkBusy} style={{ ...GHOST, opacity: bulkBusy ? .4 : 1, cursor: bulkBusy ? 'not-allowed' : 'pointer' }}>
            Un-waive Selected
          </button>
          <button
            onClick={bulkDelete}
            disabled={bulkBusy}
            style={{ ...GHOST, color: 'var(--text-3)', opacity: bulkBusy ? .4 : 1, cursor: bulkBusy ? 'not-allowed' : 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#c8102e'; e.currentTarget.style.color = '#c8102e' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-3)' }}
          >
            Delete Selected
          </button>
          <button onClick={() => setSelected([])} disabled={bulkBusy} style={{ ...GHOST, border: 'none', color: 'var(--text-3)' }}>
            Clear
          </button>
        </div>
      )}

      {upcoming.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>
          Nothing outstanding. Every coach is current on their rotation.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--surface)' }}>
          {upcoming.map(s => {
            const st = STATE_STYLE[s.state]
            // Also locked while a form save is mid-flight, so a save-completion
            // closeForm() can't tear down a form opened by a click during it.
            const rowBusy = busyId === s.cycle.id || saving || bulkBusy
            return (
              <div key={s.cycle.id} style={{ background: 'var(--bg)', padding: '1rem 1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {canManage && (
                  <input
                    type="checkbox"
                    checked={selected.includes(s.cycle.id)}
                    onChange={() => toggleRow(s.cycle.id)}
                    disabled={bulkBusy}
                    aria-label={`Select ${coachName(s.cycle.coachSlug)} cycle due ${formatCycleDate(s.cycle.dueDate)}`}
                    style={{ flexShrink: 0, cursor: bulkBusy ? 'not-allowed' : 'pointer' }}
                  />
                )}
                <span style={{
                  border: `1px solid ${st.border}`, color: st.fg,
                  fontSize: '.5rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
                  padding: '.2rem .5rem', borderRadius: '.15rem', flexShrink: 0, minWidth: 74, textAlign: 'center',
                }}>{st.label}</span>

                <div style={{ flex: 1, minWidth: 200 }}>
                  <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.8rem' }}>
                    {coachName(s.cycle.coachSlug)}
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
                      Waived: {s.cycle.waiveNote}
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
                      style={{ ...GHOST, cursor: rowBusy ? 'not-allowed' : 'pointer', opacity: rowBusy ? .4 : 1 }}
                    >
                      {busyId === s.cycle.id ? '…' : s.cycle.waived ? 'Un-waive' : 'Waive'}
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(s.cycle)}
                    disabled={rowBusy}
                    style={{ ...GHOST, cursor: rowBusy ? 'not-allowed' : 'pointer', opacity: rowBusy ? .5 : 1 }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => removeCycle(s.cycle)}
                    disabled={rowBusy}
                    style={{ ...GHOST, color: 'var(--text-3)', cursor: rowBusy ? 'not-allowed' : 'pointer', opacity: rowBusy ? .4 : 1 }}
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
