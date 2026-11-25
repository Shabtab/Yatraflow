// ============ Shared engine for the YatraFlow trip cost calculators ============
// Pure: no DOM, no globals, no fetch. `tests/calculators.test.ts` imports this
// file directly, and `scripts/build-calculators.mjs` writes the generated
// <!--gen:*--> blocks in every calculator page from the SAME functions, so the
// static HTML a crawler reads can never drift from the model a visitor sees.
//
// One destination is described entirely by its JSON in calculators/destinations/:
// routes, segmented choices ("groups"), and an ordered list of cost lines. A
// line is one row of the breakdown, and its `kind` picks the arithmetic:
//
//   km          distance / mileage * fuel price * units   (a driven or ridden leg)
//   unit-day    units * days * rate                       (a rental or a cab with driver)
//   person-day  people * days * rate                      (food)
//   person      people * (rate + dayRate * days + addOn)  (entries, permits, fees)
//   room-night  rooms * nights * rate                     (stay)
//   flat        rate, once                                (a booking fee)
//
// A line can be gated by a group's chosen value (`when`) or by its own checkbox
// (`optional`), which is how "I ride my own bike" removes bike rent without a
// second copy of the model.

const MAX_PEOPLE = 40
const MAX_DAYS = 90

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Round to the nearest 100 rupees, for display. */
export function round100(v) {
  return Math.round(v / 100) * 100
}

/** "₹30,700" with Indian digit grouping, rounded to the nearest 100. */
export function formatInr(v) {
  return '₹' + round100(v).toLocaleString('en-IN')
}

/** Plain-text range, for the status line and the pinned bar. */
export function formatRange(r) {
  const lo = formatInr(r.low)
  const hi = formatInr(r.high)
  return lo === hi ? lo : `${lo} – ${hi}`
}

/** A low/high pair in the right order, whichever way the visitor typed it. */
function ordered(low, high) {
  const a = num(low)
  const b = num(high)
  return a <= b ? [a, b] : [b, a]
}

// ---------------- Inputs ----------------

const money = (obj) => ({ low: num(obj?.low), high: num(obj?.high ?? obj?.low) })

/** Resolve a line's multiplier. `units` is either a fixed count, the visitor's
 *  own count (a destination that asks for bikes), a headcount, or one per two
 *  travellers — a scooty between two people is the case that needs the halves. */
function resolveUnits(line, input, people) {
  if (typeof line.units === 'number') return line.units
  if (line.units === 'people') return people
  if (line.units === 'half-people') return Math.ceil(people / 2)
  if (line.units === 'units') return Math.floor(num(input.units))
  return 1
}

function tierRates(tiers, key, fallback) {
  const t = tiers?.[key] ?? tiers?.[fallback]
  return t ? { low: num(t.low), high: num(t.high) } : { low: 0, high: 0 }
}

/** The default inputs for a route: distance, days and nights follow the route,
 *  rates follow the destination's own defaults. */
export function inputsForRoute(dest, routeKey) {
  const known = Boolean(dest.routes[routeKey])
  const key = known ? routeKey : dest.defaultRoute
  const route = dest.routes[key]
  const days = route.days
  const km = dest.kmFromRoute ? num(route.km) : num(dest.kmDefault)
  const kmHigh = dest.kmFromRoute ? num(route.kmHigh ?? route.km) : km
  const stay = dest.defaults.stay ?? Object.keys(dest.stays)[0]
  const food = dest.defaults.food ?? Object.keys(dest.foods)[0]
  const stayRate = tierRates(dest.stays, stay, Object.keys(dest.stays)[0])
  const foodRate = tierRates(dest.foods, food, Object.keys(dest.foods)[0])

  const input = {
    route: key,
    days,
    nights: Math.max(0, days - 1),
    people: dest.defaults.people ?? 2,
    kmLow: km,
    kmHigh,
    mileage: num(dest.fuel?.mileage) || 15,
    fuelPrice: num(dest.fuel?.price) || 105,
    units: dest.units ? num(dest.units.default) : 1,
    stay,
    stayLow: stayRate.low,
    stayHigh: stayRate.high,
    food,
    foodLow: foodRate.low,
    foodHigh: foodRate.high,
  }
  for (const g of dest.groups) input[g.key] = dest.defaults[g.key] ?? g.options[0].value
  for (const line of dest.lines) {
    // A tiered line takes its base rate from the chosen tier, never from a
    // second copy of the same numbers in the line config.
    const rate = line.tier
      ? tierRates(line.tier === 'stay' ? dest.stays : dest.foods, input[line.key])
      : money(line.rate)
    input[`${line.key}Low`] = rate.low
    input[`${line.key}High`] = rate.high
    if (line.dayRate) {
      const day = money(line.dayRate)
      input[`${line.key}DayLow`] = day.low
      input[`${line.key}DayHigh`] = day.high
    }
    // An optional line is an extra: off until the visitor asks for it.
    if (line.optional) input[`${line.key}On`] = line.on === true
    if (line.addOn) {
      input[`${line.key}AddOn`] = line.addOn.on !== false
      // The amount is an input's value, not just a fallback: leaving it unset
      // rendered value="undefined", the browser sent the string, and every
      // optional contribution silently priced at zero.
      input[`${line.key}Add`] = num(line.addOn.amount)
    }
  }
  return input
}

export function defaultInputs(dest) {
  return inputsForRoute(dest, dest.defaultRoute)
}

/** The tier rates a segmented control must write when it changes, so the panel
 *  and the model never disagree about what "Comfort" means. */
export function tierChange(dest, line, value) {
  return tierRates(line.tier === 'stay' ? dest.stays : dest.foods, value)
}

// ---------------- The model ----------------

/** Is this line in play for the current choices? */
export function lineActive(line, input) {
  if (line.optional && input[`${line.key}On`] === false) return false
  if (line.when) {
    const chosen = input[line.when.group]
    if (!line.when.in.includes(chosen)) return false
  }
  return true
}

function lineAmount(dest, line, input, ctx) {
  const { people, rooms, days, nights } = ctx
  const [low, high] = ordered(input[`${line.key}Low`], input[`${line.key}High`])
  const units = resolveUnits(line, input, people)

  switch (line.kind) {
    case 'km': {
      const mileage = num(input.mileage)
      const price = num(input.fuelPrice)
      if (mileage <= 0 || units <= 0) return { low: 0, high: 0 }
      const [kmLow, kmHigh] = ordered(input.kmLow, input.kmHigh)
      return {
        low: (kmLow / mileage) * price * units,
        high: (kmHigh / mileage) * price * units,
      }
    }
    case 'unit-day':
      return { low: units * days * low, high: units * days * high }
    case 'person-day':
      return { low: people * days * low, high: people * days * high }
    case 'person': {
      const [dayLow, dayHigh] = ordered(input[`${line.key}DayLow`], input[`${line.key}DayHigh`])
      const add = line.addOn && input[`${line.key}AddOn`] !== false
        ? num(input[`${line.key}Add`] ?? line.addOn.amount)
        : 0
      return {
        low: people * (low + dayLow * days + add),
        high: people * (high + dayHigh * days + add),
      }
    }
    case 'room-night':
      return { low: rooms * nights * low, high: rooms * nights * high }
    case 'flat':
      return { low, high }
    default:
      return { low: 0, high: 0 }
  }
}

/**
 * Returns the low/high rupee totals for the group and per person, the ordered
 * breakdown rows, and the warnings that are worth saying out loud. Never
 * returns NaN: a blank or junk field counts as 0 and gets a field message.
 */
export function calculate(dest, input) {
  const people = Math.max(1, Math.min(MAX_PEOPLE, Math.floor(num(input.people))))
  const days = num(input.days)
  const nights = num(input.nights)
  const rooms = Math.ceil(people / (dest.peoplePerRoom ?? 2))
  const ctx = { people, rooms, days, nights }

  const rows = []
  let low = 0
  let high = 0
  for (const line of dest.lines) {
    const active = lineActive(line, input)
    if (!active) {
      rows.push({ key: line.key, name: line.name, active: false, off: line.offLabel ?? null })
      continue
    }
    const amount = lineAmount(dest, line, input, ctx)
    rows.push({ key: line.key, name: line.name, active: true, low: amount.low, high: amount.high })
    low += amount.low
    high += amount.high
  }

  const fuelLine = dest.lines.find((l) => l.kind === 'km')
  const unitLine = dest.lines.find((l) => l.units === 'units')

  return {
    people,
    rooms,
    days,
    nights,
    rows,
    group: { low, high },
    perPerson: { low: low / people, high: high / people },
    fuelUncounted: Boolean(fuelLine) && lineActive(fuelLine, input) && num(input.mileage) <= 0,
    fewerPeopleThanUnits: Boolean(unitLine) && people < num(input.units),
    manyPeoplePerUnit: Boolean(unitLine) && num(input.units) > 0 && people > num(input.units) * 2,
  }
}

/** The mid figure the trip hand-off carries as a starting budget. */
export function midPerPerson(res) {
  return round100((res.perPerson.low + res.perPerson.high) / 2)
}

// ---------------- Field messages ----------------

const NUMERIC_SUFFIX = ['Low', 'High', 'DayLow', 'DayHigh', 'Add']
const PARAM_KEY = { Low: 'low', High: 'high', DayLow: 'day', DayHigh: 'dayHigh', Add: 'add' }
const paramFor = (params, suffix) => params[PARAM_KEY[suffix]]

/** Field id -> input key, for every numeric control the page renders. */
export function numericFields(dest) {
  const fields = ['days', 'nights', 'people', 'mileage', 'fuelPrice']
  if (dest.units) fields.push('units')
  if (dest.lines.some((l) => l.kind === 'km')) fields.push('km')
  for (const line of dest.lines) {
    // A km line prices fuel from the distance and the two pump figures, so it
    // has no money rate of its own to check.
    if (line.kind !== 'km') fields.push(`${line.key}Low`, `${line.key}High`)
    if (line.dayRate) fields.push(`${line.key}DayLow`, `${line.key}DayHigh`)
    if (line.addOn) fields.push(`${line.key}Add`)
  }
  return fields
}

/**
 * Messages for the raw field values (strings, as typed). Returns a map of
 * field id to one sentence. The model never fails on bad input; these
 * messages say what it did instead.
 */
export function fieldMessages(dest, raw) {
  const out = {}
  // days, nights and people have a floor of their own, so an empty one is
  // answered by the sentence below rather than by "counted as 0".
  const hasFloor = new Set(['days', 'nights', 'people', 'km'])
  for (const id of numericFields(dest)) {
    const s = String(raw[id] ?? '').trim()
    if (s === '') {
      if (!hasFloor.has(id)) out[id] = 'Counted as 0. Enter a number to include it.'
      continue
    }
    if (!Number.isFinite(Number(s))) out[id] = 'Counted as 0. Enter a number to include it.'
    else if (Number(s) < 0) out[id] = 'Negative values count as 0.'
  }
  const days = Number(raw.days)
  if (!out.days && Number.isFinite(days) && days < 1) out.days = 'A trip needs at least 1 day.'
  if (!out.mileage && Number(raw.mileage) === 0) out.mileage = 'Fuel is not counted until you enter a mileage.'
  if (!out.nights && Number(raw.nights) > days && days >= 1) out.nights = 'More nights than days. Check the dates.'
  for (const line of dest.lines) {
    const pairs = [['Low', 'High'], ['DayLow', 'DayHigh']]
    for (const [lo, hi] of pairs) {
      const loId = `${line.key}${lo}`
      const hiId = `${line.key}${hi}`
      if (out[loId] || out[hiId]) continue
      if (raw[loId] === undefined || raw[hiId] === undefined) continue
      if (Number(raw[loId]) > Number(raw[hiId])) out[hiId] = 'Low and high were swapped.'
    }
  }
  return out
}

// ---------------- Link state ----------------
// Only values that differ from the route's defaults go into the link, so the
// default page keeps a clean address.

const BOUNDS = {
  km: [0, 20000], days: [1, MAX_DAYS], nights: [0, MAX_DAYS], people: [1, MAX_PEOPLE], units: [0, MAX_PEOPLE],
  rate: [0, 100000], mileage: [1, 200], fuel: [0, 500], money: [0, 100000],
}

const GLOBAL_PARAMS = {
  days: ['d', 'days'], nights: ['n', 'nights'], people: ['p', 'people'],
  mileage: ['mi', 'mileage'], fuelPrice: ['fp', 'fuel'],
}

export function serializeInputs(dest, input) {
  const base = inputsForRoute(dest, input.route)
  const p = new URLSearchParams()
  if (input.route !== dest.defaultRoute) p.set('r', input.route)
  if (Number(input.kmLow) !== base.kmLow || Number(input.kmHigh) !== base.kmHigh) {
    // A ranged route keeps its two ends in one param only when they agree;
    // otherwise the low end rides `km` and the high end `kmh`.
    p.set('km', String(Number(input.kmLow)))
    if (Number(input.kmHigh) !== Number(input.kmLow)) p.set('kmh', String(Number(input.kmHigh)))
  }
  if (dest.units && Number(input.units) !== base.units) p.set(dest.units.param, String(Number(input.units)))
  for (const [key, [param]] of Object.entries(GLOBAL_PARAMS)) {
    const v = input[key]
    if (v === null || v === '' || !Number.isFinite(Number(v))) continue
    if (Number(v) !== Number(base[key] ?? NaN)) p.set(param, String(Number(v)))
  }
  const differs = (id) => {
    const v = input[id]
    if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return false
    return Number(v) !== Number(base[id] ?? NaN)
  }
  for (const line of dest.lines) {
    const params = line.params ?? {}
    // A pair goes out as a pair. Writing only the end that moved leaves a link
    // that names one number, and one number means a flat fee — so an edited low
    // would collapse a range on the next open.
    for (const [loSuffix, hiSuffix] of [['Low', 'High'], ['DayLow', 'DayHigh']]) {
      const loParam = paramFor(params, loSuffix)
      if (!loParam || !differs(`${line.key}${loSuffix}`) && !differs(`${line.key}${hiSuffix}`)) continue
      p.set(loParam, String(Number(input[`${line.key}${loSuffix}`])))
      const hiParam = paramFor(params, hiSuffix)
      if (hiParam) p.set(hiParam, String(Number(input[`${line.key}${hiSuffix}`])))
    }
    const addParam = paramFor(params, 'Add')
    if (addParam && differs(`${line.key}Add`)) p.set(addParam, String(Number(input[`${line.key}Add`])))
    if (line.tier && input[line.key] !== base[line.key]) p.set(line.tierParam, input[line.key])
    if (line.optional) {
      // An optional extra is off by default, so the link has to be able to say
      // BOTH things: `=1` keeps an estimate that includes it, `=0` one that does
      // not. Anything equal to the destination's own default stays out.
      const on = input[`${line.key}On`] !== false
      if (on !== (base[`${line.key}On`] !== false)) p.set(params.off ?? `${line.key}off`, on ? '1' : '0')
    }
    if (line.addOn && params.off && input[`${line.key}AddOn`] === false && base[`${line.key}AddOn`] !== false) {
      p.set(params.off, '0')
    }
  }
  for (const g of dest.groups) {
    const chosen = input[g.key]
    if (chosen === (dest.defaults[g.key] ?? g.options[0].value)) continue
    const option = g.options.find((o) => o.value === chosen)
    if (option?.param) p.set(option.param, option.token ?? String(chosen))
    else if (g.param) p.set(g.param, String(chosen))
  }
  return p.toString()
}

/** Reads a link's query string back into inputs. Junk values are ignored. */
export function parseInputs(dest, search) {
  let p
  try {
    p = new URLSearchParams(String(search ?? '').split('#')[0])
  } catch {
    return defaultInputs(dest)
  }
  const route = p.get('r')
  const input = inputsForRoute(dest, dest.routes[route] ? route : dest.defaultRoute)
  const within = (raw, key) => {
    if (raw === null || raw.trim() === '') return null
    const n = Number(raw)
    const [lo, hi] = BOUNDS[key]
    return Number.isFinite(n) && n >= lo && n <= hi ? n : null
  }

  const km = within(p.get('km'), 'km')
  if (km !== null && (km > 0 || input.route === 'custom' || !dest.kmFromRoute)) {
    input.kmLow = km
    input.kmHigh = within(p.get('kmh'), 'km') ?? km
  }
  if (dest.units) {
    const u = within(p.get(dest.units.param), 'units')
    if (u !== null) input.units = u
  }
  for (const [key, [param, bounds]] of Object.entries(GLOBAL_PARAMS)) {
    const n = within(p.get(param), bounds)
    if (n !== null) input[key] = n
  }
  // A link that moves the days without the nights keeps the two in step, the
  // way the form does: nights are days minus one unless someone said otherwise.
  if (p.get('d') !== null && p.get('n') === null && within(p.get('d'), 'days') !== null) {
    input.nights = Math.max(0, input.days - 1)
  }
  for (const line of dest.lines) {
    const params = line.params ?? {}
    const read = {}
    for (const suffix of NUMERIC_SUFFIX) {
      const param = paramFor(params, suffix)
      if (!param) continue
      const n = within(p.get(param), suffix === 'Add' ? 'money' : 'rate')
      if (n === null) continue
      input[`${line.key}${suffix}`] = n
      read[suffix] = true
    }
    // A link that names ONE end of a fee means one number: mirroring it stops
    // `ordered()` from swapping ₹450 against an untouched default and quietly
    // pricing ₹400. A link that names both keeps both, and a value that failed
    // to parse mirrors nothing, so junk never invents a flat fee.
    for (const [loSuffix, hiSuffix] of [['Low', 'High'], ['DayLow', 'DayHigh']]) {
      if (!read[loSuffix]) continue
      if (params[PARAM_KEY[hiSuffix]] && p.has(params[PARAM_KEY[hiSuffix]])) continue
      input[`${line.key}${hiSuffix}`] = input[`${line.key}${loSuffix}`]
    }
    if (line.tier) {
      const tiers = line.tier === 'stay' ? dest.stays : dest.foods
      const chosen = p.get(line.tierParam)
      if (tiers[chosen]) {
        input[line.key] = chosen
        if (p.get(line.params?.low ?? '') === null) input[`${line.key}Low`] = num(tiers[chosen].low)
        if (p.get(line.params?.high ?? '') === null) input[`${line.key}High`] = num(tiers[chosen].high)
      }
    }
    if (line.optional) {
      const flag = p.get(params.off ?? `${line.key}off`)
      if (flag === '0') input[`${line.key}On`] = false
      else if (flag === '1') input[`${line.key}On`] = true
    }
    if (line.addOn && params.off && p.get(params.off) === '0') input[`${line.key}AddOn`] = false
  }
  for (const g of dest.groups) {
    for (const option of g.options) {
      if (!option.param) continue
      if (p.get(option.param) === (option.token ?? option.value)) {
        input[g.key] = option.value
        break
      }
    }
    if (g.param && p.get(g.param) && g.options.some((o) => o.value === p.get(g.param))) {
      input[g.key] = p.get(g.param)
    }
  }
  return input
}

// ---------------- Markup ----------------
// Strings only, so the same code writes the static HTML and the live update.

const amt = (v) => `<span class="amt">${formatInr(v)}</span>`

export function rangeHTML(r) {
  const lo = formatInr(r.low)
  const hi = formatInr(r.high)
  return lo === hi ? amt(r.low) : `${amt(r.low)} – ${amt(r.high)}`
}

const peopleText = (n) => `${n} ${n === 1 ? 'person' : 'people'}`

/** The hero: the per-person range first, the group range second. */
export function renderHeroHTML(res) {
  return (
    `<p class="who">Per person</p>` +
    `<p class="big">${rangeHTML(res.perPerson)}</p>` +
    (res.people > 1 ? `<p class="group">${rangeHTML(res.group)} for ${peopleText(res.people)}</p>` : '')
  )
}

/** One sentence for the screen-reader status line. */
export function statusText(res) {
  return `Estimate ${formatRange(res.perPerson)} per person, ${formatRange(res.group)} for ${peopleText(res.people)}.`
}

/** Text nodes the breakdown writes from the destination config. Escaped here
 *  because the live page assigns the result with innerHTML: a label is data,
 *  and data never gets to close a tag. */
const text = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const pct = (v) => Math.round(v * 1000) / 10

/** The breakdown rows. Each bar runs solid to the low figure, then striped to
 *  the high figure, on one shared scale. An inactive line that names a reason
 *  prints as an "off" row; one without a reason is not in this trip and is
 *  left out entirely. */
export function renderBreakdownHTML(res, dest) {
  const live = res.rows.filter((r) => r.active || r.off)
  const scale = Math.max(1, ...live.map((r) => (r.active ? r.high : 0)))
  return live
    .map((r) => {
      if (!r.active) {
        return `<li class="off"><span class="cat">${text(r.name)}</span><span class="val">${text(r.off)}</span></li>`
      }
      const lo = pct(r.low / scale)
      const span = pct((r.high - r.low) / scale)
      const hi = span > 0 ? `<i class="hi" data-k="${r.key}-hi" style="width:${span}%"></i>` : ''
      return (
        `<li><span class="cat">${text(r.name)}</span><span class="val">${rangeHTML(r)}</span>` +
        `<span class="bar" aria-hidden="true"><i class="lo" data-k="${r.key}-lo" style="width:${lo}%"></i>${hi}</span></li>`
      )
    })
    .join('\n')
}

// ---------------- Hand-off ----------------

/** The trip-creation address, carrying every choice the visitor already made.
 *  `mode` and `stay` are the app's own vocabulary (see calcPrefill.ts), never
 *  the calculator's internal option keys. */
export function prefillPath(dest, input, res) {
  const p = new URLSearchParams()
  p.set('ref', 'calculator')
  p.set('calc', dest.key)
  p.set('dest', dest.dest)
  const days = Math.round(num(input.days))
  if (days > 0) p.set('days', String(days))
  if (res.people > 0) p.set('people', String(res.people))
  const modeOption = dest.groups.map((g) => g.options.find((o) => o.value === input[g.key])).find(Boolean)
  if (modeOption?.appMode) p.set('mode', modeOption.appMode)
  const stayTier = dest.stays[input.stay]
  if (stayTier?.style) p.set('stay', stayTier.style)
  p.set('budget', String(midPerPerson(res)))
  return `/new?${p.toString()}`
}

/** The message a visitor drops into a group chat: the numbers they just saw,
 *  the link that reproduces them, and no claim beyond "planning estimate". */
export function shareText(dest, input, res, pageUrl) {
  const days = Math.round(num(input.days))
  const head = `${dest.dest} trip${days > 0 ? `, ${days} ${days === 1 ? 'day' : 'days'}` : ''}, ${peopleText(res.people)}`
  return (
    `${head}: ${formatRange(res.perPerson)} per person, ${formatRange(res.group)} for the group. ` +
    `Planning estimate from YatraFlow. Work out yours: ${pageUrl}`
  )
}

// ---------------- Structured data ----------------

/** The `WebApplication` block every calculator page carries. */
export function webApplicationJsonLd(dest, origin = 'https://www.yatraflow.in') {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: dest.h1,
    url: `${origin}/${dest.slug}/`,
    applicationCategory: 'TravelApplication',
    operatingSystem: 'Any',
    inLanguage: 'en-IN',
    datePublished: dest.datePublished ?? dest.dateModified,
    dateModified: dest.dateModified,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
  }
}

/** The `FAQPage` block, built from the SAME questions and answers the page
 *  prints in its <details> blocks. Google rejects a pair that differs. */
export function faqJsonLd(dest) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: dest.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
}

export function renderJsonLd(...blocks) {
  return blocks
    .map((b) => `<script type="application/ld+json">\n${JSON.stringify(b, null, 2)}\n</script>`)
    .join('\n')
}
