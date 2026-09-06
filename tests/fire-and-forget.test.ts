import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue #52: `postgrest-js` builders are lazy — the request is issued from `then()`,
 * so `void supabase.from(…).update(…)` builds a request and throws it away without
 * ever sending it. 17 of the store's optimistic writes were in that shape: they
 * updated the cache, looked like they worked, and never touched the database.
 *
 * This file's mock is deliberately strict — a write is recorded ONLY when something
 * thenes the builder, exactly like the real client. Every mutation below therefore
 * has to actually issue a request, or its test fails. That is the property the old
 * store-persistence mock could not express, because it recorded at update() time.
 */

const sent: Array<{ table: string; method: string }> = []

vi.mock('../src/lib/supabase', () => {
  const lazy = (table: string, method: string) => {
    const qb: any = { table, method }
    const chain = () => qb
    qb.select = chain; qb.eq = chain; qb.in = chain; qb.order = chain
    qb.limit = chain; qb.lt = chain; qb.gt = chain
    qb.maybeSingle = () => qb; qb.single = () => qb; qb.throwOnError = chain
    qb.then = (f: any, r?: any) =>
      new Promise(resolve => { sent.push({ table, method }); resolve({ data: null, error: null }) }).then(f, r)
    return qb
  }
  const supabase: any = {
    from: (table: string) => ({
      select: () => {
        const qb = lazy(table, 'select')
        qb.maybeSingle = async () => ({ data: null, error: null })
        return qb
      },
      insert: () => lazy(table, 'insert'),
      update: () => lazy(table, 'update'),
      upsert: () => lazy(table, 'upsert'),
      delete: () => lazy(table, 'delete'),
    }),
    rpc: (fn: string, params?: any) => {
      // Extract table from function name pattern: bump_published_stats -> published_itineraries
      const table = fn === 'bump_published_stats' ? 'published_itineraries' : fn
      const method = 'rpc'
      const qb: any = { table, method, fn }
      qb.then = (f: any, r?: any) =>
        new Promise(resolve => { sent.push({ table, method }); resolve({ data: null, error: null }) }).then(f, r)
      return qb
    },
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    channel: () => ({ on: () => ({}), subscribe: () => ({}) }),
    removeChannel: () => {},
    realtime: { removeChannel: () => {} },
  }
  return { supabase, isSupabaseConfigured: () => true, SUPABASE_MISSING: '' }
})
vi.mock('../src/components/ui', () => ({ toast: () => {} }))

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const sentTo = (table: string, method: string) => sent.filter(s => s.table === table && s.method === method)

async function freshStore() {
  vi.resetModules()
  sent.length = 0
  const store = await import('../src/store/store')
  const db = store.getSnapshot() as any
  db.sessionUserId = 'amelia'
  db.trips.push({
    id: 'trip-1', title: 'Lisbon', destination: 'Lisbon, Portugal',
    startDate: '2026-09-01', endDate: '2026-09-03', attendees: 2, ownerId: 'amelia',
    members: [
      { userId: 'amelia', role: 'owner', joinedAt: 1 },
      { userId: 'priya', role: 'editor', joinedAt: 2 },
    ],
    days: [
      { index: 0, date: '2026-09-01', label: 'Day 1', stops: [{ id: 'stop-1', title: 'Alfama', dayIndex: 0, orderInDay: 1 }] },
      { index: 1, date: '2026-09-02', label: 'Day 2', stops: [] },
    ],
    expenses: [], collaborators: [],
  } as any)
  db.suggestions.push({
    id: 'sug-1', tripId: 'trip-1', title: 'Time Out Market', dayIndex: 0, proposedBy: 'priya',
    category: 'food', locationName: 'Rua Augusta', lat: 38.7, lng: -9.1, description: '',
    visitMinutes: 60, estimatedEntryFeeInr: 0, estimatedTransportInr: 0, votes: [], comments: [],
  } as any)
  db.decisions.push({
    id: 'dec-1', tripId: 'trip-1', question: 'Where to eat?', context: '', status: 'open',
    options: [{ id: 'opt-1', label: 'Time Out' }], votesByUserId: {},
  } as any)
  db.published.push({
    // creator ≠ session user: registerPubView skips the creator's own visits,
    // so seeding amelia here would mute the rpc the case asserts on.
    id: 'pub-1', tripId: 'trip-1', creatorId: 'priya', slug: 'lisbon-3-days', views: 0, copies: 0,
  } as any)
  return store
}

beforeEach(() => {
  sent.length = 0
})

describe('#52 — every optimistic write must actually reach the client', () => {
  const cases: Array<{ name: string; table: string; method: 'insert' | 'update' | 'delete'; run: (s: any) => void }> = [
    { name: 'restoreMember', table: 'trip_members', method: 'insert', run: s => s.restoreMember('trip-1', { userId: 'diego', role: 'editor', joinedAt: 3 }) },
    { name: 'setMemberRole', table: 'trip_members', method: 'update', run: s => s.setMemberRole('trip-1', 'priya', 'viewer') },
    { name: 'joinViaInvite', table: 'trip_members', method: 'insert', run: s => s.joinViaInvite('trip-1', 'newcomer', 'editor') },
    { name: 'removeMember', table: 'trip_members', method: 'delete', run: s => s.removeMember('trip-1', 'priya') },
    {
      name: 'addSuggestion',
      table: 'suggestions',
      method: 'insert',
      run: s => s.addSuggestion('trip-1', {
        title: 'LX Factory', dayIndex: 0, proposedBy: 'amelia', category: 'food', locationName: 'Rua',
        lat: 38.7, lng: -9.1, description: '', visitMinutes: 45, estimatedEntryFeeInr: 0, estimatedTransportInr: 0,
      }),
    },
    { name: 'voteSuggestion', table: 'suggestions', method: 'update', run: s => s.voteSuggestion('trip-1', 'sug-1', 'amelia', 1) },
    { name: 'addCommentToSuggestion', table: 'suggestions', method: 'update', run: s => s.addCommentToSuggestion('trip-1', 'sug-1', 'amelia', 'great idea') },
    { name: 'acceptSuggestionIntoTimeline', table: 'suggestions', method: 'update', run: s => s.acceptSuggestionIntoTimeline('trip-1', 'sug-1') },
    { name: 'declineSuggestion', table: 'suggestions', method: 'update', run: s => s.declineSuggestion('trip-1', 'sug-1') },
    { name: 'addDecision', table: 'decisions', method: 'insert', run: s => s.addDecision('trip-1', { question: 'Beach or museum?', context: '', options: [{ id: 'o1', label: 'Beach' }] }) },
    { name: 'voteOnDecision', table: 'decisions', method: 'update', run: s => s.voteOnDecision('dec-1', 'opt-1') },
    { name: 'resolveDecision', table: 'decisions', method: 'update', run: s => s.resolveDecision('dec-1', 'opt-1') },
    { name: 'addActivity', table: 'activity', method: 'insert', run: s => s.addActivity('trip-1', 'amelia', 'checked in') },
    { name: 'pushNotification', table: 'notifications', method: 'insert', run: s => s.pushNotification('priya', 'trip-1', 'Amelia liked Time Out Market') },
    { name: 'markAllNotificationsRead', table: 'notifications', method: 'update', run: s => s.markAllNotificationsRead('amelia') },
    { name: 'registerPubView', table: 'published_itineraries', method: 'rpc', run: s => s.registerPubView('pub-1') },
    { name: 'registerPubCopy', table: 'published_itineraries', method: 'rpc', run: s => s.registerPubCopy('pub-1') },
  ]

  it('covers all 17 sites the fix converted', () => {
    expect(cases).toHaveLength(17)
  })

  for (const c of cases) {
    it(`${c.name} sends its ${c.method} to ${c.table}`, async () => {
      const store = await freshStore()
      c.run(store)
      await flush()
      expect(sentTo(c.table, c.method).length, `${c.name} issued no request at all`).toBeGreaterThan(0)
    })
  }
})
