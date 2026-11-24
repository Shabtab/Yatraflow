// ============ The trip cost calculators: model, pages and wiring ============
// One test file for the whole family (it replaces the Ladakh-only
// tests/ladakh-calculator.test.ts and tests/vercel-calculator-route.test.ts).
// Four things are pinned here, in the order they can break:
//
//   1. THE MODEL. Every destination's arithmetic, and Ladakh's legacy numbers
//      byte for byte — the page it replaces has been ranking on Google with
//      those figures on it.
//   2. THE PAGES. The committed public/<slug>/index.html must equal exactly what
//      scripts/build-calculators.mjs renders today. That is the drift gate: edit
//      a rate or a rendering function without rebuilding and this fails.
//   3. THE LINK STATE. A default page keeps a clean address, a changed estimate
//      round-trips, junk is ignored, and every shared Ladakh address from 2026
//      still opens the numbers it named.
//   4. THE WIRING. The manifest, vercel.json, api/sitemap.js and public/sw.js
//      must agree in BOTH directions, so a new destination cannot ship
//      unreachable and a dead slug cannot linger.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The generators ship as plain ESM outside src/, so they are loaded by a
// variable path — the same pattern seo-discovery.test.ts uses for api/*.js.
const enginePath = '../calculators/engine.mjs'
const buildPath = '../scripts/build-calculators.mjs'
const engine: any = await import(enginePath)
const build: any = await import(buildPath)

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const DESTINATIONS: any[] = build.loadDestinations()
const DEST_SLUGS: string[] = DESTINATIONS.map((d) => d.slug)
const rendered = build.renderAll()
const PAGES: Record<string, string> = rendered.pages
const byKey = Object.fromEntries(DESTINATIONS.map((d) => [d.key, d]))

/** HTML entity → text, for comparing a page's visible copy against JSON-LD. */
function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** A committed page and its freshly rendered twin, for message clarity. */
function committed(slug: string): string {
  return read(`../public/${slug}/index.html`)
}

describe('calculator model', () => {
  it('prices the Ladakh default exactly as the page it replaces did', () => {
    const r = engine.calculate(byKey.ladakh, engine.defaultInputs(byKey.ladakh))
    const row = (key: string) => r.rows.find((x: any) => x.key === key)
    expect(row('fuel').low).toBeCloseTo(11200) // 1600 km / 30 km/L * 105 * 2 bikes
    expect(row('stay')).toMatchObject({ low: 10500, high: 17500 }) // 1 room * 7 nights
    expect(row('food')).toMatchObject({ low: 4800, high: 9600 })
    expect(row('permits').low).toBe(1220) // 2 * (400 + 20*8 + 50)
    expect(row('misc')).toMatchObject({ low: 3000, high: 5000 })
    expect(r.group.low).toBeCloseTo(30720)
    expect(r.group.high).toBeCloseTo(44520)
    expect(engine.formatRange(r.perPerson)).toBe('₹15,400 – ₹22,300')
    expect(engine.formatRange(r.group)).toBe('₹30,700 – ₹44,500')
    expect(row('rent').active).toBe(false) // own bike: no rent row
  })

  it('prices a rented bike for every bike, for every day', () => {
    const dest = byKey.ladakh
    const input = { ...engine.defaultInputs(dest), bike: 'rent' }
    const r = engine.calculate(dest, input)
    const rent = r.rows.find((x: any) => x.key === 'rent')
    expect(rent.active).toBe(true)
    expect(rent).toMatchObject({ low: 2 * 1500 * 8, high: 2 * 2500 * 8 })
  })

  it('uses both ends of a ranged route for the two ends of the total', () => {
    const dest = byKey.ladakh
    const r = engine.calculate(dest, engine.inputsForRoute(dest, 'delhi'))
    expect(r.rows.find((x: any) => x.key === 'fuel').low).toBeCloseTo((3300 / 30) * 105 * 2)
    expect(r.rows.find((x: any) => x.key === 'fuel').high).toBeCloseTo((3600 / 30) * 105 * 2)
  })

  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: never returns NaN and keeps low <= high', (_key, dest) => {
    const cases = [
      engine.defaultInputs(dest),
      { ...engine.defaultInputs(dest), people: '' , days: 'x', nights: '' },
      { ...engine.defaultInputs(dest), people: 1, days: 30, nights: 29 },
      { ...engine.defaultInputs(dest), stayLow: 9000, stayHigh: 100 }, // typed the wrong way round
    ]
    for (const input of cases) {
      const r = engine.calculate(dest, input)
      expect(Number.isFinite(r.perPerson.low)).toBe(true)
      expect(Number.isFinite(r.perPerson.high)).toBe(true)
      expect(r.perPerson.low).toBeLessThanOrEqual(r.perPerson.high)
      expect(r.group.low).toBeLessThanOrEqual(r.group.high)
    }
  })

  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: each transport choice prices its own lines and only those', (_key, dest) => {
    const group = dest.groups[0]
    const totals = new Set<number>()
    for (const option of group.options) {
      const r = engine.calculate(dest, { ...engine.defaultInputs(dest), [group.key]: option.value })
      const on = r.rows.filter((x: any) => x.active)
      expect(on.length).toBeGreaterThan(0)
      // Exactly the lines this option gates are active; nothing else moves.
      for (const line of dest.lines) {
        if (!line.when || line.when.group !== group.key) continue
        const expected = line.when.in.includes(option.value)
        expect(Boolean(r.rows.find((x: any) => x.key === line.key).active), line.key).toBe(expected)
      }
      totals.add(Math.round(r.perPerson.low))
    }
    // Each way of travelling must land somewhere different, or the control is
    // decoration rather than a choice.
    expect(totals.size).toBe(group.options.length)
  })

  it('leaves an optional extra out until it is asked for, then prices it per person', () => {
    const dest = byKey.rajasthan
    const off = engine.calculate(dest, engine.defaultInputs(dest))
    const on = engine.calculate(dest, { ...engine.defaultInputs(dest), campOn: true })
    const campOff = off.rows.find((x: any) => x.key === 'camp')
    const campOn = on.rows.find((x: any) => x.key === 'camp')
    expect(campOff.active).toBe(false)
    expect(campOff.off).toBe('Not included, add a night in the dunes')
    expect(campOn).toMatchObject({ low: 4 * 2000, high: 4 * 4500 })
    expect(on.group.low - off.group.low).toBe(4 * 2000)
  })

  it('prices entries and fees per person, and a per-day fee per person per day', () => {
    const dest = byKey.meghalaya
    const r = engine.calculate(dest, { ...engine.defaultInputs(dest), people: 3, days: 6, nights: 5 })
    const registration = r.rows.find((x: any) => x.key === 'registration')
    expect(registration).toMatchObject({ low: 3 * 100, high: 3 * 200 })
    const entries = r.rows.find((x: any) => x.key === 'entries')
    expect(entries).toMatchObject({ low: 3 * 600, high: 3 * 1400 })
  })

  it('rounds rooms up at two people per room', () => {
    const dest = byKey.goa
    expect(engine.calculate(dest, { ...engine.defaultInputs(dest), people: 4 }).rooms).toBe(2)
    expect(engine.calculate(dest, { ...engine.defaultInputs(dest), people: 5 }).rooms).toBe(3)
  })

  it('formatWith Indian grouping, rounded to the nearest 100', () => {
    expect(engine.formatInr(123449)).toBe('₹1,23,400')
    expect(engine.formatRange({ low: 1220, high: 1220 })).toBe('₹1,200')
  })

  it('says what it did with empty, negative and impossible values', () => {
    const dest = byKey.ladakh
    const m = engine.fieldMessages(dest, { days: '', nights: '9', people: '-1', mileage: '0', stayLow: '', stayHigh: '1500' })
    expect(m.stayLow).toMatch(/Counted as 0/)
    expect(m.people).toMatch(/Negative/)
    expect(m.mileage).toMatch(/not counted until/)
    expect(engine.fieldMessages(dest, { stayLow: '2500', stayHigh: '1500' }).stayHigh).toBe('Low and high were swapped.')
    expect(engine.fieldMessages(dest, { days: '', days2: '' }).days).toBe('A trip needs at least 1 day.')
    expect(engine.fieldMessages(dest, { days: '0', nights: '0' }).days).toBe('A trip needs at least 1 day.')
    expect(engine.fieldMessages(dest, { days: '5', nights: '9' }).nights).toMatch(/More nights than days/)
  })

  it('leaves the group line out for a solo traveller', () => {
    const dest = byKey.ladakh
    const solo = engine.calculate(dest, { ...engine.defaultInputs(dest), people: 1 })
    expect(engine.renderHeroHTML(solo)).not.toContain('class="group"')
    expect(engine.renderHeroHTML(engine.calculate(dest, engine.defaultInputs(dest)))).toContain('class="group"')
  })
})

describe('calculator link state', () => {
  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: keeps the default page address clean', (_key, dest) => {
    expect(engine.serializeInputs(dest, engine.defaultInputs(dest))).toBe('')
  })

  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: round-trips a changed estimate through the query string', (_key, dest) => {
    const changed = {
      ...engine.defaultInputs(dest),
      people: 5,
      days: 6,
      nights: 5,
      stay: Object.keys(dest.stays)[Object.keys(dest.stays).length - 1],
    }
    const tier = dest.stays[changed.stay]
    changed.stayLow = tier.low
    changed.stayHigh = tier.high
    const back = engine.parseInputs(dest, '?' + engine.serializeInputs(dest, changed))
    expect(engine.calculate(dest, back).group).toEqual(engine.calculate(dest, changed).group)
    expect(back.people).toBe(5)
    expect(back.days).toBe(6)
    expect(back.stay).toBe(changed.stay)
  })

  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: ignores junk and out-of-range values', (_key, dest) => {
    const back = engine.parseInputs(dest, '?r=nope&p=abc&d=9999&mi=0&s=palace&km=zzz&g=nonsense')
    expect(back).toEqual(engine.defaultInputs(dest))
  })

  it('keeps an optional extra in the link whether it is on or off', () => {
    const dest = byKey.goa
    const on = { ...engine.defaultInputs(dest), nightlifeOn: true }
    expect(engine.parseInputs(dest, '?' + engine.serializeInputs(dest, on)).nightlifeOn).toBe(true)
    const off = { ...engine.defaultInputs(dest), nightlifeOn: false }
    expect(engine.parseInputs(dest, '?' + engine.serializeInputs(dest, off)).nightlifeOn).toBe(false)
    // ...and the two addresses are only ever the same when the estimate is.
    expect(engine.serializeInputs(dest, on)).not.toBe(engine.serializeInputs(dest, off))
  })

  it('tolerates a copy that still carries the fragment', () => {
    const dest = byKey.goa
    expect(engine.parseInputs(dest, '?p=6#/result').people).toBe(6)
  })

  it('moves nights with days when only days is in the link', () => {
    expect(engine.parseInputs(byKey.goa, '?d=10').nights).toBe(9)
  })

  it('opens every Ladakh address shared in 2026 with the numbers it named', () => {
    const dest = byKey.ladakh
    // The exact parameter names the page has been handing out: r, km, d, n, p,
    // b, rent, rl, rh, mi, fp, sl, sh, fl, fh, env, wl, rcf, ml, mh, s, f, rc.
    const back = engine.parseInputs(
      dest,
      '?r=delhi&km=3400&d=12&n=11&p=4&b=3&rent=1&rl=1800&rh=2200&mi=32&fp=112&s=hotel&sl=2500&sh=5000&f=cafe&fl=800&fh=1200&env=450&wl=25&rcf=50&ml=2000&mh=3000&rc=0',
    )
    expect(back).toMatchObject({
      route: 'delhi', kmLow: 3400, kmHigh: 3400, days: 12, nights: 11, people: 4, units: 3, bike: 'rent',
      rentLow: 1800, rentHigh: 2200, mileage: 32, fuelPrice: 112, stay: 'hotel', stayLow: 2500, stayHigh: 5000,
      food: 'cafe', foodLow: 800, foodHigh: 1200, permitsLow: 450, permitsDayLow: 25, permitsAdd: 50,
      miscLow: 2000, miscHigh: 3000, permitsAddOn: false,
    })
    const r = engine.calculate(dest, back)
    expect(r.rows.find((x: any) => x.key === 'permits').low).toBe(4 * (450 + 25 * 12))
  })

  it('keeps a link that names only the stay tier priced at that tier', () => {
    const dest = byKey.ladakh
    const back = engine.parseInputs(dest, '?s=camp')
    expect(back.stay).toBe('camp')
    expect(back.stayLow).toBe(500)
    expect(back.stayHigh).toBe(1500)
  })
})

describe('calculator hand-off', () => {
  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: carries the visitor\'s own numbers into /new', (_key, dest) => {
    const input = engine.defaultInputs(dest)
    const path = engine.prefillPath(dest, input, engine.calculate(dest, input))
    const url = new URL(path, 'https://www.yatraflow.in')
    expect(url.pathname).toBe('/new')
    expect(url.searchParams.get('ref')).toBe('calculator')
    expect(url.searchParams.get('calc')).toBe(dest.key)
    expect(url.searchParams.get('dest')).toBe(dest.dest)
    expect(url.searchParams.get('days')).toBe(String(input.days))
    expect(url.searchParams.get('people')).toBe(String(input.people))
    // The app's own vocabularies, never the calculator's internal option keys.
    expect(['car', 'train', 'flight', 'taxi', 'motorcycle', 'bus']).toContain(url.searchParams.get('mode'))
    expect(['budget', 'comfort', 'luxury']).toContain(url.searchParams.get('stay'))
    expect(Number(url.searchParams.get('budget'))).toBeGreaterThan(0)
    expect(Number(url.searchParams.get('budget')) % 100).toBe(0)
  })

  it('shares a group-chat message with the numbers and the reproducing link', () => {
    const dest = byKey.goa
    const input = engine.defaultInputs(dest)
    const res = engine.calculate(dest, input)
    const text = engine.shareText(dest, input, res, 'https://www.yatraflow.in/goa-trip-cost-calculator/')
    expect(text).toContain('Goa trip, 4 days, 4 people')
    expect(text).toContain(engine.formatRange(res.perPerson))
    expect(text).toContain('Planning estimate')
    expect(text).toContain('https://www.yatraflow.in/goa-trip-cost-calculator/')
  })
})

describe('calculator pages', () => {
  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: the committed file is exactly what the generator renders today', (_key, dest) => {
    expect(committed(dest.slug).replace(/\r\n/g, '\n')).toBe(PAGES[dest.slug])
  })

  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: the embedded runtime config reproduces the whole-destination model', (_key, dest) => {
    // The browser only ever sees the trimmed config embedded in the page. If it
    // is missing a field the model reads (a name, an off-label, a default), the
    // live page disagrees with the pre-rendered HTML in front of a visitor —
    // which is exactly how a breakdown row rendered "undefined" once.
    const runtime = JSON.parse(JSON.stringify(build.runtimeConfig(dest)))
    const input = engine.defaultInputs(dest)
    expect(engine.calculate(runtime, input)).toEqual(engine.calculate(dest, input))
    expect(engine.renderBreakdownHTML(engine.calculate(runtime, input), runtime)).toBe(
      engine.renderBreakdownHTML(engine.calculate(dest, input), dest),
    )
    expect(engine.renderBreakdownHTML(engine.calculate(runtime, input), runtime)).not.toContain('undefined')
    // A default page must still keep a clean address in the browser, which is
    // the only place this config is ever used.
    expect(engine.serializeInputs(runtime, input)).toBe('')
    expect(engine.prefillPath(runtime, input, engine.calculate(runtime, input))).toBe(
      engine.prefillPath(dest, input, engine.calculate(dest, input)),
    )
  })

  it('renders the committed hub exactly', () => {
    expect(committed('trip-cost-calculators').replace(/\r\n/g, '\n')).toBe(rendered.hub)
  })

  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: writes the default estimate into the raw HTML', (_key, dest) => {
    const html = committed(dest.slug)
    const input = engine.defaultInputs(dest)
    const res = engine.calculate(dest, input)
    // The blocks are the exact output of the shared markup functions, so a
    // crawler reads the same rupees the browser shows on load.
    expect(html).toContain(`<!--gen:hero-->\n${engine.renderHeroHTML(res)}\n<!--/gen:hero-->`)
    expect(html).toContain(`<!--gen:breakdown-->\n${engine.renderBreakdownHTML(res, dest)}\n<!--/gen:breakdown-->`)
    expect(html).toContain(`<!--gen:status-->${engine.statusText(res)}<!--/gen:status-->`)
    expect(html.match(/<!--gen:hero-->/g)).toHaveLength(2) // the summary and the full card
    expect(res.perPerson.low).toBeGreaterThan(0)
  })

  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: carries both structured-data blocks, and the FAQ one matches the page', (_key, dest) => {
    const html = committed(dest.slug)
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/g)].map((m) => JSON.parse(m[1]))
    expect(blocks).toHaveLength(2)
    const web = blocks.find((b) => b['@type'] === 'WebApplication')
    const faq = blocks.find((b) => b['@type'] === 'FAQPage')
    expect(web).toBeDefined()
    expect(faq).toBeDefined()
    expect(web.applicationCategory).toBe('TravelApplication')
    expect(web.inLanguage).toBe('en-IN')
    expect(web.offers).toMatchObject({ price: '0', priceCurrency: 'INR' })
    expect(web.dateModified).toBe(dest.dateModified)
    expect(web.url).toBe(`https://www.yatraflow.in/${dest.slug}/`)
    // Every question AND answer in the schema must be the one on the page —
    // Google penalises a FAQPage whose answers a visitor cannot see.
    const summaries = [...html.matchAll(/<summary>([^<]*)<\/summary>/g)]
      .map((m) => unescapeHtml(m[1]))
      .filter((q) => dest.faqs.some((f: any) => f.q === q))
    expect(summaries).toEqual(dest.faqs.map((f: any) => f.q))
    expect(faq.mainEntity.map((e: any) => e.name)).toEqual(dest.faqs.map((f: any) => f.q))
    expect(faq.mainEntity.map((e: any) => e.acceptedAnswer.text)).toEqual(dest.faqs.map((f: any) => f.a))
  })

  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: has the SEO tags in the raw HTML', (_key, dest) => {
    const html = committed(dest.slug)
    expect(html).toContain(`<title>${dest.title}</title>`)
    expect(html.trim().split('\n')[0]).toBe('<!doctype html>')
    expect(html).toContain(`<link rel="canonical" href="https://www.yatraflow.in/${dest.slug}/">`)
    expect(html).toContain(dest.h1)
    expect(html.match(/<h1>/g)).toHaveLength(1)
    expect(html).toContain(`<meta property="og:image" content="https://www.yatraflow.in${dest.ogImage}">`)
    expect(html).toContain('Prices checked ' + dest.pricesChecked)
    expect(html).toContain('Planning estimate, not a quote')
    // Under the length a search result will actually print.
    expect(dest.title.length).toBeLessThanOrEqual(65)
  })

  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: loads Vercel analytics and one shared stylesheet', (_key, dest) => {
    const html = committed(dest.slug)
    expect(html).toContain('<script defer src="/_vercel/insights/script.js"></script>')
    expect(html).toContain('<link rel="stylesheet" href="/calculators/shared.css">')
    expect(html).toContain('<script type="module" src="/calculators/client.js"></script>')
    expect(html).not.toContain('<style>') // the stylesheet is shared and cached, not inlined
  })

  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: has one CTA with the prefill address, plus the WhatsApp share', (_key, dest) => {
    const html = committed(dest.slug)
    expect(html.match(/class="cta"/g)).toHaveLength(1)
    expect(html).toContain(`href="https://www.yatraflow.in/new?ref=calculator&amp;calc=${dest.key}`)
    expect(html.match(/id="wa"/g)).toHaveLength(1)
    expect(html).toContain('href="https://wa.me/?text=')
    expect(html).toContain('Share estimate on WhatsApp')
    expect(html).toContain('Plan this trip with your group')
  })

  it.each(DESTINATIONS.map((d) => [d.key, d] as const))('%s: has no button element, no inline script and no raw animation durations', (_key, dest) => {
    const html = committed(dest.slug)
    expect(html).not.toContain('<button')
    // Only the JSON config and the module import; no inline behaviour.
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((m) => m[1])
    for (const attrs of scripts) {
      expect(attrs).toMatch(/type="application\/ld\+json"|type="application\/json"|defer src="\/_vercel\/insights\/script\.js"|type="module" src="\/calculators\/client\.js"/)
    }
  })

  it('keeps third-party blog mentions out of the above-the-fold copy', () => {
    // The sources list names the third-party guides; nothing above <section
    // class="below"> may. That is the leak the audit found in the Reel.
    for (const dest of DESTINATIONS) {
      const html = committed(dest.slug)
      const cut = html.indexOf('<section class="below"')
      expect(cut, dest.slug).toBeGreaterThan(0)
      const aboveTheFold = html.slice(0, cut)
      // Visible copy only: a `#src-dheeraj` anchor is a link to the source
      // list, not a mention of the blog in the reader's face.
      const visibleText = aboveTheFold.replace(/<[^>]+>/g, ' ')
      expect(visibleText).not.toMatch(/Discover with Dheeraj|Tata Capital|Ladakh Bikers|Rent n Hop/i)
      expect(aboveTheFold).not.toContain('discoverwithdheeraj.com')
      expect(html).toContain('Read the sources')
    }
  })

  it('links every destination to its siblings and the hub', () => {
    for (const dest of DESTINATIONS) {
      const html = committed(dest.slug)
      for (const sibling of dest.siblings) expect(html, sibling).toContain(`href="/${sibling}/"`)
      expect(html).toContain('href="/trip-cost-calculators/"')
    }
  })

  it('builds a hub that links every live calculator', () => {
    const hub = committed('trip-cost-calculators')
    for (const dest of DESTINATIONS) expect(hub).toContain(`href="/${dest.slug}/"`)
    expect(hub).toContain('"@type": "CollectionPage"')
    expect(hub).toContain('<script defer src="/_vercel/insights/script.js"></script>')
  })

  it('motion comes from tokens: no raw duration in the shared stylesheet', () => {
    const css = read('../calculators/shared.css')
    const raw = css
      .split('\n')
      .filter((line) => /[:\s,]\d*\.?\d+m?s[\s;}]/.test(line) && !line.includes('--motion-') && !line.includes('scroll'))
    expect(raw).toEqual([])
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('ships a 1200x630 PNG card per destination', () => {
    for (const dest of DESTINATIONS) {
      const png = readFileSync(new URL(`../public${dest.ogImage}`, import.meta.url))
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
      expect(png.readUInt32BE(16)).toBe(1200)
      expect(png.readUInt32BE(20)).toBe(630)
    }
  })

  it('publishes the shared runtime once, not once per destination', () => {
    for (const file of ['core.js', 'client.js', 'shared.css']) {
      expect(read(`../public/calculators/${file}`).length).toBeGreaterThan(1000)
    }
    // The published runtime is a copy, so it cannot silently diverge.
    expect(read('../public/calculators/core.js')).toBe(read('../calculators/engine.mjs'))
    expect(read('../public/calculators/client.js')).toBe(read('../calculators/client.mjs'))
  })
})

describe('calculator routing and discovery wiring', () => {
  const manifest = JSON.parse(read('../calculators/manifest.json'))
  const vercel = JSON.parse(read('../vercel.json')) as {
    redirects: Array<{ source: string; destination: string; permanent?: boolean }>
    rewrites: Array<{ source: string; destination: string }>
  }
  const sw = read('../public/sw.js')
  const sitemap = read('../api/sitemap.js')

  const paths = [manifest.hub, ...manifest.calculators.map((c: any) => c.slug)]
  const catchAll = vercel.rewrites.find((r) => r.destination === '/index.html')
  const catchAllRe = new RegExp(`^${catchAll?.source ?? '$^'}$`)

  it('the manifest lists every destination the generator knows', () => {
    expect(manifest.calculators.map((c: any) => c.slug)).toEqual(DEST_SLUGS)
    expect(manifest.generated).toBe(true)
  })

  it('redirects the slash-less path to the slash form, permanently, for every page', () => {
    for (const path of paths) {
      const redirect = vercel.redirects?.find((r) => r.source === `/${path}`)
      expect(redirect, path).toBeDefined()
      expect(redirect?.destination).toBe(`/${path}/`)
      expect(redirect?.permanent).toBe(true)
    }
  })

  it('keeps the SPA catch-all exempting every static calculator path', () => {
    expect(catchAll).toBeDefined()
    for (const path of paths) {
      expect(catchAllRe.test(`/${path}/`), path).toBe(false)
      expect(catchAllRe.test(`/${path}/index.html`), path).toBe(false)
    }
    expect(catchAllRe.test('/calculators/client.js')).toBe(false)
    expect(catchAllRe.test('/og/calc-goa.png')).toBe(false)
  })

  it('keeps the other catch-all exemptions intact', () => {
    for (const path of ['/sw.js', '/manifest.webmanifest', '/robots.txt', '/sitemap.xml', '/api/sitemap']) {
      expect(catchAllRe.test(path), path).toBe(false)
    }
    expect(catchAllRe.test('/trips')).toBe(true)
    expect(catchAllRe.test('/goa')).toBe(true) // a near-miss slug is still an app route
  })

  it('keeps the service worker off every calculator path', () => {
    for (const path of paths) expect(sw, path).toContain(`'/${path}/'`)
    expect(sw).toContain("'/calculators/'")
  })

  it('lists every calculator and the hub in the sitemap, and nothing dead', () => {
    const listed = [...sitemap.matchAll(/^ {2}'(\/[^']*\/)',$/gm)].map((m) => m[1])
    expect(listed.sort()).toEqual(paths.map((p: string) => `/${p}/`).sort())
  })

  it('the hand-off vocabulary and the published destinations are the same list', async () => {
    // /new?ref=calculator&calc=<slug>: the app drops a slug the calculators do
    // not publish, and a new destination has to be added in both places. Read
    // through a variable path so the TS project does not need its types.
    const prefillPath = '../src/lib/calcPrefill'
    const prefill: any = await import(prefillPath)
    expect([...prefill.CALC_PREFILL_SLUGS].sort()).toEqual(manifest.calculators.map((c: any) => c.key).sort())
  })

  it('links the hub from the app footer and the no-JS shell', () => {
    expect(read('../src/App.tsx')).toContain('href="/trip-cost-calculators/"')
    expect(read('../index.html')).toContain('href="/trip-cost-calculators/"')
    expect(read('../index.html')).toContain('href="/goa-trip-cost-calculator/"')
  })
})
