import { useEffect } from 'react'
import { usePermissions } from '../../lib/usePermissions'
import { useHashSubTab } from '../../lib/useHashSubTab'
import ResourceLibraryPanel from './ResourceLibraryPanel'
import CalculatorSettingsPanel from './CalculatorSettingsPanel'

/**
 * Resources & Tools — the two surfaces behind the free half of the public site.
 *
 * The library is what a visitor downloads; the calculators are the numbers
 * inside the tools they use without downloading anything. They are one nav
 * entry because they are one job, and two sub-tabs because they are governed by
 * two different permissions: `manage_resource_library` and `manage_calculators`
 * are granted separately, so a coach can curate the guides without being able
 * to change what the attempt planner tells somebody to lift.
 *
 * Each sub-tab renders only for its own key, in the shape SalesPanel already
 * uses: build the available list, keep the active one pointed at something the
 * person may see, and say so plainly when the list is empty. Demo and admin
 * resolve to '*' in usePermissions, so neither loses a tab.
 */

const ACCENT = '#272C84'

type Sub = 'library' | 'calculators'

const SUB_LABELS: Record<Sub, string> = {
  library: 'Resource library',
  calculators: 'Calculators',
}

const KEY_FOR: Record<Sub, string> = {
  library: 'manage_resource_library',
  calculators: 'manage_calculators',
}

// Module-level so the hash hook does not rebuild its listener every render.
// Both keys are always valid to READ out of the hash; what a person may open is
// decided below, because a hash is a bookmark and not a claim.
const SUB_KEYS: readonly Sub[] = ['library', 'calculators']

export default function ResourcesHub({ isDemo = false }: { isDemo?: boolean }) {
  const { can } = usePermissions()
  const allow = (s: Sub) => isDemo || can('*') || can(KEY_FOR[s])

  const available = SUB_KEYS.filter(allow)
  const [sub, setSub] = useHashSubTab(SUB_KEYS, 'library')

  // The hash may name a sub-tab this person does not hold, and the permission
  // set arrives a beat after the first paint, so this settles both.
  useEffect(() => {
    if (available.length > 0 && !available.includes(sub)) setSub(available[0])
  }, [available, sub, setSub])

  return (
    <div>
      <div style={{ display: 'flex', gap: '.35rem', padding: '1rem 2rem 0', borderBottom: '1px solid var(--surface)', flexWrap: 'wrap' }}>
        {available.map(s => (
          <button
            key={s}
            onClick={() => setSub(s)}
            style={{
              background: 'none', border: 'none', borderBottom: `2px solid ${sub === s ? ACCENT : 'transparent'}`,
              color: sub === s ? 'var(--text)' : 'var(--text-3)',
              fontSize: '.7rem', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase',
              padding: '.5rem .5rem .75rem', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {SUB_LABELS[s]}
          </button>
        ))}
      </div>

      {sub === 'library'     && allow('library')     && <ResourceLibraryPanel isDemo={isDemo} />}
      {sub === 'calculators' && allow('calculators') && <CalculatorSettingsPanel isDemo={isDemo} />}

      {available.length === 0 && (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>
          You do not have access to the resource library or the calculators.
        </div>
      )}
    </div>
  )
}
