import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { freeDaySet, planBody, renderBodyHTML, touristTripJsonLd } from '../api/_publicBody.js'

// #691 — a search visitor reads the free days of a published itinerary at
// /i/<id>. The hostile fixture below hands the page a trip whose locked day
// still carries real content, as if the database stub had failed. The page
// must print none of it.

const PUB_ID = 'kerala-trip_1'
const SECRET = 'SECRET-LOCKED-CONTENT'
const stop = (title: string, description: string, extra: Record<string, unknown> = {}) => ({
  id: title, title, locationName: `${title} town`, description, notes: `${SECRET} note`,
  openTime: '09:00', sourceUrl: `https://${SECRET}.example/x`, entryFeeInrPerPerson: 777, ...extra,
})
const trip = {
  days: [
    { id: 'd0', index: 0, title: 'Munnar hills', stops: [stop('Tea museum', 'Walk the estate.')] },
    { id: 'd1', index: 1, title: 'Thekkady forest', stops: [stop(`${SECRET} stop`, `${SECRET} description`)] },
    { id: 'd2', index: 2, title: 'Alleppey backwaters', stops: [stop('Houseboat', 'Locked — the full plan is on the original itinerary.')] },
    { id: 'd3', stops: [stop(`${SECRET} no index`, `${SECRET} d3`)] },
  ],
}
const priced = {
  id: PUB_ID, title: 'Kerala in 4 days', tagline: 'Hills and water', duration_days: 4,
  premium_price_inr: 299, free_day_indexes: [0, 2],
  estimated_budget_per_person_inr: 24500,
  cover_image_url: 'https://cdn.example.test/kerala.jpg',
  travel_tips: ['Book the ferry seats in advance', 'Carry cash for the hill roads'],
  warnings_and_assumptions: ['Monsoon closes the ghat road'],
  // Neither of these two has a public surface, so neither may reach the page.
  best_season: `${SECRET} season`,
  subscriber_cta: `${SECRET} cta`,
}

describe('free-day rules', () => {
  it('treats an unpriced publication as free and everything else as locked unless listed', () => {
    expect(freeDaySet({ premium_price_inr: null })).toBe('all')
    expect([...(freeDaySet(priced) as Set<number>)]).toEqual([0, 2])
  })
  it('fails closed on a missing or corrupt list and a missing price', () => {
    expect((freeDaySet({ premium_price_inr: 5 }) as Set<number>).size).toBe(0)
    expect((freeDaySet({ premium_price_inr: 5, free_day_indexes: 'all' }) as Set<number>).size).toBe(0)
    expect((freeDaySet({ free_day_indexes: [0] , premium_price_inr: undefined }) as Set<number>).has(0)).toBe(true)
    expect((freeDaySet({}) as Set<number>).size).toBe(0)
    expect([...(freeDaySet({ premium_price_inr: 5, free_day_indexes: [-1, 1.5, '0', 2] }) as Set<number>)]).toEqual([2])
  })
  it('locks a listed day that still carries the database marker, and a day with no index', () => {
    const open = planBody(priced, trip).map(day => day.open)
    expect(open).toEqual([true, false, false, false])
  })
})

describe('the body never prints locked content', () => {
  const html = renderBodyHTML(priced, trip, `/pub/${PUB_ID}`)
  it('prints the free day in full', () => {
    expect(html).toContain('<h1>Kerala in 4 days</h1>')
    expect(html).toContain('Tea museum')
    expect(html).toContain('Walk the estate.')
  })
  it('prints a locked day as its title and an in-app line only', () => {
    expect(html).toContain('Day 2: Thekkady forest')
    expect(html).toContain('The full plan for this day is in the app.')
    expect(html).not.toContain(SECRET)
    expect(html).not.toContain('Houseboat')
    expect(html).not.toContain('777')
    expect(html).not.toContain('09:00')
  })
  it('keeps the structured data free of locked stops, ratings and prices', () => {
    const ld = touristTripJsonLd(priced, trip, `https://app.example.test/i/${PUB_ID}`)
    expect(ld).not.toContain(SECRET)
    expect(ld).not.toContain('Houseboat')
    expect(ld).not.toMatch(/aggregateRating|offers|price/i)
    expect(JSON.parse(ld)['@type']).toBe('TouristTrip')
  })
  it('escapes markup in titles', () => {
    const out = renderBodyHTML({ ...priced, title: '<script>x</script>' }, trip, '/pub/x')
    expect(out).not.toContain('<script>')
  })
})

// #700 — the metadata the free view of the public page already shows. The row
// also carries two fields with no public surface at all, and those must not
// become a new one just because a crawler is reading.
describe('the free metadata reaches the page', () => {
  const html = renderBodyHTML(priced, trip, `/pub/${PUB_ID}`)

  it('prints the budget per person as text', () => {
    expect(html).toContain('Budget: about ₹24,500 per person.')
  })

  it('prints the travel tips and the warnings', () => {
    expect(html).toContain('<h2>Travel tips</h2>')
    expect(html).toContain('Book the ferry seats in advance')
    expect(html).toContain('<h2>Warnings &amp; assumptions</h2>')
    expect(html).toContain('Monsoon closes the ghat road')
  })

  it('prints the cover as an image with width, height and a descriptive alt', () => {
    expect(html).toContain('<img src="https://cdn.example.test/kerala.jpg" alt="Trip cover photo for Kerala in 4 days" width="1600" height="900"')
  })

  it('prints nothing for a field with no value, a wrong type or a bad scheme', () => {
    const bare = renderBodyHTML({
      ...priced,
      estimated_budget_per_person_inr: 0,
      cover_image_url: 'javascript:alert(1)',
      travel_tips: 'not a list',
      warnings_and_assumptions: null,
    }, trip, '/pub/x')
    expect(bare).not.toContain('<img')
    expect(bare).not.toContain('Budget:')
    expect(bare).not.toContain('Travel tips')
    expect(bare).not.toContain('Warnings')
  })

  it('keeps a field with no public surface off the page', () => {
    expect(html).not.toContain(SECRET)
    expect(html).not.toContain('best season')
    expect(html).not.toContain('cta')
  })

  it('carries the cover in the structured data and nothing else from the row', () => {
    const ld = touristTripJsonLd(priced, trip, `https://app.example.test/i/${PUB_ID}`)
    expect(JSON.parse(ld).image).toBe('https://cdn.example.test/kerala.jpg')
    expect(ld).not.toContain(SECRET)
    const bare = touristTripJsonLd({ ...priced, cover_image_url: 'http://plain.example.test/x.jpg' }, trip, 'https://app.example.test/i/x')
    expect(JSON.parse(bare).image).toBeUndefined()
  })
})

// The handler, end to end, with the fetch mocked.
function makeRes() {
  return {
    statusCode: 0, headers: {} as Record<string, string>, body: '',
    setHeader(key: string, value: string) { this.headers[key.toLowerCase()] = value },
    status(code: number) { this.statusCode = code; return this },
    send(body: string) { this.body = body; return this },
    end() { return this },
  }
}
const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example.test/')
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key')
  fetchMock.mockReset()
  fetchMock.mockImplementation(async input => {
    const url = String(input)
    if (url.includes('/rpc/get_public_trip')) return new Response(JSON.stringify([trip]), { status: 200 })
    return new Response(JSON.stringify([priced]), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function run(query: Record<string, string> = {}) {
  const res = makeRes()
  const { default: handler } = await import('../api/i.js')
  await handler({ method: 'GET', query: { id: PUB_ID, ...query } }, res)
  return res
}

describe('/i/<id> handler', () => {
  it('serves the readable page without a redirect to a search visitor', async () => {
    const res = await run()
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Walk the estate.')
    expect(res.body).not.toContain('location.replace')
    expect(res.body).toContain('application/ld+json')
    expect(res.body).not.toContain(SECRET)
    expect(res.headers['cache-control']).toContain('s-maxage=300')
  })
  it('serves the free metadata in the HTML, with no JavaScript needed', async () => {
    const res = await run()
    expect(res.body).toContain('Budget: about ₹24,500 per person.')
    expect(res.body).toContain('Book the ferry seats in advance')
    expect(res.body).toContain('Monsoon closes the ghat road')
    expect(res.body).toContain('<img src="https://cdn.example.test/kerala.jpg"')
    expect(res.body).not.toContain(SECRET)
  })
  it('still redirects a shared link that carries ref', async () => {
    const res = await run({ ref: 'wa' })
    expect(res.body).toContain('location.replace')
  })
  it('redirects an unverified buyer link without reading the trip', async () => {
    const res = await run({ buyer: '3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f601' })
    expect(res.body).toContain('location.replace')
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('get_public_trip'))).toBe(false)
  })
  it('skips the trip read for a shared link and for HEAD', async () => {
    await run({ ref: 'wa' })
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('get_public_trip'))).toBe(false)
    fetchMock.mockClear()
    const res = makeRes()
    const { default: handler } = await import('../api/i.js')
    await handler({ method: 'HEAD', query: { id: PUB_ID } }, res)
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('get_public_trip'))).toBe(false)
  })
  it('does not cache a page whose trip read failed', async () => {
    fetchMock.mockImplementation(async input => {
      if (String(input).includes('/rpc/get_public_trip')) throw new Error('down')
      return new Response(JSON.stringify([priced]), { status: 200 })
    })
    expect((await run()).headers['cache-control']).toBe('no-store')
  })
  it('prints one day, not "1 days"', () => {
    expect(renderBodyHTML({ ...priced, duration_days: 1 }, trip, '/pub/x')).toContain('1 day')
    expect(renderBodyHTML({ ...priced, duration_days: 1 }, trip, '/pub/x')).not.toContain('1 days')
  })
  it('keeps the old redirect card when the trip read fails', async () => {
    fetchMock.mockImplementation(async input => {
      if (String(input).includes('/rpc/get_public_trip')) throw new Error('down')
      return new Response(JSON.stringify([priced]), { status: 200 })
    })
    const res = await run()
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('location.replace')
    expect(res.body).not.toContain('Walk the estate.')
  })
})
