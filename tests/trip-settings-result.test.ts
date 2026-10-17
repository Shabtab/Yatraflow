// ============ #704 — "Trip settings updated" only after the server has the row ============
// updateTrip answers at once from the cache, and a failed row write used to leave
// the Save button silent. tripWriteVerdict hands out the server's verdict on the
// row write that carries the newest edit. These tests drive the real write
// pipeline against a Supabase mock whose trips UPDATE answers with the outcome
// each test sets, and pin the settings form to that verdict.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { seedData } from '../src/data/seed'
import type { QueuedWrite, WriteQueueStore } from '../src/lib/writeQueue'

const { state } = vi.hoisted(() => ({
  state: {
    updates: [] as Array<{ payload: unknown; eq: Record<string, unknown> }>,
    refuse: null as null | { message: string },
  },
}))

vi.mock('../src/lib/supabase', async () => {
  const { tripWriteClient } = await import('./helpers/tripWriteClient')
  const makeBuilder = (table: string) => {
    let method: string | undefined
    let payload: unknown
    const eqs: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {}
    const chain = (m: string, p?: unknown) => { method = m; payload = p; return builder }
    builder.update = (p: unknown) => chain('update', p)
    builder.insert = (p: unknown) => chain('insert', p)
    builder.delete = () => chain('delete')
    builder.select = () => builder
    builder.eq = (col: string, val: unknown) => { eqs[col] = val; return builder }
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (method === 'update' && table === 'trips') {
        state.updates.push({ payload, eq: { ...eqs } })
        return Promise.resolve({ data: null, error: state.refuse }).then(res, rej)
      }
      return Promise.resolve({ data: null, error: null }).then(res, rej)
    }
    return builder
  }
  return { isSupabaseConfigured: false, supabase: tripWriteClient({ from: (t: string) => makeBuilder(t) }) }
})

// The queue normally lives in IndexedDB, which Node does not have. Swap only the
// backend for an in-memory store; the real queue logic still runs. That lets the
// test see whether a refused edit stayed queued for replay.
vi.mock('../src/lib/writeQueue', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/writeQueue')>()
  const map = new Map<string, QueuedWrite>()
  const mem: WriteQueueStore = {
    list: async () => [...map.values()],
    put: async entry => { map.set(actual.writeQueueKey(entry.ownerId, entry.tripId), entry) },
    remove: async tripId => { map.delete(tripId) },
    removeIf: async (key, capturedAt, revision) => {
      const current = map.get(key)
      if (!current || current.revision !== revision || (revision === undefined && current.capturedAt !== capturedAt)) return false
      map.delete(key)
      return true
    },
    putIf: async (entry, expectedCapturedAt, expectedRevision) => {
      const key = actual.writeQueueKey(entry.ownerId, entry.tripId)
      const current = map.get(key)
      if (!current || current.revision !== expectedRevision || (expectedRevision === undefined && current.capturedAt !== expectedCapturedAt)) return false
      map.set(key, entry)
      return true
    },
  }
  return {
    ...actual,
    queueWrite: (entry: QueuedWrite) => actual.queueWrite(entry, mem),
    dropWrite: (tripId: string) => actual.dropWrite(tripId, mem),
    dropQueuedWrite: (entry: QueuedWrite) => actual.dropQueuedWrite(entry, mem),
    dropWriteIfCurrent: (tripId: string, capturedAt: number) => actual.dropWriteIfCurrent(tripId, capturedAt, mem),
    requeueIfCurrent: (entry: QueuedWrite) => actual.requeueIfCurrent(entry, mem),
    pendingWrites: () => actual.pendingWrites(mem),
    pendingWriteCount: (ownerId?: string) => actual.pendingWriteCount(ownerId, mem),
    clearWritesFor: (ownerId: string) => actual.clearWritesFor(ownerId, mem),
  }
})

import {
  duplicateTrip, updateTrip, tripById, tripWriteVerdict, getSnapshot,
  _setTripWriteDebounceMs, _flushTripWrites, _cancelTripWrites,
} from '../src/store/store'
import { clearWritesFor, pendingWrites } from '../src/lib/writeQueue'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const tick = async () => { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)) }
const keralaTrip = seedData.trips[0]

beforeEach(async () => {
  getSnapshot().sessionUserId = 'owner-test'
  _setTripWriteDebounceMs(0)
  await clearWritesFor('owner-test')
  state.updates.length = 0
  state.refuse = null
})

afterEach(() => {
  _cancelTripWrites()
  _setTripWriteDebounceMs(0)
})

describe('#704 — the write verdict reports what the server said', () => {
  it('resolves true once the server has the row', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    expect(updateTrip(trip.id, { name: 'Kerala, saved' })).toBe(true)
    const verdict = tripWriteVerdict(trip.id)
    expect(verdict).not.toBeNull()
    await tick()
    expect(state.updates).toHaveLength(1)
    await expect(verdict).resolves.toBe(true)
    expect((await pendingWrites()).some(w => w.tripId === trip.id)).toBe(false)
  })

  it('resolves false when the server refuses, keeps the edit cached, and leaves it queued', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    state.refuse = { message: 'new row violates row-level security policy' }
    updateTrip(trip.id, { name: 'Kerala, refused' })
    const verdict = tripWriteVerdict(trip.id)
    await tick()
    await expect(verdict).resolves.toBe(false)
    // No rollback: the edit stays in the cache, and the durable queue replays it.
    expect(tripById(trip.id)?.name).toBe('Kerala, refused')
    expect((await pendingWrites()).some(w => w.tripId === trip.id)).toBe(true)
  })

  it('gives every edit in a coalesced burst the verdict of the one write that carries it', async () => {
    _setTripWriteDebounceMs(30)
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    updateTrip(trip.id, { name: 'Burst one' })
    const first = tripWriteVerdict(trip.id)
    updateTrip(trip.id, { name: 'Burst two' })
    const second = tripWriteVerdict(trip.id)
    expect(second).toBe(first)
    await new Promise(r => setTimeout(r, 80))
    await tick()
    expect(state.updates).toHaveLength(1)
    expect(JSON.stringify(state.updates[0].payload)).toContain('Burst two')
    await expect(first).resolves.toBe(true)
  })

  it('stays pending through the debounce and settles when the write is flushed', async () => {
    _setTripWriteDebounceMs(10_000)
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    updateTrip(trip.id, { name: 'Flushed' })
    const verdict = tripWriteVerdict(trip.id)
    let settled = false
    void verdict?.then(() => { settled = true })
    await tick()
    expect(settled).toBe(false)
    _flushTripWrites()
    await tick()
    expect(settled).toBe(true)
    await expect(verdict).resolves.toBe(true)
  })

  it('a cancelled write never reached the server, so its verdict is false', async () => {
    _setTripWriteDebounceMs(10_000)
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    updateTrip(trip.id, { name: 'Cancelled' })
    const verdict = tripWriteVerdict(trip.id)
    _cancelTripWrites()
    await expect(verdict).resolves.toBe(false)
    expect(state.updates).toHaveLength(0)
  })

  it('reads null once the newest write has settled, and for a trip with no edit', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    updateTrip(trip.id, { name: 'Settles' })
    await tick()
    expect(tripWriteVerdict(trip.id)).toBeNull()
    expect(tripWriteVerdict('no-such-trip')).toBeNull()
  })
})

describe('#704 — the settings form says "updated" only on a true verdict', () => {
  const src = read('../src/pages/trip/TripSettingsForm.tsx')

  it('reads the verdict right after the cache write, and announces success only when it is true', () => {
    expect(src).toMatch(/if \(updateTrip\(trip\.id, dry\.patch\)\) \{/)
    expect(src).toMatch(/const verdict = tripWriteVerdict\(trip\.id\)/)
    expect(src).toMatch(/void verdict\.then\(saved => \{/)
    expect(src).toMatch(/if \(saved\) toast\('Trip settings updated'\)/)
    expect(src.indexOf("toast('Trip settings updated')")).toBeGreaterThan(src.indexOf('tripWriteVerdict(trip.id)'))
  })

  it('shows a refused save beside the Save button', () => {
    expect(src).toMatch(/const \[writeErr, setWriteErr\] = useState<string \| null>\(null\)/)
    expect(src).toMatch(/else setWriteErr\(TRIP_SETTINGS_NOT_SAVED\)/)
    expect(src).toMatch(/\{writeErr && <span className="err-text" role="alert">\{writeErr\}<\/span>\}/)
  })

  it('disables Save and reads Saving… until the verdict settles', () => {
    expect(src).toMatch(/const \[savingSettings, setSavingSettings\] = useState\(false\)/)
    expect(src).toMatch(/setSavingSettings\(true\)/)
    expect(src).toMatch(/setSavingSettings\(false\)/)
    expect(src).toMatch(/disabled=\{!canSave \|\| savingSettings\}/)
    expect(src).toContain("{savingSettings ? 'Saving…' : 'Save settings'}")
  })

  it('every draft setter clears a refused save before it writes, so the next edit clears the refusal', () => {
    expect(src).toMatch(/const setF = \(next: Parameters<typeof setFState>\[0\]\) => \{ setWriteErr\(null\); setFState\(next\) \}/)
    expect(src).toMatch(/const setStartPin = \(next: Parameters<typeof setStartPinState>\[0\]\) => \{ setWriteErr\(null\); setStartPinState\(next\) \}/)
    expect(src).toMatch(/const setDests = \(next: Parameters<typeof setDestsState>\[0\]\) => \{ setWriteErr\(null\); setDestsState\(next\) \}/)
  })

  it('a refused save says the settings stay here and the app will retry', () => {
    expect(src).toContain("const TRIP_SETTINGS_NOT_SAVED = 'Settings not saved. They stay here, and the app will retry.'")
  })
})
