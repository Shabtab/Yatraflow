// ============ The day header's two labels (#995) ============
// A dated day prints its date badge, then a "Day 3" kicker beside the day's
// title. The title falls back to `Day <n>` when the trip has none, so an
// untitled dated day read "Day 3 Day 3" — the same words twice, from two
// elements that each derived it on their own.
//
// One pure function now decides both strings. The kicker prints only when the
// title says something the kicker does not, so a custom title keeps its label
// and an untitled day prints the day number once.

/** The default title of a day, 1-based. */
export function defaultDayTitle(index: number): string {
  return `Day ${index + 1}`
}

export interface DayHeaderLabel {
  /** The kicker beside the title, or null when the title already says it. */
  number: string | null
  /** The heading text. */
  title: string
}

/** A custom title keeps the kicker. An empty title, or one that repeats the
 *  default `Day <n>` in any letter case, gets the label once. */
export function dayHeaderLabel(index: number, title: string | null | undefined): DayHeaderLabel {
  const fallback = defaultDayTitle(index)
  const custom = (title ?? '').trim()
  if (!custom || custom.toLowerCase() === fallback.toLowerCase()) {
    return { number: null, title: custom || fallback }
  }
  return { number: fallback, title: custom }
}
