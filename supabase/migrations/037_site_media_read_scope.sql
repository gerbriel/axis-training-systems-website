-- ============================================================
-- Axis Training Systems, 037: site-media policies, corrected
-- ============================================================
--
-- 035 shipped four storage.objects policies for the site-media bucket, and an
-- adversarial review caught two problems with them on databases where 035 has
-- already run. This file re-states the corrected set; 035 itself has been
-- brought in line for any database built fresh from the chain.
--
-- What was wrong, and why it matters:
--
-- 1. The read policy said `to anon, authenticated`. A SELECT policy on
--    storage.objects is METADATA access: it is what the list endpoint reads.
--    Public URL downloads bypass RLS entirely on a public bucket, so anon
--    gained nothing legitimate from that row. What it did gain was listing:
--    anyone holding the publishable anon key could page every object name in
--    the bucket and turn each into a fetchable URL. That defeats the
--    unguessable-uuid filenames 035's own header calls load-bearing, and it
--    exposes objects whose referencing rows are deliberately invisible to
--    anon: the face photo on a testimonial still waiting for approval, the
--    portrait on a hidden coach profile, the cover of an unapproved blog
--    draft, and every abandoned upload. Anon loses the SELECT row; nothing
--    the site does needs it.
--
-- 2. Update and delete were open to ALL staff bucket-wide, so any active
--    coach could overwrite or remove any other coach's images. They are now
--    owner-or-senior: the uploader, an admin, or a manage_staff holder.
--    Insert stays open to all staff; a shared media library is the point.
--
-- The same insufficient_privilege guard as 035: on hosted projects where
-- storage.objects is owned by supabase_storage_admin and this role cannot
-- manage its policies, the block raises a notice instead of failing, and the
-- corrections must be applied by hand in the dashboard (SQL in the notice).
--
-- Re-runnable.

do $do$
begin
  -- ── 1. Read: authenticated only ─────────────────────────────────────────
  execute $sql$ drop policy if exists "site media is publicly readable" on storage.objects $sql$;
  execute $sql$ drop policy if exists "signed in users read site media rows" on storage.objects $sql$;
  execute $sql$
    create policy "signed in users read site media rows"
      on storage.objects for select to authenticated
      using (bucket_id = 'site-media')
  $sql$;

  -- ── 2. Replace and delete: owner or senior ──────────────────────────────
  execute $sql$ drop policy if exists "axis staff replace site media" on storage.objects $sql$;
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

  raise notice '037: site-media policies corrected (read is authenticated-only; replace/delete are owner-or-senior).';
exception
  when insufficient_privilege then
    raise notice '037: could NOT alter the storage.objects policies (permission denied). Apply by hand: drop "site media is publicly readable"; recreate the read policy for authenticated only; add owner-or-senior conditions to the update and delete policies per this file.';
  when others then
    raise notice '037: could NOT alter the storage.objects policies (% / %). Apply the corrections by hand per this file.', sqlstate, sqlerrm;
end
$do$;


-- ── 3. Verify ───────────────────────────────────────────────────────────────
--
--   select policyname, cmd, roles
--     from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like '%site media%'
--    order by policyname;
--   -- 4 rows, all {authenticated}. No anon row anywhere.
--
--   set role anon;
--   select count(*) from storage.objects where bucket_id = 'site-media';
--   -- 0 rows (policy no longer admits anon), while public URL downloads
--   -- keep working because the bucket itself is public.
--   reset role;
--
-- Re-runnable.
