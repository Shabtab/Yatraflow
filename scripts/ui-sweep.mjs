#!/usr/bin/env node
/*
 * ui-sweep: dev-only screenshot sweep for the YatraFlow web app.
 *
 * Usage:
 *   npm run ui:sweep -- --routes /,/explore,/auth,/dmca --hover
 *   node scripts/ui-sweep.mjs --routes /explore --themes dark --widths 390
 *   node scripts/ui-sweep.mjs --routes /explore --motion --out <dir>
 *   node scripts/ui-sweep.mjs --routes /trips --profile-dir <dir>
 *   node scripts/ui-sweep.mjs --routes /explore --full-page
 *
 * Flags:
 *   --base <url>               Dev server origin. Default http://localhost:5191.
 *   --routes <list>            Comma list of app paths. Default: /,/explore,/auth,/dmca.
 *   --themes <list>            light, dark, or both. Default: light,dark.
 *   --widths <list>            Viewport widths in px. Default: 1280,390.
 *   --out <dir>                Output folder. Default: .verify-evidence/sweep/<branch>/.
 *   --profile-dir <dir>        Persistent browser profile. Reuse it to keep a sign-in.
 *   --expect-signed-in <mode>  auto, yes, or no. Default auto. auto expects a signed-in
 *                              session on /trips, /purchases, /profile, /new, /creator-hub,
 *                              /admin, /trip/*, and /created/*. yes expects it on every
 *                              route. no expects none. An expected shot that renders the
 *                              landing prints a warning.
 *   --hover                    Also shoot hover states on the first .ex-card or .mt-card and the first .btn-primary.
 *   --motion                   Sample opacity and transform of the page root children for 1.2 s after load.
 *   --full-page                Static shot covers the full page height, not just the viewport.
 *                              Height is capped at 16000 px. Hover shots stay viewport-only.
 *   --cdp-port <n>             DevTools port for the browser. Default 9447.
 *   --help                     Show this header.
 *
 * Output:
 *   <slug>-<width>-<theme>.png          One per shot. Root route slug is "root".
 *   <slug>-<width>-<theme>-hover-*.png  One per hover shot found.
 *   <slug>-<width>-<theme>.motion.json  One per shot with --motion.
 *   sweep.jsonl                         One JSON line per shot. Appended on each run.
 *                                       Overflowing shots carry overflowCulprit: { selector, right }
 *                                       or null. It names the first element past the viewport edge.
 *
 * Notes:
 *   This script never signs in and never reads or prints credentials. Sign in
 *   once with --profile-dir, then reuse that folder.
 *   The app uses path routes. A signed-out visit to a signed-in route keeps its
 *   URL and renders the landing page. A shot is marked "rendersLanding": true
 *   when its first h1 is the landing headline. It is marked "redirected": true
 *   when its final path differs from the route, or when it renders the landing
 *   on any route other than "/".
 *   A signed-out run prints one WARNING line per shot and one SIGNED-OUT summary.
 *   Overflow, console and signed-out findings do not change the exit code. Only
 *   a script failure exits 1.
 *   Needs Node 22 or newer and Microsoft Edge or Google Chrome. Set
 *   UI_SWEEP_BROWSER to a browser executable to override the search.
 */
import { execFileSync, spawn } from 'node:child_process'
import { request } from 'node:http'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(SCRIPT_PATH), '..')
const THEME_KEY = 'yatraflow_theme' // src/lib/theme.ts
const DEFAULT_ROUTES = ['/', '/explore', '/auth', '/dmca']
const DEFAULT_THEMES = ['light', 'dark']
const DEFAULT_WIDTHS = [1280, 390]
const VIEWPORT_HEIGHT = 900
const SETTLE_MS = 600
const NETWORK_IDLE_QUIET_MS = 500
const NETWORK_IDLE_CAP_MS = 8000
const LOAD_TIMEOUT_MS = 20000
const MOTION_WAIT_MS = 4000
const FULL_PAGE_MAX_HEIGHT = 16000 // px. Chrome cannot capture much taller in one PNG.
const EXPECT_SIGNED_IN_MODES = ['auto', 'yes', 'no']
const SIGNED_IN_ROUTES = ['/trips', '/purchases', '/profile', '/new', '/creator-hub', '/admin']
const SIGNED_IN_PREFIXES = ['/trip/', '/created/']
// src/pages/Landing.tsx renders "Plan trips that actually flow together" as its first h1.
// Match on this stable part only, case-insensitively.
const LANDING_H1_MATCH = 'plan trips that actually'
const HOVER_TARGETS = [
  { shot: 'hover-card', selector: '.ex-card, .mt-card' },
  { shot: 'hover-btn', selector: '.btn-primary' },
]
const BROWSERS = [
  process.env.UI_SWEEP_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const sleep = ms => new Promise(done => setTimeout(done, ms))

function usage() {
  const source = readFileSync(SCRIPT_PATH, 'utf8')
  console.log(source.slice(0, source.indexOf('*/') + 2).replace(/^#!.*\n/, ''))
}

function parseArgs(argv) {
  const options = { hover: false, motion: false, 'full-page': false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--hover' || arg === '--motion' || arg === '--full-page' || arg === '--help') {
      options[arg.slice(2)] = true
      continue
    }
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`)
    const value = argv[++i]
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${arg}`)
    options[arg.slice(2)] = value
  }
  return options
}

function listOf(value, fallback) {
  if (value === undefined) return fallback
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

function buildConfig(options) {
  const routes = listOf(options.routes, DEFAULT_ROUTES).map(route => (route.startsWith('/') ? route : `/${route}`))
  const themes = listOf(options.themes, DEFAULT_THEMES)
  for (const theme of themes) if (!DEFAULT_THEMES.includes(theme)) throw new Error(`unknown theme: ${theme}`)
  const widths = listOf(options.widths, DEFAULT_WIDTHS.map(String)).map(Number)
  for (const width of widths) if (!Number.isInteger(width) || width < 280) throw new Error(`bad width: ${width}`)
  const branch = gitBranch()
  const out = options.out ? resolve(options.out) : join(ROOT, '.verify-evidence', 'sweep', branch)
  const cdpPort = Number(options['cdp-port'] ?? 9447)
  const expectSignedIn = options['expect-signed-in'] ?? 'auto'
  if (!EXPECT_SIGNED_IN_MODES.includes(expectSignedIn)) throw new Error(`bad --expect-signed-in: ${expectSignedIn}`)
  return {
    base: (options.base ?? 'http://localhost:5191').replace(/\/+$/, ''),
    routes,
    themes,
    widths,
    out,
    profileDir: options['profile-dir'] ? resolve(options['profile-dir']) : null,
    hover: options.hover,
    motion: options.motion,
    fullPage: options['full-page'],
    expectSignedIn,
    cdpPort,
  }
}

// True when this route needs a signed-in session. Mode "yes" or "no" overrides the route list.
function expectsSignedIn(route, mode) {
  if (mode === 'yes') return true
  if (mode === 'no') return false
  const path = normalizePath(route)
  return SIGNED_IN_ROUTES.includes(path) || SIGNED_IN_PREFIXES.some(prefix => path.startsWith(prefix))
}

function gitBranch() {
  try {
    const name = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
    return name.replace(/[^A-Za-z0-9._-]+/g, '-') || 'unknown-branch'
  } catch {
    return 'unknown-branch'
  }
}

// Plain node:http. Undici fetch can abort Node on Windows when a request is refused.
function httpGet(url) {
  return new Promise(done => {
    const req = request(url, { agent: false, timeout: 3000 }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => done({ status: res.statusCode ?? 0, body }))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => done({ status: 0, body: '' }))
    req.end()
  })
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(300)
  }
  throw new Error(`timed out waiting for ${label}`)
}

function browserExecutable() {
  const found = BROWSERS.find(path => existsSync(path))
  if (!found) throw new Error('no Edge or Chrome found; set UI_SWEEP_BROWSER to the executable')
  return found
}

// One CDP page session over WebSocket. Node 22+ provides the global WebSocket.
class Cdp {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
    this.handlers = new Set()
  }

  open() {
    return new Promise((ok, fail) => {
      this.ws = new WebSocket(this.url)
      this.ws.onopen = () => ok()
      this.ws.onerror = () => fail(new Error('CDP websocket failed to open'))
      this.ws.onmessage = event => this.#receive(JSON.parse(event.data))
    })
  }

  #receive(message) {
    if (message.id !== undefined && this.pending.has(message.id)) {
      const { ok, fail } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) fail(new Error(message.error.message))
      else ok(message.result ?? {})
    } else if (message.method) {
      for (const handler of this.handlers) handler(message)
    }
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }))
  }

  on(handler) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  close() {
    this.ws?.close()
  }
}

function waitForEvent(cdp, method, timeoutMs) {
  return new Promise((ok, fail) => {
    const off = cdp.on(message => {
      if (message.method !== method) return
      clearTimeout(timer)
      off()
      ok(message.params)
    })
    const timer = setTimeout(() => {
      off()
      fail(new Error(`timed out waiting for ${method}`))
    }, timeoutMs)
  })
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'evaluate failed')
  return result.result?.value
}

// Runs in the page. Reads the facts the JSON line needs.
const PAGE_INFO = () => {
  const doc = document.documentElement
  const h1s = Array.from(document.querySelectorAll('h1'))
  const first = h1s[0]
  const overflow = doc.scrollWidth > window.innerWidth

  // Skips decoration that cannot widen the page: aria-hidden or pointer-events none,
  // a position:fixed element, or an element clipped by an ancestor with overflow hidden or clip.
  const isDecoration = el => {
    for (let node = el; node && node !== doc; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (node.getAttribute('aria-hidden') === 'true' || style.pointerEvents === 'none') return true
      if (style.position === 'fixed') return true
      if (node !== el && /hidden|clip/.test(style.overflowX + ' ' + style.overflowY)) return true
    }
    return false
  }
  const describe = el => {
    const classes = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + classes.map(name => `.${name}`).join('')
  }
  const findCulprit = () => {
    const limit = window.innerWidth + 1
    for (const el of document.querySelectorAll('body *')) {
      const right = el.getBoundingClientRect().right
      if (right <= limit || isDecoration(el)) continue
      return { selector: describe(el), right: Math.round(right * 100) / 100 }
    }
    return null
  }

  return {
    finalHash: location.hash,
    finalPath: location.pathname + location.search,
    innerWidth: window.innerWidth,
    scrollWidth: doc.scrollWidth,
    overflow,
    overflowCulprit: overflow ? findCulprit() : undefined,
    h1Count: h1s.length,
    h1: first ? first.textContent.replace(/\s+/g, ' ').trim() : null,
    themeApplied: doc.dataset.theme ?? null,
  }
}

// Runs in the page before any app script. Samples the page root's children once per frame.
const MOTION_SCRIPT = () => {
  const state = { done: false, rootSelector: null, frames: [] }
  window.__uiSweepMotion = state
  const started = performance.now()
  const pickRoot = () => {
    for (const selector of ['.page-enter', 'main']) {
      const el = document.querySelector(selector)
      if (el) return { el, selector }
    }
    return null
  }
  const tick = now => {
    const elapsed = Math.round(now - started)
    const picked = pickRoot()
    if (picked) {
      state.rootSelector = picked.selector
      state.frames.push({
        t: elapsed,
        children: Array.from(picked.el.children).map((child, index) => {
          const style = getComputedStyle(child)
          const cls = typeof child.className === 'string' ? child.className.slice(0, 80) : ''
          return { i: index, tag: child.tagName.toLowerCase(), cls, opacity: style.opacity, transform: style.transform }
        }),
      })
    }
    if (elapsed < 1200) requestAnimationFrame(tick)
    else state.done = true
  }
  requestAnimationFrame(tick)
}

// Runs in the page before any app script. Sets the theme the same way src/lib/theme.ts does.
function themeScript(theme) {
  return `try { localStorage.setItem(${JSON.stringify(THEME_KEY)}, ${JSON.stringify(theme)}) } catch (e) {}`
}

function slugOf(route) {
  return route.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root'
}

function normalizePath(path) {
  const bare = (path || '/').split('?')[0].replace(/\/index\.html$/, '/').replace(/\/+$/, '')
  return bare === '' ? '/' : bare
}

async function launchBrowser(config, profileDir) {
  const port = config.cdpPort
  if ((await httpGet(`http://127.0.0.1:${port}/json/version`)).status === 200) {
    throw new Error(`port ${port} already answers; pass --cdp-port <n> with a free port`)
  }
  const child = spawn(browserExecutable(), [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=1280,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  await waitFor(async () => (await httpGet(`http://127.0.0.1:${port}/json/version`)).status === 200, 30000, 'browser CDP endpoint')
  return child
}

async function pageSocketUrl(port) {
  let target = null
  await waitFor(async () => {
    const list = await httpGet(`http://127.0.0.1:${port}/json/list`)
    if (list.status !== 200) return false
    target = JSON.parse(list.body).find(entry => entry.type === 'page' && entry.webSocketDebuggerUrl)
    return Boolean(target)
  }, 15000, 'a browser page target')
  return target.webSocketDebuggerUrl
}

async function closeBrowser(child, port) {
  try {
    const version = await httpGet(`http://127.0.0.1:${port}/json/version`)
    const browser = new Cdp(JSON.parse(version.body).webSocketDebuggerUrl)
    await browser.open()
    browser.send('Browser.close').catch(() => {})
    await sleep(500)
    browser.close()
  } catch {
    // The browser may already be gone. The kill below covers that case.
  }
  if (child.exitCode !== null) return
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* already gone */ }
  } else {
    child.kill('SIGKILL')
  }
}

async function waitForNetworkIdle(inflight) {
  const started = Date.now()
  let quietSince = Date.now()
  while (Date.now() - started < NETWORK_IDLE_CAP_MS) {
    if (inflight.size > 0) quietSince = Date.now()
    else if (Date.now() - quietSince >= NETWORK_IDLE_QUIET_MS) return true
    await sleep(100)
  }
  return false
}

async function waitForMotion(cdp) {
  const started = Date.now()
  while (Date.now() - started < MOTION_WAIT_MS) {
    if (await evaluate(cdp, 'Boolean(window.__uiSweepMotion && window.__uiSweepMotion.done)')) return true
    await sleep(150)
  }
  return false
}

async function captureShot(cdp) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  return Buffer.from(shot.data, 'base64')
}

// Captures the full scroll height at the given width. Returns the PNG and the page height in px.
async function captureFullPage(cdp, width) {
  const metrics = await cdp.send('Page.getLayoutMetrics')
  const size = metrics.cssContentSize ?? metrics.contentSize
  const pageHeight = Math.ceil(size.height)
  const height = Math.min(pageHeight, FULL_PAGE_MAX_HEIGHT)
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  })
  return { buffer: Buffer.from(shot.data, 'base64'), pageHeight, capped: pageHeight > FULL_PAGE_MAX_HEIGHT }
}

async function hoverShot(cdp, target) {
  const point = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(target.selector)})
    if (!el) return null
    el.scrollIntoView({ block: 'center', behavior: 'instant' })
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (!point) return { found: false, png: null }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await sleep(SETTLE_MS)
  return { found: true, buffer: await captureShot(cdp) }
}

async function runShot(cdp, state, config, job) {
  const { route, width, theme } = job
  const base = `${slugOf(route)}-${width}-${theme}`
  const record = {
    runAt: state.runAt,
    route,
    width,
    theme,
    shot: 'static',
    png: `${base}.png`,
    expectSignedIn: expectsSignedIn(route, config.expectSignedIn),
    fullPage: config.fullPage,
  }
  const addedScripts = []
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: VIEWPORT_HEIGHT, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] })
  try {
    addedScripts.push((await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: themeScript(theme) })).identifier)
    if (config.motion) {
      addedScripts.push((await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${MOTION_SCRIPT.toString()})()` })).identifier)
    }
    state.consoleErrors.length = 0
    state.inflight.clear()
    const loaded = waitForEvent(cdp, 'Page.loadEventFired', LOAD_TIMEOUT_MS).then(() => true, () => false)
    const nav = await cdp.send('Page.navigate', { url: config.base + route })
    if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText}`)
    record.loaded = await loaded
    record.networkIdle = await waitForNetworkIdle(state.inflight)
    await sleep(SETTLE_MS)

    if (config.motion) {
      const motionReady = await waitForMotion(cdp)
      const motion = await evaluate(cdp, 'window.__uiSweepMotion ? { rootSelector: window.__uiSweepMotion.rootSelector, frames: window.__uiSweepMotion.frames } : null')
      const motionFile = `${base}.motion.json`
      writeFileSync(join(config.out, motionFile), JSON.stringify({ route, width, theme, complete: motionReady, ...motion }, null, 2))
      record.motionFile = motionFile
      record.motionComplete = motionReady
    }

    const info = await evaluate(cdp, `(${PAGE_INFO.toString()})()`)
    Object.assign(record, info)
    record.rendersLanding = info.h1 !== null && info.h1.toLowerCase().includes(LANDING_H1_MATCH)
    record.redirected = normalizePath(info.finalPath) !== normalizePath(route)
      || (record.rendersLanding && normalizePath(route) !== '/')
    record.consoleErrors = state.consoleErrors.slice(0, 50)
    if (record.expectSignedIn && record.rendersLanding) {
      console.error(`WARNING signed-out: ${route} ${width} ${theme} rendered the landing, not the signed-in page`)
    }
    if (config.fullPage) {
      const full = await captureFullPage(cdp, width)
      record.pageHeight = full.pageHeight
      if (full.capped) record.fullPageCapped = true
      writeFileSync(join(config.out, record.png), full.buffer)
    } else {
      writeFileSync(join(config.out, record.png), await captureShot(cdp))
    }

    if (config.hover) {
      for (const target of HOVER_TARGETS) {
        const hover = await hoverShot(cdp, target)
        const hoverRecord = { ...record, shot: target.shot, found: hover.found, png: hover.found ? `${base}-${target.shot}.png` : null }
        if (hover.found) writeFileSync(join(config.out, hoverRecord.png), hover.buffer)
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
        appendFileSync(join(config.out, 'sweep.jsonl'), `${JSON.stringify(hoverRecord)}\n`)
      }
    }
  } catch (error) {
    record.error = error.message
  } finally {
    for (const identifier of addedScripts) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {})
  }
  appendFileSync(join(config.out, 'sweep.jsonl'), `${JSON.stringify(record)}\n`)
  const errorCount = record.consoleErrors?.length ?? 0
  console.log(`${record.error ? 'ERR ' : 'ok  '} ${route} ${width} ${theme} -> ${record.png} redirected=${record.redirected ?? 'n/a'} rendersLanding=${record.rendersLanding ?? 'n/a'} overflow=${record.overflow ?? 'n/a'} consoleErrors=${errorCount}${record.error ? ` error="${record.error}"` : ''}`)
  return record
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) return usage()
  const config = buildConfig(options)

  if ((await httpGet(config.base)).status !== 200) {
    throw new Error(`app is not answering at ${config.base}; start the dev server first`)
  }
  mkdirSync(config.out, { recursive: true })
  const profileDir = config.profileDir ?? mkdtempSync(join(tmpdir(), 'ui-sweep-'))
  mkdirSync(profileDir, { recursive: true })

  console.log(`sweep ${config.base} -> ${config.out}`)
  const child = await launchBrowser(config, profileDir)
  const cdp = new Cdp(await pageSocketUrl(config.cdpPort))
  try {
    await cdp.open()
    const state = { runAt: new Date().toISOString(), consoleErrors: [], inflight: new Map() }
    cdp.on(message => {
      const { method, params } = message
      if (method === 'Network.requestWillBeSent') state.inflight.set(params.requestId, true)
      else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') state.inflight.delete(params.requestId)
      else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
        state.consoleErrors.push(params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' ').slice(0, 300))
      } else if (method === 'Runtime.exceptionThrown') {
        const details = params.exceptionDetails
        state.consoleErrors.push(String(details.exception?.description ?? details.text).slice(0, 300))
      } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
        state.consoleErrors.push(`${params.entry.text} ${params.entry.url ?? ''}`.trim().slice(0, 300))
      }
    })
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    await cdp.send('Log.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

    const signedIn = { shots: 0, landing: 0 }
    for (const route of config.routes) {
      for (const width of config.widths) {
        for (const theme of config.themes) {
          const record = await runShot(cdp, state, config, { route, width, theme })
          if (record.expectSignedIn && !record.error) {
            signedIn.shots++
            if (record.rendersLanding) signedIn.landing++
          }
        }
      }
    }
    if (signedIn.landing > 0) {
      console.error(`SIGNED-OUT: ${signedIn.landing} of ${signedIn.shots} signed-in shots rendered the landing; sign in on ${config.base} with --profile-dir and re-run`)
    }
  } finally {
    cdp.close()
    await closeBrowser(child, config.cdpPort)
    if (!config.profileDir) {
      // The browser can still hold its files for a moment after it closes. A leftover temp folder is not a failure.
      try {
        rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
      } catch {
        console.error(`could not remove temp profile ${profileDir}; delete it by hand`)
      }
    }
  }
}

main().catch(error => {
  console.error(`ui-sweep failed: ${error.message}`)
  process.exitCode = 1
})
