# Security

What the app enforces, what a deep audit found and fixed, and the handful of
things only an operator can do. Read this before pushing the SQL or cutting the
domain over.

The one-line model: **RLS is the security boundary; the UI is signage.** Every
route guard, disabled button and hidden tab exists to turn "an empty screen full
of permission errors" into "an explanation". None of them stops anyone. What
stops people is row-level security, the SECURITY DEFINER functions, and the
triggers — verified against a scratch Postgres reproducing Supabase's real role
and default-privilege setup.

---

## The permission model (559 → Axis)

Ported from the studio platform's design, adapted to Axis's three roles.

- `permissions` — the catalogue: 16 keys, three of them `is_sensitive`.
- `role_permissions` — what each role holds by default. Athlete: nothing. Coach:
  own calendar, own hours, the application queue with contact details, athletes,
  site content, analytics. Admin: everything.
- `staff_permissions` — per-person overrides, either direction.
- `has_permission(key)` — resolves the override first, then the role default,
  then no. An admin short-circuits to yes.

Three properties are database facts, not UI conventions (migration 016):

1. **You cannot grant yourself anything** — not even a permission you already
   hold, because an explicit grant outlives the role that justified it.
2. **You cannot grant what you do not hold.** The set in circulation can spread
   between people but never grow; only an admin introduces one.
3. The grant check reads the role of the stored `granted_by` column, **not**
   `auth.uid()`, so it holds for the service role too — a bug in an edge
   function cannot mint a grant a non-admin could not.

### A permission only means something once a policy adopts it

This is the part that surprises people, and 016 says so in its own comments: a
permission is **inert** until an RLS policy or a trigger is written against it.
Granting a coach `manage_bookings_all` in the portal, today, changes what the UI
offers and nothing a coach can actually do.

Migration **018** is the first adoption, deliberately small and safe:

| Permission | What it now really unlocks |
|---|---|
| `manage_services` | Writing the global service catalog and any coach's offering — the "head coach curates the menu" case. Verified: a granted coach writes the catalog; a plain coach is refused by RLS. |
| `moderate_testimonials` | Approving/rejecting a homepage testimonial (was head-coach-only). |

`manage_pricing` gates pricing **surfaces in the UI** only — splitting "edit the
service row but not its price column" needs a column-comparison trigger, which
is a named follow-up, not a shipped guarantee. The comment in 018 says so; do
not read a database guarantee into it yet.

**The next tranche, and why it is separate.** `view_all_calendars`,
`manage_bookings_all` and `manage_staff` each widen a read or write *across
coaches* — one coach seeing another's clients, phone numbers, notes. Adopting a
permission there is a real transfer of access to personal data, and each gets
its own migration with its own verification rather than a line in a batch. The
pattern is exactly 018's: `using (public.is_axis_admin() or
public.has_permission('<key>'))`, ORed alongside the existing per-coach policy so
it only ever widens.

`usePermissions()` (`src/lib/usePermissions.ts`) is the client hook. It mirrors
the admin short-circuit and falls back to the role default for first paint. It
gates buttons; it never guards data.

---

## Audit — findings fixed

A full adversarial pass ran across the client, the SQL, the edge functions, and
the build/deps. Every finding below was reproduced, fixed, and (for the SQL and
permission work) re-verified by exploit against a scratch database.

### Critical

- **The overlap guard never existed** (008). `booking-create` claimed an
  exclusion constraint settled the double-booking race; no migration created
  one. Added, and it refuses to install over data that already violates it.
- **`revoke … from public` is a no-op on Supabase** (017 F1). Supabase's
  bootstrap grants function EXECUTE to `anon`/`authenticated` *by role name*, so
  every `revoke … from public` in 004–016 did nothing — anon could execute all
  29 SECURITY DEFINER functions, including one returning a coach's encrypted
  Google refresh token and one returning a booking's `manage_token`. Fixed by a
  sweep that revokes from the roles and re-grants an explicit allowlist.
  *(Integration caught that the sweep would have orphaned the permission
  functions — they are now in the allowlist; verified `authenticated` keeps
  `has_permission`.)*
- **`coach_routing`, `leads`, `admin_config` writable/readable by any login**
  (017 F2–F4). Three fail-open or never-locked policies. The `coach_routing` one
  was a full self-promotion chain to admin using only the publishable key. All
  three closed; `admin_config` (which held the Resend key) is now admin-only,
  and the key is write-only in the UI.
- **`send-lead-email` was an open mail relay.** Unauthenticated, wildcard CORS,
  no rate limit, every lead field interpolated into HTML unescaped. Rewritten:
  it may only *name* a lead by id, re-reads and escapes every value, is
  rate-limited and sends once.

### High

- Invite/booking **tokens were written into the analytics table** — redacted to
  `:token` before insert.
- The **Resend API key round-tripped through the browser** — field is now
  write-only.
- **A client price-tamper path** on the booking policy panel — the override is
  no longer sent.
- **Every per-IP rate limit was bypassable** — `requestSubject` trusted the
  client's own `X-Forwarded-For`; now uses the edge-written `cf-connecting-ip`.
- **`booking-notify` was dispatchable by anyone** with the anon key — now
  requires the service-role key or a cron secret.
- **`ilike` wildcard identity match** in `booking-update`/`google-oauth` —
  `ronni_@…` matched `ronnie@…` and inherited their admin flag. Exact
  comparison now.
- The **`auth_all_*` policies** (017 F5) let any account delete any coach's
  schedule — per-coach now.
- A **client read of `coach_notes`/`manage_token`** off `bookings` (017 F6) —
  closed; athletes read a `coach_notes`-free view.

### The GUC bypass (017 F7) and the ticket

The `axis.privileged_write` GUC that lets internal flows write a role past the
clamp was a global mutable string with a published value — not reachable via
PostgREST today, but one refactor from being a self-promotion primitive.
Replaced with an unforgeable per-transaction ticket in schema `private` that no
client role can call. The permission system's own `axis.permission_reset` GUC
was moved onto the same ticket (017 F7c), and the ticket was made re-entrant
after integration surfaced that a self-claim changing a role nests two ticketed
flows. *Verified: a pending athlete setting either GUC and updating their own
profile stays `athlete/pending`.*

### Client, medium/low (17 fixed)

`javascript:` URL guards on every DB-supplied URL; CSV formula-injection in the
newsletter export; the account-enumeration oracle on both old login screens;
email PII out of `localStorage`; length caps and email validation on every form;
mailto header injection; and a correctness bug where `sanitizeEmail`'s escaping
stopped anyone with an apostrophe in their address from signing in.

### Build / deps / headers

`npm audit`: 2 high → 0. Full CSP in `index.html` (meta) and `vercel.json`
(headers). Deploy workflow no longer exposes the OIDC token to `npm ci` scripts.
A Vite base-path bug that served Vercel a blank page, fixed. Honeypot +
time-trap (`src/lib/botTrap.ts`) on all five public forms (apply, booking, and
the three newsletter gates), failing silently.

---

## What only an operator can do

Nothing in the repo can set these, and several are load-bearing for the security
model above.

1. **Email confirmation MUST be on.** Authentication → Providers → Email →
   "Confirm email". `handle_new_user` and the invitation claim now gate on
   `email_confirmed_at` (017 F8); with confirmation off, whoever signs up first
   with an invited coach's address gets that coach's calendar and clients. This
   is the single most important switch.

2. **Move the Resend key out of `admin_config`.** It belongs in the edge
   functions' secret store (`RESEND_API_KEY`), never a table. The UI no longer
   reads it and `admin_config` is admin-only now, but the row should not exist.

3. **`booking-notify` needs the service-role key or `BOOKING_NOTIFY_CRON_SECRET`**
   on its cron call, or it returns 401 and no email is ever sent.

4. **Redirect allow-list + Google provider** in the Supabase dashboard, or every
   OAuth/magic-link/reset bounces to the site root with no session.

5. **Headers only reach users off Wix.** `axistrainingsystems.com` is on Wix
   nameservers today; Wix cannot set custom response headers and GitHub Pages
   never can. The `vercel.json` header set (and the Cloudflare equivalent) is
   live only once the domain points at Vercel or Cloudflare. Until then the site
   is clickjackable — the meta CSP is the ceiling Pages allows.

6. **`corsproxy.io`** (`src/pages/Rankings.tsx`) routes every rankings query
   through an uncontrolled third party. Consider proxying through an edge
   function; the CSP is forced to allow it meanwhile.

---

## Verifying it yourself

A scratch Postgres 17 with a Supabase-shaped stub (the `anon`/`authenticated`/
`service_role` roles, the default privileges that make F1 real, an `auth` schema
whose `uid()`/`email()` read `request.jwt.claims`) applies 001→018 clean and
passes the exploit suite: overlap guard raises 23P01; anon cannot execute any
definer function while `authenticated` keeps `has_permission`; the GUC bypass
leaves a pending athlete pending; a coach cannot grant themselves or forge a
staff invitation; `manage_services` genuinely gates the catalog; the ticket
table is empty after every flow. The harness lives in the migration headers'
`Verify` sections — each is runnable SQL.
