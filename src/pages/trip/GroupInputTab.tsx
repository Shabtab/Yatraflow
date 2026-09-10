// ============ Trip workspace — Group input tab ============
// Merges the former Suggestions and Decisions tabs into one group-input
// surface. v0.36: a one-row stat strip + filters, needs-you cards float up
// with an amber edge and a digest in the sidebar that scrolls to them,
// decision options show WHO voted what with a tally verdict, the composer
// gains real Day/Category pickers, a visible transport-cost field and
// decision context, and per-filter empty states each get an exit.
// The underlying data model (two tables) and store actions are unchanged.
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Car, Clock, Lightbulb, MapPin, Plus, Scale, Sparkles, Ticket, X } from 'lucide-react'
import { PillNav } from '../../components/PillNav'
import type { StopCategory, StopSuggestion, Trip, TripDecision } from '../../data/types'
import { STOP_CATEGORIES } from '../../data/types'
import {
  useDb, userById, currentUser, addSuggestion, voteSuggestion, addCommentToSuggestion,
  acceptSuggestionIntoTimeline, declineSuggestion, addDecision, voteOnDecision, resolveDecision,
  activityFor,
} from '../../store/store'
import { formatInr, minutesToHM } from '../../lib/engine'
import { decisionContext, contextLine, recommendForDecision } from '../../lib/decisionGuide'
import { Avatar, Chip, EmptyState, Field, toast } from '../../components/ui'
import { LocationInput } from '../../components/LocationInput'
import { timeAgo } from './shared'

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

export function GroupInputTab({ trip, editable, me }: {
  trip: Trip
  editable: boolean
  me: NonNullable<ReturnType<typeof currentUser>>
}) {
  const db = useDb()
  const memberCount = (trip.members ?? []).length
  const [filter, setFilter] = useState<Filter>('all')
  const [composerMode, setComposerMode] = useState<ComposerMode>('idea')

  const suggestions = db.suggestions.filter(s => s.tripId === trip.id)
  const decisions = db.decisions.filter(d => d.tripId === trip.id)

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

  /** Digest row → scroll the card into view and flash its edge. */
  function focusItem(id: string) {
    const el = document.getElementById(`gi-item-${id}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('gi-flash')
    window.setTimeout(() => el.classList.remove('gi-flash'), 1600)
  }

  return (
    <div>
      <div className="gi-strip">
        <div className="gi-stats" role="group" aria-label="Filter by state">
          {([['open', 'Open', openCount], ['mine', 'Need you', needsYouCount], ['resolved', 'Resolved', resolvedCount]] as const).map(([key, label, count]) => (
            <button key={key} type="button"
              className={`gi-stat${count > 0 && key === 'mine' ? ' hot' : ''}${filter === key ? ' on' : ''}`}
              aria-pressed={filter === key}
              onClick={() => setFilter(f => f === key ? 'all' : key)}>
              <b>{count}</b> {label}
            </button>
          ))}
        </div>
        <PillNav className="filter-pillbar" role="group" aria-label="Filter group input" activeKey={filter}>
          {([['all', 'All'], ['ideas', 'Stop ideas'], ['decisions', 'Decisions'], ['mine', 'Need you'], ['resolved', 'Resolved']] as const).map(([k, label]) => (
            <button key={k} type="button" data-pill-key={k} className={`clickable-chip chip${filter === k ? ' on-teal' : ''}`}
              onClick={() => setFilter(k)} aria-pressed={filter === k}>{label}</button>
          ))}
        </PillNav>
      </div>

      <div className="two-col">
        <div>
          {items.length === 0 && (
            <EmptyState icon={<Lightbulb size={38} aria-hidden />} title={EMPTY_COPY.all.title}
              body={EMPTY_COPY.all.body} />
          )}
          {items.length > 0 && shown.length === 0 && (
            <EmptyState icon={EMPTY_COPY[filter].icon === 'idea' ? <Lightbulb size={38} aria-hidden /> : <Scale size={38} aria-hidden />}
              title={EMPTY_COPY[filter].title} body={EMPTY_COPY[filter].body}
              action={<button className="btn btn-outline btn-sm" onClick={() => setFilter('all')}>Show everything</button>} />
          )}
          {shown.map(item => item.kind === 'idea'
            ? <SuggestionCard key={item.sg.id} sg={item.sg} trip={trip} me={me} editable={editable} memberCount={memberCount}
                needsMe={suggestionNeedsMe(item.sg)} />
            : <DecisionCard key={item.d.id} d={item.d} me={me} editable={editable}
                needsMe={decisionNeedsMe(item.d)} trip={trip} />
          )}

          <div className="card">
            <h3>Activity feed</h3>
            <hr className="divider" />
            {activityFor(trip.id).slice(0, 20).map(a => (
              <div key={a.id} className="feed-item">
                <Avatar user={userById(a.actorId)} />
                <span><b>{userById(a.actorId)?.profile.name}</b> {a.verb}{a.target ? ` · ${a.target}` : ''}</span>
                <span className="feed-time">{timeAgo(a.at)}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          {needsYou.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h3>Needs you</h3>
              <hr className="divider" />
              {needsYou.map(i => (
                <button key={itemId(i)} type="button" className="digest-row"
                  onClick={() => focusItem(itemId(i))}>
                  {i.kind === 'idea' ? <Lightbulb size={14} aria-hidden /> : <Scale size={14} aria-hidden />}
                  <span className="digest-title">{itemTitle(i)}</span>
                  <span className="digest-sub">{digestSub(i)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="card">
            <PillNav className="filter-pillbar" role="group" aria-label="What do you want to add?" activeKey={composerMode}>
              {([['idea', 'Stop idea'], ['question', 'Question']] as const).map(([k, label]) => (
                <button key={k} type="button" data-pill-key={k} className={`clickable-chip chip${composerMode === k ? ' on-teal' : ''}`}
                  onClick={() => setComposerMode(k)} aria-pressed={composerMode === k}>{label}</button>
              ))}
            </PillNav>
            {composerMode === 'idea'
              ? <SuggestionComposerForm trip={trip} me={me} />
              : <DecisionComposerForm trip={trip} />}
          </div>
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

function SuggestionCard({ sg, trip, me, editable, memberCount, needsMe }: {
  sg: StopSuggestion
  trip: Trip
  me: NonNullable<ReturnType<typeof currentUser>>
  editable: boolean
  memberCount: number
  needsMe: boolean
}) {
  const ups = sg.votes.filter(v => v.value === 1).length
  const downs = sg.votes.length - ups
  const myVote = sg.votes.find(v => v.userId === me.id)?.value
  const consensusPct = memberCount ? Math.round((ups / memberCount) * 100) : 0
  const author = userById(sg.proposedBy)
  return (
    <div id={`gi-item-${sg.id}`} className={`card${needsMe ? ' gi-needs-you' : ''}`} style={{ marginBottom: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 14 }}>
      <div className="vote-col">
        <button className={`vote-btn ${myVote === 1 ? 'on' : ''}`} onClick={() => voteSuggestion(trip.id, sg.id, me.id, 1)} aria-label="Upvote" aria-pressed={myVote === 1}>▲</button>
        <span className="vote-count">{ups - downs}</span>
        <button className={`vote-btn ${myVote === -1 ? 'on' : ''}`} onClick={() => voteSuggestion(trip.id, sg.id, me.id, -1)} aria-label="Downvote" aria-pressed={myVote === -1}>▼</button>
      </div>
      <div>
        <div className="row-between">
          <h3>{sg.title}</h3>
          <span style={{ display: 'inline-flex', gap: 6 }}>
            {needsMe && <Chip tone="saffron">Needs your vote</Chip>}
            {sg.status === 'open' && consensusPct >= 60 && <Chip tone="teal">Best fit</Chip>}
            <Chip tone={sg.status === 'accepted' ? 'ok' : sg.status === 'declined' ? 'danger' : 'teal'}>{sg.status}</Chip>
          </span>
        </div>
        <div className="creator-line" style={{ margin: '5px 0' }}>
          <Avatar user={author} /> {author?.profile.name ?? 'Traveller'} suggested for Day {sg.dayIndex + 1}
        </div>
        {sg.description && <p className="small muted">{sg.description}</p>}
        <div className="stop-meta" style={{ marginTop: 7 }}>
          <span><MapPin size={13} aria-hidden /> {sg.locationName}</span>
          <span><Clock size={13} aria-hidden /> {minutesToHM(sg.visitMinutes)}</span>
          <span><Ticket size={13} aria-hidden /> ₹{sg.estimatedEntryFeeInr}/person</span>
          <span><Car size={13} aria-hidden /> ₹{sg.estimatedTransportInr} transport</span>
        </div>
        <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="consensus-bar" style={{ flex: 1 }} role="img" aria-label={`Consensus ${consensusPct}% of members upvoted`}>
            <div style={{ width: `${consensusPct}%`, background: consensusPct >= 60 ? 'var(--ok)' : consensusPct >= 35 ? 'var(--saffron)' : 'var(--line)' }} />
          </div>
          <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{ups} of {memberCount} upvoted</span>
        </div>

        {editable && sg.status === 'open' && (
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 11 }}>
            <button className="btn btn-primary btn-sm" onClick={() => { acceptSuggestionIntoTimeline(trip.id, sg.id); toast('Added to timeline') }}>Add to timeline</button>
            <button className="btn btn-danger btn-sm" onClick={() => { declineSuggestion(trip.id, sg.id); toast('Suggestion declined') }}>Decline</button>
          </div>
        )}

        {sg.comments.length > 0 && (
          <div style={{ marginTop: 8 }}>
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
        <CommentForm onSubmit={(text) => addCommentToSuggestion(trip.id, sg.id, me.id, text)} />
      </div>
      </div>
    </div>
  )
}

function CommentForm({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <form style={{ display: 'flex', gap: 7, marginTop: 10 }} onSubmit={e => { e.preventDefault(); if (text.trim()) { onSubmit(text.trim()); setText('') } }}>
      <input className="input" placeholder="Add a comment…" aria-label="Add a comment" value={text} onChange={e => setText(e.target.value)} />
      <button className="btn btn-sm btn-outline">Post</button>
    </form>
  )
}

// ================= Decision card =================

function DecisionCard({ d, me, editable, needsMe, trip }: {
  d: TripDecision
  me: { id: string }
  editable: boolean
  needsMe: boolean
  trip: Trip
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

  return (
    <div id={`gi-item-${d.id}`} className={`card${needsMe ? ' gi-needs-you' : ''}`} style={{ marginBottom: 14 }}>
      <div className="row-between">
        <h3>{d.question}</h3>
        <span style={{ display: 'inline-flex', gap: 6 }}>
          {needsMe && <Chip tone="saffron">Needs your vote</Chip>}
          <Chip tone={d.status === 'open' ? 'saffron' : 'ok'}>{d.status}</Chip>
        </span>
      </div>
      {d.context && <p className="small muted" style={{ margin: '5px 0 10px' }}>{d.context}</p>}
      <div style={{ margin: '8px 0' }}>
        {d.options.map((o, i) => {
          const mine = d.votesByUserId[me.id] === o.id
          const voters = votersOf(o.id)
          const leading = d.status === 'open' && i === leadingIdx && tally[i] > 0
          return (
            <div key={o.id} className={`decision-option-row${leading ? ' leading' : ''}`}>
              <button className={`vote-btn ${mine ? 'on' : ''}`} disabled={d.status === 'resolved'} aria-pressed={mine}
                onClick={() => voteOnDecision(d.id, o.id)} aria-label={`Vote for ${o.label}`}>▲</button>
              <span style={{ flex: 1 }}>
                {o.label}
                {o.costImpactInr ? <span className="muted small"> · {o.costImpactInr > 0 ? '+' : ''}{formatInr(o.costImpactInr)}</span> : null}
              </span>
              {voters.length > 0 && (
                <span className="who-voted" role="img" aria-label={`Voted for this: ${voters.map(v => userById(v)?.profile.name ?? 'Traveller').join(', ')}`}>
                  {voters.slice(0, 4).map(v => <Avatar key={v} user={userById(v)} />)}
                  {voters.length > 4 && <span className="who-more">+{voters.length - 4}</span>}
                </span>
              )}
              {tally[i] > 0 && <span className="chip chip-info">{tally[i]} vote{tally[i] !== 1 ? 's' : ''}</span>}
              {d.status === 'resolved' && d.resolvedOptionId === o.id && <Chip tone="ok">Chosen</Chip>}
            </div>
          )
        })}
      </div>
      {d.status === 'open' && (
        <div className="gi-guide" style={{ marginTop: 10 }}>
          <p className="small muted" style={{ margin: 0 }}>📋 {contextLine(ctx)}</p>
          {rec && (
            <p className="small" style={{ margin: '4px 0 0' }}>
              <Sparkles size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />
              <b>{rec.label}</b> — {rec.reason} <span className="chip chip-sm chip-info" style={{ marginLeft: 4 }}>offline</span>
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
            <button key={o.id} className={`btn btn-sm ${i === leadingIdx ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => { resolveDecision(d.id, o.id); toast('Decision resolved') }}>
              Resolve: {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ================= Composer forms =================

/** Where a suggestion pins when the proposer didn't pick a real place: the
 *  trip's own start, then its first geocoded destination, then its first
 *  stop — never a hardcoded Munnar. */
export function tripAnchor(trip: Trip): { lat: number; lng: number } {
  if (trip.startLocationCoords) return trip.startLocationCoords
  const dest = trip.destinationCoords?.find(c => c !== null && c !== undefined)
  if (dest) return dest
  for (const d of trip.days) {
    const s = d.stops.find(x => x.status !== 'rejected') ?? d.stops[0]
    if (s) return { lat: s.lat, lng: s.lng }
  }
  // Degenerate: a trip with no geography at all. Anchor at 0,0 (visible as a
  // "To be decided" pin) rather than silently inventing a real place.
  return { lat: 0, lng: 0 }
}

function SuggestionComposerForm({ trip, me }: {
  trip: Trip
  me: NonNullable<ReturnType<typeof currentUser>>
}) {
  const [form, setForm] = useState({
    title: '', dayIndex: 0, category: 'sightseeing' as StopCategory, locationName: '',
    description: '', visitMinutes: 60, entryFee: 0, transportCost: 200,
  })
  const [coords, setCoords] = useState<{ lat?: number; lng?: number }>({})

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) { toast('Give your suggestion a name.', 'err'); return }
    const anchor = coords.lat !== undefined && coords.lng !== undefined
      ? { lat: coords.lat, lng: coords.lng }
      : tripAnchor(trip)
    addSuggestion(trip.id, {
      dayIndex: form.dayIndex, proposedBy: me.id, title: form.title.trim(),
      category: form.category, locationName: form.locationName || 'To be decided',
      lat: anchor.lat, lng: anchor.lng, description: form.description,
      visitMinutes: form.visitMinutes, estimatedEntryFeeInr: form.entryFee,
      estimatedTransportInr: form.transportCost,
    })
    setForm(f => ({ ...f, title: '', description: '' }))
    setCoords({})
    toast('Suggestion shared with the group!')
  }

  return (
    <form onSubmit={submit}>
      <h3>Add to the plan</h3>
      <p className="hint-text" style={{ margin: '6px 0 12px' }}>Others can vote and comment; editors can accept it into the timeline.</p>
      <Field label="Idea"><input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Pothamedu viewpoint" /></Field>
      <div className="form-row">
        <Field label="Day">
          <select className="select" value={form.dayIndex} onChange={e => setForm(f => ({ ...f, dayIndex: Number(e.target.value) }))}>
            {trip.days.map(d => <option key={d.index} value={d.index}>Day {d.index + 1}{d.title ? ` · ${d.title}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select className="select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as StopCategory }))}>
            {STOP_CATEGORIES.map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Area"><LocationInput value={form.locationName} onChange={v => setForm(f => ({ ...f, locationName: v }))} onPick={p => setCoords({ lat: p.latitude, lng: p.longitude })} placeholder="Search, e.g. Munnar" /></Field>
      <div className="form-row">
        <Field label="Visit minutes"><input type="number" className="input" min={15} step={5} value={form.visitMinutes} onChange={e => setForm(f => ({ ...f, visitMinutes: Number(e.target.value) }))} /></Field>
        <Field label="Entry fee ₹/person"><input type="number" className="input" min={0} value={form.entryFee} onChange={e => setForm(f => ({ ...f, entryFee: Number(e.target.value) }))} /></Field>
      </div>
      <Field label="Transport ₹ (total, to get there and back)" hint="Feeds the Budget tab's per-day bars when accepted.">
        <input type="number" className="input" min={0} value={form.transportCost} onChange={e => setForm(f => ({ ...f, transportCost: Number(e.target.value) }))} />
      </Field>
      <Field label="Why it’s worth it"><textarea className="textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></Field>
      <button className="btn btn-primary" style={{ width: '100%' }}>Share with the group</button>
    </form>
  )
}

function DecisionComposerForm({ trip }: { trip: Trip }) {
  const [q, setQ] = useState('')
  const [context, setContext] = useState('')
  const [opts, setOpts] = useState([{ label: '', cost: '' }, { label: '', cost: '' }])

  function setOpt(i: number, key: 'label' | 'cost', v: string) {
    setOpts(list => list.map((o, j) => j === i ? { ...o, [key]: v } : o))
  }

  function create(e: FormEvent) {
    e.preventDefault()
    if (!q.trim()) { toast('Write the question first.', 'err'); return }
    const built = opts
      .map(o => ({ label: o.label.trim(), cost: Number(o.cost) || 0 }))
      .filter(o => o.label)
    if (built.length < 2) { toast('Give at least two options.', 'err'); return }
    addDecision(trip.id, {
      question: q.trim(),
      context: context.trim() || undefined,
      options: built.map((o, i) => ({ id: `tmp_${i}`, label: o.label, costImpactInr: o.cost || undefined })),
    })
    setQ(''); setContext(''); setOpts([{ label: '', cost: '' }, { label: '', cost: '' }])
    toast('Decision posted for the group')
  }

  return (
    <form onSubmit={create}>
      <h3>Raise a decision</h3>
      <p className="hint-text" style={{ margin: '6px 0 12px' }}>Turn endless group-chat debates into one clear vote.</p>
      <Field label="Question"><input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Beach day or backwater day on Day 3?" /></Field>
      <Field label="Context (optional)" hint="Why the group is deciding — e.g. “forecast says one beach afternoon is a washout”.">
        <input className="input" value={context} onChange={e => setContext(e.target.value)} />
      </Field>
      <Field label="Options" hint="At least two — cost impact is optional.">
        <span style={{ display: 'grid', gap: 7 }}>
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
      <button className="btn btn-primary" style={{ width: '100%' }}>Post decision</button>
    </form>
  )
}
