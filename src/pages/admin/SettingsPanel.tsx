import { useEffect, useMemo } from 'react'
import { usePermissions } from '../../lib/usePermissions'
import { useHashSubTab } from '../../lib/useHashSubTab'
import AdminSettings from './AdminSettings'
import UserManagementPanel from './UserManagementPanel'
import SchedulingPanel from './settings/SchedulingPanel'
import ServicesPanel from './settings/ServicesPanel'
import AvailabilityPanel from './settings/AvailabilityPanel'
import WaitlistRulesPanel from './settings/WaitlistRulesPanel'
import ClientNotificationsPanel from './settings/ClientNotificationsPanel'
import TeamPanel from './settings/TeamPanel'
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
 *
 * THE ACTIVE ENTRY LIVES IN THE URL HASH, the same slot Messages and Insights
 * use, so `?tab=settings#availability` is a link somebody can be sent and a
 * refresh lands back where it left off. Commission is gone entirely: the rules
 * table was built ahead of anything that paid out against it and 049 drops it.
 */

type SettingsTab =
  | 'general' | 'scheduling' | 'services' | 'availability' | 'waitlist'
  | 'notifications' | 'team' | 'users' | 'import' | 'legal'

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general',       label: 'General' },
  { key: 'scheduling',    label: 'Scheduling' },
  { key: 'services',      label: 'Services' },
  { key: 'availability',  label: 'Set Availability' },
  { key: 'waitlist',      label: 'Waitlist rules' },
  { key: 'notifications', label: 'Client notifications' },
  { key: 'team',          label: 'Team' },
  { key: 'users',         label: 'Users & permissions' },
  { key: 'import',        label: 'Import & export' },
  { key: 'legal',         label: 'Legal' },
]

/**
 * The hash values, module-level so useHashSubTab does not rebuild its
 * hashchange listener on every render. Named apart from TAB_KEYS below, which
 * is the PERMISSION map and a different thing entirely.
 */
const SUB_KEYS: readonly SettingsTab[] = TABS.map(t => t.key)

/**
 * Which key opens which entry. ANY of them is enough.
 *
 * `general` and `import` are `manage_site_settings`, which 016 flags sensitive
 * and admin-only to GRANT: between them they hold coach routing, the Resend key
 * and the content importer, which is to say the machinery the other rules are
 * enforced with. `team` is deliberately empty — it is the roster read that
 * gives every other entry its context, so anybody who reached this screen at
 * all may look at it.
 *
 * `availability` is `manage_staff`, which is the key it carried when it was a
 * portal tab of its own. Setting a coach's hours and editing their public page
 * are both roster work.
 */
const TAB_KEYS: Record<SettingsTab, readonly string[]> = {
  general:       ['manage_site_settings'],
  scheduling:    ['manage_scheduling'],
  services:      ['manage_services'],
  availability:  ['manage_staff'],
  waitlist:      ['manage_waitlist'],
  notifications: ['manage_notifications'],
  team:          [],
  users:         ['manage_staff', 'manage_permissions'],
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

  // The hook validates against the FULL key list on purpose: a hash is a
  // bookmark, and what this person may OPEN is decided separately, below. An
  // unrecognised hash (Messages left #newsletters in the slot, say) is not an
  // error, it just falls back to the default.
  const [tab, setTab] = useHashSubTab(SUB_KEYS, 'general')

  // 'general' needs manage_site_settings, so it is exactly the wrong default for
  // everybody this feature was built for. First available entry wins. Still
  // needed now the hash decides the entry: a link to #availability handed to
  // somebody without manage_staff must land them on a tab they can use rather
  // than strand them on an empty pane.
  useEffect(() => {
    if (available.length > 0 && !available.some(t => t.key === tab)) setTab(available[0].key)
  }, [available, tab, setTab])

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
        {open('availability')  && <AvailabilityPanel isDemo={isDemo} />}
        {open('waitlist')      && <WaitlistRulesPanel isDemo={isDemo} />}
        {open('notifications') && <ClientNotificationsPanel isDemo={isDemo} />}
        {open('team')          && <TeamPanel isDemo={isDemo} />}
        {open('users')         && <UserManagementPanel isDemo={isDemo} />}
        {open('import')        && <ImportExportPanel isDemo={isDemo} />}
        {open('legal')         && <LegalPanel isDemo={isDemo} />}
      </div>
    </div>
  )
}
