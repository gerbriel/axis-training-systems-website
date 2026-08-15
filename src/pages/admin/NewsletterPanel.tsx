import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../lib/usePermissions'
import {
  fetchNewsletters, saveNewsletterDraft, deleteNewsletterDraft,
  saveNewsletterPoll, sendNewsletter, fetchPollForNewsletter,
  fetchNewsletterRecipients, fetchPollStateForNewsletter,
} from '../../lib/newsletterBroadcast'
import type { BroadcastNewsletter, NewsletterRecipient, PollState } from '../../types/messaging'
import PollWidget from '../../components/messaging/PollWidget'
import { ROLE_LABEL } from '../../components/messaging/messagingUi'
import DemoBanner from '../../components/dashboard/DemoBanner'
import NewsletterLeadsPanel from './NewsletterLeadsPanel'

/**
 * Write a newsletter, attach a poll, send it.
 *
 * Delivery is IN-APP. A send fans the newsletter out as one private broadcast
 * conversation per recipient, which is the point: everybody gets their own
 * copy with their own unread flag rather than a line on a mailing list. A
 * newsletter is an announcement and takes no replies, so the question a sender
 * actually has afterwards is who has read it. That is what opening a sent row
 * answers. Nothing here sends email, and the "Email signups" list at the bottom
 * is a separate, older thing kept in the same room because that is where people
 * look for it.
 *
 * Two writes, not one. The draft saves first because the poll RPC needs a
 * newsletter id to hang options off, so a poll is always the second step
 * against the id the first step returned.
 *
 * The permission gate here is signage. `send_marketing` is enforced again in
 * every policy and RPC underneath, so a hidden button is a courtesy, never a
 * boundary.
 */

const ACCENT = '#272C84'

type Audience = BroadcastNewsletter['audience']

const AUDIENCE_LABEL: Record<Audience, string> = {
  all:      'Everyone',
  athletes: 'Athletes',
  staff:    'Coaches and admins',
}

/** How the confirm dialog names an audience. Recipient counts are a server answer. */
const AUDIENCE_PHRASE: Record<Audience, string> = {
  all:      'every active member',
  athletes: 'every active athlete',
  staff:    'every active coach and admin',
}

const SUBJECT_MAX = 200
const BODY_MAX = 8000
/** Where the character counter appears. Below this it is noise. */
const COUNT_WARN_AT = 7000
const MAX_OPTIONS = 8
/** Poll badges cost one read each, so only the visible top of the list gets them. */
const BADGE_LOOKUP_LIMIT = 40

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** The sub-heading inside an opened row. Same family as a section label, one step quieter. */
const DETAIL_LABEL: React.CSSProperties = {
  color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 900,
  letterSpacing: '.25em', textTransform: 'uppercase',
}

/**
 * What one opened row knows. Kept per newsletter rather than for the open one
 * only, so closing a row and opening it again costs nothing.
 *
 * `outage` is about the RECIPIENTS. A poll that fails to load comes back as
 * `null`, which renders the same as a newsletter that never had one, and that
 * is the right trade: the list of who received it is the reason the row opens.
 */
type SentDetail = {
  loading: boolean
  outage: boolean
  recipients: NewsletterRecipient[]
  poll: PollState | null
}

function Chip({ children, tone = 'accent' }: { children: React.ReactNode; tone?: 'accent' | 'quiet' }) {
  const color = tone === 'accent' ? ACCENT : 'var(--text-4)'
  return (
    <span style={{ background: tone === 'accent' ? 'rgba(39,44,132,.12)' : 'transparent', border: `1px solid ${tone === 'accent' ? 'rgba(39,44,132,.45)' : 'var(--surface-2)'}`, color: tone === 'accent' ? 'var(--text)' : color, fontSize: '.55rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.2rem .55rem', borderRadius: '.2rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {children}
    </span>
  )
}

function SmallButton({
  children, onClick, disabled = false, danger = false, expanded,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  /** Set only on the buttons that open something, which is where the attribute belongs. */
  expanded?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
      style={{
        background: 'none',
        border: `1px solid ${danger ? 'rgba(200,16,46,.45)' : 'var(--surface-2)'}`,
        color: disabled ? 'var(--text-4)' : danger ? '#c8102e' : 'var(--text-3)',
        fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
        padding: '.5rem .9rem', borderRadius: '.2rem',
        cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  )
}

export default function NewsletterPanel({ isDemo = false }: { isDemo?: boolean }) {
  const { isAdmin } = useAuth()
  const { ready, can } = usePermissions()

  const [rows, setRows] = useState<BroadcastNewsletter[]>([])
  const [hasPoll, setHasPoll] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [outage, setOutage] = useState(false)

  const [draftId, setDraftId] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<Audience>('all')

  const [pollOpen, setPollOpen] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState<string[]>(['', ''])

  const [saving, setSaving] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  // One sent row open at a time. Two recipient lists side by side answer a
  // question nobody asked and cost two reads to do it.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, SentDetail>>({})

  const composerRef = useRef<HTMLElement | null>(null)
  const editNonceRef = useRef(0)

  // Two tiers now, and they were one. `send_marketing` writes drafts and pushes
  // them out; `view_marketing` (040) reads what went out, who received it, and
  // the signup list at the bottom, and composes nothing. 030 and 040 say the
  // same thing in RLS: the sender policy is `for all`, the marketing reader's
  // is SELECT with no WITH CHECK.
  const canSend = isDemo || isAdmin || can('send_marketing')
  const allowed = canSend || can('view_marketing')

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetchNewsletters(isDemo)
    if (data === null) {
      setOutage(true)
      setRows([])
      setHasPoll({})
      setLoading(false)
      return
    }
    setOutage(false)
    setRows(data)
    setLoading(false)

    // Badges are a nicety, so they load after the list and never block it.
    const lookups = data.slice(0, BADGE_LOOKUP_LIMIT)
    const found = await Promise.all(
      lookups.map(async n => [n.id, (await fetchPollForNewsletter(n.id, isDemo)) !== null] as const)
    )
    setHasPoll(Object.fromEntries(found))
  }, [isDemo])

  useEffect(() => { if (allowed) void load() }, [allowed, load])

  /**
   * Who got one newsletter, and how its poll landed. Two reads, asked together.
   *
   * The recipients RPC is the only place delivery and seen state are gathered
   * back up after a fan-out, and the poll comes back as a finished aggregate,
   * so neither call can tell anybody who voted for what.
   */
  const loadDetail = useCallback(async (id: string) => {
    setDetails(prev => ({
      ...prev,
      [id]: { loading: true, outage: false, recipients: prev[id]?.recipients ?? [], poll: prev[id]?.poll ?? null },
    }))

    const [people, poll] = await Promise.all([
      fetchNewsletterRecipients(id, isDemo),
      fetchPollStateForNewsletter(id, isDemo),
    ])

    setDetails(prev => ({
      ...prev,
      [id]: { loading: false, outage: people === null, recipients: people ?? [], poll },
    }))
  }, [isDemo])

  // The detail behind a sent row costs reads, so it waits until somebody opens
  // that row and then stays put for the rest of the session.
  useEffect(() => {
    if (expandedId && !details[expandedId]) void loadDetail(expandedId)
  }, [expandedId, details, loadDetail])

  const clearComposer = () => {
    setDraftId(null)
    setSubject('')
    setBody('')
    setAudience('all')
    setPollOpen(false)
    setPollQuestion('')
    setPollOptions(['', ''])
  }

  const editDraft = async (n: BroadcastNewsletter) => {
    setFeedback(null)
    setDraftId(n.id)
    setSubject(n.subject)
    setBody(n.body)
    setAudience(n.audience)
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

    // Two quick Edit clicks race their poll fetches; only the latest click may
    // write into the composer, or draft A's poll lands on draft B.
    const nonce = ++editNonceRef.current
    const poll = await fetchPollForNewsletter(n.id, isDemo)
    if (nonce !== editNonceRef.current) return
    if (poll) {
      const options = [...poll.options]
      while (options.length < 2) options.push('')
      setPollOpen(true)
      setPollQuestion(poll.question)
      setPollOptions(options.slice(0, MAX_OPTIONS))
    } else {
      setPollOpen(false)
      setPollQuestion('')
      setPollOptions(['', ''])
    }
  }

  const cleanOptions = () => pollOptions.map(o => o.trim()).filter(o => o.length > 0)

  const save = async (): Promise<string | null> => {
    if (saving) return null
    setFeedback(null)

    if (!subject.trim()) { setFeedback({ tone: 'error', message: 'Give it a subject first.' }); return null }
    if (!body.trim())    { setFeedback({ tone: 'error', message: 'The newsletter is empty.' }); return null }

    const options = cleanOptions()
    if (pollOpen && pollQuestion.trim() && options.length < 2) {
      setFeedback({ tone: 'error', message: 'A poll needs a question and at least two options.' })
      return null
    }

    setSaving(true)
    const res = await saveNewsletterDraft(
      { id: draftId ?? undefined, subject: subject.trim(), body: body.trim(), audience },
      isDemo
    )
    if (!res.ok) { setSaving(false); setFeedback({ tone: 'error', message: res.message }); return null }

    // Second step, always: an empty question is how the RPC is told to drop a poll.
    const wantsPoll = pollOpen && pollQuestion.trim().length > 0
    const pollRes = await saveNewsletterPoll(res.id, wantsPoll ? pollQuestion.trim() : '', wantsPoll ? options : [], isDemo)

    setSaving(false)
    setDraftId(res.id)
    setFeedback(
      pollRes.ok
        ? { tone: 'success', message: 'Draft saved.' }
        : { tone: 'error', message: `Draft saved, but the poll did not. ${pollRes.message}` }
    )
    await load()
    return res.id
  }

  const send = async (n: BroadcastNewsletter) => {
    if (sendingId) return
    setFeedback(null)

    const ok = window.confirm(
      `Send "${n.subject}" to ${AUDIENCE_PHRASE[n.audience]}? Each person gets their own copy under Newsletters in Messages. Newsletters do not take replies. This cannot be undone.`
    )
    if (!ok) return

    setSendingId(n.id)
    const res = await sendNewsletter(n.id, isDemo)
    setSendingId(null)

    if (!res.ok) { setFeedback({ tone: 'error', message: res.message }); return }

    setFeedback(
      res.sent === 0
        ? { tone: 'error', message: 'Nobody matched that audience, so it went to no one.' }
        : { tone: 'success', message: `Sent. Delivered to ${res.sent} ${res.sent === 1 ? 'person' : 'people'}.` }
    )
    if (draftId === n.id) clearComposer()
    await load()
  }

  const remove = async (id: string) => {
    setConfirmDelete(null)
    setFeedback(null)
    const res = await deleteNewsletterDraft(id, isDemo)
    if (!res.ok) { setFeedback({ tone: 'error', message: res.message }); return }
    if (draftId === id) clearComposer()
    await load()
  }

  // ── Gate ────────────────────────────────────────────────────────────────
  if (!allowed) {
    if (!ready) {
      return (
        <div className="dash-pad">
          <p style={{ color: 'var(--text-4)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
        </div>
      )
    }
    return (
      <div className="dash-pad" style={{ maxWidth: 520 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.75rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text)', fontSize: '.95rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.5rem' }}>
            Not your tab yet
          </p>
          <p style={{ color: 'var(--text-3)', fontSize: '.85rem', lineHeight: 1.65 }}>
            Sending a newsletter needs the send marketing permission, and reading what has gone out needs
            see marketing data. Ask an administrator to turn one of them on for your account.
          </p>
        </div>
      </div>
    )
  }

  const drafts = rows.filter(n => n.status === 'draft')
  const sent = rows.filter(n => n.status === 'sent')
  const overBodyWarn = body.length >= COUNT_WARN_AT
  const canSave = !!subject.trim() && !!body.trim() && !saving

  return (
    <div className="dash-pad" style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem', maxWidth: 800 }}>
      {isDemo && <DemoBanner note="Nothing is delivered from the demo." />}

      {/* ── Composer ──────────────────────────────────────────────────────── */}
      {/* Sender tier only. A marketing reader arrives at the history below with
          no half-usable form above it. */}
      {canSend && <section ref={composerRef}>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>
          {draftId ? 'Editing a draft' : 'Compose'}
        </p>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '.6rem' }}>
          Newsletter
        </h2>
        <p style={{ color: 'var(--text-3)', fontSize: '.82rem', lineHeight: 1.65, marginBottom: '1.5rem', maxWidth: 560 }}>
          This goes out inside the app, not by email. Everyone you pick gets their own copy
          under Newsletters in Messages. Newsletters do not take replies, so open a sent one
          below to see who has read it.
        </p>

        {feedback && (
          <div style={{
            background: feedback.tone === 'success' ? 'rgba(34,197,94,.08)' : 'rgba(200,16,46,.08)',
            border: `1px solid ${feedback.tone === 'success' ? 'rgba(34,197,94,.35)' : 'rgba(200,16,46,.35)'}`,
            borderRadius: '.25rem', padding: '.7rem 1rem', marginBottom: '1rem',
          }}>
            <span style={{ color: feedback.tone === 'success' ? '#22c55e' : '#c8102e', fontSize: '.82rem', lineHeight: 1.6 }}>
              {feedback.message}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 560 }}>
          <div>
            <label className="field-label" htmlFor="nl-subject">Subject *</label>
            <input id="nl-subject" className="field" maxLength={SUBJECT_MAX}
              value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Meet week schedule" />
          </div>

          <div>
            <label className="field-label" htmlFor="nl-body">Message *</label>
            <textarea id="nl-body" className="field" rows={10} maxLength={BODY_MAX}
              value={body} onChange={e => setBody(e.target.value)}
              placeholder="Write it the way you would say it." />
            {overBodyWarn && (
              <p style={{ color: body.length >= BODY_MAX ? '#c8102e' : 'var(--text-4)', fontSize: '.7rem', marginTop: '.4rem' }}>
                {body.length.toLocaleString()} of {BODY_MAX.toLocaleString()} characters
                {body.length >= BODY_MAX ? '. That is the limit.' : ''}
              </p>
            )}
          </div>

          <div>
            <label className="field-label" htmlFor="nl-audience">Who gets it</label>
            <select id="nl-audience" className="field" value={audience}
              onChange={e => setAudience(e.target.value as Audience)}>
              <option value="all">Everyone</option>
              <option value="athletes">Athletes</option>
              <option value="staff">Coaches and admins</option>
            </select>
            <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.4rem', lineHeight: 1.5 }}>
              Active accounts only. You are never a recipient of your own newsletter.
            </p>
          </div>

          {/* ── Poll ──────────────────────────────────────────────────────── */}
          {!pollOpen ? (
            <div>
              <SmallButton onClick={() => setPollOpen(true)}>Add a poll</SmallButton>
            </div>
          ) : (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1rem 1.1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '.75rem' }}>
                <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase' }}>Poll</p>
                <button type="button"
                  onClick={() => { setPollOpen(false); setPollQuestion(''); setPollOptions(['', '']) }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                  Remove poll
                </button>
              </div>

              <div style={{ marginBottom: '.85rem' }}>
                <label className="field-label" htmlFor="nl-poll-q">Question</label>
                <input id="nl-poll-q" className="field" maxLength={200}
                  value={pollQuestion} onChange={e => setPollQuestion(e.target.value)}
                  placeholder="Which Saturday works for the team lift?" />
              </div>

              <label className="field-label">Options</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                {pollOptions.map((option, i) => (
                  <div key={i} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <input className="field" maxLength={100} value={option}
                      aria-label={`Option ${i + 1}`}
                      placeholder={`Option ${i + 1}`}
                      onChange={e => setPollOptions(prev => prev.map((v, j) => (j === i ? e.target.value : v)))} />
                    <button type="button"
                      onClick={() => setPollOptions(prev => prev.filter((_, j) => j !== i))}
                      disabled={pollOptions.length <= 2}
                      aria-label={`Remove option ${i + 1}`}
                      style={{ background: 'none', border: '1px solid var(--surface-2)', color: pollOptions.length <= 2 ? 'var(--text-dim)' : 'var(--text-3)', fontSize: '.8rem', lineHeight: 1, width: '2.2rem', height: '2.2rem', borderRadius: '.2rem', cursor: pollOptions.length <= 2 ? 'default' : 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: '.75rem' }}>
                <SmallButton
                  onClick={() => setPollOptions(prev => (prev.length < MAX_OPTIONS ? [...prev, ''] : prev))}
                  disabled={pollOptions.length >= MAX_OPTIONS}
                >
                  Add option
                </SmallButton>
                <span style={{ color: 'var(--text-4)', fontSize: '.7rem', marginLeft: '.75rem' }}>
                  Two at minimum, {MAX_OPTIONS} at most.
                </span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={() => void save()} disabled={!canSave}
              style={{
                background: canSave ? ACCENT : 'var(--border)', border: 'none',
                color: canSave ? '#fff' : 'var(--text-3)',
                fontWeight: 900, fontSize: '.7rem', letterSpacing: '.15em', textTransform: 'uppercase',
                padding: '.8rem 1.8rem', borderRadius: '.25rem',
                cursor: canSave ? 'pointer' : 'default', fontFamily: 'inherit',
              }}>
              {saving ? 'Saving…' : draftId ? 'Save changes' : 'Save draft'}
            </button>

            {(draftId || subject || body) && (
              <SmallButton onClick={() => { clearComposer(); setFeedback(null) }}>
                {draftId ? 'Start a new one' : 'Clear'}
              </SmallButton>
            )}

            <span style={{ color: 'var(--text-4)', fontSize: '.72rem', lineHeight: 1.5 }}>
              Drafts send from the list below.
            </span>
          </div>
        </div>
      </section>}

      {/* ── Drafts ────────────────────────────────────────────────────────── */}
      <section>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>Not sent yet</p>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '1rem' }}>Drafts</h2>

        {loading ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
        ) : outage ? (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.5rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text)', fontSize: '.875rem', fontWeight: 700, marginBottom: '.3rem' }}>We could not load your newsletters.</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>That is on our side. Nothing has been sent or lost.</p>
            <button type="button" onClick={() => void load()}
              style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--text)', color: 'var(--text)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '0 0 .25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              Try again
            </button>
          </div>
        ) : drafts.length === 0 ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.875rem' }}>
            {canSend ? 'No drafts. Write one above.' : 'No drafts.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {drafts.map(n => {
              const armed = confirmDelete === n.id
              const busy = sendingId === n.id
              return (
                <div key={n.id} style={{ background: 'var(--surface)', border: `1px solid ${draftId === n.id ? ACCENT : 'var(--surface-2)'}`, borderRadius: '.25rem', padding: '.9rem 1.1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.25rem' }}>
                      <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.85rem' }}>{n.subject}</span>
                      <Chip>{AUDIENCE_LABEL[n.audience]}</Chip>
                      {hasPoll[n.id] && <Chip tone="quiet">Poll</Chip>}
                    </div>
                    <p style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>
                      Started {fmtDate(n.created_at)}
                    </p>
                  </div>

                  {/* Edit, send and delete are all sender tier. A reader keeps
                      the row and its audience chip and nothing to press. */}
                  {!canSend ? null : armed ? (
                    <div style={{ display: 'flex', gap: '.4rem' }}>
                      <button type="button" onClick={() => void remove(n.id)}
                        style={{ background: '#c8102e', border: 'none', color: '#fff', fontWeight: 900, fontSize: '.6rem', letterSpacing: '.1em', textTransform: 'uppercase', padding: '.5rem .9rem', borderRadius: '.2rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                        Delete
                      </button>
                      <SmallButton onClick={() => setConfirmDelete(null)}>Keep</SmallButton>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                      <SmallButton onClick={() => void editDraft(n)} disabled={busy}>Edit</SmallButton>
                      <button type="button" onClick={() => void send(n)} disabled={!!sendingId}
                        style={{ background: sendingId ? 'var(--border)' : ACCENT, border: 'none', color: sendingId ? 'var(--text-3)' : '#fff', fontWeight: 900, fontSize: '.6rem', letterSpacing: '.1em', textTransform: 'uppercase', padding: '.5rem .9rem', borderRadius: '.2rem', cursor: sendingId ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                        {busy ? 'Sending…' : 'Send'}
                      </button>
                      <SmallButton onClick={() => setConfirmDelete(n.id)} disabled={busy} danger>Delete</SmallButton>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Sent ──────────────────────────────────────────────────────────── */}
      <section>
        <p style={{ color: 'var(--text)', fontSize: '.6rem', fontWeight: 900, letterSpacing: '.3em', textTransform: 'uppercase', marginBottom: '.4rem' }}>History</p>
        <h2 style={{ color: 'var(--text)', fontWeight: 900, fontSize: '1.25rem', textTransform: 'uppercase', letterSpacing: '-.01em', marginBottom: '1rem' }}>Sent</h2>

        {loading || outage ? null : sent.length === 0 ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.875rem' }}>Nothing has gone out yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {sent.map(n => {
              const open = expandedId === n.id
              return (
                <div key={n.id} style={{ background: 'var(--surface)', border: `1px solid ${open ? ACCENT : 'var(--surface-2)'}`, borderRadius: '.25rem', padding: '.9rem 1.1rem' }}>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.25rem' }}>
                        <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '.85rem' }}>{n.subject}</span>
                        <Chip>{AUDIENCE_LABEL[n.audience]}</Chip>
                        {hasPoll[n.id] && <Chip tone="quiet">Poll</Chip>}
                      </div>
                      <p style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>
                        {n.recipient_count} {n.recipient_count === 1 ? 'recipient' : 'recipients'}
                        {n.sent_at ? ` · sent ${fmtDate(n.sent_at)}` : ''}
                      </p>
                    </div>

                    <SmallButton onClick={() => setExpandedId(prev => (prev === n.id ? null : n.id))} expanded={open}>
                      {open ? 'Hide' : 'View'}
                    </SmallButton>
                  </div>

                  {open && (
                    <SentDetailView
                      newsletter={n}
                      detail={details[n.id]}
                      onRefresh={() => void loadDetail(n.id)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Email signups (the older, separate list) ──────────────────────── */}
      <EmailSignups isDemo={isDemo} />
    </div>
  )
}

/** Whether one person has opened their copy. Not whether they liked it. */
function SeenPill({ seen }: { seen: boolean }) {
  const c = seen ? '#22c55e' : '#eab308'
  return (
    <span style={{ background: `${c}18`, border: `1px solid ${c}`, color: c, fontSize: '.55rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.2rem .55rem', borderRadius: '.2rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {seen ? 'Seen' : 'Unread'}
    </span>
  )
}

/**
 * One sent newsletter, opened up: what went out, who got it, how the poll landed.
 *
 * The recipient list is the whole reason this exists. A send fans out into one
 * conversation per person, so "has Maria read it" is otherwise a question you
 * answer by scrolling forty conversations. `newsletter_recipients` gathers them
 * back into one list, and it carries delivery and seen state and NOTHING else.
 *
 * The poll below it is deliberately `disabled`. A sender is not a recipient of
 * their own newsletter and has no ballot to cast, and the tallies are the same
 * definer aggregate everybody else reads, so this is a results board rather
 * than a poll anybody can push.
 */
function SentDetailView({
  newsletter, detail, onRefresh,
}: {
  newsletter: BroadcastNewsletter
  detail: SentDetail | undefined
  onRefresh: () => void
}) {
  const pending = !detail || detail.loading
  const seenCount = detail ? detail.recipients.filter(p => p.seen).length : 0

  return (
    <div style={{ borderTop: '1px solid var(--surface-2)', marginTop: '.9rem', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1.35rem' }}>
      {/* ── What went out ─────────────────────────────────────────────────── */}
      <div>
        <p style={{ ...DETAIL_LABEL, marginBottom: '.5rem' }}>What went out</p>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--surface-2)', borderRadius: '.25rem .25rem .25rem 0', padding: '.85rem 1rem', maxWidth: 560 }}>
          <p style={{ color: 'var(--text-2)', fontSize: '.85rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {newsletter.body}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '.55rem' }}>
          <Chip>{AUDIENCE_LABEL[newsletter.audience]}</Chip>
          <span style={{ color: 'var(--text-4)', fontSize: '.72rem' }}>
            {newsletter.sent_at ? `Sent ${fmtDate(newsletter.sent_at)}` : 'Sent'} to {newsletter.recipient_count}{' '}
            {newsletter.recipient_count === 1 ? 'person' : 'people'}
          </span>
        </div>
      </div>

      {/* ── Who got it ────────────────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '.5rem' }}>
          <p style={DETAIL_LABEL}>Sent to</p>
          <button type="button" onClick={onRefresh} disabled={pending}
            style={{ background: 'none', border: 'none', color: pending ? 'var(--text-dim)' : 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', cursor: pending ? 'default' : 'pointer', fontFamily: 'inherit', padding: 0 }}>
            Refresh
          </button>
        </div>

        {!detail || detail.loading ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.75rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>Loading…</p>
        ) : detail.outage ? (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--surface-2)', borderRadius: '.25rem', padding: '1.25rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text)', fontSize: '.85rem', fontWeight: 700, marginBottom: '.3rem' }}>We could not load recipients.</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.8rem', marginBottom: '1rem' }}>That is on our side. The newsletter went out either way.</p>
            <button type="button" onClick={onRefresh}
              style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--text)', color: 'var(--text)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '0 0 .25rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              Try again
            </button>
          </div>
        ) : detail.recipients.length === 0 ? (
          <p style={{ color: 'var(--text-4)', fontSize: '.82rem' }}>Nobody received this one.</p>
        ) : (
          <>
            <p style={{ color: 'var(--text-4)', fontSize: '.72rem', marginBottom: '.5rem' }}>
              {seenCount} of {detail.recipients.length} opened it.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
              {detail.recipients.map(person => (
                <div key={person.id} style={{ background: 'var(--bg)', border: '1px solid var(--surface-2)', borderRadius: '.2rem', padding: '.5rem .7rem', display: 'flex', gap: '.75rem', alignItems: 'center' }}>
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--text-2)', fontSize: '.82rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {person.display_name}
                  </span>
                  <span style={{ color: 'var(--text-4)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', flexShrink: 0 }}>
                    {ROLE_LABEL[person.role]}
                  </span>
                  <SeenPill seen={person.seen} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── How the poll landed ───────────────────────────────────────────── */}
      {detail?.poll && (
        <div>
          <p style={{ ...DETAIL_LABEL, marginBottom: '.5rem' }}>Results</p>
          <PollWidget state={detail.poll} onVote={() => {}} disabled />
          <p style={{ color: 'var(--text-4)', fontSize: '.7rem', marginTop: '.5rem', lineHeight: 1.5 }}>
            Counts only. Nobody, you included, can see who picked what.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * The lead-capture list, folded away. It has nothing to do with the in-app
 * newsletter above, but it is the first place somebody looks for "the mailing
 * list", so it lives here rather than nowhere.
 */
function EmailSignups({ isDemo }: { isDemo: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        style={{ background: 'none', border: '1px solid var(--surface-2)', borderRadius: '.25rem', color: 'var(--text-2)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', padding: '.7rem 1.1rem', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '.6rem', width: '100%' }}
      >
        <span style={{ color: 'var(--text-4)', fontSize: '.75rem', lineHeight: 1 }}>{open ? '−' : '+'}</span>
        Email signups
        <span style={{ color: 'var(--text-4)', fontWeight: 400, letterSpacing: 0, textTransform: 'none', fontSize: '.72rem', marginLeft: 'auto' }}>
          People who left an address on the site
        </span>
      </button>

      {open && (
        <div style={{ border: '1px solid var(--surface-2)', borderTop: 'none', borderRadius: '0 0 .25rem .25rem', overflow: 'hidden' }}>
          <NewsletterLeadsPanel isDemo={isDemo} />
        </div>
      )}
    </section>
  )
}
