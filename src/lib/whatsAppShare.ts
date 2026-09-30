// ============ Sending a published link on WhatsApp (ROADMAP F3 · #227) ============
// The distribution experiment is one message into a group the sender is
// already in, and the send unit is what this module owns: the address, the
// sentence, and the fallback chain. The CARD that lands at the other end is
// the server's job (api/i.js renders the publication's own Open Graph tags) —
// this only puts a good address in someone's hands.
//
// The fallback order is the one `lib/purchaseShare.ts` established: the
// system share sheet first (on a phone it lists WhatsApp directly, and the
// message is identical either way), then WhatsApp's own click-to-chat. Two
// rules from the crew-channels pass shape the second step:
//   - §6e — a window opened with the `noopener` feature ALWAYS returns null.
//     The moment-after screen's "Send invite" read that null as
//     popup-blocked and therefore never once opened WhatsApp. Nothing here
//     reads the return; the link also lands in the clipboard so a blocked
//     popup is still a usable share.
//   - §6a — the caller holds the button disabled while this resolves (the
//     #409 shelf pattern); this module is async and never throws.

import { nativeCopyText, nativeShareText, openExternal } from './native'
import { currentPublicShareUrl, publicationShareMessage, type ShareSource } from './shareUrl'
import { toast } from '../components/ui'

/** WhatsApp's click-to-chat with the message pre-filled. Pure so the
 *  encoding is pinned rather than eyeballed — the message carries a URL, and
 *  `&`/spaces in it must survive into the chat box. */
export function whatsAppSendUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/** Offer the publication to a WhatsApp group. Resolves true when the link
 *  reached somewhere the visitor can paste it — the sheet, or the clipboard
 *  beside the click-to-chat tab.
 *
 *  `ref` is the channel this send counts for (F7 · #228): the send unit's own
 *  channel by default, or the post's reference when the sharing visitor
 *  arrived through one. It travels on the LINK, never in the sentence — the
 *  message stays its one honest clause. Vocabulary-checked: only a
 *  ShareSource reaches the address, so the stored log can never hold a
 *  stranger's sentence. */
export async function sharePublicationOnWhatsApp(pub: { id: string; title: string }, ref: ShareSource | null = 'wa'): Promise<boolean> {
  const url = currentPublicShareUrl(pub.id, ref)
  const text = publicationShareMessage(pub.title, url)
  if (await nativeShareText({ text, title: pub.title, url }) === 'shared') return true
  // No sheet (most desktops): WhatsApp's click-to-chat with the same
  // sentence. Opened fire-and-forget — the return is null by construction,
  // so the fallback's honesty is the clipboard, not a guess about the tab.
  openExternal(whatsAppSendUrl(text))
  const copied = await nativeCopyText(url)
  toast(copied
    ? 'Opening WhatsApp — the link is copied too, in case the chat does not open'
    : 'Opening WhatsApp — if nothing opened, copy the link from this page.')
  return copied
}
