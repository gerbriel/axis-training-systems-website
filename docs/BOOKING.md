# The booking system

How `/book` works, what it guarantees, and the order things must be deployed in.

---

## The four rules

### 1. The double-booking guard is a database constraint

`bookings_no_overlap` (migration 008) is an exclusion constraint on
`(coach_slug, tstzrange(booked_at, ends_at))` where `status <> 'cancelled'`.
Application code checks availability so the UI can render sensibly; **the
constraint is what makes it true.** Two clients that both pass validation race
into the insert, exactly one commits, the loser gets SQLSTATE `23P01`, which
`booking-create` turns into a 409 `slot_taken`.

This constraint did not exist until 008. `booking-create` had claimed it did
since the day it was written and its `23P01` branch was unreachable code, so two
requests for the same instant could both commit. If you are ever tempted to
"optimise away" the availability re-check, the constraint still holds; if you
are tempted to drop the constraint because the check looks sufficient, it is not.

A **pending** booking holds its slot exactly as a confirmed one does. That is
what makes "your coach will confirm within 24 hours" honest. Cancelling is what
releases it.

### 2. The client never supplies a duration or a price

A booking request names *which* service. `priceService()` reads the length and
the price out of `booking_services`, applies any per-coach override from
`coach_booking_services`, and computes the slot from that. A request carrying a
`duration_minutes` is answering a question it was not asked.

`coach_schedules.slot_duration_minutes` means **how often a slot may start**, not
how long a booking is. It is the granularity of the grid — 9:00, 9:30, 10:00 —
and the service decides how much of that grid one booking consumes. A 45-minute
session on a 30-minute grid takes 9:00–9:45 and the 9:30 start is not offered.

A coach with no `coach_booking_services` rows is a supported state: the window's
own length is used as both step and duration, which is exactly the behaviour
that predates the catalog. Nobody goes dark on deploy.

### 3. Wall clock vs. instants

`coach_schedules.start_time`, `coach_availability_blocks.*` and `block_date` are
**wall-clock in the coach's IANA zone**. Everything stored, compared, or sent to
Google is an absolute instant.

All conversion goes through `_shared/tz.ts` (server) or `src/lib/tz.ts`
(browser). No `setHours`, no `setDate`, no `toISOString().split('T')[0]`.

The corollary that bites: a calendar-grid day is a **coach-zone** day. "Today"
has to be the coach's today, and a slot rendered in the visitor's zone can fall
on a different calendar day than the header it sits under — which is why the
time buttons name their own date when the two disagree.

### 4. An outage is not an empty calendar

`loadAvailability` returns the string `'unavailable'` when a read fails, and
`booking-availability` turns that into a **503**, never an empty week. The
booking page renders a retry panel for it.

"Nothing is open" and "we could not find out" are different facts and send a
visitor to very different places. The page used to have no way to say the second
one: it called the availability fetch with a bare `.then()` over a loader that
throws, so any hiccup left "Loading availability…" on screen for ever.

---

## The pieces

```
src/
  pages/BookPage.tsx            service → coach → time → details
  pages/ManageBookingPage.tsx   /booking/<manage_token>
  lib/availability.ts           calls booking-availability; demo-mode fallback
  lib/services.ts               the catalog, per coach
  lib/bookingManage.ts          typed client for booking-manage
  lib/ics.ts                    "add to calendar" in the browser
  pages/coach-admin/BookingPolicyPanel.tsx   services + policy, in the portal

supabase/functions/
  _shared/slots.ts        THE slot algorithm (mirrored by lib/availability for demo)
  _shared/booking.ts      loadCoachPolicy / priceService / loadAvailability / rate limit
  _shared/mirror.ts       Google Calendar upsert / reschedule / cancel
  _shared/ics.ts          the invite attached to booking emails
  booking-availability    open slots, computed server-side          (no JWT)
  booking-create          the only public write path into bookings  (no JWT)
  booking-manage          the client's cancel / reschedule          (no JWT)
  booking-update          the coach's confirm / cancel / move       (JWT)
  booking-notify          drains the notification queue, then       (cron)
                          retries pending Google syncs (Meet links)
```

### Why availability moved to the server

The browser used to compute slots, which meant downloading — over the anon key,
which ships in the Vite bundle — the coach's whole weekly schedule, their date
blocks, and ten weeks of `coach_calendar_busy`. That is every instant a coach is
busy, whether that is a client or a dentist, readable by anyone who opens
devtools. What leaves the building now is a list of times that are open.

It also closes the gap between what the page offers and what the server accepts:
`booking-create` re-derives through the same module.

---

## Deploy order

The migrations are additive and safe to apply before the functions, **except**
that 008 will refuse to install if overlapping bookings already exist. It names
every offending pair; cancel one of each and re-run.

```bash
# 1. Schema
supabase db push        # 008, 009, 010

# 2. Secrets (Project Settings → Edge Functions → Secrets)
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set SITE_URL=https://axistrainingsystems.com
supabase secrets set BOOKING_FROM_EMAIL='Axis Training Systems <noreply@axistrainingsystems.com>'
supabase secrets set RATE_LIMIT_SALT="$(openssl rand -hex 16)"

# 3. Functions
supabase functions deploy booking-availability --no-verify-jwt
supabase functions deploy booking-create       --no-verify-jwt
supabase functions deploy booking-manage       --no-verify-jwt
supabase functions deploy booking-update
supabase functions deploy booking-notify

# 4. Frontend
git push    # GitHub Pages workflow builds and deploys
```

`SITE_URL` must include any base path the site is served under — it is what
builds the "manage your booking" link in every email, and a wrong value means
every client gets a dead link.

### The cron nobody remembers

`booking-notify` is not self-scheduling. Without this, the queue fills and
nothing is ever sent — no confirmations, no reminders, no cancellation notices.
Run once in the SQL editor:

```sql
select cron.schedule(
  'booking-notify', '*/5 * * * *',
  $$ select net.http_post(
       url     := 'https://<project-ref>.supabase.co/functions/v1/booking-notify',
       headers := jsonb_build_object('Authorization', 'Bearer ' || '<service-role-key>')
     ) $$
);
```

Five minutes is what makes the reminder times real: a "2 hours before" queued for
07:00 goes out somewhere in 07:00–07:05, which is what anyone means by two hours.

---

## Notifications

Migration 010's trigger computes the send times **once**, when the booking
changes. The dispatcher does not re-derive them, so there is no second opinion
about what "24 hours before" means.

| kind | when | to |
|---|---|---|
| `confirmation` | immediately | client |
| `coach_alert` | immediately | coach, if `coach_routing.notify` |
| `confirmed` | when the coach accepts a pending booking | client |
| `reminder_24h` | 24 h before | client |
| `reminder_2h` | 2 h before | client |
| `reschedule` | on a move | client + coach |
| `cancellation` | on a cancel | client + coach |

Two rules do the work:

- **Idempotency is a unique index, not a flag.** A cron that fires twice, or a
  dispatcher poked by hand mid-sweep, collides on
  `(booking_id, kind, channel, recipient, scheduled_for)` and the second insert
  is a no-op. `recipient` is in that key because a cancellation goes to two
  people at the same instant with the same kind.
- **Work is claimed, not selected.** `claim_booking_notifications` takes a row
  lock with `for update skip locked` and counts the attempt at claim time. A
  dispatcher that crashes mid-send has burned the attempt, which is what stops a
  message that reliably kills the sender from retrying for ever. Five attempts
  and it stops being swept — the row stays, unsent, with its last error.

A reminder for a cancelled or moved booking is **deleted**, not filtered at send
time. A queue you have to remember to read carefully eventually mails somebody
about a call that is not happening.

---

## Self-service

There are no client accounts. The credential is `bookings.manage_token`: one
`gen_random_uuid()` per booking, in the confirmation email and on the
confirmation screen, and nowhere else — `bookings` is revoked from `anon` in full
(005), so `booking-manage` is the only reader.

It is a bearer token. Anyone holding the link can cancel that booking, which is
the same exposure as forwarding your own confirmation email.

A client may cancel or move up to **2 hours** before the call, and move at most
**3 times**. Both limits are decided by the server and returned as `can_cancel` /
`can_reschedule`; the page renders them rather than re-deriving them, so a
disabled button and a 409 can never disagree about the same booking.

A reschedule is re-derived exactly as a new booking is — matched against
regenerated availability in the coach's zone, with the exclusion constraint
settling the race. A client moving their own call cannot land it outside the
coach's hours, on a block, or on top of somebody else.

---

## Rate limits

`rate_limit_hit(bucket, subject, window_seconds, limit)` is a fixed window in one
atomic upsert. The subject is a **salted SHA-256 of the caller's address** — a
rate-limit table is not a place to keep a log of who visited.

| endpoint | budget | on limiter failure |
|---|---|---|
| `booking-availability` | 60 / min / IP | **open** — it is a read |
| `booking-create` | 5 / hour / IP, 6 / day / email | **closed** |
| `booking-manage` read | 30 / min / IP | open |
| `booking-manage` write | 10 / hour / IP | **closed** |

The writes fail closed on purpose. Most limiters wave requests through when the
limiter is broken; these guard writes to a real calendar that send real email, so
a limiter that cannot count is a reason to refuse.

---

## Things that are still missing

- **No waitlist.** A fully-booked month says "look further ahead" and offers the
  next window. There is nowhere to record that somebody wanted a slot that was
  not there.
- **No deposits.** There is no money anywhere in this system, so there is nothing
  protecting against a no-show beyond the reminders.
- **The Google outbox is write-only legacy.** `google_sync_outbox` is filled by
  the mirror trigger (007) and nothing empties it. Every write path does a
  synchronous best-effort mirror, and since round 5 the booking-notify cron
  also sweeps bookings stuck at `google_sync_status = 'pending'` (five per run,
  seven-day window), so a transient Google failure heals within minutes. A push
  that never succeeds inside that window is abandoned: the booking stays
  correct, the calendar event is simply absent, and terminal failures are
  marked `failed` with a code in `google_sync_error`. The legacy table itself
  is inert and safe to drop in a later migration.
- **`booking-notify` is email-only.** No SMS. The queue carries a `channel`
  column and rejects anything that is not `email`; adding a sender means widening
  that check and writing the worker, not reshaping any of this.
