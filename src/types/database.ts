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
  status: 'pending' | 'confirmed' | 'cancelled'
  coach_notes: string | null
  created_at: string
}

export interface Pageview {
  id: string
  path: string
  referrer: string | null
  session_id: string
  created_at: string
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
    }
  }
}
