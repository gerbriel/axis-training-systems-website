/**
 * "Add to calendar", in the browser.
 *
 * The confirmation email carries a real invite as an attachment
 * (supabase/functions/_shared/ics.ts). This is the same file built client-side
 * for the button on the confirmation screen, so somebody who books and closes
 * the tab before the email lands still gets it into their calendar.
 *
 * Everything is UTC: `DTSTART:20260814T170000Z` is an instant, which needs no
 * VTIMEZONE block and no DST reasoning at read time. The zone is a display
 * concern and the page carries it in words next to the time.
 */

export interface CalendarEvent {
  /** Stable for the life of the booking, so a later invite UPDATES this one. */
  uid: string
  start: Date
  end: Date
  summary: string
  description?: string
  location?: string
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** RFC 5545 TEXT escaping. Backslash first, or later escapes get escaped again. */
function esc(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

export function buildCalendarFile(event: CalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Axis Training Systems//Booking//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${esc(event.uid)}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${esc(event.summary)}`,
    'STATUS:CONFIRMED',
  ]
  if (event.description) lines.push(`DESCRIPTION:${esc(event.description)}`)
  if (event.location)    lines.push(`LOCATION:${esc(event.location)}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.join('\r\n') + '\r\n'
}

/**
 * Hand the file to the browser.
 *
 * A blob URL rather than a `data:` URI: Safari refuses to download a data URI
 * from a link click, and this is the one browser where "add to calendar" is
 * most likely to be the reason someone tapped the button.
 *
 * The object URL is revoked on the next tick — immediately after `click()` is
 * too early in Firefox, which has not started reading it yet.
 */
export function downloadCalendarFile(event: CalendarEvent, filename = 'axis-booking.ics'): void {
  const blob = new Blob([buildCalendarFile(event)], { type: 'text/calendar;charset=utf-8' })
  const url  = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  setTimeout(() => URL.revokeObjectURL(url), 0)
}
