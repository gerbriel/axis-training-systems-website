import MessagingWorkspace from '../../components/messaging/MessagingWorkspace'
import NewsletterPanel from './NewsletterPanel'
import { useHashSubTab } from '../../lib/useHashSubTab'

/**
 * Messages: everything that goes out to a person, in one place. The inbox is
 * the conversation with someone who already wrote in; the newsletter desk is
 * where an announcement is written and its delivery read back. They were two
 * rail entries and one sentence, so they are one entry and two sub-tabs now.
 *
 * READING AND WRITING ARE DIFFERENT TABS ON PURPOSE. Inside Inbox, the
 * workspace has its own Newsletters tab: the newsletters this person RECEIVED,
 * which is where a recipient expects to find them and which every athlete and
 * coach sees whether or not they can send. This tab is the sender's half, the
 * one screen where a newsletter is composed, drafted, sent, and its recipients
 * reviewed. One word for the feature, two halves of it.
 *
 * The unread badge stays on the rail's Messages item and still counts inbox
 * conversations only. Nothing about it changed.
 */

type Sub = 'inbox' | 'newsletters'

const SUB_TABS: readonly { key: Sub; label: string }[] = [
  { key: 'inbox',       label: 'Inbox' },
  { key: 'newsletters', label: 'Newsletters' },
]

const SUB_KEYS: readonly Sub[] = SUB_TABS.map(t => t.key)

export default function MessagesHub({ isDemo = false }: { isDemo?: boolean }) {
  const [sub, setSub] = useHashSubTab(SUB_KEYS, 'inbox')

  return (
    <div>
      {/* MessagingWorkspace and NewsletterPanel both pad themselves with
          .dash-pad, so a padded wrapper here would double the inset. Only the
          strip needs its own gutter. */}
      <div
        role="tablist"
        aria-label="Messages sections"
        style={{ display: 'flex', gap: '.25rem', padding: '0 2rem', borderBottom: '1px solid var(--surface)', flexWrap: 'wrap' }}
      >
        {SUB_TABS.map(t => {
          const active = sub === t.key
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setSub(t.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: active ? 'var(--text)' : 'var(--text-3)',
                fontSize: '.72rem', fontWeight: active ? 900 : 700,
                letterSpacing: '.1em', textTransform: 'uppercase',
                padding: '.9rem .4rem', marginRight: '1rem',
                borderBottom: `2px solid ${active ? '#272C84' : 'transparent'}`,
                fontFamily: 'inherit',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {sub === 'inbox'       && <MessagingWorkspace isDemo={isDemo} />}
      {sub === 'newsletters' && <NewsletterPanel isDemo={isDemo} />}
    </div>
  )
}
