-- ============================================================
-- Axis Training Systems — 020: blog posts get a real URL
-- ============================================================
--
-- A blog post in pending_content (004) is addressed by its uuid id, so a
-- database post lives at /blog/<uuid>. The founding posts in src/data/blog.ts
-- have human slugs (/blog/julien-gaudet-pec-strain-nationals), which is why the
-- content importer refused to move them into the database — doing so would have
-- changed their URLs. This adds the missing column so a post can carry its own
-- slug, and the importer + public blog can prefer it.
--
-- Nullable: a meet has no slug, and an older blog row that predates this keeps
-- working (the reader falls back to the id). Unique only among blog rows that
-- actually set one, so two meets with NULL slugs do not collide.
--
-- Re-runnable.
-- ============================================================

alter table public.pending_content
  add column if not exists slug text;

-- A slug is a URL segment: lowercase, digits, hyphens. The shape check is
-- deferred (NOT VALID would need a separate validate step and there is no bad
-- data yet) — enforced going forward.
alter table public.pending_content drop constraint if exists pending_content_slug_shape;
alter table public.pending_content add constraint pending_content_slug_shape
  check (slug is null or slug ~ '^[a-z0-9-]+$');

-- One post per slug. Partial: only blog rows that set a slug are constrained,
-- so the many meet rows (slug NULL) are untouched.
create unique index if not exists pending_content_blog_slug_idx
  on public.pending_content (slug)
  where type = 'blog' and slug is not null;

-- The public read grant (005 narrowed anon to specific columns) must include the
-- new column or the blog page cannot read the slug it is now keyed on.
grant select (slug) on public.pending_content to anon;

-- Verify:
--   select slug from public.pending_content where type = 'blog';  -- readable as anon
