// P6 Invite gate and shared snapshot: the honesty of their branches (R23).
//
// These are the page's own decisions, imported from the page's own module, so
// the rules pinned here are the ones App.tsx follows. A read that failed is
// never shown as a link that is dead, and the auth round-trip keeps its route.
import { describe, expect, it } from 'vitest'
import {
  inviteGateState, sharedSnapshotState,
  inviteAuthRoute, inviteLoginNext, inviteSignupNext, invitePreview,
} from '../src/lib/inviteGateStates'

describe('inviteGateState', () => {
  it('is loading while the read is in flight', () => {
    expect(inviteGateState({ loading: true, failed: false, trip: null })).toBe('loading')
  })

  it('is ready when the read returned a trip', () => {
    expect(inviteGateState({ loading: false, failed: false, trip: { name: 'Goa' } })).toBe('ready')
  })

  it('is expired when the read answered that no trip exists', () => {
    expect(inviteGateState({ loading: false, failed: false, trip: null })).toBe('expired')
  })

  it('is failed when the read threw, and never expired', () => {
    expect(inviteGateState({ loading: false, failed: true, trip: null })).toBe('failed')
  })

  it('is failed when the read failed even while a stale trip is still held', () => {
    expect(inviteGateState({ loading: false, failed: true, trip: { name: 'Goa' } })).toBe('failed')
  })

  it('is failed, not loading, when the read failed in flight', () => {
    expect(inviteGateState({ loading: true, failed: true, trip: null })).toBe('failed')
  })
})

describe('sharedSnapshotState', () => {
  it('is loading while the payload is unpacked', () => {
    expect(sharedSnapshotState({ loading: true, failed: false, trip: null })).toBe('loading')
  })

  it('is ready when the payload decoded to a trip', () => {
    expect(sharedSnapshotState({ loading: false, failed: false, trip: { name: 'Goa' } })).toBe('ready')
  })

  it('is failed when the decode threw', () => {
    expect(sharedSnapshotState({ loading: false, failed: true, trip: null })).toBe('failed')
  })

  it('is failed, not ready, when the decode produced nothing', () => {
    expect(sharedSnapshotState({ loading: false, failed: false, trip: null })).toBe('failed')
  })
})

describe('inviteAuthRoute', () => {
  it('parks a short-code link under /join', () => {
    expect(inviteAuthRoute('GOA-K7QF', false)).toBe('/join/GOA-K7QF')
  })

  it('parks a trip-id link under /invite', () => {
    expect(inviteAuthRoute('3f2b1c00-0000-4000-8000-000000000000', true)).toBe('/invite/3f2b1c00-0000-4000-8000-000000000000')
  })
})

describe('inviteLoginNext', () => {
  it('carries the parked route as an encoded next parameter', () => {
    expect(inviteLoginNext('GOA-K7QF', false)).toBe('/auth?next=%2Fjoin%2FGOA-K7QF')
  })

  it('carries the trip-id route for a legacy link', () => {
    expect(inviteLoginNext('3f2b1c00-0000-4000-8000-000000000000', true))
      .toBe('/auth?next=%2Finvite%2F3f2b1c00-0000-4000-8000-000000000000')
  })

  it('encodes a code that carries a space', () => {
    expect(inviteLoginNext('GOA K7QF', false)).toBe('/auth?next=%2Fjoin%2FGOA%20K7QF')
  })
})

describe('inviteSignupNext', () => {
  it('keeps the signup mode and the same parked route', () => {
    expect(inviteSignupNext('GOA-K7QF', false)).toBe('/auth?mode=signup&next=%2Fjoin%2FGOA-K7QF')
  })

  it('keeps the signup mode for a trip-id link', () => {
    expect(inviteSignupNext('3f2b1c00-0000-4000-8000-000000000000', true))
      .toBe('/auth?mode=signup&next=%2Finvite%2F3f2b1c00-0000-4000-8000-000000000000')
  })
})

describe('invitePreview', () => {
  it('reads the route, dates and member count from the trip it already holds', () => {
    const p = invitePreview({
      name: 'Goa beach week',
      startDate: '2026-11-14',
      days: [{}, {}, {}, {}],
      destinations: ['Panaji', 'Palolem'],
      members: [{}, {}, {}],
    })
    expect(p).toEqual({
      name: 'Goa beach week',
      route: 'Panaji \u00b7 Palolem',
      dates: '2026-11-14 \u00b7 4 days',
      memberCount: 3,
    })
  })

  it('says one day, not one days', () => {
    expect(invitePreview({ name: 'Quick trip', startDate: '2026-11-14', days: [{}], destinations: [], members: [] }).dates)
      .toBe('2026-11-14 \u00b7 1 day')
  })

  it('shows no date line when the trip has no start date', () => {
    expect(invitePreview({ name: 'Quick trip', days: [{}], destinations: [], members: [] }).dates).toBe('')
  })

  it('shows no date line when the trip has no days', () => {
    expect(invitePreview({ name: 'Quick trip', startDate: '2026-11-14', days: [], destinations: [], members: [] }).dates).toBe('')
  })

  it('drops an empty destination from the route', () => {
    expect(invitePreview({ name: 'Quick trip', startDate: '2026-11-14', days: [{}], destinations: ['Panaji', ''], members: [] }).route)
      .toBe('Panaji')
  })

  it('counts no members when the trip carries none', () => {
    expect(invitePreview({ name: 'Quick trip', days: [{}], destinations: [], members: [] }).memberCount).toBe(0)
  })
})
