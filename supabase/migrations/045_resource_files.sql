-- ============================================================
-- Axis Training Systems, 045: somewhere to put a PDF
-- ============================================================
--
-- 041 turned the free resources area into a table, and gave the owner a
-- `download` kind whose whole payload is `{ url, file_label }`. It did not say
-- where that URL comes from. Today the honest answer is "host the PDF somewhere
-- else first, then paste the link", which is the same sentence 035 was written
-- to delete for photographs, said again about documents. A guide with a
-- checklist attached, or a standalone downloadable worksheet, is a file the
-- owner has on a laptop, and the product does not currently accept it.
--
-- This file is the storage half of the fix: one public bucket for the files
-- that hang off resource library rows. The client half is
-- `src/lib/resourceFiles.ts` (validation, naming, upload) and
-- `src/components/admin/AttachmentManager.tsx` (the control the guide editors
-- and the library panel mount).
--
--
-- WHY A NEW BUCKET AND NOT `site-media`. 035's own header sets the rule: one
-- bucket per set of rules, and "if one of these ever needs a different rule,
-- that is a new bucket with its own file, not a renegotiation of this one."
-- Three rules differ here, and each is load bearing:
--
--   1. THE CAP IS BIGGER. site-media is 5 MB because it holds photographs and a
--      phone photo that needs more than 5 MB needs resizing, not permission. A
--      20 page PDF with images in it is routinely 8 to 15 MB, and a checklist
--      the owner cannot upload is a feature that does not work. 20 MB.
--   2. THE TYPE LIST IS WIDER, and that is the point of the feature rather than
--      an accident of it. PDFs, the three web image formats, CSV, and both Word
--      types. Widening site-media to carry them would have made "the image
--      bucket" a lie and handed every coach a document uploader nobody asked
--      for.
--   3. THE WRITE GATE IS NARROWER. site-media admits all staff, because a coach
--      editing their own profile photo is the common case. This bucket admits
--      admins and holders of `manage_resource_library` only: a file here exists
--      to be referenced by a `resource_library` row, and 041 gates writing those
--      rows on exactly that key. The file rides the same authority as the row
--      that points at it. A coach who cannot publish a resource has no reason
--      to be able to put a document on the public internet under our domain.
--
--
-- WHY PUBLIC. A download link on /guides is followed by anonymous visitors, and
-- a private bucket means a signed URL with an expiry on every render, which
-- means the public page cannot be cached and a stale card offers a dead link.
-- The bucket holds what the owner has decided to publish.
--
-- Public has the same consequence 035 spells out and it is worth repeating in
-- the file that a reader will actually have open: on a public bucket, reads
-- through `/storage/v1/object/public/<bucket>/<path>` DO NOT CONSULT RLS. The
-- SELECT policy below is not what makes a download work. It is what lets a
-- signed-in staff session list and probe objects through the authenticated
-- endpoint, which is what the upload path itself does.
--
-- So unguessable names are load bearing here too, and slightly more so than for
-- photographs. `resourceFiles.ts` names every object `files/<uuid>.<ext>` and
-- never uses the file's own name. A user supplied name in a public bucket is an
-- enumeration handle, and the names people give documents are worse than the
-- names they give photographs: `axis-pricing-2026-DRAFT.docx`,
-- `client-list.csv`. The extension comes from the MIME type and never from the
-- name, for the same reason and because a `.pdf` that is not a PDF should not
-- get to name itself.
--
-- A FILE THAT IS UPLOADED BUT NEVER PUBLISHED IS STILL FETCHABLE by anyone who
-- has the URL, because that is what a public bucket is. Nothing here is a place
-- to put something confidential. The admin UI says so, and this comment is the
-- database's copy of that sentence: if a resource ever needs to be private, it
-- needs a private bucket and signed URLs, not a policy edit on this one.
--
--
-- THE LIMITS ARE SET IN TWO PLACES ON PURPOSE, the same deliberate duplication
-- 035 carries. The bucket has `file_size_limit` and `allowed_mime_types`;
-- `resourceFiles.ts` has `RESOURCE_FILE_MAX_MB` and its own type list with the
-- same values. The client copy exists to refuse a file in a sentence before
-- spending the owner's upload bandwidth. The bucket copy exists because the
-- client is not a boundary, it is a courtesy, and a direct POST to the storage
-- API skips it entirely. If you change one, change both. The numbers are 20 MB
-- and these seven types:
--
--     application/pdf
--     image/jpeg
--     image/png
--     image/webp
--     text/csv
--     application/msword
--     application/vnd.openxmlformats-officedocument.wordprocessingml.document
--
-- ONE TYPE IS DELIBERATELY ABSENT AND COSTS A LINE OF CLIENT CODE. Windows
-- hands a `.csv` over as `application/vnd.ms-excel` often enough to matter, and
-- some browsers hand it over with no type at all. That type is NOT added here,
-- because `application/vnd.ms-excel` is also what a real `.xls` binary is, and
-- this bucket has no business accepting Excel workbooks. Instead
-- `resourceFiles.ts` recognises that exact case by the `.csv` extension and
-- REWRITES the content type to `text/csv` on the way up, so what lands in the
-- bucket is honestly labelled and passes this allow-list. If the client copy of
-- that fallback is ever deleted, the symptom is "some CSVs will not upload",
-- and this paragraph is the explanation.
--
--
-- SECTIONS 1 AND 2 MAY REFUSE TO RUN, AND THAT IS HANDLED RATHER THAN FATAL.
-- `storage.buckets` and `storage.objects` are owned by `supabase_storage_admin`,
-- not by the role that applies these files, and whether `postgres` may write
-- them varies by project age and by how the SQL is being applied. Hosted
-- projects frequently refuse storage DDL from the SQL editor. Both sections run
-- inside guarded blocks: on `insufficient_privilege` they raise an actionable
-- notice and the file continues, rather than leaving a half applied migration
-- and taking the chain down over a permission this file cannot grant itself.
--
-- IF YOU SEE THOSE NOTICES, NOTHING UPLOADS UNTIL THE MANUAL STEPS ARE DONE:
--
--   THE BUCKET. Storage, New bucket, name `resource-files`, Public bucket ON,
--   file size limit 20 MB, allowed MIME types: the seven listed above.
--
--   THE POLICIES. Storage, Policies, `storage.objects`, New policy, For full
--   customization. Create four, one per command, with the names and expressions
--   section 2 spells out. Or, in the SQL editor, run section 2's statements
--   after `set role supabase_storage_admin;` and then `reset role;`.
--
-- Section 3's verify block has the query that says whether they landed.
--
-- Requires 011 (is_axis_admin), 016 (has_permission) and 041 (the library rows
-- these files hang off, and the permission key the policies read).
--
-- Re-runnable.
-- ============================================================


-- ── 0. Preconditions ────────────────────────────────────────────────────────
--
-- Four probes, each for something this file assumes and cannot create.
-- `storage.buckets` is absent on a plain PostgreSQL database with no Supabase
-- Storage extension, and section 1 would fail on it with a bare "relation does
-- not exist". The two helper functions ARE the write gate in section 2, and a
-- database missing either would end up with policies that fail at CREATE time
-- rather than closed. `resource_library` is 041: the files this bucket holds
-- exist to be referenced from that table's `config`, and a bucket with nothing
-- to attach to is a half installed feature rather than a working one.

do $do$
begin
  if to_regclass('storage.buckets') is null then
    raise exception
      'Supabase Storage is not set up on this database (storage.buckets is missing). Enable Storage before 045_resource_files.sql.'
      using errcode = '22023';
  end if;
  if to_regprocedure('public.is_axis_admin()') is null then
    raise exception
      'Run 011_identity.sql before 045_resource_files.sql (public.is_axis_admin() is half the write gate in section 2).'
      using errcode = '22023';
  end if;
  if to_regprocedure('public.has_permission(text)') is null then
    raise exception
      'Run 016_permissions.sql before 045_resource_files.sql (public.has_permission() is half the write gate in section 2).'
      using errcode = '22023';
  end if;
  if to_regclass('public.resource_library') is null then
    raise exception
      'Run 041_resource_library.sql before 045_resource_files.sql (these files are attachments on those rows, and manage_resource_library is the key the policies read).'
      using errcode = '22023';
  end if;
end
$do$;


-- ── 1. The bucket ───────────────────────────────────────────────────────────
--
-- One row in `storage.buckets`. `on conflict (id) do update` rather than `do
-- nothing`, following 035: the limits are the point of the row and this file is
-- the statement of what they are, so a second run repairs a bucket somebody
-- widened by hand in the dashboard. `name` is not in the update list because it
-- is the id here and changing it under a live bucket is not a repair, and
-- `owner` is left alone for the same reason.
--
-- 20971520 is 20 * 1024 * 1024, written out rather than computed so the value in
-- the table and the value of `RESOURCE_FILE_MAX_MB` in `resourceFiles.ts` can be
-- compared by eye.
--
-- The MIME array is the allow-list in full. It grows on demand and never by
-- guess: the day something legitimate needs to be attached (a `.pptx`, a
-- `.xlsx`), it goes in this array and in the client's list in the same change.

do $do$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('resource-files', 'resource-files', true, 20971520,
          array[
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
            'text/csv',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          ])
  on conflict (id) do update
    set public             = true,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  raise notice '045: bucket resource-files exists, public, 20 MB, pdf/jpeg/png/webp/csv/doc/docx.';
exception
  when insufficient_privilege then
    raise notice '045: could NOT create the resource-files bucket (permission denied on storage.buckets). NOTHING UPLOADS UNTIL IT EXISTS. Create it by hand: Storage -> New bucket, name resource-files, Public bucket ON, file size limit 20 MB, allowed MIME types application/pdf, image/jpeg, image/png, image/webp, text/csv, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document.';
  when others then
    raise notice '045: could NOT create the resource-files bucket (% / %). NOTHING UPLOADS UNTIL IT EXISTS. See the header for the manual step.',
      sqlstate, sqlerrm;
end
$do$;


-- ── 2. Who may write into it ────────────────────────────────────────────────
--
-- Four policies on `storage.objects`, every one of them scoped to
-- `bucket_id = 'resource-files'` so nothing here can reach an object in
-- site-media or anywhere else.
--
-- The staff set, used by all four, is the same one 041 gates the rows on:
--
--     public.is_axis_admin() or public.has_permission('manage_resource_library')
--
--   read    THE SAME STAFF SET, and no anon row. Two halves to this, and both
--           matter. Anon is absent for 037's reason: a SELECT policy here is
--           METADATA access, it is what the list endpoint reads, and public URL
--           downloads bypass RLS entirely on a public bucket, so anon gains
--           nothing legitimate from a row and gains listing from it. Anyone with
--           the publishable key could page every object name and turn each into
--           a fetchable URL, which defeats the unguessable-uuid naming the
--           header calls load bearing and exposes the files of unpublished
--           rows. Authenticated is narrowed to the staff set rather than left
--           open, because "the manager lists what it uploaded" is the only
--           legitimate read here and an athlete's session is not doing it.
--   insert  the staff set. This is the narrowing 035's `is_axis_staff()` would
--           not give us, and it is the third of the three reasons this is a
--           separate bucket.
--   update  owner or senior. An upsert on an existing path is an UPDATE to
--           storage, and `resourceFiles.ts` never upserts (its names are uuids),
--           but a policy that allows the insert and forbids the update produces
--           a confusing partial failure on any client that does.
--   delete  owner or senior, and nothing in the app calls it yet. Removing an
--           attachment in the manager edits the row and LEAVES THE FILE: the
--           resource may already be published and a dangling object is cheaper
--           than a broken public link. A sweep of unreferenced objects is a
--           later job and it needs this policy to exist.
--
-- OWNER-OR-SENIOR HERE IS A PLAIN OR, WHERE 035 AND 037 WROTE AN AND, and the
-- difference is not an oversight. In site-media the shape is
-- `is_axis_staff() and (owner = auth.uid() or admin or manage_staff)`: the base
-- gate is BROADER than the senior set, so the owner clause means "a staff member
-- who uploaded this one". Here the base gate IS the senior set, so ANDing it in
-- would make the owner clause dead code: an owner holding the key is already
-- admitted by the third disjunct, and an owner who has lost it would be refused
-- by the AND no matter what the owner clause said. The disjunction is what makes
-- "the uploader" mean anything.
--
-- The only way to become the owner of an object in this bucket is to have passed
-- the insert policy, so the owner clause admits nobody who was not staff when
-- they wrote the file. And the senior half is the point of the pairing: THE
-- LIBRARY IS A SHARED CABINET. The person who may edit a resource row must be
-- able to replace the file attached to it, even when a colleague uploaded it,
-- because otherwise a correction to a published PDF waits on whoever happens to
-- be on holiday.
--
-- `owner` rather than `owner_id`: it is the column 035 and 037 use, it is a uuid
-- comparable to auth.uid() without a cast, and consistency between the two
-- storage files is worth more here than chasing the newer column.
--
-- RLS IS ALREADY ENABLED ON `storage.objects` BY SUPABASE. This block adds
-- policies and does not touch the table: `alter table ... enable row level
-- security` would need ownership this role may not have, and would be a no-op
-- everywhere it would succeed.
--
-- EXECUTE with dollar-quoted strings rather than bare DDL inside plpgsql, 035's
-- form: these are utility commands with column names in their expressions, and
-- passing them as literal text is what cannot be affected by name resolution
-- inside the block.
--
-- The names are the sentences a reviewer reads in the dashboard policy list.

do $do$
begin
  execute $sql$ drop policy if exists "library staff read resource files"    on storage.objects $sql$;
  execute $sql$
    create policy "library staff read resource files"
      on storage.objects for select to authenticated
      using (bucket_id = 'resource-files'
             and (public.is_axis_admin() or public.has_permission('manage_resource_library')))
  $sql$;

  execute $sql$ drop policy if exists "library staff upload resource files"  on storage.objects $sql$;
  execute $sql$
    create policy "library staff upload resource files"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'resource-files'
                  and (public.is_axis_admin() or public.has_permission('manage_resource_library')))
  $sql$;

  execute $sql$ drop policy if exists "library staff replace resource files" on storage.objects $sql$;
  execute $sql$
    create policy "library staff replace resource files"
      on storage.objects for update to authenticated
      using      (bucket_id = 'resource-files'
                  and (owner = auth.uid() or public.is_axis_admin()
                       or public.has_permission('manage_resource_library')))
      with check (bucket_id = 'resource-files'
                  and (owner = auth.uid() or public.is_axis_admin()
                       or public.has_permission('manage_resource_library')))
  $sql$;

  execute $sql$ drop policy if exists "library staff delete resource files"  on storage.objects $sql$;
  execute $sql$
    create policy "library staff delete resource files"
      on storage.objects for delete to authenticated
      using (bucket_id = 'resource-files'
             and (owner = auth.uid() or public.is_axis_admin()
                  or public.has_permission('manage_resource_library')))
  $sql$;

  raise notice '045: four storage.objects policies for resource-files are in place.';
exception
  when insufficient_privilege then
    raise notice '045: could NOT create the storage.objects policies (permission denied; storage.objects is owned by supabase_storage_admin). NOTHING UPLOADS UNTIL THEY EXIST. Create the four by hand per the header: select and insert to authenticated where bucket_id = ''resource-files'' and (is_axis_admin() or has_permission(''manage_resource_library'')); update and delete to authenticated where bucket_id = ''resource-files'' and (owner = auth.uid() or is_axis_admin() or has_permission(''manage_resource_library'')). No anon policy on any of the four.';
  when others then
    raise notice '045: could NOT create the storage.objects policies (% / %). NOTHING UPLOADS UNTIL THEY EXIST. See the header for the manual steps.',
      sqlstate, sqlerrm;
end
$do$;


-- ── 3. Verify ───────────────────────────────────────────────────────────────
--
-- Section 1. The bucket exists and carries its limits:
--
--   select id, public, file_size_limit, array_length(allowed_mime_types, 1)
--     from storage.buckets where id = 'resource-files';
--   -- one row: public t, 20971520, 7
--
--   select unnest(allowed_mime_types) from storage.buckets
--    where id = 'resource-files' order by 1;
--   -- application/msword
--   -- application/pdf
--   -- application/vnd.openxmlformats-officedocument.wordprocessingml.document
--   -- image/jpeg
--   -- image/png
--   -- image/webp
--   -- text/csv
--   -- and NOT application/vnd.ms-excel: see the header for why that one is the
--   -- client's problem to translate rather than the bucket's to accept.
--
-- Section 2. Four policies, and the roles and commands they carry:
--
--   select policyname, cmd, roles
--     from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like '%resource files%'
--    order by policyname;
--   -- 4 rows, all {authenticated}: SELECT / INSERT / UPDATE / DELETE.
--   -- No anon row anywhere. Public downloads do not need one and listing is
--   -- not something the anon key should be able to do.
--
-- If that returns zero rows, section 2 hit the permission wall. The apply-time
-- notice says so and the header says what to do about it.
--
-- The gate itself. Objects arrive through the Storage API rather than through
-- SQL, so what can be checked from psql is the predicate the four policies
-- share, evaluated as the sessions that matter:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<an admin uuid>';
--     select public.is_axis_admin()
--         or public.has_permission('manage_resource_library');   -- t, may upload
--   rollback;
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a coach WITHOUT the key>';
--     select public.is_axis_admin()
--         or public.has_permission('manage_resource_library');   -- f, may not
--   rollback;
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<a coach granted the key>';
--     select public.is_axis_admin()
--         or public.has_permission('manage_resource_library');   -- t
--   rollback;
--
-- That last one is the pairing with 041 doing its job: the same grant that lets
-- a coach publish a resource lets them attach a file to it.
--
-- End to end, from the browser, which is the test that actually matters:
-- sign in as an admin, open the resource library panel, attach a PDF under
-- 20 MB to a guide. It must appear in the attachment list with its size, the
-- saved row's `config.attachments[0].url` must be an
-- `https://<ref>.supabase.co/storage/v1/object/public/resource-files/files/<uuid>.pdf`,
-- and that URL must DOWNLOAD in a private window with no session at all. That
-- last clause is the public-bucket assertion; if it 400s there, the bucket did
-- not get created public.
--
-- And the refusals:
--
--   -- a 25 MB PDF        -> refused by resourceFiles.ts before the request
--   -- a .zip or a .mp4   -> refused by resourceFiles.ts, and by the bucket if forced
--   -- a .csv that the OS calls application/vnd.ms-excel
--   --                    -> ACCEPTED, re-labelled text/csv on the way up
--   -- a coach without manage_resource_library
--   --                    -> "new row violates row-level security policy"
--
-- Listing is staff only, which is the 037 correction applied from the start:
--
--   set role anon;
--   select count(*) from storage.objects where bucket_id = 'resource-files';
--   -- 0 rows, while a public URL download of any of them keeps working.
--   reset role;
--
-- Re-runnability, last. Applying this file twice must change nothing:
--
--   \i supabase/migrations/045_resource_files.sql
--   select count(*) from storage.buckets where id = 'resource-files';         -- 1
--   select count(*) from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like '%resource files%';                                -- 4
--
-- Re-runnable.
-- ============================================================
