# Refunds

The product rule for `payment.refunded` events (Razorpay), decided with #554.
`api/payments-webhook.js` carries the figures; `apply_order_refund`
(supabase/migrations/20261003_partial_refund_record.sql) makes the decision;
this file records what the decision IS.

## The rule

- **Full refund** — the cumulative refunded amount has reached the ORDER's own
  captured amount (`amount_inr * 100`): revoke as always. The order flips
  `paid → failed`, the entitlement is deleted, the sale leaves the ledger.
- **Partial refund** — anything less: the entitlement and the `paid` status
  SURVIVE, and the cumulative refunded paise is recorded on the order
  (`refunded_paise`). The buyer keeps the plan; the money story is not a
  receipt for nothing.

## Why

The old rule ("a refund revokes the entitlement") was written for full
refunds and read every refund event as one. A goodwill ₹50 back on a ₹500
sale therefore confiscated the buyer's whole plan and erased 90% of the sale
from the books — both directions wrong at once: the money largely outlived
the entitlement.

## Discipline

- The cumulative figure is Razorpay's `payment.amount_refunded` (the payment
  entity's running total), never a sum of refund events — webhook deliveries
  can be missed.
- The threshold compares against the ORDER's own `amount_inr`, never the
  event's captured amount — the same trust boundary `api/checkout.js` applies
  to prices.
- One decision point: the webhook cannot revoke or record directly; it calls
  `apply_order_refund` with the figures and reports the outcome
  (`revoked` / `recorded` / `unknown-order` / `invalid`).

## Known remainder

The creator's earnings ledger currently reports a partially-refunded sale at
its full amount (the entitlement row survives with its `amount_paid_inr`).
Netting the refund out of `deriveActualSales` / `get_creator_sales` is the
follow-up half — the recording this change adds is what makes that
subtraction possible at all.
