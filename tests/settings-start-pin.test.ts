// ============ #410 — the start's pin belongs to the text it was picked for ============
//
// The bug this pins: renaming the start city kept the OLD city's coordinates.
// "Udaipur" then measured Jaipur's roads — every downstream figure honest math
// over the wrong city, with nothing anywhere saying so. (The Create-trip path
// has the same typed-vs-picked shape and its own filed issue; this is the
// Settings instance.)
//
// The rule the module enforces: a pin carries the label it was picked for. A
// text that names a different city has no pin, the trip saves unpositioned
// (the existing degraders measure that honestly), and only a pick restores it.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { StartPin } from '../src/lib/startPin'
import { coordsForText, pinMatchesText } from '../src/lib/startPin'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const jaipur: StartPin = { coords: { lat: 26.9124, lng: 75.7873 }, label: 'Jaipur, Rajasthan' }

describe('#410 — the pin follows the text', () => {
  it('an untouched pick keeps its coordinates', () => {
    expect(pinMatchesText(jaipur, 'Jaipur, Rajasthan')).toBe(true)
    expect(coordsForText(jaipur, 'Jaipur, Rajasthan')).toEqual(jaipur.coords)
  })

  it('a rename to a different city loses the pin', () => {
    // The exact transition the issue pins: pick Jaipur, edit the text to
    // Udaipur, save — the save must carry no coordinates at all.
    expect(pinMatchesText(jaipur, 'Udaipur, Rajasthan')).toBe(false)
    expect(coordsForText(jaipur, 'Udaipur, Rajasthan')).toBeNull()
  })

  it('case and stray whitespace are not a new city', () => {
    expect(pinMatchesText(jaipur, 'jaipur, rajasthan')).toBe(true)
    expect(pinMatchesText(jaipur, '   Jaipur, Rajasthan   ')).toBe(true)
    expect(coordsForText(jaipur, ' jaipur, rajasthan ')).toEqual(jaipur.coords)
  })

  it('an empty start field has no pin', () => {
    expect(pinMatchesText(jaipur, '   ')).toBe(false)
    expect(coordsForText(jaipur, '')).toBeNull()
  })

  it('a trip with no pin has no coordinates, whatever the text', () => {
    expect(pinMatchesText(null, 'Kochi')).toBe(false)
    expect(coordsForText(null, 'Kochi')).toBeNull()
    expect(coordsForText(undefined, 'Kochi')).toBeNull()
  })

  it('edit-then-save simulates to an unpositioned trip, never a wrong city', () => {
    // The handler's whole shape, replayed as state: the pick sets the pin, the
    // edit that renames drops it, and the save reads the pin through the same
    // backstop. No step ever writes the old city's coordinates under new text.
    let pin: StartPin | null = jaipur
    const onEdit = (text: string) => { if (pin && !pinMatchesText(pin, text)) pin = null }
    onEdit('Udaipur, Rajasthan')
    expect(coordsForText(pin, 'Udaipur, Rajasthan')).toBeNull()
  })
})

describe('#410 — the settings form speaks the module', () => {
  const src = read('../src/pages/trip/TripSettingsForm.tsx')
  const loc = read('../src/components/LocationInput.tsx')

  it('the edit handler drops a pin the text no longer names', () => {
    // Claimed BEFORE the text state is used at save — the drop is the whole fix.
    expect(src).toMatch(/pinMatchesText\(startPin, v\)/)
  })

  it('a pick sets the pin with the label the box itself will show', () => {
    // The label must be the LocationInput's OWN pick-label formula — a private
    // copy would drift from the box and the pin would refuse its own text on
    // the next keystroke.
    expect(src).toMatch(/label: pickLabel\(p\)/)
    expect(loc).toMatch(/export function pickLabel\(hit: PlaceHit\): string/)
    expect(loc).toMatch(/onChange\(pickLabel\(hit\)\)/)
  })

  it('the save refuses to persist a mismatched pair', () => {
    expect(src).toMatch(/coordsForText\(startPin, f\.startLocation\)/)
    expect(src).toMatch(/startLocationCoords: startCoordsToSave \?\? undefined/)
  })

  it('the drop is said out loud, not silently absorbed', () => {
    // Both notices: the edit that dropped the pin, and the pair a save refused.
    expect(src).toMatch(/START_UNPINNED/)
    expect(src).toMatch(/START_DROPPED/)
    expect(src).toMatch(/startNotice && <p/)
  })
})
