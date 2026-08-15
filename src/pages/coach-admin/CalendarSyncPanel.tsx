import { useState, useEffect, useCallback } from 'react'
import type { CoachDisplay } from '../../lib/coachProfiles'
import { supabaseConfigured } from '../../lib/supabase'
import { DEFAULT_TIME_ZONE } from '../../lib/availability'
import { browserTimeZone } from '../../lib/timezone'
import {
  getCalendarConnectionStatus,
  getCoachTimeZone,
  updateCoachTimeZone,
  startGoogleOAuth,
  syncCalendarNow,
  disconnectGoogleCalendar,
  calendarErrorMessage,
  DISCONNECTED,
} from '../../lib/calendarSync'
import { safeUrl } from '../../utils/sanitize'
import type { CalendarConnectionStatus } from '../../lib/calendarSync'

const FALLBACK_ZONES = [
  'America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago',
  'America/New_York', 'America/Toronto', 'America/Sao_Paulo', 'Europe/London',
  'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Athens', 'Europe/Moscow', 'Asia/Dubai',
  'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo',
  'Asia/Seoul', 'Australia/Perth', 'Australia/Brisbane', 'Australia/Sydney',
  'Pacific/Auckland', 'UTC',
]

function timeZoneList(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  if (typeof supported === 'function') {
    try {
      const zones = supported('timeZone')
      if (zones.length > 0) return zones
    } catch {
      // Older engine — fall through to the static list.
    }
  }
  return FALLBACK_ZONES
}

const ZONES = timeZoneList()

const OAUTH_ERRORS: Record<string, string> = {
  access_denied:  'You cancelled the Google consent screen — nothing was connected.',
  invalid_state:  'That connection link expired. Start the connection again from this page.',
  missing_scope:  'Google did not grant calendar access. Leave both calendar checkboxes ticked on the consent screen.',
  token_exchange: 'Google would not issue a token. Please try connecting again.',
  server_error:   'Something went wrong on our side. Please try connecting again.',
}

const DEMO_CONNECTION: CalendarConnectionStatus = {
  connected:     true,
  googleEmail:   'coach@gmail.com',
  calendarId:    'primary',
  lastSyncedAt:  new Date().toISOString(),
  lastSyncError: null,
}

function fmtSynced(iso: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

type Banner = { kind: 'success' | 'error'; text: string }
type Busy   = 'connect' | 'sync' | 'disconnect' | 'tz' | null

export default function CalendarSyncPanel({ coach, isDemo = false, onTimeZoneChange }: {
  coach: CoachDisplay
  isDemo?: boolean
  onTimeZoneChange?: (tz: string) => void
}) {
  const useDemo = isDemo || !supabaseConfigured

  const [conn,    setConn]    = useState<CalendarConnectionStatus>(DISCONNECTED)
  const [tz,      setTz]      = useState(useDemo ? browserTimeZone() : DEFAULT_TIME_ZONE)
  const [loading, setLoading] = useState(!useDemo)
  const [banner,  setBanner]  = useState<Banner | null>(null)
  const [busy,    setBusy]    = useState<Busy>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const applyTz = useCallback((next: string) => {
    setTz(next)
    onTimeZoneChange?.(next)
  }, [onTimeZoneChange])

  // The OAuth callback returns the coach here with ?calendar=connected or
  // ?calendar=error&reason=<opaque code>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('calendar')
    if (!result) return

    if (result === 'connected') {
      setBanner({ kind: 'success', text: 'Google Calendar connected. Your busy times now block slots on your booking page.' })
    } else {
      const reason = params.get('reason') ?? params.get('error') ?? result.split('=')[1] ?? ''
      setBanner({ kind: 'error', text: OAUTH_ERRORS[reason] ?? 'We could not connect Google Calendar. Please try again.' })
    }

    params.delete('calendar')
    params.delete('reason')
    params.delete('error')
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
  }, [])

  const load = useCallback(async () => {
    if (useDemo) {
      applyTz(browserTimeZone())
      setLoading(false)
      return
    }
    setLoading(true)

    // The zone is not part of the Google connection — a coach who has never touched Google
    // still has one — so it is fetched alongside the connection, not read off it.
    const [status, zone] = await Promise.all([
      getCalendarConnectionStatus(),
      getCoachTimeZone(coach.slug),
    ])

    setConn(status)
    applyTz(zone ?? DEFAULT_TIME_ZONE)
    setLoading(false)
  }, [useDemo, coach.slug, applyTz])

  useEffect(() => { load() }, [load])

  const connect = async () => {
    if (useDemo) {
      setConn(DEMO_CONNECTION)
      setBanner({ kind: 'success', text: 'Preview mode — no real Google account was connected.' })
      return
    }
    setBusy('connect')
    setBanner(null)

    const res = await startGoogleOAuth(window.location.origin + window.location.pathname)
    if (!res.ok) {
      setBanner({ kind: 'error', text: calendarErrorMessage(res.code) })
      setBusy(null)
      return
    }
    // Checked before we leave the page. `res.url` is minted by our own edge
    // function today, but this is an unconditional navigation to a URL that
    // arrived over the network — the one place where "the server would never
    // send that" is all that stands between a compromised or misconfigured
    // response and the browser following it anywhere.
    const target = safeUrl(res.url)
    if (!target || !target.startsWith('https://accounts.google.com/')) {
      setBanner({ kind: 'error', text: 'That consent link did not look right. Try again.' })
      setBusy(null)
      return
    }
    window.location.assign(target)
  }

  const sync = async () => {
    setBusy('sync')
    setBanner(null)

    if (useDemo) {
      setConn(c => ({ ...c, lastSyncedAt: new Date().toISOString() }))
      setBusy(null)
      return
    }

    const res = await syncCalendarNow()
    if (!res.ok) {
      setBanner({ kind: 'error', text: calendarErrorMessage(res.code) })
      await load()
      setBusy(null)
      return
    }
    setConn(c => ({ ...c, lastSyncedAt: res.syncedAt, lastSyncError: null }))
    setBanner({ kind: 'success', text: `Busy times refreshed — ${res.busyCount} found on your calendar.` })
    setBusy(null)
  }

  const disconnect = async () => {
    setBusy('disconnect')
    setBanner(null)

    if (useDemo) {
      setConn(DISCONNECTED)
      setConfirmDisconnect(false)
      setBusy(null)
      return
    }

    const res = await disconnectGoogleCalendar()
    if (!res.ok) {
      setBanner({ kind: 'error', text: calendarErrorMessage(res.code) })
    } else {
      setConn(DISCONNECTED)
      setBanner({ kind: 'success', text: 'Google Calendar disconnected. Events already on your calendar stay there.' })
    }
    setConfirmDisconnect(false)
    setBusy(null)
  }

  const changeTz = async (next: string) => {
    const previous = tz
    applyTz(next)
    if (useDemo) return

    setBusy('tz')
    const res = await updateCoachTimeZone(coach.slug, next)
    if (!res.ok) {
      applyTz(previous)
      setBanner({ kind: 'error', text: calendarErrorMessage(res.code) })
    }
    setBusy(null)
  }

  const fieldStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid #222', color: 'var(--text)',
    padding: '.6rem .75rem', borderRadius: '.25rem', fontSize: '.8rem',
    outline: 'none', fontFamily: 'inherit', appearance: 'none' as const,
  }

  const connected = conn.connected
  const broken    = connected && !!conn.lastSyncError

  const detail = broken
    ? 'Google stopped accepting our access — usually because the permission was removed from your Google account. Reconnect to resume syncing.'
    : connected
      ? `Calendar: ${conn.calendarId ?? 'primary'} · Last synced ${fmtSynced(conn.lastSyncedAt)}`
      // The cost of not connecting, stated. Bookings are not blocked by it, and
      // a coach who reads "not connected" as "nothing works" connects for the
      // wrong reason. The Meet link is the part that is actually missing: it can
      // only be minted when the booking is written to a real calendar.
      : 'Website bookings are not on your Google Calendar, and your Google busy times do not block slots yet. Bookings still work, but clients do not get a Google Meet link until you connect.'

  return (
    <section>
      <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>Calendar</p>
      <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '1.5rem' }}>Google Calendar Sync</h2>

      {banner && (
        <div style={{
          background: banner.kind === 'success' ? 'rgba(34,197,94,.08)' : 'rgba(200,16,46,.08)',
          border: `1px solid ${banner.kind === 'success' ? 'rgba(34,197,94,.35)' : 'rgba(200,16,46,.35)'}`,
          borderRadius: '.25rem', padding: '.75rem 1rem', marginBottom: '1rem',
          display: 'flex', alignItems: 'center', gap: '.75rem',
        }}>
          <span style={{ color: banner.kind === 'success' ? '#22c55e' : '#c8102e', fontSize: '.8rem', flex: 1 }}>{banner.text}</span>
          <button onClick={() => setBanner(null)} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '.8rem', padding: 0, lineHeight: 1, fontFamily: 'inherit' }}>×</button>
        </div>
      )}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.25rem' }}>
        {loading ? (
          <p style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>Checking your calendar connection…</p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: broken ? '#c8102e' : connected ? '#22c55e' : 'var(--border-mid)',
              }} />

              <div style={{ flex: 1, minWidth: 240 }}>
                <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.85rem' }}>
                  {broken
                    ? `${conn.googleEmail ?? 'Google'} — needs attention`
                    : connected
                      ? conn.googleEmail ?? 'Google account connected'
                      : 'Not connected'}
                </p>
                <p style={{ color: 'var(--text-3)', fontSize: '.75rem', lineHeight: 1.6 }}>{detail}</p>
              </div>

              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                {connected && !broken && (
                  <button onClick={sync} disabled={busy === 'sync'}
                    style={{ background: 'transparent', border: '1px solid var(--border-mid)', color: 'var(--text-2)', fontWeight: 700, fontSize: '.65rem', letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {busy === 'sync' ? 'Syncing…' : 'Sync Now'}
                  </button>
                )}
                {(!connected || broken) && (
                  <button onClick={connect} disabled={busy === 'connect'}
                    style={{ background: busy === 'connect' ? 'var(--border)' : '#272C84', border: 'none', color: 'var(--text)', fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.55rem 1.25rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {busy === 'connect' ? 'Opening Google…' : broken ? 'Reconnect Google' : 'Connect Google Calendar'}
                  </button>
                )}
                {connected && (
                  <button onClick={() => setConfirmDisconnect(true)}
                    style={{ background: 'transparent', border: '1px solid var(--border-mid)', color: 'var(--text-4)', fontWeight: 700, fontSize: '.65rem', letterSpacing: '.1em', textTransform: 'uppercase', padding: '.55rem 1rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Disconnect
                  </button>
                )}
              </div>
            </div>

            {confirmDisconnect && (
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--surface-2)', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-2)', fontSize: '.8rem', flex: 1, minWidth: 260, lineHeight: 1.6 }}>
                  Disconnect {conn.googleEmail ?? 'this Google account'}? New bookings will stop appearing on your calendar, and your Google busy times will stop blocking slots on your booking page. Events already on your calendar stay there.
                </span>
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <button onClick={() => setConfirmDisconnect(false)}
                    style={{ background: 'transparent', border: '1px solid var(--border-mid)', color: 'var(--text-4)', fontWeight: 700, fontSize: '.65rem', letterSpacing: '.1em', textTransform: 'uppercase', padding: '.5rem 1rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Keep Connected
                  </button>
                  <button onClick={disconnect} disabled={busy === 'disconnect'}
                    style={{ background: busy === 'disconnect' ? 'var(--border)' : '#c8102e', border: 'none', color: 'var(--text)', fontWeight: 900, fontSize: '.65rem', letterSpacing: '.12em', textTransform: 'uppercase', padding: '.5rem 1rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {busy === 'disconnect' ? 'Disconnecting…' : 'Yes, Disconnect'}
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--surface-2)', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', display: 'block', marginBottom: '.35rem' }}>Your Timezone</label>
                <select value={tz} onChange={e => changeTz(e.target.value)} disabled={busy === 'tz'} style={{ ...fieldStyle, minWidth: 260 }}>
                  {!ZONES.includes(tz) && <option value={tz}>{tz.replace(/_/g, ' ')}</option>}
                  {ZONES.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <p style={{ color: 'var(--text-4)', fontSize: '.75rem', lineHeight: 1.6, flex: 1, minWidth: 260, marginBottom: '.2rem' }}>
                The hours you set below are wall-clock time in this zone. Clients see them converted to their own zone, and daylight saving is handled for you.
              </p>
            </div>

            <p style={{ color: 'var(--text-3)', fontSize: '.75rem', lineHeight: 1.7, marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--surface-2)' }}>
              What syncing does: we read only your <strong style={{ color: 'var(--text-2)', fontWeight: 700 }}>busy times</strong> — never your event titles, guests, or notes — and hide those slots on your booking page so nobody can double-book you. When a client books, we add the call to this calendar with them as a guest and a Google Meet link, and we update or cancel that event when you change the booking's status.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
