/**
 * fileDownload.ts
 *
 * One way to hand a generated file to the browser, because there were three and
 * two of them were subtly wrong.
 *
 * The wrong shape is: create the object URL, set it on a detached anchor, click,
 * revoke on the very next line. That works often enough to look correct and
 * fails in exactly the cases nobody tests. A link that was never inserted into
 * the document does not reliably dispatch a navigation in Firefox, and revoking
 * the URL in the same task can abort a save that has not started reading yet.
 * Both failures are silent: no error, no file, an admin who clicks Export and
 * gets nothing.
 *
 * So: append, click, remove, and revoke a tick later, which is what
 * `downloadCalendarFile` in ics.ts already did correctly and what everything
 * else now goes through.
 */

/** Append, click, remove, then revoke a tick later. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  // Next task, not next line. The save is asynchronous and the browser is still
  // holding the URL when this function returns.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * The same, for text we generated ourselves.
 *
 * `charset=utf-8` is on every caller's MIME string because these files are
 * opened by Excel, and Excel guesses the encoding from the type when it can and
 * from the locale when it cannot. The guess is wrong often enough that a name
 * with an accent in it comes back mangled.
 */
export function downloadText(filename: string, text: string, mime: string): void {
  downloadBlob(filename, new Blob([text], { type: mime }))
}
