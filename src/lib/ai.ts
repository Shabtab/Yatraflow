// ============ AI travel companion ============
// Deterministic, trip-data-grounded assistant. No live data claims —
// every answer cites the assumptions it used.
import type { Trip, ItineraryStop } from '../data/types'
import {
  getAssumptions, simulateDay, buildJourney, computeTotals, originOf, scheduleRowsById, legCostInr,
  minutesToHM, hmToMinutes, collectWarnings, formatInr, countHotelNights, AIRPORT_CHECKIN_MIN,
  type LegEstimate,
} from './engine'
import { INTENT_NONE, type CompanionIntent } from './jevTaxonomy'

export interface AiReply {
  text: string
  assumptions?: string
}

const DISCLAIMER = 'Estimates use demo coordinates and fixed assumptions — not live traffic or prices.'
type AdviceExposure = 'indoor' | 'outdoor' | 'unknown'
type DepartureCommitment = Trip['fixedCommitments'][number] & { type: 'flight-departure' | 'train-departure' }
type DepartureCandidate =
  | { dayIndex: number; type: 'flight-departure'; source: 'flight-leg'; title: string; time: string | null; airportIata: string }
  | { dayIndex: number; type: DepartureCommitment['type']; source: 'fixed-commitment'; title: string; time: string; terminalStopId: string | null }

export interface AdviceStopFact {
  id: string
  title: string
  category: ItineraryStop['category']
  priority: ItineraryStop['priority']
  auto: boolean
  dayIndex: number
  arrival: string | null
  departure: string | null
  visitMinutes: number | null
  transferFrom: string | null
  transferMinutes: number | null
  exposure: AdviceExposure
}

export interface AdviceDayFacts {
  dayIndex: number
  start: string | null
  end: string | null
  stops: AdviceStopFact[]
}

export interface DepartureAdviceFact {
  dayIndex: number
  type: 'flight-departure' | 'train-departure'
  source: 'flight-leg' | 'fixed-commitment'
  title: string
  time: string | null
  departureAt: string | null
  terminal: AdviceStopFact | null
  bufferMinutes: number | null
  status: 'supported' | 'unknown'
  reason: string | null
}

/**
 * The shared, engine-derived schedule facts used by both advice paths.
 *
 * `legCorrections` is the workspace's measured road data — the same figures the
 * timeline, map, ICS export and impact preview render with. Passing it is what
 * makes an advice verdict and those surfaces agree; omitting it keeps the
 * deterministic haversine engine in charge, exactly as before.
 */
export function buildAdviceFacts(
  trip: Trip,
  legCorrections?: Record<string, LegEstimate>,
): AdviceDayFacts[] {
  return [...trip.days]
    .sort((a, b) => a.index - b.index)
    .map(day => {
      const journey = buildJourney(trip, day, legCorrections, originOf(trip, day.index))
      const at = (absoluteMinute: number): string | null => {
        if (!Number.isFinite(absoluteMinute)) return null
        // Round once before the date carry and clock modulo, as engine
        // addMinutesToClock does. Fractional leg durations are normal.
        const roundedMinute = Math.round(absoluteMinute)
        const date = shiftIsoDate(trip.startDate, day.index + Math.floor(roundedMinute / 1440))
        if (date === 'unknown-date') return null
        const minute = ((roundedMinute % 1440) + 1440) % 1440
        const clock = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
        return `${date} ${clock}`
      }
      let cursor = hmToMinutes(journey.startTime) + (journey.startDayOffset ?? 0) * 1440
      const start = Number.isFinite(cursor) ? at(cursor) : null
      let timelineKnown = start !== null
      const stops = journey.points.flatMap(point => {
        if (point.kind === 'start') return []
        const transfer = point.legIn
        const transferMinutes = transfer && Number.isFinite(transfer.durationMinutes) ? transfer.durationMinutes : null
        if (transferMinutes === null) timelineKnown = false
        else if (timelineKnown) cursor += transferMinutes
        const arrival = timelineKnown ? at(cursor) : null
        const source = day.stops.find(stop => stop.id === point.stop.id)
        const visitMinutes = point.stop.auto === true
          ? 0
          : source && Number.isFinite(source.visitMinutes) ? source.visitMinutes : null
        if (visitMinutes === null || !Number.isFinite(point.dwellMinutes)) timelineKnown = false
        else if (timelineKnown) cursor += point.dwellMinutes
        return [{
          id: point.stop.id,
          title: point.title,
          category: point.stop.category,
          priority: point.stop.priority,
          auto: point.stop.auto === true,
          dayIndex: day.index,
          arrival,
          departure: timelineKnown ? at(cursor) : null,
          visitMinutes,
          transferFrom: transferMinutes === null ? null : transfer?.fromTitle ?? null,
          transferMinutes,
          exposure: exposureEvidence(point.stop),
        }]
      })
      return { dayIndex: day.index, start, end: timelineKnown ? at(cursor) : null, stops }
    })
}

/** A commitment is usable only when the final terminal and its buffer are evidenced. */
export function buildDepartureAdviceFacts(
  trip: Trip,
  days: AdviceDayFacts[] | undefined = undefined,
  legCorrections?: Record<string, LegEstimate>,
): DepartureAdviceFact[] {
  // `days` defaults to the facts for this same correction snapshot, so a caller
  // that passes only corrections still gets a consistent day/terminal pair.
  const dayFacts = days ?? buildAdviceFacts(trip, legCorrections)
  const flightCandidates: DepartureCandidate[] = (trip.flights ?? []).map(flight => ({
    dayIndex: flight.dayIndex,
    type: 'flight-departure',
    source: 'flight-leg',
    title: `Flight from ${flight.fromAirport}`,
    time: flight.departAt ?? null,
    airportIata: flight.fromAirport,
  }))
  const commitmentCandidates = trip.fixedCommitments
    .filter((commitment): commitment is DepartureCommitment =>
      commitment.type === 'flight-departure' || commitment.type === 'train-departure')
    .map((commitment): DepartureCandidate => ({
      dayIndex: commitment.dayIndex,
      type: commitment.type,
      source: 'fixed-commitment',
      title: commitment.title,
      time: commitment.time,
      terminalStopId: commitment.stopId ?? null,
    }))
  const candidates = [...flightCandidates, ...commitmentCandidates]
    .sort((a, b) => a.dayIndex - b.dayIndex || (a.time ?? '99:99').localeCompare(b.time ?? '99:99'))
  const seen = new Set<string>()
  return candidates.filter(candidate => {
    const key = `${candidate.dayIndex}|${candidate.type}|${candidate.time ?? 'unknown'}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map(candidate => {
      const day = dayFacts.find(fact => fact.dayIndex === candidate.dayIndex)
      const terminal = day?.stops.find(stop => candidate.source === 'flight-leg'
        ? stop.title.startsWith(`${candidate.airportIata} ·`)
        : stop.id === candidate.terminalStopId) ?? null
      const finalStop = day?.stops[day.stops.length - 1]
      const bufferMinutes = candidate.type === 'flight-departure' ? AIRPORT_CHECKIN_MIN : null
      let reason: string | null = null
      const departureAt = candidate.time === null
        ? null
        : `${shiftIsoDate(trip.startDate, candidate.dayIndex)} ${candidate.time}`
      if (!departureAt || !Number.isFinite(utcMinute(departureAt))) {
        reason = 'The commitment date or time is missing, so it cannot be compared with the schedule.'
      } else if (!day?.start || !Number.isFinite(utcMinute(day.start))) {
        reason = 'The scheduled start date or time is unknown.'
      } else if (utcMinute(departureAt) < utcMinute(day.start)) {
        reason = 'The commitment clock is before the scheduled start. Its date does not show whether it is the following morning.'
      } else if (!terminal || (candidate.source === 'fixed-commitment' && finalStop?.id !== terminal.id)) {
        reason = 'No scheduled terminal transfer is recorded, so reachability is unknown.'
      } else if (candidate.source === 'fixed-commitment' && terminal.category !== 'transport-hub') {
        reason = 'The linked final stop is not identified as an airport or station.'
      } else {
        const terminalIndex = day?.stops.findIndex(stop => stop.id === terminal.id) ?? -1
        const precedingStops = terminalIndex < 0 ? [] : day?.stops.slice(0, terminalIndex + 1) ?? []
        if (precedingStops.some(stop => stop.transferMinutes === null || stop.visitMinutes === null || stop.arrival === null || stop.departure === null)) {
          reason = 'A transfer leg or visit duration is missing, so the scheduled arrival may be incomplete.'
        } else if (bufferMinutes === null) {
          reason = 'No station buffer is recorded.'
        }
      }
      return {
        dayIndex: candidate.dayIndex,
        type: candidate.type,
        source: candidate.source,
        title: candidate.title,
        time: candidate.time,
        departureAt,
        terminal,
        bufferMinutes,
        status: reason === null ? 'supported' : 'unknown',
        reason,
      }
    })
}

function shiftIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(value.getTime())) return 'unknown-date'
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function exposureEvidence(stop: ItineraryStop): AdviceExposure {
  const exposure: unknown = stop.exposure
  if (exposure === 'indoor' || exposure === 'outdoor') return exposure
  return stop.weatherSensitive === true ? 'outdoor' : 'unknown'
}

function utcMinute(value: string): number {
  return Date.parse(`${value.replace(' ', 'T')}:00Z`) / 60_000
}

function daySim(trip: Trip, i: number) {
  return simulateDay(trip.days[i], trip, originOf(trip, i), i)
}

function busiestDay(trip: Trip): { index: number; travelMin: number; stops: number; endsAt: string } {
  let worst = { index: 0, travelMin: 0, stops: 0, endsAt: '00:00' }
  trip.days.forEach((_, i) => {
    const sim = daySim(trip, i)
    if (sim.totalTravelMinutes > worst.travelMin) {
      worst = { index: i, travelMin: sim.totalTravelMinutes, stops: sim.activeStops.length, endsAt: sim.endsAt }
    }
  })
  return worst
}

function cheapestRemovableStop(trip: Trip): { stop: ItineraryStop; saving: number } | null {
  let best: { stop: ItineraryStop; saving: number } | null = null
  const perKm = getAssumptions(trip).inrPerKm ?? 8
  for (const day of trip.days) {
    // the same per-stop transport figure the budget counts (#573): the stated
    // cost of the leg INTO the stop when the row holds one, else that leg's
    // per-km estimate
    const rows = scheduleRowsById(simulateDay(day, trip, originOf(trip, day.index), day.index))
    for (const s of day.stops) {
      if (s.priority === 'must-do' || s.status === 'rejected') continue
      const stated = s.transportCostInrTotal
      const legEstimate = rows.get(s.id)?.legIn?.distanceKm ?? 0
      // rough saving: entry fees for the group + the transport the budget counts
      const saving = s.entryFeeInrPerPerson * trip.travellers + legCostInr(stated, legEstimate, perKm)
      if (!best || saving > best.saving) best = { stop: s, saving }
    }
  }
  return best
}

export function quickPrompts(): string[] {
  return [
    'Make Day 2 less tiring',
    'Can we reach the airport by 5 PM if we add this stop?',
    'Suggest a cheaper alternative',
    'Give us three options if it rains',
    'Create a family-friendly version',
    'What should we remove if we are travelling with children?',
    'Compare a relaxed itinerary with a packed itinerary',
    'Identify the biggest risks in this plan',
    'Create a backup plan for a transport delay',
    'Turn this itinerary into a YouTube description',
  ]
}

export function answerQuestion(
  trip: Trip,
  question: string,
  legCorrections?: Record<string, LegEstimate>,
): AiReply {
  const q = question.toLowerCase()
  const has = (...words: string[]) => words.some((w) => q.includes(w))

  return answerForIntent(trip, routeIntent(q, has), question, legCorrections)
}

/** Map one classified intent to its handler. Exported for the Jev path — a
 *  classifier picks the capability, the same local handlers compute the answer,
 *  so both routers share one body of trip analysis and can never drift apart.
 *
 *  `legCorrections` is the workspace's measured road snapshot. Every handler that
 *  reads scheduled clocks receives it, so a Jev answer, an offline answer and the
 *  remote context describe the same schedule. */
export function answerForIntent(
  trip: Trip,
  intent: CompanionIntent,
  question: string,
  legCorrections?: Record<string, LegEstimate>,
): AiReply {
  const totals = totals_of(trip)
  switch (intent) {
    case 'compare': return compareRelaxedPacked(trip)
    case 'rain': return rainPlan(trip)
    case 'airport': return airportFeasibility(trip, legCorrections)
    case 'youtube': return youtubeDescription(trip)
    case 'cheaper': return cheaperAlternative(trip)
    case 'family': return familyVersion(trip)
    case 'kids': return removeForKids(trip)
    case 'cost': return costSummary(trip, totals)
    case 'tiring': return makeLessTiring(trip)
    case 'risks': return biggestRisks(trip)
    case 'delay': return delayBackup(trip)
    case 'summary': return planSummary(trip, totals)
    case INTENT_NONE: return generalAnswer(trip, totals, question)
    default: return generalAnswer(trip, totals, question)
  }
}

function routeIntent(q: string, has: (...words: string[]) => boolean): CompanionIntent {
  // Route to the most relevant handler.
  //
  // ORDER IS LOAD-BEARING. This is a first-match chain, so an earlier rule always
  // wins and a keyword that appears in ordinary speech will steal unrelated
  // questions. Two rules caused most of the theft and both were repaired here:
  //
  //   * planSummary matched the bare word "plan" — the most common noun in a trip
  //     planner. "wet weather plan", "problems with this plan", "plan B?" and
  //     "longer than planned" all came back as a plan recap instead of rain,
  //     risks, rain and delay. The word is gone; summary now matches only
  //     genuinely summarizing language.
  //   * cheaperAlternative sat below costSummary, so "over budget, what can we
  //     trim?" and "bring the cost down" reported current spend rather than
  //     proposing savings. Cheaper now precedes cost, and its reduction verbs are
  //     scoped to money nouns so "reduce the driving on day 4" stays a tiring
  //     question.
  //
  // Distinctive intents (rain, a flight, promotional copy) are tested before fuzzy
  // ones (a day being too much, what could go wrong). scripts/jev-router-corpus.ts
  // + scripts/jev-router-audit.test.ts measure this against 212 authored phrasings; the
  // residual collisions are listed in that run's output, not hidden.

  if (
    (has('relax') && has('pack')) ||
    has('compare', 'slower', 'faster and', 'lighter', 'heavier', 'trade off', 'more or less', 'difference between') ||
    (has('packed') && has('see more')) ||
    (has('fewer stops') && has('or more'))
  ) return 'compare'

  // Word-boundary match so the substring "rain" inside "train" does not mis-route
  // train questions to the rain plan. Extended to conjugations and to "rain" + ed
  // while still rejecting false positives like "rainbow" or "rainforest"; test t12
  // and tests/ai-routing.test.ts pin both directions.
  if (/\brain(s|ing|y|ed)?\b/.test(q) || has('monsoon', 'wet weather', 'poor weather', 'weather turns', 'washed out', 'forecast', 'drizzle', 'pours', 'wet day', 'indoor alternative')) return 'rain'

  // The handler checks saved flight/train departures, so match those words — not
  // just the word "airport" (issue: "catch a 6am flight" used to fall through).
  if (has('airport', 'flight', 'departure', 'station') || (has('catch', 'make') && has('train')) || (q.includes('reach') && has('pm', 'on time'))) return 'airport'

  if (has('youtube', 'description', 'instagram', 'caption', 'reel', 'blog', 'vlog', 'social media', 'promo', 'seo', 'publish')) return 'youtube'

  // Money to SPEND LESS, before money AS IT STANDS and before family — "cheaper
  // family options" is a budget ask, not a family recast. The reduction verbs are
  // gated on a money noun so "reduce the driving on day 4" stays a tiring question.
  // "cheap" covers cheaper/cheapest; /\blean/ keeps "clean" out of it.
  if (
    has('cheap', 'cut corners', 'cut the bill', 'spend less', 'pay less', 'over budget', 'money is tight', 'budget is tight', 'our pocket', 'beyond our pocket') ||
    /\bsavings\b/.test(q) ||
    (/\b(save|saving)\b/.test(q) && has('money', 'cost', 'bill', 'spend', 'price', 'fee', 'fuel', 'budget')) ||
    /\blean(er)?\b/.test(q) ||
    (has('reduce', 'lower', 'cut') && has('cost', 'bill', 'spend', 'price', 'fee', 'fuel', 'budget')) ||
    (has('bring') && has('down'))
  ) return 'cheaper'

  if (has('family', 'in-law', 'grandparent', 'baby', 'generation', 'young one', 'older folk', 'softer', 'kid friendly', 'kid-friendly')) return 'family'
  if (
    /\b(children|kids?|child|toddlers?|year old)\b/.test(q) &&
    /\b(remove|drop|cut|skip|unsuitable|not good|not child friendly|too much|too long|bore|bored)\b/.test(q)
  ) return 'kids'

  const asksEstimateAccuracy = /\b(costs?|prices?|times?|estimates?)\b/.test(q) && /\b(real|accurate|reliable|trust)\b/.test(q)
  if (!asksEstimateAccuracy && has('cost', 'budget', 'expense', 'spend', 'total', 'per person', 'per head', 'how much', 'breakdown', 'afford', 'add up', 'money split', '₹')) return 'cost'

  // Tiring last of the "distinctive" group: its vocabulary overlaps money and
  // family phrasing, so it is tested after both have had their chance.
  if (
    has('tiring', 'relax', 'ease off', 'take it easy', 'exhaust', 'rushed', 'overstuffed', 'brutal', 'too many stops', 'fewer stops', 'too much walking', 'too much', 'lighten', 'lighter', 'gentler', 'simplify', 'slow', 'reduce the driving', 'cut down', 'trim day', 'dead by', 'back and forth', 'tone it down', 'too packed') ||
    (/\bpacked\b/.test(q) && /\b(drop|remove|cut|skip)\b/.test(q))
  ) return 'tiring'

  // "get stuck" is a risk question unless it is about traffic, which is a delay
  // question; the two share the word, so the traffic half is carved out here.
  if (has('risk', 'worry', 'go wrong', 'goes wrong', 'weak point', 'danger', 'red flag', 'cautious', 'trouble', 'derail', 'overambitious', 'safe', 'problem') || (has('stuck') && !has('traffic'))) return 'risks'

  // "backup" stays here but is safe: rain is tested far above, so "monsoon backup
  // plan" and "backup for a washed out day" reach the rain plan, not this one.
  // /\blate\b/ rather than a substring so "Translate this into Malayalam" is not a
  // delay question.
  if (has('delay', 'backup', 'traffic', 'stuck', 'breakdown', 'contingency', 'fallback', 'lose two hours', 'longer than plan') || /\blate\b/.test(q)) return 'delay'

  // Summary last, and deliberately narrow: no bare "plan".
  if (has('summary', 'summarise', 'summarize', 'overview', 'recap', 'high level', 'overall', 'brief me', 'run me through', 'walk me through', 'tell me about', 'shape of this trip')) return 'summary'

  return INTENT_NONE
}

function footer(): string {
  return `\n\nAssumptions: ${DISCLAIMER}`
}

function makeLessTiring(trip: Trip): AiReply {
  const busy = busiestDay(trip)
  const sim = daySim(trip, busy.index)
  const droppable = sim.activeStops.filter(s => s.priority !== 'must-do')
  const lines: string[] = []
  lines.push(`Day ${busy.index + 1} is your heaviest: ~${minutesToHM(busy.travelMin)} of travel across ${sim.activeStops.length} stops, finishing near ${sim.endsAt}.`)
  if (droppable.length) {
    const d = droppable[droppable.length - 1]
    lines.push(`\nTo lighten it:`)
    lines.push(`1. Move “${d.title}” (${d.locationName}) to another day — saves its visit + transit time.`)
    lines.push(`2. Start the day 30–45 min earlier so stops aren't rushed.`)
    lines.push(`3. Shorten optional photo/shopping halts by 15 min each.`)
  } else {
    lines.push(`Every stop is marked must-do; consider extending the trip by a day instead.`)
  }
  return { text: lines.join('\n'), assumptions: DISCLAIMER }
}

function airportFeasibility(trip: Trip, legCorrections?: Record<string, LegEstimate>): AiReply {
  const dayFacts = buildAdviceFacts(trip, legCorrections)
  const [departure] = buildDepartureAdviceFacts(trip, dayFacts, legCorrections)
  if (!departure) {
    return { text: `There are no flight/train departure commitments saved on this trip yet. Add one under Overview → Fixed commitments and I'll check reachability with current timings.${footer()}` }
  }
  const terminal = departure.terminal
  if (departure.status === 'unknown' || !terminal || !departure.time || !departure.departureAt
    || departure.bufferMinutes === null || terminal.arrival === null || terminal.departure === null) {
    const scheduled = terminal
      ? ` The schedule reaches the linked stop at ${terminal.arrival ?? 'an unknown time'} and leaves it at ${terminal.departure ?? 'an unknown time'}.`
      : ''
    return {
      text: `I can't confirm whether Day ${departure.dayIndex + 1} can reach “${departure.title}” by ${departure.time}.${scheduled} ${departure.reason ?? 'Terminal evidence is incomplete.'}${footer()}`,
      assumptions: terminal?.transferMinutes !== null && terminal?.transferMinutes !== undefined
        ? `The transfer into the linked stop is estimated at ${terminal.transferMinutes} min from ${terminal.transferFrom ?? 'an unknown origin'}. ${departure.bufferMinutes === null ? 'The terminal buffer is unknown.' : `The airport check-in buffer is ${departure.bufferMinutes} min.`} ${DISCLAIMER}`
        : `Transfer evidence is incomplete. ${DISCLAIMER}`,
    }
  }
  const latestDeparture = utcMinute(departure.departureAt) - departure.bufferMinutes
  const scheduledTerminalTime = departure.source === 'flight-leg' ? terminal.arrival : terminal.departure
  const slackMin = latestDeparture - utcMinute(scheduledTerminalTime)
  const ok = slackMin >= 0
  return {
    text: ok
      ? `Yes, workable. The scheduled transfer reaches “${terminal.title}” at ${terminal.arrival} and leaves at ${terminal.departure}. That leaves ${Math.floor(slackMin)} min before the airport check-in buffer for your ${departure.time} flight (“${departure.title}”).`
      : `Risky. The current Day ${departure.dayIndex + 1} schedule reaches “${terminal.title}” at ${terminal.arrival} and leaves at ${terminal.departure}, ${Math.abs(Math.floor(slackMin))} min after the latest departure that preserves the airport check-in buffer.`,
    assumptions: `Transfer from ${terminal.transferFrom} to the linked airport stop is estimated at ${terminal.transferMinutes} min. The schedule includes stop visit time and per-stop buffer; airport check-in buffer is ${departure.bufferMinutes} min. ${DISCLAIMER}`,
  }
}

function cheaperAlternative(trip: Trip): AiReply {
  const cand = cheapestRemovableStop(trip)
  const A = getAssumptions(trip)
  const lines: string[] = []
  lines.push(`Current estimated total: ${formatInr(totals_of(trip).totalCostInr)} (${formatInr(totals_of(trip).costPerPersonInr)}/person).`)
  lines.push(`\nBiggest levers:`)
  lines.push(`• Transport is priced at ~₹${A.inrPerKm}/km for ${A.mode}. Shifting some legs to bus/local ferry typically cuts that by half or more.`)
  if (cand) lines.push(`• “${cand.stop.title}” is marked ${cand.stop.priority} — dropping it saves roughly ${formatInr(cand.saving)}.`)
  lines.push(`• Swap one paid attraction for a free viewpoint/beach stop; Kerala's coastline gives you several.`)
  return { text: lines.join('\n'), assumptions: DISCLAIMER }
}

function rainPlan(trip: Trip): AiReply {
  const stops = buildAdviceFacts(trip).flatMap(day => day.stops
    .filter(stop => !stop.auto)
    .map(stop => ({ ...stop, label: `Day ${day.dayIndex + 1}: ${stop.title}` })))
  const outdoor = stops.filter(stop => stop.exposure === 'outdoor').map(stop => stop.label)
  const indoor = stops.filter(stop => stop.exposure === 'indoor').map(stop => `${stop.title} (${stop.category})`)
  const unknown = stops.filter(stop => stop.exposure === 'unknown').map(stop => stop.label)
  const lines = [`Three rain options:\n`]
  lines.push(`Option A — Shuffle: swap outdoor stops (${outdoor.slice(0, 2).join(', ') || 'none verified'}) with indoor ones later in the trip.`)
  lines.push(`Option B — Indoor day: build the day around museums, spas, cafes & shopping; keep drive time similar.`)
  lines.push(`Option C — Push through: keep the plan but add 30–40 min buffer per outdoor stop for wet roads.`)
  if (outdoor.length) lines.push(`\nWeather-sensitive stops flagged: ${outdoor.join('; ')}.`)
  if (indoor.length) lines.push(`\nVerified indoor stops: ${indoor.join('; ')}.`)
  if (unknown.length) lines.push(`\nExposure is unknown for: ${unknown.join('; ')}. Check these stops before relying on an indoor alternative.`)
  return { text: lines.join('\n'), assumptions: `A true weather-sensitive flag is outdoor evidence. A false or missing flag is not indoor evidence. ${DISCLAIMER}` }
}

function familyVersion(trip: Trip): AiReply {
  const longDays = trip.days.map((_, i) => ({ i, sim: daySim(trip, i) })).filter(x => x.sim.totalTravelMinutes > 180)
  const lines = [`A family-friendlier version would:`]
  lines.push(`1. Cap each day at 4 activities and ~3h of total driving.`)
  lines.push(`2. Add a mid-day rest/pool break between 1–3 PM.`)
  lines.push(`3. Keep two anchor attractions per day max; everything else becomes optional.`)
  if (longDays.length) lines.push(`\nStart by easing Day ${longDays.map(x => x.i + 1).join(', ')} — currently ${longDays.map(x => minutesToHM(x.sim.totalTravelMinutes)).join(', ')} of transit.`)
  return { text: lines.join('\n'), assumptions: DISCLAIMER }
}

function removeForKids(trip: Trip): AiReply {
  const candidates = trip.days.flatMap(d =>
    d.stops.filter(s => s.status !== 'rejected' && (s.visitMinutes > 150 || s.category === 'adventure'))
      .map(s => `“${s.title}” (Day ${d.index + 1}, ${minutesToHM(s.visitMinutes)}, ${s.category})`),
  )
  const lines = [`With children along, first consider removing:`]
  if (candidates.length) candidates.forEach((c, i) => lines.push(`${i + 1}. ${c}`))
  else lines.push(`Nothing looks child-unfriendly based on durations and categories — nice!`)
  lines.push(`\nAlso replace any late-evening stops (after 8 PM) with early dinners.`)
  return { text: lines.join('\n'), assumptions: DISCLAIMER }
}

function compareRelaxedPacked(trip: Trip): AiReply {
  const curStopsPerDay = trip.days.map(d => d.stops.filter(s => s.status !== 'rejected').length)
  // Guard a dayless trip — Math.min()/Math.max() on an empty spread are
  // ±Infinity, which would print "~∞/day".
  if (curStopsPerDay.length === 0) {
    return { text: 'Your itinerary has no days yet — add at least one day to compare a relaxed vs packed version.', assumptions: DISCLAIMER }
  }
  const relaxedCount = Math.max(1, Math.round(Math.min(...curStopsPerDay) * 0.8))
  const packedCount = Math.max(...curStopsPerDay) + 2
  const lines = [
    `Current plan: ${curStopsPerDay.join(' → ')} stops/day.`,
    ``,
    `Relaxed version (~${relaxedCount}/day):`,
    `• Travel drops noticeably; you finish days by ~6 PM.`,
    `• Estimated cost falls ~10–18% (fewer paid entries + less fuel).`,
    ``,
    `Packed version (~${packedCount}/day):`,
    `• Adds sunrise starts and 2 extra stops/day.`,
    `• Estimated cost rises ~12–20%; health score will likely drop to Tight.`,
    `• Only realistic if visit durations are shortened.`,
  ]
  return { text: lines.join('\n'), assumptions: DISCLAIMER }
}

function biggestRisks(trip: Trip): AiReply {
  const warnings = collectWarnings(trip)
  const high = warnings.filter(w => w.severity === 'high')
  const med = warnings.filter(w => w.severity === 'medium')
  const lines: string[] = []
  if (!warnings.length) {
    lines.push(`No schedule risks detected — the plan has healthy buffers. Watch weather during monsoon months regardless.`)
  } else {
    lines.push(`Top risks right now:`)
    high.concat(med).slice(0, 4).forEach((w, i) => lines.push(`${i + 1}. ${w.title} — ${w.detail} Fix: ${w.fix}`))
    if (high.length === 0 && med.length < 4) {
      lines.push(`\nAlso keep an eye on: monsoon-season outdoor stops and single-lane ghat sections on hill routes.`)
    }
  }
  return { text: lines.join('\n'), assumptions: DISCLAIMER }
}

function delayBackup(trip: Trip): AiReply {
  const busy = busiestDay(trip)
  const sim = daySim(trip, busy.index)
  const last = sim.activeStops[sim.activeStops.length - 1]
  const lines = [
    `Backup plan if you're delayed 60–90 min (most likely on Day ${busy.index + 1}, your longest travel day):`,
    `1. Pre-identify the 2 lowest-priority stops today — skip them without discussion.`,
    `2. If “${last?.title ?? 'the final stop'}” can't fit, move it to tomorrow morning; its opening hours matter more than its order.`,
    `3. Shift dinner reservation 45 min later as buffer.`,
    `4. If a fixed commitment (train/flight) is at risk, leave immediately from the previous stop rather than adding one more halt.`,
  ]
  return { text: lines.join('\n'), assumptions: DISCLAIMER }
}

function youtubeDescription(trip: Trip): AiReply {
  const places = trip.destinations.join(' → ')
  const highlights = trip.days.map(d => {
    const top = [...d.stops].filter(s => s.status !== 'rejected').sort((a, b) => b.entryFeeInrPerPerson - a.entryFeeInrPerPerson)[0]
    return `Day ${d.index + 1}${d.title ? ` — ${d.title}` : ''}: ${(top?.title ?? 'scenic drive')} & more`
  })
  const text = `${trip.name} | ${places} 🌴

${trip.days.length} days • ${trip.travellers} travellers • ${trip.travelStyle} style • Est ₹${Math.round(totals_of(trip).costPerPersonInr).toLocaleString('en-IN')}/person

Join us as we explore ${places}! In this vlog we cover:
${highlights.map(h => '👉 ' + h).join('\n')}

Timestamps coming soon!
#india #travelvlog #${trip.destinations[0]?.toLowerCase().replace(/\s+/g, '') ?? 'kerala'} #roadtrip`
  return { text, assumptions: `Draft generated from your itinerary data. Review details before publishing. ${DISCLAIMER}` }
}

function costSummary(trip: Trip, totals: ReturnType<typeof computeTotals>): AiReply {
  const cats = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1])
  const lines = [`Estimated total ${formatInr(totals.totalCostInr)} · ${formatInr(totals.costPerPersonInr)}/person · ${formatInr(totals.costPerDayInr)}/day.`, ``]
  lines.push(`Where it goes:`)
  cats.forEach(([c, v]) => lines.push(`• ${c}: ${formatInr(v)}`))
  lines.push(``, `Essential: ${formatInr(totals.essentialInr)} · Optional: ${formatInr(totals.optionalInr)}`)
  return { text: lines.join('\n'), assumptions: DISCLAIMER }
}

function planSummary(trip: Trip, totals: ReturnType<typeof computeTotals>): AiReply {
  const lines = [`${trip.name}: ${trip.startLocation} → ${trip.destinations.join(' → ')}`, ``]
  lines.push(`• ${trip.days.length} days, ${totals.stopCount} active stops, ${trip.travellers} travellers.`)
  lines.push(`• ~${minutesToHM(totals.totalTravelMinutes)} total travel over ~${Math.round(totals.totalDistanceKm)} km.`)
  lines.push(`• Estimated ${formatInr(totals.totalCostInr)} total (${formatInr(totals.costPerPersonInr)}/person).`)
  lines.push(`• ${countHotelNights(trip)} distinct overnight bases.`)
  const w = collectWarnings(trip)
  lines.push(`• Health: ${scoreBand(w)} with ${w.length} note(s).`)
  lines.push(``, `Ask me to compare relaxed vs packed, find risks, or draft a YouTube description.`)
  return { text: lines.join('\n'), assumptions: DISCLAIMER }
}

function generalAnswer(trip: Trip, totals: ReturnType<typeof computeTotals>, question: string): AiReply {
  const lines = [`Here's what I can see in “${trip.name}”:`, ``]
  lines.push(`• ${trip.days.length}-day plan, ${totals.stopCount} stops, est. ${formatInr(totals.costPerPersonInr)}/person.`)
  lines.push(`• Try asking me to: make a day less tiring, check airport timing, find a cheaper alternative, plan for rain, compare relaxed vs packed, list risks, or write a YouTube description.`)
  lines.push(`(You asked: “${question}”)`)
  return { text: lines.join('\n'), assumptions: DISCLAIMER }
}

function scoreBand(warnings: { severity: string }[]): string {
  let s = 100
  warnings.forEach(w => { s -= w.severity === 'high' ? 11 : w.severity === 'medium' ? 7 : 3 })
  s = Math.max(5, s)
  return s >= 85 ? 'Comfortable' : s >= 70 ? 'Manageable' : s >= 55 ? 'Tight' : 'Unrealistic'
}

// small helper to avoid recomputing repeatedly in one call
const totalsCache = new WeakMap<Trip, ReturnType<typeof computeTotals>>()
function totals_of(trip: Trip): ReturnType<typeof computeTotals> {
  let t = totalsCache.get(trip)
  if (!t) { t = computeTotals(trip); totalsCache.set(trip, t) }
  return t
}
