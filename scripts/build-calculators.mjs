// ============ Build the static trip cost calculators ============
// One generator for every destination. It reads calculators/destinations/*.json,
// renders public/<slug>/index.html from calculators/template.html, publishes the
// shared runtime (core.js, client.js, shared.css, fonts) under /calculators/,
// writes calculators/manifest.json for the sitemap, the service worker and the
// tests, and renders the hub at /trip-cost-calculators/.
//
//   npm run calculators:build
//
// The generated HTML is committed, because Vercel serves public/ as static files
// with no build step of its own — and because the drift tests compare the
// committed bytes against what this script would produce today.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  defaultInputs, calculate, formatRange, renderHeroHTML, renderBreakdownHTML, statusText,
  prefillPath, shareText, webApplicationJsonLd, faqJsonLd, renderJsonLd,
} from '../calculators/engine.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = 'https://www.yatraflow.in'

export const SOURCE_DIR = join(ROOT, 'calculators', 'destinations')
export const PUBLIC_DIR = join(ROOT, 'public')

/** Display order on the hub: the peak-season pages first. */
export const DESTINATION_ORDER = ['goa', 'rajasthan', 'meghalaya', 'ladakh']

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function loadDestinations() {
  return DESTINATION_ORDER.map((key) => JSON.parse(readFileSync(join(SOURCE_DIR, `${key}.json`), 'utf8')))
}

// ---------------- Form markup ----------------

function routesHTML(dest, input) {
  return Object.entries(dest.routes)
    .map(([key, route]) => {
      const checked = key === input.route ? ' checked' : ''
      return (
        `            <label class="card-opt"><input type="radio" name="route" value="${key}"${checked}>` +
        `<span class="body"><b>${esc(route.label)}</b><span class="meta">${esc(route.meta)}</span></span></label>`
      )
    })
    .join('\n')
}

function unitsFieldHTML(dest, input) {
  if (!dest.units) return ''
  return (
    `            <div class="field">\n` +
    `              <label for="units">${esc(dest.units.label)}</label>\n` +
    `              <input type="number" id="units" inputmode="numeric" min="${dest.units.min ?? 0}" step="1" value="${input.units}" aria-describedby="m-units">\n` +
    `              <p class="msg" id="m-units" hidden></p>\n` +
    `            </div>`
  )
}

function segmented(name, legend, options, chosen, hint, legendHtml = null) {
  const index = Math.max(0, options.findIndex((o) => o.value === chosen))
  const radios = options
    .map(
      (o) =>
        `              <label class="opt"><input type="radio" name="${name}" value="${o.value}"${o.value === chosen ? ' checked' : ''}><span>${esc(o.label)}</span></label>`,
    )
    .join('\n')
  return (
    `        <fieldset>\n` +
    `          <legend>${legendHtml ?? esc(legend)}</legend>\n` +
    `          <div class="seg" style="--n:${options.length};--i:${index}" data-seg>\n` +
    `            <span class="glider" aria-hidden="true"></span>\n` +
    `${radios}\n` +
    `          </div>\n` +
    (hint ? `          <p class="hint" style="margin-top:8px">${esc(hint)}</p>\n` : '') +
    `        </fieldset>`
  )
}

function groupsHTML(dest, input) {
  return dest.groups.map((g) => segmented('g-' + g.key, g.legend, g.options, input[g.key], g.hint)).join('\n')
}

/** The two tier controls (stay, food) are rendered from the lines that own
 *  them, so a destination with no stay tiers simply has no stay control. */
function tiersHTML(dest, input) {
  return dest.lines
    .filter((l) => l.tier)
    .map((line) => {
      const tiers = line.tier === 'stay' ? dest.stays : dest.foods
      const options = Object.entries(tiers).map(([value, t]) => ({ value, label: t.label }))
      const tag = line.tierSource
        ? ` <a class="tag ${line.tierSource.label === 'sourced' ? 'src' : 'asm'}" href="${line.tierSource.href}">${line.tierSource.label}</a>`
        : ''
      // The tag is our own markup, so it must not be escaped a second time.
      return segmented('g-' + line.key, line.tierLegend, options, input[line.key], line.tierHint, esc(line.tierLegend) + tag)
    })
    .join('\n')
}

function optionalsHTML(dest, input) {
  return dest.lines
    .filter((l) => l.optional)
    .map((line) => {
      const checked = input[`${line.key}On`] ? ' checked' : ''
      return (
        `        <fieldset id="${line.key}Field">\n` +
        `          <legend>${esc(line.name)}${line.source ? ` <a class="tag ${line.source.label === 'sourced' ? 'src' : 'asm'}" href="${line.source.href}">${line.source.label}</a>` : ''}</legend>\n` +
        `          <label class="check"><input type="checkbox" id="${line.key}On"${checked}><span>${esc(line.optionalLabel)}</span></label>\n` +
        (line.hint ? `          <p class="hint">${esc(line.hint)}</p>\n` : '') +
        `        </fieldset>`
      )
    })
    .join('\n')
}

function moneyField(id, label, value, describedBy) {
  return (
    `              <div class="field">\n` +
    `                <label for="${id}">${esc(label)}</label>\n` +
    `                <div class="adorn pre"><span aria-hidden="true">₹</span><input type="number" id="${id}" inputmode="numeric" min="0" step="100" value="${value}" aria-describedby="${describedBy}"></div>\n` +
    `                <p class="msg" id="${describedBy}" hidden></p>\n` +
    `              </div>`
  )
}

function unitField(id, label, value, unit, attrs, describedBy) {
  return (
    `              <div class="field">\n` +
    `                <label for="${id}">${esc(label)}</label>\n` +
    `                <div class="adorn post"><input type="number" id="${id}" inputmode="decimal" ${attrs} value="${value}" aria-describedby="${describedBy}"><span aria-hidden="true">${unit}</span></div>\n` +
    `                <p class="msg" id="${describedBy}" hidden></p>\n` +
    `              </div>`
  )
}

/** A range pair for one line, with the model's current values. */
function rangeFields(line, input) {
  const key = line.key
  const lowLabel = line.lowLabel ?? 'Low'
  const highLabel = line.highLabel ?? 'High'
  return (
    `            <div class="row">\n` +
    moneyField(`${key}Low`, lowLabel, input[`${key}Low`], `m-${key}Low`) +
    `\n` +
    moneyField(`${key}High`, highLabel, input[`${key}High`], `m-${key}High`) +
    `\n            </div>`
  )
}

function ratesHTML(dest, input) {
  const fieldsets = []
  for (const line of dest.lines) {
    const tag = line.source
      ? ` <a class="tag ${line.source.label === 'sourced' ? 'src' : 'asm'}" href="${line.source.href}">${line.source.label}</a>`
      : ''
    const hint = line.hint ? `\n            <p class="hint">${esc(line.hint)}</p>` : ''

    if (line.kind === 'km') {
      fieldsets.push(
        `          <fieldset id="${line.key}Field">\n` +
          `            <legend>${esc(line.rateLabel)}${tag}</legend>\n` +
          `            <div class="row">\n` +
          unitField('mileage', 'Mileage', input.mileage, 'km/L', 'min="1" step="1"', 'm-mileage') +
          `\n` +
          unitField('fuel', 'Fuel price', input.fuelPrice, '₹/L', 'min="0" step="1"', 'm-fuel') +
          `\n            </div>` +
          (line.hint ? `\n            <p class="hint">${esc(line.hint)}</p>` : '') +
          `\n          </fieldset>`,
      )
      continue
    }

    if (line.kind === 'person' && line.dayRate) {
      fieldsets.push(
        `          <fieldset>\n` +
          `            <legend>${esc(line.rateLabel)}${tag}</legend>\n` +
          `            <div class="row">\n` +
          moneyField(`${line.key}Low`, line.baseLabel ?? 'Once, low', input[`${line.key}Low`], `m-${line.key}Low`) +
          `\n` +
          moneyField(`${line.key}High`, line.baseLabel ?? 'Once, high', input[`${line.key}High`], `m-${line.key}High`) +
          `\n            </div>\n` +
          `            <div class="row">\n` +
          moneyField(`${line.key}DayLow`, (line.dayLabel ?? 'Per day') + ', low', input[`${line.key}DayLow`], `m-${line.key}DayLow`) +
          `\n` +
          moneyField(`${line.key}DayHigh`, (line.dayLabel ?? 'Per day') + ', high', input[`${line.key}DayHigh`], `m-${line.key}DayHigh`) +
          `\n            </div>` +
          (line.addOn
            ? `\n            <div class="row"><div class="field full">\n` +
              `              <label class="check"><input type="checkbox" id="${line.key}AddOn"${input[`${line.key}AddOn`] ? ' checked' : ''}><span>${esc(line.addOn.label)}</span></label>\n` +
              moneyField(`${line.key}Add`, 'Contribution, per person', input[`${line.key}Add`], `m-${line.key}Add`) +
              `\n            </div></div>`
            : '') +
          hint +
          `\n          </fieldset>`,
      )
      continue
    }

    const label =
      line.kind === 'room-night'
        ? `${line.rateLabel}`
        : line.kind === 'person-day'
          ? line.rateLabel
          : line.rateLabel
    fieldsets.push(
      `          <fieldset>\n` +
        `            <legend>${esc(label)}${tag}</legend>\n` +
        rangeFields(line, input) +
        hint +
        `\n          </fieldset>`,
    )
  }

  return fieldsets.join('\n')
}

function faqsHTML(dest) {
  return dest.faqs
    .map((f) => `      <details class="faq">\n        <summary>${esc(f.q)}</summary>\n        <p>${esc(f.a)}</p>\n      </details>`)
    .join('\n')
}

function sourcesHTML(dest) {
  return dest.sources
    .map((s) => {
      const links = (s.links ?? [])
        .map((l) => `<a href="${l.href}" rel="noopener">${esc(l.text)}</a>`)
        .join(', ')
      return `          <li id="${s.id}"><b>${esc(s.kind)}:</b> ${esc(s.text)}${links}${links ? '.' : ''}</li>`
    })
    .join('\n')
}

function siblingsHTML(dest, bySlug, estimates) {
  return dest.siblings
    .filter((slug) => bySlug[slug])
    .map((slug) => {
      const other = bySlug[slug]
      const est = estimates[slug]
      return (
        `        <li><a href="/${slug}/"><b>${esc(other.dest)}</b>` +
        `<span>${esc(est)} per person · ${esc(other.season)}</span>` +
        `<span>${esc(other.hubBlurb)}</span></a></li>`
      )
    })
    .join('\n')
}

/** The runtime config the shared client needs. Deliberately NOT the whole
 *  destination: no FAQs, no sources, no prose — just what the model reads. */
export function runtimeConfig(dest) {
  return {
    key: dest.key,
    slug: dest.slug,
    dest: dest.dest,
    defaultRoute: dest.defaultRoute,
    defaults: dest.defaults,
    kmFromRoute: dest.kmFromRoute,
    kmDefault: dest.kmDefault,
    peoplePerRoom: dest.peoplePerRoom,
    fuel: dest.fuel,
    units: dest.units ? { label: dest.units.label, param: dest.units.param, default: dest.units.default } : null,
    routes: Object.fromEntries(
      Object.entries(dest.routes).map(([k, r]) => [k, { days: r.days, km: r.km, kmHigh: r.kmHigh, note: r.note }]),
    ),
    // `param`/`token` ride along: the browser serialises and parses the address
    // bar through this config, so a dropped param means a shared link silently
    // resets the visitor's transport choice.
    groups: dest.groups.map((g) => ({
      key: g.key,
      param: g.param,
      options: g.options.map((o) => ({ value: o.value, appMode: o.appMode, param: o.param, token: o.token })),
    })),
    tiers: dest.lines
      .filter((l) => l.tier)
      .map((l) => ({
        key: l.key,
        tier: l.tier,
        options: Object.keys(l.tier === 'stay' ? dest.stays : dest.foods).map((value) => ({ value })),
      })),
    stays: dest.stays,
    foods: dest.foods,
    lines: dest.lines.map((l) => ({
      key: l.key,
      name: l.name,
      offLabel: l.offLabel,
      kind: l.kind,
      units: l.units,
      when: l.when,
      optional: Boolean(l.optional),
      rate: l.rate,
      dayRate: l.dayRate,
      addOn: l.addOn ? { amount: l.addOn.amount, on: l.addOn.on } : null,
      tier: l.tier,
      tierParam: l.tierParam,
      params: l.params,
    })),
  }
}

// ---------------- Page ----------------

export function renderCalculator(dest, bySlug, estimates) {
  const template = readFileSync(join(ROOT, 'calculators', 'template.html'), 'utf8')
  const input = defaultInputs(dest)
  const res = calculate(dest, input)
  const pagePath = `/${dest.slug}/`

  const skeleton = template
    .replace(/\{\{title\}\}/g, esc(dest.title))
    .replace(/\{\{slug\}\}/g, dest.slug)
    .replace(/\{\{h1\}\}/g, esc(dest.h1))
    .replace(/\{\{lead\}\}/g, esc(dest.lead))
    .replace(/\{\{season\}\}/g, esc(dest.season))
    .replace(/\{\{pricesChecked\}\}/g, esc(dest.pricesChecked))
    .replace(/\{\{description\}\}/g, esc(dest.description))
    .replace(/\{\{ogImage\}\}/g, dest.ogImage)
    .replace(/\{\{ogAlt\}\}/g, esc(`${dest.dest} trip cost calculator: planning estimates per person and for the group, in rupees.`))
    .replace(/\{\{routeHint\}\}/g, esc(dest.routes[dest.defaultRoute].note ?? ''))
    .replace(/\{\{fuelLabel\}\}/g, esc(dest.fuelLabel ?? 'Distance, km'))
    .replace(/\{\{kmValue\}\}/g, input.kmLow === input.kmHigh && input.kmLow > 0 ? String(input.kmLow) : '')
    .replace(/\{\{kmPlaceholder\}\}/g, dest.kmFromRoute ? String(dest.routes[dest.defaultRoute].km || 'Enter km') : String(dest.kmDefault ?? ''))
    .replace(/\{\{days\}\}/g, String(input.days))
    .replace(/\{\{nights\}\}/g, String(input.nights))
    .replace(/\{\{people\}\}/g, String(input.people))
    .replace(/\{\{hero\}\}/g, renderHeroHTML(res))
    .replace(/\{\{breakdown\}\}/g, renderBreakdownHTML(res, dest))
    .replace(/\{\{status\}\}/g, statusText(res))
    .replace(/\{\{faqTitle\}\}/g, esc(dest.faqTitle))
    .replace(/\{\{ctaHref\}\}/g, esc(ORIGIN + prefillPath(dest, input, res)))
    .replace(
      /\{\{waHref\}\}/g,
      esc('https://wa.me/?text=' + encodeURIComponent(shareText(dest, input, res, ORIGIN + pagePath))),
    )

  const filled = skeleton
    .replace('{{jsonLd}}', renderJsonLd(webApplicationJsonLd(dest, ORIGIN), faqJsonLd(dest)))
    .replace('{{routes}}', routesHTML(dest, input))
    .replace('{{unitsField}}', unitsFieldHTML(dest, input))
    .replace('{{groups}}', groupsHTML(dest, input))
    .replace('{{tiers}}', tiersHTML(dest, input))
    .replace('{{optionals}}', optionalsHTML(dest, input))
    .replace('{{rates}}', ratesHTML(dest, input))
    .replace('{{faqs}}', faqsHTML(dest))
    .replace('{{sources}}', sourcesHTML(dest))
    .replace('{{siblings}}', siblingsHTML(dest, bySlug, estimates))
    .replace(
      '{{cfg}}',
      `<script type="application/json" id="calc-cfg">${JSON.stringify(runtimeConfig(dest))}</script>`,
    )

  const leftover = filled.match(/\{\{[a-zA-Z]+\}\}/g)
  if (leftover) throw new Error(`${dest.slug}: unfilled template tokens ${[...new Set(leftover)].join(', ')}`)
  return filled
}

// ---------------- Hub ----------------

export function renderHub(dests, estimates) {
  const cards = dests
    .map(
      (d) =>
        `      <li><a class="hub-card" href="/${d.slug}/"><b>${esc(d.dest)}</b>` +
        `<p>${esc(d.hubBlurb)}</p>` +
        `<p class="est">${esc(estimates[d.slug])}<span>per person, default trip · ${esc(d.season)}</span></p></a></li>`,
    )
    .join('\n')
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>India Trip Cost Calculators 2026–27 (Free, No Signup) | YatraFlow</title>
<meta name="description" content="Free India trip cost calculators for Goa, Rajasthan, Meghalaya and Ladakh: transport, stays, food and entry fees in rupees, per person and for the group. No signup.">
<meta name="robots" content="index,follow">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#FAF7F2">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0C1420">
<link rel="canonical" href="${ORIGIN}/trip-cost-calculators/">
<link rel="preload" href="/calculators/fonts/sora-latin-800-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/calculators/fonts/plus-jakarta-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/calculators/shared.css">
<meta property="og:type" content="website">
<meta property="og:site_name" content="YatraFlow">
<meta property="og:title" content="India Trip Cost Calculators 2026–27 (Free, No Signup)">
<meta property="og:description" content="Free India trip cost calculators for Goa, Rajasthan, Meghalaya and Ladakh: transport, stays, food and entry fees in rupees. No signup.">
<meta property="og:url" content="${ORIGIN}/trip-cost-calculators/">
<meta property="og:image" content="${ORIGIN}/og-default.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="India Trip Cost Calculators (Free, No Signup)">
<meta name="twitter:description" content="Free India trip cost calculators for Goa, Rajasthan, Meghalaya and Ladakh. No signup.">
<meta name="twitter:image" content="${ORIGIN}/og-default.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/icons/favicon-96.png" sizes="96x96" type="image/png">
${renderJsonLd({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'India trip cost calculators',
    url: `${ORIGIN}/trip-cost-calculators/`,
    inLanguage: 'en-IN',
    hasPart: dests.map((d) => ({ '@type': 'WebApplication', name: d.h1, url: `${ORIGIN}/${d.slug}/` })),
  })}
<script defer src="/_vercel/insights/script.js"></script>
</head>
<body>
<div class="wrap">
  <header class="top"><a href="${ORIGIN}/"><svg width="24" height="24" viewBox="4.25 5.5 55.5 56.5" aria-hidden="true" focusable="false"><path d="M15 6C15 26 32 24 32 40" fill="none" stroke="#0B6B63" stroke-width="11"/><path d="M49 6C49 26 32 24 32 40V46" fill="none" stroke="#0D8D82" stroke-width="11"/><circle cx="32" cy="56" r="5.5" fill="#F59E2D"/></svg>YatraFlow</a></header>
  <main>
    <h1>India trip cost calculators</h1>
    <p class="lead">Free calculators for the trips Indian groups actually plan right now. Each one prices the transport, the stays, the food and the fees for your own dates and group size, shows a low to high range, and needs no signup.</p>
    <p class="fresh">Prices checked November 2026. Planning estimates, not quotes.</p>
    <ul class="hub-list">
${cards}
    </ul>
    <section class="below">
      <h2>Why the range, not one number</h2>
      <p class="lead" style="max-width:66ch">One number would pretend to know things nobody knows yet: what your room actually costs in the week you travel, what the pump price is that month, and how far you really drive. Each calculator uses the cheaper figure for every line at the low end and the dearer one at the high end, so your real spend has a good chance of landing between them. Every line is editable, and every page's link keeps your numbers so you can send it to the group.</p>
      <p class="lead" style="max-width:66ch">When the group is ready, each calculator hands your route, days, party size and budget straight into a YatraFlow plan, so nobody retypes anything.</p>
    </section>
  </main>
  <footer>
    <a href="${ORIGIN}/">YatraFlow</a>: plan trips together. These calculators give planning estimates, not quotes.
  </footer>
</div>
</body>
</html>
`
}

// ---------------- OG cards ----------------

/** A 1200x630 PNG per destination: the destination art, a dark scrim and the
 *  title. Uses sharp (already a dev dependency for the art pipeline); when it
 *  is missing the page keeps og-default.png and the build says so. */
async function renderOgCards(dests, estimates) {
  let sharp
  try {
    sharp = (await import('sharp')).default
  } catch {
    console.warn('[calculators] sharp is not installed: OG images stay at og-default.png')
    return false
  }
  const art = {
    goa: 'public/art/dest-goa-v2.webp',
    rajasthan: 'public/art/dest-jaipur-v2.webp',
    meghalaya: 'public/art/dest-cherrapunji-v2.webp',
    ladakh: 'public/art/dest-leh-v2.webp',
  }
  mkdirSync(join(PUBLIC_DIR, 'og'), { recursive: true })
  for (const d of dests) {
    const file = join(ROOT, art[d.key])
    if (!existsSync(file)) {
      console.warn(`[calculators] no art for ${d.key}, keeping og-default.png`)
      continue
    }
    const base = await sharp(file).resize(1200, 630, { fit: 'cover' }).toBuffer()
    const scrim = Buffer.from(
      `<svg width="1200" height="630"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#0B2545" stop-opacity=".2"/><stop offset="1" stop-color="#0B2545" stop-opacity=".9"/>` +
        `</linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/>` +
        `<text x="72" y="452" font-family="sans-serif" font-size="30" fill="#DDF1EE">YatraFlow · trip cost calculator</text>` +
        `<text x="72" y="524" font-family="sans-serif" font-size="76" font-weight="bold" fill="#FFFFFF">${escapeXmlText(d.dest)} trip cost</text>` +
        `<text x="72" y="582" font-family="sans-serif" font-size="34" fill="#DDF1EE">${escapeXmlText(estimates[d.slug])} per person · planning estimate</text>` +
        `</svg>`,
    )
    // A palette PNG: a truecolour 1200x630 card over a photo is about 1 MB,
    // which is slow to unfurl in a group chat. The palette version is ~280 KB
    // and the headline stays crisp, which is the only part of the card a
    // WhatsApp preview actually shows.
    await sharp(base)
      .composite([{ input: scrim }])
      .png({ compressionLevel: 9, palette: true, quality: 80, effort: 10 })
      .toFile(join(PUBLIC_DIR, d.ogImage.replace(/^\//, '')))
  }
  return true
}

function escapeXmlText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---------------- Main ----------------

/** Every page this generator would write right now, as strings. The drift tests
 *  compare these against the committed files, so "the generator changed and the
 *  HTML did not" is a failing test rather than a stale page in production. */
export function renderAll() {
  const dests = loadDestinations()
  const bySlug = Object.fromEntries(dests.map((d) => [d.slug, d]))
  const estimates = {}
  for (const d of dests) estimates[d.slug] = formatRange(calculate(d, defaultInputs(d)).perPerson)
  return {
    dests,
    bySlug,
    estimates,
    pages: Object.fromEntries(dests.map((d) => [d.slug, renderCalculator(d, bySlug, estimates)])),
    hub: renderHub(dests, estimates),
  }
}

export async function build({ og = true } = {}) {
  const { dests, estimates, pages, hub } = renderAll()

  // The shared runtime, published once instead of per destination.
  const shared = join(PUBLIC_DIR, 'calculators')
  mkdirSync(join(shared, 'fonts'), { recursive: true })
  copyFileSync(join(ROOT, 'calculators', 'engine.mjs'), join(shared, 'core.js'))
  copyFileSync(join(ROOT, 'calculators', 'client.mjs'), join(shared, 'client.js'))
  copyFileSync(join(ROOT, 'calculators', 'shared.css'), join(shared, 'shared.css'))
  const fontDir = join(ROOT, 'calculators', 'fonts')
  for (const f of ['sora-latin-700-normal.woff2', 'sora-latin-800-normal.woff2', 'plus-jakarta-sans-latin-400-normal.woff2', 'plus-jakarta-sans-latin-600-normal.woff2', 'plus-jakarta-sans-latin-700-normal.woff2']) {
    copyFileSync(join(fontDir, f), join(shared, 'fonts', f))
  }

  const written = []
  for (const d of dests) {
    const dir = join(PUBLIC_DIR, d.slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), pages[d.slug])
    written.push(`public/${d.slug}/index.html`)
  }

  const hubDir = join(PUBLIC_DIR, 'trip-cost-calculators')
  mkdirSync(hubDir, { recursive: true })
  writeFileSync(join(hubDir, 'index.html'), hub)
  written.push('public/trip-cost-calculators/index.html')

  const manifest = {
    generated: true,
    note: 'Written by scripts/build-calculators.mjs. Consumed by api/sitemap.js, public/sw.js and tests/calculators.test.ts.',
    hub: 'trip-cost-calculators',
    calculators: dests.map((d) => ({
      key: d.key,
      slug: d.slug,
      dest: d.dest,
      season: d.season,
      pricesChecked: d.pricesChecked,
      dateModified: d.dateModified,
      ogImage: d.ogImage,
      estimate: estimates[d.slug],
    })),
  }
  writeFileSync(join(ROOT, 'calculators', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  written.push('calculators/manifest.json')

  const ogDone = og ? await renderOgCards(dests, estimates) : false
  return { written, estimates, og: ogDone }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  const { written, estimates, og } = await build()
  console.log(`[calculators] wrote ${written.length} files`)
  for (const w of written) console.log('  ' + w)
  for (const [slug, est] of Object.entries(estimates)) console.log(`  ${slug}: ${est} per person`)
  console.log(`[calculators] OG images: ${og ? 'generated' : 'og-default.png fallback'}`)
}
