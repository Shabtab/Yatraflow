// APK update integration — adapter, runtime gating, feed cases and the notice
// rule. Node environment, no DOM and no renderer: the notice decision is a pure
// step (`nextNoticeOffer`), so it needs no React to test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { UpdateManifest } from '../src/lib/apkUpdates'

const seams = vi.hoisted(() => ({
  native: true,
  info: { id: 'app.yatraflow.mobile', build: '14', version: '0.14-native' },
  getInfoCalls: 0,
  fetches: [] as string[],
  reply: { ok: true, body: '{}' },
}))

vi.mock('../src/lib/native', () => ({
  get isNative() {
    return seams.native
  },
}))

vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: async () => {
      seams.getInfoCalls += 1
      return seams.info
    },
  },
}))

const FEED = 'https://releases.example.com/android/manifest.json'
const HOSTS = 'releases.example.com,dl.example.com'

const MANIFEST = {
  packageId: 'app.yatraflow.mobile',
  channel: 'production',
  versionCode: 15,
  versionName: '0.15-native',
  notes: 'Faster map, clearer budgets.',
  downloadUrl: 'https://dl.example.com/yatraflow-0.15.apk',
}

type Runtime = typeof import('../src/lib/apkUpdateRuntime')

/** Loads a fresh runtime. The module holds state, so every test resets it. */
async function fresh(options: { feed?: string; hosts?: string; info?: typeof seams.info } = {}): Promise<Runtime> {
  if (options.info) seams.info = options.info
  vi.resetModules()
  vi.stubEnv('VITE_APK_UPDATE_FEED_URL', options.feed ?? FEED)
  vi.stubEnv('VITE_APK_UPDATE_HOSTS', options.hosts ?? HOSTS)
  return await import('../src/lib/apkUpdateRuntime')
}

beforeEach(() => {
  seams.native = true
  seams.info = { id: 'app.yatraflow.mobile', build: '14', version: '0.14-native' }
  seams.getInfoCalls = 0
  seams.fetches = []
  seams.reply = { ok: true, body: JSON.stringify(MANIFEST) }
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('fetch', async (url: string) => {
    seams.fetches.push(String(url))
    return {
      ok: seams.reply.ok,
      status: seams.reply.ok ? 200 : 500,
      text: async () => seams.reply.body,
    }
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('the app id decides the channel', () => {
  it('maps only the two known Android ids', async () => {
    const { channelForAppId } = await import('../src/lib/apkUpdateConfig')
    expect(channelForAppId('app.yatraflow.mobile')).toBe('production')
    expect(channelForAppId('app.yatraflow.mobile.t3audit')).toBe('audit')
    // Anything else is not ours, so no channel is guessed for it.
    expect(channelForAppId('app.yatraflow.mobile.beta')).toBeNull()
    expect(channelForAppId('')).toBeNull()
  })

  it('parses the feed URL and the host list, and trims them', async () => {
    const { apkUpdateFeedUrl, apkUpdateHosts } = await import('../src/lib/apkUpdateConfig')
    expect(apkUpdateFeedUrl('  https://a.example.com/m.json  ')).toBe('https://a.example.com/m.json')
    expect(apkUpdateFeedUrl('')).toBe('')
    expect(apkUpdateHosts(' A.example.com , b.example.com ,, ')).toEqual(['a.example.com', 'b.example.com'])
    expect(apkUpdateHosts('')).toEqual([])
  })
})

describe('boot gating', () => {
  it('stays inert on the web', async () => {
    seams.native = false
    const runtime = await fresh()
    await runtime.bootApkUpdates()
    expect(runtime.apkUpdateStatus().unavailable).toBe('web')
    expect(runtime.apkUpdateEnabled()).toBe(false)
    await runtime.apkUpdateCheck()
    expect(seams.fetches).toEqual([])
  })

  it('refuses an app id it does not know', async () => {
    const runtime = await fresh({ info: { id: 'app.other.app', build: '3', version: '3.0' } })
    await runtime.bootApkUpdates()
    expect(runtime.apkUpdateStatus().unavailable).toBe('unsupported-app')
    await runtime.apkUpdateCheck()
    expect(seams.fetches).toEqual([])
  })

  it('refuses a build that is not an integer version code', async () => {
    const runtime = await fresh({ info: { id: 'app.yatraflow.mobile', build: '1.0', version: 'x' } })
    await runtime.bootApkUpdates()
    expect(runtime.apkUpdateStatus().unavailable).toBe('unsupported-app')
  })

  it('reads the audit channel from the audit id', async () => {
    const runtime = await fresh({ info: { id: 'app.yatraflow.mobile.t3audit', build: '14', version: '0.14-native' } })
    await runtime.bootApkUpdates()
    expect(runtime.apkUpdateStatus().installed?.channel).toBe('audit')
  })

  it('reports an unconfigured build without any request', async () => {
    const runtime = await fresh({ feed: '' })
    await runtime.bootApkUpdates()
    expect(runtime.apkUpdateStatus().unavailable).toBe('unconfigured')
    expect(runtime.apkUpdateStatus().installed?.versionCode).toBe(14)
    await runtime.apkUpdateCheck({ manual: true })
    expect(seams.fetches).toEqual([])
  })

  it('boots once when two mounts ask at the same time', async () => {
    const runtime = await fresh()
    await Promise.all([runtime.bootApkUpdates(), runtime.bootApkUpdates()])
    expect(seams.getInfoCalls).toBe(1)
  })
})

describe('feed outcomes', () => {
  it('offers a newer release and fetches the configured URL once', async () => {
    const runtime = await fresh()
    await runtime.bootApkUpdates()
    const state = await runtime.apkUpdateCheck()
    expect(state.phase).toBe('newer')
    expect(state.manifest?.versionCode).toBe(15)
    expect(seams.fetches).toEqual([FEED])
  })

  it('reports the installed build as current', async () => {
    const runtime = await fresh()
    seams.reply = { ok: true, body: JSON.stringify({ ...MANIFEST, versionCode: 14 }) }
    await runtime.bootApkUpdates()
    expect((await runtime.apkUpdateCheck()).phase).toBe('current')
  })

  it('does not request anything while offline', async () => {
    const runtime = await fresh()
    await runtime.bootApkUpdates()
    vi.stubGlobal('navigator', { onLine: false })
    expect((await runtime.apkUpdateCheck()).phase).toBe('offline')
    expect(seams.fetches).toEqual([])
  })

  it('reports a failed transfer as a failure that keeps the app usable', async () => {
    const runtime = await fresh()
    await runtime.bootApkUpdates()
    seams.reply = { ok: false, body: '' }
    expect((await runtime.apkUpdateCheck()).phase).toBe('failed')

    // The next check still works: a failure is never a dead end.
    seams.reply = { ok: true, body: JSON.stringify(MANIFEST) }
    expect((await runtime.apkUpdateCheck({ manual: true })).phase).toBe('newer')
  })

  it('rejects a body that is not a manifest', async () => {
    const runtime = await fresh()
    seams.reply = { ok: true, body: 'not json at all' }
    await runtime.bootApkUpdates()
    const state = await runtime.apkUpdateCheck()
    expect(state.phase).toBe('failed')
    expect(state.failure).toBe('malformed')
  })

  it('rejects a destination on an unapproved host', async () => {
    const runtime = await fresh()
    seams.reply = { ok: true, body: JSON.stringify({ ...MANIFEST, downloadUrl: 'https://evil.test/x.apk' }) }
    await runtime.bootApkUpdates()
    const state = await runtime.apkUpdateCheck()
    expect(state.failure).toBe('unsafe-destination')
  })

  it('checks once inside the day, and again on a manual request', async () => {
    const runtime = await fresh()
    await runtime.bootApkUpdates()
    await runtime.apkUpdateCheck()
    await runtime.apkUpdateCheck()
    expect(seams.fetches).toHaveLength(1)

    await runtime.apkUpdateCheck({ manual: true })
    expect(seams.fetches).toHaveLength(2)
  })

  it('holds a version back through Later', async () => {
    const runtime = await fresh()
    await runtime.bootApkUpdates()
    expect((await runtime.apkUpdateCheck()).phase).toBe('newer')
    expect(runtime.apkUpdateLater()).toBe(true)
    expect(runtime.apkUpdateStatus().state.phase).toBe('suppressed')

    // An automatic check inside the window stays quiet.
    expect((await runtime.apkUpdateCheck()).phase).toBe('suppressed')
  })

  it('still records Later when storage is missing or throws', async () => {
    const runtime = await fresh()
    await runtime.bootApkUpdates()
    await runtime.apkUpdateCheck()
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('quota')
      },
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(runtime.apkUpdateLater()).toBe(true)
    expect(runtime.apkUpdateStatus().state.phase).toBe('suppressed')
  })
})

describe('the notice rule', () => {
  const manifest: UpdateManifest = {
    packageId: 'app.yatraflow.mobile',
    channel: 'production',
    versionCode: 15,
    versionName: '0.15-native',
    notes: 'Faster map.',
    downloadUrl: 'https://dl.example.com/yatraflow-0.15.apk',
  }

  it('offers on newer', async () => {
    const { nextNoticeOffer } = await import('../src/lib/useApkUpdate')
    expect(nextNoticeOffer(null, { phase: 'newer', manifest })).toBe(manifest)
  })

  it('keeps what is offered while a re-check runs', async () => {
    const { nextNoticeOffer } = await import('../src/lib/useApkUpdate')
    expect(nextNoticeOffer(manifest, { phase: 'checking', manifest })).toBe(manifest)
    expect(nextNoticeOffer(manifest, { phase: 'checking' })).toBe(manifest)
  })

  it('clears on suppressed, even though that state carries a manifest', async () => {
    const { nextNoticeOffer } = await import('../src/lib/useApkUpdate')
    expect(nextNoticeOffer(manifest, { phase: 'suppressed', manifest })).toBeNull()
  })

  it.each(['current', 'offline', 'failed', 'idle'] as const)('clears on %s', async (phase) => {
    const { nextNoticeOffer } = await import('../src/lib/useApkUpdate')
    expect(nextNoticeOffer(manifest, { phase, manifest })).toBeNull()
    expect(nextNoticeOffer(manifest, { phase, failure: 'network' })).toBeNull()
  })
})
