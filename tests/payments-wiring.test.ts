import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Wiring guards for the M7 unlock flow. The page's purchase path is a
// browser-only journey (gateway modal + session JWT), so these pin the
// seams the verify gate cannot otherwise see: the placeholder toast is
// really gone, the buying state actually disables the button, and the
// api functions stay client-import-free (they must never pull Capacitor
// into a serverless bundle).

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
/** Code only, comments stripped. This file's page explains the entitlement gate
 *  at length and names the same strings the assertions use, so a raw-source
 *  match would be satisfiable by a sentence describing the fix rather than by
 *  the fix (the trap `tests/purchase-share-card.test.ts` documents). */
const codeOf = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(\/\/|--)/.test(line))
    .join('\n')

// One exported function's OWN source, up to the next top-level export. A check
// about a function must not be bent by whatever is later added beside it: the
// assertions below used to slice a fixed 400/500-character window off a name,
// which both under-read the body and swallowed the next function — so adding an
// unrelated read nearby failed a check about the creator-sales path, and a
// `catch { return [] }` anywhere below silently satisfied a check about this one.
const fnSource = (src: string, name: string) => {
  const start = src.indexOf(`export async function ${name}(`)
  expect(start, `${name} not found in the source`).toBeGreaterThan(-1)
  const rest = src.slice(start)
  const end = rest.indexOf('\nexport ')
  return end === -1 ? rest : rest.slice(0, end)
}

describe('the public page wires the real unlock flow', () => {
  const page = read('../src/pages/PublicItinerary.tsx')

  it('has no placeholder premium toast left', () => {
    expect(page).not.toContain('no payments in this MVP')
    expect(page).not.toContain('Premium unlock is a placeholder')
  })

  it('purchases through lib/unlock and gates rendering with hasUnlock', () => {
    expect(page).toMatch(/import\s*\{[^}]*purchaseUnlock[^}]*\}\s*from\s*'\.\.\/lib\/unlock'/)
    expect(page).toMatch(/import\s*\{[^}]*hasUnlock[^}]*\}\s*from\s*'\.\.\/lib\/payments'/)
    expect(page).toContain('const unlocked = tripReReadFailed ? false : hasUnlock(')
  })

  it('disables the unlock buttons while a purchase is in flight (the #36-6 rule)', () => {
    const buttons = page.match(/<button[^>]*disabled=\{buying\}[^>]*>/g) ?? []
    expect(buttons.length).toBeGreaterThanOrEqual(2)
  })

  it('re-reads entitlements after a successful purchase', () => {
    expect(page).toMatch(/onUnlocked:\s*\(\)\s*=>\s*\{/)
    expect(page).toContain('fetchMyEntitlements(meId)')
  })

  it('passes the unlock state into the fork, so a buyer forks real days', () => {
    // The fifth argument (#230) is the link's route in — the pin follows the
    // call site, and the unlock flag stays in its own position.
    expect(page).toMatch(/forkPublication\(pub!, me\?\.id \?\? null, onNavigate, unlocked, shareRefFromSearch\(window\.location\.search\)\)/)
  })

  it('fetches the trip through the PAYWALL RPC, never the raw table (the P0)', () => {
    // The public page must read via get_public_trip (wire-stubbed locked
    // days, entitlement decided server-side) — a direct select('*') or the
    // old fetchSharedTrip path re-opens the anonymous full-row read.
    expect(page).toMatch(/import\s*\{[^}]*fetchPublicTrip[^}]*\}\s*from\s*'\.\.\/store\/store'/)
    expect(page).not.toMatch(/import\s*\{[^}]*fetchSharedTrip[^}]*\}\s*from\s*'\.\.\/store\/store'/)
    expect(page).toContain('fetchPublicTrip(pub.id)')
  })

  it('renders free and unlocked days through ONE shared stop renderer', () => {
    // The first cut duplicated the renderer and the unlocked copy silently
    // dropped the travelling strips — pin the single shared component.
    expect(page).toContain('function DayStops(')
    expect(page).toContain('<DayStops stops={stops}')
    // The two full renderer copies are gone: only the shared one remains.
    expect((page.match(/travel-anchor-title/g) ?? []).length).toBe(2) // the component's two variants
  })

  it('the creator hub reads real sales through the creator RLS path (I-11)', () => {
    const hub = read('../src/pages/CreatorHubPage.tsx')
    // The Earnings tab's Actual view must derive from entitlements, not from
    // the projection arithmetic — that's the whole point of I-11.
    expect(hub).toMatch(/import\s*\{[^}]*deriveActualSales[^}]*\}\s*from\s*'\.\.\/lib\/earnings'/)
    expect(hub).toMatch(/import\s*\{[^}]*fetchCreatorSales[^}]*\}\s*from\s*'\.\.\/lib\/unlock'/)
    expect(hub).toContain('deriveActualSales(rows, myPubs)')
    // And lib/unlock's creator read must NOT filter by user_id — the RPC's
    // auth.uid() scoping does it.
    const unlock = read('../src/lib/unlock.ts')
    expect(fnSource(unlock, 'fetchCreatorSales')).not.toContain(".eq('user_id'")
  })

  it('the sales ledger reads through the definer RPC, not client-facing RLS', () => {
    // A client-facing RLS policy that failed to apply live answers 200 with
    // zero rows — "No sales yet" rendered over real sales, indistinguishable
    // from honest emptiness. Through the security-definer RPC the same
    // accident surfaces as an error (function not found) the tab can render.
    const unlock = read('../src/lib/unlock.ts')
    const creatorFn = fnSource(unlock, 'fetchCreatorSales')
    expect(creatorFn).toContain(".rpc('get_creator_sales')")
    expect(creatorFn).not.toContain("from('entitlements')")
    // And the migration must ship the RPC scoped by the caller's auth.uid().
    const sql = read('../supabase/migrations/20260918_payments_security.sql')
    expect(sql).toContain('create or replace function public.get_creator_sales()')
    expect(sql).toMatch(/get_creator_sales\(\)[\s\S]*?p\.creator_id = auth\.uid\(\)/)
    expect(sql).toMatch(/grant execute on function public\.get_creator_sales\(\) to authenticated/)
  })

  it('a failed creator-sales read is an ERROR STATE, never a silent empty ledger', () => {
    // The conflation that hid the stranded-grant bug: fetchCreatorSales
    // degraded a failed read to [] and the tab rendered "No sales yet" over
    // it — indistinguishable from genuinely zero sales. Pin both halves of
    // the fix: the fetch throws, and the tab renders a distinct retry state.
    const unlock = read('../src/lib/unlock.ts')
    const creatorFn = fnSource(unlock, 'fetchCreatorSales')
    expect(creatorFn).toContain('throw error')
    expect(creatorFn).not.toMatch(/catch[^}]*return \[\]/)
    const hub = read('../src/pages/CreatorHubPage.tsx')
    expect(hub).toContain("Couldn't load your sales")
    expect(hub).toContain('salesError')
    expect(hub).toContain('onRetry')
  })

  it('a failed entitlement read shows an error and Retry, and NEVER a price CTA (#359)', () => {
    // The direction that mattered. The read now rejects, and a rejection used to
    // be a silent `[]` — which the page spent as "you own nothing". A paying
    // buyer on a flaky connection therefore saw locked days and an
    // "Unlock full plan · ₹499" button for a plan they had already paid for.
    //
    // The two halves are independent and both are asserted: the content stays
    // LOCKED (a fix that unlocked on error would be a paywall breach) and the UI
    // gets LOUD (a fix that errored silently is this bug again).
    const code = codeOf(page)
    // 1. Three states, derived in the order the hub's ledger uses.
    expect(code).toMatch(/const entitlementRead: 'ready' \| 'reading' \| 'failed'/)
    expect(code).toContain('entitlementsError')
    expect(code).toContain('entitlementsReading')
    expect(code).toContain('entitlementsRetry')
    // 2. The price CTA is gated on a read that ANSWERED. A logged-out visitor
    //    has nothing to check, so the gate opens for them. #588 adds the
    //    second conjunct: a stuck post-purchase trip re-read silences the CTA
    //    too — the buyer owns the plan, so no price tag may render.
    expect(code).toMatch(/const mayShowPriceCta = \(!meId \|\| entitlementRead === 'ready'\) && !tripReReadFailed/)
    // 3. Every one of the two price buttons sits behind that gate — the day-card
    //    one and the sticky-sidebar one. A single unguarded site is enough to
    //    re-open the bug, and a guard that only covers the obvious one is the
    //    shape this failed in.
    const priceButtons = code.match(/\{price !== undefined[^}]*<button className="btn btn-saffron/g) ?? []
    expect(priceButtons).toHaveLength(2)
    for (const b of priceButtons) expect(b).toContain('mayShowPriceCta')
    // 4. The failure is SAYABLE, with a way to ask again, and offers no price.
    expect(code).toContain("Couldn&apos;t check your access.")
    expect(code).toContain('Checking your access…')
    expect(code).toContain('role="alert"')
    expect(code).toMatch(/onRetry=\{retryEntitlements\}/)
    // 5. The read is BOUNDED, so "Checking your access…" always resolves into a
    //    figure or into a failure that offers Retry.
    expect(code).toContain('ENTITLEMENT_READ_TIMEOUT_MS')
    expect(code).toContain("'TimeoutError'")
  })

  it('the gate FAILS CLOSED — a failed read never widens what is shown', () => {
    // The other direction of the same fix, and the one a careless implementation
    // gets wrong: `entitlements` is left untouched by a failed refresh, and
    // `unlocked` is still derived from it alone. So a buyer keeps the access they
    // already proved, and nobody else gains any.
    const code = codeOf(page)
    // The catch sets the error flag and NOTHING else — it does not clear the
    // list, so a refresh that fails cannot take away access already on screen.
    expect(code).toMatch(/\.catch\(\(\) => \{ if \(alive\) setEntitlementsError\(true\) \}\)/)
    // `unlocked` is still derived from `hasUnlock(entitlements, …)` — the
    // entitlement failure flag is routed to the UI, never into the unlock
    // decision. #588 adds exactly one narrowing conjunct in front of it (the
    // stuck post-purchase trip re-read), and that flag can only ever turn a
    // true into a false — it never widens what is shown.
    expect(code).toMatch(/const unlocked = tripReReadFailed \? false : hasUnlock\(entitlements, meId/)
    // And the paywall itself is untouched: this is a presentation gate, the wire
    // still decides what content exists.
    expect(code).toContain('forkPublication(pub!, me?.id ?? null, onNavigate, unlocked, shareRefFromSearch(window.location.search))')
  })

  it('the purchase re-read cannot become an unhandled rejection (#359)', () => {
    // The read rejects now, so the post-purchase refresh needs both arms. A
    // missing catch here is not a style question: it is an unhandled promise
    // rejection in the buyer's browser, on the exact moment they paid.
    const code = codeOf(page)
    const onUnlocked = code.slice(code.indexOf('onUnlocked:'), code.indexOf('}).then('))
    expect(onUnlocked).toContain('fetchMyEntitlements(meId)')
    expect(onUnlocked).toContain('.catch(')
    expect(onUnlocked).toContain('setEntitlementsError(true)')
  })

  it('the fork treats a failed entitlement read as NOT entitled, never as entitled', () => {
    // The third caller, and the one with the sharpest edge: a rejection that
    // escapes would stop a buyer forking their own plan, and one read as
    // entitlement would hand paid content to a stranger. Conservative, either way
    // the fork only NARROWS — the wire already decided what exists.
    const fork = read('../src/lib/forkPub.ts')
    expect(fork).toMatch(/\} catch \{\s*entitled = false\s*\}/)
  })

  it('the fork re-stubs locked days before persisting (defense-in-depth on the P0)', () => {
    const fork = read('../src/lib/forkPub.ts')
    // The fork reads through the paywall RPC (or the owner's own cache) and
    // re-applies the stub, so a stale cache can never fork paid content.
    expect(fork).toMatch(/import\s*\{[^}]*fetchPublicTrip[^}]*\}\s*from\s*'\.\.\/store\/store'/)
    expect(fork).not.toMatch(/import\s*\{[^}]*fetchSharedTrip[^}]*\}\s*from\s*'\.\.\/store\/store'/)
    // #352 added the money flag; the call still re-stubs `src` against the
    // publication's own free-day list, which is what this pins.
    expect(fork).toContain('restubLockedDays(src, pub.freeDayIndexes,')
    // The stub shape mirrors the migration's wire stub.
    expect(fork).toContain("description: LOCKED_STOP_DESCRIPTION")
    expect(fork).toContain('entryFeeInrPerPerson: 0')
  })

  it('the security migration ships the four audit fixes', () => {
    const sql = read('../supabase/migrations/20260918_payments_security.sql')
    // P0: the stubbing RPC exists, decides per auth.uid(), and grants anon execute.
    expect(sql).toContain('create or replace function public.get_public_trip(p_pub_id text)')
    expect(sql).toContain('v_pub.creator_id = auth.uid()')
    expect(sql).toMatch(/grant execute on function public\.get_public_trip\(text\) to anon, authenticated/)
    // P0: the anonymous public clause is gone from direct reads.
    expect(sql).toContain('create policy "trips read"')
    expect(sql).toMatch(/create policy "trips read"[\s\S]*?to authenticated/)
    // M2: refund revoke RPC, service-role only.
    expect(sql).toContain('create or replace function public.revoke_refunded_entitlement(p_razorpay_order_id text)')
    expect(sql).toMatch(/grant execute on function public\.revoke_refunded_entitlement\(text\) to service_role/)
    // L2: entitlements survive buyer deletion.
    expect(sql).toContain('on delete set null')
    // Invite RPC refuses premium-backed trips for strangers.
    expect(sql).toMatch(/get_invite_trip[\s\S]*?premium_price_inr/)
  })

  it('the paywall RPC answers every publication shape, with its stub text typed', () => {
    // The RPC's first live call 400'd on every PRICED publication: a bare
    // string literal went into polymorphic to_jsonb ("could not determine
    // polymorphic type"). Buyers and the creator returned earlier, so only
    // visitors broke — and no offline gate executes SQL, so pin the shapes
    // textually: the migration is unapplied code until someone runs it.
    const sql = read('../supabase/migrations/20260918_payments_security.sql')
    const rpc = sql.slice(
      sql.indexOf('create or replace function public.get_public_trip'),
      sql.indexOf('-- 2. Tighten the trips RLS public clause'),
    )
    // Every literal fed to polymorphic to_jsonb carries its cast.
    expect([...rpc.matchAll(/to_jsonb\('([^']*)'\)/g)].map((m) => m[1])).toEqual([])
    // Unpriced: the whole trip is the preview — a bare `return;` answered an
    // empty set, so the page rendered nothing at all.
    expect(rpc).toMatch(/premium_price_inr is null then[\s\S]{0,90}?return next v_trip;/)
    // An empty free-day list means every day locks, not "entirely free".
    expect(rpc).not.toContain("v_free = '{}'")
  })
})

describe('the api functions stay client-import-free', () => {
  it.each(['../api/checkout.js', '../api/payments-verify.js', '../api/payments-webhook.js'])('%s imports no client code', path => {
    const source = read(path)
    expect(source).not.toMatch(/from\s+'\.\.\/src\//)
    expect(source).not.toMatch(/require\(['"]\.\.\/src/)
  })
})

describe('the unlock library degrades honestly', () => {
  it('loads checkout.js only once per session', () => {
    // The module-level memo is load-bearing: every Unlock click appending its
    // own script tag would race the modal open. Pinned so a refactor keeps it.
    const source = read('../src/lib/unlock.ts')
    expect(source).toMatch(/let scriptPromise: Promise<boolean> \| null = null/)
    expect(source).toContain('scriptPromise = null // allow a retry on the next click')
  })

  it('rejects a failed entitlement read instead of degrading to none', () => {
    // #359. This used to be the OPPOSITE pin — it asserted the catch-to-`[]`,
    // on the reasoning that a dropped connection must not break the public page.
    // But the page spends the difference: a buyer whose read failed saw locked
    // days and an "Unlock full plan · ₹499" button for a plan they had already
    // paid for. An empty list is only honest evidence once a read SUCCEEDED
    // with zero rows, so the read now rejects like every other reader here.
    const source = read('../src/lib/unlock.ts')
    const fn = fnSource(source, 'fetchMyEntitlements')
    expect(fn).toContain('throw error')
    expect(fn).not.toMatch(/catch[^}]*return \[\]/)
    // A logged-out visitor is still an empty list — there is nothing to read,
    // and that is not a failure.
    expect(fn).toMatch(/if \(!userId\) return \[\]/)
  })
})

describe('#588 — a failed post-purchase re-read cannot render as fresh', () => {
  const page = read('../src/pages/PublicItinerary.tsx')

  it('the entitlement catch clears the read marker, so the gate falls to failed', () => {
    // #359's keep-proven-access ordering is deliberate — and it is exactly
    // what made the failure invisible here: the pre-purchase read proved
    // NOT-owning, so the marker standing means a stale negative renders as
    // fresh. The post-purchase catch must clear the marker with the flag.
    // Anchored to the onUnlocked chain — the folded retry's catch shares the
    // shape but its then-clause also sets the read marker, so a bare catch
    // regex could pass on the wrong call site.
    expect(page).toMatch(/setEntitlements\(rows\); setEntitlementsError\(false\) \}\)\s*\.catch\(\(\) => \{ setEntitlementsError\(true\); setEntitlementsReadFor\(null\) \}\)/)
  })

  it('a null post-purchase trip sets the stuck flag; only a real trip clears it', () => {
    expect(page).toMatch(/else \{\s*setTripReReadFailedFor\(pub!\.id\)/)
    expect(page).toMatch(/setFetched\(fresh\)\s*setTripReReadFailedFor\(null\)/)
  })

  it('the stuck flag gates the lock and silences the price CTA', () => {
    // The overlays stay over the stub, and no "Unlock full plan" can render
    // for the plan the buyer just paid for.
    expect(page).toMatch(/const unlocked = tripReReadFailed \? false : hasUnlock\(/)
    expect(page).toMatch(/mayShowPriceCta = \(!meId \|\| entitlementRead === 'ready'\) && !tripReReadFailed/)
  })

  it('both CTA sites route the stuck state to the post-purchase panel', () => {
    expect((page.match(/<PurchaseLoadState/g) ?? []).length).toBe(2)
    expect(page).toMatch(/retryPostPurchaseReads/)
  })

  it('the folded retry asks both halves of the question', () => {
    // One Retry re-runs the entitlement read AND the trip read — two halves
    // of one question (what did I just buy).
    expect(page).toMatch(/const retryPostPurchaseReads = useCallback/)
    const fn = page.slice(page.indexOf('const retryPostPurchaseReads'), page.indexOf('}, [pub?.id, meId, postPurchaseRetrying])'))
    expect(fn).toContain('fetchMyEntitlements(meId)')
    expect(fn).toContain('fetchPublicTrip(id)')
  })
})

describe('#587 — the entitlements read timeout is bound to the request', () => {
  const page = read('../src/pages/PublicItinerary.tsx')

  it('the read takes a signal and hands it to the wire', () => {
    // The bounded-read recipe existed except the wire between its halves: the
    // page aborted a controller no request listened to, so a hung connection
    // never settled the promise and "Checking your access…" had no exit.
    const source = read('../src/lib/unlock.ts')
    const fn = fnSource(source, 'fetchMyEntitlements')
    expect(fn).toContain('opts: { signal?: AbortSignal } = {}')
    expect(fn).toContain('opts.signal ? query.abortSignal(opts.signal) : query')
  })

  it('a timeout logs as a failure and a teardown as a cancel, like the siblings', () => {
    const source = read('../src/lib/unlock.ts')
    const fn = fnSource(source, 'fetchMyEntitlements')
    expect(fn).toContain("reportReadFailure('entitlements', error, opts.signal)")
  })

  it('the effect passes its controller signal to the read', () => {
    expect(page).toContain('fetchMyEntitlements(meId, { signal: ac.signal })')
  })
})

describe('#591 — the reveal states what was paid, from the snapshot', () => {
  const page = read('../src/pages/PublicItinerary.tsx')

  it('the receipt amount comes from the entitlement row, never the catalog copy', () => {
    // A creator changing the price while the tab sat open would otherwise make
    // the ceremony contradict the shelf for the same purchase — the reveal is
    // the one surface that spends the PAID figure.
    expect(page).toContain('amountPaidInr={entitlements.find(e => e.pubId === pub.id)?.amountPaidInr}')
    expect(page).not.toContain('amountPaidInr={pub.premiumPriceInr}')
  })

  it('an unreadable figure renders as no figure, and the component keeps that rule', () => {
    // The pitfall: the entitlement can be absent for a beat — prefer no figure
    // over a wrong one. The component's own guard is what makes the fallback
    // safe, so it is pinned too.
    expect(page).toContain('?.amountPaidInr}')
    const reveal = read('../src/components/UnlockReveal.tsx')
    expect(reveal).toMatch(/typeof amountPaidInr === 'number'/)
  })
})
