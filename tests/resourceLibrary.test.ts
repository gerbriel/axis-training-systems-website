import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_RESOURCES,
  CUSTOM_KINDS,
  SORT_STEP,
  compareResources,
  createResource,
  deleteResource,
  fetchAllResources,
  isValidSlug,
  nextSortOrder,
  planReorder,
  reorderResource,
  resetDemoResources,
  safeResourceUrl,
  setPublished,
  slugFromTitle,
  sortResources,
  updateResource,
  validateConfig,
  type ResourceItem,
} from '../src/lib/resourceLibrary.ts'

// Pure functions and the in-memory demo store. Everything else in that module
// is a Supabase call gated by the RLS in migration 041, and belongs to an
// integration test with a database behind it, not to `node --test`.
//
// The demo store is module-level and mutated in place (that is the point of it
// — a walk-through survives a tab change), so every test that touches it calls
// resetDemoResources() first and owns the store for its duration.

const item = (over: Partial<ResourceItem> = {}): ResourceItem => ({
  id: 'r-1',
  slug: 'a-thing',
  kind: 'link',
  builtin_key: null,
  title: 'A thing',
  description: '',
  tag: null,
  sort_order: 0,
  is_published: true,
  requires_signup: false,
  config: {},
  updated_at: '2026-01-01T00:00:00.000Z',
  ...over,
})

// ---------------------------------------------------------------------------
// 1. slugFromTitle / isValidSlug — the shape the CHECK constraint enforces
// ---------------------------------------------------------------------------

test('slugFromTitle lowercases and hyphenates', () => {
  assert.equal(slugFromTitle('Meet Day Checklist'), 'meet-day-checklist')
  assert.equal(slugFromTitle('RPE Calculator'), 'rpe-calculator')
  assert.equal(slugFromTitle('Big 3'), 'big-3')
})

test('slugFromTitle collapses punctuation instead of keeping it', () => {
  // The real titles on the site: an apostrophe, quotes and a question mark.
  assert.equal(slugFromTitle("Beginner's Guide to the Big Three"), 'beginner-s-guide-to-the-big-three')
  assert.equal(
    slugFromTitle('"Is Your Training Leaving Gains on the Table?" Quiz'),
    'is-your-training-leaving-gains-on-the-table-quiz',
  )
  assert.equal(slugFromTitle('  Spaced   out  '), 'spaced-out')
})

test('slugFromTitle never starts or ends with a hyphen, even after the length cap', () => {
  assert.equal(slugFromTitle('---leading and trailing---'), 'leading-and-trailing')
  const long = slugFromTitle('a'.repeat(80))
  assert.equal(long.length, 60)
  // A cap that lands mid-separator must not leave the hyphen behind.
  const cut = slugFromTitle(`${'a'.repeat(59)} tail`)
  assert.equal(cut, 'a'.repeat(59))
  assert.ok(isValidSlug(cut))
})

test('slugFromTitle is empty when there is nothing sluggable in the title', () => {
  assert.equal(slugFromTitle('!!! ???'), '')
  assert.equal(slugFromTitle(''), '')
})

test('isValidSlug matches the database shape and nothing else', () => {
  for (const good of ['rpe', 'big3', 'meet-day-checklist', '3-week-peak', 'a']) {
    assert.equal(isValidSlug(good), true, good)
  }
  for (const bad of ['', '-leading', 'Upper', 'has space', 'trailing-', 'has_underscore', 'x'.repeat(61)]) {
    assert.equal(isValidSlug(bad), false, bad)
  }
})

test('every slug the built-ins carry is one the constraint would accept', () => {
  for (const r of BUILTIN_RESOURCES) assert.equal(isValidSlug(r.slug), true, r.slug)
})

// ---------------------------------------------------------------------------
// 2. safeResourceUrl — the allow-list, without a window
// ---------------------------------------------------------------------------

test('safeResourceUrl passes the schemes a resource may link to', () => {
  assert.equal(safeResourceUrl('https://usapl.com/rulebook.pdf'), 'https://usapl.com/rulebook.pdf')
  assert.equal(safeResourceUrl('http://example.com'), 'http://example.com')
  assert.equal(safeResourceUrl('mailto:coach@axis.com'), 'mailto:coach@axis.com')
  assert.equal(safeResourceUrl('/guides'), '/guides')
  assert.equal(safeResourceUrl('  https://example.com  '), 'https://example.com')
})

test('safeResourceUrl refuses the schemes that execute, and the costumes they wear', () => {
  assert.equal(safeResourceUrl('javascript:alert(1)'), undefined)
  assert.equal(safeResourceUrl('JavaScript:alert(1)'), undefined)
  assert.equal(safeResourceUrl('data:text/html,<script>alert(1)</script>'), undefined)
  assert.equal(safeResourceUrl('vbscript:msgbox(1)'), undefined)
  // The classic bypass: a control character the URL parser strips and a naive
  // prefix test does not.
  assert.equal(safeResourceUrl('java\tscript:alert(1)'), undefined)
  assert.equal(safeResourceUrl('java\nscript:alert(1)'), undefined)
  // Protocol-relative is an absolute URL in a costume, not a path.
  assert.equal(safeResourceUrl('//evil.com'), undefined)
  // And so is the backslash flavor: WHATWG parsers read "\" as "/" on http(s)
  // URLs, so "/\evil.com" is "//evil.com" by the time a browser follows it.
  assert.equal(safeResourceUrl('/\\evil.com'), undefined)
  assert.equal(safeResourceUrl('\\\\evil.com'), undefined)
  assert.equal(safeResourceUrl('https://ok.com/a\\b'), undefined)
  assert.equal(safeResourceUrl(''), undefined)
  assert.equal(safeResourceUrl(null), undefined)
  assert.equal(safeResourceUrl(42), undefined)
})

// ---------------------------------------------------------------------------
// 3. validateConfig — one shape per kind
// ---------------------------------------------------------------------------

test('a tool or a guide keeps nothing in config, whatever is handed in', () => {
  for (const kind of ['tool', 'guide'] as const) {
    const res = validateConfig(kind, { url: 'https://example.com', body: 'x' })
    assert.equal(res.ok, true)
    if (res.ok) assert.deepEqual(res.value, {})
  }
})

test('an article needs a body', () => {
  const empty = validateConfig('article', { body: '   ' })
  assert.equal(empty.ok, false)
  const missing = validateConfig('article', {})
  assert.equal(missing.ok, false)

  const ok = validateConfig('article', { body: '## Warmups\n\nStart light.' })
  assert.equal(ok.ok, true)
  if (ok.ok) assert.equal(ok.value.body, '## Warmups\n\nStart light.')
})

test('an article body is stripped of markup before it is stored', () => {
  const res = validateConfig('article', { body: 'Safe <script>alert(1)</script> text' })
  assert.equal(res.ok, true)
  if (res.ok) assert.ok(!String(res.value.body).includes('<script>'))
})

test('a link needs an address that is safe to put in an href', () => {
  const bad = validateConfig('link', { url: 'javascript:alert(1)' })
  assert.equal(bad.ok, false)
  const none = validateConfig('link', {})
  assert.equal(none.ok, false)

  const ok = validateConfig('link', { url: 'https://openpowerlifting.org', body: 'ignored' })
  assert.equal(ok.ok, true)
  // Keys the kind does not use are dropped rather than carried along.
  if (ok.ok) assert.deepEqual(ok.value, { url: 'https://openpowerlifting.org' })
})

test('a download needs an address and gets a button label either way', () => {
  const bad = validateConfig('download', { file_label: 'Get it' })
  assert.equal(bad.ok, false)

  const bare = validateConfig('download', { url: '/files/checklist.pdf' })
  assert.equal(bare.ok, true)
  if (bare.ok) assert.deepEqual(bare.value, { url: '/files/checklist.pdf', file_label: 'Download' })

  const labelled = validateConfig('download', { url: '/files/checklist.pdf', file_label: 'Get the checklist' })
  assert.equal(labelled.ok, true)
  if (labelled.ok) assert.equal(labelled.value.file_label, 'Get the checklist')
})

// ---------------------------------------------------------------------------
// 4. Ordering — the comparator has to agree with the SQL ORDER BY
// ---------------------------------------------------------------------------

test('compareResources sorts by kind, then position, then title', () => {
  const rows = [
    item({ id: 'c', kind: 'tool', sort_order: 10, title: 'Dots Score' }),
    item({ id: 'a', kind: 'guide', sort_order: 0, title: 'Meet Day Checklist' }),
    item({ id: 'b', kind: 'tool', sort_order: 0, title: 'RPE Calculator' }),
  ]
  // kind ascending is alphabetical, exactly as `.order('kind')` resolves it:
  // guide before tool.
  assert.deepEqual(sortResources(rows).map(r => r.id), ['a', 'b', 'c'])
})

test('compareResources breaks a tied position on the title', () => {
  const rows = [
    item({ id: 'z', kind: 'link', sort_order: 0, title: 'Zone chart' }),
    item({ id: 'a', kind: 'link', sort_order: 0, title: 'Attempt sheet' }),
  ]
  assert.deepEqual(sortResources(rows).map(r => r.id), ['a', 'z'])
})

test('sortResources does not disturb the array it was given', () => {
  const rows = [item({ id: 'b', sort_order: 10 }), item({ id: 'a', sort_order: 0 })]
  sortResources(rows)
  assert.deepEqual(rows.map(r => r.id), ['b', 'a'])
})

test('nextSortOrder lands below the bottom of that kind only', () => {
  const rows = [
    item({ id: '1', kind: 'tool', sort_order: 40 }),
    item({ id: '2', kind: 'link', sort_order: 10 }),
  ]
  assert.equal(nextSortOrder(rows, 'link'), 10 + SORT_STEP)
  assert.equal(nextSortOrder(rows, 'tool'), 40 + SORT_STEP)
  assert.equal(nextSortOrder(rows, 'article'), 0)
})

// ---------------------------------------------------------------------------
// 5. planReorder — moving a row a slot, as the writes it implies
// ---------------------------------------------------------------------------

const group = (): ResourceItem[] => [
  item({ id: 'a', kind: 'tool', sort_order: 0, title: 'A' }),
  item({ id: 'b', kind: 'tool', sort_order: 10, title: 'B' }),
  item({ id: 'c', kind: 'tool', sort_order: 20, title: 'C' }),
]

test('planReorder swaps a row with its neighbour and writes only what moved', () => {
  const plan = planReorder(group(), 'c', 'up')
  assert.deepEqual(plan, [{ id: 'c', sort_order: 10 }, { id: 'b', sort_order: 20 }])

  const down = planReorder(group(), 'a', 'down')
  assert.deepEqual(down, [{ id: 'b', sort_order: 0 }, { id: 'a', sort_order: 10 }])
})

test('planReorder refuses to move past either end, or to move a row it cannot see', () => {
  assert.equal(planReorder(group(), 'a', 'up'), null)
  assert.equal(planReorder(group(), 'c', 'down'), null)
  assert.equal(planReorder(group(), 'nope', 'up'), null)
  assert.equal(planReorder([item({ id: 'only' })], 'only', 'down'), null)
})

test('planReorder stays inside the kind: the guides are not the tools', () => {
  const mixed = [
    ...group(),
    item({ id: 'g1', kind: 'guide', sort_order: 0, title: 'G1' }),
    item({ id: 'g2', kind: 'guide', sort_order: 10, title: 'G2' }),
  ]
  const plan = planReorder(mixed, 'g2', 'up')
  assert.ok(plan)
  assert.deepEqual(plan?.map(p => p.id).sort(), ['g1', 'g2'])
  // A tool at the top of its own group is still at the top of it.
  assert.equal(planReorder(mixed, 'a', 'up'), null)
})

test('planReorder renumbers rather than swapping, so tied positions still move', () => {
  // Two rows sharing a sort_order is legal (the column has no unique index) and
  // a plain swap would be a no-op on them. Renumbering is what makes the arrow
  // actually do something.
  const tied = [
    item({ id: 'x', kind: 'tool', sort_order: 0, title: 'Aaa' }),
    item({ id: 'y', kind: 'tool', sort_order: 0, title: 'Bbb' }),
  ]
  const plan = planReorder(tied, 'y', 'up')
  assert.deepEqual(plan, [{ id: 'x', sort_order: 10 }])
})

// ---------------------------------------------------------------------------
// 6. The built-in seed — the eleven this replaces
// ---------------------------------------------------------------------------

test('the built-ins are the five tools and six guides, all of them built in', () => {
  assert.equal(BUILTIN_RESOURCES.length, 11)
  assert.equal(BUILTIN_RESOURCES.filter(r => r.kind === 'tool').length, 5)
  assert.equal(BUILTIN_RESOURCES.filter(r => r.kind === 'guide').length, 6)
  for (const r of BUILTIN_RESOURCES) {
    assert.equal(r.builtin_key, r.slug)
    assert.equal(r.is_published, true)
    assert.deepEqual(r.config, {})
  }
})

test('the gates match the site as it stands: one tool, every guide', () => {
  const gatedTools = BUILTIN_RESOURCES.filter(r => r.kind === 'tool' && r.requires_signup)
  assert.deepEqual(gatedTools.map(r => r.slug), ['attempts'])
  assert.ok(BUILTIN_RESOURCES.filter(r => r.kind === 'guide').every(r => r.requires_signup))
})

test('the two rpe rows coexist because a slug is unique per kind, not globally', () => {
  const rpe = BUILTIN_RESOURCES.filter(r => r.slug === 'rpe')
  assert.equal(rpe.length, 2)
  assert.deepEqual(rpe.map(r => r.kind).sort(), ['guide', 'tool'])
  // Which is also true of 'attempts'.
  assert.equal(BUILTIN_RESOURCES.filter(r => r.slug === 'attempts').length, 2)
})

// ---------------------------------------------------------------------------
// 7. The demo store — the invariants a walk-through must keep
// ---------------------------------------------------------------------------

test('the demo store starts as the eleven built-ins, in order', async () => {
  resetDemoResources()
  const rows = await fetchAllResources(true)
  assert.ok(rows)
  assert.equal(rows?.length, 11)
  // Ordered the way the reads order: guides (alphabetically first) then tools.
  assert.deepEqual(rows?.slice(0, 6).map(r => r.slug), ['checklist', 'attempts', 'quiz', 'rpe', 'big3', 'audit'])
  assert.deepEqual(rows?.slice(6).map(r => r.slug), ['rpe', 'dots', 'convert', 'attempts', 'rankings'])
})

test('a built-in refuses to be deleted, and says to unpublish instead', async () => {
  resetDemoResources()
  const rows = await fetchAllResources(true)
  const builtin = rows?.find(r => r.builtin_key !== null)
  assert.ok(builtin)

  const res = await deleteResource(builtin!, true)
  assert.equal(res.ok, false)
  if (!res.ok) assert.match(res.message, /unpublish/i)

  const after = await fetchAllResources(true)
  assert.equal(after?.length, 11)
})

test('unpublishing a built-in is allowed, and keeps the row and its copy', async () => {
  resetDemoResources()
  const before = await fetchAllResources(true)
  const tool = before?.find(r => r.kind === 'tool' && r.slug === 'dots')
  assert.ok(tool)

  const res = await setPublished(tool!.id, false, true)
  assert.equal(res.ok, true)

  const after = await fetchAllResources(true)
  const hidden = after?.find(r => r.id === tool!.id)
  assert.equal(after?.length, 11)
  assert.equal(hidden?.is_published, false)
  assert.equal(hidden?.title, tool!.title)

  // And it goes back, which is the whole reason unpublishing is the answer.
  assert.equal((await setPublished(tool!.id, true, true)).ok, true)
  const back = await fetchAllResources(true)
  assert.equal(back?.find(r => r.id === tool!.id)?.is_published, true)
})

test('a tool or a guide cannot be created from the form', async () => {
  resetDemoResources()
  for (const kind of ['tool', 'guide'] as const) {
    const res = await createResource({ kind, title: 'Bench Calculator' }, true)
    assert.equal(res.ok, false)
    if (!res.ok) assert.match(res.message, /built into the site/i)
  }
  assert.equal((await fetchAllResources(true))?.length, 11)
})

test('a custom resource is created, edited and removed', async () => {
  resetDemoResources()

  const created = await createResource({
    kind: 'link',
    title: 'OpenPowerlifting Rankings',
    description: 'Every result, searchable.',
    tag: 'External',
    config: { url: 'https://openpowerlifting.org' },
  }, true)
  assert.equal(created.ok, true)

  const rows = await fetchAllResources(true)
  const made = rows?.find(r => r.slug === 'openpowerlifting-rankings')
  assert.ok(made)
  assert.equal(rows?.length, 12)
  assert.equal(made?.builtin_key, null)
  assert.equal(made?.kind, 'link')
  assert.equal(made?.tag, 'External')
  assert.deepEqual(made?.config, { url: 'https://openpowerlifting.org' })

  const edited = await updateResource(made!.id, { kind: 'link', title: 'Rankings', requires_signup: true }, true)
  assert.equal(edited.ok, true)
  const afterEdit = (await fetchAllResources(true))?.find(r => r.id === made!.id)
  assert.equal(afterEdit?.title, 'Rankings')
  assert.equal(afterEdit?.requires_signup, true)

  const removed = await deleteResource(made!, true)
  assert.equal(removed.ok, true)
  assert.equal((await fetchAllResources(true))?.length, 11)
})

test('a custom resource is refused without a usable config', async () => {
  resetDemoResources()
  const res = await createResource({ kind: 'link', title: 'Sketchy', config: { url: 'javascript:alert(1)' } }, true)
  assert.equal(res.ok, false)
  assert.equal((await fetchAllResources(true))?.length, 11)
})

test('two resources of one kind cannot share a slug, but two kinds can', async () => {
  resetDemoResources()
  const first = await createResource({ kind: 'link', title: 'Peaking', config: { url: '/guides' } }, true)
  assert.equal(first.ok, true)

  const dupe = await createResource({ kind: 'link', title: 'Peaking', config: { url: '/other' } }, true)
  assert.equal(dupe.ok, false)
  if (!dupe.ok) assert.match(dupe.message, /already uses that slug/i)

  // The same slug under a different kind is the (kind, slug) key doing its job.
  const other = await createResource({ kind: 'article', title: 'Peaking', config: { body: 'Taper.' } }, true)
  assert.equal(other.ok, true)
  assert.equal((await fetchAllResources(true))?.length, 13)
})

test('a title cannot be emptied, and markup never becomes one', async () => {
  resetDemoResources()
  const rows = await fetchAllResources(true)
  const first = rows![0]

  const blank = await updateResource(first.id, { kind: first.kind, title: '   ' }, true)
  assert.equal(blank.ok, false)

  const stripped = await updateResource(first.id, { kind: first.kind, title: '<b>Bold</b> title' }, true)
  assert.equal(stripped.ok, true)
  const after = (await fetchAllResources(true))?.find(r => r.id === first.id)
  assert.equal(after?.title, 'Bold title')
})

test('reordering moves a row within its group and leaves the other group alone', async () => {
  resetDemoResources()
  const before = await fetchAllResources(true)
  const tools = before!.filter(r => r.kind === 'tool')
  const guidesBefore = before!.filter(r => r.kind === 'guide').map(r => r.slug)
  assert.deepEqual(tools.map(r => r.slug), ['rpe', 'dots', 'convert', 'attempts', 'rankings'])

  const dots = tools.find(r => r.slug === 'dots')!
  const res = await reorderResource(before!, dots.id, 'up', true)
  assert.equal(res.ok, true)

  const after = await fetchAllResources(true)
  assert.deepEqual(
    after!.filter(r => r.kind === 'tool').map(r => r.slug),
    ['dots', 'rpe', 'convert', 'attempts', 'rankings'],
  )
  assert.deepEqual(after!.filter(r => r.kind === 'guide').map(r => r.slug), guidesBefore)
})

test('reordering at the end of a group is a no-op rather than a failure', async () => {
  resetDemoResources()
  const rows = await fetchAllResources(true)
  const firstTool = rows!.filter(r => r.kind === 'tool')[0]
  const res = await reorderResource(rows!, firstTool.id, 'up', true)
  assert.equal(res.ok, true)
  const after = await fetchAllResources(true)
  assert.deepEqual(after!.filter(r => r.kind === 'tool').map(r => r.slug), rows!.filter(r => r.kind === 'tool').map(r => r.slug))
})

test('every kind an owner can create renders from config alone', () => {
  // The three custom kinds are exactly the ones with no component behind them,
  // which is why each has a config shape and the built-ins do not.
  assert.deepEqual(CUSTOM_KINDS, ['link', 'download', 'article'])
  for (const kind of CUSTOM_KINDS) {
    assert.equal(validateConfig(kind, {}).ok, false, kind)
  }
})
