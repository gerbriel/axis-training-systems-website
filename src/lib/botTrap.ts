/**
 * Bot friction for the public, unauthenticated forms — apply, booking and the
 * newsletter signup.
 *
 * WHAT THIS IS FOR
 * Those three endpoints already rate-limit server-side, which caps how fast a
 * single caller can hit them. What rate limiting does not do is tell a person
 * apart from a script: a bot that stays under the limit still fills the leads
 * table with junk, and every junk row costs a real notification email and a
 * coach's attention. This adds two cheap client-side signals that cost a human
 * nothing and cost a naive bot everything.
 *
 * BE HONEST ABOUT THE CEILING
 * This stops form-spam scripts that parse the HTML, fill every input they find
 * and POST immediately. It does NOT stop a headless browser driven by anyone
 * who looked at the page once — both checks run in the client, so an attacker
 * who controls the client controls the answer. Treat it as noise reduction, not
 * as a security boundary. The section at the bottom of this file describes what
 * an actual boundary (Cloudflare Turnstile) would take.
 *
 * ── HOW TO ADOPT IT IN A FORM ────────────────────────────────────────────────
 *
 *   import { useBotTrap } from '../lib/botTrap'
 *
 *   function ApplyForm() {
 *     const bot = useBotTrap()
 *
 *     async function onSubmit(e: React.FormEvent) {
 *       e.preventDefault()
 *       // Silent success. Do NOT show an error and do NOT skip the redirect —
 *       // a bot that can see it failed is a bot that gets retooled, and a false
 *       // positive against a real applicant must never look like a rejection.
 *       if (bot.isSuspect()) { setSubmitted(true); return }
 *       await submitApplication(values)
 *     }
 *
 *     return (
 *       <form onSubmit={onSubmit}>
 *         <input {...bot.fieldProps} />
 *         {/* …the real fields… *\/}
 *       </form>
 *     )
 *   }
 *
 * Two rules for whoever wires this up:
 *   1. Drop `bot.fieldProps` on a bare <input>. Spreading it onto a styled
 *      component that overrides `style` will make the honeypot VISIBLE, at
 *      which point real users type in it and get silently dropped.
 *   2. Bail silently, as above. Never surface "you look like a bot".
 */

import { useCallback, useMemo, useRef, type CSSProperties } from 'react'

/**
 * How long a human plausibly needs. Three seconds is deliberately forgiving:
 * the cost of a false positive here is a lost coaching lead, so the threshold
 * only catches submissions that no one could have typed — a script POSTing the
 * instant the DOM is ready.
 */
export const MIN_FILL_MS = 3_000

/**
 * The honeypot's name is the whole trick, so it has to look like a field worth
 * filling. Bots target common names; "website" is one of the most attractive
 * because link-spam is the point of most form-spam. A field named `honeypot`
 * or `bot_check` gets skipped by anything written after 2010.
 *
 * It must not collide with a real field name on any adopting form. None of the
 * apply, booking or newsletter forms collect a website, so this is safe — check
 * before reusing it anywhere that does.
 */
export const HONEYPOT_NAME = 'website'

export interface BotTrapFieldProps {
  type: 'text'
  name: string
  autoComplete: 'off'
  tabIndex: -1
  'aria-hidden': true
  /** Keeps the browser's own "this field is empty" heuristics off it. */
  defaultValue: ''
  ref: (el: HTMLInputElement | null) => void
  style: CSSProperties
}

export interface BotTrap {
  /** Spread onto a bare <input>. See the adoption note above. */
  fieldProps: BotTrapFieldProps
  /** Epoch ms captured on first render — i.e. when the form appeared. */
  startedAt: number
  /** True when the submission looks automated. Call at submit time. */
  isSuspect: () => boolean
}

/**
 * Hidden without being `display:none` or `type="hidden"`.
 *
 * This distinction matters. A `type="hidden"` input, or one hidden with
 * `display:none` / `visibility:hidden`, is exactly what a competent spam script
 * checks for before deciding which fields to fill — those are the two-line
 * honeypot detections every spam toolkit ships with. Pushing a normally-styled
 * input off-screen instead means the bot has to run layout to notice, which the
 * cheap ones do not do.
 *
 * The accessibility side is handled separately and must stay: `aria-hidden`
 * keeps it out of the screen-reader tree, `tabIndex: -1` keeps it out of the
 * tab order, and `autoComplete: 'off'` stops a password manager helpfully
 * filling it in and locking a real user out of the form forever.
 */
const OFFSCREEN: CSSProperties = {
  position: 'absolute',
  left: '-9999px',
  top: 'auto',
  width: 1,
  height: 1,
  opacity: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
}

export function useBotTrap(minFillMs: number = MIN_FILL_MS): BotTrap {
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Captured once, on first render, and never refreshed — this is the clock the
  // time-trap measures against. A ref rather than state so that reading it
  // cannot schedule a re-render mid-submit.
  const startedAtRef = useRef<number>(Date.now())

  const setRef = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el
  }, [])

  const isSuspect = useCallback((): boolean => {
    // Honeypot: nothing a human can see or tab to was typed in, so any value at
    // all means something filled the form by parsing it.
    if ((inputRef.current?.value ?? '').trim() !== '') return true

    // Time trap. Date.now() can jump backwards if the OS clock is corrected
    // mid-form, which would produce a negative elapsed and read as instant
    // submission; treat a negative delta as unknown rather than as a bot.
    const elapsed = Date.now() - startedAtRef.current
    if (elapsed < 0) return false
    return elapsed < minFillMs
  }, [minFillMs])

  const fieldProps = useMemo<BotTrapFieldProps>(
    () => ({
      type: 'text',
      name: HONEYPOT_NAME,
      autoComplete: 'off',
      tabIndex: -1,
      'aria-hidden': true,
      defaultValue: '',
      ref: setRef,
      style: OFFSCREEN,
    }),
    [setRef],
  )

  return { fieldProps, startedAt: startedAtRef.current, isSuspect }
}

/**
 * ── WHAT REAL BOT PROTECTION WOULD TAKE ──────────────────────────────────────
 *
 * Everything above is advisory, because it is decided in the client. A bot that
 * skips the honeypot input and waits four seconds passes cleanly. Cloudflare
 * Turnstile is the upgrade, and the reason it works is that the verdict is
 * reached on Cloudflare's side and confirmed by OUR server — the client only
 * carries an opaque token it cannot forge.
 *
 * The work, in order:
 *
 *   1. Cloudflare dashboard → Turnstile → add a widget for
 *      axistrainingsystems.com. Free, no Cloudflare-hosted DNS required. It
 *      yields a public sitekey and a secret key.
 *   2. Load the widget script and render it in each public form. This needs a
 *      CSP change in BOTH index.html and vercel.json, and the two must stay in
 *      sync: `script-src https://challenges.cloudflare.com` and
 *      `frame-src https://challenges.cloudflare.com` — note frame-src is
 *      currently 'none', so the challenge iframe is blocked until it is opened.
 *   3. Send the resulting `cf-turnstile-response` token with the form payload.
 *   4. Verify it SERVER-SIDE in the Supabase Edge Functions that already own
 *      these endpoints — booking-create, send-lead-email, and whatever handles
 *      newsletter signup — by POSTing token + secret + the caller's IP to
 *      https://challenges.cloudflare.com/turnstile/v0/siteverify and rejecting
 *      the request when `success` is false. Store the secret as a Supabase
 *      function secret; it must never reach the bundle.
 *      Tokens are single-use and expire after ~5 minutes, so verification has
 *      to happen on the request that carries them, not on a later retry.
 *   5. Decide the failure mode for a Cloudflare outage — fail-closed blocks
 *      real leads, fail-open reverts to today's posture. Fail-open plus the
 *      existing rate limit is the right trade for a lead form.
 *
 * Only step 4 makes it a boundary. A Turnstile widget rendered without the
 * server-side siteverify call is worth no more than this file.
 */
