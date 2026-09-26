// ============ One band → colour mapping (#369) ============
// Trip health is stated as a BAND by the engine (`scoreWarnings`: Comfortable /
// Manageable / Tight / Unrealistic) and colour-coded by the surfaces. The Board
// re-invented the cuts from the raw SCORE (`>=70 ok | >=40 mid | else bad`), so
// a 45-point trip printed the word “Unrealistic” in reassuring mid-blue: the
// word and its colour came from two different scales. Both surfaces now share
// this one mapping, keyed on the band the engine actually produced.
import type { HealthResult } from './engine'

export type HealthBand = HealthResult['band']

/** Fill/ink class for the score and the health bar: `ok` · `mid` · `bad`. */
export function healthBandClass(band: HealthBand): 'ok' | 'mid' | 'bad' {
  return band === 'Tight' ? 'mid' : band === 'Comfortable' || band === 'Manageable' ? 'ok' : 'bad'
}

/** `Chip` tone for the band word — the palette the Overview already used for it. */
export function healthBandTone(band: HealthBand): 'ok' | 'teal' | 'saffron' | 'danger' {
  return band === 'Comfortable' ? 'ok' : band === 'Manageable' ? 'teal' : band === 'Tight' ? 'saffron' : 'danger'
}
