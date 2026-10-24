// ============ Budget benchmarks - the honest anchor ============
// The line under the budget dial that judges a number against reality:
// "our rough take for a 6-day Kerala run: INR 7,300-12,300 / head".
//
// HONESTY CONTRACT - where these numbers come from:
//   The band is NOT a market survey and never claims to be. It is this
//   product's own estimate for a nominal route in that region, computed by
//   the same `estimateTripStarter` that prints the trip's bill. Two inputs
//   are curated (which route stands in for the region, and its stop
//   coordinates - facts, not prices); every rupee figure comes from the
//   engine's shared rate tables. So the anchor can never disagree with the
//   bill it is anchoring - and when a rate changes, both move together.
//
// Pure module: no react/supabase imports, node-testable.

import { estimateTripStarter } from './tripStarter'
import { TEMPLATE_COORDS } from './tripTemplates'
import type { LatLngPoint, StayStyle } from '../data/types'

/** A region's stand-in route: real, drivable stops the engine already handles.
 *  `label` is what the UI says out loud; `days` is the run the band is priced
 *  over (overridden by the trip's own day count when that is known). */
export interface RegionBaseline {
  key: string
  label: string
  /** Matched against "City, State" destination strings, case-insensitive. */
  matches: readonly string[]
  start: string
  destinations: readonly string[]
  days: number
}

export const REGION_BASELINES: readonly RegionBaseline[] = [
  { key: 'kerala', label: 'Kerala', matches: ['kerala', 'kochi', 'munnar', 'alleppey', 'alappuzha', 'kozhikode', 'wayanad'], start: 'Kochi, Kerala', destinations: ['Munnar, Kerala', 'Alleppey, Kerala'], days: 6 },
  { key: 'rajasthan', label: 'Rajasthan', matches: ['rajasthan', 'jaipur', 'jodhpur', 'udaipur', 'jaisalmer', 'bikaner'], start: 'Jaipur, Rajasthan', destinations: ['Jodhpur, Rajasthan', 'Udaipur, Rajasthan'], days: 7 },
  { key: 'himachal', label: 'Himachal', matches: ['himachal', 'manali', 'shimla', 'kaza', 'spiti', 'kasol', 'dharamshala'], start: 'Manali, Himachal Pradesh', destinations: ['Kaza, Himachal Pradesh', 'Kasol, Himachal Pradesh'], days: 8 },
  { key: 'coast', label: 'the Konkan coast', matches: ['goa', 'panaji', 'palolem', 'gokarna', 'karnataka', 'mangalore', 'udupi'], start: 'Panaji, Goa', destinations: ['Palolem, Goa', 'Gokarna, Karnataka'], days: 4 },
  { key: 'mp', label: 'Madhya Pradesh', matches: ['madhya pradesh', 'bhopal', 'khajuraho', 'orchha', 'gwalior', 'indore', 'bandhavgarh', 'kanha'], start: 'Bhopal, Madhya Pradesh', destinations: ['Khajuraho, Madhya Pradesh', 'Orchha, Madhya Pradesh'], days: 6 },
  { key: 'ne', label: 'the North-East', matches: ['meghalaya', 'shillong', 'cherrapunji', 'sohra', 'assam', 'kaziranga', 'guwahati'], start: 'Guwahati, Assam', destinations: ['Shillong, Meghalaya', 'Kaziranga, Assam'], days: 6 },
  { key: 'tamilnadu', label: 'Tamil Nadu', matches: ['tamil nadu', 'chennai', 'madurai', 'kanyakumari', 'ooty', 'coimbatore', 'rameswaram'], start: 'Chennai, Tamil Nadu', destinations: ['Madurai, Tamil Nadu', 'Kanyakumari, Tamil Nadu'], days: 5 },
]

/** Which baseline a trip's destinations belong to, or null when we honestly
 *  have none (the UI then renders nothing rather than a generic filler line). */
export function regionFor(places: readonly string[]): RegionBaseline | null {
  const hay = places.join(' ').toLowerCase()
  if (!hay.trim()) return null
  for (const r of REGION_BASELINES) {
    if (r.matches.some(m => hay.includes(m))) return r
  }
  return null
}

/** Per-head for a region's stand-in route at a given bed tier - the same
 *  engine call the ticket makes, so the anchor and the bill cannot drift. */
/** Baseline routes need coordinates too - facts about cities, kept here
 *  rather than polluting the template registry's own map. */
export const BASELINE_COORDS: Record<string, { lat: number; lng: number }> = {
  'Guwahati, Assam': { lat: 26.1445, lng: 91.7362 },
  'Shillong, Meghalaya': { lat: 25.5788, lng: 91.8933 },
  'Kaziranga, Assam': { lat: 26.5775, lng: 93.1711 },
  'Chennai, Tamil Nadu': { lat: 13.0827, lng: 80.2707 },
  'Madurai, Tamil Nadu': { lat: 9.9252, lng: 78.1198 },
  'Kanyakumari, Tamil Nadu': { lat: 8.0883, lng: 77.5385 },
  'Bhopal, Madhya Pradesh': { lat: 23.2599, lng: 77.4126 },
  'Khajuraho, Madhya Pradesh': { lat: 24.8528, lng: 79.9194 },
  'Orchha, Madhya Pradesh': { lat: 25.3516, lng: 78.3894 },
}

/** One lookup for any place a baseline names. */
export function baselineCoords(name: string): { lat: number; lng: number } | null {
  return TEMPLATE_COORDS[name] ?? BASELINE_COORDS[name] ?? null
}

function regionHeadAt(r: RegionBaseline, days: number, stayStyle: StayStyle, crew = 4): number {
  const pts: (LatLngPoint | null)[] = [
    baselineCoords(r.start),
    ...r.destinations.map(d => baselineCoords(d)),
  ]
  const start = '2026-02-14'
  const end = isoAdd(start, Math.max(1, days) - 1)
  const bill = estimateTripStarter({
    startDate: start, endDate: end,
    travellers: crew, mode: 'car',
    orderedPoints: pts, returnCount: 0, roundTrip: true,
    stayStyle,
  })
  if (bill.perHead == null) return 0
  return Math.round(bill.perHead / 100) * 100
}

/** The band a typical party actually spends on this region's run: budget beds
 *  at the bottom, comfort beds at the top - the two tiers most travellers
 *  choose between. Both ends computed. */
export function regionBand(r: RegionBaseline, days?: number): { low: number; high: number; days: number; label: string } {
  const d = Math.min(14, Math.max(2, Math.round(days ?? r.days)))
  const low = regionHeadAt(r, d, 'budget')
  const high = Math.max(low, regionHeadAt(r, d, 'comfort'))
  return { low, high, days: d, label: r.label }
}

/** The P2.2 fallback: when the trip's region is unknown, the anchor is still
 *  available - the mean of every region's band, labeled honestly as a national
 *  rough take rather than pretending to know the region. */
export function nationalBand(days?: number): { low: number; high: number; days: number; label: string } {
  const d = Math.min(14, Math.max(2, Math.round(days ?? 6)))
  const bands = REGION_BASELINES.map(r => regionBand(r, d))
  const mean = (pick: 'low' | 'high') => Math.round((bands.reduce((a, b) => a + b[pick], 0) / bands.length) / 100) * 100
  return { low: mean('low'), high: Math.max(mean('high'), mean('low')), days: d, label: 'India' }
}

/** What a per-head number actually buys, tied to the bed tier and mode the
 *  engine really prices - never to amenities the product cannot promise. */
export interface ExperienceTier {
  /** Inclusive lower bound in INR per head. */
  from: number
  label: string
  blurb: string
}

export const EXPERIENCE_TIERS: readonly ExperienceTier[] = [
  { from: 0, label: 'shoestring', blurb: 'dorm beds and budget rooms, buses or shared cabs, local food' },
  { from: 6000, label: 'budget', blurb: 'private budget rooms, a self-drive car, mostly local restaurants' },
  { from: 11000, label: 'comfort', blurb: 'comfort rooms, your own transport, a mix of local and proper restaurants' },
  { from: 20000, label: 'premium', blurb: 'good hotels, your own transport, meals without watching the menu' },
  { from: 32000, label: 'heritage', blurb: 'heritage and boutique stays, chauffeur-driven if you want it' },
]

/** The tier a per-head figure falls in. Never returns null: a zero budget is
 *  honestly 'shoestring', which is what the engine would price too. */
export function experienceTier(perHeadInr: number): ExperienceTier {
  const v = Number.isFinite(perHeadInr) ? Math.max(0, perHeadInr) : 0
  let tier = EXPERIENCE_TIERS[0]
  for (const t of EXPERIENCE_TIERS) if (v >= t.from) tier = t
  return tier
}

/** Where the user's own number sits against the region's band - the sentence
 *  the anchor line renders. Plain language, no judgement, no upsell. */
export function anchorNote(perHeadInr: number, band: { low: number; high: number }): string {
  if (!Number.isFinite(perHeadInr) || perHeadInr <= 0) return 'no per-head target yet - the bill prices the plan as it stands'
  if (perHeadInr < band.low) return "you're below that band - the bed tier is where it shows"
  if (perHeadInr > band.high) return "you're above that band - the extra buys the bed and the table"
  return "you're inside that band"
}

function inr(v: number): string {
  return '\u20B9' + v.toLocaleString('en-IN')
}

function isoAdd(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
