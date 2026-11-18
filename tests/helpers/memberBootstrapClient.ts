/** Simulate the bootstrap RPC against a test's existing storage adapter.
 * SQL authorization is tested against PostgreSQL, not this fixture.
 */
export function memberBootstrapClient(client: any): any {
  const wrapped = Object.create(client)
  let storeRead: Promise<typeof import('../../src/store/store')> | undefined
  wrapped.rpc = (name: string, args: any) => {
    if (name !== 'change_trip_access' || args?.p_action !== 'bootstrap') return client.rpc(name, args)
    const response: any = {
      setHeader: () => response,
      then: (resolve: any, reject: any) => (async () => {
        const { getSnapshot } = await (storeRead ??= import('../../src/store/store'))
        const trip = getSnapshot().trips.find(t => t.id === args.p_trip_id)
        const owner = trip?.members?.find(m => m.role === 'owner')
        if (!trip || !owner) return { data: null, error: { message: 'Trip has no owner.' } }
        const row = { trip_id: trip.id, user_id: owner.userId, role: 'owner', joined_at: owner.joinedAt }
        const result = await client.from('trip_members').insert([row])
        if (result.error) {
          if (result.error.code !== '23505') return result
          const existing = await client.from('trip_members').select('user_id, role, joined_at')
            .eq('trip_id', trip.id).eq('user_id', owner.userId).maybeSingle()
          if (existing.error || existing.data?.role !== 'owner') return result
        }
        return { data: { status: 'applied', state: {
          version: 1, inviteCode: trip.inviteCode ?? null,
          members: [{ ...owner, revision: 1 }], removed: [],
        } }, error: null }
      })().then(resolve, reject),
    }
    return response
  }
  return wrapped
}
