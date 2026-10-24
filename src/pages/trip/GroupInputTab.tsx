// ============ Trip workspace — Group input tab ============
// Merges the former Suggestions and Decisions tabs into one group-input
// surface. v0.36: a one-row stat strip + filters, needs-you cards float up
// with an amber edge and a digest in the sidebar that scrolls to them,
// decision options show WHO voted what with a tally verdict, the composer
// gains real Day/Category pickers, a visible transport-cost field and
// decision context, and per-filter empty states each get an exit.
// The underlying data model (two tables) and store actions are unchanged.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InlineIcon } from '../../components/icons'
import { scrollBehavior } from '../../lib/motion'
import type { FormEvent } from 'react'
import { Car, ChevronDown, ChevronUp, ClipboardList, Clock, Lightbulb, MapPin, Plus, Scale, Sparkles, Ticket, X } from 'lucide-react'
import { PillNav } from '../../components/PillNav'
import type { StopCategory, StopSuggestion, Trip, TripDecision } from '../../data/types'
import type { CollabOutcome } from '../../store/collabCommand'
import { STOP_CATEGORIES } from '../../data/types'
import {
  useDb, userById, currentUser, addSuggestion, voteSuggestion, addCommentToSuggestion,
  acceptSuggestionIntoTimeline, declineSuggestion, addDecision, voteOnDecision, resolveDecision,
  addCommentToDecision,
  activityFor, resumeSync,
} from '../../store/store'
import { formatInr, minutesToHM } from '../../lib/engine'
import { decisionContext, contextLine, recommendForDecision } from '../../lib/decisionGuide'
import { emptyCopyFor, sliceState } from '../../lib/readState'
import { Avatar, Chip, Field, toast } from '../../components/ui'
import { StateBlock } from '../../components/page/StateBlock'
import { Surface } from '../../components/page/Surface'
import { refuseWhileStaged } from '../../lib/mutationLifecycle'
import { reportCollabOutcome } from '../../lib/collabFeedback'
import type { BusyClaim } from '../../lib/busyClaim'
import { isClaimed, takeClaim } from '../../lib/busyClaim'
import { LocationInput } from '../../components/LocationInput'
import { dayRefFor } from '../../lib/dayRef'
import { editPlaceDraft, persistedPlace, pickPlaceDraft, unresolvedPlace, type PlaceDraft } from '../../lib/placeDraft'
import { cap, timeAgo } from './shared'

// ================= Group input tab =================

type Filter = 'all' | 'open' | 'ideas' | 'decisions' | 'mine' | 'resolved'
type ComposerMode = 'idea' | 'question'
/** One interleaved list entry: either a stop suggestion or a trip decision. */
type GroupItem = { kind: 'idea'; sg: StopSuggestion } | { kind: 'decision'; d: TripDecision }

/** Per-filter empty states — each with its own way out ("Show everything"). */
const EMPTY_COPY: Record<Filter, { icon: 'idea' | 'question'; title: string; body: string }> = {
  all: { icon: 'idea', title: 'Nothing waiting on the group', body: 'Propose stops for everyone to vote on, or raise a decision — both land here with the activity feed.' },
  open: { icon: 'idea', title: 'Nothing open right now', body: 'Every idea and question has landed — propose the next one from the composer.' },
  ideas: { icon: 'idea', title: 'No stop ideas here yet', body: 'Propose one from the composer — the group votes and comments right on the card.' },
  decisions: { icon: 'question', title: 'No open questions', body: 'Raise a decision to turn a group-chat debate into one clear vote.' },
  mine: { icon: 'idea', title: 'You’re all caught up', body: 'Nothing on this trip needs your vote right now.' },
  resolved: { icon: 'question', title: 'Nothing resolved yet', body: 'Once a decision is settled or a suggestion lands on the timeline, it shows up here.' },
}

function itemId(i: GroupItem): string { return i.kind === 'idea' ? i.sg.id : i.d.id }
function itemTitle(i: GroupItem): string { return i.kind === 'idea' ? i.sg.title : i.d.question }

// #334: accepting a suggestion and resolving a decision are written straight to
// the cache (`addStop` / `decisions`), never staged into an open preview — a crew
// signal must not end up inside one person's unkept proposal, where the group
// cannot see it and Keep could silently revert it. So while a preview is open
// they refuse. The rule and its wording now live in the shared lifecycle
// (`refuseWhileStaged`), which is where this surface's own local copy went after
// #424 — one refusal, one sentence, six surfaces.

/** #394: one busy claim per crew-signal row. The claim is read through a ref
 *  because a state closure can still hold the pre-claim render when a fast
 *  second click lands before React re-renders — the ref makes the refusal
 *  synchronous, the state only paints it. The claim is never released on
 *  SUCCESS: the store write spends the row inside the same handler, the
 *  buttons that carried it unmount with the row, and nothing is left waiting
 *  on a network tail (see lib/busyClaim for why releasing on one would be a
 *  bug). Stage A of #832 made decline/resolve receipts ASYNC, and a refused
 *  write leaves the row on screen — so a failed outcome releases the claim
 *  (releaseClaim), or the row's buttons would strand disabled forever. */
function useBusyClaim(key: string): { busy: boolean; claim: () => boolean; release: () => void } {
  const claimsRef = useRef<BusyClaim>(new Set())
  const [claims, setClaims] = useState<BusyClaim>(() => new Set())
  const claim = useCallback(() => {
    const taken = takeClaim(claimsRef.current, key)
    if (!taken.claimed) return false
    claimsRef.current = taken.claims
    setClaims(taken.claims)
    return true
  }, [key])
  const release = useCallback(() => {
    if (!claimsRef.current.has(key)) return
    const next = new Set(claimsRef.current)
    next.delete(key)
    claimsRef.current = next
    setClaims(next)
  }, [key])
  return { busy: isClaimed(claims, key), claim, release }
}

export function GroupInputTab({ trip, editable, me, previewOpen }: {
  trip: Trip
  editable: boolean
  me: NonNullable<ReturnType<typeof currentUser>>
  /** true while the workspace holds a staged change — the crew-signal buttons
   *  below write the committed row, so they must not race a preview (#334). */
  previewOpen?: boolean
}) {
  const db = useDb()
  const memberCount = (trip.members ?? []).length
  const [filter, setFilter] = useState<Filter>('all')
  const [composerMode, setComposerMode] = useState<ComposerMode>('idea')

  const suggestions = db.suggestions.filter(s => s.tripId === trip.id)
  const decisions = db.decisions.filter(d => d.tripId === trip.id)
  const tripActivity = activityFor(trip.id)

  // #704: a failed or pending read never hides loaded cards. The empty copy shows
  // only for an empty list that read successfully. The list fails when either
  // slice fails, and it reads while either slice is still pending.
  const suggestionsRead = sliceState(db.sliceReads, 'suggestions')
  const decisionsRead = sliceState(db.sliceReads, 'decisions')
  const listFailed = suggestionsRead === 'failed' || decisionsRead === 'failed'
  const listReading = !listFailed && (suggestionsRead === 'reading' || decisionsRead === 'reading')
  const activityRead = sliceState(db.sliceReads, 'activity')
  // Retry re-issues the read through the same re-hydrate that app resume runs.
  const retryGroupInput = () => { void resumeSync() }

  // "Needs you" spans both kinds: an open item I haven't voted on.
  const suggestionNeedsMe = (sg: StopSuggestion) => sg.status === 'open' && !sg.votes.some(v => v.userId === me.id)
  const decisionNeedsMe = (d: TripDecision) => d.status === 'open' && !d.votesByUserId[me.id]
  const itemNeedsMe = (i: GroupItem) => i.kind === 'idea' ? suggestionNeedsMe(i.sg) : decisionNeedsMe(i.d)
  const itemResolved = (i: GroupItem) => i.kind === 'idea' ? i.sg.status !== 'open' : i.d.status === 'resolved'

  const openSuggestions = suggestions.filter(s => s.status === 'open')
  const openDecisions = decisions.filter(d => d.status === 'open')
  const needsYouCount = openSuggestions.filter(suggestionNeedsMe).length + openDecisions.filter(decisionNeedsMe).length
  const openCount = openSuggestions.length + openDecisions.length
  const resolvedCount = (suggestions.length - openSuggestions.length) + (decisions.length - openDecisions.length)

  // Unified interleaved list: needs-you first, then newest first.
  const items: GroupItem[] = [
    ...suggestions.map(sg => ({ kind: 'idea' as const, sg })),
    ...decisions.map(d => ({ kind: 'decision' as const, d })),
  ].sort((a, b) => {
    if (itemNeedsMe(a) !== itemNeedsMe(b)) return itemNeedsMe(a) ? -1 : 1
    return newestOf(b) - newestOf(a)
  })

  const shown = filter === 'ideas' ? items.filter(i => i.kind === 'idea')
    : filter === 'decisions' ? items.filter(i => i.kind === 'decision')
    : filter === 'open' ? items.filter(i => !itemResolved(i))
    : filter === 'mine' ? items.filter(itemNeedsMe)
    : filter === 'resolved' ? items.filter(itemResolved)
    : items

  const needsYou = items.filter(itemNeedsMe)

  const [pendingTarget, setPendingTarget] = useState<string | null>(null)
  useEffect(() => {
    if (!pendingTarget) return
    const el = document.getElementById(`gi-item-${pendingTarget}`)
    if (!el) return
    el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
    el.focus({ preventScroll: true })
    setPendingTarget(null)
  }, [pendingTarget, shown])

  /** Park the digest request until its card is rendered, even behind a filter. */
  function focusItem(id: string) {
    setPendingTarget(id)
    if (!shown.some(item => itemId(item) === id)) setFilter('all')
  }

  return (
    <div>
      <h2 className="sr-only">Group input</h2>
      {/* ONE filter bar (workspace tab-rail look) — the old count-pill row was
          the same filters in a second visual language. Counts live inside the
          pills; "All" carries the open count, Need you its amber hot badge. */}
      <div className="gi-strip">
        <PillNav className="filter-pillbar" role="group" aria-label="Filter group input" activeKey={filter}>
          <button type="button" data-pill-key="all" className={`clickable-chip chip${filter === 'all' ? ' on-teal' : ''}`}
            onClick={() => setFilter('all')} aria-pressed={filter === 'all'}>
            All{openCount > 0 && <span className="tab-count">{openCount} open</span>}
          </button>
          <button type="button" data-pill-key="ideas" className={`clickable-chip chip${filter === 'ideas' ? ' on-teal' : ''}`}
            onClick={() => setFilter('ideas')} aria-pressed={filter === 'ideas'}>Stop ideas</button>
          <button type="button" data-pill-key="decisions" className={`clickable-chip chip${filter === 'decisions' ? ' on-teal' : ''}`}
            onClick={() => setFilter('decisions')} aria-pressed={filter === 'decisions'}>Decisions</button>
          <button type="button" data-pill-key="mine" className={`clickable-chip chip${filter === 'mine' ? ' on-teal' : ''}`}
            onClick={() => setFilter('mine')} aria-pressed={filter === 'mine'}>
            Need you{needsYouCount > 0 && <span className="tab-count tab-count--hot">{needsYouCount}</span>}
          </button>
          <button type="button" data-pill-key="resolved" className={`clickable-chip chip${filter === 'resolved' ? ' on-teal' : ''}`}
            onClick={() => setFilter('resolved')} aria-pressed={filter === 'resolved'}>
            Resolved{resolvedCount > 0 && <span className="tab-count tab-count--muted">{resolvedCount}</span>}
          </button>
        </PillNav>
      </div>

      <div className="two-col">
        <div>
          {items.length > 0 && listFailed && (
            <StateBlock kind="kept" size="compact" title="Couldn’t refresh group input. Showing what was loaded."
              actions={<button className="btn btn-outline btn-sm" onClick={retryGroupInput}>Try again</button>} />
          )}
          {items.length === 0 && listFailed && (() => {
            const copy = emptyCopyFor('failed', 'group input', retryGroupInput)
            return (
              <StateBlock kind="failed" size="compact" title={copy.title} body={copy.body}
                icon={<Lightbulb size={38} aria-hidden />}
                actions={<button className="btn btn-outline btn-sm" onClick={retryGroupInput}>Try again</button>} />
            )
          })()}
          {items.length === 0 && listReading && (
            <StateBlock kind="loading" size="compact" title="Loading group input…" art={<div className="spinner" />} />
          )}
          {items.length === 0 && !listFailed && !listReading && (
            <StateBlock kind="empty" size="compact" title={EMPTY_COPY.all.title} body={EMPTY_COPY.all.body}
              icon={<Lightbulb size={38} aria-hidden />} />
          )}
          {items.length > 0 && shown.length === 0 && (
            <StateBlock kind="empty" size="compact" title={EMPTY_COPY[filter].title} body={EMPTY_COPY[filter].body}
              icon={EMPTY_COPY[filter].icon === 'idea' ? <Lightbulb size={38} aria-hidden /> : <Scale size={38} aria-hidden />}
              actions={<button className="btn btn-outline btn-sm" onClick={() => setFilter('all')}>Show everything</button>} />
          )}
          {shown.map(item => item.kind === 'idea'
            ? <SuggestionCard key={item.sg.id} sg={item.sg} trip={trip} me={me} editable={editable} memberCount={memberCount}
                needsMe={suggestionNeedsMe(item.sg)} previewOpen={previewOpen} />
            : <DecisionCard key={item.d.id} d={item.d} me={me} editable={editable}
                needsMe={decisionNeedsMe(item.d)} trip={trip} previewOpen={previewOpen} />
          )}

          <Surface className="card gin-panel">
            <h3 className="gin-card-title">Activity feed</h3>
            <hr className="divider" />
            {activityRead === 'failed' && tripActivity.length > 0 && (
              <StateBlock kind="kept" size="compact" title="Couldn’t refresh activity. Showing what was loaded."
                actions={<button className="btn btn-outline btn-sm" onClick={retryGroupInput}>Try again</button>} />
            )}
            {activityRead === 'failed' && tripActivity.length === 0 && (
              <StateBlock kind="failed" size="compact" title="Couldn’t load activity."
                actions={<button className="btn btn-outline btn-sm" onClick={retryGroupInput}>Try again</button>} />
            )}
            {activityRead === 'ready' && tripActivity.length === 0 && (
              <StateBlock kind="empty" size="compact" title="No activity yet." />
            )}
            {tripActivity.slice(0, 20).map(a => (
              <div key={a.id} className="feed-item">
                <Avatar user={userById(a.actorId)} />
                <span><b>{userById(a.actorId)?.profile.name}</b> {a.verb}{a.target ? ` · ${a.target}` : ''}</span>
                <span className="feed-time">{timeAgo(a.at)}</span>
              </div>
            ))}
          </Surface>
        </div>

        <div>
          {needsYou.length > 0 && (
            <Surface className="card gin-digest-card gin-panel">
              <h3 className="gin-card-title">Needs you</h3>
              <hr className="divider" />
              {needsYou.map(i => (
                <button key={itemId(i)} type="button" className="digest-row"
                  onClick={() => focusItem(itemId(i))}>
                  {i.kind === 'idea' ? <Lightbulb size={14} aria-hidden /> : <Scale size={14} aria-hidden />}
                  <span className="digest-title">{itemTitle(i)}</span>
                  <span className="digest-sub num">{digestSub(i)}</span>
                </button>
              ))}
            </Surface>
          )}
          <Surface className="card gin-panel">
            <PillNav className="mode-pillbar" role="group" aria-label="What do you want to add?" activeKey={composerMode}>
              {([['idea', 'Stop idea'], ['question', 'Question']] as const).map(([k, label]) => (
                <button key={k} type="button" data-pill-key={k} className={`tab-btn${composerMode === k ? ' active' : ''}`}
                  onClick={() => setComposerMode(k)} aria-pressed={composerMode === k}>{label}</button>
              ))}
            </PillNav>
            {composerMode === 'idea'
              ? <SuggestionComposerForm trip={trip} />
              : <DecisionComposerForm trip={trip} />}
          </Surface>
        </div>
      </div>
    </div>
  )
}

function newestOf(i: GroupItem): number {
  return i.kind === 'idea' ? i.sg.createdAt : i.d.createdAt
}

/** Sidebar digest subtitle: where my vote is missing. */
function digestSub(i: GroupItem): string {
  if (i.kind === 'idea') {
    const ups = i.sg.votes.filter(v => v.value === 1).length
    return `Day ${i.sg.dayIndex + 1} · ${ups} upvoted so far`
  }
  const votes = Object.keys(i.d.votesByUserId).length
  return votes > 0 ? `${votes} voted so far` : 'Be the first to vote'
}

// ================= Suggestion card =================

function SuggestionCard({ sg, trip, me, editable, memberCount, needsMe, previewOpen }: {
  sg: StopSuggestion
  trip: Trip
  me: NonNullable<ReturnType<typeof currentUser>>
  editable: boolean
  memberCount: number
  needsMe: boolean
  previewOpen?: boolean
}) {
  const ups = sg.votes.filter(v => v.value === 1).length
  const downs = sg.votes.length - ups
  const myVote = sg.votes.find(v => v.userId === me.id)?.value
  const consensusPct = memberCount ? Math.round((ups / memberCount) * 100) : 0
  const author = userById(sg.proposedBy)
  const { busy, claim, release } = useBusyClaim(sg.id)
  // Only the user's CHOICE lives here. The day list is read from the trip at
  // render time: a day removed while the panel was open must disappear from the
  // choices too, instead of offering a day that no longer exists (#839).
  const [retarget, setRetarget] = useState<null | { dayId: string; reason: 'missing-day' | 'legacy-ambiguous' }>(null)
  const [duplicate, setDuplicate] = useState<null | { dayId: string; dayIndex: number }>(null)
  const liveDays = useMemo(() => trip.days.map(d => ({ id: d.id, index: d.index, ...(d.title ? { title: d.title } : {}) })),
    [trip.days])
  // One follow-up at a time. Retarget wins when both somehow want to be open,
  // because the missing day is the question that has to be answered first.
  const followUp: SuggestionFollowUp | null = retarget
    ? { kind: 'retarget', ...retarget }
    : duplicate ? { kind: 'duplicate', ...duplicate } : null

  function accept(opts: { dayId?: string; dayIndex?: number; allowDuplicate?: boolean } = {}) {
    const outcome = acceptSuggestionIntoTimeline(trip.id, sg.id, opts)
    if (outcome.status === 'applied') {
      setRetarget(null); setDuplicate(null)
      toast('Added to timeline')
      return
    }
    if (outcome.status === 'alreadyApplied') {
      setRetarget(null); setDuplicate(null)
      toast('This idea is already on the timeline.')
      return
    }
    if (outcome.status === 'retarget') {
      // The day the user chose is gone, or a legacy index is ambiguous. The idea
      // stays OPEN and they are asked again. Never re-file it onto another day,
      // and never close it with the work lost. This panel replaces the duplicate
      // one, because two follow-ups on one row read as two answers to one
      // question. The first action asked a question rather than writing, so its
      // claim is released here and the follow-up takes its own. That is what lets
      // the follow-up's buttons disable while it is in flight.
      setDuplicate(null)
      release()
      setRetarget({ dayId: '', reason: outcome.reason })
      return
    }
    if (outcome.status === 'visitConflict') {
      setRetarget(null)
      release()
      setDuplicate({ dayId: outcome.dayId, dayIndex: outcome.dayIndex })
      return
    }
    toast(outcome.reason ?? 'Could not add this idea to the timeline.', 'err')
    release()
  }
  return (
    <Surface id={`gi-item-${sg.id}`} tabIndex={-1} className={`card gi-item gin-item-card gin-panel${needsMe ? ' gi-needs-you' : ''}`}>
      <div className="gin-item-layout">
      <div className="vote-col">
        <button className={`vote-btn ${myVote === 1 ? 'on' : ''}`} onClick={() => void voteSuggestion(trip.id, sg.id, 1).then(o => reportCollabOutcome(o))} aria-label="Upvote" aria-pressed={myVote === 1}><ChevronUp size={13} aria-hidden /></button>
        <span className="vote-count">{ups - downs}</span>
        <button className={`vote-btn ${myVote === -1 ? 'on' : ''}`} onClick={() => void voteSuggestion(trip.id, sg.id, -1).then(o => reportCollabOutcome(o))} aria-label="Downvote" aria-pressed={myVote === -1}><ChevronDown size={13} aria-hidden /></button>
      </div>
      <div>
        <div className="row-between">
          <h3 className="gin-card-title">{sg.title}</h3>
          <span className="gin-chip-group">
            {needsMe && <Chip tone="saffron">Needs your vote</Chip>}
            {sg.status === 'open' && consensusPct >= 60 && <Chip tone="teal">Best fit</Chip>}
            <Chip tone={sg.status === 'accepted' ? 'ok' : sg.status === 'declined' ? 'danger' : 'teal'}>{cap(sg.status)}</Chip>
          </span>
        </div>
        <div className="creator-line gin-creator-line">
          <Avatar user={author} /> {author?.profile.name ?? 'Traveller'} suggested for Day {sg.dayIndex + 1}
        </div>
        {sg.description && <p className="small muted">{sg.description}</p>}
        <div className="stop-meta gin-stop-meta">
          <span><MapPin size={13} aria-hidden /> {sg.locationName}</span>
          <span><Clock size={13} aria-hidden /> {minutesToHM(sg.visitMinutes)}</span>
          <span><Ticket size={13} aria-hidden /> ₹{sg.estimatedEntryFeeInr}/person</span>
          <span><Car size={13} aria-hidden /> ₹{sg.estimatedTransportInr} transport</span>
        </div>
        <div className="gin-consensus-row">
          <div className="consensus-bar gin-consensus-track" role="img" aria-label={`Consensus ${consensusPct}% of members upvoted`}>
            {/* neutral → amber → green, each clearing 3:1 on the --bg-soft track
                in both themes (was --line 1.18 / --saffron 1.85 / --ok 3.67 — the
                low segment was invisible and mid failed the non-text floor). */}
            <div style={{ width: `${consensusPct}%`, background: consensusPct >= 60 ? 'var(--ink-ok)' : consensusPct >= 35 ? 'var(--ink-amber)' : 'var(--text-3)' }} />
          </div>
          <span className="small muted num gin-consensus-count">{ups} of {memberCount} upvoted</span>
        </div>

        {editable && sg.status === 'open' && (
          // off-ladder 11px: stays inline until the page redesign
          <div className="gin-item-actions" style={{ marginTop: 11 }}>
            <button className="btn btn-primary btn-sm" disabled={busy} aria-busy={busy} onClick={() => {
              if (refuseWhileStaged(previewOpen)) return
              if (!claim()) return
              accept()
            }}>Add to timeline</button>
            <button className="btn btn-danger btn-sm" disabled={busy} aria-busy={busy} onClick={() => {
              if (refuseWhileStaged(previewOpen)) return
              if (!claim()) return
              void declineSuggestion(trip.id, sg.id).then(o => {
                reportCollabOutcome(o, 'Suggestion declined')
                // A refused receipt leaves the row on screen with its status
                // unchanged — free the claim or the buttons strand disabled.
                if (o.status !== 'applied' && o.status !== 'alreadyApplied') release()
              })
            }}>Decline</button>
          </div>
        )}

        {followUp && (
          <SuggestionFollowUpPanel
            followUp={followUp}
            days={liveDays}
            busy={busy}
            previewOpen={previewOpen}
            onPickDay={dayId => setRetarget(r => (r ? { ...r, dayId } : r))}
            onConfirm={() => {
              if (!claim()) return
              if (followUp.kind === 'retarget') accept({ dayId: followUp.dayId })
              else accept({ dayId: followUp.dayId, allowDuplicate: true })
            }}
            onCancel={() => {
              if (followUp.kind === 'retarget') setRetarget(null)
              else setDuplicate(null)
              release()
            }}
          />
        )}

        {sg.comments.length > 0 && (
          <div className="gin-comments">
            {sg.comments.map(c => (
              <div key={c.id} className="comment">
                <Avatar user={userById(c.authorId)} />
                <div className="comment-body">
                  <span className="comment-author">{userById(c.authorId)?.profile.name}</span>
                  <span className="comment-time">{timeAgo(c.createdAt)}</span>
                  <div>{c.text}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <CommentForm onSubmit={text => addCommentToSuggestion(trip.id, sg.id, text).then(o => { reportCollabOutcome(o); return o })} />
      </div>
      </div>
    </Surface>
  )
}

// ================= The one follow-up a suggestion row can be asking =================
// Retarget ("that day is gone, pick another") and repeat ("this place is already
// on that day, add another visit?") are the SAME question shape: a sentence, a
// choice, a confirm and a cancel. Rendering them from one component is what makes
// them mutually exclusive by construction — a row cannot ask two questions at
// once, which is how the two panels used to stack (#839).

export type SuggestionFollowUp =
  | { kind: 'retarget'; dayId: string; reason: 'missing-day' | 'legacy-ambiguous' }
  | { kind: 'duplicate'; dayId: string; dayIndex: number }

export function SuggestionFollowUpPanel({ followUp, days, busy, previewOpen, onPickDay, onConfirm, onCancel }: {
  followUp: SuggestionFollowUp
  /** The trip's CURRENT days, read at render time — never a captured list. */
  days: Array<{ id: string; index: number; title?: string }>
  busy: boolean
  previewOpen?: boolean
  onPickDay: (dayId: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const noDays = days.length === 0
  const canConfirm = followUp.kind === 'duplicate' || (!!followUp.dayId && !noDays)
  return (
    <div className="gin-item-actions gin-followup" role="group"
      aria-label={followUp.kind === 'retarget' ? 'Choose a day for this idea' : 'Add another visit'}>
      {followUp.kind === 'retarget' ? (
        <>
          <p className="small muted">
            {followUp.reason === 'legacy-ambiguous'
              ? 'This idea names a day by number and more than one day now matches it. Choose the day, or cancel to keep the idea here.'
              : 'That day is no longer on this trip. Choose another day, or cancel to keep the idea here.'}
          </p>
          {noDays ? (
            // No day to offer and none invented: the honest instruction is to add
            // one, and Cancel keeps the idea exactly as it is.
            <p className="small">This trip has no days yet. Add a day in the timeline, then choose Add to timeline again.</p>
          ) : (
            <select className="select" aria-label="Day for this idea" value={followUp.dayId}
              onChange={e => onPickDay(e.target.value)}>
              <option value="">Pick a day</option>
              {days.map(d => <option key={d.id} value={d.id}>Day {d.index + 1}{d.title ? ` · ${d.title}` : ''}</option>)}
            </select>
          )}
        </>
      ) : (
        <p className="small muted">This place is already on Day {followUp.dayIndex + 1}. Add another visit, or cancel to keep the idea open.</p>
      )}
      <button className="btn btn-primary btn-sm" disabled={busy || !canConfirm} aria-busy={busy}
        onClick={() => {
          // The row's own guards, again: no write while a preview is staged, one
          // claim per row so a double-tap cannot land the idea twice, and no
          // confirm without an actual choice.
          if (refuseWhileStaged(previewOpen)) return
          if (!canConfirm) return
          onConfirm()
        }}>
        {followUp.kind === 'retarget' ? 'Add to chosen day' : 'Add another visit'}
      </button>
      {/* Cancel stays live while the claim is held: cancelling is how the claim
          is given back, so disabling it would strand the row. */}
      <button className="btn btn-outline btn-sm" onClick={onCancel}>Cancel</button>
    </div>
  )
}

function CommentForm({ onSubmit }: { onSubmit: (text: string) => Promise<CollabOutcome> }) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  return (
    <form className="gin-comment-form" onSubmit={e => {
      e.preventDefault()
      const trimmed = text.trim()
      if (!trimmed || pending) return
      setPending(true)
      // The draft clears on the RECEIPT, not on the click (gate round 2):
      // a refused send keeps what the planner typed, and a second submit
      // waits for the first to settle.
      void onSubmit(trimmed).then(o => {
        if (o.status === 'applied' || o.status === 'alreadyApplied') setText('')
        setPending(false)
      })
    }}>
      <input className="input" placeholder="Add a comment…" aria-label="Add a comment" value={text} onChange={e => setText(e.target.value)} />
      <button className="btn btn-sm btn-outline" disabled={pending} aria-busy={pending}>Post</button>
    </form>
  )
}

// ================= Decision card =================

function DecisionCard({ d, me, editable, needsMe, trip, previewOpen }: {
  d: TripDecision
  me: { id: string }
  editable: boolean
  needsMe: boolean
  trip: Trip
  previewOpen?: boolean
}) {
  const tally = d.options.map(o => Object.values(d.votesByUserId).filter(v => v === o.id).length)
  const totalVotes = tally.reduce((s, t) => s + t, 0)
  const leadingIdx = totalVotes > 0 ? tally.indexOf(Math.max(...tally)) : -1
  const votersOf = (optionId: string) => Object.entries(d.votesByUserId).filter(([, o]) => o === optionId).map(([u]) => u)
  // Grounded trip context + offline recommendation (§6.8): the deterministic
  // guide, using the same engine data the Overview shows. Recomputed when the
  // trip or decision changes (a new vote can flip the tie-break).
  const ctx = useMemo(() => decisionContext(trip), [trip])
  const rec = useMemo(() => recommendForDecision(trip, d, ctx), [trip, d, ctx])
  const { busy, claim, release } = useBusyClaim(d.id)

  return (
    <Surface id={`gi-item-${d.id}`} tabIndex={-1} className={`card gi-item gin-item-card gin-panel${needsMe ? ' gi-needs-you' : ''}`}>
      <div className="row-between">
        <h3 className="gin-card-title">{d.question}</h3>
        <span className="gin-chip-group">
          {needsMe && <Chip tone="saffron">Needs your vote</Chip>}
          <Chip tone={d.status === 'open' ? 'saffron' : 'ok'}>{cap(d.status)}</Chip>
        </span>
      </div>
      {d.context && <p className="small muted gin-decision-context">{d.context}</p>}
      <div className="gin-decision-options">
        {d.options.map((o, i) => {
          const mine = d.votesByUserId[me.id] === o.id
          const voters = votersOf(o.id)
          const leading = d.status === 'open' && i === leadingIdx && tally[i] > 0
          return (
            <div key={o.id} className={`decision-option-row${leading ? ' leading' : ''}`}>
              <button className={`vote-btn ${mine ? 'on' : ''}`} disabled={d.status === 'resolved'} aria-pressed={mine}
                onClick={() => void voteOnDecision(d.id, o.id).then(o2 => reportCollabOutcome(o2))} aria-label={`Vote for ${o.label}`}><ChevronUp size={13} aria-hidden /></button>
              <span className="gin-option-label">
                {o.label}
                {o.timeImpactMin ? <span className="muted small num"> · ≈{o.timeImpactMin} min detour</span> : null}
                {o.costImpactInr ? <span className="muted small num"> · {o.costImpactInr > 0 ? '+' : ''}{formatInr(o.costImpactInr)}</span> : null}
              </span>
              {voters.length > 0 && (
                <span className="who-voted" role="img" aria-label={`Voted for this: ${voters.map(v => userById(v)?.profile.name ?? 'Traveller').join(', ')}`}>
                  {voters.slice(0, 4).map(v => <Avatar key={v} user={userById(v)} />)}
                  {voters.length > 4 && <span className="who-more">+{voters.length - 4}</span>}
                </span>
              )}
              {tally[i] > 0 && <Chip tone="info">{tally[i]} vote{tally[i] !== 1 ? 's' : ''}</Chip>}
              {d.status === 'resolved' && d.resolvedOptionId === o.id && <Chip tone="ok">Chosen</Chip>}
            </div>
          )
        })}
      </div>
      {d.status === 'open' && (
        <div className="gi-guide gin-guide-block">
          <p className="small muted gin-guide-note">
            <InlineIcon icon={ClipboardList} size={12} gap={4} />
            {contextLine(ctx)}
          </p>
          {rec && (
            <p className="small gin-guide-rec">
              <InlineIcon icon={Sparkles} size={12} gap={4} />
              <b>{rec.label}</b> — {rec.reason} <Chip tone="info">offline</Chip>
            </p>
          )}
        </div>
      )}
      {d.status === 'open' && totalVotes > 0 && (
        <p className="small muted verdict-line">
          Tally leans <b>{d.options[leadingIdx]?.label}</b>{needsMe ? ' — your vote could flip it' : ' — editors resolve'}.
        </p>
      )}
      {editable && d.status === 'open' && (
        <div className="resolve-btns">
          {d.options.map((o, i) => (
            <button key={o.id} className={`btn btn-sm ${i === leadingIdx ? 'btn-primary' : 'btn-outline'}`} disabled={busy} aria-busy={busy}
              onClick={() => {
                if (refuseWhileStaged(previewOpen)) return
                if (!claim()) return
                void resolveDecision(d.id, o.id).then(o2 => {
                  reportCollabOutcome(o2, 'Decision resolved')
                  // A refused receipt leaves the poll open — free the claim
                  // or the Resolve buttons strand disabled.
                  if (o2.status !== 'applied' && o2.status !== 'alreadyApplied') release()
                })
              }}>
              Resolve: {o.label}
            </button>
          ))}
        </div>
      )}
      {/* Discussion, same card language as suggestions (I-7): comments stay
          visible on a resolved decision — the record of why it was chosen. */}
      {d.comments.length > 0 && (
        <div className="gin-comments">
          {d.comments.map(c => (
            <div key={c.id} className="comment">
              <Avatar user={userById(c.authorId)} />
              <div className="comment-body">
                <span className="comment-author">{userById(c.authorId)?.profile.name}</span>
                <span className="comment-time">{timeAgo(c.createdAt)}</span>
                <div>{c.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <CommentForm onSubmit={text => addCommentToDecision(trip.id, d.id, text).then(o => { reportCollabOutcome(o); return o })} />
    </Surface>
  )
}

// ================= Composer forms =================

function SuggestionComposerForm({ trip }: {
  trip: Trip
}) {
  const [form, setForm] = useState({
    title: '', dayIndex: 0, category: 'sightseeing' as StopCategory,
    description: '', visitMinutes: 60, entryFee: 0, transportCost: 200,
  })
  const [place, setPlace] = useState<PlaceDraft>(() => unresolvedPlace(''))
  const [pending, setPending] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    if (!form.title.trim()) { toast('Give your suggestion a name.', 'err'); return }
    if (place.kind !== 'resolved') {
      toast('Pick the place from the search suggestions so the idea keeps its exact location.', 'err')
      return
    }
    const day = trip.days.find(d => d.index === form.dayIndex)
    if (!day) { toast('That day is no longer on this trip. Choose another day.', 'err'); return }
    const ref = dayRefFor(trip, day.index)
    setPending(true)
    void addSuggestion(trip.id, {
      dayIndex: day.index, ...(ref.dayId ? { dayId: ref.dayId } : {}),
      title: form.title.trim(), category: form.category,
      locationName: place.place.label, lat: place.place.lat, lng: place.place.lng,
      place: persistedPlace(place.place),
      description: form.description,
      visitMinutes: form.visitMinutes, estimatedEntryFeeInr: form.entryFee,
      estimatedTransportInr: form.transportCost,
    }).then(o => {
      reportCollabOutcome(o, 'Suggestion shared with the group!')
      // The draft clears on the RECEIPT, not on the click — a refused write
      // must not erase what the planner typed (#802's optimistic-success half).
      if (o.status === 'applied' || o.status === 'alreadyApplied') {
        setForm(f => ({ ...f, title: '', description: '' }))
        setPlace(unresolvedPlace(''))
      }
      setPending(false)
    })
  }

  return (
    <form onSubmit={submit}>
      <h3 className="gin-card-title">Add to the plan</h3>
      <p className="hint-text gin-composer-hint">Others can vote and comment; editors can accept it into the timeline.</p>
      <Field label="Idea"><input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Pothamedu viewpoint" /></Field>
      <div className="form-row">
        <Field label="Day">
          <select className="select" value={form.dayIndex} onChange={e => setForm(f => ({ ...f, dayIndex: Number(e.target.value) }))}>
            {trip.days.map(d => <option key={d.id} value={d.index}>Day {d.index + 1}{d.title ? ` · ${d.title}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select className="select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as StopCategory }))}>
            {STOP_CATEGORIES.map(c => <option key={c} value={c}>{cap(c)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Area" hint={place.kind === 'unresolved' && place.text ? 'Pick a search result to pin the idea to an exact place.' : undefined}>
        <LocationInput value={place.text} onChange={v => setPlace(d => editPlaceDraft(d, v))} onPick={p => setPlace(pickPlaceDraft(p))} placeholder="Search, e.g. Munnar" />
      </Field>
      <div className="form-row">
        <Field label="Visit minutes"><input type="number" className="input" min={15} step={5} value={form.visitMinutes} onChange={e => setForm(f => ({ ...f, visitMinutes: Number(e.target.value) }))} /></Field>
        <Field label="Entry fee ₹/person"><input type="number" className="input" min={0} value={form.entryFee} onChange={e => setForm(f => ({ ...f, entryFee: Number(e.target.value) }))} /></Field>
      </div>
      <Field label="Transport ₹ (total, to get there and back)" hint="Feeds the Budget tab’s per-day bars when accepted.">
        <input type="number" className="input" min={0} value={form.transportCost} onChange={e => setForm(f => ({ ...f, transportCost: Number(e.target.value) }))} />
      </Field>
      <Field label="Why it’s worth it"><textarea className="textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></Field>
      <button className="btn btn-primary gin-submit">Share with the group</button>
    </form>
  )
}

function DecisionComposerForm({ trip }: { trip: Trip }) {
  const [q, setQ] = useState('')
  const [context, setContext] = useState('')
  const [opts, setOpts] = useState([{ label: '', cost: '' }, { label: '', cost: '' }])
  const [pending, setPending] = useState(false)

  function setOpt(i: number, key: 'label' | 'cost', v: string) {
    setOpts(list => list.map((o, j) => j === i ? { ...o, [key]: v } : o))
  }

  function create(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    if (!q.trim()) { toast('Write the question first.', 'err'); return }
    const built = opts
      .map(o => ({ label: o.label.trim(), cost: Number(o.cost) || 0 }))
      .filter(o => o.label)
    if (built.length < 2) { toast('Give at least two options.', 'err'); return }
    setPending(true)
    void addDecision(trip.id, {
      question: q.trim(),
      context: context.trim() || undefined,
      // #335: no placeholder ids — a hand-typed poll gets real ones from the
      // store, which preserves an id a caller does supply (the Map rail's
      // slot and place ids are load-bearing).
      options: built.map(o => ({ label: o.label, costImpactInr: o.cost || undefined })),
    }).then(o => {
      reportCollabOutcome(o, 'Decision posted for the group')
      if (o.status === 'applied' || o.status === 'alreadyApplied') {
        setQ(''); setContext(''); setOpts([{ label: '', cost: '' }, { label: '', cost: '' }])
      }
      setPending(false)
    })
  }

  return (
    <form onSubmit={create}>
      <h3 className="gin-card-title">Raise a decision</h3>
      <p className="hint-text gin-composer-hint">Turn endless group-chat debates into one clear vote.</p>
      <Field label="Question"><input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Beach day or backwater day on Day 3?" /></Field>
      <Field label="Context (optional)" hint="Why the group is deciding — e.g. “forecast says one beach afternoon is a washout”.">
        <input className="input" value={context} onChange={e => setContext(e.target.value)} />
      </Field>
      <Field label="Options" hint="At least two — cost impact is optional.">
        <span className="gin-option-grid">
          {opts.map((o, i) => (
            <span key={i} className="opt-row">
              <input className="input" placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} value={o.label} onChange={e => setOpt(i, 'label', e.target.value)} />
              <input className="input opt-cost" type="number" placeholder="₹ impact" aria-label={`Cost impact of option ${i + 1}, optional`} value={o.cost} onChange={e => setOpt(i, 'cost', e.target.value)} />
              {opts.length > 2 && (
                <button type="button" className="icon-btn" aria-label={`Remove option ${i + 1}`} onClick={() => setOpts(list => list.filter((_, j) => j !== i))}><X size={14} /></button>
              )}
            </span>
          ))}
          <span>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpts(list => [...list, { label: '', cost: '' }])}><Plus size={14} aria-hidden /> Add option</button>
          </span>
        </span>
      </Field>
      <button className="btn btn-primary gin-submit">Post decision</button>
    </form>
  )
}
