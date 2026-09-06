// ============ Trip workspace — Group input tab ============
// Merges the former Suggestions and Decisions tabs (both M3.4 extractions of
// TripWorkspace.tsx) into one group-input surface: a single stat strip and
// filter pillbar span BOTH kinds, suggestion and decision cards interleave in
// one list ("needs you" first, then newest), and one composer card switches
// between the two forms. The underlying data model (two tables) and store
// actions are unchanged — this is a UI-level merge.
import React, { useState } from 'react'
import { Lightbulb, Scale } from 'lucide-react'
import type { StopSuggestion, Trip, TripDecision } from '../../data/types'
import {
  useDb, userById, currentUser, addSuggestion, voteSuggestion, addCommentToSuggestion,
  acceptSuggestionIntoTimeline, declineSuggestion, addDecision, voteOnDecision, resolveDecision,
  activityFor,
} from '../../store/store'
import { formatInr, minutesToHM } from '../../lib/engine'
import { Avatar, Chip, EmptyState, Field, toast } from '../../components/ui'
import { LocationInput } from '../../components/LocationInput'
import { timeAgo } from './shared'

// ================= Group input tab =================

type Filter = 'all' | 'ideas' | 'decisions' | 'mine' | 'resolved'
type ComposerMode = 'idea' | 'question'
/** One interleaved list entry: either a stop suggestion or a trip decision. */
type GroupItem = { kind: 'idea'; sg: StopSuggestion } | { kind: 'decision'; d: TripDecision }

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

  // "Needs you" now spans both kinds: an open suggestion I haven't voted on,
  // or an open decision I haven't voted on.
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
    : filter === 'mine' ? items.filter(itemNeedsMe)
    : filter === 'resolved' ? items.filter(itemResolved)
    : items

  // ⚡ focus: the first needs-you item across BOTH kinds is "next to unblock".
  const unblock = items.find(itemNeedsMe)

  return (
    <div>
      <div className="dec-strip">
        <div className="stat-tile">
          <div className="stat-label">Open</div>
          <div className="stat-value">{openCount}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Need you</div>
          <div className="stat-value">{needsYouCount}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Resolved</div>
          <div className="stat-value">{resolvedCount}</div>
        </div>
      </div>
      <div className="filter-pillbar" style={{ marginBottom: 14 }} role="group" aria-label="Filter group input">
        {([['all', 'All'], ['ideas', 'Stop ideas'], ['decisions', 'Decisions'], ['mine', 'Need you'], ['resolved', 'Resolved']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`clickable-chip chip${filter === k ? ' on-teal' : ''}`}
            onClick={() => setFilter(k)} aria-pressed={filter === k}>{label}</button>
        ))}
      </div>

      <div className="two-col">
        <div>
          {items.length === 0 && (
            <EmptyState icon={<Lightbulb size={38} aria-hidden />} title="Nothing waiting on the group"
              body="Propose stops for everyone to vote on, or raise a decision — both land here with the activity feed." />
          )}
          {items.length > 0 && shown.length === 0 && (
            <p className="muted small" style={{ margin: '4px 0 14px' }}>Nothing under this filter right now.</p>
          )}
          {shown.map(item => item.kind === 'idea'
            ? <SuggestionCard key={item.sg.id} sg={item.sg} trip={trip} me={me} editable={editable} memberCount={memberCount}
                isUnblock={unblock?.kind === 'idea' && unblock.sg.id === item.sg.id} />
            : <DecisionCard key={item.d.id} d={item.d} me={me} editable={editable}
                isUnblock={unblock?.kind === 'decision' && unblock.d.id === item.d.id} />
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
          <div className="card">
            <div className="filter-pillbar" style={{ marginBottom: 12 }} role="group" aria-label="What do you want to add?">
              {([['idea', 'Stop idea'], ['question', 'Question']] as const).map(([k, label]) => (
                <button key={k} type="button" className={`clickable-chip chip${composerMode === k ? ' on-teal' : ''}`}
                  onClick={() => setComposerMode(k)} aria-pressed={composerMode === k}>{label}</button>
              ))}
            </div>
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

// ================= Suggestion card (was SuggestionsTab) =================

function SuggestionCard({ sg, trip, me, editable, memberCount, isUnblock }: {
  sg: StopSuggestion
  trip: Trip
  me: NonNullable<ReturnType<typeof currentUser>>
  editable: boolean
  memberCount: number
  isUnblock: boolean
}) {
  const ups = sg.votes.filter(v => v.value === 1).length
  const downs = sg.votes.length - ups
  const myVote = sg.votes.find(v => v.userId === me.id)?.value
  const consensusPct = memberCount ? Math.round((ups / memberCount) * 100) : 0
  const author = userById(sg.proposedBy)
  return (
    <div className={`card${isUnblock ? ' decision-unblock' : ''}`} style={{ marginBottom: 14 }}>
      {isUnblock && <div className="unblock-label">⚡ Next to unblock</div>}
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
            {sg.status === 'open' && consensusPct >= 60 && <Chip tone="teal">Best fit</Chip>}
            <Chip tone={sg.status === 'accepted' ? 'ok' : sg.status === 'declined' ? 'danger' : 'teal'}>{sg.status}</Chip>
          </span>
        </div>
        <div className="creator-line" style={{ margin: '5px 0' }}>
          <Avatar user={author} /> {author?.profile.name ?? 'Traveller'} suggested for Day {sg.dayIndex + 1}
        </div>
        {sg.description && <p className="small muted">{sg.description}</p>}
        <div className="stop-meta" style={{ marginTop: 7 }}>
          <span>📍 {sg.locationName}</span>
          <span>⏱ {minutesToHM(sg.visitMinutes)}</span>
          <span>🎫 ₹{sg.estimatedEntryFeeInr}/person</span>
          <span>🚗 ₹{sg.estimatedTransportInr} transport</span>
        </div>
        <div style={{ marginTop: 9 }}>
          <div className="small muted" style={{ marginBottom: 3 }}>Consensus: {consensusPct}% of members upvoted</div>
          <div className="consensus-bar">
            <div style={{ width: `${consensusPct}%`, background: consensusPct >= 60 ? 'var(--ok)' : consensusPct >= 35 ? 'var(--saffron)' : 'var(--line)' }} />
          </div>
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

// ================= Decision card (was DecisionsTab) =================

function DecisionCard({ d, me, editable, isUnblock }: {
  d: TripDecision
  me: { id: string }
  editable: boolean
  isUnblock: boolean
}) {
  const tally = d.options.map(o => Object.values(d.votesByUserId).filter(v => v === o.id).length)
  return (
    <div className={`card${isUnblock ? ' decision-unblock' : ''}`} style={{ marginBottom: 14 }}>
      {isUnblock && <div className="unblock-label">⚡ Next to unblock</div>}
      <div className="row-between">
        <h3>{d.question}</h3>
        <Chip tone={d.status === 'open' ? 'saffron' : 'ok'}>{d.status}</Chip>
      </div>
      {d.context && <p className="small muted" style={{ margin: '5px 0 10px' }}>{d.context}</p>}
      <div style={{ margin: '8px 0' }}>
        {d.options.map((o, i) => {
          const votes = tally[i]
          const mine = d.votesByUserId[me.id] === o.id
          return (
            <div key={o.id} className="decision-option-row">
              <button className={`vote-btn ${mine ? 'on' : ''}`} disabled={d.status === 'resolved'} aria-pressed={mine}
                onClick={() => voteOnDecision(d.id, o.id)} aria-label={`Vote for ${o.label}`}>▲</button>
              <span style={{ flex: 1 }}>{o.label}{o.costImpactInr ? <span className="muted small"> · {o.costImpactInr > 0 ? '+' : ''}{formatInr(o.costImpactInr)}</span> : null}</span>
              {votes > 0 && <span className="chip chip-info">{votes} vote{votes !== 1 ? 's' : ''}</span>}
              {d.status === 'resolved' && d.resolvedOptionId === o.id && <Chip tone="ok">Chosen</Chip>}
            </div>
          )
        })}
      </div>
      {editable && d.status === 'open' && (
        <div className="resolve-btns">
          {d.options.map(o => (
            <button key={o.id} className="btn btn-outline btn-sm" onClick={() => { resolveDecision(d.id, o.id); toast('Decision resolved') }}>
              Resolve: {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ================= Composer forms (were the two side-column forms) =================

function SuggestionComposerForm({ trip, me }: {
  trip: Trip
  me: NonNullable<ReturnType<typeof currentUser>>
}) {
  const [form, setForm] = useState({ title: '', locationName: '', description: '', visitMinutes: 60, entryFee: 0, transportCost: 200 })
  const [sugCoords, setSugCoords] = useState<{ lat?: number; lng?: number }>({})

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) { toast('Give your suggestion a name.', 'err'); return }
    addSuggestion(trip.id, {
      dayIndex: 0, proposedBy: me.id, title: form.title.trim(),
      category: 'sightseeing', locationName: form.locationName || 'To be decided',
      lat: sugCoords.lat ?? 10.0889, lng: sugCoords.lng ?? 77.0595, description: form.description,
      visitMinutes: form.visitMinutes, estimatedEntryFeeInr: form.entryFee,
      estimatedTransportInr: form.transportCost,
    })
    setForm(f => ({ ...f, title: '', description: '' }))
    toast('Suggestion shared with the group!')
  }

  return (
    <form onSubmit={submit}>
      <h2>Propose a stop</h2>
      <p className="hint-text" style={{ margin: '6px 0 12px' }}>Others can vote and comment; editors can accept it into the timeline.</p>
      <Field label="Idea"><input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Pothamedu viewpoint" /></Field>
      <Field label="Area"><LocationInput value={form.locationName} onChange={v => setForm(f => ({ ...f, locationName: v }))} onPick={p => setSugCoords({ lat: p.latitude, lng: p.longitude })} placeholder="Search, e.g. Munnar" /></Field>
      <div className="form-row">
        <Field label="Visit minutes"><input type="number" className="input" min={15} step={5} value={form.visitMinutes} onChange={e => setForm(f => ({ ...f, visitMinutes: Number(e.target.value) }))} /></Field>
        <Field label="Entry fee ₹/person"><input type="number" className="input" min={0} value={form.entryFee} onChange={e => setForm(f => ({ ...f, entryFee: Number(e.target.value) }))} /></Field>
      </div>
      <Field label="Why it’s worth it"><textarea className="textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></Field>
      <button className="btn btn-primary" style={{ width: '100%' }}>Share suggestion</button>
    </form>
  )
}

function DecisionComposerForm({ trip }: { trip: Trip }) {
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState('')

  function create(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) { toast('Write the question first.', 'err'); return }
    const list = opts.split('\n').map(o => o.trim()).filter(Boolean)
    if (list.length < 2) { toast('Give at least two options (one per line).', 'err'); return }
    addDecision(trip.id, {
      question: q.trim(),
      options: list.map(l => ({ id: `opt_${Math.random().toString(36).slice(2, 8)}`, label: l })),
    })
    setQ(''); setOpts('')
    toast('Decision posted for the group')
  }

  return (
    <form onSubmit={create}>
      <h3>Raise a decision</h3>
      <p className="hint-text" style={{ margin: '6px 0 12px' }}>Turn endless group-chat debates into one clear vote.</p>
      <Field label="Question"><input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Beach shack lunch or café?" /></Field>
      <Field label="Options (one per line)" hint="At least two"><textarea className="textarea" value={opts} onChange={e => setOpts(e.target.value)} placeholder={'Option A\nOption B'} /></Field>
      <button className="btn btn-primary" style={{ width: '100%' }}>Post decision</button>
    </form>
  )
}
