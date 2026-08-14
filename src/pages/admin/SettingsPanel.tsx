import { useState } from 'react'
import AdminSettings from './AdminSettings'
import UserManagementPanel from './UserManagementPanel'
import SchedulingPanel from './settings/SchedulingPanel'
import ResourcesPanel from './settings/ResourcesPanel'
import WaitlistRulesPanel from './settings/WaitlistRulesPanel'
import ClientNotificationsPanel from './settings/ClientNotificationsPanel'
import TeamPanel from './settings/TeamPanel'
import CommissionPanel from './settings/CommissionPanel'
import LocationsPanel from './settings/LocationsPanel'
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
 */

type SettingsTab =
  | 'general' | 'scheduling' | 'resources' | 'waitlist' | 'notifications'
  | 'team' | 'users' | 'commission' | 'locations' | 'import' | 'legal'

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general',       label: 'General' },
  { key: 'scheduling',    label: 'Scheduling' },
  { key: 'resources',     label: 'Rooms & equipment' },
  { key: 'waitlist',      label: 'Waitlist rules' },
  { key: 'notifications', label: 'Client notifications' },
  { key: 'team',          label: 'Team' },
  { key: 'users',         label: 'Users & permissions' },
  { key: 'commission',    label: 'Commission' },
  { key: 'locations',     label: 'Locations' },
  { key: 'import',        label: 'Import & export' },
  { key: 'legal',         label: 'Legal' },
]

export default function SettingsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [tab, setTab] = useState<SettingsTab>('general')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 180px) minmax(0, 1fr)', gap: '2rem', alignItems: 'start' }}>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '.15rem', position: 'sticky', top: '1rem' }}>
        {TABS.map(t => (
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

      <div style={{ minWidth: 0 }}>
        {tab === 'general'       && <AdminSettings isDemo={isDemo} />}
        {tab === 'scheduling'    && <SchedulingPanel isDemo={isDemo} />}
        {tab === 'resources'     && <ResourcesPanel isDemo={isDemo} />}
        {tab === 'waitlist'      && <WaitlistRulesPanel isDemo={isDemo} />}
        {tab === 'notifications' && <ClientNotificationsPanel isDemo={isDemo} />}
        {tab === 'team'          && <TeamPanel isDemo={isDemo} />}
        {tab === 'users'         && <UserManagementPanel isDemo={isDemo} />}
        {tab === 'commission'    && <CommissionPanel isDemo={isDemo} />}
        {tab === 'locations'     && <LocationsPanel isDemo={isDemo} />}
        {tab === 'import'        && <ImportExportPanel isDemo={isDemo} />}
        {tab === 'legal'         && <LegalPanel isDemo={isDemo} />}
      </div>
    </div>
  )
}
