/**
 * Workspace tab audit, batch 2 (#612, #613, #614).
 *
 * Tests run in node with no DOM. Component markup is pinned as source guards.
 * The engine half of #613 runs as a real fixture.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildJourney } from '../src/lib/engine'
import { seedData } from '../src/data/seed'
import type { Trip, ItineraryStop } from '../src/data/types'

const KOLKATA = { lat: 22.5726, lng: 88.3639 }
const DELHI = { lat: 28.6139, lng: 77.209 }

const tripMap = readFileSync(new URL('../src/components/TripMap.tsx', import.meta.url), 'utf8')
const heightChart = readFileSync(new URL('../src/components/trips/OverviewElevationProfile.tsx', import.meta.url), 'utf8')
const overview = readFileSync(new URL('../src/pages/trip/OverviewTab.tsx', import.meta.url), 'utf8')
const overviewTruth = readFileSync(new URL('../src/lib/overviewTruth.ts', import.meta.url), 'utf8')
const pubItinerary = readFileSync(new URL('../src/pages/PublicItinerary.tsx', import.meta.url), 'utf8')

/** The popup block, sliced so later markup cannot satisfy the pins by accident. */
function popupBlock(): string {
  const start = tripMap.indexOf('yf-stop-jump')
  expect(start, 'yf-stop-jump moved — re-anchor this guard').toBeGreaterThan(0)
  return tripMap.slice(start, start + 2600)
}

describe('#612 — the phone stop popup keeps its name and actions in bounds', () => {
  it('gives the name its own row with an ellipsis', () => {
    const block = popupBlock()
    expect(block).toContain("flexDirection: 'column'")
    expect(block).toContain("textOverflow: 'ellipsis'")
    expect(block).not.toContain('maxWidth: 200')
  })

  it('wraps the actions inside the popup and keeps every control at full size', () => {
    const block = popupBlock()
    expect(block).toContain("flexWrap: 'wrap'")
    expect(block).toContain('btn btn-sm btn-primary')
    expect(block).toContain('btn btn-sm btn-outline')
    expect(block).toContain('btn btn-sm btn-danger')
    expect(block).toContain('aria-label="Close"')
  })
})

describe('#613 — a driving day with no stored stops still draws its journey', () => {
  it('derives a drawable journey for the stopless day: two-plus finite points', () => {
    const t = structuredClone(seedData.trips[0]) as Trip
    t.transportMode = 'car'
    t.roundTrip = false
    t.startLocation = 'Kolkata'
    t.startLocationCoords = KOLKATA
    t.destinations = ['Delhi']
    t.destinationCoords = [DELHI]
    t.fixedCommitments = []
    const anchor = (name: string, p: { lat: number; lng: number }, orderInDay: number, id: string): ItineraryStop => ({
      id, title: name, category: 'travel', locationName: name,
      lat: p.lat, lng: p.lng, visitMinutes: 0,
      entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
      priority: 'must-do', status: 'confirmed', orderInDay, auto: true,
    })
    // The middle day carries no stored stops — the audit's repro shape. Day 1
    // ends at a real visit, so day 2 wakes up mid-route and drives on. (A day
    // with no visits behind it would already hold the whole drive, and a
    // trailing empty day is a stay: nothing lies past it to drive to.)
    const midway = { lat: 25.6, lng: 82.8 }
    const halt: ItineraryStop = {
      id: 'hs', title: 'Ghat halt', category: 'sightseeing', locationName: 'Ghat halt',
      lat: midway.lat, lng: midway.lng, visitMinutes: 60,
      entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
      priority: 'must-do', status: 'confirmed', orderInDay: 2,
    }
    t.days = [
      { id: 'dd0', index: 0, stops: [anchor('Kolkata', KOLKATA, 1, 'ka'), halt] },
      { id: 'dd1', index: 1, stops: [] },
      { id: 'dd2', index: 2, stops: [anchor('Delhi', DELHI, 1, 'da')] },
    ] as Trip['days']
    const j = buildJourney(t, t.days[1])
    expect(j.distanceKm).toBeGreaterThan(100)
    const pts = j.points
      .map(p => ({ lat: p.lat, lng: p.lng }))
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    // The same bar the map's own day-route derivation applies.
    expect(pts.length).toBeGreaterThanOrEqual(2)
  })

  it('gates the map on the selected day journey, not just on plotted stops', () => {
    expect(tripMap).toContain('const canDrawRoute = dayFilter')
    expect(tripMap).toContain('dayRoutePoints[String(dayFilter)] != null')
    expect(tripMap).toContain('if (!canDrawRoute) { setGeom({}); return }')
    expect(tripMap).toContain('if (!canDrawRoute) { setMapLoaded(false); return }')
    expect(tripMap).toContain('{!canDrawRoute ? (')
    expect(tripMap).not.toContain('allPoints.length === 0')
  })

  it('still draws the single day from its derived journey', () => {
    expect(tripMap).toContain('.filter(d => d.index === dayFilter && dayRoutePoints')
  })
})

describe('#614 — route day badges are one-based', () => {
  it('the published page uses the Ride along height card, not the old route snapshot', () => {
    expect(pubItinerary).toContain('<RideElevation ')
    expect(pubItinerary).not.toContain('RouteGlance')
    expect(pubItinerary).not.toContain('RouteSnapshot')
  })

  it('the overview passes day indexes, never a coerced zero', () => {
    expect(overview).toContain('<OverviewRouteCard rows={routeRows}')
    expect(overviewTruth).toContain('dayIndex: chain.ptDay[i] ?? null')
    expect(overviewTruth).not.toContain('chain.ptDay[i] ?? 0')
  })
})
