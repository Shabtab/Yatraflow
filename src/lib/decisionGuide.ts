// ============ Grounded decision guidance (CTI §6.8) ============
// Deterministic, offline recommendations for trip decisions — grounded in the
// same engine data the Overview tab already shows, not a language model. M5's
// configurable LLM companion (still unbuilt, flag-gated) will layer a real
// assistant on top of this; until then this router keeps an honest "(offline)"
// answer available. Pure — node-testable.
import type { Trip, TripDecision } from '../data/types'
import { computeTotals, computeHealth, formatInr, minutesToHM } from './engine'

export interface DecisionContext {
  totals: ReturnType<typeof computeTotals>
  health: ReturnType<typeof computeHealth>
}

/** Snapshot the engine data a decision should be weighed against. */
export function decisionContext(trip: Trip): DecisionContext {
  return { totals: computeTotals(trip), health: computeHealth(trip) }
}

/** One-line "where the trip stands" summary for grounding a decision card. */
export function contextLine(ctx: DecisionContext): string {
  return `${minutesToHM(ctx.totals.totalTravelMinutes)} on the road · ${formatInr(ctx.totals.totalCostInr)} total · health ${ctx.health.score}/100 (${ctx.health.band})`
}

export interface GroundedRecommendation {
  optionId: string
  label: string
  reason: string
  basis: 'cost' | 'time' | 'tie'
}

/** Recommend the option with the smallest declared cost, then the least added
 *  time; when options declare no impact at all, lean with the current leading
 *  vote and say so; when the data can't support a verdict, return null rather
 *  than invent one. */
export function recommendForDecision(trip: Trip, d: TripDecision, ctx: DecisionContext): GroundedRecommendation | null {
  if (d.status !== 'open' || d.options.length === 0) return null
  const opts = d.options

  const costOpts = opts.filter(o => typeof o.costImpactInr === 'number')
  const timeOpts = opts.filter(o => typeof o.timeImpactMin === 'number')

  let pick = opts[0]
  let basis: GroundedRecommendation['basis'] = 'tie'

  if (costOpts.length >= 2) {
    const min = Math.min(...costOpts.map(o => o.costImpactInr as number))
    pick = costOpts.find(o => o.costImpactInr === min) as typeof pick
    basis = 'cost'
  } else if (timeOpts.length >= 2) {
    const min = Math.min(...timeOpts.map(o => o.timeImpactMin as number))
    pick = timeOpts.find(o => o.timeImpactMin === min) as typeof pick
    basis = 'time'
  } else {
    const tally = opts.map(o => Object.values(d.votesByUserId).filter(v => v === o.id).length)
    const max = Math.max(0, ...tally)
    if (max > 0) pick = opts[tally.indexOf(max)]
  }

  return { optionId: pick.id, label: pick.label, reason: buildReason(basis, pick, ctx), basis }
}

function signedInr(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatInr(Math.abs(n))}`
}

function signedMin(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${minutesToHM(Math.abs(n))}`
}

function buildReason(basis: GroundedRecommendation['basis'], pick: TripDecision['options'][number], ctx: DecisionContext): string {
  if (basis === 'cost') {
    return `${pick.label} keeps the most budget — ${signedInr(pick.costImpactInr ?? 0)} against a ${formatInr(ctx.totals.totalCostInr)} trip.`
  }
  if (basis === 'time') {
    return `${pick.label} adds the least driving time — ${signedMin(pick.timeImpactMin ?? 0)} against ${minutesToHM(ctx.totals.totalTravelMinutes)} on the road.`
  }
  return `${pick.label} — no cost or time impact was declared, so this just leans with the current votes.`
}
