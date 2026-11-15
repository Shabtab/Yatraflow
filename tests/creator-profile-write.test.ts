import { afterEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '../src/lib/supabase'
import { getSnapshot, updateProfile, _installUsersForTest } from '../src/store/store'

afterEach(() => vi.restoreAllMocks())

describe('creator profile write payload', () => {
  it.each([
    { featuredPubId: 'route', planningNotes: ['Start early.'] },
    { featuredPubId: null, planningNotes: [] },
  ])('sends the saved pick and notes to their database columns: %j', async patch => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq }))
    const from = vi.spyOn(supabase, 'from').mockReturnValue({ update } as never)
    getSnapshot().sessionUserId = 'creator'
    _installUsersForTest([{
      id: 'creator', kind: 'private', email: 'creator@example.test', createdAt: 1,
      profile: { name: 'Creator', languages: ['en'], travelStyles: [], isCreator: true, creatorAvailable: true },
    }])

    expect(await updateProfile(patch)).toEqual({ ok: true })
    expect(from).toHaveBeenCalledWith('profiles')
    expect(update).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      featured_pub_id: patch.featuredPubId,
      planning_notes: patch.planningNotes,
    }))
    expect(eq).toHaveBeenCalledWith('id', 'creator')
  })
})
