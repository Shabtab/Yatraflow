// Group input phase 2: row mappers and receipt handling (node env, no DOM).
// The Supabase client is replaced by a recorder, so nothing here reaches a network.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc }, isSupabaseConfigured: true }))

import { decisionRowToEntry, submitCollabCommand, type CollabCommand } from '../src/store/collabCommand'
import { crewPreferenceRowToEntry, submitCrewPreferences } from '../src/store/crewPreferenceWire'

const TRIP = '11111111-1111-4111-8111-111111111111'
const DECISION = '33333333-0000-4000-8000-000000000001'
const USER = '00000000-0000-4000-8000-00000000000b'
const CLOSES = 4_000_000_000_000

const decisionRow = (extra: Record<string, unknown> = {}) => ({
  id: DECISION, trip_id: TRIP, question: 'Where?', context: null,
  options: [{ id: 'o_a', label: 'Fort' }, { id: 'o_b', label: 'Beach' }],
  votes_by_user_id: {}, comments: [], status: 'open', resolved_option_id: null, raised_by: USER,
  created_at: 5, resolved_at: null, closes_at: null, day_id: null, ...extra,
})

beforeEach(() => { rpc.mockReset() })

describe('decisionRowToEntry: closing time and day', () => {
  it('maps a legacy row to a decision with neither field', () => {
    const d = decisionRowToEntry(decisionRow())
    expect('closesAt' in d).toBe(false)
    expect('dayId' in d).toBe(false)
  })
  it('maps a row from before the columns existed', () => {
    const legacy: Record<string, unknown> = decisionRow()
    delete legacy.closes_at
    delete legacy.day_id
    const d = decisionRowToEntry(legacy)
    expect('closesAt' in d).toBe(false)
    expect('dayId' in d).toBe(false)
  })
  it('maps both fields when they are set', () => {
    const d = decisionRowToEntry(decisionRow({ closes_at: CLOSES, day_id: 'day_2' }))
    expect(d.closesAt).toBe(CLOSES)
    expect(d.dayId).toBe('day_2')
  })
  it('reads a bigint that arrives as a string', () => {
    expect(decisionRowToEntry(decisionRow({ closes_at: String(CLOSES) })).closesAt).toBe(CLOSES)
  })
  it('drops a closing time that is not a positive number, and an empty day', () => {
    for (const bad of [0, -1, 'soon', '', Number.NaN]) {
      expect('closesAt' in decisionRowToEntry(decisionRow({ closes_at: bad }))).toBe(false)
    }
    expect('dayId' in decisionRowToEntry(decisionRow({ day_id: '' }))).toBe(false)
  })
  it('keeps who added an option', () => {
    const d = decisionRowToEntry(decisionRow({ options: [{ id: 'o_c', label: 'Market', addedBy: USER }] }))
    expect(d.options[0].addedBy).toBe(USER)
  })
})

describe('submitCollabCommand: decision.create with a closing time', () => {
  const create = (decision: Record<string, unknown>): CollabCommand => ({
    type: 'decision.create', decisionId: DECISION,
    decision: { question: 'Where?', options: [{ id: 'o_a', label: 'Fort' }, { id: 'o_b', label: 'Beach' }], ...decision },
  })
  it('is applied when the stored row carries what was set', async () => {
    rpc.mockResolvedValue({ data: { status: 'applied', tripRevision: 3, decision: decisionRow({ closes_at: CLOSES, day_id: 'day_2' }) }, error: null })
    const out = await submitCollabCommand('c1', TRIP, create({ closesAt: CLOSES, dayId: 'day_2' }))
    expect(out.status).toBe('applied')
  })
  it('is NOT applied when a server drops the closing time (the vote would never lock)', async () => {
    rpc.mockResolvedValue({ data: { status: 'applied', tripRevision: 3, decision: decisionRow() }, error: null })
    expect((await submitCollabCommand('c1', TRIP, create({ closesAt: CLOSES }))).status).toBe('unavailable')
  })
  it('is NOT applied when a server drops the day', async () => {
    rpc.mockResolvedValue({ data: { status: 'applied', tripRevision: 3, decision: decisionRow({ closes_at: CLOSES }) }, error: null })
    expect((await submitCollabCommand('c1', TRIP, create({ closesAt: CLOSES, dayId: 'day_2' }))).status).toBe('unavailable')
  })
  it('needs no proof for a decision without a closing time or day', async () => {
    rpc.mockResolvedValue({ data: { status: 'applied', tripRevision: 3, decision: decisionRow() }, error: null })
    expect((await submitCollabCommand('c1', TRIP, create({}))).status).toBe('applied')
  })
  it('sends the closing time and day in the command', async () => {
    rpc.mockResolvedValue({ data: { status: 'applied', tripRevision: 3, decision: decisionRow({ closes_at: CLOSES, day_id: 'day_2' }) }, error: null })
    await submitCollabCommand('c1', TRIP, create({ closesAt: CLOSES, dayId: 'day_2' }))
    const sent = rpc.mock.calls[0][1].p_command
    expect(sent.decision.closesAt).toBe(CLOSES)
    expect(sent.decision.dayId).toBe('day_2')
  })
})

describe('submitCollabCommand: decision.option.add', () => {
  const add: CollabCommand = { type: 'decision.option.add', decisionId: DECISION, option: { id: 'o_c', label: 'Market' } }
  it('is applied when the receipt row holds the new option', async () => {
    const withOption = decisionRow({ options: [{ id: 'o_a', label: 'Fort' }, { id: 'o_c', label: 'Market', addedBy: USER }] })
    rpc.mockResolvedValue({ data: { status: 'applied', tripRevision: 3, decision: withOption }, error: null })
    const out = await submitCollabCommand('c2', TRIP, add)
    expect(out.status).toBe('applied')
    if (out.status === 'applied') expect(out.decision?.options.find(o => o.id === 'o_c')?.addedBy).toBe(USER)
  })
  it('is NOT applied when the receipt row lacks the option', async () => {
    rpc.mockResolvedValue({ data: { status: 'applied', tripRevision: 3, decision: decisionRow() }, error: null })
    expect((await submitCollabCommand('c2', TRIP, add)).status).toBe('unavailable')
  })
  it('is NOT applied when the receipt carries no row', async () => {
    rpc.mockResolvedValue({ data: { status: 'applied', tripRevision: 3 }, error: null })
    expect((await submitCollabCommand('c2', TRIP, add)).status).toBe('unavailable')
  })
  it('passes the server reason through on a refusal', async () => {
    rpc.mockResolvedValue({ data: { status: 'invalid', tripRevision: 3, reason: 'voting is closed' }, error: null })
    expect(await submitCollabCommand('c2', TRIP, add)).toEqual({ status: 'invalid', reason: 'voting is closed' })
  })
  it('answers forbidden for a viewer', async () => {
    rpc.mockResolvedValue({ data: { status: 'forbidden', tripRevision: null }, error: null })
    expect((await submitCollabCommand('c2', TRIP, add)).status).toBe('forbidden')
  })
})

describe('crewPreferenceRowToEntry', () => {
  it('maps a row', () => {
    expect(crewPreferenceRowToEntry({ trip_id: TRIP, user_id: USER, interests: ['food', 'nature'], updated_at: 9 }))
      .toEqual({ tripId: TRIP, userId: USER, interests: ['food', 'nature'], updatedAt: 9 })
  })
  it('keeps an empty answer as an empty list', () => {
    expect(crewPreferenceRowToEntry({ trip_id: TRIP, user_id: USER, interests: [], updated_at: 1 }).interests).toEqual([])
  })
  it('leaves out an interest this app does not know, and keeps the row', () => {
    const r = crewPreferenceRowToEntry({ trip_id: TRIP, user_id: USER, interests: ['food', 'casino', 7], updated_at: 1 })
    expect(r.interests).toEqual(['food'])
  })
  it('reads a missing or bad list as empty and a bad time as 0', () => {
    const r = crewPreferenceRowToEntry({ trip_id: TRIP, user_id: USER, interests: 'food', updated_at: 'now' })
    expect(r.interests).toEqual([])
    expect(r.updatedAt).toBe(0)
  })
  it('throws on a row with no trip or no member, so the caller can skip it', () => {
    expect(() => crewPreferenceRowToEntry({ user_id: USER, interests: [] })).toThrow()
    expect(() => crewPreferenceRowToEntry({ trip_id: TRIP, interests: [] })).toThrow()
    expect(() => crewPreferenceRowToEntry(null)).toThrow()
  })
})

describe('submitCrewPreferences', () => {
  const stored = { trip_id: TRIP, user_id: USER, interests: ['food'], updated_at: 12 }
  it('sends the trip and the list to the RPC', async () => {
    rpc.mockResolvedValue({ data: { status: 'applied', preference: stored }, error: null })
    await submitCrewPreferences(TRIP, ['food'])
    expect(rpc).toHaveBeenCalledWith('set_my_crew_preferences', { p_trip_id: TRIP, p_interests: ['food'] })
  })
  it('returns the stored row on success', async () => {
    rpc.mockResolvedValue({ data: { status: 'applied', preference: stored }, error: null })
    const out = await submitCrewPreferences(TRIP, ['food'])
    expect(out.status).toBe('applied')
    if (out.status === 'applied') expect(out.crewPreference).toEqual({ tripId: TRIP, userId: USER, interests: ['food'], updatedAt: 12 })
  })
  it('maps each refusal', async () => {
    rpc.mockResolvedValue({ data: { status: 'invalid' }, error: null })
    expect((await submitCrewPreferences(TRIP, [])).status).toBe('invalid')
    rpc.mockResolvedValue({ data: { status: 'forbidden' }, error: null })
    expect((await submitCrewPreferences(TRIP, [])).status).toBe('forbidden')
    rpc.mockResolvedValue({ data: { status: 'unavailable' }, error: null })
    expect((await submitCrewPreferences(TRIP, [])).status).toBe('unavailable')
  })
  it('maps a permission error to forbidden and any other error to unavailable', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    expect((await submitCrewPreferences(TRIP, [])).status).toBe('forbidden')
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    expect((await submitCrewPreferences(TRIP, [])).status).toBe('unavailable')
  })
  it('never reads an unreadable success as a save', async () => {
    for (const data of [null, 'ok', {}, { status: 'applied' }, { status: 'applied', preference: { interests: [] } }, { status: 'maybe' }]) {
      rpc.mockResolvedValue({ data, error: null })
      expect((await submitCrewPreferences(TRIP, ['food'])).status).toBe('unavailable')
    }
  })
  it('does not accept a receipt for a different trip', async () => {
    rpc.mockResolvedValue({ data: { status: 'applied', preference: { ...stored, trip_id: '22222222-2222-4222-8222-222222222222' } }, error: null })
    expect((await submitCrewPreferences(TRIP, ['food'])).status).toBe('unavailable')
  })
  it('never throws', async () => {
    rpc.mockRejectedValue(new Error('offline'))
    expect((await submitCrewPreferences(TRIP, ['food'])).status).toBe('unavailable')
  })
})
