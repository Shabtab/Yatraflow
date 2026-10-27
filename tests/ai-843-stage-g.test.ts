import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answerForIntent, answerQuestion, buildAdviceFacts, buildDepartureAdviceFacts } from '../src/lib/ai'
import { askCompanion, buildMessages, buildTripContext, clearAiProviderConfig, clearJevConfig, saveAiProviderConfig, saveJevConfig } from '../src/lib/aiProvider'
import { seedData } from '../src/data/seed'
import type { ItineraryStop, Trip } from '../src/data/types'
import { legKey, originOf, simulateDay } from '../src/lib/engine'

const baseTrip = seedData.trips[0]
const baseStop = baseTrip.days.flatMap(day => day.stops).find(stop => !stop.auto)
if (!baseStop) throw new Error('The seeded trip needs one active stop for Stage G fixtures.')
const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  })
  clearAiProviderConfig()
  clearJevConfig()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function stop(overrides: Partial<ItineraryStop>): ItineraryStop {
  return {
    ...baseStop,
    ...overrides,
    locationName: overrides.locationName ?? overrides.title ?? baseStop.locationName,
  }
}

function tripWithStops(stops: ItineraryStop[], fixedCommitments: Trip['fixedCommitments'] = [], startTime = '22:00'): Trip {
  return {
    ...baseTrip,
    startDate: '2026-10-25',
    endDate: '2026-10-27',
    fixedCommitments,
    days: baseTrip.days.filter(day => day.index === 0).map(day => ({ ...day, startTime, stops })),
  }
}

function toUtcMinute(value: string): number {
  return Date.parse(`${value.replace(' ', 'T')}:00Z`) / 60_000
}

describe('issue 843 Stage G schedule facts', () => {
  it('keeps the full visit in the scheduled departure after arrival', () => {
    const trip = tripWithStops([stop({
      id: 'long-visit',
      title: 'Ten hour terminal visit',
      category: 'transport-hub',
      visitMinutes: 600,
      lat: tripStart().lat,
      lng: tripStart().lng,
      orderInDay: 0,
    })], [{
      id: 'long-flight', title: 'Flight', type: 'flight-departure', dayIndex: 0, time: '23:00', stopId: 'long-visit',
    }])
    const fact = buildAdviceFacts(trip)[0].stops[0]
    if (!fact.arrival || !fact.departure) throw new Error('The complete fixture should produce stop times.')
    const sim = simulateDay(trip.days[0], trip, originOf(trip, 0), 0)
    const reply = answerQuestion(trip, 'Can we reach the airport by 23:00?')

    expect(toUtcMinute(fact.departure) - toUtcMinute(fact.arrival)).toBeGreaterThanOrEqual(600)
    expect(fact.departure.endsWith(` ${sim.endsAt}`)).toBe(true)
    expect(fact.arrival).not.toBe(fact.departure)
    expect(reply.text).toContain(fact.departure)
    expect(reply.text).toContain('Risky')
  })

  it('uses the next calendar date when the scheduled stop departs after midnight', () => {
    const trip = tripWithStops([stop({
      id: 'overnight',
      title: 'Overnight terminal',
      category: 'transport-hub',
      visitMinutes: 180,
      lat: tripStart().lat,
      lng: tripStart().lng,
      orderInDay: 0,
    })])
    const fact = buildAdviceFacts(trip)[0].stops[0]

    expect(fact.arrival).toMatch(/^2026-10-25 /)
    expect(fact.departure).toMatch(/^2026-10-26 /)
  })

  it('keeps elapsed dates correct for a visit longer than twenty-four hours', () => {
    const trip = tripWithStops([stop({
      id: 'multi-day-visit',
      title: 'Long visit',
      visitMinutes: 3000,
      lat: tripStart().lat,
      lng: tripStart().lng,
      orderInDay: 0,
    })])
    const fact = buildAdviceFacts(trip)[0].stops[0]
    if (!fact.arrival || !fact.departure) throw new Error('The complete fixture should produce stop times.')

    expect(fact.departure).toMatch(/^2026-10-28 /)
    expect(toUtcMinute(fact.departure) - toUtcMinute(fact.arrival)).toBeGreaterThan(3000)
  })

  it('keeps an engine-supplied previous-day start offset', () => {
    const trip: Trip = {
      ...baseTrip,
      startDate: '2026-10-25',
      endDate: '2026-10-25',
      transportMode: 'flight',
      destinations: ['Mumbai'],
      destinationCoords: [{ lat: 18.922, lng: 72.834 }],
      startLocation: 'Delhi',
      startLocationCoords: { lat: 28.6139, lng: 77.209 },
      flights: [{ id: 'red-eye', dayIndex: 0, fromAirport: 'DEL', toAirport: 'BOM', departAt: '01:00' }],
      days: [{ id: 'red-eye-day', index: 0, stops: [] }],
    }
    const fact = buildAdviceFacts(trip)[0]

    expect(fact.start).toMatch(/^2026-10-24 /)
  })

  it('uses a modeled flight leg as departure and airport-transfer evidence', () => {
    const trip: Trip = {
      ...tripWithStops([stop({
        id: 'munnar-visit',
        title: 'Munnar visit',
        visitMinutes: 60,
        lat: 10.089,
        lng: 77.059,
        orderInDay: 0,
      })], [], '18:00'),
      transportMode: 'flight',
      startLocation: 'Munnar',
      startLocationCoords: { lat: 10.089, lng: 77.059 },
      destinations: ['Mumbai'],
      destinationCoords: [{ lat: 18.922, lng: 72.834 }],
      flights: [{ id: 'modeled-flight', dayIndex: 0, fromAirport: 'COK', toAirport: 'BOM', departAt: '23:30', arriveAt: '01:30' }],
      fixedCommitments: [],
    }
    const [departure] = buildDepartureAdviceFacts(trip)
    const context = buildTripContext(trip)
    if (!departure) throw new Error('The modeled flight should produce a departure fact.')

    expect(departure.source).toBe('flight-leg')
    expect(departure.terminal?.title).toContain('COK')
    expect(departure.terminal?.transferMinutes).not.toBeNull()
    expect(departure.bufferMinutes).toBe(120)
    expect(context).toContain('transfer')
    expect(context).toContain('buffer 120min')
  })

  it.each([false, undefined])('keeps missing exposure unknown in rain advice when weatherSensitive is %s', weatherSensitive => {
    const unknown = stop({
      id: 'unknown-exposure',
      title: 'Unclassified place',
      weatherSensitive,
      exposure: undefined,
      orderInDay: 0,
    })
    const trip = tripWithStops([unknown])
    const fact = buildAdviceFacts(trip)[0].stops[0]
    const reply = answerForIntent(trip, 'rain', 'What if it rains?')

    expect(fact.exposure).toBe('unknown')
    expect(reply.text).toContain('Exposure is unknown for: Day 1: Unclassified place')
    expect(reply.text).not.toContain('Verified indoor stops: Unclassified place')
  })

  it('preserves explicit indoor exposure in the deterministic answer path', () => {
    const indoor = stop({
      id: 'verified-indoor',
      title: 'Verified indoor museum',
      weatherSensitive: false,
      exposure: 'unknown',
      orderInDay: 0,
    })
    Reflect.set(indoor, 'exposure', 'indoor')
    const trip = tripWithStops([indoor])
    const fact = buildAdviceFacts(trip)[0].stops[0]
    const reply = answerForIntent(trip, 'rain', 'What if it rains?')

    expect(fact.exposure).toBe('indoor')
    expect(reply.text).toContain('Verified indoor stops: Verified indoor museum')
  })

  it('ignores rejected stops and reflects the active stop order in the schedule', () => {
    const first = stop({ id: 'first', title: 'First', orderInDay: 0, lat: 10.1, lng: 76.2 })
    const second = stop({ id: 'second', title: 'Second', orderInDay: 1, lat: 9.4, lng: 77.8 })
    const rejected = stop({ id: 'rejected', title: 'Rejected', status: 'rejected', orderInDay: 2 })
    const forward = buildAdviceFacts(tripWithStops([first, second, rejected]))[0].stops
    const reversed = buildAdviceFacts(tripWithStops([
      { ...second, orderInDay: 0 },
      { ...first, orderInDay: 1 },
      rejected,
    ]))[0].stops

    expect(forward.map(fact => fact.id)).toEqual(['first', 'second'])
    expect(reversed.map(fact => fact.id)).toEqual(['second', 'first'])
    expect(forward[1].transferFrom).toContain('First')
    expect(reversed[1].transferFrom).toContain('Second')

    const rejectedExtra = stop({
      id: 'rejected-extra',
      title: 'Rejected extra',
      status: 'rejected',
      weatherSensitive: true,
      visitMinutes: 600,
      orderInDay: 2,
    })
    const plainTrip = tripWithStops([first, second])
    const rejectedTrip = tripWithStops([first, second, rejectedExtra])
    const reorderedTrip = tripWithStops([{ ...second, orderInDay: 0 }, { ...first, orderInDay: 1 }])
    const plainTiring = answerForIntent(plainTrip, 'tiring', 'Make the day less tiring')
    const rejectedTiring = answerForIntent(rejectedTrip, 'tiring', 'Make the day less tiring')
    const reorderedTiring = answerForIntent(reorderedTrip, 'tiring', 'Make the day less tiring')

    expect(rejectedTiring.text).toBe(plainTiring.text)
    expect(answerForIntent(rejectedTrip, 'rain', 'What if it rains?').text)
      .toBe(answerForIntent(plainTrip, 'rain', 'What if it rains?').text)
    expect(reorderedTiring.text).not.toBe(plainTiring.text)
    expect(plainTiring.text).toContain('Second')
    expect(reorderedTiring.text).toContain('First')
  })

  it('does not claim station feasibility without linked terminal and buffer evidence', () => {
    const terminal = stop({
      id: 'station',
      title: 'Ernakulam station',
      category: 'transport-hub',
      visitMinutes: 0,
      lat: tripStart().lat,
      lng: tripStart().lng,
      orderInDay: 0,
    })
    const trip = tripWithStops([terminal], [{
      id: 'train', title: 'Train departure', type: 'train-departure', dayIndex: 0, time: '23:30',
    }])
    const reply = answerForIntent(trip, 'airport', 'Can we reach the station?')

    expect(reply.text).toMatch(/unknown/i)
    expect(reply.text).not.toMatch(/easy|workable/i)
  })

  it('reports unknown when an early commitment clock has no date evidence', () => {
    const terminal = stop({
      id: 'airport',
      title: 'Kochi airport',
      category: 'transport-hub',
      visitMinutes: 180,
      lat: tripStart().lat,
      lng: tripStart().lng,
      orderInDay: 0,
    })
    const trip = tripWithStops([terminal], [{
      id: 'flight', title: 'Flight departure', type: 'flight-departure', dayIndex: 0, time: '03:00', stopId: 'airport',
    }])
    const terminalFact = buildAdviceFacts(trip)[0].stops[0]
    const reply = answerForIntent(trip, 'airport', 'Can we reach the airport?')
    if (terminalFact.transferMinutes === null || terminalFact.transferFrom === null) {
      throw new Error('The fixture must provide a modeled transfer time and origin.')
    }

    expect(reply.text).toContain('2026-10-26')
    expect(reply.text).toContain("can't confirm")
    expect(reply.text).toContain('does not show whether it is the following morning')
    expect(reply.text).not.toMatch(/\bYes, workable\b|\bRisky\./i)
    expect(reply.assumptions).toContain(
      `The transfer into the linked stop is estimated at ${terminalFact.transferMinutes} min from ${terminalFact.transferFrom}.`,
    )
    expect(reply.assumptions).toContain('The airport check-in buffer is 120 min.')
  })

  it('applies the engine airport check-in buffer to the terminal departure', () => {
    const terminal = stop({
      id: 'buffer-airport',
      title: 'Kochi airport',
      category: 'transport-hub',
      visitMinutes: 255,
      lat: tripStart().lat,
      lng: tripStart().lng,
      orderInDay: 0,
    })
    const trip = tripWithStops([terminal], [{
      id: 'buffer-flight', title: 'Flight', type: 'flight-departure', dayIndex: 0, time: '23:40', stopId: 'buffer-airport',
    }], '18:00')
    const reply = answerForIntent(trip, 'airport', 'Can we reach the airport?')

    expect(reply.text).toContain('2026-10-25 22:30')
    expect(reply.text).toContain('Risky')
    expect(reply.assumptions).toContain('120 min')
  })

  it('rounds fractional engine legs into valid remote clocks and finite airport slack', () => {
    const trip: Trip = {
      ...tripWithStops([stop({
      id: 'fractional-airport',
      title: 'Cochin airport',
      category: 'transport-hub',
      visitMinutes: 45,
      lat: 10.152,
      lng: 76.4019,
      orderInDay: 0,
    })], [{
      id: 'fractional-flight',
      title: 'Flight from Cochin',
      type: 'flight-departure',
      dayIndex: 0,
      time: '16:00',
      stopId: 'fractional-airport',
    }], '08:00'),
      startLocation: 'Kochi',
      startLocationCoords: { lat: 9.9312, lng: 76.2673 },
      transportMode: 'car',
      flights: [],
    }
    const dayFact = buildAdviceFacts(trip)[0]
    const terminal = dayFact.stops.find(fact => fact.id === 'fractional-airport')
    const [departure] = buildDepartureAdviceFacts(trip, [dayFact])
    const origin = originOf(trip, 0)
    const sim = simulateDay(trip.days[0], trip, origin, 0)
    const context = buildTripContext(trip)
    const reply = answerForIntent(trip, 'airport', 'Can we reach Cochin airport?')
    if (!terminal || terminal.transferMinutes === null || terminal.arrival === null || terminal.departure === null) {
      throw new Error('The real-coordinate engine fixture must provide leg and terminal clocks.')
    }

    const validClock = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
    const remoteClocks = context.match(/\b\d{4}-\d{2}-\d{2} \d{2}:[0-9]+(?:\.[0-9]+)?/g) ?? []
    const terminalDepartureMs = Date.parse(`${terminal.departure.replace(' ', 'T')}:00Z`)
    const latestDepartureMs = Date.parse('2026-10-25T16:00:00Z') - 120 * 60_000
    const slackMinutes = (latestDepartureMs - terminalDepartureMs) / 60_000

    expect(origin).toEqual({ lat: 9.9312, lng: 76.2673 })
    expect(sim.legs[0].distanceKm).toBeGreaterThan(0.5)
    expect(terminal.transferMinutes).toBe(sim.legs[0].durationMinutes)
    expect(Number.isInteger(sim.legs[0].durationMinutes)).toBe(false)
    expect([dayFact.start, dayFact.end, terminal.arrival, terminal.departure].every(value => value !== null && validClock.test(value))).toBe(true)
    expect(remoteClocks.length).toBeGreaterThan(0)
    expect(remoteClocks.every(value => validClock.test(value))).toBe(true)
    expect(context).toContain(`arrive ${terminal.arrival}; depart ${terminal.departure}`)
    expect(departure?.status).toBe('supported')
    expect(departure?.bufferMinutes).toBe(120)
    expect(Number.isFinite(slackMinutes)).toBe(true)
    expect(slackMinutes).toBeGreaterThan(0)
    expect(reply.text).toContain(`That leaves ${Math.floor(slackMinutes)} min`)
    expect(reply.text).toMatch(/^Yes, workable\./)
    expect(reply.text).not.toMatch(/\bNaN\b/)
  })

  it('rounds a fractional leg before the calendar carry when a visit ends at midnight', () => {
    const terminal = stop({
      id: 'midnight-terminal',
      title: 'Kochi airport midnight terminal',
      category: 'transport-hub',
      visitMinutes: 45,
      lat: 10.1815,
      lng: 76.2673,
      orderInDay: 0,
    })
    const trip: Trip = {
      ...tripWithStops([terminal], [], '22:00'),
      startLocation: 'Kochi',
      startLocationCoords: { lat: 9.9312, lng: 76.2673 },
      transportMode: 'car',
      destinations: ['Kochi'],
      destinationCoords: [{ lat: 10.1815, lng: 76.2673 }],
      flights: [],
    }
    const dayFact = buildAdviceFacts(trip)[0]
    const fact = dayFact.stops.find(candidate => candidate.id === 'midnight-terminal')
    const sim = simulateDay(trip.days[0], trip, originOf(trip, 0), 0)
    if (!fact || !fact.arrival || !fact.departure) throw new Error('The midnight fixture should produce terminal clocks.')

    // The engine models this leg as 59.7 min, so the arrival minute is fractional.
    expect(Number.isInteger(sim.legs[0].durationMinutes)).toBe(false)
    expect(originOf(trip, 0)).toEqual({ lat: 9.9312, lng: 76.2673 })
    expect(fact.transferMinutes).toBe(sim.legs[0].durationMinutes)

    // 22:00 + 59.7 min arrives at 23:00; a 45 min visit and the 15 min per-stop
    // buffer push the departure past the calendar boundary. Rounding first makes
    // that departure exactly 00:00 on the next day, never 23:60 or 00:00.7.
    expect(fact.arrival).toBe('2026-10-25 23:00')
    expect(fact.departure).toBe('2026-10-26 00:00')
    expect(fact.departure.startsWith('2026-10-26 ')).toBe(true)
    expect(dayFact.end).toBe(fact.departure)
    expect([dayFact.start, dayFact.end, fact.arrival, fact.departure].every(value =>
      value !== null && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))).toBe(true)
  })

  it('keeps the previous-day start boundary when a fractional airport run precedes a dawn flight', () => {
    const destinationVisit = stop({
      id: 'delhi-arrival-visit',
      title: 'Delhi arrival visit',
      category: 'sightseeing',
      visitMinutes: 60,
      lat: 28.6,
      lng: 77.2,
      orderInDay: 0,
    })
    const trip: Trip = {
      ...baseTrip,
      startDate: '2026-10-25',
      endDate: '2026-10-25',
      transportMode: 'flight',
      destinations: ['Delhi'],
      destinationCoords: [{ lat: 28.6, lng: 77.2 }],
      startLocation: 'Kochi',
      startLocationCoords: { lat: 9.9312, lng: 76.2673 },
      flights: [{ id: 'dawn-flight', dayIndex: 0, fromAirport: 'COK', toAirport: 'DEL', departAt: '00:30', arriveAt: '03:30' }],
      days: [{ id: 'dawn-day', index: 0, stops: [destinationVisit] }],
    }
    const dayFact = buildAdviceFacts(trip)[0]
    const [departure] = buildDepartureAdviceFacts(trip, [dayFact])
    const sim = simulateDay(trip.days[0], trip, originOf(trip, 0), 0)
    const context = buildTripContext(trip)
    const reply = answerForIntent(trip, 'airport', 'Can we reach the airport?')
    const originRun = sim.legs.find(leg => leg.toTitle.startsWith('COK ·'))
    if (!originRun) throw new Error('The flight fixture should model the run to the origin airport.')

    // The run to COK is fractional and the engine back-computes a 21:29 start on
    // the previous day. That offset must survive, and the airport arrival must be
    // rounded, not printed as 22:30.134...
    expect(originOf(trip, 0)).toEqual({ lat: 9.9312, lng: 76.2673 })
    expect(Number.isInteger(originRun.durationMinutes)).toBe(false)
    expect(sim.startDayOffset).toBe(-1)
    expect(dayFact.start).toBe('2026-10-24 21:29')
    expect(departure?.status).toBe('supported')
    expect(departure?.bufferMinutes).toBe(120)

    const airportWaypoint = dayFact.stops.find(fact => fact.title.startsWith('COK ·'))
    if (!airportWaypoint || !airportWaypoint.arrival) throw new Error('The flight fixture should expose the airport waypoint clock.')
    expect(airportWaypoint.arrival).toBe('2026-10-24 22:30')
    expect(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(airportWaypoint.arrival)).toBe(true)

    const remoteClocks = context.match(/\b\d{4}-\d{2}-\d{2} \d{2}:[0-9]+(?:\.[0-9]+)?/g) ?? []
    expect(remoteClocks.length).toBeGreaterThan(0)
    expect(remoteClocks.every(value => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))).toBe(true)
    expect(reply.text).not.toMatch(/\bNaN\b/)
  })

  it('reads the workspace measured legs so a correction can flip the airport verdict', () => {
    const terminal = stop({
      id: 'measured-airport',
      title: 'Kochi airport',
      category: 'transport-hub',
      visitMinutes: 60,
      lat: 10.152,
      lng: 76.4019,
      orderInDay: 0,
    })
    const trip: Trip = {
      ...tripWithStops([terminal], [{
        id: 'measured-flight', title: 'Flight', type: 'flight-departure', dayIndex: 0, time: '16:00', stopId: 'measured-airport',
      }], '08:00'),
      startLocation: 'Munnar',
      startLocationCoords: { lat: 9.9312, lng: 76.2673 },
      transportMode: 'car',
    }
    const origin = originOf(trip, 0)
    const estimated = simulateDay(trip.days[0], trip, origin, 0)
      .legs.find(leg => leg.toTitle === 'Kochi airport')
    if (!estimated) throw new Error('The measured fixture should model the terminal leg.')
    expect(estimated.durationMinutes).toBeGreaterThan(0)

    // The uncorrected engine calls this workable. A measured road run that is
    // longer than the haversine estimate must be what the companion reports.
    const workable = answerForIntent(trip, 'airport', 'Can we reach the airport?')
    expect(workable.text).toMatch(/^Yes, workable\./)

    const corrections = {
      [legKey(origin, { lat: terminal.lat, lng: terminal.lng })]: {
        distanceKm: estimated.distanceKm,
        durationMinutes: estimated.durationMinutes + 240,
      },
    }
    const measured = answerForIntent(trip, 'airport', 'Can we reach the airport?', corrections)
    expect(measured.text).toMatch(/^Risky\./)
    expect(measured.text).not.toBe(workable.text)

    // The facts, the remote context and the answer all read that one snapshot.
    const fact = buildAdviceFacts(trip, corrections)[0].stops[0]
    const context = buildTripContext(trip, corrections)
    if (!fact.arrival) throw new Error('The measured fixture should produce a terminal arrival.')
    expect(context).toContain(`arrive ${fact.arrival}`)
    expect(measured.text).toContain(fact.arrival)
    expect(context).not.toContain(`arrive ${buildAdviceFacts(trip)[0].stops[0].arrival}`)

    // An unrelated leg must not move the answer: the record is keyed, not blanket.
    const unrelated = { [legKey({ lat: 0, lng: 0 }, { lat: 1, lng: 1 })]: { distanceKm: 999, durationMinutes: 999 } }
    expect(answerForIntent(trip, 'airport', 'Can we reach the airport?', unrelated).text).toBe(workable.text)
  })

  it('carries the same measured snapshot through the remote and offline routes', async () => {
    const terminal = stop({
      id: 'routed-airport',
      title: 'Kochi airport',
      category: 'transport-hub',
      visitMinutes: 60,
      lat: 10.152,
      lng: 76.4019,
      orderInDay: 0,
    })
    const trip: Trip = {
      ...tripWithStops([terminal], [{
        id: 'routed-flight', title: 'Flight', type: 'flight-departure', dayIndex: 0, time: '16:00', stopId: 'routed-airport',
      }], '08:00'),
      startLocation: 'Munnar',
      startLocationCoords: { lat: 9.9312, lng: 76.2673 },
      transportMode: 'car',
    }
    const origin = originOf(trip, 0)
    const leg = simulateDay(trip.days[0], trip, origin, 0).legs.find(candidate => candidate.toTitle === 'Kochi airport')
    if (!leg) throw new Error('The routed fixture should model the terminal leg.')
    const corrections = {
      [legKey(origin, { lat: terminal.lat, lng: terminal.lng })]: {
        distanceKm: leg.distanceKm,
        durationMinutes: leg.durationMinutes + 240,
      },
    }

    // Offline route (no Jev, no provider) must read the corrections.
    const offline = await askCompanion(trip, 'Can we reach the airport?', undefined, corrections)
    expect(offline.source).toBe('offline')
    expect(offline.text).toMatch(/^Risky\./)
    expect(offline.text).toBe(answerForIntent(trip, 'airport', 'Can we reach the airport?', corrections).text)

    // The remote prompt carries the same measured arrival, not the estimate.
    const measuredArrival = buildAdviceFacts(trip, corrections)[0].stops[0].arrival
    const estimatedArrival = buildAdviceFacts(trip)[0].stops[0].arrival
    if (!measuredArrival || !estimatedArrival) throw new Error('Both fixtures should produce a terminal arrival.')
    expect(buildMessages(trip, 'q', corrections)[0].content).toContain(`arrive ${measuredArrival}`)
    expect(buildMessages(trip, 'q', corrections)[0].content).not.toContain(`arrive ${estimatedArrival}`)

    // Jev classifies, the local handler answers — the corrections must survive.
    saveJevConfig({ baseUrl: 'https://jev.test/v1', apiKey: 'test-key' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      answers: { intent: { choice: 'airport' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const jev = await askCompanion(trip, 'Can we reach the airport?', undefined, corrections)
    expect(jev.source).toBe('jev')
    expect(jev.text).toBe(offline.text)
    expect(jev.text).toMatch(/^Risky\./)
  })

  it('leaves callers without a measurement on the engine estimate', () => {
    const terminal = stop({
      id: 'legacy-airport',
      title: 'Kochi airport',
      category: 'transport-hub',
      visitMinutes: 60,
      lat: 10.152,
      lng: 76.4019,
      orderInDay: 0,
    })
    const trip = tripWithStops([terminal], [{
      id: 'legacy-flight', title: 'Flight', type: 'flight-departure', dayIndex: 0, time: '16:00', stopId: 'legacy-airport',
    }], '08:00')

    // Every old call shape keeps its previous result, and the measured-empty
    // record ({}) is engine-equivalent to no record at all.
    expect(buildAdviceFacts(trip)).toEqual(buildAdviceFacts(trip, undefined))
    expect(buildAdviceFacts(trip)).toEqual(buildAdviceFacts(trip, {}))
    expect(buildTripContext(trip)).toBe(buildTripContext(trip, {}))
    expect(answerForIntent(trip, 'airport', 'q')).toEqual(answerForIntent(trip, 'airport', 'q', {}))
    expect(answerQuestion(trip, 'Can we reach the airport?')).toEqual(
      answerQuestion(trip, 'Can we reach the airport?', {}),
    )
    expect(buildDepartureAdviceFacts(trip)).toEqual(buildDepartureAdviceFacts(trip, undefined, {}))
  })

  it('serializes the shared schedule facts remotely and excludes private trip fields', () => {
    const place = stop({
      id: 'private-context-place',
      title: 'Context place',
      visitMinutes: 75,
      notes: 'PRIVATE_NOTE_BODY_843',
      lat: 86.123456,
      lng: 32.654321,
      weatherSensitive: undefined,
      exposure: undefined,
      orderInDay: 0,
    })
    const members: NonNullable<Trip['members']> = [{ userId: 'PRIVATE_MEMBER_ID_843', role: 'viewer', joinedAt: 0 }]
    const trip = {
      ...tripWithStops([place]),
      startLocationCoords: { lat: 85.987654, lng: 32.123456 },
      members,
    }
    const fact = buildAdviceFacts(trip)[0].stops[0]
    if (!fact.arrival || !fact.departure) throw new Error('The pinned fixture should produce stop times.')
    const context = buildTripContext(trip)

    expect(context).toContain(fact.arrival)
    expect(context).toContain(fact.departure)
    expect(context).toContain('exposure unknown')
    expect(context).not.toContain('PRIVATE_NOTE_BODY_843')
    expect(context).not.toContain('PRIVATE_MEMBER_ID_843')
    expect(context).not.toContain('86.123456')
    expect(context).not.toContain('32.654321')
    expect(context).not.toContain('85.987654')
    expect(context).not.toContain('32.123456')
  })

  it('serializes missing terminal and station-buffer evidence as unknown remotely', () => {
    const terminal = stop({
      id: 'unlinked-station',
      title: 'Station stop',
      category: 'transport-hub',
      visitMinutes: 0,
      lat: tripStart().lat,
      lng: tripStart().lng,
      orderInDay: 0,
    })
    const trip = tripWithStops([terminal], [{
      id: 'train', title: 'Train', type: 'train-departure', dayIndex: 0, time: '23:30', stopId: 'unlinked-station',
    }])
    const context = buildTripContext(trip)

    expect(context).toContain('train-departure')
    expect(context).toContain('unknown')
    expect(context).toContain('No station buffer is recorded.')
  })

  it('fails closed for minimal stops without coordinates and keeps fallback available', () => {
    const stopWithoutCoordinates = stop({
      id: 'coordinate-free-terminal',
      title: 'Terminal with no pin',
      category: 'transport-hub',
      visitMinutes: 60,
      orderInDay: 0,
    })
    Reflect.deleteProperty(stopWithoutCoordinates, 'lat')
    Reflect.deleteProperty(stopWithoutCoordinates, 'lng')
    const trip = tripWithStops([stopWithoutCoordinates], [{
      id: 'missing-route-flight', title: 'Flight', type: 'flight-departure', dayIndex: 0, time: '23:30', stopId: 'coordinate-free-terminal',
    }])
    Reflect.deleteProperty(trip, 'startLocationCoords')
    const context = buildTripContext(trip)
    const reply = answerForIntent(trip, 'airport', 'Can we reach the airport?')

    const legacyPriority = stopWithoutCoordinates.priority === 'must-do' ? ', must-do' : ''
    expect(context).toContain(`Terminal with no pin [transport-hub${legacyPriority}, 60min]`)
    expect(context).toMatch(/unknown transfer/)
    expect(context).not.toMatch(/NaN|undefined/)
    expect(reply.text).toMatch(/unknown/i)
    expect(reply.text).not.toMatch(/easy|workable/i)
  })

  it('keeps the offline fallback and configured endpoint behavior intact', async () => {
    const trip = tripWithStops([stop({ id: 'fallback-stop', orderInDay: 0 })])
    const offline = await askCompanion(trip, 'Give me a trip summary')
    expect(offline.source).toBe('offline')

    expect(saveAiProviderConfig({ baseUrl: 'https://provider.example/v1', apiKey: 'test', model: 'test-model' })).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Configured endpoint reply' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const endpoint = await askCompanion(trip, 'Give me a trip summary')

    expect(endpoint.source).toBe('llm')
    expect(endpoint.text).toBe('Configured endpoint reply')
  })

  it('keeps endpoint failure fallback and Jev shared-handler routing intact', async () => {
    const trip = tripWithStops([stop({ id: 'fallback-stop', orderInDay: 0 })])
    expect(saveAiProviderConfig({ baseUrl: 'https://provider.example/v1', apiKey: 'test', model: 'test-model' })).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Synthetic network failure') }))
    const fallback = await askCompanion(trip, 'What time should we leave for the airport?')
    expect(fallback.source).toBe('offline')
    expect(fallback.text).toMatch(/unknown|departure commitments/i)

    clearAiProviderConfig()
    expect(saveJevConfig({ baseUrl: 'https://jev.example/v1', apiKey: 'test' })).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      answers: { intent: { choice: 'airport' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const jev = await askCompanion(trip, 'Can we reach the airport?')

    expect(jev.source).toBe('jev')
    expect(jev.text).toBe(answerForIntent(trip, 'airport', 'Can we reach the airport?').text)
  })

  it.each([
    { value: '', enabled: false },
    { value: 'on', enabled: true },
    { value: 'ON ', enabled: false },
    { value: 'off', enabled: false },
  ])('keeps the companion flag gate for VITE_AI_COMPANION=$value', async ({ value, enabled }) => {
      vi.stubEnv('VITE_AI_COMPANION', value)
      vi.resetModules()
      const flags = await import('../src/lib/featureFlags')
      expect(flags.AI_COMPANION_ENABLED).toBe(enabled)
  })
})

function tripStart(): { lat: number; lng: number } {
  return baseTrip.startLocationCoords ?? { lat: baseStop.lat, lng: baseStop.lng }
}
