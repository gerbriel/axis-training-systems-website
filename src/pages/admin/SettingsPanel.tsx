import { useEffect, useMemo, useState } from 'react'
import { usePermissions } from '../../lib/usePermissions'
import AdminSettings from './AdminSettings'
import UserManagementPanel from './UserManagementPanel'
import SchedulingPanel from './settings/SchedulingPanel'
import ServicesPanel from './settings/ServicesPanel'
import WaitlistRulesPanel from './settings/WaitlistRulesPanel'
import ClientNotificationsPanel from './settings/ClientNotificationsPanel'
import TeamPanel from './settings/TeamPanel'
import CommissionPanel from './settings/CommissionPanel'
import ImportExportPanel from './settings/ImportExportPanel'
import LegalPanel from './settings/LegalPanel'

/**
 * Settings, and its sub-tabs.
 *
 * The nine setting areas the wave-1 build produced are individual panels; this
 * is the one place they hang together, mirroring the Settings section of the
 * reference studio's sidebar. "General" is the pre-existing AdminSettings
 * (coach email routing, the demo switch, the content importer, the Resend key),
 * kept as-is; "Users" is the accounts/roles/permissions screen. Everything else
 * is a wave-1 sub-panel.
 *
 * A vertical rail rather than a top bar because there are a dozen entries — a
 * horizontal row of a dozen tabs wraps into an unreadable block on any normal
 * width, and the reference UI stacks them for the same reason.
 *
 * EACH ENTRY IS ITS OWN PERMISSION. 029 split business settings into seven keys
 * so an admin can delegate one area at a time, and this rail is where that
 * split becomes visible: a coach granted `manage_legal` and nothing else sees
 * Legal and no neighbours. The filter is SalesPanel's — build the available
 * list, keep the active entry inside it. Signage only; every panel behind these
 * reads and writes through its own RLS.
 */

type SettingsTab =
  | 'general' | 'scheduling' | 'services' | 'waitlist' | 'notifications'
  | 'team' | 'users' | 'commission' | 'import' | 'legal'

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general',       label: 'General' },
  { key: 'scheduling',    label: 'Scheduling' },
  { key: 'services',      label: 'Services' },
  { key: 'waitlist',      label: 'Waitlist rules' },
  { key: 'notifications', label: 'Client notifications' },
  { key: 'team',          label: 'Team' },
  { key: 'users',         label: 'Users & permissions' },
  { key: 'commission',    label: 'Commission' },
  { key: 'import',        label: 'Import & export' },
  { key: 'legal',         label: 'Legal' },
]

/**
 * Which key opens which entry. ANY of them is enough.
 *
 * `general` and `import` are `manage_site_settings`, which 016 flags sensitive
 * and admin-only to GRANT: between them they hold coach routing, the Resend key
 * and the content importer, which is to say the machinery the other rules are
 * enforced with. `team` is deliberately empty — it is the roster read that
 * gives every other entry its context, so anybody who reached this screen at
 * all may look at it.
 */
const TAB_KEYS: Record<SettingsTab, readonly string[]> = {
  general:       ['manage_site_settings'],
  scheduling:    ['manage_scheduling'],
  services:      ['manage_services'],
  waitlist:      ['manage_waitlist'],
  notifications: ['manage_notifications'],
  team:          [],
  users:         ['manage_staff', 'manage_permissions'],
  commission:    ['manage_commission'],
  import:        ['manage_site_settings'],
  legal:         ['manage_legal'],
}

export default function SettingsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const { can } = usePermissions()
  const fullAccess = isDemo || can('*')

  const available = useMemo(
    () => TABS.filter(t => {
      if (fullAccess) return true
      const keys = TAB_KEYS[t.key]
      // `team` (no key of its own) shows only once something else does, so an
      // empty rail never renders as a single orphaned entry.
      if (keys.length === 0) return TABS.some(o => TAB_KEYS[o.key].some(k => can(k)))
      return keys.some(k => can(k))
    }),
    [can, fullAccess]
  )

  const [tab, setTab] = useState<SettingsTab>('general')

  // 'general' needs manage_site_settings, so it is exactly the wrong default for
  // everybody this feature was built for. First available entry wins.
  useEffect(() => {
    if (available.length > 0 && !available.some(t => t.key === tab)) setTab(available[0].key)
  }, [available, tab])

  const open = (k: SettingsTab) => tab === k && available.some(t => t.key === k)

  if (available.length === 0) {
    return (
      <p style={{ color: 'var(--text-3)', fontSize: '.8rem', padding: '2rem' }}>
        You do not have access to any settings area.
      </p>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 180px) minmax(0, 1fr)', gap: '2rem', alignItems: 'start' }}>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '.15rem', position: 'sticky', top: '1rem' }}>
        {available.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              textAlign: 'left', background: tab === t.key ? 'var(--surface)' : 'transparent',
              border: 'none', borderLeft: `2px solid ${tab === t.key ? '#272C84' : 'transparent'}`,
              color: tab === t.key ? 'var(--text)' : 'var(--text-3)',
              fontSize: '.8rem', fontWeight: tab === t.key ? 700 : 500,
              padding: '.5rem .75rem', cursor: 'pointer', fontFamily: 'inherit', borderRadius: '0 .2rem .2rem 0',
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* `open` rather than a bare `tab ===`: the effect above corrects the
          active entry one frame AFTER a permission set narrows, and a settings
          panel that mounts and fetches for that frame is a request that only
          ever comes back refused. */}
      <div style={{ minWidth: 0 }}>
        {open('general')       && <AdminSettings isDemo={isDemo} />}
        {open('scheduling')    && <SchedulingPanel isDemo={isDemo} />}
        {open('services')      && <ServicesPanel isDemo={isDemo} />}
        {open('waitlist')      && <WaitlistRulesPanel isDemo={isDemo} />}
        {open('notifications') && <ClientNotificationsPanel isDemo={isDemo} />}
        {open('team')          && <TeamPanel isDemo={isDemo} />}
        {open('users')         && <UserManagementPanel isDemo={isDemo} />}
        {open('commission')    && <CommissionPanel isDemo={isDemo} />}
        {open('import')        && <ImportExportPanel isDemo={isDemo} />}
        {open('legal')         && <LegalPanel isDemo={isDemo} />}
      </div>
    </div>
  )
}
