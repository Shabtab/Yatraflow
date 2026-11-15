import type { PublishedItinerary } from '../../data/types'
import { appLink } from '../../lib/appLink'
import { POST_KIND_LABEL, postDayLabel, visiblePosts, type PostsRead } from '../../lib/creatorPosts'
import { CrSectionHead } from './CrSectionHead'
import { SocialIcon } from './SocialIcon'

/** F-39 "From the posts": the creator's public post links, each with the live
 *  route it belongs to. A visitor sees the section only when there is something
 *  to show. A failed read shows a visitor nothing; the owner gets a retry. */
export function StorePosts({ creatorName, posts, pubs, isOwner, retry }: {
  creatorName: string
  posts: PostsRead
  pubs: PublishedItinerary[]
  isOwner: boolean
  retry: () => void
}) {
  if (posts.kind === 'failed') {
    return isOwner ? <p className="container cr-store-posts-retry" role="status">
      Post links: Unavailable. <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>Retry post links</button>
    </p> : null
  }
  const rows = posts.kind === 'ready' ? posts.value : posts.previous
  const items = rows ? visiblePosts(rows, pubs) : []
  if (items.length === 0) return null
  return (
    <section className="container cr-store-posts" aria-labelledby="cr-store-posts-h">
      <CrSectionHead title="From the posts" id="cr-store-posts-h" note={`Posts ${creatorName} linked to these routes.`} />
      <ul className="cr-store-posts-list">
        {items.map(({ post, pub }) => {
          const label = POST_KIND_LABEL[post.kind]
          const day = postDayLabel(post, pub.durationDays)
          return (
            <li className="cr-store-post" key={post.id} data-kind={post.kind}>
              <a className="cr-store-post-link" href={post.url} target="_blank" rel="noopener noreferrer nofollow">
                <span className="cr-store-post-platform"><SocialIcon kind={post.kind} size={16} gap={6} />{label}</span>
                <span className="cr-store-post-caption">{post.caption ?? `${label} post`}</span>
                <span className="sr-only">Opens in a new tab</span>
              </a>
              <p className="cr-store-post-meta">{pub.title}{day ? ` · ${day}` : ''}</p>
              <a className="cr-store-post-route" {...appLink(`/pub/${pub.id}`)}>Open this route</a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
