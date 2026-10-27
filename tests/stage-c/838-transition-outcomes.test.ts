import { beforeEach, describe, expect, it, vi } from 'vitest'

const { transport } = vi.hoisted(() => ({ transport: { response: null as { data?: unknown; error?: unknown } | null, throws: false } }))

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: async (_name: string, _args: unknown) => {
      if (transport.throws) throw new Error('transport down')
      return transport.response ?? { data: null, error: null }
    },
  },
}))

import { submitCollabTransition } from '../../src/store/collabCommand'

const suggestionRow = {
  id: 'suggestion-1', trip_id: 'trip-1', day_index: 0, proposed_by: 'user-1',
  title: 'Museum', category: 'sightseeing', location_name: 'Museum', lat: 12.9, lng: 77.6,
  visit_minutes: 45, estimated_entry_fee_inr: 0, estimated_transport_inr: 0,
  votes: [], comments: [], status: 'accepted', accepted_stop_id: 'st_1',
}

describe('stage-c/838 transition receipt outcomes', () => {
  beforeEach(() => { transport.response = null; transport.throws = false })

  it('returns a stop identity only after an acknowledged acceptance', async () => {
    transport.response = { data: { status: 'applied', tripRevision: 8, stopId: 'st_1', suggestion: suggestionRow }, error: null }
    const outcome = await submitCollabTransition('command-1', 'trip-1', {
      type: 'suggestion.accept', suggestionId: 'suggestion-1', expectedRevision: 7,
    })
    expect(outcome).toMatchObject({ status: 'applied', tripRevision: 8, stopId: 'st_1', suggestion: { status: 'accepted' } })
  })

  it('keeps a deleted-day refusal explicit and returns only current choices', async () => {
    transport.response = { data: { status: 'needsDay', tripRevision: 7, availableDays: [{ id: 'day-b', index: 1 }] }, error: null }
    const outcome = await submitCollabTransition('command-2', 'trip-1', {
      type: 'suggestion.accept', suggestionId: 'suggestion-1', expectedRevision: 7,
    })
    expect(outcome).toEqual({ status: 'needsDay', availableDays: [{ id: 'day-b', index: 1 }] })
  })

  it('keeps the resolved winner separate from a missing placement day', async () => {
    transport.response = { data: {
      status: 'applied', tripRevision: 7, winnerId: 'slot:lunch:cafe', placementStatus: 'needsDay',
      availableDays: [{ id: 'day-current', index: 0 }],
      decision: {
        id: 'decision-1', trip_id: 'trip-1', question: 'Where?', options: [{ id: 'slot:lunch:cafe', label: 'Cafe' }],
        votes_by_user_id: {}, comments: [], status: 'resolved', resolved_option_id: 'slot:lunch:cafe', raised_by: 'user-1',
      },
    }, error: null }
    const outcome = await submitCollabTransition('command-3', 'trip-1', {
      type: 'decision.resolve', decisionId: 'decision-1', optionId: 'slot:lunch:cafe', expectedRevision: 7,
    })
    expect(outcome).toMatchObject({
      status: 'applied', winnerId: 'slot:lunch:cafe',
      placement: { status: 'needsDay', availableDays: [{ id: 'day-current', index: 0 }] },
      decision: { status: 'resolved', resolvedOptionId: 'slot:lunch:cafe' },
    })
  })

  it('fails closed for malformed success receipts, permission errors, and rejected transport', async () => {
    transport.response = { data: { status: 'applied', tripRevision: 8 }, error: null }
    await expect(submitCollabTransition('command-4', 'trip-1', {
      type: 'suggestion.accept', suggestionId: 'suggestion-1', expectedRevision: 7,
    })).resolves.toEqual({ status: 'unavailable' })

    transport.response = { data: null, error: { code: '42501' } }
    await expect(submitCollabTransition('command-5', 'trip-1', {
      type: 'suggestion.decline', suggestionId: 'suggestion-1',
    })).resolves.toEqual({ status: 'forbidden' })

    transport.response = null
    transport.throws = true
    await expect(submitCollabTransition('command-6', 'trip-1', {
      type: 'suggestion.decline', suggestionId: 'suggestion-1',
    })).resolves.toEqual({ status: 'unavailable' })
  })
})
