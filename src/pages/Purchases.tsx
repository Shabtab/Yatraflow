// ============ My purchases (ROADMAP I-20) ============
// The shelf the research asks for: what you own, from whom, what you paid and
// whether its creator has touched it since. Ownership has to live somewhere
// visible — a bought plan that dissolves into the same list as your own trips
// reads as though it evaporated.
//
// Two deliberate choices, both about honesty:
//   * Entitlements are read here on mount rather than carried in the hydrate
//     cache (see lib/unlock.ts for why they stay out), and the read is the
//     STRICT one: a failed request must not render as "nothing bought yet",
//     which would tell a paying customer they own nothing.
//   * Every price shown is the entitlement's own snapshot, never the
//     publication's price today — a creator raising their price does not
//     retroactively change what you paid.
import { useEffect, useMemo, useState } from 'react'
import { InlineIcon } from '../components/icons'
import { ArrowLeft, Share2, ShoppingBag } from 'lucide-react'
import { usePublished, useUsers, useSessionUserId } from '../store/store'
import { fetchMyPurchases } from '../lib/unlock'
import { buildPurchaseShelf, purchaseShareable } from '../lib/purchases'
import { sharePurchase } from '../lib/purchaseShare'
import { forkPublication } from '../lib/forkPub'
import { CoverThumb } from '../components/CoverThumb'
import { Chip, EmptyState, toast } from '../components/ui'
import { formatInr } from '../lib/engine'
import type { Entitlement } from '../lib/payments'

/** "12 Sep 2026" — the same en-IN shape the plan bench and the print view use.
 *  A grant date that could not be read says so: "Invalid Date" is a developer
 *  string leaking into a receipt, and a wrong date is worse than an absent one. */
function boughtOn(ms: number, readable: boolean): string {
  if (!readable) return 'date unknown'
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "Sep 2026" — an update is a season, not a timestamp, on a shelf. */
function updatedIn(ms: number): string {
  return new Date(ms).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

export function PurchasesPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const pubs = usePublished()
  const users = useUsers()
  const meId = useSessionUserId()
  const [entitlements, setEntitlements] = useState<Entitlement[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!meId) { setEntitlements([]); setFailed(false); return }
    let alive = true
    setEntitlements(null)
    setFailed(false)
    void fetchMyPurchases(meId)
      .then(rows => { if (alive) setEntitlements(rows) })
      .catch(() => { if (alive) { setFailed(true); setEntitlements([]) } })
    return () => { alive = false }
  }, [meId, attempt])

  const shelf = useMemo(() => buildPurchaseShelf(entitlements ?? [], pubs, users), [entitlements, pubs, users])

  function fork(rowPubId: string) {
    const pub = pubs.find(p => p.id === rowPubId)
    if (!pub) { toast('That plan is no longer listed, so there is nothing to fork.', 'err'); return }
    void forkPublication(pub, meId, onNavigate)
  }

  return (
    <div className="container purchases-page">
      <div className="purchases-head">
        <button className="btn btn-ghost" onClick={() => onNavigate('/trips')}>
          <InlineIcon icon={ArrowLeft} size={14} gap={4} />My trips
        </button>
      </div>

      <h1 className="purchases-title">My purchases</h1>
      <p className="hint-text purchases-lede">
        Plans you unlocked, kept here for good — with what you paid, what is inside, and any update from
        the person who made them.
      </p>

      {!meId ? (
        <EmptyState icon={<ShoppingBag size={38} aria-hidden />} title="Sign in to see what you own"
          body="Purchases are tied to your account, so they follow you to any device you sign in on."
          action={<button className="btn btn-primary" onClick={() => onNavigate('/auth')}>Sign in</button>} />
      ) : failed ? (
        <div className="card purchases-error">
          <h2>Couldn’t load your purchases</h2>
          <p className="hint-text">
            The request failed, which is not the same as owning nothing — your plans are safe on your account.
            Check your connection and try again.
          </p>
          <button className="btn btn-primary" onClick={() => setAttempt(n => n + 1)}>Try again</button>
        </div>
      ) : entitlements === null ? (
        <div className="loading-block"><div className="spinner" />Loading your purchases…</div>
      ) : shelf.rows.length === 0 ? (
        <EmptyState icon={<ShoppingBag size={38} aria-hidden />} title="Nothing bought yet"
          body="Unlock a priced itinerary and it appears here permanently — with the price you paid and any later updates. Free previews you fork live in My trips."
          action={<button className="btn btn-primary" onClick={() => onNavigate('/explore')}>Browse itineraries</button>} />
      ) : (
        <>
          <p className="purchases-sum">
            <b>{shelf.rows.length}</b> {shelf.rows.length === 1 ? 'plan' : 'plans'} ·{' '}
            {shelf.totalReadable ? (
              <><b>{formatInr(shelf.totalPaidInr)}</b> paid</>
            ) : (
              // A partial sum printed as the total is the same lie as a wrong
              // one: it reads as complete. Say the figure is incomplete instead.
              <>at least <b>{formatInr(shelf.totalPaidInr)}</b> paid</>
            )}
            {shelf.updatedCount > 0 && <> · <b>{shelf.updatedCount}</b> updated since you bought {shelf.updatedCount === 1 ? 'it' : 'them'}</>}
          </p>
          {!shelf.totalReadable && (
            <p className="hint-text">
              One or more purchases could not be read back, so this total is a floor rather than the
              whole amount. Your plans are unaffected — the price is just not showing.
            </p>
          )}

          <div className="purchase-list">
            {shelf.rows.map(row => (
              <article className="purchase-row" key={row.pubId}>
                <div className="purchase-thumb">
                  <CoverThumb variant="short" explicitUrl={row.coverImageUrl} trip={{ name: row.title }} emoji="🧭" />
                </div>
                <div className="purchase-body">
                  <h2 className="purchase-name">{row.title}</h2>
                  <p className="purchase-by">
                    {row.creatorName ? <>by <b>{row.creatorName}</b></> : <>creator no longer listed</>}
                    {' · '}bought {boughtOn(row.grantedAt, row.dateReadable)}
                  </p>
                  <div className="purchase-meta">
                    {row.durationDays > 0 && <Chip>{row.durationDays} days</Chip>}
                    {row.places > 0 && <Chip>{row.places} places</Chip>}
                    {row.amountReadable
                      ? <Chip tone="saffron">{formatInr(row.amountPaidInr)} paid</Chip>
                      // "₹0 paid" would be a claim that this plan was free. It
                      // was not — the price simply could not be read.
                      : <Chip tone="saffron">price unavailable</Chip>}
                    {row.updatedSince && row.refreshedAt && (
                      <Chip tone="info">Updated {updatedIn(row.refreshedAt)}</Chip>
                    )}
                  </div>
                  {!row.listed && (
                    <p className="hint-text">
                      This plan is not listed publicly any more — your access and your copy are unaffected.
                    </p>
                  )}
                  <div className="purchase-actions">
                    <button className="btn btn-primary" onClick={() => onNavigate(`/pub/${row.pubId}`)}>Open the plan</button>
                    {row.listed && <button className="btn btn-ghost" onClick={() => fork(row.pubId)}>Fork into my trips</button>}
                    {/* ROADMAP I-21: the buyer's own card. Offered only while the
                        publication still exists — a withdrawn plan's link
                        previews as nothing, and handing someone a dead link to
                        post is worse than not offering it (purchaseShareable). */}
                    {purchaseShareable(row) && (
                      <button className="btn btn-ghost" onClick={() => void sharePurchase(row)}>
                        <InlineIcon icon={Share2} size={13} gap={4} />Share what you bought
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          <p className="hint-text purchases-foot">
            Forking copies a plan into your own trips with your dates — it stays yours even if the original
            is updated later.
          </p>
        </>
      )}
    </div>
  )
}
