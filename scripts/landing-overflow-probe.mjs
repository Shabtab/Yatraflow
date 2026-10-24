#!/usr/bin/env node
// ============================================================================
// Landing overflow probe — GitHub issue #670.
//
// Usage:
//   npm run probe:landing-overflow
//   node scripts/landing-overflow-probe.mjs --json
//   node scripts/landing-overflow-probe.mjs --selftest
//
// Why this probe exists:
//   Issue #670 says the Landing page overflows at phone width. The first
//   report came from production on 2026-10-12 at a 390x844 window. The
//   Landing page measured a scroll width of 586px against a client width of
//   375px. A later comment says the overflow does not occur at HEAD. This
//   probe answers that with numbers, not with memory.
//
// Why the built app:
//   The probe serves the production build with `vite preview`. The report is
//   about production, and only the built CSS and the built bundle ship. A dev
//   server adds its own client and its own module graph, so a number read
//   there can differ from the number a phone reads.
//
// What it measures:
//   At each width it reads `documentElement.scrollWidth` and `clientWidth`.
//   It then names every element whose right edge crosses the window, and it
//   says if a clipping ancestor holds that element inside the window. An
//   element that crosses the window with no such ancestor is a real
//   overflow. An element that a within-window ancestor clips is decoration
//   that paints past the edge on purpose.
//
//   The page number alone is not enough. The root rule `html
//   { overflow-x: clip }` prunes the overflow, so the document can report a
//   clean width while content still sits past the edge. The element list is
//   the part that a root clip cannot fool.
//
// Exit codes:
//   0 no real overflow · 1 a real overflow exists · 2 the probe cannot run
// ============================================================================

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PORT = Number(process.env.OVERFLOW_PORT ?? 4321)
const BASE = `http://127.0.0.1:${PORT}`
const WIDTHS = [320, 360, 375, 390, 414]
const HEIGHT = 844
const ROUTES = ['/', '/explore']
const ROUTE_LABEL = { '/': 'Landing', '/explore': 'Explore' }
const EPS = 1
const MAX_ELEMENTS = 40
const SETTLE_MS = 1600
const MOTION_PASSES = ['reduce', 'no-preference']
const MOTION_LABEL = { reduce: 'rest', 'no-preference': 'motion' }

// The overflow values that clip a descendant. `clip` prunes without a scroll
// box. `auto` and `scroll` clip and add a scrollbar. `visible` does not clip,
// so a wide child pushes the page wider.
export const CLIPPING = new Set(['hidden', 'clip', 'auto', 'scroll'])

// The nearest ancestor that clips the element, or null. An ancestor clips
// only when it sits in the element's containing-block chain, so a wide child
// of a `position: fixed` box is not held by an `overflow: hidden` grandparent.
// The `cb` mark on each ancestor says where a chain starts: `transform` for a
// box that makes the containing block for every descendant, `positioned` for
// one that makes it only for boxes that are not fixed, `block` for a plain
// block container, and `none` for an inline box. A chain starts at the first
// marked ancestor, and that ancestor itself can clip.
function chainStarts(cb, position) {
  if (position === 'fixed') return cb === 'transform'
  if (position === 'absolute') return cb === 'transform' || cb === 'positioned'
  return cb === 'transform' || cb === 'positioned' || cb === 'block'
}

function clippingAncestor(el) {
  const chain = el.ancestors ?? []
  let inChain = false
  for (const a of chain) {
    if (chainStarts(a.cb, el.position)) inChain = true
    if (inChain && CLIPPING.has(a.overflowX)) return a
  }
  return null
}

// Sorts the elements whose right edge crosses the window into real overflows
// and clipped decoration. Pure: no fs, no process, no browser. The test file
// `tests/landing-overflow-probe.test.ts` pins this function.
//
// An element that a section clips is decoration: the section is no wider than
// the window, so nothing that the user can reach is cut. An element that only
// the root element clips is not decoration. The root rule `html
// { overflow-x: clip }` is a global guard, and it is the thing that hides a
// document which is wider than the window. Such an element is a real overflow,
// because a clip that holds it is also the clip that hides the defect.
export function classifyCrossings(elements, viewportWidth, eps = EPS) {
  const real = []
  const clipped = []
  for (const el of elements) {
    if (!(el.right > viewportWidth + eps)) continue
    const clipper = clippingAncestor(el)
    const past = Math.round((el.right - viewportWidth) * 10) / 10
    if (clipper && !clipper.root && clipper.right <= viewportWidth + eps) {
      clipped.push({
        id: el.id,
        right: el.right,
        past,
        clipper: clipper.id,
        clipperRight: clipper.right,
      })
    } else {
      const reason = !clipper
        ? 'no ancestor clips it'
        : clipper.root
          ? 'only the root clip holds it, so the document is wider than the window'
          : `the clipping ancestor ${clipper.id} reaches ${clipper.right}px, past the ${viewportWidth}px window`
      real.push({ id: el.id, right: el.right, past, reason })
    }
  }
  return { real, clipped }
}

// True when the page itself is wider than the window. This is the number a
// phone shows as a sideways scroll, so it is the primary page signal.
export function hasRealPageOverflow(scrollWidth, clientWidth, eps = EPS) {
  return scrollWidth > clientWidth + eps
}

// Reads the page. This runs in the browser, so it takes no value from this
// scope and it returns plain data only.
function collectPage({ eps, limit }) {
  const root = document.documentElement
  const vw = root.clientWidth
  const label = (el) => {
    const name = typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).join('.')}`
      : ''
    let nth = ''
    const parent = el.parentElement
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === el.tagName)
      if (same.length > 1) nth = `:nth-of-type(${same.indexOf(el) + 1})`
    }
    return `${el.tagName.toLowerCase()}${name}${nth}`
  }
  const cbKind = (cs) => {
    if (cs.transform && cs.transform !== 'none') return 'transform'
    if (cs.filter && cs.filter !== 'none') return 'transform'
    if (cs.perspective && cs.perspective !== 'none') return 'transform'
    if (cs.willChange && /transform|perspective|filter/.test(cs.willChange)) return 'transform'
    if (cs.contain && /paint|layout|strict|content/.test(cs.contain)) return 'transform'
    if (cs.position && cs.position !== 'static') return 'positioned'
    if (/^(block|flex|grid|flow-root|list-item|table)/.test(cs.display)) return 'block'
    return 'none'
  }
  const crossing = []
  const crossed = new Set()
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 && r.height <= 0) continue
    if (r.right > vw + eps) {
      crossing.push({ el, right: r.right })
      crossed.add(el)
    }
  }
  // Keep the outermost crossings only. A child whose parent also crosses adds
  // no new fact, and a ticker row holds hundreds of them.
  const outer = crossing.filter(({ el }) => !crossed.has(el.parentElement))
  const elements = outer.slice(0, limit).map(({ el, right }) => {
    const ancestors = []
    let p = el.parentElement
    while (p && ancestors.length < 12) {
      const cs = getComputedStyle(p)
      ancestors.push({
        id: label(p),
        right: p.getBoundingClientRect().right,
        overflowX: cs.overflowX,
        cb: cbKind(cs),
        root: p === document.documentElement,
      })
      p = p.parentElement
    }
    return { id: label(el), right, position: getComputedStyle(el).position, ancestors }
  })
  return {
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
    rendered: document.querySelectorAll('.route-panel > *').length,
    total: crossing.length,
    outer: outer.length,
    elements,
  }
}

// A run that cannot start. #656: a direct process.exit can cut the message
// short on Windows while the write still sits in the queue, so this sets the
// code and unwinds instead. `main` catches it and returns the code.
class ProbeStop extends Error {}

function fail(message) {
  console.error(`\nlanding overflow probe: ${message}`)
  throw new ProbeStop(message)
}

// The whole run: read the command line, serve the build, drive the browser
// and print the verdict. It runs only when this file is the entry point, so
// the test file imports the pure functions above and starts no browser.
// It returns the exit code, and the entry point below assigns that code.
async function main() {
  let server = null
  let browser = null
  let serverDeath = ''
  let stopping = false
  const rows = []
  const selftestRows = []

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

  // The known-bad input for the self-test. It adds a box that is twice the
  // window wide, and it removes the root clip that would otherwise hide it.
  // Without the second half the root rule holds the box and the probe stays
  // green, which is correct but proves nothing.
  async function breakPage(page) {
    await page.addStyleTag({ content: 'html { overflow-x: visible !important; }' })
    await page.evaluate(() => {
      const d = document.createElement('div')
      d.setAttribute('data-probe', 'canary')
      d.style.cssText = 'position:absolute;top:0;left:0;width:200vw;height:24px'
      document.body.appendChild(d)
    })
    await page.waitForTimeout(400)
  }

  // One measurement: one route, one width, one motion setting. `broken` feeds
  // the known-bad input, which only the self-test sets.
  async function measure(browser, route, width, reducedMotion, broken) {
    if (serverDeath) fail(serverDeath)
    const ctx = await browser.newContext({ viewport: { width, height: HEIGHT }, reducedMotion })
    const page = await ctx.newPage()
    try {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForSelector('.route-panel > *', { timeout: 20000 }).catch(() => {})
      await page.waitForTimeout(SETTLE_MS)
      if (broken) await breakPage(page)
      const raw = await page.evaluate(collectPage, { eps: EPS, limit: MAX_ELEMENTS })
      const cls = classifyCrossings(raw.elements, raw.clientWidth, EPS)
      return {
        route,
        width,
        motion: reducedMotion,
        raw,
        cls,
        pageOverflow: hasRealPageOverflow(raw.scrollWidth, raw.clientWidth, EPS),
        bad: hasRealPageOverflow(raw.scrollWidth, raw.clientWidth, EPS) || cls.real.length > 0,
      }
    } finally {
      await ctx.close()
    }
  }

  function printRun(rows) {
    const bad = rows.filter((r) => r.bad)
    const crossings = rows.flatMap((r) => [
      ...r.cls.real.map((c) => ({ r, c, kind: 'REAL' })),
      ...r.cls.clipped.map((c) => ({ r, c, kind: 'clipped' })),
    ])

    console.log('landing overflow probe — issue #670')
    console.log(`source: built app (dist/ served by vite preview on 127.0.0.1:${PORT})`)
    console.log(`widths: ${WIDTHS.join(', ')} px · height ${HEIGHT} px · tolerance ${EPS} px · motion: rest and motion\n`)

    for (const route of ROUTES) {
      const mine = rows.filter((r) => r.route === route)
      console.log(`${route}  ${ROUTE_LABEL[route]}`)
      for (const width of WIDTHS) {
        for (const motion of MOTION_PASSES) {
          const r = mine.find((x) => x.width === width && x.motion === motion)
          if (!r) continue
          const page = r.pageOverflow
            ? `scroll ${r.raw.scrollWidth} / client ${r.raw.clientWidth}  PAGE OVERFLOW`
            : `scroll ${r.raw.scrollWidth} / client ${r.raw.clientWidth}`
          const note = r.cls.real.length > 0
            ? `${r.cls.real.length} real, ${r.cls.clipped.length} clipped  REAL OVERFLOW`
            : `clean, ${r.cls.clipped.length} clipped`
          console.log(`  ${String(width).padStart(3)}px  ${MOTION_LABEL[motion].padEnd(6)}  ${page}  ${note}`)
        }
      }
      console.log('')
    }

    if (crossings.length > 0) {
      console.log('right-edge crossings — an element whose right edge sits past the window')
      for (const { r, c, kind } of crossings) {
        const head = `  ${r.route} ${r.width}px (${MOTION_LABEL[r.motion]})  ${c.id}`
        if (kind === 'REAL') {
          console.log(`${head}  right ${c.right}px (${c.past}px past the window)  REAL — ${c.reason}`)
        } else {
          console.log(`${head}  right ${c.right}px (${c.past}px past the window)  clipped by ${c.clipper} (right ${c.clipperRight}px)`)
        }
      }
      console.log('')
    }

    if (bad.length === 0) {
      console.log(`landing overflow probe: PASS — 0 real overflow(s) across ${ROUTES.length} routes x ${WIDTHS.length} widths x ${MOTION_PASSES.length} motion passes.`)
      console.log(`The ${crossings.length} right-edge crossing(s) above are decoration that a within-window ancestor clips.`)
    } else {
      console.log(`landing overflow probe: FAIL — ${bad.length} measurement(s) hold a real overflow:`)
      for (const r of bad) {
        for (const c of r.cls.real) {
          console.log(`  ${r.route} ${r.width}px (${MOTION_LABEL[r.motion]})  ${c.id}  right ${c.right}px (${c.past}px past the window)  ${c.reason}`)
        }
        if (r.pageOverflow && r.cls.real.length === 0) {
          console.log(`  ${r.route} ${r.width}px (${MOTION_LABEL[r.motion]})  the page is wider than the window: scroll ${r.raw.scrollWidth} vs client ${r.raw.clientWidth}`)
        }
      }
    }
    return bad.length
  }

  function printSelftest(rows) {
    const detected = rows.filter((r) => r.broken.bad).length
    console.log('landing overflow probe — self-test: can the probe go red?')
    console.log('known-bad input: a box that is 200vw wide, with the root clip removed\n')
    console.log('  width  clean page                          bad page')
    for (const r of rows) {
      const clean = r.clean.pageOverflow
        ? `scroll ${r.clean.raw.scrollWidth}/${r.clean.raw.clientWidth}, ${r.clean.cls.real.length} real, PAGE OVERFLOW`
        : `scroll ${r.clean.raw.scrollWidth}/${r.clean.raw.clientWidth}, ${r.clean.cls.real.length} real`
      const broken = r.broken.pageOverflow
        ? `scroll ${r.broken.raw.scrollWidth}/${r.broken.raw.clientWidth}, ${r.broken.cls.real.length} real, PAGE OVERFLOW`
        : `scroll ${r.broken.raw.scrollWidth}/${r.broken.raw.clientWidth}, ${r.broken.cls.real.length} real`
      console.log(`  ${String(r.width).padStart(3)}px  ${clean.padEnd(36)} ${broken}`)
    }
    console.log('')
    if (detected === rows.length) {
      console.log(`self-test: PASS — the probe went red on the known-bad input at ${detected}/${rows.length} width(s).`)
    } else {
      console.log(`self-test: FAIL — the probe stayed green at ${rows.length - detected}/${rows.length} width(s) on a page that is known to overflow.`)
    }
    return detected === rows.length ? 0 : 1
  }

  let jsonMode = false
  let selftestMode = false
  try {
    const argv = process.argv.slice(2)
    jsonMode = argv.includes('--json')
    selftestMode = argv.includes('--selftest')
    const known = ['--json', '--selftest']
    for (const a of argv) {
      if (!known.includes(a)) fail(`unknown argument "${a}". Usage: landing-overflow-probe [--json] [--selftest]`)
    }

    if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
      fail(`OVERFLOW_PORT must be a port number from 1024 to 65535, got "${process.env.OVERFLOW_PORT}".`)
    }

    if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
      fail('dist/index.html is missing — run `npm run build` first. The probe measures the built app.')
    }

    const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
    if (!existsSync(viteBin)) fail(`vite is not installed at ${viteBin} — run \`npm ci\` first.`)
    server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let serverLog = ''
    server.stderr.on('data', (d) => { serverLog += d.toString() })
    // The teardown in `finally` below is what ends this server, and `vite
    // preview` catches SIGTERM and exits 143. Only `stopping` separates "died
    // while the check ran" from "we are done". A death is recorded and not
    // thrown, so the next measurement stops the run with the sentence that
    // explains it.
    server.on('exit', (code) => {
      if (stopping) return
      if (code !== 0 && code !== null) serverDeath = `vite preview exited with ${code}:\n${serverLog}`
    })

    await waitForServer()
    browser = await launchChrome()

    if (selftestMode) {
      for (const width of WIDTHS) {
        selftestRows.push({
          width,
          clean: await measure(browser, '/', width, 'reduce', false),
          broken: await measure(browser, '/', width, 'reduce', true),
        })
      }
      return printSelftest(selftestRows)
    }

    for (const route of ROUTES) {
      for (const width of WIDTHS) {
        for (const motion of MOTION_PASSES) {
          rows.push(await measure(browser, route, width, motion, false))
        }
      }
    }

    if (jsonMode) {
      console.log(JSON.stringify({
        ok: rows.every((r) => !r.bad),
        widths: WIDTHS,
        routes: ROUTES,
        rows: rows.map((r) => ({
          route: r.route,
          width: r.width,
          motion: r.motion,
          scrollWidth: r.raw.scrollWidth,
          clientWidth: r.raw.clientWidth,
          rendered: r.raw.rendered,
          pageOverflow: r.pageOverflow,
          real: r.cls.real,
          clipped: r.cls.clipped,
        })),
      }, null, 2))
      return rows.every((r) => !r.bad) ? 0 : 1
    }

    return printRun(rows) > 0 ? 1 : 0
  } catch (e) {
    // A run that cannot start returns 2. Anything else is a real defect in the
    // probe itself, so it is re-thrown and the stack reaches the terminal.
    if (e instanceof ProbeStop) return 2
    throw e
  } finally {
    await browser?.close().catch(() => {})
    stopping = true
    server?.kill()
  }
}

// Self-execute only when run directly, so tests can import the pure functions.
// #656: the code is assigned and not forced, so the last printed line reaches
// the terminal before the process ends.
if (process.argv[1] && process.argv[1].endsWith('landing-overflow-probe.mjs')) {
  process.exitCode = await main()
}
