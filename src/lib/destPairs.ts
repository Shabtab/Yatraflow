// ============ Destination name/coord pairs (#411) ============
// The trip row stores destinations as PARALLEL arrays — names, then coords
// with nulls for pin-less cities, positional and never compacted. Editing one
// array while the other stayed behind was the misalignment bug: the form held
// two independent states and re-zipped them optimistically, so a rename or a
// remove shifted the names under the pins and Kochi inherited Munnar's coords.
//
// The fix is a boundary: INSIDE the form there is exactly ONE array of pairs,
// and the parallel shape exists only on the way in (zip) and the way out
// (split) — the save mapping is the single writer of both arrays.

/** One destination with its optional pin. A missing lat/lng is a pin-less
 *  destination — meaningful, and preserved by position on the way out. */
export interface DestPair {
  name: string
  lat?: number
  lng?: number
}

/** Zip the row's two arrays into pairs, positionally. Longer `names` (a
 *  hand-edited row) keep their extra names unpinned; a longer `coords` cannot
 *  happen from the save mapping, and a stray entry there is ignored rather
 *  than trusted onto a name it never had. Nulls in `coords` are KEPT as
 *  pin-less pairs — never compacted, never back-filled. */
export function zipDests(
  names: readonly string[] | undefined,
  coords: readonly ({ lat: number; lng: number } | null)[] | undefined,
): DestPair[] {
  return (names ?? []).map((name, i) => {
    const c = coords?.[i] ?? null
    return c ? { name, lat: c.lat, lng: c.lng } : { name }
  })
}

/** Split pairs back into the row's parallel arrays. Pin-less pairs become
 *  explicit nulls at their own index — byte-for-byte the create-path
 *  convention, so a settings re-save never "heals" a hand-edited row into a
 *  different shape than the create form wrote. */
export function splitDests(pairs: readonly DestPair[]): {
  destinations: string[]
  destinationCoords: ({ lat: number; lng: number } | null)[]
} {
  return {
    destinations: pairs.map(p => p.name),
    destinationCoords: pairs.map(p =>
      p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null),
  }
}

/** Rename a pair in place — coords and position untouched. The rename
 *  affordance keeps the pins by construction (it never rebuilds the array). */
export function renameDest(pairs: readonly DestPair[], index: number, name: string): DestPair[] {
  return pairs.map((p, i) => (i === index ? { ...p, name } : p))
}

/** Pin (or unpin) a pair by index, touching nothing else. */
export function setDestCoords(pairs: readonly DestPair[], index: number, coords: { lat: number; lng: number } | null): DestPair[] {
  return pairs.map((p, i) => (i === index ? (coords ? { ...p, ...coords } : stripCoords(p)) : p))
}

function stripCoords(p: DestPair): DestPair {
  const { name } = p
  return { name }
}

/** Are two pair lists the same chain, by name + pin? Used by the dirty
 *  compare (D3b, #413) and by the Preview's route-tail hint (#411). */
export function destPairsEqual(a: readonly DestPair[], b: readonly DestPair[]): boolean {
  return a.length === b.length && a.every((p, i) => {
    const q = b[i]
    return p.name === q.name && (p.lat ?? null) === (q.lat ?? null) && (p.lng ?? null) === (q.lng ?? null)
  })
}
