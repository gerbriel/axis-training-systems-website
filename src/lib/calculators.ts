/**
 * calculators.ts — the numbers behind the free tools, and the registry that
 * decides which tools and guides the public sees.
 *
 * Two things used to be spread across three component files and are now here,
 * once each:
 *
 *   1. THE TUNABLE CONSTANTS. The RPE chart, the attempt percentages, the
 *      rounding increments, the bar and plate reference weights, the score tier
 *      cutoffs. Tools.tsx held one copy and GuidesPage.tsx held a second copy of
 *      the attempt percentages, verbatim, which meant the same site could quote
 *      two different openers depending on which page you opened. There is now
 *      one copy, and both surfaces read it.
 *
 *   2. THE PUBLIC REGISTRY. Which tools appear in the strip, which guides
 *      appear on /guides, what they are called, what order they come in, and
 *      which of them ask for an email first. It comes from the database
 *      (resourceLibrary.ts, migrations 040/041) and falls back to the arrays
 *      below when the database cannot be reached.
 *
 * ── Overrides, not values ───────────────────────────────────────────────────
 *
 * `calculator_settings` (migration 042) stores the DIFFERENCE between these
 * defaults and what the owner asked for, not the settings themselves. An empty
 * table means every calculator behaves exactly as it shipped, and a row only
 * carries the fields somebody actually changed, so a later correction to a
 * default still reaches a site that never overrode it.
 *
 * `mergeCalculatorConfig` is where that merge happens. It is PURE and exported
 * so the ranges below are testable without a database, and it is defensive
 * field by field: an unreadable field falls back to its default rather than
 * taking the whole calculator down with it. The client, not the database, is
 * where a number is clamped — see 042's header for why the table has no CHECK
 * per value.
 *
 * ── What is NOT tunable ─────────────────────────────────────────────────────
 *
 * The Dots / Wilks / IPF GL coefficients and the IPF weight classes stay in
 * Tools.tsx as literals. They are published standards, not preferences: an
 * editable Wilks polynomial produces a score nobody else can reproduce. Only
 * the tier CUTOFFS ("Elite starts at 380") are opinion, and only those moved.
 *
 * Nothing here throws. Reads answer defaults on failure, writes answer a
 * WriteResult. This is SIGNAGE — RLS in 042 is what actually refuses a write.
 */

import { useEffect, useState } from 'react'
import { supabase, supabaseConfigured } from './supabase.ts'
import { fetchPublishedResources } from './resourceLibrary.ts'
import { parseGuideContent } from './guideContent.ts'
import type { ResourceItem, ResourceKind } from './resourceLibrary.ts'
import type { WriteResult } from '../types/messaging.ts'

export type { WriteResult }

// =============================================================================
// TYPES
// =============================================================================

export type CalculatorKey = 'rpe' | 'attempts' | 'converter' | 'scores'

export const CALCULATOR_KEYS: readonly CalculatorKey[] = ['rpe', 'attempts', 'converter', 'scores'] as const

/** One meet-day plan: what fraction of the training max each attempt is. */
export interface AttemptProfile {
  open: number
  second: number
  third: number
}

export interface BarSpec {
  lbs: number
  kg: number
  label: string
}

export interface PlateSpec {
  lbs: number
  kg: number
  label: string
}

/**
 * A tier on a scoring scale. `cutoff` is the exclusive upper bound (a score
 * BELOW it is in this tier), and the top tier's cutoff is Infinity.
 *
 * `range` is DERIVED from the cutoffs, never stored. It used to be typed by
 * hand next to the number it described, which is a caption that goes stale the
 * moment an owner edits the cutoff it captions.
 */
export interface ScoreTier {
  label: string
  cutoff: number
  range: string
}

export interface ScoreScheme {
  /** Full width of the progress bar for this scale. */
  barMax: number
  /** The bar's right-hand caption, derived from barMax. */
  barLabel: string
  tiers: ScoreTier[]
}

export type ScoreSchemeKey = 'dots' | 'wilks' | 'gl'

export type ScoreBenchmarks = Record<ScoreSchemeKey, ScoreScheme>

export interface CalculatorConfig {
  /** table['8'][3] = the fraction of 1RM a triple at RPE 8 represents. */
  rpe: { table: Record<string, Record<number, number>> }
  attempts: {
    profiles: { conservative: AttemptProfile; aggressive: AttemptProfile }
    rounding: { lbs: number; kg: number }
  }
  converter: { bars: BarSpec[]; plates: PlateSpec[] }
  scores: { benchmarks: ScoreBenchmarks }
}

// =============================================================================
// DEFAULTS
// =============================================================================

/** Every rep count the chart covers, in order. */
export const RPE_REPS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/** Every RPE row the selector offers, in order: 6, 6.5, 7 … 10. */
export const RPE_STEPS: readonly number[] = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]

/**
 * The Tuchscherer chart, at whole RPEs, exactly as it has always been.
 *
 * These five rows are the published chart and are transcribed, not computed.
 * The half-RPE rows below ARE computed from them.
 */
const TUCHSCHERER: Record<number, Record<number, number>> = {
  10: { 1: 1.000, 2: 0.955, 3: 0.922, 4: 0.892, 5: 0.863, 6: 0.837, 7: 0.811, 8: 0.786, 9: 0.762, 10: 0.739 },
   9: { 1: 0.955, 2: 0.922, 3: 0.892, 4: 0.863, 5: 0.837, 6: 0.811, 7: 0.786, 8: 0.762, 9: 0.739, 10: 0.714 },
   8: { 1: 0.922, 2: 0.892, 3: 0.863, 4: 0.837, 5: 0.811, 6: 0.786, 7: 0.762, 8: 0.739, 9: 0.714, 10: 0.688 },
   7: { 1: 0.892, 2: 0.863, 3: 0.837, 4: 0.811, 5: 0.786, 6: 0.762, 7: 0.739, 8: 0.714, 9: 0.688, 10: 0.663 },
   6: { 1: 0.863, 2: 0.837, 3: 0.811, 4: 0.786, 5: 0.762, 6: 0.739, 7: 0.714, 8: 0.688, 9: 0.663, 10: 0.637 },
}

/** '6' | '6.5' | … | '10'. The key an RPE row is stored under. */
export function rpeKey(rpe: number): string {
  return String(rpe)
}

/** Four decimals. Halving a three-decimal chart value needs exactly four, so
 *  this is lossless for the interpolation below and only exists to keep
 *  0.798500000000000001 out of a number input. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

/**
 * The chart the selector actually offers, half RPEs included.
 *
 * The UI has always listed 6.5, 7.5, 8.5 and 9.5, and the calculator has always
 * answered them with `Math.round(rpe)` — so picking 7.5 silently gave you the
 * RPE 8 row, and picking 8.5 silently gave you RPE 8 as well. Two different
 * selections, one answer, no indication that the thing you chose was ignored.
 *
 * A half RPE is now the midpoint of the two whole rows either side of it, at
 * the same rep count. That is not a published figure and is not claimed to be
 * one: it is the straight line between two published ones, which is exactly
 * what a coach reading "somewhere between RPE 7 and RPE 8" already means. The
 * whole rows are untouched, so every answer the calculator gave before, for a
 * whole RPE, it still gives.
 */
function buildRpeTable(): Record<string, Record<number, number>> {
  const table: Record<string, Record<number, number>> = {}
  for (const rpe of RPE_STEPS) {
    const row: Record<number, number> = {}
    if (Number.isInteger(rpe)) {
      for (const reps of RPE_REPS) row[reps] = TUCHSCHERER[rpe][reps]
    } else {
      const lower = TUCHSCHERER[Math.floor(rpe)]
      const upper = TUCHSCHERER[Math.ceil(rpe)]
      for (const reps of RPE_REPS) row[reps] = round4((lower[reps] + upper[reps]) / 2)
    }
    table[rpeKey(rpe)] = row
  }
  return table
}

const DEFAULT_ATTEMPT_PROFILES: { conservative: AttemptProfile; aggressive: AttemptProfile } = {
  conservative: { open: 0.90, second: 0.96, third: 1.00 },
  aggressive:   { open: 0.91, second: 0.97, third: 1.03 },
}

/** The plate maths of each unit: 5 lb jumps, 2.5 kg jumps. */
const DEFAULT_ROUNDING = { lbs: 5, kg: 2.5 }

const DEFAULT_BARS: BarSpec[] = [
  { lbs: 45, kg: 20, label: 'Standard barbell' },
  { lbs: 55, kg: 25, label: "Women's barbell" },
  { lbs: 33, kg: 15, label: 'Technique bar' },
]

const DEFAULT_PLATES: PlateSpec[] = [
  { lbs: 100, kg: 45,   label: '100 lb / 45 kg plate' },
  { lbs:  55, kg: 25,   label: '55 lb / 25 kg plate' },
  { lbs:  45, kg: 20,   label: '45 lb / 20 kg plate' },
  { lbs:  35, kg: 15,   label: '35 lb / 15 kg plate' },
  { lbs:  25, kg: 11,   label: '25 lb / 10 kg plate' },
  { lbs:  10, kg: 5,    label: '10 lb / 5 kg plate' },
  { lbs:   5, kg: 2.5,  label: '5 lb / 2.5 kg plate' },
  { lbs: 2.5, kg: 1.25, label: '2.5 lb / 1.25 kg plate' },
]

/** A tier boundary, before its caption is worked out. */
interface TierSeed { label: string; cutoff: number }

const DEFAULT_TIER_LABELS = ['Beginner', 'Intermediate', 'Advanced', 'Elite', 'World-class'] as const

const DEFAULT_SCHEME_SEEDS: Record<ScoreSchemeKey, { barMax: number; cutoffs: number[] }> = {
  // Dots and Wilks land on numerically similar scales, so they share cutoffs.
  dots:  { barMax: 500, cutoffs: [200, 300, 380, 450] },
  wilks: { barMax: 500, cutoffs: [200, 300, 380, 450] },
  // Goodlift runs 0–120, where 100+ is world class.
  gl:    { barMax: 120, cutoffs: [40, 60, 80, 100] },
}

/** A cutoff as it reads in a caption: 380, not 380.00. */
function fmtCutoff(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/**
 * Turn cutoffs into a scheme, captions and all.
 *
 * `cutoffs` is one shorter than the tier list: the top tier has no upper bound.
 */
function buildScheme(barMax: number, labels: readonly string[], cutoffs: number[]): ScoreScheme {
  const seeds: TierSeed[] = labels.map((label, i) => ({
    label,
    cutoff: i < cutoffs.length ? cutoffs[i] : Infinity,
  }))
  const tiers: ScoreTier[] = seeds.map((seed, i) => {
    const range = i === 0
      ? `< ${fmtCutoff(seed.cutoff)}`
      : i === seeds.length - 1
        ? `${fmtCutoff(seeds[i - 1].cutoff)}+`
        : `${fmtCutoff(seeds[i - 1].cutoff)} – ${fmtCutoff(seed.cutoff)}`
    return { label: seed.label, cutoff: seed.cutoff, range }
  })
  return { barMax, barLabel: `${fmtCutoff(barMax)}+`, tiers }
}

function defaultBenchmarks(): ScoreBenchmarks {
  return {
    dots:  buildScheme(DEFAULT_SCHEME_SEEDS.dots.barMax,  DEFAULT_TIER_LABELS, [...DEFAULT_SCHEME_SEEDS.dots.cutoffs]),
    wilks: buildScheme(DEFAULT_SCHEME_SEEDS.wilks.barMax, DEFAULT_TIER_LABELS, [...DEFAULT_SCHEME_SEEDS.wilks.cutoffs]),
    gl:    buildScheme(DEFAULT_SCHEME_SEEDS.gl.barMax,    DEFAULT_TIER_LABELS, [...DEFAULT_SCHEME_SEEDS.gl.cutoffs]),
  }
}

/**
 * A fresh copy of everything the calculators ship with.
 *
 * A COPY, every call: the merge writes into what it is given, and a caller that
 * accidentally edited a shared default would change the numbers for every other
 * screen in the tab.
 */
export function defaultCalculatorConfig(): CalculatorConfig {
  return {
    rpe: { table: buildRpeTable() },
    attempts: {
      profiles: {
        conservative: { ...DEFAULT_ATTEMPT_PROFILES.conservative },
        aggressive:   { ...DEFAULT_ATTEMPT_PROFILES.aggressive },
      },
      rounding: { ...DEFAULT_ROUNDING },
    },
    converter: {
      bars:   DEFAULT_BARS.map(b => ({ ...b })),
      plates: DEFAULT_PLATES.map(p => ({ ...p })),
    },
    scores: { benchmarks: defaultBenchmarks() },
  }
}

// =============================================================================
// LIMITS
// =============================================================================
//
// The ranges the merge clamps to. Exported because the admin panel puts the
// same numbers on its inputs, and two copies of a limit is one copy too many.

export const LIMITS = {
  /** An RPE fraction. 1.2 leaves room for a chart that quotes above a true max;
   *  zero and below is not a smaller value, it is a broken one, so it falls back
   *  to the default rather than clamping to some arbitrary floor. */
  rpeFraction: { max: 1.2 },
  /** An attempt as a fraction of the training max. */
  attemptPct: { min: 0.5, max: 1.15 },
  /** The smallest jump a plate set can make. */
  rounding: { min: 0.5, max: 10 },
  /** A reference weight on the converter's quick-pick list. */
  referenceWeight: { min: 0.25, max: 10000 },
  /** A tier cutoff or a bar maximum. */
  scoreCutoff: { min: 0.01, max: 100000 },
} as const

// =============================================================================
// MERGE — pure, defensive, field by field
// =============================================================================

/** A finite number, or null for anything else (strings, NaN, objects, null). */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** True for a plain JSON object — not an array, not null, not a scalar. */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asObject(v: unknown): Record<string, unknown> | null {
  return isObject(v) ? v : null
}

/**
 * The RPE chart, cell by cell.
 *
 * Only cells that already exist in the defaults are writable, so an override
 * cannot invent an RPE 11 row or an 11th rep the selector has no entry for.
 * Each cell is independent: one unreadable number costs that one cell.
 */
function mergeRpe(target: CalculatorConfig['rpe'], params: unknown): void {
  const table = asObject(asObject(params)?.table)
  if (!table) return
  for (const rowKey of Object.keys(target.table)) {
    const row = asObject(table[rowKey])
    if (!row) continue
    for (const reps of RPE_REPS) {
      // JSON keys are strings, always, however the number was written.
      const raw = num(row[String(reps)])
      if (raw === null || raw <= 0) continue
      target.table[rowKey][reps] = round4(Math.min(raw, LIMITS.rpeFraction.max))
    }
  }
}

/**
 * One attempt profile, all three numbers or none of them.
 *
 * A triple that goes backwards is discarded WHOLE. Re-sorting it would be the
 * tempting fix and it is the wrong one: an owner who typed 0.96 into the opener
 * box and 0.90 into the second gets their meet plan back the way they meant it
 * only by noticing the mistake, and a plan that quietly rearranges itself is a
 * plan that never tells them. Out-of-range is different from out-of-order and
 * is clamped, because 1.30 unambiguously means "as high as you will let me".
 */
function mergeAttemptProfile(target: AttemptProfile, params: unknown): void {
  const raw = asObject(params)
  if (!raw) return
  const open = num(raw.open)
  const second = num(raw.second)
  const third = num(raw.third)
  if (open === null || second === null || third === null) return
  if (!(open <= second && second <= third)) return
  const { min, max } = LIMITS.attemptPct
  target.open = clamp(open, min, max)
  target.second = clamp(second, min, max)
  target.third = clamp(third, min, max)
}

function mergeAttempts(target: CalculatorConfig['attempts'], params: unknown): void {
  const raw = asObject(params)
  if (!raw) return

  const profiles = asObject(raw.profiles)
  if (profiles) {
    mergeAttemptProfile(target.profiles.conservative, profiles.conservative)
    mergeAttemptProfile(target.profiles.aggressive, profiles.aggressive)
  }

  const rounding = asObject(raw.rounding)
  if (rounding) {
    const { min, max } = LIMITS.rounding
    const lbs = num(rounding.lbs)
    const kg = num(rounding.kg)
    if (lbs !== null) target.rounding.lbs = clamp(lbs, min, max)
    if (kg !== null) target.rounding.kg = clamp(kg, min, max)
  }
}

/** One quick-pick row: two positive weights and something to call it. */
function readWeights(v: unknown): BarSpec | null {
  const raw = asObject(v)
  if (!raw) return null
  const lbs = num(raw.lbs)
  const kg = num(raw.kg)
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 80) : ''
  if (lbs === null || kg === null || !label) return null
  const { min, max } = LIMITS.referenceWeight
  if (lbs < min || lbs > max || kg < min || kg > max) return null
  return { lbs, kg, label }
}

/**
 * A quick-pick list is replaced wholesale or not at all.
 *
 * Unlike the RPE chart there is no stable identity for a row here — "the third
 * plate" is not a thing an override can address — so a per-row merge would have
 * to guess, and a list that came back half from the database and half from the
 * defaults is a plate rack that does not exist in any gym. An override that
 * leaves nothing usable behind is ignored, so a typo cannot empty the rack.
 */
function readWeightList(v: unknown): BarSpec[] | null {
  if (!Array.isArray(v)) return null
  const rows = v.map(readWeights).filter((r): r is BarSpec => r !== null)
  return rows.length > 0 ? rows : null
}

function mergeConverter(target: CalculatorConfig['converter'], params: unknown): void {
  const raw = asObject(params)
  if (!raw) return
  const bars = readWeightList(raw.bars)
  if (bars) target.bars = bars
  const plates = readWeightList(raw.plates)
  if (plates) target.plates = plates
}

/**
 * One scoring scheme's tier cutoffs.
 *
 * `cutoffs` is exactly one shorter than the tier list, in ascending order, all
 * positive. Anything else is ignored for that scheme: a non-increasing set of
 * cutoffs describes tiers that overlap, and the first tier a score falls into
 * would depend on the order they happen to be listed in rather than on the
 * score. Labels stay in code — they are copy, not configuration.
 */
function mergeScheme(target: ScoreScheme, params: unknown): void {
  const raw = asObject(params)
  if (!raw) return

  const labels = target.tiers.map(t => t.label)
  const { min, max } = LIMITS.scoreCutoff

  let barMax = target.barMax
  const rawBarMax = num(raw.barMax)
  if (rawBarMax !== null && rawBarMax > 0) barMax = clamp(rawBarMax, min, max)

  let cutoffs = target.tiers.slice(0, -1).map(t => t.cutoff)
  if (raw.cutoffs !== undefined && Array.isArray(raw.cutoffs)) {
    const next = raw.cutoffs.map(num)
    const wellFormed =
      next.length === labels.length - 1 &&
      next.every(n => n !== null && n > 0) &&
      next.every((n, i) => i === 0 || (n as number) > (next[i - 1] as number))
    // Ignoring the cutoffs does not have to mean ignoring barMax: they are
    // independent numbers and a bad one should not undo a good one.
    if (wellFormed) cutoffs = next.map(n => clamp(n as number, min, max))
  }

  const rebuilt = buildScheme(barMax, labels, cutoffs)
  target.barMax = rebuilt.barMax
  target.barLabel = rebuilt.barLabel
  target.tiers = rebuilt.tiers
}

function mergeScores(target: CalculatorConfig['scores'], params: unknown): void {
  const raw = asObject(params)
  if (!raw) return
  mergeScheme(target.benchmarks.dots, raw.dots)
  mergeScheme(target.benchmarks.wilks, raw.wilks)
  mergeScheme(target.benchmarks.gl, raw.gl)
}

/**
 * Defaults with the database's overrides applied on top.
 *
 * Pure: `defaults` is not touched, and the same inputs always give the same
 * answer, which is what makes the clamping rules above testable without a
 * database behind them.
 *
 * Rows for an unknown calculator are skipped. Two rows for the same calculator
 * are applied in the order given, so the last one wins — the primary key makes
 * that impossible from the database, but the function does not assume it.
 */
export function mergeCalculatorConfig(
  defaults: CalculatorConfig,
  rows: { calculator: string; params: unknown }[],
): CalculatorConfig {
  const merged = cloneConfig(defaults)
  if (!Array.isArray(rows)) return merged

  for (const row of rows) {
    if (!isObject(row)) continue
    switch (row.calculator) {
      case 'rpe':       mergeRpe(merged.rpe, row.params); break
      case 'attempts':  mergeAttempts(merged.attempts, row.params); break
      case 'converter': mergeConverter(merged.converter, row.params); break
      case 'scores':    mergeScores(merged.scores, row.params); break
      default: break
    }
  }
  return merged
}

/** A deep copy of a config, so the merge can write in place without reaching
 *  back into the caller's object. Hand-written rather than structuredClone
 *  because Infinity is a legitimate cutoff and JSON round-tripping loses it. */
function cloneConfig(c: CalculatorConfig): CalculatorConfig {
  const table: Record<string, Record<number, number>> = {}
  for (const key of Object.keys(c.rpe.table)) table[key] = { ...c.rpe.table[key] }
  const scheme = (s: ScoreScheme): ScoreScheme => ({
    barMax: s.barMax,
    barLabel: s.barLabel,
    tiers: s.tiers.map(t => ({ ...t })),
  })
  return {
    rpe: { table },
    attempts: {
      profiles: {
        conservative: { ...c.attempts.profiles.conservative },
        aggressive:   { ...c.attempts.profiles.aggressive },
      },
      rounding: { ...c.attempts.rounding },
    },
    converter: {
      bars:   c.converter.bars.map(b => ({ ...b })),
      plates: c.converter.plates.map(p => ({ ...p })),
    },
    scores: {
      benchmarks: {
        dots:  scheme(c.scores.benchmarks.dots),
        wilks: scheme(c.scores.benchmarks.wilks),
        gl:    scheme(c.scores.benchmarks.gl),
      },
    },
  }
}

// =============================================================================
// READ / WRITE
// =============================================================================

/** Demo and "no credentials" are the same to a screen: nothing to talk to. */
const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

/** A beat of latency so demo saving-states read as honest, not instant. */
const beat = () => new Promise<void>(r => setTimeout(r, 220))

/**
 * The demo override store.
 *
 * The admin panel has to be usable in the demo portal and in a preview build
 * with no credentials, which means a save has to land SOMEWHERE and a reload of
 * the panel has to show it. It lives for the life of the tab and resets on
 * refresh, the same story settings.ts tells for its nine panels.
 */
const demoOverrides = new Map<CalculatorKey, unknown>()

function demoRows(): { calculator: string; params: unknown }[] {
  return [...demoOverrides.entries()].map(([calculator, params]) => ({ calculator, params }))
}

/** A PostgREST error, in a sentence a person can act on. */
function writeMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  const code = error.code ?? ''
  const msg = (error.message ?? '').replace(/^ERROR:\s*/i, '').trim()
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'The database refused that change. Your account may not have permission to manage the calculators.'
  }
  // 042's guard raises these two with a sentence already fit to read.
  if (code === '22023' || code === '23514') return msg || fallback
  if (code === 'PGRST301' || /jwt|token is expired/i.test(msg)) {
    return 'Your session expired. Sign in again and the change will go through.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection, nothing was changed.'
  }
  if (/does not exist|schema cache/i.test(msg)) {
    return 'The calculator settings table is not there yet. Apply migration 042 and try again.'
  }
  return fallback
}

/**
 * The live config: defaults, with whatever the owner has changed on top.
 *
 * Never throws and never answers nothing. A refusal, an outage, a table that
 * has not been migrated yet: all of them answer the shipped defaults, because a
 * calculator that renders the wrong-ish number is a smaller failure than a
 * calculator that renders an error where a public page used to be.
 */
export async function fetchCalculatorConfig(isDemo = false): Promise<CalculatorConfig> {
  const defaults = defaultCalculatorConfig()
  if (offline(isDemo)) return mergeCalculatorConfig(defaults, demoRows())

  try {
    const { data, error } = await supabase
      .from('calculator_settings')
      .select('calculator,params')
    if (error || !Array.isArray(data)) return defaults
    return mergeCalculatorConfig(defaults, data as unknown as { calculator: string; params: unknown }[])
  } catch {
    return defaults
  }
}

/**
 * Store one calculator's overrides.
 *
 * `params` of `{}` is the reset: it says "nothing is overridden here", which is
 * how the panel's Reset button works. The row stays so the audit trail of who
 * reset it survives.
 */
export async function saveCalculatorParams(
  calculator: CalculatorKey,
  params: unknown,
  isDemo = false,
): Promise<WriteResult> {
  if (!CALCULATOR_KEYS.includes(calculator)) {
    return { ok: false, message: 'That is not one of the calculators.' }
  }
  // The same shape check 042's guard trigger makes, one round trip earlier.
  if (!isObject(params)) {
    return { ok: false, message: 'Calculator settings have to be an object of overrides.' }
  }

  invalidateCalculatorConfig()

  if (offline(isDemo)) {
    await beat()
    demoOverrides.set(calculator, params)
    return { ok: true }
  }

  try {
    const { data, error } = await supabase
      .from('calculator_settings')
      .upsert({ calculator, params }, { onConflict: 'calculator' })
      .select('calculator')
    if (error) return { ok: false, message: writeMessage(error, 'That did not save.') }
    // An RLS refusal can come back as zero rows and no error. Treat it as the
    // permission failure it is rather than as a save.
    if (!data || data.length === 0) {
      return { ok: false, message: 'The database refused that change. Your account may not have permission to manage the calculators.' }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection, nothing was changed.' }
  }
}

// ── The shared read ─────────────────────────────────────────────────────────
//
// Several calculators can be on screen at once (the homepage strip mounts one,
// a guide card mounts another), and they all want the same answer. One promise,
// shared, dropped whenever a save makes it stale.

let sharedConfig: Promise<CalculatorConfig> | null = null

export function invalidateCalculatorConfig(): void {
  sharedConfig = null
}

function sharedCalculatorConfig(): Promise<CalculatorConfig> {
  if (!sharedConfig) sharedConfig = fetchCalculatorConfig()
  return sharedConfig
}

/**
 * The config, for a component.
 *
 * Starts at the defaults so the first paint is a working calculator rather than
 * a spinner, and swaps in the fetched config when it lands. Every calculator
 * recomputes from its own state on each render, so a late swap simply changes
 * the answer to whatever the owner set. Nothing is captured at mount.
 */
export function useCalculatorConfig(): CalculatorConfig {
  const [config, setConfig] = useState<CalculatorConfig>(defaultCalculatorConfig)

  useEffect(() => {
    let live = true
    void sharedCalculatorConfig().then(next => { if (live) setConfig(next) })
    return () => { live = false }
  }, [])

  return config
}

// =============================================================================
// THE PUBLIC REGISTRY
// =============================================================================
//
// Which tools and guides exist, in what order, under what names. It lives in
// `resources` (the sibling's table) so the owner can rename a guide, reorder
// the strip, unpublish something seasonal or add a link out, without a deploy.
//
// The arrays below are the FALLBACK, not a duplicate: they are what renders
// when the database cannot be reached, and they are exactly the registries
// these three pages hardcoded before this change. A null answer means "we could
// not ask" and takes the fallback; an EMPTY answer means the owner published
// nothing, and is honoured as the empty library it is.

/** The tool components Tools.tsx exports, by the key a resource row names. */
export type BuiltinToolKey = 'rpe' | 'dots' | 'convert' | 'attempts' | 'rankings'

/** The guide components GuidesPage.tsx defines, by the key a row names. */
export type BuiltinGuideKey = 'checklist' | 'attempts' | 'quiz' | 'rpe' | 'big3' | 'audit'

export interface ToolEntry {
  /** The slug in /tools/<id>. */
  id: string
  label: string
  desc: string
  /** Which component renders it. */
  builtin: BuiltinToolKey
  /** Ask for an email before showing it. */
  requiresSignup: boolean
}

export interface GuideEntry {
  id: string
  /** What the card renders. Every kind reads `config` first; a 'guide' with
   *  nothing in it falls back to the component `builtin` names. */
  kind: ResourceKind
  label: string
  description: string
  tag: string
  /** The newsletter signup source recorded when this card opens the gate. */
  source: string
  /** The component behind a built-in guide. Null for a guide that is content
   *  alone, which is what a duplicate or an owner-written one is. */
  builtin: BuiltinGuideKey | null
  /** The row's config, unread: `content`, `body` and `url` are the page's to
   *  interpret, because it is the one that knows how to render each. */
  config: Record<string, unknown>
  requiresSignup: boolean
}

export const FALLBACK_TOOLS: ToolEntry[] = [
  {
    id: 'rpe',
    label: 'RPE Calculator',
    desc: 'Estimate your 1RM or get a prescribed working weight from any RPE and rep target.',
    builtin: 'rpe',
    requiresSignup: false,
  },
  {
    id: 'dots',
    label: 'Dots Score',
    desc: 'Calculate your Dots coefficient to compare performance across weight classes and sexes.',
    builtin: 'dots',
    requiresSignup: false,
  },
  {
    id: 'convert',
    label: 'Weight Converter',
    desc: 'Instantly convert between lbs and kg for any weight or total.',
    builtin: 'convert',
    requiresSignup: false,
  },
  {
    id: 'attempts',
    label: 'Attempt Planner',
    desc: 'Plan your opener, second, and third attempts based on your training maxes and meet strategy.',
    builtin: 'attempts',
    requiresSignup: true,
  },
  {
    id: 'rankings',
    label: 'View Rankings',
    desc: 'Browse 3M+ powerlifting results worldwide. Filter by federation, weight class, and gender.',
    builtin: 'rankings',
    requiresSignup: false,
  },
]

export const FALLBACK_GUIDES: GuideEntry[] = [
  {
    id: 'checklist', kind: 'guide', builtin: 'checklist', source: 'meet_checklist',
    label: 'Meet Day Checklist',
    description: 'Warmup timing, attempt strategy, gear bag essentials: everything you need the night before and on the day.',
    tag: 'Free Checklist', config: {}, requiresSignup: true,
  },
  {
    id: 'attempts', kind: 'guide', builtin: 'attempts', source: 'attempt_planner',
    label: 'Attempt Selection Calculator',
    description: 'Enter your training maxes and get your opener, second, and third attempt recommendations based on proven percentages.',
    tag: 'Interactive Tool', config: {}, requiresSignup: true,
  },
  {
    id: 'quiz', kind: 'guide', builtin: 'quiz', source: 'quiz',
    label: '"Is Your Training Leaving Gains on the Table?" Quiz',
    description: '6 questions. Score your programming, volume management, recovery habits, and more. Get your tier and a clear picture of what to fix.',
    tag: 'Scored Quiz', config: {}, requiresSignup: true,
  },
  {
    id: 'rpe', kind: 'guide', builtin: 'rpe', source: 'rpe_guide',
    label: 'RPE Guide for Beginners',
    description: 'What RPE 6 to 10 actually means, how many reps each level implies, and how to calibrate your own effort accurately.',
    tag: 'Reference Guide', config: {}, requiresSignup: true,
  },
  {
    id: 'big3', kind: 'guide', builtin: 'big3', source: 'big_three',
    label: "Beginner's Guide to the Big Three",
    description: 'Squat, bench, and deadlift cue breakdowns, phase-by-phase. Setup, execution, and the most common technical mistakes.',
    tag: 'Technical Guide', config: {}, requiresSignup: true,
  },
  {
    id: 'audit', kind: 'guide', builtin: 'audit', source: 'audit_worksheet',
    label: 'Audit Your Last Training Block',
    description: 'Rate your last block across 6 programming dimensions. Score your structure, specificity, recovery management, and compliance.',
    tag: 'Scored Worksheet', config: {}, requiresSignup: true,
  },
]

/**
 * A resource row's builtin_key, in the spelling this file uses.
 *
 * The aliases matter because the seed on the other side of this contract was
 * written from the old GUIDES array, where the same component answered to two
 * names: the card's `id` ('big3') and its newsletter `source` ('big_three').
 * Matching only one of them would leave a published guide rendering nothing.
 * The kind decides which map is consulted, which is what lets 'rpe' mean the
 * RPE calculator on a tool row and the RPE explainer on a guide row.
 */
const TOOL_KEY_ALIASES: Record<string, BuiltinToolKey> = {
  rpe: 'rpe', rpe_calculator: 'rpe',
  dots: 'dots', dots_score: 'dots', dots_calculator: 'dots',
  convert: 'convert', converter: 'convert', weight_converter: 'convert',
  attempts: 'attempts', attempt_planner: 'attempts',
  rankings: 'rankings', view_rankings: 'rankings',
}

const GUIDE_KEY_ALIASES: Record<string, BuiltinGuideKey> = {
  checklist: 'checklist', meet_checklist: 'checklist', meet_day_checklist: 'checklist',
  attempts: 'attempts', attempt_planner: 'attempts', attempt_calculator: 'attempts',
  quiz: 'quiz', training_quiz: 'quiz',
  rpe: 'rpe', rpe_guide: 'rpe',
  big3: 'big3', big_three: 'big3',
  audit: 'audit', audit_worksheet: 'audit',
}

/** Lowercased, hyphens as underscores, any `tool:`/`guide_` prefix dropped. */
function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/^(tool|tools|guide|guides)[:_]/, '')
}

function toolBuiltin(key: string | null): BuiltinToolKey | null {
  if (!key) return null
  return TOOL_KEY_ALIASES[normalizeKey(key)] ?? null
}

function guideBuiltin(key: string | null): BuiltinGuideKey | null {
  if (!key) return null
  return GUIDE_KEY_ALIASES[normalizeKey(key)] ?? null
}

function publishedInOrder(rows: ResourceItem[], kinds: ResourceKind[]): ResourceItem[] {
  return rows
    .filter(r => !!r && r.is_published && kinds.includes(r.kind))
    .slice()
    .sort((a, b) =>
      ((a.sort_order ?? 0) - (b.sort_order ?? 0)) ||
      String(a.title ?? '').localeCompare(String(b.title ?? '')))
}

/**
 * The tool strip, from the library.
 *
 * A tool row whose builtin_key names no component we have is DROPPED, not
 * rendered empty: there is nothing behind /tools/<slug> for it, and a tab that
 * leads to a blank panel is worse than a tab that is not there. Custom kinds
 * belong on the guides page, which can render them.
 */
export function composeToolRegistry(rows: ResourceItem[] | null): ToolEntry[] {
  if (rows === null) return FALLBACK_TOOLS.map(t => ({ ...t }))
  return publishedInOrder(rows, ['tool'])
    .map(r => {
      const builtin = toolBuiltin(r.builtin_key)
      if (!builtin) return null
      return {
        id: r.slug || builtin,
        label: r.title,
        desc: r.description,
        builtin,
        requiresSignup: !!r.requires_signup,
      } satisfies ToolEntry
    })
    .filter((t): t is ToolEntry => t !== null)
}

/** The default newsletter source for a card the owner made up. */
function sourceForGuide(builtin: BuiltinGuideKey | null, slug: string): string {
  const fallback = FALLBACK_GUIDES.find(g => g.builtin === builtin)
  if (fallback) return fallback.source
  const clean = normalizeKey(slug).slice(0, 60)
  return clean ? `resource_${clean}` : 'guides_page'
}

/** A sensible chip for a custom card that did not bring its own. */
const KIND_TAGS: Record<ResourceKind, string> = {
  tool: 'Free Tool',
  guide: 'Free Guide',
  article: 'Article',
  link: 'Link',
  download: 'Download',
}

/**
 * The guides page, from the library.
 *
 * Four kinds render here. 'article', 'link' and 'download' carry everything they
 * need in `config` and need no component at all. A 'guide' needs one of two
 * things: a builtin_key naming a component in the bundle, or content in
 * `config.content` that one of the five views can render. A row with neither is
 * dropped rather than shown as a card that opens onto nothing.
 *
 * The two together are what lets an owner duplicate the meet day checklist: the
 * copy has no builtin_key of its own and survives on its content alone.
 */
export function composeGuideRegistry(rows: ResourceItem[] | null): GuideEntry[] {
  // The id is kind-qualified because the library's uniqueness is (kind, slug):
  // a 'guide' named rpe and an 'article' named rpe are both legal rows, and on
  // a page that renders four kinds together a bare slug would collide React
  // keys and open both cards with one click. Guide ids never reach a URL (tools
  // are the ones with routes), so the prefix costs nothing.
  if (rows === null) return FALLBACK_GUIDES.map(g => ({ ...g, id: `${g.kind}:${g.id}`, config: { ...g.config } }))
  return publishedInOrder(rows, ['guide', 'article', 'link', 'download'])
    .map(r => {
      const builtin = r.kind === 'guide' ? guideBuiltin(r.builtin_key) : null
      const config = (r.config && typeof r.config === 'object' ? r.config : {}) as Record<string, unknown>
      if (r.kind === 'guide' && !builtin && !parseGuideContent(config)) return null
      return {
        id: `${r.kind}:${r.slug || r.id}`,
        kind: r.kind,
        label: r.title,
        description: r.description,
        tag: r.tag || KIND_TAGS[r.kind],
        source: sourceForGuide(builtin, r.slug),
        builtin,
        config,
        requiresSignup: !!r.requires_signup,
      } satisfies GuideEntry
    })
    .filter((g): g is GuideEntry => g !== null)
}

export interface PublicRegistry {
  tools: ToolEntry[]
  guides: GuideEntry[]
  /** False until the library has answered. The lists are the fallback until it
   *  does, so a screen can render immediately and only needs this to decide
   *  whether an empty list means "nothing published" or "not asked yet". */
  ready: boolean
}

let sharedResources: Promise<ResourceItem[] | null> | null = null

function sharedPublishedResources(): Promise<ResourceItem[] | null> {
  if (!sharedResources) {
    sharedResources = fetchPublishedResources().catch(() => null)
  }
  return sharedResources
}

export function invalidateResourceRegistry(): void {
  sharedResources = null
}

/**
 * The registry, for a component. Same shape of promise as the config above:
 * the fallback renders first, the library replaces it when it lands.
 */
export function useResourceRegistry(): PublicRegistry {
  const [registry, setRegistry] = useState<PublicRegistry>(() => ({
    tools: composeToolRegistry(null),
    guides: composeGuideRegistry(null),
    ready: false,
  }))

  useEffect(() => {
    let live = true
    void sharedPublishedResources().then(rows => {
      if (!live) return
      setRegistry({
        tools: composeToolRegistry(rows),
        guides: composeGuideRegistry(rows),
        ready: true,
      })
    })
    return () => { live = false }
  }, [])

  return registry
}
