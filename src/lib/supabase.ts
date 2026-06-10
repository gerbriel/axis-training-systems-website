import { createClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env = (import.meta as any).env ?? {}
const url = (env.VITE_SUPABASE_URL as string) ?? ''
const key = (env.VITE_SUPABASE_ANON_KEY as string) ?? ''

if (!url || !key) {
  console.warn('[Supabase] Missing env vars. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env')
}

export const supabase = createClient(url, key)
