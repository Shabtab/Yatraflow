import { useMemo, useSyncExternalStore } from 'react'

const CHANGE = 'yatraflow:ride-progress'
export const rideProgressKey = (publicationId: string) => `yatraflow_ride_read:${publicationId}`

/** Invalid storage entries cannot mark a day as read. */
export function parseRideProgress(raw: string | null): ReadonlySet<number> {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')
    return new Set(Array.isArray(value) ? value.filter((index: unknown): index is number =>
      typeof index === 'number' && Number.isSafeInteger(index) && index >= 0) : [])
  } catch { return new Set() }
}

export function freeDaysRead(readDays: ReadonlySet<number>, freeIndexes: readonly number[]): number {
  return new Set(freeIndexes.filter(index => readDays.has(index))).size
}

function readRaw(publicationId: string): string | null {
  try { return window.localStorage.getItem(rideProgressKey(publicationId)) } catch { return null }
}

export function markRideDayRead(publicationId: string, index: number, freeIndexes: readonly number[]): void {
  if (!publicationId || !Number.isSafeInteger(index) || !freeIndexes.includes(index)) return
  const read = parseRideProgress(readRaw(publicationId))
  if (read.has(index)) return
  try {
    window.localStorage.setItem(rideProgressKey(publicationId), JSON.stringify([...read, index].sort((a, b) => a - b)))
    window.dispatchEvent(new Event(CHANGE))
  } catch { /* The day still opens when storage is blocked. */ }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** Shared with the ribbon. Day indexes are publication indexes, not positions. */
export function useRideProgress(publicationId: string): ReadonlySet<number> {
  const raw = useSyncExternalStore(subscribe, () => readRaw(publicationId), () => null)
  return useMemo(() => parseRideProgress(raw), [raw])
}
