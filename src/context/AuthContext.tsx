import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { fetchProfile } from '../lib/account'
import type { Profile } from '../lib/account'

/**
 * Session and profile, for the whole app.
 *
 * The session says who you are. The PROFILE says what you may do, and it is the
 * one that matters here: an invite-gated site has a state — signed in, with a
 * real session, and allowed to see nothing — that a session alone cannot
 * express.
 *
 * Everything this exposes is for RENDERING. It decides which screen someone
 * sees, never what they may read. RLS is the boundary; this is the signage.
 */

interface AuthState {
  session: Session | null
  profile: Profile | null
  /** True until the first profile fetch settles. Guards render as "not signed in". */
  loading: boolean
  isSignedIn: boolean
  isActive: boolean
  isStaff: boolean
  isAdmin: boolean
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(supabaseConfigured)

  // Guards every setState against a component that unmounted mid-request.
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])

  const load = useCallback(async (userId: string) => {
    const next = await fetchProfile(userId)
    if (live.current) setProfile(next)
  }, [])

  useEffect(() => {
    // Demo mode has no auth at all. Settle immediately rather than leaving every
    // guard spinning on a session that will never arrive.
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!live.current) return
      setSession(data.session)
      if (data.session) await load(data.session.user.id)
      if (live.current) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!live.current) return
      setSession(next)

      if (!next) {
        setProfile(null)
        setLoading(false)
        return
      }

      // A background token renewal is the same person with a fresher token.
      // Refetching the profile on every renewal is pure churn.
      if (event === 'TOKEN_REFRESHED') return

      // This callback runs while the auth client holds its internal lock, and a
      // Supabase call made inside it can deadlock. Defer to a fresh tick.
      setTimeout(() => {
        if (!live.current) return
        void load(next.user.id).finally(() => { if (live.current) setLoading(false) })
      }, 0)
    })

    return () => sub.subscription.unsubscribe()
  }, [load])

  /**
   * An admin activating or suspending somebody takes effect on that person's
   * screen without them reloading — which matters most on /pending, where the
   * whole experience is waiting for exactly this row to change.
   *
   * Subscribed to their OWN row only. A broader subscription would push every
   * profile change in the system to every signed-in browser.
   */
  const userId = session?.user.id ?? null
  useEffect(() => {
    if (!supabaseConfigured || !userId) return

    const channel = supabase
      .channel(`profile:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        () => { void load(userId) }
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [userId, load])

  const refresh = useCallback(async () => {
    if (userId) await load(userId)
  }, [userId, load])

  const isActive = profile?.status === 'active'

  const value: AuthState = {
    session,
    profile,
    loading,
    isSignedIn: !!session,
    isActive,
    // Staff is "has a calendar or runs the place", which is exactly what
    // current_coach_slug() and is_axis_admin() answer server-side. Both halves
    // require an active status, here as there.
    isStaff: isActive && (profile?.role === 'coach' || profile?.role === 'admin'),
    isAdmin: isActive && profile?.role === 'admin',
    refresh,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
