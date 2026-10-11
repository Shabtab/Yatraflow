// ============ Segmented tabs ============
// One row of choices where exactly one is active. It has two semantics, because
// the two jobs differ in what a screen reader must hear.
//
//   'tablist' - the choices switch a panel. The row is a tablist. It follows
//               the useTablist keyboard contract (roving tab stop, arrows,
//               Home and End) and a PillNav glider slides behind the active tab.
//               The look is the tabbar and tab-btn rules in styles.css.
//   'toggle'  - the choices are a pressed-state group, such as Grid and List.
//               Each button carries aria-pressed. There is no roving focus and
//               no glider, so the markup stays the same as the My trips switch
//               had before this primitive existed. The caller passes the look
//               class, such as mt-seg.
//
// The semantics prop exists so a group of pressed buttons is never announced
// as tabs. A tab needs a panel to point at. A toggle does not have one.
import { useCallback, useMemo, type ReactNode } from 'react'
import { useTablist } from '../../hooks/useTablist'
import { PillNav } from '../PillNav'

export interface SegmentedTabItem {
  /** The stable key of the choice. It is the value passed to onChange. */
  key: string
  label: ReactNode
  /** An icon before the label. Pass it with aria-hidden. */
  icon?: ReactNode
  /** A count badge after the label. It shows for a non-zero value only. Tablist only. */
  count?: number
  /** The id of the tab button, so a panel can name it with aria-labelledby. Tablist only. */
  id?: string
  /** The id of the panel this tab controls. Tablist only. */
  controls?: string
}

export interface SegmentedTabsProps {
  semantics: 'tablist' | 'toggle'
  items: readonly SegmentedTabItem[]
  /** The key of the active item. */
  value: string
  onChange: (key: string) => void
  /** The accessible name of the row. */
  label: string
  /** The look class of the row. A tablist defaults to tabbar. A toggle has no default. */
  className?: string
}

export function SegmentedTabs({ semantics, items, value, onChange, label, className }: SegmentedTabsProps) {
  const keys = useMemo(() => items.map(item => item.key), [items])
  const activate = useCallback((key: string) => onChange(key), [onChange])
  // The hook is called for both semantics so the hook order never changes. A
  // toggle ignores what it returns.
  const { refs, tabProps } = useTablist(keys, value, activate)

  if (semantics === 'toggle') {
    return (
      <div className={className} role="group" aria-label={label}>
        {items.map(item => (
          <button key={item.key} type="button" aria-pressed={value === item.key} onClick={() => onChange(item.key)}>
            {item.icon}{item.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <PillNav className={className ?? 'tabbar'} role="tablist" aria-label={label} activeKey={value}>
      {items.map((item, index) => {
        const isActive = value === item.key
        const hasCount = item.count !== undefined && item.count > 0
        return (
          <button key={item.key} ref={refs(index)} type="button" role="tab" id={item.id} data-pill-key={item.key}
            aria-selected={isActive} aria-controls={item.controls} {...tabProps(item.key, index)}
            className={`tab-btn${isActive ? ' active' : ''}`} onClick={() => onChange(item.key)}>
            {item.icon}{item.label}{hasCount ? <span className="tab-count">{item.count}</span> : null}
          </button>
        )
      })}
    </PillNav>
  )
}
