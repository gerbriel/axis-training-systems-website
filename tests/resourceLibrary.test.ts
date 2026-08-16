import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTACHMENT_LIMIT,
  BUILTIN_RESOURCES,
  CUSTOM_KINDS,
  SLUG_LIMIT,
  SORT_STEP,
  compareResources,
  createResource,
  deleteResource,
  duplicateResource,
  fetchAllResources,
  isValidSlug,
  nextCopySlug,
  nextSortOrder,
  planReorder,
  reorderResource,
  resetDemoResources,
  safeResourceUrl,
  setPublished,
  slugFromTitle,
  sortResources,
  updateResource,
  validateAttachments,
  validateConfig,
  type ResourceItem,
} from '../src/lib/resourceLibrary.ts'
import { defaultContentFor } from '../src/lib/guideContent.ts'

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

// ---------------------------------------------------------------------------
// 8. Guide content and attached files — the two things a config now carries
// ---------------------------------------------------------------------------
//
// The content itself is guideContent.ts's to judge; what is checked here is
// that validateConfig DELEGATES to it, keeps what comes back, and applies its
// own two rules on top: a file has to be a file, and the whole thing has to fit.

/** A file record shaped the way an upload produces one. */
const file = (over: Record<string, unknown> = {}) => ({
  label: 'USAPL rulebook',
  url: 'https://usapl.com/rulebook.pdf',
  kind: 'pdf',
  size: 24000,
  ...over,
})

test('a guide keeps the content it is given, and gives it back unchanged', () => {
  const content = defaultContentFor('checklist')
  assert.ok(content, 'the checklist guide ships with content')

  const res = validateConfig('guide', { content })
  assert.equal(res.ok, true)
  // Round-tripping matters: the copy stored on a duplicate has to render the
  // same as the original it was taken from.
  if (res.ok) assert.deepEqual(res.value.content, content)
})

test('a guide with nothing written into it still stores nothing', () => {
  // The built-in case, unchanged by any of this: no content key means the page
  // reads its copy out of the bundle.
  const res = validateConfig('guide', {})
  assert.equal(res.ok, true)
  if (res.ok) assert.deepEqual(res.value, {})
})

test('every kind that sends a visitor somewhere can carry files', () => {
  const cases: [Parameters<typeof validateConfig>[0], Record<string, unknown>][] = [
    ['guide', { content: defaultContentFor('checklist'), attachments: [file()] }],
    ['article', { body: 'Read the rulebook.', attachments: [file()] }],
    ['link', { url: 'https://usapl.com', attachments: [file()] }],
    ['download', { url: '/files/checklist.pdf', attachments: [file()] }],
  ]
  for (const [kind, config] of cases) {
    const res = validateConfig(kind, config)
    assert.equal(res.ok, true, kind)
    if (res.ok) {
      const files = res.value.attachments as Record<string, unknown>[]
      assert.equal(files.length, 1, kind)
      assert.equal(files[0].label, 'USAPL rulebook', kind)
      assert.equal(files[0].size, 24000, kind)
    }
  }
})

test('an empty file list is stored as no list at all', () => {
  // Same reason the other unused keys are dropped: a row that has never had a
  // file attached should not grow a key that reads as "zero files".
  const res = validateConfig('link', { url: 'https://usapl.com', attachments: [] })
  assert.equal(res.ok, true)
  if (res.ok) assert.deepEqual(res.value, { url: 'https://usapl.com' })
})

test("a file's address goes through the same allow-list as everything else", () => {
  const bad = validateConfig('link', {
    url: 'https://usapl.com',
    attachments: [file({ url: 'javascript:alert(1)' })],
  })
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.message, /File 1/)

  // And the position is named, because a person with six files needs to know
  // which one to fix.
  const second = validateConfig('link', {
    url: 'https://usapl.com',
    attachments: [file(), file({ url: '//evil.com' })],
  })
  assert.equal(second.ok, false)
  if (!second.ok) assert.match(second.message, /File 2/)
})

test('a browser-local file address is refused unless the caller is the demo store', () => {
  // A demo upload has nowhere to upload to, so it mints URL.createObjectURL and
  // the value is a `blob:` url that only the tab holding it can open. The demo
  // store is in that tab too, so it takes them; the column must not, because a
  // stored blob: is a dead link for every other visitor.
  const local = [file({ url: 'blob:https://axis.local/6f1c-9a2b' })]

  const refused = validateAttachments(local)
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.message, /File 1/)

  const allowed = validateAttachments(local, true)
  assert.equal(allowed.ok, true)
  if (allowed.ok) assert.equal(allowed.value[0].url, 'blob:https://axis.local/6f1c-9a2b')

  // The flag opens one scheme, not the gate: the allow-list still runs.
  const script = validateAttachments([file({ url: 'javascript:alert(1)' })], true)
  assert.equal(script.ok, false)

  // And validateConfig hands the flag through rather than having its own idea.
  assert.equal(validateConfig('guide', { attachments: local }).ok, false)
  assert.equal(validateConfig('guide', { attachments: local }, true).ok, true)
})

test('a file has to be one of the types the site knows how to show', () => {
  const res = validateConfig('guide', { attachments: [file({ kind: 'exe' })] })
  assert.equal(res.ok, false)
  if (!res.ok) assert.match(res.message, /pdf/)
})

test('a file needs a name, and a size that is a number of bytes', () => {
  const nameless = validateConfig('guide', { attachments: [file({ label: '   ' })] })
  assert.equal(nameless.ok, false)

  const nonsense = validateConfig('guide', { attachments: [file({ size: 'big' })] })
  assert.equal(nonsense.ok, false)

  // No size at all is legitimate: a file linked rather than uploaded has none.
  const unknown = validateConfig('guide', { attachments: [file({ size: null })] })
  assert.equal(unknown.ok, true)
  if (unknown.ok) assert.equal((unknown.value.attachments as Record<string, unknown>[])[0].size, null)
})

test('there is a ceiling on how many files one resource carries', () => {
  const many = Array.from({ length: ATTACHMENT_LIMIT + 1 }, (_, i) => file({ label: `File ${i}` }))
  const res = validateConfig('guide', { attachments: many })
  assert.equal(res.ok, false)
  if (!res.ok) assert.match(res.message, new RegExp(String(ATTACHMENT_LIMIT)))
})

test('a config too heavy to store is refused by weight, before anything else', () => {
  // Every read of this table pulls the whole config: the admin list, the public
  // page, the homepage strip. A quiz is a few kilobytes of text, so something
  // measured in hundreds of them is a paste accident, and it is turned away on
  // the way in rather than walked item by item first.
  const fat = {
    type: 'checklist',
    sections: Array.from({ length: 50 }, (_, s) => ({
      title: `Section ${s}`,
      items: Array.from({ length: 60 }, () => 'x'.repeat(120)),
    })),
  }
  const res = validateConfig('guide', { content: fat })
  assert.equal(res.ok, false)
  if (!res.ok) assert.match(res.message, /too much|KB/i)
})

// ---------------------------------------------------------------------------
// 9. nextCopySlug — a free address for a copy, inside the shape constraint
// ---------------------------------------------------------------------------

test('nextCopySlug counts up until it finds one nobody is using', () => {
  assert.equal(nextCopySlug('checklist', []), 'checklist-2')
  assert.equal(nextCopySlug('checklist', ['checklist-2']), 'checklist-3')
  assert.equal(nextCopySlug('checklist', ['checklist-2', 'checklist-3']), 'checklist-4')
  // A copy of a copy is a copy of whatever it was called.
  assert.equal(nextCopySlug('checklist-2', ['checklist-2']), 'checklist-2-2')
})

test('nextCopySlug trims the head so the suffix fits, and stays a legal slug', () => {
  const long = 'a'.repeat(SLUG_LIMIT)
  const copy = nextCopySlug(long, [])
  assert.ok(copy)
  assert.ok(copy!.length <= SLUG_LIMIT)
  assert.equal(isValidSlug(copy!), true)

  // A trim that lands on a hyphen must not leave it dangling, which the shape
  // constraint would reject.
  const hyphenated = `${'a'.repeat(SLUG_LIMIT - 3)}-bb`
  const trimmed = nextCopySlug(hyphenated, [])
  assert.ok(trimmed)
  assert.equal(isValidSlug(trimmed!), true)
})

test('nextCopySlug gives up rather than inventing something', () => {
  const taken = Array.from({ length: 200 }, (_, i) => `x-${i}`)
  assert.equal(nextCopySlug('x', taken), null)
})

// ---------------------------------------------------------------------------
// 10. duplicateResource — a draft to change without touching the original
// ---------------------------------------------------------------------------

test('a copy of a built-in guide is not a built-in, and carries its content', async () => {
  resetDemoResources()
  const rows = await fetchAllResources(true)
  const checklist = rows!.find(r => r.kind === 'guide' && r.slug === 'checklist')!
  assert.ok(checklist)

  const res = await duplicateResource(checklist, true)
  assert.equal(res.ok, true)

  const after = await fetchAllResources(true)
  assert.equal(after?.length, 12)
  const copy = after!.find(r => r.slug === 'checklist-2')!
  assert.ok(copy)

  assert.equal(copy.kind, 'guide')
  assert.equal(copy.title, 'Copy of Meet Day Checklist')
  // The whole point of the null key: "built in" has to mean "one of the eleven
  // the migration seeded", or the delete guard refuses a row made this
  // afternoon. Dropping the key means the content has to come with it.
  assert.equal(copy.builtin_key, null)
  assert.deepEqual(copy.config.content, defaultContentFor('checklist'))
  // Hidden, at the bottom of its own group.
  assert.equal(copy.is_published, false)
  assert.ok(copy.sort_order > checklist.sort_order)
  // And everything else about it came along.
  assert.equal(copy.tag, checklist.tag)
  assert.equal(copy.requires_signup, checklist.requires_signup)

  // The original is untouched, still built in, still live.
  const original = after!.find(r => r.id === checklist.id)!
  assert.equal(original.builtin_key, 'checklist')
  assert.equal(original.is_published, true)
  assert.deepEqual(original.config, {})
})

test('copying twice counts up rather than colliding', async () => {
  resetDemoResources()
  const rows = await fetchAllResources(true)
  const quiz = rows!.find(r => r.kind === 'guide' && r.slug === 'quiz')!

  assert.equal((await duplicateResource(quiz, true)).ok, true)
  assert.equal((await duplicateResource(quiz, true)).ok, true)

  const after = await fetchAllResources(true)
  const copies = after!.filter(r => r.slug.startsWith('quiz-')).map(r => r.slug).sort()
  assert.deepEqual(copies, ['quiz-2', 'quiz-3'])
})

test('a copy can be deleted, while the built-in it came from still refuses', async () => {
  resetDemoResources()
  const rows = await fetchAllResources(true)
  const big3 = rows!.find(r => r.kind === 'guide' && r.slug === 'big3')!

  assert.equal((await duplicateResource(big3, true)).ok, true)
  const copy = (await fetchAllResources(true))!.find(r => r.slug === 'big3-2')!
  assert.ok(copy)

  // This is the pair that matters. Same kind, same content, opposite answers,
  // and the difference is builtin_key — which is exactly what the trigger in
  // 041 keys on, so the demo store and the database say the same thing.
  const removed = await deleteResource(copy, true)
  assert.equal(removed.ok, true)

  const refused = await deleteResource(big3, true)
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.message, /unpublish/i)

  const after = await fetchAllResources(true)
  assert.equal(after?.length, 11)
})

test('a copy of a custom resource brings its config with it', async () => {
  resetDemoResources()
  const created = await createResource({
    kind: 'download',
    title: 'Attempt card',
    description: 'Print it and hand it to your handler.',
    tag: 'PDF',
    config: { url: '/files/attempts.pdf', file_label: 'Get the card', attachments: [file()] },
  }, true)
  assert.equal(created.ok, true)

  const made = (await fetchAllResources(true))!.find(r => r.slug === 'attempt-card')!
  const res = await duplicateResource(made, true)
  assert.equal(res.ok, true)

  const copy = (await fetchAllResources(true))!.find(r => r.slug === 'attempt-card-2')!
  assert.ok(copy)
  assert.deepEqual(copy.config, made.config)
  assert.equal(copy.title, 'Copy of Attempt card')
  assert.equal(copy.description, made.description)
  assert.equal(copy.is_published, false)
})

test('a tool cannot be copied, because there is only one of each calculator', async () => {
  resetDemoResources()
  const rows = await fetchAllResources(true)
  const rpe = rows!.find(r => r.kind === 'tool' && r.slug === 'rpe')!

  const res = await duplicateResource(rpe, true)
  assert.equal(res.ok, false)
  if (!res.ok) assert.match(res.message, /only one/i)
  assert.equal((await fetchAllResources(true))?.length, 11)
})

test('the attempt planner guide cannot be copied either, and says why', async () => {
  // It is the one guide with no content on the row: its numbers are the
  // calculator's. A copy with builtin_key dropped would have nothing in it at
  // all, so it is refused rather than made and puzzled over.
  resetDemoResources()
  const rows = await fetchAllResources(true)
  const attempts = rows!.find(r => r.kind === 'guide' && r.slug === 'attempts')!

  const res = await duplicateResource(attempts, true)
  assert.equal(res.ok, false)
  if (!res.ok) assert.match(res.message, /calculator/i)
  assert.equal((await fetchAllResources(true))?.length, 11)
})

// ---------------------------------------------------------------------------
// 11. Guides made here — the kind that is content and nothing else
// ---------------------------------------------------------------------------

test('a guide can be created, but only with the content it is made of', async () => {
  resetDemoResources()

  const bare = await createResource({ kind: 'guide', title: 'Meet Prep' }, true)
  assert.equal(bare.ok, false)
  if (!bare.ok) assert.match(bare.message, /content|built into the site/i)

  const made = await createResource({
    kind: 'guide',
    title: 'Meet Prep',
    is_published: false,
    config: { content: defaultContentFor('checklist') },
  }, true)
  assert.equal(made.ok, true)

  const row = (await fetchAllResources(true))!.find(r => r.slug === 'meet-prep')!
  assert.ok(row)
  assert.equal(row.kind, 'guide')
  assert.equal(row.builtin_key, null)
  assert.equal(row.is_published, false)
  assert.deepEqual(row.config.content, defaultContentFor('checklist'))

  // And unlike the six that shipped, it can be thrown away again.
  assert.equal((await deleteResource(row, true)).ok, true)
  assert.equal((await fetchAllResources(true))?.length, 11)
})

test('an override on a built-in guide is a key that comes and goes', async () => {
  resetDemoResources()
  const rows = await fetchAllResources(true)
  const rpe = rows!.find(r => r.kind === 'guide' && r.slug === 'rpe')!
  const content = defaultContentFor('rpe')
  assert.ok(content)

  const saved = await updateResource(rpe.id, { kind: 'guide', config: { content } }, true)
  assert.equal(saved.ok, true)
  const edited = (await fetchAllResources(true))!.find(r => r.id === rpe.id)!
  assert.deepEqual(edited.config.content, content)
  assert.equal(edited.builtin_key, 'rpe', 'editing the content does not un-build-in the row')

  // Restoring writes a config WITHOUT the key rather than the defaults into it,
  // so a later correction in the bundle still reaches the page.
  const restored = await updateResource(rpe.id, { kind: 'guide', config: {} }, true)
  assert.equal(restored.ok, true)
  const back = (await fetchAllResources(true))!.find(r => r.id === rpe.id)!
  assert.deepEqual(back.config, {})
})

test('files survive a save that was only ever about the files', async () => {
  resetDemoResources()
  const rows = await fetchAllResources(true)
  const audit = rows!.find(r => r.kind === 'guide' && r.slug === 'audit')!

  const saved = await updateResource(audit.id, { kind: 'guide', config: { attachments: [file()] } }, true)
  assert.equal(saved.ok, true)

  const after = (await fetchAllResources(true))!.find(r => r.id === audit.id)!
  assert.equal((after.config.attachments as unknown[]).length, 1)
  // No content key was written, so the guide still renders what it shipped with.
  assert.equal(after.config.content, undefined)
})

test('a demo upload saves, object URL and all', async () => {
  // The walk-through: attach a file with no Supabase behind it, press Save. The
  // uploader answers a blob: url, the demo store is the same tab that minted it,
  // and the save has to go through or the demo dead-ends on its own upload.
  resetDemoResources()
  const rows = await fetchAllResources(true)
  const checklist = rows!.find(r => r.kind === 'guide' && r.slug === 'checklist')!

  const url = 'blob:https://axis.local/6f1c-9a2b'
  const saved = await updateResource(
    checklist.id,
    { kind: 'guide', config: { attachments: [file({ url })] } },
    true,
  )
  assert.equal(saved.ok, true, saved.ok ? '' : saved.message)

  const after = (await fetchAllResources(true))!.find(r => r.id === checklist.id)!
  assert.equal((after.config.attachments as Record<string, unknown>[])[0].url, url)
})
