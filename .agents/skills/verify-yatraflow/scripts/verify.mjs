#!/usr/bin/env node
// verify-yatraflow harness. Zero dependencies; needs Node 22+ (global WebSocket).
//
//   node .agents/skills/verify-yatraflow/scripts/verify.mjs start
//   node .agents/skills/verify-yatraflow/scripts/verify.mjs doctor
//   node .agents/skills/verify-yatraflow/scripts/verify.mjs signin
//   node .agents/skills/verify-yatraflow/scripts/verify.mjs trips
//   node .agents/skills/verify-yatraflow/scripts/verify.mjs drive <route> <name> [--click <text>] [--expect <text>] [--width <px>] [--settle <ms>] [--signin]
//   node .agents/skills/verify-yatraflow/scripts/verify.mjs stop
//
// Overrides: VERIFY_APP_PORT (default 5178), VERIFY_CDP_PORT (default 9333),
// VERIFY_BROWSER (path to an Edge or Chrome executable).
// Signed-in checks read VERIFY_TEST_EMAIL and VERIFY_TEST_PASSWORD from .env.local
// or the process environment. Their values are never printed or saved.
//
// Everything this harness starts is recorded under .verify-evidence/run/ and
// is killed by PID tree on `stop`. It never kills by process name, and it never
// touches a server on the port it did not start.
import { execFileSync, spawn } from 'node:child_process'
import { request } from 'node:http'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const APP_PORT = Number(process.env.VERIFY_APP_PORT ?? 5178)
const APP_ORIGIN = `http://localhost:${APP_PORT}`
const CDP_PORT = Number(process.env.VERIFY_CDP_PORT ?? 9333)
const EVIDENCE = join(ROOT, '.verify-evidence')
const RUN = join(EVIDENCE, 'run')
const DEV_PID = join(RUN, 'dev.pid')
const BROWSER_PID = join(RUN, 'browser.pid')
const DEV_LOG = join(RUN, 'dev.log')
const BROWSER_PROFILE = join(RUN, 'browser-profile')

const BROWSERS = [
  process.env.VERIFY_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const env = readEnvFile(join(ROOT, '.env.local'))
const PROJECT_REF = (env.VITE_SUPABASE_URL ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? ''

// The disposable test account for signed-in checks. The process environment wins
// over .env.local, and an empty value counts as set. Never print these values.
const TEST_EMAIL = (process.env.VERIFY_TEST_EMAIL ?? env.VERIFY_TEST_EMAIL ?? '').trim()
const TEST_PASSWORD = process.env.VERIFY_TEST_PASSWORD ?? env.VERIFY_TEST_PASSWORD ?? ''

// Every message and saved record passes through here, so the test account never
// reaches a log, a report or a file.
function scrub(value) {
  if (typeof value === 'string') {
    return [TEST_EMAIL, TEST_PASSWORD].reduce((text, secret) => (secret ? text.split(secret).join('[test account]') : text), value)
  }
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]))
  return value
}

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter(line => line.includes('=') && !line.trimStart().startsWith('#'))
      .map(line => {
        const index = line.indexOf('=')
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
      }),
  )
}

function readPid(file) {
  return existsSync(file) ? Number(readFileSync(file, 'utf8').trim()) : null
}

function alive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

function killTree(pid) {
  if (!alive(pid)) return
  // taskkill /T walks the child tree, so npm/vite/browser helpers die with the
  // process we started. Never by image name.
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-pid, 'SIGKILL') // detached children lead their own process group
  } catch { /* already gone */ }
}

// Plain node:http, not fetch. Undici's fetch aborts Node on Windows at exit
// (libuv assertion, exit 127) when a request was refused or left open.
function httpGet(url, method = 'GET') {
  return new Promise(done => {
    const req = request(url, { method, agent: false, timeout: 3000 }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => done({ status: res.statusCode, body }))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => done({ status: 0, body: '' }))
    req.end()
  })
}

async function httpOk(url) {
  return (await httpGet(url)).status === 200
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for ${label}`)
}

// ---------- start ----------
async function start() {
  mkdirSync(RUN, { recursive: true })
  if (await httpOk(APP_ORIGIN)) {
    const pid = readPid(DEV_PID)
    if (alive(pid)) {
      console.log(`already running (pid ${pid}) at ${APP_ORIGIN}`)
      return
    }
    throw new Error(`port ${APP_PORT} answers but was not started by this harness; not touching it. Stop that server yourself or use another port.`)
  }
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  // Truncate the log once per start, then append the server's output to it.
  writeFileSync(DEV_LOG, '')
  const log = openSync(DEV_LOG, 'a')
  const child = spawn(process.execPath, [vite, '--port', String(APP_PORT), '--strictPort'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
  })
  child.unref()
  writeFileSync(DEV_PID, String(child.pid))
  await waitFor(() => httpOk(APP_ORIGIN), 90_000, `dev server on ${APP_ORIGIN}`)
  console.log(`dev server up at ${APP_ORIGIN} (pid ${child.pid}), log ${DEV_LOG}`)
}

// ---------- doctor ----------
// Each check is a PASS/FAIL line. The exit code is non-zero if any check fails.
// The browser line is informational: drive starts the browser on demand.
async function doctor() {
  const checks = []
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail })

  const pid = readPid(DEV_PID)
  add('dev server started by harness', alive(pid), pid ? `pid ${pid}` : 'no dev.pid; run start')

  const up = await httpOk(APP_ORIGIN)
  add(`app answers on ${APP_ORIGIN}`, up)

  if (up) {
    const served = (await httpGet(`${APP_ORIGIN}/src/lib/supabase.ts`)).body
    add('Supabase project ref compiled into served client', Boolean(PROJECT_REF) && served.includes(PROJECT_REF), PROJECT_REF ? `ref ${PROJECT_REF}` : 'no VITE_SUPABASE_URL in .env.local')
  }

  const browserPid = readPid(BROWSER_PID)
  const browserUp = alive(browserPid) || (await httpOk(`http://127.0.0.1:${CDP_PORT}/json/version`))
  console.log(`info  browser on CDP port: ${browserUp ? 'running' : 'not started (drive starts it)'}`)

  for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
  if (checks.some(check => !check.ok)) process.exitCode = 1
}

// ---------- browser / CDP ----------
function browserExecutable() {
  const found = BROWSERS.find(path => existsSync(path))
  if (!found) throw new Error('no Edge or Chrome found at the standard install paths; set VERIFY_BROWSER to the executable')
  return found
}

async function ensureBrowser(width) {
  if (await httpOk(`http://127.0.0.1:${CDP_PORT}/json/version`)) return
  mkdirSync(BROWSER_PROFILE, { recursive: true })
  const child = spawn(browserExecutable(), [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${BROWSER_PROFILE}`,
    `--window-size=${width},900`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  writeFileSync(BROWSER_PID, String(child.pid))
  await waitFor(() => httpOk(`http://127.0.0.1:${CDP_PORT}/json/version`), 30_000, 'browser CDP endpoint')
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.listeners = []
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve: done, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        message.error ? reject(new Error(message.error.message)) : done(message.result)
      } else if (message.method) {
        for (const listener of this.listeners) listener(message)
      }
    }
  }
  open() { return new Promise((done, fail) => { this.ws.onopen = done; this.ws.onerror = fail }) }
  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((done, reject) => this.pending.set(id, { resolve: done, reject }))
  }
  on(listener) { this.listeners.push(listener) }
  close() { this.ws.close() }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Like waitFor, but returns false on timeout instead of throwing.
async function pollUntil(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await sleep(500)
  }
  return false
}

// Opens a tab on the running app, runs the callback, then closes the tab.
async function withTab(width, run) {
  const target = JSON.parse((await httpGet(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`, 'PUT')).body)
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  try {
    await cdp.open()
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 720 })
    const evaluate = async expression => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })).result.value
    return await run(cdp, evaluate)
  } finally {
    cdp.close()
    await httpGet(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`)
  }
}

// Loads a URL in the tab and waits for the load event.
async function loadPage(cdp, url) {
  let loaded = false
  cdp.on(message => { if (message.method === 'Page.loadEventFired') loaded = true })
  await cdp.send('Page.navigate', { url })
  await waitFor(async () => loaded, 60_000, `load of ${url}`)
}

// Page-side reads. They return plain values, never the stored token.
const READ_STORED_SESSION = `(() => {
  try {
    const key = Object.keys(localStorage).find(name => name.startsWith('sb-') && name.endsWith('-auth-token'))
    const session = key ? JSON.parse(localStorage.getItem(key)) : null
    if (!session || !session.access_token) return null
    return { email: String(session.user?.email ?? '') }
  } catch { return null }
})()`
const READ_FORM_ALERT = `(() => {
  const alert = document.querySelector('.auth-submit-error')
  return alert ? alert.innerText.trim() : null
})()`
const TRIP_LINK_COUNT = `document.querySelectorAll('a[href^="/trip/"]').length`
const TRIP_LINKS = `(() => {
  const found = new Map()
  for (const link of document.querySelectorAll('a[href]')) {
    const route = link.getAttribute('href') || ''
    const title = (link.innerText || link.getAttribute('aria-label') || '').trim()
    // Workspace routes only: /trip/<id>, not /trip/<id>/share.
    if (route.startsWith('/trip/') && route.split('/').length === 3 && title && !found.has(route)) found.set(route, title)
  }
  return [...found].map(([route, title]) => ({ title, route }))
})()`

// Signs the test account in on the running app. It does nothing when the account
// is already signed in. It stops when another account holds the session, because
// this harness signs in only the test account.
async function signIn() {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    const missing = [TEST_EMAIL ? null : 'VERIFY_TEST_EMAIL', TEST_PASSWORD ? null : 'VERIFY_TEST_PASSWORD'].filter(Boolean).join(' and ')
    throw new Error(`signin needs ${missing}. Set both in .env.local (git-ignored) or the process environment. Values are never printed.`)
  }
  if (!(await httpOk(APP_ORIGIN))) throw new Error(`app is not running at ${APP_ORIGIN}; run start first`)
  await ensureBrowser(1280)
  return withTab(1280, async (cdp, evaluate) => {
    await loadPage(cdp, `${APP_ORIGIN}/auth`)
    const stored = await evaluate(READ_STORED_SESSION)
    if (stored && stored.email.trim().toLowerCase() !== TEST_EMAIL.toLowerCase()) {
      throw new Error('another account is signed in on the harness browser. Run stop, then signin again.')
    }
    // The app leaves /auth once it accepts a stored session. A rejected session stays on /auth.
    if (stored && await pollUntil(async () => (await evaluate('location.pathname')) !== '/auth', 20_000)) {
      return 'already signed in as the test account'
    }
    if (!(await pollUntil(() => evaluate(`Boolean(document.querySelector('input[name=email]'))`), 30_000))) {
      throw new Error('the sign-in form did not render on /auth within 30 s')
    }
    for (const [field, value] of [['email', TEST_EMAIL], ['password', TEST_PASSWORD]]) {
      const focused = await evaluate(`(() => {
        const el = document.querySelector('input[name=${field}]')
        if (!el) return false
        el.focus()
        return document.activeElement === el
      })()`)
      if (!focused) throw new Error(`could not focus the ${field} field on /auth`)
      // Input.insertText fires the input events that React listens for.
      await cdp.send('Input.insertText', { text: value })
    }
    const submitted = await evaluate(`(() => {
      const button = document.querySelector('form button[type=submit]')
      if (!button) return false
      button.click()
      return true
    })()`)
    if (!submitted) throw new Error('no submit button on /auth')
    let failure = null
    const signedIn = await pollUntil(async () => {
      const now = await evaluate(READ_STORED_SESSION)
      if (now && now.email.trim().toLowerCase() === TEST_EMAIL.toLowerCase()) return true
      failure = await evaluate(READ_FORM_ALERT)
      return Boolean(failure)
    }, 30_000)
    if (failure) throw new Error(`sign-in failed: ${scrub(failure)}`)
    if (!signedIn) throw new Error('sign-in stored no session within 30 s')
    return 'signed in as the test account'
  })
}

// Prints the signed-in account's trips: title, workspace route and Map tab route.
async function trips() {
  console.log(await signIn())
  const rows = await withTab(1280, async (cdp, evaluate) => {
    await loadPage(cdp, `${APP_ORIGIN}/trips`)
    // A cold dev server compiles the list page on its first load, which can take a minute.
    if (!(await pollUntil(async () => (await evaluate(TRIP_LINK_COUNT)) > 0, 90_000))) {
      throw new Error('no trip links on /trips within 90 s: the account has no trips, or the list did not load')
    }
    await sleep(2000) // the list can still fill in after its first link appears
    return evaluate(TRIP_LINKS)
  })
  console.log(JSON.stringify(scrub((rows ?? []).map(row => ({ ...row, map: `${row.route}/map` }))), null, 2))
}

// ---------- drive ----------
async function drive(route, name, options) {
  // settle: ms to wait after a click before reading the DOM.
  if (!(await httpOk(APP_ORIGIN))) throw new Error(`app is not running at ${APP_ORIGIN}; run start first`)
  mkdirSync(EVIDENCE, { recursive: true })
  await ensureBrowser(options.width)

  // Git Bash rewrites a bare "/" argument into a Windows path. Refuse that here
  // instead of sending the browser to a file:// nonsense URL.
  if (!route.startsWith('/') || route.includes(':')) throw new Error(`route "${route}" is not an app path (Git Bash path conversion? run with MSYS_NO_PATHCONV=1)`)
  if (options.signin) console.log(await signIn())
  const url = `${APP_ORIGIN}${route}`
  const target = JSON.parse((await httpGet(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`, 'PUT')).body)
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()

  const consoleErrors = []
  let loaded = false
  cdp.on(message => {
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '))
    if (message.method === 'Page.loadEventFired') loaded = true
  })

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: options.width, height: 900, deviceScaleFactor: 1, mobile: options.width < 720 })
  await cdp.send('Page.navigate', { url })
  await waitFor(async () => loaded, 60_000, `load of ${url}`)
  await sleep(4000) // let the app hydrate from Supabase before reading the DOM

  const evaluate = async expression => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })).result.value

  if (options.click) {
    const clicked = await evaluate(`(() => {
      const wanted = ${JSON.stringify(options.click)}
      const candidates = [...document.querySelectorAll('a, button, [role="button"]')]
      const hit = candidates.find(el => (el.innerText || el.getAttribute('aria-label') || '').trim() === wanted)
        ?? candidates.find(el => (el.innerText || el.getAttribute('aria-label') || '').includes(wanted))
      if (!hit) return false
      hit.click()
      return true
    })()`)
    if (!clicked) throw new Error(`no link or button with text "${options.click}" on ${route}`)
    await sleep(options.settle)
  }

  // Signed-in data can arrive after the fixed wait. Poll for the expected text up to 15 s.
  if (options.expect) await pollUntil(async () => (await evaluate('document.body.innerText')).includes(options.expect), 15_000)
  const text = await evaluate('document.body.innerText')
  const finalUrl = await evaluate('location.href')
  const title = await evaluate('document.title')
  const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data
  const shotPath = join(EVIDENCE, `${name}.png`)
  writeFileSync(shotPath, Buffer.from(shot, 'base64'))

  const expectation = options.expect
    ? { expect: options.expect, found: text.includes(options.expect) }
    : null
  const record = scrub({
    name,
    route,
    finalUrl,
    title,
    width: options.width,
    click: options.click ?? null,
    expectation,
    consoleErrors,
    bodyTextExcerpt: text.slice(0, 600),
    screenshot: shotPath,
    capturedAt: new Date().toISOString(),
  })
  writeFileSync(join(EVIDENCE, `${name}.json`), JSON.stringify(record, null, 2))
  cdp.close()
  await httpGet(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`)

  console.log(JSON.stringify(record, null, 2))
  if (expectation && !expectation.found) {
    console.error(`FAIL: expected text "${options.expect}" not found on ${route}`)
    process.exitCode = 1
  }
}

// ---------- stop ----------
// Edge helper processes can outlive taskkill /T and keep the profile locked.
// Kill only the processes whose command line names this run's own profile.
function killProfileStragglers() {
  if (process.platform !== 'win32') return
  const script = 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:VERIFY_PROFILE_DIR) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      env: { ...process.env, VERIFY_PROFILE_DIR: BROWSER_PROFILE },
    })
  } catch { /* nothing left to kill */ }
}

function stop() {
  killTree(readPid(BROWSER_PID))
  killTree(readPid(DEV_PID))
  killProfileStragglers()
  // Remove run state (pids, the browser profile, the dev log). Proof artifacts
  // directly under .verify-evidence/ are left in place. Windows keeps profile
  // files locked for a moment after taskkill, so retry instead of failing.
  removeRunState()
  console.log(`stopped. Proof artifacts kept in ${EVIDENCE}`)
}

function removeRunState() {
  const pause = new Int32Array(new SharedArrayBuffer(4))
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      rmSync(RUN, { recursive: true, force: true })
      return
    } catch (error) {
      if (!['EPERM', 'EBUSY'].includes(error.code) || attempt === 10) throw error
      Atomics.wait(pause, 0, 0, 500)
    }
  }
}

// ---------- entry ----------
const [command, ...args] = process.argv.slice(2)
const flags = {}
const positional = []
// Flags that take no value. Every other --flag takes the next argument.
const SWITCHES = new Set(['signin'])
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const name = args[i].slice(2)
    flags[name] = SWITCHES.has(name) ? true : args[++i]
  } else positional.push(args[i])
}

try {
  if (command === 'start') await start()
  else if (command === 'doctor') await doctor()
  else if (command === 'signin') console.log(await signIn())
  else if (command === 'trips') await trips()
  else if (command === 'drive') {
    if (positional.length < 2) throw new Error('usage: drive <route> <name> [--click <text>] [--expect <text>] [--width <px>] [--settle <ms>] [--signin]')
    await drive(positional[0], positional[1], { click: flags.click, expect: flags.expect, width: Number(flags.width ?? 1280), settle: Number(flags.settle ?? 3000), signin: flags.signin === true })
  } else if (command === 'stop') stop()
  else throw new Error('usage: verify.mjs <start|doctor|signin|trips|drive|stop>')
} catch (error) {
  console.error(`ERROR: ${error.message}`)
  process.exitCode = 1
}
// An open DevTools socket keeps Node alive after a failure, so exit explicitly.
process.exit(process.exitCode ?? 0)
