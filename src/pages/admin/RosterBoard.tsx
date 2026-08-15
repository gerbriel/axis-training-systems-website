import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../lib/usePermissions'
import { useMediaQuery, MOBILE_QUERY } from '../../lib/dashboard'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { fetchPeople, personName } from '../../lib/userManagement'
import { fetchCoachAssignments, setCoachAssignment } from '../../lib/messagingApi'
import type { CoachAssignment } from '../../types/messaging'
import type { Profile } from '../../lib/account'
import {
  PHASES,
  currentBlocks,
  daysInPhase,
  endTrainingBlock,
  fetchTrainingBlocks,
  phaseMeta,
  startTrainingBlock,
} from '../../lib/trainingApi'
import type { TrainingBlock, TrainingPhase } from '../../lib/trainingApi'
import {
  UNASSIGNED_KEY,
  alsoWith,
  applySteps,
  buildBoard,
  canMoveAthletes,
  canSetPhase,
  encodeDrag,
  halfMoveWarning,
  invertStep,
  moveOptions,
  parseDragPayload,
  planMove,
} from '../../lib/rosterBoard'
import type { BoardCard, BoardColumn, DragPayload } from '../../lib/rosterBoard'

/**
 * The roster, as a board: one column per coach, one card per athlete, and a
 * leading Unassigned column that is the queue nobody should leave anybody in.
 *
 * WHY A BOARD AND NOT A TABLE. `athlete_coaches` is the table that decides who
 * an athlete may message at all, and until now it was edited one athlete at a
 * time from inside their profile pane. That shape answers "who coaches Devin"
 * and never answers "who is carrying twelve people while somebody else carries
 * three", which is the question a head coach actually opens this screen with.
 * Columns answer it at a glance and a move is a drag.
 *
 * WHAT A MOVE COSTS. There is no UPDATE grant on that table, deliberately, so
 * every move between two coaches is an INSERT and then a DELETE. The board is
 * optimistic across both and rolls back on the first, but a failure on the
 * SECOND is not a rollback situation: the insert really did land, the athlete
 * really does have two coaches, and the only honest thing to do is say so in a
 * sentence with the fix in it. `halfMoveWarning` is that sentence.
 *
 * DRAG IS THE DECORATION, NOT THE FEATURE. Every card carries a Move button
 * that opens a plain select and writes through exactly the same path, because
 * this app has no drag library, native HTML5 drag does not exist on touch, and
 * a board whose only affordance is a mouse gesture is a board half this gym
 * cannot use. The drag handle glyph is aria-hidden; the button is the real
 * control and the one screen readers and phones get.
 *
 * TWO PERMISSIONS, NOT ONE. Moving an athlete is a staffing decision and needs
 * admin or `manage_staff` (033). Running an athlete's training blocks is the
 * daily coaching job and reaches their own coaches too, which is what
 * `can_manage_training` (044) allows. Both checks here are signage: the
 * database refuses either way, and every refusal it sends back is printed
 * verbatim.
 */

const ACCENT = '#272C84'
const DANGER = '#c8102e'
const GREEN = '#22c55e'

const microLabel: React.CSSProperties = {
  color: 'var(--text)', fontSize: '.6rem', fontWeight: 900,
  letterSpacing: '.3em', textTransform: 'uppercase',
}

const heading: React.CSSProperties = {
  color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem',
  textTransform: 'uppercase', letterSpacing: '-.01em',
}

const hintLine: React.CSSProperties = {
  color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1.55,
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.7rem 1rem' }}>
      <span style={{ color: DANGER, fontSize: '.8rem', lineHeight: 1.6 }}>{message}</span>
    </div>
  )
}

/** The phase, in colour. Falls back to a grey chip when there is no open block. */
function phaseLook(block: TrainingBlock | undefined) {
  if (!block) return { label: 'No block', color: 'var(--text-4)' as string, days: null as number | null }
  const meta = phaseMeta(block.phase)
  return { label: meta.label, color: meta.color, days: daysInPhase(block) }
}

const smallButton = (color: string, filled: boolean): React.CSSProperties => ({
  background: filled ? color : 'transparent',
  border: filled ? 'none' : `1px solid ${color}`,
  color: filled ? '#ffffff' : color,
  fontSize: '.58rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase',
  padding: '.45rem .75rem', minHeight: '2.25rem', borderRadius: '.2rem',
  cursor: 'pointer', fontFamily: 'inherit',
})

interface PhaseDraft {
  athleteId: string
  /** Which rendered card opened it. A two-coach athlete renders twice, and one
   *  picker per BOARD would otherwise open on both cards with duplicate ids. */
  columnKey: string
  phase: TrainingPhase
  label: string
}

export default function RosterBoard({ isDemo = false }: { isDemo?: boolean }) {
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const { profile, isAdmin } = useAuth()
  const { can } = usePermissions()

  // Demo mode has no session, so the seeded head coach stands in as the viewer.
  // Without this every demo card would look like somebody else's athlete.
  const viewerId = isDemo ? 'demo-ronnie' : (profile?.id ?? null)
  const viewer = useMemo(
    () => ({ id: viewerId, isDemo, isAdmin: isDemo || isAdmin, canManageStaff: can('manage_staff') }),
    [viewerId, isDemo, isAdmin, can],
  )
  const mayMove = canMoveAthletes(viewer)

  const [people, setPeople] = useState<Profile[]>([])
  const [assignments, setAssignments] = useState<CoachAssignment[]>([])
  const [blocks, setBlocks] = useState<TrainingBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // One picker of each kind open at a time. A board with six selects hanging
  // open is a board where nobody can tell which one they are about to submit.
  const [openMove, setOpenMove] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<string>(UNASSIGNED_KEY)
  const [phaseDraft, setPhaseDraft] = useState<PhaseDraft | null>(null)

  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [ppl, asg, blk] = await Promise.all([
      fetchPeople(isDemo),
      fetchCoachAssignments(isDemo),
      fetchTrainingBlocks(isDemo),
    ])
    // Any one of the three coming back null is an outage. A board drawn from two
    // of them shows athletes with no coaches, or coaches with no phases, and
    // both read as data rather than as a server that is down.
    if (ppl === null || asg === null || blk === null) {
      setOutage(true)
      setPeople([]); setAssignments([]); setBlocks([])
    } else {
      setOutage(false)
      setPeople(ppl); setAssignments(asg); setBlocks(blk)
    }
    setLoading(false)
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  const columns = useMemo(() => buildBoard(people, assignments, personName), [people, assignments])
  const open = useMemo(() => currentBlocks(blocks), [blocks])
  const nameById = useMemo(() => new Map(people.map(p => [p.id, personName(p)])), [people])
  const athleteCount = useMemo(
    () => people.filter(p => p.role === 'athlete' && p.status === 'active').length,
    [people],
  )
  const unassignedCount = columns[0]?.cards.length ?? 0
  const coachCount = Math.max(columns.length - 1, 0)

  const nameOfCoach = (id: string | null) => (id === null ? 'Unassigned' : nameById.get(id) ?? 'a former coach')
  const cardFor = (athleteId: string): BoardCard | undefined =>
    columns.flatMap(c => c.cards).find(card => card.athlete.id === athleteId)

  // ── Moving ─────────────────────────────────────────────────────────────────

  /**
   * One drop, or one Move button, all the way to the database.
   *
   * The plan is applied to the local rows first so the card lands where it was
   * dropped instantly, then written one step at a time. The first step failing
   * restores the snapshot, which is the whole board exactly as it was. The
   * SECOND step failing does not: by then the insert has really happened, so
   * only that step is put back and the person is told, in full, what is now
   * true and what to do about it.
   */
  const move = async (athleteId: string, from: string | null, to: string | null) => {
    const card = cardFor(athleteId)
    const plan = planMove(athleteId, from, to, card?.coachIds ?? [])
    setOpenMove(null)
    if (plan.steps.length === 0) return

    const who = nameById.get(athleteId) ?? 'That athlete'

    setError(null)
    setNotice(null)
    setBusyId(athleteId)
    setAssignments(rows => applySteps(rows, plan.steps))

    const first = plan.steps[0]
    const firstResult = await setCoachAssignment(athleteId, first.coachId, first.assigned, isDemo)
    if (!firstResult.ok) {
      // Invert only OUR step. A whole-board snapshot would also erase a
      // concurrent move that succeeded while this one was in flight.
      setAssignments(rows => applySteps(rows, [invertStep(first)]))
      setBusyId(null)
      setError(firstResult.message)
      return
    }

    if (plan.steps.length > 1) {
      const second = plan.steps[1]
      const secondResult = await setCoachAssignment(athleteId, second.coachId, second.assigned, isDemo)
      if (!secondResult.ok) {
        setAssignments(rows => applySteps(rows, [invertStep(second)]))
        setBusyId(null)
        setError(`${secondResult.message} ${halfMoveWarning(who, nameOfCoach(second.coachId), nameOfCoach(first.coachId))}`)
        return
      }
    }

    setBusyId(null)
    setNotice(
      plan.kind === 'remove'
        ? `${who} is no longer with ${nameOfCoach(from)}.`
        : `${who} is now with ${nameOfCoach(to)}.`,
    )
  }

  // ── Training blocks ────────────────────────────────────────────────────────

  /** Both phase writes reload the blocks, because the RPC closes a block we do not hold. */
  const reloadBlocks = async (): Promise<boolean> => {
    const rows = await fetchTrainingBlocks(isDemo)
    if (rows === null) return false
    setBlocks(rows)
    return true
  }

  const startPhase = async (draft: PhaseDraft) => {
    const who = nameById.get(draft.athleteId) ?? 'That athlete'
    setError(null)
    setNotice(null)
    setBusyId(draft.athleteId)
    const label = draft.label.trim()
    const result = await startTrainingBlock(draft.athleteId, draft.phase, label ? label : null, null, isDemo)
    if (!result.ok) {
      setBusyId(null)
      setError(result.message)
      return
    }
    const reloaded = await reloadBlocks()
    setBusyId(null)
    setPhaseDraft(null)
    const phase = PHASES.find(p => p.key === draft.phase)
    setNotice(
      reloaded
        ? `${who} is in ${phase?.label ?? draft.phase}.`
        : `${who} is in ${phase?.label ?? draft.phase}. The board could not reload the blocks, so refresh to see it.`,
    )
  }

  const endPhase = async (athleteId: string) => {
    const who = nameById.get(athleteId) ?? 'That athlete'
    setError(null)
    setNotice(null)
    setBusyId(athleteId)
    const result = await endTrainingBlock(athleteId, isDemo)
    if (!result.ok) {
      setBusyId(null)
      setError(result.message)
      return
    }
    const reloaded = await reloadBlocks()
    setBusyId(null)
    setPhaseDraft(null)
    setNotice(
      reloaded
        ? `${who} has no open block.`
        : `${who} has no open block. The board could not reload the blocks, so refresh to see it.`,
    )
  }

  // ── One card ───────────────────────────────────────────────────────────────

  const renderCard = (card: BoardCard, column: BoardColumn) => {
    const athlete = card.athlete
    const id = athlete.id
    const who = personName(athlete)
    const block = open.get(id)
    const look = phaseLook(block)
    const others = alsoWith(card, column.coachId)
    const busy = busyId === id
    const moveKey = `${id}|${column.key}`
    const moveOpen = openMove === moveKey
    const phaseOpen = phaseDraft?.athleteId === id && phaseDraft.columnKey === column.key
    const mayPhase = canSetPhase(viewer, card.coachIds)
    const options = moveOptions(columns, column.key)

    return (
      <div
        key={moveKey}
        role="group"
        aria-label={who}
        draggable={mayMove && !isMobile}
        onDragStart={e => {
          const payload: DragPayload = { athleteId: id, fromCoachId: column.coachId }
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('application/json', encodeDrag(payload))
          // Some browsers hand a drag no data at all unless text/plain is set.
          e.dataTransfer.setData('text/plain', encodeDrag(payload))
          setDragging(payload)
        }}
        onDragEnd={() => { setDragging(null); setDragOver(null) }}
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--surface-2)',
          borderLeft: `3px solid ${look.color}`,
          borderRadius: '.2rem',
          padding: '.6rem .7rem',
          display: 'flex', flexDirection: 'column', gap: '.4rem',
          opacity: dragging?.athleteId === id ? 0.5 : busy ? 0.6 : 1,
          cursor: mayMove && !isMobile ? 'grab' : 'default',
        }}
      >
        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'baseline' }}>
          {mayMove && !isMobile && (
            <span aria-hidden style={{ color: 'var(--text-4)', fontSize: '.7rem', lineHeight: 1, flexShrink: 0 }}>⠿</span>
          )}
          <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.82rem', lineHeight: 1.35, wordBreak: 'break-word' }}>
            {who}
          </span>
        </div>

        {/* The phase chip is the control, when the viewer is allowed one. */}
        {mayPhase ? (
          <button
            onClick={() => setPhaseDraft(
              phaseOpen
                ? null
                : { athleteId: id, columnKey: column.key, phase: block?.phase ?? 'development', label: block?.label ?? '' },
            )}
            aria-expanded={phaseOpen}
            aria-label={
              block
                ? `Training phase for ${who}: ${look.label}, ${look.days} days in. Change it.`
                : `${who} has no training block. Start one.`
            }
            style={{
              alignSelf: 'flex-start',
              background: `${look.color}18`, border: `1px solid ${look.color}`, color: look.color,
              fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
              padding: '.22rem .5rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {look.label}{look.days === null ? '' : ` · ${look.days}d`}
          </button>
        ) : (
          <span
            style={{
              alignSelf: 'flex-start',
              background: `${look.color}18`, border: `1px solid ${look.color}`, color: look.color,
              fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase',
              padding: '.22rem .5rem', borderRadius: '.2rem',
            }}
          >
            {look.label}{look.days === null ? '' : ` · ${look.days}d`}
          </span>
        )}

        {block?.label && (
          <p style={{ color: 'var(--text-3)', fontSize: '.72rem', lineHeight: 1.45 }}>{block.label}</p>
        )}

        {others.length > 0 && (
          <p style={{ color: 'var(--text-4)', fontSize: '.68rem', lineHeight: 1.45 }}>
            also with {others.map(nameOfCoach).join(', ')}
          </p>
        )}

        {column.coachId === null && card.offBoardCoachIds.length > 0 && (
          <p style={{ color: 'var(--text-4)', fontSize: '.68rem', lineHeight: 1.45 }}>
            Assigned to {card.offBoardCoachIds.map(nameOfCoach).join(', ')}, whose account is not active.
          </p>
        )}

        {/* The accessible move path, present on every card and on every device.
            The toggle stays mounted while the picker is open so keyboard focus
            has somewhere to be, and so Escape-by-Cancel returns to it. */}
        {mayMove && options.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', alignItems: 'flex-start' }}>
            <button
              onClick={() => {
                if (moveOpen) { setOpenMove(null); return }
                setOpenMove(moveKey)
                setMoveTarget(options[0].key)
              }}
              disabled={busy}
              aria-expanded={moveOpen}
              aria-controls={`rb-move-panel-${moveKey}`}
              aria-label={`Move ${who} out of ${column.title}`}
              style={{ ...smallButton('var(--text-3)', false), border: '1px solid var(--border)' }}
            >
              {busy ? 'Working…' : 'Move'}
            </button>

            {moveOpen && (
              <div
                id={`rb-move-panel-${moveKey}`}
                style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', width: '100%', borderTop: '1px solid var(--surface-2)', paddingTop: '.45rem' }}
              >
                <label className="field-label" htmlFor={`rb-move-${moveKey}`}>Move {who} to</label>
                <select
                  id={`rb-move-${moveKey}`}
                  className="field"
                  value={moveTarget}
                  onChange={e => setMoveTarget(e.target.value)}
                >
                  {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => {
                      const target = options.find(o => o.key === moveTarget) ?? options[0]
                      void move(id, column.coachId, target.coachId)
                    }}
                    disabled={busy}
                    aria-label={`Move ${who} to ${options.find(o => o.key === moveTarget)?.label ?? options[0].label}`}
                    style={{ ...smallButton(ACCENT, true), opacity: busy ? 0.6 : 1 }}
                  >
                    {busy ? 'Moving…' : 'Move'}
                  </button>
                  <button
                    onClick={() => setOpenMove(null)}
                    style={smallButton('var(--text-4)', false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* The phase picker. A phase change is a NEW block on purpose: the
            history is the point, so the copy says what Start actually does. */}
        {phaseOpen && phaseDraft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', borderTop: '1px solid var(--surface-2)', paddingTop: '.45rem' }}>
            <label className="field-label" htmlFor={`rb-phase-${moveKey}`}>Phase</label>
            <select
              id={`rb-phase-${moveKey}`}
              className="field"
              value={phaseDraft.phase}
              onChange={e => setPhaseDraft({ ...phaseDraft, phase: e.target.value as TrainingPhase })}
            >
              {PHASES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>

            <label className="field-label" htmlFor={`rb-label-${moveKey}`}>Label (optional)</label>
            <input
              id={`rb-label-${moveKey}`}
              className="field"
              maxLength={120}
              value={phaseDraft.label}
              placeholder="Meet prep, week 1"
              onChange={e => setPhaseDraft({ ...phaseDraft, label: e.target.value })}
            />

            <p style={hintLine}>Starting a new block closes the current one.</p>

            <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => void startPhase(phaseDraft)}
                disabled={busy}
                aria-label={`Start a new training block for ${who}`}
                style={{ ...smallButton(ACCENT, true), opacity: busy ? 0.6 : 1 }}
              >
                {busy ? 'Saving…' : 'Start'}
              </button>
              {block && (
                <button
                  onClick={() => void endPhase(id)}
                  disabled={busy}
                  aria-label={`End the open training block for ${who}`}
                  style={smallButton(DANGER, false)}
                >
                  End block
                </button>
              )}
              <button onClick={() => setPhaseDraft(null)} style={smallButton('var(--text-4)', false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── One column ─────────────────────────────────────────────────────────────

  const renderColumn = (column: BoardColumn) => {
    const hot = dragOver === column.key && dragging !== null && dragging.fromCoachId !== column.coachId
    const isUnassigned = column.coachId === null

    return (
      <section
        key={column.key}
        aria-label={`${column.title}, ${column.cards.length} ${column.cards.length === 1 ? 'athlete' : 'athletes'}`}
        onDragOver={mayMove ? (e => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDragOver(column.key)
        }) : undefined}
        onDragLeave={mayMove ? (e => {
          // Moving between children of the same column fires dragleave too, so
          // the highlight only drops when the pointer really left the column.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(null)
        }) : undefined}
        onDrop={mayMove ? (e => {
          e.preventDefault()
          setDragOver(null)
          const payload =
            parseDragPayload(e.dataTransfer.getData('application/json'))
            ?? parseDragPayload(e.dataTransfer.getData('text/plain'))
            ?? dragging
          setDragging(null)
          if (!payload) return
          void move(payload.athleteId, payload.fromCoachId, column.coachId)
        }) : undefined}
        style={{
          flex: isMobile ? '0 0 auto' : '0 0 260px',
          width: isMobile ? '100%' : 260,
          background: hot ? `${ACCENT}14` : 'var(--surface)',
          border: `1px solid ${hot ? ACCENT : 'var(--surface-2)'}`,
          borderTop: `3px solid ${isUnassigned ? 'var(--border-mid)' : ACCENT}`,
          borderRadius: '.25rem',
          padding: '.7rem',
          display: 'flex', flexDirection: 'column', gap: '.5rem',
        }}
      >
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'baseline' }}>
          <h3 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '.8rem', letterSpacing: '.02em', flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
            {column.title}
          </h3>
          <span style={{ color: 'var(--text-4)', fontSize: '.7rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {column.cards.length}
          </span>
        </div>

        {isUnassigned && (
          <p style={hintLine}>Nobody here can message a coach yet.</p>
        )}

        {column.cards.length === 0 ? (
          <p style={{ ...hintLine, padding: '.6rem 0' }}>
            {isUnassigned ? 'Everybody has a coach.' : mayMove ? 'Drop somebody here, or use Move on a card.' : 'No athletes yet.'}
          </p>
        ) : (
          column.cards.map(card => renderCard(card, column))
        )}
      </section>
    )
  }

  // ── The screen ─────────────────────────────────────────────────────────────

  return (
    <div className="dash-pad" style={{ paddingBottom: isMobile ? '1rem' : '1.25rem' }}>
      {isDemo && <DemoBanner note="Sample athletes and coaches. Moves and training blocks stay in this preview." />}

      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <p style={{ ...microLabel, marginBottom: '.4rem' }}>Roster</p>
          <h2 style={{ ...heading, marginBottom: '.4rem' }}>Who coaches whom</h2>
          <p style={{ color: 'var(--text-3)', fontSize: '.8rem', lineHeight: 1.6, maxWidth: 620 }}>
            An athlete can only message the coaches they are assigned to, and an athlete can have more
            than one. A card sits in every column it belongs to.
          </p>
        </div>
        <button
          onClick={() => void load()}
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: isMobile ? '.55rem .875rem' : '.35rem .875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          ↺ Refresh
        </button>
      </div>

      {!loading && !outage && (
        <div style={{ display: 'flex', gap: isMobile ? '1.25rem 1.75rem' : '2.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          {([
            ['Athletes', athleteCount, 'var(--text)'],
            ['Unassigned', unassignedCount, unassignedCount > 0 ? '#eab308' : GREEN],
            ['Coaches', coachCount, ACCENT],
          ] as const).map(([label, value, color]) => (
            <div key={label}>
              <p style={{ color, fontWeight: 900, fontSize: '1.5rem', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
              <p style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginTop: '.25rem' }}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {!mayMove && !loading && !outage && (
        <p style={{ ...hintLine, marginBottom: '1rem', maxWidth: 620 }}>
          Changing who coaches an athlete needs an administrator, or the manage staff permission. You can
          still read the board, and you can set training phases for your own athletes.
        </p>
      )}

      {error && <div style={{ marginBottom: '1rem', maxWidth: 720 }}><ErrorNote message={error} /></div>}

      {/* Every finished move says so here, once, for anyone not watching the
          card fly across the screen. */}
      <p role="status" aria-live="polite" style={{ color: GREEN, fontSize: '.78rem', lineHeight: 1.6, marginBottom: notice ? '1rem' : 0, minHeight: notice ? undefined : 0 }}>
        {notice ?? ''}
      </p>

      {loading ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading the roster…</p>
      ) : outage ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>Couldn&rsquo;t load the roster.</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>That&rsquo;s on our side. Nobody has been moved and no training block has changed.</p>
          <button onClick={() => void load()} style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--text)', color: 'var(--text)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '0 0 .25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            Try again
          </button>
        </div>
      ) : athleteCount === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>No athletes on the board yet.</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem' }}>
            An account shows up here once it is approved. Approve one under Settings, Users and permissions.
          </p>
        </div>
      ) : (
        <>
          {coachCount === 0 && (
            <p style={{ ...hintLine, marginBottom: '.75rem', maxWidth: 620 }}>
              There are no active coaches, so there is nowhere to move anybody yet. Add one under Settings,
              Users and permissions.
            </p>
          )}
          <div
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'stretch' : 'flex-start',
              gap: '.75rem',
              overflowX: isMobile ? 'visible' : 'auto',
              paddingBottom: isMobile ? 0 : '.75rem',
            }}
          >
            {columns.map(renderColumn)}
          </div>
        </>
      )}
    </div>
  )
}
