// URLs of the generated illustration files. Vite hashes each file, so the
// URLs are safe to cache. Pure module: no React.
//
// Files are found by name, not by manifest, so a file that is missing from
// the build simply has no URL. Callers must handle undefined.

export type ArtFormat = 'avif' | 'webp'

const FILE_URLS = import.meta.glob('../assets/art/*.{avif,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const urlByName = new Map<string, string>()
for (const [filePath, url] of Object.entries(FILE_URLS)) {
  urlByName.set(filePath.slice(filePath.lastIndexOf('/') + 1), url)
}

/** URL of one generated file, or undefined when the build has no such file. */
export function artUrl(id: string, width: number, format: ArtFormat = 'avif'): string | undefined {
  return urlByName.get(`${id}-${width}.${format}`)
}

/** A srcset value such as "a-320.avif 320w, a-640.avif 640w". Missing widths are skipped. */
export function srcsetFor(id: string, widths: readonly number[], format: ArtFormat = 'avif'): string {
  return widths
    .map(width => {
      const url = artUrl(id, width, format)
      return url ? `${url} ${width}w` : null
    })
    .filter((entry): entry is string => entry !== null)
    .join(', ')
}
