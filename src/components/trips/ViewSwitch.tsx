// ============ My trips — Grid | List switch ============
// A thin caller of SegmentedTabs. The two layouts are a pressed-state group,
// not tabs, so it uses the toggle semantics and keeps the mt-seg look.
import { LayoutGrid, List } from 'lucide-react'
import type { TripsLayout as CardTripsLayout } from '../../lib/tripsCard'
import { SegmentedTabs, type SegmentedTabItem } from '../page/SegmentedTabs'

// The type lives in tripsCard. This line keeps the name callers import from here.
export type TripsLayout = CardTripsLayout

const LAYOUT_ITEMS: readonly SegmentedTabItem[] = [
  { key: 'grid', label: 'Grid', icon: <LayoutGrid size={15} aria-hidden /> },
  { key: 'list', label: 'List', icon: <List size={15} aria-hidden /> },
]

export function ViewSwitch({ layout, onChange }: { layout: TripsLayout; onChange: (next: TripsLayout) => void }) {
  return (
    <SegmentedTabs semantics="toggle" className="mt-seg" label="Layout" items={LAYOUT_ITEMS} value={layout}
      onChange={key => onChange(key as TripsLayout)} />
  )
}
