// Browser motion check (AGENTS §2.10).
//
// The CSS gates in tests/design-system.test.ts read rules as text: they can
// prove a page root carries an entrance, and they cannot prove anything MOVES.
// This script closes that gap in the real app. It serves the production build,
// opens each route, and samples every block of the page root once per animation
// frame from before navigation. A block whose opacity and transform never
// change appeared between two frames — no motion — and the run fails.
//
// Why the sampler installs before navigation: an entrance that finishes before
// observation starts looks identical to an entrance that never happened, so the
// first painted frame has to be captured. That is also what makes this check
// able to fail: the class of bug it exists for (2026-10-06, a hero that popped
// into place above a cascade) reads as "states = 1" here.
//
// A second step covers STATE CHANGES, which the page-load sampler cannot see.
// It clicks the My trips Grid | List switch and samples the card blocks and the
// switch's glider once per frame across the click. The cards must change opacity
// or transform (the staggered entrance replays) and the glider must travel. A
// layout that snaps shows one state per card and fails. My trips is a signed-in
// route, and a clean browser holds no session, so the step needs a Playwright
// storage state in MOTION_STORAGE_STATE (a file kept outside the repo). Without
// it the step is skipped and says so; MOTION_REQUIRE_SESSION=1 turns that skip
// into a failure for a job that does hold credentials.
//
// A third step covers REMOVAL, on the public Explore route. It turns the Saved
// filter on, which takes every card out of the grid, and samples each removed
// card once per frame. The card must stay mounted for an exit: it passes
// through in-between opacity frames, wears data-presence="exit", is inert and
// ignores the pointer. A card that vanishes between two frames fails. It then
// repeats the click with prefers-reduced-motion on and needs the opposite result:
// the card is gone at once and no exit is painted. The step skips with a note
// when the catalog holds no card to remove.
//
// It runs in CI as its own job because it needs a browser. `npm run verify`
// stays runnable on a machine with no Chrome.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PORT = Number(process.env.MOTION_PORT ?? 4319)
const BASE = `http://127.0.0.1:${PORT}`
const WINDOW_MS = 4000

// Public routes only: a signed-in route renders the marketing landing in a
// clean browser, and CI holds no credentials. The static gate covers every
// page's root; this one proves the ones a browser can actually reach move.
const ROUTES = ['/', '/explore', '/auth', '/trips']

const SAMPLE = (windowMs) => {
  window.__blocks = []
  const read = () => {
    const root = document.querySelector('.route-panel > *')
    if (root) {
      const rows = []
      for (const el of root.children) {
        const box = el.getBoundingClientRect()
        if (box.height < 24) continue
        const cs = getComputedStyle(el)
        rows.push({
          cls: (typeof el.className === 'string' && el.className.trim()) || '(no class)',
          op: +(+cs.opacity).toFixed(3),
          tf: cs.transform === 'none' ? 'none' : cs.transform,
          vis: cs.visibility,
        })
      }
      window.__blocks.push({ t: Math.round(performance.now()), rows })
    }
    if (performance.now() - start < windowMs) requestAnimationFrame(read)
  }
  const start = performance.now()
  requestAnimationFrame(read)
}

// Samples the My trips card blocks and the switch glider once per frame. The
// click lands after ~50ms, so the frames before it are the resting state.
const SWITCH_SAMPLE = ({ clickSel, windowMs }) => new Promise((resolve) => {
  const frames = []
  const start = performance.now()
  let clicked = false
  const seg = document.querySelector('.mt-seg')
  const step = () => {
    const elapsed = performance.now() - start
    if (!clicked && elapsed > 50) {
      clicked = true
      document.querySelector(clickSel)?.click()
    }
    const cards = [...document.querySelectorAll('.mt-grid > .mt-card')].slice(0, 6).map((el) => {
      const cs = getComputedStyle(el)
      return `${(+cs.opacity).toFixed(3)}|${cs.transform}`
    })
    frames.push({ clicked, cards, glider: seg ? getComputedStyle(seg, '::before').left : '' })
    if (elapsed < windowMs) requestAnimationFrame(step)
    else resolve(frames)
  }
  requestAnimationFrame(step)
})

// Samples the Explore grid cards once per frame. The click lands after ~50ms.
// A card is "removed" when it is in the first frame and not in the last one.
const REMOVAL_SAMPLE = ({ clickSel, windowMs }) => new Promise((resolve) => {
  const seen = new Map()
  const start = performance.now()
  let clicked = false
  let lastIds = []
  const step = () => {
    const elapsed = performance.now() - start
    if (!clicked && elapsed > 50) {
      clicked = true
      document.querySelector(clickSel)?.click()
    }
    const cards = [...document.querySelectorAll('.ex-grid > .ex-card')]
    lastIds = cards.map((el) => el.dataset.id)
    for (const el of cards) {
      const cs = getComputedStyle(el)
      const rec = seen.get(el.dataset.id) ?? { opacities: new Set(), exit: false, inert: false, hidden: false, pointer: 'auto', frames: 0 }
      rec.opacities.add((+cs.opacity).toFixed(3))
      rec.frames++
      if (el.dataset.presence === 'exit') {
        rec.exit = true
        rec.inert = el.hasAttribute('inert')
        rec.hidden = el.getAttribute('aria-hidden') === 'true'
        rec.pointer = cs.pointerEvents
      }
      seen.set(el.dataset.id, rec)
    }
    if (elapsed < windowMs) requestAnimationFrame(step)
    else resolve([...seen].map(([id, rec]) => ({ id, ...rec, opacities: rec.opacities.size, removed: !lastIds.includes(id) })))
  }
  requestAnimationFrame(step)
})

function fail(message) {
  console.error(`\nmotion check: ${message}`)
  process.exit(1)
}

// MOTION_PORT is the escape hatch for a machine where 4319 is taken. A bad
// value must fail with a sentence, because the wait below would otherwise
// report a malformed port as a server that never answered.
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  fail(`MOTION_PORT must be a port number from 1024 to 65535, got "${process.env.MOTION_PORT}".`)
}

/** Wait until the preview server answers. The only URL this script fetches is
 *  the loopback constant above, and its port is a validated number — no value
 *  from a caller ever reaches an HTTP client. */
async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}/`)
      if (res.ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  fail(`the preview server never answered at ${BASE}/`)
}

async function launchChrome() {
  const { chromium } = await import('playwright-core')
  const attempts = [
    { channel: 'chrome' },
    ...(process.env.CHROME_PATH ? [{ executablePath: process.env.CHROME_PATH }] : []),
    { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    { executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
    { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    { executablePath: '/usr/bin/google-chrome' },
    { executablePath: '/usr/bin/chromium-browser' },
  ]
  let last
  for (const opts of attempts) {
    try {
      return await chromium.launch({ headless: true, ...opts })
    } catch (e) {
      last = e
    }
  }
  fail(`no Chrome found (${last?.message ?? 'unknown'}). Set CHROME_PATH to a Chrome binary.`)
}

if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  fail('dist/index.html is missing — run `npm run build` first (npm run check:motion does both).')
}

const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
if (!existsSync(viteBin)) fail(`vite is not installed at ${viteBin} — run \`npm ci\` first.`)
const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], {
  cwd: ROOT,
  stdio: ['ignore', 'ignore', 'pipe'],
})
let serverLog = ''
server.stderr.on('data', (d) => { serverLog += d.toString() })
// The teardown in `finally` below is what ends this server, and `vite preview`
// catches SIGTERM and exits 143. So an exit AFTER we asked the server to stop
// is expected, and the code it exits with cannot tell the two cases apart.
// Reading that 143 as a crash failed the whole run in CI after every sampled
// block had already passed (the motion job's first CI run, 2026-10-10). Only
// `stopping` separates "died while the check was running" from "we are done".
let stopping = false
server.on('exit', (code) => {
  if (stopping) return
  if (code !== 0 && code !== null) fail(`vite preview exited with ${code}:\n${serverLog}`)
})

/** Click the My trips layout switch and report whether the cards and the glider
 *  moved. Returns the number of failed directions. */
async function checkLayoutSwitch(browser, storageState) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState })
  const page = await ctx.newPage()
  let bad = 0
  try {
    await page.goto(`${BASE}/trips`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const reached = await page.waitForSelector('.mt-seg', { timeout: 20000 }).then(() => true, () => false)
    if (!reached) {
      console.log('FAIL  /trips layout switch — the Grid | List switch never rendered; the session in MOTION_STORAGE_STATE may be expired')
      return 1
    }
    await page.waitForSelector('.mt-grid > .mt-card', { timeout: 20000 }).catch(() => {})
    if ((await page.locator('.mt-grid > .mt-card').count()) < 1) {
      console.log('FAIL  /trips layout switch — the account has no trip cards in the grid, so there is nothing to sample')
      return 1
    }
    // Start from the grid and let its entrance finish.
    await page.click('.mt-seg button:nth-child(1)')
    await page.waitForTimeout(1200)

    for (const [label, clickSel] of [['grid -> list', '.mt-seg button:nth-child(2)'], ['list -> grid', '.mt-seg button:nth-child(1)']]) {
      const frames = await page.evaluate(SWITCH_SAMPLE, { clickSel, windowMs: 1000 })
      const after = frames.filter((f) => f.clicked)
      const cardCount = Math.max(...after.map((f) => f.cards.length))
      let cardsMoved = 0
      for (let i = 0; i < cardCount; i++) {
        const states = new Set(after.map((f) => f.cards[i]).filter((v) => v !== undefined))
        // Three or more states: the rest state, the end state and a frame in between.
        // Two states is a snap.
        if (states.size > 2) cardsMoved++
      }
      const gliderStates = new Set(after.map((f) => f.glider)).size
      const ok = cardCount > 0 && cardsMoved === cardCount && gliderStates > 2
      if (ok) {
        console.log(`ok    /trips layout switch ${label} — ${cardsMoved}/${cardCount} card(s) animated, glider took ${gliderStates} positions, across ${after.length} frames`)
      } else {
        bad++
        console.log(`FAIL  /trips layout switch ${label} — ${cardsMoved}/${cardCount} card(s) passed through in-between opacity/transform frames, glider took ${gliderStates} position(s) across ${after.length} frames`)
        console.log('        The cards snapped into the new layout, or the switch painted its pressed state with no glide.')
      }
      await page.waitForTimeout(1200)
    }
  } finally {
    await ctx.close()
  }
  return bad
}

/** Take every card out of the Explore grid and check how it leaves. Returns the
 *  number of failed checks. */
async function checkListExit(browser) {
  let bad = 0
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const label = reducedMotion === 'reduce' ? 'reduced motion' : 'motion on'
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion })
    const page = await ctx.newPage()
    try {
      await page.goto(`${BASE}/explore`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForSelector('.ex-chip-saved', { timeout: 20000 }).catch(() => {})
      await page.waitForSelector('.ex-grid > .ex-card', { timeout: 15000 }).catch(() => {})
      if ((await page.locator('.ex-grid > .ex-card').count()) < 1) {
        console.log(`skip  /explore card exit (${label}) — the catalog holds no card in the grid, so there is nothing to remove`)
        continue
      }
      // Let the card entrance end, so the sample sees the resting state first.
      await page.waitForTimeout(1200)
      const cards = await page.evaluate(REMOVAL_SAMPLE, { clickSel: '.ex-chip-saved', windowMs: 900 })
      const removed = cards.filter((c) => c.removed)
      if (removed.length === 0) {
        bad++
        console.log(`FAIL  /explore card exit (${label}) — the Saved filter left every card in the grid`)
        continue
      }
      if (reducedMotion === 'reduce') {
        const painted = removed.filter((c) => c.exit || c.opacities > 1)
        if (painted.length === 0) {
          console.log(`ok    /explore card exit (${label}) — ${removed.length} card(s) left at once, no exit painted`)
        } else {
          bad++
          console.log(`FAIL  /explore card exit (${label}) — ${painted.length} card(s) played an exit; prefers-reduced-motion must remove them at once`)
        }
        continue
      }
      // Three or more opacity states: the rest state, the end state and a frame in between.
      const snapped = removed.filter((c) => c.opacities <= 2)
      const unsafe = removed.filter((c) => !(c.exit && c.inert && c.hidden && c.pointer === 'none'))
      if (snapped.length === 0 && unsafe.length === 0) {
        console.log(`ok    /explore card exit (${label}) — ${removed.length} card(s) faded out across ${Math.max(...removed.map((c) => c.opacities))} opacity states, inert and aria-hidden while they left`)
      } else {
        bad++
        console.log(`FAIL  /explore card exit (${label}) — ${snapped.length}/${removed.length} card(s) vanished between two frames, ${unsafe.length} card(s) were not inert, aria-hidden and click-through while they left`)
        console.log('        A card that leaves a list must stay mounted for its exit: see usePresenceList and the [data-presence="exit"] rule.')
      }
    } finally {
      await ctx.close()
    }
  }
  return bad
}

let browser
let failures = 0
let interactionFailures = 0
try {
  await waitForServer()
  browser = await launchChrome()

  for (const route of ROUTES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await ctx.addInitScript(SAMPLE, WINDOW_MS)
    const page = await ctx.newPage()
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]))

    await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('.route-panel > *', { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(WINDOW_MS + 500)

    const result = await page.evaluate(() => {
      const frames = window.__blocks ?? []
      const byClass = new Map()
      let i = 0
      for (const frame of frames) {
        i++
        for (const row of frame.rows) {
          const rec = byClass.get(row.cls) ?? { states: new Set(), mount: i, last: null, vis: 'visible' }
          rec.states.add(`${row.op}|${row.tf}`)
          rec.mount = Math.min(rec.mount, i)
          rec.last = row.op
          rec.vis = row.vis
          byClass.set(row.cls, rec)
        }
      }
      return {
        frames: frames.length,
        blocks: [...byClass.entries()].map(([cls, r]) => ({
          cls,
          states: r.states.size,
          mount: r.mount,
          op: r.last,
          vis: r.vis,
          motionless: r.states.size <= 1 && r.last >= 0.99 && r.vis !== 'hidden',
        })),
      }
    })

    if (result.frames < 10) {
      failures++
      console.log(`FAIL  ${route} — sampler captured ${result.frames} frames; nothing could be measured`)
      continue
    }
    if (result.blocks.length === 0) {
      failures++
      console.log(`FAIL  ${route} — no blocks found under the page root; nothing could be measured`)
      continue
    }
    const bad = result.blocks.filter((b) => b.motionless)
    if (bad.length) {
      failures++
      console.log(`FAIL  ${route} — ${bad.length}/${result.blocks.length} block(s) appeared between two frames:`)
      for (const b of bad) console.log(`        ${b.cls} (states=${b.states}, first seen at sample ${b.mount})`)
    } else {
      console.log(`ok    ${route} — ${result.blocks.length} block(s) sampled across ${result.frames} frames, all moved`)
    }
    if (pageErrors.length) console.log(`      page errors: ${pageErrors.join(' | ')}`)
    await ctx.close()
  }

  interactionFailures += await checkListExit(browser)

  const storageState = process.env.MOTION_STORAGE_STATE
  if (storageState) {
    if (!existsSync(storageState)) fail(`MOTION_STORAGE_STATE points at ${storageState}, which does not exist.`)
    interactionFailures += await checkLayoutSwitch(browser, storageState)
  } else if (process.env.MOTION_REQUIRE_SESSION === '1') {
    fail('MOTION_REQUIRE_SESSION=1 but MOTION_STORAGE_STATE is not set; the layout-switch step cannot run.')
  } else {
    console.log('skip  /trips layout switch — My trips is a signed-in route; set MOTION_STORAGE_STATE to a Playwright storage-state file to run this step')
  }
} finally {
  stopping = true
  await browser?.close().catch(() => {})
  server.kill()
}

if (interactionFailures > 0) {
  fail(`${interactionFailures} state-change interaction(s) did not move. A control that changes state must animate: slide its glider and replay the card entrance. A card that leaves a list must fade out.`)
}
if (failures > 0) {
  fail(`${failures} route(s) rendered motionless blocks. A page block must animate in: give the page root's children the shared \`.page-enter > *\` cascade.`)
}
console.log(`\nmotion check: every sampled block animated in${process.env.MOTION_STORAGE_STATE ? ', and every exercised state change moved' : ''}.`)
