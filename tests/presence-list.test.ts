// The exit state machine behind usePresenceList (AGENTS §2.10).
//
// The hook keeps a removed list item mounted for one exit. The decisions it
// makes are pure: which items stay, where a leaving item sits, and when it is
// dropped. This file tests those, in node, with no DOM. The real-browser proof
// that the exit paints is in scripts/browser-motion-check.mjs.
import { describe, it, expect } from 'vitest'
import {
  dropExited,
  hasExiting,
  liveEntries,
  presenceAttrs,
  reconcilePresence,
  reflowDeltas,
  reflowToken,
  type PresenceEntry,
} from '../src/lib/usePresenceList'

type Card = { id: string; name?: string }
const keyOf = (card: Card) => card.id
const cards = (...ids: string[]): Card[] => ids.map(id => ({ id }))
const view = (entries: PresenceEntry<Card>[]) => entries.map(e => (e.exiting ? `~${e.key}` : e.key))

describe('reconcilePresence', () => {
  it('keeps every item live when nothing leaves', () => {
    const before = liveEntries(cards('a', 'b', 'c'), keyOf)
    expect(view(reconcilePresence(before, cards('a', 'b', 'c'), keyOf, true))).toEqual(['a', 'b', 'c'])
  })

  it('keeps a removed item as an exiting entry in its old slot', () => {
    const before = liveEntries(cards('a', 'b', 'c', 'd'), keyOf)
    expect(view(reconcilePresence(before, cards('a', 'c', 'd'), keyOf, true))).toEqual(['a', '~b', 'c', 'd'])
  })

  it('keeps the first item in the first slot when it leaves', () => {
    const before = liveEntries(cards('a', 'b'), keyOf)
    expect(view(reconcilePresence(before, cards('b'), keyOf, true))).toEqual(['~a', 'b'])
  })

  it('keeps the last item in the last slot when it leaves', () => {
    const before = liveEntries(cards('a', 'b'), keyOf)
    expect(view(reconcilePresence(before, cards('a'), keyOf, true))).toEqual(['a', '~b'])
  })

  it('keeps several leaving items, each after the item that stood before it', () => {
    const before = liveEntries(cards('a', 'b', 'c', 'd', 'e'), keyOf)
    expect(view(reconcilePresence(before, cards('a', 'd'), keyOf, true))).toEqual(['a', '~b', '~c', 'd', '~e'])
  })

  it('keeps every item when a filter empties the list', () => {
    const before = liveEntries(cards('a', 'b'), keyOf)
    const after = reconcilePresence(before, [], keyOf, true)
    expect(view(after)).toEqual(['~a', '~b'])
    expect(hasExiting(after)).toBe(true)
  })

  it('keeps an item that already exits while another item leaves', () => {
    const first = reconcilePresence(liveEntries(cards('a', 'b', 'c'), keyOf), cards('a', 'c'), keyOf, true)
    const second = reconcilePresence(first, cards('a'), keyOf, true)
    expect(view(second)).toEqual(['a', '~b', '~c'])
  })

  it('keeps the exiting item in its slot when a new item joins the list', () => {
    const first = reconcilePresence(liveEntries(cards('a', 'b'), keyOf), cards('a'), keyOf, true)
    const second = reconcilePresence(first, cards('a', 'z'), keyOf, true)
    expect(view(second)).toEqual(['a', '~b', 'z'])
  })

  it('makes an exiting item live again when its key returns', () => {
    const leaving = reconcilePresence(liveEntries(cards('a', 'b'), keyOf), cards('a'), keyOf, true)
    const back = reconcilePresence(leaving, cards('a', 'b'), keyOf, true)
    expect(view(back)).toEqual(['a', 'b'])
    expect(hasExiting(back)).toBe(false)
  })

  it('plays no exit with canExit false: the result is the live list', () => {
    // canExit is false under prefers-reduced-motion and in a hidden tab.
    const before = liveEntries(cards('a', 'b', 'c'), keyOf)
    const after = reconcilePresence(before, cards('a'), keyOf, false)
    expect(view(after)).toEqual(['a'])
    expect(hasExiting(after)).toBe(false)
  })

  it('also clears items that were already exiting when canExit turns false', () => {
    const leaving = reconcilePresence(liveEntries(cards('a', 'b'), keyOf), cards('a'), keyOf, true)
    expect(view(reconcilePresence(leaving, cards('a'), keyOf, false))).toEqual(['a'])
  })

  it('keeps the data an exiting item had when it left', () => {
    const before = liveEntries([{ id: 'a', name: 'Goa' }, { id: 'b', name: 'Hampi' }], keyOf)
    const after = reconcilePresence(before, [{ id: 'a', name: 'Goa' }], keyOf, true)
    expect(after.find(e => e.key === 'b')?.item.name).toBe('Hampi')
  })
})

describe('dropExited', () => {
  it('removes only exiting entries with the given keys', () => {
    const leaving = reconcilePresence(liveEntries(cards('a', 'b', 'c'), keyOf), cards('a'), keyOf, true)
    expect(view(dropExited(leaving, ['b']))).toEqual(['a', '~c'])
    expect(view(dropExited(leaving, ['b', 'c']))).toEqual(['a'])
  })

  it('never removes a live entry, even when its key is listed', () => {
    const live = liveEntries(cards('a', 'b'), keyOf)
    expect(view(dropExited(live, ['a']))).toEqual(['a', 'b'])
  })

  it('keeps an entry that came back live before its timer ended', () => {
    const leaving = reconcilePresence(liveEntries(cards('a', 'b'), keyOf), cards('a'), keyOf, true)
    const back = reconcilePresence(leaving, cards('a', 'b'), keyOf, true)
    expect(view(dropExited(back, ['b']))).toEqual(['a', 'b'])
  })
})

describe('presenceAttrs', () => {
  it('marks a live item and does not hide it', () => {
    expect(presenceAttrs({ exiting: false })).toEqual({ 'data-presence': 'live' })
  })

  it('marks a leaving item and hides it from a screen reader', () => {
    expect(presenceAttrs({ exiting: true })).toEqual({ 'data-presence': 'exit', 'aria-hidden': true })
  })
})

describe('reflowDeltas', () => {
  const a = {} as Element
  const b = {} as Element
  const gone = {} as Element

  it('reports how far an item that stayed has moved', () => {
    const before = new Map([[a, { x: 40, y: 700 }], [b, { x: 450, y: 700 }]])
    const after = new Map([[a, { x: 40, y: 300 }], [b, { x: 450, y: 300 }]])
    const deltas = reflowDeltas(before, after)
    expect(deltas.get(a)).toEqual({ x: 0, y: 400 })
    expect(deltas.get(b)).toEqual({ x: 0, y: 400 })
  })

  it('leaves out an item that did not move', () => {
    const before = new Map([[a, { x: 40, y: 300 }]])
    const after = new Map([[a, { x: 40.4, y: 300.3 }]])
    expect(reflowDeltas(before, after).size).toBe(0)
  })

  it('leaves out an item that is not in the list any more, and one that is new', () => {
    const before = new Map([[a, { x: 0, y: 0 }], [gone, { x: 10, y: 10 }]])
    const after = new Map([[a, { x: 0, y: 50 }], [b, { x: 20, y: 20 }]])
    const deltas = reflowDeltas(before, after)
    expect([...deltas.keys()]).toEqual([a])
    expect(deltas.get(a)).toEqual({ x: 0, y: -50 })
  })
})

describe('reflowToken', () => {
  it('takes the slow step for a short move and the slower step for hundreds of px', () => {
    expect(reflowToken(40)).toBe('--motion-slow')
    expect(reflowToken(200)).toBe('--motion-slow')
    expect(reflowToken(201)).toBe('--motion-slower')
    expect(reflowToken(668)).toBe('--motion-slower')
  })
})
