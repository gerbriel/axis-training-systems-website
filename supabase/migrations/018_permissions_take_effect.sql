-- ============================================================
-- Axis Training Systems — 018: the permissions take effect
-- ============================================================
--
-- 016 built the permission system and 016's own comments are honest about what
-- it does NOT do: "has_permission() gates exactly what is written against it and
-- nothing else. Until a policy adopts it, a permission is inert." As shipped,
-- an admin can grant a coach `manage_services` in the portal and it changes
-- nothing — the grant is recorded and the catalog's RLS still says admin-only.
--
-- This file is the first policy adoption, and it is deliberately SMALL. It
-- covers the two capabilities that are the clearest answer to "an admin setting
-- a head coach should be able to hold" and that touch no cross-coach PII:
--
--   * managing what Axis offers and what it costs — the service catalog;
--   * approving what appears on the public homepage — testimonial moderation.
--
-- What is NOT here, and why. `view_all_calendars`, `manage_bookings_all` and
-- `manage_staff` all widen a read or write ACROSS coaches — one coach seeing
-- another's clients, their phone numbers, their notes. Adopting a permission
-- into those policies is a real transfer of access to personal data and each
-- deserves its own migration with its own verification, not a line in a batch.
-- The pattern below is exactly what those will follow; this proves it on the
-- safe surface first.
--
-- `is_content_admin()` resolves to `is_axis_admin()` since 011, so every policy
-- that still names it already means "an active admin". The new clauses widen
-- those policies; they never narrow them, so an admin keeps everything.
--
-- Re-runnable.
-- ============================================================


-- ── 1. The service catalog ──────────────────────────────────────────────────
--
-- `booking_services` is the global menu — which services exist, their standard
-- length and price. `coach_booking_services` is each coach's offering of them,
-- carrying the per-coach duration and price overrides.
--
-- Before this, both were admin-only to write (009), except a coach could edit
-- their OWN offering row via `coach_write_own_services`. The head-coach case —
-- one senior coach who curates the menu and the pricing for the whole roster —
-- had no home: they are not an admin, and the catalog is not "their own" row.
--
-- `manage_services` is that home. A coach granted it may write the global
-- catalog and any coach's offering, exactly as an admin can. The grant is the
-- transfer; the policy is what makes the grant mean something.
--
-- `manage_pricing` is deliberately NOT split out at the row level here. A
-- service row bundles name, duration and price, and "may edit the row but not
-- its price column" is a column-level rule that RLS cannot express — it needs a
-- trigger comparing old.price_cents to new. That trigger is worth writing, and
-- it is a separate change; until then `manage_services` is the single gate on
-- the catalog and `manage_pricing` gates the pricing SURFACES in the UI only.
-- Said plainly so nobody reads a security guarantee into the pricing permission
-- that the database is not yet making.

drop policy if exists "manage_services writes catalog" on public.booking_services;
create policy "manage_services writes catalog"
  on public.booking_services for all to authenticated
  using (public.is_axis_admin() or public.has_permission('manage_services'))
  with check (public.is_axis_admin() or public.has_permission('manage_services'));

-- The owning-coach and admin policies from 009 stay. This adds the head coach:
-- somebody with manage_services may write ANY coach's offering, not only their
-- own. Postgres ORs multiple permissive policies, so this widens without
-- touching the other two.
drop policy if exists "manage_services writes offerings" on public.coach_booking_services;
create policy "manage_services writes offerings"
  on public.coach_booking_services for all to authenticated
  using (public.is_axis_admin() or public.has_permission('manage_services'))
  with check (public.is_axis_admin() or public.has_permission('manage_services'));


-- ── 2. Testimonial moderation ───────────────────────────────────────────────
--
-- `guard_testimonial_main_status` (006) is what stops a coach putting their own
-- testimonial on the homepage: only the head coach may set `main_status` to
-- approved or rejected, enforced in a trigger because RLS cannot see that the
-- column changed. It has admitted exactly `is_content_admin()`.
--
-- `moderate_testimonials` widens that to a coach the admin has trusted with it.
-- The body is 006's, verbatim, with the one predicate widened — the reason it
-- is reproduced here rather than edited in place is that 006 has its own verify
-- block and story, and this keeps the adoption legible as one change.

create or replace function public.guard_testimonial_main_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Unchanged main_status, or a brand-new row that is not being published, is
  -- nobody's business but the owning coach's — 006's own logic, preserved.
  if tg_op = 'UPDATE' and new.main_status is not distinct from old.main_status then
    return new;
  end if;

  if new.main_status in ('approved', 'rejected') then
    -- WAS: is_content_admin() alone. NOW: that, or a coach explicitly granted
    -- the moderation permission. is_content_admin() resolves to is_axis_admin()
    -- (011), so the admin path is unchanged.
    if public.is_content_admin() or public.has_permission('moderate_testimonials') then
      return new;
    end if;
    raise exception 'Only the head coach can approve or reject a main-page testimonial';
  end if;

  return new;
end $$;

revoke all on function public.guard_testimonial_main_status() from public, anon, authenticated;


-- ── 3. Verify ───────────────────────────────────────────────────────────────
--
-- With a coach who has been granted manage_services (as an admin, through
-- set_staff_permission), acting as that coach:
--
--   -- may now write the catalog
--   insert into public.booking_services (slug, name, duration_minutes)
--   values ('test-svc', 'Test', 30);                       -- succeeds
--
-- And a coach WITHOUT it is still refused by RLS (0 rows written, no error from
-- PostgREST — the insert simply violates the policy):
--
--   -- as a plain coach
--   insert into public.booking_services (slug, name, duration_minutes)
--   values ('nope', 'Nope', 30);                           -- 0 rows / 42501
--
-- Testimonial moderation, as a coach granted moderate_testimonials, on somebody
-- else's testimonial row:
--
--   update public.coach_testimonials set main_status = 'approved' where id = '<x>';
--   -- succeeds; without the grant: 'Only the head coach can approve...'
