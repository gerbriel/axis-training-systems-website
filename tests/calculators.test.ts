import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultCalculatorConfig,
  mergeCalculatorConfig,
  composeToolRegistry,
  composeGuideRegistry,
  FALLBACK_TOOLS,
  FALLBACK_GUIDES,
  LIMITS,
  RPE_STEPS,
  rpeKey,
} from '../src/lib/calculators.ts'
import type { CalculatorConfig } from '../src/lib/calculators.ts'
import type { ResourceItem } from '../src/lib/resourceLibrary.ts'

// The merge is the whole safety story of migration 042. The database stores
// whatever an owner typed into a number box and clamps NOTHING — deliberately,
// because a CHECK per opinion is the deploy this feature exists to avoid — so
// every guard that keeps a bad row from breaking a public page is in this one
// pure function. That is why it is tested here and the Supabase calls are not:
// those are a round trip, this is the rule.

const defaults = () => defaultCalculatorConfig()

/** One row, the way calculator_settings hands it over. */
function row(calculator: string, params: unknown) {
  return { calculator, params }
}

// ---------------------------------------------------------------------------
// 1. Nothing overridden is nothing changed
// ---------------------------------------------------------------------------

test('an empty table leaves every calculator exactly as it shipped', () => {
  assert.deepEqual(mergeCalculatorConfig(defaults(), []), defaults())
})

test('a row of empty params is the same as no row at all', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('rpe', {}), row('attempts', {}), row('converter', {}), row('scores', {}),
  ])
  assert.deepEqual(merged, defaults())
})

test('the merge does not touch the defaults it was handed', () => {
  const base = defaults()
  const before = base.attempts.profiles.conservative.open
  mergeCalculatorConfig(base, [row('attempts', { profiles: { conservative: { open: 0.5, second: 0.6, third: 0.7 } } })])
  assert.equal(base.attempts.profiles.conservative.open, before)
  assert.deepEqual(base, defaults())
})

test('a row for a calculator nobody has heard of is skipped', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('bench_press', { profiles: { conservative: { open: 0.1, second: 0.2, third: 0.3 } } }),
  ])
  assert.deepEqual(merged, defaults())
})

test('two rows for one calculator apply in order, so the last one wins', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('attempts', { rounding: { lbs: 2.5 } }),
    row('attempts', { rounding: { lbs: 10 } }),
  ])
  assert.equal(merged.attempts.rounding.lbs, 10)
})

// ---------------------------------------------------------------------------
// 2. The RPE chart, halves included
// ---------------------------------------------------------------------------

test('the chart offers every row the selector does, 6 through 10 in halves', () => {
  const table = defaults().rpe.table
  // Compared as a SET, and iterated through RPE_STEPS everywhere else, because
  // JavaScript sorts integer-like keys ahead of the rest: Object.keys on this
  // table answers 6, 7, 8, 9, 10, 6.5, 7.5, 8.5, 9.5, which is not an order any
  // selector should ever be built from.
  assert.deepEqual(new Set(Object.keys(table)), new Set(['6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10']))
  assert.deepEqual(new Set(Object.keys(table)), new Set(RPE_STEPS.map(rpeKey)))
  assert.equal(Object.keys(table).length, RPE_STEPS.length)
  for (const key of Object.keys(table)) {
    assert.deepEqual(Object.keys(table[key]).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  }
})

test('the whole-RPE rows are the published Tuchscherer chart, unchanged', () => {
  const table = defaults().rpe.table
  // The four corners and the one everybody quotes.
  assert.equal(table['10'][1], 1.000)
  assert.equal(table['10'][10], 0.739)
  assert.equal(table['6'][1], 0.863)
  assert.equal(table['6'][10], 0.637)
  assert.equal(table['8'][3], 0.863)
})

test('a half RPE is the midpoint of the two whole rows either side of it', () => {
  const table = defaults().rpe.table
  // The wart this fixes: the selector offered 7.5 and Math.round handed back
  // the RPE 8 row, so 7.5 and 8 were the same answer and 8.5 was too.
  assert.equal(table['7.5'][5], (table['7'][5] + table['8'][5]) / 2)
  assert.equal(table['7.5'][5], 0.7985)
  assert.equal(table['8.5'][1], 0.9385)
  assert.equal(table['6.5'][10], 0.65)
  assert.equal(table['9.5'][3], 0.907)
  // And they are genuinely distinct from the rows they used to collapse into.
  assert.notEqual(table['7.5'][5], table['8'][5])
  assert.notEqual(table['8.5'][5], table['8'][5])
})

test('every half row sits strictly between its neighbours at every rep count', () => {
  const table = defaults().rpe.table
  for (const rpe of RPE_STEPS) {
    if (Number.isInteger(rpe)) continue
    const lower = table[rpeKey(Math.floor(rpe))]
    const upper = table[rpeKey(Math.ceil(rpe))]
    for (const reps of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const v = table[rpeKey(rpe)][reps]
      assert.ok(v > lower[reps] && v < upper[reps], `RPE ${rpe} × ${reps}`)
    }
  }
})

// ---------------------------------------------------------------------------
// 3. RPE overrides
// ---------------------------------------------------------------------------

test('an RPE override lands on the cell it names and nowhere else', () => {
  const merged = mergeCalculatorConfig(defaults(), [row('rpe', { table: { '8': { '3': 0.87 } } })])
  assert.equal(merged.rpe.table['8'][3], 0.87)
  assert.equal(merged.rpe.table['8'][2], defaults().rpe.table['8'][2])
  assert.equal(merged.rpe.table['9'][3], defaults().rpe.table['9'][3])
  // A half row is writable in its own right now that it exists.
  const half = mergeCalculatorConfig(defaults(), [row('rpe', { table: { '7.5': { '5': 0.8 } } })])
  assert.equal(half.rpe.table['7.5'][5], 0.8)
})

test('an RPE fraction above the ceiling is clamped, not taken at face value', () => {
  const merged = mergeCalculatorConfig(defaults(), [row('rpe', { table: { '10': { '1': 4.2 } } })])
  assert.equal(merged.rpe.table['10'][1], LIMITS.rpeFraction.max)
})

test('an RPE fraction of zero or below is refused rather than clamped to a floor', () => {
  // There is no nearest sensible value for "0% of your max", so the cell keeps
  // the chart's own number rather than inventing one.
  const merged = mergeCalculatorConfig(defaults(), [
    row('rpe', { table: { '8': { '1': 0, '2': -0.5, '3': 0.9 } } }),
  ])
  assert.equal(merged.rpe.table['8'][1], defaults().rpe.table['8'][1])
  assert.equal(merged.rpe.table['8'][2], defaults().rpe.table['8'][2])
  assert.equal(merged.rpe.table['8'][3], 0.9)
})

test('an RPE override cannot invent a row or a rep count the selector has no entry for', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('rpe', { table: { '11': { '1': 1.1 }, '8': { '11': 0.5, '0': 0.5 } } }),
  ])
  assert.equal(merged.rpe.table['11'], undefined)
  assert.equal((merged.rpe.table['8'] as Record<string, number>)['11'], undefined)
  assert.deepEqual(merged.rpe.table['8'], defaults().rpe.table['8'])
})

test('an unreadable RPE cell costs that cell and nothing more', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('rpe', { table: { '8': { '1': 'heavy', '2': null, '3': 0.87 } } }),
  ])
  assert.equal(merged.rpe.table['8'][1], defaults().rpe.table['8'][1])
  assert.equal(merged.rpe.table['8'][2], defaults().rpe.table['8'][2])
  assert.equal(merged.rpe.table['8'][3], 0.87)
})

// ---------------------------------------------------------------------------
// 4. Attempt profiles — the ones with teeth
// ---------------------------------------------------------------------------

test('an attempt profile lands whole', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('attempts', { profiles: { aggressive: { open: 0.92, second: 0.98, third: 1.05 } } }),
  ])
  assert.deepEqual(merged.attempts.profiles.aggressive, { open: 0.92, second: 0.98, third: 1.05 })
  // The profile that was not mentioned keeps tracking the code.
  assert.deepEqual(merged.attempts.profiles.conservative, defaults().attempts.profiles.conservative)
})

test('an attempt percentage outside the range is clamped to it', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('attempts', { profiles: { aggressive: { open: 0.2, second: 0.9, third: 1.4 } } }),
  ])
  assert.equal(merged.attempts.profiles.aggressive.open, LIMITS.attemptPct.min)
  assert.equal(merged.attempts.profiles.aggressive.second, 0.9)
  assert.equal(merged.attempts.profiles.aggressive.third, LIMITS.attemptPct.max)
})

test('a triple that goes backwards is discarded whole, never re-sorted', () => {
  // A silently re-sorted attempt plan is a wrong answer wearing a right one's
  // clothes: the owner never finds out they typed the opener into the second.
  const merged = mergeCalculatorConfig(defaults(), [
    row('attempts', {
      profiles: {
        conservative: { open: 0.96, second: 0.90, third: 1.00 },
        aggressive:   { open: 0.92, second: 0.98, third: 1.05 },
      },
    }),
  ])
  assert.deepEqual(merged.attempts.profiles.conservative, defaults().attempts.profiles.conservative)
  // And it costs only the profile that was wrong.
  assert.deepEqual(merged.attempts.profiles.aggressive, { open: 0.92, second: 0.98, third: 1.05 })
})

test('a third attempt below the second is refused for the same reason', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('attempts', { profiles: { aggressive: { open: 0.90, second: 1.00, third: 0.95 } } }),
  ])
  assert.deepEqual(merged.attempts.profiles.aggressive, defaults().attempts.profiles.aggressive)
})

test('a flat triple is allowed: equal is not backwards', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('attempts', { profiles: { conservative: { open: 0.9, second: 0.9, third: 0.9 } } }),
  ])
  assert.deepEqual(merged.attempts.profiles.conservative, { open: 0.9, second: 0.9, third: 0.9 })
})

test('a profile missing one of its three numbers is ignored, not half applied', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('attempts', { profiles: { conservative: { open: 0.85, second: 0.95 } } }),
  ])
  assert.deepEqual(merged.attempts.profiles.conservative, defaults().attempts.profiles.conservative)
})

test('a profile written as something other than an object is ignored', () => {
  for (const junk of ['0.9', 42, null, [0.9, 0.96, 1.0], true]) {
    const merged = mergeCalculatorConfig(defaults(), [row('attempts', { profiles: { conservative: junk } })])
    assert.deepEqual(merged.attempts.profiles.conservative, defaults().attempts.profiles.conservative)
  }
})

// ---------------------------------------------------------------------------
// 5. Rounding increments
// ---------------------------------------------------------------------------

test('rounding increments land and clamp independently of each other', () => {
  const merged = mergeCalculatorConfig(defaults(), [row('attempts', { rounding: { lbs: 2.5, kg: 1 } })])
  assert.deepEqual(merged.attempts.rounding, { lbs: 2.5, kg: 1 })

  const clamped = mergeCalculatorConfig(defaults(), [row('attempts', { rounding: { lbs: 500, kg: 0.01 } })])
  assert.equal(clamped.attempts.rounding.lbs, LIMITS.rounding.max)
  assert.equal(clamped.attempts.rounding.kg, LIMITS.rounding.min)

  const partial = mergeCalculatorConfig(defaults(), [row('attempts', { rounding: { kg: 5 } })])
  assert.equal(partial.attempts.rounding.lbs, defaults().attempts.rounding.lbs)
  assert.equal(partial.attempts.rounding.kg, 5)
})

test('an unreadable rounding increment keeps the plate maths that works', () => {
  const merged = mergeCalculatorConfig(defaults(), [row('attempts', { rounding: { lbs: 'five', kg: NaN } })])
  assert.deepEqual(merged.attempts.rounding, defaults().attempts.rounding)
})

// ---------------------------------------------------------------------------
// 6. Malformed params, at every level
// ---------------------------------------------------------------------------

test('params that are not an object at all are ignored, whatever they are', () => {
  for (const junk of [[], '{}', 42, null, undefined, true, [1, 2, 3]]) {
    assert.deepEqual(
      mergeCalculatorConfig(defaults(), [
        row('rpe', junk), row('attempts', junk), row('converter', junk), row('scores', junk),
      ]),
      defaults(),
      `params: ${JSON.stringify(junk)}`,
    )
  }
})

test('a row that is not a row is skipped rather than thrown over', () => {
  const junk = [null, 'attempts', 7] as unknown as { calculator: string; params: unknown }[]
  assert.deepEqual(mergeCalculatorConfig(defaults(), junk), defaults())
})

test('the sub-objects are checked too, not just the top level', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('rpe', { table: 'the whole chart' }),
    row('attempts', { profiles: [], rounding: 'nearest 5' }),
    row('converter', { bars: 'standard', plates: {} }),
    row('scores', { dots: 42 }),
  ])
  assert.deepEqual(merged, defaults())
})

// ---------------------------------------------------------------------------
// 7. Score tier cutoffs
// ---------------------------------------------------------------------------

test('a tier cutoff override lands and rewrites the caption that describes it', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('scores', { dots: { cutoffs: [220, 320, 400, 470] } }),
  ])
  const dots = merged.scores.benchmarks.dots
  assert.deepEqual(dots.tiers.map(t => t.cutoff), [220, 320, 400, 470, Infinity])
  // The caption is derived, so it cannot drift away from the number it captions.
  assert.deepEqual(dots.tiers.map(t => t.range), ['< 220', '220 – 320', '320 – 400', '400 – 470', '470+'])
  assert.deepEqual(dots.tiers.map(t => t.label), ['Beginner', 'Intermediate', 'Advanced', 'Elite', 'World-class'])
  // Wilks shares the scale in the defaults but not the override.
  assert.deepEqual(merged.scores.benchmarks.wilks, defaults().scores.benchmarks.wilks)
})

test('cutoffs that do not increase are ignored for that scheme and no other', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('scores', {
      dots: { cutoffs: [200, 300, 280, 450] },
      gl:   { cutoffs: [45, 65, 85, 105] },
    }),
  ])
  assert.deepEqual(merged.scores.benchmarks.dots, defaults().scores.benchmarks.dots)
  assert.deepEqual(merged.scores.benchmarks.gl.tiers.map(t => t.cutoff), [45, 65, 85, 105, Infinity])
})

test('repeated cutoffs are refused too: two tiers cannot start at the same score', () => {
  const merged = mergeCalculatorConfig(defaults(), [row('scores', { dots: { cutoffs: [200, 300, 300, 450] } })])
  assert.deepEqual(merged.scores.benchmarks.dots, defaults().scores.benchmarks.dots)
})

test('a cutoff list of the wrong length is refused rather than padded', () => {
  for (const cutoffs of [[200, 300], [200, 300, 380, 450, 520], []]) {
    const merged = mergeCalculatorConfig(defaults(), [row('scores', { dots: { cutoffs } })])
    assert.deepEqual(merged.scores.benchmarks.dots, defaults().scores.benchmarks.dots)
  }
})

test('a negative or unreadable cutoff refuses the whole list', () => {
  for (const cutoffs of [[-1, 300, 380, 450], [200, '300', 380, 450], [200, 300, 380, null]]) {
    const merged = mergeCalculatorConfig(defaults(), [row('scores', { dots: { cutoffs } })])
    assert.deepEqual(merged.scores.benchmarks.dots, defaults().scores.benchmarks.dots)
  }
})

test('a bad cutoff list does not undo a good bar maximum beside it', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('scores', { gl: { barMax: 140, cutoffs: [80, 60] } }),
  ])
  assert.equal(merged.scores.benchmarks.gl.barMax, 140)
  assert.equal(merged.scores.benchmarks.gl.barLabel, '140+')
  assert.deepEqual(
    merged.scores.benchmarks.gl.tiers.map(t => t.cutoff),
    defaults().scores.benchmarks.gl.tiers.map(t => t.cutoff),
  )
})

test('the top tier keeps its open upper bound however the cutoffs move', () => {
  const merged = mergeCalculatorConfig(defaults(), [row('scores', { wilks: { cutoffs: [1, 2, 3, 4] } })])
  const tiers = merged.scores.benchmarks.wilks.tiers
  assert.equal(tiers[tiers.length - 1].cutoff, Infinity)
  assert.equal(tiers[tiers.length - 1].range, '4+')
})

// ---------------------------------------------------------------------------
// 8. Converter reference weights
// ---------------------------------------------------------------------------

test('a quick-pick list is replaced wholesale when it is usable', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('converter', { bars: [{ lbs: 45, kg: 20, label: 'Comp bar' }] }),
  ])
  assert.deepEqual(merged.converter.bars, [{ lbs: 45, kg: 20, label: 'Comp bar' }])
  // The list that was not mentioned is untouched.
  assert.deepEqual(merged.converter.plates, defaults().converter.plates)
})

test('an unusable row is dropped and the rest of the list still lands', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('converter', {
      plates: [
        { lbs: 45, kg: 20, label: '45 lb plate' },
        { lbs: 25, kg: 10 },
        { lbs: 'ten', kg: 5, label: '10 lb plate' },
        { lbs: 10, kg: 5, label: '10 lb plate' },
      ],
    }),
  ])
  assert.deepEqual(merged.converter.plates, [
    { lbs: 45, kg: 20, label: '45 lb plate' },
    { lbs: 10, kg: 5, label: '10 lb plate' },
  ])
})

test('a list with nothing usable left in it is ignored, so a typo cannot empty the rack', () => {
  const merged = mergeCalculatorConfig(defaults(), [
    row('converter', { plates: [{ lbs: -5, kg: 2, label: 'x' }, { label: 'no weights' }] }),
  ])
  assert.deepEqual(merged.converter.plates, defaults().converter.plates)
})

// ---------------------------------------------------------------------------
// 9. The public registry
// ---------------------------------------------------------------------------
//
// null is an outage and takes the fallback; [] is an owner who published
// nothing and is honoured as the empty library it is. Getting those two the
// same way round is the difference between "the site lost its tools" and "the
// owner turned them off".

function item(partial: Partial<ResourceItem> & { slug: string; kind: ResourceItem['kind'] }): ResourceItem {
  return {
    id: `id-${partial.slug}`,
    slug: partial.slug,
    kind: partial.kind,
    builtin_key: partial.builtin_key ?? null,
    title: partial.title ?? 'A resource',
    description: partial.description ?? '',
    tag: partial.tag ?? null,
    sort_order: partial.sort_order ?? 0,
    is_published: partial.is_published ?? true,
    requires_signup: partial.requires_signup ?? false,
    config: partial.config ?? {},
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

test('an unreachable library falls back to the registries the pages used to hardcode', () => {
  assert.deepEqual(composeToolRegistry(null), FALLBACK_TOOLS)
  // Guide ids are kind-qualified at compose time (the library's uniqueness is
  // (kind, slug), so a bare slug can collide across kinds on the guides page);
  // everything else is the fallback verbatim.
  assert.deepEqual(
    composeGuideRegistry(null),
    FALLBACK_GUIDES.map(g => ({ ...g, id: `${g.kind}:${g.id}` })),
  )
  // A copy, so a page that sorts its own list cannot reorder the fallback.
  assert.notEqual(composeToolRegistry(null), FALLBACK_TOOLS)
})

test('an empty library is an empty library, not an outage', () => {
  assert.deepEqual(composeToolRegistry([]), [])
  assert.deepEqual(composeGuideRegistry([]), [])
})

test('an unpublished built-in is gone from the strip', () => {
  const rows = [
    item({ slug: 'rpe', kind: 'tool', builtin_key: 'rpe', title: 'RPE Calculator' }),
    item({ slug: 'dots', kind: 'tool', builtin_key: 'dots', title: 'Dots Score', is_published: false }),
  ]
  assert.deepEqual(composeToolRegistry(rows).map(t => t.id), ['rpe'])
})

test('the strip is ordered by sort_order, then by title for a tie', () => {
  const rows = [
    item({ slug: 'dots', kind: 'tool', builtin_key: 'dots', title: 'Dots Score', sort_order: 10 }),
    item({ slug: 'rankings', kind: 'tool', builtin_key: 'rankings', title: 'View Rankings', sort_order: 0 }),
    item({ slug: 'convert', kind: 'tool', builtin_key: 'convert', title: 'Converter', sort_order: 0 }),
  ]
  assert.deepEqual(composeToolRegistry(rows).map(t => t.id), ['convert', 'rankings', 'dots'])
})

test('a tool row naming no component we have is dropped rather than left blank', () => {
  const rows = [
    item({ slug: 'rpe', kind: 'tool', builtin_key: 'rpe' }),
    item({ slug: 'mystery', kind: 'tool', builtin_key: 'time_machine' }),
    item({ slug: 'orphan', kind: 'tool', builtin_key: null }),
  ]
  assert.deepEqual(composeToolRegistry(rows).map(t => t.id), ['rpe'])
})

test('the kind decides which component a shared key means', () => {
  const rows = [
    item({ slug: 'rpe', kind: 'tool', builtin_key: 'rpe', title: 'RPE Calculator' }),
    item({ slug: 'rpe-guide', kind: 'guide', builtin_key: 'rpe', title: 'RPE Guide for Beginners' }),
  ]
  assert.deepEqual(composeToolRegistry(rows).map(t => t.builtin), ['rpe'])
  assert.deepEqual(composeGuideRegistry(rows).map(g => g.builtin), ['rpe'])
  // Kind-qualified: a guide and an article may share a slug, a React key may not.
  assert.deepEqual(composeGuideRegistry(rows).map(g => g.id), ['guide:rpe-guide'])
})

test('a builtin key spelled the other way still finds its component', () => {
  const rows = [
    item({ slug: 'big3', kind: 'guide', builtin_key: 'big_three' }),
    item({ slug: 'checklist', kind: 'guide', builtin_key: 'meet-checklist' }),
    item({ slug: 'convert', kind: 'tool', builtin_key: 'weight_converter' }),
  ]
  assert.deepEqual(composeGuideRegistry(rows).map(g => g.builtin).sort(), ['big3', 'checklist'])
  assert.deepEqual(composeToolRegistry(rows).map(t => t.builtin), ['convert'])
})

test('a custom kind needs no component and carries its own config through', () => {
  const rows = [
    item({ slug: 'form-check', kind: 'link', title: 'Form check playlist', sort_order: 0, config: { url: 'https://example.com/x' } }),
    item({ slug: 'template', kind: 'download', title: 'Block template', sort_order: 10, config: { url: '/files/block.pdf', file_label: 'PDF' } }),
    item({ slug: 'peaking', kind: 'article', title: 'How peaking works', sort_order: 20, config: { body: 'One.\n\nTwo.' } }),
  ]
  const guides = composeGuideRegistry(rows)
  assert.deepEqual(guides.map(g => g.kind), ['link', 'download', 'article'])
  assert.equal(guides.every(g => g.builtin === null), true)
  assert.equal(guides[0].config.url, 'https://example.com/x')
  assert.equal(guides[2].config.body, 'One.\n\nTwo.')
  // A custom card with no tag of its own still gets a chip rather than a gap.
  assert.equal(guides[0].tag, 'Link')
})

test('requires_signup is carried per row, so an ungated card can exist beside a gated one', () => {
  const rows = [
    item({ slug: 'checklist', kind: 'guide', builtin_key: 'checklist', requires_signup: true }),
    item({ slug: 'rpe-guide', kind: 'guide', builtin_key: 'rpe', requires_signup: false, sort_order: 10 }),
  ]
  assert.deepEqual(composeGuideRegistry(rows).map(g => g.requiresSignup), [true, false])
})

test('a guide keeps the newsletter source its built-in has always reported', () => {
  const rows = [item({ slug: 'anything', kind: 'guide', builtin_key: 'big3' })]
  assert.equal(composeGuideRegistry(rows)[0].source, 'big_three')
  const custom = [item({ slug: 'peaking-notes', kind: 'article', config: { body: 'x' } })]
  assert.equal(composeGuideRegistry(custom)[0].source, 'resource_peaking_notes')
})

// A guide row used to need a builtin_key, because a guide WAS a component. It
// can now be content instead (guideContent.ts), which is what a duplicated or
// owner-written guide is, so the drop rule is "neither of the two" rather than
// "no builtin_key".

test('a guide row with content but no built-in survives, and one with neither is dropped', () => {
  const content = { type: 'checklist', sections: [{ title: 'Night before', items: ['Pack the bag'] }] }
  const rows = [
    item({ slug: 'checklist-copy', kind: 'guide', title: 'My checklist', config: { content } }),
    item({ slug: 'orphan', kind: 'guide', builtin_key: null, sort_order: 10 }),
    item({ slug: 'mystery', kind: 'guide', builtin_key: 'time_machine', sort_order: 20 }),
  ]
  const guides = composeGuideRegistry(rows)
  assert.deepEqual(guides.map(g => g.id), ['guide:checklist-copy'])
  // Content alone, so there is no component to name and the config rides through
  // for the page to render.
  assert.equal(guides[0].builtin, null)
  assert.deepEqual(guides[0].config.content, content)
})

test('a guide row whose content is malformed is dropped unless a built-in can carry it', () => {
  const rows = [
    // A checklist with no sections in it is not a checklist, so this row has
    // nothing to render and nothing to fall back to.
    item({ slug: 'half-typed', kind: 'guide', config: { content: { type: 'checklist' } } }),
    // The same broken content on a built-in row keeps the built-in.
    item({ slug: 'checklist', kind: 'guide', builtin_key: 'checklist', sort_order: 10, config: { content: { type: 'nope' } } }),
  ]
  assert.deepEqual(composeGuideRegistry(rows).map(g => g.builtin), ['checklist'])
})

// ---------------------------------------------------------------------------
// 10. The shape the rest of the app depends on
// ---------------------------------------------------------------------------

test('a merged config is still a complete config, whatever was thrown at it', () => {
  const merged: CalculatorConfig = mergeCalculatorConfig(defaults(), [
    row('rpe', { table: { '8': { '3': 9999 } } }),
    row('attempts', { profiles: { conservative: 'nope' }, rounding: { lbs: -4 } }),
    row('converter', { bars: [] }),
    row('scores', { gl: { cutoffs: 'high' } }),
  ])
  assert.equal(Object.keys(merged.rpe.table).length, RPE_STEPS.length)
  assert.equal(typeof merged.attempts.profiles.aggressive.third, 'number')
  assert.ok(merged.converter.bars.length > 0)
  assert.ok(merged.converter.plates.length > 0)
  for (const scheme of Object.values(merged.scores.benchmarks)) {
    assert.equal(scheme.tiers.length, 5)
    assert.ok(Number.isFinite(scheme.barMax))
  }
})
