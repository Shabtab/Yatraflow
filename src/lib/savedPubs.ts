// Saved (favourited) public itineraries — presentation-layer state only.
// localStorage keeps this schema-free: the Supabase model is untouched, and a
// visitor's saves are naturally device-local (no account required to save).
import { useCallback, useState } from 'react'

const SAVED_KEY = 'yf.savedPubs'

function read(): string[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    const ids = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []
  } catch { return [] }
}

function write(ids: string[]) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(ids)) } catch { /* private mode etc. — saving is best-effort */ }
}

/** Saved-published-itinerary ids + a toggle, shared by Explore and the public page. */
export function useSavedPubs(): { saved: string[]; isSaved: (id: string) => boolean; toggleSaved: (id: string) => boolean } {
  const [saved, setSaved] = useState<string[]>(read)
  const isSaved = useCallback((id: string) => saved.includes(id), [saved])
  const toggleSaved = useCallback((id: string) => {
    setSaved(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      write(next)
      return next
    })
    return !saved.includes(id) // the state it's switching to
  }, [saved])
  return { saved, isSaved, toggleSaved }
}
