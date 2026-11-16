import { describe, expect, it } from 'vitest'
import { postThumbnailUrl, youtubeThumbUrl, youtubeVideoId } from '../src/lib/creatorPostThumb'

const ID = 'dQw4w9WgXcQ'
const THUMB = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'

describe('post thumbnail choice', () => {
  const post = { kind: 'youtube', url: `https://youtu.be/${ID}` }
  it('shows a valid YouTube thumbnail until that URL fails', () => {
    expect(postThumbnailUrl(post)).toBe(THUMB)
    expect(postThumbnailUrl(post, post.url)).toBeNull()
    expect(postThumbnailUrl(post, 'https://youtu.be/another0001')).toBe(THUMB)
  })
  it('keeps other platforms and invalid links as text cards', () => {
    for (const kind of ['instagram', 'threads']) expect(postThumbnailUrl({ ...post, kind })).toBeNull()
    expect(postThumbnailUrl({ ...post, url: 'https://youtu.be/invalid' })).toBeNull()
  })
})

describe('youtubeVideoId', () => {
  it('reads /watch?v=', () => {
    expect(youtubeVideoId(`https://youtube.com/watch?v=${ID}`)).toBe(ID)
  })

  it('reads /watch?v= on www', () => {
    expect(youtubeVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID)
  })

  it('reads /watch?v= on m', () => {
    expect(youtubeVideoId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID)
  })

  it('reads /shorts/', () => {
    expect(youtubeVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID)
  })

  it('reads /embed/', () => {
    expect(youtubeVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID)
  })

  it('reads /live/', () => {
    expect(youtubeVideoId(`https://www.youtube.com/live/${ID}`)).toBe(ID)
  })

  it('reads youtu.be', () => {
    expect(youtubeVideoId(`https://youtu.be/${ID}`)).toBe(ID)
  })

  it('ignores extra query parameters', () => {
    expect(youtubeVideoId(`https://www.youtube.com/watch?v=${ID}&t=42&si=AbCdEf`)).toBe(ID)
  })

  it('accepts a trailing slash on a short link', () => {
    expect(youtubeVideoId(`https://youtu.be/${ID}/`)).toBe(ID)
  })

  it('refuses http', () => {
    expect(youtubeVideoId(`http://www.youtube.com/watch?v=${ID}`)).toBeNull()
  })

  it('refuses a lookalike host', () => {
    expect(youtubeVideoId(`https://youtube.com.evil.com/watch?v=${ID}`)).toBeNull()
  })

  it('refuses a 10 character id', () => {
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXc')).toBeNull()
  })

  it('refuses a 12 character id', () => {
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQQ')).toBeNull()
  })

  it('refuses a playlist without v', () => {
    expect(youtubeVideoId('https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI')).toBeNull()
  })

  it('refuses a watch link without v', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch')).toBeNull()
  })

  it('refuses an id with a dot', () => {
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXc.')).toBeNull()
  })

  it('refuses an Instagram link', () => {
    expect(youtubeVideoId('https://www.instagram.com/p/Cabcdef1234/')).toBeNull()
  })

  it('refuses a Threads link', () => {
    expect(youtubeVideoId('https://www.threads.net/@creator/post/Cabcdef1234')).toBeNull()
  })
})

describe('youtubeThumbUrl', () => {
  it('builds the static thumbnail', () => {
    expect(youtubeThumbUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(THUMB)
  })

  it('builds the same thumbnail from a short link', () => {
    expect(youtubeThumbUrl(`https://youtu.be/${ID}`)).toBe(THUMB)
  })

  it('returns null for a bad link', () => {
    expect(youtubeThumbUrl(`http://www.youtube.com/watch?v=${ID}`)).toBeNull()
  })

  it('returns null for Instagram and Threads', () => {
    expect(youtubeThumbUrl('https://www.instagram.com/p/Cabcdef1234/')).toBeNull()
    expect(youtubeThumbUrl('https://www.threads.net/@creator/post/Cabcdef1234')).toBeNull()
  })
})
