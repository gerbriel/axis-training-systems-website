/**
 * In-memory availability store for demo / no-Supabase mode.
 * Shared between AvailabilityManager (coach admin) and fetchAvailableSlots (booking page)
 * so edits a coach makes in their admin portal are immediately visible on /book.
 *
 * Each coach is seeded with a default Mon/Wed/Fri schedule on first access.
 */

import type { CoachSchedule, CoachAvailabilityBlock } from '../types/database'

const DEFAULT_WINDOWS: Omit<CoachSchedule, 'id' | 'created_at' | 'coach_slug'>[] = [
  { day_of_week: 1, start_time: '09:00', end_time: '11:00', slot_duration_minutes: 30, is_active: true },
  { day_of_week: 3, start_time: '09:00', end_time: '11:00', slot_duration_minutes: 30, is_active: true },
  { day_of_week: 5, start_time: '14:00', end_time: '16:00', slot_duration_minutes: 30, is_active: true },
]

const scheduleStore = new Map<string, CoachSchedule[]>()
const blockStore    = new Map<string, CoachAvailabilityBlock[]>()

function seed(slug: string) {
  if (!scheduleStore.has(slug)) {
    scheduleStore.set(slug, DEFAULT_WINDOWS.map((w, i) => ({
      ...w, coach_slug: slug, id: `demo-${slug}-sched-${i}`, created_at: new Date().toISOString(),
    })))
    blockStore.set(slug, [])
  }
}

export function demoGetSchedules(slug: string): CoachSchedule[] {
  seed(slug)
  return (scheduleStore.get(slug) ?? []).filter(s => s.is_active)
}

export function demoAddSchedule(s: CoachSchedule): void {
  seed(s.coach_slug)
  scheduleStore.get(s.coach_slug)!.push(s)
}

export function demoRemoveSchedule(id: string, slug: string): void {
  seed(slug)
  const arr = scheduleStore.get(slug)
  if (arr) {
    const item = arr.find(s => s.id === id)
    if (item) item.is_active = false
  }
}

export function demoGetBlocks(slug: string): CoachAvailabilityBlock[] {
  seed(slug)
  return blockStore.get(slug) ?? []
}

export function demoAddBlock(b: CoachAvailabilityBlock): void {
  seed(b.coach_slug)
  blockStore.get(b.coach_slug)!.push(b)
}

export function demoRemoveBlock(id: string, slug: string): void {
  seed(slug)
  const arr = blockStore.get(slug)
  if (arr) {
    const idx = arr.findIndex(b => b.id === id)
    if (idx >= 0) arr.splice(idx, 1)
  }
}
