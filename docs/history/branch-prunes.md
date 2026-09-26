# Merged branches pruned — the running record

Point-in-time record. Two prunes happened on **2026-09-20**: the batched sweep of 17 refs
below, and then — under the convention that sweep introduced — a single branch pruned at the
moment its PR merged. A third sweep, recorded in its own section below, pruned the three
`test`-merged hold-outs on **2026-09-22**, once the v0.65.0 promotion made their work
ancestors of `main`. This file is what keeps all of it reversible in writing. `main` was
`55efd21` on 2026-09-20 and `3893ccc` at the 2026-09-22 sweep; `test` was `e5bba2a` during
the first sweep and `9bac779` at the second prune.

## Why these, and why it was safe

Until this date the repo kept every merged branch as archaeology — 26 remote heads, of which
21 described work already contained in `main` or `test`. The 17 below were each verified as
an ancestor of `origin/main` immediately before deletion (`git merge-base --is-ancestor
origin/<branch> origin/main`, all exit 0), which is the strict test: **every commit on them
was already reachable from production**, so deleting the ref removed no content at all.
Their PRs merged via merge commits rather than squash, so nothing was orphaned.

The prune is deliberately partial. Two branches merged into `test` but not yet into `main`
(`docs/creator-market-research` #254, `fix/explore-clipping` #261) were **kept** until the
next promotion, and the branches with unmerged or superseded work were kept outright — see
"Not pruned" below. The argument for the sweep was redundancy, not rot: nothing here was
stale by age, the oldest being nine days old.

## The 17 deleted refs

| Branch | Head SHA | Owning PR |
|---|---|---|
| `audit/ui-complete-2026-09` | `817699daeff5d16795adc8d65fb8100d92be3735` | #257 |
| `chore/untrack-verdent-scratch` | `afb02c012e8a927585021712661e73fbe492a400` | #263 |
| `ci/verify-prs-into-test` | `f1a74760042cfc27a6bd0328b51be3be6538f9b5` | #266 |
| `docs/commercial-launch-docs` | `17a7908c47a6d5c46ec15d0da30960868a524c39` | #214 |
| `feat/clock-living-plan` | `821ee8f1874f1277b35e2c59efef92f18ef4134c` | #262 |
| `feat/clock-map-zones` | `16742e7c25b59405e0813c97be935497677cdf67` | folded into #262 |
| `feat/itinerary-import-v2` | `17640d5c4f87a20d03277ee78efb5d70f7f5764d` | #253 |
| `feat/payments-rail` | `c9487be60e4fbd4f87304b209644bce0f674cc1a` | #251 |
| `feat/seo-discovery` | `358db2e840ec70b82f5d0f82e761866fa23f9b85` | #258 |
| `feat/together-rls-suite` | `2c2cfc7476e5b35fcf2ce3da1cdc335c29fed0c0` | #249 |
| `fix/map-polyline-perf` | `2bbd6edb03b3ac42f473e205c8f3796aaf383d29` | #224 |
| `fix/paywall-rpc-literal` | `1d4467f5f64257ae3fa0132052ab5d2721635da9` | #256 |
| `fix/public-address-bar` | `909c450d4722e81dd66594ad53d557bb119771d1` | #246 |
| `fix/public-surfaces-audit` | `5c69080f4e086eba36597f295b9905983f76a86d` | #250 |
| `freebuff/m6-together` | `eac92eab66728f78d7f781a39c0f55fc4b5cbb4e` | #265 |
| `refactor/design-baseline-selector-keys` | `e05c97f425a7165e75f9f9f173a750e3e7ff2601` | #264 |
| `refactor/map-rail-calm` | `bcf139822458c41545e0b3baaea4604b2edfa340` | #260 |

## Pruned at merge: `feat/settle-nudge-decision-comments` (#268)

The sweep above was a one-off cleanup; this is the first application of the convention it left
behind — **a merged branch is pruned at merge**, because the branch name was only ever a
pointer and the PR is the archaeology. PR #268 merged into `test` as `9bac779`, and its head
was deleted within minutes of the merge.

| Branch | Head SHA | Owning PR |
|---|---|---|
| `feat/settle-nudge-decision-comments` | `607d52fd4bdaf879a685b094d4bbdf314a06f18d` | #268 |

The same pre-flight gate ran, and aborts wholesale on any of its checks: the ref still pointed
at the exact SHA that merged (`607d52f`, not advanced since), no PR was open against the
branch, and `refs/pull/268/head` resolved before deletion.

**One honest difference from the 17 above: this branch is not reachable from `main`.** It
merged into `test` (`9bac779`, 25 commits ahead of `main` at `55efd21`), so it is an ancestor
of `test` only — the "from `main`" recovery path did not apply to it until the next
promotion. The PR path did, and was verified. (It reached `main` with the v0.65.0 promotion,
PR #304, so both paths answer for it now.)

## Pruned at the v0.65.0 promotion (2026-09-22): the three `test`-merged hold-outs

The 2026-09-20 sweep deliberately kept branches whose work had merged into `test` but not yet
into `main`. **PR #304** (the v0.65.0 promotion, `main` and `test` both at `3893ccc`, merged
2026-09-22 16:01 UTC) made all of that work ancestors of `main`, and these three refs were
pruned in its wake. Verified gone 2026-09-22 via `git ls-remote --heads origin` — **5 heads
remain**: `main`, `test`, and the three kept-on-purpose branches in "Not pruned" below.

| Branch | Head SHA | Owning PR |
|---|---|---|
| `docs/creator-market-research` | `09c57d047011efd05929df28dc5db42696764e37` | #254 (→ `test`, merged 2026-09-20) |
| `fix/explore-clipping` | `da0e724e7b339ac5528f98c575b2a3e8fac7ba59` | #261 (→ `test`, merged 2026-09-20) |
| `fix/onboarding-design-audit` | `9270a2e4e974c5010312ec31b0a811b9981cdb51` | #269 (→ `test`, merged 2026-09-20) |

The deleted refs cannot be re-inspected, so each SHA above is its PR's head as GitHub
recorded it (`gh pr view <n> --json headRefOid`), not a fresh ref read. Both recovery paths
answer for all three, and were checked 2026-09-22: `refs/pull/<n>/head` resolves for #254,
#261 and #269, and the compare API reports `main` strictly ahead of each SHA
(`behind_by` 0) — every commit on them is reachable from production.

## How to recover one

Two independent paths, either of which works after the prune:

- **From the PR** — GitHub keeps `refs/pull/<n>/head` for merged *and* closed PRs, so the
  exact head comes back with `git fetch origin pull/<n>/head`. Verified on the remote for
  #235, #254, #261 and #265, including #235, which was closed without merging.
- **From `main`** — every SHA in the 17-ref sweep above is an ancestor of `main`, so
  `git branch <name> <sha>` restores the ref from what production already holds. (The #268
  entry and the three 2026-09-22 hold-outs reached `main` with the v0.65.0 promotion — the
  compare checks in that section are the proof.)

The PR is the durable artifact; the branch name was only ever a temporary pointer to it.

## Not pruned, and why

| Branch | Reason kept |
|---|---|
| `main`, `test` | the two long-lived refs |
| `refactor/brand-seam` | archived by decision; no PR ever, so the branch was the only remote copy of its commit |
| `explore/landing-hero-local` | landing-page experiment; no PR ever, same single-copy situation |
| `feat/share-preview-og` | PR #235 closed as superseded; kept as the counter-example whose `api/i.js`/`shareUrl.ts` must not be merged over the versions that landed |

---

# Merged branches pruned on 2026-09-22

Point-in-time record: the sweep after the **v0.65.0** promotion (`3893ccc`). 41 remote heads
before, **5** after — `main`, `test`, and the three keeps from the section above
(`refactor/brand-seam`, `explore/landing-hero-local`, `feat/share-preview-og`). PR **#294**
was closed by hand first (with a comment recording that the queue integration merged its
branch directly), so the gate's open-PR check ran against the real world.

## Why these, and why it was safe

One scripted pre-flight that aborts wholesale, per the AGENTS prune gate: each of the 36 was
verified (a) an ancestor of `origin/main` **or** `origin/test` (both `3893ccc` after the
promotion), (b) with **no open PR**, and (c) with PR history present — or, for the two
never-PR'd refs, ancestry alone, which is the strict test (their commits are reachable from
`main`). All 36 passed. This is not an age-based cleanup: `docs/roadmap-slots-decisions` was
four days old and went for merged-ness alone.

Two mechanics this sweep taught (now rules in AGENTS §1.1):

1. **Enumerate with `git ls-remote --heads origin`**, not `for-each-ref refs/remotes/origin` —
   the namespace's own `origin/HEAD` prints as a phantom `origin` "branch", passes an ancestry
   check (it carries `main`'s SHA), and cannot be deleted: one un-deletable name in a batched
   `git push --delete` **aborts the entire sweep** (the first attempt deleted nothing).
2. **Record every head SHA before deleting** — a successful `push --delete` also prunes the
   local remote-tracking refs. The SHAs below come from each PR's `head.sha` (GitHub keeps
   `refs/pull/<n>/head` after branch deletion, so every deleted head stays fetchable).

Note: three rows of the "Not pruned" table above expired and were pruned here —
`docs/creator-market-research` (#254) and `fix/explore-clipping` (#261) at this promotion,
`fix/onboarding-design-audit` (#269) at its merge. Local refs were **not** touched:
`feat/migration-status-check` and `fix/map-day-fit` remain as local branches — and the latter
carries two unpushed coordinate commits (`55a3a5a`, `7845d0e`) whose only copy is this clone.

## The 36 deleted refs

| Branch | Head SHA | Owning PR |
|---|---|---|
| `cline/g9wfhxqs` | `68c3764df212952b9001b7254a91009d3a6ba935` | — (no PR; cline artifact of `feat/ai-companion-m5`, same head) |
| `docs/creator-market-research` | `09c57d047011efd05929df28dc5db42696764e37` | #254 |
| `docs/roadmap-slots-decisions` | `23a9d0df701f925cd2d7d9f5b41af08cbfae4ad5` | #299 |
| `feat/admin-revenue` | `32fa5d0d5bc89def53d5f472c86c47ffedabb97e` | #277 |
| `feat/agents-sandbox-docs` | `30be334aeb27b80bb98e0df1199e6fb96ce79a51` | #280 |
| `feat/ai-companion-m5` | `68c3764df212952b9001b7254a91009d3a6ba935` | #289 |
| `feat/console-by-pub` | `c5d839032bfba687a701035e5b0062942b150352` | #284 |
| `feat/create-funnel-p1` | `6453ff199a88d72cffc0e3e25f02f850d85f9751` | #302 |
| `feat/day-slots-engine` | `3b6a814df5c95419005d0afcae612e843b11176f` | #271 |
| `feat/doc-drift-gate` | `8aeb913fd0902cb7b3e46b484674ec6794c31fbf` | #282, #278 |
| `feat/fee-ladder-payouts` | `5df9d357d9a6525c11391cc1fba51cdc7fdb2086` | #276 |
| `feat/fixture-kit` | `7a26605adc6e0468c4b9681f09ed2e16d9b46a5e` | #286 |
| `feat/fixture-v2` | `f1bdb9faf61b6574ff088bdc7c690989510d198c` | #283 |
| `feat/funnel-record` | `76cb93cb5cf8bb583c6cc4e04d96f791022e2e3f` | #281 |
| `feat/funnel-surface-retention` | `3fd1106df754ee0cd917c6fed73a0f30ea12bacc` | #285 |
| `feat/i21-share-card` | `ee55e799baad74ee00cc7aa97d9075359e7dc938` | #275 |
| `feat/m6-followups-i19-i16` | `643cbd537b2c66ba2d21d8e02d51f219b048303e` | #272 |
| `feat/map-search-fixes` | `43f2a8ce8c5fe317d9a78cf932a055171276e7c4` | #274 |
| `feat/map-slot-search` | `97a96cfde4297c3e8410a5374631ec8381a11379` | #301 |
| `feat/offline-read` | `50724b39536896c941b226624049c53d97892da4` | #294 |
| `feat/purchases-shelf-i20` | `372826e246afd33a1928870c29572041bf51dea1` | #273 |
| `feat/pwa-shell` | `b9ad58269d178b984f6f64e200e9d0cb0feb863e` | #293 |
| `fix/agents-recipe-and-eol` | `b7719bb2954462a02d705e1726daca9e54af0c52` | #288 |
| `fix/apk-native-shell` | `1d28676d7a3c1d8755981e5be30d5915acd3e49c` | #290 |
| `fix/board-kind-glyphs` | `4e25744c0b116651a9de0c7c9f174bfa7e3d674c` | #296 |
| `fix/design-language-audit` | `f613d9e9d1fc0ad93a837c92710c347bca1ee880` | #292 |
| `fix/explore-clipping` | `da0e724e7b339ac5528f98c575b2a3e8fac7ba59` | #261 |
| `fix/map-day-fit` | `a558bfccddefec4166320ece2148b7d5fa699731` | #300 |
| `fix/map-tab-batch` | `317179179179a9feecf3b47dde9942c4137397ce` | #297 |
| `fix/map-tab-p3s` | `d7feae5082180cd7904062daccf33be97973953a` | #303 |
| `fix/map-tab-review-round` | `7f4c58bf2a42ef93bc33f5d3ff5eb8834db48c28` | #295 |
| `fix/map-tab-tray-drift` | `d7e3f4b4ce0d1c064df9d2a63632b95a9327ffab` | #298 |
| `fix/migration-guard` | `144de63f17df397d426be98b1d381588bcf8eb1d` | #287 |
| `fix/onboarding-design-audit` | `9270a2e4e974c5010312ec31b0a811b9981cdb51` | #269 |
| `redesign/landing-taste-pass` | `e8c0a1881f7f83b0dd0f80c431bdd37dab87d5ea` | #279 |
| `security/audit-fixes` | `e3598507dce627b84a5511c6229778d285b20e49` | #291 |

---

# Merged branches pruned on 2026-09-23

Point-in-time record: the sweep after **#305, #306 and #307** merged into `test` (all three
2026-09-23). 8 remote heads before, **5** after — `main`, `test`, and the three keeps from the
section above (`refactor/brand-seam`, `explore/landing-hero-local`, `feat/share-preview-og`).

## Why these, and why it was safe

One scripted pre-flight that aborts wholesale, per the AGENTS prune gate; every head enumerated
with `git ls-remote --heads origin` and every SHA below captured **before** deletion (the
`push --delete` that follows also prunes the local remote-tracking refs). Per branch, four
checks had to pass, and all three did:

1. the local `origin/<b>` ref agreed byte-for-byte with the fresh remote (no racing refs);
2. the head was an **ancestor of `origin/test`** (all three are `test`-only — none had reached
   `main` yet, which the gate allows: merged-ness in the branch's own target is what matters);
3. the owning PR read **`MERGED`** (`gh pr view <n> --json state`);
4. the name was not on the keep-list.

Then one batched `git push --delete` for all three. The same fetch's `--prune` also reaped **34
stale remote-tracking refs** the local namespace still carried from the 2026-09-22 sweep
(`origin/fix/map-tab-p3s` et al.) — they were already gone from the server; the local view just
hadn't caught up. Remote view and local view now agree at 5 heads.

## The three deleted refs

| Branch | Head SHA | Owning PR |
|---|---|---|
| `cline/fcbce69x` | `ed44063b89fa49e7c8b7da0456cd3b493c2be795` | #305 |
| `feat/theme-selection-caret` | `b92c858eca49e13540fa8e5433439f7195023b6f` | #306 |
| `fix/entry-path-review` | `9c321c90240fb8fef69dff89e7f1ccd3f3c31692` | #307 |

All three SHAs remain fetchable via `refs/pull/<n>/head`. This sweep's own record-carrier
(`docs/roadmap-slots-record-sync`) is **pruned at its own merge**, moments after this text
reaches `test` — its head SHA post-dates this commit by construction; read it from the PR
(`gh pr view <n> --json headRefOid`), which is also where the deletion is verifiable.

## Local refs this time: 17 deleted, 3 kept

Unlike the 2026-09-22 sweep (which deliberately left local refs alone), this clone's own
branches got the same gate: 17 were ancestors of `origin/test`/`origin/main` and were deleted
with `git branch -D` (all recoverable — e.g. `fix/map-tab-p3s`, `feat/map-slot-search`,
`docs/roadmap-slots-decisions`, `promote`-era helpers). Local `test` and `main` were
fast-forwarded to their remotes. **Kept pending a human check**, because they are *not*
ancestors of either remote tip and may hold work that exists only here:

| Branch | Head SHA | Why kept |
|---|---|---|
| `conflict/268-settle-nudge` | `d2fafabc762a579d460a0d472da6b347aa831543` | not in `origin/test`/`main` — possible unpushed variant of #268's conflict resolution |
| `docs/changelog-269` | `a77f6e767b288fc5ebc74f397d5c63fb5a18ac03` | not in `origin/test`/`main` — possible unpushed changelog work for #269 |
| `promote/v0.64.0` | `2fd3e7ddd68e61f92580c5fbb9711619027d9aca` | the v0.64.0 promotion branch; `main` took that release as a reconciled squash (`f50a47a`), so the original line may not be an ancestor anywhere |

How to recover any branch deleted here: `git branch <name> <sha>` — every SHA above is reachable
from `origin/test` (or from `refs/pull/<n>/head` where only the PR answers). For the three kept
locals: `git cherry origin/test <name>` reports whether their patches are already upstream before
anyone decides to delete them too.

# Merged branches pruned on 2026-09-24

Point-in-time record: the sweep after **#315, #316, #317 and #318** merged into `test` and
**#319 promoted `test` → `main` as v0.66.0** (#320 then reconciled the status docs the promotion
had invalidated). **16 remote heads before, 7 after** — `main`, `test`, the three keeps carried
over from the sections above (`refactor/brand-seam`, `explore/landing-hero-local`,
`feat/share-preview-og`), and **two heads that failed the gate** and were left alone.

## Why these, and why it was safe

One scripted pre-flight over every candidate, after a fresh `git fetch origin --prune` so the
local remote-tracking refs could not disagree with the server. Per branch, three checks, and all
nine passed:

1. the head was an **ancestor of `origin/main` or `origin/test`** — merged-ness in the branch's
   own target, not in `main`;
2. the **open-PR check was empty** (`gh pr list --state open` returned nothing);
3. the name was **not on the keep-list**.

Only then was the set deleted, in one sequence — no branch was hand-picked, and a branch that had
advanced since the last sweep would have failed (2) or (1) and been left standing rather than
deleted blind. The two that did fail are named at the foot of this section.

Eight of the nine heads have an owning PR that reads `MERGED`. The ninth, `cline/6v9pm0gn`, has
**no PR at all**: its single commit `dc3baa1` was pushed straight to `main`, so the branch is
redundant but its provenance is a direct push rather than a review — recorded rather than
smoothed over.

## The nine deleted refs

| Branch | Head SHA | Owning PR |
|---|---|---|
| `cline/6v9pm0gn` | `dc3baa10beb49f09162f2d77d88fb32ec7f4197c` | none — pushed straight to `main` |
| `docs/post-promotion-v0.66.0` | `9eddfee555ed8d1bb93628515225e22d030f5278` | #320 |
| `docs/promote-v0.66.0` | `4277646fa091c0047231ff31943af9f30231a992` | #318 |
| `feat/creator-hub-dashboard` | `cbf4870e9d3d4e490c6d53058714534fb447bd55` | #315 |
| `feat/tripcreated-reveals` | `816ff496e6d8b3693af948ae771a5d8a6e84080c` | #313 |
| `fix/bench-title-ramp` | `378fd001cdf6f0d9f51cf183cef632c4e8952a14` | #314 |
| `fix/create-funnel-look` | `e2020377271cefd96b714f6721c7a6a4aad9ef63` | #310 |
| `fix/map-search-route-bias` | `f7beb21edd580ca9dbf6efb50dee858415019b1e` | #316 |
| `fix/og-card-font` | `ed973067c9705d56bacaa3f1e26c312b07289a93` | #317 |

Every SHA above is reachable from `origin/main` or `origin/test`, and all but `cline/6v9pm0gn`
are additionally fetchable via `refs/pull/<n>/head`. This sweep's own record-carrier
(`docs/prune-v0.66.0`) is **pruned at its own merge**, moments after this text reaches `test` —
its head SHA post-dates this commit by construction; read it from the PR
(`gh pr view <n> --json headRefOid`), which is also where the deletion is verifiable.

## The two heads that failed the gate, and were kept

| Branch | Head SHA | Why kept |
|---|---|---|
| `cline/g9wfhxqs` | `ef9c0cc` | not an ancestor of `origin/main` or `origin/test` — another agent's branch carrying work this repo has never merged |
| `cline/n478z8sr` | `313999a` | same |

Both belong to the `cline` agent's line rather than to a merged PR, so the gate has no evidence
that deleting them is safe. They stay until someone with that context says otherwise.

## Local refs this time: 9 deleted, 10 kept

This clone's own branches got the same ancestor gate. Nine were ancestors of a remote tip and
were deleted with `git branch -d`. **Ten were kept**, and only two of those are the canonical
names:

| Branch | Head SHA | Why kept |
|---|---|---|
| `feat/creator-hub-dashboard` | `5797c1b022dc75685bfbda3380e2bfb4d32e8454` | **checked out in the primary clone** — git refuses to delete a branch a worktree is on. It is also 2 commits behind the remote head just pruned; switch that clone to `test` before deleting it |
| `backup/creator-hub-prerebase` | `0ed2fab958b18cd9f594b9ba6c9583d2bb9db17f` | pre-rebase safety ref for #315. **Not an ancestor of any remote tip** — its commits exist only in this clone |
| `backup/tripcreated-reveals` | `a06bacde2b5d4978326b843cf9e72ee68bf37d2b` | pre-split safety ref, same standing |
| `conflict/268-settle-nudge` | `d2fafabc762a579d460a0d472da6b347aa831543` | kept by the 2026-09-23 sweep as well; still not an ancestor |
| `docs/changelog-269` | `a77f6e767b288fc5ebc74f397d5c63fb5a18ac03` | same |
| `promote/v0.64.0` | `2fd3e7ddd68e61f92580c5fbb9711619027d9aca` | `main` took v0.64.0 as a reconciled squash, so the original line is an ancestor nowhere |
| `scratch/break-landing` | `a4e3c2faef608142d2cb7076f665e3dafe1c4146` | local scratch, not an ancestor — kept pending a human check |
| `scratch/hub-dashboard` | `34619ddc36667f4903da2ab7765024e928ecb726` | same |

`main` and `test` were left in place as the canonical names; both are behind their remotes and
should be refreshed with a pull before use rather than treated as current.

How to recover any branch deleted here: `git branch <name> <sha>`. For the kept locals,
`git cherry origin/test <name>` reports whether their patches are already upstream before anyone
decides to delete them too.

## 2026-09-25 — the Wave 0/1 closeout sweep: 3 refs

The audit-fix waves 0 and 1 closed with three of their branches still on the remote; the other
eleven had already been pruned at their own merges, under the convention above. Each of the
three was verified an ancestor of `origin/test` immediately before deletion, each had no open
PR, and every head SHA was recorded first. Remote heads went **14 → 11**. `test` was `c9a529f`
and `main` `244e74e` when the gate ran.

| Branch | Head SHA | Owning PR |
|---|---|---|
| `fix/map-core-flaws` | `7a57f642143bd297f2b52950847535a455827992` | #380 |
| `fix/map-safety-batch` | `8f0601566c5a3bf030ccd8c708fb0c99c319de9d` | #399 |
| `fix/public-unlock-freshness` | `e83cb5a05498a972e20803873b59391413c25223` | #435 |

Kept, unchanged from the sections above: `refactor/brand-seam` and `explore/landing-hero-local`
(no PR has ever existed, so the branch is the only copy), `feat/share-preview-og` (closed as
superseded), the two `cline` heads that fail the ancestor gate (`g9wfhxqs`, `n478z8sr`), and
every branch whose PR is open — `fix/hub-recovery-path` (#439), `fix/fixture-tooling` (#440),
`feat/resolve-pick-prompt` (#430), `cline/ftq10q0f` (#322). The closeout record for the waves
themselves, including the four rendered checks that were never driven, is
[`wave-0-1-closeout.md`](wave-0-1-closeout.md).

## 2026-09-25 — the v0.67.0 promotion: 5 refs

The promote branch was deleted at its merge, gated the same way as every sweep above: verified an
ancestor of `origin/main` immediately before deletion, no open PR, head SHA recorded first. `test`
was `73c7e0e` and `main` `af373cc` when the gate ran.

| Branch | Head SHA | Owning PR |
|---|---|---|
| `promote/v0.67.0` | `ee132c4644c596a9a9b32360162ef02e1b931ffd` | #446 |
| `docs/post-promotion-v0.67.0` | `3586ff058862e416c327f23bd99f0c11b0976e5c` | #447 |

**The four branches the sweep above held back because their PRs were open had all merged by the
time this one ran, and each passed the same gate** — every head a recorded ancestor of
`origin/main`, no open PR. Remote heads went **11 → 7**.

| Branch | Head SHA | Owning PR |
|---|---|---|
| `fix/hub-recovery-path` | `2a71c6352bf95e63f81d2209cdd75889f08189e5` | #439 |
| `fix/fixture-tooling` | `1975f487a25c54a35aa2c2a03828b893b7c03307` | #440 |
| `cline/ftq10q0f` | `b3d0ef9a56007a8aef57bc752e9cb8e93a4d8130` | #322 |
| `feat/resolve-pick-prompt` | `80cea7727682cd44c22a943470042586d8ac1c35` | #430 |

Two of those heads are not the branch's original commit: `fix/hub-recovery-path` and
`fix/fixture-tooling` were each updated onto `test` before their PRs could merge (both conflicted
on `CHANGELOG.md`, and neither had ever run CI), so what is recorded here is the merge-commit tip
that actually landed. Recovery is still through `refs/pull/<n>/head`, as always.

Kept, unchanged: `refactor/brand-seam` and `explore/landing-hero-local` (no PR has ever existed, so
the branch is the only copy), `feat/share-preview-og` (closed as superseded), and the two `cline`
heads that fail the ancestor gate (`g9wfhxqs`, `n478z8sr`).
