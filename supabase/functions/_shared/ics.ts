// Axis Training Systems — iCalendar (RFC 5545) for booking emails.
//
// A confirmation email that cannot be added to a calendar is a confirmation the
// client has to re-type. Google's own invite covers the coaches who connected
// Google; this covers everybody else, and it is what makes "add to calendar"
// work in Apple Mail and Outlook where a link would not.
//
// Everything here is UTC. `DTSTART:20260814T170000Z` is an instant and needs no
// VTIMEZONE block, no zone name the client's calendar has to recognise, and no
// DST reasoning at read time. The zone is a display concern and the email body
// carries it in words.

export interface IcsEvent {
  /** Stable across every mail about this booking — that is what makes an update an update. */
  uid: string
  start: Date
  end: Date
  summary: string
  description?: string
  location?: string
  organizerName: string
  organizerEmail: string
  attendeeName?: string
  attendeeEmail?: string
  /**
   * Incremented every time this booking is mailed about again. A calendar
   * client ignores an update whose SEQUENCE is not higher than the one it
   * already holds, so a rescheduled booking that reuses 0 silently does nothing.
   */
  sequence?: number
  method?: 'REQUEST' | 'CANCEL'
}

/** RFC 5545: `20260814T170000Z`. */
function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * TEXT escaping, in the order the spec requires: backslash first, or every
 * escape added afterwards gets escaped again.
 */
function esc(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Content lines are limited to 75 OCTETS, not characters. Folding by character
 * splits a multi-byte sequence down the middle and the line arrives as mojibake
 * — which is how an accented name in a summary breaks an otherwise fine invite.
 */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line

  const out: string[] = []
  let start = 0
  let limit = 75

  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    // Never cut inside a UTF-8 sequence: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
    out.push(new TextDecoder().decode(bytes.slice(start, end)))
    start = end
    limit = 74 // continuation lines carry a leading space
  }

  return out.join('\r\n ')
}

export function buildIcs(event: IcsEvent): string {
  const method = event.method ?? 'REQUEST'

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Axis Training Systems//Booking//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${esc(event.uid)}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${esc(event.summary)}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    `ORGANIZER;CN=${esc(event.organizerName)}:mailto:${event.organizerEmail}`,
  ]

  if (event.description) lines.push(`DESCRIPTION:${esc(event.description)}`)
  if (event.location)    lines.push(`LOCATION:${esc(event.location)}`)
  if (event.attendeeEmail) {
    lines.push(
      `ATTENDEE;CN=${esc(event.attendeeName ?? event.attendeeEmail)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${event.attendeeEmail}`
    )
  }

  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.map(fold).join('\r\n') + '\r\n'
}

/** Base64 for a Resend attachment. Encodes the UTF-8 bytes, not the code units. */
export function icsBase64(ics: string): string {
  const bytes = new TextEncoder().encode(ics)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}
