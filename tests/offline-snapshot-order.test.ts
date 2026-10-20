import { describe, expect, it } from 'vitest'
import { clearSnapshot, loadSnapshot, saveSnapshot, type SnapshotStore } from '../src/lib/offlineCache'

const slices = (id: string) => ({
  trips: [{ id }], trashedTrips: [], users: [], published: [], suggestions: [], decisions: [], activity: [],
})

function deferred() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

describe('snapshot account write order', () => {
  it('clears a started save before a later session saves fresh data', async () => {
    const values = new Map<string, unknown>()
    const gate = deferred()
    let writes = 0
    const store: SnapshotStore = {
      read: async key => values.get(key),
      write: async (key, value) => {
        writes += 1
        if (writes === 1) await gate.promise
        values.set(key, value)
      },
      remove: async key => { values.delete(key) },
    }
    const oldSave = saveSnapshot('A', slices('old'), store)
    await Promise.resolve()
    const clear = clearSnapshot('A', store)
    const freshSave = saveSnapshot('A', slices('fresh'), store)
    gate.release()
    await Promise.all([oldSave, clear, freshSave])
    expect((await loadSnapshot('A', store))?.trips).toEqual([{ id: 'fresh' }])
  })

  it('skips an old save that has not started when clear invalidates it', async () => {
    const values = new Map<string, unknown>()
    const written: unknown[] = []
    const store: SnapshotStore = {
      read: async key => values.get(key),
      write: async (key, value) => { written.push(value); values.set(key, value) },
      remove: async key => { values.delete(key) },
    }
    const oldSave = saveSnapshot('A', slices('old'), store)
    const clear = clearSnapshot('A', store)
    expect(await oldSave).toBe(false)
    await clear
    expect(written).toEqual([])
    expect(await loadSnapshot('A', store)).toBeNull()
  })

  it('does not block another account behind a slow snapshot write', async () => {
    const values = new Map<string, unknown>()
    const gate = deferred()
    const store: SnapshotStore = {
      read: async key => values.get(key),
      write: async (key, value) => { if (key === 'A') await gate.promise; values.set(key, value) },
      remove: async key => { values.delete(key) },
    }
    const saveA = saveSnapshot('A', slices('a'), store)
    expect(await saveSnapshot('B', slices('b'), store)).toBe(true)
    gate.release()
    await saveA
  })
})
