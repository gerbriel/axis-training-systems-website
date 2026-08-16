import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RESOURCE_FILE_ACCEPT,
  RESOURCE_FILE_BUCKET,
  RESOURCE_FILE_MAX_BYTES,
  RESOURCE_FILE_MAX_MB,
  RESOURCE_FILE_TYPES,
  attachmentKindForFile,
  humanFileSize,
  uploadResourceFile,
} from '../src/lib/resourceFiles.ts'

// The pure half of the upload path, plus the refusals, which are the parts that
// run before anything touches the network. The live upload is a Supabase call
// gated by the storage policies in migration 045 and belongs to an integration
// test with a bucket behind it, not to `node --test`.
//
// Every upload here runs in demo mode, which needs no credentials. The blob URL
// that path would mint is NOT asserted on: `URL.createObjectURL` under node
// either does not exist or refuses anything that is not a real Blob, and
// resourceFiles guards it and answers an empty url there. The kind, the size and
// the refusal sentences are what this file is about.

/** A File as far as this module is concerned: a name, a type and a size. */
const fileLike = (name: string, type: string, size = 1024): File =>
  ({ name, type, size } as unknown as File)

const MB = 1024 * 1024

// ---------------------------------------------------------------------------
// 1. attachmentKindForFile — the seven types the bucket takes
// ---------------------------------------------------------------------------

test('every MIME type the bucket allows maps to a kind', () => {
  assert.equal(attachmentKindForFile('a.pdf', 'application/pdf'), 'pdf')
  assert.equal(attachmentKindForFile('a.jpg', 'image/jpeg'), 'image')
  assert.equal(attachmentKindForFile('a.png', 'image/png'), 'image')
  assert.equal(attachmentKindForFile('a.webp', 'image/webp'), 'image')
  assert.equal(attachmentKindForFile('a.csv', 'text/csv'), 'csv')
  assert.equal(attachmentKindForFile('a.doc', 'application/msword'), 'doc')
  assert.equal(
    attachmentKindForFile('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    'doc',
  )
})

test('the client list and the bucket list are the same seven, in the same order', () => {
  // Migration 045 carries this array verbatim. If one of them grows, both do.
  assert.deepEqual([...RESOURCE_FILE_TYPES], [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ])
  // And each of them is a type the mapper actually recognises, so a type can
  // never be accepted by the bucket and then refused by the client.
  for (const type of RESOURCE_FILE_TYPES) {
    assert.notEqual(attachmentKindForFile(`file.${type}`, type), null, type)
  }
})

test('the kind never comes from the extension, only from the type', () => {
  // A .pdf that reports as a zip is a zip. The extension is decoration here and
  // the object name in storage is derived from the type for the same reason.
  assert.equal(attachmentKindForFile('resume.pdf', 'application/zip'), null)
  assert.equal(attachmentKindForFile('sheet.docx', 'video/mp4'), null)
  // And the reverse: a truthful type with a missing or wrong extension is fine.
  assert.equal(attachmentKindForFile('nameless', 'application/pdf'), 'pdf')
  assert.equal(attachmentKindForFile('photo.jfif', 'image/jpeg'), 'image')
})

test('a type the bucket does not carry is refused, whatever it looks like', () => {
  for (const type of ['application/zip', 'video/mp4', 'image/gif', 'image/svg+xml', 'text/html', 'application/x-msdownload']) {
    assert.equal(attachmentKindForFile('thing.pdf', type), null, type)
  }
})

test('the allow-list is read as an own-property table, not through the prototype', () => {
  // A plain object used as a lookup answers something truthy for these two, and
  // an allow-list that says yes to `constructor` is not an allow-list.
  assert.equal(attachmentKindForFile('x.pdf', 'constructor'), null)
  assert.equal(attachmentKindForFile('x.pdf', '__proto__'), null)
  assert.equal(attachmentKindForFile('x.pdf', 'toString'), null)
})

// ---------------------------------------------------------------------------
// 2. The CSV fallback — the one place the file's own name decides anything
// ---------------------------------------------------------------------------

test('a CSV that Windows calls an Excel file is still a CSV', () => {
  assert.equal(attachmentKindForFile('meet-results.csv', 'application/vnd.ms-excel'), 'csv')
  assert.equal(attachmentKindForFile('MEET-RESULTS.CSV', 'application/vnd.ms-excel'), 'csv')
})

test('a CSV the browser could not type at all is still a CSV', () => {
  assert.equal(attachmentKindForFile('lifters.csv', ''), 'csv')
  assert.equal(attachmentKindForFile('lifters.csv', '   '), 'csv')
})

test('the fallback is the .csv extension and nothing wider', () => {
  // A real .xls binary reports the same type as a Windows CSV, which is exactly
  // why that type is not on the bucket's allow-list. Without the .csv name it
  // gets nothing.
  assert.equal(attachmentKindForFile('workbook.xls', 'application/vnd.ms-excel'), null)
  assert.equal(attachmentKindForFile('workbook.xlsx', 'application/vnd.ms-excel'), null)
  // An untyped file that is not named .csv is not guessed at either.
  assert.equal(attachmentKindForFile('mystery', ''), null)
  assert.equal(attachmentKindForFile('report.pdf', ''), null)
  // text/plain is a plausible third liar and is deliberately not admitted yet.
  assert.equal(attachmentKindForFile('lifters.csv', 'text/plain'), null)
})

test('the accept list keeps the .csv extension alongside the MIME types', () => {
  // Without it, a Windows picker filtered on text/csv greys the file out and the
  // fallback above never gets a chance to run.
  assert.ok(RESOURCE_FILE_ACCEPT.includes('text/csv'))
  assert.ok(RESOURCE_FILE_ACCEPT.split(',').includes('.csv'))
})

// ---------------------------------------------------------------------------
// 3. humanFileSize
// ---------------------------------------------------------------------------

test('humanFileSize rounds to the unit a person would use', () => {
  assert.equal(humanFileSize(Math.round(2.4 * MB)), '2.4 MB')
  assert.equal(humanFileSize(312 * 1024), '312 KB')
  assert.equal(humanFileSize(MB), '1.0 MB')
  assert.equal(humanFileSize(20 * MB), '20.0 MB')
  // Under a kilobyte keeps its own unit, because "0 KB" reads as a broken file.
  assert.equal(humanFileSize(0), '0 B')
  assert.equal(humanFileSize(312), '312 B')
  assert.equal(humanFileSize(1023), '1023 B')
  assert.equal(humanFileSize(1024), '1 KB')
})

test('humanFileSize says nothing at all when there is no size to say', () => {
  // A hand written attachments row, or one from before the size was recorded.
  assert.equal(humanFileSize(null), '')
  assert.equal(humanFileSize(-1), '')
  assert.equal(humanFileSize(NaN), '')
  assert.equal(humanFileSize(Infinity), '')
})

// ---------------------------------------------------------------------------
// 4. uploadResourceFile — the refusals, which happen before any network call
// ---------------------------------------------------------------------------

test('the size limit is 20 MB in both of the places that carry it', () => {
  // The other place is the bucket's file_size_limit in 045: 20971520.
  assert.equal(RESOURCE_FILE_MAX_MB, 20)
  assert.equal(RESOURCE_FILE_MAX_BYTES, 20971520)
  assert.equal(RESOURCE_FILE_BUCKET, 'resource-files')
})

test('a file over the cap is refused, and the sentence says how big it was', async () => {
  const res = await uploadResourceFile(fileLike('huge.pdf', 'application/pdf', Math.round(25.4 * MB)), true)
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.match(res.message, /25\.4 MB/)
    assert.match(res.message, /20 MB/)
  }
})

test('a file exactly on the cap is accepted and one byte over is not', async () => {
  const at = await uploadResourceFile(fileLike('big.pdf', 'application/pdf', RESOURCE_FILE_MAX_BYTES), true)
  assert.equal(at.ok, true)

  const over = await uploadResourceFile(fileLike('big.pdf', 'application/pdf', RESOURCE_FILE_MAX_BYTES + 1), true)
  assert.equal(over.ok, false)
})

test('a type the library does not take is refused, naming it and the list', async () => {
  const res = await uploadResourceFile(fileLike('clip.mp4', 'video/mp4', 2 * MB), true)
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.match(res.message, /video\/mp4/)
    assert.match(res.message, /PDF/)
    assert.match(res.message, /DOCX/)
  }
})

test('an untyped file that is not a CSV is refused in its own words', async () => {
  const res = await uploadResourceFile(fileLike('mystery', '', 4096), true)
  assert.equal(res.ok, false)
  // Not "we do not take  files", which is what naming an empty type would give.
  if (!res.ok) {
    assert.match(res.message, /could not tell what kind of file/i)
    assert.match(res.message, /PDF/)
  }
})

test('an empty file is refused before anything is uploaded', async () => {
  const res = await uploadResourceFile(fileLike('empty.csv', 'text/csv', 0), true)
  assert.equal(res.ok, false)
  if (!res.ok) assert.match(res.message, /empty/i)
})

test('nothing at all is refused rather than thrown at', async () => {
  const res = await uploadResourceFile(undefined as unknown as File, true)
  assert.equal(res.ok, false)
})

// ---------------------------------------------------------------------------
// 5. uploadResourceFile — what an accepted file answers
// ---------------------------------------------------------------------------

test('an accepted file answers the kind and the size it saw', async () => {
  const cases: Array<[string, string, string]> = [
    ['checklist.pdf', 'application/pdf', 'pdf'],
    ['cover.jpg', 'image/jpeg', 'image'],
    ['cover.png', 'image/png', 'image'],
    ['cover.webp', 'image/webp', 'image'],
    ['results.csv', 'text/csv', 'csv'],
    ['plan.doc', 'application/msword', 'doc'],
    ['plan.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'doc'],
  ]

  for (const [name, type, kind] of cases) {
    const res = await uploadResourceFile(fileLike(name, type, 3 * MB), true)
    assert.equal(res.ok, true, `${type} should upload`)
    if (res.ok) {
      assert.equal(res.kind, kind, type)
      assert.equal(res.size, 3 * MB, type)
      // The url is a blob: in a browser and an empty string under node. Either
      // way it is a string and this test does not care which.
      assert.equal(typeof res.url, 'string')
    }
  }
})

test('a Windows CSV survives the whole path, not just the mapper', async () => {
  const res = await uploadResourceFile(fileLike('meet.csv', 'application/vnd.ms-excel', 12 * 1024), true)
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.kind, 'csv')
    assert.equal(res.size, 12 * 1024)
  }
})

test('upload never mints the other kind, whatever it is handed', async () => {
  // `other` exists on the union for hand written config rows pointing at foreign
  // URLs. Nothing that goes up through here is ever labelled with it.
  for (const [name, type] of [['a.pdf', 'application/pdf'], ['a.csv', ''], ['a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']] as const) {
    const res = await uploadResourceFile(fileLike(name, type, 2048), true)
    if (res.ok) assert.notEqual(res.kind, 'other')
  }
})
