import { supabase } from './supabase'
import type { CoachSchedule, CoachAvailabilityBlock, Booking } from '../types/database'

export interface TimeSlot {
  start: Date
  end: Date
  durationMinutes: number
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function dateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

export async function fetchAvailableSlots(
  coachSlug: string,
  weeksAhead = 8
): Promise<Map<string, TimeSlot[]>> {
  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() + weeksAhead * 7)

  const [schedulesRes, blocksRes, bookingsRes] = await Promise.all([
    supabase.from('coach_schedules').select('*').eq('coach_slug', coachSlug).eq('is_active', true),
    supabase.from('coach_availability_blocks').select('*').eq('coach_slug', coachSlug)
      .gte('block_date', dateStr(now)).lte('block_date', dateStr(end)),
    supabase.from('bookings').select('booked_at,duration_minutes').eq('coach_slug', coachSlug)
      .neq('status', 'cancelled').gte('booked_at', now.toISOString()).lte('booked_at', end.toISOString()),
  ])

  const schedules = (schedulesRes.data ?? []) as CoachSchedule[]
  const blocks    = (blocksRes.data    ?? []) as CoachAvailabilityBlock[]
  const bookings  = (bookingsRes.data  ?? []) as Pick<Booking, 'booked_at' | 'duration_minutes'>[]

  const result = new Map<string, TimeSlot[]>()

  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)

  while (cursor <= end) {
    const dow = cursor.getDay()
    const ds  = dateStr(cursor)
    const daySchedules = schedules.filter(s => s.day_of_week === dow)

    if (daySchedules.length > 0) {
      const fullDayBlock = blocks.find(b => b.block_date === ds && !b.start_time)
      if (!fullDayBlock) {
        const daySlots: TimeSlot[] = []

        for (const sched of daySchedules) {
          const startMin = timeToMinutes(sched.start_time)
          const endMin   = timeToMinutes(sched.end_time)
          const dur      = sched.slot_duration_minutes

          for (let m = startMin; m + dur <= endMin; m += dur) {
            const slotStart = new Date(cursor)
            slotStart.setHours(Math.floor(m / 60), m % 60, 0, 0)
            const slotEnd = new Date(slotStart)
            slotEnd.setMinutes(slotEnd.getMinutes() + dur)

            // Skip past slots (need at least 2h buffer)
            if (slotStart.getTime() < Date.now() + 2 * 3600_000) continue

            // Time-specific block overlap
            const slotEndMin = m + dur
            const blocked = blocks.some(b => {
              if (b.block_date !== ds || !b.start_time || !b.end_time) return false
              const bs = timeToMinutes(b.start_time)
              const be = timeToMinutes(b.end_time)
              return m < be && slotEndMin > bs
            })
            if (blocked) continue

            // Already booked
            const isBooked = bookings.some(bk => {
              const bkStart = new Date(bk.booked_at).getTime()
              const bkEnd   = bkStart + bk.duration_minutes * 60_000
              return slotStart.getTime() < bkEnd && slotEnd.getTime() > bkStart
            })
            if (isBooked) continue

            daySlots.push({ start: slotStart, end: slotEnd, durationMinutes: dur })
          }
        }

        if (daySlots.length > 0) result.set(ds, daySlots)
      }
    }

    cursor.setDate(cursor.getDate() + 1)
  }

  return result
}

export function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
