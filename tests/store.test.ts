// ============ Store re-render contract ============
// useSyncExternalStore re-renders only when getSnapshot() returns a NEW
// reference. This test pins that contract (regression for #1): after a
// mutation the store must hand back a fresh top-level `cache` object so React
// subscribers actually re-render.
//
// Run under the default (node) environment — the store module does not need a
// DOM at import time, and we avoid pulling the optional jsdom dependency.
import { describe, it, expect } from 'vitest'
import { getSnapshot } from '../src/store/store'

describe('store snapshot reference contract', () => {
  it('getSnapshot is stable across reads when nothing changed', () => {
    const a = getSnapshot()
    const b = getSnapshot()
    expect(a).toBe(b)
  })

  it('a real mutation produces a new snapshot reference (regression for #1)', () => {
    const snapBefore = getSnapshot()
    // markAllNotificationsRead is a commit() path; on an empty/unknown user it
    // is effectively a no-op on data but still replaces the top-level cache
    // via commit(). That replacement is exactly what makes useSyncExternalStore
    // re-render.
    return import('../src/store/store').then(({ markAllNotificationsRead }) => {
      markAllNotificationsRead('nonexistent-user-id')
      const snapAfter = getSnapshot()
      expect(snapAfter).not.toBe(snapBefore)
    })
  })
})
