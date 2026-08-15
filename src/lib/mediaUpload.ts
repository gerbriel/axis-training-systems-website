import { supabase, supabaseConfigured } from './supabase'

/**
 * mediaUpload.ts
 *
 * One way to get a photograph off a phone and onto the site.
 *
 * Every image on this site used to be a URL somebody pasted, which meant the
 * real instruction to a coach was "upload it to Imgur first, then come back".
 * This is the other half of migration 035: a single public bucket, three
 * folders, and one function that turns a `File` into a URL the editors can
 * store in the column they already have.
 *
 * WHAT IT DOES NOT DO, so nothing waits for it. It does not resize, compress,
 * strip EXIF or produce thumbnails. A browser upload of an unmodified phone
 * photo is usually 2 to 4 MB, which is under the cap and over what a 72px
 * avatar needs; that is a real cost and it is deliberately not paid here,
 * because the alternative is a canvas re-encode that quietly rotates half of
 * them. If image processing arrives later it belongs in one place: this file,
 * between validation and upload, where every caller inherits it at once.
 *
 * THE FILENAME IS A UUID AND NEVER THE FILE'S OWN NAME. Two reasons, and the
 * second is the important one. A user-supplied name collides, and a
 * user-supplied name in a PUBLIC bucket is an enumeration handle: the bucket
 * serves anything whose path you can guess, and phone photos are named after
 * the person in them often enough to matter. The extension comes from the MIME
 * type rather than the name for the same reason, and because `.jfif` and no
 * extension at all are both common.
 *
 * NOTHING HERE THROWS. Every path answers an `UploadOutcome`, because the caller
 * is a form and a form's job on failure is to say one sentence and stay open.
 * Storage's own errors are translated: they are written for whoever wrote the
 * bucket policy, not for a coach holding a phone.
 *
 * DEMO AND OFFLINE ARE THE SAME SITUATION, the convention `messagingApi.ts`
 * sets: there is nothing to talk to and the screen must still work. Both get
 * `URL.createObjectURL(file)`, so the preview renders (the CSP allows `blob:`)
 * and the value is a URL of the right shape for the rest of the form. That URL
 * is local to the tab and never reaches the database: on the live write path
 * `safeUrl()` drops any scheme that is not http, https or mailto, and the demo
 * stores keep it verbatim, which is exactly the split we want.
 */

/** The bucket migration 035 creates. Public read, staff write, one per site. */
export const SITE_MEDIA_BUCKET = 'site-media'

/**
 * The three surfaces that upload. A folder is a path prefix inside the one
 * bucket, not a separate bucket: same audience, same rules, and a per-surface
 * listing is a prefix query.
 */
export type MediaFolder = 'testimonials' | 'blog' | 'coaches'

/**
 * 5 MB, the same number as the bucket's `file_size_limit` in 035. This copy
 * exists to refuse a file in a sentence before spending a coach's upload
 * bandwidth on a request the bucket will reject anyway. It is not the boundary.
 * Change one, change both.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** Mirrors the bucket's `allowed_mime_types`. Same rule: this is the courtesy, the bucket is the boundary. */
export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export interface UploadResult { ok: true; url: string }
export type UploadOutcome = UploadResult | { ok: false; message: string }

/** Extension from the MIME type, never from the file's name. */
const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
}

/** "4.7 MB". One decimal is all a size message needs to be believed. */
function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * `crypto.randomUUID` needs a secure context. Every real deploy has one and so
 * does localhost, but a LAN preview over plain http does not, and an upload
 * button that throws `randomUUID is not a function` there is a worse outcome
 * than a slightly weaker name in a situation that never reaches production.
 */
function objectId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** Demo mode and "no credentials" are one case: there is nothing to upload to. */
const offline = (isDemo: boolean) => isDemo || !supabaseConfigured

/**
 * What a Storage failure becomes on screen.
 *
 * The two that are worth naming are the two that are somebody's job to fix
 * rather than the uploader's mistake. A missing bucket or a missing policy is
 * migration 035 not having finished (its storage sections can be refused by
 * permissions and say so in a notice), and the person holding the phone needs
 * to be told that and given the paste-a-URL escape hatch rather than "new row
 * violates row-level security policy for table objects".
 */
function uploadMessage(error: { message?: string; statusCode?: string } | null): string {
  const raw = (error?.message ?? '').toLowerCase()

  if (raw.includes('bucket not found') || raw.includes('does not exist')) {
    return 'Photo uploads are not set up on this site yet. Ask an administrator to finish storage setup, or paste an image URL instead.'
  }
  if (raw.includes('row-level security') || raw.includes('permission') || raw.includes('unauthorized')) {
    return 'Your account is not allowed to upload photos. Ask an administrator, or paste an image URL instead.'
  }
  if (raw.includes('exceeded') || raw.includes('too large') || raw.includes('payload')) {
    return `That file is over the ${mb(MAX_UPLOAD_BYTES)} limit.`
  }
  if (raw.includes('mime') || raw.includes('content type')) {
    return 'That file type is not accepted. Use a JPG, PNG, or WebP.'
  }
  return 'The upload did not go through. Check your connection and try again, or paste an image URL instead.'
}

/**
 * Put one image in the bucket and answer its public URL.
 *
 * Validates type and size first, so the common refusals cost nothing and read
 * like sentences. Then uploads to `<folder>/<uuid>.<ext>` and returns the public
 * URL, which is stable for the life of the object because the bucket is public
 * and the path never changes.
 *
 * `isDemo` routes to a local object URL. So does a build with no Supabase
 * credentials, which is what the GitHub Pages preview is.
 */
export async function uploadSiteImage(
  file: File,
  folder: MediaFolder,
  isDemo = false,
): Promise<UploadOutcome> {
  if (!file) return { ok: false, message: 'Choose a photo first.' }

  if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
    return { ok: false, message: 'Photos need to be a JPG, PNG, or WebP.' }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      message: `That photo is ${mb(file.size)} and the limit is ${mb(MAX_UPLOAD_BYTES)}. Resize it and try again.`,
    }
  }
  if (file.size === 0) {
    return { ok: false, message: 'That file is empty. Try picking the photo again.' }
  }

  // Demo and credential-less builds. The blob URL renders (the CSP allows
  // `blob:`) and lives until the tab closes, which is exactly as long as a demo
  // edit does.
  if (offline(isDemo)) {
    return { ok: true, url: URL.createObjectURL(file) }
  }

  const path = `${folder}/${objectId()}.${EXTENSION[file.type] ?? 'jpg'}`

  const { error } = await supabase.storage
    .from(SITE_MEDIA_BUCKET)
    .upload(path, file, {
      // A year. The path contains a uuid that is never reused, so the object at
      // a given URL cannot change and there is nothing to revalidate.
      cacheControl: '31536000',
      contentType: file.type,
      // Deliberately not an upsert: a uuid collision is a bug worth hearing
      // about, not a file worth overwriting.
      upsert: false,
    })

  if (error) return { ok: false, message: uploadMessage(error) }

  const { data } = supabase.storage.from(SITE_MEDIA_BUCKET).getPublicUrl(path)
  const url = data?.publicUrl ?? ''
  if (!url) {
    return { ok: false, message: 'The photo uploaded but the site could not work out its address. Try again.' }
  }

  return { ok: true, url }
}
