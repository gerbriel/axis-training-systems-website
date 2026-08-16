import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toCsv,
  parseCsv,
  parseSpreadsheetXml,
  parseXlsx,
  prepareLeads,
  prepareInvites,
  templateCsv,
  templateSpreadsheetXml,
  LEAD_FIELDS,
  INVITE_FIELDS,
  type ParsedTable,
  type ParseOutcome,
} from '../src/lib/dataImport.ts'

// Everything here is the pure half of the import: reading a file into a grid,
// and turning that grid into rows the database would accept. Nothing in this
// file writes anything, which is the point — the panel shows a person all of
// this before there is a button to press.
//
// The parts worth guarding are the ones where being nearly right is worse than
// failing: a quote that shifts every column after it, a formula guard that gets
// stripped off the wrong cell, a row number in an error message that points at
// the wrong line of somebody's spreadsheet.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function table(outcome: ParseOutcome): ParsedTable {
  assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.message)
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.table
}

function refusal(outcome: ParseOutcome): string {
  assert.equal(outcome.ok, false)
  if (outcome.ok) throw new Error('expected a refusal')
  return outcome.message
}

const NO_EXISTING = new Set<string>()

function leadTable(headers: string[], rows: string[][]): ParsedTable {
  return { headers, rows }
}

// ---------------------------------------------------------------------------
// 1. parseCsv — the shape of a file
// ---------------------------------------------------------------------------

test('a plain CSV splits into a header and its rows', () => {
  const t = table(parseCsv('First name,Last name,Email\nJordan,Reyes,jordan@example.com'))
  assert.deepEqual(t.headers, ['First name', 'Last name', 'Email'])
  assert.deepEqual(t.rows, [['Jordan', 'Reyes', 'jordan@example.com']])
})

test('CRLF reads the same as LF, and neither leaves a stray carriage return', () => {
  const t = table(parseCsv('a,b\r\n1,2\r\n3,4\r\n'))
  assert.deepEqual(t.headers, ['a', 'b'])
  assert.deepEqual(t.rows, [['1', '2'], ['3', '4']])
})

test('a quoted field keeps its commas and its newlines', () => {
  const t = table(parseCsv('a,b\n"one, two","line one\nline two"'))
  assert.deepEqual(t.rows, [['one, two', 'line one\nline two']])
})

test('a doubled quote inside a quoted field is one quote', () => {
  const t = table(parseCsv('a\n"5\'11"" tall"'))
  assert.deepEqual(t.rows, [[`5'11" tall`]])
})

test('trailing blank lines are dropped, interior blank rows are not', () => {
  const t = table(parseCsv('a,b\n1,2\n,\n3,4\n\n\n'))
  assert.equal(t.rows.length, 3)
  assert.deepEqual(t.rows[1], ['', ''])
})

test('a header row and nothing else parses to zero rows rather than an error', () => {
  const t = table(parseCsv('First name,Last name,Email,Service'))
  assert.deepEqual(t.rows, [])
})

test('an empty file is refused with a sentence, not an exception', () => {
  assert.match(refusal(parseCsv('')), /nothing in it/i)
  assert.match(refusal(parseCsv('\n\n')), /nothing in it/i)
})

test('a quote that is never closed is refused rather than silently eating the file', () => {
  assert.match(refusal(parseCsv('a,b\n"never ends,2')), /quote/i)
})

test('a byte order mark does not become part of the first header', () => {
  const t = table(parseCsv('﻿Email\njordan@example.com'))
  assert.deepEqual(t.headers, ['Email'])
})

// ---------------------------------------------------------------------------
// 2. parseCsv against settingsExport's own escaping
// ---------------------------------------------------------------------------

test('anything settingsExport can write, parseCsv reads back unchanged', () => {
  const headers = ['First name', 'Last name', 'Email', 'Notes']
  const rows = [
    ['Jordan', 'Reyes', 'jordan@example.com', 'Nothing unusual'],
    ['Ana "Nan"', "O'Neill", 'ana@example.com', 'Said: "one, two"'],
    ['Bao', 'Tran', 'bao@example.com', 'line one\nline two'],
    // Interior, not trailing: a run of empty rows at the END of a file is the
    // padding every spreadsheet leaves behind and is trimmed on the way in.
    ['', '', '', ''],
    ['=cmd', '+1', '-lead@example.com', '@handle'],
  ]
  const t = table(parseCsv(toCsv(headers, rows)))
  assert.deepEqual(t.headers, headers)
  assert.deepEqual(t.rows, rows)
})

test('the formula guard is stripped back off, and only off a guarded cell', () => {
  const t = table(parseCsv('a,b,c,d\n"\'=SUM(A1)","\'Tis the season","\'@handle","plain"'))
  assert.deepEqual(t.rows[0], ['=SUM(A1)', "'Tis the season", '@handle', 'plain'])
})

// ---------------------------------------------------------------------------
// 3. SpreadsheetML — our own .xls template, read back
// ---------------------------------------------------------------------------

test('the Excel lead template parses back into its own headers and example row', () => {
  const t = table(parseSpreadsheetXml(templateSpreadsheetXml('leads')))
  assert.deepEqual(t.headers, LEAD_FIELDS.map(f => f.header))
  assert.equal(t.rows.length, 1)
  assert.equal(t.rows[0][0], 'Jordan')
  assert.equal(t.rows[0][2], 'jordan.reyes@example.com')
})

test('the Excel invite template parses back into its own headers and example row', () => {
  const t = table(parseSpreadsheetXml(templateSpreadsheetXml('invites')))
  assert.deepEqual(t.headers, INVITE_FIELDS.map(f => f.header))
  assert.deepEqual(t.rows, [['jordan.reyes@example.com', 'Jordan', 'Reyes']])
})

test('an escaped ampersand or angle bracket survives the round trip', () => {
  const xml = [
    '<?xml version="1.0"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    ' <Worksheet ss:Name="Sheet1"><Table>',
    '  <Row><Cell><Data ss:Type="String">Notes</Data></Cell></Row>',
    '  <Row><Cell><Data ss:Type="String">Squat &amp; bench &lt;br&gt; 5&#39;9&quot;</Data></Cell></Row>',
    ' </Table></Worksheet></Workbook>',
  ].join('\n')
  const t = table(parseSpreadsheetXml(xml))
  assert.deepEqual(t.rows, [[`Squat & bench <br> 5'9"`]])
})

test('ss:Index places a cell in its real column instead of the next one along', () => {
  const xml = [
    '<Workbook xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="S"><Table>',
    '  <Row><Cell><Data ss:Type="String">a</Data></Cell><Cell><Data ss:Type="String">b</Data></Cell><Cell><Data ss:Type="String">c</Data></Cell></Row>',
    '  <Row><Cell><Data ss:Type="String">one</Data></Cell><Cell ss:Index="3"><Data ss:Type="String">three</Data></Cell></Row>',
    '</Table></Worksheet></Workbook>',
  ].join('\n')
  const t = table(parseSpreadsheetXml(xml))
  assert.deepEqual(t.rows, [['one', '', 'three']])
})

test('XML that is not a spreadsheet is refused with the save-as-CSV way out', () => {
  assert.match(refusal(parseSpreadsheetXml('<html><body>nope</body></html>')), /save as/i)
})

// ---------------------------------------------------------------------------
// 4. .xlsx — a ZIP of XML, built here and read back
// ---------------------------------------------------------------------------

const utf8 = new TextEncoder()

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * The smallest thing that is honestly a .xlsx: real local headers, a real
 * central directory, real deflate. The reader ignores the CRC, so this writes
 * zero rather than implementing CRC32 for a fixture.
 */
async function makeXlsx(files: Array<{ name: string; xml: string; store?: boolean }>): Promise<ArrayBuffer> {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const raw = utf8.encode(file.xml)
    const body = file.store ? raw : await deflateRaw(raw)
    const name = utf8.encode(file.name)

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(8, file.store ? 0 : 8, true)
    lv.setUint32(14, 0, true)                 // crc, unread
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)

    const entry = new Uint8Array(46 + name.length)
    const cv = new DataView(entry.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(10, file.store ? 0 : 8, true)
    cv.setUint32(16, 0, true)                 // crc, unread
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    entry.set(name, 46)

    parts.push(local, body)
    central.push(entry)
    offset += local.length + body.length
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const all = [...parts, ...central, eocd]
  const total = all.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of all) { out.set(p, at); at += p.length }
  return out.buffer
}

const SHEET = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>',
  '<row r="2"><c r="A2" t="inlineStr"><is><t>Jordan</t></is></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c><c r="D2" t="s"><v>6</v></c></row>',
  '<row r="3"><c r="A3" t="s"><v>7</v></c><c r="C3" t="s"><v>8</v></c><c r="D3" t="s"><v>6</v></c><c r="E3"><v>31</v></c></row>',
  '</sheetData></worksheet>',
].join('')

const STRINGS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="9" uniqueCount="9">',
  '<si><t>First name</t></si>',
  '<si><t>Last name</t></si>',
  '<si><t>Email</t></si>',
  '<si><t>Service</t></si>',
  '<si><t>Reyes</t></si>',
  '<si><t>jordan@example.com</t></si>',
  '<si><t>1:1 Coaching</t></si>',
  '<si><r><t>Ana</t></r><r><t> Nan</t></r></si>',
  '<si><t>ana@example.com</t></si>',
  '</sst>',
].join('')

test('an xlsx built from real deflate reads back through shared and inline strings', async () => {
  const buffer = await makeXlsx([
    { name: '[Content_Types].xml', xml: '<Types/>' },
    { name: 'xl/worksheets/sheet1.xml', xml: SHEET },
    { name: 'xl/sharedStrings.xml', xml: STRINGS },
  ])
  const t = table(await parseXlsx(buffer))
  assert.deepEqual(t.headers, ['First name', 'Last name', 'Email', 'Service'])
  assert.deepEqual(t.rows[0], ['Jordan', 'Reyes', 'jordan@example.com', '1:1 Coaching'])
  // A rich-text run joins up, the missing B3 leaves a gap rather than shifting
  // the row along, and an unstyled number comes through as its digits.
  assert.deepEqual(t.rows[1], ['Ana Nan', '', 'ana@example.com', '1:1 Coaching', '31'])
})

test('a stored (uncompressed) entry reads the same as a deflated one', async () => {
  const buffer = await makeXlsx([
    { name: 'xl/worksheets/sheet1.xml', xml: SHEET, store: true },
    { name: 'xl/sharedStrings.xml', xml: STRINGS, store: true },
  ])
  const t = table(await parseXlsx(buffer))
  assert.deepEqual(t.headers, ['First name', 'Last name', 'Email', 'Service'])
})

test('a workbook whose sheet is numbered something else is still found', async () => {
  const buffer = await makeXlsx([
    { name: 'xl/worksheets/sheet3.xml', xml: SHEET },
    { name: 'xl/sharedStrings.xml', xml: STRINGS },
  ])
  const t = table(await parseXlsx(buffer))
  assert.deepEqual(t.headers, ['First name', 'Last name', 'Email', 'Service'])
})

test('a legacy binary .xls is refused by name, with the way out in the sentence', async () => {
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
  const message = refusal(await parseXlsx(ole.buffer))
  assert.match(message, /older Excel file/i)
  assert.match(message, /save as/i)
})

test('a file that is not a zip at all is refused rather than misread', async () => {
  const message = refusal(await parseXlsx(utf8.encode('First name,Last name\nA,B').buffer as ArrayBuffer))
  assert.match(message, /save as/i)
})

// ---------------------------------------------------------------------------
// 5. prepareLeads — mapping and validation
// ---------------------------------------------------------------------------

const HEAD = ['First name', 'Last name', 'Email', 'Service']

test('the CSV template parses and prepares into exactly one usable row', () => {
  const t = table(parseCsv(templateCsv('leads')))
  const prepared = prepareLeads(t, NO_EXISTING)
  assert.deepEqual(prepared.issues, [])
  assert.equal(prepared.rows.length, 1)
  assert.equal(prepared.rows[0].email, 'jordan.reyes@example.com')
  assert.equal(prepared.rows[0].service, '1:1 Coaching (Full Service)')
  assert.equal(prepared.rows[0].coach_pref, 'No Preference')
  assert.equal(prepared.rows[0].status, 'new')
})

test('headers match whatever the case, spacing and underscores are', () => {
  const prepared = prepareLeads(
    leadTable(['FIRST_NAME', 'last name', ' E-Mail ', 'Service'], [['Jordan', 'Reyes', 'jordan@example.com', 'Meet Day']]),
    NO_EXISTING,
  )
  assert.deepEqual(prepared.issues, [])
  assert.equal(prepared.rows[0].first_name, 'Jordan')
  assert.equal(prepared.rows[0].email, 'jordan@example.com')
})

test('a column called something else entirely still lands where it belongs', () => {
  const prepared = prepareLeads(
    leadTable(['Given name', 'Surname', 'Email address', 'Program', 'Instagram', 'Coach'],
      [['Jordan', 'Reyes', 'jordan@example.com', 'Meet Day', '@jlifts', 'Seth Burman']]),
    NO_EXISTING,
  )
  assert.deepEqual(prepared.issues, [])
  assert.equal(prepared.rows[0].social, '@jlifts')
  assert.equal(prepared.rows[0].coach_pref, 'Seth Burman')
})

test('a missing required column stops the whole file and says which one', () => {
  const prepared = prepareLeads(leadTable(['First name', 'Last name'], [['Jordan', 'Reyes']]), NO_EXISTING)
  assert.deepEqual(prepared.rows, [])
  const header = prepared.issues.filter(i => i.row === 1)
  assert.ok(header.some(i => /"Email"/.test(i.message) && /"Service"/.test(i.message)))
})

test('a row missing a required value names the spreadsheet row it is on', () => {
  const prepared = prepareLeads(
    leadTable(HEAD, [
      ['Jordan', 'Reyes', 'jordan@example.com', 'Meet Day'],
      ['', 'Nguyen', 'kim@example.com', 'Meet Day'],
      ['Ana', 'Diaz', '', ''],
    ]),
    NO_EXISTING,
  )
  assert.equal(prepared.rows.length, 1)
  assert.deepEqual(prepared.issues.map(i => i.row), [3, 4])
  assert.match(prepared.issues[0].message, /Row 3 has no a first name|Row 3 has no/)
  assert.match(prepared.issues[1].message, /an email address and a service/)
})

test('a blank row in the middle is skipped without an issue and without shifting the numbers', () => {
  const prepared = prepareLeads(
    leadTable(HEAD, [
      ['Jordan', 'Reyes', 'jordan@example.com', 'Meet Day'],
      ['', '', '', ''],
      ['Ana', 'Diaz', 'not-an-email', 'Meet Day'],
    ]),
    NO_EXISTING,
  )
  assert.equal(prepared.rows.length, 1)
  assert.equal(prepared.issues.length, 1)
  assert.equal(prepared.issues[0].row, 4)
})

test('something that is not an email is quoted back rather than sent to the database', () => {
  const prepared = prepareLeads(leadTable(HEAD, [['Jordan', 'Reyes', 'jordan at example', 'Meet Day']]), NO_EXISTING)
  assert.deepEqual(prepared.rows, [])
  assert.match(prepared.issues[0].message, /"jordan at example"/)
})

test('an address already on file is flagged but kept, so importing anyway stays possible', () => {
  const prepared = prepareLeads(
    leadTable(HEAD, [
      ['Jordan', 'Reyes', 'Jordan@Example.com', 'Meet Day'],
      ['Ana', 'Diaz', 'ana@example.com', 'Meet Day'],
    ]),
    new Set(['jordan@example.com']),
  )
  assert.equal(prepared.rows.length, 2)
  assert.deepEqual(prepared.duplicateEmails, ['jordan@example.com'])
  assert.deepEqual(prepared.issues, [])
})

test('the same address twice in one file keeps the first and says why', () => {
  const prepared = prepareLeads(
    leadTable(HEAD, [
      ['Jordan', 'Reyes', 'jordan@example.com', 'Meet Day'],
      ['Jordan', 'Reyes', 'JORDAN@example.com', 'Full Service'],
    ]),
    NO_EXISTING,
  )
  assert.equal(prepared.rows.length, 1)
  assert.equal(prepared.rows[0].service, 'Meet Day')
  assert.equal(prepared.issues[0].row, 3)
  assert.match(prepared.issues[0].message, /appears earlier in this file/)
})

test('a Status column is ignored and every row still starts as new', () => {
  const prepared = prepareLeads(
    leadTable([...HEAD, 'Status'], [['Jordan', 'Reyes', 'jordan@example.com', 'Meet Day', 'accepted']]),
    NO_EXISTING,
  )
  assert.equal(prepared.rows[0].status, 'new')
  assert.ok(prepared.issues.some(i => i.row === 1 && /starts as New/.test(i.message)))
})

test('a column nobody recognises is named in the preview rather than silently dropped', () => {
  const prepared = prepareLeads(
    leadTable([...HEAD, 'Gym membership number'], [['Jordan', 'Reyes', 'jordan@example.com', 'Meet Day', '4471']]),
    NO_EXISTING,
  )
  assert.equal(prepared.rows.length, 1)
  assert.ok(prepared.issues.some(i => i.row === 1 && /Gym membership number/.test(i.message)))
})

test('a leads export taken out of this same panel imports back in cleanly', () => {
  const csv = toCsv(
    ['First name', 'Last name', 'Email', 'Social', 'Service', 'Coach preference', 'Status', 'Applied'],
    [['Jordan', 'Reyes', 'jordan@example.com', '@jlifts', 'Meet Day Coaching', 'Seth Burman', 'accepted', '8/1/2026, 9:15:00 AM']],
  )
  const prepared = prepareLeads(table(parseCsv(csv)), NO_EXISTING)
  assert.equal(prepared.rows.length, 1)
  assert.equal(prepared.rows[0].status, 'new')
  assert.equal(prepared.rows[0].coach_pref, 'Seth Burman')
  // Only the Status note. "Applied" is a column we know about and skip.
  assert.deepEqual(prepared.issues.map(i => i.row), [1])
})

test('an optional column left blank is omitted rather than written as an empty string', () => {
  const prepared = prepareLeads(
    leadTable([...HEAD, 'Coach preference', 'Goals'], [['Jordan', 'Reyes', 'jordan@example.com', 'Meet Day', '', 'Total 1200']]),
    NO_EXISTING,
  )
  assert.equal('coach_pref' in prepared.rows[0], false)
  assert.equal(prepared.rows[0].goals, 'Total 1200')
})

// ---------------------------------------------------------------------------
// 6. prepareInvites
// ---------------------------------------------------------------------------

test('the invite template prepares into one person', () => {
  const prepared = prepareInvites(table(parseCsv(templateCsv('invites'))), NO_EXISTING)
  assert.deepEqual(prepared.issues, [])
  assert.deepEqual(prepared.rows, [{ email: 'jordan.reyes@example.com', first_name: 'Jordan', last_name: 'Reyes' }])
})

test('one Name column is split rather than leaving the invitation addressed to nobody', () => {
  const prepared = prepareInvites(
    leadTable(['Name', 'Email'], [['Jordan Reyes', 'jordan@example.com'], ['Cher', 'cher@example.com']]),
    NO_EXISTING,
  )
  assert.deepEqual(prepared.rows[0], { email: 'jordan@example.com', first_name: 'Jordan', last_name: 'Reyes' })
  assert.deepEqual(prepared.rows[1], { email: 'cher@example.com', first_name: 'Cher', last_name: '' })
})

test('an invite file with no email column is refused before anything is emailed', () => {
  const prepared = prepareInvites(leadTable(['First name', 'Last name'], [['Jordan', 'Reyes']]), NO_EXISTING)
  assert.deepEqual(prepared.rows, [])
  assert.equal(prepared.issues[0].row, 1)
})

test('somebody who already has an account is listed as already in', () => {
  const prepared = prepareInvites(
    leadTable(['Email'], [['jordan@example.com'], ['ana@example.com']]),
    new Set(['JORDAN@example.com']),
  )
  assert.equal(prepared.rows.length, 2)
  assert.deepEqual(prepared.alreadyIn, ['jordan@example.com'])
})

test('a row with no email at all says there is nobody to invite', () => {
  const prepared = prepareInvites(leadTable(['Email', 'First name'], [['', 'Jordan']]), NO_EXISTING)
  assert.deepEqual(prepared.rows, [])
  assert.equal(prepared.issues[0].row, 2)
  assert.match(prepared.issues[0].message, /nobody to invite/)
})

// ---------------------------------------------------------------------------
// 7. Templates are self-consistent
// ---------------------------------------------------------------------------

test('both templates carry one example row and the same headers in both formats', () => {
  for (const kind of ['leads', 'invites'] as const) {
    const csv = table(parseCsv(templateCsv(kind)))
    const xls = table(parseSpreadsheetXml(templateSpreadsheetXml(kind)))
    assert.deepEqual(csv.headers, xls.headers)
    assert.deepEqual(csv.rows, xls.rows)
    assert.equal(csv.rows.length, 1)
  }
})
