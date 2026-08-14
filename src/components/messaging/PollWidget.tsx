import type { PollState } from '../../types/messaging'

/**
 * One poll, attached to a sent newsletter.
 *
 * Tallies come from the `poll_results_multi` aggregate and "my pick" comes from
 * the caller's own `poll_votes` row, so this component can show a result bar
 * without ever knowing who voted for what. That split is the whole privacy
 * story: counts are public, ballots are not.
 *
 * It owns no data. The parent votes, refetches, and hands back a new state, so
 * a vote that the server refuses simply repaints as the truth.
 */

const ACCENT = '#272C84'

export function PollWidget({
  state,
  onVote,
  disabled = false,
}: {
  state: PollState
  onVote: (optionId: string) => void
  disabled?: boolean
}) {
  const { poll, counts, myOptionId, totalVotes } = state

  const closed = poll.closes_at !== null && new Date(poll.closes_at).getTime() <= Date.now()
  const locked = disabled || closed

  const options = [...state.options].sort((a, b) => a.position - b.position)

  return (
    <div
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--surface-2)',
        borderRadius: '.25rem',
        padding: '1rem 1.1rem',
      }}
    >
      <p style={{ color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>
        Poll
      </p>
      <p style={{ color: 'var(--text)', fontSize: '.9rem', fontWeight: 700, lineHeight: 1.5, marginBottom: '.85rem' }}>
        {poll.question}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
        {options.map(option => {
          const votes = counts[option.id] ?? 0
          const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0
          const mine = myOptionId === option.id

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => { if (!locked && !mine) onVote(option.id) }}
              disabled={locked}
              aria-pressed={mine}
              style={{
                position: 'relative',
                overflow: 'hidden',
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'var(--surface)',
                border: `1px solid ${mine ? ACCENT : 'var(--surface-2)'}`,
                borderRadius: '.25rem',
                padding: '.6rem .75rem',
                cursor: locked || mine ? 'default' : 'pointer',
                fontFamily: 'inherit',
                opacity: locked && !mine ? 0.75 : 1,
              }}
            >
              {/* The fill sits under the label so the percentage stays readable. */}
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: '0 auto 0 0',
                  width: `${pct}%`,
                  background: mine ? 'rgba(39,44,132,.38)' : 'rgba(39,44,132,.16)',
                  transition: 'width .25s',
                  pointerEvents: 'none',
                }}
              />
              <span style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                <span style={{ flex: 1, color: 'var(--text)', fontSize: '.82rem', fontWeight: mine ? 700 : 400, lineHeight: 1.4 }}>
                  {option.label}
                </span>
                <span style={{ color: 'var(--text-2)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.08em', whiteSpace: 'nowrap' }}>
                  {pct}%
                </span>
                <span style={{ color: 'var(--text-4)', fontSize: '.66rem', letterSpacing: '.08em', whiteSpace: 'nowrap', minWidth: '3.5rem', textAlign: 'right' }}>
                  {votes} {votes === 1 ? 'vote' : 'votes'}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <p style={{ color: 'var(--text-4)', fontSize: '.68rem', marginTop: '.7rem', lineHeight: 1.5 }}>
        {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'} so far.
        {closed
          ? ' Poll closed.'
          : disabled
            ? ''
            : myOptionId
              ? ' Pick another option to change your vote.'
              : ' Pick an option to vote.'}
      </p>
    </div>
  )
}

export default PollWidget
