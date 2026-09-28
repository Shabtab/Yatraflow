# HANDOFF — Phase 3 · Lane C: money, creator & the public wire (15 issues)

Written 2026-09-28 by the **DSH agent** (working clone `C:\Users\hasna\YatraFlow-DSH`) for **commandcode**
(working clone `C:\Users\hasna\Yatraflow-commandcode`, where this file lives).

Phase 2's lanes are drained: your own P1 shelf closed on 2026-09-27 in five PRs, lane B is empty
(Timeline/Board fully landed), lane S shipped #424 (PR #487), and A/D/E/F/G are down to their remainder.
The 60 open issues are **re-cut into six staffed lanes** — A · C · D · E · F · G — plus the owner's
milestone track. Six agents can work at once because the lanes are partitioned by **file surface**, not by
theme. §1 is the rule; §6 is the map.

---

## 0. State you are inheriting (re-derived 2026-09-28 — re-derive it again, never quote it)

| Fact | Value at the time of writing | How to re-derive |
|---|---|---|
| `origin/test` | `13fc92c` (merge of PR #487, lane S) | `git -c http.sslBackend=openssl fetch origin --prune` |
| `origin/main` | `d20f195` — **v0.69.0 promoted** (PR #489); newest tag `v0.69.0` | `git log --oneline -1 origin/main` · `git tag --sort=-creatordate \| Select-Object -First 3` |
| Open issues | **60** | `gh issue list --state open --limit 200` |
| Open PRs | **#491** (`chore/lint-dead-imports`, lane S's follow-up: two dead `stopById` imports, +2/−2, Verify + Codacy green, MERGEABLE) | `gh pr list --state open` |
| Migrations | **29** files; newest `20260928_public_trip_fail_closed.sql`; last probe read 29 · 14 applied · 0 missing · 15 no-probe | `npm run check:migrations` |
| Gate | the last recorded cut (v0.69.0, PR #489's body) read tsc clean · **2781 passed / 1 skipped (2782) in 205 files**, ``built in 4.06s``. Re-run it; never quote this | `npm run verify` |
| Your clone | on **`lane-c/publish-honest` at `f6df5c2`** — the merge of your own PR #478 — **behind `origin/test`**: the branch is spent and its remote-tracking refs predate lane S's merge. 3 untracked files: `$null` (a PowerShell redirection accident), `HANDOFF-COMMANDCODE-LANE-C.md` (this file's predecessor), `scripts/jev-suggestion-audit.test.ts`. **Start by cutting a fresh branch from `origin/test`.** | `git -C C:\Users\hasna\Yatraflow-commandcode status -sb` · `git log -1 --oneline` |

**Cut every wave from a fresh `origin/test`** — `fix/money-<slug>`, `fix/creator-<slug>` or `fix/wire-<slug>`
— and merge `test` into the branch before opening the PR: five other lanes are landing constantly.

**Never `git add -A` / `git add .` in this repo.** It has committed `dev.log` and tool scratch that way
before. Add explicit paths only.

**The issue queue, not `ROADMAP.md` prose, is the work list.** It has been 13, 98, 73 and now 60 inside a
week; every count written in a document (this one included) is a timestamp.

---

## 1. The one rule that makes parallelism work

**Lanes are partitioned by FILE SURFACE, because that is what decides whether two branches merge
cleanly.** Two agents editing one file is the only real failure mode here; everything else is
recoverable.

1. **Announce the regions you will touch before you start** — in §8, by file and by
   function/memo/layer name, **never by line number**.
2. **Audit-issue line numbers are stale** — the sweep's anchors were ~140 lines wrong the day they
   were filed and every merge moves them again. Re-anchor by grepping the named identifier.
3. **Never edit a file another lane holds.** If you believe you must, write it in §8 first and let
   the owner answer. Holdings:

| Surface | Held by |
|---|---|
| **Lane A:** `src/pages/trip/MapTab.tsx`, `src/pages/trip/map/**`, `src/pages/trip/MapOmnibar.tsx`, `src/pages/trip/MapTabSkeleton.tsx`, `src/pages/trip/mapPlacement.ts`, `src/components/TripMap.tsx`, `src/components/mapcn/**`, `src/components/DetourWhisk.tsx`, `src/components/ResolvePickDialog.tsx`, `src/lib/{mapFit,mapCluster,mapSheet,mapViewModes,pinOffsets,railA11y,railKeys,railReasons,railRuler,routeIq,ridePlan,tripRoad,detourBudget,storyArcs,placeIdentity,resolvePick}.ts` | DSH (`YatraFlow-DSH`) |
| **Lane C (you):** `src/pages/CreatorHubPage.tsx`, `CreatorPage.tsx`, `Purchases.tsx`, `Explore.tsx`, `src/pages/trip/ShareTab.tsx`, `src/components/{CoverImagePicker,CoverThumb,PubCard,UnlockReveal,TrendChart}.tsx`, `src/lib/{payments,purchases,unlock,earnings,pubFunnel,coverUpload,tripThumb,shareUrl,purchaseShare,savedPubs,forkPub}.ts`, `api/**`, `public/robots.txt`, `vercel.json` | **you** (commandcode) |
| `src/pages/trip/TripSettingsForm.tsx`, `src/pages/trip/BudgetTab.tsx`, `src/pages/trip/GroupInputTab.tsx`, `src/lib/{expenseAmount,settlement,budgetBenchmarks,vehicleProfile,startPin,writeQueue}.ts` | **Lane D** (mcode) |
| `src/pages/trip/OverviewTab.tsx`, `src/pages/Profile.tsx`, `src/components/AiDrawer.tsx`, `src/lib/{ai,aiProvider,jevTaxonomy,anticipation,daySummary,healthBand,seasonality,weather}.ts` | **Lane E** (cline) |
| `src/pages/TripsList.tsx`, `src/pages/TripCreated.tsx`, the Trash surfaces, `src/lib/{tripImport,itinerarySpec,snapshot,restoreRows,localData}.ts`, `src/components/ImportTripButton.tsx` | **Lane F** (opencode) |
| `src/App.tsx`, `src/lib/routes.ts`, `src/pages/CreateTrip.tsx`, `src/pages/Landing.tsx`, `src/components/PlanBench.tsx`, `src/pages/AdminPage.tsx`, `src/lib/{admin,adminSession,adminStats,createDraft,createReadiness,createRadar,createSubmit,createHandoff,planBench,tripStarter,tripTemplates,tripRow}.ts`, `supabase/**` | **Lane G** (freebuff) |
| **Dormant — lane B retired:** `src/pages/trip/TimelineTab.tsx`, `src/pages/trip/timeline/**`, `src/components/BoardView.tsx` | **no owner this phase** — Timeline and Board have zero open issues. Announce-first: name the region and the issue in §8 before you touch them (only #400 and #425 are expected to need them) |
| **Unheld — announce-first:** `src/pages/TripWorkspace.tsx`, `src/hooks/**` (notably `useSuggestionCache.ts`), `src/lib/routing.ts`, `src/lib/weather.ts`, `src/components/RemoteEditBanner.tsx`, `src/pages/PublicItinerary.tsx` | no lane holds these yet, and four issues are already known to need them: **#400** (E — `BoardView` + a `styles.css` teal rule + the deliberate `tests/health-band.test.ts` pin edit), **#403** (E — `routing.ts`'s `coordValid` is module-private, and `PublicItinerary.tsx` is a second `RouteSnapshot` caller), **#404** (E — `useSuggestionCache.ts`'s `planInputsHash`/`isMapCacheFresh`, plus a new prop through `TripWorkspace.tsx`), **#414** (D — `useSuggestionCache.ts` + `RemoteEditBanner.tsx`), **#387/#383** (F — Trash has no per-slice read status and `get_trashed_trips`' failure stops at a `console.error`; every Trash RPC/policy file is lane G's `supabase/**`) || `src/store/store.ts` | **contended** — lanes D, F and G all touch it; announce your regions before you take it, keep edits narrow and additive |
| `src/lib/engine.ts`, `src/lib/readState.ts` | **shared, additive only** — D, E and F read the same helpers; announce a signature change |
| `src/styles.css` | **serialized** — one lane at a time. Any edit moves line numbers and the design-system ratchet baseline is line-keyed: re-baseline with `UPDATE_DESIGN_SYSTEM_BASELINE=1`, then prove the finding *names* are identical before/after. The last lane to merge re-baselines on the merged tree |
| `CHANGELOG.md` | **everyone** — conflicts are normal; resolve by keeping BOTH sides, never by dropping another lane's bullet. Edit it with editor primitives only (a bulk rewrite once truncated it from 830 lines to 21) |
| `package.json`, `package-lock.json` | **never bump** — the user cuts releases |
| `ROADMAP.md` | the owner's |

*This is lane A's §1 with the two "you" markers re-pointed at lane C; the holdings table is the shared
one and was not re-cut.*

4. **Merged branches are pruned at merge**; the PR *is* the archaeology. One branch per wave, PR into
   `test`, never push to `test` or `main` directly — the user merges.

---

## 2. Your lane — money, creator & the public wire (15 issues)

Five of the fifteen **must not be redone** — #406 (#475, `e465f72`), #388 (#477, `69a319d`), #360's
byte-cap half (#478, `f6df5c2`), #405 (#479, `ffe2872`), #364 (#480, `dfe4102`), all CLOSED; #357 needed
no code (`c460159`). #360 and #407 stay open on purpose. The waves below are yours to shape — say so in §8.

#### Wave C1 — the creator's own numbers (4 issues)
- **#348** (P2) — `payoutPeriods` judges each period alone (`clears = net >= 500 ? net : 0`) while `payoutStatus` judges the total, so two ₹300 weeks read "rolls over, ₹0 clears"
  under a header offering a payout. Implement the carry, then derive the header **from** the walk so one derivation feeds both.
- **#358** (P3) — a >100% fork row draws a **capped** bar with the unlock mark pushed off-track, and the page's and a row's "recording began" dates can disagree side by side. The
  rate is pinned unclamped (Explore cards fork without opening): fix the bar and the labels, never the number.
- **#359** (P2) — `fetchMyEntitlements` catches a failed read into `[]`, so a paying buyer sees locked days and an **Unlock** CTA for a plan they own. Three states (`reading` /
  `failed`+Retry / `ready`): fail **closed** on content, **loud** in the UI. `fetchMyPurchases` is the template.
- **#360** (P1) — trim (#477) and caps (#478) are landed; what remains is `PublicItinerary` falling back to a **live Wikipedia suggestion** where `api/i.js` falls back to
  `og-default.png`, so a pre-cover-requirement row disagrees with its own card forever. **Owner's decision, not a diff** (§5).

#### Wave C2 — publish, share, cover (5 issues)
- **#354** (P2) — every rule lives in `PublicationForm` only: `publishItinerary` enforces none of them (verified live), the DB has no CHECK, and the `visibility → public` flip is
  still `fire(...)` — a rejected flip leaves Explore live over a page that serves nothing.
- **#361** (P2) — the row is committed optimistically with the Wikimedia URL **before** `ownSuggestedCover` resolves, and the upsert-failure rollback restores `cache.published` while
  `updateTrip(…, { coverImageUrl })` has already persisted the owned cover to the trip.
- **#389** (P2) — one `err: string | null` drives one `role="alert"` banner: no `Field error=`, no refs, no `.focus()`, no `FormErrorSummary`. Port CreateTrip's F-15 shape; the
  banner stays the assertive *summary*, field messages stay polite.
- **#390** (P2) — the picker stores any string as a "custom URL", a total auto-suggest miss clears the field in silence, and an unapplied bucket shows the raw storage error
  ("Upload failed: Bucket not found") instead of a friendly one.
- **#391** (P2) — `removeMember` and `setMemberRole` mutate + `commit()` + naked `fire(...)` with no rollback (verified still true after #424), and `SnapshotCard.makeLink` has no
  busy guard and no error path around `encodeTripSnapshot`.

#### Wave C3 — the public wire (3 issues)
- **#362** (P2) — creator links are fragment-only so they never reach a crawler; `api/sitemap.js` caps at `MAX_URLS = 1000` with no paging and orders by `published_at` while
  `lastmod` reads `refreshed_at`; the canonical origin is a literal in five files; `?buyer=` survives a publication switch onto the next publication's address.
- **#363** (P2) — **moved into this lane 2026-09-28** from F. Session-deduped visits over raw fork clicks, and both counters bump the cache + `commit()` **before** a `fire(...)` that
  can fail — so a failed bump inflates Explore's sort (`popularity = views + copies * 5`) and featured pick (`p.copies >= 1 || p.views >= FEATURED_MIN_VIEWS`) permanently.
- **#395** (P2) — no loading state and no error branch: a dropped publications read prints "the community catalog is just getting started" over a catalog that exists, with no retry.
  Consume the per-slice read status the other lanes' pages expose; a genuine empty keeps **both** current copies.

#### Wave C4 — the money edge, and one decision (3 issues)
- **#355** (P3) — `claim_paid_order` distinguishes three failure states to any authenticated prober; a zero-row `markOrderPaid` PATCH still returns 2xx; the webhook answers
  `{ revoked: true }` for unknown orders; abandoned checkouts leave permanent orphans.
- **#409** (P3) — `boughtOn` formats epoch-ms in the **browser's** timezone; an unlisted row wears a title-keyed auto photo the creator never chose; the lede promises what a
  withdrawn row cannot show; `void sharePurchase(row)` has no busy guard.
- **#407** (P2) — **settled; a decision is owed, not a fix.** `revoke_refunded_entitlement` sets the order `failed` **and deletes the entitlement row**, so the shelf — built from
  entitlements — loses the purchase entirely; the real defect is that the refund takes the buyer's receipt with it. Preserve it (marker or `refunds` table + migration) or accept it.
  **The reported fix would compile, test green and change nothing.** Evidence: the issue's 2026-09-27 comment.

**What is already true about these surfaces** (so you do not re-litigate it):

- **The paywall is enforced at the wire, not in the browser** (v0.61.0, `20260918_payments_security.sql`): price read server-side from the publication row, unlock granted only
  through a buyer-scoped RPC or the idempotent webhook, a confirmed-but-unsaved purchase **recovered rather than charged twice**. A client-side check is a regression. **Refunds
  revoke** by deleting the entitlement row — that is #407's whole finding.
- **Covers:** the `covers` bucket and `trips.cover_image_url` are applied live (2026-09-19), and auto-picked Wikipedia covers go through Wikimedia's resize endpoint because
  `og:image` has a **600 KB WhatsApp budget** (measured 144–406 KB where originals were 1.3–3.3 MB). A cover fix that stops resizing breaks link previews; `COVER_MAX_EDGE = 1200`
  stays; never delete-on-replace (forks and publications copy the URL).
- **#360's premise correction stands** (learned on #478): `uploadCover` downscales to 1200px **before** the bucket, so a 5–8 MB photo never reached the 5 MB limit — the cap decided
  which originals a creator could *pick*, not whether an upload failed. **When a new test contradicts an issue body, the body is the more likely thing that is stale.**
- **#388 already landed the ShareTab halves #389 must not redo** (verified in the tree): the publish is awaited with `busy`, `disabled={busy}`, a "Publishing…" label, and
  `setErr(null)` on every text-field edit and the free-day toggle. #389's remainder is the **field-level** half — `Field error=` per rule, `fieldRefs` + first-invalid `.focus()`,
  `FormErrorSummary`, and the cover picker's own error affordance (`<CoverImagePicker trip={trip} editable={isOwner} />` takes no `error` prop today).
- **`src/lib/mutationLifecycle.ts` is lane S's merged module** (#424, PR #487): the staged/kept/discarded/undone vocabulary, `blocksDirectWrite`, `removeStopWithUndo`,
  `MUTATION_RECOVERY`. It owns **stop** deletion only — not `removeMember`/`setMemberRole`, which are still naked `fire(...)` in `store.ts` (#391's premise, verified). Read it before
  touching a mutation path; never add a second pending-mutation system.
- **The fire-and-forget shape is this repo's most expensive family, and #363 is its counter instance:** `fire(...)` swallows by design, `bump_published_stats` writes the dated event
  only on **server** success, so a failed bump leaves the counter and the log out of step while Explore sorts on the inflated value. Views dedupe per session (`yf-viewed-<id>`);
  **forks do not** — #363's first fix. Compute the rate straight, never clamp it.
- **The public wire is three handlers and one policy file:** `/i/<id>` → `api/i.js`, `/sitemap.xml` → `api/sitemap.js`, `public/robots.txt` (a test forbids `Disallow: /#/`). A new
  `api/*` handler needs its `vercel.json` rewrite **in the same change**. The canonical origin literal sits in **five** places — `src/lib/shareUrl.ts`, `api/i.js`, `api/sitemap.js`,
  `index.html` (×4), `public/robots.txt` (×2); re-derive with `git grep -n 'yatraflow-blond.vercel.app' origin/test`. The handler is plain JS outside `src` and must not import client
  code — pin the pair by literal-test, never by sharing.
- **`get_public_trip` has been rewritten three times in a week and each rewrite inherits the previous body's holes**; the newest is `20260928_public_trip_fail_closed.sql`
  (#352/#353). Read the **whole** body before `create or replace`-ing it — two files redefining one function means **NAME ORDER decides which body a fresh database runs**, and
  `schema.sql` is a second, independent way to build it: fix both and let a test compare them.
- **`prune_pub_events` is `service_role`-only** since `20260927_prune_pub_events_lockdown.sql` (#356) — `revoke … from public` revokes from neither `anon` nor `authenticated`, so
  name all three roles.
- **A migration's DB half is a separate, user-run step.** Your three previously-suspect RPCs (`admin_revenue`, `prune_pub_events`, `owns_publication`) were probed live on 2026-09-27
  and all **exist**: `PGRST202` from a bare `{}` is the documented false negative. Re-probe (§4); never "fix" an applied migration.
- **Also yours by surface, though §1's row does not enumerate them:** `src/pages/PublicItinerary.tsx` (#359's gate, #360's hero fallback) and `src/lib/forkPub.ts` (the second
  `registerPubCopy` caller). The `syncPublicAddress` call site lives in `src/App.tsx`, which is **lane G's** — announce in §8 and keep any edit to the call, not the shell.

**Contention inside your own lane:** `src/store/store.ts` is contended and **three of your issues land in
it** — #361, #391, #363: announce each region by function name in §8 before the first edit, keep them
narrow and additive, prefer one branch per region, and serialize the `api/i.js` work for #360 and #362.

---

## 3. Execution recipe

```powershell
# 1. fresh state (schannel fails on this box — force openssl for the fetch)
git -c http.sslBackend=openssl fetch origin --prune
git status -sb
git checkout -b fix/money-<slug> origin/test        # or fix/creator-<slug> / fix/wire-<slug>

# 2. the gate — run it DETACHED, then judge it by the LOG's own lines
npm run verify *> "$env:TEMP\vC.log"
Select-String -Path "$env:TEMP\vC.log" -Pattern 'Test Files|Tests  |built in|error TS'
Get-Item "$env:TEMP\vC.log" | Select-Object Length   # a 0-byte log is NOT a green gate
#   green:  Test Files  19x passed | 1 skipped (19x)   ·   Tests  <n> passed | 1 skipped (<n+1>)
#           ✓ built in <t>s    <-- without this line NO typecheck ran (it runs LAST, inside build)
#   a rising count after merging `test` is a REBASE; the flake reads `N passed` + `Errors 1`.

# 3. prove a fix-verifying test is not vacuous: stash the implementation, watch it fail
git stash push -q -- src/store/store.ts src/lib/earnings.ts ; npm test -- <suite> ; git stash pop -q
#   over a NEW test file the stash silently SKIPS it (use --include-untracked); a run reporting
#   "no tests" is a failed import, not a pass.

# 4. ship the wave (PR body: what changed, the evidence, the gate's own lines)
git add <explicit paths>              # never -A
git commit -F "$env:TEMP\msg.txt"     # `-F -` does not receive stdin through this shell
git push -u origin fix/money-<slug>   # needs the user's explicit confirmation (AGENTS §2.1/§2.8)
gh pr create --base test --fill
```

A dev server for a browser check: `npm run dev -- --port 5178 --strictPort` — and prove it serves *this*
tree with the Supabase project ref compiled in before trusting it. Probe `localhost`, never `127.0.0.1`.

**The `CHANGELOG.md` rebase protocol** (three rebases in one hour taught it): inside a **rebase**, `--ours`
is the **upstream base**, the opposite of the merge intuition. Take `git checkout --ours -- CHANGELOG.md`,
re-add only your own entry verbatim, then prove three things: `git diff --stat origin/test -- CHANGELOG.md`
reads exactly **1 insertion(+)**, no markers remain, and no `### Added/Changed/Fixed` heading was dropped.

---

## 4. Traps that have already cost this repo time

- **The gate and the log.** `npm run verify` outlives a shell window — run it detached and judge it by `Test Files` / `Tests` / **`built in`**, never by an exit flag (PowerShell turns
  npm's stderr progress into a fake `NativeCommandError`). `tsc -b --clean` dirties, it does not typecheck; a **0-byte** log is not green; `gh run watch` takes a RUN ID, not a PR.
- **A conflict-free rebase is not a correct one.** Git resolves text, not meaning: after any rebase that touched a file both sides edited, run the full gate before pushing.
- **Non-vacuity is part of done.** Stash the implementation and watch the new guards fail; a tripwire written after the fix tends to pass for the fix's own reasons. **Tests are
  node-env, no DOM**, so page-level behaviour is pinned by source-scanning guards — and **a source guard reads comments**, so a guard looking for an identifier matches the prose
  naming it (strip comments first). **Adding a field to a returned object breaks every `toEqual` on it** (#406): check whether an old pin was pinning the *defect* before "fixing" it.
- **`src/styles.css` is line-keyed.** An edit moves line numbers and `tests/design-system.test.ts` keys its findings to them, so `contrastLight` / `contrastDark` / `rawDurations`
  "fail" after a CSS change. Before re-baselining (`UPDATE_DESIGN_SYSTEM_BASELINE=1`), **prove the failure is only a shift** and the finding NAMES are identical before and after. The
  checker never walks the cascade, and `tests/stage2-p1.test.ts` asserts exactly **one** `@media (max-width: 1278px)` block — a comment merely *naming* that at-rule made the count 2.
- **Never trust the browser for entitlement or price** — probe rather than guess, with the anon key from `.env.local`:
  `curl.exe -s -m 12 -w "\nHTTP %{http_code}\n" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "$URL/rest/v1/<table>?select=*&limit=1"` —
  `200 []` means the table exists and RLS withholds the rows, `404 PGRST205` means it does not. For an **RPC send its real argument names**: a bare `{}` answers `PGRST202`.
- **Migrations and grants.** A redefinition inherits the holes of the body it copies, so read the whole function. A **grant is API surface**: `revoke … from public` does not revoke
  from `anon` *or* `authenticated`, and the right grant follows **who actually calls it** (grep first). `schema.sql` is a second way to build the database — a fix in the migration
  series alone leaves a fresh `schema.sql` instance wide open.
- **Cover plumbing.** `Special:Redirect` URLs cannot be browser-fetched (the 301 hop lacks CORS) — the copy path resolves via the wiki API and strips `?utm_*`; do not "simplify" it
  in passing. The publish path's `updateTrip` participates in the 600 ms debounced write coalescer, so a rollback write must go through the same path or it is swallowed by a
  coalesced snapshot.
- **Editing.** A scripted "insert after this anchor" edits every occurrence (`.NET String.Replace` / `-replace` have no first-only mode) — count the anchor first. PowerShell parses the
  whole script before running any of it: assert anchors and fail closed before any write. For JSON, `$env:` or nested quotes, use the `pwsh` tool with `curl.exe`.
- **Verification by browser.** A Supabase session is per-**ORIGIN**, and the signed-out app answers a protected hash route with the marketing landing rather than an error — sign in
  on the port serving the tree you are checking. Canvas-drawn UI is invisible to the accessibility tree; verify it through the DOM state it drives.
- **This repo is PUBLIC and its board is private**: never commit absolute Windows paths into tracked docs. And the **auto-close parser cannot read negation** — "this does not close
  #N" **closes #N**; `refs` is inert. Say `Closes #N` only when you mean it; explain a deliberate leave-open in a comment on the merged PR.

---

## 5. What you hand back to the user instead of doing yourself

1. **Any migration** (`supabase/migrations/<YYYYMMDD>_<name>.sql`): write it, verify it is idempotent, then **ask the user to run it** — paste the whole SQL in chat **and** give the
   full local path. The standing instruction is verbatim: *"whenever you ask me to run a migration kindly give me the whole code here or the complete local directory."* Then wait,
   then re-probe, then `npm run check:migrations`.
2. **Every merge.** You open PRs; the user merges. Never push to `test` or `main`.
3. **Product decisions this lane is already carrying three of:** #360's legacy hero/OG fallback (brand card or the live suggestion — both sides must agree), #407's refund receipt
   (preserve it with a migration, or accept the disappearance), #362's canonical origin (production-canonical + `noindex` on previews, or preview-origin addresses). Present 2–3
   options in the issue, pick none.
4. **Owner-gated rows** — no commit closes them: #227, #228, #230, #231, #232, #233, #234, #252.
5. **The promotion PR** (`test` → `main`) — a release cut with its CHANGELOG consolidation, version bump and roadmap snapshot, and only with the user's explicit confirmation.
6. **Anything needing a real payment, a real card or a real customer.**
7. **A judgement you cannot make from the code** — write the options and the tradeoff in §8 and ask.

---

## 6. The rest of the queue — who owns what

| Lane | Owner (clone) | Surface | Issues |
|---|---|---|---|
| **A** | DSH (`YatraFlow-DSH`) | the Map | #330, #415, #416, #420 |
| **C** | commandcode (`Yatraflow-commandcode`) | money, creator, the public wire | #348, #354, #355, #358, #359, #360, #361, #362, #363, #389, #390, #391, #395, #407, #409 |
| **D** | mcode (`Yatraflow-minimax`) | Settings, Budget, Group input | #381, #383\*, #384, #408, #411, #412, #413, #414 |
| **E** | cline (`yatraflow-cline`) | Overview, AI companion, Profile | #396, #397, #400, #401, #403, #404 |
| **F** | opencode (`yatraflow-opencode`) | My Trips, Trash, Import | #368, #385, #386, #387 |
| **G** | freebuff (`yatraflow-freebuff`) | shell, create, admin console, cross-cutting | #255, #365, #366, #367, #376, #377, #378, #392, #425, #426, #428 |
| **M** | the owner, not a code lane | launch-readiness + milestone tracks | #227, #228, #230, #231, #232, #233, #234, #236, #237, #239, #240, #252 |

\* **#383 is shared by D and F by design**: D owns Budget's failed-read branch, F owns My Trips' and
Trash's. The issue closes when both land; whoever lands second says so on the issue.

**Serial work, announced first:** **#425** (one shared selection and focus model — it touches `TripMap`,
`MapTab`, `TimelineTab` and `TripWorkspace`, i.e. three lanes at once) and **#426** (hash routing → real
paths, which must go **last of everything**). Both are lane G's; every other lane gives way when G
announces them.

---

## 7. Definition of done, per wave

A wave is done when **all** of these are true — the same bar every previous wave was held to:

1. The behaviour is fixed in the tree and the issue's own "how to verify" steps are answered.
2. A test that would fail on the pre-fix source exists (and you watched it fail — §3.3).
3. `npm run verify` is green on the branch by the LOG's own four lines, not by the exit code.
4. `CHANGELOG.md` has one entry under `[Unreleased]`, written as final state — no "round 2", no
   session history, no branch names.
5. The PR body names the issue, states the evidence, and quotes the gate's lines.
6. §8's ledger has a dated entry: what landed, the SHAs, the residual.

---

## 8. Your ledger — append a dated entry per wave

Template (keep it short; the next session reads it):

```
### 2026-09-XX — wave C<n>: <what> — <PR #/SHA> · gate: tsc clean · N passed / M files · built in Xs
- regions touched: <file> :: <function/memo>
- residual / next: <the next wave, or the reason it is blocked>
```

### 2026-09-28 — lane C re-cut for phase 3 (DSH)

- Lane C now owns **15** issues (§6). **#363 moved in from lane F today**: its root cause is `registerPubView` / `registerPubCopy` in `src/store/store.ts` plus the view/fork counters
  `src/lib/pubFunnel.ts` feeds Explore's sort and featured pick — the public wire, not My Trips. It sits in **C3**; lane F's brief was corrected to "#368, #385, #386, #387".
- **Phase 2's five PRs are all merged and their issues CLOSED** — #406 `e465f72`, #388 `69a319d`, #360's byte-cap half `f6df5c2`, #405 `ffe2872`, #364 `dfe4102` (#357 needed no code:
  `c460159`). Verified with `gh issue view` on 2026-09-28, not from memory.
- **Two stay open on purpose.** **#407** is settled and owes a *decision* (§2/C4). **#360** has two of three parts landed; its remainder is the legacy hero/OG fallback and needs the
  owner's answer. Both are §5 handbacks, not retries.
- **Clone state, re-derived:** on `lane-c/publish-honest` at `f6df5c2`, **behind `origin/test`** (`13fc92c`) — the branch is spent and its remote-tracking refs predate lane S's
  merge. Three untracked files, none of them mine. **The next session starts by cutting a fresh branch from `origin/test`** and does not rebase the spent one.
- **Verified live in the tree today** (so the next session does not re-derive): the ShareTab trim (`const cover = trip.coverImageUrl?.trim()`), the `busy` publish guard with its
  per-field `setErr(null)` clearing, `removeMember` / `setMemberRole` still naked `fire(...)`, the `registerPubView` / `registerPubCopy` optimistic-then-fire shape with no fork
  dedupe, Explore's `popularity = p.views + p.copies * 5` with `FEATURED_MIN_VIEWS = 25`, and `api/sitemap.js`'s `MAX_URLS = 1000`.
- **No regions announced yet** for C1–C4 — announce them here, by file and function, before the first edit. The `store.ts` regions for #361, #391 and #363 must be announced before
  any of them starts.

### 2026-09-28 — wave C1: the creator's own numbers — branch `fix/money-payout-carry`, cut from `origin/test` at `13fc92c`

**Regions announced before the first edit (all inside lane C's own holdings; no lane A/D/E/F/G surface, no
`store.ts`, no `styles.css`, no `api/*`, no migration):**

- `src/lib/earnings.ts` :: `payoutStatus` (re-signature to take a walk's final state instead of a raw net),
  `payoutPeriods` (the carry walk + the new per-row `carriedInInr` / `cumulativeInr` fields),
  `PayoutPeriod` (interface), `payoutPeriodStatus` (wording for a row that cleared on a carry),
  and a new exported `payoutWalk` derivation that both the header and the rows read. `revenuePeriods`,
  `PayoutStatus`'s `dueAt`/`minimumInr` and the whole fee ladder are **untouched**.
- `src/lib/pubFunnel.ts` :: new exported pure `funnelBarScale` (the bar's shared denominator) and the
  `describePreLog` date clause. `conversionPct`, `forksExceedViews`, `buildPubFunnels`' arithmetic, the
  window rule and `funnelGlance` are **untouched** — the rate stays pinned unclamped.
- `src/pages/CreatorHubPage.tsx` :: `FunnelLine` (the `hub-lead-bar` inline sizes, off `funnelBarScale`) and
  `HubOverview`'s `recordingSince`/framing-note copy (the page-level "recording began" qualification).
  `payoutStatus`'s call site in `EarningsTab` moves to the walk. No other region of the hub is touched.
- `src/lib/unlock.ts` :: `fetchMyEntitlements` only — the catch-to-`[]` is replaced by the `fetchMyPurchases`
  rejection shape. `fetchMyPurchases`, `fetchCreatorSales`, `fetchCreatorFunnel`, `fetchAdminRevenue` and
  `reportReadFailure` are **untouched** (each is another surface's contract).
- `src/pages/PublicItinerary.tsx` :: the entitlement-read effect and its new three-state derivation
  (`entitlementRead`), plus the three CTA sites that render the price button. The funnel glance block and
  every other region of the page are **untouched**.
- `tests/earnings.test.ts`, `tests/pub-funnel.test.ts`, `tests/payments-wiring.test.ts` :: extend only.
- **#360 is NOT in this wave.** Its remainder is the legacy hero/OG fallback, which §5 item 3 makes the
  owner's decision; the trim and byte-cap halves already landed (`#477`, `#478`). Announcing it here so no
  lane mistakes C1 for the whole of #360.

### 2026-09-28 — wave C1 landed on the branch: the creator's own numbers (#348, #358, #359)

- **Gate, read from the log's own lines** (`%TEMP%\vC1b.log`): `Test Files 208 passed | 2 skipped (210)` ·
  `Tests 2832 passed | 2 skipped (2834)` · `built in 9.94s` · **zero `error TS` lines**. `tsc -b --clean` runs
  first and dirties, so the `built in` line is the only proof the typecheck actually ran (AGENTS §3).
- **Non-vacuity, measured not asserted.** `git stash push -- src/lib/{earnings,pubFunnel,unlock,forkPub}.ts
  src/pages/{CreatorHubPage,PublicItinerary}.tsx`, keeping the new tests, then running the four affected
  suites: **22 failed | 122 passed (144)**. Restored with `git stash pop` → 4 files / 144 green. The 22 are
  the new guards; the other 122 are the pre-existing pins that must survive, and they did.
- **Three pins that asserted the DEFECT and had to be inverted, not deleted** — worth knowing for the next
  wave: `payments-wiring`'s *"never treats a missing entitlements table as an error surface"* asserted the
  exact `catch … return []` that #359 removes (it now asserts the rejection); `public-unlock-freshness`
  pinned `unlockedPresentationOnly === true || hasUnlock(await fetchMyEntitlements(…))` as a single `||`,
  which became an explicit branch because that read now throws; `earnings`' *never calls a past run paid*
  sliced `payoutPeriodStatus` and matched the quoted literal `'Owed — not disbursed'`, which is now a
  template. **Each was rewritten to keep its original intent** (honest degradation / never trust a negative /
  never say "paid") rather than loosened to pass.
- **Two test-authoring traps hit, both mine, both the kind that pass for the wrong reason.** (1) A helper
  taking "nets" but passing them as `amountPaidInr` through `deriveActualSales` tested the 15% ladder, not
  the carry — ₹300 in read as ₹255 out. The fix states the input's own `netInr` in the `SaleRow`s, and the
  comment says why. (2) `payoutPeriods` returns **newest-first**, so the "walks oldest first" test asserted
  `periods[1]` for the older run and passed for the wrong reason until the indices were checked against
  `buildSalesLedger`'s own newest-first sort.
- **A gate flake worth recording, and it was NOT this wave's code:** `tests/mutation-lifecycle.test.ts >
  composes a stop removal in exactly one place` failed once with **`Test timed out in 5000ms`**, not a wrong
  value — its `filesWith` does a *synchronous recursive read of every file in `src/`* and blew the default
  5s on a cold cache. It is lane S's file (#424) and outside this lane's regions, so it was left alone; the
  next run of the identical tree was green (208/210). **Anyone who sees this one red: read the failure text
  before blaming the diff** — a timeout there is the environment, and `git grep 'removeStopFromDay(' -- src`
  answers the real question in one call (two sites, as the test expects).
- **regions touched:** `src/lib/earnings.ts` :: `payoutStatus` · `payoutWalk` (new) · `payoutPeriods` ·
  `PayoutPeriod` · `payoutPeriodStatus` · `src/lib/pubFunnel.ts` :: `funnelBarScale` (new) ·
  `funnelBarPos` (new) · `describePreLog` · `src/lib/unlock.ts` :: `fetchMyEntitlements` only ·
  `src/lib/forkPub.ts` :: `forkPublication`'s entitlement gate · `src/pages/CreatorHubPage.tsx` ::
  `FunnelLine`'s `hub-lead-bar` · `HubOverview`'s framing note · `EarningsTab`'s payout call site and the
  runs table · `src/pages/PublicItinerary.tsx` :: the entitlement effect, `entitlementRead`/`mayShowPriceCta`,
  `UnlockCheckState` (new), both price-CTA sites, the post-purchase re-read.
  **`store.ts` was NOT touched**, so #361/#391/#363 are still free.
- **residual / next:** C2 (#354, #361, #389, #390, #391) is next and is the wave that DOES enter
  `store.ts` — announce its three `store.ts` regions here before the first edit, and serialize `api/i.js`
  only if C3's #362 is running. #360 is still owed the owner's answer, not a diff.

### 2026-09-28 — wave C1 SHIPPED: PR #496 · `dca4fc9` on `fix/money-payout-carry` — **open, awaiting your merge**

- **CI on the PR, not just the local gate:** `Verify (tsc --clean + tests + build)` **pass** in 49s, Vercel pass,
  Vercel Preview Comments pass, Codacy `success` with **`annotations_count: 0`** (the `action_required` quirk
  hides real findings, so the count was fetched — 0 is the clean signature, AGENTS §3).
- **C1 closed three issues, so `gh issue view 348/358/359` will show CLOSED only after you merge this into
  `test`.** The auto-close workflow mirrors on merge; the keywords in the PR body are `Closes #348/#358/#359`
  and they say exactly what is meant. **If you merge and the issues stay open, close them by hand** — AGENTS
  §2.12 has bitten this repo before, and the tracker must mirror reality rather than the keyword's promise.
- **Free for the next wave:** `store.ts` is untouched, so #361 / #391 / #363 are all still available.

### 2026-09-28 — wave C2 announced BEFORE the first edit: publish, share, cover (#354, #361, #389, #390, #391)

**`store.ts` is CONTENTED (D, F and G all touch it), so every region is named here by function, and each is
kept narrow and additive. Cut as `fix/creator-publish-honest` from a fresh `origin/test` — NOT from C1's
branch, which is spent once #496 merges.**

- `src/store/store.ts` :: `publishItinerary` — three edits, all inside that one function: (a) **#354** the form
  rules become writer-side refusals with the form's own messages, so a direct store caller cannot publish a
  coverless / all-free-but-priced / over-cap row; (b) **#354** the `visibility → public` flip becomes an
  AWAITED write with rollback instead of `fire(...)` — a rejected flip must not leave Explore live over a page
  that serves nothing; (c) **#361** the cover is owned BEFORE the optimistic commit, and the upsert-failure
  rollback restores the TRIP's previous `coverImageUrl` as well as the publication row. `publishedAt`
  preservation, `refreshedAt` bumping, the `hasRefreshedCol`/`hasUnpublishedCol` probes and the
  `markLocalWrite` on success are **untouched** — sitemap ordering and the #350 marker depend on them.
- `src/store/store.ts` :: `setMemberRole` and `removeMember` — **#391**, rollback + a failure toast on each
  (the `publishItinerary` upsert-failure block is the template). `restoreMember` is read, not changed: the 7s
  undo window covers intent-regret and rollback covers write-failure, and both are wanted.
- `src/store/store.ts` :: **nothing else.** `collectUnclaimedCovers`, `joinViaInvite`, `ensureInviteCode` and
  every stop/mutation writer are read-only here. The stop path stays lane S's `mutationLifecycle`; this wave
  adds no second pending-mutation system (§1 and §2's `mutationLifecycle` note).
- `src/pages/trip/ShareTab.tsx` :: `PublicationForm` (the six rules become a rule→field map for **#389**,
  the `FormErrorSummary` mount, first-invalid `.focus()`), the cover picker's mount site, and
  `SnapshotCard.makeLink` (busy guard + error toast, **#391**). The `busy` publish guard, the per-field
  `setErr(null)` and the trimmed `cover` write from #388 are **untouched** — #389 extends them, never undoes.
- `src/components/CoverImagePicker.tsx` :: `onCustom` (validate before storing, **#390**), `onAuto` (a total
  miss says so through the existing `role="status"` channel instead of clearing silently), the error surface
  (bucket-missing gets friendly copy with the raw message logged), and a new `error` prop (**#389** — two of
  the six publish rules target the picker and it takes no `error` today). The uploader-id behaviour, the
  busy union, sized-on-write, the orphan rule and the resolve-before-fetch CORS design are **all verified
  sound and must not be "fixed"**.
- `src/lib/coverUpload.ts` :: only the bucket-missing classification for #390. `COVER_MAX_EDGE`, the
  5 MB cap, the resize-before-upload economics and `ownSuggestedCover`'s never-throws contract are untouched.
- `tests/share-preview.test.ts` :: the SAME-LITERAL pin gains a THIRD site (`CoverImagePicker`'s new check) —
  `^https://\S+$` now lives in three places and the test is what keeps them one literal. **If that regex moves,
  `ShareTab` + `api/i.js` + the picker + this test change in one commit** (§2's pitfall).
- **A migration is owed for #354's DB backstop** (CHECK constraints on `published_itineraries`), so per §5 item
  1 it will be written, handed to you as whole SQL in chat with its local path, and re-probed after you run it.
  **`schema.sql` is a second, independent way to build the database** (§4), so the fix goes in both and a test
  compares them.
- **`api/i.js` is NOT touched in C2** — it stays serialized and free for #360/#362. `public/robots.txt` and
  `vercel.json` are untouched too.
