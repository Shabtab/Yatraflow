/** Add revision-aware trip transport to mutation tests that only inspect payloads.
 * Dedicated replay tests supply their own server, authorization, and failure model.
 */
export function tripWriteClient(client: any, fixture?: () => { trips: any[]; members: any[] }): any {
  const rows = new Map<string, any>()
  const members = new Map<string, any>()
  const from = client.from.bind(client)
  const wrapped = Object.create(client)
  wrapped.auth = {
    ...client.auth,
    getSession: async () => {
      const { getSnapshot } = await import('../../src/store/store')
      const userId = getSnapshot().sessionUserId
      return { data: { session: userId ? { user: { id: userId }, access_token: `fixture-${userId}` } : null }, error: null }
    },
  }
  wrapped.from = (table: string) => {
    let query = from(table)
    let method = 'select'
    let selection = '*'
    let payload: any
    const filters: Record<string, any> = {}
    const builder: any = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') return (resolve: any, reject: any) => {
          const execute = async () => {
            const seed = fixture?.()
            for (const row of seed?.trips ?? []) {
              if (!rows.has(row.id)) rows.set(row.id, { ...row, write_version: row.write_version ?? 0 })
            }
            for (const member of seed?.members ?? []) members.set(`${member.trip_id}:${member.user_id}`, member)
            if (method === 'select' && selection === 'user_id, role, joined_at' && table === 'trip_members') {
              return { data: members.get(`${filters.trip_id}:${filters.user_id}`) ?? null, error: null }
            }
            if (method === 'select' && selection === 'id, owner_id, write_version, deleted_at' && table === 'trips') {
              return { data: rows.get(filters.id) ?? null, error: null }
            }
            const result = await query
            if (result.error) return result
            if (method === 'select' && table === 'trips' && selection === '*' && result.data) {
              const normalize = (row: any) => {
                const next = { ...row, write_version: row.write_version ?? 0 }
                rows.set(row.id, next)
                return next
              }
              return { ...result, data: Array.isArray(result.data) ? result.data.map(normalize) : normalize(result.data) }
            }
            if (method === 'insert' && table === 'trips' && payload?.id) {
              rows.set(payload.id, { ...payload, write_version: 0 })
              return { ...result, data: [{ id: payload.id, write_version: 0 }] }
            }
            if (method === 'insert' && table === 'trip_members') {
              for (const member of Array.isArray(payload) ? payload : [payload]) {
                members.set(`${member.trip_id}:${member.user_id}`, member)
              }
            }
            if (method === 'update' && table === 'trips') {
              if (result.count === 0) return { ...result, data: [] }
              const previous = rows.get(filters.id)
              if (!previous || previous.write_version !== filters.write_version) return { data: [], error: null, count: 0 }
              const next = { ...previous, ...payload, write_version: previous.write_version + 1 }
              rows.set(filters.id, next)
              return { ...result, data: [{ id: filters.id, write_version: next.write_version, updated_at: Date.now() }], count: 1 }
            }
            return result
          }
          return execute().then(resolve, reject)
        }
        return (...args: any[]) => {
          if (property === 'select') selection = args[0] ?? '*'
          if (['insert', 'update', 'delete', 'upsert'].includes(String(property))) {
            method = String(property)
            payload = args[0]
          }
          if (property === 'eq') filters[args[0]] = args[1]
          if (property !== 'setHeader' && typeof query[property] === 'function') query = query[property](...args)
          return builder
        }
      },
    })
    return builder
  }
  return wrapped
}
