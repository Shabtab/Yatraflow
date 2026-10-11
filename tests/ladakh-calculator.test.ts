import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The page ships as static files under public/, so the module is loaded by a
// variable path (the same pattern seo-discovery.test.ts uses for api/*.js).
const corePath = '../public/ladakh-trip-cost-calculator/calc-core.js'
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const core = await import(corePath)

describe('Ladakh cost calculator core', () => {
  it('prices the default trip (2 people, 2 own bikes, Manali loop, homestay, dhabas)', () => {
    const r = core.calculate(core.defaultInputs())
    expect(r.breakdown.fuel.low).toBeCloseTo(11200) // 1600 km / 30 * 105 * 2 bikes
    expect(r.breakdown.stay).toEqual({ low: 10500, high: 17500 }) // 1 room * 7 nights
    expect(r.breakdown.food).toEqual({ low: 4800, high: 9600 })
    expect(r.breakdown.permits.low).toBe(1220) // 2 * (400 + 20*8 + 50)
    expect(r.breakdown.misc).toEqual({ low: 3000, high: 5000 })
    expect(r.group.low).toBeCloseTo(30720)
    expect(r.group.high).toBeCloseTo(44520)
    expect(r.perPerson.low).toBeCloseTo(15360)
    expect(r.rentMissing).toBe(false)
  })

  it('uses the low and high ends of a ranged route for the low and high totals', () => {
    const r = core.calculate({ ...core.defaultInputs(), kmLow: 3300, kmHigh: 3600 })
    expect(r.breakdown.fuel.low).toBeCloseTo((3300 / 30) * 105 * 2)
    expect(r.breakdown.fuel.high).toBeCloseTo((3600 / 30) * 105 * 2)
  })

  it('prices rented bikes as a range by default, and leaves it out for an own bike', () => {
    expect(core.calculate(core.defaultInputs()).breakdown.rent).toEqual({ low: 0, high: 0 })
    const r = core.calculate({ ...core.defaultInputs(), rented: true })
    expect(r.breakdown.rent).toEqual({ low: 2 * 1500 * 8, high: 2 * 2500 * 8 })
    expect(r.rentMissing).toBe(false)
    expect(r.group.low).toBeCloseTo(30720 + 24000)
    expect(r.group.high).toBeCloseTo(44520 + 40000)
  })

  it('leaves rent out and flags it when rented bikes have no rate entered', () => {
    const r = core.calculate({ ...core.defaultInputs(), rented: true, rentLow: '', rentHigh: '' })
    expect(r.breakdown.rent).toEqual({ low: 0, high: 0 })
    expect(r.rentMissing).toBe(true)
    expect(core.renderBreakdownHTML(r, { ...core.defaultInputs(), rented: true })).toContain('href="#rentLow"')
  })

  it('swaps a rent low and high typed the wrong way round', () => {
    const r = core.calculate({ ...core.defaultInputs(), rented: true, rentLow: 2500, rentHigh: 1500 })
    expect(r.breakdown.rent).toEqual({ low: 24000, high: 40000 })
    expect(core.fieldMessages({ rentLow: '2500', rentHigh: '1500' }).rentHigh).toBe('Low and high were swapped.')
  })

  it('flags fewer people than bikes and rounds rooms up', () => {
    expect(core.calculate({ ...core.defaultInputs(), people: 1, bikes: 2 }).fewerPeopleThanBikes).toBe(true)
    expect(core.calculate({ ...core.defaultInputs(), people: 3 }).rooms).toBe(2)
  })

  it('never returns NaN for blank or junk fields', () => {
    const r = core.calculate({ ...core.defaultInputs(), days: '', mileage: 'x', people: '' })
    expect(Number.isFinite(r.group.low)).toBe(true)
    expect(Number.isFinite(r.perPerson.high)).toBe(true)
  })

  it('formats with Indian grouping, rounded to the nearest 100', () => {
    expect(core.formatInr(123449)).toBe('₹1,23,400')
    expect(core.formatRange({ low: 15360, high: 22260 })).toBe('₹15,400 – ₹22,300')
    expect(core.formatRange({ low: 1220, high: 1220 })).toBe('₹1,200')
  })

  it('swaps a low and high that were typed the wrong way round', () => {
    const swapped = core.calculate({ ...core.defaultInputs(), stayLow: 2500, stayHigh: 1500 })
    expect(swapped.breakdown.stay).toEqual({ low: 10500, high: 17500 })
    expect(core.fieldMessages({ stayLow: '2500', stayHigh: '1500' }).stayHigh).toBe('Low and high were swapped.')
  })

  it('says what it did with empty, negative and impossible values', () => {
    const m = core.fieldMessages({ days: '', nights: '9', people: '-1', mileage: '0', bikes: '2' })
    expect(m.days).toMatch(/Counted as 0/)
    expect(m.people).toMatch(/Negative/)
    expect(m.mileage).toMatch(/not counted until/)
    expect(core.fieldMessages({ days: '0', nights: '0' }).days).toBe('A trip needs at least 1 day.')
    expect(core.fieldMessages({ days: '5', nights: '9' }).nights).toMatch(/More nights than days/)
    const clean = {
      days: '8', nights: '7', people: '2', bikes: '2', mileage: '30', fuel: '105',
      stayLow: '1500', stayHigh: '2500', foodLow: '300', foodHigh: '600', env: '400', wild: '20', miscLow: '1500', miscHigh: '2500',
    }
    expect(core.fieldMessages(clean)).toEqual({})
  })

  it('leaves out the group line when one person is travelling', () => {
    const solo = core.calculate({ ...core.defaultInputs(), people: 1, bikes: 1 })
    expect(core.renderHeroHTML(solo)).not.toContain('class="group"')
    expect(core.renderHeroHTML(core.calculate(core.defaultInputs()))).toContain('class="group"')
  })

  it('flags more than two people per bike', () => {
    expect(core.calculate({ ...core.defaultInputs(), people: 5, bikes: 2 }).manyPeoplePerBike).toBe(true)
    expect(core.calculate(core.defaultInputs()).manyPeoplePerBike).toBe(false)
  })
})

describe('Ladakh calculator link state', () => {
  it('keeps the default page address clean', () => {
    expect(core.serializeInputs(core.defaultInputs())).toBe('')
  })

  it('writes only changed fields when the form hands over strings', () => {
    const typed = { ...core.defaultInputs(), days: '8', nights: '7', people: '3', mileage: '30', stayLow: '1500', kmLow: '1600', kmHigh: '1600' }
    expect(core.serializeInputs(typed)).toBe('p=3')
  })

  it('round-trips a changed estimate through the query string', () => {
    const input = {
      ...core.inputsForRoute('delhi'),
      people: 4, bikes: 3, rented: true, rentLow: 1800, rentHigh: 2200, stay: 'hotel', stayLow: 2500, stayHigh: 5000,
      redCross: false, fuelPrice: 112,
    }
    const back = core.parseInputs('?' + core.serializeInputs(input))
    expect(back).toEqual(input)
    expect(core.calculate(back).group).toEqual(core.calculate(input).group)
  })

  it('ignores junk and out-of-range values', () => {
    const back = core.parseInputs('?r=nope&p=abc&b=-4&d=9999&mi=0&s=palace&km=zzz')
    expect(back).toEqual(core.defaultInputs())
  })

  it('moves nights with days when only days is in the link', () => {
    const back = core.parseInputs('?d=10')
    expect(back.days).toBe(10)
    expect(back.nights).toBe(9)
  })

  it('keeps a typed distance for a ranged route', () => {
    const back = core.parseInputs('?r=delhi&km=3000')
    expect(back.kmLow).toBe(3000)
    expect(back.kmHigh).toBe(3000)
    expect(core.serializeInputs(back)).toBe('r=delhi&km=3000')
  })
})

describe('Ladakh calculator page', () => {
  const html = read('../public/ladakh-trip-cost-calculator/index.html')

  it('carries the SEO tags in the raw HTML', () => {
    expect(html).toContain('<title>Ladakh Bike Trip Cost Calculator 2026 (Free, No Signup)</title>')
    expect(html).toContain('<link rel="canonical" href="https://www.yatraflow.in/ladakh-trip-cost-calculator/">')
    expect(html).toContain('<h1>Ladakh bike trip cost calculator</h1>')
    expect(html).toContain('"@type": "WebApplication"')
  })

  it('writes the default result into the HTML so it matches the model', () => {
    const r = core.calculate(core.defaultInputs())
    // the static blocks are the exact output of the shared markup functions
    const d = core.defaultInputs()
    expect(html).toContain('<!--gen:hero-->\n' + core.renderHeroHTML(r) + '\n<!--/gen:hero-->')
    expect(html).toContain('<!--gen:breakdown-->\n' + core.renderBreakdownHTML(r, d) + '\n<!--/gen:breakdown-->')
    expect(html).toContain('<!--gen:status-->' + core.statusText(r) + '<!--/gen:status-->')
    expect(html.match(/<!--gen:hero-->/g)).toHaveLength(2) // summary and full card
    expect(core.formatRange(r.perPerson)).toBe('₹15,400 – ₹22,300')
  })

  it('shows the price check date and carries dateModified in the JSON-LD', () => {
    expect(html).toContain('Prices checked October 2026')
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    expect(block).not.toBeNull()
    const ld = JSON.parse(block![1])
    expect(ld.dateModified).toBe('2026-10-10')
    expect(ld.datePublished).toBe('2026-10-10')
  })

  it('has no button element and no raw animation durations', () => {
    expect(html).not.toContain('<button')
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
    const raw = css.split('\n').filter((l) => /[:\s,]\d*\.?\d+m?s[\s;}]/.test(l) && !l.includes('--motion-') && !l.includes('scroll'))
    expect(raw).toEqual([])
  })

  it('has exactly one call-to-action link with the tracking query', () => {
    expect(html.match(/class="cta"/g)).toHaveLength(1)
    expect(html).toContain('https://www.yatraflow.in/?utm_source=ladakh-calculator&amp;utm_medium=tool&amp;utm_campaign=free-tools')
    expect(html).not.toContain('<button')
  })

  it('is wired into the site: sitemap, service worker, rewrite and footer', () => {
    expect(read('../api/sitemap.js')).toContain('/ladakh-trip-cost-calculator/')
    expect(read('../public/sw.js')).toContain("'/ladakh-trip-cost-calculator/'")
    expect(read('../vercel.json')).toContain('ladakh-trip-cost-calculator/')
    expect(read('../src/App.tsx')).toContain('href="/ladakh-trip-cost-calculator/"')
    expect(read('../index.html')).toContain('href="/ladakh-trip-cost-calculator/"')
  })
})
