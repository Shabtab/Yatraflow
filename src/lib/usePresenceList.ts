// ============ Exit motion for list items (AGENTS §2.10) ============
// React unmounts a removed item on the spot, so a card that a filter, the Trash
// or an un-save takes out of a list used to vanish between two frames. This
// hook keeps the removed item mounted for one exit, then drops it.
//
//   const presence = usePresenceList(cards, card => card.id)
//   <div ref={presence.attachList}>
//     {presence.entries.map(({ item, key, exiting }, i) => (
//       <Card key={key} {...presenceAttrs({ exiting })} ... />
//     ))}
//   </div>
//
// The exit itself is CSS: `[data-presence='exit']` in styles.css plays the
// `presence-out` keyframes on the motion tokens. This file owns the three things
// CSS cannot do:
//   1. keep the item mounted for `--motion-med`, then drop it (a timer);
//   2. make the leaving item inert, so no key, click or screen reader reaches it;
//   3. move keyboard focus off a leaving item before the item goes inert.
// Nothing here runs when the reader asked for reduced motion or the tab is
// hidden: the item is dropped at once, exactly as before the hook existed.
//
// The leaving item keeps its slot until the exit ends. Then it is dropped, and
// the items that stay glide into the freed slot (a FLIP move on `--motion-slow`,
// or `--motion-slower` when the move is hundreds of px).
// The leaving item does not collapse: in a grid it cannot, because the cells
// around it would not move until the item was gone.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { motionTiming, prefersReducedMotion } from './motion'

export interface PresenceEntry<T> {
  key: string
  item: T
  /** True while the item plays its exit. It is gone from the data already. */
  exiting: boolean
}

/** The attributes a list item wears. `data-presence` is what the stylesheet and
 *  the DOM sync read. `aria-hidden` hides a leaving item from a screen reader. */
export interface PresenceAttrs {
  'data-presence': 'live' | 'exit'
  'aria-hidden'?: true
}

export function presenceAttrs(entry: { exiting: boolean }): PresenceAttrs {
  return entry.exiting ? { 'data-presence': 'exit', 'aria-hidden': true } : { 'data-presence': 'live' }
}

// ---- Pure state machine (tested in node, no DOM) ----

export function liveEntries<T>(items: readonly T[], keyOf: (item: T) => string): PresenceEntry<T>[] {
  return items.map(item => ({ key: keyOf(item), item, exiting: false }))
}

/**
 * Fold a new list of items into the entries that are on screen.
 *
 * - Every item in `items` is live, in the order it has now.
 * - An entry that was on screen and is gone from `items` becomes an exiting
 *   entry, placed straight after the entry that stood before it. An entry that
 *   was already exiting stays exiting.
 * - An exiting entry whose key comes back in `items` is live again.
 * - With `canExit` false, nothing exits: the result is the live list.
 */
export function reconcilePresence<T>(
  previous: readonly PresenceEntry<T>[],
  items: readonly T[],
  keyOf: (item: T) => string,
  canExit: boolean,
): PresenceEntry<T>[] {
  const next = liveEntries(items, keyOf)
  if (!canExit) return next
  const stillHere = new Set(next.map(entry => entry.key))
  const result = [...next]
  previous.forEach((entry, at) => {
    if (stillHere.has(entry.key)) return
    const ghost: PresenceEntry<T> = { key: entry.key, item: entry.item, exiting: true }
    const anchorKey = at === 0 ? null : previous[at - 1].key
    const anchorAt = anchorKey === null ? -1 : result.findIndex(other => other.key === anchorKey)
    result.splice(anchorAt + 1, 0, ghost)
  })
  return result
}

/** Remove the exiting entries with these keys. A key that is live again stays. */
export function dropExited<T>(entries: readonly PresenceEntry<T>[], keys: readonly string[]): PresenceEntry<T>[] {
  return entries.filter(entry => !(entry.exiting && keys.includes(entry.key)))
}

export function hasExiting(entries: readonly PresenceEntry<unknown>[]): boolean {
  return entries.some(entry => entry.exiting)
}

// ---- DOM side: inert and focus ----

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Make each leaving item inert and move focus off it. Call it after every
 * commit. It is cheap and it does nothing when no item leaves.
 *
 * Focus moves BEFORE the item goes inert: an inert element that holds focus
 * drops focus to <body>. The target is the first focusable thing in the next
 * live item, then in the one before it, then `fallback`, then the list itself.
 * A fallback that is a plain region gets a -1 tabindex, so it can take focus.
 *
 * A dialog can return focus to the control that opened it, and that control may
 * sit in a leaving item. The item is inert, so focus lands on <body>. When focus
 * is on <body>, `lastFocused` (the last element that held focus in the list)
 * stands in for it. Returns true when it moved focus.
 */
export function syncPresenceDom(root: HTMLElement, fallback?: (root: HTMLElement) => HTMLElement | null, lastFocused?: Element | null): boolean {
  const items = [...root.querySelectorAll<HTMLElement>('[data-presence]')]
  const active = document.activeElement
  const focusLost = !active || active === document.body
  const holds = focusLost ? lastFocused : active
  const holder = holds ? items.find(el => el.dataset.presence === 'exit' && el.contains(holds)) : undefined
  if (holder) {
    const isLive = (el: HTMLElement) => el.dataset.presence !== 'exit'
    const at = items.indexOf(holder)
    const neighbour = items.slice(at + 1).find(isLive) ?? items.slice(0, at).reverse().find(isLive)
    const target = neighbour?.querySelector<HTMLElement>(FOCUSABLE) ?? fallback?.(root) ?? root
    // A region that is not a control takes focus only with a -1 tabindex.
    if (!target.matches(FOCUSABLE) && !target.hasAttribute('tabindex')) target.tabIndex = -1
    target.focus({ preventScroll: true })
  }
  for (const el of items) el.toggleAttribute('inert', el.dataset.presence === 'exit')
  return Boolean(holder)
}

// ---- Reflow: the items that stay glide into the freed slot ----

export interface Point { x: number; y: number }

/** How far each item that stayed has moved: where it was minus where it is.
 *  An item that moved less than `minPx` on both axes is left out. */
export function reflowDeltas(before: ReadonlyMap<Element, Point>, after: ReadonlyMap<Element, Point>, minPx = 1): Map<Element, Point> {
  const deltas = new Map<Element, Point>()
  for (const [el, was] of before) {
    const now = after.get(el)
    if (!now) continue
    const dx = was.x - now.x
    const dy = was.y - now.y
    if (Math.abs(dx) >= minPx || Math.abs(dy) >= minPx) deltas.set(el, { x: dx, y: dy })
  }
  return deltas
}

/** The duration step for a glide of this length. A move of hundreds of px takes
 *  the long step: peak speed is distance over duration (docs/MOTION-TOKENS.md). */
export const LONG_REFLOW_PX = 200
export function reflowToken(farthestPx: number): '--motion-slow' | '--motion-slower' {
  return farthestPx > LONG_REFLOW_PX ? '--motion-slower' : '--motion-slow'
}

function livePositions(root: HTMLElement | null): Map<Element, Point> {
  const positions = new Map<Element, Point>()
  if (!root) return positions
  for (const el of root.querySelectorAll('[data-presence="live"]')) {
    const box = el.getBoundingClientRect()
    positions.set(el, { x: box.left, y: box.top })
  }
  return positions
}

/** Slide each item from where it was to where it is now. Only transform moves,
 *  so the glide costs no layout. */
function playReflow(root: HTMLElement, before: ReadonlyMap<Element, Point>): void {
  const deltas = reflowDeltas(before, livePositions(root))
  if (deltas.size === 0) return
  const farthest = Math.max(...[...deltas.values()].map(delta => Math.max(Math.abs(delta.x), Math.abs(delta.y))))
  const { duration } = motionTiming(reflowToken(farthest))
  const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-resize').trim() || 'ease-in-out'
  for (const [el, delta] of deltas) {
    el.animate([{ transform: `translate(${delta.x}px, ${delta.y}px)` }, { transform: 'none' }], { duration, easing })
  }
}

function canPlayExit(): boolean {
  if (typeof document === 'undefined') return false
  return !prefersReducedMotion() && document.visibilityState === 'visible'
}

// ---- The hook ----

export interface PresenceList<T> {
  /** Render these. Live items first-class, leaving items marked `exiting`. */
  entries: PresenceEntry<T>[]
  /** True while any item still plays its exit. Hold an empty state back until it ends. */
  exiting: boolean
  /** Put this as `ref` on the element that holds the items. */
  attachList: (element: HTMLElement | null) => void
}

export function usePresenceList<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  options: { fallbackFocus?: (root: HTMLElement) => HTMLElement | null } = {},
): PresenceList<T> {
  const signature = items.map(keyOf).join('\u0001')
  const [seenSignature, setSeenSignature] = useState(signature)
  const [entries, setEntries] = useState<PresenceEntry<T>[]>(() => liveEntries(items, keyOf))
  const listElement = useRef<HTMLElement | null>(null)
  const lastFocused = useRef<Element | null>(null)
  const detachFocusWatch = useRef<(() => void) | null>(null)
  const attachList = useCallback((element: HTMLElement | null) => {
    detachFocusWatch.current?.()
    detachFocusWatch.current = null
    listElement.current = element
    if (!element) return
    const remember = (event: FocusEvent) => { lastFocused.current = event.target as Element | null }
    element.addEventListener('focusin', remember)
    detachFocusWatch.current = () => element.removeEventListener('focusin', remember)
  }, [])
  // Leaving keys start their drop timer together: one batch, one timeout.
  const batches = useRef(new Set<{ id: number; keys: Set<string> }>())
  const reflowFrom = useRef<Map<Element, Point> | null>(null)
  const fallbackFocus = options.fallbackFocus
  // The drop timer outlives a render, so it reads the newest fallback from a ref.
  const fallbackFocusRef = useRef(fallbackFocus)
  useEffect(() => { fallbackFocusRef.current = fallbackFocus })

  // The set of keys changed: fold it in during render, so no frame paints the
  // item as gone. React re-renders this component at once with the new state.
  if (signature !== seenSignature) {
    setSeenSignature(signature)
    setEntries(reconcilePresence(entries, items, keyOf, canPlayExit()))
  }

  // A live entry shows the newest data for its key. A leaving entry keeps the
  // data it had when it left.
  const latest = new Map(items.map(item => [keyOf(item), item] as const))
  const shown = entries.map(entry => (entry.exiting ? entry : { ...entry, item: latest.get(entry.key) ?? entry.item }))

  useLayoutEffect(() => {
    const root = listElement.current
    if (!root) return
    if (syncPresenceDom(root, fallbackFocus, lastFocused.current)) lastFocused.current = null
    const from = reflowFrom.current
    reflowFrom.current = null
    if (from) playReflow(root, from)
  })

  // The keys that start to leave share one timer. A key that comes back live
  // leaves its batch, so the timer cannot drop it, and a later exit gets its own.
  useEffect(() => {
    const leaving = new Set(entries.filter(entry => entry.exiting).map(entry => entry.key))
    const pending = batches.current
    const queued = new Set<string>()
    for (const batch of pending) {
      for (const key of batch.keys) {
        if (leaving.has(key)) queued.add(key)
        else batch.keys.delete(key)
      }
    }
    const fresh = [...leaving].filter(key => !queued.has(key))
    if (fresh.length === 0) return
    const batch = { id: 0, keys: new Set(fresh) }
    batch.id = window.setTimeout(() => {
      pending.delete(batch)
      if (batch.keys.size === 0) return
      // Focus that a closed dialog dropped to <body> goes to the next item now.
      if (listElement.current && syncPresenceDom(listElement.current, fallbackFocusRef.current, lastFocused.current)) lastFocused.current = null
      // Read where the staying items are, drop the leaving ones in the same
      // commit, then let the layout effect glide the stayers into the gap.
      reflowFrom.current = livePositions(listElement.current)
      flushSync(() => setEntries(current => dropExited(current, [...batch.keys])))
    }, motionTiming('--motion-med').duration)
    pending.add(batch)
  }, [entries])

  useEffect(() => {
    const pending = batches.current
    return () => {
      for (const batch of pending) window.clearTimeout(batch.id)
      pending.clear()
    }
  }, [])

  return { entries: shown, exiting: hasExiting(entries), attachList }
}
