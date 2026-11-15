import { supabase } from './supabase'
import { SHARE_SOURCES } from './shareUrl'
import { activityCsv, activityFeed } from './creatorHub'
import type { SaleRow } from './earnings'
import type { FunnelDailyRow } from './unlock'

export const CREATOR_PAGE_SOURCES = [...SHARE_SOURCES, 'ig', 'yt', 'threads', 'post'] as const
export type CreatorPageSource = typeof CREATOR_PAGE_SOURCES[number]
export interface CreatorShareSource { source: string; views: number; forks: number }
export interface CreatorPageView { day: string; source: string; visits: number }
export type OwnerRead<T> =
  | { kind: 'reading'; data: T[] | null; at: number | null }
  | { kind: 'failed'; data: null; at: null }
  | { kind: 'ready' | 'kept'; data: T[]; at: number }
export interface OwnerReads {
  funnel: OwnerRead<FunnelDailyRow>
  sales: OwnerRead<SaleRow>
  sources: OwnerRead<CreatorShareSource>
  visits: OwnerRead<CreatorPageView>
}

export function failedOwnerRead<T>(previous: OwnerRead<T> | null): OwnerRead<T> {
  return previous?.data && previous.at !== null
    ? { kind: 'kept', data: previous.data, at: previous.at }
    : { kind: 'failed', data: null, at: null }
}

export function creatorPageSource(search: string): CreatorPageSource | null {
  const raw = new URLSearchParams(search.split('#')[0]).get('src')
  return CREATOR_PAGE_SOURCES.find(source => source === raw) ?? null
}

function count(value: unknown): number {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) {
    throw new Error('Invalid creator count')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Invalid creator count')
  return parsed
}

function sourceLabel(value: unknown): string {
  if (value === null) return 'Direct link'
  if (typeof value !== 'string' || !CREATOR_PAGE_SOURCES.some(source => source === value)) {
    throw new Error('Invalid creator source')
  }
  return value
}

function rows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) throw new Error('Invalid creator rows')
  return data.map((row: unknown) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new Error('Invalid creator row')
    return Object.fromEntries(Object.entries(row))
  })
}

export function mapCreatorShareSources(data: unknown, error: unknown): CreatorShareSource[] {
  if (error) throw error
  return rows(data).map(row => ({ source: sourceLabel(row.source), views: count(row.views), forks: count(row.forks) }))
}

export function mapCreatorPageViews(data: unknown, error: unknown): CreatorPageView[] {
  if (error) throw error
  return rows(data).map(row => {
    if (typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)
      || !Number.isFinite(Date.parse(row.day)) || new Date(row.day).toISOString().slice(0, 10) !== row.day) {
      throw new Error('Invalid creator day')
    }
    return { day: row.day, source: sourceLabel(row.source), visits: count(row.visits) }
  })
}

export async function fetchCreatorShareSources(days: number, opts: { signal?: AbortSignal } = {}): Promise<CreatorShareSource[]> {
  const query = supabase.rpc('get_creator_share_sources', { p_days: days })
  const { data, error } = await (opts.signal ? query.abortSignal(opts.signal) : query)
  return mapCreatorShareSources(data, error)
}

export async function fetchCreatorPageViews(days: number, opts: { signal?: AbortSignal } = {}): Promise<CreatorPageView[]> {
  const query = supabase.rpc('get_creator_page_views', { p_days: days })
  const { data, error } = await (opts.signal ? query.abortSignal(opts.signal) : query)
  return mapCreatorPageViews(data, error)
}

type VisitStorage = Pick<Storage, 'getItem' | 'setItem'>
export function claimCreatorPageView(creatorId: string, viewerId: string | null, storage: VisitStorage | null, claimed: Set<string>): boolean {
  if (creatorId === viewerId) return false
  const key = `yf:creator-page-view:${creatorId}`
  if (claimed.has(key)) return false
  claimed.add(key)
  try {
    if (storage?.getItem(key)) return false
    storage?.setItem(key, '1')
  } catch { /* Storage can be blocked; the memory claim still prevents repeats. */ }
  return true
}

const visitClaims = new Set<string>()
export async function bumpCreatorPageView(creatorId: string, source: string | null, viewerId: string | null): Promise<void> {
  let storage: VisitStorage | null = null
  try { storage = window.sessionStorage } catch { /* Use the memory claim when storage is blocked. */ }
  if (!claimCreatorPageView(creatorId, viewerId, storage, visitClaims)) return
  const safeSource = CREATOR_PAGE_SOURCES.find(item => item === source) ?? null
  try {
    const { error } = await supabase.rpc('bump_creator_page_view', { p_creator: creatorId, p_source: safeSource })
    if (error) console.error('[yatraflow] creator page visit failed', error)
  } catch (error) { console.error('[yatraflow] creator page visit failed', error) }
}

/** The export includes every dated count used by the meters, without a feed limit. */
export function ownerActivityCsv(daily: FunnelDailyRow[], sales: SaleRow[], visits: CreatorPageView[], now: number): string {
  const events = activityFeed(sales, [], [], now, sales.length)
  for (const row of daily) {
    events.push({ kind: 'forked', at: Date.parse(`${row.day}T00:00:00Z`), route: row.pubId, count: row.forks })
  }
  const extra = [
    ...daily.map(row => `route-open,${row.day}T00:00:00.000Z,,${row.views},`),
    ...visits.map(row => `page-visit,${row.day}T00:00:00.000Z,,${row.visits},`),
  ]
  return [activityCsv(events), ...extra].join('\r\n')
}
