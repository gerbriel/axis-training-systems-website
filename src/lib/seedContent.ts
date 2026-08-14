import { supabase, supabaseConfigured } from './supabase'
import { STATIC_MEETS } from '../components/UpcomingMeets'
import { SEED_TESTIMONIALS } from '../data/testimonials'
import { POSTS } from '../data/blog'

/**
 * One-time import of the site's built-in content into the database.
 *
 * The meets, testimonials and blog posts the public site shows have always
 * lived in code (STATIC_MEETS here, each coach's testimonials in coaches.ts, and
 * POSTS in blog.ts). That is why the admin panels — which read the database —
 * could not see or edit them. This copies them into the database ONCE, using the
 * very same code data the site renders, so there is no hand-transcribed second
 * copy to drift, and everything on the home page becomes editable in the admin.
 *
 * Runs as the signed-in admin. The `admin_full_access` policy on pending_content
 * and `admin writes testimonials` on coach_testimonials (both is_content_admin)
 * are what let an admin write approved rows and rows attributed to other
 * coaches; a non-admin caller is refused by RLS and gets `not_admin` back.
 *
 * IDEMPOTENT. It matches on a natural key (a meet's name, a testimonial's
 * coach+quote, a post's slug) and skips anything already there, so running it
 * twice imports nothing the second time rather than duplicating the site.
 *
 * Blog posts keep their URLs: pending_content.slug (migration 020) carries the
 * human slug, and the public blog prefers it over the row id — so an imported
 * post still lives at /blog/<its-slug>, now editable in the Blog panel.
 */

export interface ImportResult {
  ok: boolean
  meets: { imported: number; skipped: number }
  testimonials: { imported: number; skipped: number }
  blog: { imported: number; skipped: number }
  message?: string
}

export async function importSiteContent(): Promise<ImportResult> {
  const empty: ImportResult = {
    ok: false,
    meets: { imported: 0, skipped: 0 },
    testimonials: { imported: 0, skipped: 0 },
    blog: { imported: 0, skipped: 0 },
  }
  if (!supabaseConfigured) return { ...empty, message: 'Unavailable in preview mode.' }

  const nowIso = new Date().toISOString()
  const result: ImportResult = {
    ok: true,
    meets: { imported: 0, skipped: 0 },
    testimonials: { imported: 0, skipped: 0 },
    blog: { imported: 0, skipped: 0 },
  }

  // ── Meets → pending_content ────────────────────────────────────────────────
  {
    // What's already there, so a re-run is a no-op. Read only the natural key.
    const { data: existing, error: readErr } = await supabase
      .from('pending_content')
      .select('meet_name')
      .eq('type', 'meet')

    if (readErr) return { ...empty, message: 'Could not read existing meets. Are you signed in as an admin?' }

    const have = new Set((existing ?? []).map((r) => (r as { meet_name: string | null }).meet_name))
    const rows = STATIC_MEETS
      .filter((m) => !have.has(m.name))
      .map((m) => ({
        type: 'meet',
        coach_slug: 'admin',
        coach_name: 'Axis Admin',
        status: 'approved',
        reviewed_at: nowIso,
        meet_name: m.name,
        meet_date: m.date,
        meet_location: m.location,
        federation: m.federation,
        // meet_type has a CHECK (National/Regional/World/Local); the static data
        // only ever uses those, but coerce anything unexpected to Local rather
        // than fail the whole insert on one bad value.
        meet_type: ['National', 'Regional', 'World', 'Local'].includes(m.type) ? m.type : 'Local',
        meet_note: m.note,
      }))

    result.meets.skipped = STATIC_MEETS.length - rows.length
    if (rows.length > 0) {
      const { error } = await supabase.from('pending_content').insert(rows)
      if (error) return { ...empty, message: error.message.includes('row-level security') ? 'You do not have permission — sign in as an admin.' : 'Could not import meets.' }
      result.meets.imported = rows.length
    }
  }

  // ── Testimonials → coach_testimonials ────────────────────────────────────────
  {
    const { data: existing, error: readErr } = await supabase
      .from('coach_testimonials')
      .select('coach_slug, quote')

    if (readErr) return { ...empty, message: 'Could not read existing testimonials.' }

    // Natural key is coach + the quote text: the same athlete quote under the
    // same coach is the same testimonial.
    const have = new Set(
      (existing ?? []).map((r) => `${(r as { coach_slug: string }).coach_slug}::${(r as { quote: string }).quote}`)
    )
    const rows = SEED_TESTIMONIALS
      .filter((t) => !have.has(`${t.coachSlug}::${t.quote}`))
      .map((t) => ({
        coach_slug: t.coachSlug,
        coach_name: t.coachName,
        quote: t.quote,
        athlete: t.athlete,
        result: t.result,
        photo: t.photo ?? null,
        show_on_coach: t.showOnCoach,
        // The admin runs this, and guard_testimonial_main_status lets an admin
        // set any main_status — so the three that were featured on the homepage
        // arrive already approved rather than needing a second click.
        main_status: t.mainStatus,
        reviewed_at: t.mainStatus === 'approved' ? nowIso : null,
      }))

    result.testimonials.skipped = SEED_TESTIMONIALS.length - rows.length
    if (rows.length > 0) {
      const { error } = await supabase.from('coach_testimonials').insert(rows)
      if (error) return { ...empty, message: error.message.includes('row-level security') ? 'You do not have permission — sign in as an admin.' : 'Could not import testimonials.' }
      result.testimonials.imported = rows.length
    }
  }

  // ── Blog posts → pending_content ─────────────────────────────────────────────
  {
    const { data: existing, error: readErr } = await supabase
      .from('pending_content')
      .select('slug, title')
      .eq('type', 'blog')

    if (readErr) return { ...empty, message: 'Could not read existing blog posts.' }

    // Natural key is the slug; the title is a second guard so a post imported
    // before slugs existed (uuid-addressed) is still recognised and not doubled.
    const haveSlug  = new Set((existing ?? []).map((r) => (r as { slug: string | null }).slug).filter(Boolean))
    const haveTitle = new Set((existing ?? []).map((r) => (r as { title: string | null }).title).filter(Boolean))

    const rows = POSTS
      .filter((p) => !haveSlug.has(p.slug) && !haveTitle.has(p.title))
      .map((p) => ({
        type: 'blog',
        coach_slug: p.coachSlug ?? 'admin',
        coach_name: p.coachName ?? p.author,
        status: 'approved',
        reviewed_at: nowIso,
        slug: p.slug,
        title: p.title,
        subtitle: p.subtitle,
        tags: p.tags.join(', '),
        summary: p.summary,
        // The reader (BlogPostPage.parseContent) JSON.parses this back into the
        // section array, so the rich structure round-trips intact.
        content: JSON.stringify(p.content),
      }))

    result.blog.skipped = POSTS.length - rows.length
    if (rows.length > 0) {
      const { error } = await supabase.from('pending_content').insert(rows)
      if (error) return { ...empty, message: error.message.includes('row-level security') ? 'You do not have permission — sign in as an admin.' : 'Could not import blog posts.' }
      result.blog.imported = rows.length
    }
  }

  return result
}
