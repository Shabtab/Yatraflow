# Reconciling the payment rail

Reference + how-to for anyone matching our records against Razorpay's, reading a
payment log, or looking at a `pending` order and wondering whether money moved.

Read this before concluding anything from a row in `purchase_orders`. The rail
has three states that look alike and mean different things, one value that is
deliberately **not** a gateway id, and a class of row that exists on purpose.

## The two tables, and which question each answers

| Table | Answers | Survives a refund? |
|---|---|---|
| `purchase_orders` | **the money** — what was charged, and whether it came back | yes — this is the surviving record |
| `entitlements` | **the grant** — what the buyer may open | **no** — the refund deletes the row |

`revoke_refunded_entitlement` flips the order `paid → failed` and **deletes** the
entitlement. So a refund is visible in exactly one place: the order. Anything
built by reading entitlements alone loses refunded purchases entirely — that was
issue #407, and it is why the buyer's shelf reads both.

## The status vocabulary, and the one reading that is load-bearing

`status` is `pending` · `paid` · `failed`.

**`failed` means the money was captured and then given back. It does not mean
"declined", and it does not mean "abandoned".**

That is not a convention, it is a fact about the schema, and it is the assumption
the entire buyer-facing surface rests on:

- `revoke_refunded_entitlement` is the **only** writer of `failed`, and it writes
  it only `where status = 'paid'`. Every mark-paid path writes `paid` **with**
  `paid_at`.
- A declined card leaves the order `pending` — the verify call that would mark it
  never runs, so nothing downgrades it.
- Checkout's reuse guard reads `latest.status !== 'failed'`, so a refunded order
  is never re-served.

If you ever add a second writer of `failed`, **#407's "Refunded" chip starts
lying about abandoned checkouts** and this table becomes ambiguous. Add a new
status value instead — but note that would need its own migration, because the
column is a `check` constraint.

`pending` means what it says and nothing more: **no money has moved as far as the
gateway told us.** It is not evidence of a sale, and it is not evidence of a
failure either.

## The `recovered-by-checkout` sentinel

`purchase_orders.razorpay_payment_id` normally holds Razorpay's own `pay_…` id.
One path writes a literal instead:

```
api/checkout.js  →  markOrderPaid(…, 'recovered-by-checkout', …)
```

That is the **self-heal** branch. It runs when a buyer opens checkout again and
the order's local row is still `pending` while the *gateway* says the money was
captured — the stranded state left behind when the browser verify call never
landed. There is no `pay_…` id in hand on that path (nobody present made the
call), so the literal goes in the column to record **how we learned** this order
was paid: a gateway **probe**, not a signature-checked callback.

**What this means when reconciling:**

- Do **not** try to match a row whose payment id is `recovered-by-checkout`
  against a Razorpay payment id — it will never match, because it is not one.
- Match it on **`razorpay_order_id`** instead, which is always the gateway's own
  order id on every path.
- A `recovered-by-checkout` row that also has `paid_at` set is a **confirmed
  capture** that was written late. It is not a placeholder, and not a guess: the
  gateway was asked directly before the row was marked.

The buyer-facing ledger is a different read and never sees this column: the
finance view and the creator's sales list both go through `get_creator_sales`
(entitlements, `amount_paid_inr`). The sentinel exists for **gateway
reconciliation**, i.e. for this document.

## The orphan policy

An **orphan** is a `pending` order that never became anything: the buyer opened
the Razorpay modal and walked away, so no payment was ever attempted or captured.

**They are expected, and they are not errors.** Since #355 they are also no
longer allowed to accumulate — a buyer who presses Buy again with an orphan
sitting there gets **the same order re-served**, not a second one:

| Gateway says | What checkout does | Why |
|---|---|---|
| `paid` | finishes the grant (self-heal) | the money moved; the buyer must get the unlock |
| `created` | re-serves the **existing** order | still payable — a second order would be a second thing to pay |
| `attempted` | re-serves the **existing** order | an attempt started and did not complete; Razorpay keeps the order payable, which is why `attempted` is not terminal |
| `unknown` | **refuses**, 503 | the probe failed, so we cannot know whether money moved — minting here is the double-charge window |
| anything else | **refuses**, 503 | we do not know that order is payable, and we will not guess |

The rule underneath the table: **mint a new order only when the gateway confirms
the old one cannot be paid, and never when we are unsure.** Re-serving cannot
double-charge (one order, one payment, however many attempts); minting a second
order can, and a buyer who pays twice for one unlock is paid once by the claim
(`on conflict do nothing`), so the second payment buys them nothing.

**What an orphan means if you find one from before #355:** it is a retry that
minted a fresh order, and money did **not** move on it. Safe to ignore for
revenue; the pile is bounded now because the retry path reuses rather than adds.

## Reading the logs

Two things were made legible in #355, because both used to say something
confident regardless of what happened:

**A refund delivery answers with the RPC's own verdict:**

```json
{ "ok": true, "revoked": true,  "outcome": "revoked" }
{ "ok": true, "revoked": false, "outcome": "unknown-order" }
{ "ok": true, "revoked": false, "outcome": "unreadable" }
```

Both are a **200** — an unknown order is a foreign or test event and a retry storm
helps nobody (that part is unchanged). `outcome` is the only thing that separates
a real revoke from noise, so **read `outcome`, not the status code**.

**A mark-paid that matched no rows is no longer reported as success.** The write
asks PostgREST for `return=representation`; an empty array means it moved nothing,
and the row is then read back to learn which of `already-paid`, `refunded`,
`still-pending` or `missing` it is. Callers act on the difference — in particular
`refunded` never falls through to a grant, because that would resurrect access a
refund deleted.

**A claim refusal is deliberately uninformative.** `claim_paid_order` answers
"no such order", "not yours" and "not paid" with ONE identical error. The reason
is logged server-side (`raise log`, visible in the Supabase Postgres log) and
never returned — an authenticated caller must not be able to probe order ids for
whether they exist, whose they are, or whether they were paid. If you are
debugging a buyer's failed claim, **read the database, not the API response**; the
response has nothing to tell you by design.
