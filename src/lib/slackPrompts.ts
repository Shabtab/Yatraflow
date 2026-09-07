// ============ Slack prompts (Horizon 3.6) ============
// Pure, provider-agnostic. After any itinerary change the day's leftover slack
// (day window minus drive, dwell, planned halts and buffers) surfaces one
// nearby pick that fits: there-and-back detour plus a sensible visit length.
// Thin days stay quiet — the prompt only speaks at MIN_SLACK_MIN or more.
export const MIN_SLACK_MIN = 45

/** Leftover minutes inside the day window, floored at zero. */
export function daySlackMin(args: {
  dayEndMin: number
  startMin: number
  driveMin: number
  dwellMin: number
  planMin: number
  bufferMin: number
}): number {
  const { dayEndMin, startMin, driveMin, dwellMin, planMin, bufferMin } = args
  const parts = [dayEndMin, startMin, driveMin, dwellMin, planMin, bufferMin]
  if (parts.some(v => !Number.isFinite(v))) return 0
  return Math.max(0, Math.round(dayEndMin - startMin - driveMin - dwellMin - planMin - bufferMin))
}

/** Sensible visit length per category (tourist pacing, matches MapTab). */
export function visitMinutesForCategory(cat?: string): number {
  switch (cat) {
    case 'food': return 45
    case 'hotel': return 0
    case 'transport-hub': return 20
    case 'museum': case 'temple': case 'nature': case 'beach': return 90
    default: return 60
  }
}

export interface SlackCandidate {
  name: string
  detourMin: number
  category?: string
}

/** Round for human display ("~90 min"). */
function round5(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5)
}

/**
 * Closest candidate whose there-and-back detour plus visit fits the slack.
 * Garbage detours never fit; zero-detour on-route picks always do.
 */
export function pickSlackHit(slackMin: number, candidates: SlackCandidate[]): SlackCandidate | null {
  let best: SlackCandidate | null = null
  for (const c of candidates) {
    if (!Number.isFinite(c.detourMin) || c.detourMin < 0) continue
    const cost = c.detourMin * 2 + visitMinutesForCategory(c.category)
    if (cost > slackMin) continue
    if (!best || c.detourMin < (best.detourMin as number)) best = c
  }
  return best
}

/** Full prompt text, or null when the day is too full or nothing fits. */
export function slackPrompt(slackMin: number, dayLabel: string, candidates: SlackCandidate[]): string | null {
  if (!(slackMin >= MIN_SLACK_MIN)) return null
  const pick = pickSlackHit(slackMin, candidates)
  if (!pick) return null
  return `you have ~${round5(slackMin)} min slack in ${dayLabel} — ${pick.name} is ${round5(pick.detourMin)} min away`
}
