// ============ Chakra mascot: pose to file ============
// One map answers "which file draws this pose". It is the single source of
// truth, and tests/mascot.test.ts checks every path here against the files in
// public/brand/mascot/ - a pose that names a missing file fails the gate.
//
// Rules from docs/MASCOT-PLAN.md §2 and §5:
// - The mascot is decoration. Every placement is `alt=""` + `aria-hidden`.
// - The dark theme takes the night file where one exists (`hero`).
// - A pose with no still file (a loop such as `loading`) always uses its
//   animated file; the caller cannot ask for a still that does not exist.
// - Placement files carry no `<text>`: an `<img>` cannot load the page font,
//   so every glyph is a path. The test enforces this.

/** The files that answer for one pose. Paths are relative to public/brand/mascot/. */
export interface MascotPoseFiles {
  /** The still SVG. */
  still?: string
  /** The looping SVG. Its CSS stops under `prefers-reduced-motion: reduce`. */
  animated?: string
  /** The dark-theme variant, when the pose has one. */
  night?: string
}

/** Every pose the app can ask for, and the file that draws it. */
export const MASCOT_FILES = {
  budget: { still: 'chakra-budget.svg', animated: 'animated/chakra-budget.svg' },
  celebrate: { animated: 'animated/chakra-celebrate.svg' },
  chai: { still: 'chakra-chai.svg', animated: 'animated/chakra-chai.svg' },
  flock: { still: 'chakra-flock.svg' },
  'head-curious': { still: 'chakra-head-curious.svg' },
  hero: { still: 'chakra-hero.svg', night: 'chakra-night-hero.svg' },
  idle: { animated: 'animated/chakra-idle.svg' },
  loading: { animated: 'animated/chakra-loading.svg' },
  lost: { animated: 'animated/chakra-lost.svg' },
  love: { animated: 'animated/chakra-love.svg' },
  'mark-face': { still: 'chakra-mark-face.svg' },
  'mark-tile': { still: 'chakra-mark-tile.svg' },
  pin: { still: 'chakra-pin.svg' },
  sad: { animated: 'animated/chakra-sad.svg' },
  scouting: { still: 'chakra-scouting.svg' },
  sleep: { still: 'chakra-sleep.svg', animated: 'animated/chakra-sleep.svg' },
  thinking: { animated: 'animated/chakra-thinking.svg' },
  wave: { animated: 'animated/chakra-wave.svg' },
} as const satisfies Record<string, MascotPoseFiles>

/** A pose name the app may ask for. */
export type MascotPose = keyof typeof MASCOT_FILES

/**
 * The file that draws `pose`, relative to public/brand/mascot/.
 *
 * Order: the night file in a dark theme, then the animated file when the
 * caller asked for motion, then the still file, then whatever the pose has.
 * A pose never resolves to a file it does not ship.
 */
export function mascotFile(
  pose: MascotPose,
  { animated = false, dark = false }: { animated?: boolean; dark?: boolean } = {},
): string {
  const files: MascotPoseFiles = MASCOT_FILES[pose]
  const chosen = dark && files.night
    ? files.night
    : animated && files.animated
      ? files.animated
      : files.still ?? files.animated ?? files.night
  return chosen ? `brand/mascot/${chosen}` : ''
}
