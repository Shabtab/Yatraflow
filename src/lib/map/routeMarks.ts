// Marks the Drive map draws on the route itself, from the plan's own schedule:
// a clock tick every few kilometres, the lunch window at its kilometre, and the
// words on a pick that lies past the detour scope. Pure, no React, no map.
import { formatHM, type TimeFormat } from '../timefmt'
import { clockHM } from '../clockOverlay'

/** One known point of the day: its km from the day's start, and its clocks. */
export interface TickAnchor {
  km: number
  arriveMin: number
  departMin: number
}

export interface ClockTick {
  /** Kilometres from the day's start. */
  km: number
  /** The planned clock at that kilometre, in minutes since midnight. */
  min: number
}

export interface ClockTickOptions {
  /** Kilometres between two ticks. */
  everyKm?: number
  /** A tick closer than this to a stop is dropped: the stop has its own chip. */
  clearKm?: number
  /** The most ticks one day draws. */
  max?: number
}

/**
 * Ticks along the road between stops. The clock at a kilometre is read off the
 * plan: it runs in a straight line from the clock you leave one stop to the
 * clock you reach the next. A leg with no time between its stops gives none.
 */
export function clockTicks(anchors: readonly TickAnchor[], options: ClockTickOptions = {}): ClockTick[] {
  const everyKm = options.everyKm ?? 20
  const clearKm = options.clearKm ?? 6
  const max = options.max ?? 6
  const usable = anchors
    .filter(anchor => Number.isFinite(anchor.km) && Number.isFinite(anchor.arriveMin) && Number.isFinite(anchor.departMin))
    .sort((a, b) => a.km - b.km)
  const ticks: ClockTick[] = []
  for (let i = 1; i < usable.length; i += 1) {
    const from = usable[i - 1]
    const to = usable[i]
    const span = to.km - from.km
    const minutes = to.arriveMin - from.departMin
    if (span <= 0 || minutes <= 0) continue
    for (let km = Math.ceil((from.km + clearKm) / everyKm) * everyKm; km <= to.km - clearKm; km += everyKm) {
      ticks.push({ km, min: Math.round(from.departMin + ((km - from.km) / span) * minutes) })
      if (ticks.length >= max) return ticks
    }
  }
  return ticks
}

/** "11:05" with "Km 21" on its own side: the board's clock tick, in the reader's clock. */
export function tickText(tick: ClockTick, format: TimeFormat): { clock: string; km: string } {
  return { clock: formatHM(clockHM(tick.min), format), km: `Km ${tick.km}` }
}

/** "Lunch · 11:30 AM–2:30 PM": the window's own name and hours. */
export function windowLabel(name: string, startMin: number, endMin: number, format: TimeFormat): string {
  return `${name} · ${formatHM(clockHM(startMin), format)}–${formatHM(clockHM(endMin), format)}`
}

/**
 * The words on a pick that sits past the scope. A pick just past the scope says
 * how far past. A pick over the day's budget says its detour and the budget.
 * A pick with no known detour gets no words.
 */
export function pickBandTag(
  band: 'just-past' | 'over-budget',
  detourMin: number | null | undefined,
  scopeMinutes: number,
): string | null {
  if (detourMin == null || !Number.isFinite(detourMin)) return null
  if (band === 'over-budget') return `+${Math.round(detourMin)} min · over budget`
  const past = Math.round(detourMin - scopeMinutes)
  return past > 0 ? `+${past} min past` : null
}

/** One mark the map draws on the route: a clock tick or a window label. */
export interface RouteMark {
  id: string
  kind: 'tick' | 'window'
  lat: number
  lng: number
  /** A tick's clock, or a window's name and hours. */
  label: string
  /** A tick's "Km 21". Absent on a window. */
  sub?: string
}
