// ============ useTablist — the WAI-ARIA APG tablist keyboard contract ============
// One implementation of the tablist interaction pattern, extracted from
// ShareTab's (the only surface that had it right — issue #87): roving tabindex
// (only the active tab is in the tab order), ArrowLeft/Right + Up/Down to move
// (wrapping), Home/End to jump to the ends, automatic activation (focus moves
// the selection). Every role="tablist" surface should use this so keyboard and
// screen-reader users get one predictable behavior, not three.
//
// Usage:
//   const { refs, onKeyDown, tabProps } = useTablist(ids, activeId, setActiveId)
//   <div role="tablist">
//     {ids.map((id, i) => (
//       <button ref={refs(i)} {...tabProps(id, i)} … />
//     ))}
//   </div>
//
// `tabProps` returns the roving tabIndex + keydown handler; the caller keeps
// ownership of role/aria-selected/aria-controls because the id conventions
// differ per surface.

import { useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

export function useTablist<K extends string>(
  ids: readonly K[],
  activeId: K,
  activate: (id: K) => void,
) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = useCallback((e: ReactKeyboardEvent, idx: number) => {
    let next = idx
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % ids.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + ids.length) % ids.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = ids.length - 1
    else return
    e.preventDefault()
    activate(ids[next])
    refs.current[next]?.focus()
  }, [ids, activate])

  return {
    /** ref callback for tab button i: ref={refs(i)} */
    refs: (i: number) => (el: HTMLButtonElement | null) => { refs.current[i] = el },
    onKeyDown,
    /** spread onto the tab button: roving tabindex + keydown wiring */
    tabProps: (id: K, i: number) => ({
      tabIndex: id === activeId ? 0 : -1,
      onKeyDown: (e: ReactKeyboardEvent) => onKeyDown(e, i),
    }),
  }
}
