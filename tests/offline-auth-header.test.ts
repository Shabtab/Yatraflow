import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

describe('replay request identity with the installed Supabase SDK', () => {
  it('keeps its captured Authorization while SDK token acquisition waits through a switch', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let actor = 'fixture-A'
    let authorization: string | null = null
    const client = createClient('https://fixture.invalid', 'fixture-anon', {
      accessToken: async () => { await gate; return actor },
      global: {
        fetch: async (_input, init) => {
          authorization = new Headers(init?.headers).get('authorization')
          return new Response('[]', { headers: { 'content-type': 'application/json' } })
        },
      },
    })
    const request = Promise.resolve(client.from('trips').update({ days: [] })
      .eq('id', 'fixture-trip').eq('write_version', 7).select('id,write_version')
      .setHeader('Authorization', 'Bearer fixture-A'))
    await Promise.resolve()
    actor = 'fixture-B'
    release()
    const result = await request
    expect(result.error).toBeNull()
    expect(authorization).toBe('Bearer fixture-A')
  })
})
