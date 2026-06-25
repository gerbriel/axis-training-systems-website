import type { Lead, LeadStatus } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { useState } from 'react'

const STATUS_COLORS: Record<LeadStatus, string> = {
  new:      '#c8102e',
  reviewed: '#f5b935',
  accepted: '#22c55e',
  declined: 'var(--text-4)',
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', gap: '1rem', padding: '.6rem 0', borderBottom: '1px solid var(--surface)', fontSize: '.85rem' }}>
      <span style={{ minWidth: '10rem', color: 'var(--text-2)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--chalk)', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

function SectionHead({ label }: { label: string }) {
  return (
    <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', margin: '1.75rem 0 .5rem' }}>{label}</p>
  )
}

interface Props {
  lead: Lead
  onClose: () => void
  onUpdate: (lead: Lead) => void
  isDemo?: boolean
}

export default function LeadDetail({ lead, onClose, onUpdate, isDemo = false }: Props) {
  const [status, setStatus] = useState<LeadStatus>(lead.status)
  const [notes, setNotes] = useState(lead.admin_notes ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    if (isDemo) {
      await new Promise(r => setTimeout(r, 600)) // simulate latency
      const updated: Lead = { ...lead, status, admin_notes: notes }
      onUpdate(updated)
    } else {
      const { data, error } = await supabase
        .from('leads')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ status, admin_notes: notes } as any)
        .eq('id', lead.id)
        .select()
        .single()
      if (!error && data) onUpdate(data as Lead)
    }
    setSaving(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      style={{ background: 'var(--modal-overlay)', backdropFilter: 'blur(4px)', padding: '2rem 1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full relative" style={{ maxWidth: 680, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '2.5rem' }}>
        {/* Close */}
        <button onClick={onClose} style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer', padding: '.25rem' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-2" style={{ paddingRight: '2rem' }}>
          <div>
            <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.5rem', letterSpacing: '-.02em' }}>
              {lead.first_name} {lead.last_name}
            </h2>
            <p style={{ color: 'var(--text-2)', fontSize: '.8rem', marginTop: '.25rem' }}>
              {lead.email} · {new Date(lead.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <span style={{ background: STATUS_COLORS[lead.status] + '22', border: `1px solid ${STATUS_COLORS[lead.status]}`, color: STATUS_COLORS[lead.status], fontSize: '.65rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', padding: '.25rem .75rem', borderRadius: '.25rem', flexShrink: 0 }}>
            {lead.status}
          </span>
        </div>

        {/* Data */}
        <SectionHead label="Service" />
        <Row label="Service" value={lead.service} />
        <Row label="Coach Preference" value={lead.coach_pref} />
        <Row label="Instagram / Facebook" value={lead.social} />

        <SectionHead label="Physical Profile" />
        <Row label="Age" value={lead.age} />
        <Row label="Height" value={lead.height} />
        <Row label="Body Weight" value={lead.body_weight} />
        <Row label="Weight Class" value={lead.weight_class} />
        <Row label="Experience" value={lead.experience} />
        <Row label="Injuries" value={lead.injuries} />
        <Row label="Training Days" value={lead.train_days} />
        <Row label="Occupation" value={lead.occupation} />

        <SectionHead label="Training Data" />
        <Row label="Squat Max" value={lead.squat_max} />
        <Row label="Bench Max" value={lead.bench_max} />
        <Row label="Deadlift Max" value={lead.dead_max} />
        <Row label="Squat Frequency" value={lead.squat_freq} />
        <Row label="Bench Frequency" value={lead.bench_freq} />
        <Row label="Deadlift Frequency" value={lead.dead_freq} />
        <Row label="Current Program" value={lead.current_program} />
        <Row label="Squat Style" value={lead.squat_style} />
        <Row label="Bench Style" value={lead.bench_style} />
        <Row label="Deadlift Style" value={lead.dead_style} />

        <SectionHead label="Lifestyle & Recovery" />
        <Row label="Weak Points" value={lead.weak_points} />
        <Row label="Learning Style" value={lead.learning_style} />
        <Row label="Sleep (hrs)" value={lead.sleep} />
        <Row label="Nutrition / Hydration" value={lead.nutrition ? `${lead.nutrition}/10` : null} />
        <Row label="Life Stress" value={lead.stress ? `${lead.stress}/10` : null} />
        <Row label="Overall Recovery" value={lead.recovery ? `${lead.recovery}/10` : null} />

        <SectionHead label="Goals" />
        <Row label="Expectations" value={lead.expectations} />
        <Row label="Further Goals" value={lead.goals} />

        {/* Admin controls */}
        <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase' }}>Admin</p>

          <div>
            <label className="field-label">Status</label>
            <select className="field" value={status} onChange={e => setStatus(e.target.value as LeadStatus)}>
              <option value="new">New</option>
              <option value="reviewed">Reviewed</option>
              <option value="accepted">Accepted</option>
              <option value="declined">Declined</option>
            </select>
          </div>

          <div>
            <label className="field-label">Admin Notes</label>
            <textarea className="field" rows={3} placeholder="Internal notes…" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <button
            onClick={save} disabled={saving}
            style={{ background: saving ? '#5c0e14' : '#c8102e', border: 'none', color: 'var(--text)', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', padding: '.875rem', borderRadius: '.25rem', cursor: 'pointer' }}
            onMouseEnter={e => { if (!saving) e.currentTarget.style.background = '#9a7c3a' }}
            onMouseLeave={e => { if (!saving) e.currentTarget.style.background = '#bfa162' }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          {isDemo && (
            <p style={{ color: '#5c4800', fontSize: '.7rem', textAlign: 'center' }}>
              Demo mode — changes apply to local state only.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
