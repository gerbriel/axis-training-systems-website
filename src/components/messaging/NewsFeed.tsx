import { useState, useEffect, useCallback } from 'react'
import { fetchNewsFeed, castPollVote } from '../../lib/newsletterBroadcast'
import type { BroadcastNewsletter, PollState } from '../../types/messaging'
import PollWidget from './PollWidget'
import DemoBanner from '../dashboard/DemoBanner'

/**
 * Every newsletter that has been sent, newest first.
 *
 * A newsletter also lands in the inbox as a private broadcast conversation, so
 * this page is not the only place it can be read. It is the place it can be
 * read AGAIN: the inbox copy scrolls away under replies, this one stays put and
 * carries the poll.
 *
 * Voting is optimistic and then reconciled by a refetch, because the tallies are
 * an aggregate this client cannot compute on its own.
 */

const COLLAPSE_AT = 400

type FeedItem = { newsletter: BroadcastNewsletter; poll: PollState | null }

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function sentAt(n: BroadcastNewsletter): string {
  return n.sent_at ?? n.created_at
}

function NewsCard({
  item,
  voting,
  onVote,
}: {
  item: FeedItem
  voting: boolean
  onVote: (pollId: string, optionId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const body = item.newsletter.body
  const long = body.length > COLLAPSE_AT
  const shown = long && !expanded ? `${body.slice(0, COLLAPSE_AT).trimEnd()}…` : body

  return (
    <article
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--surface-2)',
        borderRadius: '.25rem',
        padding: '1.25rem 1.35rem',
      }}
    >
      <p style={{ color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase', marginBottom: '.45rem' }}>
        {fmtDate(sentAt(item.newsletter))}
      </p>

      <h3 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.05rem', lineHeight: 1.3, letterSpacing: '-.01em', marginBottom: '.7rem' }}>
        {item.newsletter.subject}
      </h3>

      <p style={{ color: 'var(--text-2)', fontSize: '.86rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {shown}
      </p>

      {long && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--text-3)', color: 'var(--text-2)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '0 0 .2rem', marginTop: '.75rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}

      {item.poll && (
        <div style={{ marginTop: '1.1rem' }}>
          <PollWidget
            state={item.poll}
            disabled={voting}
            onVote={optionId => { if (item.poll) onVote(item.poll.poll.id, optionId) }}
          />
        </div>
      )}
    </article>
  )
}

export default function NewsFeed({ isDemo = false }: { isDemo?: boolean }) {
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [votingPoll, setVotingPoll] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await fetchNewsFeed(isDemo)
    if (rows === null) { setOutage(true); setItems([]) }
    else {
      setOutage(false)
      setItems([...rows].sort((a, b) => sentAt(b.newsletter).localeCompare(sentAt(a.newsletter))))
    }
    setLoading(false)
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  const vote = async (pollId: string, optionId: string) => {
    if (votingPoll) return
    setVotingPoll(pollId)
    setError(null)

    // Move the pick locally first. The refetch below is what makes it true.
    setItems(prev => prev.map(item => {
      if (!item.poll || item.poll.poll.id !== pollId) return item
      const state = item.poll
      if (state.myOptionId === optionId) return item
      const counts = { ...state.counts }
      if (state.myOptionId) counts[state.myOptionId] = Math.max(0, (counts[state.myOptionId] ?? 0) - 1)
      counts[optionId] = (counts[optionId] ?? 0) + 1
      return {
        ...item,
        poll: {
          ...state,
          counts,
          myOptionId: optionId,
          totalVotes: state.myOptionId ? state.totalVotes : state.totalVotes + 1,
        },
      }
    }))

    const res = await castPollVote(pollId, optionId, isDemo)
    if (!res.ok) setError(res.message)
    setVotingPoll(null)
    await load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 720 }}>
      {isDemo && <DemoBanner note="Votes are counted only in this preview." />}

      {error && (
        <div style={{ background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)', borderRadius: '.25rem', padding: '.7rem 1rem' }}>
          <span style={{ color: '#c8102e', fontSize: '.82rem', lineHeight: 1.6 }}>{error}</span>
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-4)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
      ) : outage ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>We could not load the news.</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>That is on our side. Nothing has been missed.</p>
          <button
            type="button"
            onClick={() => void load()}
            style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--text)', color: 'var(--text)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '0 0 .25rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.75rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>No news yet.</p>
          <p style={{ color: 'var(--text-3)', fontSize: '.82rem' }}>Team announcements will show up here.</p>
        </div>
      ) : (
        items.map(item => (
          <NewsCard
            key={item.newsletter.id}
            item={item}
            voting={votingPoll === item.poll?.poll.id}
            onVote={(pollId, optionId) => { void vote(pollId, optionId) }}
          />
        ))
      )}
    </div>
  )
}
