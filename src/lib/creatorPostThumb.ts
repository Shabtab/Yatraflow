// ============ Creator post thumbnails ============
// A post card can show a still image without a call to the platform: YouTube
// serves a public thumbnail for every video id. The rules below read the id out
// of a link the app already accepts (see creatorPosts.POST_URL_RE) and keep the
// same posture: https only, allowlisted hosts, exact id. Instagram and Threads
// have no public thumbnail without an API key, so both return null.
//
// Nothing here fetches a page. The caller builds an <img> source only.

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS: ReadonlySet<string> = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'])
const SHORT_HOST = 'youtu.be'
const PATH_KINDS: ReadonlySet<string> = new Set(['shorts', 'embed', 'live'])
const THUMB_BASE = 'https://i.ytimg.com/vi/'
const THUMB_NAME = '/hqdefault.jpg'

/** The path segments with empty ones removed, so a trailing slash is harmless. */
function pathSegments(pathname: string): string[] {
  return pathname.split('/').filter(segment => segment.length > 0)
}

/**
 * The 11 character video id of a YouTube link, or null.
 * Shapes: /watch?v=ID, /shorts/ID, /embed/ID, /live/ID and youtu.be/ID.
 * Extra query parameters are ignored; a host that only looks like YouTube is not.
 */
export function youtubeVideoId(url: string): string | null {
  if (typeof url !== 'string') return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.port !== '') return null
  if (!YOUTUBE_HOSTS.has(parsed.hostname)) return null
  const segments = pathSegments(parsed.pathname)
  if (parsed.hostname === SHORT_HOST) {
    return segments.length === 1 && VIDEO_ID_RE.test(segments[0]) ? segments[0] : null
  }
  if (segments.length === 1 && segments[0] === 'watch') {
    const id = parsed.searchParams.get('v')
    return id !== null && VIDEO_ID_RE.test(id) ? id : null
  }
  if (segments.length === 2 && PATH_KINDS.has(segments[0])) {
    return VIDEO_ID_RE.test(segments[1]) ? segments[1] : null
  }
  return null
}

/** The static thumbnail of a YouTube link, or null when the link gives no video id. */
export function youtubeThumbUrl(url: string): string | null {
  const id = youtubeVideoId(url)
  return id === null ? null : `${THUMB_BASE}${id}${THUMB_NAME}`
}
