// ============ Make it your weekend: the creator storefront card (F-40, I-133) ============
// A visitor picks a start date and a party size, then copies the featured route
// with those answers. The ticket shows what the copy will hold. The route figures
// come from the publication row, and a figure the row does not have is left off.
import { useEffect, useId, useState } from 'react'
import type { PublishedItinerary } from '../../data/types'
import { CREW_MIN } from '../../lib/crew'
import { countNoun } from '../../lib/creatorCopy'
import { formatInr } from '../../lib/engine'
import { takeForkAttribution } from '../../lib/growthAttribution'
import {
  PARTY_DEFAULT, PARTY_MAX, clampParty, copiedSpan, dateRangeLabel, endForSpan, headEstimateInr,
  isoDayOf, pickLabel, planLine, weekendStarts, type ForkPlan,
} from '../../lib/weekendPlan'
import { localMidnightMs } from '../../lib/dayCount'
import { fetchPublicTrip, tripById } from '../../store/store'

export function StoreWeekend({ pub, creatorName, signedIn, onCopy }: {
  pub: PublishedItinerary
  creatorName: string
  signedIn: boolean
  onCopy: (plan: ForkPlan) => void
}) {
  const whenId = useId()
  const partyId = useId()
  const fromId = useId()
  const otherId = useId()
  const [today] = useState(() => new Date())
  const todayIso = isoDayOf(today)
  const [picks] = useState(() => weekendStarts(today))
  // Answers kept through sign-in refill the form. A date that has already passed is not offered again.
  const [kept] = useState<ForkPlan | null>(() => {
    const plan = takeForkAttribution(pub.id, false)?.plan ?? null
    return plan && plan.startDate >= todayIso ? plan : null
  })
  const [start, setStart] = useState(() => kept?.startDate ?? picks[0])
  const [otherOpen, setOtherOpen] = useState(() => kept !== null && !picks.includes(kept.startDate))
  const [party, setParty] = useState(() => (kept ? clampParty(kept.travellers) : PARTY_DEFAULT))

  const [source, setSource] = useState(() => tripById(pub.tripId) ?? null)
  useEffect(() => {
    if (source) return
    let alive = true
    void fetchPublicTrip(pub.id).then(trip => { if (alive) setSource(trip) }).catch(() => {})
    return () => { alive = false }
  }, [pub.id, source])
  const span = copiedSpan(source)
  const end = span === null ? null : endForSpan(start, span)
  if (span === null || end === null) return null
  const town = (pub.routeSummary ?? [])[0]?.trim() || null
  const plan = planLine(pub.premiumPriceInr)
  const head = headEstimateInr(pub.estimatedBudgetPerPersonInr)
  const partyLabel = countNoun(party, 'person', 'people')
  const ticketDates = `${dateRangeLabel(start, end)} · ${countNoun(span, 'day')}`

  const copyRoute = () => { onCopy({ startDate: start, travellers: party, startTown: town }) }
  const takeOtherDate = (value: string) => {
    if (localMidnightMs(value) !== null && value >= todayIso) setStart(value)
  }

  return (
    <section className="container cr-store-weekend" aria-label="Make it your weekend">
      <div className="cr-weekend-form">
        <span className="cr-weekend-kicker">Make it your weekend</span>
        <h2 className="cr-weekend-title">{pub.title}, with your dates and your people</h2>
        <div className="cr-weekend-fields">
          <div className="cr-weekend-field" role="group" aria-labelledby={whenId}>
            <span className="cr-weekend-label" id={whenId}>When</span>
            {picks.map(p => (
              <button key={p} type="button" className="cr-weekend-pick" aria-pressed={start === p}
                onClick={() => { setStart(p); setOtherOpen(false) }}>
                {pickLabel(p, endForSpan(p, span) ?? p)}
              </button>
            ))}
            <button type="button" className="cr-weekend-pick" aria-expanded={otherOpen} aria-controls={otherId}
              onClick={() => { setOtherOpen(open => !open) }}>
              Other dates
            </button>
            {otherOpen && (
              <label className="cr-weekend-other" id={otherId}>
                <span className="cr-weekend-label">Start date</span>
                <input type="date" className="cr-weekend-date" min={todayIso} value={start}
                  onChange={e => { takeOtherDate(e.target.value) }} />
              </label>
            )}
          </div>

          <div className="cr-weekend-field">
            <span className="cr-weekend-label" id={partyId}>Who’s coming</span>
            <div className="cr-weekend-stepper" role="group" aria-labelledby={partyId}>
              <button type="button" className="cr-weekend-step" aria-label="Fewer people"
                disabled={party <= CREW_MIN} onClick={() => { setParty(n => clampParty(n - 1)) }}>−</button>
              <output className="cr-weekend-count" aria-live="polite">{partyLabel}</output>
              <button type="button" className="cr-weekend-step" aria-label="More people"
                disabled={party >= PARTY_MAX} onClick={() => { setParty(n => clampParty(n + 1)) }}>+</button>
            </div>
            <span className="cr-weekend-note">Invite them after you copy</span>
          </div>

          <div className="cr-weekend-field">
            <span className="cr-weekend-label" id={fromId}>Leaving from</span>
            <div className={town ? 'cr-weekend-from' : 'cr-weekend-from cr-weekend-from--empty'} aria-labelledby={fromId}>
              <span className="cr-weekend-from-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="13" height="13">
                  <path className="cr-weekend-pin-body" d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" strokeWidth="1.9" />
                  <circle className="cr-weekend-pin-dot" cx="12" cy="9.5" r="2.5" />
                </svg>
              </span>
              {town ?? 'Not named'}
            </div>
            {town && <span className="cr-weekend-note">Same start as {creatorName}’s route</span>}
          </div>
        </div>

        <div className="cr-weekend-copy-row">
          <button type="button" className="btn btn-primary btn-lg cr-weekend-copy" onClick={() => { copyRoute() }}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="12" cy="19" r="2" />
              <path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 12v5" />
            </svg>
            Copy to my trips
          </button>
          {!signedIn && <span className="cr-weekend-note">You sign in once, then come straight back here with these answers kept.</span>}
        </div>
      </div>

      <aside className="cr-weekend-ticket" aria-label="Your trip ticket">
        <div className="cr-weekend-ticket-head">
          <span className="cr-weekend-ticket-brand">Yatra<span>Flow</span></span>
          <span className="cr-weekend-ticket-tag">Your ticket</span>
        </div>
        {pub.coverImageUrl && (
          <div className="cr-weekend-ticket-cover"><img src={pub.coverImageUrl} alt="" loading="lazy" /></div>
        )}
        <div className="cr-weekend-ticket-body">
          <b className="cr-weekend-ticket-title">{pub.title}</b>
          <dl className="cr-weekend-ticket-rows">
            <div><dt>Dates</dt><dd>{ticketDates}</dd></div>
            <div><dt>Party</dt><dd>{partyLabel}</dd></div>
            {plan && (
              <div>
                <dt>Plan</dt>
                <dd className={plan.kind === 'free' ? 'cr-weekend-free' : undefined}>
                  {plan.kind === 'free' ? 'Free' : formatInr(plan.inr)}
                </dd>
              </div>
            )}
            {head !== null && <div><dt>Trip, a head</dt><dd>about {formatInr(head)}</dd></div>}
          </dl>
          {head !== null && <span className="cr-weekend-ticket-note">{creatorName}’s estimate. It is not a booking.</span>}
        </div>
      </aside>
    </section>
  )
}
