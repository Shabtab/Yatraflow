// ============ Shared category icons (Lucide-style stroke paths) ============
// One source of truth for the monochrome stop/suggestion icon set: map pins,
// nearby-suggestion thumbnails and any future surface that needs a clean
// category glyph. stroke="currentColor" so parents set the colour.
import type { ReactNode } from 'react'

const CATEGORY_PATHS: Record<string, string> = {
  food: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7', // utensils
  hotel: 'M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9', // bed
  rest: 'M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4ZM7 2v3M11 2v3', // coffee
  temple: 'M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2 3 7h18l-9-5Z', // landmark
  beach: 'M22 12a10 10 0 0 0-20 0ZM12 12v8a2 2 0 0 0 4 0M2 12h20', // umbrella
  nature: 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10ZM2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12', // leaf
  adventure: 'm8 3 4 8 5-5 5 15H2L8 3Z', // mountains
  shopping: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0', // bag
  museum: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M6 12h12M2 22h20', // building
  travel: 'M8 19l-2 3M16 19l2 3M5 11h14M7 4h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM8.5 14.5h.01M15.5 14.5h.01', // train
  'transport-hub': 'M8 19l-2 3M16 19l2 3M5 11h14M7 4h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM8.5 14.5h.01M15.5 14.5h.01',
  event: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', // calendar
}
// camera — default for sightseeing and anything unmapped
const CAMERA_PATH = 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z'

export function CatIcon({ category, size = 15, className }: {
  category?: string; size?: number; className?: string
}): ReactNode {
  const d = CATEGORY_PATHS[category ?? ''] ?? CAMERA_PATH
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}