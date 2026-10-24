// ============ UNIT 2 — the PRODUCT dispatch, through the REAL SDK ============
//
// The SDK suite proves the mechanism. This suite proves the product uses it:
// `../src/lib/supabase` is replaced with a REAL `createClient` from the installed
// @supabase/supabase-js, whose transport is an in-process function that records
// each request's FINAL Authorization header.
//
// Nothing here mocks the request builder. `joinViaInvite` runs for real, the SDK
// builds and sends the requests, and the assertion is what arrived on the wire.
//
// Two cases:
//   1. no switch  -> every request carries the captured bearer;
//   2. the session answers B after the first capture -> the already-dispatched A
//      request still arrives as A, and the continuation abandons instead of
//      committing B's cache, ledger or effects.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const TRIP = '11111111-1111-4111-8111-111111111111'
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CODE = 'SYNTHETIC-CODE'

const ROW = {
  id: TRIP,
  owner_id: BOB,
  name: 'Goa Beach Week',
  start_location: 'Mumbai',
  start_location_coords: null,
  destinations: ['Goa'],
  destination_coords: null,
  start_date: '2026-10-01',
  end_date: '2026-10-04',
  travellers: 2,
  transport_mode: 'car',
  budget_per_person_inr: 12000,
  travel_style: 'relaxed',
  fixed_commitments: [],
  days: [],
  expenses: [],
  cover_emoji: '🧭',
  invite_code: CODE,
  visibility: 'private',
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  write_version: 1,
  // The five protected columns a full row carries.
  flights: [],
  tank_l: null,
  rent_per_day_inr: null,
  local_train: null,
  ref: null,
  // Round 10 — admission reads the WHOLE row before any default applies.
  fuel_economy_km_per_l: null,
  fuel_price_per_l: null,
  round_trip: null,
  cover_image_url: null,
  stay_style: null,
  driver_count: null,
  has_vulnerable: null,
  drive_after_dinner_min: null,
  vehicle_profile: null,
  deleted_at: null,
}
const MEMBERS = [{ trip_id: TRIP, user_id: ALICE, role: 'editor', joined_at: 1 }]

const api = vi.hoisted(() => ({
  requests: [] as Array<{ url: string; authorization: string }>,
  sessions: 0,
  /** 'steady' answers ALICE; 'switch' answers BOB after the first capture. */
  mode: 'steady' as 'steady' | 'switch',
}))

vi.mock('../src/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const transport = async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const href = String(url)
    api.requests.push({ url: href, authorization: headers.get('Authorization') ?? '' })
    const single = (headers.get('accept') ?? '').includes('vnd.pgrst.object')
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (href.includes('/rest/v1/rpc/join_trip')) return json(TRIP)
    if (href.includes('/rest/v1/trip_members')) {
      // The pre-query (select=user_id) answers "not a member", so the join RPC
      // really runs. The loader's full read (select=*) carries the new row.
      if (href.includes('select=user_id')) return json(null)
      return json(single ? MEMBERS[0] : MEMBERS)
    }
    if (href.includes('/rest/v1/trips')) return json(ROW)
    return json([])
  }
  const client = createClient('http://127.0.0.1:1', 'synthetic-anon-key', {
    auth: { persistSession: false },
    global: { fetch: transport, headers: {} },
  })
  client.auth.getSession = (async () => {
    api.sessions += 1
    const switched = api.mode === 'switch' && api.sessions > 1
    return {
      data: {
        session: {
          access_token: switched ? 'synthetic-B' : 'synthetic-A',
          user: { id: switched ? BOB : ALICE },
        },
      },
      error: null,
    }
  }) as typeof client.auth.getSession
  return { isSupabaseConfigured: false, supabase: client }
})

import { getSnapshot, joinViaInvite, tripById } from '../src/store/store'

function reset(): void {
  api.requests = []
  api.sessions = 0
  api.mode = 'steady'
  const db = getSnapshot() as { sessionUserId: string | null; trips: unknown[] }
  db.sessionUserId = ALICE
  db.trips = []
}

describe('the product pins the join dispatch through the installed SDK', () => {
  beforeEach(reset)

  it('every request carries the bearer captured before the first await', async () => {
    const outcome = await joinViaInvite(TRIP, ALICE, CODE)

    expect(outcome).toBe('joined')
    expect(tripById(TRIP)?.id).toBe(TRIP)

    // Membership read, join RPC, trips read, members read.
    expect(api.requests.length, api.requests.map(r => r.url).join(' | ')).toBeGreaterThanOrEqual(4)
    const bare = api.requests.filter(r => r.authorization !== 'Bearer synthetic-A')
    expect(bare.map(r => r.url), 'every request is bound to the captured account').toEqual([])
    expect(api.requests.some(r => r.url.includes('/rpc/join_trip'))).toBe(true)
  })

  it('a session that turns to B cannot change the dispatched A request or commit B', async () => {
    api.mode = 'switch'

    const outcome = await joinViaInvite(TRIP, ALICE, CODE)

    // The A membership read and the A join dispatch both went out as A, because
    // each was pinned. The second stage's capture sees B and abandons.
    const rpc = api.requests.find(r => r.url.includes('/rpc/join_trip'))
    expect(rpc, 'the dispatch is still issued as the capturing account').toBeDefined()
    expect(rpc?.authorization).toBe('Bearer synthetic-A')
    const bare = api.requests.filter(r => r.authorization !== 'Bearer synthetic-A')
    expect(bare.map(r => r.url), 'no request is re-authorised as B').toEqual([])

    expect(outcome).toBe('abandoned')
    expect(tripById(TRIP), 'nothing is cached for the new account').toBeUndefined()
  })
})
