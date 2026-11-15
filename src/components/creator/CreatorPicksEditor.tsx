import { useState } from 'react'
import type { PrivateUser, PublishedItinerary } from '../../data/types'
import { updateProfile, PROFILE_NOT_SAVED } from '../../store/store'
import { validPlanningNotes } from '../../lib/creatorFacts'
import { livePubs } from '../../lib/livePubs'
import type { ReadState } from '../../lib/readState'
import { Field } from '../ui'

export function CreatorPicksEditor({ me, pubs, read }: { me: PrivateUser; pubs: PublishedItinerary[]; read: ReadState }) {
  const [pick, setPick] = useState(me.profile.featuredPubId ?? '')
  const [notes, setNotes] = useState(me.profile.planningNotes ?? [])
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const live = livePubs(pubs).filter(pub => pub.creatorId === me.id)
  async function save() {
    if (busy) return
    if (!validPlanningNotes(notes)) { setFeedback({ kind: 'error', text: 'Use up to three notes. Each note needs text and at most 140 characters.' }); return }
    if (pick && !live.some(pub => pub.id === pick)) { setFeedback({ kind: 'error', text: 'Choose a live route or None.' }); return }
    setBusy(true)
    setFeedback(null)
    try {
      const result = await updateProfile({ featuredPubId: pick || null, planningNotes: notes })
      setFeedback(result.ok ? { kind: 'ok', text: 'Creator picks saved.' } : { kind: 'error', text: result.error ?? PROFILE_NOT_SAVED })
    } catch { setFeedback({ kind: 'error', text: PROFILE_NOT_SAVED }) }
    finally { setBusy(false) }
  }
  return <div className="cr-own-picks">
    <h3>Creator picks</h3>
    {read !== 'ready' && <p role="status">Routes: {read === 'failed' ? 'Unavailable' : 'Loading…'}</p>}
    <Field label="Featured route">
      <select className="input cr-own-featured-select" value={pick} disabled={busy || read !== 'ready'} onChange={event => { setPick(event.target.value); setFeedback(null) }}>
        <option value="">None</option>
        {pick && !live.some(pub => pub.id === pick) && <option value={pick} disabled>Unavailable route</option>}
        {live.map(pub => <option key={pub.id} value={pub.id}>{pub.title}</option>)}
      </select>
    </Field>
    <div className="cr-own-planning-notes">
      <h4>Planning notes</h4>
      {notes.map((note, index) => <div className="cr-own-planning-note" key={index}>
        <Field label={`Planning note ${index + 1}`}>
          <textarea className="textarea" value={note} disabled={busy} onChange={event => { setNotes(rows => rows.map((row, i) => i === index ? event.target.value : row)); setFeedback(null) }} />
        </Field>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setNotes(rows => rows.filter((_, i) => i !== index))}>Remove note {index + 1}</button>
      </div>)}
      <button type="button" className="btn btn-outline btn-sm" disabled={busy || notes.length >= 3} onClick={() => setNotes(rows => [...rows, ''])}>Add planning note</button>
    </div>
    <button type="button" className="btn btn-primary btn-sm" disabled={busy || read !== 'ready'} onClick={() => { void save() }}>{busy ? 'Saving…' : 'Save creator picks'}</button>
    {feedback && <p className="cr-own-picks-feedback" data-kind={feedback.kind} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.text}</p>}
  </div>
}
