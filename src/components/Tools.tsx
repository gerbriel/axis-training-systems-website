import { useState } from 'react'

// ── RPE percentage table (Tuchscherer) ───────────────────────────────────────
// RPE_TABLE[rpe][reps] = fraction of 1RM
const RPE_TABLE: Record<number, Record<number, number>> = {
  10: { 1: 1.000, 2: 0.955, 3: 0.922, 4: 0.892, 5: 0.863, 6: 0.837, 7: 0.811, 8: 0.786, 9: 0.762, 10: 0.739 },
   9: { 1: 0.955, 2: 0.922, 3: 0.892, 4: 0.863, 5: 0.837, 6: 0.811, 7: 0.786, 8: 0.762, 9: 0.739, 10: 0.714 },
   8: { 1: 0.922, 2: 0.892, 3: 0.863, 4: 0.837, 5: 0.811, 6: 0.786, 7: 0.762, 8: 0.739, 9: 0.714, 10: 0.688 },
   7: { 1: 0.892, 2: 0.863, 3: 0.837, 4: 0.811, 5: 0.786, 6: 0.762, 7: 0.739, 8: 0.714, 9: 0.688, 10: 0.663 },
   6: { 1: 0.863, 2: 0.837, 3: 0.811, 4: 0.786, 5: 0.762, 6: 0.739, 7: 0.714, 8: 0.688, 9: 0.663, 10: 0.637 },
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function roundToNearest(val: number, nearest: number) {
  return Math.round(val / nearest) * nearest
}
function toKg(lbs: number) { return lbs * 0.453592 }
function toLbs(kg: number) { return kg * 2.20462 }

// ── Shared input style ────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  background: '#0d0d0d',
  border: '1px solid #222',
  borderRadius: '.2rem',
  color: '#fff',
  fontSize: '.875rem',
  fontWeight: 600,
  padding: '.6rem .875rem',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}
const labelStyle: React.CSSProperties = {
  color: '#555',
  fontSize: '.6rem',
  fontWeight: 700,
  letterSpacing: '.15em',
  textTransform: 'uppercase',
  marginBottom: '.35rem',
  display: 'block',
}
const resultBox: React.CSSProperties = {
  background: 'rgba(230,62,62,.06)',
  border: '1px solid rgba(230,62,62,.2)',
  borderRadius: '.25rem',
  padding: '1.5rem',
  marginTop: '1.5rem',
}
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  cursor: 'pointer',
}

// ─────────────────────────────────────────────────────────────────────────────
// RPE CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────
function RPECalc() {
  const [mode, setMode]       = useState<'estimate' | 'prescribe'>('estimate')
  const [weight, setWeight]   = useState('')
  const [reps, setReps]       = useState('3')
  const [rpe, setRpe]         = useState('8')
  const [oneRM, setOneRM]     = useState('')
  const [targetReps, setTargetReps] = useState('3')
  const [targetRpe, setTargetRpe]   = useState('8')
  const [unit, setUnit]       = useState<'lbs' | 'kg'>('lbs')

  const rpeOptions  = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]
  const repsOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  // Estimate 1RM from weight + reps @ RPE
  function estimateFrom() {
    const w = parseFloat(weight)
    const r = parseInt(reps)
    const rpeInt = Math.round(parseFloat(rpe))
    if (isNaN(w) || isNaN(r) || w <= 0) return null
    const pct = RPE_TABLE[rpeInt]?.[r]
    if (!pct) return null
    return w / pct
  }

  // Prescribe weight from 1RM + target reps + target RPE
  function prescribeFrom() {
    const orm = parseFloat(oneRM)
    const r = parseInt(targetReps)
    const rpeInt = Math.round(parseFloat(targetRpe))
    if (isNaN(orm) || orm <= 0) return null
    const pct = RPE_TABLE[rpeInt]?.[r]
    if (!pct) return null
    return orm * pct
  }

  const estimated1RM = mode === 'estimate' ? estimateFrom() : null
  const prescribed   = mode === 'prescribe' ? prescribeFrom() : null

  const fmt = (v: number) => unit === 'lbs'
    ? `${Math.round(v)} lbs  /  ${toKg(v).toFixed(1)} kg`
    : `${(v).toFixed(1)} kg  /  ${toLbs(v).toFixed(1)} lbs`

  return (
    <div>
      <p style={{ color: '#666', fontSize: '.85rem', lineHeight: 1.7, marginBottom: '1.5rem' }}>
        Based on the Tuchscherer RPE chart used in powerlifting programming. RPE 10 = absolute max, RPE 9 = 1 rep in reserve, RPE 8 = 2 reps in reserve, etc.
      </p>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem' }}>
        {(['estimate', 'prescribe'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              background: mode === m ? '#e63e3e' : 'transparent',
              border: `1px solid ${mode === m ? '#e63e3e' : '#222'}`,
              color: mode === m ? '#fff' : '#555',
              borderRadius: '.2rem',
              padding: '.5rem 1.25rem',
              fontSize: '.65rem',
              fontWeight: 900,
              letterSpacing: '.15em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all .15s',
            }}
          >
            {m === 'estimate' ? 'Estimate 1RM' : 'Get Working Weight'}
          </button>
        ))}
      </div>

      {mode === 'estimate' ? (
        <>
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
            <div>
              <label style={labelStyle}>Weight Lifted</label>
              <input style={inputStyle} type="number" min="1" placeholder="e.g. 275" value={weight} onChange={e => setWeight(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Unit</label>
              <select style={selectStyle} value={unit} onChange={e => setUnit(e.target.value as 'lbs' | 'kg')}>
                <option value="lbs">lbs</option>
                <option value="kg">kg</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Reps Completed</label>
              <select style={selectStyle} value={reps} onChange={e => setReps(e.target.value)}>
                {repsOptions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>RPE</label>
              <select style={selectStyle} value={rpe} onChange={e => setRpe(e.target.value)}>
                {rpeOptions.map(r => <option key={r} value={r}>RPE {r}</option>)}
              </select>
            </div>
          </div>
          {estimated1RM && (
            <div style={resultBox}>
              <p style={{ color: '#888', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Estimated 1RM</p>
              <p style={{ color: '#e63e3e', fontWeight: 900, fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', letterSpacing: '-.02em' }}>{fmt(estimated1RM)}</p>
              <p style={{ color: '#444', fontSize: '.75rem', marginTop: '.75rem' }}>
                {parseInt(reps)}@RPE{rpe} = {Math.round(RPE_TABLE[Math.round(parseFloat(rpe))]?.[parseInt(reps)] * 100)}% of 1RM
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
            <div>
              <label style={labelStyle}>Your 1RM</label>
              <input style={inputStyle} type="number" min="1" placeholder="e.g. 405" value={oneRM} onChange={e => setOneRM(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Unit</label>
              <select style={selectStyle} value={unit} onChange={e => setUnit(e.target.value as 'lbs' | 'kg')}>
                <option value="lbs">lbs</option>
                <option value="kg">kg</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Target Reps</label>
              <select style={selectStyle} value={targetReps} onChange={e => setTargetReps(e.target.value)}>
                {repsOptions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Target RPE</label>
              <select style={selectStyle} value={targetRpe} onChange={e => setTargetRpe(e.target.value)}>
                {rpeOptions.map(r => <option key={r} value={r}>RPE {r}</option>)}
              </select>
            </div>
          </div>
          {prescribed && (
            <div style={resultBox}>
              <p style={{ color: '#888', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Prescribed Working Weight</p>
              <p style={{ color: '#e63e3e', fontWeight: 900, fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', letterSpacing: '-.02em' }}>
                {unit === 'lbs' ? `${Math.round(prescribed)} lbs` : `${prescribed.toFixed(1)} kg`}
              </p>
              <p style={{ color: '#444', fontSize: '.75rem', marginTop: '.75rem' }}>
                Rounded target: {unit === 'lbs'
                  ? `${roundToNearest(prescribed, 5)} lbs`
                  : `${roundToNearest(prescribed, 2.5)} kg`}
                &nbsp;·&nbsp;
                {Math.round(RPE_TABLE[Math.round(parseFloat(targetRpe))]?.[parseInt(targetReps)] * 100)}% of 1RM
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ATTEMPT PLANNER
// ─────────────────────────────────────────────────────────────────────────────
function AttemptPlanner() {
  const [unit, setUnit] = useState<'lbs' | 'kg'>('lbs')
  const [squat, setSquat]   = useState('')
  const [bench, setBench]   = useState('')
  const [dead,  setDead]    = useState('')
  const [style, setStyle]   = useState<'conservative' | 'aggressive'>('conservative')

  const profiles = {
    conservative: { open: 0.90, second: 0.96, third: 1.00 },
    aggressive:   { open: 0.91, second: 0.97, third: 1.03 },
  }

  function attempts(max: number) {
    const p = profiles[style]
    const a1 = roundToNearest(max * p.open,   unit === 'kg' ? 2.5 : 5)
    const a2 = roundToNearest(max * p.second, unit === 'kg' ? 2.5 : 5)
    const a3 = roundToNearest(max * p.third,  unit === 'kg' ? 2.5 : 5)
    return [a1, a2, a3]
  }

  const lifts: { label: string; val: string }[] = [
    { label: 'Squat', val: squat },
    { label: 'Bench', val: bench },
    { label: 'Deadlift', val: dead },
  ]

  const hasAny = [squat, bench, dead].some(v => parseFloat(v) > 0)

  const totalEstimate = [squat, bench, dead].reduce((acc, v) => {
    const n = parseFloat(v)
    return acc + (isNaN(n) ? 0 : n)
  }, 0)

  const projectedTotal = hasAny
    ? [squat, bench, dead].reduce((acc, v) => {
        const n = parseFloat(v)
        if (isNaN(n) || n <= 0) return acc
        return acc + roundToNearest(n * profiles[style].second, unit === 'kg' ? 2.5 : 5)
      }, 0)
    : 0

  return (
    <div>
      <p style={{ color: '#666', fontSize: '.85rem', lineHeight: 1.7, marginBottom: '1.5rem' }}>
        Enter your estimated max (gym or training max) for each lift. Conservative style keeps your opener very safe for guaranteed white lights; aggressive style goes for a bigger PR third.
      </p>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginBottom: '1.5rem' }}>
        <div>
          <label style={labelStyle}>Unit</label>
          <select style={selectStyle} value={unit} onChange={e => setUnit(e.target.value as 'lbs' | 'kg')}>
            <option value="lbs">lbs</option>
            <option value="kg">kg</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Strategy</label>
          <select style={selectStyle} value={style} onChange={e => setStyle(e.target.value as 'conservative' | 'aggressive')}>
            <option value="conservative">Conservative</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {[
          { label: 'Squat Max', val: squat, set: setSquat },
          { label: 'Bench Max', val: bench, set: setBench },
          { label: 'Deadlift Max', val: dead, set: setDead },
        ].map(({ label, val, set }) => (
          <div key={label}>
            <label style={labelStyle}>{label}</label>
            <input style={inputStyle} type="number" min="1" placeholder={`e.g. ${label.includes('Bench') ? '225' : '405'}`} value={val} onChange={e => set(e.target.value)} />
          </div>
        ))}
      </div>

      {hasAny && (
        <div style={{ marginTop: '1.5rem' }}>
          {lifts.map(({ label, val }) => {
            const n = parseFloat(val)
            if (isNaN(n) || n <= 0) return null
            const [a1, a2, a3] = attempts(n)
            const pcts = profiles[style]
            return (
              <div key={label} style={{ background: '#080808', border: '1px solid #1a1a1a', borderRadius: '.25rem', padding: '1.5rem', marginBottom: '1rem' }}>
                <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>{label}</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.75rem' }}>
                  {[
                    { num: 1, weight: a1, pct: Math.round(pcts.open * 100),   label: 'Opener' },
                    { num: 2, weight: a2, pct: Math.round(pcts.second * 100), label: '2nd Attempt' },
                    { num: 3, weight: a3, pct: Math.round(pcts.third * 100),  label: '3rd Attempt' },
                  ].map(att => (
                    <div key={att.num} style={{ background: '#0d0d0d', border: `1px solid ${att.num === 3 ? 'rgba(230,62,62,.3)' : '#161616'}`, borderRadius: '.2rem', padding: '1rem .875rem', textAlign: 'center' }}>
                      <p style={{ color: '#333', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.3rem' }}>{att.label}</p>
                      <p style={{ color: att.num === 3 ? '#e63e3e' : '#fff', fontWeight: 900, fontSize: '1.2rem', letterSpacing: '-.01em' }}>
                        {att.weight} <span style={{ fontSize: '.65rem', fontWeight: 600, color: '#444' }}>{unit}</span>
                      </p>
                      <p style={{ color: '#333', fontSize: '.6rem', marginTop: '.2rem' }}>{att.pct}%</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Projected total */}
          {projectedTotal > 0 && (
            <div style={{ background: 'rgba(230,62,62,.06)', border: '1px solid rgba(230,62,62,.2)', borderRadius: '.25rem', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <p style={{ color: '#555', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.2rem' }}>Training Max Total</p>
                <p style={{ color: '#888', fontSize: '.85rem', fontWeight: 600 }}>{totalEstimate} {unit}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ color: '#555', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.2rem' }}>Projected Meet Total</p>
                <p style={{ color: '#e63e3e', fontWeight: 900, fontSize: '1.5rem' }}>{projectedTotal} <span style={{ fontSize: '.75rem', fontWeight: 600, color: '#e63e3e' }}>{unit}</span></p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// WEIGHT CONVERTER
// ─────────────────────────────────────────────────────────────────────────────
function WeightConverter() {
  const [lbsVal, setLbsVal] = useState('')
  const [kgVal,  setKgVal]  = useState('')

  function handleLbs(v: string) {
    setLbsVal(v)
    const n = parseFloat(v)
    setKgVal(isNaN(n) || v === '' ? '' : (n * 0.453592).toFixed(3))
  }
  function handleKg(v: string) {
    setKgVal(v)
    const n = parseFloat(v)
    setLbsVal(isNaN(n) || v === '' ? '' : (n * 2.20462).toFixed(3))
  }

  // Common plate / barbell reference weights
  const barWeights = [
    { lbs: 45, kg: 20,    label: 'Standard barbell' },
    { lbs: 55, kg: 25,    label: 'Women\'s barbell' },
    { lbs: 33, kg: 15,    label: 'Technique bar' },
  ]
  const plates = [
    { lbs: 100, kg: 45, label: '100 lb / 45 kg plate' },
    { lbs:  55, kg: 25, label: '55 lb / 25 kg plate' },
    { lbs:  45, kg: 20, label: '45 lb / 20 kg plate' },
    { lbs:  35, kg: 15, label: '35 lb / 15 kg plate' },
    { lbs:  25, kg: 11, label: '25 lb / 10 kg plate' },
    { lbs:  10, kg: 5,  label: '10 lb / 5 kg plate' },
    { lbs:   5, kg: 2.5,label: '5 lb / 2.5 kg plate' },
    { lbs: 2.5, kg: 1.25, label: '2.5 lb / 1.25 kg plate' },
  ]

  return (
    <div>
      <p style={{ color: '#666', fontSize: '.85rem', lineHeight: 1.7, marginBottom: '1.5rem' }}>
        Type in either field to instantly convert. All other tools accept both units.
      </p>

      {/* Converter inputs */}
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
        <div>
          <label style={labelStyle}>Pounds (lbs)</label>
          <input
            style={{ ...inputStyle, fontSize: '1.1rem' }}
            type="number"
            min="0"
            step="any"
            placeholder="0"
            value={lbsVal}
            onChange={e => handleLbs(e.target.value)}
          />
        </div>
        <div style={{ textAlign: 'center', paddingTop: '1.4rem' }}>
          <span style={{ color: '#e63e3e', fontWeight: 900, fontSize: '1.25rem' }}>⇄</span>
        </div>
        <div>
          <label style={labelStyle}>Kilograms (kg)</label>
          <input
            style={{ ...inputStyle, fontSize: '1.1rem' }}
            type="number"
            min="0"
            step="any"
            placeholder="0"
            value={kgVal}
            onChange={e => handleKg(e.target.value)}
          />
        </div>
      </div>

      {/* Quick conversions */}
      <div style={{ marginTop: '2rem' }}>
        <p style={{ color: '#333', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Common Barbell Weights</p>
        <div style={{ display: 'grid', gap: '.5rem', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {[...barWeights, ...plates].map(({ lbs, kg, label }) => (
            <button
              key={label}
              onClick={() => handleLbs(String(lbs))}
              style={{
                background: '#0d0d0d',
                border: '1px solid #1a1a1a',
                borderRadius: '.2rem',
                padding: '.6rem .875rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                transition: 'border-color .15s',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#e63e3e'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#1a1a1a'}
            >
              <span style={{ color: '#666', fontSize: '.7rem' }}>{label}</span>
              <span style={{ color: '#ccc', fontSize: '.75rem', fontWeight: 700 }}>{lbs} lbs · {kg} kg</span>
            </button>
          ))}
        </div>
      </div>

      {/* Quick reference formulas */}
      <div style={{ marginTop: '1.5rem', background: '#0a0a0a', border: '1px solid #141414', borderRadius: '.25rem', padding: '1.25rem' }}>
        <p style={{ color: '#333', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Quick Reference</p>
        <div style={{ display: 'grid', gap: '.4rem' }}>
          {[
            ['1 lb', '0.4536 kg'],
            ['1 kg', '2.2046 lbs'],
            ['100 lbs', '45.36 kg'],
            ['100 kg', '220.46 lbs'],
            ['500 lbs', '226.8 kg'],
            ['600 lbs', '272.2 kg'],
            ['700 lbs', '317.5 kg'],
            ['800 lbs', '362.9 kg'],
          ].map(([l, r]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '.3rem 0', borderBottom: '1px solid #111' }}>
              <span style={{ color: '#555', fontSize: '.8rem' }}>{l}</span>
              <span style={{ color: '#888', fontSize: '.8rem', fontWeight: 600 }}>{r}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SECTION
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'rpe',       label: 'RPE Calculator',  short: 'RPE' },
  { id: 'attempts',  label: 'Attempt Planner', short: 'Attempts' },
  { id: 'convert',   label: 'Weight Converter',short: 'Convert' },
] as const

type TabId = typeof TABS[number]['id']

export default function Tools() {
  const [active, setActive] = useState<TabId>('rpe')

  return (
    <section id="tools" style={{ padding: '6rem 2rem', background: '#050505', borderTop: '1px solid #0d0d0d' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '3rem' }}>
          <p style={{ color: '#e63e3e', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.6rem' }}>Free Tools</p>
          <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(2rem, 5vw, 3.5rem)', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: .95 }}>
            Powerlifting<br />Calculators
          </h2>
          <p style={{ color: '#444', fontSize: '.85rem', marginTop: '1rem', maxWidth: 480 }}>
            Calculate your estimated max, plan training loads, set up meet attempts, and convert between lbs and kg — all in one place.
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '2rem', borderBottom: '1px solid #141414', paddingBottom: '0' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active === tab.id ? '#e63e3e' : 'transparent'}`,
                color: active === tab.id ? '#fff' : '#444',
                fontSize: '.7rem',
                fontWeight: 900,
                letterSpacing: '.15em',
                textTransform: 'uppercase',
                padding: '.75rem 1.25rem',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'color .15s',
                marginBottom: '-1px',
              }}
              onMouseEnter={e => { if (active !== tab.id) e.currentTarget.style.color = '#888' }}
              onMouseLeave={e => { if (active !== tab.id) e.currentTarget.style.color = '#444' }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Panel */}
        <div style={{ background: '#080808', border: '1px solid #141414', borderRadius: '.25rem', padding: '2rem' }}>
          {active === 'rpe'      && <RPECalc />}
          {active === 'attempts' && <AttemptPlanner />}
          {active === 'convert'  && <WeightConverter />}
        </div>
      </div>
    </section>
  )
}
