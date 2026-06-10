// Axis Training Systems — Lead Notification Edge Function
// Deploy: supabase functions deploy send-lead-email
// Requires env secret: RESEND_API_KEY (set in Supabase dashboard)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface LeadPayload {
  id: string
  first_name: string
  last_name: string
  email: string
  social?: string
  service: string
  coach_pref: string
  age?: string
  height?: string
  body_weight?: string
  weight_class?: string
  experience?: string
  injuries?: string
  train_days?: string
  occupation?: string
  squat_max?: string
  bench_max?: string
  dead_max?: string
  squat_freq?: string
  bench_freq?: string
  dead_freq?: string
  current_program?: string
  squat_style?: string
  bench_style?: string
  dead_style?: string
  weak_points?: string
  learning_style?: string
  sleep?: string
  nutrition?: string
  stress?: string
  recovery?: string
  expectations?: string
  goals?: string
  created_at: string
}

function buildEmailHtml(lead: LeadPayload): string {
  const row = (label: string, value?: string | null) =>
    value
      ? `<tr><td style="padding:6px 12px;color:#888;font-size:13px;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 12px;color:#ddd;font-size:13px">${value}</td></tr>`
      : ''

  const section = (title: string, rows: string) =>
    `<tr><td colspan="2" style="padding:16px 12px 4px;color:#e63e3e;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;border-top:1px solid #222">${title}</td></tr>${rows}`

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="background:#080808;font-family:ui-sans-serif,system-ui,sans-serif;padding:0;margin:0">
  <div style="max-width:680px;margin:0 auto;padding:32px 16px">
    <div style="margin-bottom:24px">
      <p style="color:#e63e3e;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin:0 0 8px">New Application</p>
      <h1 style="color:#fff;font-size:28px;font-weight:900;margin:0;text-transform:uppercase;letter-spacing:-1px">
        ${lead.first_name} ${lead.last_name}
      </h1>
      <p style="color:#555;font-size:13px;margin:4px 0 0">${lead.email} · ${new Date(lead.created_at).toLocaleString()}</p>
    </div>

    <div style="background:#0a0a0a;border:1px solid #1e1e1e;border-radius:4px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        ${section('Service', `
          ${row('Service', lead.service)}
          ${row('Coach Preference', lead.coach_pref)}
          ${row('Instagram / Facebook', lead.social)}
        `)}
        ${section('Physical Profile', `
          ${row('Age', lead.age)}
          ${row('Height', lead.height)}
          ${row('Body Weight', lead.body_weight)}
          ${row('Weight Class', lead.weight_class)}
          ${row('Experience', lead.experience)}
          ${row('Injuries', lead.injuries)}
          ${row('Training Days', lead.train_days)}
          ${row('Occupation', lead.occupation)}
        `)}
        ${section('Training Data', `
          ${row('Squat Max', lead.squat_max)}
          ${row('Bench Max', lead.bench_max)}
          ${row('Deadlift Max', lead.dead_max)}
          ${row('Squat Frequency', lead.squat_freq)}
          ${row('Bench Frequency', lead.bench_freq)}
          ${row('Deadlift Frequency', lead.dead_freq)}
          ${row('Current Program', lead.current_program)}
          ${row('Squat Style', lead.squat_style)}
          ${row('Bench Style', lead.bench_style)}
          ${row('Deadlift Style', lead.dead_style)}
        `)}
        ${section('Lifestyle & Recovery', `
          ${row('Weak Points', lead.weak_points)}
          ${row('Learning Style', lead.learning_style)}
          ${row('Sleep (hrs)', lead.sleep)}
          ${row('Nutrition / Hydration', lead.nutrition ? lead.nutrition + '/10' : null)}
          ${row('Life Stress', lead.stress ? lead.stress + '/10' : null)}
          ${row('Overall Recovery', lead.recovery ? lead.recovery + '/10' : null)}
        `)}
        ${section('Goals', `
          ${row('Expectations', lead.expectations)}
          ${row('Further Goals', lead.goals)}
        `)}
      </table>
    </div>

    <p style="color:#333;font-size:12px;margin-top:24px;text-align:center">
      Axis Training Systems Admin · <a href="https://axistrainingsystems.com/admin" style="color:#555">View in Dashboard</a>
    </p>
  </div>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const lead: LeadPayload = await req.json()

    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
    const supabaseKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendApiKey = Deno.env.get('RESEND_API_KEY')!

    const db = createClient(supabaseUrl, supabaseKey)

    // Fetch coach routing + master email in parallel
    const [{ data: routes }, { data: config }] = await Promise.all([
      db.from('coach_routing').select('*'),
      db.from('admin_config').select('*'),
    ])

    const masterEmail = config?.find((c: {key:string;value:string}) => c.key === 'master_notify_email')?.value ?? ''
    const coachRoute  = routes?.find((r: {coach_name:string;email:string;notify:boolean}) =>
      r.coach_name === lead.coach_pref && r.notify && r.email
    )

    const toAddresses: string[] = []
    if (coachRoute?.email) toAddresses.push(coachRoute.email)
    if (masterEmail && !toAddresses.includes(masterEmail)) toAddresses.push(masterEmail)

    if (toAddresses.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no recipients configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Axis Training Systems <noreply@axistrainingsystems.com>',
        to: toAddresses,
        subject: `New Application — ${lead.first_name} ${lead.last_name} (${lead.service})`,
        html: buildEmailHtml(lead),
      }),
    })

    if (!emailRes.ok) {
      const err = await emailRes.text()
      throw new Error(`Resend error: ${err}`)
    }

    return new Response(JSON.stringify({ ok: true, recipients: toAddresses }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
