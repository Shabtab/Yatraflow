import type { PublishedItinerary } from '../../data/types'
import { POST_KIND_LABEL, type PostsRead, type PostVisitsRead } from '../../lib/creatorPosts'
import { StateBlock } from '../page/StateBlock'
import { CrMeterRow } from './CrMeterRow'
import { CrSectionHead } from './CrSectionHead'

/** H-11 "Posts bringing visits": page visits that came through each post's tagged
 *  link over the hub's window. The posts read and the visits read each have their
 *  own failed and loading state, and an empty list is different from zero visits. */
export function HubPostVisits({ posts, visits, pubs, windowLabel, retry }: {
  posts: PostsRead
  visits: PostVisitsRead
  pubs: readonly PublishedItinerary[]
  windowLabel: string
  retry: () => void
}) {
  const head = <>
    <CrSectionHead title="Posts bringing visits" id="hub-post-visits-h" as="h2" />
    <p className="cr-tile__note">Page visits through each post's tagged link · {windowLabel}</p>
  </>
  const again = <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>Try again</button>
  let body
  if (posts.kind === 'failed' || visits.kind === 'failed') {
    body = <StateBlock kind="failed" size="compact" title="Could not load post visits" actions={again} />
  } else if (posts.kind === 'reading' || visits.kind === 'reading') {
    body = <StateBlock kind="loading" size="compact" title="Loading post visits" />
  } else if (posts.value.length === 0) {
    body = <StateBlock kind="empty" size="compact" title="No post links yet" body="Add a post link in the Profile tab, then share its tagged link." />
  } else {
    const count = new Map(visits.value.map(row => [row.postId, row.visits]))
    const rows = posts.value.map(post => ({ post, visits: count.get(post.id) ?? 0 }))
      .sort((a, b) => b.visits - a.visits || b.post.createdAt - a.post.createdAt)
    const max = Math.max(1, ...rows.map(row => row.visits))
    body = <>
      {rows.map(({ post, visits: n }) => <CrMeterRow key={post.id} tone="route"
        label={POST_KIND_LABEL[post.kind]}
        value={n} pct={n / max * 100}
        note={`${post.caption ?? 'No caption'} · ${pubs.find(pub => pub.id === post.pubId)?.title ?? 'Unknown route'}`} />)}
      <p className="cr-tile__note">Counts only visits that used the tagged link.</p>
    </>
  }
  return <section className="cr-card cr-hub-post-visits" aria-labelledby="hub-post-visits-h">{head}{body}</section>
}
