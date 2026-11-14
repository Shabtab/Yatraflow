import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchSectionHash } from '../src/lib/sectionNavigation'

afterEach(() => vi.unstubAllGlobals())
beforeEach(() => vi.stubGlobal('document', { getElementById: () => null }))

describe.each([
  { page: 'Profile', ids: ['prof-details', 'prof-styles', 'prof-account'] },
  { page: 'Trip settings', ids: ['tset-identity', 'tset-travel', 'tset-danger'] },
])('$page section history', ({ ids }) => {
  it('selects a deep link and follows Back and Forward without a rail click', () => {
    const events = new EventTarget()
    const address = new URL(`https://fixture.invalid/settings#${ids[2]}`)
    vi.stubGlobal('window', events)
    vi.stubGlobal('location', address)
    const select = vi.fn()
    const stop = watchSectionHash(ids, select)
    expect(select).toHaveBeenLastCalledWith(ids[2])

    for (const id of [ids[0], ids[1], ids[0], ids[2]]) {
      address.hash = `#${id}`
      events.dispatchEvent(new Event('hashchange'))
      expect(select).toHaveBeenLastCalledWith(id)
    }
    stop()
    select.mockClear()
    events.dispatchEvent(new Event('hashchange'))
    expect(select).not.toHaveBeenCalled()
  })

  it('releases click selection for an empty, hidden or unrelated target', () => {
    const events = new EventTarget()
    const address = new URL('https://fixture.invalid/settings')
    vi.stubGlobal('window', events)
    vi.stubGlobal('location', address)
    const select = vi.fn()
    const stop = watchSectionHash(ids, select)
    expect(select).toHaveBeenLastCalledWith(null)
    for (const hash of ['#hidden-section', '#other-page', '']) {
      address.hash = hash
      events.dispatchEvent(new Event('hashchange'))
      expect(select).toHaveBeenLastCalledWith(null)
    }
    stop()
  })
})

describe('Late section mounts', () => {
  function setup() {
    let finish = () => {}
    const finished = new Promise<void>(resolve => { finish = resolve })
    const scrollIntoView = vi.fn()
    const events = Object.assign(new EventTarget(), { scrollY: 0 })
    vi.stubGlobal('window', events)
    vi.stubGlobal('location', new URL('https://fixture.invalid/settings#prof-styles'))
    vi.stubGlobal('document', { getElementById: () => ({ getAnimations: () => [{ finished }], scrollIntoView }) })
    const stop = watchSectionHash(['prof-styles'], vi.fn())
    return { events, finish, scrollIntoView, stop }
  }

  it('aligns an initial fragment after the entrance finishes', async () => {
    const state = setup()
    expect(state.scrollIntoView).not.toHaveBeenCalled()
    state.finish()
    await vi.waitFor(() => expect(state.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' }))
    state.stop()
  })

  it.each(['wheel', 'touchstart', 'keydown', 'pointerdown'])('does not pull the reader back after %s', async type => {
    const state = setup()
    state.events.dispatchEvent(new Event(type))
    state.finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(state.scrollIntoView).not.toHaveBeenCalled()
    state.stop()
  })

  it('cancels delayed alignment on cleanup', async () => {
    const state = setup()
    state.stop()
    state.finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(state.scrollIntoView).not.toHaveBeenCalled()
  })
})
