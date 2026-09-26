// ============ Trip workspace — the Map tab's loading shape ============
// Its own module on purpose (#332 R4): this is the Suspense fallback for the
// LAZILY imported MapTab, so it must pull nothing heavy. While it lived in
// MapTab.tsx, importing it statically dragged that whole module — geocode,
// engine, daySlots, tripDna, storyArcs and the rest of the suggestion stack —
// into the workspace chunk whether or not the tab was ever opened, which is
// exactly what the lazy boundary was there to prevent. Keep it dependency-free:
// a fallback that imports the thing it is waiting for suspends on itself.

/** The Map tab's loading shape. The tab is behind a Suspense boundary because it
    carries the lazy MapLibre chunk, and the frame it waits for is the heaviest
    download in the app — so it gets a skeleton of what is arriving (the frame
    and the two rails, on the tab's own grid so it inherits the breakpoints)
    rather than a spinner. */
export function MapTabSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">Loading the map and your day plan.</span>
      <div className="map-ideas-grid">
        <div className="map-skel-rail" aria-hidden />
        <div className="map-ideas-map map-skel-map" aria-hidden />
        <div className="map-skel-rail" aria-hidden />
      </div>
    </div>
  )
}
