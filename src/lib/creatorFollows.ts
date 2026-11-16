import { supabase } from './supabase'
import { currentUser } from '../store/store'
import type { Database } from '../types/database.generated'

function followerId(creator: string): string {
  const id = currentUser()?.id
  if (!id) throw new Error('Sign in to follow a creator.')
  if (id === creator) throw new Error('You cannot follow yourself.')
  return id
}

export function creatorFollowerCount(data: unknown, error: unknown): number {
  if (error) throw error
  if (typeof data !== 'number' && !(typeof data === 'string' && /^\d+$/u.test(data))) throw new Error('Invalid follower count')
  const count = Number(data)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid follower count')
  return count
}

export async function getCreatorFollowerCount(creator: string, signal: AbortSignal): Promise<number> {
  const { data, error } = await supabase.rpc('get_creator_follower_count', { p_creator: creator }).abortSignal(signal)
  return creatorFollowerCount(data, error)
}

export async function isFollowing(creator: string, signal: AbortSignal): Promise<boolean> {
  const follower = followerId(creator)
  const { data, error } = await supabase.from('creator_follows').select('follower, creator')
    .eq('follower', follower).eq('creator', creator).abortSignal(signal)
  if (error) throw error
  if (!Array.isArray(data) || data.length > 1 || data.some(row => !row || row.follower !== follower || row.creator !== creator)) {
    throw new Error('Follow status is unavailable')
  }
  return data.length === 1
}

export async function followCreator(creator: string, signal: AbortSignal): Promise<void> {
  const follower = followerId(creator)
  const { data, error } = await supabase.from('creator_follows').insert({ follower, creator } satisfies Database['public']['Tables']['creator_follows']['Insert'])
    .select('follower, creator').abortSignal(signal).single()
  if (error?.code === '23505') return
  if (error) throw error
  if (!data || data.follower !== follower || data.creator !== creator) throw new Error('Follow was not saved')
}

export async function unfollowCreator(creator: string, signal: AbortSignal): Promise<void> {
  const follower = followerId(creator)
  const { error } = await supabase.from('creator_follows').delete()
    .eq('follower', follower).eq('creator', creator).abortSignal(signal)
  if (error) throw error
}

export const creatorFollowApi = { count: getCreatorFollowerCount, isFollowing, follow: followCreator, unfollow: unfollowCreator }
export type CreatorFollowApi = typeof creatorFollowApi
export type CreatorValue<T> = { kind: 'reading' } | { kind: 'failed' } | { kind: 'ready'; value: T }

export function creatorFollowerCountLabel(count: CreatorValue<number>): string {
  return count.kind === 'ready' ? count.value.toLocaleString('en-IN') : count.kind === 'failed' ? 'Unavailable' : 'Loading…'
}
