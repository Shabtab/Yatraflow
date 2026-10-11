// ============ Explore — save heart ============
// The round heart on a plan's cover. The grid card and the trending card both
// draw it, so the look, the hover pop and the keyboard focus ring cannot drift.
// The caller owns the saved state: it passes `saved` and the toggle handler.
import { Heart } from 'lucide-react'

export function ExploreSaveHeart({ title, saved, onToggle }: {
  title: string
  saved: boolean
  onToggle: () => void
}) {
  /* The label is fixed; aria-pressed carries the saved state. */
  return (
    <button type="button" className="ex-save" aria-pressed={saved}
      aria-label={`Save ${title}`} onClick={onToggle}>
      <span className="ex-save-dot"><Heart size={16} aria-hidden fill={saved ? 'currentColor' : 'none'} /></span>
    </button>
  )
}
