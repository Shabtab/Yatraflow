// Pure model and markup for the Ladakh bike trip cost calculator. No DOM and
// no globals, so tests/ladakh-calculator.test.ts can import it directly.
// The result blocks in index.html are generated from the functions at the
// bottom of this file; the test fails when the static HTML drifts from them.

export const ROUTES = {
  delhi: { label: 'Delhi loop via Srinagar, Leh and Manali', kmLow: 3300, kmHigh: 3600, days: 12 },
  manali: { label: 'Manali, Leh and back, with Nubra and Pangong', kmLow: 1600, kmHigh: 1600, days: 8 },
  leh: { label: 'Leh-only rides (Nubra, Pangong)', kmLow: 600, kmHigh: 600, days: 6 },
  custom: { label: 'Custom distance', kmLow: 0, kmHigh: 0, days: 8 },
}

export const STAYS = {
  camp: { label: 'Camp', low: 500, high: 1500 },
  homestay: { label: 'Homestay', low: 1500, high: 2500 },
  hotel: { label: 'Hotel', low: 2500, high: 5000 },
}

export const FOODS = {
  dhaba: { label: 'Dhabas', low: 300, high: 600 },
  cafe: { label: 'Local restaurants and cafes', low: 800, high: 1200 },
}

export const CATEGORIES = ['fuel', 'rent', 'stay', 'food', 'permits', 'misc']
export const CATEGORY_NAMES = {
  fuel: 'Fuel',
  rent: 'Bike rent',
  stay: 'Stay',
  food: 'Food',
  permits: 'Permits and fees',
  misc: 'Buffer',
}

/** Default inputs for a route: distance, days and nights follow the route. */
export function inputsForRoute(route) {
  const r = ROUTES[route] ?? ROUTES.manali
  return {
    route: ROUTES[route] ? route : 'manali',
    kmLow: r.kmLow,
    kmHigh: r.kmHigh,
    days: r.days,
    nights: r.days - 1,
    people: 2,
    bikes: 2,
    rented: false,
    rentLow: 1500, // used only when the rider chooses rented bikes
    rentHigh: 2500,
    mileage: 30,
    fuelPrice: 105,
    stay: 'homestay',
    stayLow: STAYS.homestay.low,
    stayHigh: STAYS.homestay.high,
    food: 'dhaba',
    foodLow: FOODS.dhaba.low,
    foodHigh: FOODS.dhaba.high,
    envFee: 400,
    wildlifePerDay: 20,
    redCross: true,
    redCrossFee: 50,
    miscLow: 1500,
    miscHigh: 2500,
  }
}

export function defaultInputs() {
  return inputsForRoute('manali')
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Round to the nearest 100 rupees, for display. */
export function round100(v) {
  return Math.round(v / 100) * 100
}

/** A low/high pair in the right order, whichever way the rider typed it. */
function ordered(low, high) {
  const a = num(low)
  const b = num(high)
  return a <= b ? [a, b] : [b, a]
}

/**
 * Returns low/high rupee totals for the group and per person, plus the
 * category breakdown. Never returns NaN: bad input counts as 0.
 */
export function calculate(input) {
  const people = Math.max(1, Math.floor(num(input.people)))
  const bikes = Math.floor(num(input.bikes))
  const days = num(input.days)
  const nights = num(input.nights)
  const mileage = num(input.mileage)
  const rooms = Math.ceil(people / 2)

  const [kmLow, kmHigh] = ordered(input.kmLow, input.kmHigh)
  const fuelFor = (km) => (mileage > 0 ? (km / mileage) * num(input.fuelPrice) * bikes : 0)

  const [rentLow, rentHigh] = ordered(input.rentLow, input.rentHigh)
  const rentKnown = Boolean(input.rented) && rentHigh > 0
  const rentFor = (rate) => (rentKnown ? bikes * rate * days : 0)

  const [stayLow, stayHigh] = ordered(input.stayLow, input.stayHigh)
  const [foodLow, foodHigh] = ordered(input.foodLow, input.foodHigh)
  const [miscLow, miscHigh] = ordered(input.miscLow, input.miscHigh)

  const permits =
    people * (num(input.envFee) + num(input.wildlifePerDay) * days + (input.redCross ? num(input.redCrossFee) : 0))

  const breakdown = {
    fuel: { low: fuelFor(kmLow), high: fuelFor(kmHigh) },
    rent: { low: rentFor(rentLow), high: rentFor(rentHigh) },
    stay: { low: rooms * nights * stayLow, high: rooms * nights * stayHigh },
    food: { low: people * days * foodLow, high: people * days * foodHigh },
    permits: { low: permits, high: permits },
    misc: { low: people * miscLow, high: people * miscHigh },
  }

  let low = 0
  let high = 0
  for (const c of CATEGORIES) {
    low += breakdown[c].low
    high += breakdown[c].high
  }

  return {
    people,
    rooms,
    breakdown,
    group: { low, high },
    perPerson: { low: low / people, high: high / people },
    rentMissing: Boolean(input.rented) && !rentKnown,
    fewerPeopleThanBikes: people < bikes,
    manyPeoplePerBike: bikes > 0 && people > bikes * 2,
  }
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

// ---------------- Field messages ----------------

const NUMERIC_FIELDS = [
  'days', 'nights', 'people', 'bikes', 'mileage', 'fuel',
  'stayLow', 'stayHigh', 'foodLow', 'foodHigh', 'env', 'wild', 'miscLow', 'miscHigh',
]

/**
 * Messages for the raw field values (strings, as typed). Returns a map of
 * field id to one sentence. The model never fails on bad input; these
 * messages say what it did instead.
 * @param {Record<string, string>} raw
 */
export function fieldMessages(raw) {
  const out = {}
  for (const id of NUMERIC_FIELDS) {
    const s = String(raw[id] ?? '').trim()
    if (s === '' || !Number.isFinite(Number(s))) out[id] = 'Counted as 0. Enter a number to include it.'
    else if (Number(s) < 0) out[id] = 'Negative values count as 0.'
  }
  const days = Number(raw.days)
  if (!out.days && days < 1) out.days = 'A trip needs at least 1 day.'
  if (!out.mileage && Number(raw.mileage) === 0) out.mileage = 'Fuel is not counted until you enter a mileage.'
  if (!out.nights && Number(raw.nights) > days && days >= 1) out.nights = 'More nights than days. Check the dates.'
  for (const [lo, hi] of [['stayLow', 'stayHigh'], ['foodLow', 'foodHigh'], ['miscLow', 'miscHigh'], ['rentLow', 'rentHigh']]) {
    if (!out[lo] && !out[hi] && Number(raw[lo]) > Number(raw[hi])) out[hi] = 'Low and high were swapped.'
  }
  return out
}

// ---------------- Link state ----------------
// Only values that differ from the route's defaults go into the link, so the
// default page keeps a clean address.

const BOUNDS = {
  km: [0, 20000], days: [1, 90], nights: [0, 90], people: [1, 40], bikes: [0, 40],
  rate: [0, 100000], mileage: [1, 200], fuel: [0, 500], money: [0, 100000],
}

/** field key in the input object -> [url param, bounds key] */
const PARAMS = {
  days: ['d', 'days'], nights: ['n', 'nights'], people: ['p', 'people'], bikes: ['b', 'bikes'],
  rentLow: ['rl', 'rate'], rentHigh: ['rh', 'rate'], mileage: ['mi', 'mileage'], fuelPrice: ['fp', 'fuel'],
  stayLow: ['sl', 'money'], stayHigh: ['sh', 'money'], foodLow: ['fl', 'money'], foodHigh: ['fh', 'money'],
  envFee: ['env', 'money'], wildlifePerDay: ['wl', 'money'], redCrossFee: ['rcf', 'money'],
  miscLow: ['ml', 'money'], miscHigh: ['mh', 'money'],
}

export function serializeInputs(input) {
  const base = inputsForRoute(input.route)
  const p = new URLSearchParams()
  if (input.route !== 'manali') p.set('r', input.route)
  if (Number(input.kmLow) !== base.kmLow || Number(input.kmHigh) !== base.kmHigh) p.set('km', String(input.kmLow))
  for (const [key, [param]] of Object.entries(PARAMS)) {
    const v = input[key]
    if (v === null || v === '' || !Number.isFinite(Number(v))) continue
    if (Number(v) !== Number(base[key] ?? NaN)) p.set(param, String(Number(v)))
  }
  if (input.rented) p.set('rent', '1')
  if (input.stay !== base.stay) p.set('s', input.stay)
  if (input.food !== base.food) p.set('f', input.food)
  if (!input.redCross) p.set('rc', '0')
  return p.toString()
}

/** Reads a link's query string back into inputs. Junk values are ignored. */
export function parseInputs(search) {
  const p = new URLSearchParams(search)
  const route = p.get('r')
  const input = inputsForRoute(ROUTES[route] ? route : 'manali')
  const within = (raw, key) => {
    if (raw === null || raw.trim() === '') return null
    const n = Number(raw)
    const [lo, hi] = BOUNDS[key]
    return Number.isFinite(n) && n >= lo && n <= hi ? n : null
  }
  const km = within(p.get('km'), 'km')
  if (km !== null && (km > 0 || input.route === 'custom')) {
    input.kmLow = km
    input.kmHigh = km
  }
  for (const [key, [param, bounds]] of Object.entries(PARAMS)) {
    const n = within(p.get(param), bounds)
    if (n !== null) input[key] = n
  }
  if (p.get('d') !== null && p.get('n') === null && within(p.get('d'), 'days') !== null) input.nights = Math.max(0, input.days - 1)
  if (p.get('rent') === '1') input.rented = true
  if (STAYS[p.get('s')]) {
    input.stay = p.get('s')
    if (p.get('sl') === null) input.stayLow = STAYS[input.stay].low
    if (p.get('sh') === null) input.stayHigh = STAYS[input.stay].high
  }
  if (FOODS[p.get('f')]) {
    input.food = p.get('f')
    if (p.get('fl') === null) input.foodLow = FOODS[input.food].low
    if (p.get('fh') === null) input.foodHigh = FOODS[input.food].high
  }
  if (p.get('rc') === '0') input.redCross = false
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

const pct = (v) => Math.round(v * 1000) / 10

/** The six breakdown rows. Each bar runs solid to the low figure, then
 *  striped to the high figure, on one shared scale. */
export function renderBreakdownHTML(res, input) {
  const scale = Math.max(1, ...CATEGORIES.map((c) => res.breakdown[c].high))
  return CATEGORIES.map((c) => {
    const b = res.breakdown[c]
    const name = CATEGORY_NAMES[c]
    if (c === 'rent' && !input.rented) {
      return `<li class="off"><span class="cat">${name}</span><span class="val">Not included, you ride your own bike</span></li>`
    }
    if (c === 'rent' && res.rentMissing) {
      return `<li class="off"><span class="cat">${name}</span><span class="val"><a href="#rentLow">Add your quoted rate</a></span></li>`
    }
    const lo = pct(b.low / scale)
    const span = pct((b.high - b.low) / scale)
    const hi = span > 0 ? `<i class="hi" data-k="${c}-hi" style="width:${span}%"></i>` : ''
    return (
      `<li><span class="cat">${name}</span><span class="val">${rangeHTML(b)}</span>` +
      `<span class="bar" aria-hidden="true"><i class="lo" data-k="${c}-lo" style="width:${lo}%"></i>${hi}</span></li>`
    )
  }).join('\n')
}
