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

let browser
let failures = 0
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
} finally {
  stopping = true
  await browser?.close().catch(() => {})
  server.kill()
}

if (failures > 0) {
  fail(`${failures} route(s) rendered motionless blocks. A page block must animate in: give the page root's children the shared \`.page-enter > *\` cascade.`)
}
console.log('\nmotion check: every sampled block animated in.')
