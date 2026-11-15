import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { POST_CAPTION_MAX, POST_LIMIT, POST_URL_MAX, POST_URL_RE } from '../src/lib/creatorPosts'

// The G8 SQL is a draft that no test executes. This file is the one automated
// link between it and the client: the same hosts, the same path class and the
// same limits. A change on one side fails here until the other side follows.
const sql = readFileSync(new URL('../supabase/migrations/20261117_creator_post_links.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const hostsOf = (pattern: string) => {
  const match = /\^https:\\?\/\\?\/\(([^)]*)\)/.exec(pattern)
  if (!match) throw new Error('No host list found')
  return match[1].split('|').map(host => host.replace(/\\/g, '')).sort()
}

describe('post links: client and SQL agree', () => {
  it('lists the same hosts and the same path class', () => {
    const urlCheck = /url ~ '([^']*)'/.exec(sql)
    expect(urlCheck).not.toBeNull()
    const sqlPattern = urlCheck?.[1] ?? ''
    expect(hostsOf(sqlPattern)).toEqual(hostsOf(POST_URL_RE.source))
    expect(sqlPattern.endsWith('(/[!-~]*)?$')).toBe(true)
    expect(POST_URL_RE.source.endsWith('(\\/[!-~]*)?$')).toBe(true)
  })
  it('uses the same limits', () => {
    expect(sql).toContain(`char_length(url) <= ${POST_URL_MAX}`)
    expect(sql).toContain(`char_length(caption) <= ${POST_CAPTION_MAX}`)
    expect(sql).toContain(`v_count >= ${POST_LIMIT}`)
    expect(sql).toContain(`at most ${POST_LIMIT} post links`)
  })
  it('derives the same platform for each host', () => {
    expect(sql).toContain("kind = 'instagram' and url ~ '^https://(www\\.)?instagram\\.com(/|$)'")
    expect(sql).toContain("kind = 'youtube' and url ~ '^https://((www\\.|m\\.)?youtube\\.com|youtu\\.be)(/|$)'")
    expect(sql).toContain("kind = 'threads' and url ~ '^https://(www\\.)?threads\\.net(/|$)'")
  })
  it('keeps client writes to the granted columns', () => {
    expect(sql).toContain('grant insert (creator, url, kind, pub_id, day_index, caption) on public.creator_posts to authenticated;')
    expect(sql).toContain('grant update (caption) on public.creator_posts to authenticated;')
  })
})
