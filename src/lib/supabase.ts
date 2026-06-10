import { createClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env = (import.meta as any).env ?? {}
const url = (env.VITE_SUPABASE_URL as string) || 'https://placeholder.supabase.co'
const key = (env.VITE_SUPABASE_ANON_KEY as string) || 'placeholder-anon-key'

// createClient throws if url/key are empty strings — use placeholders so the
// app renders without credentials (demo mode, GitHub Pages preview, etc.)
export const supabaseConfigured =
  url !== 'https://placeholder.supabase.co' && key !== 'placeholder-anon-key'

if (!supabaseConfigured) {
  console.info('[Supabase] No env vars detected — running in demo/preview mode. Supabase features are disabled.')
}

export const supabase = createClient(url, key)
