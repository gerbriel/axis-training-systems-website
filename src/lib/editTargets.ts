import { adminHref } from '../utils/nav.ts'

/**
 * editTargets.ts
 *
 * The other half of the edit bar: the things on the public site that ALREADY
 * live in the database.
 *
 * siteContent.ts covers the copy compiled into the bundle. This file covers
 * everything the admin portal can already create, edit and delete: blog posts,
 * coach profiles, testimonials, meet listings, the resource library, the
 * calculator numbers, the service catalog and the announcement banner. Those
 * all have tables, libraries, RLS and panels already. Nothing here is a second
 * write path, and nothing here invents a permission: each target names the key
 * ITS OWN TABLE actually demands, verified against the migration that adopts it
 * and cited on the line.
 *
 * THE RULE THAT MAKES THIS SAFE: permission is a property of the TARGET, never
 * of the caller. `manage_content` opens the site copy and the meet listings and
 * nothing else. A bar that assumed one key covered everything would put a
 * dashed outline around a coach profile a coach cannot write, and the save
 * would come back refused, or worse, come back a checkmark over a write that
 * changed nothing.
 *
 * WHY SOME TARGETS HAVE NO ACTIONS. `actions: []` is not an oversight, it is
 * the honest answer for a thing that does not fit in a 380px drawer. The
 * resource library has five distinct nested content editors inside
 * ResourceLibraryPanel; rebuilding them in a side panel would be a second,
 * worse copy of an 848-line screen. So those targets carry `adminHref` and
 * nothing else, and the bar shows "Edit in portal", which costs one line and is
 * not a lie. Each one below records what would have to be true for its actions
 * to grow, so the next person does not have to work it out again.
 *
 * THIS IS SIGNAGE. docs/SECURITY.md: RLS is the security boundary and the UI is
 * signage. Everything in this file decides which outline is drawn and which
 * menu entry appears. It authorizes nothing. The write itself meets the policy
 * on the table either way.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type RecordAction = 'edit' | 'create' | 'delete'

export interface RecordTargetDef {
  /** The name in a `row:<key>:<id>` attribute. Stable: it is in the DOM. */
  key: string
  /** The noun the bar and the drawer say out loud. Singular. */
  label: string
  /** The permission this target's OWN table demands. Never manage_content. */
  permission: string
  /**
   * What can be done to one of these from the public page.
   *
   * Empty means "open the portal instead", not "you may not". See the header.
   */
  actions: RecordAction[]
  /**
   * A deep link into the panel that already manages these.
   *
   * The portal's conventions, both of them: the top-level tab is `?tab=<tab>`
   * (useUrlTab, src/lib/dashboard.ts:34) and a panel's sub-tab is the URL hash
   * (useHashSubTab, src/lib/useHashSubTab.ts:17). An unrecognised value of
   * either falls back to that screen's default rather than erroring, so a link
   * that goes stale lands somebody in the right area rather than nowhere.
   *
   * `id` is accepted so a panel that learns to open one row can use it without
   * changing every call site. No admin panel takes a row id in its URL today,
   * so it is ignored, which is why the link still works.
   */
  adminHref: (id?: string) => string
}

// ── The targets ──────────────────────────────────────────────────────────────

const TARGETS: RecordTargetDef[] = [
  /**
   * BLOG POSTS. Rows in public.pending_content where type = 'blog' (004).
   *
   * Permission: `manage_blog`, adopted for real at 040_area_permissions.sql:157
   *   create policy "manage_blog manages every submission"
   *     on public.pending_content for all to authenticated
   *     using (is_axis_admin() or has_permission('manage_blog'))
   *
   * Library: src/lib/contentApi.ts. Create is TWO writes and always has been:
   * submitContent() inserts at the column default status 'pending', and
   * updateContent() flips it to 'approved' (BlogPanel.tsx:177-178). An adapter
   * reusing them has to do both, in that order, or the post is written and
   * never appears.
   *
   * `slug` is a LOCKED field, refused before any I/O rather than sent: it
   * carries a partial UNIQUE index (020_blog_slug.sql:31) and it is the public
   * URL, so renaming it either 23505s in front of a visitor or silently breaks
   * a live link. That belongs in the blog panel, with the warning it already has.
   */
  {
    key: 'blog',
    label: 'Blog post',
    permission: 'manage_blog',
    actions: ['edit', 'create', 'delete'],
    adminHref: () => `${adminHref()}?tab=blog`,
  },

  /**
   * COACH PROFILES. public.coach_profiles (032).
   *
   * Permission: `manage_staff`, adopted at 032_coach_profiles.sql:362
   *   create policy "admins manage coach profiles" ... for all
   *     using (is_axis_admin() or has_permission('manage_staff'))
   * beside "coaches edit their own profile" (update, slug = current_coach_slug()).
   * So a coach can always edit their OWN card without manage_staff, which is
   * the case the bar most wants and the reason this target is editable at all.
   *
   * EDIT ONLY, and this one is a real constraint rather than a size judgement.
   * The field split is enforced by a TRIGGER that RAISES, not a policy that
   * filters: coach_profiles_guard() (032_coach_profiles.sql:264-296) refuses a non-admin changing
   * `slug`, `is_visible` or `sort_order`, comparing with `is distinct from`. An
   * adapter must therefore pass all three through VERBATIM from the loaded row
   * and must never offer them as fields, or a re-serialized value raises "Only
   * an admin can change that field" on an edit the coach did not make.
   *
   * Create and delete stay in CoachProfilesManager: a new profile mints a slug
   * that becomes a public URL at /coaches/<slug>, and deleting one removes a
   * page that is linked from the homepage, the testimonials and the apply flow.
   */
  {
    key: 'coachProfile',
    label: 'Coach profile',
    permission: 'manage_staff',
    actions: ['edit'],
    adminHref: () => `${adminHref()}?tab=settings#availability`,
  },

  /**
   * TESTIMONIALS. public.coach_testimonials (006).
   *
   * Permission: `moderate_testimonials`. Registered at 016_permissions.sql:727
   * and, until migration 048 section 5, adopted by NO POLICY ANYWHERE. 018:87
   * widened the guard TRIGGER to accept it, which made it look adopted, but the
   * write policies were still 006's admin-only and coach-own-row ones. A
   * moderator's update matched no policy, changed zero rows, and came back a
   * 204 that reviewTestimonial reported as success. 048 section 5 adds the
   * missing policy.
   *
   * ACTIONS ARE EMPTY ON PURPOSE, for one more deploy. Two things unblock them,
   * and neither is in this cut:
   *   1. 048 section 5 has to be applied and verified under a real moderator
   *      JWT, not as the table owner. A bar whose save silently does nothing is
   *      worse than no bar.
   *   2. testimonialsApi.reviewTestimonial (testimonialsApi.ts:247) ends at
   *      .update().eq('id', id) with no .select(), so it still cannot tell a
   *      refusal from a success. It needs .select('id') and a zero-rows refusal
   *      first. That is a fix for the existing panel, not a regression.
   * Also worth settling in the same pass: 018's rewrite silently dropped 006's
   * "editing the copy sends an approved testimonial back for re-review" clause,
   * while testimonialsApi.ts:148-153 and its demo branch still emulate it, so
   * live and demo currently disagree about what editing an approved one does.
   */
  {
    key: 'testimonial',
    label: 'Testimonial',
    permission: 'moderate_testimonials',
    actions: [],
    adminHref: () => `${adminHref()}?tab=testimonials`,
  },

  /**
   * MEET LISTINGS. Rows in public.pending_content where type = 'meet' (004).
   * There is no meets table; the type column is the discriminator.
   *
   * Permission: `manage_content`, which AdminPortal.tsx TAB_KEYS.meets has
   * gated the Meet Listings tab on since it was written, and which no pending_content policy
   * adopted until migration 048 section 6. Until then a coach holding
   * manage_content saw the tab and every write behind it was refused unless
   * they also held manage_blog. 048 adopts it narrowly, `type = 'meet'` in both
   * USING and WITH CHECK, so it cannot reach a blog row or turn a meet into one.
   *
   * Empty actions for the same reason as testimonials: one deploy after the
   * repair they depend on, not in the same breath as it. When they open, the
   * fields are name, date, location and note, and the library is contentApi's
   * submitContent / updateContent / removeContent.
   */
  {
    key: 'meet',
    label: 'Meet listing',
    permission: 'manage_content',
    actions: [],
    adminHref: () => `${adminHref()}?tab=meets`,
  },

  /**
   * THE RESOURCE LIBRARY AND THE GUIDES. public.resource_library (041).
   *
   * Permission: `manage_resource_library`, adopted at
   * 041_resource_library.sql:210, beside the staff read at 206.
   *
   * Deep link only, and this is the clearest case of it. A guide's content is
   * one of five nested editors inside ResourceLibraryPanel (checklist, quiz,
   * reference table, sections, worksheet), each with its own cross-field rules
   * out of guideContent.ts. Rebuilding any of that in a side drawer would be a
   * second, worse copy of a screen that already works; embedding the panel
   * would pin 848 lines of admin code into the bundle every anonymous visitor
   * downloads. "Edit in portal" is the honest answer and it is one line.
   */
  {
    key: 'resource',
    label: 'Free resource',
    permission: 'manage_resource_library',
    actions: [],
    adminHref: () => `${adminHref()}?tab=resources#library`,
  },

  /**
   * THE CALCULATOR NUMBERS. public.calculator_settings (042).
   *
   * Permission: `manage_calculators`, adopted at
   * 042_calculator_settings.sql:175.
   *
   * Deep link only: these are percentage tables and rounding rules, not copy.
   * The words around them ARE editable, as tools.* blocks in siteContent.ts.
   */
  {
    key: 'calculator',
    label: 'Calculator numbers',
    permission: 'manage_calculators',
    actions: [],
    adminHref: () => `${adminHref()}?tab=resources#calculators`,
  },

  /**
   * THE SERVICE CATALOG. public.booking_services (009).
   *
   * Permission: `manage_services`, adopted by 018_permissions_take_effect.sql:59
   * on booking_services, and again on coach_booking_services below it.
   *
   * READ THIS BEFORE WIRING IT UP: the four cards in the Services section of
   * the homepage are NOT these rows. Services.tsx:1-33 is a hardcoded array
   * with no lib import at all, and it is class (a) copy, editable through the
   * `services.*` blocks in siteContent.ts. The booking_services catalog
   * surfaces on /book and nowhere else (services.ts's only caller is
   * BookPage.tsx:1010). Anyone who conflates the two has designed the wrong
   * thing, which is why this entry exists at all: to say so.
   */
  {
    key: 'service',
    label: 'Bookable service',
    permission: 'manage_services',
    actions: [],
    adminHref: () => `${adminHref()}?tab=settings#services`,
  },

  /**
   * THE ANNOUNCEMENT BANNER. public.site_announcements (028).
   *
   * Permission: `manage_announcements`, adopted at 028_marketing.sql:155-156.
   *
   * Deep link only. A banner is not copy on a page: it carries a schedule, an
   * audience (announceTargeting.ts), a kind chip and a CTA, and it renders
   * nothing at all when no rule matches, so an edit bar cannot reliably put an
   * outline around one. Its words are edited where its schedule is.
   */
  {
    key: 'announcement',
    label: 'Announcement',
    permission: 'manage_announcements',
    actions: [],
    adminHref: () => `${adminHref()}?tab=insights#announcements`,
  },
]

const BY_KEY = new Map<string, RecordTargetDef>(TARGETS.map(t => [t.key, t]))

/** Every database-backed target the edit bar knows about, in page order. A
 *  fresh array each call, so a caller sorting or splicing it does not reorder
 *  the registry for everybody else. */
export function recordTargets(): RecordTargetDef[] {
  return [...TARGETS]
}

export function recordTarget(key: string): RecordTargetDef | undefined {
  return BY_KEY.get(key)
}

/** The targets that can actually be done something to from the public page. */
export function inlineTargets(): RecordTargetDef[] {
  return TARGETS.filter(t => t.actions.length > 0)
}

/**
 * Every permission the bar has any use for, deduplicated.
 *
 * The bar's own "may this person edit anything here at all" check ORs this with
 * `manage_content` (which opens the site copy) and with is_axis_admin. Derived
 * rather than listed, so a target added above cannot be invisible.
 */
export function recordPermissions(): string[] {
  return [...new Set(TARGETS.map(t => t.permission))]
}

// ── Deferred, with the reason recorded ───────────────────────────────────────
//
// Written here rather than in a ticket, because the next person to look at this
// file is the one who needs it. Each of these was considered and left out.
//
// NAV LINK HREFS (Navbar and Footer). A stored href reaches an <a>, and
//   Services.tsx:81-91 already flips an anchor to target=_blank on an http
//   prefix, so it needs the allow-list AND a PICKED LIST rather than a text
//   box: Tools, Coaches and Testimonials each return null on an empty list and
//   take their anchor with them, and '#apply' is already dead on the home page
//   because Apply.tsx mounts only at /apply/<slug>. Note also that the desktop
//   and mobile "Book a Call" already point at two different destinations
//   (Navbar.tsx:66 vs 114), so one stored list would be a behaviour change.
//
// THE APPLY FORM. Apply.tsx:8-18 documents it outright: leads.coach_pref stores
//   the coach NAME and current_coach_name() matches it against
//   coach_routing.coach_name. The coach-preference labels and 'No Preference'
//   are ROUTING KEYS wearing the costume of copy, and an edited label produces
//   leads nobody is assigned, with no error anywhere. The same holds for the
//   squat/bench/deadlift style lists and the service <select>, which feed
//   leads.service, the column the CRM groups on.
//
// THE PRIVACY POLICY. Eleven numbered sections with inline anchors and
//   mid-sentence <strong>. dangerouslySetInnerHTML is banned, so it needs
//   before/label/after fields or slotted templates, and it is a legal document
//   whose edit history matters more than a headline's.
//
// COMPOSITE STRINGS generally: Apply's privacy-consent paragraph (text, a
//   button, text), UpcomingMeets' Instagram footer note, and Footer's copyright
//   (a computed year inside a sentence). Each needs a template with named slots
//   validated at save time, or the slot silently disappears.
//
// ADDING AND REMOVING ENTRIES IN A COPY LIST. Blocked by the fixed-shape rule
//   in siteContent.ts, deliberately: add and remove drag in ordinals,
//   reordering and per-item delete confirmation. When it is wanted, derive the
//   display ordinal from position the way resource_library.sort_order does, and
//   never store it.
