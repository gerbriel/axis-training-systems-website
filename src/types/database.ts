export type LeadStatus = 'new' | 'reviewed' | 'accepted' | 'declined'

export interface Lead {
  id: string
  created_at: string
  first_name: string
  last_name: string
  email: string
  social: string | null
  service: string
  coach_pref: string
  age: string | null
  height: string | null
  body_weight: string | null
  weight_class: string | null
  experience: string | null
  injuries: string | null
  train_days: string | null
  occupation: string | null
  squat_max: string | null
  bench_max: string | null
  dead_max: string | null
  squat_freq: string | null
  bench_freq: string | null
  dead_freq: string | null
  current_program: string | null
  squat_style: string | null
  bench_style: string | null
  dead_style: string | null
  weak_points: string | null
  learning_style: string | null
  sleep: string | null
  nutrition: string | null
  stress: string | null
  recovery: string | null
  expectations: string | null
  goals: string | null
  status: LeadStatus
  admin_notes: string | null
}

export interface CoachRouting {
  id: string
  coach_name: string
  email: string
  notify: boolean
  calendly_url: string | null
  updated_at: string
  // Added by 006. Optional here because partial selects and demo fixtures predate them.
  coach_slug?: string | null
  time_zone?: string | null
}

export interface AdminConfig {
  key: string
  value: string
}

export interface CoachSchedule {
  id: string
  coach_slug: string
  day_of_week: number
  start_time: string
  end_time: string
  slot_duration_minutes: number
  is_active: boolean
  created_at: string
}

export interface CoachAvailabilityBlock {
  id: string
  coach_slug: string
  block_date: string
  start_time: string | null
  end_time: string | null
  reason: string | null
  created_at: string
}

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled'

/** 'skipped' = the coach has not connected Google. A fully supported state, not an error. */
export type GoogleSyncStatus = 'pending' | 'synced' | 'failed' | 'skipped'

export interface Booking {
  id: string
  coach_slug: string
  booked_at: string
  duration_minutes: number
  first_name: string
  last_name: string
  email: string
  phone: string | null
  service_interest: string | null
  goals: string | null
  status: BookingStatus
  coach_notes: string | null
  created_at: string
  // Added by 006. Optional here because partial selects and demo fixtures predate them.
  /** Generated: booked_at + duration_minutes. Interval queries filter on this, not booked_at. */
  ends_at?: string
  google_event_id?: string | null
  google_meet_url?: string | null
  google_sync_status?: GoogleSyncStatus
  google_synced_at?: string | null
  // ── Added by 009. The service, and a snapshot of what it was at booking time. ──
  service_id?: string | null
  /**
   * Snapshot, not a lookup. Renaming a service next quarter must not rewrite
   * what somebody booked last month. `service_interest` is kept alongside it
   * because it is what every booking taken before the catalog recorded.
   */
  service_name?: string | null
  service_price_cents?: number | null
  // ── Added by 010. What happened to it, and how the client gets back to it. ──
  /** Bearer credential for booking-manage. Never rendered; never sent to a client role. */
  manage_token?: string
  confirmed_at?: string | null
  cancelled_at?: string | null
  cancelled_by?: 'client' | 'coach' | 'admin' | null
  cancellation_reason?: string | null
  /** The ORIGINAL instant, set on the first move only. */
  rescheduled_from?: string | null
  reschedule_count?: number
}

/**
 * Every column of `bookings` a STAFF screen needs, and not one more.
 *
 * `manage_token` is deliberately absent. It is a bearer credential: whoever
 * holds it can cancel or move that booking without signing in as anyone. A
 * coach can already do both to their own bookings, so pulling it into the
 * portal grants no new power — but it does copy a live credential into a
 * browser, into React state, and into every devtools session and screen
 * recording of that page, for no reason at all.
 *
 * `select('*')` is how it would get there, which is why neither staff screen
 * uses one.
 *
 * ONE STRING LITERAL, however long. postgrest-js parses the select string at
 * the TYPE level, so anything built at runtime — a `.join(',')`, a template,
 * two literals concatenated — widens to `string` and the whole result type
 * collapses to `GenericStringError[]`. The array-and-join version of this
 * constant read better and made every query that used it stop typechecking.
 */
export const BOOKING_STAFF_COLUMNS =
  'id,coach_slug,booked_at,ends_at,duration_minutes,first_name,last_name,email,phone,service_id,service_name,service_price_cents,service_interest,goals,status,coach_notes,created_at,confirmed_at,cancelled_at,cancelled_by,cancellation_reason,rescheduled_from,reschedule_count,google_event_id,google_meet_url,google_sync_status,google_synced_at'

/** A bookable session type (009). The row that owns the duration. */
export interface BookingServiceRow {
  id: string
  slug: string
  name: string
  description: string | null
  duration_minutes: number
  /** null is a real value — most Axis coaching has no price at booking time. */
  price_cents: number | null
  price_note: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

/** Which coach offers which service, and on what terms (009). */
export interface CoachBookingServiceRow {
  coach_slug: string
  service_id: string
  /** null means "the catalog's value" — never zero, which is why there is no default. */
  price_cents_override: number | null
  duration_minutes_override: number | null
  is_active: boolean
  sort_order: number
  created_at: string
}

/**
 * Public, PII-free projection of the coach's timezone. The booking page reads
 * this and nothing else about the coach.
 */
export interface CoachPublicSettings {
  coach_slug: string
  time_zone: string
  updated_at: string
  // ── Added by 009. Booking policy, public because the calendar cannot be drawn
  //    without it. These were constants in two files that disagreed with each
  //    other (120 in the browser, 90 in the edge function).
  /** The notice this coach needs. 0 = same-minute booking. */
  min_lead_minutes?: number
  /** How far out the calendar opens. */
  max_advance_days?: number
  /** Idle held after every booking. Occupies the calendar; never part of a duration. */
  buffer_minutes?: number
  /** Whether a website booking lands 'confirmed' or waits for the coach. */
  auto_confirm?: boolean
}

/**
 * The coach's Google Calendar connection as the CLIENT is allowed to see it.
 * The refresh/access tokens live in the `private` schema, are AES-GCM encrypted,
 * and are unreachable from any client role — so they deliberately have no type here.
 */
export interface CoachCalendarConnection {
  coach_slug: string
  google_email: string
  calendar_id: string
  last_synced_at: string | null
  last_sync_error: string | null
  created_at: string
  updated_at: string
}

/**
 * Busy intervals imported from the coach's Google Calendar via freeBusy.
 * Instants only — no titles, no attendees: event content never enters our system.
 */
export interface CoachCalendarBusy {
  id: string
  coach_slug: string
  starts_at: string
  ends_at: string
  synced_at: string
}

/** Public read surface for taken slots — `bookings` minus every column that is PII. */
export interface CoachBookedSlot {
  coach_slug: string
  starts_at: string
  ends_at: string
}

export interface Pageview {
  id: string
  path: string
  referrer: string | null
  session_id: string
  created_at: string
}

/** Main-page placement. Coaches can only reach 'none'/'pending'; the head coach approves. */
export type TestimonialMainStatus = 'none' | 'pending' | 'approved' | 'rejected'

/**
 * Coaches CRUD these from their portal. `show_on_coach` is theirs to set and
 * publishes immediately; `main_status` gates the homepage and only the head coach
 * can approve it (enforced by the guard_testimonial_main_status trigger in 006).
 */
export interface CoachTestimonialRow {
  id: string
  coach_slug: string
  coach_name: string
  quote: string
  athlete: string
  result: string
  photo: string | null
  show_on_coach: boolean
  main_status: TestimonialMainStatus
  rejection_note: string | null
  created_at: string
  reviewed_at: string | null
}

// Minimal Supabase Database type shape (enough for our tables)
export interface Database {
  public: {
    Tables: {
      leads: {
        Row: Lead
        Insert: Omit<Lead, 'id' | 'created_at' | 'status' | 'admin_notes'> & {
          status?: LeadStatus
          admin_notes?: string | null
        }
        Update: Partial<Lead>
      }
      coach_routing: {
        Row: CoachRouting
        Insert: Omit<CoachRouting, 'id' | 'updated_at'>
        Update: Partial<CoachRouting>
      }
      admin_config: {
        Row: AdminConfig
        Insert: AdminConfig
        Update: Partial<AdminConfig>
      }
      coach_testimonials: {
        Row: CoachTestimonialRow
        Insert: Omit<CoachTestimonialRow, 'id' | 'created_at' | 'reviewed_at' | 'rejection_note'> & {
          main_status?: TestimonialMainStatus
        }
        Update: Partial<CoachTestimonialRow>
      }
    }
  }
}
