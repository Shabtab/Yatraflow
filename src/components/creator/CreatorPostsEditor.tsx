import { useState } from 'react'
import type { PrivateUser, PublishedItinerary } from '../../data/types'
import {
  POST_CAPTION_MAX, POST_KIND_LABEL, POST_LIMIT, POST_TIMEOUT_MS, checkPostCaption, checkPostDraft, postDayLabel,
  type CreatorPost, type CreatorPostsApi, type PostsRead,
} from '../../lib/creatorPosts'
import { livePubs } from '../../lib/livePubs'
import type { ReadState } from '../../lib/readState'
import { currentCreatorPostShareUrl } from '../../lib/shareUrl'
import { CopyButton, Field } from '../ui'
import { SocialIcon } from './SocialIcon'

const NOT_SAVED = 'The change was not saved. Try again.'

/** G8 owner editor: add a post link, edit its caption, remove it, copy its tagged
 *  link. Every write names its own pending, failed and saved state, like the
 *  creator picks editor. The list comes from the read the hub already holds. */
export function CreatorPostsEditor({ me, pubs, pubsRead, posts, api, onChanged, onRetry }: {
  me: PrivateUser
  pubs: PublishedItinerary[]
  pubsRead: ReadState
  posts: PostsRead
  api: CreatorPostsApi
  onChanged: () => void
  onRetry: () => void
}) {
  const [url, setUrl] = useState('')
  const [pubId, setPubId] = useState('')
  const [day, setDay] = useState('')
  const [caption, setCaption] = useState('')
  const [captions, setCaptions] = useState<Record<string, string>>({})
  const [removing, setRemoving] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const live = livePubs(pubs).filter(pub => pub.creatorId === me.id)
  const chosen = live.find(pub => pub.id === pubId)
  const rows = posts.kind === 'ready' ? posts.value : posts.kind === 'reading' ? posts.previous : undefined
  const writable = posts.kind === 'ready' && busy === null

  async function run(key: string, work: (signal: AbortSignal) => Promise<void>, ok: string) {
    if (busy !== null) return
    setBusy(key)
    setFeedback(null)
    try {
      await work(AbortSignal.timeout(POST_TIMEOUT_MS))
      setFeedback({ kind: 'ok', text: ok })
      onChanged()
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error && /already on your list/.test(error.message) ? error.message : NOT_SAVED })
    } finally { setBusy(null) }
  }

  function add() {
    const check = checkPostDraft({ url, pubId, dayIndex: day === '' ? null : Number(day), caption }, me.id, pubs, rows ?? [])
    if (!check.ok) { setFeedback({ kind: 'error', text: check.error }); return }
    void run('add', async signal => {
      await api.add(check.value, signal)
      setUrl(''); setDay(''); setCaption('')
    }, 'Post link added.')
  }

  function saveCaption(post: CreatorPost) {
    const check = checkPostCaption(captions[post.id] ?? post.caption ?? '')
    if (!check.ok) { setFeedback({ kind: 'error', text: check.error }); return }
    void run(post.id, async signal => {
      await api.setCaption(post.id, me.id, check.value, signal)
      setCaptions(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== post.id)))
    }, 'Caption saved.')
  }

  function remove(post: CreatorPost) {
    if (removing !== post.id) { setRemoving(post.id); return }
    setRemoving(null)
    void run(post.id, signal => api.remove(post.id, me.id, signal), 'Post link removed.')
  }

  const routeTitle = (post: CreatorPost) => pubs.find(pub => pub.id === post.pubId)
  return <div className="cr-own-posts">
    <h3>Post links</h3>
    <p className="hint-text">Link a public Instagram, YouTube or Threads post to one of your live routes. Visitors see it under "From the posts". You can keep up to {POST_LIMIT}.</p>
    {posts.kind === 'reading' && !rows && <p role="status">Post links: Loading…</p>}
    {posts.kind === 'failed' && <p role="alert">Post links: Unavailable. <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>Retry post links</button></p>}
    {rows && rows.length === 0 && <p className="cr-own-posts-empty">No post links yet.</p>}
    {rows && rows.length > 0 && <ul className="cr-own-posts-list">
      {rows.map(post => {
        const pub = routeTitle(post)
        const isLive = pub !== undefined && livePubs([pub]).length === 1
        const draft = captions[post.id] ?? post.caption ?? ''
        const rowBusy = busy === post.id
        return <li className="cr-own-post" key={post.id}>
          <p className="cr-own-post-head">
            <SocialIcon kind={post.kind} size={16} gap={6} />
            <a href={post.url} target="_blank" rel="noopener noreferrer nofollow">{POST_KIND_LABEL[post.kind]}</a>
            <span>{pub?.title ?? 'Unknown route'}{pub && postDayLabel(post, pub.durationDays) ? ` · ${postDayLabel(post, pub.durationDays)}` : ''}</span>
          </p>
          <p className="cr-own-post-url">{post.url}</p>
          {!isLive && <p className="cr-own-post-note" role="status">Hidden from visitors: this route is not live.</p>}
          <Field label="Caption">
            <input className="input" value={draft} disabled={!writable}
              onChange={event => { setCaptions(current => ({ ...current, [post.id]: event.target.value })); setFeedback(null) }} />
          </Field>
          <div className="cr-own-post-actions">
            <button type="button" className="btn btn-outline btn-sm" disabled={!writable || draft === (post.caption ?? '')}
              onClick={() => saveCaption(post)}>{rowBusy ? 'Saving…' : 'Save caption'}</button>
            <CopyButton text={currentCreatorPostShareUrl(me.id, post.id)} label="Copy tagged link" />
            <button type="button" className="btn btn-ghost btn-sm" disabled={!writable} onClick={() => remove(post)}>
              {removing === post.id ? 'Confirm remove' : 'Remove'}
            </button>
          </div>
        </li>
      })}
    </ul>}
    {posts.kind === 'ready' && rows && rows.length < POST_LIMIT && <div className="cr-own-posts-add">
      <h4>Add a post link</h4>
      {pubsRead !== 'ready' && <p role="status">Routes: {pubsRead === 'failed' ? 'Unavailable' : 'Loading…'}</p>}
      <Field label="Post link"><input className="input" type="url" inputMode="url" value={url} disabled={!writable}
        placeholder="https://www.instagram.com/reel/…" onChange={event => { setUrl(event.target.value); setFeedback(null) }} /></Field>
      <div className="form-row">
        <Field label="Route">
          <select className="input" value={pubId} disabled={!writable || pubsRead !== 'ready'}
            onChange={event => { setPubId(event.target.value); setDay(''); setFeedback(null) }}>
            <option value="">Choose a live route</option>
            {live.map(pub => <option key={pub.id} value={pub.id}>{pub.title}</option>)}
          </select>
        </Field>
        <Field label="Day">
          <select className="input" value={day} disabled={!writable || !chosen} onChange={event => { setDay(event.target.value); setFeedback(null) }}>
            <option value="">Whole route</option>
            {Array.from({ length: chosen?.durationDays ?? 0 }, (_, index) => <option key={index} value={index}>Day {index + 1}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Caption (optional)" hint={`Up to ${POST_CAPTION_MAX} characters.`}>
        <input className="input" value={caption} disabled={!writable} onChange={event => { setCaption(event.target.value); setFeedback(null) }} />
      </Field>
      <button type="button" className="btn btn-primary btn-sm" disabled={!writable} onClick={add}>{busy === 'add' ? 'Adding…' : 'Add post link'}</button>
    </div>}
    {rows && rows.length >= POST_LIMIT && <p className="cr-own-posts-empty">You have {POST_LIMIT} post links. Remove one to add another.</p>}
    {feedback && <p className="cr-own-posts-feedback" data-kind={feedback.kind} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.text}</p>}
  </div>
}
