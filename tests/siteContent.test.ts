import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BLOCK_BYTE_LIMIT,
  BLOCK_ID_SHAPE,
  LINE_LIMIT,
  PARAGRAPH_LIMIT,
  blockDef,
  blockDefs,
  blockGroups,
  defaultFor,
  fetchSiteContent,
  hasOverride,
  resetBlock,
  resetDemoContent,
  resolveContent,
  safeContentUrl,
  saveBlock,
  validateBlock,
} from '../src/lib/siteContent.ts'
import { recordTarget, recordTargets, inlineTargets, recordPermissions } from '../src/lib/editTargets.ts'

/**
 * The registry, the validator and the in-memory demo store. Everything else in
 * siteContent.ts is a Supabase call gated by the RLS in migration 048 and
 * belongs to an integration test with a database behind it.
 *
 * The demo store is module-level and mutated in place, which is the point of it
 * (a walk-through survives a page load), so every test that touches it calls
 * resetDemoContent() first and owns the store for its duration.
 *
 * `supabaseConfigured` is false here, so every write takes the offline path
 * without any test needing to pass isDemo. That is the same code path a real
 * demo walk-through takes, which is why it is worth testing at all.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

// ---------------------------------------------------------------------------
// 1. The registry is well formed
// ---------------------------------------------------------------------------

test('every block id is unique and matches the shape the CHECK constraint enforces', () => {
  const seen = new Set<string>()
  for (const def of blockDefs()) {
    assert.ok(BLOCK_ID_SHAPE.test(def.id), `${def.id} would be refused by site_content_block_shape`)
    assert.ok(def.id.length <= 120, `${def.id} is longer than the column allows`)
    assert.ok(!seen.has(def.id), `${def.id} is registered twice`)
    seen.add(def.id)
  }
  assert.ok(seen.size > 40, 'the registry lost most of its blocks')
})

test('every block carries a label and a group, and no label has an em dash in it', () => {
  for (const def of blockDefs()) {
    assert.ok(def.label.trim().length > 0, `${def.id} has no label`)
    assert.ok(def.group.trim().length > 0, `${def.id} has no group`)
    assert.ok(!def.label.includes('—'), `${def.id} has an em dash in its label`)
  }
})

test('groups come back in page order with no duplicates', () => {
  const groups = blockGroups()
  assert.equal(groups.length, new Set(groups).size)
  assert.equal(groups[0], 'Hero')
  assert.equal(groups[groups.length - 1], 'Footer')
})

test('every items, image and link block names its fields, and every element carries exactly those', () => {
  for (const def of blockDefs()) {
    if (def.kind !== 'items' && def.kind !== 'image' && def.kind !== 'link') continue
    assert.ok(Array.isArray(def.fields) && def.fields.length > 0, `${def.id} names no fields`)
    const fields = def.fields as string[]
    const elements = def.kind === 'items'
      ? (def.default as Record<string, unknown>[])
      : [def.default as Record<string, unknown>]
    for (const [i, el] of elements.entries()) {
      assert.deepEqual(
        Object.keys(el).sort(), [...fields].sort(),
        `${def.id} element ${i + 1} does not carry exactly its fields`,
      )
    }
  }
})

// ---------------------------------------------------------------------------
// 2. Every default validates against itself
//
// This is the property that makes "Restore original" safe: a default the
// validator would refuse is a default nobody could save back, so restoring
// would be the one edit that cannot be undone. It is also what catches a new
// block arriving with an em dash in it, which the house rule bans.
// ---------------------------------------------------------------------------

test('every shipped default passes its own validateBlock and round-trips unchanged', () => {
  for (const def of blockDefs()) {
    const result = validateBlock(def.id, defaultFor(def.id))
    assert.ok(result.ok, `${def.id} refused its own default: ${result.ok ? '' : result.message}`)
    assert.deepStrictEqual(
      result.value, def.default,
      `${def.id} came back from the validator changed, so saving it unedited would rewrite it`,
    )
  }
})

test('no shipped default contains an em dash', () => {
  const dashes: string[] = []
  const walk = (id: string, v: unknown) => {
    if (typeof v === 'string') { if (v.includes('—')) dashes.push(id); return }
    if (Array.isArray(v)) { v.forEach(x => walk(id, x)); return }
    if (v && typeof v === 'object') Object.values(v).forEach(x => walk(id, x))
  }
  for (const def of blockDefs()) walk(def.id, def.default)
  assert.deepEqual(dashes, [], 'the house rule bans em dashes in user-facing copy')
})

// ---------------------------------------------------------------------------
// 3. Lookups
// ---------------------------------------------------------------------------

test('blockDef and defaultFor find a block, and answer undefined for one that does not exist', () => {
  const def = blockDef('hero.eyebrow')
  assert.ok(def)
  assert.equal(def.kind, 'text')
  assert.equal(def.group, 'Hero')
  assert.equal(defaultFor('hero.eyebrow'), 'Powerlifting Coaching')

  assert.equal(blockDef('hero.nothing'), undefined)
  assert.equal(defaultFor('hero.nothing'), undefined)
})

test('defaultFor hands out a copy, so a caller editing it cannot change the registry', () => {
  const a = defaultFor('hero.taglines') as string[]
  a[0] = 'Something Else'
  assert.equal((defaultFor('hero.taglines') as string[])[0], 'Solution Focused')

  const stats = defaultFor('hero.stats') as Record<string, string>[]
  stats[0].number = '9'
  assert.equal((defaultFor('hero.stats') as Record<string, string>[])[0].number, '5')
})

test('an unknown block id is refused rather than stored', () => {
  const r = validateBlock('hero.nothing', 'anything')
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /not a block this site knows about/i)
})

// ---------------------------------------------------------------------------
// 4. Per-kind refusals. Each one has to name the spot, because a drawer eight
//    rows down a page is a screen and a half away from a generic "invalid".
// ---------------------------------------------------------------------------

test('a blank line is refused, not saved', () => {
  const r = validateBlock('hero.eyebrow', '   ')
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /Eyebrow cannot be blank/)
})

test('text where text was expected, or it is refused', () => {
  const r = validateBlock('hero.headline-1', 42)
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /needs to be text/)
})

test('a line longer than the cap is refused rather than truncated', () => {
  const r = validateBlock('hero.eyebrow', 'x'.repeat(LINE_LIMIT + 1))
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, new RegExp(`longer than ${LINE_LIMIT} characters`))
})

test('a paragraph gets the longer cap, and still has one', () => {
  const ok = validateBlock('philosophy.body-1', 'y'.repeat(PARAGRAPH_LIMIT))
  assert.equal(ok.ok, true)
  const no = validateBlock('philosophy.body-1', 'y'.repeat(PARAGRAPH_LIMIT + 1))
  assert.equal(no.ok, false)
  assert.match(no.ok ? '' : no.message, /First paragraph is longer than/)
})

test('an em dash is refused with the sentence that says what to type instead', () => {
  const r = validateBlock('services.intro', 'Four distinct tracks — each designed for a stage.')
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /Use a period, a comma or a colon instead of a dash/)
})

test('a list of the wrong length is refused with both counts named', () => {
  const r = validateBlock('hero.taglines', ['One', 'Two', 'Three'])
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /has 3 entries and this section holds 4/)
})

test('a list of the right length with a blank entry names the entry', () => {
  const r = validateBlock('hero.taglines', ['One', '', 'Three', 'Four'])
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /Entry 2 of taglines cannot be blank/)
})

test('a list of the right length saves', () => {
  const r = validateBlock('hero.taglines', ['One', 'Two', 'Three', 'Four'])
  assert.equal(r.ok, true)
  assert.deepStrictEqual(r.ok ? r.value : null, ['One', 'Two', 'Three', 'Four'])
})

test('an items block refuses a field the default does not have', () => {
  const stats = defaultFor('hero.stats') as Record<string, string>[]
  ;(stats[1] as Record<string, unknown>).colour = 'red'
  const r = validateBlock('hero.stats', stats)
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /Item 2 of stats has a field this site does not know about: "colour"/)
})

test('an items block refuses a record missing one of its fields', () => {
  const pillars = defaultFor('philosophy.pillars') as Record<string, string>[]
  delete (pillars[2] as Record<string, unknown>).desc
  const r = validateBlock('philosophy.pillars', pillars)
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /Item 3 of pillars is missing "desc"/)
})

test('an items block refuses a blank field and names the item and the field', () => {
  const steps = defaultFor('how-it-works.steps') as Record<string, string>[]
  steps[3].title = ''
  const r = validateBlock('how-it-works.steps', steps)
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /Item 4 of steps "title" cannot be blank/)
})

test('an items block of the wrong length is refused, so no ordinal can be minted', () => {
  const pillars = (defaultFor('philosophy.pillars') as Record<string, string>[]).slice(0, 3)
  const r = validateBlock('philosophy.pillars', pillars)
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /has 3 entries and this section holds 4/)
})

test('an image refuses a javascript: src and names the field', () => {
  const r = validateBlock('philosophy.image', { src: 'javascript:alert(1)', alt: 'A photo' })
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /Section photo "src" needs a web address/)
})

test('an image refuses a blank alt, because a photo nobody can hear is not finished', () => {
  const r = validateBlock('philosophy.image', { src: 'https://example.com/a.jpg', alt: '' })
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /Section photo "alt" cannot be blank/)
})

test('an image takes an https src and a site-relative one', () => {
  const a = validateBlock('philosophy.image', { src: 'https://example.com/a.jpg', alt: 'A photo' })
  assert.equal(a.ok, true)
  const b = validateBlock('philosophy.image', { src: '/media/a.jpg', alt: 'A photo' })
  assert.equal(b.ok, true)
})

test('a link refuses a protocol-relative href, which is an absolute URL in a costume', () => {
  const r = validateBlock('footer.linktree', { label: 'Linktree', href: '//evil.example' })
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /Linktree "href" needs a web address/)
})

test('safeContentUrl holds the same line as safeUrl, with no window in the room', () => {
  assert.equal(safeContentUrl('https://example.com/x'), 'https://example.com/x')
  assert.equal(safeContentUrl('/guides'), '/guides')
  assert.equal(safeContentUrl('#tools'), '#tools')
  assert.equal(safeContentUrl('mailto:coach@axistrainingsystems.com'), 'mailto:coach@axistrainingsystems.com')
  assert.equal(safeContentUrl('javascript:alert(1)'), undefined)
  assert.equal(safeContentUrl('java\tscript:alert(1)'), undefined)
  assert.equal(safeContentUrl('/\\evil.example'), undefined)
  assert.equal(safeContentUrl('//evil.example'), undefined)
  assert.equal(safeContentUrl('data:text/html,<script>'), undefined)
  assert.equal(safeContentUrl(''), undefined)
  assert.equal(safeContentUrl(null), undefined)
})

// ---------------------------------------------------------------------------
// 5. The byte cap refuses BEFORE the per-field walk
//
// There is no point walking a megabyte of pasted text to find out which entry
// is malformed when the answer is no either way, and the size refusal is the
// more useful of the two sentences.
// ---------------------------------------------------------------------------

test('an oversized value is refused on size, not on the field it would have failed on', () => {
  const huge = 'x'.repeat(BLOCK_BYTE_LIMIT)
  // Wrong length AND far too big. If the walk ran first the message would be
  // about the entry count.
  const r = validateBlock('hero.taglines', [huge, huge, '', ''])
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /too much text/i)
})

// ---------------------------------------------------------------------------
// 6. Resolving: an override map merged over the shipped copy
// ---------------------------------------------------------------------------

test('with nothing stored, every block resolves to the copy it ships with', () => {
  const resolved = resolveContent(null)
  assert.equal(resolved['hero.eyebrow'], 'Powerlifting Coaching')
  assert.equal(resolved['footer.nav-heading'], 'Navigate')
  assert.equal(Object.keys(resolved).length, blockDefs().length)
})

test('an override replaces its own block and leaves its siblings shipped', () => {
  const resolved = resolveContent({ 'hero.eyebrow': 'Barbell Coaching' })
  assert.equal(resolved['hero.eyebrow'], 'Barbell Coaching')
  assert.equal(resolved['hero.headline-1'], 'Axis')
  assert.equal(resolved['philosophy.heading'], 'Coaching you can trust.')
})

test('a stored value that no longer validates falls back rather than rendering half of itself', () => {
  // A release that added a fifth tagline would leave rows like this behind.
  const resolved = resolveContent({ 'hero.taglines': ['One', 'Two'] })
  assert.deepStrictEqual(resolved['hero.taglines'], defaultFor('hero.taglines'))
})

test('a stored value for a block this build no longer has is ignored, not crashed on', () => {
  const resolved = resolveContent({ 'hero.retired-block': 'x', 'hero.eyebrow': 'Kept' })
  assert.equal(resolved['hero.eyebrow'], 'Kept')
  assert.equal(resolved['hero.retired-block'], undefined)
})

test('hasOverride answers what the Edited chip and the override count both need', () => {
  assert.equal(hasOverride(null, 'hero.eyebrow'), false)
  assert.equal(hasOverride({}, 'hero.eyebrow'), false)
  assert.equal(hasOverride({ 'hero.eyebrow': 'x' }, 'hero.eyebrow'), true)
})

// ---------------------------------------------------------------------------
// 7. The demo store, which is also the no-credentials path
// ---------------------------------------------------------------------------

test('a save round-trips through the demo store and a reset puts the original back', async () => {
  resetDemoContent()

  assert.deepStrictEqual(await fetchSiteContent(), {})

  const saved = await saveBlock('hero.headline-2', 'Powerlifting.')
  assert.equal(saved.ok, true)

  const stored = await fetchSiteContent()
  assert.deepStrictEqual(stored, { 'hero.headline-2': 'Powerlifting.' })
  assert.equal(resolveContent(stored)['hero.headline-2'], 'Powerlifting.')
  assert.equal(resolveContent(stored)['hero.headline-1'], 'Axis')

  const reset = await resetBlock('hero.headline-2')
  assert.equal(reset.ok, true)

  const after = await fetchSiteContent()
  assert.deepStrictEqual(after, {})
  assert.equal(resolveContent(after)['hero.headline-2'], 'Training.')
})

test('a refused save writes nothing at all', async () => {
  resetDemoContent()
  const r = await saveBlock('hero.eyebrow', '')
  assert.equal(r.ok, false)
  assert.deepStrictEqual(await fetchSiteContent(), {})
})

test('a save stores the CLEANED value, not the raw one', async () => {
  resetDemoContent()
  const r = await saveBlock('hero.eyebrow', '  Powerlifting Coaching  ')
  assert.equal(r.ok, true)
  assert.deepStrictEqual(await fetchSiteContent(), { 'hero.eyebrow': 'Powerlifting Coaching' })
  resetDemoContent()
})

test('resetting a block that was never overridden is a success, not an error', async () => {
  resetDemoContent()
  const r = await resetBlock('coaches.heading')
  assert.equal(r.ok, true)
})

test('resetting a block that does not exist is refused rather than silently ignored', async () => {
  const r = await resetBlock('coaches.nothing')
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.message, /not a block this site knows about/i)
})

// ---------------------------------------------------------------------------
// 8. The database-backed targets
//
// The check that matters is not "is this string in a list" but "does a policy
// anywhere actually read this key". 016 says at length that a permission is
// inert until a policy adopts it, and this repo has shipped two keys that were
// gated in the UI and adopted nowhere (manage_content on the meets tab,
// moderate_testimonials on testimonials). Migration 048 repairs both. These
// tests read the migrations so that a target naming a third one cannot ship.
// ---------------------------------------------------------------------------

const MIGRATIONS = readdirSync(join(REPO, 'supabase/migrations'))
  .filter(f => f.endsWith('.sql'))
  .map(f => readFileSync(join(REPO, 'supabase/migrations', f), 'utf8'))
  .join('\n')

const USER_MANAGEMENT = readFileSync(join(REPO, 'src/lib/userManagement.ts'), 'utf8')

test('every target names a permission that exists in the catalogue', () => {
  for (const t of recordTargets()) {
    assert.ok(t.permission.length > 0, `${t.key} names no permission`)
    assert.ok(
      USER_MANAGEMENT.includes(`key: '${t.permission}'`),
      `${t.key} names ${t.permission}, which is not in PERMISSION_CATALOG`,
    )
    assert.ok(
      MIGRATIONS.includes(`('${t.permission}',`),
      `${t.key} names ${t.permission}, which no migration registers in public.permissions`,
    )
  }
})

test('every target names a permission a policy actually adopts', () => {
  for (const t of recordTargets()) {
    assert.ok(
      MIGRATIONS.includes(`has_permission('${t.permission}')`),
      `${t.key} names ${t.permission}, which no policy anywhere reads. A key nothing adopts hides a control and grants nothing.`,
    )
  }
})

test('migration 048 is the one that adopts manage_content and repairs the two broken gates', () => {
  const sql = readFileSync(join(REPO, 'supabase/migrations/048_site_content.sql'), 'utf8')
  assert.match(sql, /has_permission\('manage_content'\)/)
  assert.match(sql, /moderators write testimonials/)
  assert.match(sql, /manage_content writes meets/)
  // The whole point of the table: nothing is seeded, so a delete is the undo.
  // Comment lines are dropped first, because the Verify section is full of
  // example inserts somebody is meant to run by hand.
  const executable = sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')
  assert.ok(!/insert into public\.site_content/i.test(executable), '048 must ship no content rows')
})

test('target keys are unique and every one is findable by key', () => {
  const keys = recordTargets().map(t => t.key)
  assert.equal(keys.length, new Set(keys).size)
  for (const t of recordTargets()) assert.equal(recordTarget(t.key), t)
  assert.equal(recordTarget('nothing'), undefined)
})

test('a target with no inline actions still offers a way in, and one with actions is inline', () => {
  for (const t of recordTargets()) {
    assert.match(t.adminHref(), /\/admin(\?|$)/, `${t.key} does not deep link into the portal`)
    assert.match(t.adminHref('some-id'), /\/admin(\?|$)/)
    for (const a of t.actions) assert.ok(['edit', 'create', 'delete'].includes(a))
  }
  const inline = inlineTargets().map(t => t.key)
  assert.deepEqual(inline, ['blog', 'coachProfile'])
})

test('the heavy targets deep link at the sub-tab the portal actually uses', () => {
  // ?tab= is useUrlTab (dashboard.ts:34) and the hash is useHashSubTab
  // (useHashSubTab.ts:17). An unrecognised value of either falls back rather
  // than erroring, so these going stale is a soft landing, not a crash.
  assert.equal(recordTarget('resource')?.adminHref(), '/admin?tab=resources#library')
  assert.equal(recordTarget('calculator')?.adminHref(), '/admin?tab=resources#calculators')
  assert.equal(recordTarget('service')?.adminHref(), '/admin?tab=settings#services')
  assert.equal(recordTarget('coachProfile')?.adminHref(), '/admin?tab=settings#availability')
  assert.equal(recordTarget('announcement')?.adminHref(), '/admin?tab=insights#announcements')
})

test('the site copy permission is not borrowed by a target that has its own', () => {
  // manage_content opens the site_content table and the meet listings, and
  // nothing else. A target claiming it for a table whose policy reads a
  // different key would draw an outline around a write RLS is going to refuse.
  const borrowed = recordTargets().filter(t => t.permission === 'manage_content').map(t => t.key)
  assert.deepEqual(borrowed, ['meet'], 'only the meets adopt manage_content, per 048 section 6')
})

test('recordPermissions is derived, so a target added later cannot be invisible', () => {
  const perms = recordPermissions()
  assert.equal(perms.length, new Set(perms).size)
  for (const t of recordTargets()) assert.ok(perms.includes(t.permission))
})
