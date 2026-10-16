import campaigns from '../data/growthCampaigns.json'
import { shareRefFromSearch, type ShareSource } from './shareUrl'
import { randomToken } from './randomId'

/** These fixed pilot slots contain no participant identities. Never reuse a slot for another pilot. */
export const PILOT_CAMPAIGNS = campaigns
export type CampaignId = keyof typeof campaigns
export const TRIP_CREATION_KINDS = ['created', 'forked', 'copied', 'imported', 'demo'] as const
export type TripCreationKind = typeof TRIP_CREATION_KINDS[number]

export function campaignId(value: unknown): CampaignId | null {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(campaigns, value) ? value as CampaignId : null
}

export function campaignFromSearch(search: string): CampaignId | null {
  const values = new URLSearchParams(search.split('#')[0]).getAll('campaign')
  return values.length === 1 ? campaignId(values[0]) : null
}

export function withCampaign(url: string, value: unknown): string {
  const id = campaignId(value)
  if (!id) return url
  const [base, ...hash] = url.split('#')
  const query = base.includes('?') ? base.slice(base.indexOf('?') + 1) : ''
  if (new URLSearchParams(query).has('campaign')) return url
  return `${base}${base.includes('?') ? '&' : '?'}campaign=${id}${hash.length ? `#${hash.join('#')}` : ''}`
}

export interface ForkAttribution { source: ShareSource | null; campaign: CampaignId | null }
export interface ForkOrigin { publicationId: string; campaign?: CampaignId | null; requestId: string }
const PENDING_KEY = 'yf.pending-publication-fork'
const MAX_AGE = 30 * 60 * 1000
const pendingIds = new Map<string, string>()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A pending action keeps its ID through retries and refreshes in this tab. */
export function pendingForkId(ownerId: string, pubId: string): string {
  const key = `yf.pending-fork:${ownerId}:${pubId}`
  const held = pendingIds.get(key)
  if (held) return held
  let id: string | null = null
  try { id = sessionStorage.getItem(key) } catch { /* Use memory when storage is denied. */ }
  if (!id || !UUID.test(id)) {
    // The shared generator also works in browser contexts without randomUUID.
    const hex = randomToken(16)
    const variant = ((parseInt(hex[16], 16) & 3) | 8).toString(16)
    id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20)}`
  }
  pendingIds.set(key, id)
  try { sessionStorage.setItem(key, id) } catch { /* The memory copy still supports retries. */ }
  return id
}

export function finishPendingFork(ownerId: string, pubId: string): void {
  const key = `yf.pending-fork:${ownerId}:${pubId}`
  pendingIds.delete(key)
  try { sessionStorage.removeItem(key) } catch { /* Storage is optional. */ }
  takeForkAttribution(pubId)
}

/** Keep only the explicit fork's public context through sign-in. No visitor identity or private trip data is stored. */
export function rememberFork(pubId: string, attribution: ForkAttribution): void {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ pubId, ...attribution, at: Date.now() })) }
  catch { /* A denied storage API must not block sign-in. */ }
}

export function takeForkAttribution(pubId: string, consume = true): ForkAttribution | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const value = JSON.parse(raw)
    if (!value || typeof value.at !== 'number' || Date.now() - value.at > MAX_AGE || value.at > Date.now()) {
      sessionStorage.removeItem(PENDING_KEY)
      return null
    }
    if (value.pubId !== pubId) return null
    if (consume) sessionStorage.removeItem(PENDING_KEY)
    return {
      source: shareRefFromSearch(`?ref=${encodeURIComponent(value.source ?? '')}`),
      campaign: campaignId(value.campaign),
    }
  } catch { return null }
}

export function clearCampaignFromLocation(): void {
  if (typeof window === 'undefined' || !campaignFromSearch(window.location.search)) return
  const params = new URLSearchParams(window.location.search)
  params.delete('campaign')
  const query = params.toString()
  history.replaceState(history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
}
