-- ============================================================
-- Axis Training Systems, 035: somewhere to put a photo
-- ============================================================
--
-- Every image this site renders is a URL somebody pasted. The testimonial
-- editors ask for a "Photo URL", the coach profile manager asks for two more,
-- and the blog has no image affordance at all. That worked while the only
-- photographs in play were already hosted somewhere else, and it stopped
-- working the moment the answer to "where do I put this?" became "upload it to
-- Imgur first, then come back". A coach with a photo on their phone has no
-- pasteable URL, and the honest description of the current flow is that the
-- product does not accept photographs.
--
-- This file is the storage half of the fix. It creates one public bucket,
-- decides who may write into it, and adds the one column the blog needs so a
-- post can carry a cover image. The client half (`src/lib/mediaUpload.ts` and
-- `src/components/dashboard/PhotoUpload.tsx`) is what the editors call.
--
--
-- WHY ONE BUCKET AND NOT THREE. Testimonial faces, blog covers and coach
-- portraits are the same kind of object with the same audience: a public image
-- rendered on a public page, uploaded by staff. Three buckets would be three
-- copies of the same four policies, and the only thing they would separate is
-- something a folder prefix already separates. `mediaUpload.ts` writes into
-- `testimonials/`, `blog/` and `coaches/`, so a listing per surface is a prefix
-- query rather than a different bucket. If one of these ever needs a different
-- rule (private athlete photos, say), that is a new bucket with its own file,
-- not a renegotiation of this one.
--
-- WHY PUBLIC. The images are rendered by anonymous visitors on the homepage,
-- the coach pages and the blog. A private bucket means every one of those
-- renders needs a signed URL with an expiry, which means the public site cannot
-- be statically cached and a stale page shows broken images. The bucket holds
-- nothing that is not already on a public page by the time it matters.
--
-- Public has one consequence worth stating plainly, because it is the thing
-- that surprises people: for a public bucket, reads through
-- `/storage/v1/object/public/<bucket>/<path>` do not consult RLS at all. The
-- SELECT policy in section 2 is not what makes the photographs visible. It is
-- what lets a signed-in session list and probe objects through the authenticated
-- endpoint, which is what the upload path itself does. Anyone holding a URL can
-- fetch the object, which is the definition of public and is the point.
--
-- Unguessable names are therefore load-bearing rather than cosmetic.
-- `mediaUpload.ts` names every object `<folder>/<uuidv4>.<ext>` and never uses
-- the file's own name: the original name is often a person's name, and a
-- predictable path in a public bucket is an enumeration handle.
--
-- THE SIZE AND TYPE LIMITS ARE SET IN TWO PLACES ON PURPOSE. The bucket carries
-- `file_size_limit` and `allowed_mime_types`, and `mediaUpload.ts` carries
-- `MAX_UPLOAD_BYTES` and `ALLOWED_UPLOAD_TYPES` with the same values. The client
-- pair exists to say "that photo is too big" in a sentence before spending a
-- coach's upload bandwidth; the bucket pair exists because the client is not a
-- security boundary and a direct POST to the storage API skips it entirely.
-- Neither is redundant. If you change one, change both: the numbers are 5 MB and
-- (image/jpeg, image/png, image/webp).
--
-- WebP is on the list and AVIF is not, deliberately. WebP is what a modern phone
-- or export tool produces and every browser this site supports renders it. AVIF
-- is fine too, and can be added to both lists the day something actually emits
-- it; an allowlist that grows on demand is the correct shape for this.
--
--
-- ⚠ THE CSP IS PART OF THIS CHANGE. A Storage public URL is
-- `https://<project-ref>.supabase.co/storage/v1/object/public/...`, and before
-- this round `img-src` allowed four image hosts, none of them Supabase. Uploads
-- would have succeeded and every uploaded photograph would have rendered as a
-- broken image with a console violation. `https://*.supabase.co` is added to
-- `img-src` in BOTH copies of the policy, `index.html` (the meta tag) and
-- `vercel.json` (the header), in the same change as this file. If this database
-- is ever fronted by a custom storage domain, that host needs adding to both
-- copies as well.
--
-- `ALLOWED_PHOTO_HOSTS` in `src/data/testimonials.ts` is the client-side mirror
-- of that list and gains `supabase.co` in the same change, plus `blob:` so demo
-- mode's local previews pass their own guard.
--
--
-- ⚠ SECTION 2 MAY REFUSE TO RUN, AND THAT IS HANDLED RATHER THAN FATAL.
-- `storage.objects` is owned by `supabase_storage_admin`, not by the role that
-- applies these files, and whether `postgres` may add a policy to it varies by
-- project age and by how the SQL is being applied. Only the owner (or a
-- superuser) may CREATE POLICY on a table. So section 2 runs inside a guarded
-- block: on `insufficient_privilege` it raises a notice and the file continues
-- rather than taking the whole migration down over a permission this file cannot
-- grant itself.
--
-- If you see that notice, the four policies have to be created by hand and
-- NOTHING UPLOADS UNTIL THEY ARE. Two ways, either is fine:
--
--   1. Dashboard. Storage → Policies → `storage.objects` → New policy → For full
--      customization. Create four, with the names and expressions section 2
--      spells out, one per command (SELECT, INSERT, UPDATE, DELETE).
--   2. SQL editor as the owner. Run section 2's four statements after
--      `set role supabase_storage_admin;` (the SQL editor connects as a role
--      that is normally a member of it), then `reset role;`.
--
-- Section 4's verify block has the query that says whether they landed.
--
-- The bucket insert in section 1 carries the same guard for the same reason,
-- with the same consequence: no bucket, no uploads. Its manual step is Storage →
-- New bucket, named `site-media`, public on, 5 MB limit, those three MIME types.
--
--
-- THE BLOG COVER COLUMN, and the trap under it. `pending_content` (004) is where
-- blog posts live, and it has no image field of any kind. Section 3 adds
-- `cover_image`, and the load-bearing line in that section is not the ALTER, it
-- is the grant. 017 F9 revoked the blanket grant on this table and gave `anon` a
-- COLUMN LIST, which means a column added later is invisible to the public site
-- until it is named in a grant of its own. 020 hit this first and left the
-- precedent: "The public read grant (005 narrowed anon to specific columns) must
-- include the new column or the blog page cannot read the slug it is now keyed
-- on." A `select id,title,cover_image,...` as `anon` with `cover_image` missing
-- from that list does not silently return null. It 403s, and it takes the whole
-- request with it, so the symptom is not a missing cover image, it is an empty
-- blog.
--
-- ORDERING HAZARD, the same one 034 catalogues. 017 F9 re-issues the `anon`
-- column grant on `pending_content` from scratch, so replaying 017 by hand after
-- this file drops both `slug` (020) and `cover_image` (this file) from it and
-- 403s the public blog. Applying the directory in filename order is fine.
-- Running 017 alone is not: re-apply 020 and this file after it.
--
-- Requires the full chain through 034_linter_hardening.sql.
--
-- Re-runnable.
-- ============================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────
--
-- Three probes, each for a thing this file assumes exists and cannot create.
-- `storage.buckets` is absent on a plain PostgreSQL database with no Supabase
-- Storage extension set up, and section 1 would fail on it with a bare "relation
-- does not exist". `pending_content` is 004. `is_axis_staff()` is 016 and is the
-- entire write gate in section 2, so a database missing it would end up with
-- policies that fail open at CREATE time rather than closed.

do $do$
begin
  if to_regclass('storage.buckets') is null then
    raise exception
      'Supabase Storage is not set up on this database (storage.buckets is missing). Enable Storage before 035_site_media.sql.'
      using errcode = '22023';
  end if;
  if to_regclass('public.pending_content') is null then
    raise exception
      'Run 004_pending_content.sql before 035_site_media.sql.'
      using errcode = '22023';
  end if;
  if to_regprocedure('public.is_axis_staff()') is null then
    raise exception
      'Run 016_permissions.sql before 035_site_media.sql (public.is_axis_staff() is the write gate in section 2).'
      using errcode = '22023';
  end if;
end
$do$;


-- ── 1. The bucket ───────────────────────────────────────────────────────────
--
-- One row in `storage.buckets`. `on conflict (id) do update` rather than `do
-- nothing`, because the limits are the point of the row and this file is the
-- statement of what they are: a second run repairs a bucket somebody widened by
-- hand in the dashboard. `name` is not in the update list because it is the id
-- here and changing it under a live bucket is not a repair, and `owner` is left
-- alone for the same reason.
--
-- 5242880 is 5 * 1024 * 1024, written out rather than computed so the value in
-- the table and the value in `MAX_UPLOAD_BYTES` can be compared by eye.
--
-- Guarded for the reason the header gives: `storage.buckets` is not this role's
-- table on every project, and a permission this file cannot grant itself must
-- not be the thing that stops 035 from applying. The notice is written to be
-- actionable on its own, because it may be read out of context in a migration
-- log.

do $do$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('site-media', 'site-media', true, 5242880,
          array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public             = true,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  raise notice '035: bucket site-media exists, public, 5 MB, jpeg/png/webp.';
exception
  when insufficient_privilege then
    raise notice '035: could NOT create the site-media bucket (permission denied on storage.buckets). NOTHING UPLOADS UNTIL IT EXISTS. Create it by hand: Storage -> New bucket, name site-media, Public bucket ON, file size limit 5 MB, allowed MIME types image/jpeg, image/png, image/webp.';
  when others then
    raise notice '035: could NOT create the site-media bucket (% / %). NOTHING UPLOADS UNTIL IT EXISTS. See the header for the manual step.',
      sqlstate, sqlerrm;
end
$do$;


-- ── 2. Who may write into it ────────────────────────────────────────────────
--
-- Four policies on `storage.objects`, all scoped to `bucket_id = 'site-media'`
-- so nothing here can touch an object in another bucket.
--
--   read    anon + authenticated, any object in this bucket. As the header says,
--           this is not what makes the public URLs work (a public bucket serves
--           those without consulting RLS). It is what lets a session list the
--           bucket and lets the upload path check its own work.
--   insert  authenticated AND `public.is_axis_staff()`. Uploading is a staff
--           action: a coach adding a testimonial photo, an admin editing a
--           profile. An athlete has a signed-in session and no business writing
--           into the site's image bucket.
--   update  the same gate on both sides. `upsert` on an existing path is an
--           UPDATE to storage, and `mediaUpload.ts` never upserts (its names are
--           uuids), but a policy that allows an insert and forbids the update
--           produces a confusing partial failure on any client that does.
--   delete  the same gate. Nothing in the app deletes objects yet: removing a
--           photo from a testimonial clears the column and leaves the file, which
--           is the safe default, because two testimonials can point at one file
--           and the app has no reference count. A sweep of unreferenced objects
--           is a later job and it needs this policy to exist.
--
-- WHY `is_axis_staff()` AND NOT `current_coach_slug() is not null`. The
-- distinction matters for admins who are not coaches: `is_axis_staff()` (016) is
-- role-based and covers coach and admin alike, where the coach-slug test would
-- lock a non-coaching administrator out of the coach profile editor's own photo
-- field. It is also the function three other policies in this schema already use
-- for exactly this question, and it keeps its grant to `authenticated` (034
-- section 4 names it), which a function referenced from a policy must.
--
-- RLS IS ALREADY ENABLED ON `storage.objects` BY SUPABASE. This block adds
-- policies and does not touch the table: `alter table storage.objects enable row
-- level security` would need ownership this role may not have, and would be a
-- no-op on every database where it would succeed.
--
-- EXECUTE with dollar-quoted strings rather than bare DDL inside plpgsql. The
-- statements are utility commands with column names in their expressions, and
-- passing them as literal text is the form that cannot be affected by name
-- resolution inside the block.
--
-- The names are the sentences a reviewer reads in the dashboard policy list, so
-- they say who and what rather than `policy_1`.

do $do$
begin
  execute $sql$ drop policy if exists "site media is publicly readable" on storage.objects $sql$;
  execute $sql$ drop policy if exists "signed in users read site media rows" on storage.objects $sql$;
  -- SELECT is metadata access: it is what the list endpoint reads. Public URL
  -- downloads bypass RLS entirely on a public bucket, so anon needs no row
  -- here, and granting it would let anyone with the publishable key page
  -- every object name, defeating the unguessable-uuid defence the header
  -- calls load-bearing. Authenticated keeps it so the upload path can see
  -- its own result.
  execute $sql$
    create policy "signed in users read site media rows"
      on storage.objects for select to authenticated
      using (bucket_id = 'site-media')
  $sql$;

  execute $sql$ drop policy if exists "axis staff upload site media" on storage.objects $sql$;
  execute $sql$
    create policy "axis staff upload site media"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'site-media' and public.is_axis_staff())
  $sql$;

  execute $sql$ drop policy if exists "axis staff replace site media" on storage.objects $sql$;
  -- Replace and delete are owner-or-senior: any staff member may add media,
  -- but only the uploader, an admin, or a manage_staff holder may overwrite
  -- or remove an object someone else placed. storage.objects records owner.
  execute $sql$
    create policy "axis staff replace site media"
      on storage.objects for update to authenticated
      using      (bucket_id = 'site-media' and public.is_axis_staff()
                  and (owner = auth.uid() or public.is_axis_admin() or public.has_permission('manage_staff')))
      with check (bucket_id = 'site-media' and public.is_axis_staff()
                  and (owner = auth.uid() or public.is_axis_admin() or public.has_permission('manage_staff')))
  $sql$;

  execute $sql$ drop policy if exists "axis staff delete site media" on storage.objects $sql$;
  execute $sql$
    create policy "axis staff delete site media"
      on storage.objects for delete to authenticated
      using (bucket_id = 'site-media' and public.is_axis_staff()
             and (owner = auth.uid() or public.is_axis_admin() or public.has_permission('manage_staff')))
  $sql$;

  raise notice '035: four storage.objects policies for site-media are in place.';
exception
  when insufficient_privilege then
    raise notice '035: could NOT create the storage.objects policies (permission denied; storage.objects is owned by supabase_storage_admin). NOTHING UPLOADS UNTIL THEY EXIST. Create the four by hand per the header of this file: read to authenticated using bucket_id = ''site-media''; insert to authenticated with is_axis_staff(); update/delete to authenticated with is_axis_staff() and (owner = auth.uid() or admin or manage_staff).';
  when others then
    raise notice '035: could NOT create the storage.objects policies (% / %). NOTHING UPLOADS UNTIL THEY EXIST. See the header for the manual steps.',
      sqlstate, sqlerrm;
end
$do$;


-- ── 3. A blog post gets a cover image ───────────────────────────────────────
--
-- Nullable, because every post that exists today has no cover and none of them
-- is broken by that. `BlogPost.coverImage` has been in `src/data/blog.ts` since
-- the beginning and is set on exactly one static post; this is the column that
-- lets a database post carry the same thing.

alter table public.pending_content
  add column if not exists cover_image text;

-- The shape check is 032's URL check, verbatim: an absolute http(s) URL, or a
-- site-relative path that is not protocol-relative (`/x` yes, `//evil.com` no).
-- It is a shape test and not a safety boundary. The safety boundary is
-- `safeUrl()` on the way in and out of `contentApi.ts`, which is what stops a
-- `javascript:` from reaching an `img src`; this constraint is what stops a
-- typo from being stored at all.
--
-- The length bound is deliberately LOOSER than the client's. `contentApi.ts`
-- caps this field at 1000 characters before it writes, matching
-- `FIELD_MAX.photo` on testimonials, so a client behaving correctly never
-- reaches 2000 and never sees a constraint violation instead of a friendly
-- message. The constraint is the backstop for a direct PostgREST write by a
-- signed-in coach, where "unbounded text on a table anon reads" is the thing
-- being prevented rather than a bad URL.
--
-- Dropped and recreated rather than `add constraint if not exists` (which does
-- not exist for constraints), which is also how 020 made its slug check
-- re-runnable.

alter table public.pending_content drop constraint if exists pending_content_cover_image_shape;
alter table public.pending_content add constraint pending_content_cover_image_shape
  check (
    cover_image is null
    or (cover_image ~* '^https?://|^/[^/]' and char_length(cover_image) <= 2000)
  );

-- THE GRANTS. Read the header before changing either line.
--
-- `anon` holds a COLUMN LIST on this table (017 F9), so a new column is
-- unreadable by the public site until it is named. This is the same one-line fix
-- 020 made for `slug`, in the same form, and forgetting it does not degrade the
-- blog, it 403s it.
grant select (cover_image) on public.pending_content to anon;

-- `authenticated` holds table-level SELECT/INSERT/UPDATE/DELETE (017 F9), and a
-- table-level grant covers columns added afterwards, so this line changes
-- nothing on a database where 017 ran. It is restated because the pair of grants
-- is the mechanism, and a reader arriving at this section should see both halves
-- of it rather than infer the second from a file eighteen numbers back. It is
-- also what repairs a database where somebody narrowed this role to a column
-- list by hand.
grant select, insert, update, delete on public.pending_content to authenticated;


-- ── 4. Verify ───────────────────────────────────────────────────────────────
--
-- Section 1. The bucket exists and carries its limits:
--
--   select id, public, file_size_limit, allowed_mime_types
--     from storage.buckets where id = 'site-media';
--   -- one row: public t, 5242880, {image/jpeg,image/png,image/webp}
--
-- Section 2. Four policies, and the roles and commands they carry:
--
--   select policyname, cmd, roles
--     from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like '%site media%'
--    order by policyname;
--   -- 4 rows, all {authenticated}: SELECT / INSERT / UPDATE / DELETE.
--   -- No anon row: public downloads bypass RLS on a public bucket, and a
--   -- SELECT row for anon would make the bucket listable with the anon key.
--
-- If that returns zero rows, section 2 hit the permission wall. The apply-time
-- notice says so, and the header says what to do about it.
--
-- Now the gate itself. Objects arrive through the Storage API rather than
-- through SQL, so the thing to check from psql is the predicate the three write
-- policies share, evaluated as the two sessions that matter:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a coach uuid>';
--     select public.is_axis_staff();                       -- t, may upload
--   rollback;
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<an athlete uuid>';
--     select public.is_axis_staff();                       -- f, may not
--   rollback;
--
-- End to end, from the browser, which is the test that actually matters and the
-- one to run before believing any of the above: sign in as a coach, open the
-- coach portal's testimonials manager, upload a JPG under 5 MB. It must appear
-- in the preview, the saved row's `photo` must be an
-- `https://<ref>.supabase.co/storage/v1/object/public/site-media/testimonials/<uuid>.jpg`,
-- and the photograph must RENDER on `/coaches/<slug>` in a private window. That
-- last clause is the CSP assertion: if the image is broken with a
-- `Refused to load the image` violation in the console, `img-src` did not get
-- `https://*.supabase.co` in one of the two files that carry it.
--
-- And the refusals:
--
--   -- a 6 MB file      -> refused by mediaUpload.ts before the request
--   -- a .gif           -> refused by mediaUpload.ts, and by the bucket if forced
--   -- an athlete session -> "new row violates row-level security policy"
--
-- Section 3. The column, the constraint and the two grants:
--
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'pending_content'
--      and column_name = 'cover_image';                    -- 1 row, text
--
--   select conname, pg_get_constraintdef(oid) from pg_catalog.pg_constraint
--    where conrelid = 'public.pending_content'::regclass
--      and conname = 'pending_content_cover_image_shape';  -- 1 row
--
--   -- the shape check bites
--   insert into public.pending_content (type, coach_slug, coach_name, cover_image)
--   values ('blog', 'x', 'X', 'javascript:alert(1)');
--   -- ERROR: violates check constraint "pending_content_cover_image_shape"
--   insert into public.pending_content (type, coach_slug, coach_name, cover_image)
--   values ('blog', 'x', 'X', '//evil.example/a.png');
--   -- ERROR: same
--
-- THE GRANT, which is the line most likely to be dropped by a later edit and the
-- most expensive one to get wrong. This must list `cover_image` AND `slug`:
--
--   select column_name, privilege_type
--     from information_schema.column_privileges
--    where table_name = 'pending_content' and grantee = 'anon'
--    order by column_name;
--
-- and the read the public blog actually issues must work as `anon`:
--
--   begin;
--     set local role anon;
--     select id, title, cover_image, slug
--       from public.pending_content
--      where type = 'blog' and status = 'approved';        -- rows, not 42501
--   rollback;
--
-- Re-runnability, last. Applying this file twice must change nothing:
--
--   \i supabase/migrations/035_site_media.sql
--   select count(*) from storage.buckets where id = 'site-media';        -- 1
--   select count(*) from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like '%site media%';                               -- 4
--
-- Re-runnable.
-- ============================================================
