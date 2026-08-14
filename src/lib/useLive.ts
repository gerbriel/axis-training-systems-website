import { useEffect, useRef } from 'react'
import { supabase, supabaseConfigured } from './supabase.ts'

/**
 * One subscription, many tables, one refetch.
 *
 * Every live surface in this app has the same shape: something changed in the
 * database, so ask again. Not "apply this payload" — ask again. Patching state
 * from a realtime row means writing a second, worse copy of every query in the
 * app and getting it subtly wrong the first time a row arrives that the current
 * filter would have excluded. Refetching costs one round trip and is always
 * right.
 *
 * Realtime honors RLS, so a subscriber is only sent changes to rows it was
 * already allowed to read. A conversation somebody else is having produces no
 * event here at all.
 *
 * The debounce is not politeness. One send fans out into three row events (the
 * message, the conversation rollup, the membership unread flag) and without it
 * the inbox would refetch three times for one incoming message.
 */
export interface LiveTable {
  table: string
  /** PostgREST-style row filter, e.g. `profile_id=eq.${myId}`. */
  filter?: string
}

/**
 * Re-runs `onChange` whenever any of `tables` changes, so a screen reflects
 * other people's writes without a refresh.
 *
 * `channelName` must be unique per mounted component. Two channels sharing a
 * name collide on the server, and the second one quietly gets nothing.
 *
 * A no-op without credentials: demo mode has no server to subscribe to, and an
 * empty `tables` array is the idiom for "not yet" (no session, nothing to
 * watch) so callers can keep the hook call unconditional the way hooks require.
 */
export function useLive(channelName: string, tables: LiveTable[], onChange: () => void) {
  // The latest callback, without it being a resubscribe trigger. A caller that
  // passes an inline arrow would otherwise tear down and rebuild the channel on
  // every render.
  const handler = useRef(onChange)
  useEffect(() => {
    handler.current = onChange
  }, [onChange])

  // Serialized for the same reason: an inline array literal is a new object
  // every render, and a new object in a dependency list is a resubscribe.
  const spec = JSON.stringify(tables)

  useEffect(() => {
    if (!supabaseConfigured) return
    const parsed = JSON.parse(spec) as LiveTable[]
    if (parsed.length === 0) return

    let timer: ReturnType<typeof setTimeout> | undefined
    const ping = () => {
      clearTimeout(timer)
      timer = setTimeout(() => handler.current(), 150)
    }

    const channel = supabase.channel(channelName)
    for (const entry of parsed) {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: entry.table,
          ...(entry.filter ? { filter: entry.filter } : {}),
        },
        ping,
      )
    }
    channel.subscribe()

    return () => {
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [channelName, spec])
}
