// ============ #800 REPAIR-03 — the user-facing and lifecycle findings ============
//
// F1  actual self/admin consumers and a visible authorized retry
// F2  authorized private refresh on reconnect, and a safe event path
// F3  post-SDK-signOut continuation fenced to its own identity
// F4  same-ID admin-authority loss downgrades other-account private rows
// F5  the final catalogue is built after the read outcomes, not by aliasing
//
// Each finding was reproduced by root's browser probe or the reviewer's
// fixed-source probe. These tests drive the same seams through the store.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

const { state, toast } = vi.hoisted(() => ({
  state: {
    tableReads: [] as string[],
    rpcCalls: [] as { fn: string; args: unknown }[],
    cards: [] as unknown[],
    disabled: false,
    rpcError: false,
    tableErrors: {} as Record<string, { message: string } | null>,
    profileErrors: {} as Record<string, { message: string } | null>,
    profileRows: {} as Record<string, unknown>,
    /** Rows an unfiltered select returns (the admin bulk read). */
    allProfileRows: [] as unknown[],
    deferred: {} as Record<string, () => void>,
    /** A held SDK signOut: the call BEGINS for the caller, and its completion
     *  only resolves when the test releases it. */
    signOutGate: null as null | Promise<void>,
    signOuts: [] as string[],
    sessionUser: 'u-1' as 'u-1' | 'u-2',
    admin: false,
  },
  toast: vi.fn(),
}))

vi.mock('../src/components/ui', () => ({ toast }))

vi.mock('../src/lib/supabase', () => {
  const builder = (table: string) => {
    const filters: Array<[string, unknown]> = []
    const b: Record<string, unknown> = {
      select: (column?: string) => { if (column) b.column = column; return b },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return b },
      in: () => b,
      limit: () => b,
      maybeSingle: () => { b.singleUsed = true; return b },
      single: () => { b.singleUsed = true; return b },
      insert: () => b,
      update: () => b,
      upsert: () => b,
      delete: () => b,
      setHeader: () => b,
      then: (res: (v: { data: unknown; error: unknown }) => unknown) => {
        state.tableReads.push(table)
        const id = filters.find(([k]) => k === 'id')?.[1]
        const failed = state.tableErrors[table] ?? (id !== undefined ? (state.profileErrors[String(id)] ?? null) : null)
        const row = id !== undefined ? (state.profileRows[String(id)] ?? null) : null
        const single = b.singleUsed === true
        // An unfiltered select answers every row (the admin bulk read); a filtered
        // one answers just that row.
        const rows = row ? [row] : (id === undefined ? state.allProfileRows : [])
        // A held read lets a test change the authority or the account mid-flight.
        // The self read is held on `__holdSelf`, the admin bulk on `__holdProfiles`.
        const gate = id !== undefined ? state.deferred.__holdSelf : state.deferred.__holdProfiles
        if (gate && table === 'profiles') {
          if (id !== undefined) state.deferred.__holdSelf = undefined as never
          else state.deferred.__holdProfiles = undefined as never
          return gate.then(() => Promise.resolve({ data: failed ? null : (single ? row : rows), error: failed })).then(res)
        }
        return Promise.resolve({
          data: failed ? null : (single ? row : rows),
          error: failed,
        }).then(res)
      },
    }
    return b
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: builder,
      channel: () => { const c: Record<string, unknown> = { on: () => c, subscribe: () => ({}) }; return c },
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () => Promise.resolve({
          data: { session: state.sessionUser ? { user: { id: state.sessionUser }, access_token: 'tok' } : null },
        }),
        signOut: () => {
          state.signOuts.push(String(state.sessionUser))
          const gate = state.signOutGate
          if (gate) { state.signOutGate = null; return gate.then(() => ({ error: null })) }
          return Promise.resolve({ error: null })
        },
        onAuthStateChange: () => ({ data: { subscription: {} } }),
      },
      rpc: (fn: string, args: unknown) => {
        state.rpcCalls.push({ fn, args })
        const b: Record<string, unknown> = {
          setHeader: () => b,
          then: (res: (v: { data: unknown; error: unknown }) => unknown) => {
            const failed = (state.rpcError && fn === 'get_public_profile_cards')
              || (fn === 'is_disabled' && state.disabled === null)
            const data = failed ? null
              : fn === 'get_public_profile_cards' ? state.cards
                : fn === 'is_disabled' ? state.disabled
                  : null
            const settle = () => Promise.resolve({ data, error: failed ? { message: 'PGRST202' } : null })
            const parked = state.deferred[fn]
            if (parked) { state.deferred[fn] = () => {}; return parked().then(settle).then(res) }
            return settle().then(res)
          },
        }
        return b
      },
    },
  }
})

const OWNER_PRIVATE = {
  id: 'u-1', email: 'a@example.invalid', name: 'Asha', avatar_url: 'https://cdn/a.png', home_city: 'Kochi',
  languages: ['en', 'ml'], travel_styles: ['balanced'], is_creator: true, creator_bio: 'Kerala',
  social_links: { youtube: 'https://y/@a', instagram: 'https://i/a' }, is_disabled: false, created_at: 111,
}
const OTHER_PRIVATE = {
  ...OWNER_PRIVATE, id: 'u-2', email: 'b@example.invalid', name: 'Bilal',
  social_links: { youtube: 'https://y/@b' },
}
const OWNER_CARD = { id: 'u-1', name: 'Asha', avatar_url: 'https://cdn/a.png', is_creator: true, creator_bio: 'Kerala', social_links: { youtube: 'https://y/@a', instagram: 'https://i/a' }, creator_available: true }
const OTHER_CARD = { id: 'u-2', name: 'Bilal', avatar_url: null, is_creator: false, creator_bio: null, social_links: null, creator_available: false }

const flush = () => new Promise(r => setTimeout(r, 0))

async function freshStore() {
  vi.resetModules()
  return await import('../src/store/store')
}

beforeEach(() => {
  state.tableReads = []
  state.rpcCalls = []
  state.cards = [OWNER_CARD, OTHER_CARD]
  state.disabled = false
  state.rpcError = false
  state.tableErrors = {}
  state.profileErrors = {}
  state.profileRows = {}
  state.allProfileRows = []
  state.deferred = {}
  state.signOutGate = null
  state.signOuts = []
  state.sessionUser = 'u-1'
  state.admin = false
  toast.mockClear()
})

// ============ F1 — the actual consumers and a working retry ============
describe('the profile lookup follows the private read', () => {
  it('a failed private read reports failed, not a completed-without-account', async () => {
    const { profileLookupState } = await import('../src/App')
    const state1 = profileLookupState('u-1', false, { profiles: 'ok', 'self profile': 'failed' })
    expect(state1).toBe('failed')
  })

  it('a public success cannot certify the account ready when the private read failed', async () => {
    const { profileLookupState } = await import('../src/App')
    // The old code read `profiles` alone, which was 'ok' here.
    expect(profileLookupState('u-1', false, { profiles: 'ok', 'self profile': 'failed' })).toBe('failed')
  })

  it('a genuinely absent account is still missing, not failed', async () => {
    const { profileLookupState } = await import('../src/App')
    expect(profileLookupState('u-1', false, { profiles: 'ok', 'self profile': 'ok' })).toBe('missing')
  })

  it('the retry reissues the authorized private read', async () => {
    const store = await freshStore()
    state.profileRows = {}
    state.profileErrors = { 'u-1': { message: 'network down' } }

    store.getSnapshot().sessionUserId = 'u-1'
    await store.resumeSync()
    await flush(); await flush(); await flush()
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')

    const readsBefore = state.tableReads.length
    state.profileErrors = {}
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    await store.resumeSync()
    await flush(); await flush(); await flush()

    // The authorized read actually ran again and the account is back.
    expect(state.tableReads.length).toBeGreaterThan(readsBefore)
    expect(store.getSnapshot().sliceReads['self profile']).not.toBe('failed')
    expect(store.currentUser()?.email).toBe('a@example.invalid')
  })
})

// ============ F2 — private refresh and safe events ============
describe('the private reads are fenced to their caller', () => {
  it('an admin-authority loss during the read refuses rather than installing rows', async () => {
    const store = await freshStore()
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    // Hold the private bulk read open, so the authority can change mid-flight.
    let release = () => {}
    state.deferred.__holdProfiles = new Promise<void>(r => { release = r })

    store.getSnapshot().sessionUserId = 'u-1'
    store._setAdminForTest(true)
    const pending = store.resumeSync()
    await flush()
    expect(state.tableReads.filter(t => t === 'profiles').length).toBeGreaterThan(0)

    // The authority is revoked while the read is still in the air.
    store._setAdminForTest(false)
    release()
    await pending
    await flush(); await flush(); await flush()

    // The read is refused, the console's verdict says so, and no OTHER-account
    // private row is installed. The caller's own private row is legitimate: it
    // came from the self read, which is fenced separately.
    expect(store.getSnapshot().sliceReads['admin profiles']).toBe('failed')
    expect(store.getSnapshot().users.filter(u => u.kind === 'private').every(u => u.id === 'u-1')).toBe(true)
  })

  it('a remote disablement during the read refuses rather than installing rows', async () => {
    const store = await freshStore()
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    let release = () => {}
    state.deferred.__holdProfiles = new Promise<void>(r => { release = r })

    store.getSnapshot().sessionUserId = 'u-1'
    store._setAdminForTest(true)
    const pending = store.resumeSync()
    await flush()

    // The caller is disabled remotely while the bulk read is in the air. The
    // RESTRICTIVE policy would then refuse the read server-side too.
    state.sessionUser = 'u-2'
    store.getSnapshot().sessionUserId = 'u-2'
    release()
    await pending
    await flush(); await flush(); await flush()

    // The answer belonged to the account that asked, so it is discarded, and no
    // OTHER-account private row is installed under the account now signed in.
    expect(store.getSnapshot().sliceReads['admin profiles']).toBe('failed')
    expect(store.getSnapshot().users.filter(u => u.kind === 'private').every(u => u.id === 'u-1')).toBe(true)
    expect(store.getSnapshot().users.filter(u => u.kind === 'private')).not.toContainEqual(
      expect.objectContaining({ id: 'u-2' }),
    )
  })

  it('an event for a non-admin caller does not install private rows', async () => {
    const store = await freshStore()
    store.getSnapshot().sessionUserId = 'u-1'
    store._setAdminForTest(false)
    store._applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', schema: 'public', table: 'profile_cards',
      commit_timestamp: new Date().toISOString(),
      old: { id: 'u-2' },
      new: { id: 'u-2', name: 'Renamed', avatar_url: null, is_creator: true, creator_bio: null, social_links: null, creator_available: true },
    } as never)

    // The event carries public fields only, and the cache holds public cards.
    const users = store.getSnapshot().users
    expect(users.every(u => u.kind === 'public')).toBe(true)
  })
})

// ============ F3 — the signOut completion is fenced ============
describe('the sign-out completion belongs to its own identity', () => {
  it('an obsolete signOut completion does not clear the next account\'s admin cache', async () => {
    const store = await freshStore()
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.disabled = true
    let releaseSignOut = () => {}
    state.signOutGate = new Promise<void>(r => { releaseSignOut = r })

    store.getSnapshot().sessionUserId = 'u-1'
    store._setAdminForTest(false)
    const pending = store.enforceDisabledCheck()
    await flush()
    expect(state.signOuts).toEqual(['u-1'])

    // Account B becomes an admin with a fresh generation, then A's completion runs.
    store._bumpIdentityEpochForTest()
    state.sessionUser = 'u-2'
    store.getSnapshot().sessionUserId = 'u-2'
    store._setAdminForTest(true)
    releaseSignOut()
    expect(await pending).toBe(false)

    // B is still an admin: A's late completion did not clear B's admin cache.
    expect(store.getSnapshot().sessionUserId).toBe('u-2')
    expect(store._isAdminForTest()).toBe(true)
    // And no message was attributed to B.
    expect(toast).not.toHaveBeenCalled()
  })

  it('a stable disabled account is still signed out with the message', async () => {
    const store = await freshStore()
    state.profileRows = {}
    state.disabled = true

    store.getSnapshot().sessionUserId = 'u-1'
    expect(await store.enforceDisabledCheck()).toBe(true)
    expect(state.signOuts).toEqual(['u-1'])
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('disabled'), 'err')
  })
})

// ============ F4 — same-ID authority loss ============
describe('a same-ID authority loss downgrades other-account private rows', () => {
  it('losing admin on the same id removes the private rows it unlocked', async () => {
    const store = await freshStore()
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    let release = () => {}
    state.deferred.__holdProfiles = new Promise<void>(r => { release = r })

    store.getSnapshot().sessionUserId = 'u-1'
    store._setAdminForTest(true)
    const pending = store.resumeSync()
    await flush()
    // Same id, no generation bump: the authority itself changed mid-read.
    store._setAdminForTest(false)
    release()
    await pending
    await flush(); await flush(); await flush()

    // No other-account private row survives the authority loss. The caller's own
    // row comes from the self read, which is fenced separately.
    expect(store.getSnapshot().users.filter(u => u.kind === 'private').every(u => u.id === 'u-1')).toBe(true)
    expect(store.getSnapshot().users).not.toContainEqual(expect.objectContaining({ id: 'u-2', kind: 'private' }))
    expect(store.getSnapshot().sliceReads['admin profiles']).toBe('failed')
  })
})

// ============ F5 — the catalogue is built, not aliased ============
describe('the final catalogue is built after the read outcomes', () => {
  it('an admin bulk read produces a catalogue that is entirely private rows', async () => {
    const store = await freshStore()
    state.profileRows = { 'u-1': OWNER_PRIVATE, 'u-2': OTHER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.getSnapshot().sessionUserId = 'u-1'
    store._setAdminForTest(true)
    await store.resumeSync()
    await flush(); await flush(); await flush()

    const users = store.getSnapshot().users
    expect(users).toHaveLength(2)
    // Every row is private, and the emails are the ones the read returned.
    expect(users.every(u => u.kind === 'private')).toBe(true)
    expect(users.map(u => u.email).sort()).toEqual(['a@example.invalid', 'b@example.invalid'])
  })

  it('a non-admin hydrate keeps the public catalogue plus its own private row', async () => {
    const store = await freshStore()
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.getSnapshot().sessionUserId = 'u-1'
    store._setAdminForTest(false)
    await store.resumeSync()
    await flush(); await flush(); await flush()

    const users = store.getSnapshot().users
    expect(users.filter(u => u.kind === 'private')).toHaveLength(1)
    expect(users.find(u => u.id === 'u-2')?.kind).toBe('public')
  })
})
