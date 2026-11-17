// ============ Trip workspace — Group input tab ============
// S9 "Decide together": one header with a segmented pill bar, then three columns.
// Decisions sit in the first column. Stop ideas and their composers sit in the
// second. The activity feed sits in the third. The data model and the store
// actions are unchanged.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CatIcon, InlineIcon } from '../../components/icons'
import { motionTiming, scrollBehavior } from '../../lib/motion'
import { presenceAttrs, usePresenceList } from '../../lib/usePresenceList'
import type { CSSProperties, FormEvent } from 'react'
import { Car, Check, ChevronDown, ChevronUp, ClipboardList, Clock, Heart, Lightbulb, MapPin, MessageSquare, Plus, Scale, Sparkles, Ticket, X } from 'lucide-react'
import { PillNav } from '../../components/PillNav'
import type { CrewInterest, StopCategory, StopSuggestion, Trip, TripDecision } from '../../data/types'
import type { AcceptanceOutcome, CollabOutcome } from '../../store/collabCommand'
import { STOP_CATEGORIES } from '../../data/types'
import {
  useDb, userById, currentUser, addSuggestion, voteSuggestion, addCommentToSuggestion,
  acceptSuggestionIntoTimeline, declineSuggestion, addDecision, voteOnDecision, resolveDecision,
  addCommentToDecision, addDecisionOption,
  loadCrewPreferences, setMyCrewPreferences, useCrewPreferenceRows, useCrewPreferenceReads,
  activityFor, resumeSync,
} from '../../store/store'
import { formatInr, minutesToHM } from '../../lib/engine'
import { decisionContext, contextLine, recommendForDecision } from '../../lib/decisionGuide'
import { emptyCopyFor, sliceState } from '../../lib/readState'
import { formatSpan, hasClosingTime, isVoteClosed, voteOutcome } from '../../lib/decisionClock'
import { useTimeFormat } from '../../lib/timefmt'
import { canAddOption, checkNewOptionLabel } from '../../lib/decisionOptions'
import { myCrewPreference, summarizeCrewPreferences } from '../../lib/crewPreferences'
import {
  CREW_QUIZ_INTERESTS, closingStamp, crewBars, dayOptionLabel, localInputValue, sameInterests, decisionDayLabel, optionLabelRefusal, parseClosesAt, votingClosedLine,
} from '../../lib/groupInputView'
import { Avatar, Chip, Field, toast, useInView, usePageVisible } from '../../components/ui'
import { assignAvatarTones } from '../../lib/avatarTone'
import { FilterChip } from '../../components/filters/FilterChip'
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
import { SmoothCollapse } from './timeline/DaySection'
import {
  runDecisionResolution,
  type LegacyResolutionTarget,
  type SlotResolutionContext,
} from './slotResolutionAdapter'

// ================= Group input tab =================

/** The three content sections: decisions, stop ideas and the activity feed. */
type Section = 'decisions' | 'ideas' | 'activity'
/** The pill bar keys. "needs" opens the section that holds the first item needing my vote. */
type View = 'needs' | Section
/** The DOM id of each section, so the pill bar can scroll to and focus it. */
const SECTION_DOM: Record<Section, string> = {
  decisions: 'gi-section-decisions',
  ideas: 'gi-section-ideas',
  activity: 'gi-section-activity',
}
/** The base class of each column. Written out, so every class name stays greppable. */
const COL_CLASS: Record<Section, string> = {
  decisions: 'gin-col gin-col--decisions',
  ideas: 'gin-col gin-col--ideas',
  activity: 'gin-col gin-col--activity',
}
/** One interleaved list entry: either a stop suggestion or a trip decision. */
type GroupItem = { kind: 'idea'; sg: StopSuggestion } | { kind: 'decision'; d: TripDecision }

/** Empty copy. Each one shows only after its read has settled with no rows. */
const EMPTY_COPY = {
  all: { title: 'Nothing waiting on the group', body: 'Propose stops for everyone to vote on, or raise a decision. Both land here with the activity feed.' },
  ideas: { title: 'No stop ideas here yet', body: 'Use Add an idea above. The group votes and comments on each row.' },
  ideasOpen: { title: 'No open stop ideas', body: 'Every idea has an answer. Use Add an idea for the next one.' },
  decisions: { title: 'No open questions', body: 'Raise a decision to turn a group-chat debate into one clear vote.' },
} as const

function itemId(i: GroupItem): string { return i.kind === 'idea' ? i.sg.id : i.d.id }
function newestOf(i: GroupItem): number {
  return i.kind === 'idea' ? i.sg.createdAt : i.d.createdAt
}

/** A pill label. The count shows only after its read has settled, and never when it is zero. */
function pillLabel(base: string, count: number, ready: boolean): string {
  return ready && count > 0 ? `${base} · ${count}` : base
}

/** Up to two initials from a display name, the way the avatar draws them. */
function initialsOf(name: string | undefined): string {
  const initials = (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('')
  return initials.toUpperCase() || '?'
}

/** Day, visit time and the costs an idea records. A zero cost is left out. */
function ideaMeta(sg: StopSuggestion): string {
  const parts = [`Day ${sg.dayIndex + 1}`, minutesToHM(sg.visitMinutes)]
  if (sg.estimatedEntryFeeInr > 0) parts.push(`₹${sg.estimatedEntryFeeInr}/person`)
  if (sg.estimatedTransportInr > 0) parts.push(`₹${sg.estimatedTransportInr} transport`)
  return parts.join(' · ')
}

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

/** The clock, read again every 30 seconds. It only words the page (the closing
 *  label and the lock). The server decides whether a ballot is late. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function GroupInputTab({ trip, editable, me, previewOpen, slotResolution }: {
  trip: Trip
  editable: boolean
  me: NonNullable<ReturnType<typeof currentUser>>
  /** true while the workspace holds a staged change — the crew-signal buttons
   *  below write the committed row, so they must not race a preview (#334). */
  previewOpen?: boolean
  /** The committed trip and graded workspace road for slot-vote resolution. */
  slotResolution: SlotResolutionContext | null
}) {
  const db = useDb()
  const now = useNow()
  const memberCount = (trip.members ?? []).length
  const [view, setView] = useState<View>('needs')
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null)
  const [ideaComposerOpen, setIdeaComposerOpen] = useState(false)
  const ideaComposerRef = useRef<HTMLDivElement>(null)
  // The composer takes the focus on its first field when it opens.
  useEffect(() => {
    if (ideaComposerOpen) ideaComposerRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus()
  }, [ideaComposerOpen])
  const [showResolvedIdeas, setShowResolvedIdeas] = useState(false)
  const [showAllActivity, setShowAllActivity] = useState(false)
  const feedToggleRef = useRef<HTMLButtonElement>(null)
  // The entrance staggers only while the tab arrives. The flag drops after the
  // last delayed animation has started, so a row or card that mounts later
  // rises at once instead of waiting for a beat that has already passed. A
  // delay that lapses on a running animation would also make it jump, so the
  // wait is three of the longest steps, which is past the last delay. The
  // window starts when the list read first settles (it is declared below the
  // reads), not at mount: the cards that carry the beats arrive with the read.
  const [intro, setIntro] = useState(true)
  // Below 860px one column shows at a time. A column that has been on screen and
  // then left it is "seen", and its entrance does not play again on a later pill press.
  const [seenCols, setSeenCols] = useState<ReadonlySet<Section>>(() => new Set())
  const [lastShown, setLastShown] = useState<Section | null>(null)
  // The stamp plays on the card that a resolve produced. A resolve moves its
  // decision to the decided group as a new card, so the id lives here.
  const [stampedIds, setStampedIds] = useState<ReadonlySet<string>>(() => new Set())
  const markStamped = useCallback((id: string) => {
    setStampedIds(current => (current.has(id) ? current : new Set(current).add(id)))
  }, [])

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
  const listReady = suggestionsRead === 'ready' && decisionsRead === 'ready'
  // A failed read also settles the list: its kept rows are on screen, so the intro must end.
  const listSettled = listReady || listFailed
  useEffect(() => {
    if (!listSettled) return
    const timer = window.setTimeout(() => setIntro(false), motionTiming('--motion-slower').duration * 3)
    return () => window.clearTimeout(timer)
  }, [listSettled])
  const activityRead = sliceState(db.sliceReads, 'activity')
  // Retry re-issues the read through the same re-hydrate that app resume runs.
  const retryGroupInput = () => { void resumeSync() }

  // "Needs you" spans both kinds: an open item I haven't voted on.
  const suggestionNeedsMe = (sg: StopSuggestion) => sg.status === 'open' && !sg.votes.some(v => v.userId === me.id)
  // A decision past its closing time takes no ballot, so it no longer needs my vote.
  const decisionNeedsMe = (d: TripDecision) => d.status === 'open' && !isVoteClosed(d, now) && !d.votesByUserId[me.id]
  const itemNeedsMe = (i: GroupItem) => i.kind === 'idea' ? suggestionNeedsMe(i.sg) : decisionNeedsMe(i.d)

  // Unified list: needs-you first, then newest first. Both columns keep this order.
  const items: GroupItem[] = [
    ...suggestions.map(sg => ({ kind: 'idea' as const, sg })),
    ...decisions.map(d => ({ kind: 'decision' as const, d })),
  ].sort((a, b) => {
    if (itemNeedsMe(a) !== itemNeedsMe(b)) return itemNeedsMe(a) ? -1 : 1
    return newestOf(b) - newestOf(a)
  })
  const sortedIdeas = items.flatMap(i => (i.kind === 'idea' ? [i.sg] : []))
  const sortedDecisions = items.flatMap(i => (i.kind === 'decision' ? [i.d] : []))
  const openIdeas = sortedIdeas.filter(sg => sg.status === 'open')
  const resolvedIdeas = sortedIdeas.filter(sg => sg.status !== 'open')
  const openDecisions = sortedDecisions.filter(d => d.status === 'open')
  const resolvedDecisions = sortedDecisions.filter(d => d.status === 'resolved')
  const needsYou = items.filter(itemNeedsMe)
  const needsYouCount = needsYou.length

  // The header sentence. A zero count is left out, and the sentence still reads.
  const summary: string[] = []
  if (needsYouCount > 0) summary.push(`${needsYouCount} ${needsYouCount === 1 ? 'vote needs' : 'votes need'} you`)
  if (resolvedDecisions.length > 0) summary.push(`${resolvedDecisions.length} decided`)
  if (openIdeas.length > 0) summary.push(`${openIdeas.length} stop ${openIdeas.length === 1 ? 'idea' : 'ideas'}`)

  // "Needs you" opens the section that holds the first item that needs my vote.
  const needsSection: 'decisions' | 'ideas' = needsYou[0]?.kind === 'idea' ? 'ideas' : 'decisions'
  // Below 860px one column shows at a time. Wider, every column shows.
  const sectionOnScreen: Section = view === 'needs' ? needsSection : view
  // Adjust state while rendering: the column that just left the screen is now seen.
  if (lastShown !== sectionOnScreen) {
    setLastShown(sectionOnScreen)
    if (lastShown) setSeenCols(current => new Set(current).add(lastShown))
  }
  const colClass = (section: Section) =>
    `${COL_CLASS[section]}${sectionOnScreen === section ? ' gin-col--shown' : ''}${seenCols.has(section) ? ' gin-col--seen' : ''}`
  // The beat each column starts on. Beat 0 is the header and beat 1 the bar, so
  // the first card is on beat 2. A column with no card gives its beats away: with
  // no decision cards, Stop ideas takes beat 2. The decision cards use up to three beats.
  const decisionBeats = Math.min(sortedDecisions.length, 3)
  const ideasBeat = 2 + decisionBeats
  const activityBeat = ideasBeat + 2
  const beatOf = (beat: number) => ({ '--col-beat': beat }) as CSSProperties
  const feed = tripActivity.slice(0, 20)
  const feedRows = feed.slice(0, 4)
  const moreFeedRows = feed.slice(4)

  // An idea that leaves the open list (added or declined) stays mounted for one
  // exit (docs/MOTION-TOKENS.md, "List exit"). A decision keys on its id only:
  // one card instance lives through open to decided, so a comment draft, an
  // add-option draft, the day picker and the focus all survive the resolve. The
  // card plays the open-to-decided change inside itself.
  const { entries: ideaEntries, exiting: ideasExiting, attachList: attachIdeaList } = usePresenceList(openIdeas, sg => sg.id, {
    fallbackFocus: () => document.getElementById(SECTION_DOM.ideas),
  })
  const { entries: decisionEntries, attachList: attachDecisionList } = usePresenceList(
    [...openDecisions, ...resolvedDecisions],
    d => d.id,
  )

  /** One tap opens an idea row and its actions. A second tap closes it. */
  function toggleIdea(id: string) {
    setSelectedIdeaId(current => (current === id ? null : id))
  }

  /** One idea row. `exiting` is set only by the open list, which plays an exit. */
  const renderIdea = (sg: StopSuggestion, exiting?: boolean) => (
    <IdeaRow key={sg.id} sg={sg} trip={trip} me={me} editable={editable} memberCount={memberCount}
      needsMe={suggestionNeedsMe(sg)} previewOpen={previewOpen} exiting={exiting}
      selected={selectedIdeaId === sg.id} onSelect={toggleIdea} />
  )

  const [pendingTarget, setPendingTarget] = useState<string | null>(null)
  useEffect(() => {
    if (!pendingTarget) return
    const el = document.getElementById(pendingTarget)
    if (!el) return
    el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
    el.focus({ preventScroll: true })
    setPendingTarget(null)
  }, [pendingTarget, items])

  /** Park the focus request until its row renders, then scroll to it and focus it. */
  function focusItem(id: string) { setPendingTarget(`gi-item-${id}`) }

  /** One pill press: show that section (one column below 860px) and focus it. */
  function jump(next: View) {
    setView(next)
    if (next !== 'needs') { setPendingTarget(SECTION_DOM[next]); return }
    const first = needsYou[0]
    if (!first) { setPendingTarget(SECTION_DOM[needsSection]); return }
    if (first.kind === 'idea') setSelectedIdeaId(first.sg.id)
    focusItem(itemId(first))
  }

  return (
    <div className="gin-page" data-intro={intro ? 'true' : undefined}>
      <div className="gin-head">
        <div className="gin-head-text">
          <p className="gin-eyebrow">Crew · group input</p>
          <h2 className="gin-title">Decide together</h2>
          {summary.length > 0 && <p className="small muted gin-summary">{summary.join(' · ')}</p>}
        </div>
        <PillNav className="mode-pillbar gin-pillbar" role="group" aria-label="Jump to a section" activeKey={view}>
          <button type="button" data-pill-key="needs" className={`tab-btn${view === 'needs' ? ' active' : ''}`}
            onClick={() => jump('needs')} aria-pressed={view === 'needs'}>{pillLabel('Needs you', needsYouCount, listReady)}</button>
          <button type="button" data-pill-key="decisions" className={`tab-btn${view === 'decisions' ? ' active' : ''}`}
            onClick={() => jump('decisions')} aria-pressed={view === 'decisions'}>{pillLabel('Decisions', openDecisions.length, decisionsRead === 'ready')}</button>
          <button type="button" data-pill-key="ideas" className={`tab-btn${view === 'ideas' ? ' active' : ''}`}
            onClick={() => jump('ideas')} aria-pressed={view === 'ideas'}>{pillLabel('Stop ideas', openIdeas.length, suggestionsRead === 'ready')}</button>
          <button type="button" data-pill-key="activity" className={`tab-btn${view === 'activity' ? ' active' : ''}`}
            onClick={() => jump('activity')} aria-pressed={view === 'activity'}>Activity</button>
        </PillNav>
      </div>

      <div className="gin-state">
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
      </div>

      <div className="gin-grid">
        <div id="gi-section-decisions" tabIndex={-1} role="region" aria-labelledby="gi-heading-decisions"
          ref={attachDecisionList}
          style={beatOf(2)} className={colClass('decisions')}>
          <h3 id="gi-heading-decisions" className="sr-only">Decisions</h3>
          {items.length > 0 && decisionsRead === 'ready' && sortedDecisions.length === 0 && (
            <StateBlock kind="empty" size="compact" title={EMPTY_COPY.decisions.title} body={EMPTY_COPY.decisions.body}
              icon={<Scale size={38} aria-hidden />} />
          )}
          {decisionEntries.map(({ item: d, key, exiting }) => (
            <DecisionCard key={key} d={d} me={me} editable={editable} memberCount={memberCount}
              needsMe={decisionNeedsMe(d)} now={now} trip={trip} previewOpen={previewOpen} slotResolution={slotResolution}
              exiting={exiting} stamped={stampedIds.has(d.id)} onStamp={markStamped} />
          ))}
        </div>

        <div id="gi-section-ideas" tabIndex={-1} role="region" aria-labelledby="gi-heading-ideas"
          style={beatOf(ideasBeat)} className={colClass('ideas')}>
          <Surface className="card gin-panel">
            <div className="gin-card-head">
              <div>
                <h3 id="gi-heading-ideas" className="gin-card-title">Stop ideas</h3>
              </div>
              <button type="button" className="btn btn-outline btn-sm" aria-expanded={ideaComposerOpen}
                aria-controls="gi-idea-composer" onClick={() => setIdeaComposerOpen(open => !open)}>
                <Plus size={14} aria-hidden /> Add an idea
              </button>
            </div>
            <p className="small muted gin-help">Anyone can suggest. Editors add the ones the group likes to the timeline.</p>
            <div id="gi-idea-composer" ref={ideaComposerRef} className="gin-composer" hidden={!ideaComposerOpen}>
              <SuggestionComposerForm trip={trip} />
            </div>
            {items.length > 0 && suggestionsRead === 'ready' && sortedIdeas.length === 0 && (
              <StateBlock kind="empty" size="compact" title={EMPTY_COPY.ideas.title} body={EMPTY_COPY.ideas.body}
                icon={<Lightbulb size={38} aria-hidden />} />
            )}
            {items.length > 0 && suggestionsRead === 'ready' && sortedIdeas.length > 0 && openIdeas.length === 0 && !ideasExiting && (
              <StateBlock kind="empty" size="compact" title={EMPTY_COPY.ideasOpen.title} body={EMPTY_COPY.ideasOpen.body}
                icon={<Lightbulb size={38} aria-hidden />} />
            )}
            <div ref={attachIdeaList} className="gin-rows">
              {ideaEntries.map(({ item: sg, exiting }) => renderIdea(sg, exiting))}
            </div>
            {resolvedIdeas.length > 0 && (
              <div className="gin-resolved">
                <button type="button" className="gin-disclosure" aria-expanded={showResolvedIdeas}
                  aria-controls={showResolvedIdeas ? 'gi-resolved-ideas' : undefined}
                  onClick={() => setShowResolvedIdeas(open => !open)}>Resolved ideas · {resolvedIdeas.length}</button>
                {showResolvedIdeas && <div id="gi-resolved-ideas">{resolvedIdeas.map(sg => renderIdea(sg))}</div>}
              </div>
            )}
          </Surface>
          <Surface className="card gin-panel">
            <DecisionComposerForm trip={trip} />
          </Surface>
        </div>

        <div id="gi-section-activity" tabIndex={-1} role="region" aria-labelledby="gi-heading-activity"
          style={beatOf(activityBeat)} className={colClass('activity')}>
          <Surface className="card gin-panel">
            <h3 id="gi-heading-activity" className="gin-card-title">Activity</h3>
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
            {feedRows.length > 0 && (
              <div className={`gin-feed${moreFeedRows.length > 0 ? ' gin-feed--more' : ''}`}>
                {feedRows.map(a => (
                  <FeedRow key={a.id} a={a} />
                ))}
              </div>
            )}
            {moreFeedRows.length > 0 && (
              // The rest of the feed opens and closes with the day collapse.
              <SmoothCollapse open={showAllActivity} fallbackFocus={feedToggleRef}>
                <div className="gin-feed">
                  {moreFeedRows.map(a => (
                    <FeedRow key={a.id} a={a} />
                  ))}
                </div>
              </SmoothCollapse>
            )}
            {tripActivity.length > 4 && (
              <button ref={feedToggleRef} type="button" className="gin-text-btn" aria-expanded={showAllActivity}
                onClick={() => setShowAllActivity(open => !open)}>
                {showAllActivity ? 'Show less' : 'Show everything'}
              </button>
            )}
          </Surface>
          <CrewPreferencesCard trip={trip} meId={me.id} />
        </div>
      </div>
    </div>
  )
}

/** One activity entry: who did what, and when. */
function FeedRow({ a }: { a: ReturnType<typeof activityFor>[number] }) {
  return (
    <div className="feed-item">
      <Avatar user={userById(a.actorId)} />
      <span className="gin-feed-text"><b>{userById(a.actorId)?.profile.name}</b> {a.verb}{a.target ? ` · ${a.target}` : ''}<span className="feed-time gin-feed-time">{timeAgo(a.at)}</span></span>
    </div>
  )
}

// ================= Crew preferences card =================

function CrewPreferencesCard({ trip, meId }: { trip: Trip; meId: string }) {
  const rows = useCrewPreferenceRows()
  const reads = useCrewPreferenceReads()
  const read = sliceState(reads, trip.id)
  const [draft, setDraft] = useState<CrewInterest[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  // After a Save or a Cancel the quiz folds. Focus then goes back to the
  // "Edit your answers" button, or to the card heading when that button is absent.
  const [restoreFocus, setRestoreFocus] = useState(false)
  const [focusChip, setFocusChip] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const editBtnRef = useRef<HTMLButtonElement>(null)
  const chipsRef = useRef<HTMLDivElement>(null)
  const memberIds = useMemo(() => (trip.members ?? []).map(m => m.userId), [trip.members])
  const isMember = memberIds.includes(meId)
  const retry = () => { void loadCrewPreferences(trip.id) }

  // The answers of one trip are read when the tab opens, and again after a failure.
  useEffect(() => { void loadCrewPreferences(trip.id) }, [trip.id])

  const summary = useMemo(
    () => summarizeCrewPreferences(rows, { tripId: trip.id, memberIds }),
    [rows, trip.id, memberIds],
  )
  const bars = crewBars(summary)
  const mine = myCrewPreference(rows, trip.id, meId)
  const picked = draft ?? mine?.interests ?? []
  // A member who has not answered sees the quiz open. One who has sees it behind a button.
  // The quiz stays open while a save is pending. A first save writes my row at once,
  // and the quiz must not unmount before the server answers.
  const quizOpen = !mine || editing || pending
  const hasRows = summary.answered > 0
  // Save needs a change. A first answer needs at least one chip.
  const dirty = mine ? !sameInterests(picked, mine.interests) : picked.length > 0

  useEffect(() => {
    if (!restoreFocus || quizOpen) return
    ;(editBtnRef.current ?? headingRef.current)?.focus()
    setRestoreFocus(false)
  }, [restoreFocus, quizOpen])

  /** The quiz mounts hidden and opens a beat later. The first chip takes the
   *  focus when the clip starts to open. The clip is still about 0px high then,
   *  so the focus call must not scroll. */
  function focusFirstChip() {
    if (!focusChip) return
    chipsRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    setFocusChip(false)
  }

  function toggle(interest: CrewInterest) {
    setDraft(current => {
      const base = current ?? mine?.interests ?? []
      return base.includes(interest) ? base.filter(i => i !== interest) : [...base, interest]
    })
  }

  function save(list: CrewInterest[] = picked) {
    if (pending) return
    setPending(true)
    void setMyCrewPreferences(trip.id, list).then(o => {
      reportCollabOutcome(o, 'Your answers are saved')
      // The draft stays after a refusal, so the member keeps what they picked.
      if (o.status === 'applied' || o.status === 'alreadyApplied') { setDraft(null); setEditing(false); setRestoreFocus(true) }
      setPending(false)
    })
  }

  return (
    <Surface className="card gin-panel">
      <h3 ref={headingRef} tabIndex={-1} className="gin-card-title">Crew preferences</h3>
      <p className="small muted gin-help">From each person’s answers.</p>
      <hr className="divider" />
      {read === 'failed' && hasRows && (
        <StateBlock kind="kept" size="compact" title="Couldn’t refresh crew preferences. Showing what was loaded."
          actions={<button className="btn btn-outline btn-sm" onClick={retry}>Try again</button>} />
      )}
      {read === 'failed' && !hasRows && (
        <StateBlock kind="failed" size="compact" title="Couldn’t load crew preferences."
          actions={<button className="btn btn-outline btn-sm" onClick={retry}>Try again</button>} />
      )}
      {read === 'reading' && !hasRows && (
        <StateBlock kind="loading" size="compact" title="Loading crew preferences…" art={<div className="spinner" />} />
      )}
      {read === 'ready' && !hasRows && (
        <StateBlock kind="empty" size="compact" title="No answers yet." body="Pick the interests you want on this trip. The bars appear after the first answer." />
      )}
      {hasRows && (
        <>
          <p className="small muted gin-crew-count">{summary.answered} of {memberIds.length} answered</p>
          {bars.length > 0 ? (
            <CrewBarList bars={bars} />
          ) : (
            <p className="small muted">Nobody picked an interest yet.</p>
          )}
        </>
      )}
      {read === 'ready' && isMember && (
        <div className="gin-quiz">
          {/* The quiz opens and closes with the day collapse. The Edit button
              is not part of it: it appears at once, so focus has a target as
              the quiz starts to close. */}
          <SmoothCollapse open={quizOpen} fallbackFocus={editBtnRef} onExpanded={focusFirstChip}>
            <div className="gin-quiz-body">
              <p className="small gin-quiz-title" id={`gi-quiz-title-${trip.id}`}>Your answers</p>
              <div ref={chipsRef} className="gin-quiz-chips" role="group" aria-labelledby={`gi-quiz-title-${trip.id}`}>
                {CREW_QUIZ_INTERESTS.map(interest => (
                  <FilterChip key={interest} pressed={picked.includes(interest)} onClick={() => toggle(interest)}>{cap(interest)}</FilterChip>
                ))}
              </div>
              <div className="gin-foot">
                <button type="button" className="btn btn-primary btn-sm" disabled={pending || !dirty} aria-busy={pending} onClick={() => save()}>Save</button>
                {mine && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={pending}
                    onClick={() => { setDraft(null); setEditing(false); setRestoreFocus(true) }}>Cancel</button>
                )}
                {!mine && (
                  <button type="button" className="gin-text-btn" disabled={pending} onClick={() => save([])}>None of these</button>
                )}
              </div>
            </div>
          </SmoothCollapse>
          {!quizOpen && (
            <button ref={editBtnRef} type="button" className="gin-text-btn" aria-expanded={false}
              onClick={() => { setEditing(true); setFocusChip(true) }}>Edit your answers</button>
          )}
        </div>
      )}
    </Surface>
  )
}

/** The crew's interest bars. The list owns its in-view and page-visible state,
 *  so the bars grow only while the reader can see them. It mounts when the first
 *  answer arrives, so the observer reads a real element. */
function CrewBarList({ bars }: { bars: ReturnType<typeof crewBars> }) {
  const listRef = useRef<HTMLUListElement>(null)
  const inView = useInView(listRef)
  const visible = usePageVisible()
  return (
    <ul ref={listRef} className="gin-crew-list" data-motion-paused={!visible || !inView}>
      {bars.map(b => (
        <li key={b.interest} className="gin-crew-row">
          <span className="gin-crew-label">{cap(b.interest)}</span>
          <ShareBar percent={b.percent} lead />
          <span className="gin-option-pct num">{b.percent}%</span>
        </li>
      ))}
    </ul>
  )
}

/** One 6px share bar. The fill uses the vote-bar motion token. */
function ShareBar({ percent, lead }: { percent: number; lead?: boolean }) {
  return (
    <span className="gin-track" aria-hidden>
      <span className={`gin-fill${lead ? ' gin-fill--lead' : ''}`} style={{ width: `${percent}%` }} />
    </span>
  )
}

// ================= Stop idea row =================

function IdeaRow({ sg, trip, me, editable, memberCount, needsMe, previewOpen, selected, onSelect, exiting }: {
  sg: StopSuggestion
  trip: Trip
  me: NonNullable<ReturnType<typeof currentUser>>
  editable: boolean
  memberCount: number
  needsMe: boolean
  previewOpen?: boolean
  selected: boolean
  onSelect: (id: string) => void
  /** Set by the open list, which plays an exit. A row outside that list leaves it unset. */
  exiting?: boolean
}) {
  const ups = sg.votes.filter(v => v.value === 1).length
  const downs = sg.votes.length - ups
  const myVote = sg.votes.find(v => v.userId === me.id)?.value
  const author = userById(sg.proposedBy)
  const open = sg.status === 'open'
  const { busy, claim, release } = useBusyClaim(sg.id)
  const headRef = useRef<HTMLButtonElement>(null)
  // Only the user's CHOICE lives here. The day list is read from the trip at
  // render time: a day removed while the panel was open must disappear from the
  // choices too, instead of offering a day that no longer exists (#839).
  const [retarget, setRetarget] = useState<null | { dayId: string; reason: 'missing-day' | 'legacy-ambiguous' }>(null)
  const [retargetDays, setRetargetDays] = useState<Array<{ id: string; index: number; title?: string }> | null>(null)
  const [duplicate, setDuplicate] = useState<null | { dayId: string; dayIndex: number }>(null)
  const liveDays = useMemo(() => retargetDays ?? trip.days.map(d => ({ id: d.id, index: d.index, ...(d.title ? { title: d.title } : {}) })),
    [retargetDays, trip.days])
  // One follow-up at a time. Retarget wins when both somehow want to be open,
  // because the missing day is the question that has to be answered first.
  const followUp: SuggestionFollowUp | null = retarget
    ? { kind: 'retarget', ...retarget }
    : duplicate ? { kind: 'duplicate', ...duplicate } : null
  // A follow-up question or a held claim keeps the row open, so it cannot be hidden.
  const expanded = selected || followUp !== null || busy

  async function accept(opts: { dayId?: string; dayIndex?: number; allowDuplicate?: boolean } = {}) {
    try {
      const outcome = await acceptSuggestionIntoTimeline(trip.id, sg.id, opts)
      const follow = followUpFromOutcome(outcome)
      setRetarget(follow?.retarget ?? null)
      setRetargetDays(follow?.retargetDays ?? null)
      setDuplicate(follow?.duplicate ?? null)
      if (follow?.toast) toast(follow.toast, follow.toastTone)
      if (follow?.report) reportCollabOutcome(follow.report)
    } catch {
      toast('Could not add this idea. Your idea is still open. Try again.', 'err')
    } finally {
      release()
    }
  }

  return (
    <div id={exiting ? undefined : `gi-item-${sg.id}`} tabIndex={-1} className={`gin-row gi-item${needsMe ? ' gi-needs-you' : ''}`}
      {...(exiting === undefined ? {} : presenceAttrs({ exiting }))}>
      <button ref={headRef} type="button" className="gin-row-head" aria-expanded={expanded}
        aria-controls={expanded ? `gi-row-panel-${sg.id}` : undefined} onClick={() => onSelect(sg.id)}>
        <span className="gin-cat-tile"><CatIcon category={sg.category} size={18} /></span>
        <span className="gin-row-main">
          <span className="gin-row-title">
            {sg.title}
            {needsMe && <span className="gin-pop"><Chip tone="saffron">Needs your vote</Chip></span>}
            {!open && <Chip tone={sg.status === 'accepted' ? 'ok' : 'danger'}>{cap(sg.status)}</Chip>}
          </span>
          <span className="gin-row-meta small muted num">{ideaMeta(sg)}</span>
          <span className="gin-row-by small muted"><Avatar user={author} /> suggested by {initialsOf(author?.profile.name)}</span>
        </span>
        <span className="gin-heart"><Heart size={14} aria-hidden /><b>{ups}</b></span>
      </button>
      {/* The action panel opens and closes with the day collapse (grid rows).
          Focus returns to the row head if a close would strand it. */}
      <SmoothCollapse open={expanded} fallbackFocus={headRef}>
        <div id={exiting ? undefined : `gi-row-panel-${sg.id}`} className="gin-row-panel">
          <div className="stop-meta gin-stop-meta">
            <span><MapPin size={13} aria-hidden /> {sg.locationName}</span>
            <span><Clock size={13} aria-hidden /> {minutesToHM(sg.visitMinutes)}</span>
            <span><Ticket size={13} aria-hidden /> ₹{sg.estimatedEntryFeeInr}/person</span>
            <span><Car size={13} aria-hidden /> ₹{sg.estimatedTransportInr} transport</span>
          </div>
          {sg.description && <p className="small muted">{sg.description}</p>}
          <div className="gin-vote-row">
            <button className={`vote-btn ${myVote === 1 ? 'on' : ''}`} disabled={!open}
              onClick={() => void voteSuggestion(trip.id, sg.id, 1).then(o => reportCollabOutcome(o))}
              aria-label="Upvote" aria-pressed={myVote === 1}><ChevronUp size={13} aria-hidden /></button>
            <span className="vote-count">{ups - downs}</span>
            <button className={`vote-btn ${myVote === -1 ? 'on' : ''}`} disabled={!open}
              onClick={() => void voteSuggestion(trip.id, sg.id, -1).then(o => reportCollabOutcome(o))}
              aria-label="Downvote" aria-pressed={myVote === -1}><ChevronDown size={13} aria-hidden /></button>
            <span className="small muted num">{ups} of {memberCount} upvoted</span>
          </div>

          {editable && open && (
            <div className="gin-item-actions">
              <button className="btn btn-primary btn-sm" disabled={busy} aria-busy={busy} onClick={() => {
                if (refuseWhileStaged(previewOpen)) return
                if (!claim()) return
                accept()
              }}><Plus size={14} aria-hidden /> Add to timeline</button>
              <button className="gin-text-btn" disabled={busy} aria-busy={busy} onClick={() => {
                if (refuseWhileStaged(previewOpen)) return
                if (!claim()) return
                void declineSuggestion(trip.id, sg.id).then(o => {
                  reportCollabOutcome(o, 'Suggestion declined')
                  // A refused receipt leaves the row on screen with its status
                  // unchanged, so the claim is freed or the buttons stay disabled.
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
                if (followUp.kind === 'retarget') setRetargetDays(null)
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
      </SmoothCollapse>
    </div>
  )
}

// ================= Decision card =================

function DecisionCard({ d, me, editable, needsMe, memberCount, now, trip, previewOpen, slotResolution, exiting, stamped, onStamp }: {
  d: TripDecision
  me: { id: string }
  editable: boolean
  needsMe: boolean
  memberCount: number
  /** The clock, for the closing label and the lock. The server decides a late ballot. */
  now: number
  trip: Trip
  previewOpen?: boolean
  slotResolution: SlotResolutionContext | null
  /** True while this card plays its exit: an open card whose decision just moved to decided. */
  exiting: boolean
  /** True after a resolve this tab made. The Chosen chip then plays its stamp. */
  stamped: boolean
  onStamp: (id: string) => void
}) {
  const tally = d.options.map(o => Object.values(d.votesByUserId).filter(v => v === o.id).length)
  const totalVotes = tally.reduce((s, t) => s + t, 0)
  const leadingIdx = totalVotes > 0 ? tally.indexOf(Math.max(...tally)) : -1
  const votersOf = (optionId: string) => Object.entries(d.votesByUserId).filter(([, o]) => o === optionId).map(([u]) => u)
  const voterCount = Object.keys(d.votesByUserId).length
  const myOptionId: string | undefined = d.votesByUserId[me.id]
  const open = d.status === 'open'
  // Past the closing time the vote is locked. Nothing resolves on its own: an editor applies the winner.
  const locked = open && isVoteClosed(d, now)
  const outcome = voteOutcome(d)
  const dayLabel = decisionDayLabel(trip.days, d.dayId)
  const raiser = userById(d.raisedBy)?.profile.name ?? 'Traveller'
  // Grounded trip context + offline recommendation (§6.8): the deterministic
  // guide, using the same engine data the Overview shows. Recomputed when the
  // trip or decision changes (a new vote can flip the tie-break).
  const ctx = useMemo(() => decisionContext(trip), [trip])
  const rec = useMemo(() => recommendForDecision(trip, d, ctx), [trip, d, ctx])
  const { busy, claim, release } = useBusyClaim(d.id)
  const [pick, setPick] = useState<string | null>(null)
  const [commenting, setCommenting] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [addingOption, setAddingOption] = useState(false)
  const [optionLabel, setOptionLabel] = useState('')
  const [optionError, setOptionError] = useState<string | undefined>()
  const optionClaim = useBusyClaim(`${d.id}:add-option`)
  const optionRef = useRef<HTMLInputElement>(null)
  const addTriggerRef = useRef<HTMLButtonElement>(null)
  const commentToggleRef = useRef<HTMLButtonElement>(null)
  const detailsToggleRef = useRef<HTMLButtonElement>(null)
  // The vote bars grow once, while they are on screen and the tab is visible.
  const optionsRef = useRef<HTMLDivElement>(null)
  const optionsInView = useInView(optionsRef)
  const pageVisible = usePageVisible()
  const timeFormat = useTimeFormat()
  const [placementDayId, setPlacementDayId] = useState('')
  const [placementDays, setPlacementDays] = useState<Array<{ id: string; index: number; title?: string }> | null>(null)
  const [openDayOptionId, setOpenDayOptionId] = useState<string | null>(null)
  const [roadRefusal, setRoadRefusal] = useState<{ copy: string; recoverable: boolean } | null>(null)
  // One card instance lives through open to decided, so every draft below
  // survives a resolve. `turned` marks a card that changed phase while it was
  // on screen: only that card plays the decided body's rise. A card that loads
  // as decided has the card's own entrance and nothing more. State is adjusted
  // while rendering, so the first decided frame already carries the mark.
  const [seenOpen, setSeenOpen] = useState(open)
  const [turned, setTurned] = useState(false)
  if (open !== seenOpen) {
    setSeenOpen(open)
    if (!open) setTurned(true)
  }
  // Set by a resolve that this member made while focus sat inside the card.
  const [refocusCard, setRefocusCard] = useState(false)
  useEffect(() => {
    if (open || !refocusCard) return
    setRefocusCard(false)
    // The Resolve button left with the open body. Focus goes to the card, and only
    // when it is stranded: a member who typed in a field that stays keeps that field.
    const active = document.activeElement
    if (!active || active === document.body) document.getElementById(`gi-item-${d.id}`)?.focus({ preventScroll: true })
  }, [open, refocusCard, d.id])
  const resolvedOption = d.options.find(o => o.id === d.resolvedOptionId)
  const agreed = d.resolvedOptionId ? votersOf(d.resolvedOptionId).length : 0
  const needsPlacement = d.status === 'resolved' && !!d.resolvedOptionId && !d.resolvedStopId && !!resolvedOption?.place
  // An open legacy poll can reach this picker after a missing-day refusal.
  const pickerOptionId = needsPlacement ? (d.resolvedOptionId ?? null) : openDayOptionId
  const pickerOption = pickerOptionId ? d.options.find(o => o.id === pickerOptionId) : undefined
  const availablePlacementDays = placementDays ?? trip.days.map(day => ({
    id: day.id, index: day.index, ...(day.title ? { title: day.title } : {}),
  }))

  // The orchestration captures day, route, anchor and revision as one snapshot.
  // It is pure, so no await can lend a newer trip to an older measurement.
  // Every resolve route goes through it, including the day-picker retry.
  async function resolveChoice(optionId: string, target: LegacyResolutionTarget = {}) {
    const cardHadFocus = !!document.getElementById(`gi-item-${d.id}`)?.contains(document.activeElement)
    const flow = await runDecisionResolution(
      { context: slotResolution, decision: d, optionId, target, previewOpen },
      {
        resolveDecision, toast, reportCollabOutcome, refuseWhileStaged,
        claim, release, onPlacementDays: setPlacementDays, onPlacementDayId: setPlacementDayId,
      },
    )
    if (flow.kind === 'refused') {
      setRoadRefusal(flow.reason === 'missing-road' || flow.reason === 'stale-road' || flow.reason === 'road-unavailable'
        ? { copy: flow.copy, recoverable: flow.recoverable }
        : null)
      setOpenDayOptionId(flow.reason === 'missing-day' ? optionId : null)
      return
    }
    setRoadRefusal(null)
    // The stamp plays only for a resolution this card made, so a page load never replays it.
    if (flow.kind === 'settled' && (flow.outcome.status === 'applied' || flow.outcome.status === 'alreadyApplied')) {
      onStamp(d.id)
      if (cardHadFocus) setRefocusCard(true)
    }
    setOpenDayOptionId(flow.kind === 'settled' && flow.needsDayPicker ? (d.resolvedOptionId ?? optionId) : null)
  }

  // The add-option field and the comment field mount hidden and open a beat
  // later. Each takes the focus when its clip starts to open. The clip is still
  // about 0px high with hidden overflow then, so neither call may scroll.
  const focusOptionField = () => optionRef.current?.focus({ preventScroll: true })
  const focusCommentField = () => document.getElementById(`gi-comment-${d.id}`)?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true })

  /** Add one option. The same duplicate check the server runs shows its reason at once. */
  function submitOption() {
    const checked = checkNewOptionLabel(d.options, optionLabel)
    if (!checked.ok) { setOptionError(optionLabelRefusal(checked.reason)); return }
    setOptionError(undefined)
    if (!optionClaim.claim()) return
    void addDecisionOption(d.id, { label: checked.label }).then(o => {
      reportCollabOutcome(o, 'Option added')
      if (o.status === 'applied' || o.status === 'alreadyApplied') {
        // The field unmounts, so focus goes back to the trigger. A member who moved on keeps their place.
        const active = document.activeElement
        const stranded = !active || active === document.body || !!document.getElementById(`gi-add-option-${d.id}`)?.contains(active)
        setOptionLabel(''); setAddingOption(false)
        if (stranded) addTriggerRef.current?.focus()
      }
    }).finally(() => optionClaim.release())
  }

  /** Send my ballot. A ballot change is a set, so a repeat of my own option does nothing. */
  function castVote() {
    if (!pick || pick === myOptionId) return
    void voteOnDecision(d.id, pick).then(o => reportCollabOutcome(o))
  }

  return (
    <Surface id={exiting ? undefined : `gi-item-${d.id}`} tabIndex={-1} className={`card gi-item gin-panel gin-decision${needsMe ? ' gi-needs-you' : ''}`}
      data-turned={turned && !open ? 'true' : undefined} {...presenceAttrs({ exiting })}>
      {open ? (
        <>
          <div className="gin-decision-head">
            <div className="gin-decision-head-text">
              {locked && <p className="gin-eyebrow">Closed</p>}
              {!locked && needsMe && (
                <p className="gin-eyebrow gin-eyebrow--amber">
                  Needs your vote{hasClosingTime(d) ? ` · closes ${closingStamp(d.closesAt as number, timeFormat, now)} · in ${formatSpan((d.closesAt as number) - now)}` : ''}
                </p>
              )}
              {!locked && !needsMe && hasClosingTime(d) && (
                <p className="gin-eyebrow">Open · closes {closingStamp(d.closesAt as number, timeFormat, now)} · in {formatSpan((d.closesAt as number) - now)}</p>
              )}
              <h3 className="gin-card-title">{d.question}</h3>
            </div>
            <Avatar user={userById(d.raisedBy)} />
          </div>
          <p className="small muted gin-sub">Raised by {raiser}{dayLabel ? ` · ${dayLabel}` : ''} · {voterCount} of {memberCount} voted</p>
          {d.context && <p className="small muted gin-decision-context">{d.context}</p>}
          <div ref={optionsRef} className="gin-decision-options" role="radiogroup" aria-label={`Options for ${d.question}`}
            data-motion-paused={!pageVisible || !optionsInView}>
            {d.options.map((o, i) => {
              const pct = totalVotes > 0 ? Math.round((tally[i] / totalVotes) * 100) : 0
              const leading = i === leadingIdx && tally[i] > 0
              const voters = votersOf(o.id)
              const detail = [
                o.place?.locationName,
                o.timeImpactMin ? `≈${o.timeImpactMin} min detour` : '',
                o.costImpactInr ? `${o.costImpactInr > 0 ? '+\u2060' : ''}${formatInr(o.costImpactInr)}` : '',
              ].filter(Boolean).join(' · ')
              return (
                <label key={o.id} className="gin-option">
                  <span className="gin-option-top">
                    <input type="radio" className="gin-radio" name={`vote-${d.id}`} value={o.id}
                      aria-labelledby={`gi-opt-${d.id}-${o.id}-label`}
                      aria-describedby={[detail ? `gi-opt-${d.id}-${o.id}-detail` : '', `gi-opt-${d.id}-${o.id}-pct`].filter(Boolean).join(' ')}
                      checked={(pick ?? myOptionId) === o.id} disabled={locked} onChange={() => setPick(o.id)} />
                    <span id={exiting ? undefined : `gi-opt-${d.id}-${o.id}-label`} className="gin-option-label">{o.label}</span>
                    {rec?.optionId === o.id && <span className="gin-pop"><Chip tone="teal">Best fit · engine</Chip></span>}
                    <span className="gin-option-end">
                      <span id={exiting ? undefined : `gi-opt-${d.id}-${o.id}-pct`} className="gin-option-pct num">{pct}%</span>
                    </span>
                  </span>
                  <ShareBar percent={pct} lead={leading} />
                  {(voters.length > 0 || detail) && (
                    <span className="gin-option-meta">
                      {voters.length > 0 && (
                        <span className="who-voted" role="img"
                          aria-label={`Voted for this: ${voters.map(v => userById(v)?.profile.name ?? 'Traveller').join(', ')}`}>
                          {(() => {
                            const first = voters.slice(0, 4)
                            const tones = assignAvatarTones(first)
                            return first.map((v, index) => (
                              <Avatar key={v} user={userById(v)} tone={tones[index]} />
                            ))
                          })()}
                          {voters.length > 4 && <span className="who-more">+{voters.length - 4}</span>}
                        </span>
                      )}
                      {detail && <span id={exiting ? undefined : `gi-opt-${d.id}-${o.id}-detail`} className="gin-option-detail small muted num">{detail}</span>}
                    </span>
                  )}
                </label>
              )
            })}
          </div>
          {locked && (
            <p className="small verdict-line">
              {votingClosedLine(d)}{outcome.kind === 'tie' ? '. An editor picks the winner.' : ''}
            </p>
          )}
          <div className="gin-foot">
            {!locked && (
              <button type="button" className="btn btn-primary btn-sm" disabled={!pick || pick === myOptionId}
                onClick={castVote}><><Check size={15} aria-hidden /> Vote</></button>
            )}
            {editable && canAddOption(d, now) && (
              <button ref={addTriggerRef} type="button" className="btn btn-outline btn-sm" aria-expanded={addingOption}
                aria-label={`Add option to ${d.question}`}
                aria-controls={addingOption ? `gi-add-option-${d.id}` : undefined}
                onClick={() => setAddingOption(a => !a)}>
                <Plus size={14} aria-hidden /> Add option
              </button>
            )}
            <span className="gin-foot-spacer" aria-hidden />
            <button ref={detailsToggleRef} type="button" className="gin-disclosure" aria-expanded={detailsOpen}
              aria-controls={detailsOpen ? `gi-details-${d.id}` : undefined}
              onClick={() => setDetailsOpen(v => !v)}>{detailsOpen ? 'Hide details' : 'Details'}</button>
            <button ref={commentToggleRef} type="button" className="gin-text-btn" aria-expanded={commenting}
              aria-controls={commenting ? `gi-comment-${d.id}` : undefined}
              onClick={() => setCommenting(c => !c)}><MessageSquare size={15} aria-hidden /> Comment · {d.comments.length}</button>
          </div>
          {/* The add-option field opens and closes with the day collapse. */}
          <SmoothCollapse open={addingOption && editable && canAddOption(d, now)} fallbackFocus={addTriggerRef} onExpanded={focusOptionField}>
            <form id={exiting ? undefined : `gi-add-option-${d.id}`} className="gin-option-form" onSubmit={e => { e.preventDefault(); submitOption() }}>
              <Field label="New option" error={optionError}>
                <input ref={optionRef} className="input" value={optionLabel} maxLength={200}
                  onChange={e => { setOptionLabel(e.target.value); setOptionError(undefined) }} />
              </Field>
              <button className="btn btn-sm btn-outline" aria-label={`Add option to ${d.question}`} disabled={optionClaim.busy} aria-busy={optionClaim.busy}>Add</button>
            </form>
          </SmoothCollapse>
          {editable && locked && (
            <div className="resolve-btns">
              {d.options.map(o => (
                <button key={o.id} className={`btn btn-sm ${locked && outcome.kind === 'winner' && outcome.option.id === o.id ? 'btn-primary' : 'btn-outline'}`} disabled={busy} aria-busy={busy}
                  onClick={() => {
                    if (refuseWhileStaged(previewOpen)) return
                    void resolveChoice(o.id)
                  }}>
                  Resolve: {o.label}
                </button>
              ))}
            </div>
          )}
          <SmoothCollapse open={detailsOpen} fallbackFocus={detailsToggleRef}>
            <div id={exiting ? undefined : `gi-details-${d.id}`} className="gin-details">
              <div className="gi-guide gin-guide-block">
                <p className="small muted gin-guide-note">
                  <InlineIcon icon={ClipboardList} size={12} gap={4} />
                  {contextLine(ctx)}
                </p>
                {rec && (
                  <p className="small gin-guide-rec">
                    <InlineIcon icon={Sparkles} size={12} gap={4} />
                    <b>{rec.label}</b>: {rec.reason} <Chip tone="info">offline</Chip>
                  </p>
                )}
              </div>
              {editable && !locked && (
                <div className="resolve-btns">
                  {d.options.map(o => (
                    <button key={o.id} className={`btn btn-sm ${locked && outcome.kind === 'winner' && outcome.option.id === o.id ? 'btn-primary' : 'btn-outline'}`} disabled={busy} aria-busy={busy}
                      onClick={() => {
                        if (refuseWhileStaged(previewOpen)) return
                        void resolveChoice(o.id)
                      }}>
                      Resolve: {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </SmoothCollapse>
        </>
      ) : (

        <>
          <div className="gin-decided">
            <div>
              <p className="gin-eyebrow gin-eyebrow--ok">{d.resolvedAt ? `Decided · ${timeAgo(d.resolvedAt)}` : 'Decided'}</p>
              <h3 className="gin-card-title">{resolvedOption?.label ?? d.question}</h3>
              {resolvedOption && <p className="small muted gin-sub">{agreed} of {memberCount} agreed · {d.question}</p>}
              {d.context && <p className="small muted gin-decision-context">{d.context}</p>}
            </div>
            <span className={`chip chip-ok${stamped ? ' gin-stamp' : ''}`}>Chosen</span>
          </div>
          <div className="gin-foot">
            <button ref={commentToggleRef} type="button" className="gin-text-btn" aria-expanded={commenting}
              aria-controls={commenting ? `gi-comment-${d.id}` : undefined}
              onClick={() => setCommenting(c => !c)}><MessageSquare size={15} aria-hidden /> Comment · {d.comments.length}</button>
          </div>
        </>
      )}
      {pickerOptionId && pickerOption?.place && (
        <div className="gin-item-actions gin-followup" role="group" aria-label="Choose a day for the winning stop">
          <p className="small muted">{needsPlacement
            ? `${pickerOption.place.title} won the vote. Choose a current day to place it.`
            : 'This slot vote has no day. Choose a current day, then place it.'}</p>
          {availablePlacementDays.length === 0 ? (
            <p className="small">This trip has no days. Add a day in the timeline, then choose a day here.</p>
          ) : (
            <>
              <select className="select" aria-label="Day for the winning stop" value={placementDayId}
                onChange={e => setPlacementDayId(e.target.value)}>
                <option value="">Pick a day</option>
                {availablePlacementDays.map(day => <option key={day.id} value={day.id}>
                  Day {day.index + 1}{day.title ? ` · ${day.title}` : ''}
                </option>)}
              </select>
              <button className="btn btn-primary btn-sm" disabled={busy || !placementDayId} aria-busy={busy}
                onClick={() => { void resolveChoice(pickerOptionId, { dayId: placementDayId }) }}>
                {needsPlacement ? 'Place winning stop' : 'Place on chosen day'}
              </button>
            </>
          )}
        </div>
      )}
      {roadRefusal && (
        <div className="gin-item-actions gin-followup" role="group" aria-label="Route for ordered placement">
          <p className="small muted">{roadRefusal.copy}</p>
          {roadRefusal.recoverable && slotResolution?.road?.retry && (
            <button className="btn btn-outline btn-sm"
              onClick={() => slotResolution?.road?.retry()}>
              {slotResolution?.road?.status === 'failed' ? 'Retry measurement' : 'Measure route'}
            </button>
          )}
        </div>
      )}
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
      {/* The comment field opens and closes with the day collapse. */}
      <SmoothCollapse open={commenting} fallbackFocus={commentToggleRef} onExpanded={focusCommentField}>
        <CommentForm id={exiting ? undefined : `gi-comment-${d.id}`} onSubmit={text => addCommentToDecision(trip.id, d.id, text).then(o => { reportCollabOutcome(o); return o })} />
      </SmoothCollapse>
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

/** One accept outcome → the follow-up the row must ask, its toasts, and who
 *  reports it. The repeat-confirmation contract lives here: a needsDuplicate
 *  receipt opens the add-another panel for the SERVER-resolved day, and no
 *  other outcome can ever open it — allowDuplicate is sent only by that
 *  panel's explicit confirm. */
export function followUpFromOutcome(outcome: AcceptanceOutcome): {
  retarget?: { dayId: string; reason: 'missing-day' | 'legacy-ambiguous' }
  retargetDays?: Array<{ id: string; index: number; title?: string }>
  duplicate?: { dayId: string; dayIndex: number }
  toast?: string
  toastTone?: 'ok' | 'err'
  report?: CollabOutcome
} | null {
  switch (outcome.status) {
    case 'applied':
    case 'alreadyApplied':
      return { toast: outcome.status === 'applied' ? 'Added to timeline' : 'This idea is already on the timeline.' }
    case 'needsDay':
      return { retarget: { dayId: '', reason: 'missing-day' }, retargetDays: outcome.availableDays }
    case 'needsDuplicate':
      return { duplicate: { dayId: outcome.dayId, dayIndex: outcome.dayIndex } }
    case 'needsPlace':
      return { toast: 'This idea needs a valid place before it can be added.', toastTone: 'err' }
    case 'conflict':
    case 'forbidden':
    case 'unavailable':
      return { report: outcome }
  }
}

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

function CommentForm({ id, onSubmit }: { id?: string; onSubmit: (text: string) => Promise<CollabOutcome> }) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  return (
    <form id={id} className="gin-comment-form" onSubmit={e => {
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
  const [closes, setCloses] = useState('')
  const [dayId, setDayId] = useState('')
  const [closesError, setClosesError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)
  const closesRef = useRef<HTMLInputElement>(null)
  // The earliest closing time is now. It refreshes when the field takes focus.
  const [minCloses, setMinCloses] = useState(() => localInputValue(Date.now()))

  function setOpt(i: number, key: 'label' | 'cost', v: string) {
    setOpts(list => list.map((o, j) => j === i ? { ...o, [key]: v } : o))
  }

  /** Cancel clears the draft. The card stays on the page. */
  function clearDraft() {
    setQ(''); setContext(''); setOpts([{ label: '', cost: '' }, { label: '', cost: '' }])
    setCloses(''); setDayId(''); setClosesError(undefined)
  }

  function create(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    if (!q.trim()) { toast('Write the question first.', 'err'); return }
    const built = opts
      .map(o => ({ label: o.label.trim(), cost: Number(o.cost) || 0 }))
      .filter(o => o.label)
    if (built.length < 2) { toast('Give at least two options.', 'err'); return }
    // The closing time is the device's local time. It must be in the future.
    const closing = parseClosesAt(closes, Date.now())
    if (!closing.ok) {
      setClosesError(closing.reason === 'past' ? 'Pick a time in the future, or leave it empty.' : 'Enter a valid date and time.')
      closesRef.current?.focus()
      return
    }
    setClosesError(undefined)
    setPending(true)
    void addDecision(trip.id, {
      question: q.trim(),
      ...(closing.closesAt !== undefined ? { closesAt: closing.closesAt } : {}),
      ...(dayId ? { dayId } : {}),
      context: context.trim() || undefined,
      // #335: no placeholder ids — a hand-typed poll gets real ones from the
      // store, which preserves an id a caller does supply (the Map rail's
      // slot and place ids are load-bearing).
      options: built.map(o => ({ label: o.label, costImpactInr: o.cost || undefined })),
    }).then(o => {
      reportCollabOutcome(o, 'Decision posted for the group')
      if (o.status === 'applied' || o.status === 'alreadyApplied') clearDraft()
      setPending(false)
    })
  }

  return (
    <form onSubmit={create}>
      <h3 className="gin-card-title">Raise a decision</h3>
      <p className="hint-text gin-composer-hint">Turn a group-chat debate into one clear vote.</p>
      <Field label="Question"><input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Beach day or backwater day on Day 3?" /></Field>
      <Field label="Context (optional)" hint="Why the group is deciding: e.g. “forecast says one beach afternoon is a washout”.">
        <input className="input" value={context} onChange={e => setContext(e.target.value)} />
      </Field>
      <div className="form-row">
        <Field label="Closes (optional)" error={closesError} hint="Your local time. After it, nobody can vote. An editor applies the winner.">
          <input ref={closesRef} className="input" type="datetime-local" min={minCloses} value={closes}
            onFocus={() => setMinCloses(localInputValue(Date.now()))} onChange={e => { setCloses(e.target.value); setClosesError(undefined) }} />
        </Field>
        <Field label="Day (optional)">
          <select className="select" value={dayId} onChange={e => setDayId(e.target.value)}>
            <option value="">No day</option>
            {trip.days.map(day => <option key={day.id} value={day.id}>{dayOptionLabel(day)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Options" hint="At least two. Cost impact is optional.">
        <span className="gin-option-grid">
          {opts.map((o, i) => (
            <span key={i} className="opt-row">
              <input className="input" placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} value={o.label} onChange={e => setOpt(i, 'label', e.target.value)} />
              <input className="input opt-cost" type="number" placeholder="₹" aria-label={`Cost impact of option ${i + 1}, optional`} value={o.cost} onChange={e => setOpt(i, 'cost', e.target.value)} />
              {opts.length > 2 && (
                <button type="button" className="icon-btn" aria-label={`Remove option ${i + 1}`} onClick={() => setOpts(list => list.filter((_, j) => j !== i))}><X size={14} /></button>
              )}
            </span>
          ))}
          <span>
            <button type="button" className="btn btn-outline btn-sm" aria-label={`Add option to ${q.trim() || 'this decision'}`}
              onClick={() => setOpts(list => [...list, { label: '', cost: '' }])}><Plus size={14} aria-hidden /> Add option</button>
          </span>
        </span>
      </Field>
      <div className="gin-foot">
        <button className="btn btn-primary btn-sm">Post decision</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clearDraft}>Cancel</button>
      </div>
    </form>
  )
}
