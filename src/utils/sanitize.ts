/**
 * Sanitizes user input:
 * - Strips HTML / script tags
 * - Trims leading/trailing whitespace
 * - Enforces a character length cap
 */

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '`': '&#x60;',
  '/': '&#x2F;',
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"'`/]/g, c => HTML_ENTITIES[c] ?? c)
}

/**
 * Full sanitize — used for long-form / free-text fields (max 3 000 chars).
 */
export function sanitize(input: string, maxLength = 3000): string {
  return escapeHtml(
    input
      .replace(/<[^>]*>/g, '')          // strip any HTML tags
      .replace(/javascript:/gi, '')      // strip JS protocol
      .replace(/on\w+\s*=/gi, '')        // strip inline event handlers
      .trim()
  ).slice(0, maxLength)
}

/**
 * Short sanitize — for names, handles, single-line fields (max 200 chars).
 */
export function sanitizeShort(input: string): string {
  return sanitize(input, 200)
}

/**
 * Numeric sanitize — strips everything except digits, dots, and common
 * weight/height notation (e.g. "5'10\"", "84.5 kg", "405 lbs").
 */
export function sanitizeNumeric(input: string): string {
  return sanitize(input.replace(/[^0-9.,'"\-\s a-zA-Z]/g, ''), 50)
}

/**
 * Email sanitize — strips tags and limits length.
 */
export function sanitizeEmail(input: string): string {
  return escapeHtml(input.replace(/<[^>]*>/g, '').trim()).slice(0, 254)
}
