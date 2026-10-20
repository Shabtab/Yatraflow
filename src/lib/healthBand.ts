// ============ One band → colour mapping (#369) ============
// Trip health is stated as a BAND by the engine (`scoreWarnings`: Comfortable /
// Manageable / Tight / Unrealistic) and colour-coded by the surfaces. The Board
// re-invented the cuts from the raw SCORE (`>=70 ok | >=40 mid | else bad`), so
// a 45-point trip printed the word “Unrealistic” in reassuring mid-blue: the
// word and its colour came from two different scales. Both surfaces now share
// this one mapping, keyed on the band the engine actually produced.
import type { HealthResult } from './engine'

export type HealthBand = HealthResult['band']

/**
 * Fill/ink class for the score number and the health bar.
 *
 * #400: this was THREE buckets (`Tight→mid`, `Comfortable|Manageable→ok`,
 * `else→bad`) while the chip beside it read a FOUR-way tone — so a 70–84 trip
 * printed the word "Manageable" in Comfortable-green and the middle band had no
 * identity at all where the numbers live. It is now four-way and returns
 * `healthBandTone`'s own palette, so the two cannot drift apart again: the
 * word, the number and the bar all state the same band the same way.
 *
 * `Unrealistic` keeps the badge's `danger` hue (the palette's own name for the
 * same coral the old `bad` wore) — renaming the class, not the colour.
 */
export function healthBandClass(band: HealthBand): HealthBandClass {
  return healthBandTone(band)
}

/** The four class names the number and the bar are painted from. */
export type HealthBandClass = 'ok' | 'teal' | 'saffron' | 'danger'

/** `Chip` tone for the band word — the palette the Overview already used for it. */
export function healthBandTone(band: HealthBand): HealthBandClass {
  return band === 'Comfortable' ? 'ok' : band === 'Manageable' ? 'teal' : band === 'Tight' ? 'saffron' : 'danger'
}

/**
 * One plain sentence for each band. The score then states its consequence.
 *
 * #683: the Overview printed the raw band word beside the score. "Unrealistic"
 * names no consequence a traveller can act on, so the panel says what it means.
 */
export function healthBandSentence(band: HealthBand): string {
  return band === 'Comfortable' ? 'The plan fits these days with room to spare.'
    : band === 'Manageable' ? 'The plan fits, but the days run full.'
      : band === 'Tight' ? 'The days run long. Expect late arrivals.'
        : 'The plan does not fit these days. Drop a stop or add a day.'
}

