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
import { usePublished, useUsers, useSessionUserId, useTrips } from '../store/store'
import { fetchMyOrders, fetchMyPurchases } from '../lib/unlock'
import { buildPurchaseShelf, purchaseShareable, findBuyerCopy } from '../lib/purchases'
import { sharePurchase } from '../lib/purchaseShare'
import { forkPublication } from '../lib/forkPub'
import { CoverThumb } from '../components/CoverThumb'
import { Chip, EmptyState, toast } from '../components/ui'
import { formatInr } from '../lib/engine'
import type { Entitlement, PurchaseOrder } from '../lib/payments'

/** "12 Sep 2026" — the same en-IN shape the plan bench and the print view use.
 *  A grant date that could not be read says so: "Invalid Date" is a developer
 *  string leaking into a receipt, and a wrong date is worse than an absent one.
 *
 *  #409 — formatted in **UTC**, because `toLocaleDateString` alone reads the
 *  BROWSER's timezone: a grant at 23:30 UTC was "yesterday" in IST and "today"
 *  in the US, so the same receipt carried two dates depending on where the buyer
 *  opened it. A purchase date is a fact about the account, not about the reader,
 *  and a money-adjacent date is the last one that should move under someone.
 *  Day granularity is unchanged — only the timezone is pinned. */
function boughtOn(ms: number, readable: boolean): string {
  if (!readable) return 'date unknown'
  return new Date(ms).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

/** "Sep 2026" — an update is a season, not a timestamp, on a shelf.
 *
 *  #409 asked whether two same-month updates collapsing is a defect; it is a
 *  deliberate granularity, recorded here so the next reader does not "fix" it.
 *  The month is the unit a buyer acts on ("did this change since I bought it,
 *  roughly when"), the exact instant is not, and the shelf's `updatedCount`
 *  counts ROWS rather than versions to match — the two are consistent, which is
 *  the property that matters. A day-granular date would read as a changelog
 *  this surface is not. (Also UTC for the same reason as `boughtOn`: a month
 *  label that flips between readers is the same bug one unit up.) */
function updatedIn(ms: number): string {
  return new Date(ms).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function PurchasesPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const pubs = usePublished()
  const users = useUsers()
  const meId = useSessionUserId()
  // The buyer's own trips, so a withdrawn plan can point at the copy they
  // forked instead of at a page that no longer exists (#405).
  const trips = useTrips()
  const [entitlements, setEntitlements] = useState<Entitlement[] | null>(null)
  /** #407 — the buyer's ORDERS: the money state, and the only row that survives
   *  a refund (the entitlement is deleted). Read alongside the entitlements in
   *  the same attempt, so the shelf can render a refunded purchase as a receipt
   *  instead of losing it. */
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  /** #409 — which row's share is in flight. `sharePurchase` opens a sheet (and
   *  can await the card build), so a double-tap used to open two of them: the
   *  same in-flight-guard rule the unlock buttons follow (payments-wiring). One
   *  id rather than a boolean, so only the row that was clicked goes busy. */
  const [sharingId, setSharingId] = useState<string | null>(null)

  useEffect(() => {
    if (!meId) { setEntitlements([]); setOrders([]); setFailed(false); return }
    let alive = true
    setEntitlements(null)
    setOrders(null)
    setFailed(false)
    // BOTH reads, one attempt, one error state (#407). They are two halves of one
    // answer — what you own and what you paid — so a shelf built from one of them
    // is not a partial shelf, it is a wrong one: entitlements alone lose every
    // refunded purchase, and orders alone lose every grant. A failure of either
    // is therefore a failure of the shelf, and `Promise.all` makes that the
    // literal shape of the code rather than a rule someone has to remember.
    void Promise.all([
      fetchMyPurchases(meId).then(rows => { if (alive) setEntitlements(rows) }),
      fetchMyOrders(meId).then(rows => { if (alive) setOrders(rows) }),
    ]).catch(() => { if (alive) { setFailed(true); setEntitlements([]); setOrders([]) } })
    return () => { alive = false }
  }, [meId, attempt])

  const shelf = useMemo(
    () => buildPurchaseShelf(entitlements ?? [], pubs, users, orders ?? []),
    [entitlements, orders, pubs, users],
  )

  function fork(rowPubId: string) {
    const pub = pubs.find(p => p.id === rowPubId)
    // #409 — this branch is reachable ONLY by a render→click race: the Fork
    // button renders under `row.listed`, and `listed` is exactly "the publication
    // is in the cache", so by the time a click can arrive the lookup that backs
    // it has already succeeded. It is kept because the alternative (assuming the
    // find cannot fail) turns a race into a crash, and the message says what the
    // reader would need to know rather than "something went wrong".
    if (!pub) { toast('That plan is no longer listed, so there is nothing to fork.', 'err'); return }
    void forkPublication(pub, meId, onNavigate, undefined, 'purchases')
  }

  /** Share one row's card, with the row held busy until it resolves (#409). */
  async function share(row: (typeof shelf.rows)[number]) {
    if (sharingId) return
    setSharingId(row.pubId)
    try { await sharePurchase(row) } finally { setSharingId(null) }
  }

  return (
    <div className="container purchases-page">
      <div className="purchases-head">
        <button className="btn btn-ghost" onClick={() => onNavigate('/trips')}>
          <InlineIcon icon={ArrowLeft} size={14} gap={4} />My trips
        </button>
      </div>

      <h1 className="purchases-title">My purchases</h1>
      {/* #409 — the lede promised three things and, on a row whose publication
          row is GONE, showed one: "what is inside" is read from the publication
          row, so its shape chips are simply absent. The base sentence stays (it
          is true for everything listed) and the caveats appear ONLY when this
          shelf actually holds the case they describe — a permanent sentence
          about a case most shelves never have would be its own small
          dishonesty. #570 splits the case in two: a plan taken OFF SALE still
          has its row (and its chips) and still opens from here, so the old
          single caveat would have claimed its details were "not repeated here"
          while they are printed right below. Refunded rows say their own piece
          per row, so neither caveat speaks for them. */}
      <p className="hint-text purchases-lede">
        Plans you unlocked, kept here for good — with what you paid, the shape of the plan, and any update
        from the person who made them.
        {shelf.rows.some(r => !r.onSale && !r.refunded && !r.pendingGrant) && (
          <> A plan taken off sale keeps its receipt and your access — it still opens from here.</>
        )}
        {shelf.rows.some(r => !r.rowExists && !r.refunded && !r.pendingGrant) && (
          <> A plan whose catalogue entry is gone keeps its receipt and your access; its length, places and cover
          live in the copy you forked, which is why they are not repeated here.</>
        )}
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
      ) : entitlements === null || orders === null ? (
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
            {/* #407 — the total above EXCLUDES refunded purchases and the update
                count excludes them too, so the exclusion is named here rather
                than left for the reader to notice. A silently smaller number is
                the same class of lie as a silently larger one. */}
            {shelf.refundedCount > 0 && <> · <b>{shelf.refundedCount}</b> refunded</>}
            {/* #589 — in-flight grants are excluded from the total above (the
                money moved but the plan is not held yet), so the exclusion is
                named like the refunds' is. */}
            {shelf.pendingGrantCount > 0 && <> · <b>{shelf.pendingGrantCount}</b> {shelf.pendingGrantCount === 1 ? 'payment' : 'payments'} being finalized</>}
          </p>
          {shelf.pendingGrantCount > 0 && (
            <p className="hint-text">
              A payment was captured and its access is still being finalized. This usually clears in a
              minute. If it does not, open the plan once more and press Unlock — the checkout completes
              the grant without a second charge.
            </p>
          )}
          {!shelf.totalReadable && (
            <p className="hint-text">
              One or more purchases could not be read back, so this total is a floor rather than the
              whole amount. Your plans are unaffected — the price is just not showing.
            </p>
          )}

          <div className="purchase-list">
            {shelf.rows.map(row => {
              // Only a plan whose catalogue entry is GONE needs a copy resolved:
              // a withdrawn plan's own page still works for its buyer (#350 —
              // get_public_trip serves entitled holders), so the fork is a
              // fallback for pre-#350 rows whose publication really was deleted,
              // not a requirement. Resolving for every row would also mean a
              // live plan could be shadowed by an old fork, which is the wrong
              // answer to a different question.
              //
              // #407 — and a REFUNDED row resolves nothing at all: there is no
              // access to point at, so offering "Open your copy" would advertise
              // a plan the buyer's money was returned for.
              const copy = row.rowExists || row.refunded ? null : findBuyerCopy(row, trips)
              return (
              <article className="purchase-row" key={row.pubId}>
                <div className="purchase-thumb">
                  {/* #409 — a row that is not on sale gets NO auto lookup.
                      `CoverThumb` resolves a missing cover through
                      `pickTripQueryCandidates`, which for this caller degrades to
                      the purchase TITLE, and a title is not a destination:
                      "Spiti Valley Circuit" resolves to a plausible photo the
                      creator never chose, presented in the authoritative cover
                      slot. A neutral emoji is the honest fallback for a plan
                      taken off sale (#570 — its own page no longer shows any
                      photo to agree with). A row still ON SALE keeps the lookup,
                      because there its own public page shows the same photo and
                      the two agree. */}
                  <CoverThumb variant="short" explicitUrl={row.coverImageUrl}
                    trip={row.onSale ? { name: row.title } : null} emoji="🧭" />
                </div>
                <div className="purchase-body">
                  <h2 className="purchase-name">{row.title}</h2>
                  <p className="purchase-by">
                    {row.creatorName ? <>by <b>{row.creatorName}</b></> : <>creator no longer listed</>}
                    {' · '}bought {boughtOn(row.grantedAt, row.dateReadable)}
                  </p>
                  <div className="purchase-meta">
                    {/* #407 — the money STATE, independent of the shape chips
                        below. A refunded purchase keeps both of them when the
                        publication is gone: `refunded` and `listed` are
                        orthogonal, and rendering one would otherwise hide the
                        other. */}
                    {row.refunded && <Chip tone="info">Refunded</Chip>}
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
                  {row.refunded && (
                    <p className="hint-text">
                      The money for this plan was refunded, so the access it came with has ended. The
                      receipt stays here — what you paid and when — because a refund is a change of
                      access, not a reason to erase that you bought it.
                    </p>
                  )}
                  {/* #589 — the money moved and the grant has not landed. The row
                      says money and state, never access: the paywall refuses this
                      publication until the grant exists, so any owned-language
                      affordance here would dead-end. The header explains the
                      recovery path (press Unlock again — the checkout self-heals). */}
                  {row.pendingGrant && (
                    <p className="hint-text">
                      <b>Payment received</b> — access is being finalized. This row is a receipt until the
                      grant lands; it usually takes a minute.
                    </p>
                  )}
                  {/* #570 — fires for BOTH faces of "not on sale": the row
                      surviving a withdrawal (#350 — the plan is still readable
                      from here) and the row being gone entirely (pre-#350, where
                      the forked copy is the fallback). Before the marker split
                      this could not fire for a withdrawn plan at all — the one
                      thing the buyer most needed to know. #589 — never for an
                      in-flight grant: its access is not ready, so "it still
                      opens from here" would be false in the other direction. */}
                  {!row.refunded && !row.pendingGrant && !row.onSale && (
                    <p className="hint-text">
                      This plan is not listed publicly any more. Your access is unaffected
                      {row.rowExists
                        ? <> — it still opens from here, any time.</>
                        : copy
                          ? <> — your own copy is the trip you forked, and it still works.</>
                          : <> — but we could not find your copy in My trips, so there is nothing here to open.</>}
                    </p>
                  )}
                  <div className="purchase-actions">
                    {/* The link is offered while the publication ROW exists —
                        `/pub/<id>` reads the row, and since #350 a withdrawn row
                        still serves its buyer (get_public_trip + the page's
                        `unlocked` gate), so "Open the plan" is the buyer's working
                        path through a withdrawal, not a dead button. Gating it on
                        "still on sale" would break exactly the access the shelf
                        promises is unaffected (#570).

                        #407 — every access affordance is gated on the PLAN being
                        openable at all, which a refunded purchase is not: the
                        paywall already refuses it server-side, so an "Open the
                        plan" button here would be a button whose only outcome is a
                        locked page. The receipt above is what a refunded row is
                        FOR. #589 — an in-flight grant is refused the same way
                        until it lands, so the same gate excludes it. */}
                    {row.rowExists && !row.refunded && !row.pendingGrant && (
                      <button className="btn btn-primary" onClick={() => onNavigate(`/pub/${row.pubId}`)}>Open the plan</button>
                    )}
                    {copy && (
                      // A title match is a guess, and says so. A confident wrong
                      // link is worse than an uncertain right one.
                      <button className="btn btn-primary" onClick={() => onNavigate(`/trip/${copy.tripId}`)}>
                        {copy.exact ? 'Open your copy' : 'Open your copy (we think this is it)'}
                      </button>
                    )}
                    {row.rowExists && !row.refunded && !row.pendingGrant && <button className="btn btn-ghost" onClick={() => fork(row.pubId)}>Fork into my trips</button>}
                    {/* ROADMAP I-21: the buyer's own card. Offered only while the
                        plan is still ON SALE — a withdrawn plan's link previews as
                        a live card whose recipient is then refused the page (#350),
                        and handing someone that link is worse than not offering it
                        (purchaseShareable, which #407 also makes false for a
                        refunded row). */}
                    {purchaseShareable(row) && (
                      <button className="btn btn-ghost" disabled={sharingId !== null}
                        onClick={() => void share(row)}>
                        <InlineIcon icon={Share2} size={13} gap={4} />{sharingId === row.pubId ? 'Opening…' : 'Share what you bought'}
                      </button>
                    )}
                  </div>
                </div>
              </article>
              )
            })}
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
