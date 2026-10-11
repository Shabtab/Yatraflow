// ============ My trips — Grid | List switch ============
import { LayoutGrid, List } from 'lucide-react'

export type TripsLayout = 'grid' | 'list'

export function ViewSwitch({ layout, onChange }: { layout: TripsLayout; onChange: (next: TripsLayout) => void }) {
  return (
    <div className="mt-seg" role="group" aria-label="Layout">
      <button type="button" aria-pressed={layout === 'grid'} onClick={() => onChange('grid')}>
        <LayoutGrid size={15} aria-hidden />Grid
      </button>
      <button type="button" aria-pressed={layout === 'list'} onClick={() => onChange('list')}>
        <List size={15} aria-hidden />List
      </button>
    </div>
  )
}
