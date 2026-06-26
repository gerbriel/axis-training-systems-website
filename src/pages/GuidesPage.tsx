import { useState, useEffect, useCallback } from 'react'
import { href } from '../utils/nav'
import { subscribeNewsletter, getNewsletterAccess } from '../lib/newsletterApi'
import type { NewsletterAccess } from '../types/newsletter'
import { TOOL_LIST } from './ToolPage'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

// ── Shared styles ────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.2rem',
  color: 'var(--text)', fontSize: '.875rem', fontWeight: 500, padding: '.65rem .875rem',
  outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
}
const lbl: React.CSSProperties = {
  color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em',
  textTransform: 'uppercase', marginBottom: '.35rem', display: 'block',
}
const sectionLabel: React.CSSProperties = {
  color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em',
  textTransform: 'uppercase', marginBottom: '.5rem', display: 'block',
}
const heading: React.CSSProperties = {
  color: 'var(--text)', fontWeight: 900, fontSize: '1.1rem', textTransform: 'uppercase',
  letterSpacing: '-.01em', marginBottom: '.6rem',
}
const listItem = (idx: number) => ({
  display: 'flex', gap: '.75rem', color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.75,
  padding: '.35rem 0', borderBottom: idx > 0 ? '1px solid var(--surface-2)' : 'none',
} as React.CSSProperties)

// ─────────────────────────────────────────────────────────────────────────────
// 1. MEET DAY CHECKLIST
// ─────────────────────────────────────────────────────────────────────────────

const CHECKLIST_SECTIONS = [
  {
    label: 'Night Before',
    items: [
      'Pack your gear bag completely — don\'t leave anything for morning',
      'Confirm weigh-in time and location',
      'Eat the same foods you eat on training days — no experiments',
      'Prepare meet day meals and snacks (bring more than you think you need)',
      'Lay out your singlet, belt, shoes, wraps/sleeves, and lifting shoes',
      'Set two alarms — one for wake-up, one as backup',
      'Aim for 8+ hours of sleep; accept that nerves are normal',
    ],
  },
  {
    label: 'Gear Bag Essentials',
    items: [
      'Singlet (IPF/federation legal)',
      'Belt',
      'Knee sleeves or wraps',
      'Wrist wraps',
      'Squat shoes and deadlift shoes (or socks)',
      'Chalk (if allowed)',
      'Extra socks and underwear',
      'Ammonia (if used)',
      'Energy snacks: rice cakes, bananas, gummy bears, Bobo\'s, etc.',
      'Electrolyte drinks and plain water',
      'Pre-workout or caffeine source (match your training dose)',
      'Recovery tools: foam roller, lacrosse ball',
      'Headphones / playlist',
      'Printed attempts card (backup to the handler\'s copy)',
    ],
  },
  {
    label: 'Weigh-In',
    items: [
      'Arrive early — rush and stress kill your warm-up',
      'Eat and rehydrate immediately after weigh-in',
      'If cutting water: 2 hrs minimum to rehydrate before first attempt',
      'Confirm your opening attempts with your handler before rack height setup',
      'Register equipment (belt, sleeves, wraps) with the expeditor',
    ],
  },
  {
    label: 'Warm-Up Room',
    items: [
      'Start warm-ups 45–60 minutes before your first flight',
      'Attempt 1 should feel like a warm-up — an easy single',
      'Don\'t go to failure in warm-ups — leave something for the platform',
      'Warm-up timing: your last warm-up bar should land ~5–8 min before your first attempt',
      'Your handler manages timing — trust them and stop watching the scoreboard',
      'Communicate RPE of every warm-up set to your handler',
    ],
  },
  {
    label: 'Between Attempts & Lifts',
    items: [
      'Eat fast carbs between lifts (gummies, bananas, rice cakes)',
      'Sip water or electrolytes constantly — don\'t wait until you\'re thirsty',
      'Review your next attempt with your handler before it\'s called in',
      'Avoid social media and distractions between flights',
      'Keep warm: movement, light stretching, stay loose',
      'Trust your handler\'s attempt calls — they have the big picture',
    ],
  },
]

function MeetDayChecklist() {
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const toggle = (key: string) =>
    setChecked(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const total   = CHECKLIST_SECTIONS.reduce((a, s) => a + s.items.length, 0)
  const doneCount = checked.size
  const pct = Math.round((doneCount / total) * 100)

  return (
    <div>
      {/* Progress bar */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.5rem' }}>
          <span style={{ color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>Progress</span>
          <span style={{ color: pct === 100 ? '#22c55e' : '#c8102e', fontSize: '.65rem', fontWeight: 900 }}>{doneCount}/{total}</span>
        </div>
        <div style={{ height: 4, background: 'var(--surface)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#22c55e' : '#c8102e', transition: 'width .3s' }} />
        </div>
      </div>

      {CHECKLIST_SECTIONS.map(section => (
        <div key={section.label} style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase', marginBottom: '.75rem' }}>{section.label}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--surface)', borderRadius: '.25rem', overflow: 'hidden' }}>
            {section.items.map(item => {
              const key = `${section.label}::${item}`
              const done = checked.has(key)
              return (
                <button
                  key={item}
                  onClick={() => toggle(key)}
                  style={{
                    display: 'flex', gap: '.875rem', alignItems: 'flex-start',
                    padding: '.875rem 1rem', background: done ? 'rgba(34,197,94,.04)' : 'transparent',
                    border: 'none', borderBottom: '1px solid var(--surface-2)', cursor: 'pointer',
                    textAlign: 'left', width: '100%', fontFamily: 'inherit',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => { if (!done) e.currentTarget.style.background = 'var(--bg)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = done ? 'rgba(34,197,94,.04)' : 'transparent' }}
                >
                  <span style={{
                    width: 18, height: 18, borderRadius: '.2rem', flexShrink: 0, marginTop: 1,
                    border: `1.5px solid ${done ? '#22c55e' : 'var(--border)'}`,
                    background: done ? '#22c55e' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all .1s',
                  }}>
                    {done && <span style={{ color: '#000', fontSize: 11, fontWeight: 900 }}>✓</span>}
                  </span>
                  <span style={{ color: done ? 'var(--text-dim)' : 'var(--text-4)', fontSize: '.85rem', lineHeight: 1.6, textDecoration: done ? 'line-through' : 'none', transition: 'color .1s' }}>
                    {item}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ATTEMPT SELECTION CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────

function round5(n: number) { return Math.round(n / 5) * 5 }
function round2_5(n: number) { return Math.round(n / 2.5) * 2.5 }

function AttemptCalcGuide() {
  const [unit, setUnit]   = useState<'lbs' | 'kg'>('lbs')
  const [squat, setSquat] = useState('')
  const [bench, setBench] = useState('')
  const [dead,  setDead]  = useState('')
  const [style, setStyle] = useState<'conservative' | 'aggressive'>('conservative')

  const profiles = {
    conservative: { open: 0.90, second: 0.96, third: 1.00 },
    aggressive:   { open: 0.91, second: 0.97, third: 1.03 },
  }

  function conv(v: string, factor: number) {
    const n = parseFloat(v)
    return isNaN(n) || v === '' ? '' : String(parseFloat((n * factor).toFixed(2)))
  }
  function switchUnit(next: 'lbs' | 'kg') {
    const f = next === 'kg' ? 0.453592 : 2.20462
    setSquat(s => conv(s, f)); setBench(b => conv(b, f)); setDead(d => conv(d, f))
    setUnit(next)
  }

  function attempts(maxStr: string) {
    const max = parseFloat(maxStr)
    if (isNaN(max) || max <= 0) return null
    const p = profiles[style]
    const r = unit === 'kg' ? round2_5 : round5
    return [r(max * p.open), r(max * p.second), r(max * p.third)]
  }

  const lifts = [
    { label: 'Squat',    val: squat, set: setSquat },
    { label: 'Bench',    val: bench, set: setBench },
    { label: 'Deadlift', val: dead,  set: setDead  },
  ]
  const hasAny = lifts.some(l => parseFloat(l.val) > 0)
  const p = profiles[style]

  const projectedTotal = lifts.reduce((acc, l) => {
    const n = parseFloat(l.val)
    if (isNaN(n) || n <= 0) return acc
    return acc + (unit === 'kg' ? round2_5 : round5)(n * p.second)
  }, 0)

  return (
    <div>
      <p style={{ color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.75, marginBottom: '1.5rem' }}>
        Enter your training max for each lift (the heaviest single you're confident you could hit on a good day). Conservative keeps your opener very safe; aggressive goes for a bigger PR third.
      </p>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginBottom: '1.5rem' }}>
        {[
          { label: 'Unit', el: <select style={{ ...inp, appearance: 'none', cursor: 'pointer' }} value={unit} onChange={e => switchUnit(e.target.value as 'lbs' | 'kg')}><option value="lbs">lbs</option><option value="kg">kg</option></select> },
          { label: 'Strategy', el: <select style={{ ...inp, appearance: 'none', cursor: 'pointer' }} value={style} onChange={e => setStyle(e.target.value as 'conservative' | 'aggressive')}><option value="conservative">Conservative</option><option value="aggressive">Aggressive</option></select> },
        ].map(({ label, el }) => (
          <div key={label}><label style={lbl}>{label}</label>{el}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: '1.5rem' }}>
        {lifts.map(({ label, val, set }) => (
          <div key={label}>
            <label style={lbl}>{label} Training Max</label>
            <input style={inp} type="number" min="1" placeholder={`e.g. ${label === 'Bench' ? '225' : '405'}`} value={val} onChange={e => set(e.target.value)} />
          </div>
        ))}
      </div>

      {hasAny && (
        <div>
          {lifts.map(({ label, val }) => {
            const atts = attempts(val)
            if (!atts) return null
            const [a1, a2, a3] = atts
            return (
              <div key={label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.25rem', padding: '1.5rem', marginBottom: '1rem' }}>
                <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>{label}</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.75rem' }}>
                  {[
                    { num: 1, w: a1, pct: Math.round(p.open   * 100), label: 'Opener'      },
                    { num: 2, w: a2, pct: Math.round(p.second * 100), label: '2nd Attempt' },
                    { num: 3, w: a3, pct: Math.round(p.third  * 100), label: '3rd Attempt' },
                  ].map(att => (
                    <div key={att.num} style={{ background: 'var(--surface-2)', border: `1px solid ${att.num === 3 ? 'rgba(39,44,132,.3)' : 'var(--surface)'}`, borderRadius: '.2rem', padding: '1rem .875rem', textAlign: 'center' }}>
                      <p style={{ color: 'var(--text-3)', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.3rem' }}>{att.label}</p>
                      <p style={{ color: att.num === 3 ? '#c8102e' : 'var(--text)', fontWeight: 900, fontSize: '1.2rem' }}>
                        {att.w} <span style={{ fontSize: '.65rem', fontWeight: 600, color: 'var(--text-2)' }}>{unit}</span>
                      </p>
                      <p style={{ color: 'var(--text-3)', fontSize: '.6rem', marginTop: '.2rem' }}>{att.pct}%</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {projectedTotal > 0 && (
            <div style={{ background: 'rgba(39,44,132,.06)', border: '1px solid rgba(39,44,132,.2)', borderRadius: '.25rem', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <span style={{ color: 'var(--text-2)', fontSize: '.75rem', fontWeight: 600 }}>Projected Meet Total (2nd attempts)</span>
              <span style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.5rem' }}>{projectedTotal} <span style={{ fontSize: '.7rem' }}>{unit}</span></span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TRAINING QUIZ
// ─────────────────────────────────────────────────────────────────────────────

const QUIZ_QUESTIONS = [
  {
    q: 'How is your training structured?',
    options: [
      'I don\'t really plan ahead — I just train',
      'I follow a template or program I found online',
      'Periodized with planned phases, goals, and deloads',
    ],
  },
  {
    q: 'Do you track your training volume week to week?',
    options: [
      'No — I don\'t track sets and reps historically',
      'Sometimes — I look back occasionally',
      'Yes — I track and adjust based on trends',
    ],
  },
  {
    q: 'How do you manage intensity in training?',
    options: [
      'I go as heavy as I feel like that day',
      'I follow prescribed weights without much thought',
      'I use RPE or percentages with intentional progression',
    ],
  },
  {
    q: 'How many nights per week do you get 7+ hours of sleep?',
    options: [
      '0–2 nights',
      '3–4 nights',
      '5–7 nights',
    ],
  },
  {
    q: 'How often do you review technique video of your lifts?',
    options: [
      'Never — I don\'t film myself',
      'Occasionally, when something feels off',
      'Regularly — I analyze video weekly or every session',
    ],
  },
  {
    q: 'How do you handle accumulated fatigue?',
    options: [
      'I train through it until I burn out or get hurt',
      'I take a week off when I feel terrible',
      'I plan deloads every 4–6 weeks regardless of how I feel',
    ],
  },
]

const QUIZ_TIERS = [
  { min: 0,  max: 4,  label: 'Leaving Major Gains Behind',  color: 'var(--text)', summary: 'Your training lacks the structure and intentionality needed to get the most out of your time under the bar. The good news: this is fixable fast. A coach can double your progress rate by addressing the root issues.' },
  { min: 5,  max: 8,  label: 'Solid Base, Room to Optimize', color: 'var(--text)', summary: 'You\'re doing the work, but there are clear gaps in structure, recovery, or intensity management that are limiting your ceiling. Closing those gaps is the difference between average progress and competitive results.' },
  { min: 9,  max: 12, label: 'Well-Optimized Athlete',       color: '#22c55e', summary: 'Your process is strong. At this level, the next gains come from personalized periodization, technique refinement, and meet-specific coaching — the exact things a dedicated coach provides.' },
]

function TrainingQuiz() {
  const [answers,  setAnswers]  = useState<number[]>([])
  const [current,  setCurrent]  = useState(0)
  const [complete, setComplete] = useState(false)

  const score = answers.reduce((a, v) => a + v, 0)
  const tier  = QUIZ_TIERS.find(t => score >= t.min && score <= t.max) ?? QUIZ_TIERS[0]

  function answer(val: number) {
    const next = [...answers, val]
    setAnswers(next)
    if (current < QUIZ_QUESTIONS.length - 1) {
      setCurrent(c => c + 1)
    } else {
      setComplete(true)
    }
  }

  function reset() { setAnswers([]); setCurrent(0); setComplete(false) }

  if (complete) {
    return (
      <div>
        <div style={{ background: 'var(--bg)', border: `1px solid ${tier.color}33`, borderRadius: '.25rem', padding: '2rem', marginBottom: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Your Score</p>
          <p style={{ color: tier.color, fontWeight: 900, fontSize: '3rem', lineHeight: 1, marginBottom: '.25rem' }}>{score}<span style={{ fontSize: '1.5rem', color: 'var(--text-3)' }}>/12</span></p>
          <p style={{ color: tier.color, fontWeight: 900, fontSize: '.8rem', letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '1.25rem' }}>{tier.label}</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.9rem', lineHeight: 1.75, maxWidth: 500, margin: '0 auto' }}>{tier.summary}</p>
        </div>
        {/* Per-question breakdown */}
        <div style={{ marginBottom: '1.5rem' }}>
          {QUIZ_QUESTIONS.map((q, i) => (
            <div key={i} style={{ padding: '.875rem 0', borderBottom: '1px solid var(--surface-2)' }}>
              <p style={{ color: 'var(--text-2)', fontSize: '.75rem', marginBottom: '.3rem' }}>{q.q}</p>
              <p style={{ color: answers[i] === 2 ? '#22c55e' : answers[i] === 1 ? 'var(--text)' : '#c8102e', fontWeight: 700, fontSize: '.8rem' }}>
                {q.options[answers[i]]} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>({answers[i]}/2)</span>
              </p>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <a
            href={href('/#coaches')}
            style={{ display: 'inline-block', background: '#272C84', color: '#ffffff', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.2em', textTransform: 'uppercase', padding: '.75rem 1.5rem', borderRadius: '.2rem', textDecoration: 'none', transition: 'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = '#1a1f6b'}
            onMouseLeave={e => e.currentTarget.style.background = '#272C84'}
          >
            Work With a Coach →
          </a>
          <button
            onClick={reset}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.75rem 1.25rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-dim)'; e.currentTarget.style.color = 'var(--text-3)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
          >
            Retake
          </button>
        </div>
      </div>
    )
  }

  const q = QUIZ_QUESTIONS[current]
  return (
    <div>
      {/* Progress */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.5rem' }}>
          <span style={{ color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>Question {current + 1} of {QUIZ_QUESTIONS.length}</span>
          <span style={{ color: 'var(--text-3)', fontSize: '.65rem' }}>{Math.round((current / QUIZ_QUESTIONS.length) * 100)}%</span>
        </div>
        <div style={{ height: 3, background: 'var(--surface)', borderRadius: 2 }}>
          <div style={{ height: '100%', width: `${(current / QUIZ_QUESTIONS.length) * 100}%`, background: '#272C84', transition: 'width .3s' }} />
        </div>
      </div>

      <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '1rem', lineHeight: 1.55, marginBottom: '1.5rem' }}>{q.q}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {q.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => answer(i)}
            style={{ textAlign: 'left', background: 'transparent', border: '1px solid var(--border)', borderRadius: '.25rem', color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.6, padding: '.875rem 1rem', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#272C84'; e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'rgba(39,44,132,.05)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.background = 'transparent' }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. RPE GUIDE
// ─────────────────────────────────────────────────────────────────────────────

const RPE_ROWS = [
  { rpe: '6',   reps: '4+',  desc: 'Comfortable. You could rep this many more times. Used for warm-ups, technique work, or very high volume. Doesn\'t feel like training.' },
  { rpe: '7',   reps: '3',   desc: 'Working hard but clearly could do more. Good for building work capacity. A common target for volume blocks. Breathing gets elevated.' },
  { rpe: '7.5', reps: '2–3', desc: 'Between RPE 7 and 8. Two reps clearly available, third is possible. Useful for moderate accumulation. A transition zone.' },
  { rpe: '8',   reps: '2',   desc: 'Hard. You could get two more reps if you had to. Common target for intensification blocks. This is where most meet-prep work lives.' },
  { rpe: '8.5', reps: '1–2', desc: 'One rep definitely left, a second is possible but uncertain. A daily max for many athletes. Harder to recover from than RPE 8.' },
  { rpe: '9',   reps: '1',   desc: 'One rep left in the tank. Very demanding. Use sparingly — a common target for peak week attempts to simulate meet conditions.' },
  { rpe: '9.5', reps: '0–1', desc: 'You might have gotten one more but aren\'t sure. Common after a hard daily max. Feels close to max effort but you didn\'t fully go there.' },
  { rpe: '10',  reps: '0',   desc: 'Absolute maximum — couldn\'t have gotten another rep. Reserve this for meet openers (intentionally conservative) or true 1RM tests.' },
]

function RPEGuide() {
  return (
    <div>
      <p style={{ color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.75, marginBottom: '1.75rem' }}>
        RPE (Rate of Perceived Exertion) is a scale from 1–10 that describes how hard a set felt relative to your maximum. In powerlifting, we typically work in the RPE 6–10 range. The key insight: <strong style={{ color: 'var(--chalk)' }}>RPE is about reps remaining, not how tired you feel.</strong>
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--surface)', borderRadius: '.25rem', overflow: 'hidden', marginBottom: '1.5rem' }}>
        {RPE_ROWS.map((row, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 90px 1fr', gap: '1rem', alignItems: 'start', padding: '1rem 1.25rem', background: 'var(--bg)' }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', lineHeight: 1 }}>{row.rpe}</p>
              <p style={{ color: 'var(--text-3)', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginTop: '.2rem' }}>RPE</p>
            </div>
            <div>
              <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.8rem' }}>{row.reps} reps</p>
              <p style={{ color: 'var(--text-3)', fontSize: '.65rem', marginTop: '.15rem' }}>left</p>
            </div>
            <p style={{ color: 'var(--text-2)', fontSize: '.85rem', lineHeight: 1.7 }}>{row.desc}</p>
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--bg)', border: '1px solid rgba(39,44,132,.2)', borderLeft: '3px solid #272C84', borderRadius: '.2rem', padding: '1.25rem 1.5rem' }}>
        <p style={{ color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.75 }}>
          <strong style={{ color: 'var(--chalk)' }}>Beginner tip:</strong> If you're new to RPE, film your sets. Watch the bar speed — a fast bar is low RPE, a grinding, slow bar is RPE 9+. Over time, the calibration becomes instinctual. Most coaches recommend training primarily at RPE 7–8 for volume work, and 8.5–9 for peak/heavy work.
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. BEGINNER'S GUIDE TO THE BIG THREE
// ─────────────────────────────────────────────────────────────────────────────

const BIG_THREE = {
  squat: {
    label: 'Squat',
    setup: ['Bar over mid-foot (1–2 inches from shins for high bar)', 'High bar: on traps / Low bar: rear delt shelf', 'Brace hard before unracking — 360° of pressure', 'Walk out: step back, feet just outside hip width, toes pointed out 30–45°'],
    descent: ['Big breath and brace before descent', 'Push knees out in the direction of toes throughout', 'Break at the hips and knees simultaneously', 'Aim for depth just past parallel (crease of hip below top of knee)'],
    ascent:  ['Drive the floor apart — don\'t let knees cave', 'Lead with the chest on the way up, not the hips', 'Maintain the brace all the way through lockout', 'Squeeze glutes at the top before stepping forward'],
    mistakes: ['Knees caving on the ascent (valgus collapse)', 'Good morning squat — hips rise faster than chest', 'Losing upper back tightness at the bottom', 'Incomplete depth — the lift won\'t count in competition'],
  },
  bench: {
    label: 'Bench Press',
    setup: ['Eyes under the bar — wrists directly below the bar at setup', 'Retract and depress scapulae — pull shoulder blades down and together', 'Arch position: drive chest up, maintain contact with the bench', 'Foot position: flat on floor or on toes — build leg drive'],
    descent: ['Control the descent — don\'t crash the bar', 'Tuck the elbows slightly (45–60° from torso)', 'Touch the lower chest / upper abs (not the neck)', 'Pause briefly on touch — don\'t bounce the bar off your chest'],
    ascent:  ['Drive the bar back toward your face as you press (bar path should arc)', 'Push your body away from the bar — think "push the bench away"', 'Drive your feet into the floor to generate leg drive', 'Maintain scapular position through the entire rep'],
    mistakes: ['Flared elbows — increases anterior shoulder stress', 'Losing back tightness during the press', 'Lifting the butt off the bench to use leg drive', 'Touching too high (on the sternum instead of lower chest)'],
  },
  deadlift: {
    label: 'Deadlift',
    setup: ['Bar over mid-foot (1 inch from shins)', 'Push your hips back until your shins touch the bar', 'Chest up, back flat — eliminate any rounding in the lower back', 'Grip: double overhand to start, switch to mixed or hook when needed'],
    lift:    ['Push the floor away — don\'t think "pull up", think "push down"', 'Bar stays in contact with the legs the entire way up', 'Hips and shoulders rise at the same rate off the floor', 'Once past the knee, drive your hips through and stand tall'],
    lockout: ['Lock out hips and knees simultaneously', 'Don\'t hyperextend the lower back at the top', 'Lower the bar with control — don\'t drop unless on bumpers', 'Reset position fully before your next rep'],
    mistakes: ['Bar drifting away from the body (increases leverage demands)', 'Jerking the bar off the floor — the pull should be a smooth acceleration', 'Rounding the lower back off the floor', 'Looking up — keep a neutral neck, not extended'],
  },
}

type LiftTab = 'squat' | 'bench' | 'deadlift'

function BigThreeGuide() {
  const [tab, setTab] = useState<LiftTab>('squat')
  const data = BIG_THREE[tab]

  const phases = tab === 'deadlift'
    ? [{ label: 'Setup', items: data.setup }, { label: 'Off the Floor', items: (data as typeof BIG_THREE.deadlift).lift }, { label: 'Lockout', items: (data as typeof BIG_THREE.deadlift).lockout }]
    : [{ label: 'Setup', items: data.setup }, { label: tab === 'squat' ? 'Descent' : 'Descent / Touch', items: (data as typeof BIG_THREE.squat).descent }, { label: 'Ascent / Press', items: (data as typeof BIG_THREE.squat).ascent }]

  return (
    <div>
      {/* Lift tabs */}
      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '1.75rem', borderBottom: '1px solid var(--surface)', paddingBottom: 0 }}>
        {(['squat', 'bench', 'deadlift'] as LiftTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t ? '#272C84' : 'transparent'}`, color: tab === t ? 'var(--text)' : 'var(--text-dim)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.75rem 1.25rem', cursor: 'pointer', fontFamily: 'inherit', marginBottom: '-1px', transition: 'color .15s' }}
            onMouseEnter={e => { if (tab !== t) e.currentTarget.style.color = 'var(--text-3)' }}
            onMouseLeave={e => { if (tab !== t) e.currentTarget.style.color = 'var(--text-2)' }}
          >
            {BIG_THREE[t].label}
          </button>
        ))}
      </div>

      {/* Phases */}
      <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
        {phases.map(phase => (
          <div key={phase.label} style={{ background: 'var(--bg)', border: '1px solid var(--surface)', borderRadius: '.25rem', padding: '1.25rem 1.5rem' }}>
            <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.875rem' }}>{phase.label}</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {phase.items.map((item, i) => (
                <li key={i} style={{ display: 'flex', gap: '.75rem', color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.65 }}>
                  <span style={{ color: 'var(--text)', flexShrink: 0, marginTop: '.3rem' }}>·</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Common mistakes */}
      <div style={{ background: 'rgba(39,44,132,.05)', border: '1px solid rgba(39,44,132,.15)', borderRadius: '.25rem', padding: '1.25rem 1.5rem' }}>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.875rem' }}>Common Mistakes</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {data.mistakes.map((m, i) => (
            <li key={i} style={{ display: 'flex', gap: '.75rem', color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.65 }}>
              <span style={{ color: 'var(--text)', flexShrink: 0, marginTop: '.35rem', fontWeight: 900 }}>✕</span>
              {m}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. TRAINING BLOCK AUDIT WORKSHEET
// ─────────────────────────────────────────────────────────────────────────────

const AUDIT_CATEGORIES = [
  {
    name: 'Volume Management',
    question: 'Did you progressively increase total sets/reps over the block, and did you know what your volume was week to week?',
    options: ['I had no idea what my volume was', 'I tracked it roughly but didn\'t adjust', 'I tracked, adjusted, and progressed intentionally'],
  },
  {
    name: 'Intensity Progression',
    question: 'Did the weights go up in a planned, structured way — not just whenever you felt good?',
    options: ['I lifted heavy when I felt like it, light when I didn\'t', 'I followed percentages or RPE but loosely', 'Systematic weekly progression with planned overloads'],
  },
  {
    name: 'Specificity',
    question: 'Was the majority of your training directly transferring to your competition lifts (squat, bench, deadlift)?',
    options: ['Lots of non-specific exercises, low competition lift frequency', 'Mostly specific with some filler', 'High frequency on competition lifts with purposeful accessories'],
  },
  {
    name: 'Recovery & Fatigue Management',
    question: 'Did you manage accumulated fatigue with planned deloads or reduced weeks?',
    options: ['Trained hard every week, no planned deloads', 'Took time off when I felt beat up', 'Planned recovery weeks at regular intervals'],
  },
  {
    name: 'Technique Consistency',
    question: 'Did your technique stay consistent across different intensities, or did your form break down under heavy load?',
    options: ['Form was inconsistent and I know it', 'Mostly consistent but broke down under max loads', 'Consistent mechanics across all intensity ranges'],
  },
  {
    name: 'Program Compliance',
    question: 'How closely did you follow the plan as written?',
    options: ['I changed things frequently or skipped sessions often', 'Followed it with some missed sessions', 'Followed the program as written, consistent attendance'],
  },
]

function AuditWorksheet() {
  const [scores, setScores] = useState<Record<string, number>>({})
  const [done, setDone] = useState(false)

  const answered = Object.keys(scores).length
  const total = Object.values(scores).reduce((a, v) => a + v, 0)
  const maxScore = AUDIT_CATEGORIES.length * 2
  const pct = Math.round((total / maxScore) * 100)

  function getTier() {
    if (pct < 40) return { label: 'Major Programming Gaps',  color: 'var(--text)', note: 'Multiple critical programming errors are limiting your progress. Addressing these — ideally with a coach — could dramatically accelerate your results.' }
    if (pct < 70) return { label: 'Developing Programmer',    color: 'var(--text)', note: 'You have a partial grasp of training principles, but key gaps in structure, recovery, or specificity are costing you gains.' }
    return { label: 'Strong Programming Foundation', color: '#22c55e', note: 'You\'re managing the programming fundamentals well. The next ceiling is personalization — a coach adds precision that general templates can\'t match.' }
  }

  if (done) {
    const tier = getTier()
    return (
      <div>
        <div style={{ background: 'var(--bg)', border: `1px solid ${tier.color}33`, borderRadius: '.25rem', padding: '2rem', marginBottom: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.5rem' }}>Block Score</p>
          <p style={{ color: tier.color, fontWeight: 900, fontSize: '3rem', lineHeight: 1 }}>{total}<span style={{ fontSize: '1.5rem', color: 'var(--text-3)' }}>/{maxScore}</span></p>
          <p style={{ color: tier.color, fontWeight: 900, fontSize: '.8rem', letterSpacing: '.15em', textTransform: 'uppercase', margin: '.5rem 0 1.25rem' }}>{tier.label}</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.875rem', lineHeight: 1.75, maxWidth: 500, margin: '0 auto' }}>{tier.note}</p>
        </div>

        {/* Breakdown */}
        <div style={{ marginBottom: '1.5rem' }}>
          {AUDIT_CATEGORIES.map(cat => (
            <div key={cat.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.75rem 0', borderBottom: '1px solid var(--surface-2)', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <p style={{ color: 'var(--chalk)', fontWeight: 700, fontSize: '.8rem' }}>{cat.name}</p>
                <p style={{ color: 'var(--text-2)', fontSize: '.75rem', marginTop: '.15rem' }}>{cat.options[scores[cat.name] ?? 0]}</p>
              </div>
              <span style={{ color: (scores[cat.name] ?? 0) === 2 ? '#22c55e' : (scores[cat.name] ?? 0) === 1 ? 'var(--text)' : '#c8102e', fontWeight: 900, fontSize: '.9rem', flexShrink: 0 }}>
                {scores[cat.name] ?? 0}/2
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <a href={href('/#coaches')} style={{ display: 'inline-block', background: '#272C84', color: '#ffffff', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.2em', textTransform: 'uppercase', padding: '.75rem 1.5rem', borderRadius: '.2rem', textDecoration: 'none' }}
            onMouseEnter={e => e.currentTarget.style.background = '#1a1f6b'}
            onMouseLeave={e => e.currentTarget.style.background = '#272C84'}
          >Work With a Coach →</a>
          <button onClick={() => { setScores({}); setDone(false) }}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.75rem 1.25rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-dim)'; e.currentTarget.style.color = 'var(--text-3)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
          >Re-audit</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <p style={{ color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.75, marginBottom: '1.5rem' }}>
        Rate each aspect of your most recent training block honestly — not how you hope it went, but how it actually went. One block = 4–12 weeks of training.
      </p>

      {/* Progress */}
      <div style={{ height: 3, background: 'var(--surface)', borderRadius: 2, marginBottom: '1.5rem', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(answered / AUDIT_CATEGORIES.length) * 100}%`, background: '#272C84', transition: 'width .3s' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {AUDIT_CATEGORIES.map(cat => (
          <div key={cat.name} style={{ background: 'var(--bg)', border: `1px solid ${scores[cat.name] !== undefined ? 'var(--border)' : 'var(--surface)'}`, borderRadius: '.25rem', padding: '1.25rem 1.5rem' }}>
            <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '.5rem' }}>{cat.name}</p>
            <p style={{ color: 'var(--chalk)', fontSize: '.875rem', lineHeight: 1.6, marginBottom: '1rem' }}>{cat.question}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
              {cat.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => setScores(s => ({ ...s, [cat.name]: i }))}
                  style={{ textAlign: 'left', background: scores[cat.name] === i ? 'rgba(39,44,132,.08)' : 'transparent', border: `1px solid ${scores[cat.name] === i ? 'rgba(39,44,132,.4)' : 'var(--border)'}`, borderRadius: '.2rem', color: scores[cat.name] === i ? 'var(--text)' : 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.6, padding: '.75rem 1rem', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}
                  onMouseEnter={e => { if (scores[cat.name] !== i) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-3)' } }}
                  onMouseLeave={e => { if (scores[cat.name] !== i) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' } }}
                >
                  <span style={{ color: i === 0 ? '#c8102e' : i === 1 ? 'var(--text)' : '#22c55e', marginRight: '.5rem', fontWeight: 900 }}>
                    {i === 0 ? '✕' : i === 1 ? '~' : '✓'}
                  </span>
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {answered === AUDIT_CATEGORIES.length && (
        <button
          onClick={() => setDone(true)}
          style={{ marginTop: '1.5rem', background: '#272C84', border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.2em', textTransform: 'uppercase', padding: '.875rem 2rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}
          onMouseEnter={e => e.currentTarget.style.background = '#1a1f6b'}
          onMouseLeave={e => e.currentTarget.style.background = '#272C84'}
        >
          See My Score →
        </button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NEWSLETTER GATE
// ─────────────────────────────────────────────────────────────────────────────

interface GateProps {
  source?: string
  onAccess: (access: NewsletterAccess) => void
}

function NewsletterGate({ source = 'guides_page', onAccess }: GateProps) {
  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [email,     setEmail]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await subscribeNewsletter({ firstName, lastName, email, source }, false)
      onAccess({ email, firstName, source, signedUpAt: new Date().toISOString() })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      if (msg.includes('already subscribed')) {
        // Still grant access
        onAccess({ email, firstName: firstName || 'Athlete', source, signedUpAt: new Date().toISOString() })
      } else {
        setError(msg)
        setLoading(false)
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.5rem', padding: '2.5rem', maxWidth: 480, margin: '0 auto' }}>
      <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Free Access</p>
      <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.4rem', textTransform: 'uppercase', letterSpacing: '-.02em', lineHeight: 1.1, marginBottom: '.75rem' }}>Unlock All 6 Guides</h2>
      <p style={{ color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.7, marginBottom: '1.75rem' }}>Enter your name and email to get instant, free access to all guides, tools, and worksheets — no credit card, no spam.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.875rem', marginBottom: '.875rem' }}>
        <div>
          <label style={lbl}>First Name <span style={{ color: 'var(--text)' }}>*</span></label>
          <input style={inp} required placeholder="Jane" value={firstName} onChange={e => setFirstName(e.target.value)} maxLength={100} />
        </div>
        <div>
          <label style={lbl}>Last Name</label>
          <input style={inp} placeholder="Smith" value={lastName} onChange={e => setLastName(e.target.value)} maxLength={100} />
        </div>
      </div>
      <div style={{ marginBottom: '1.25rem' }}>
        <label style={lbl}>Email <span style={{ color: 'var(--text)' }}>*</span></label>
        <input style={inp} type="email" required placeholder="jane@example.com" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} />
      </div>
      {error && <p style={{ color: 'var(--text)', fontSize: '.8rem', marginBottom: '.875rem' }}>{error}</p>}
      <button
        type="submit"
        disabled={loading || !firstName.trim() || !email.trim()}
        style={{ width: '100%', background: '#272C84', border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.2em', textTransform: 'uppercase', padding: '.875rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit', opacity: loading || !firstName.trim() || !email.trim() ? 0.5 : 1, transition: 'opacity .15s' }}
        onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#1a1f6b' }}
        onMouseLeave={e => e.currentTarget.style.background = '#272C84'}
      >
        {loading ? 'Unlocking…' : 'Get Free Access →'}
      </button>
      <p style={{ color: 'var(--text-3)', fontSize: '.7rem', textAlign: 'center', marginTop: '.875rem' }}>No spam. Unsubscribe any time.</p>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GUIDE CARDS CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const GUIDES = [
  {
    id: 'checklist',
    source: 'meet_checklist',
    label: 'Meet Day Checklist',
    description: 'Warmup timing, attempt strategy, gear bag essentials — everything you need the night before and on the day.',
    tag: 'Free Checklist',
    component: <MeetDayChecklist />,
  },
  {
    id: 'attempts',
    source: 'attempt_planner',
    label: 'Attempt Selection Calculator',
    description: 'Enter your training maxes and get your opener, second, and third attempt recommendations based on proven percentages.',
    tag: 'Interactive Tool',
    component: <AttemptCalcGuide />,
  },
  {
    id: 'quiz',
    source: 'quiz',
    label: '"Is Your Training Leaving Gains on the Table?" Quiz',
    description: '6 questions. Score your programming, volume management, recovery habits, and more. Get your tier and a clear picture of what to fix.',
    tag: 'Scored Quiz',
    component: <TrainingQuiz />,
  },
  {
    id: 'rpe',
    source: 'rpe_guide',
    label: 'RPE Guide for Beginners',
    description: 'What RPE 6–10 actually means, how many reps each level implies, and how to calibrate your own effort accurately.',
    tag: 'Reference Guide',
    component: <RPEGuide />,
  },
  {
    id: 'big3',
    source: 'big_three',
    label: "Beginner's Guide to the Big Three",
    description: 'Squat, bench, and deadlift cue breakdowns, phase-by-phase. Setup, execution, and the most common technical mistakes.',
    tag: 'Technical Guide',
    component: <BigThreeGuide />,
  },
  {
    id: 'audit',
    source: 'audit_worksheet',
    label: 'Audit Your Last Training Block',
    description: 'Rate your last block across 6 programming dimensions. Score your structure, specificity, recovery management, and compliance.',
    tag: 'Scored Worksheet',
    component: <AuditWorksheet />,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function GuidesPage() {
  const [view,      setView]      = useState<'guides' | 'tools'>('guides')
  const [access,    setAccess]    = useState<NewsletterAccess | null>(null)
  const [expanded,  setExpanded]  = useState<string | null>(null)
  const [gateSource, setGateSource] = useState('guides_page')

  useEffect(() => {
    const saved = getNewsletterAccess()
    if (saved) setAccess(saved)
  }, [])

  const handleAccess = useCallback((a: NewsletterAccess) => {
    setAccess(a)
  }, [])

  function toggleGuide(id: string, source: string) {
    if (!access) {
      setGateSource(source)
      document.getElementById('guides-gate')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setExpanded(prev => prev === id ? null : id)
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--nav-overlay)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--border)', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 24, filter: 'var(--logo-filter)' }} />
        </a>
        <span style={{ color: 'var(--text-3)' }}>›</span>
        <span style={{ color: 'var(--text-2)', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>Free Stuff</span>
      </nav>

      {/* Hero */}
      <section style={{ padding: '6rem 2rem 3rem', borderBottom: '1px solid var(--surface)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Free Resources</p>
          <h1 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(2.5rem, 7vw, 5rem)', textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: .9 }}>
            Free Stuff
          </h1>
          <p style={{ color: 'var(--text-2)', fontSize: '.9rem', marginTop: '1.25rem', maxWidth: 520, lineHeight: 1.75 }}>
            Free guides, calculators, and tools for powerlifters at every level. Sign up once to unlock everything.
          </p>
          {access && (
            <p style={{ color: '#22c55e', fontSize: '.75rem', fontWeight: 700, marginTop: '1rem' }}>
              ✓ Access active — welcome back{access.firstName ? `, ${access.firstName}` : ''}.
            </p>
          )}

          {/* View switcher */}
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '2rem' }}>
            {(['guides', 'tools'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  background: view === v ? 'var(--text)' : 'transparent',
                  border: `1px solid ${view === v ? 'var(--text)' : 'var(--border)'}`,
                  color: view === v ? 'var(--bg)' : 'var(--text-2)',
                  fontSize: '.65rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase',
                  padding: '.5rem 1.25rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all .15s',
                }}
              >
                {v === 'guides' ? 'Free Guides' : 'Free Tools'}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Tools grid */}
      {view === 'tools' && (
        <section style={{ padding: '4rem 2rem 6rem', maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1px', background: 'var(--surface)' }}>
            {TOOL_LIST.map(tool => (
              <div key={tool.id} style={{ background: 'var(--bg)', padding: '2rem' }}>
                <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '.95rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '.5rem' }}>{tool.label}</p>
                <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.65, marginBottom: '1.5rem' }}>{tool.desc}</p>
                <a
                  href={href(`/tools/${tool.id}`)}
                  style={{ display: 'inline-block', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', padding: '.5rem 1rem', borderRadius: '.2rem', textDecoration: 'none', transition: 'border-color .15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#272C84'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  Use Tool →
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Guide cards + gate + CTA — only in guides view */}
      {view === 'guides' && (<>
        <section style={{ padding: '4rem 2rem', maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--surface)' }}>
            {GUIDES.map(guide => {
              const isOpen = expanded === guide.id
              return (
                <div key={guide.id} style={{ background: 'var(--bg)' }}>
                  <button
                    onClick={() => toggleGuide(guide.id, guide.source)}
                    style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '1.75rem 2rem', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', gap: '1.25rem', alignItems: 'flex-start', transition: 'background .15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.4rem' }}>
                        <span style={{ background: 'rgba(39,44,132,.1)', border: '1px solid rgba(39,44,132,.2)', color: 'var(--text)', fontSize: '.55rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.2rem .55rem', borderRadius: '.15rem', flexShrink: 0 }}>{guide.tag}</span>
                        {!access && <span style={{ color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700 }}>🔒 Sign up to unlock</span>}
                      </div>
                      <p style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '-.01em', lineHeight: 1.2, marginBottom: '.4rem' }}>{guide.label}</p>
                      <p style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.65 }}>{guide.description}</p>
                    </div>
                    <span style={{ color: isOpen ? '#272C84' : 'var(--steel)', fontSize: '1.2rem', flexShrink: 0, marginTop: '.2rem', transition: 'transform .2s, color .15s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>›</span>
                  </button>
                  {isOpen && access && (
                    <div style={{ padding: '0 2rem 2rem', borderTop: '1px solid var(--surface-2)' }}>
                      <div style={{ paddingTop: '1.5rem' }}>{guide.component}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {!access && (
          <section id="guides-gate" style={{ padding: '3rem 2rem 6rem' }}>
            <NewsletterGate source={gateSource} onAccess={handleAccess} />
          </section>
        )}

        {access && (
          <section style={{ padding: '4rem 2rem', borderTop: '1px solid var(--surface)', background: 'var(--bg)', textAlign: 'center' }}>
            <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Ready to Level Up?</p>
            <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: 'clamp(1.5rem, 4vw, 2.5rem)', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '.875rem' }}>Work With a Real Coach</h2>
            <p style={{ color: 'var(--text-2)', fontSize: '.875rem', lineHeight: 1.75, maxWidth: 480, margin: '0 auto 1.75rem' }}>
              The guides give you the framework. A coach applies it to your training, your schedule, and your meet timeline.
            </p>
            <a href={href('/#coaches')} style={{ display: 'inline-block', background: '#272C84', color: '#ffffff', fontWeight: 900, fontSize: '.75rem', letterSpacing: '.2em', textTransform: 'uppercase', padding: '.875rem 2rem', borderRadius: '.25rem', textDecoration: 'none' }}
              onMouseEnter={e => e.currentTarget.style.background = '#1a1f6b'}
              onMouseLeave={e => e.currentTarget.style.background = '#272C84'}
            >
              Meet the Team →
            </a>
          </section>
        )}
      </>)}

      {/* Footer strip */}
      <div style={{ background: 'var(--bg)', borderTop: '1px solid var(--surface)', padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <a href={href('/')}><img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 20, filter: 'var(--logo-filter)' }} /></a>
        <a href={href('/')} style={{ color: 'var(--text-3)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', textDecoration: 'none' }}>← Home</a>
      </div>
    </div>
  )
}
