// P5 Trip created: the honesty of its states (ruling R23), as pure decisions.
//
// The page's reads each reduce to one view, and its writes each reduce to one
// status. A read that fails must never look like empty data, and a write must
// never report success before it has a result. The page imports these, so the
// rules below are the ones it actually follows.

/** The views a read on this page can take. `failed` is its own view: it is never
 *  folded into `empty`, because an unread forecast is not a dry week. */
export type ReadView = 'reading' | 'rows' | 'failed' | 'empty'

/** The view a read renders, from its three inputs.
 *  - `failed` when the read failed, whatever the rows hold. A failure wins over
 *    an empty result: the page cannot say what it did not read.
 *  - `reading` while the read is in flight and nothing has arrived yet.
 *  - `rows` when the read succeeded and returned something.
 *  - `empty` when the read succeeded and returned nothing. */
export function createdReadView(read: { loading: boolean; failed: boolean; rows: number }): ReadView {
  if (read.failed) return 'failed'
  if (read.loading) return 'reading'
  if (read.rows > 0) return 'rows'
  return 'empty'
}

/** The status a crew row shows after a send. `opened` means the channel window
 *  really opened, `copied` means the clipboard write resolved, and `blocked`
 *  means the browser refused the window - the row must not read as sent, and the
 *  message is on the page to copy. `idle` is the state before a send, and after a
 *  refused clipboard write. */
export type InviteRowStatus = 'idle' | 'opened' | 'blocked' | 'copied'

export function inviteRowStatus(attempt: { opened?: boolean; blocked?: boolean; copied?: boolean } | null): InviteRowStatus {
  if (!attempt) return 'idle'
  if (attempt.opened) return 'opened'
  if (attempt.blocked) return 'blocked'
  if (attempt.copied) return 'copied'
  return 'idle'
}

/** The invite link, or null when there is none. A missing join code must never
 *  fall back to the bare site origin: that link joins nothing. */
export function createdInviteUrl(origin: string, code: string | null): string | null {
  if (!code) return null
  return `${origin}/join/${code}`
}

/** Whether the send actions may run. With no link there is no invite to send. */
export function createdCanSend(joinUrl: string | null): boolean {
  return joinUrl != null && joinUrl !== ''
}
