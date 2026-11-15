import { useEffect, useState } from 'react'
import {
  creatorPostsApi, POST_TIMEOUT_MS,
  type CreatorPost, type CreatorPostsApi, type PostsRead, type PostVisitsRead,
} from '../lib/creatorPosts'

/** One post-list read for one creator. A refresh keeps the last list as `previous`
 *  while it reads, so an editor does not blank between a save and the re-read. */
export function useCreatorPosts(creator: string | null, api: CreatorPostsApi = creatorPostsApi, attempt = 0): PostsRead {
  const [settled, setSettled] = useState<{ creator: string; api: CreatorPostsApi; attempt: number; read: PostsRead } | null>(null)
  const [last, setLast] = useState<{ creator: string; posts: CreatorPost[] } | null>(null)
  useEffect(() => {
    if (!creator) return
    let alive = true
    const ac = new AbortController()
    const timer = setTimeout(() => { ac.abort(); if (alive) setSettled({ creator, api, attempt, read: { kind: 'failed' } }) }, POST_TIMEOUT_MS)
    void api.list(creator, ac.signal).then(value => {
      if (!alive || ac.signal.aborted) return
      setLast({ creator, posts: value })
      setSettled({ creator, api, attempt, read: { kind: 'ready', value } })
    }).catch(() => {
      if (alive) setSettled({ creator, api, attempt, read: { kind: 'failed' } })
    }).finally(() => clearTimeout(timer))
    return () => { alive = false; clearTimeout(timer); ac.abort() }
  }, [creator, api, attempt])
  if (settled && settled.creator === creator && settled.api === api && settled.attempt === attempt) return settled.read
  return last && last.creator === creator ? { kind: 'reading', previous: last.posts } : { kind: 'reading' }
}

/** The owner's visits per post over `days`. Disabled until `enabled` is true. */
export function useCreatorPostVisits(enabled: boolean, days: number, api: CreatorPostsApi = creatorPostsApi, attempt = 0): PostVisitsRead {
  const [settled, setSettled] = useState<{ days: number; api: CreatorPostsApi; attempt: number; read: PostVisitsRead } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const ac = new AbortController()
    const timer = setTimeout(() => { ac.abort(); if (alive) setSettled({ days, api, attempt, read: { kind: 'failed' } }) }, POST_TIMEOUT_MS)
    void api.visits(days, ac.signal).then(value => {
      if (alive && !ac.signal.aborted) setSettled({ days, api, attempt, read: { kind: 'ready', value } })
    }).catch(() => {
      if (alive) setSettled({ days, api, attempt, read: { kind: 'failed' } })
    }).finally(() => clearTimeout(timer))
    return () => { alive = false; clearTimeout(timer); ac.abort() }
  }, [enabled, days, api, attempt])
  return settled && settled.days === days && settled.api === api && settled.attempt === attempt ? settled.read : { kind: 'reading' }
}
