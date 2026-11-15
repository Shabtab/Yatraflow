import { useEffect, useRef, useState } from 'react'
import { creatorFollowApi, type CreatorFollowApi, type CreatorValue } from '../lib/creatorFollows'

export function useCreatorFollowerCount(creator: string | null, api: CreatorFollowApi = creatorFollowApi, attempt = 0): CreatorValue<number> {
  const [result, setResult] = useState<{ creator: string; api: CreatorFollowApi; attempt: number; read: CreatorValue<number> } | null>(null)
  useEffect(() => {
    if (!creator) return
    let alive = true
    const ac = new AbortController()
    const timer = setTimeout(() => { ac.abort(); if (alive) setResult({ creator, api, attempt, read: { kind: 'failed' } }) }, 10_000)
    void api.count(creator, ac.signal).then(value => {
      if (alive && !ac.signal.aborted) setResult({ creator, api, attempt, read: { kind: 'ready', value } })
    }).catch(() => {
      if (alive) setResult({ creator, api, attempt, read: { kind: 'failed' } })
    }).finally(() => { clearTimeout(timer) })
    return () => { alive = false; clearTimeout(timer); ac.abort() }
  }, [creator, api, attempt])
  return result !== null && result.creator === creator && result.api === api && result.attempt === attempt
    ? result.read
    : { kind: 'reading' }
}

export function useCreatorFollows(creator: string, viewer: string | null, api: CreatorFollowApi = creatorFollowApi) {
  const [attempt, setAttempt] = useState(0)
  const count = useCreatorFollowerCount(creator, api, attempt)
  const identity = `${viewer ?? ''}:${creator}`
  const [settled, setSettled] = useState<{ identity: string; api: CreatorFollowApi; attempt: number; read: CreatorValue<boolean> } | null>(null)
  const [writing, setWriting] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ identity: string; intended: boolean; text: string } | null>(null)
  const inFlight = useRef(false)
  const liveIdentity = useRef(identity)
  useEffect(() => { liveIdentity.current = identity }, [identity])
  useEffect(() => {
    if (!viewer || viewer === creator) return
    let alive = true
    const ac = new AbortController()
    const timer = setTimeout(() => { ac.abort(); if (alive) setSettled({ identity, api, attempt, read: { kind: 'failed' } }) }, 10_000)
    void api.isFollowing(creator, ac.signal).then(value => {
      if (alive && !ac.signal.aborted) {
        setSettled({ identity, api, attempt, read: { kind: 'ready', value } })
        setFailure(current => current?.identity === identity && current.intended === value ? null : current)
      }
    }).catch(() => { if (alive) setSettled({ identity, api, attempt, read: { kind: 'failed' } }) })
      .finally(() => { clearTimeout(timer) })
    return () => { alive = false; clearTimeout(timer); ac.abort() }
  }, [creator, viewer, identity, api, attempt])
  const following: CreatorValue<boolean> = !viewer ? { kind: 'ready', value: false }
    : settled?.identity === identity && settled.api === api && settled.attempt === attempt ? settled.read : { kind: 'reading' }
  const refresh = () => { setAttempt(value => value + 1) }
  async function toggle() {
    if (inFlight.current || !viewer || viewer === creator || following.kind !== 'ready') return
    inFlight.current = true
    setWriting(identity)
    setFailure(null)
    try {
      await (following.value ? api.unfollow : api.follow)(creator, AbortSignal.timeout(10_000))
      if (liveIdentity.current !== identity) return
      setSettled({ identity, api, attempt, read: { kind: 'ready', value: !following.value } })
      refresh()
    } catch {
      if (liveIdentity.current === identity) {
        setFailure({ identity, intended: !following.value, text: 'Follow change not saved. Try again.' })
        refresh()
      }
    } finally {
      inFlight.current = false
      setWriting(null)
    }
  }
  return { count, following, busy: writing === identity, error: failure?.identity === identity ? failure.text : null, refresh, toggle }
}
