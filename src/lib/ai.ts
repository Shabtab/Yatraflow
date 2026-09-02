// ============ AI travel companion ============
// Deterministic, trip-data-grounded assistant. No live data claims —
// every answer cites the assumptions it used.
import type { Trip, ItineraryStop } from '../data/types'
import {
  getAssumptions, simulateDay, computeTotals, originOf,
  minutesToHM, hmToMinutes, collectWarnings, formatInr, legBetween, countHotelNights,
} from './engine'

export interface AiReply {
  text: string
  assumptions?: string
}

const DISCLAIMER = 'Estimates use demo coordinates and fixed assumptions — not live traffic or prices.'

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
  for (const day of trip.days) {
    for (const s of day.stops) {
      if (s.priority === 'must-do' || s.status === 'rejected') continue
      // rough saving: entry fees for the group + the stop's own transport cost line
      const saving = s.entryFeeInrPerPerson * trip.travellers + s.transportCostInrTotal
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

export function answerQuestion(trip: Trip, question: string): AiReply {
  const q = question.toLowerCase()
  const totals = computeTotals(trip)

  // Route to the most relevant handler
  if (q.includes('less tiring') || q.includes('tiring') || q.includes('relax')) return makeLessTiring(trip)
  if (q.includes('airport') || (q.includes('reach') && q.includes('pm'))) return airportFeasibility(trip)
  // Explicit grouping (issue #15): without parens JS binds && tighter than ||,
  // making the rule fragile to read and easy to regress. Semantics are unchanged:
  // "cheaper" alone, or both "alternative" AND "cheap", route to cheaperAlternative.
  if (q.includes('cheaper') || (q.includes('alternative') && q.includes('cheap'))) return cheaperAlternative(trip)
  // Word-boundary match so the substring "rain" inside "train" does not
  // mis-route train questions to the rain plan. Extended to also match
  // common conjugations (rains, raining, rainy) while still rejecting
  // false positives like "rainbow" or "rainforest".
  if (/\brain([s]|ing|y)?\b/.test(q)) return rainPlan(trip)
  if (q.includes('family-friendly') || q.includes('family friendly')) return familyVersion(trip)
  if (q.includes('children') || q.includes('kids')) return removeForKids(trip)
  if (q.includes('relaxed') && q.includes('packed')) return compareRelaxedPacked(trip)
  if (q.includes('risk')) return biggestRisks(trip)
  if (q.includes('delay') || q.includes('backup')) return delayBackup(trip)
  if (q.includes('youtube') || q.includes('description')) return youtubeDescription(trip)
  if (q.includes('cost') || q.includes('budget') || q.includes('₹')) return costSummary(trip, totals)
  if (q.includes('summary') || q.includes('overview') || q.includes('plan')) return planSummary(trip, totals)

  return generalAnswer(trip, totals, question)
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

function airportFeasibility(trip: Trip): AiReply {
  const flights = trip.fixedCommitments.filter(c => c.type === 'flight-departure' || c.type === 'train-departure')
  if (!flights.length) {
    return { text: `There are no flight/train departure commitments saved on this trip yet. Add one under Overview → Fixed commitments and I'll check reachability with current timings.${footer()}` }
  }
  const fc = flights[0]
  const sim = daySim(trip, fc.dayIndex)
  if (!sim.activeStops.length) return { text: `Day ${fc.dayIndex + 1} is empty, so reaching "${fc.title}" by ${fc.time} is easy from your start point.` }
  const lastArr = sim.arrivalTimes[sim.arrivalTimes.length - 1]
  const lastStop = sim.activeStops[sim.activeStops.length - 1]
  const slackMin = hmToMinutes(fc.time) - hmToMinutes(lastArr)
  const ok = slackMin >= 60
  return {
    text: ok
      ? `Yes, workable. Your Day ${fc.dayIndex + 1} plan finishes at “${lastStop.title}” around ${lastArr}, leaving ~${Math.round(slackMin / 5) * 5} min before the ${fc.time} ${fc.type === 'flight-departure' ? 'flight' : 'train'} (“${fc.title}”). Keep the last stop within ~30 km of the airport to be safe.`
      : `Risky. The current Day ${fc.dayIndex + 1} plan only reaches “${lastStop.title}” around ${lastArr}, after your ${fc.time} commitment. Remove the last 1–2 stops or start 90 min earlier.`,
    assumptions: `Uses avg speed ${getAssumptions(trip).avgSpeedKmph} km/h and per-stop buffers. ${DISCLAIMER}`,
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
  const outdoor = trip.days.flatMap(d => d.stops.filter(s => s.weatherSensitive && s.status !== 'rejected').map(s => `Day ${d.index + 1}: ${s.title}`))
  const indoor = trip.days.flatMap(d => d.stops.filter(s => !s.weatherSensitive && s.status !== 'rejected').map(s => `${s.title} (${s.category})`))
  const lines = [`Three rain options:\n`]
  lines.push(`Option A — Shuffle: swap outdoor stops (${outdoor.slice(0, 2).join(', ') || 'none flagged'}) with indoor ones later in the trip.`)
  lines.push(`Option B — Indoor day: build the day around museums, spas, cafes & shopping; keep drive time similar.`)
  lines.push(`Option C — Push through: keep the plan but add 30–40 min buffer per outdoor stop for wet roads.`)
  if (outdoor.length) lines.push(`\nWeather-sensitive stops flagged: ${outdoor.join('; ')}.`)
  else if (indoor.length) lines.push(`\nNo stops are flagged weather-sensitive, so rain impact should be limited.`)
  return { text: lines.join('\n'), assumptions: `YatraFlow flags beach/viewpoint/trek stops as weather-sensitive. ${DISCLAIMER}` }
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
  const relaxedCount = Math.max(1, Math.round(Math.min(...curStopsPerDay) * 0.8))
  const packedCount = Math.max(...curStopsPerDay) + 2
  const t = totals_of(trip)
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
