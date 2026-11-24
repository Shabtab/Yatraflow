// ============ Shared client for the YatraFlow trip cost calculators ============
// One binding layer for every destination. It reads the page's embedded config
// (`<script type="application/json" id="calc-cfg">`, written by
// scripts/build-calculators.mjs) and never names a destination or a field, so a
// new destination is data and nothing else.
//
// What it owns: the form, the live result, the 300 ms debounced address-bar
// sync, the trip hand-off link, the WhatsApp share link, the accessible status
// line, and the pinned mobile bar.

import {
  inputsForRoute, calculate, fieldMessages, serializeInputs, parseInputs, tierChange,
  formatRange, renderHeroHTML, renderBreakdownHTML, statusText, prefillPath, shareText,
} from './core.js'

const cfg = JSON.parse(document.getElementById('calc-cfg').textContent)
const $ = (id) => document.getElementById(id)
const form = $('calc')
const val = (id) => $(id).value.trim()
const radio = (name) => form.elements[name].value
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

// Follow the main site's saved theme choice when there is one.
try {
  const t = localStorage.getItem('yatraflow_theme')
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t
} catch (e) { /* storage blocked: the OS preference still applies */ }

const state = { nightsTouched: false }

const hasKm = () => cfg.lines.some((l) => l.kind === 'km')
/** Inputs whose id matches their key, present on this page. */
const LINE_SUFFIXES = ['Low', 'High', 'DayLow', 'DayHigh', 'Add']
const lineInputIds = cfg.lines.flatMap((l) => {
  const out = l.kind === 'km' ? [] : [`${l.key}Low`, `${l.key}High`]
  if (l.dayRate) out.push(`${l.key}DayLow`, `${l.key}DayHigh`)
  if (l.addOn) out.push(`${l.key}Add`)
  return out
})
const RAW_IDS = [
  'days', 'nights', 'people', 'mileage', 'fuel', ...(cfg.units ? ['units'] : []), ...(hasKm() ? ['km'] : []),
  ...lineInputIds,
]

function setRadio(name, value) {
  const list = form.elements[name]
  if (!list || !list.length && !list.value) return
  for (const r of list.length ? list : [list]) r.checked = r.value === value
}

function syncGliders() {
  for (const seg of form.querySelectorAll('[data-seg]')) {
    const radios = [...seg.querySelectorAll('input[type=radio]')]
    seg.style.setProperty('--i', Math.max(0, radios.findIndex((r) => r.checked)))
  }
}

function routeNow() {
  const r = radio('route')
  return cfg.routes[r] ? r : cfg.defaultRoute
}

function routeHint() {
  const r = cfg.routes[routeNow()]
  $('routeHint').textContent = r.note ?? ''
  if (hasKm()) {
    $('km').placeholder = !r.km ? 'Enter km' : String(r.km)
    // The distance field only earns its place when the chosen way of travelling
    // is one that burns fuel.
    $('kmField').hidden = !kmInPlay()
  }
}

function kmInPlay() {
  return cfg.lines.some((l) => l.kind === 'km' && activeFor(l))
}

function activeFor(line) {
  if (line.when && !line.when.in.includes(radio('g-' + line.when.group))) return false
  return true
}

/** A destination's distance for the current route, before anyone types one. */
function routeKm() {
  const r = cfg.routes[routeNow()]
  return cfg.kmFromRoute ? { low: Number(r.km) || 0, high: Number(r.kmHigh ?? r.km) || 0 } : { low: Number(cfg.kmDefault) || 0, high: Number(cfg.kmDefault) || 0 }
}

/** Write a full input object into the form (page load, or a route change). */
function writeInputs(input) {
  setRadio('route', input.route)
  for (const g of cfg.groups) setRadio('g-' + g.key, input[g.key])
  for (const t of cfg.tiers) setRadio('g-' + t.key, input[t.key])
  for (const line of cfg.lines) {
    if (line.optional) $(`${line.key}On`).checked = input[`${line.key}On`] !== false
    if (line.addOn) $(`${line.key}AddOn`).checked = input[`${line.key}AddOn`] !== false
  }
  if (hasKm()) {
    const km = routeKm()
    const same = Number(input.kmLow) === km.low && Number(input.kmHigh) === km.high
    $('km').value = same ? '' : input.kmLow
  }
  for (const id of ['days', 'nights', 'people', 'mileage', 'fuel', 'units']) {
    if ($(id)) $(id).value = input[id]
  }
  for (const id of lineInputIds) $(id).value = input[id]
  state.nightsTouched = input.nights !== input.days - 1
  routeHint()
  syncGliders()
}

function readInputs() {
  const base = inputsForRoute(cfg, routeNow())
  const input = {
    ...base,
    route: routeNow(),
    days: val('days'),
    nights: val('nights'),
    people: val('people'),
    mileage: val('mileage'),
    fuelPrice: val('fuel'),
  }
  if (cfg.units) input.units = val('units')
  if (hasKm()) {
    const typed = val('km')
    const km = routeKm()
    input.kmLow = typed !== '' ? Number(typed) : km.low
    input.kmHigh = typed !== '' ? Number(typed) : km.high
  }
  for (const g of cfg.groups) input[g.key] = radio('g-' + g.key)
  for (const t of cfg.tiers) input[t.key] = radio('g-' + t.key)
  for (const line of cfg.lines) {
    if (line.optional) input[`${line.key}On`] = $(`${line.key}On`).checked
    if (line.addOn) input[`${line.key}AddOn`] = $(`${line.key}AddOn`).checked
  }
  for (const id of lineInputIds) input[id] = val(id)
  return input
}

function showMessages(raw) {
  const msgs = fieldMessages(cfg, raw)
  for (const id of RAW_IDS) {
    const el = $('m-' + id)
    if (!el) continue
    el.textContent = msgs[id] ?? ''
    el.hidden = !msgs[id]
    const soft = msgs[id] && (msgs[id].startsWith('More nights') || msgs[id].startsWith('Low and high'))
    $(id).setAttribute('aria-invalid', msgs[id] && !soft ? 'true' : 'false')
  }
}

/** True when anything in the rates panel differs from the destination's own
 *  defaults, so the summary can say "(edited)" without the visitor opening it. */
function showEdited(input) {
  const base = inputsForRoute(cfg, input.route)
  let edited = false
  for (const id of [...lineInputIds, 'mileage', 'fuel']) {
    if (Number(input[id]) !== Number(base[id])) { edited = true; break }
  }
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

function pageUrl(query) {
  return location.origin + location.pathname + (query ? '?' + query : '')
}

function render() {
  const input = readInputs()
  const res = calculate(cfg, input)

  const note = $('peopleNote')
  const text = res.fewerPeopleThanUnits
    ? 'You have more bikes than people. That is fine if one rider takes two bikes, otherwise check the numbers.'
    : res.manyPeoplePerUnit ? 'That is more than two people per bike.' : ''
  note.textContent = text
  note.hidden = !text
  $('fuelNote').hidden = !res.fuelUncounted
  for (const line of cfg.lines) {
    if (line.kind !== 'km') continue
    const field = $(line.key + 'Field')
    if (field) field.hidden = !activeFor(line)
  }

  const hero = renderHeroHTML(res)
  if (hero !== lastHero) {
    for (const el of document.querySelectorAll('[data-hero]')) { el.innerHTML = hero; flash(el) }
    lastHero = hero
  }
  $('miniRange').textContent = formatRange(res.perPerson)
  morphBreakdown(renderBreakdownHTML(res, cfg))
  showMessages(Object.fromEntries(RAW_IDS.map((id) => [id, val(id)])))
  showEdited(input)

  const query = serializeInputs(cfg, input)
  $('cta').setAttribute('href', prefillPath(cfg, input, res))
  $('wa').setAttribute('href', 'https://wa.me/?text=' + encodeURIComponent(shareText(cfg, input, res, pageUrl(query))))

  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { $('status').textContent = statusText(res) }, 600)
  clearTimeout(urlTimer)
  urlTimer = setTimeout(() => {
    try { history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash) } catch (e) { /* sandboxed: skip */ }
  }, 300)
}

function onRoute() {
  const base = inputsForRoute(cfg, routeNow())
  $('days').value = base.days
  $('nights').value = base.nights
  if (hasKm()) $('km').value = ''
  state.nightsTouched = false
  routeHint()
}

form.addEventListener('change', (e) => {
  const t = e.target
  if (t.name === 'route') onRoute()
  // A tier's rate follows the tier, so the panel and the model never disagree.
  for (const tier of cfg.tiers) {
    if (t.name === 'g-' + tier.key) {
      const rate = tierChange(cfg, { key: tier.key, tier: tier.tier }, t.value)
      $(tier.key + 'Low').value = rate.low
      $(tier.key + 'High').value = rate.high
    }
  }
  syncGliders()
  routeHint()
  render()
})
$('nights').addEventListener('input', () => { state.nightsTouched = true })
$('days').addEventListener('input', () => {
  if (!state.nightsTouched) $('nights').value = Math.max(0, Number(val('days') || 1) - 1)
})
form.addEventListener('input', render)

// Pinned bar: only while neither result block is on screen.
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

// An opened link restores its numbers.
if (location.search) writeInputs(parseInputs(cfg, location.search))
routeHint()
render()
