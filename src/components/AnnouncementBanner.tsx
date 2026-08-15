import { useEffect, useMemo, useState } from 'react'
import { fetchLiveAnnouncements, type Announcement, type AnnouncementKind } from '../lib/marketing'
import {
  ANONYMOUS_VIEWER, readFirstSeen, recordFirstSeen, selectAnnouncement,
  type AnnouncementViewer,
} from '../lib/announceTargeting'
import { useAuth } from '../context/AuthContext'
import { safeUrl } from '../utils/sanitize'

/**
 * The site-wide announcement banner.
 *
 * Mount it near the top of a public page (home, booking). It fetches every
 * currently-live announcement, picks the one this visitor is targeted by, and
 * remembers a dismissal in localStorage keyed BY THE ANNOUNCEMENT ID — so
 * dismissing one banner does not hide the next one the studio publishes.
 *
 * Targeting is decided here, in the browser, which makes it PRESENTATION and
 * not confidentiality: every live row is readable by anyone. It only chooses
 * which of several banners a given visitor is shown.
 *
 * Renders nothing until it has an announcement to show, and nothing at all when
 * there is none, when nothing matches, when the visitor has dismissed it, or
 * when the fetch fails. A banner is never allowed to be the reason a page does
 * not paint — which is also why a session that is still loading counts as
 * signed out rather than as something to wait for.
 */

const DISMISS_PREFIX = 'axis_announcement_dismissed_'

interface KindStyle {
  accent: string
  chipBg: string
  chipText: string
  label: string
}

// info → the brand blue; promo → amber; alert → red. Kept to inline values +
// #272C84 so the banner needs no stylesheet of its own.
const KIND: Record<AnnouncementKind, KindStyle> = {
  info:  { accent: '#272C84', chipBg: 'rgba(39,44,132,.14)',  chipText: '#272C84', label: 'Update' },
  promo: { accent: '#B8860B', chipBg: 'rgba(184,134,11,.16)', chipText: '#8a6608', label: 'Offer'  },
  alert: { accent: '#B4232B', chipBg: 'rgba(180,35,43,.14)',  chipText: '#b4232b', label: 'Notice' },
}

function kindStyle(kind: AnnouncementKind): KindStyle {
  return KIND[kind] ?? KIND.info
}

// ── Presentational view (shared with the admin preview) ──────────────────────

export function AnnouncementView({
  announcement,
  onDismiss,
  preview = false,
}: {
  announcement: Announcement
  onDismiss?: () => void
  preview?: boolean
}) {
  const k = kindStyle(announcement.kind)
  const cta = announcement.ctaUrl ? safeUrl(announcement.ctaUrl) : undefined
  const ctaLabel = announcement.ctaLabel?.trim() || 'Learn more'

  return (
    <div
      role={preview ? undefined : 'region'}
      aria-label={preview ? undefined : 'Site announcement'}
      style={{
        display: 'flex', alignItems: 'center', gap: '1rem',
        flexWrap: 'wrap',
        padding: '.7rem 1.25rem',
        background: 'var(--surface, #f4f4f6)',
        borderBottom: `2px solid ${k.accent}`,
        position: 'relative',
        fontFamily: 'inherit',
      }}
    >
      <span
        style={{
          flexShrink: 0,
          background: k.chipBg, color: k.chipText,
          fontSize: '.55rem', fontWeight: 900, letterSpacing: '.16em',
          textTransform: 'uppercase',
          padding: '.22rem .55rem', borderRadius: '.15rem',
        }}
      >
        {k.label}
      </span>

      <div style={{ flex: 1, minWidth: 200, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '.25rem .6rem' }}>
        <span style={{ color: 'var(--text, #14141a)', fontSize: '.82rem', fontWeight: 800 }}>
          {announcement.title}
        </span>
        {announcement.body && (
          <span style={{ color: 'var(--text-2, #55555f)', fontSize: '.8rem' }}>
            {announcement.body}
          </span>
        )}
      </div>

      {cta && (
        <a
          href={cta}
          style={{
            flexShrink: 0,
            background: k.accent, color: '#ffffff',
            fontSize: '.62rem', fontWeight: 900, letterSpacing: '.1em',
            textTransform: 'uppercase',
            padding: '.4rem .9rem', borderRadius: '.25rem',
            textDecoration: 'none', whiteSpace: 'nowrap',
          }}
          {...(preview ? { onClick: (e: React.MouseEvent) => e.preventDefault(), tabIndex: -1 } : {})}
        >
          {ctaLabel} →
        </a>
      )}

      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss announcement"
          style={{
            flexShrink: 0,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-3, #8a8a92)', fontSize: '1.05rem', lineHeight: 1,
            padding: '.15rem .35rem', fontFamily: 'inherit',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text, #14141a)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3, #8a8a92)')}
        >
          ×
        </button>
      )}
    </div>
  )
}

// ── Dismissals ───────────────────────────────────────────────────────────────

/**
 * Every announcement this browser has dismissed. Read once per mount from the
 * per-id keys the banner has always written, so an older dismissal keeps
 * working unchanged. Storage that throws (private mode) reads as "none".
 */
function readDismissedIds(): string[] {
  const ids: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(DISMISS_PREFIX) && localStorage.getItem(key) === '1') {
        ids.push(key.slice(DISMISS_PREFIX.length))
      }
    }
  } catch { /* ignore */ }
  return ids
}

// ── The mountable, self-fetching banner ──────────────────────────────────────

export default function AnnouncementBanner({
  isDemo = false,
  offsetTop,
}: {
  isDemo?: boolean
  /**
   * Space to leave above the banner, for a page whose header is fixed and would
   * otherwise sit on top of it (the marketing navbar). Applied only when there
   * is something to show, so an empty banner never shifts the page.
   */
  offsetTop?: string
}) {
  const { profile, session, loading } = useAuth()

  const [items, setItems] = useState<Announcement[] | null>(null)
  // Dismissing closes the banner for this page view rather than promoting the
  // next candidate. The id is remembered, so the next page load moves on to it.
  const [dismissed, setDismissed] = useState(false)
  // Read before recording, so the first visit is not immediately "returning".
  const [firstSeenAt] = useState<string | null>(() => readFirstSeen())
  const [dismissedIds] = useState<string[]>(() => readDismissedIds())

  useEffect(() => { recordFirstSeen(new Date()) }, [])

  useEffect(() => {
    let live = true
    fetchLiveAnnouncements(isDemo)
      .then(rows => { if (live) setItems(rows ?? []) })
      .catch(() => { if (live) setItems([]) })
    return () => { live = false }
  }, [isDemo])

  // While the session is still settling the visitor counts as signed out. The
  // pick re-runs on its own once the profile lands.
  const viewer: AnnouncementViewer = useMemo(() => {
    if (loading) return { ...ANONYMOUS_VIEWER, firstSeenAt }
    return {
      userId: profile?.id ?? session?.user.id ?? null,
      role: profile?.role ?? null,
      accountCreatedAt: profile?.created_at ?? null,
      firstSeenAt,
    }
  }, [loading, profile, session, firstSeenAt])

  const announcement = useMemo(() => {
    if (!items || items.length === 0) return null
    try {
      return selectAnnouncement(items, viewer, new Date(), dismissedIds)
    } catch {
      return null
    }
  }, [items, viewer, dismissedIds])

  if (!announcement || dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try { localStorage.setItem(DISMISS_PREFIX + announcement.id, '1') } catch { /* storage full / private mode */ }
  }

  const view = <AnnouncementView announcement={announcement} onDismiss={dismiss} />
  return offsetTop ? <div style={{ paddingTop: offsetTop }}>{view}</div> : view
}
