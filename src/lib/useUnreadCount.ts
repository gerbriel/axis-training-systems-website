import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { fetchUnreadConversationCount } from './messagingApi'
import { useLive } from './useLive'

/**
 * How many conversations are waiting on the signed-in person, live.
 *
 * Three shells want the same number in three different badges (the account
 * header, the admin sidebar, the coach bottom bar) and each of them subscribes
 * under its own channel name, because two components sharing one Supabase
 * channel name fight over the same socket topic.
 *
 * The count is CONVERSATIONS, not messages: `unread` is a boolean on the
 * membership row, so "3" means three threads have something new in them.
 *
 * A failed read is not a zero. `fetchUnreadConversationCount` returns null on an
 * outage and the last known number stays on screen rather than the badge
 * quietly claiming the inbox is clear.
 */
export function useUnreadCount(channelName: string, isDemo = false): number {
  const { profile } = useAuth()
  const profileId = profile?.id ?? null
  const [count, setCount] = useState(0)

  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])

  const refetch = useCallback(() => {
    if (!profileId && !isDemo) { setCount(0); return }
    void fetchUnreadConversationCount(isDemo).then(n => {
      if (live.current && typeof n === 'number') setCount(n)
    })
  }, [profileId, isDemo])

  useEffect(() => { refetch() }, [refetch])

  // Own membership rows only. A broader subscription would push every read
  // receipt in the system to every signed-in browser.
  useLive(
    channelName,
    profileId && !isDemo ? [{ table: 'conversation_members', filter: `profile_id=eq.${profileId}` }] : [],
    refetch,
  )

  return count
}
