import { supabase, supabaseConfigured } from './supabase'

let _sessionId: string | null = null

function sessionId(): string {
  if (_sessionId) return _sessionId
  const stored = sessionStorage.getItem('ax_sid')
  if (stored) { _sessionId = stored; return stored }
  const id = crypto.randomUUID()
  sessionStorage.setItem('ax_sid', id)
  _sessionId = id
  return id
}

export function trackPageview(path: string): void {
  if (!supabaseConfigured) return
  supabase.from('pageviews').insert({
    path,
    referrer: document.referrer || null,
    session_id: sessionId(),
  }).then(() => {})
}
