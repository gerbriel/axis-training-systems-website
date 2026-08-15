import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import DemoBanner from '../../components/dashboard/DemoBanner'
import { usePermissions } from '../../lib/usePermissions'
import {
  defaultCalculatorConfig,
  fetchCalculatorConfig,
  saveCalculatorParams,
  LIMITS,
  RPE_REPS,
  RPE_STEPS,
  rpeKey,
  type BarSpec,
  type CalculatorConfig,
  type CalculatorKey,
  type ScoreSchemeKey,
} from '../../lib/calculators'
import { ACCENT, SettingsSection, Field, SaveButton, Flash, Loading, pageStyle } from './settings/_shared'
import type { FlashState } from './settings/_shared'

/**
 * The calculators, adjustable without a deploy.
 *
 * Everything on this screen is an OVERRIDE. The boxes are pre-filled from the
 * live config, and a Save writes only the numbers that actually differ from
 * what the code ships with (migration 042's header explains why that matters:
 * a field left alone keeps tracking the default, so a later correction still
 * reaches it). Reset writes an empty object for that section, which is the same
 * as never having touched it.
 *
 * Two things this screen deliberately cannot edit:
 *
 *   The Dots, Wilks and IPF GL COEFFICIENTS, and the IPF WEIGHT CLASSES. Those
 *   are published standards. A score computed against a house polynomial is a
 *   number no other calculator on earth agrees with, and it would be presented
 *   to athletes as though it were the federation's.
 *
 * What IS editable in the scores section is where each tier begins, because
 * "Elite starts at 380" is a coaching opinion and always was.
 *
 * This is SIGNAGE. The read-only notice and the disabled inputs are here so a
 * coach without `manage_calculators` sees an explanation instead of a wall of
 * refusals; RLS in 042 is what actually stops the write.
 */

// ── Formatting ──────────────────────────────────────────────────────────────

/** A fraction as the percent an owner types: 0.922 → "92.2". */
function pctText(fraction: number): string {
  return String(Number((fraction * 100).toFixed(2)))
}

/** A limit as a percent, for a min/max attribute and for prose. Rounded because
 *  1.15 × 100 is 114.99999999999999 in binary floating point, and an input that
 *  caps at 114.999… will not accept the 115 it is telling you about. */
function pctLimit(fraction: number): number {
  return Math.round(fraction * 1000) / 10
}

/** Four decimals, the same precision the shared config keeps. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

/** A percent box back to a fraction, or null if it is not a number. */
function pctValue(text: string): number | null {
  const n = parseFloat(text)
  return Number.isFinite(n) ? round4(n / 100) : null
}

function plainValue(text: string): number | null {
  const n = parseFloat(text)
  return Number.isFinite(n) ? n : null
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Floating point makes 82.4 / 100 land a hair off 0.824, so "changed" has to
 *  mean "changed by an amount a person could have typed". */
function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > 1e-9
}

// ── Local chrome ────────────────────────────────────────────────────────────

const cellBase: CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '.4rem .45rem',
  borderRadius: '.2rem',
  fontSize: '.78rem',
  textAlign: 'right',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

/** The subtle mark that says "this one is not the shipped number". */
function cellStyle(changed: boolean, disabled: boolean): CSSProperties {
  return {
    ...cellBase,
    borderColor: changed ? ACCENT : 'var(--border)',
    background: changed ? 'rgba(39,44,132,.10)' : 'var(--surface)',
    color: disabled ? 'var(--text-3)' : 'var(--text)',
    cursor: disabled ? 'default' : 'text',
  }
}

const ghostBtn: CSSProperties = {
  background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)',
  fontSize: '.68rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
  padding: '.8rem 1.3rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit',
}

const rowLabel: CSSProperties = {
  color: 'var(--text-2)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.08em',
  whiteSpace: 'nowrap', textAlign: 'left',
}

const headCell: CSSProperties = {
  color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em',
  textTransform: 'uppercase', padding: '0 .25rem .5rem', textAlign: 'right',
}

function SectionActions({
  saving, disabled, onSave, onReset, changed,
}: { saving: boolean; disabled: boolean; onSave: () => void; onReset: () => void; changed: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '1.5rem' }}>
      <SaveButton saving={saving} disabled={disabled} onClick={onSave}>Save</SaveButton>
      <button
        type="button"
        onClick={onReset}
        disabled={disabled || saving}
        style={{ ...ghostBtn, opacity: disabled || saving ? 0.5 : 1, cursor: disabled || saving ? 'default' : 'pointer' }}
      >
        Reset to defaults
      </button>
      {changed && (
        <span style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>
          Highlighted boxes are not the shipped value.
        </span>
      )}
    </div>
  )
}

// ── Drafts ──────────────────────────────────────────────────────────────────
//
// Every box is a STRING while it is being typed. Parsing on each keystroke
// turns "0." into 0 and eats the decimal point out from under the cursor, so
// the values are read back on blur and on save, not on change.

type RpeDraft = Record<string, Record<number, string>>
type ProfileDraft = { open: string; second: string; third: string }
interface AttemptDraft {
  conservative: ProfileDraft
  aggressive: ProfileDraft
  rounding: { lbs: string; kg: string }
}
type ScoreDraft = Record<ScoreSchemeKey, string[]>
interface WeightRowDraft { label: string; lbs: string; kg: string }
interface ConverterDraft { bars: WeightRowDraft[]; plates: WeightRowDraft[] }

const SCHEMES: { key: ScoreSchemeKey; label: string; note: string }[] = [
  { key: 'dots',  label: 'Dots',   note: 'The USAPL and IPF standard.' },
  { key: 'wilks', label: 'Wilks',  note: 'The classic cross-bodyweight score.' },
  { key: 'gl',    label: 'IPF GL', note: 'Goodlift points, on a 0 to 120 scale.' },
]

const PROFILE_STYLES: { key: 'conservative' | 'aggressive'; label: string; note: string }[] = [
  { key: 'conservative', label: 'Conservative', note: 'A safe opener for guaranteed white lights.' },
  { key: 'aggressive',   label: 'Aggressive',   note: 'A bigger third for a PR attempt.' },
]

const ATTEMPT_FIELDS: { key: keyof ProfileDraft; label: string }[] = [
  { key: 'open',   label: 'Opener' },
  { key: 'second', label: '2nd attempt' },
  { key: 'third',  label: '3rd attempt' },
]

function rpeDraftFrom(cfg: CalculatorConfig): RpeDraft {
  const draft: RpeDraft = {}
  for (const step of RPE_STEPS) {
    const key = rpeKey(step)
    const row: Record<number, string> = {}
    for (const reps of RPE_REPS) row[reps] = pctText(cfg.rpe.table[key][reps])
    draft[key] = row
  }
  return draft
}

function attemptDraftFrom(cfg: CalculatorConfig): AttemptDraft {
  const p = cfg.attempts.profiles
  return {
    conservative: { open: pctText(p.conservative.open), second: pctText(p.conservative.second), third: pctText(p.conservative.third) },
    aggressive:   { open: pctText(p.aggressive.open),   second: pctText(p.aggressive.second),   third: pctText(p.aggressive.third) },
    rounding: { lbs: String(cfg.attempts.rounding.lbs), kg: String(cfg.attempts.rounding.kg) },
  }
}

function converterDraftFrom(cfg: CalculatorConfig): ConverterDraft {
  const rows = (list: BarSpec[]) => list.map(r => ({ label: r.label, lbs: String(r.lbs), kg: String(r.kg) }))
  return { bars: rows(cfg.converter.bars), plates: rows(cfg.converter.plates) }
}

function scoreDraftFrom(cfg: CalculatorConfig): ScoreDraft {
  const cutoffs = (key: ScoreSchemeKey) =>
    cfg.scores.benchmarks[key].tiers.slice(0, -1).map(t => String(t.cutoff))
  return { dots: cutoffs('dots'), wilks: cutoffs('wilks'), gl: cutoffs('gl') }
}

// ── The panel ───────────────────────────────────────────────────────────────

export default function CalculatorSettingsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const { can } = usePermissions()
  // isDemo is ORed in for the reason OrdersPanel gives: a demo session on a
  // configured deployment has no profile, so can() answers no to everything and
  // the whole screen would render as read-only in the walk-through.
  const canEdit = isDemo || can('*') || can('manage_calculators')

  const [cfg, setCfg] = useState<CalculatorConfig | null>(null)
  const [rpe, setRpe] = useState<RpeDraft | null>(null)
  const [attempts, setAttempts] = useState<AttemptDraft | null>(null)
  const [converter, setConverter] = useState<ConverterDraft | null>(null)
  const [scores, setScores] = useState<ScoreDraft | null>(null)

  const [saving, setSaving] = useState<CalculatorKey | null>(null)
  const [flash, setFlash] = useState<Partial<Record<CalculatorKey, FlashState>>>({})

  // What the code ships with, for the "this box is not the default" mark and
  // for working out which numbers are worth storing at all.
  const defaults = useMemo(() => defaultCalculatorConfig(), [])

  const load = useCallback(async () => {
    const next = await fetchCalculatorConfig(isDemo)
    setCfg(next)
    setRpe(rpeDraftFrom(next))
    setAttempts(attemptDraftFrom(next))
    setConverter(converterDraftFrom(next))
    setScores(scoreDraftFrom(next))
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  function say(section: CalculatorKey, text: string, ok: boolean) {
    setFlash(f => ({ ...f, [section]: { text, ok } }))
    if (ok) {
      window.setTimeout(
        () => setFlash(f => (f[section]?.text === text ? { ...f, [section]: undefined } : f)),
        2600,
      )
    }
  }

  async function commit(section: CalculatorKey, params: Record<string, unknown>, done: string) {
    setSaving(section)
    const res = await saveCalculatorParams(section, params, isDemo)
    if (res.ok) await load()
    setSaving(null)
    say(section, res.ok ? done : res.message, res.ok)
  }

  async function reset(section: CalculatorKey) {
    // An empty object, not a delete: the row keeps the record of who reset it.
    await commit(section, {}, 'Back to the shipped values.')
  }

  if (!cfg || !rpe || !attempts || !converter || !scores) return <Loading />

  // ── RPE ───────────────────────────────────────────────────────────────────

  const rpeChanged = (key: string, reps: number) => {
    const v = pctValue(rpe[key][reps])
    return v !== null && differs(v, defaults.rpe.table[key][reps])
  }
  const anyRpeChanged = RPE_STEPS.some(s => RPE_REPS.some(r => rpeChanged(rpeKey(s), r)))

  function setRpeCell(key: string, reps: number, text: string) {
    setRpe(d => (d ? { ...d, [key]: { ...d[key], [reps]: text } } : d))
  }

  /** Blur is where a box becomes a number: out of range clamps to the edge, and
   *  something that is not a number at all goes back to what it was. */
  function blurRpeCell(key: string, reps: number) {
    setRpe(d => {
      if (!d) return d
      const v = pctValue(d[key][reps])
      const fallback = cfg!.rpe.table[key][reps]
      const next = v === null || v <= 0 ? fallback : Math.min(v, LIMITS.rpeFraction.max)
      return { ...d, [key]: { ...d[key], [reps]: pctText(next) } }
    })
  }

  async function saveRpe() {
    const table: Record<string, Record<string, number>> = {}
    for (const step of RPE_STEPS) {
      const key = rpeKey(step)
      for (const reps of RPE_REPS) {
        const v = pctValue(rpe![key][reps])
        if (v === null || v <= 0) continue
        const clamped = round4(Math.min(v, LIMITS.rpeFraction.max))
        if (!differs(clamped, defaults.rpe.table[key][reps])) continue
        if (!table[key]) table[key] = {}
        table[key][String(reps)] = clamped
      }
    }
    // Only the cells that moved. A chart with nothing changed stores {}, which
    // is the same as no row at all.
    await commit('rpe', Object.keys(table).length > 0 ? { table } : {}, 'RPE chart saved.')
  }

  // ── Attempts ──────────────────────────────────────────────────────────────

  const attemptChanged = (style: 'conservative' | 'aggressive', field: keyof ProfileDraft) => {
    const v = pctValue(attempts[style][field])
    return v !== null && differs(v, defaults.attempts.profiles[style][field])
  }
  const roundingChanged = (unit: 'lbs' | 'kg') => {
    const v = plainValue(attempts.rounding[unit])
    return v !== null && differs(v, defaults.attempts.rounding[unit])
  }
  const anyAttemptChanged =
    PROFILE_STYLES.some(s => ATTEMPT_FIELDS.some(f => attemptChanged(s.key, f.key))) ||
    roundingChanged('lbs') || roundingChanged('kg')

  function setAttemptField(style: 'conservative' | 'aggressive', field: keyof ProfileDraft, text: string) {
    setAttempts(d => (d ? { ...d, [style]: { ...d[style], [field]: text } } : d))
  }

  function blurAttemptField(style: 'conservative' | 'aggressive', field: keyof ProfileDraft) {
    setAttempts(d => {
      if (!d) return d
      const v = pctValue(d[style][field])
      const fallback = cfg!.attempts.profiles[style][field]
      const next = v === null ? fallback : clamp(v, LIMITS.attemptPct.min, LIMITS.attemptPct.max)
      return { ...d, [style]: { ...d[style], [field]: pctText(next) } }
    })
  }

  function blurRounding(unit: 'lbs' | 'kg') {
    setAttempts(d => {
      if (!d) return d
      const v = plainValue(d.rounding[unit])
      const fallback = cfg!.attempts.rounding[unit]
      const next = v === null ? fallback : clamp(v, LIMITS.rounding.min, LIMITS.rounding.max)
      return { ...d, rounding: { ...d.rounding, [unit]: String(next) } }
    })
  }

  async function saveAttempts() {
    const params: Record<string, unknown> = {}
    const profiles: Record<string, unknown> = {}

    for (const { key: style, label } of PROFILE_STYLES) {
      const triple = {
        open:   pctValue(attempts![style].open),
        second: pctValue(attempts![style].second),
        third:  pctValue(attempts![style].third),
      }
      if (triple.open === null || triple.second === null || triple.third === null) {
        say('attempts', `${label}: all three attempts need a percentage.`, false)
        return
      }
      const clamped = {
        open:   clamp(triple.open,   LIMITS.attemptPct.min, LIMITS.attemptPct.max),
        second: clamp(triple.second, LIMITS.attemptPct.min, LIMITS.attemptPct.max),
        third:  clamp(triple.third,  LIMITS.attemptPct.min, LIMITS.attemptPct.max),
      }
      // Refused here rather than saved and silently dropped by the merge. A
      // plan that goes backwards is almost always two boxes typed the wrong way
      // round, and the owner needs to hear that instead of watching a Save
      // succeed and change nothing.
      if (!(clamped.open <= clamped.second && clamped.second <= clamped.third)) {
        say('attempts', `${label}: the opener cannot be heavier than the second, or the second heavier than the third.`, false)
        return
      }
      const base = defaults.attempts.profiles[style]
      if (differs(clamped.open, base.open) || differs(clamped.second, base.second) || differs(clamped.third, base.third)) {
        profiles[style] = clamped
      }
    }
    if (Object.keys(profiles).length > 0) params.profiles = profiles

    const rounding: Record<string, number> = {}
    for (const unit of ['lbs', 'kg'] as const) {
      const v = plainValue(attempts!.rounding[unit])
      if (v === null) continue
      const clamped = clamp(v, LIMITS.rounding.min, LIMITS.rounding.max)
      if (differs(clamped, defaults.attempts.rounding[unit])) rounding[unit] = clamped
    }
    if (Object.keys(rounding).length > 0) params.rounding = rounding

    await commit('attempts', params, 'Attempt percentages saved.')
  }

  // ── Converter quick-picks ─────────────────────────────────────────────────
  //
  // The lists replace WHOLESALE (mergeConverter's rule: a row has no stable
  // identity to merge by), so the draft is the whole future list and Save
  // either ships all of it or refuses with the row that stopped it.

  const convRowChanged = (kind: 'bars' | 'plates', i: number, field: keyof WeightRowDraft) => {
    const base = defaults.converter[kind][i]
    if (!base) return true // a row past the shipped list is an addition
    const row = converter[kind][i]
    if (field === 'label') return row.label.trim() !== base.label
    const v = plainValue(row[field])
    return v !== null && differs(v, base[field])
  }
  const convListChanged = (kind: 'bars' | 'plates') =>
    converter[kind].length !== defaults.converter[kind].length ||
    converter[kind].some((_, i) => (['label', 'lbs', 'kg'] as const).some(f => convRowChanged(kind, i, f)))
  const anyConvChanged = convListChanged('bars') || convListChanged('plates')

  function setConvCell(kind: 'bars' | 'plates', i: number, field: keyof WeightRowDraft, text: string) {
    setConverter(d => (d ? { ...d, [kind]: d[kind].map((r, j) => (j === i ? { ...r, [field]: text } : r)) } : d))
  }

  function blurConvCell(kind: 'bars' | 'plates', i: number, field: 'lbs' | 'kg') {
    setConverter(d => {
      if (!d) return d
      const v = plainValue(d[kind][i][field])
      if (v === null) return d // save is where an unparseable box gets its sentence
      const next = String(clamp(v, LIMITS.referenceWeight.min, LIMITS.referenceWeight.max))
      return { ...d, [kind]: d[kind].map((r, j) => (j === i ? { ...r, [field]: next } : r)) }
    })
  }

  function addConvRow(kind: 'bars' | 'plates') {
    setConverter(d => (d ? { ...d, [kind]: [...d[kind], { label: '', lbs: '', kg: '' }] } : d))
  }

  function removeConvRow(kind: 'bars' | 'plates', i: number) {
    setConverter(d => (d ? { ...d, [kind]: d[kind].filter((_, j) => j !== i) } : d))
  }

  async function saveConverter() {
    const params: Record<string, unknown> = {}
    for (const kind of ['bars', 'plates'] as const) {
      const label = kind === 'bars' ? 'Bars' : 'Plates'
      const rows = converter![kind]
      // mergeConverter ignores an empty override so the rack cannot be emptied
      // by accident; refusing here says so instead of letting Save no-op.
      if (rows.length === 0) {
        say('converter', `${label}: the list needs at least one row.`, false)
        return
      }
      const parsed: BarSpec[] = []
      for (const [i, row] of rows.entries()) {
        const name = row.label.trim()
        const lbs = plainValue(row.lbs)
        const kg = plainValue(row.kg)
        if (!name || lbs === null || kg === null) {
          say('converter', `${label}, row ${i + 1}: every row needs a label and both weights.`, false)
          return
        }
        parsed.push({
          label: name.slice(0, 80),
          lbs: clamp(lbs, LIMITS.referenceWeight.min, LIMITS.referenceWeight.max),
          kg: clamp(kg, LIMITS.referenceWeight.min, LIMITS.referenceWeight.max),
        })
      }
      const base = defaults.converter[kind]
      const same = parsed.length === base.length &&
        parsed.every((r, i) => r.label === base[i].label && !differs(r.lbs, base[i].lbs) && !differs(r.kg, base[i].kg))
      if (!same) params[kind] = parsed
    }
    await commit('converter', params, 'Quick-pick weights saved.')
  }

  // ── Scores ────────────────────────────────────────────────────────────────

  const scoreChanged = (scheme: ScoreSchemeKey, i: number) => {
    const v = plainValue(scores[scheme][i])
    return v !== null && differs(v, defaults.scores.benchmarks[scheme].tiers[i].cutoff)
  }
  const anyScoreChanged = SCHEMES.some(s => scores[s.key].some((_, i) => scoreChanged(s.key, i)))

  function setCutoff(scheme: ScoreSchemeKey, i: number, text: string) {
    setScores(d => (d ? { ...d, [scheme]: d[scheme].map((v, j) => (j === i ? text : v)) } : d))
  }

  function blurCutoff(scheme: ScoreSchemeKey, i: number) {
    setScores(d => {
      if (!d) return d
      const v = plainValue(d[scheme][i])
      const fallback = cfg!.scores.benchmarks[scheme].tiers[i].cutoff
      const next = v === null || v <= 0 ? fallback : clamp(v, LIMITS.scoreCutoff.min, LIMITS.scoreCutoff.max)
      return { ...d, [scheme]: d[scheme].map((old, j) => (j === i ? String(next) : old)) }
    })
  }

  async function saveScores() {
    const params: Record<string, unknown> = {}
    for (const { key: scheme, label } of SCHEMES) {
      const values = scores![scheme].map(plainValue)
      if (values.some(v => v === null || v <= 0)) {
        say('scores', `${label}: every tier needs a score to start at.`, false)
        return
      }
      const cutoffs = (values as number[]).map(v => clamp(v, LIMITS.scoreCutoff.min, LIMITS.scoreCutoff.max))
      if (!cutoffs.every((v, i) => i === 0 || v > cutoffs[i - 1])) {
        say('scores', `${label}: each tier has to start above the one before it.`, false)
        return
      }
      const base = defaults.scores.benchmarks[scheme].tiers.slice(0, -1).map(t => t.cutoff)
      if (cutoffs.some((v, i) => differs(v, base[i]))) params[scheme] = { cutoffs }
    }
    await commit('scores', params, 'Score tiers saved.')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const tierLabels = defaults.scores.benchmarks.dots.tiers.map(t => t.label)
  const disabled = !canEdit

  return (
    <div style={{ ...pageStyle, maxWidth: 1000 }}>
      {isDemo && <DemoBanner note="Calculator changes live for this session only." />}

      {!canEdit && (
        <div style={{
          padding: '.85rem 1rem', borderRadius: '.25rem', fontSize: '.8rem', lineHeight: 1.6,
          marginBottom: '1.25rem', background: 'var(--surface-2)', border: '1px solid var(--border)',
          color: 'var(--text-2)',
        }}>
          You can see what the calculators are set to, but not change them. Editing needs the
          &ldquo;Manage calculators&rdquo; permission, which an admin can grant from Users.
        </div>
      )}

      {/* ── RPE chart ───────────────────────────────────────────────────── */}
      <SettingsSection
        title="RPE chart"
        intro={
          <>
            What fraction of a one-rep max each rep count at each RPE represents, as a percentage.
            The shipped numbers are the Tuchscherer chart, with the half RPEs interpolated between
            its whole rows. Change a cell and both the RPE calculator and the working-weight
            prescription follow it.
          </>
        }
      >
        <Flash flash={flash.rpe ?? null} />
        <div style={{ overflowX: 'auto', paddingBottom: '.5rem' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: '.3rem', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ ...headCell, textAlign: 'left' }}>RPE</th>
                {RPE_REPS.map(r => <th key={r} style={headCell}>{r} rep{r === 1 ? '' : 's'}</th>)}
              </tr>
            </thead>
            <tbody>
              {RPE_STEPS.map(step => {
                const key = rpeKey(step)
                return (
                  <tr key={key}>
                    <td style={rowLabel}>{key}</td>
                    {RPE_REPS.map(reps => (
                      <td key={reps} style={{ width: 66 }}>
                        <input
                          type="number"
                          step="0.1"
                          min={0}
                          max={pctLimit(LIMITS.rpeFraction.max)}
                          disabled={disabled}
                          value={rpe[key][reps]}
                          aria-label={`RPE ${key}, ${reps} reps, percent of one rep max`}
                          onChange={e => setRpeCell(key, reps, e.target.value)}
                          onBlur={() => blurRpeCell(key, reps)}
                          style={cellStyle(rpeChanged(key, reps), disabled)}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p style={{ color: 'var(--text-4)', fontSize: '.72rem', marginTop: '.5rem' }}>
          Percentages, so 92.2 means 92.2% of the one-rep max. Anything above {pctLimit(LIMITS.rpeFraction.max)}
          {' '}is pulled back to it.
        </p>
        <SectionActions
          saving={saving === 'rpe'}
          disabled={disabled}
          changed={anyRpeChanged}
          onSave={() => void saveRpe()}
          onReset={() => void reset('rpe')}
        />
      </SettingsSection>

      {/* ── Attempt planner ─────────────────────────────────────────────── */}
      <SettingsSection
        title="Attempt planner"
        intro="Each attempt as a percentage of the training max, for the two meet-day strategies, plus the smallest jump the plates in each unit can make. The planner in the tools strip and the one on the guides page both read these."
      >
        <Flash flash={flash.attempts ?? null} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
          {PROFILE_STYLES.map(({ key: style, label, note }) => (
            <div key={style} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '1.1rem 1.25rem' }}>
              <p style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: '.2rem' }}>{label}</p>
              <p style={{ color: 'var(--text-4)', fontSize: '.72rem', lineHeight: 1.5, marginBottom: '1rem' }}>{note}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.6rem' }}>
                {ATTEMPT_FIELDS.map(({ key: field, label: fieldLabel }) => (
                  <div key={field}>
                    <label className="field-label" style={{ fontSize: '.6rem', marginBottom: '.35rem' }}>{fieldLabel}</label>
                    <input
                      type="number"
                      step="0.5"
                      min={pctLimit(LIMITS.attemptPct.min)}
                      max={pctLimit(LIMITS.attemptPct.max)}
                      disabled={disabled}
                      value={attempts[style][field]}
                      aria-label={`${label} ${fieldLabel}, percent of training max`}
                      onChange={e => setAttemptField(style, field, e.target.value)}
                      onBlur={() => blurAttemptField(style, field)}
                      style={cellStyle(attemptChanged(style, field), disabled)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', maxWidth: 520, marginTop: '1.75rem' }}>
          <Field label="Round to, in pounds" hint="The smallest jump the plates make. 5 is a pair of 2.5s.">
            <input
              type="number" step="0.5" min={LIMITS.rounding.min} max={LIMITS.rounding.max}
              disabled={disabled}
              value={attempts.rounding.lbs}
              onChange={e => setAttempts(d => (d ? { ...d, rounding: { ...d.rounding, lbs: e.target.value } } : d))}
              onBlur={() => blurRounding('lbs')}
              style={{ ...cellStyle(roundingChanged('lbs'), disabled), textAlign: 'left', padding: '.6rem .8rem', fontSize: '.85rem' }}
            />
          </Field>
          <Field label="Round to, in kilos" hint="2.5 is a pair of 1.25s, the smallest change on a calibrated set.">
            <input
              type="number" step="0.25" min={LIMITS.rounding.min} max={LIMITS.rounding.max}
              disabled={disabled}
              value={attempts.rounding.kg}
              onChange={e => setAttempts(d => (d ? { ...d, rounding: { ...d.rounding, kg: e.target.value } } : d))}
              onBlur={() => blurRounding('kg')}
              style={{ ...cellStyle(roundingChanged('kg'), disabled), textAlign: 'left', padding: '.6rem .8rem', fontSize: '.85rem' }}
            />
          </Field>
        </div>

        <SectionActions
          saving={saving === 'attempts'}
          disabled={disabled}
          changed={anyAttemptChanged}
          onSave={() => void saveAttempts()}
          onReset={() => void reset('attempts')}
        />
      </SettingsSection>

      {/* ── Converter quick-picks ───────────────────────────────────────── */}
      <SettingsSection
        title="Converter quick-picks"
        intro="The bars and plates the weight converter offers as one-tap references. The pound-to-kilo factor itself is physics and is not editable; these lists are what your gym actually racks. A list is saved as a whole, so removing a row here removes it from the public page."
      >
        <Flash flash={flash.converter ?? null} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          {(['bars', 'plates'] as const).map(kind => (
            <div key={kind} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '1.1rem 1.25rem' }}>
              <p style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: '.75rem' }}>
                {kind === 'bars' ? 'Bars' : 'Plates'}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 76px 76px auto', gap: '.4rem', alignItems: 'center' }}>
                <span style={{ ...headCell, textAlign: 'left', padding: '0 .1rem .1rem' }}>Label</span>
                <span style={{ ...headCell, padding: '0 .1rem .1rem' }}>Lbs</span>
                <span style={{ ...headCell, padding: '0 .1rem .1rem' }}>Kg</span>
                <span />
                {converter[kind].map((row, i) => (
                  <Fragment key={i}>
                    <input
                      type="text"
                      maxLength={80}
                      disabled={disabled}
                      value={row.label}
                      placeholder="45 lb / 20 kg bar"
                      aria-label={`${kind === 'bars' ? 'Bar' : 'Plate'} ${i + 1} label`}
                      onChange={e => setConvCell(kind, i, 'label', e.target.value)}
                      style={{ ...cellStyle(convRowChanged(kind, i, 'label'), disabled), textAlign: 'left' }}
                    />
                    <input
                      type="number"
                      step="0.5"
                      min={LIMITS.referenceWeight.min}
                      max={LIMITS.referenceWeight.max}
                      disabled={disabled}
                      value={row.lbs}
                      aria-label={`${kind === 'bars' ? 'Bar' : 'Plate'} ${i + 1} weight in pounds`}
                      onChange={e => setConvCell(kind, i, 'lbs', e.target.value)}
                      onBlur={() => blurConvCell(kind, i, 'lbs')}
                      style={cellStyle(convRowChanged(kind, i, 'lbs'), disabled)}
                    />
                    <input
                      type="number"
                      step="0.25"
                      min={LIMITS.referenceWeight.min}
                      max={LIMITS.referenceWeight.max}
                      disabled={disabled}
                      value={row.kg}
                      aria-label={`${kind === 'bars' ? 'Bar' : 'Plate'} ${i + 1} weight in kilos`}
                      onChange={e => setConvCell(kind, i, 'kg', e.target.value)}
                      onBlur={() => blurConvCell(kind, i, 'kg')}
                      style={cellStyle(convRowChanged(kind, i, 'kg'), disabled)}
                    />
                    <button
                      type="button"
                      onClick={() => removeConvRow(kind, i)}
                      disabled={disabled}
                      aria-label={`Remove ${kind === 'bars' ? 'bar' : 'plate'} row ${i + 1}`}
                      title="Remove this row"
                      style={{
                        ...ghostBtn, padding: '.45rem .6rem',
                        opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer',
                      }}
                    >
                      ×
                    </button>
                  </Fragment>
                ))}
              </div>
              <button
                type="button"
                onClick={() => addConvRow(kind)}
                disabled={disabled}
                style={{
                  ...ghostBtn, marginTop: '.75rem', padding: '.55rem 1rem',
                  opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer',
                }}
              >
                Add a row
              </button>
            </div>
          ))}
        </div>

        <SectionActions
          saving={saving === 'converter'}
          disabled={disabled}
          changed={anyConvChanged}
          onSave={() => void saveConverter()}
          onReset={() => void reset('converter')}
        />
      </SettingsSection>

      {/* ── Score benchmarks ────────────────────────────────────────────── */}
      <SettingsSection
        title="Score tiers"
        intro={
          <>
            The score each level begins at, per scoring system. The formulas themselves are not
            editable and should not be: Dots, Wilks and IPF GL are published standards, and a score
            computed against house coefficients is one no other calculator would agree with. Where
            &ldquo;Elite&rdquo; starts is the coaching call, and that is what these boxes are.
          </>
        }
      >
        <Flash flash={flash.scores ?? null} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {SCHEMES.map(({ key: scheme, label, note }) => (
            <div key={scheme} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '1.1rem 1.25rem' }}>
              <p style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: '.2rem' }}>{label}</p>
              <p style={{ color: 'var(--text-4)', fontSize: '.72rem', lineHeight: 1.5, marginBottom: '1rem' }}>{note}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '.75rem' }}>
                {scores[scheme].map((value, i) => (
                  <div key={i}>
                    <label className="field-label" style={{ fontSize: '.6rem', marginBottom: '.35rem' }}>
                      {tierLabels[i + 1]} from
                    </label>
                    <input
                      type="number"
                      step="1"
                      min={0}
                      disabled={disabled}
                      value={value}
                      aria-label={`${label}: the score ${tierLabels[i + 1]} begins at`}
                      onChange={e => setCutoff(scheme, i, e.target.value)}
                      onBlur={() => blurCutoff(scheme, i)}
                      style={{ ...cellStyle(scoreChanged(scheme, i), disabled), textAlign: 'left', padding: '.55rem .7rem', fontSize: '.82rem' }}
                    />
                  </div>
                ))}
              </div>
              <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.7rem' }}>
                {tierLabels[0]} is everything below the first box, and the labels on the public page
                are written from these numbers, so they cannot drift apart.
              </p>
            </div>
          ))}
        </div>

        <SectionActions
          saving={saving === 'scores'}
          disabled={disabled}
          changed={anyScoreChanged}
          onSave={() => void saveScores()}
          onReset={() => void reset('scores')}
        />
      </SettingsSection>
    </div>
  )
}
