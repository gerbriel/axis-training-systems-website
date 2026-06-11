/**
 * Security utilities:
 *   - Input sanitization (XSS prevention)
 *   - Client-side rate limiting (brute-force / spam deterrent)
 */

// ── HTML escaping ─────────────────────────────────────────────────────────

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
 * Full sanitize — strips HTML/script/event-handler patterns, trims,
 * escapes remaining special chars. Used for long-form free-text (default 3 000 chars).
 */
export function sanitize(input: string, maxLength = 3000): string {
  if (typeof input !== 'string') return ''
  return escapeHtml(
    input
      .replace(/<[^>]*>/g, '')              // strip HTML tags
      .replace(/javascript\s*:/gi, '')       // strip JS protocol
      .replace(/data\s*:/gi, '')             // strip data: URIs
      .replace(/vbscript\s*:/gi, '')         // strip vbscript:
      .replace(/on\w+\s*=/gi, '')            // strip inline event handlers
      .replace(/<!--[\s\S]*?-->/g, '')       // strip HTML comments
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
 * Strict short sanitize — for fields that should only contain
 * alphanumerics, spaces, hyphens, apostrophes, and periods (max 100 chars).
 * Use for names, locations, federation names.
 */
export function sanitizeStrict(input: string): string {
  if (typeof input !== 'string') return ''
  return input.replace(/[^a-zA-Z0-9\s\-'.,@/()&]/g, '').trim().slice(0, 100)
}

/**
 * Numeric sanitize — strips everything except digits, dots, and common
 * weight/height notation (e.g. "5'10\"", "84.5 kg", "405 lbs").
 */
export function sanitizeNumeric(input: string): string {
  return sanitize(input.replace(/[^0-9.,'"\-\s a-zA-Z]/g, ''), 50)
}

/**
 * Email sanitize — strips tags, validates rough shape, limits length.
 */
export function sanitizeEmail(input: string): string {
  if (typeof input !== 'string') return ''
  return escapeHtml(input.replace(/<[^>]*>/g, '').replace(/\s/g, '').trim()).slice(0, 254)
}

/**
 * Validate that a string looks like a plausible email.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
}

// ── Rate limiting (client-side, localStorage-backed) ─────────────────────
//
//  Not a substitute for server-side limiting (Supabase handles that for auth),
//  but provides a meaningful deterrent for scripted abuse and gives the UI
//  clear feedback without a round-trip.

const RL_PREFIX = 'axis_rl_'

interface RLState {
  attempts: number
  firstAttemptAt: number
  lockedUntil?: number
}

function readRL(scope: string): RLState {
  try {
    const raw = localStorage.getItem(RL_PREFIX + scope)
    if (!raw) return { attempts: 0, firstAttemptAt: Date.now() }
    const parsed = JSON.parse(raw)
    if (typeof parsed.attempts !== 'number') throw new Error('bad shape')
    return parsed as RLState
  } catch {
    return { attempts: 0, firstAttemptAt: Date.now() }
  }
}

function writeRL(scope: string, state: RLState): void {
  try { localStorage.setItem(RL_PREFIX + scope, JSON.stringify(state)) } catch { /* storage full */ }
}

/**
 * Check whether a scope is currently locked out.
 * Automatically clears an expired lock.
 */
export function isRateLimited(scope: string): { blocked: boolean; remainingMs: number } {
  const state = readRL(scope)
  if (!state.lockedUntil) return { blocked: false, remainingMs: 0 }
  const remaining = state.lockedUntil - Date.now()
  if (remaining <= 0) {
    try { localStorage.removeItem(RL_PREFIX + scope) } catch { /* ignore */ }
    return { blocked: false, remainingMs: 0 }
  }
  return { blocked: true, remainingMs: remaining }
}

/**
 * Record a FAILED attempt. Returns the updated state (including whether now blocked).
 * @param maxAttempts  Number of failures before lockout (default 5)
 * @param lockMs       How long to lock in ms (default 15 min)
 * @param windowMs     How long before attempt counter resets (default 15 min)
 */
export function recordFailedAttempt(
  scope: string,
  maxAttempts = 5,
  lockMs = 15 * 60 * 1000,
  windowMs = 15 * 60 * 1000
): { attempts: number; blocked: boolean; lockedUntil?: number } {
  const now = Date.now()
  const state = readRL(scope)

  // If already locked, just return current state
  if (state.lockedUntil && state.lockedUntil > now) {
    return { attempts: state.attempts, blocked: true, lockedUntil: state.lockedUntil }
  }

  // Reset window if the last attempt was too long ago
  const windowExpired = (now - state.firstAttemptAt) > windowMs
  const newAttempts = windowExpired ? 1 : state.attempts + 1

  const newState: RLState = {
    attempts: newAttempts,
    firstAttemptAt: windowExpired ? now : state.firstAttemptAt,
  }

  if (newAttempts >= maxAttempts) {
    newState.lockedUntil = now + lockMs
  }

  writeRL(scope, newState)
  return { attempts: newAttempts, blocked: !!newState.lockedUntil, lockedUntil: newState.lockedUntil }
}

/**
 * Record a SUCCESSFUL action — resets the counter for the scope.
 */
export function clearRateLimit(scope: string): void {
  try { localStorage.removeItem(RL_PREFIX + scope) } catch { /* ignore */ }
}

/**
 * Format remaining lockout time as a human-readable string.
 */
export function formatLockRemaining(ms: number): string {
  if (ms <= 0) return ''
  const totalSec = Math.ceil(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min > 0) return `${min}m ${sec}s`
  return `${sec}s`
}
