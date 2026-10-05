// #562 — the Android back button's arm-then-exit state must not survive a
// history back. registerAndroidBack is shell-only wiring (isAndroid gates
// everything), so the harness mocks the Capacitor boundary: '@capacitor/app'
// captures the backButton handler and records exitApp, and src/lib/native is
// partially mocked so isAndroid reads true in a node env. history is stubbed
// because node has none.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: [] as Array<(e: { canGoBack: boolean }) => void>,
  exitApp: vi.fn(),
  historyBack: vi.fn(),
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn((_event: string, cb: (e: { canGoBack: boolean }) => void) => {
      h.handlers.push(cb)
      return Promise.resolve({ remove: async () => {} })
    }),
    exitApp: h.exitApp,
  },
}))

vi.mock('../src/lib/native', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/native')>()),
  isAndroid: true,
}))

import { registerAndroidBack } from '../src/lib/appShell'

/** One back-button press through the handler the shell registered. */
function press(canGoBack = false) {
  h.handlers[0]({ canGoBack })
}

beforeEach(() => {
  h.handlers.length = 0
  h.exitApp.mockClear()
  h.historyBack.mockClear()
  vi.stubGlobal('history', { back: h.historyBack })
})

afterEach(() => {
  vi.unstubAllGlobals()
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
