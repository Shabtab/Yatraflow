// ============ #800 — the public/private profile boundary ============
//
// The database half is proved by the SQL probe; this file proves the CLIENT half
// through the store's real seams: the mappers, the merge rule, the public read
// path, the realtime dispatch and the offline-snapshot scrub. The mock records
// every table read, so a test can assert a public path never touches the private
// table — which is the property the whole change rests on.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { state, toast } = vi.hoisted(() => ({
  state: {
    /** Every `from(...)` read the store attempts, so a test can assert a path
     *  never touches the private table. */
    tableReads: [] as string[],
    /** Every RPC the store calls, with its arguments. */
    rpcCalls: [] as { fn: string; args: unknown }[],
    /** What `get_public_profile_cards` answers. */
    cards: [] as unknown[],
    /** What `is_disabled` answers. */
    disabled: false,
    /** Set to make `get_public_profile_cards` answer with an error instead. */
    rpcError: false,
  },
  toast: vi.fn(),
}))

vi.mock('../src/components/ui', () => ({ toast }))

vi.mock('../src/lib/supabase', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {
      select: (column?: string) => { if (column) b.column = column; return b },
      eq: () => b,
      in: () => b,
      limit: () => b,
      maybeSingle: () => b,
      insert: () => b,
      update: () => b,
      upsert: () => b,
      delete: () => b,
      setHeader: () => b,
      then: (res: (v: { data: unknown; error: unknown }) => unknown) => {
        state.tableReads.push(table)
        return Promise.resolve({ data: [], error: null }).then(res)
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
        getSession: () => Promise.resolve({ data: { session: null } }),
        signOut: () => Promise.resolve({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: {} } }),
      },
      rpc: (fn: string, args: unknown) => {
        state.rpcCalls.push({ fn, args })
        const b: Record<string, unknown> = {
          setHeader: () => b,
          then: (res: (v: { data: unknown; error: unknown }) => unknown) => {
            const failed = state.rpcError && fn === 'get_public_profile_cards'
            const data = failed ? null
              : fn === 'get_public_profile_cards' ? state.cards
                : fn === 'is_disabled' ? state.disabled
                  : null
            return Promise.resolve({ data, error: failed ? { message: 'PGRST202' } : null }).then(res)
          },
        }
        return b
      },
    },
  }
})

const flush = () => new Promise(r => setTimeout(r, 0))

async function freshStore() {
  vi.resetModules()
  return await import('../src/store/store')
}

const OWNER_CARD = { id: 'u-1', name: 'Asha', avatar_url: 'https://cdn/a.png', is_creator: true, creator_bio: 'Kerala', social_links: { youtube: 'https://y/@a', instagram: 'https://i/a' }, creator_available: true }
const OTHER_CARD = { id: 'u-2', name: 'Bilal', avatar_url: null, is_creator: false, creator_bio: null, social_links: null, creator_available: false }

/** A private `public.profiles` row, as the self read (or an admin's bulk read)
 *  returns it. This is the ONLY shape that carries an account field. */
const OWNER_PRIVATE = {
  id: 'u-1', email: 'a@example.invalid', name: 'Asha', avatar_url: 'https://cdn/a.png', home_city: 'Kochi',
  languages: ['en', 'ml'], travel_styles: ['balanced'], is_creator: true, creator_bio: 'Kerala',
  social_links: { youtube: 'https://y/@a', instagram: 'https://i/a' }, is_disabled: false, created_at: 111,
}

beforeEach(() => {
  state.tableReads = []
  state.rpcCalls = []
  state.cards = [OWNER_CARD, OTHER_CARD]
  state.disabled = false
  state.rpcError = false
  toast.mockClear()
})

describe('the mappers', () => {
  it('the public mapper produces exactly the reviewed shape and no account field', async () => {
    const { rowToPublicUser } = await freshStore()
    const user = rowToPublicUser(OWNER_CARD)
    expect(user).toEqual({
      id: 'u-1', kind: 'public',
      profile: { name: 'Asha', avatarUrl: 'https://cdn/a.png', isCreator: true, creatorBio: 'Kerala', socialLinks: { youtube: 'https://y/@a', instagram: 'https://i/a' }, creatorAvailable: true },
    })
    // The old rowToUser manufactured these five from a whole private row. They are
    // absent here because the card it is handed does not have them.
    expect(user).not.toHaveProperty('email')
    expect(user).not.toHaveProperty('createdAt')
    expect(user.profile).not.toHaveProperty('homeCity')
    expect(user.profile).not.toHaveProperty('languages')
    expect(user.profile).not.toHaveProperty('travelStyles')
    expect(user.profile).not.toHaveProperty('isDisabled')
  })

  it('the private mapper is the only one that touches an account field', async () => {
    const { rowToPrivateUser } = await freshStore()
    const user = rowToPrivateUser(OWNER_PRIVATE)
    expect(user.kind).toBe('private')
    expect(user.email).toBe('a@example.invalid')
    expect(user.createdAt).toBe(111)
    expect(user.profile.homeCity).toBe('Kochi')
    expect(user.profile.languages).toEqual(['en', 'ml'])
    expect(user.profile.travelStyles).toEqual(['balanced'])
    expect(user.profile.isDisabled).toBe(false)
    // A disabled account's own row maps to an unavailable creator, which is what
    // the public surfaces filter on.
    const disabled = rowToPrivateUser({ ...OWNER_PRIVATE, is_disabled: true })
    expect(disabled.profile.creatorAvailable).toBe(false)
  })
})

describe('the merge rule', () => {
  it('a public read never erases a private entry, and a private read replaces one', async () => {
    const { mergeUsers, rowToPublicUser, rowToPrivateUser } = await freshStore()
    const pub = rowToPublicUser(OWNER_CARD)
    const priv = rowToPrivateUser(OWNER_PRIVATE)

    // The dangerous direction: a public refresh arriving over a private row.
    const afterPublic = mergeUsers([priv], [pub])
    expect(afterPublic).toHaveLength(1)
    expect(afterPublic[0].kind).toBe('private')

    // The necessary direction: a self-read replacing a stale public card.
    const afterPrivate = mergeUsers([pub], [priv])
    expect(afterPrivate[0].kind).toBe('private')
    expect(afterPrivate[0]).toHaveProperty('email', 'a@example.invalid')

    // Distinct ids coexist.
    expect(mergeUsers([pub], [rowToPublicUser(OTHER_CARD)]).map(u => u.id).sort()).toEqual(['u-1', 'u-2'])

    // The natural hydrate shape carries an id TWICE: the public catalogue holds a
    // card for the signed-in user, and the self read adds their private row beside
    // it. The merge must resolve that to the private row, or `currentUser()` finds
    // a name where an account should be.
    const natural = mergeUsers([pub, rowToPublicUser(OTHER_CARD)], [priv])
    expect(natural).toHaveLength(2)
    expect(natural.find(u => u.id === 'u-1')?.kind).toBe('private')
    expect(natural.find(u => u.id === 'u-2')?.kind).toBe('public')
  })
})

describe('the public read path', () => {
  it('a public refresh reads the RPC and never the private table', async () => {
    const store = await freshStore()
    await store.rereadPublicSlices()
    await flush(); await flush()

    expect(state.rpcCalls.some(c => c.fn === 'get_public_profile_cards')).toBe(true)
    expect(state.tableReads).not.toContain('profiles')
    const users = store.getSnapshot().users
    expect(users).toHaveLength(2)
    expect(users.every(u => u.kind === 'public')).toBe(true)
  })

  it('a public refresh does not erase the signed-in user’s private row', async () => {
    const store = await freshStore()
    const { rowToPublicUser, rowToPrivateUser } = store
    // Seed the cache the way a hydrate does: public cards plus the private self row.
    store.getSnapshot().sessionUserId = 'u-1'
    store.getSnapshot().users = [rowToPrivateUser(OWNER_PRIVATE), ...state.cards.map(rowToPublicUser)]
    await store.rereadPublicSlices()
    await flush(); await flush()

    // The catalogue is refreshed — u-1's card is superseded by the private row for
    // that id, and u-2 stays a public card — so two entries, one of each kind.
    const users = store.getSnapshot().users
    expect(users).toHaveLength(2)
    expect(users.filter(u => u.kind === 'public').map(u => u.id)).toEqual(['u-2'])
    // …and the private row is still there.
    const me = store.currentUser()
    expect(me?.kind).toBe('private')
    expect(me?.email).toBe('a@example.invalid')
    expect(state.tableReads).not.toContain('profiles')
  })

  it('a failed public read reports failed and does not wipe the rows', async () => {
    const store = await freshStore()
    await store.rereadPublicSlices()
    await flush(); await flush()
    const loaded = store.getSnapshot().users

    // The RPC answers an error (a missing function, say). The slice must report
    // failed, and the rows must survive — "still broken" and "now empty as well"
    // are different states, and only one of them is a regression.
    state.rpcError = true
    await store.rereadPublicSlices()
    await flush(); await flush()

    expect(store.getSnapshot().sliceReads.profiles).toBe('failed')
    expect(store.getSnapshot().users).toHaveLength(loaded.length)
  })
})

describe('the realtime dispatch', () => {
  it('a profile_cards event lands through the public mapper and keeps a private entry', async () => {
    const store = await freshStore()
    const { rowToPublicUser, rowToPrivateUser, _applyRealtimeEventForTest } = store
    store.getSnapshot().sessionUserId = 'u-1'
    store.getSnapshot().users = [rowToPrivateUser(OWNER_PRIVATE), rowToPublicUser(OTHER_CARD)]

    _applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', schema: 'public', table: 'profile_cards',
      commit_timestamp: new Date().toISOString(),
      old: { id: 'u-2' },
      new: { id: 'u-2', name: 'Bilal Ahmed', avatar_url: null, is_creator: false, creator_bio: null, social_links: null, creator_available: true },
    } as never)

    const other = store.getSnapshot().users.find(u => u.id === 'u-2')
    expect(other?.kind).toBe('public')
    expect(other?.profile.name).toBe('Bilal Ahmed')
    // The signed-in user's own private row survives the public event stream.
    expect(store.currentUser()?.kind).toBe('private')
    expect(store.currentUser()?.email).toBe('a@example.invalid')
  })
})

describe('the offline snapshot', () => {
  it('an old snapshot carrying private rows is scrubbed on the way in', async () => {
    const { sanitizeSnapshotUsers, publicOnlyUsers, rowToPrivateUser } = await freshStore()
    const scrubbed = sanitizeSnapshotUsers([
      // A whole private row, as every snapshot written before #800 held it.
      { id: 'u-1', email: 'a@example.invalid', createdAt: 111, profile: { name: 'Asha', homeCity: 'Kochi', languages: ['en'], travelStyles: ['balanced'], isCreator: true, isDisabled: false } },
      // A current public card passes through.
      { id: 'u-2', kind: 'public', profile: { name: 'Bilal', isCreator: false, creatorAvailable: true } },
      // Junk is dropped rather than coerced.
      null, 'nope', { id: 'u-3' }, { id: 'u-4', profile: 7 },
    ])
    expect(scrubbed.map(u => u.id)).toEqual(['u-1', 'u-2'])
    for (const u of scrubbed) {
      expect(u.kind).toBe('public')
      expect(u).not.toHaveProperty('email')
      expect(u).not.toHaveProperty('createdAt')
      expect(u.profile).not.toHaveProperty('homeCity')
      expect(u.profile).not.toHaveProperty('languages')
      expect(u.profile).not.toHaveProperty('travelStyles')
      expect(u.profile).not.toHaveProperty('isDisabled')
    }
    // The write side drops private rows before they are ever serialised.
    const mixed = [rowToPrivateUser(OWNER_PRIVATE), { id: 'u-2', kind: 'public', profile: { name: 'Bilal', isCreator: false, creatorAvailable: true } }]
    expect(publicOnlyUsers(mixed as never).map(u => u.id)).toEqual(['u-2'])
  })
})

describe('the disabled-account check', () => {
  it('a missing private row is not read as an enabled account', async () => {
    const store = await freshStore()
    // A disabled account cannot read its own row, so there is no private entry.
    store.getSnapshot().sessionUserId = 'u-1'
    store.getSnapshot().users = store.getSnapshot().users
    expect(store.currentUser()).toBeNull()

    // The server helper answers for the caller, so the friendly message still fires.
    state.disabled = true
    expect(await store.enforceDisabledCheck()).toBe(true)
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('disabled'), 'err')
    expect(state.rpcCalls.some(c => c.fn === 'is_disabled')).toBe(true)
  })

  it('an enabled account with a private row is not signed out', async () => {
    const store = await freshStore()
    const { rowToPrivateUser } = store
    store.getSnapshot().sessionUserId = 'u-1'
    store.getSnapshot().users = [rowToPrivateUser(OWNER_PRIVATE)]

    expect(await store.enforceDisabledCheck()).toBe(false)
    expect(state.rpcCalls.some(c => c.fn === 'is_disabled')).toBe(false)
  })
})
