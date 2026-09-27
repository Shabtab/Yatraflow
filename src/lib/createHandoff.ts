// ============ Create handoff - what the moment-after screen needs ============
// The create page already computed the figures the interstitial wants to speak
// about (road km, tank range, the crew the planner collected). Persisting them
// for the one hop is cheaper and more honest than recomputing - and the
// interstitial still works when this is missing (it reads the trip instead).
//
// Same defensive contract as createDraft: injectable store, never throws,
// anything unrecognised reads as null.

// The key was the literal `'***'` — a real localStorage key written outside this
// app's namespace, which is why a namespace-scoped "clear saved data" would have
// left it behind. Same shape as createDraft's `yf.createDraft.v1` now.
export const HANDOFF_KEY = 'yf.createHandoff.v1'

export interface HandoffCrew {
  name: string
  phone: string | null
}

import type { StarterBill } from './tripStarter'

export interface CreateHandoff {
  tripId: string
  tripName: string
  plannerName: string
  roadKm: number | null
  rangeKm: number | null
  days: number
  travellers: number
  crew: HandoffCrew[]
  /** The rough bill the ticket printed, carried over verbatim - every row and
   *  its formula - so the shared artifact and the moment-after screen cannot
   *  show a second, slightly different total. */
  bill: StarterBill | null
}

export type HandoffStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStore(): HandoffStore | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null
  } catch {
    return null
  }
}

export function stashHandoff(h: CreateHandoff, opts: { store?: HandoffStore | null } = {}): boolean {
  const store = opts.store === undefined ? defaultStore() : opts.store
  if (!store) return false
  try {
    store.setItem(HANDOFF_KEY, JSON.stringify(h))
    return true
  } catch {
    return false
  }
}

export function readHandoff(tripId: string, opts: { store?: HandoffStore | null } = {}): CreateHandoff | null {
  const store = opts.store === undefined ? defaultStore() : opts.store
  if (!store) return null
  try {
    const raw = store.getItem(HANDOFF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CreateHandoff>
    if (!parsed || parsed.tripId !== tripId) return null
    const crew = Array.isArray(parsed.crew)
      ? parsed.crew.filter(c => c && typeof c === 'object' && (typeof c.name === 'string' || typeof c.phone === 'string'))
        .map(c => ({ name: typeof c.name === 'string' ? c.name : '', phone: typeof c.phone === 'string' ? c.phone : null }))
      : []
    const rawBill = parsed.bill as Partial<StarterBill> | null | undefined
    const num = (v: unknown, fallback: number | null = null) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    const bill: StarterBill | null = rawBill && typeof rawBill === 'object'
      ? {
        days: num(rawBill.days, 0) as number,
        nights: num(rawBill.nights, 0) as number,
        roadKm: num(rawBill.roadKm),
        transportCost: num(rawBill.transportCost),
        transportFormula: str(rawBill.transportFormula),
        stayCost: num(rawBill.stayCost, 0) as number,
        stayFormula: str(rawBill.stayFormula),
        mealCost: num(rawBill.mealCost, 0) as number,
        mealFormula: str(rawBill.mealFormula),
        perHead: num(rawBill.perHead),
        rangeKm: num(rawBill.rangeKm),
      }
      : null
    return {
      tripId,
      tripName: typeof parsed.tripName === 'string' ? parsed.tripName : '',
      plannerName: typeof parsed.plannerName === 'string' ? parsed.plannerName : '',
      roadKm: typeof parsed.roadKm === 'number' && Number.isFinite(parsed.roadKm) ? parsed.roadKm : null,
      rangeKm: typeof parsed.rangeKm === 'number' && Number.isFinite(parsed.rangeKm) ? parsed.rangeKm : null,
      days: typeof parsed.days === 'number' && Number.isFinite(parsed.days) ? Math.max(0, Math.round(parsed.days)) : 0,
      travellers: typeof parsed.travellers === 'number' && Number.isFinite(parsed.travellers) ? Math.max(1, Math.round(parsed.travellers)) : 1,
      crew,
      bill,
    }
  } catch {
    return null
  }
}

/** Stamps the handoff with the bill that was just printed. Kept here so the
 *  two callers (the create page and its tests) cannot disagree about shape. */
export function billTotal(bill: StarterBill | null, travellers: number): number | null {
  if (!bill || bill.perHead == null) return null
  return Math.round(bill.perHead * Math.max(1, travellers))
}

export function clearHandoff(opts: { store?: HandoffStore | null } = {}): boolean {
  const store = opts.store === undefined ? defaultStore() : opts.store
  if (!store) return false
  try {
    store.removeItem(HANDOFF_KEY)
    return true
  } catch {
    return false
  }
}
