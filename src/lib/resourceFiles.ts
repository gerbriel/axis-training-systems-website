import { supabase, supabaseConfigured } from './supabase.ts'

/**
 * resourceFiles.ts
 *
 * One way to get a PDF off a laptop and onto the site.
 *
 * 041 gave the resource library a `download` kind whose payload is a URL, and
 * said nothing about where that URL comes from. The real instruction to the
 * owner was "host it somewhere else first, then paste the link", which is the
 * sentence mediaUpload.ts was written to delete for photographs, said again
 * about documents. This is the other half of migration 045: one public bucket,
 * one function that turns a `File` into a URL, and the two small helpers the
 * attachment manager renders with.
 *
 * TWO PLACES A FILE ENDS UP, one function for both:
 *
 *   As an ATTACHMENT on a guide. The url goes in `config.attachments[]` next to
 *   a label, a kind and a size, and the public page renders a list of them.
 *   `ResourceAttachment` is that row's shape.
 *
 *   As a STANDALONE download. The library's `download` kind stores a single url
 *   in config, and this is how that url gets minted without leaving the site.
 *
 * WHAT IT DOES NOT DO, so nothing waits for it. No compression, no PDF page
 * count, no virus scanning, no thumbnailing, no text extraction. A file goes up
 * exactly as it came off the disk. If any of that arrives later it belongs in
 * one place, this file, between validation and upload, where every caller
 * inherits it at once.
 *
 * THE OBJECT NAME IS A UUID AND NEVER THE FILE'S OWN NAME, and this matters
 * more for documents than it did for photographs. The bucket is public, so it
 * serves anything whose path can be guessed, and the names people give
 * documents are the giveaway kind: `axis-pricing-2026-DRAFT.docx`,
 * `client-list.csv`. A predictable path in a public bucket is an enumeration
 * handle. The extension comes from the MIME type rather than from the name for
 * the same reason, and because a `.pdf` that is not a PDF should not get to
 * name itself.
 *
 * NOTHING HERE THROWS. Every path answers a `FileUploadOutcome`, because the
 * caller is a form and a form's job on failure is to say one sentence and stay
 * open. Storage's own errors are translated: they are written for whoever wrote
 * the bucket policy, not for the person holding the file.
 *
 * DEMO AND OFFLINE ARE THE SAME SITUATION, the convention mediaUpload.ts and
 * messagingApi.ts set: there is nothing to talk to and the screen must still
 * work. Both get `URL.createObjectURL(file)`, so the link opens in the tab that
 * made it and the value has the shape the rest of the form expects. That URL is
 * local to the tab and never reaches the database.
 *
 * THE CLIENT IS NOT A BOUNDARY, IT IS A COURTESY. The size and type checks
 * below mirror the bucket's `file_size_limit` and `allowed_mime_types` from 045
 * on purpose, so a refusal costs a sentence instead of a 20 MB upload that the
 * bucket rejects at the end. The bucket is what actually enforces them. Change
 * one, change both.
 */

/** The bucket migration 045 creates. Public read, library staff write. */
export const RESOURCE_FILE_BUCKET = 'resource-files'

/**
 * 20 MB, the same number as the bucket's `file_size_limit` in 045.
 *
 * Four times site-media's cap, because this holds documents rather than
 * photographs: a 20 page PDF with images in it is routinely 8 to 15 MB, and a
 * checklist the owner cannot upload is a feature that does not work.
 */
export const RESOURCE_FILE_MAX_MB = 20
export const RESOURCE_FILE_MAX_BYTES = RESOURCE_FILE_MAX_MB * 1024 * 1024

/**
 * Mirrors the bucket's `allowed_mime_types`, in the same order, so the two
 * lists can be compared by eye against 045.
 */
export const RESOURCE_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

/**
 * What goes in a file input's `accept`.
 *
 * The seven types plus the literal `.csv`, which is not redundant: a Windows
 * machine with Excel installed reports a CSV as `application/vnd.ms-excel`, so a
 * picker filtered on `text/csv` alone greys the file out and the owner cannot
 * even select it. The extension entry puts it back in the dialog, and the
 * fallback in `attachmentKindForFile` is what accepts it once it arrives.
 */
export const RESOURCE_FILE_ACCEPT = [...RESOURCE_FILE_TYPES, '.csv'].join(',')

/** One file hanging off a resource row, as it is stored in `config`. */
export interface ResourceAttachment {
  label: string
  url: string
  kind: 'pdf' | 'image' | 'csv' | 'doc' | 'other'
  /** Bytes, or null for a row that predates the size being recorded. */
  size: number | null
}

export type FileUploadOutcome =
  | { ok: true; url: string; kind: ResourceAttachment['kind']; size: number }
  | { ok: false; message: string }

/**
 * MIME to kind. The seven the bucket takes, and nothing else.
 *
 * `other` is deliberately absent from this map and is never MINTED by an
 * upload. It exists on the union so that a hand written `config.attachments`
 * row, pointing at some foreign but http(s) URL that is none of these seven,
 * still renders on the public page as a plain link rather than being dropped or
 * mislabelled as a PDF.
 */
const KIND_BY_TYPE: Record<string, ResourceAttachment['kind']> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'doc',
}

/** Extension from the MIME type, never from the file's name. */
const EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

/**
 * The one case where the file's NAME is allowed to decide anything.
 *
 * A CSV is a text file with no magic number, and browsers disagree about it
 * more than about any other type here. Windows with Excel installed reports
 * `application/vnd.ms-excel`; some Linux and Android pickers report an empty
 * string. Trusting the extension in general would undo the reason the extension
 * is derived from the MIME type everywhere else, so this is scoped as tightly as
 * it can be: the name must end in `.csv`, AND the reported type must be one of
 * those two known liars. Two, not a family: `text/plain` is the next plausible
 * candidate and it is deliberately not here until something real sends it.
 *
 * `application/vnd.ms-excel` is NOT added to the bucket's allow-list to cover
 * this, because that string is also what a real `.xls` binary reports and this
 * library has no business accepting Excel workbooks. Instead the upload rewrites
 * the content type to `text/csv` on the way up, so what lands in the bucket is
 * honestly labelled and passes 045's list.
 */
const CSV_LIARS = ['application/vnd.ms-excel', '']

function looksLikeCsv(name: string, mime: string): boolean {
  return CSV_LIARS.includes(mime.trim().toLowerCase())
    && name.trim().toLowerCase().endsWith('.csv')
}

/**
 * An own-property read of a plain object used as a table.
 *
 * `KIND_BY_TYPE['constructor']` and `KIND_BY_TYPE['__proto__']` both answer
 * something truthy off `Object.prototype`, so a file whose reported MIME type is
 * literally `constructor` would sail through the allow-list with a function as
 * its kind. Nothing produces that by accident, which is exactly why it would be
 * a fun thing to send on purpose.
 */
function ownLookup<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
}

/**
 * What kind of attachment this file would become, or null if it is not one we
 * take. Pure, and exported because it is the half of the validation that is
 * worth testing without a browser.
 */
export function attachmentKindForFile(name: string, mime: string): ResourceAttachment['kind'] | null {
  const type = (mime ?? '').trim().toLowerCase()
  const known = ownLookup(KIND_BY_TYPE, type)
  if (known) return known
  if (looksLikeCsv(name ?? '', type)) return 'csv'
  return null
}

/** The content type to send, which is not always the one the browser reported. */
function contentTypeFor(name: string, mime: string): string {
  const type = (mime ?? '').trim().toLowerCase()
  if (ownLookup(KIND_BY_TYPE, type)) return type
  if (looksLikeCsv(name ?? '', type)) return 'text/csv'
  return type
}

/**
 * "2.4 MB", "312 KB", "" for a row that never recorded one.
 *
 * Used by the attachment manager and available to the public guides page, so
 * that a download link can say how big the thing behind it is before somebody on
 * a phone plan taps it. Bytes below a kilobyte keep their unit rather than
 * rounding to "0 KB", because "312 B" is a real answer and "0 KB" reads as a
 * broken file.
 */
export function humanFileSize(bytes: number | null): string {
  // A missing size and a nonsense one answer the same way. The isFinite test
  // also catches the undefined and the string that a hand written `config` row
  // can carry, which the declared type says cannot happen and JSON disagrees.
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The size sentence in a refusal, one decimal, which is all it needs to be believed. */
function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * `crypto.randomUUID` needs a secure context. Every real deploy has one and so
 * does localhost, but a LAN preview over plain http does not, and an upload
 * button that throws `randomUUID is not a function` there is a worse outcome
 * than a slightly weaker name in a situation that never reaches production.
 * Lifted verbatim from mediaUpload.ts, deliberately: two copies of eight lines
 * beat a shared utility that couples the image path to the document path.
 */
function objectId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** Demo mode and "no credentials" are one case: there is nothing to upload to. */
const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

/**
 * A local URL for the demo path, or an empty string where one cannot be made.
 *
 * In a browser this always succeeds. It is wrapped because this module is
 * imported by `node --test`, where `URL.createObjectURL` either does not exist
 * or refuses anything that is not a real Blob, and a demo mode that throws on a
 * stub would make the pure parts of this file untestable. An empty url only ever
 * happens outside a browser, where nothing renders it.
 */
function previewUrl(file: File): string {
  try {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      return URL.createObjectURL(file)
    }
  } catch {
    // Not a real Blob, which means this is not a real browser.
  }
  return ''
}

/**
 * What a Storage failure becomes on screen.
 *
 * The two worth naming are the two that are somebody else's job to fix rather
 * than the uploader's mistake. A missing bucket or a missing policy is migration
 * 045 not having finished (its storage sections can be refused by permissions
 * and say so in a notice), and the person holding the file needs to be told
 * that, and pointed at the paste-a-URL escape hatch the library panel still
 * offers, rather than shown "new row violates row-level security policy for
 * table objects".
 */
function uploadMessage(error: { message?: string; statusCode?: string } | null): string {
  const raw = (error?.message ?? '').toLowerCase()

  if (raw.includes('bucket not found') || raw.includes('does not exist')) {
    return 'File uploads are not set up on this site yet. Ask an administrator to finish storage setup, or paste a link to the file instead.'
  }
  if (raw.includes('row-level security') || raw.includes('permission') || raw.includes('unauthorized')) {
    return 'Your account is not allowed to upload files to the resource library. Ask an administrator, or paste a link to the file instead.'
  }
  if (raw.includes('exceeded') || raw.includes('too large') || raw.includes('payload')) {
    return `That file is over the ${RESOURCE_FILE_MAX_MB} MB limit.`
  }
  if (raw.includes('mime') || raw.includes('content type')) {
    return 'That file type is not accepted. Use a PDF, JPG, PNG, WebP, CSV, DOC, or DOCX.'
  }
  return 'The upload did not go through. Check your connection and try again, or paste a link to the file instead.'
}

/**
 * Put one file in the bucket and answer its public URL, its kind and its size.
 *
 * Validation runs first and in mediaUpload.ts's order (type, then size, then
 * empty), so the common refusals cost nothing and read like sentences. The
 * object is written to `files/<uuid>.<ext>` and the public URL is returned,
 * which is stable for the life of the object because the bucket is public and
 * the path never changes.
 *
 * THE `files/` PREFIX is not needed to separate anything: this bucket holds one
 * kind of thing and 045 has no per-prefix rule. It is there so the dashboard's
 * object browser opens on a folder rather than a flat wall of uuids at the
 * bucket root, and so a second prefix can be added later without moving the
 * objects that already exist.
 *
 * `isDemo` routes to a local object URL. So does a build with no Supabase
 * credentials, which is what the preview deployment is.
 */
export async function uploadResourceFile(file: File, isDemo = false): Promise<FileUploadOutcome> {
  if (!file) return { ok: false, message: 'Choose a file first.' }

  const name = file.name ?? ''
  const type = (file.type ?? '').trim().toLowerCase()

  const kind = attachmentKindForFile(name, type)
  if (!kind) {
    // Name what we saw as well as what we take. "That file type is not
    // accepted" on its own leaves the owner guessing which of the two files
    // they just tried was the problem.
    const saw = type
      ? `The library does not take ${type} files.`
      : 'Your browser could not tell what kind of file that is.'
    return {
      ok: false,
      message: `${saw} Use a PDF, JPG, PNG, WebP, CSV, DOC, or DOCX.`,
    }
  }

  if (file.size > RESOURCE_FILE_MAX_BYTES) {
    return {
      ok: false,
      message: `That file is ${mb(file.size)} and the limit is ${RESOURCE_FILE_MAX_MB} MB. Compress it or split it up, then try again.`,
    }
  }
  if (file.size === 0) {
    return { ok: false, message: 'That file is empty. Try picking it again.' }
  }

  // Demo and credential-less builds. The blob URL opens in the tab that made it
  // and lives until that tab closes, which is exactly as long as a demo edit
  // does.
  if (offline(isDemo)) {
    return { ok: true, url: previewUrl(file), kind, size: file.size }
  }

  const contentType = contentTypeFor(name, type)
  const path = `files/${objectId()}.${ownLookup(EXTENSION, contentType) ?? 'bin'}`

  const { error } = await supabase.storage
    .from(RESOURCE_FILE_BUCKET)
    .upload(path, file, {
      // A year. The path contains a uuid that is never reused, so the object at
      // a given URL cannot change and there is nothing to revalidate.
      cacheControl: '31536000',
      // Not `file.type`. For the CSV fallback the browser's answer is a type the
      // bucket does not accept, and sending it verbatim is a rejected upload.
      contentType,
      // Deliberately not an upsert: a uuid collision is a bug worth hearing
      // about, not a file worth overwriting.
      upsert: false,
    })

  if (error) return { ok: false, message: uploadMessage(error) }

  const { data } = supabase.storage.from(RESOURCE_FILE_BUCKET).getPublicUrl(path)
  const url = data?.publicUrl ?? ''
  if (!url) {
    return { ok: false, message: 'The file uploaded but the site could not work out its address. Try again.' }
  }

  return { ok: true, url, kind, size: file.size }
}
