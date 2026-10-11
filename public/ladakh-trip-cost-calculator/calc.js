import {
  ROUTES, STAYS, FOODS, inputsForRoute, calculate, fieldMessages, serializeInputs, parseInputs,
  formatRange, renderHeroHTML, renderBreakdownHTML, statusText,
} from './calc-core.js'

const $ = (id) => document.getElementById(id)
const form = $('calc')
const val = (id) => $(id).value.trim()
const radio = (name) => form.elements[name].value
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

// follow the main site's saved theme choice when there is one
try {
  const t = localStorage.getItem('yatraflow_theme')
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t
} catch (e) { /* storage blocked: the OS preference still applies */ }

const state = { nightsTouched: false }

function setRadio(name, value) {
  for (const r of form.elements[name]) r.checked = r.value === value
}

function syncGliders() {
  for (const seg of form.querySelectorAll('[data-seg]')) {
    const radios = [...seg.querySelectorAll('input[type=radio]')]
    seg.style.setProperty('--i', Math.max(0, radios.findIndex((r) => r.checked)))
  }
}

const ROUTE_NOTES = {
  delhi: 'Delhi, Srinagar, Leh, Manali and back. 3,300 to 3,600 km, sourced from the Discover with Dheeraj guide. The low end feeds the low total. Type a distance to override.',
  manali: 'Manali to Leh and back, with Nubra and Pangong. About 1,600 km, an assumption. Type your own distance to override.',
  leh: 'Rides out of Leh to Nubra and Pangong. About 600 km, an assumption. Type your own distance to override.',
  custom: 'Enter the total distance you plan to ride.',
}

function routeHint() {
  const r = ROUTES[radio('route')]
  $('routeHint').textContent = ROUTE_NOTES[radio('route')]
  $('km').placeholder = !r.kmLow ? 'Enter km' : r.kmLow === r.kmHigh ? String(r.kmLow) : `${r.kmLow}-${r.kmHigh}`
}

function stayTag() {
  const sourced = radio('stay') !== 'hotel'
  const tag = $('stayTag')
  tag.textContent = sourced ? 'sourced' : 'assumption'
  tag.className = 'tag ' + (sourced ? 'src' : 'asm')
  tag.setAttribute('href', sourced ? '#src-tata' : '#src-assume')
}

/** Write a full input object into the form (page load from a link). */
function writeInputs(input) {
  const route = ROUTES[input.route]
  setRadio('route', input.route)
  setRadio('bike', input.rented ? 'rent' : 'own')
  setRadio('stay', input.stay)
  setRadio('food', input.food)
  const same = input.kmLow === route.kmLow && input.kmHigh === route.kmHigh
  $('km').value = same ? '' : input.kmLow
  const map = {
    days: 'days', nights: 'nights', people: 'people', bikes: 'bikes', mileage: 'mileage', fuel: 'fuelPrice',
    stayLow: 'stayLow', stayHigh: 'stayHigh', foodLow: 'foodLow', foodHigh: 'foodHigh',
    env: 'envFee', wild: 'wildlifePerDay', miscLow: 'miscLow', miscHigh: 'miscHigh',
  }
  for (const [id, key] of Object.entries(map)) $(id).value = input[key]
  $('rentLow').value = input.rentLow
  $('rentHigh').value = input.rentHigh
  $('redcross').checked = input.redCross
  state.nightsTouched = input.nights !== input.days - 1
  routeHint(); stayTag(); syncGliders()
}

function readInputs() {
  const r = ROUTES[radio('route')]
  const override = val('km')
  const d = inputsForRoute(radio('route'))
  return {
    ...d,
    kmLow: override !== '' ? Number(override) : r.kmLow,
    kmHigh: override !== '' ? Number(override) : r.kmHigh,
    days: val('days'), nights: val('nights'),
    people: val('people'), bikes: val('bikes'),
    rented: radio('bike') === 'rent',
    rentLow: val('rentLow'), rentHigh: val('rentHigh'),
    mileage: val('mileage'), fuelPrice: val('fuel'),
    stay: radio('stay'), stayLow: val('stayLow'), stayHigh: val('stayHigh'),
    food: radio('food'), foodLow: val('foodLow'), foodHigh: val('foodHigh'),
    envFee: val('env'), wildlifePerDay: val('wild'),
    redCross: $('redcross').checked,
    miscLow: val('miscLow'), miscHigh: val('miscHigh'),
  }
}

const RAW_IDS = ['days', 'nights', 'people', 'bikes', 'mileage', 'fuel', 'stayLow', 'stayHigh', 'foodLow', 'foodHigh', 'env', 'wild', 'miscLow', 'miscHigh', 'rentLow', 'rentHigh']

function showMessages() {
  const raw = Object.fromEntries(RAW_IDS.map((id) => [id, val(id)]))
  const msgs = fieldMessages(raw)
  for (const id of RAW_IDS) {
    const el = $('m-' + id)
    el.textContent = msgs[id] ?? ''
    el.hidden = !msgs[id]
    $(id).setAttribute('aria-invalid', msgs[id] && !msgs[id].startsWith('More nights') && !msgs[id].startsWith('Low and high') ? 'true' : 'false')
  }
}

function showEdited(input) {
  const s = STAYS[input.stay]
  const f = FOODS[input.food]
  const d = inputsForRoute(input.route)
  const edited =
    Number(input.stayLow) !== s.low || Number(input.stayHigh) !== s.high ||
    Number(input.foodLow) !== f.low || Number(input.foodHigh) !== f.high ||
    Number(input.mileage) !== d.mileage || Number(input.fuelPrice) !== d.fuelPrice ||
    Number(input.envFee) !== d.envFee || Number(input.wildlifePerDay) !== d.wildlifePerDay ||
    input.redCross !== d.redCross ||
    Number(input.miscLow) !== d.miscLow || Number(input.miscHigh) !== d.miscHigh
  $('edited').hidden = !edited
}

function flash(el) {
  if (reduced) return
  el.classList.remove('flash')
  void el.offsetWidth
  el.classList.add('flash')
}

/** Swap the rows in, then slide each bar from its old width to the new one. */
function morphBreakdown(html) {
  const list = $('breakdown')
  const old = new Map([...list.querySelectorAll('i[data-k]')].map((i) => [i.dataset.k, i.style.width]))
  list.innerHTML = html
  if (reduced) return
  const moves = []
  for (const i of list.querySelectorAll('i[data-k]')) {
    const was = old.get(i.dataset.k)
    if (was !== undefined) { moves.push([i, i.style.width]); i.style.width = was }
  }
  void list.offsetWidth
  for (const [i, w] of moves) i.style.width = w
}

let lastHero = ''
let statusTimer = 0
let urlTimer = 0

function render() {
  const input = readInputs()
  const res = calculate(input)

  $('rentField').hidden = !input.rented
  const note = $('peopleNote')
  const text = res.fewerPeopleThanBikes
    ? 'You have more bikes than people. That is fine if one rider takes two bikes, otherwise check the numbers.'
    : res.manyPeoplePerBike ? 'That is more than two people per bike.' : ''
  note.textContent = text
  note.hidden = !text
  $('rentNote').hidden = !res.rentMissing

  const hero = renderHeroHTML(res)
  if (hero !== lastHero) {
    for (const el of document.querySelectorAll('[data-hero]')) { el.innerHTML = hero; flash(el) }
    lastHero = hero
  }
  $('miniRange').textContent = formatRange(res.perPerson)
  morphBreakdown(renderBreakdownHTML(res, input))
  showMessages()
  showEdited(input)

  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { $('status').textContent = statusText(res) }, 600)
  clearTimeout(urlTimer)
  urlTimer = setTimeout(() => {
    const q = serializeInputs(input)
    try { history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash) } catch (e) { /* sandboxed: skip */ }
  }, 300)
}

function onRoute() {
  const d = inputsForRoute(radio('route'))
  $('days').value = d.days
  $('nights').value = d.nights
  $('km').value = ''
  state.nightsTouched = false
  routeHint()
}

function onStay() {
  const s = STAYS[radio('stay')]
  $('stayLow').value = s.low
  $('stayHigh').value = s.high
  stayTag()
}

function onFood() {
  const f = FOODS[radio('food')]
  $('foodLow').value = f.low
  $('foodHigh').value = f.high
}

form.addEventListener('change', (e) => {
  const t = e.target
  if (t.name === 'route') onRoute()
  else if (t.name === 'stay') onStay()
  else if (t.name === 'food') onFood()
  syncGliders()
  render()
})
$('nights').addEventListener('input', () => { state.nightsTouched = true })
$('days').addEventListener('input', () => {
  if (!state.nightsTouched) $('nights').value = Math.max(0, Number(val('days') || 1) - 1)
})
form.addEventListener('input', render)

// pinned bar: only while neither result block is on screen
const mini = $('mini')
if ('IntersectionObserver' in window) {
  const seen = new Set()
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id)
    mini.hidden = seen.size > 0
  })
  io.observe($('summary'))
  io.observe($('result'))
} else {
  mini.hidden = false
}

// an opened link restores its numbers
if (location.search) writeInputs(parseInputs(location.search))
render()
