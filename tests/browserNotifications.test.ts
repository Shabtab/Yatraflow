// ============ Browser push notifications (local Notification API) ============
// Pure decision logic + failure-tolerant storage wrappers. The Notification API
// itself is only touched behind browserNotifSupported() guards, so every branch
// below runs in node.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  browserNotifEnabled, setBrowserNotifEnabled, browserNotifSupported,
  browserNotifPermission, shouldPromptBrowserNotif, shouldBrowserNotify,
  BROWSER_NOTIF_FLAG,
} from '../src/lib/browserNotifications'

function memStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    _store: store,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('opt-in flag', () => {
  it('defaults to off when no flag is stored', () => {
    expect(browserNotifEnabled(memStorage())).toBe(false)
  })

  it('round-trips on then off', () => {
    const s = memStorage()
    setBrowserNotifEnabled(true, s)
    expect(s._store.get(BROWSER_NOTIF_FLAG)).toBe('1')
    expect(browserNotifEnabled(s)).toBe(true)
    setBrowserNotifEnabled(false, s)
    expect(browserNotifEnabled(s)).toBe(false)
  })

  it('degrades to off when storage throws', () => {
    const bad = { getItem: () => { throw new Error('nope') }, setItem: () => { throw new Error('nope') } }
    expect(browserNotifEnabled(bad)).toBe(false)
    expect(() => setBrowserNotifEnabled(true, bad)).not.toThrow()
  })

  it('degrades to off with no storage (node default has no localStorage)', () => {
    expect(browserNotifEnabled(null)).toBe(false)
    expect(() => setBrowserNotifEnabled(true, null)).not.toThrow()
  })
})

describe('support + permission guards', () => {
  it('reports unsupported when the Notification API is missing', () => {
    vi.stubGlobal('Notification', undefined)
    expect(browserNotifSupported()).toBe(false)
    expect(browserNotifPermission()).toBe('unsupported')
    expect(shouldPromptBrowserNotif(memStorage())).toBe(false)
  })

  it('reports the live permission when the API exists', () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    expect(browserNotifSupported()).toBe(true)
    expect(browserNotifPermission()).toBe('granted')
  })
})

describe('shouldPromptBrowserNotif', () => {
  it('prompts only when undecided and never asked', () => {
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() })
    expect(shouldPromptBrowserNotif(memStorage())).toBe(true)
    // already opted in — don't nag
    expect(shouldPromptBrowserNotif(memStorage({ [BROWSER_NOTIF_FLAG]: '1' }))).toBe(false)
    // already opted out — respect it
    expect(shouldPromptBrowserNotif(memStorage({ [BROWSER_NOTIF_FLAG]: '0' }))).toBe(false)
  })

  it('never prompts once permission is decided', () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    expect(shouldPromptBrowserNotif(memStorage())).toBe(false)
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() })
    expect(shouldPromptBrowserNotif(memStorage())).toBe(false)
  })
})

describe('shouldBrowserNotify (dedupe vs read flag vs focus)', () => {
  const base = { id: 'n1', userId: 'u1', text: 'Anaya added a stop', read: false }

  it('fires for a fresh unread row for the session user in a background tab', () => {
    expect(shouldBrowserNotify(base, 'u1', new Set(), false)).toBe(true)
  })

  it('stays quiet when the tab is focused (bell badge already shows it)', () => {
    expect(shouldBrowserNotify(base, 'u1', new Set(), true)).toBe(false)
  })

  it('dedupes: never pings the same id twice', () => {
    expect(shouldBrowserNotify(base, 'u1', new Set(['n1']), false)).toBe(false)
  })

  it('respects the read flag: already-read rows stay in-app only', () => {
    expect(shouldBrowserNotify({ ...base, read: true }, 'u1', new Set(), false)).toBe(false)
  })

  it('ignores other users’ rows and logged-out sessions', () => {
    expect(shouldBrowserNotify(base, 'u2', new Set(), false)).toBe(false)
    expect(shouldBrowserNotify(base, null, new Set(), false)).toBe(false)
  })
})
