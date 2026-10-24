// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { stashHandoff, readHandoff, clearHandoff, billTotal, HANDOFF_KEY, type HandoffStore, type CreateHandoff } from '../src/lib/createHandoff'

function fakeStore(): HandoffStore & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: k => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v) },
    removeItem: k => { map.delete(k) },
  }
}

const h: CreateHandoff = {
  tripId: 't1', tripName: 'Kerala with the crew', plannerName: 'Asha',
  roadKm: 412, rangeKm: 720, days: 6, travellers: 4,
  crew: [{ name: 'Ammu', phone: '9845021234' }, { name: 'Rahul', phone: null }],
  bill: {
    days: 6, nights: 5, roadKm: 412,
    transportCost: 2730, transportFormula: '412 km / 16 km/L x 106',
    stayCost: 32000, stayFormula: '5 nights x 3200 x 2 rooms',
    mealCost: 14400, mealFormula: '6 days x 4 heads x 600',
    perHead: 12700, rangeKm: 720,
  },
}

describe('create handoff - the one hop to the moment-after screen', () => {
  it('round-trips for the trip it belongs to', () => {
    const store = fakeStore()
    expect(stashHandoff(h, { store })).toBe(true)
    const got = readHandoff('t1', { store })!
    expect(got.tripName).toBe('Kerala with the crew')
    expect(got.roadKm).toBe(412)
    expect(got.crew).toHaveLength(2)
    // the bill travels verbatim, formulas and all
    expect(got.bill?.perHead).toBe(12700)
    expect(got.bill?.stayFormula).toContain('3200')
    expect(billTotal(got.bill, got.travellers)).toBe(50800)
    expect(store.map.has(HANDOFF_KEY)).toBe(true)
  })

  it('refuses a handoff for a different trip - no stale crew leaks into a new trip', () => {
    const store = fakeStore()
    stashHandoff(h, { store })
    expect(readHandoff('t2', { store })).toBeNull()
  })

  it('degrades to null on junk, a denied store, or nothing stashed', () => {
    const store = fakeStore()
    expect(readHandoff('t1', { store })).toBeNull()
    store.map.set(HANDOFF_KEY, '{oops')
    expect(readHandoff('t1', { store })).toBeNull()
    store.map.set(HANDOFF_KEY, JSON.stringify({ tripId: 't1' }))
    const partial = readHandoff('t1', { store })!
    // a partial handoff is still usable, with honest defaults
    expect(partial.crew).toEqual([])
    expect(partial.bill).toBeNull()
    expect(partial.roadKm).toBeNull()
    expect(partial.travellers).toBe(1)
    expect(readHandoff('t1', { store: null })).toBeNull()
  })

  it('a missing bill is null, and billTotal refuses to invent a number', () => {
    expect(billTotal(null, 4)).toBeNull()
    expect(billTotal({ days: 1, nights: 0, roadKm: null, transportCost: null, transportFormula: '', stayCost: 0, stayFormula: '', mealCost: 0, mealFormula: '', perHead: null, rangeKm: null }, 4)).toBeNull()
  })

  it('carries a resumed entry’s masked label, and refuses one that is not a mask', () => {
    // A phone-only entry resumed from a draft has no number to hand on, so the
    // moment-after screen names it by the label instead. The label is a display
    // string: a full number in that slot is dropped, never passed through.
    const store = fakeStore()
    stashHandoff({ ...h, crew: [{ name: '', phone: null, label: '••• 234' }, { name: 'Ravi', phone: null }] }, { store })
    expect(readHandoff('t1', { store })!.crew).toEqual([
      { name: '', phone: null, label: '••• 234' },
      { name: 'Ravi', phone: null },
    ])
    store.map.set(HANDOFF_KEY, JSON.stringify({ tripId: 't1', crew: [{ name: '', phone: null, label: '9845021234' }] }))
    expect(readHandoff('t1', { store })!.crew).toEqual([{ name: '', phone: null }])
  })

  it('clear removes it, and clearing twice is harmless', () => {
    const store = fakeStore()
    stashHandoff(h, { store })
    expect(clearHandoff({ store })).toBe(true)
    expect(readHandoff('t1', { store })).toBeNull()
    expect(clearHandoff({ store })).toBe(true)
  })
})
