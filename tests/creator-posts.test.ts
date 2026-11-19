import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ data: null as unknown, error: null as unknown, calls: [] as Array<[string, unknown]> }))
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      state.calls.push(['from', table])
      const query = {
        select: (columns: string) => { state.calls.push(['select', columns]); return query },
        insert: (row: unknown) => { state.calls.push(['insert', row]); return query },
        update: (row: unknown) => { state.calls.push(['update', row]); return query },
        delete: () => { state.calls.push(['delete', null]); return query },
        eq: (key: string, value: unknown) => { state.calls.push([key, value]); return query },
        order: () => query,
        single: () => query,
        abortSignal: () => query,
        then: (resolve: (result: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data: state.data, error: state.error }).then(resolve),
      }
      return query
    },
    rpc: (name: string, args: unknown) => {
      state.calls.push([name, args])
      return { abortSignal: async () => ({ data: state.data, error: state.error }) }
    },
  },
}))

import {
  POST_LIMIT, addCreatorPost, checkPostCaption, checkPostDraft, creatorPostRef, fetchCreatorPostVisits, fetchCreatorPosts,
  isPostId, normalisePostUrl, parseCreatorPosts, parsePostVisits, postDayLabel, postKindForUrl,
  removeCreatorPost, setCreatorPostCaption, validPostCaption, validPostUrl, visiblePosts, type CreatorPost,
} from '../src/lib/creatorPosts'
import { creatorPostShareUrl } from '../src/lib/shareUrl'
import type { PublishedItinerary } from '../src/data/types'

const ID = '17110000-0000-4000-8000-0000000000a1'
const ID2 = '17110000-0000-4000-8000-0000000000a2'
const route: PublishedItinerary = {
  id: 'live', creatorId: 'creator', tripId: 'trip', title: 'Kerala', tagline: '', routeSummary: [],
  durationDays: 3, estimatedBudgetPerPersonInr: 0, travelStyle: 'balanced', travelTips: [],
  warningsAndAssumptions: [], freeDayIndexes: [0], publishedAt: 1, views: 0, copies: 0,
}
const down: PublishedItinerary = { ...route, id: 'down', unpublishedAt: 5 }
const other: PublishedItinerary = { ...route, id: 'other', creatorId: 'someone-else' }
const pubs = [route, down, other]
const row = (over: Record<string, unknown> = {}) => ({
  id: ID, creator: 'creator', url: 'https://youtu.be/abc', kind: 'youtube', pub_id: 'live', day_index: null,
  caption: null, created_at: '2026-11-16T10:00:00Z', ...over,
})
const post = (over: Partial<CreatorPost> = {}): CreatorPost => ({
  id: ID, creator: 'creator', url: 'https://youtu.be/abc', kind: 'youtube', pubId: 'live', dayIndex: null,
  caption: null, createdAt: 1, ...over,
})

beforeEach(() => { state.data = null; state.error = null; state.calls = [] })

describe('post link address rules', () => {
  it.each([
    'https://instagram.com/reel/abc', 'https://www.instagram.com/p/abc/', 'https://youtube.com/watch?v=1',
    'https://www.youtube.com/shorts/x', 'https://m.youtube.com/watch?v=1', 'https://youtu.be/abc',
    'https://threads.net/@a/post/b', 'https://www.threads.net/@a', 'https://youtu.be',
  ])('accepts %s', url => { expect(validPostUrl(url)).toBe(true) })
  it.each([
    'http://youtu.be/abc', 'https://instagram.com.evil.com/p/a', 'https://instagram.com@evil.com/p', 'https://youtu.be:443/a',
    'https://evil.com/instagram.com', 'https://youtube.com#frag', 'https://vimeo.com/1', 'https://youtu.be/a b',
    'https://youtu.be/é', 'https://YouTu.be/abc', 'ftp://youtu.be/a', '', 'https://youtu.be/\n',
    `https://youtu.be/${'a'.repeat(300)}`,
  ])('rejects %j', url => { expect(validPostUrl(url)).toBe(false) })
  it('allows exactly 300 characters', () => {
    const base = 'https://youtu.be/'
    expect(validPostUrl(base + 'a'.repeat(300 - base.length))).toBe(true)
    expect(validPostUrl(base + 'a'.repeat(301 - base.length))).toBe(false)
  })
  it('derives the platform from the host', () => {
    expect(postKindForUrl('https://www.instagram.com/p/a')).toBe('instagram')
    expect(postKindForUrl('https://m.youtube.com/watch?v=1')).toBe('youtube')
    expect(postKindForUrl('https://youtu.be/a')).toBe('youtube')
    expect(postKindForUrl('https://www.threads.net/@a')).toBe('threads')
    expect(postKindForUrl('https://example.com/')).toBeNull()
  })
  it('trims the edges and lower-cases only the host', () => {
    expect(normalisePostUrl('  https://YouTu.be/AbC  ')).toBe('https://youtu.be/AbC')
    expect(validPostUrl(normalisePostUrl('https://WWW.Instagram.com/Reel/X'))).toBe(true)
    expect(normalisePostUrl('http://youtu.be/a')).toBe('http://youtu.be/a')
  })
})

describe('post caption rules', () => {
  it('counts 140 code points and rejects ASCII-blank captions', () => {
    expect(validPostCaption('a'.repeat(140))).toBe(true)
    expect(validPostCaption('a'.repeat(141))).toBe(false)
    expect(validPostCaption('😀'.repeat(140))).toBe(true)
    expect(validPostCaption('😀'.repeat(141))).toBe(false)
    for (const blank of ['', '   ', ' \t\n\v\f\r ']) expect(validPostCaption(blank)).toBe(false)
    expect(validPostCaption(' ')).toBe(true)
  })
  it('treats an empty caption as none', () => {
    expect(checkPostCaption('   ')).toEqual({ ok: true, value: null })
    expect(checkPostCaption('  Day one  ')).toEqual({ ok: true, value: 'Day one' })
    expect(checkPostCaption('a'.repeat(141)).ok).toBe(false)
  })
})

describe('post draft checks', () => {
  const draft = { url: 'https://youtu.be/abc', pubId: 'live', dayIndex: null as number | null, caption: '' }
  it('builds the insert the SQL accepts', () => {
    expect(checkPostDraft({ ...draft, dayIndex: 2, caption: ' Day three ' }, 'creator', pubs, [])).toEqual({
      ok: true,
      value: { creator: 'creator', url: 'https://youtu.be/abc', kind: 'youtube', pub_id: 'live', day_index: 2, caption: 'Day three' },
    })
  })
  it.each([
    ['an empty link', { url: '' }],
    ['an address off the allowlist', { url: 'https://vimeo.com/1' }],
    ['an unpublished route', { pubId: 'down' }],
    ['another creator\'s route', { pubId: 'other' }],
    ['a route that does not exist', { pubId: 'gone' }],
    ['a day past the route', { dayIndex: 3 }],
    ['a negative day', { dayIndex: -1 }],
    ['a fractional day', { dayIndex: 1.5 }],
    ['a long caption', { caption: 'a'.repeat(141) }],
  ])('refuses %s', (_name, over) => {
    expect(checkPostDraft({ ...draft, ...over }, 'creator', pubs, []).ok).toBe(false)
  })
  it('refuses a duplicate address and a thirteenth post', () => {
    expect(checkPostDraft(draft, 'creator', pubs, [post()]).ok).toBe(false)
    const full = Array.from({ length: POST_LIMIT }, (_, index) => post({ id: `id-${index}`, url: `https://youtu.be/${index}` }))
    expect(checkPostDraft({ ...draft, url: 'https://youtu.be/new' }, 'creator', pubs, full).ok).toBe(false)
    expect(checkPostDraft({ ...draft, url: 'https://youtu.be/new' }, 'creator', pubs, full.slice(1)).ok).toBe(true)
  })
})

describe('post row parsing fails closed', () => {
  it('maps a good row and an empty list', () => {
    expect(parseCreatorPosts([], null, 'creator')).toEqual([])
    expect(parseCreatorPosts([row({ day_index: 1, caption: 'Hi' })], null, 'creator')).toEqual([
      { id: ID, creator: 'creator', url: 'https://youtu.be/abc', kind: 'youtube', pubId: 'live', dayIndex: 1, caption: 'Hi', createdAt: Date.parse('2026-11-16T10:00:00Z') },
    ])
  })
  it.each([
    ['an error', null, { code: 'PGRST301' }],
    ['no array', null, null],
    ['a null row', [null], null],
    ['a bad id', [row({ id: 'nope' })], null],
    ['another creator', [row({ creator: 'x' })], null],
    ['a bad host', [row({ url: 'https://evil.com/a' })], null],
    ['a kind that does not match the host', [row({ kind: 'instagram' })], null],
    ['an unknown kind', [row({ kind: 'tiktok' })], null],
    ['a bad route id', [row({ pub_id: '../x' })], null],
    ['a negative day', [row({ day_index: -1 })], null],
    ['a fractional day', [row({ day_index: 0.5 })], null],
    ['a blank caption', [row({ caption: '  ' })], null],
    ['a bad date', [row({ created_at: 'soon' })], null],
    ['duplicate ids', [row(), row({ url: 'https://youtu.be/other' })], null],
    ['too many rows', Array.from({ length: POST_LIMIT + 1 }, (_, index) => row({ id: `17110000-0000-4000-8000-${String(index).padStart(12, '0')}`, url: `https://youtu.be/${index}` })), null],
  ])('rejects %s', (_name, data, error) => {
    expect(() => parseCreatorPosts(data, error, 'creator')).toThrow()
  })
  it('parses visit rows and rejects bad ones', () => {
    expect(parsePostVisits([{ post_id: ID, visits: '7' }, { post_id: ID2, visits: 2 }], null)).toEqual([{ postId: ID, visits: 7 }, { postId: ID2, visits: 2 }])
    for (const bad of [null, [{ post_id: 'x', visits: 1 }], [{ post_id: ID, visits: -1 }], [{ post_id: ID, visits: 1 }, { post_id: ID, visits: 2 }]]) {
      expect(() => parsePostVisits(bad, null)).toThrow()
    }
    expect(() => parsePostVisits([], { message: 'failed' })).toThrow()
  })
})

describe('reads and writes', () => {
  it('reads only this creator\'s columns', async () => {
    state.data = [row()]
    await expect(fetchCreatorPosts('creator')).resolves.toHaveLength(1)
    expect(state.calls).toContainEqual(['from', 'creator_posts'])
    expect(state.calls).toContainEqual(['select', 'id, creator, url, kind, pub_id, day_index, caption, created_at'])
    expect(state.calls).toContainEqual(['creator', 'creator'])
  })
  it('rethrows a failed read rather than returning an empty list', async () => {
    state.error = { code: '42501' }
    await expect(fetchCreatorPosts('creator')).rejects.toEqual({ code: '42501' })
  })
  it('inserts exactly the six granted columns and checks the returned row', async () => {
    state.data = row({ day_index: 2, caption: 'Hi' })
    const insert = { creator: 'creator', url: 'https://youtu.be/abc', kind: 'youtube', pub_id: 'live', day_index: 2, caption: 'Hi' }
    await expect(addCreatorPost(insert)).resolves.toMatchObject({ id: ID, dayIndex: 2 })
    expect(state.calls).toContainEqual(['insert', insert])
  })
  it('names a duplicate link, and rethrows other write errors', async () => {
    state.error = { code: '23505' }
    await expect(addCreatorPost({ creator: 'creator', url: 'https://youtu.be/abc', kind: 'youtube', pub_id: 'live' })).rejects.toThrow('already on your list')
    state.error = { code: '23514' }
    await expect(addCreatorPost({ creator: 'creator', url: 'https://youtu.be/abc', kind: 'youtube', pub_id: 'live' })).rejects.toEqual({ code: '23514' })
  })
  it('updates only the caption, and fails when no row changed', async () => {
    state.data = [row({ caption: 'New' })]
    await expect(setCreatorPostCaption(ID, 'creator', 'New')).resolves.toMatchObject({ caption: 'New' })
    expect(state.calls).toContainEqual(['update', { caption: 'New' }])
    state.data = []
    await expect(setCreatorPostCaption(ID, 'creator', 'New')).rejects.toThrow('not saved')
  })
  it('deletes by id and creator and rethrows failures', async () => {
    await removeCreatorPost(ID, 'creator')
    expect(state.calls).toContainEqual(['delete', null])
    expect(state.calls).toContainEqual(['id', ID])
    state.error = { code: '42501' }
    await expect(removeCreatorPost(ID, 'creator')).rejects.toEqual({ code: '42501' })
  })
  it('reads visits through the owner RPC with the window', async () => {
    state.data = [{ post_id: ID, visits: '3' }]
    await expect(fetchCreatorPostVisits(30)).resolves.toEqual([{ postId: ID, visits: 3 }])
    expect(state.calls).toContainEqual(['get_creator_post_visits', { p_days: 30 }])
  })
})

describe('tagged link and landing', () => {
  it('mints the creator page address with the post tag', () => {
    // The creator card, so a crawler reads the creator's own card (api/c.js).
    expect(creatorPostShareUrl('creator-1', ID, 'https://app.example.test/', false))
      .toBe(`https://app.example.test/c/creator-1?src=post&p=${ID}`)
    expect(creatorPostShareUrl('creator-1', ID, 'http://localhost:5173', true))
      .toBe(`https://www.yatraflow.in/c/creator-1?src=post&p=${ID}`)
  })
  it('reads the post only from a post-tagged address', () => {
    expect(creatorPostRef(`?src=post&p=${ID}`)).toBe(ID)
    expect(creatorPostRef(`?p=${ID}&src=post#x`)).toBe(ID)
    expect(creatorPostRef(`?src=ig&p=${ID}`)).toBeNull()
    expect(creatorPostRef('?src=post&p=not-a-uuid')).toBeNull()
    expect(creatorPostRef('?src=post')).toBeNull()
    expect(creatorPostRef('')).toBeNull()
    expect(isPostId(ID)).toBe(true)
    expect(isPostId(`${ID} `)).toBe(false)
  })
})

describe('what a visitor sees', () => {
  it('keeps only posts whose route is live and the creator\'s own', () => {
    const shown = visiblePosts([post(), post({ id: ID2, pubId: 'down' }), post({ id: 'c', pubId: 'other' }), post({ id: 'd', pubId: 'gone' })], pubs)
    expect(shown.map(item => item.post.id)).toEqual([ID])
    expect(shown[0].pub.title).toBe('Kerala')
  })
  it('hides a day label that no longer fits the route', () => {
    expect(postDayLabel(post({ dayIndex: 2 }), 3)).toBe('Day 3')
    expect(postDayLabel(post({ dayIndex: 3 }), 3)).toBeNull()
    expect(postDayLabel(post({ dayIndex: null }), 3)).toBeNull()
  })
})
