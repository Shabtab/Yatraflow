// ============ Creator post links (G8) ============
// A creator links a public post (Instagram, YouTube or Threads) to one of their
// own live routes. Links only: nothing here fetches a post, a thumbnail or a
// view count, and no call leaves for a third party. The validation below mirrors
// supabase/migrations/20261117_creator_post_links.sql. The SQL is the backstop;
// this file refuses the same inputs first, so the creator sees a plain reason.
import { supabase } from './supabase'
import { livePubs } from './livePubs'
import type { PublishedItinerary } from '../data/types'
import type { Database } from '../types/database.generated'

export const POST_KINDS = ['instagram', 'youtube', 'threads'] as const
export type PostKind = typeof POST_KINDS[number]
export const POST_LIMIT = 12
export const POST_URL_MAX = 300
export const POST_CAPTION_MAX = 140
export const POST_TIMEOUT_MS = 10_000

// Same pattern as creator_posts_url_check. The path class is printable ASCII, so
// a space, a control character or a non-ASCII character fails. After the host
// the next character must be "/" or the end of the string.
export const POST_URL_RE = /^https:\/\/(instagram\.com|www\.instagram\.com|youtube\.com|www\.youtube\.com|m\.youtube\.com|youtu\.be|threads\.net|www\.threads\.net)(\/[!-~]*)?$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PUB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
// The blank test trims ASCII whitespace only, like creatorFacts.validPlanningNotes.
const NOT_BLANK_RE = /[^\t\n\v\f\r ]/u
const ASCII_EDGE_RE = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g

export interface CreatorPost {
  id: string
  creator: string
  url: string
  kind: PostKind
  pubId: string
  dayIndex: number | null
  caption: string | null
  createdAt: number
}
export interface CreatorPostVisit { postId: string; visits: number }

export type PostsRead =
  | { kind: 'reading'; previous?: CreatorPost[] }
  | { kind: 'failed' }
  | { kind: 'ready'; value: CreatorPost[] }
export type PostVisitsRead =
  | { kind: 'reading' }
  | { kind: 'failed' }
  | { kind: 'ready'; value: CreatorPostVisit[] }

export function isPostId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** Trim the edges and lower-case the host, nothing else. The path keeps its case. */
export function normalisePostUrl(raw: string): string {
  const url = raw.replace(ASCII_EDGE_RE, '')
  const match = /^(https:\/\/)([^/]*)(.*)$/i.exec(url)
  return match ? `https://${match[2].toLowerCase()}${match[3]}` : url
}

export function validPostUrl(url: unknown): url is string {
  return typeof url === 'string' && [...url].length <= POST_URL_MAX && POST_URL_RE.test(url)
}

/** The platform, from the host. A host that is not on the allowlist gives null. */
export function postKindForUrl(url: string): PostKind | null {
  if (!validPostUrl(url)) return null
  const host = url.slice('https://'.length).split('/')[0]
  if (host.endsWith('instagram.com')) return 'instagram'
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube'
  if (host.endsWith('threads.net')) return 'threads'
  return null
}

export function validPostCaption(value: unknown): value is string {
  return typeof value === 'string' && NOT_BLANK_RE.test(value) && [...value].length <= POST_CAPTION_MAX
}

export const POST_KIND_LABEL: Record<PostKind, string> = { instagram: 'Instagram', youtube: 'YouTube', threads: 'Threads' }

export interface PostDraft { url: string; pubId: string; dayIndex: number | null; caption: string }
export type PostInsert = Database['public']['Tables']['creator_posts']['Insert']
export type PostCheck = { ok: true; value: PostInsert } | { ok: false; error: string }

/** Refuse what the SQL refuses, with a reason a creator can act on. */
export function checkPostDraft(
  draft: PostDraft, creatorId: string, pubs: PublishedItinerary[], existing: readonly CreatorPost[],
): PostCheck {
  const url = normalisePostUrl(draft.url)
  if (!url) return { ok: false, error: 'Paste the link to your post.' }
  const kind = postKindForUrl(url)
  if (!kind) return { ok: false, error: 'Use an https link from Instagram, YouTube or Threads, up to 300 characters.' }
  if (existing.length >= POST_LIMIT) return { ok: false, error: `You can keep up to ${POST_LIMIT} post links. Remove one first.` }
  if (existing.some(post => post.url === url)) return { ok: false, error: 'That link is already on your list.' }
  const pub = livePubs(pubs).find(item => item.id === draft.pubId && item.creatorId === creatorId)
  if (!pub) return { ok: false, error: 'Choose one of your live routes.' }
  const day = draft.dayIndex
  if (day !== null && (!Number.isInteger(day) || day < 0 || day >= pub.durationDays)) {
    return { ok: false, error: 'Choose a day inside the route, or the whole route.' }
  }
  const caption = draft.caption.replace(ASCII_EDGE_RE, '')
  if (caption && !validPostCaption(caption)) {
    return { ok: false, error: `Use a caption of up to ${POST_CAPTION_MAX} characters, or leave it empty.` }
  }
  return {
    ok: true,
    value: { creator: creatorId, url, kind, pub_id: pub.id, day_index: day, caption: caption || null },
  }
}

export function checkPostCaption(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const caption = raw.replace(ASCII_EDGE_RE, '')
  if (!caption) return { ok: true, value: null }
  return validPostCaption(caption)
    ? { ok: true, value: caption }
    : { ok: false, error: `Use a caption of up to ${POST_CAPTION_MAX} characters, or leave it empty.` }
}

// ---- Fail-closed row parsing ----
// One bad row fails the whole read. A section built from a partly wrong list
// would claim a creator posted something they did not.
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid post row')
  return Object.fromEntries(Object.entries(value))
}

function postRow(raw: unknown, creator: string): CreatorPost {
  const row = object(raw)
  const { id, url, kind, pub_id: pubId, day_index: dayIndex, caption, created_at: createdAt } = row
  if (!isPostId(id)) throw new Error('Invalid post id')
  if (row.creator !== creator) throw new Error('Invalid post creator')
  if (!validPostUrl(url)) throw new Error('Invalid post address')
  const derived = postKindForUrl(url)
  if (derived === null || kind !== derived) throw new Error('Invalid post platform')
  if (typeof pubId !== 'string' || !PUB_ID_RE.test(pubId)) throw new Error('Invalid post route')
  if (dayIndex !== null && (typeof dayIndex !== 'number' || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 10_000)) {
    throw new Error('Invalid post day')
  }
  if (caption !== null && !validPostCaption(caption)) throw new Error('Invalid post caption')
  const at = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN
  if (!Number.isFinite(at)) throw new Error('Invalid post date')
  return { id, creator, url, kind: derived, pubId, dayIndex, caption, createdAt: at }
}

export function parseCreatorPosts(data: unknown, error: unknown, creator: string): CreatorPost[] {
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Invalid post rows')
  if (data.length > POST_LIMIT) throw new Error('Too many post rows')
  const posts = data.map(row => postRow(row, creator))
  if (new Set(posts.map(post => post.id)).size !== posts.length) throw new Error('Duplicate post rows')
  return posts
}

function visitCount(value: unknown): number {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) throw new Error('Invalid visit count')
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid visit count')
  return count
}

export function parsePostVisits(data: unknown, error: unknown): CreatorPostVisit[] {
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Invalid post visit rows')
  const rows = data.map(raw => {
    const row = object(raw)
    if (!isPostId(row.post_id)) throw new Error('Invalid post visit id')
    return { postId: row.post_id, visits: visitCount(row.visits) }
  })
  if (new Set(rows.map(row => row.postId)).size !== rows.length) throw new Error('Duplicate post visit rows')
  return rows
}

// ---- Reads and writes, each with a 10 second limit ----
const COLUMNS = 'id, creator, url, kind, pub_id, day_index, caption, created_at'

function timed(signal?: AbortSignal): AbortSignal {
  const limit = AbortSignal.timeout(POST_TIMEOUT_MS)
  return signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, limit]) : limit
}

export async function fetchCreatorPosts(creator: string, signal?: AbortSignal): Promise<CreatorPost[]> {
  const { data, error } = await supabase.from('creator_posts').select(COLUMNS)
    .eq('creator', creator).order('created_at', { ascending: false }).abortSignal(timed(signal))
  return parseCreatorPosts(data, error, creator)
}

export async function addCreatorPost(insert: PostInsert, signal?: AbortSignal): Promise<CreatorPost> {
  const { data, error } = await supabase.from('creator_posts')
    .insert(insert satisfies Database['public']['Tables']['creator_posts']['Insert'])
    .select(COLUMNS).abortSignal(timed(signal)).single()
  if (error?.code === '23505') throw new Error('That link is already on your list.')
  if (error) throw error
  return postRow(data, insert.creator)
}

export async function setCreatorPostCaption(id: string, creator: string, caption: string | null, signal?: AbortSignal): Promise<CreatorPost> {
  const { data, error } = await supabase.from('creator_posts')
    .update({ caption } satisfies Database['public']['Tables']['creator_posts']['Update'])
    .eq('id', id).eq('creator', creator).select(COLUMNS).abortSignal(timed(signal))
  if (error) throw error
  // A row-level denial updates zero rows without an error. Name that case.
  if (!Array.isArray(data) || data.length !== 1) throw new Error('The caption was not saved.')
  return postRow(data[0], creator)
}

export async function removeCreatorPost(id: string, creator: string, signal?: AbortSignal): Promise<void> {
  const { error } = await supabase.from('creator_posts').delete()
    .eq('id', id).eq('creator', creator).abortSignal(timed(signal))
  if (error) throw error
}

export async function fetchCreatorPostVisits(days: number, signal?: AbortSignal): Promise<CreatorPostVisit[]> {
  const { data, error } = await supabase.rpc('get_creator_post_visits', { p_days: days }).abortSignal(timed(signal))
  return parsePostVisits(data, error)
}

export const creatorPostsApi = {
  list: fetchCreatorPosts,
  add: addCreatorPost,
  setCaption: setCreatorPostCaption,
  remove: removeCreatorPost,
  visits: fetchCreatorPostVisits,
}
export type CreatorPostsApi = typeof creatorPostsApi

// ---- The tagged link and its landing ----
/** The post a visit names: `?src=post&p=<post id>`. Anything else is null. */
export function creatorPostRef(search: string): string | null {
  const params = new URLSearchParams(search.split('#')[0])
  const post = params.get('p')
  return params.get('src') === 'post' && isPostId(post) ? post : null
}

/** The day label for a card: "Day 3", or nothing when the day no longer fits the route. */
export function postDayLabel(post: CreatorPost, durationDays: number): string | null {
  return post.dayIndex !== null && post.dayIndex < durationDays ? `Day ${post.dayIndex + 1}` : null
}

/** The posts a visitor may see: a post whose route is not on the live list stays hidden. */
export function visiblePosts(posts: readonly CreatorPost[], pubs: PublishedItinerary[]): Array<{ post: CreatorPost; pub: PublishedItinerary }> {
  const live = new Map(livePubs(pubs).map(pub => [pub.id, pub]))
  return posts.flatMap(post => {
    const pub = live.get(post.pubId)
    return pub && pub.creatorId === post.creator ? [{ post, pub }] : []
  })
}
