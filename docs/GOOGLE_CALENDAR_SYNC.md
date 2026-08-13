# Google Calendar Sync — Operator Setup Guide

This is the one-time setup that makes the Axis booking system talk to each coach's real
Google Calendar, in both directions:

- **Import** — anything already on a coach's Google Calendar (a flight, a dentist, another
  client) makes the matching slot disappear from `/book`.
- **Export** — when a client books on the site, a real event appears on that coach's Google
  Calendar, with the client invited and a Google Meet link attached. Confirming or
  cancelling the booking in the coach portal updates or deletes that event.

You do this **once**, as the site owner. After that each coach connects their own Google
account with two clicks from their own portal — you never touch their password and you
never see their calendar.

Total time: about 30–40 minutes, most of it waiting on Google's console.

---

## Before you start

Have these three things open:

1. **Google Cloud Console** — <https://console.cloud.google.com> (sign in with the Google
   account that should *own* the Axis app; use the Axis business account, not a personal one).
2. **Supabase dashboard** — <https://app.supabase.com>, the Axis project.
3. **A terminal** in the repo root, with the Supabase CLI installed and logged in:

   ```bash
   npm install -g supabase       # if you don't have it
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```

**Your project ref** is the random-looking string in your Supabase URL. If your project URL
is `https://abcdefghijklmnop.supabase.co`, then `YOUR_PROJECT_REF` is `abcdefghijklmnop`.
Write it down — you will paste it into Google in Step 1.6, and it must match **exactly**.

Throughout this guide, replace:

| Placeholder | With |
|---|---|
| `YOUR_PROJECT_REF` | your Supabase project ref, e.g. `abcdefghijklmnop` |
| `https://axistrainingsystems.com` | your real production site origin |

---

## 1. Google Cloud Console

### 1.1 Create the project

1. Go to <https://console.cloud.google.com>.
2. Top bar → the project dropdown → **New Project**.
3. Name: `Axis Training Systems`. Leave "Location / Organization" as-is.
4. **Create**, then make sure the project dropdown at the top now says `Axis Training Systems`.
   Everything below happens *inside that project*. If you ever see an unexpected screen,
   check the dropdown first — being in the wrong project is the #1 cause of confusion here.

### 1.2 Enable the Google Calendar API

1. Left sidebar → **APIs & Services** → **Library**.
2. Search for `Google Calendar API`.
3. Click it → **Enable**.

Nothing else needs enabling. (Google Meet links are produced by the Calendar API itself; there
is no separate "Meet API" to turn on.)

### 1.3 OAuth consent screen

1. Left sidebar → **APIs & Services** → **OAuth consent screen**.
2. User type: **External**. → **Create**.
   *"External" is correct even though only your coaches will use it. "Internal" is only
   available if every coach has an email address inside a Google Workspace domain that you
   own and administer. If that is genuinely true for you, choose Internal — it skips the
   verification problem entirely (§1.5).*
3. App information:
   - **App name**: `Axis Training Systems`
   - **User support email**: your email
   - **App logo**: optional. Uploading one triggers a separate logo review — skip it for now.
4. App domain (fill these in; Google requires them before it will let you submit for
   verification later):
   - **Application home page**: `https://axistrainingsystems.com`
   - **Privacy policy link**: `https://axistrainingsystems.com/privacy`
   - **Terms of service link**: `https://axistrainingsystems.com/terms`
5. **Authorized domains**: add `axistrainingsystems.com` **and** `supabase.co`
   (the OAuth redirect lands on a Supabase URL, so Google needs that domain authorized).
6. **Developer contact information**: your email.
7. **Save and continue**.

### 1.4 Scopes — the exact two to add

On the **Scopes** step click **Add or remove scopes**, then paste each of these into the
"manually add scopes" box at the bottom and click **Add to table**:

```
https://www.googleapis.com/auth/calendar.freebusy
https://www.googleapis.com/auth/calendar.events
```

That is the complete list. Two scopes, nothing else.

| Scope | Why we need it | What it lets Axis do |
|---|---|---|
| `calendar.freebusy` | Import (busy times) | Ask Google "is this coach busy between 09:00 and 10:00?" and get back **only** `busy: [{start, end}]`. No event titles, no guests, no locations, no descriptions. This is deliberate: we call the `freeBusy` endpoint, not `events.list`, so the *content* of a coach's calendar never enters Axis at all and therefore can never leak from Axis. |
| `calendar.events` | Export (booking events) | Create / update / delete the calendar events that Axis itself creates for bookings. |

> If the scope picker refuses `calendar.freebusy` (Google occasionally omits it from the
> table for new projects), use `https://www.googleapis.com/auth/calendar.readonly` instead
> and tell the engineer — it is a *broader* read scope that also permits `freeBusy`, and it
> is the only supported substitution.

**Save and continue.**

### 1.5 These scopes are SENSITIVE — read this part carefully

Google classifies both Calendar scopes as **sensitive**. That has real consequences and you
must pick one of two paths:

**Path A — Testing mode (start here).**
Leave the app's *Publishing status* as **Testing**. On the consent screen's **Test users**
step, click **+ Add users** and add the **Google account email of every coach** who will
connect a calendar (plus your own). Limit: 100 test users — far more than you need.

- Only listed test users can connect at all. Anyone else gets `Error 403: access_denied`.
- Coaches will see a scary **"Google hasn't verified this app"** screen. They click
  **Advanced** → **Go to Axis Training Systems (unsafe)** to continue. It is your app; this
  is expected.
- **The catch that will bite you:** in Testing mode, Google expires refresh tokens after
  **7 days**. Every coach must reconnect their calendar weekly, and their sync will silently
  fall back to "not connected" until they do (the portal will show it). This is fine for a
  week of piloting. It is not fine forever.

**Path B — Publish + verify (do this before real coaches rely on it).**
On the OAuth consent screen, click **Publish app** → status becomes *In production*. Then
**Submit for verification** (Google will ask for a YouTube video showing the consent flow and
a justification for each scope — say "we read only free/busy intervals to avoid
double-booking, and write only the events our own booking form creates").

- Publishing **stops the 7-day refresh-token expiry immediately**, even while verification is
  still pending. This alone is worth doing on day one.
- Until verification is *granted*, coaches still see the "unverified app" screen and you are
  capped at 100 users. After it's granted, the warning disappears.
- Review typically takes a few days to a few weeks.

**Recommended:** add your coaches as Test Users now, confirm end-to-end that it works, then
**Publish** (Path B) the same day so nobody has to reconnect every Monday.

### 1.6 Create the OAuth Client ID

1. Left sidebar → **APIs & Services** → **Credentials**.
2. **+ Create credentials** → **OAuth client ID**.
3. **Application type: Web application** (not "Desktop", not "TV" — Web application).
4. Name: `Axis Website`.
5. **Authorized JavaScript origins** — leave **empty**. The browser never talks to Google
   directly; our server does.
6. **Authorized redirect URIs** → **+ Add URI**, and paste exactly this, with your project
   ref substituted:

   ```
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/google-oauth-callback
   ```

   Real example: `https://abcdefghijklmnop.supabase.co/functions/v1/google-oauth-callback`

   This string must match, character for character, the `GOOGLE_REDIRECT_URI` secret you set
   in Step 2.2. No trailing slash. `https`, never `http`. If they differ by so much as one
   character, every connection attempt dies with `redirect_uri_mismatch`.

7. **Create**. Google shows you a **Client ID** and a **Client secret**.

   Copy both into a password manager now. The **client secret** is a credential: it never goes
   into the repo, never into `.env`, never into any `VITE_*` variable, never into a Slack
   message. It is pasted **only** into Supabase Function Secrets in the next step.

---

## 2. Supabase

### 2.1 Apply the migrations

The calendar work ships as two migrations:

- `supabase/migrations/006_google_calendar_sync.sql` — the calendar tables
  (`coach_calendar_busy`, `coach_public_settings`, the outbox, the private token store) and
  the `bookings` exclusion constraint that makes double-booking impossible at the database
  level.
- `supabase/migrations/007_grants.sql` — tightens table/column grants (applied later; it is
  independent of Google and can go out whenever).

From the repo root:

```bash
supabase db push
```

That applies every migration that isn't already on the remote, in order. To see what it
*would* do first:

```bash
supabase migration list
```

If you prefer clicking: Supabase dashboard → **SQL Editor** → paste the contents of
`006_google_calendar_sync.sql` → **Run**. Same result. Do not run a migration twice.

**Set each coach's time zone.** Everything in the booking system is wall-clock time in the
*coach's* zone, and the coach's zone lives in `coach_public_settings.time_zone`. A coach with
no row there cannot be booked correctly. In the SQL Editor:

```sql
insert into coach_public_settings (coach_slug, time_zone)
values ('gabriel', 'America/New_York'),
       ('some-other-coach', 'America/Los_Angeles')
on conflict (coach_slug) do update set time_zone = excluded.time_zone;
```

Use IANA names (`America/New_York`, `Europe/London`, `America/Denver`) — not `EST`, not
`GMT-5`. IANA names know about daylight saving; the abbreviations don't.

### 2.2 Set the secrets

These are **Supabase Function Secrets** — server-side only, readable by the Edge Functions and
by nobody else. Dashboard route: **Project Settings** → **Edge Functions** → **Secrets**. Or
from the terminal:

```bash
supabase secrets set \
  GOOGLE_CLIENT_ID="1234567890-abcdefg.apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="GOCSPX-xxxxxxxxxxxxxxxxxxxx" \
  GOOGLE_REDIRECT_URI="https://YOUR_PROJECT_REF.supabase.co/functions/v1/google-oauth-callback" \
  TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  ALLOWED_ORIGINS="https://axistrainingsystems.com,http://localhost:5173" \
  SITE_URL="https://axistrainingsystems.com"
```

| Secret | What it is |
|---|---|
| `GOOGLE_CLIENT_ID` | From Step 1.6. Not secret in the cryptographic sense, but it lives here anyway. |
| `GOOGLE_CLIENT_SECRET` | From Step 1.6. **Never** prefix this with `VITE_`. Anything named `VITE_*` is compiled into the JavaScript bundle and served to every visitor. |
| `GOOGLE_REDIRECT_URI` | Byte-for-byte identical to the URI you pasted into Google in Step 1.6. |
| `TOKEN_ENCRYPTION_KEY` | A 32-byte random key, base64. Encrypts each coach's Google refresh token (AES-256-GCM) *before* it is written to the database. Generate it with the `openssl rand -base64 32` shown above and **save a copy in your password manager** — if you lose it, every coach must reconnect; if you *rotate* it, same thing. |
| `ALLOWED_ORIGINS` | Comma-separated list of origins allowed to call the functions from a browser. Include your production origin and, if you develop locally, `http://localhost:5173`. Do not put `*` here. |
| `SITE_URL` | Where the OAuth callback sends the coach back to when they're done. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are **already available** inside every Edge
Function — Supabase injects them. Do not set them yourself. In fact you *can't*: the platform
rejects any secret whose name starts with `SUPABASE_`. If you see
`Env name cannot start with SUPABASE_`, that's why — you are trying to set a reserved name.

### 2.3 Deploy the Edge Functions

```bash
supabase functions deploy google-oauth-start
supabase functions deploy google-oauth-callback --no-verify-jwt
supabase functions deploy calendar-sync
supabase functions deploy booking-create
```

The `--no-verify-jwt` flag on **`google-oauth-callback` only** is not optional and not
sloppiness. That endpoint is the URL *Google's servers* redirect the coach's browser to after
consent, and Google does not attach a Supabase JWT to it. With JWT verification on, the
platform would reject the request before our code ran and OAuth could never complete. The
function authenticates the request itself, by looking up the single-use `state` value it
generated moments earlier — an attacker cannot forge one.

Every other function verifies its caller's JWT normally.

`supabase/functions/_shared/` is a library (CORS allowlist, Google client, crypto). It is not
a function and is not deployed on its own; it ships inside the functions that import it.

Verify the deploy landed:

```bash
supabase functions list
```

### 2.4 Add the redirect origin to Google — sanity check

Open the redirect URI in a browser:
`https://YOUR_PROJECT_REF.supabase.co/functions/v1/google-oauth-callback`

You should get a short error like `{"error":"bad_request"}` — that is **correct**. It means the
function is live and refused a request with no OAuth `state`. A `404` means the function name
is wrong or it never deployed. A `401` means you forgot `--no-verify-jwt`.

---

## 3. Turn on the periodic sync (pg_cron)

Importing busy times is a poll: every 15 minutes a job asks Google for each connected coach's
free/busy window and refreshes `coach_calendar_busy`. The same job drains the outbox — the
queue of "create this event / cancel that event" jobs produced by bookings — so a booking made
while Google was down still lands on the calendar a few minutes later.

In the Supabase dashboard → **SQL Editor**, run this **once**:

```sql
create extension if not exists pg_cron  with schema extensions;
create extension if not exists pg_net   with schema extensions;

select cron.schedule(
  'calendar-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/calendar-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

`YOUR_SERVICE_ROLE_KEY` is in **Project Settings → API → service_role**. It is the most
powerful key you have — it bypasses every row-level security policy. It belongs in this one
SQL statement and nowhere else. Never in `.env`, never in the frontend.

Check it registered, and check it's running:

```sql
select jobid, schedule, jobname, active from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
```

To run it right now instead of waiting 15 minutes, just paste the inner `select net.http_post(...)`
into the SQL Editor and run it.

To change the interval later: `select cron.unschedule('calendar-sync');` then re-run the
`cron.schedule` above with a new cron expression (`*/5 * * * *` = every 5 minutes).

---

## 4. For coaches — connecting a calendar

Send them this section verbatim.

**To connect:**

1. Sign in to your Axis coach portal: `https://axistrainingsystems.com/admin/your-slug`
2. Open the **Calendar** tab.
3. Click **Connect Google Calendar**.
4. Choose the Google account whose calendar you actually live out of.
5. You may see a screen saying **"Google hasn't verified this app"**. Click **Advanced**,
   then **Go to Axis Training Systems (unsafe)**. This is our own app — the warning just
   means Google's review is still in progress.
6. Google will ask you to allow two things: seeing when you're free/busy, and managing events.
   Click **Continue** / **Allow**.
7. You land back in the portal and the tab now says **Connected**, with the time of the last
   sync.

**What Axis reads.** Only your **busy intervals** — start time and end time, nothing else.
Not the title of the meeting, not who's attending, not the notes, not the location. Google's
free/busy service literally does not return those to us. A block on your calendar at 2pm
Thursday tells Axis "2pm Thursday is unavailable" and nothing more, and that's the only
reason it disappears from your public booking page.

**What Axis writes.** Only the events Axis itself creates for bookings — one per booked
session, with the client as an invitee and a Google Meet link. It updates that event if the
booking changes and deletes it if the booking is cancelled. It will never touch, edit, or
delete an event you created.

**To disconnect.** Portal → **Calendar** tab → **Disconnect**. This deletes our stored copy of
your Google credential and clears your imported busy times immediately. Your public booking
page keeps working off your Axis weekly schedule and manual blocks, exactly as it did before
you connected — but your Google events will no longer protect you from being booked over.
Existing calendar events that Axis created stay on your calendar; delete them by hand if you
want them gone.

You can also revoke access from Google's side at any time:
<https://myaccount.google.com/permissions> → *Axis Training Systems* → **Remove access**. The
portal notices within a sync cycle and shows you as disconnected.

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| **"Google hasn't verified this app"** on the consent screen | Expected. The app is in Testing, or Published but not yet verified, and Calendar scopes are *sensitive*. | Coach clicks **Advanced → Go to Axis Training Systems (unsafe)**. To remove the warning permanently, complete OAuth verification (§1.5, Path B). |
| **`Error 403: access_denied`**, coach never reaches the consent screen | App is in **Testing** and that coach's Google address isn't on the Test Users list. | Google Cloud → OAuth consent screen → **Test users** → **+ Add users** → their exact Google email. Or publish the app. |
| **`invalid_grant`** in the function logs; a coach who *was* connected shows as disconnected | The refresh token is dead. Almost always one of: (a) the app is still in **Testing**, where Google expires refresh tokens after **7 days**; (b) the coach revoked access at myaccount.google.com; (c) they changed their Google password; (d) `TOKEN_ENCRYPTION_KEY` was rotated or lost, so we can't decrypt what we stored. | Coach clicks **Connect Google Calendar** again — one click, they're back. To stop it recurring: **Publish** the app (§1.5). If it was (d), everyone must reconnect; restore the old key from your password manager if you still have it. |
| **`redirect_uri_mismatch`** the moment consent is granted | The URI in Google's OAuth client ≠ the `GOOGLE_REDIRECT_URI` secret. Usually a trailing slash, `http` vs `https`, or the wrong project ref. | Put them side by side and compare character by character: Google Cloud → Credentials → your Web client → *Authorized redirect URIs*, vs `supabase secrets list`. Must be `https://YOUR_PROJECT_REF.supabase.co/functions/v1/google-oauth-callback`. Google can take a few minutes to propagate a change. |
| **Coach adds an event in Google, but the slot is still bookable on the site** | The importer polls; it is not instant. Give it up to 15 minutes. If it never clears: the coach isn't connected; or the event is on a *secondary* calendar (we read `primary` only); or the event is marked **Free** rather than **Busy** in Google (free/busy deliberately ignores it); or the cron job is failing. | `select * from cron.job_run_details order by start_time desc limit 5;` and check the `calendar-sync` function logs in the Supabase dashboard. To force a poll, run the `net.http_post` from §3 by hand. Tell the coach to set the event's visibility/availability to **Busy** and put it on their main calendar. |
| **Slot disappeared but the coach has nothing there** | An event marked Busy that they don't think of as a commitment (all-day "Vacation", a birthday from a shared calendar) still counts as busy. | Expected behaviour. Mark it **Free** in Google, or remove the offending calendar from the account's primary view. |
| **Client didn't get the calendar invite** | Three usual causes: it went to spam; the client typed their email wrong at booking; or the outbox job hasn't run yet / is failing. | Check the booking row's `google_sync_status` in the dashboard. `pending` → wait for the next cron tick. `error` → read `google_sync_error` and the `calendar-sync` logs. `synced` → the event exists; the invite is in the client's spam folder, or their address is wrong. The coach can always re-send the invite from Google Calendar directly, or forward the Meet link from the booking. |
| **Coach connected, but no Meet link on the event** | Meet links are only issued for events on a Google account that has Meet enabled (all consumer and most Workspace accounts do). Rare. | The booking still stands; the coach can add a Meet link with one click in Google Calendar. |
| **Booking page says a slot is taken the instant someone else books it** | Working as intended. The database has an exclusion constraint: two people cannot hold the same coach at the same instant, no matter how simultaneously they click. The loser sees a "just taken" message and picks another slot. | Nothing to fix. |
| **Everything is broken right after deploy — every function 401s** | You are calling functions from an origin that isn't in `ALLOWED_ORIGINS`, or you deployed the OAuth callback without `--no-verify-jwt`. | `supabase secrets list`, fix `ALLOWED_ORIGINS`; redeploy the callback with the flag. |

Where the logs are: Supabase dashboard → **Edge Functions** → pick the function → **Logs**.
They contain status codes and error codes only — never a token, never a calendar's contents.

---

## 6. How it works (the 90-second version)

```
                 ┌──────────── every 15 min (pg_cron) ────────────┐
                 │                                                │
  Google Cal ──freeBusy──▶ calendar-sync ──▶ coach_calendar_busy ─┼─▶ /book page
  (coach's)                     │                                 │   (public, no PII)
                                │                                 │
                                └── drains outbox ──▶ Google Cal ─┘
                                         ▲
  Client books ──▶ booking-create ──▶ bookings (committed first)
                                  └──▶ calendar_outbox (job queued)
```

- **The public booking page never reads the `bookings` table and never talks to Google.** It
  computes open slots from the coach's weekly schedule, their manual blocks, and the busy
  intervals we imported — start/end times only, zero personal information on the wire.
- **Bookings are committed to our database first, and Google is updated afterwards** through
  an outbox queue. So a Google outage, an expired token, or a coach who has *never connected
  Google at all* can never fail a booking. "Not connected" is a fully supported state, not an
  error: the booking simply records `google_sync_status = 'skipped'` and everything else works
  identically.
- **Double-booking is impossible at the database layer**, not merely unlikely — a Postgres
  exclusion constraint rejects the second write for the same coach and instant.
- **Times are stored as absolute instants.** A coach's schedule is wall-clock in *their* zone
  (`coach_public_settings.time_zone`); anything sent to Google or compared against Google
  carries an explicit time zone. A client in London and a coach in Denver see the same slot.

## 7. Security note — where the tokens live

When a coach connects, Google hands us a **refresh token**: a long-lived credential that can
mint access tokens to their calendar. It is the most sensitive thing this system holds.

- It is encrypted with **AES-256-GCM** *before* it is written to the database. The key
  (`TOKEN_ENCRYPTION_KEY`) lives in Supabase Function Secrets — **outside** the database.
  A stolen database dump, or even a leaked `service_role` key, yields ciphertext.
- The row lives in a **`private` schema** that the `anon` and `authenticated` roles have no
  `USAGE` on and no `SELECT` grant on, with row-level security enabled and **zero policies**.
  Four independent gates, any one of which alone would be sufficient.
- The only thing the coach portal can ask about their connection is a no-argument function,
  `calendar_connection_status()`, which derives *which coach is asking* from their verified
  login — not from anything the browser sends. It returns "connected / last synced / errored"
  and never any part of the credential. There is no code path, authenticated or otherwise,
  that returns a token to a browser.
- We hold no calendar *content*. Free/busy returns intervals; we store intervals. Even total
  compromise of this database reveals when a coach is busy, not what they were doing.

If you ever suspect the encryption key leaked: generate a new one
(`openssl rand -base64 32`), set it with `supabase secrets set TOKEN_ENCRYPTION_KEY=...`, and
have every coach press **Connect Google Calendar** once. Old ciphertext becomes unreadable,
which is exactly what you want.

---

## Appendix — what goes where

| Value | Lives in | Never lives in |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `.env` (local), Vercel env vars (prod). Public by design — they are shipped in the browser bundle and protected by row-level security. | — |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`, `ALLOWED_ORIGINS`, `SITE_URL` | Supabase **Function Secrets** only. | `.env`, the repo, Vercel, any `VITE_*` name, any Slack thread. |
| `service_role` key | The one pg_cron SQL statement in §3. Injected automatically into Edge Functions. | `.env`, the repo, the frontend, anywhere. |

The rule that matters: **anything named `VITE_*` is public.** Vite substitutes it into the
JavaScript that every visitor downloads. Putting `GOOGLE_CLIENT_SECRET` behind a `VITE_`
prefix would publish it to the internet, and Google would be right to revoke it.
