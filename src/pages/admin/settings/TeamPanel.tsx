import { useEffect, useState, useCallback } from 'react'
import DemoBanner from '../../../components/dashboard/DemoBanner'
import { fetchTeam, type TeamMember } from '../../../lib/settings'
import { SettingsSection, Flash, Loading, useFlash, pageStyle } from './_shared'

/**
 * Team — the staff roster, read-only here on purpose. Who the coaches and
 * admins are, their status, and the coach page each one owns. The role itself
 * is changed in Users (that panel exists and owns the write); this is the
 * roster view and the link across.
 *
 * Reads a NARROW column set from profiles — never select('*') on a table that
 * also holds athletes' contact details — and only the staff rows.
 */

const ROLE_COLOR: Record<TeamMember['role'], string> = { admin: '#272C84', coach: '#0369a1', athlete: 'var(--text-4)' }
const STATUS_COLOR: Record<TeamMember['status'], string> = { active: '#22c55e', pending: '#eab308', suspended: '#c8102e' }

export default function TeamPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [rows, setRows] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const { flash } = useFlash()

  const load = useCallback(async () => {
    setLoading(true)
    setRows(await fetchTeam(isDemo))
    setLoading(false)
  }, [isDemo])
  useEffect(() => { void load() }, [load])

  if (loading) return <Loading />

  return (
    <div style={pageStyle}>
      {isDemo && <DemoBanner />}
      <Flash flash={flash} />
      <SettingsSection
        title="Team"
        intro="The coaches and admins on the roster. To change someone's role, add a person, or suspend an account, open the Users tab — this is the roster at a glance."
      >
        {rows.length === 0 ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.85rem' }}>No staff to show.</p>
        ) : (
          <div style={{ display: 'grid', gap: 1, background: 'var(--surface-2)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', overflow: 'hidden' }}>
            {rows.map(m => (
              <div key={m.id} style={{ background: 'var(--bg)', padding: '1rem 1.1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.9rem' }}>{m.name}</p>
                  <p style={{ color: 'var(--text-4)', fontSize: '.74rem', marginTop: '.15rem' }}>{m.email}</p>
                </div>
                {m.coach_slug && (
                  <span style={{ color: 'var(--text-3)', fontSize: '.72rem', fontFamily: 'monospace' }}>{m.coach_slug}</span>
                )}
                <span style={{ fontSize: '.6rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', color: ROLE_COLOR[m.role], border: `1px solid ${ROLE_COLOR[m.role]}`, padding: '.25rem .5rem', borderRadius: 999 }}>
                  {m.role}
                </span>
                <span style={{ fontSize: '.6rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', color: STATUS_COLOR[m.status] }}>
                  {m.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}
