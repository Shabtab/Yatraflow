// ============ Shared — generated region art ============
// One <picture> for the raster illustration set in src/assets/art/. It serves
// AVIF at every width the manifest declares, with the manifest's WebP fallback,
// and paints the caller's inline SVG motif behind it. The motif is both the
// loading floor and the error floor: when the id resolves to no file, or the
// image fails at the network or decode step, the picture unmounts and the motif
// is what is left. No slot is ever an empty box.
//
// Selection stays in lib/regionArt.ts. This component only draws.
import { useState, type ReactNode } from 'react'
import { artUrl, srcsetFor } from '../lib/artUrls'
import { artEntryFor, focalYFor, vignetteArtFor } from '../lib/regionArt'

/**
 * The generated scene for one slot, with the SVG motif underneath.
 *
 * `fallback` must fill its positioned parent — every caller passes the existing
 * `TripArt` motif, which is already `position: absolute; inset: 0`. The picture
 * is layered over it, so the motif shows while the image loads.
 */
export function RegionArt({ id, ratio, sizes, fallback, eager = false, scrim = true }: {
  /** The generated image id, or null when the region has no image and the motif is the whole answer. */
  id: string | null
  /** The crop ratio this slot renders at, such as "16:10". Sets object-position from the manifest. */
  ratio: string
  /** The responsive `sizes` for the slot's real container width. */
  sizes: string
  /** The inline SVG motif. Fills the slot and stays visible under the image. */
  fallback: ReactNode
  /** Load eagerly. Above-the-fold heroes only; cards stay lazy. */
  eager?: boolean
  /** Paint the dark-theme scrim over the scene. Off for state vignettes, which stay undimmed. */
  scrim?: boolean
}) {
  // A failure belongs to one id. When the id changes — a different trip, a
  // different publication — the old verdict must not stick, or the next slot
  // would fall back for a file that loads fine. Adjusting state during render
  // is React's own pattern for this and needs no effect.
  const [failedId, setFailedId] = useState<string | null>(null)
  const [seenId, setSeenId] = useState(id)
  if (id !== seenId) {
    setSeenId(id)
    setFailedId(null)
  }

  const entry = id ? artEntryFor(id) : undefined
  const avif = id && entry ? srcsetFor(id, entry.widths, 'avif') : ''
  // No id, no manifest entry, or no AVIF file in the build: the motif is the
  // answer. This is the missing-file case, and it draws no broken image.
  if (!id || !entry || !avif || failedId === id) return <>{fallback}</>

  const webp = artUrl(id, entry.webp, 'webp')
  const largest = entry.widths[entry.widths.length - 1]
  // `src` is the last resort for a browser that ignores <source type>. WebP is
  // the wider-supported of the two, so it leads when the build has it.
  const src = webp ?? artUrl(id, largest, 'avif')
  if (!src) return <>{fallback}</>

  return (
    <>
      {fallback}
      <picture className={scrim ? 'yf-art-picture is-scrimmed' : 'yf-art-picture'}>
        <source type="image/avif" srcSet={avif} sizes={sizes} />
        {webp && <source type="image/webp" srcSet={`${webp} ${entry.webp}w`} sizes={sizes} />}
        <img
          className="yf-art-img"
          src={src}
          alt=""
          aria-hidden="true"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          style={{ objectPosition: `50% ${focalYFor(id, ratio)}%` }}
          onError={() => { setFailedId(id) }}
        />
      </picture>
    </>
  )
}

/**
 * A page-level state vignette, square by contract. `es-first-trip` and the
 * batch-1 state images are square masters; they are never cropped to a wide
 * slot and they never take the dark scrim. `fallback` is the state's own icon,
 * which is what the block shows until the image paints and after any failure.
 */
export function StateVignette({ name, fallback }: {
  /** The manifest's `vignettes` key, such as "first-trip". */
  name: string
  /** The icon the state block shows today. */
  fallback: ReactNode
}) {
  return (
    <div className="yf-vignette">
      <RegionArt
        id={vignetteArtFor(name)}
        ratio="1:1"
        sizes="(max-width: 640px) 132px, 168px"
        scrim={false}
        fallback={<div className="yf-vignette-floor">{fallback}</div>}
      />
    </div>
  )
}
