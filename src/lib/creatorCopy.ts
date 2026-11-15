import { SHARE_SOURCE_LABELS } from './shareUrl'

/** "1 route" / "3 routes". A count inside a sentence must agree with its noun. */
export function countNoun(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`
}

/** Labels for the creator-only page sources, beside the shared share-source labels. */
const CREATOR_SOURCE_LABELS: Record<string, string> = {
  ig: 'Instagram',
  yt: 'YouTube',
  threads: 'Threads',
  post: 'Post link',
}

/** Human label for a share-source key. An unknown key shows capitalised, never raw. */
export function sourceDisplayLabel(source: string): string {
  const known = CREATOR_SOURCE_LABELS[source] ?? SHARE_SOURCE_LABELS[source]
  if (known) return known
  return source ? source.charAt(0).toUpperCase() + source.slice(1) : 'Unknown source'
}
