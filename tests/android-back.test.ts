// #562 — the Android back button's arm-then-exit state must not survive a
// history back. registerAndroidBack is shell-only wiring (isAndroid gates
// everything), so the harness mocks the Capacitor boundary: '@capacitor/app'
// captures the backButton handler and records exitApp, and src/lib/native is
// partially mocked so isAndroid reads true in a node env. history is stubbed
// because node has none.
//
// The mock models what Capacitor really does on Android, checked against the
// installed @capacitor/core 8.5.1 and @capacitor/app 8.1.1:
//   * App.addListener takes the native path, so removal crosses the bridge,
//   * a back event reaches EVERY still-registered callback.
// The dispatch shape comes from that source. Bridge timing was not measured.
// The old mock's remove did nothing and press() always used handlers[0], so a
// re-registration, and any dropped cleanup, stayed invisible.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  registered: [] as Array<{ cb: (e: { canGoBack: boolean }) => void; live: boolean }>,
  exitApp: vi.fn(),
  historyBack: vi.fn(),
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn((_event: string, cb: (e: { canGoBack: boolean }) => void) => {
      const rec = { cb, live: true }
      h.registered.push(rec)
      // Native removal crosses the bridge, so it settles a tick later.
      const remove = async () => { await Promise.resolve(); rec.live = false }
      return Promise.resolve({ remove })
    }),
    exitApp: h.exitApp,
  },
}))

vi.mock('../src/lib/native', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/native')>()),
  isAndroid: true,
}))

import { registerAndroidBack } from '../src/lib/appShell'

/** One back press, delivered to every live handler (Capacitor uses forEach). */
function press(canGoBack = false): number {
  const live = h.registered.filter(r => r.live)
  for (const r of live) r.cb({ canGoBack })
  return live.length
}
const liveCount = () => h.registered.filter(r => r.live).length
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  h.registered.length = 0
  h.exitApp.mockClear()
  h.historyBack.mockClear()
  vi.stubGlobal('history', { back: h.historyBack })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('registerAndroidBack arm-then-exit', () => {
  it('a history back disarms a pending exit arm (#562 repro)', () => {
    registerAndroidBack({ closeOverlay: () => false })
    press() // at the entry page: arms
    expect(h.exitApp).not.toHaveBeenCalled()
    press(true) // walks back into the app: navigates and must disarm
    expect(h.historyBack).toHaveBeenCalledTimes(1)
    press() // first deliberate back at the entry page: re-arms, never exits
    expect(h.exitApp).not.toHaveBeenCalled()
    press() // second press inside the 2s window: the real exit
    expect(h.exitApp).toHaveBeenCalledTimes(1)
  })

  it('two presses in a row at the entry page still exit', () => {
    registerAndroidBack({ closeOverlay: () => false })
    press()
    press()
    expect(h.exitApp).toHaveBeenCalledTimes(1)
    expect(h.historyBack).not.toHaveBeenCalled()
  })

  it('closing an overlay disarms too — the two branches stay symmetric', () => {
    let overlayOpen = false
    registerAndroidBack({ closeOverlay: () => overlayOpen })
    press() // arms at the entry page
    overlayOpen = true
    press() // overlay branch: closes, disarms, never navigates
    overlayOpen = false
    press() // re-arms; the overlay press must not have left a live arm
    expect(h.exitApp).not.toHaveBeenCalled()
    expect(h.historyBack).not.toHaveBeenCalled()
    press() // second press inside the window: exits
    expect(h.exitApp).toHaveBeenCalledTimes(1)
  })
})

describe('registerAndroidBack listener lifecycle', () => {
  it('cleanup unregisters the handler', async () => {
    const off = registerAndroidBack({ closeOverlay: () => false })
    off()
    await settle()
    expect(liveCount()).toBe(0)
    expect(press()).toBe(0)
    expect(h.exitApp).not.toHaveBeenCalled()
  })

  it('a re-registration settles to one live handler', async () => {
    let off = registerAndroidBack({ closeOverlay: () => false })
    off()
    off = registerAndroidBack({ closeOverlay: () => false })
    await settle()
    expect(liveCount()).toBe(1)
    expect(press()).toBe(1)
    expect(h.exitApp).not.toHaveBeenCalled()
  })

  it('an unsettled removal fans one press out to both handlers', () => {
    // Model-only characterisation. The mock's removal settles on a microtask,
    // while on Android it is a bridge round-trip. This test pins the fan-out
    // shape: while a removal is pending, one press reaches both handlers, so an
    // armed old closure exits and the new one only arms.
    // Reachability is UNMEASURED. The bridge duration was not measured, and the
    // window was not reproduced on device. Whether a press can land inside it is
    // unproven. Do not "fix" this with an arm that outlives its closure. A
    // behavioural change needs a reproduced failure first.
    const off = registerAndroidBack({ closeOverlay: () => false })
    press()
    expect(h.exitApp).not.toHaveBeenCalled()
    off()
    registerAndroidBack({ closeOverlay: () => false })
    expect(liveCount()).toBe(2)
    expect(press()).toBe(2)
    expect(h.exitApp).toHaveBeenCalledTimes(1)
  })

  it('the two-second arm expires instead of exiting', () => {
    vi.useFakeTimers()
    registerAndroidBack({ closeOverlay: () => false })
    press() // arms
    vi.advanceTimersByTime(2001)
    press() // the arm expired, so this only re-arms
    expect(h.exitApp).not.toHaveBeenCalled()
    press() // inside the fresh window: exits
    expect(h.exitApp).toHaveBeenCalledTimes(1)
  })

  it('a leaked arm timer cannot exit after cleanup', () => {
    vi.useFakeTimers()
    const off = registerAndroidBack({ closeOverlay: () => false })
    press()
    off()
    vi.advanceTimersByTime(5000)
    expect(h.exitApp).not.toHaveBeenCalled()
  })
})
