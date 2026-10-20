// ============ UNIT 1 — installed-SDK request binding (GREEN PROOF) ============
//
// This suite answers one question only: does the installed @supabase/supabase-js
// let a caller bind a fresh request to a captured bearer, and does that binding
// survive the SDK's own awaited token lookup?
//
// It is a mechanism proof, not product acceptance. The product contract lives in
// `invite-request-contracts.test.ts`, which drives the real store entry point.
//
// Ordering: the SDK's token lookup is the await a switch can land in. So every
// case here STARTS consumption, waits for an explicit "lookup entered" receipt,
// and only then switches the account and releases the lookup. No timer is used
// as ordering proof, and the assertion is the request's FINAL Authorization
// header: the SDK fills that header only when the caller did not supply one
// (fetch.ts:83-93), so reading `init.headers` alone would mis-report a pinned
// request.
//
// Auth answers are synthetic strings. No real credential is used, printed or
// persisted, and no server or network is touched.

import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createDeferred, type Deferred } from './helpers/deferred'

interface Captured {
  url: string
  authorization: string
}

/** A synthetic session answer. These are fixture strings, not credentials. */
function authAs(user: string, token: string) {
  return { data: { session: { access_token: token, user: { id: user } } }, error: null }
}

/** A client whose transport records each request's final Authorization header. */
function syntheticClient(requests: Captured[], getSession: () => Promise<unknown>) {
  const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    requests.push({ url: String(url), authorization: headers.get('Authorization') ?? '' })
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  const client = createClient('http://127.0.0.1:1', 'synthetic-anon-key', {
    auth: { persistSession: false },
    global: { fetch: transport, headers: {} },
  })
  client.auth.getSession = getSession as typeof client.auth.getSession
  return client
}

/**
 * Auth that answers A to the caller's capture, then parks the SDK's own lookup
 * on a deferred. `entered` is the receipt that the lookup has started.
 */
function parkedLookup(entered: Deferred<void>, release: Deferred<void>) {
  let lookups = 0
  return async () => {
    lookups += 1
    if (lookups === 1) return authAs('A', 'synthetic-A')
    entered.resolve()
    await release.promise
    return authAs('B', 'synthetic-B')
  }
}

describe('a fresh PostgREST builder can carry a captured bearer', () => {
  it('an unbound rpc adopts the account the SDK lookup returns (the defect)', async () => {
    const requests: Captured[] = []
    const entered = createDeferred<void>()
    const release = createDeferred<void>()
    const client = syntheticClient(requests, parkedLookup(entered, release))

    // Caller capture, before the request exists.
    const capture = await client.auth.getSession()
    expect(capture.data.session.access_token).toBe('synthetic-A')

    // Start consumption. The SDK now awaits its own token lookup.
    const consumed = Promise.resolve(client.rpc('join_trip', { p_code: 'SYNTHETIC' }))

    // Receipt, then the switch. This ordering is the whole point.
    await entered.promise
    release.resolve()
    await consumed

    expect(requests).toHaveLength(1)
    // Nothing bound the request, so its final authority is the lookup's answer.
    expect(requests[0].authorization).toBe('Bearer synthetic-B')
  })

  it('a per-request setHeader keeps the captured bearer through the switch', async () => {
    const requests: Captured[] = []
    const entered = createDeferred<void>()
    const release = createDeferred<void>()
    const client = syntheticClient(requests, parkedLookup(entered, release))

    const capture = await client.auth.getSession()
    const pinned = capture.data.session.access_token

    const consumed = Promise.resolve(
      client.rpc('join_trip', { p_code: 'SYNTHETIC' }).setHeader('Authorization', `Bearer ${pinned}`),
    )
    await entered.promise
    release.resolve()
    await consumed

    expect(requests).toHaveLength(1)
    expect(requests[0].authorization).toBe('Bearer synthetic-A')
  })

  it('the pin does not move the client default for a later request', async () => {
    const requests: Captured[] = []
    const entered = createDeferred<void>()
    const release = createDeferred<void>()
    const client = syntheticClient(requests, parkedLookup(entered, release))

    const capture = await client.auth.getSession()
    const pinned = capture.data.session.access_token

    const first = Promise.resolve(
      client.rpc('join_trip', { p_code: 'FIRST' }).setHeader('Authorization', `Bearer ${pinned}`),
    )
    await entered.promise
    release.resolve()
    await first

    // The lookup now answers B. An unpinned request must therefore be B's.
    await Promise.resolve(client.rpc('join_trip', { p_code: 'SECOND' }))

    expect(requests.map(r => r.authorization)).toEqual([
      'Bearer synthetic-A',
      'Bearer synthetic-B',
    ])
  })

  it('concurrent builders keep their own pinned bearers', async () => {
    const requests: Captured[] = []
    const client = syntheticClient(requests, async () => authAs('A', 'synthetic-A'))

    await Promise.all([
      Promise.resolve(client.rpc('join_trip', { p_code: 'A' }).setHeader('Authorization', 'Bearer synthetic-A')),
      Promise.resolve(client.rpc('join_trip', { p_code: 'C' }).setHeader('Authorization', 'Bearer synthetic-C')),
    ])

    expect(requests.map(r => r.authorization).sort()).toEqual([
      'Bearer synthetic-A',
      'Bearer synthetic-C',
    ])
  })
})

describe('what this suite does not prove', () => {
  it('is a mechanism proof only; the product entry point is covered elsewhere', () => {
    // Stated as a test so the boundary travels with the suite: these four cases
    // show the SDK supports per-request binding. They do not show that the
    // product uses it. `invite-request-contracts.test.ts` drives the real store
    // entry point and is the acceptance evidence.
    expect(true).toBe(true)
  })
})
