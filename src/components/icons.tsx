// ============ Shared category icons ============
// One source of truth for the monochrome stop/suggestion icon set: map pins,
// nearby-suggestion thumbnails and any future surface that needs a clean
// category glyph. Lucide components inherit currentColor so parents set the colour.
import type { CSSProperties, ReactNode } from 'react'
import {
  BedDouble, Bike, Building, Bus, Calendar, Camera, Car, CarTaxiFront, Cloud,
  CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSun, Coffee, Fuel,
  KeyRound, Landmark, Leaf, Mountain, Plane, Shuffle, ShoppingBag, Snowflake,
  Sun, TrainFront, Umbrella, Utensils,
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
    <Icon size={size} className={className} strokeWidth={1.5} aria-hidden />
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

// ---- Semantic meta icons: one tinted hue per concept, app-wide ----
// money = saffron, time = teal, place = purple, ticket (entry) = green.
// Tokens mirror in dark theme, so both themes stay AA on their surfaces.
export type MetaTone = 'money' | 'time' | 'place' | 'ticket'

export function MetaIcon({ icon: Icon, tone, size = 12 }: { icon: LucideIcon; tone: MetaTone; size?: number }) {
  return <Icon size={size} aria-hidden className={`mi mi-${tone}${size <= 12 ? ' ic-sm' : ''}`} />
}

// ---- InlineIcon: the one rule for icons sitting inside a line of text ----
// Icon + text reads as one phrase only when the glyph sits on the text
// baseline with a consistent gap. This replaces the copy-pasted
// `style={{ verticalAlign: '-2px', marginRight: N }}` every surface used to
// inline — one edit point instead of 100 drifted copies.
export function InlineIcon({ icon: Icon, size = 13, gap = 4, className, style, fill, vAlign = '-2px' }: {
  icon: LucideIcon
  size?: number
  /** space between glyph and the next word, px */
  gap?: number
  className?: string
  /** merged AFTER the baseline offset — override only what you must (e.g. a
   *  symmetric marginLeft for a two-sided margin). */
  style?: CSSProperties
  /** Heart-style outline/fill toggles pass straight through. */
  fill?: string
  /** baseline nudge; -1px is the 12px-glyph house style */
  vAlign?: string
}): ReactNode {
  return <Icon size={size} aria-hidden fill={fill}
    className={[size <= 12 ? 'ic-sm' : '', className].filter(Boolean).join(' ') || undefined}
    style={{ verticalAlign: vAlign, marginRight: gap, ...style }} />
}

// ---- Transport-mode glyphs: ONE map for every surface that names a mode ----
// Mode pickers (PlanBench tiles, Trip settings rows) and mode ECHOES (Create
// Trip's ticket row, the public page's byline anchor) all read from here, so
// "train" can never render as a car because a surface hardcoded <Car>.
// A generic travel leg with NO mode in scope keeps CatIcon('travel')
// (TrainFront); the StopEditor's "measuring road" row deliberately keeps
// <Car> because that leg is a road measurement whatever the trip mode is.
export const MODE_ICONS: Record<string, LucideIcon> = {
  car: Car, rental: KeyRound, taxi: CarTaxiFront, motorcycle: Bike,
  train: TrainFront, bus: Bus, flight: Plane, mixed: Shuffle,
}

/** Glyph for a TransportMode (data/types). Unknown mode falls back to Car. */
export function modeIcon(mode: string, size = 15): ReactNode {
  const Icon = MODE_ICONS[mode] ?? Car
  return <Icon size={size} aria-hidden />
}

// ---- Stop-kind glyphs (lib/stopKind's seven display kinds) ----
// One icon language per KIND, so a card can carry the glyph beside the kind
// colour/spine. Three families coexist on purpose and must not be confused:
//   * KIND glyphs (below)     — derived from stop data, for kind-annotated cards;
//   * CATEGORY glyphs         — CatIcon, raw category, map pins (travel =
//     TrainFront stays canonical there — the rail reads "journey" at 12px);
//   * MODE glyphs (modeIcon)  — only where the USER picks or echoes a mode.
export const KIND_ICONS: Record<string, LucideIcon> = {
  drive: Car,
  stay: BedDouble,
  food: Utensils,
  fuel: Fuel,
  rest: Coffee,
  activity: Landmark,
  viewpoint: Mountain,
}

/** Lucide glyph for a stop kind (see lib/stopKind). Camera fallback, same as
 *  CatIcon's unknown-category treatment. */
export function KindIcon({ kind, size = 13, style, className }: {
  kind: string; size?: number; style?: CSSProperties; className?: string
}): ReactNode {
  const Icon = KIND_ICONS[kind] ?? Camera
  return <Icon size={size} aria-hidden style={style}
    className={[size <= 12 ? 'ic-sm' : '', className].filter(Boolean).join(' ') || undefined} />
}
