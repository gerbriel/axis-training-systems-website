import { supabase, supabaseConfigured } from './supabase'

/**
 * Site-wide switches the public page reads (migration 019).
 *
 * Only non-secret, everyone-may-read settings live here — the table is
 * anon-readable by design. Secrets stay in admin_config (admin-only) and the
 * edge-function secret store.
 */

export type SiteSettingKey = 'demo_enabled'

/**
 * Read one flag. Returns `fallback` on any failure — a missing table (before
 * 019 is applied), an outage, or a row that isn't there yet. A public page must
 * render regardless, so this never throws and never blocks on a bad read.
 */
export async function fetchSiteFlag(key: SiteSettingKey, fallback = false): Promise<boolean> {
  if (!supabaseConfigured) return fallback

  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  if (error || !data) return fallback
  // The column is jsonb; supabase-js hands back the parsed value, so a stored
  // `true` arrives as a boolean. Coerce defensively in case it was written as a
  // string somewhere.
  const v = (data as { value: unknown }).value
  return v === true || v === 'true'
}

/**
 * Write one flag. Admin-only at the database (RLS), so a non-admin caller gets a
 * refusal rather than a silent no-op — `.select()` is included so an RLS block
 * surfaces as zero rows rather than a false success.
 */
export async function setSiteFlag(key: SiteSettingKey, value: boolean): Promise<{ ok: boolean; message?: string }> {
  if (!supabaseConfigured) return { ok: false, message: 'Unavailable in preview mode.' }

  const { data, error } = await supabase
    .from('site_settings')
    .upsert({ key, value }, { onConflict: 'key' })
    .select('key')

  if (error) return { ok: false, message: 'Could not save. Check your connection.' }
  // RLS refusal returns 0 rows with no error on some paths — treat that as the
  // permission failure it is, not a save.
  if (!data || data.length === 0) return { ok: false, message: 'You do not have permission to change this.' }
  return { ok: true }
}
