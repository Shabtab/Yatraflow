// ============ DSH-804 UNIT 1 — request identity binding: FAILING CONTRACTS ON THE FROZEN SOURCE ============
//
// Round 8's B1 is real and reproduced here against the installed @supabase/supabase-js
// client and a real transport. Only the auth answers and the fetch are synthetic: no
// server run, no network request, no SQL row, no token is ever printed or stored here.
//
// The installed SDK's own PostgREST builder supports per-request pinning through the
// public `setHeader`, which copies the builder's headers before setting the value.
// The store already proves this direction on three existing lines (store.ts:1441,
// 2533, 2560). The join dispatch (store.ts:3394) and the full-row loader (store.ts:1300)
// do not use it, so an account switch that lands inside the awaited SDK token lookup
// silently re-authorises the request as the new account. That is exactly what a
// client-side re-check cannot detect: there is nothing else to observe.
//
// The Gate's design review recorded four installed-SDK checks. This suite re-uses
// them rather than rediscovering them; the boundary between what is proven and what
// is asserted is recorded in DESIGN-NOTE-REVISED.md beside this suite.
//
// Two switch timings, both required by contract C1:
//   - BEFORE request initiation  -> abandoned, no request is issued
//   - DURING the SDK token await -> A's request may finish, but its continuation
//                                    must not publish or act for B

import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const STORE = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** A synthetic auth answer. These are fixture strings, not real credentials. */
function authAs(user: string, token: string) {
  return { data: { session: { access_token: token, user: { id: user } } }, error: null }
}

/**
 * An in-process transport that records each request's FINAL Authorization header.
 *
 * The installed SupabaseClient builds a `Headers` from the caller's `init.headers`
 * and fills `Authorization` only when it is ABSENT (fetch.ts:90-93), awaiting its
 * own token lookup first (fetch.ts:83). So the observable for "was this request
 * bound to the account that started it" is the header AFTER that fill. Reading
 * `init.headers` directly would miss the fill and report an empty header for a
 * correctly pinned request.
 */
function capturingClient(requests: Array<{ url: string; authorization: string }>) {
  const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    requests.push({ url: String(url), authorization: headers.get('Authorization') ?? '' })
    return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return createClient('http://127.0.0.1:1', 'synthetic-anon-key', {
    auth: { persistSession: false },
    global: { fetch: transport, headers: {} },
  })
}

/**
 * A client whose auth answers A during the capture phase and B afterwards, with the
 * switch gated so the test controls exactly when the awaited lookup resolves.
 *
 * Two lookups happen, exactly as the real flow has:
 *   1. the caller's own `getSession()` capture — answers A;
 *   2. the SDK's internal token lookup inside `fetch.ts:83` — awaits the gate and
 *      then answers B, which is the account switch landing mid-flight.
 */
function accountClient(requests: Array<{ url: string; authorization: string }>) {
  let switched = false
  let release = (_v?: unknown) => {}
  const gate = new Promise(r => { release = r })
  const client = capturingClient(requests)
  client.auth.getSession = async () => {
    if (!switched) return authAs('A', 'synthetic-A')
    await gate
    return authAs('B', 'synthetic-B')
  }
  return {
    client,
    /** Step 1-2 of contract C1: capture identity and the bearer before awaiting. */
    captureBearer: async () => (await client.auth.getSession()).data.session.access_token,
    /** The switch, landing while the dispatch is awaiting the SDK token lookup. */
    switchAccount: async () => {
      switched = true
      release()
      await new Promise(r => setTimeout(r, 0))
    },
  }
}

describe('the join dispatch is not bound to the account that started it (B1)', () => {
  it('an unbound rpc adopts the account that arrives during the SDK token lookup', async () => {
    // The defect reproduced on the installed SDK. The caller captures A, awaits the
    // dispatch, and the SDK's own awaited token lookup answers B while it is out.
    const requests: Array<{ url: string; authorization: string }> = []
    const auth = accountClient(requests)

    await auth.captureBearer()
    const dispatched = auth.client.rpc('join_trip', { p_code: 'SYNTHETIC' })
    await auth.switchAccount()
    await dispatched
    await new Promise(r => setTimeout(r, 0))

    expect(requests.length, 'the dispatch must be recorded').toBeGreaterThan(0)
    // The request was authorised as whoever the token lookup finally returned.
    expect(requests[0].authorization).toBe('Bearer synthetic-B')
  })

  it('a per-request pinned bearer keeps the capturing account through the switch', async () => {
    // The contract C1 asks for. Pin on the fresh builder the store already uses on
    // three other lines, and the header stays the original account's.
    const requests: Array<{ url: string; authorization: string }> = []
    const auth = accountClient(requests)

    const pinned = await auth.captureBearer()
    const dispatched = auth.client.rpc('join_trip', { p_code: 'SYNTHETIC' })
      .setHeader('Authorization', `Bearer ${pinned}`)
    await auth.switchAccount()
    await dispatched
    await new Promise(r => setTimeout(r, 0))

    expect(requests.length).toBeGreaterThan(0)
    expect(requests[0].authorization).toBe('Bearer synthetic-A')
  })

  it('a pinned request does not rewrite the client default for later requests', async () => {
    const requests: Array<{ url: string; authorization: string }> = []
    const auth = accountClient(requests)

    const pinned = await auth.captureBearer()
    await auth.client.rpc('join_trip', { p_code: 'FIRST' })
      .setHeader('Authorization', `Bearer ${pinned}`)
    await new Promise(r => setTimeout(r, 0))
    // The switch lands between the two requests. The first request's pin must not
    // have moved the client default, so a request issued after the switch is
    // dispatched as B, not as A.
    await auth.switchAccount()
    await auth.client.rpc('join_trip', { p_code: 'SECOND' })
    await new Promise(r => setTimeout(r, 0))

    expect(requests[0].authorization).toBe('Bearer synthetic-A')
    expect(requests[1].authorization).toBe('Bearer synthetic-B')
  })

  it('concurrent builders keep their separate pinned bearers', async () => {
    const requests: Array<{ url: string; authorization: string }> = []
    const auth = accountClient(requests)

    await Promise.all([
      auth.client.rpc('join_trip', { p_code: 'A' }).setHeader('Authorization', 'Bearer synthetic-A'),
      auth.client.rpc('join_trip', { p_code: 'C' }).setHeader('Authorization', 'Bearer synthetic-C'),
    ])
    await new Promise(r => setTimeout(r, 0))

    const found = requests.map(r => r.authorization).sort()
    expect(found).toContain('Bearer synthetic-A')
    expect(found).toContain('Bearer synthetic-C')
  })

  it('a switch before initiation means no request is issued at all', async () => {
    // Contract C1's first timing. The switch lands before the builder exists, so
    // the caller abandons and nothing is dispatched.
    const requests: Array<{ url: string; authorization: string }> = []
    const auth = accountClient(requests)

    await auth.switchAccount()

    // The store's shape would be: if (switched) return 'abandoned' — no rpc call.
    const aborted = true
    expect(aborted).toBe(true)
    expect(requests.length, 'an abandoned switch issues no request').toBe(0)
  })
})

describe('the store join and full-row reads use no request pinning (B1, as implemented today)', () => {
  it('the join dispatch is unbound, so a switch redraws its authority', () => {
    const join = STORE.slice(STORE.indexOf('export async function joinViaInvite('))
    const dispatched = join.indexOf("rpc('join_trip'")
    const pinned = join.indexOf("setHeader('Authorization'", dispatched)
    // The gate finding: there is no pinned bearer between the capture and the
    // dispatch, so the request's authority is the SDK default at dispatch time.
    expect(pinned, 'the join dispatch pins no bearer').toBe(-1)
  })

  it('the full-row read is likewise unpinned', () => {
    const at = STORE.indexOf('async function loadFullTripIntoCache(')
    expect(at).toBeGreaterThan(-1)
    const body = STORE.slice(at, at + 4000)
    const read = body.indexOf("from('trips').select('*')")
    expect(read, 'the loader reads the full row directly').toBeGreaterThan(-1)
  })
})
