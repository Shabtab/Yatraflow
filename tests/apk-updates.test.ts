// APK update decision core — behavior tests.
//
// These run in the node environment (no DOM, no network). Every external
// boundary — clock, storage, transport, and the installed native identity — is
// injected, so each test states its own time, feed and device.
//
// The hosts below are FIXTURES. The core ships no host of its own; the approved
// allowlist is caller-supplied, and `example.com` is reserved for examples.
import { describe, it, expect } from 'vitest'
import {
  UPDATE_DAY_MS,
  createUpdateChecker,
  installedFromAppInfo,
  isApprovedHttpsUrl,
  localStorageStore,
  type FetchOutcome,
  type InstalledApp,
  type UpdateManifest,
  type UpdateState,
  type UpdateStore,
} from '../src/lib/apkUpdates'

const MANIFEST_URL = 'https://releases.example.com/android/manifest.json'
const APPROVED = ['releases.example.com', 'dl.example.com']

const INSTALLED: InstalledApp = {
  packageId: 'app.yatraflow.mobile',
  channel: 'production',
  versionCode: 14,
  versionName: '0.14-native',
}

/** A well-formed manifest for `versionCode`, targeting the installed app. */
function manifest(over: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    packageId: INSTALLED.packageId,
    channel: INSTALLED.channel,
    versionCode: 15,
    versionName: '0.15-native',
    notes: 'Faster map, clearer budgets.',
    downloadUrl: 'https://dl.example.com/yatraflow-0.15.apk',
    ...over,
  }
}

function memoryStore(initial: string | null = null): UpdateStore {
  let value = initial
  return { read: () => value, write: (next) => { value = next } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

interface Harness {
  checker: ReturnType<typeof createUpdateChecker>
  fetches: string[]
  /** Every state a subscriber was told about, in order. */
  seen: UpdateState[]
  /** Only the states that carry a release to offer. */
  notices: UpdateState[]
  advance: (ms: number) => void
  clock: () => number
}

function harness(options: {
  /** One entry per expected fetch: a body, a transport failure, or a deferred. */
  feed?: Array<unknown | FetchOutcome | Promise<FetchOutcome>>
  store?: UpdateStore
  installed?: InstalledApp
  approvedHosts?: readonly string[]
  manifestUrl?: string
  extra?: Record<string, unknown>
} = {}): Harness {
  let clock = 1_700_000_000_000
  const feed = [...(options.feed ?? [{ ok: true as const, body: manifest() }])]
  const fetches: string[] = []
  const seen: UpdateState[] = []
  const notices: UpdateState[] = []

  const checker = createUpdateChecker({
    installed: options.installed ?? INSTALLED,
    manifestUrl: options.manifestUrl ?? MANIFEST_URL,
    approvedHosts: options.approvedHosts ?? APPROVED,
    now: () => clock,
    store: options.store ?? memoryStore(),
    fetchManifest: (url) => {
      fetches.push(url)
      const next = feed.shift()
      if (next instanceof Error) return Promise.reject(next)
      return Promise.resolve(next as FetchOutcome | Promise<FetchOutcome>)
    },
    ...options.extra,
  })

  checker.subscribe((state) => {
    seen.push(state)
    if (state.phase === 'newer') notices.push(state)
  })

  return {
    checker,
    fetches,
    seen,
    notices,
    advance: (ms) => { clock += ms },
    clock: () => clock,
  }
}

const body = (over: Partial<UpdateManifest> = {}) => ({ ok: true as const, body: manifest(over) })

describe('safe primitives', () => {
  it('accepts an approved HTTPS destination', () => {
    expect(isApprovedHttpsUrl('https://dl.example.com/yatraflow.apk', APPROVED)).toBe(true)
  })

  it('rejects plain HTTP', () => {
    expect(isApprovedHttpsUrl('http://dl.example.com/yatraflow.apk', APPROVED)).toBe(false)
  })

  it('rejects an unapproved host', () => {
    expect(isApprovedHttpsUrl('https://evil.test/yatraflow.apk', APPROVED)).toBe(false)
  })

  it('rejects a host that merely ends with an approved name', () => {
    expect(isApprovedHttpsUrl('https://dl.example.com.evil.test/a.apk', APPROVED)).toBe(false)
  })

  it('rejects embedded credentials', () => {
    expect(isApprovedHttpsUrl('https://user:pass@dl.example.com/a.apk', APPROVED)).toBe(false)
  })

  it('rejects a non-default port', () => {
    expect(isApprovedHttpsUrl('https://dl.example.com:8443/a.apk', APPROVED)).toBe(false)
    expect(isApprovedHttpsUrl('https://dl.example.com:443/a.apk', APPROVED)).toBe(true)
  })

  it('rejects everything when the allowlist is empty', () => {
    expect(isApprovedHttpsUrl('https://dl.example.com/a.apk', [])).toBe(false)
  })

  it('matches the host case-insensitively', () => {
    expect(isApprovedHttpsUrl('https://DL.Example.COM/a.apk', APPROVED)).toBe(true)
  })
})

describe('installed identity comes from the native boundary', () => {
  it('parses the Android string version code', () => {
    const installed = installedFromAppInfo({ id: 'app.yatraflow.mobile', build: '14', version: '0.14-native' }, 'production')
    expect(installed).toEqual({
      packageId: 'app.yatraflow.mobile',
      channel: 'production',
      versionCode: 14,
      versionName: '0.14-native',
    })
  })

  it('keeps the audit channel separate from production', () => {
    const installed = installedFromAppInfo({ id: 'app.yatraflow.mobile.t3audit', build: '3', version: '0.15-native' }, 'audit')
    expect(installed.channel).toBe('audit')
    expect(installed.packageId).toBe('app.yatraflow.mobile.t3audit')
  })

  it('refuses a build that is not an integer code', () => {
    expect(() => installedFromAppInfo({ id: 'app.yatraflow.mobile', build: '1.0', version: 'x' }, 'production')).toThrow()
    expect(() => installedFromAppInfo({ id: 'app.yatraflow.mobile', build: '', version: 'x' }, 'production')).toThrow()
    expect(() => installedFromAppInfo({ id: '', build: '14', version: 'x' }, 'production')).toThrow()
  })
})

describe('version comparison uses native integer codes', () => {
  it('reports current when the codes match', async () => {
    const h = harness({ feed: [body({ versionCode: 14 })] })
    expect((await h.checker.check()).phase).toBe('current')
  })

  it('reports current when the released code is older', async () => {
    const h = harness({ feed: [body({ versionCode: 12 })] })
    expect((await h.checker.check()).phase).toBe('current')
  })

  it('reports newer when the released code is higher', async () => {
    const h = harness({ feed: [body({ versionCode: 18 })] })
    const state = await h.checker.check()
    expect(state.phase).toBe('newer')
    expect(state.manifest?.versionCode).toBe(18)
  })

  it('compares as integers, not as strings', async () => {
    // "9" > "14" as text, but 9 is the older build.
    const h = harness({ feed: [body({ versionCode: 9 })] })
    expect((await h.checker.check()).phase).toBe('current')
  })

  it('never compares the display version', async () => {
    // A lower code with a lexically higher name is still not an update.
    const h = harness({ feed: [body({ versionCode: 13, versionName: 'z9.9-native' })] })
    expect((await h.checker.check()).phase).toBe('current')
  })
})

describe('an untrusted manifest is validated before use', () => {
  it('rejects a body that is not an object', async () => {
    const h = harness({ feed: [{ ok: true, body: 'not json' }] })
    const state = await h.checker.check()
    expect(state.phase).toBe('failed')
    expect(state.failure).toBe('malformed')
    expect(state.manifest).toBeUndefined()
  })

  it.each([
    ['a missing version code', { versionCode: undefined }],
    ['a fractional version code', { versionCode: 15.5 }],
    ['a string version code', { versionCode: '15' }],
    ['a negative version code', { versionCode: -1 }],
    ['a missing display version', { versionName: undefined }],
    ['notes that are not text', { notes: 42 }],
    ['a missing package id', { packageId: undefined }],
    ['an unknown channel', { channel: 'beta' }],
    ['a missing destination', { downloadUrl: undefined }],
  ])('rejects %s', async (_label, over) => {
    const h = harness({ feed: [{ ok: true, body: { ...manifest(), ...over } }] })
    const state = await h.checker.check()
    expect(state.phase).toBe('failed')
    expect(state.failure).toBe('malformed')
  })

  it.each([
    ['plain HTTP', 'http://dl.example.com/a.apk'],
    ['an unapproved host', 'https://evil.test/a.apk'],
    ['embedded credentials', 'https://u:p@dl.example.com/a.apk'],
    ['a non-default port', 'https://dl.example.com:8443/a.apk'],
  ])('rejects %s as an unsafe destination', async (_label, downloadUrl) => {
    const h = harness({ feed: [{ ok: true, body: manifest({ downloadUrl }) }] })
    const state = await h.checker.check()
    expect(state.phase).toBe('failed')
    expect(state.failure).toBe('unsafe-destination')
  })

  it('rejects a manifest for another package', async () => {
    const h = harness({ feed: [{ ok: true, body: manifest({ packageId: 'app.yatraflow.mobile.other' }) }] })
    const state = await h.checker.check()
    expect(state.failure).toBe('wrong-package')
  })

  it('rejects a manifest for another channel', async () => {
    // The audit build must never be upgraded by the production feed.
    const h = harness({
      feed: [{ ok: true, body: manifest({ channel: 'audit' }) }],
      installed: INSTALLED,
    })
    const state = await h.checker.check()
    expect(state.failure).toBe('wrong-channel')
  })

  it('offers the destination only after it is approved', async () => {
    const h = harness({ feed: [body()] })
    const state = await h.checker.check()
    expect(state.manifest?.downloadUrl).toBe('https://dl.example.com/yatraflow-0.15.apk')
  })
})

describe('transport failures stay nonblocking', () => {
  it('reports offline without inventing a release', async () => {
    const h = harness({ feed: [{ ok: false, reason: 'offline' }] })
    const state = await h.checker.check()
    expect(state.phase).toBe('offline')
    expect(state.manifest).toBeUndefined()
  })

  it('reports a failed transfer as a failure', async () => {
    const h = harness({ feed: [{ ok: false, reason: 'network' }] })
    expect((await h.checker.check()).phase).toBe('failed')
  })

  it('reports a transport that throws as a failure', async () => {
    const h = harness({ feed: [new Error('socket closed')] })
    const state = await h.checker.check()
    expect(state.phase).toBe('failed')
    expect(state.failure).toBe('network')
  })

  it('recovers on the next check', async () => {
    const h = harness({ feed: [{ ok: false, reason: 'offline' }, body()] })
    expect((await h.checker.check()).phase).toBe('offline')
    h.advance(UPDATE_DAY_MS)
    expect((await h.checker.check()).phase).toBe('newer')
  })
})

describe('automatic checks are rate-limited', () => {
  it('checks once, then waits out the interval', async () => {
    const h = harness({ feed: [body({ versionCode: 14 }), body()] })
    await h.checker.check()
    await h.checker.check()
    expect(h.fetches).toHaveLength(1)
  })

  it('checks again after the interval has passed', async () => {
    const h = harness({ feed: [body({ versionCode: 14 }), body()] })
    await h.checker.check()
    h.advance(UPDATE_DAY_MS)
    await h.checker.check()
    expect(h.fetches).toHaveLength(2)
  })

  it('honours a caller-supplied interval', async () => {
    const h = harness({ feed: [body({ versionCode: 14 }), body()], extra: { intervalMs: 60_000 } })
    await h.checker.check()
    h.advance(60_000)
    await h.checker.check()
    expect(h.fetches).toHaveLength(2)
  })

  it('lets a manual check bypass the interval', async () => {
    const h = harness({ feed: [body({ versionCode: 14 }), body()] })
    await h.checker.check()
    await h.checker.check({ manual: true })
    expect(h.fetches).toHaveLength(2)
  })

  it('starts on the first call with no previous result', async () => {
    const h = harness()
    expect(h.checker.state().phase).toBe('idle')
    await h.checker.check()
    expect(h.fetches).toHaveLength(1)
  })
})

describe('Later suppresses one version for a day', () => {
  it('records the version and stops reminding inside the window', async () => {
    const h = harness({ feed: [body(), body()] })
    await h.checker.check()
    expect(h.checker.state().phase).toBe('newer')

    expect(h.checker.later()).toBe(true)
    expect(h.checker.state().phase).toBe('suppressed')

    h.advance(UPDATE_DAY_MS - 1)
    const state = await h.checker.check()
    expect(state.phase).toBe('suppressed')
    expect(state.manifest?.versionCode).toBe(15)
  })

  it('reminds again once the window has passed', async () => {
    const h = harness({ feed: [body(), body()] })
    await h.checker.check()
    h.checker.later()
    h.advance(UPDATE_DAY_MS)
    expect((await h.checker.check()).phase).toBe('newer')
  })

  it('has nothing to suppress when the installed build is current', async () => {
    const h = harness({ feed: [body({ versionCode: 14 })] })
    await h.checker.check()
    expect(h.checker.state().phase).toBe('current')
    expect(h.checker.later()).toBe(false)
    expect(h.checker.state().phase).toBe('current')
  })

  it('suppresses only the recorded version', async () => {
    // The automatic interval is shorter than the holding window, so the next
    // automatic check is allowed to run while version 15 is still held back.
    const h = harness({
      feed: [body(), body({ versionCode: 16, versionName: '0.16-native' })],
      extra: { intervalMs: 60_000 },
    })
    await h.checker.check()
    h.checker.later()
    h.advance(60_000)

    const state = await h.checker.check()
    expect(state.phase).toBe('newer')
    expect(state.manifest?.versionCode).toBe(16)
  })

  it('does not suppress an explicit manual check', async () => {
    // The user asked. Later silences automatic reminders, not the answer.
    const h = harness({ feed: [body(), body()] })
    await h.checker.check()
    h.checker.later()
    const state = await h.checker.check({ manual: true })
    expect(state.phase).toBe('newer')
  })

  it('survives a corrupted stored record', async () => {
    const h = harness({ feed: [body({ versionCode: 14 }), body()], store: memoryStore('{not json') })
    expect((await h.checker.check()).phase).toBe('current')
    h.advance(UPDATE_DAY_MS)
    expect((await h.checker.check()).phase).toBe('newer')
  })

  it('writes suppression through the injected store', async () => {
    const store = memoryStore()
    const h = harness({ feed: [body()], store })
    await h.checker.check()
    h.checker.later()
    const raw = store.read()
    expect(raw).toBeTruthy()
    const record = JSON.parse(raw as string)
    expect(record.versionCode).toBe(15)
    expect(record.until).toBe(h.clock() + UPDATE_DAY_MS)
  })
})

describe('concurrent and out-of-order checks', () => {
  it('does not fetch twice for two concurrent automatic checks', async () => {
    const first = deferred<FetchOutcome>()
    const h = harness({ feed: [first.promise] })
    const a = h.checker.check()
    const b = h.checker.check()
    first.resolve({ ok: true, body: manifest() })

    expect((await a).phase).toBe('newer')
    expect((await b).phase).toBe('newer')
    expect(h.fetches).toHaveLength(1)
  })

  it('does not announce the same release twice', async () => {
    const first = deferred<FetchOutcome>()
    const h = harness({ feed: [first.promise] })
    const a = h.checker.check()
    const b = h.checker.check()
    first.resolve({ ok: true, body: manifest() })
    await Promise.all([a, b])
    expect(h.notices).toHaveLength(1)
  })

  it('changes nothing when the interval gates the repeat', async () => {
    const h = harness({ feed: [body()] })
    await h.checker.check()
    const before = h.seen.length
    await h.checker.check()
    expect(h.seen).toHaveLength(before)
    expect(h.fetches).toHaveLength(1)
  })

  it('never invents a second release for a repeated manual check', async () => {
    // An explicit check may re-offer the release it finds, but it must always be
    // the same release — never a freshly invented one.
    const h = harness({ feed: [body(), body(), body()] })
    await h.checker.check()
    await h.checker.check({ manual: true })
    const state = await h.checker.check({ manual: true })
    expect(state.phase).toBe('newer')
    expect(state.manifest?.versionCode).toBe(15)
    expect(h.notices.map((n) => n.manifest?.versionCode)).toEqual([15, 15, 15])
  })

  it('drops a stale result that lands after a newer one', async () => {
    // The automatic request is slow; the user's manual check answers first.
    const slow = deferred<FetchOutcome>()
    const fast = deferred<FetchOutcome>()
    let call = 0
    const h = harness({
      extra: {
        fetchManifest: () => {
          call += 1
          return call === 1 ? slow.promise : fast.promise
        },
      },
    })

    const automatic = h.checker.check()
    const manual = h.checker.check({ manual: true })

    fast.resolve({ ok: true, body: manifest({ versionCode: 16, versionName: '0.16-native' }) })
    expect((await manual).phase).toBe('newer')
    expect(h.checker.state().manifest?.versionCode).toBe(16)

    // The slow answer is older news. It must not replace what the user already saw.
    slow.resolve({ ok: true, body: manifest() })
    await automatic
    expect(h.checker.state().manifest?.versionCode).toBe(16)
    expect(h.notices.map((n) => n.manifest?.versionCode)).toEqual([16])
  })

  it('applies a suppression recorded while the check was in flight', async () => {
    const second = deferred<FetchOutcome>()
    const h = harness({ feed: [body({ versionCode: 15 }), second.promise] })

    await h.checker.check()
    expect(h.checker.state().phase).toBe('newer')
    h.advance(UPDATE_DAY_MS)

    // The re-check keeps the release on screen, so Later still refers to it.
    const inFlight = h.checker.check()
    expect(h.checker.state().phase).toBe('checking')
    expect(h.checker.state().manifest?.versionCode).toBe(15)
    expect(h.checker.later()).toBe(true)

    second.resolve({ ok: true, body: manifest() })
    const state = await inFlight
    expect(state.phase).toBe('suppressed')
  })
})

describe('the core never reaches the network or the UI on its own', () => {
  it('performs no fetch until a check is asked for', async () => {
    const h = harness()
    expect(h.fetches).toHaveLength(0)
    h.checker.subscribe(() => {})
    expect(h.fetches).toHaveLength(0)
    expect(h.checker.state().phase).toBe('idle')
    await h.checker.check()
    expect(h.fetches).toHaveLength(1)
  })

  it('reports the checking phase while a check is in flight', async () => {
    const pending = deferred<FetchOutcome>()
    const h = harness({ feed: [pending.promise] })
    const run = h.checker.check()
    expect(h.checker.state().phase).toBe('checking')
    pending.resolve({ ok: true, body: manifest() })
    await run
    expect(h.checker.state().phase).toBe('newer')
  })

  it('stops notifying after unsubscribe', async () => {
    const h = harness({ feed: [body({ versionCode: 14 }), body()] })
    const seen: UpdateState[] = []
    const stop = h.checker.subscribe((s) => seen.push(s))
    stop()
    await h.checker.check()
    expect(seen).toHaveLength(0)
  })

  it('refuses a non-integer installed version code', () => {
    expect(() => createUpdateChecker({
      installed: { ...INSTALLED, versionCode: Number.NaN },
      manifestUrl: MANIFEST_URL,
      approvedHosts: APPROVED,
      now: () => 0,
      fetchManifest: async () => ({ ok: false, reason: 'offline' }),
    })).toThrow()
  })

  it('refuses a manifest URL outside the approved hosts', () => {
    expect(() => createUpdateChecker({
      installed: INSTALLED,
      manifestUrl: 'https://elsewhere.test/manifest.json',
      approvedHosts: APPROVED,
      now: () => 0,
      fetchManifest: async () => ({ ok: false, reason: 'offline' }),
    })).toThrow()
  })

  it('refuses a wildcard allowlist entry', () => {
    expect(() => createUpdateChecker({
      installed: INSTALLED,
      manifestUrl: MANIFEST_URL,
      approvedHosts: ['*.example.com'],
      now: () => 0,
      fetchManifest: async () => ({ ok: false, reason: 'offline' }),
    })).toThrow()
  })
})

describe('localStorageStore degrades without storage', () => {
  it('reads null and writes nothing when there is no localStorage', () => {
    const store = localStorageStore('yatraflow_apk_update_later')
    expect(store.read()).toBeNull()
    expect(() => store.write('{"versionCode":15,"until":1}')).not.toThrow()
  })
})
