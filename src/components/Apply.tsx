import { useState } from 'react'
import { sanitize, sanitizeShort, sanitizeEmail } from '../utils/sanitize'
import { supabase } from '../lib/supabase'

// ── Sanitization field map ─────────────────────────────────────────────────
const SHORT_FIELDS = new Set([
  'firstName','lastName','social','age','height','bodyWeight','weightClass',
  'squatMax','benchMax','deadMax','squatFreq','benchFreq','deadFreq','sleep',
])

// ── Types ──────────────────────────────────────────────────────────────────
type FormData = {
  firstName: string; lastName: string; email: string; social: string
  service: string; coachPref: string
  age: string; height: string; bodyWeight: string; weightClass: string
  experience: string; injuries: string; trainDays: string[]; occupation: string
  squatMax: string; benchMax: string; deadMax: string
  squatFreq: string; benchFreq: string; deadFreq: string
  currentProgram: string; squatStyle: string; benchStyle: string; deadStyle: string
  weakPoints: string; learningStyle: string; sleep: string
  nutrition: string; stress: string; recovery: string
  expectations: string; goals: string
}

const INITIAL: FormData = {
  firstName: '', lastName: '', email: '', social: '',
  service: '', coachPref: 'No Preference',
  age: '', height: '', bodyWeight: '', weightClass: '',
  experience: '', injuries: '', trainDays: [], occupation: '',
  squatMax: '', benchMax: '', deadMax: '',
  squatFreq: '', benchFreq: '', deadFreq: '',
  currentProgram: '', squatStyle: '', benchStyle: '', deadStyle: '',
  weakPoints: '', learningStyle: '', sleep: '',
  nutrition: '', stress: '', recovery: '',
  expectations: '', goals: '',
}

const TOTAL_STEPS = 5
const STEP_TITLES = [
  'Step 1 of 5 — Contact & Service',
  'Step 2 of 5 — Physical Profile',
  'Step 3 of 5 — Training Data',
  'Step 4 of 5 — Lifestyle & Recovery',
  'Step 5 of 5 — Goals & Review',
]

// ── Small helpers ──────────────────────────────────────────────────────────
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="field-label">{children}</label>
}

function Req() {
  return <span style={{ color: 'var(--text)' }}> *</span>
}

function Input({ name, placeholder, type = 'text', value, onChange, required }: {
  name: keyof FormData; placeholder: string; type?: string
  value: string; onChange: (v: string) => void; required?: boolean
}) {
  return (
    <input
      type={type} name={name} className="field" placeholder={placeholder}
      value={value} onChange={e => onChange(e.target.value)}
      required={required}
      style={required && !value.trim() ? undefined : undefined}
    />
  )
}

function Textarea({ name, placeholder, rows = 3, value, onChange, required }: {
  name: keyof FormData; placeholder: string; rows?: number
  value: string; onChange: (v: string) => void; required?: boolean
}) {
  return (
    <textarea
      name={name} className="field" placeholder={placeholder} rows={rows}
      value={value} onChange={e => onChange(e.target.value)} required={required}
    />
  )
}

function Pill({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`pill-label${checked ? ' pill-checked' : ''}`}>
      {label}
    </button>
  )
}

function ScaleRow({ group, value, onChange }: { group: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: 10 }, (_, i) => String(i + 1)).map(n => (
        <button
          key={n} type="button"
          className={`scale-btn${value === n ? ' selected' : ''}`}
          onClick={() => onChange(n)}
          aria-label={`${group} ${n}`}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

// ── Step components ────────────────────────────────────────────────────────
function Step1({ data, set, lockedCoach }: { data: FormData; set: (k: keyof FormData, v: string) => void; lockedCoach?: string }) {
  const COACHES = ['Ronnie Vallejo', 'Seth Burman', 'Lucas Sison', 'Kobe Pham', 'Aedan Nguyen', 'No Preference']
  return (
    <div className="flex flex-col gap-5">
      <div className="grid sm:grid-cols-2 gap-5">
        <div><FieldLabel>First Name<Req /></FieldLabel><Input name="firstName" placeholder="Your first name" value={data.firstName} onChange={v => set('firstName', v)} required /></div>
        <div><FieldLabel>Last Name<Req /></FieldLabel><Input name="lastName" placeholder="Your last name" value={data.lastName} onChange={v => set('lastName', v)} required /></div>
      </div>
      <div><FieldLabel>Email Address<Req /></FieldLabel><Input name="email" type="email" placeholder="you@example.com" value={data.email} onChange={v => set('email', v)} required /></div>
      <div><FieldLabel>Instagram or Facebook Handle</FieldLabel><Input name="social" placeholder="@yourhandle" value={data.social} onChange={v => set('social', v)} /></div>
      <div>
        <FieldLabel>Service You're Seeking<Req /></FieldLabel>
        <select name="service" className="field" value={data.service} onChange={e => set('service', e.target.value)} required>
          <option value="" disabled>Select a service</option>
          <option>1:1 Coaching (Full Service)</option>
          <option>Meet Day Coaching</option>
          <option>Movement Coaching</option>
        </select>
      </div>
      <div>
        <FieldLabel>Coach Preference</FieldLabel>
        {lockedCoach ? (
          <div style={{ marginTop: '.5rem', display: 'inline-flex', alignItems: 'center', gap: '.75rem', background: 'var(--surface)', border: '1px solid var(--border)', padding: '.6rem 1rem', borderRadius: '.25rem' }}>
            <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.875rem' }}>{lockedCoach}</span>
            <span style={{ color: 'var(--text-2)', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>Selected</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 mt-1">
            {COACHES.map(c => (
              <Pill key={c} label={c} checked={data.coachPref === c} onClick={() => set('coachPref', c)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Step2({ data, set, toggleDay }: { data: FormData; set: (k: keyof FormData, v: string) => void; toggleDay: (d: string) => void }) {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return (
    <div className="flex flex-col gap-5">
      <div className="grid sm:grid-cols-2 gap-5">
        <div><FieldLabel>Age<Req /></FieldLabel><Input name="age" type="number" placeholder="e.g. 26" value={data.age} onChange={v => set('age', v)} required /></div>
        <div><FieldLabel>Height<Req /></FieldLabel><Input name="height" placeholder={"e.g. 5'10\" or 178cm"} value={data.height} onChange={v => set('height', v)} required /></div>
        <div><FieldLabel>Current Body Weight<Req /></FieldLabel><Input name="bodyWeight" placeholder="e.g. 185 lbs / 84 kg" value={data.bodyWeight} onChange={v => set('bodyWeight', v)} required /></div>
        <div><FieldLabel>Preferred Weight Class<Req /></FieldLabel><Input name="weightClass" placeholder="e.g. 83kg / 93kg" value={data.weightClass} onChange={v => set('weightClass', v)} required /></div>
      </div>
      <div>
        <FieldLabel>Lifting Experience<Req /></FieldLabel>
        <select name="experience" className="field" value={data.experience} onChange={e => set('experience', e.target.value)} required>
          <option value="" disabled>Select experience level</option>
          <option>Less than 1 year</option><option>1–2 years</option>
          <option>2–4 years</option><option>4–7 years</option><option>7+ years</option>
        </select>
      </div>
      <div><FieldLabel>Past or Current Injuries<Req /></FieldLabel><Textarea name="injuries" placeholder="Describe any injuries, or write 'none'" value={data.injuries} onChange={v => set('injuries', v)} required /></div>
      <div>
        <FieldLabel>Days Available to Train<Req /></FieldLabel>
        <div className="flex flex-wrap gap-2 mt-1">
          {DAYS.map(d => <Pill key={d} label={d} checked={data.trainDays.includes(d)} onClick={() => toggleDay(d)} />)}
        </div>
      </div>
      <div><FieldLabel>Occupation & Life Obligations<Req /></FieldLabel><Textarea name="occupation" placeholder="What do you do for work and what are your obligations outside of training?" value={data.occupation} onChange={v => set('occupation', v)} required /></div>
    </div>
  )
}

function Step3({ data, set }: { data: FormData; set: (k: keyof FormData, v: string) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p style={{ color: 'var(--text-2)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '1rem', fontWeight: 700 }}>Current Maxes</p>
        <div className="grid sm:grid-cols-3 gap-5">
          <div><FieldLabel>Squat Max<Req /></FieldLabel><Input name="squatMax" placeholder="e.g. 405 lbs" value={data.squatMax} onChange={v => set('squatMax', v)} required /></div>
          <div><FieldLabel>Bench Max<Req /></FieldLabel><Input name="benchMax" placeholder="e.g. 275 lbs" value={data.benchMax} onChange={v => set('benchMax', v)} required /></div>
          <div><FieldLabel>Deadlift Max<Req /></FieldLabel><Input name="deadMax" placeholder="e.g. 495 lbs" value={data.deadMax} onChange={v => set('deadMax', v)} required /></div>
        </div>
      </div>
      <div>
        <p style={{ color: 'var(--text-2)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '1rem', fontWeight: 700 }}>Weekly Frequencies</p>
        <div className="grid sm:grid-cols-3 gap-5">
          <div><FieldLabel>Squat Freq.<Req /></FieldLabel><Input name="squatFreq" placeholder="e.g. 2x/week" value={data.squatFreq} onChange={v => set('squatFreq', v)} required /></div>
          <div><FieldLabel>Bench Freq.<Req /></FieldLabel><Input name="benchFreq" placeholder="e.g. 3x/week" value={data.benchFreq} onChange={v => set('benchFreq', v)} required /></div>
          <div><FieldLabel>Deadlift Freq.<Req /></FieldLabel><Input name="deadFreq" placeholder="e.g. 1x/week" value={data.deadFreq} onChange={v => set('deadFreq', v)} required /></div>
        </div>
      </div>
      <div><FieldLabel>Current Program Description</FieldLabel><Textarea name="currentProgram" placeholder="E.g. Mon – Comp Squat 3x5 @ 77.5%, Tue – Comp Bench 4x5 75%, etc." rows={4} value={data.currentProgram} onChange={v => set('currentProgram', v)} /></div>
      <div>
        <p style={{ color: 'var(--text-2)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '1rem', fontWeight: 700 }}>Competition Style</p>
        <div className="grid sm:grid-cols-3 gap-6">
          <div>
            <FieldLabel>Squat<Req /></FieldLabel>
            <div className="flex flex-col gap-2 mt-1">
              {['Low Bar', 'High Bar'].map(v => <Pill key={v} label={v} checked={data.squatStyle === v} onClick={() => set('squatStyle', v)} />)}
            </div>
          </div>
          <div>
            <FieldLabel>Bench<Req /></FieldLabel>
            <div className="flex flex-col gap-2 mt-1">
              {['Close Grip', 'Medium Grip', 'Wide Grip'].map(v => <Pill key={v} label={v} checked={data.benchStyle === v} onClick={() => set('benchStyle', v)} />)}
            </div>
          </div>
          <div>
            <FieldLabel>Deadlift<Req /></FieldLabel>
            <div className="flex flex-col gap-2 mt-1">
              {['Conventional', 'Sumo'].map(v => <Pill key={v} label={v} checked={data.deadStyle === v} onClick={() => set('deadStyle', v)} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Step4({ data, set }: { data: FormData; set: (k: keyof FormData, v: string) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div><FieldLabel>Weak Points / Areas to Improve<Req /></FieldLabel><Textarea name="weakPoints" placeholder="What do you want to work on most?" value={data.weakPoints} onChange={v => set('weakPoints', v)} required /></div>
      <div>
        <FieldLabel>Learning Style<Req /></FieldLabel>
        <div className="flex flex-wrap gap-3 mt-1">
          {['Visual (watching / reading)', 'Verbal (hearing / discussing)'].map(v => (
            <Pill key={v} label={v} checked={data.learningStyle === v} onClick={() => set('learningStyle', v)} />
          ))}
        </div>
      </div>
      <div><FieldLabel>Avg Hours of Sleep<Req /></FieldLabel><Input name="sleep" placeholder="e.g. 7 hours" value={data.sleep} onChange={v => set('sleep', v)} required /></div>
      <div>
        <FieldLabel>Nutrition / Hydration (1–10)<Req /></FieldLabel>
        <ScaleRow group="nutrition" value={data.nutrition} onChange={v => set('nutrition', v)} />
      </div>
      <div>
        <FieldLabel>Life Stress Level (1–10)</FieldLabel>
        <ScaleRow group="stress" value={data.stress} onChange={v => set('stress', v)} />
      </div>
      <div>
        <FieldLabel>Overall Recovery (1–10)<Req /></FieldLabel>
        <ScaleRow group="recovery" value={data.recovery} onChange={v => set('recovery', v)} />
      </div>
    </div>
  )
}

function Step5({ data, set }: { data: FormData; set: (k: keyof FormData, v: string) => void }) {
  const summary = [
    ['Name',       `${data.firstName} ${data.lastName}`.trim() || '—'],
    ['Email',      data.email || '—'],
    ['Service',    data.service || '—'],
    ['Coach Pref', data.coachPref || '—'],
    ['Body Weight', data.bodyWeight || '—'],
    ['SBD Maxes',  data.squatMax && data.benchMax && data.deadMax ? `${data.squatMax} / ${data.benchMax} / ${data.deadMax}` : '—'],
    ['Competition', [data.squatStyle, data.benchStyle, data.deadStyle].filter(Boolean).join(' · ') || '—'],
  ]
  return (
    <div className="flex flex-col gap-5">
      <div><FieldLabel>Expectations of Your Coach<Req /></FieldLabel><Textarea name="expectations" placeholder="What do you expect from the coaching relationship?" rows={4} value={data.expectations} onChange={v => set('expectations', v)} required /></div>
      <div><FieldLabel>Further Goals or Concerns</FieldLabel><Textarea name="goals" placeholder="Anything else — short-term goals, upcoming meets, concerns, etc." rows={4} value={data.goals} onChange={v => set('goals', v)} /></div>
      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '1.5rem', borderRadius: '.25rem' }}>
        <p style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase', marginBottom: '1rem' }}>Application Summary</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
          {summary.map(([k, v]) => (
            <div key={k} className="flex gap-4" style={{ fontSize: '.8rem' }}>
              <span style={{ minWidth: '7rem', color: 'var(--text-2)' }}>{k}</span>
              <span style={{ color: 'var(--text-dim)' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function Apply({ preselectedCoach }: { preselectedCoach?: string } = {}) {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<FormData>(() => ({
    ...INITIAL,
    coachPref: preselectedCoach ?? 'No Preference',
  }))
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [validationErrors, setValidationErrors] = useState<Partial<Record<keyof FormData, boolean>>>({})
  const [privacyConsent, setPrivacyConsent] = useState(false)
  const [consentError, setConsentError] = useState(false)

  const set = (k: keyof FormData, v: string) => {
    const clean = k === 'email'
      ? sanitizeEmail(v)
      : SHORT_FIELDS.has(k)
        ? sanitizeShort(v)
        : sanitize(v)
    setData(d => ({ ...d, [k]: clean }))
    setValidationErrors(e => ({ ...e, [k]: false }))
  }

  const toggleDay = (day: string) => {
    setData(d => ({
      ...d,
      trainDays: d.trainDays.includes(day)
        ? d.trainDays.filter(x => x !== day)
        : [...d.trainDays, day],
    }))
  }

  const REQUIRED_BY_STEP: Array<Array<keyof FormData>> = [
    ['firstName', 'lastName', 'email', 'service'],
    ['age', 'height', 'bodyWeight', 'weightClass', 'experience', 'injuries', 'occupation'],
    ['squatMax', 'benchMax', 'deadMax', 'squatFreq', 'benchFreq', 'deadFreq'],
    ['weakPoints', 'learningStyle', 'sleep', 'nutrition', 'recovery'],
    ['expectations'],
  ]

  const validateStep = (n: number): boolean => {
    const fields = REQUIRED_BY_STEP[n - 1]
    const errors: Partial<Record<keyof FormData, boolean>> = {}
    let valid = true
    fields.forEach(f => {
      if (!data[f] || (typeof data[f] === 'string' && !(data[f] as string).trim())) {
        errors[f] = true
        valid = false
      }
    })
    setValidationErrors(errors)
    return valid
  }

  const next = () => {
    if (validateStep(step)) setStep(s => Math.min(s + 1, TOTAL_STEPS))
  }

  const back = () => setStep(s => Math.max(s - 1, 1))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateStep(TOTAL_STEPS)) return
    if (!privacyConsent) { setConsentError(true); return }
    setSubmitting(true)
    setError('')
    setConsentError(false)

    try {
      // 1 — Save lead to Supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const insertPayload: any = {
          first_name:      data.firstName,
          last_name:       data.lastName,
          email:           data.email,
          social:          data.social || null,
          service:         data.service,
          coach_pref:      data.coachPref,
          age:             data.age || null,
          height:          data.height || null,
          body_weight:     data.bodyWeight || null,
          weight_class:    data.weightClass || null,
          experience:      data.experience || null,
          injuries:        data.injuries || null,
          train_days:      data.trainDays.join(', ') || null,
          occupation:      data.occupation || null,
          squat_max:       data.squatMax || null,
          bench_max:       data.benchMax || null,
          dead_max:        data.deadMax || null,
          squat_freq:      data.squatFreq || null,
          bench_freq:      data.benchFreq || null,
          dead_freq:       data.deadFreq || null,
          current_program: data.currentProgram || null,
          squat_style:     data.squatStyle || null,
          bench_style:     data.benchStyle || null,
          dead_style:      data.deadStyle || null,
          weak_points:     data.weakPoints || null,
          learning_style:  data.learningStyle || null,
          sleep:           data.sleep || null,
          nutrition:       data.nutrition || null,
          stress:          data.stress || null,
          recovery:        data.recovery || null,
          expectations:    data.expectations || null,
          goals:           data.goals || null,
        }
      const { data: lead, error: dbErr } = await supabase
        .from('leads')
        .insert(insertPayload)
        .select()
        .single()

      if (dbErr) throw new Error(dbErr.message)

      // 2 — Trigger email notification (fire-and-forget — don't block the success state)
      if (lead) {
        supabase.functions.invoke('send-lead-email', { body: lead }).catch(() => {
          // email failure is non-blocking; lead is saved
        })
      }

      setSubmitted(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const pct = (step / TOTAL_STEPS) * 100

  const stepProps = { data, set }

  return (
    <section id="apply" style={{ background: 'var(--bg)', padding: '8rem 1.5rem' }}>
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="text-center mb-12">
          <p style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '1rem' }}>Ready To Start?</p>
          <h2 style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-.03em', lineHeight: 0.9, fontSize: 'clamp(2.5rem,6vw,5rem)', color: 'var(--text)', marginBottom: '1.25rem' }}>
            {preselectedCoach ? `Apply — ${preselectedCoach.split(' ')[0]}` : 'Work With Us'}
          </h2>
          <p style={{ color: 'var(--text-2)', fontSize: '.9rem', lineHeight: 1.7 }}>
            {preselectedCoach
              ? `Fill out the application below. ${preselectedCoach} reviews every submission and gets back to you within 24 hours.`
              : 'Fill out the application below. We review every submission and get back to you within 48 hours.'}
          </p>
        </div>

        {submitted ? (
          <div className="text-center" style={{ padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--text)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '1rem' }}>Application Received</p>
            <h3 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '2.5rem', textTransform: 'uppercase', letterSpacing: '-.02em', marginBottom: '1rem' }}>You're in the queue.</h3>
            <p style={{ color: 'var(--text-2)', fontSize: '.9rem', lineHeight: 1.7, marginBottom: '2rem' }}>We review every application personally. {preselectedCoach ? `${preselectedCoach} will reach out within 24 hours.` : 'Expect a response within 48 hours.'}</p>
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} style={{ color: 'var(--text)', fontSize: '.75rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', background: 'none', border: 'none', cursor: 'pointer' }}>
              ← Back to top
            </button>
          </div>
        ) : (
          <>
            {/* Progress bar */}
            <div style={{ background: 'var(--surface)', borderRadius: 9999, height: 2, marginBottom: '1rem', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: '#bfa162', width: `${pct}%`, borderRadius: 9999, transition: 'width .4s ease' }} />
            </div>
            <p style={{ color: 'var(--text-2)', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', textAlign: 'center', marginBottom: '2.5rem' }}>{STEP_TITLES[step - 1]}</p>

            <form onSubmit={handleSubmit} noValidate>
              {step === 1 && <Step1 {...stepProps} lockedCoach={preselectedCoach} />}
              {step === 2 && <Step2 {...stepProps} toggleDay={toggleDay} />}
              {step === 3 && <Step3 {...stepProps} />}
              {step === 4 && <Step4 {...stepProps} />}
              {step === 5 && <Step5 {...stepProps} />}

              {/* Privacy consent — shown on final step */}
              {step === TOTAL_STEPS && (
                <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'flex-start', gap: '.75rem' }}>
                  <input
                    id="privacy-consent"
                    type="checkbox"
                    checked={privacyConsent}
                    onChange={e => { setPrivacyConsent(e.target.checked); setConsentError(false) }}
                    style={{ marginTop: '.2rem', accentColor: '#c8102e', width: '1rem', height: '1rem', flexShrink: 0, cursor: 'pointer' }}
                  />
                  <label htmlFor="privacy-consent" style={{ color: 'var(--text-2)', fontSize: '.8rem', lineHeight: 1.6, cursor: 'pointer' }}>
                    I have read and agree to the{' '}
                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new CustomEvent('open-privacy'))}
                      style={{ color: 'var(--text)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '.8rem', padding: 0, textDecoration: 'underline' }}
                    >
                      Privacy Policy
                    </button>
                    . I understand that Axis Training Systems will collect and use my information to provide coaching services, and that I have rights under the California Consumer Privacy Act (CCPA).
                  </label>
                </div>
              )}

              {/* Validation hint */}
              {Object.values(validationErrors).some(Boolean) && (
                <p style={{ color: '#f87171', fontSize: '.8rem', marginTop: '1rem' }}>Please fill in all required fields before continuing.</p>
              )}

              {/* Consent error */}
              {consentError && (
                <p style={{ color: '#f87171', fontSize: '.8rem', marginTop: '.5rem' }}>Please read and accept the Privacy Policy before submitting.</p>
              )}

              {/* Error */}
              {error && (
                <div style={{ background: '#1a0309', border: '1px solid #2d0810', padding: '1rem', borderRadius: '.25rem', color: '#f87171', fontSize: '.8rem', marginTop: '1rem' }}>
                  {error}
                </div>
              )}

              {/* Navigation */}
              <div className="flex justify-between gap-4 mt-8">
                {step > 1 ? (
                  <button
                    type="button" onClick={back}
                    className="text-xs font-bold px-6 py-3 rounded tracking-widest uppercase transition-colors"
                    style={{ border: '1px solid var(--border)', color: 'var(--text)' }}
                  >
                    Back
                  </button>
                ) : <div />}

                {step < TOTAL_STEPS ? (
                  <button
                    type="button" onClick={next}
                    className="text-white text-xs font-black px-8 py-3 rounded tracking-widest uppercase transition-colors"
                    style={{ background: '#bfa162' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#9a7c3a')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#bfa162')}
                  >
                    Next Step
                  </button>
                ) : (
                  <button
                    type="submit" disabled={submitting}
                    className="inline-flex items-center gap-3 text-white text-xs font-black px-8 py-4 rounded tracking-widest uppercase transition-colors"
                    style={{ background: submitting ? '#7a6530' : '#bfa162', color: 'var(--bg)' }}
                  >
                    {submitting ? 'Sending…' : 'Submit Application'}
                    {!submitting && (
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    )}
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  )
}
