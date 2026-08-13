# Accounts, sign-in, and invitations

Axis is **invite-gated**. Anyone may create an account; nobody gets in without
something vouching for their address.

---

## The shape of it

```
auth.users  ──trigger──▶  profiles     role: athlete | coach | admin
   │                        status: pending | active | suspended
   │                        coach_slug: the calendar, for staff
   │
   ├─ password
   ├─ magic link      all three land on the SAME trigger.
   └─ Google          There is no provider-specific path, so there is no
                      provider-specific way around the gate.
```

`handle_new_user` (011) fires on the `auth.users` insert and decides the status.
Three things can open an account:

1. **A live invitation for that address.** Athletes and staff alike.
2. **A `coach_routing` row for that address.** How the five people already on the
   roster keep working, and how a coach added to the roster later makes their own
   account without needing an invitation.
3. **An admin**, by hand, in the portal.

Everything else lands at `pending` and sees `/pending`.

### Why signup is open when admission is not

Refusing the signup would mean the form has to tell a stranger whether an
invitation exists for an address they typed, which is an invitation oracle. It
would also break the ordinary case: somebody applies, signs up while they wait,
and is accepted afterwards.

---

## The invitation has two halves, and both matter

**The token half.** 32 random bytes, generated in `invite-send`, and only its
SHA-256 reaches the database. The plaintext exists in exactly two places ever:
the link in the email, and the response that created it. A leaked backup or an
over-broad SELECT yields hashes, not working links.

It follows that **a pending invitation's link cannot be re-shown**. "Send a new
link" issues a fresh invitation that supersedes the old one — which is a feature,
because it means a rotated link is also a revoked link.

**The email half.** The row also carries the address in plaintext, and
`handle_new_user` matches on it. This is what makes Google sign-in work: somebody
invited who never opens the link and simply clicks "Continue with Google" a week
later is let straight in.

So the token is what makes the landing page say *"Ronnie invited you to coach"*.
The email is what makes the invitation actually take effect. Neither alone is the
whole system — 559flawless has the first, Fresno Skillshare has the second, and
this has both.

### Who may invite whom, and where that is enforced

| Inviter | May invite |
|---|---|
| `coach` (active) | athletes |
| `admin` (active) | athletes, coaches, admins |
| suspended / pending | nobody |

The rule lives in the **`invitations_before_insert` trigger**, and it checks the
role of `invited_by` rather than of `auth.uid()`. That distinction is the whole
point: `invite-send` inserts with the service role, which bypasses RLS entirely,
so a rule that lived in the function would be a rule one bug could remove.
Triggers fire for the service role too, and `invited_by` is NOT NULL — so there
is no caller, not the anon key, not the service key, not psql, that can produce a
staff invitation attributed to a non-admin.

The RLS policies encode the same rule for callers that *are* subject to RLS. Both
exist on purpose.

### An invitation cannot be edited

`invitations_before_update` raises on any change to the email, the role, the
coach_slug, the token or the expiry. Revoking is the only permitted edit.
Otherwise the tier check could be sidestepped by inserting an athlete invitation
and editing it up to `admin`.

---

## Accepting an application invites the athlete

`leads` has had `new → reviewed → accepted → declined` since 001, and accepting
one never did anything. Now a trigger on the status change (013):

- **already active** → nothing. Re-accepting must not disturb somebody already in.
- **account sitting at `pending`** → activate it directly. An invitation would
  never be seen; `handle_new_user` fires once and theirs has already happened.
- **no account** → leave an invitation.

Failures here are **swallowed**, and this is the one place in the codebase that
does that deliberately. The guards raise for ordinary situations — the address
already has an account, the inviter is suspended — and none of them are a reason
to refuse to accept an application. The lead is the record that matters.

---

## The ordering gap, and how it is closed

`handle_new_user` fires **once**, at signup. Somebody who signs up *before* being
invited would sit at `pending` for ever, because the invitation issued afterwards
is never looked at again.

`claim_pending_invite()` closes it. The `/pending` screen calls it on load and on
"Check again". It takes **no arguments** — the address it matches on is the
signed-in user's own, read server-side — so there is no parameter that says "make
me a coach", only "look again at me".

`/pending` also subscribes to the signed-in user's own profile row, so an admin
activating them takes effect without a reload.

---

## Routes

| Path | What it is |
|---|---|
| `/signin` | Google, password, magic link, sign-up, password reset — one page, five modes |
| `/auth/callback` | Where every provider returns. Waits for the session, then routes by role |
| `/invite/<token>` | The invitation landing page. Previews who invited you, then signs you in |
| `/pending` | Signed in, not yet admitted |
| `/account` | The athlete's own bookings |
| `/admin` | Master portal — admins |
| `/admin/<slug>` | A coach's own portal |

`homeFor(profile)` in `src/lib/authRoute.ts` is the single answer to "where does
this person belong". Status is tested before role: a suspended admin is not an
admin, and sending them to a portal produces an empty screen full of permission
errors instead of the sentence explaining why.

`?next=` is validated by `safeNext` — an unvalidated `next` on a sign-in page is
a phishing primitive, and `//evil.com` is the case a naive `startsWith('/')`
misses.

---

## Setting it up

### 1. Migrations

```bash
supabase db push     # 007 (fixed), 008, 009, 010, 011, 012, 013
```

**007 had never applied.** Two defects stopped it, both found by running the
chain rather than reading it:

- `ends_at` was declared `generated always as (booked_at + make_interval(...))`.
  The `+` operator on `timestamptz` is only STABLE — an interval carrying months
  or days must be resolved against the session TimeZone — and a generated column
  requires an immutable expression. Postgres rejected the ALTER, and since the
  file is one transaction, everything after it too. It now goes through
  `booking_ends_at()`, an immutable wrapper that is honest: an interval built
  from minutes alone genuinely is zone-independent.
- `on conflict (booking_id)` could not infer `coach_calendar_busy_booking_idx`,
  which is a **partial** unique index — inference requires the statement to
  repeat the predicate. One occurrence was inside `bookings_mirror_to_busy`, so
  it would have failed on **every booking insert**.

If your database somehow does have parts of 007, everything in it is
`if not exists` / `or replace` and re-running is a no-op.

**Read the backfill in 011 §7 before running it.** It is the step that decides
whether the portals survive the migration: `is_content_admin()` and
`current_coach_slug()` are rewired to read `profiles`, and every existing auth
user has no row until the backfill makes one. Afterwards, verify:

```sql
select email, role, status, coach_slug
  from public.profiles where coach_slug is not null order by coach_slug;
```

Every coach must be there and `active`. If one is missing they cannot open their
portal — fix it by hand before anyone notices.

Anyone in `auth.users` who is *not* on the roster becomes a pending athlete.
That is correct for an invite-gated site, but a test account made in the
dashboard lands there too.

### 2. Google

Supabase dashboard → **Authentication → Providers → Google**. Client ID and
secret come from Google Cloud, and Supabase's own callback
(`https://<ref>.supabase.co/auth/v1/callback`) must be an authorised redirect URI
on the Google side.

### 3. Redirect allow-list

**Authentication → URL Configuration → Redirect URLs.** Add every origin the app
is served from, with the callback path:

```
https://axistrainingsystems.com/auth/callback
http://localhost:5173/auth/callback
```

A missing entry here is the single most common failure: the sign-in appears to
work, the browser comes back, and no session is created. `/auth/callback` has a
timeout branch that says exactly this rather than spinning.

### 4. Function and secrets

```bash
supabase functions deploy invite-send      # verify_jwt stays ON
supabase secrets set SITE_URL=https://axistrainingsystems.com
```

`invite-send` reuses `RESEND_API_KEY` and `BOOKING_FROM_EMAIL` from the booking
system. Without a Resend key the invitation is still **created and still
effective** — the email match does not need the mail to have arrived — and the
panel shows the link so it can be sent by hand.

---

## Things worth knowing

- **`security_invoker` on `my_bookings`.** RLS is row-level and cannot withhold a
  column, so a policy letting a client read their own booking row also hands them
  `coach_notes` — the coach's private assessment of the person reading it. The
  view is the projection; the policy underneath is still what decides which rows.
- **The `axis.privileged_write` bypass.** `profiles_guard_privileges` clamps
  `role`, `status` and `coach_slug` for any non-admin writer, which is what stops
  the sensible "update your own profile" policy from also being "make yourself an
  admin". Three definer functions set a transaction-local bypass immediately
  before one UPDATE and clear it immediately after. `set_config(..., true)` is
  transaction-scoped and cannot leak.
- **Route guards are signage, not security.** Every table is governed by RLS
  written against `current_coach_slug()` and `is_axis_admin()`. `useRequireRole`
  exists so an athlete who reaches `/admin` gets an explanation instead of a dozen
  silently empty panels.

## Still missing

- **No user-management screen.** An admin can change a role only in SQL. The
  policy and the guard are both in place for one; the UI is not built.
- **No suspension UI** for the same reason, though `status = 'suspended'` is
  honoured everywhere, including by `/pending`.
- **Athletes see bookings and nothing else.** No programming, no messaging, no
  intake forms.
