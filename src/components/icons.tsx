// ============ Shared category icons ============
// One source of truth for the monochrome stop/suggestion icon set: map pins,
// nearby-suggestion thumbnails and any future surface that needs a clean
// category glyph. Lucide components inherit currentColor so parents set the colour.
import type { ReactNode } from 'react'
import {
  BedDouble, Building, Calendar, Camera, Cloud, CloudDrizzle, CloudFog,
  CloudLightning, CloudRain, CloudSun, Coffee, Landmark, Leaf, Mountain,
  ShoppingBag, Snowflake, Sun, TrainFront, Umbrella, Utensils,
  type LucideIcon,
} from 'lucide-react'

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  food: Utensils,
  hotel: BedDouble,
  rest: Coffee,
  temple: Landmark,
  beach: Umbrella,
  nature: Leaf,
  adventure: Mountain,
  shopping: ShoppingBag,
  museum: Building,
  travel: TrainFront,
  'transport-hub': TrainFront,
  event: Calendar,
}

export function CatIcon({ category, size = 15, className }: {
  category?: string; size?: number; className?: string
}): ReactNode {
  const Icon = CATEGORY_ICONS[category ?? ''] ?? Camera
  return (
    <Icon size={size} className={className} strokeWidth={2} aria-hidden />
  )
}

// ---- Weather icons: the lucide counterpart of weather.ts's WMO emoji map ----
// Same code ranges, one icon language. `wmoInfo` keeps the text label.
const WMO_ICONS: Record<number, LucideIcon> = {
  0: Sun, 1: Sun, 2: CloudSun, 3: Cloud,
  45: CloudFog, 48: CloudFog,
  51: CloudDrizzle, 53: CloudDrizzle, 55: CloudDrizzle,
  61: CloudRain, 63: CloudRain, 65: CloudRain, 66: CloudRain, 67: CloudRain,
  71: Snowflake, 73: Snowflake, 75: Snowflake, 77: Snowflake,
  80: CloudRain, 81: CloudRain, 82: CloudRain,
  95: CloudLightning, 96: CloudLightning, 99: CloudLightning,
}

/** Lucide weather icon for a WMO code (0 = clear sky … 99 = thunderstorm, hail). */
export function wmoIcon(code: number): LucideIcon {
  return WMO_ICONS[code] ?? Cloud
}
