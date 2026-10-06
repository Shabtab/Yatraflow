# Verification and CI — YatraFlow

Extracted from `AGENTS.md` §3, which keeps the number: a `§3`, `§3.1` or `§3.2`
reference anywhere in this repo resolves to a section below.

Reach for this when running the gate, reading a CI result, or deciding whether
something is safe to push. **`AGENTS.md` §2 rule 8 still holds: never push to
`main`, `test` or any other branch without the user's explicit confirmation** —
the gate being green is not that confirmation.

**Before every push:** `npm run verify` (see below). The local gate and CI run
the same command; the migration check in §3.2 is the one thing `verify`
cannot see, and it is only owed when a release carries migrations.

Sections:
- **The gate** — what `npm run verify` runs, and the shell traps that make it lie.
- **§3.1** — what CI actually runs, per destination.
- **§3.2** — the migration status check, the one part `verify` cannot see.

---

## The gate

Use `npm run verify` — it runs the full gate:
`tsc -b --clean` → fresh typecheck → full test suite → production build.

Hard rules (each learned the hard way — do not relearn them):
- **After syncing a large remote update, run `npm install` before `npm run verify`.**
  The Capacitor Android shell added `@capacitor/*` dependencies that a pre-shell
  `node_modules` lacks; the first verify then fails with ~15 confusing
  `Cannot find package '@capacitor/core'` test errors that look like code
  breakage but are only stale dependencies (Sep 2026).
- **Bare commands only.** NEVER verify with `cmd /c "... & echo %ERRORLEVEL%"`.
  `cmd` expands `%ERRORLEVEL%` **at parse time, before the commands run**, so it
  echoes a stale exit code and masks real failures. This caused repeated
  "local passes / Vercel fails" drift (Aug 2026, twice).
- **PowerShell: a bare `echo;` (no argument) prompts for `InputObject` and hangs
  captured output** — always pass an argument (`echo '---'` / `Write-Host "…"`).
  The terminal looks stuck and shell-integration reports the command as still
  running (cost debugging time fetching `gh issue view` bodies, Aug 2026).
- **A source-scanning guard greps the whole file, so a COMMENT about the thing it
  guards will trip it (learned 2026-09-26, #333 A4).** The rail's "no control may
  opt out of the tab order" assertion (`not.toMatch(/tabIndex=\{-1\}/)`) went red on
  its own fix, because the comment explaining the removal quoted the literal it had
  just deleted. Fix it by spelling the literal out of the prose ("a -1 tabIndex",
  "buttons with onClick") — never by weakening the guard: a blanket check that no
  control opts out of the tab order is worth more than the sentence it costs. Same
  family as the literal-grep rules above, from the other side: a guard must be
  taught to resolve a new constant, and prose must not impersonate the code it
  describes. It is also a good sign — a guard that fires on its own documentation
  is a guard that is genuinely reading the file.
- **A JSX ternary branch holds exactly ONE expression, so a live region inserted as
  a "sibling" before it breaks the parse (learned 2026-09-26, #333 A5).** The slot
  list renders as `{slotsPeek ? (…) : (<div className="slots-list">…)}`, and dropping
  a `<span role="status">` in front of that div made two siblings in a single branch:
  the suite stayed green (**2436 passed**) while `npm run verify` failed in its LAST
  step — the `tsc -b` inside `build` — with `TS1005 ')' expected` at the div plus
  three cascading brace errors far below it. Put such a region INSIDE the container,
  which is also the better behaviour: it mounts empty and the text CHANGE is what
  announces. And when the suite is green but the gate is red, read the log for the
  `built in …` line — its absence is the only thing that distinguishes "the typecheck
  ran and passed" from "the typecheck never happened".
  That trap has a second mouth, hit the very next commit: a JSX **opening tag's
  attribute list is not a place for children either.** Inserting a `{/* … */}` and
  a `{cond && (…)}` after an element's `options={…}` line put them *between
  attributes* and produced `TS1005 '…' expected` twice — again with the suite green
  (2438 passed) and only the build's `tsc` complaining. When a scripted edit targets
  JSX, anchor on the element's closing token (`/>`, or the container's open tag) and
  insert there; "the line after the last attribute" is inside the tag.
- **`tsc -b --clean` first** in any session before trusting a typecheck —
  incremental build caches pass code that clean builds reject.
- **But `--clean` DIRTIES, it does not typecheck — and in `verify` the real
  typecheck runs LAST (learned 2026-09-20).** `tsc -b --clean` deletes build
  info and **exits without compiling**, and `verify` is
  `tsc -b --clean && npm test && npm run build` with `build` = `tsc -b && vite
  build`. So an undefined identifier reaches the test run *before* any
  typecheck happens and surfaces as a runtime `ReferenceError` in whichever
  suite exercises that path — the rebase of #261 left one use of a variable
  the other side had deleted and 18 hydration tests failed with
  `ReferenceError: catalogTrips is not defined` while the log contained no
  `error TS` line at all. A red run whose failures all sit in one code path
  and all report the same ReferenceError is a compile error wearing a test
  failure's clothes: read the failure's own text and grep the log for
  `[yatraflow]` before blaming the tests. And a green `verify` is only
  complete when the `built in …` line is present — that line is the proof the
  typecheck and bundle actually ran.
- **A conflict-free rebase is not a correct rebase — git's auto-merge can
  produce code neither side ever had (learned 2026-09-20).** Rebasing #261 onto
  `test` merged `src/store/store.ts` cleanly, but one side had deleted a
  `catalogTrips` query and the other had *added* a loop over it: the result
  referenced a variable that no longer existed, in a file git reported as
  merged. Auto-merge resolves **text**, never meaning. After any rebase that
  touched a file both sides edited, run the full `npm run verify` on the
  rebased tree before pushing — and when a suite fails wholesale after a
  rebase, suspect the merge of the file the suite covers before suspecting the
  branch's own change. The replay also means **the branch's CHANGELOG entries
  re-filed themselves into the released section** if the branch was cut before
  the release:  check `git diff origin/test..HEAD -- CHANGELOG.md` lands under `[Unreleased]`.
- **A custom `merge=<driver>` attribute can delete a file's change from a rebased
  commit while the rebase reports success (learned 2026-09-26).** Resolving a
  four-branch stack's recurring `CHANGELOG.md` conflicts with a `--union` driver
  (`git config merge.X.driver "git merge-file --union %O %A %B; true"` plus
  `CHANGELOG.md merge=X` in `$GIT_DIR/info/attributes`) rebased all three cleanly
  and reported "Successfully rebased" for each. Every one of the three commits had
  silently **lost its `CHANGELOG.md` change** — `git show --numstat <sha>` no longer
  listed the file at all, and the driver's `; true` was the tell: it exists to hide a
  non-zero exit, and that exit means `git merge-file` never wrote `%A`, so git
  recorded the path as merged with the upstream side alone. **Verify a driver-based
  rebase by content, not by exit status**: after it, `git show --numstat` each
  replayed commit and confirm the files you expected are still listed, and grep the
  file for each entry's own issue number. Prefer resolving doc conflicts by hand with
  editor primitives (§9); if a driver is used, drop the `; true`, treat a non-zero
  exit as a conflict, and check the file before continuing. The union driver also
  lives in the **shared** git dir of a linked worktree (`git rev-parse --git-path
  info/attributes` resolves to the main clone, not the worktree), so it silently
  changes merge behaviour for every other worktree — remove it when the job is done.
- **Probing a submit handler in the preview: `requestSubmit()` runs native
  constraint validation first** (measured 2026-09-23: a `min={0}` input holding
  `-5` fires `invalid`, never `submit` — the handler silently never runs and the
  browser's own bubble is the only symptom), so set `form.noValidate = true`
  before forcing a validation-error path; and never read the DOM in the same
  evaluate that triggered a React state update — the render lands next tick, and
  a same-tick read returns the stale tree, which looks exactly like a broken
  fix (three phantom "missing error" probes in a row came from these two).
- **`npm run verify` outlives a 30 s shell window — run it DETACHED and poll
  the log.** `Start-Process cmd.exe -ArgumentList '/d','/c','npm run verify >
  %TEMP%\v.log 2>&1' -WorkingDirectory <repo> -WindowStyle Hidden`, then
  `Select-String` the log in a follow-up call. Two traps this replaces
  (Sep 2026, clock-overlay phases): a foreground verify in a captured shell
  times out mid-gate and the result is unknowable; and PowerShell turns npm's
  stderr progress lines into a fake `NativeCommandError` exit 1 even when the
  gate is green — judge the run by the LOG's own summary lines
  (`Test Files`, `built in`), never by $LASTEXITCODE or the tool's error flag.
- **A merge's own output lists its conflicts by omission — `tail` hides them, and the `git status` U-list is the checklist (learned 2026-09-22, queue integration).** Two merges in one run printed three conflicted files each while a fourth (`AGENTS.md` both times) conflicted *above* the `tail -8/-10` window; `git commit --no-edit` then failed with `U <file>`, and a gate started over that half-merged tree is untrustworthy. After ANY merge or rebase step: `git status --short | grep -E '^(U|.U|AA|DD)'` FIRST, resolve every row, only then commit and gate. Companion: a `grep -c` that prints 0 exits 1 and silently short-circuits the `&&` chain after it — zero matches is a fact to report, not a command failure.
- **ANY `src/styles.css` edit moves line numbers, and the design-system
  ratchet reads line numbers — expect `contrastLight/contrastDark/rawDurations`
  to "fail" after every CSS change.** Before re-baselining, prove the failure
  is ONLY a shift: re-run with `UPDATE_DESIGN_SYSTEM_BASELINE=1`, then diff the
  baseline and confirm the finding names are identical before/after (e.g. 29
  in → 29 out). A name that appears on only one side is a REAL new violation —
  fix it, don't ratchet it in (Sep 2026, three label phases in a row).
  **A comments-only CSS edit is the exception, so run the ratchet before re-baselining
  (learned 2026-09-26).** Fixing stale prose in two `styles.css` comments — one of them
  adding lines — left `design-system.test.ts` green: the baseline records selectors and
  their measured ratios, not source line numbers, so a shift that moves no declaration
  moves no finding. The reflex the rule above invites ("CSS changed, expect red, re-baseline")
  would have rewritten the baseline to hide nothing and churned the diff for free. Order of
  operations: change the CSS, run the ratchet, and only reach for
  `UPDATE_DESIGN_SYSTEM_BASELINE=1` when it is actually red — then still prove the finding
  names are identical in and out.
- **The ratchet parses each selector's OWN declaration pair — it never walks
  the cascade (learned 2026-09-22).** A `:root` override can fix a contrast
  finding on screen while the baseline keeps it forever: `.day-warn-pill`
  rendered at its override's `--ink-amber` 5.38:1 while the baseline still
  recorded `.day-warn-pill — 3.69:1` from the base rule, so an audit reading
  the baseline reported a defect the screen did not have — and a browser check
  would have "disproved" it. Fix the **base rule** (the later override then
  becomes redundant), re-baseline, and expect exactly that name to LEAVE the
  diff; a name that stays means the fix never reached the declaration the
  checker parses. Same root, other direction: `offLadderSpacing` flags a
  `margin-right: 3px` written in CSS even when the component beside it renders
  the same gap from JS — pick the ladder value (4) in the CSS too.
- If Vercel's deploy fails, reproduce locally with `npm run build` (the exact
  Vercel command: `tsc -b && vite build`), not `tsc` alone.
- `npm warn allow-scripts` about esbuild is a **warning, not a failure**; it's
  allowlisted via `allowScripts` in package.json.
- **Never fetch with a wildcard refspec** (`git fetch origin
  '+refs/*:refs/remotes/origin/*'`) — it remaps `refs/heads/*` to
  `refs/remotes/origin/heads/*` and **deletes** `origin/main`, `origin/test`
  and PR-tracking refs, so `origin/main` becomes "not a valid object name".
  Use plain `git fetch origin [--prune]`; to grab a PR, use
  `gh pr checkout <n>` or `git fetch origin pull/<n>/head`.
- **On this Windows box a plain `git fetch origin --prune` can die with `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030E)`, exit 128 — it is not a credential problem and a retry does not fix it.** Force the OpenSSL backend for that one invocation instead: `git -c http.sslBackend=openssl fetch origin --prune` → exit 0, refs advance normally (2026-09-20, advanced `origin/test` `468fb18..6081f32`). **Companion sandbox fact: outbound HTTP works, but not to every host — do not assume a probe must be handed to the user (corrected 2026-09-21).** This entry used to claim the clone had *no* outbound HTTP, on the evidence of `curl.exe` returning `000` for every URL. That is not what happens now: `POST <project>/rest/v1/rpc/<fn>` answers for real, and the `admin_revenue` probe returned a genuine `404 PGRST202` naming the parameters PostgREST searched for — which is how the unapplied migration was confirmed *and* how the RPC's contract was cross-checked against the handler. So try the probe first and fall back to the user only if it returns `000`; a `000` means *that* host is unreachable, not that scripting is impossible. Two recipes worth keeping: a bare
```bash
curl -s -m 12 -w '\nHTTP %{http_code}\n' -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "$URL/rest/v1/<table>?select=*&limit=1"
```
discriminates a migration-gated table in one call — **`200 []` means the table EXISTS and RLS withholds the rows from an anon caller, `404 PGRST205` means it does not exist** — and control-running it against a nonsense table name is what anchors the reading, since `PGRST205` is also the exact code the client's degradation path keys on. `https://example.com` is the cheap "is the network up at all" check. Pull `$URL`/`$KEY` from `.env.local` (`grep '^VITE_SUPABASE_URL=' .env.local | cut -d= -f2- | tr -d '\r"'`) rather than pasting them into a transcript. **For an RPC, send its real argument names** — a bare `{}` answers `404 PGRST202` for a function whose parameters have no defaults, which reads as absent when the function is there and merely mis-called (measured 2026-09-22: `owns_publication` and `bump_published_stats` both looked absent that way and both exist); the same code, with the real arguments, is the honest missing-check. The root `/rest/v1/` schema endpoint is not an option for this — it answers `401 Invalid API key`, since only a `service_role` key may read it.
- **A fresh harness sandbox starts as a shallow, blob-filtered partial clone with only `test` fetched — no `origin/main` ref, no `node_modules`, no `.env.local` (learned 2026-09-22).** `git rev-list origin/main…` therefore dies with *unknown revision* until you fetch the ref you need; run `npm install` before any `npm run verify`; and the live-DB checks (`npm run check:migrations`, PostgREST probes) must run from the user's credentialed box, since the keys never reach this clone. The local `git log` is depth-1 — answer history questions with `gh api` / `git ls-remote`, not the local log.
- **A pull request can carry no `Verify` run at all, and its page will not say so (learned 2026-09-25).** Two PRs were pushed with **zero** workflow runs on their branches: `gh pr checks` listed only Codacy and Vercel, which reads as "the gate is fine" because nothing is red. `gh run list --branch <branch>` is what tells the difference — if it returns nothing for the head SHA, the gate never ran and a local `npm run verify` on that branch is the only evidence there is. Companion: a **stacked PR** (a branch cut from another PR's branch) shows only its own delta in `git diff <base>...<head>` while its PR diff against the base still carries the parent's work, so merge the parent first and then `git merge origin/test` into the child — the child's `CHANGELOG.md` conflict disappeared entirely once its parent landed.
- **When a release cut has already moved `[Unreleased]` into a version heading, an incoming `[Unreleased]` entry must be folded INTO that heading (learned 2026-09-25).** Merging `test` into a promote branch conflicts on `CHANGELOG.md` exactly this way; resolving it by keeping your own side silently drops the incoming entries from the release. Take the incoming file (`git checkout --theirs CHANGELOG.md`), re-apply the cut heading above its sections with `edit`, and check the entry count on both sides of the conflict before committing — twenty entries in, twenty entries under the heading.
- **A lane worktree lives OUTSIDE the session workspace, so the harness's default `workspace-write` policy denies every write to it — and a note claiming the sandbox is already full-access can be stale (learned 2026-09-27).** Where parallel lanes each get their own `git worktree` beside the clone (`git worktree list` names them), the first `write` into that tree comes back `[sandbox: file access denied]`: a policy fact, not a bad path. With an `ask` approval policy, retry that exact write once with `danger-full-access` — the narrower mode cannot reach outside the workspace, so it cannot be the answer; with approvals disabled, do the work inside the workspace instead. Re-derive the policy from the session's own runtime context rather than from a doc: the §2.7 dev-server entry describes the same failure shape, where the policy actually in force, not the tool, decides the outcome.
- **Never run dependent git checks as parallel shell calls** — during the PR
  audit, a ref-rewriting fetch raced a `merge-base --is-ancestor` check and
  returned contradictory results. Sequence dependent git commands in one call,
  and confirm merges via `gh pr view <n> --json mergeCommit` +
  `git merge-base --is-ancestor <mergeCommit> origin/main` (exit 0 = merged),
  not by eyeballing short `git log` windows.
- **`git rebase --continue` wants an editor in this clone, and the default one will hang you (learned 2026-09-20).** `git var GIT_EDITOR` answers `C:\WINDOWS\notepad.exe`, so a captured, non-interactive rebase stops dead on the commit message. Pass a no-op for that one invocation: `git -c core.editor=true rebase --continue` — `true` resolves because git runs the editor through its own `sh`, where it is a builtin. **Do not point `core.editor` at a Windows path**: git hands that string to the same `sh`, which eats the backslashes and fails with `C:Usershasna…: command not found`. That failure is harmless — the rebase is still in progress and the resolution is still staged — so just re-run with `true` rather than redoing the resolution. Same family as the `schannel` entry above: the friction is the shell git uses, not the git command.
- **A rebasing branch can find its change already landed — resolve by the item's identity, never by which hunk is bigger (learned 2026-09-20).** Rebasing #268 onto `test`, `ROADMAP.md` conflicted not over wording but over a **number**: both sides had written an `I-20`, for two unrelated ideas, and `test` already tracked the branch's idea as `I-19` in a *better* row — more accurate effort estimate, plus the reasoning the branch's row lacked. The correct resolution was to **drop** the branch's row (a deliberately redundant insertion, not a lost one), which is only visible if you read what each side's row *means* before resolving it. Expect this shape wherever a shared counter, ledger or issue number is allocated on both sides; a hunk-count or "keep both" instinct gets it wrong. Confirm the outcome arithmetically afterwards: the rebased commit's diffstat should differ from the original by exactly the lines you meant to drop.
- **CSS breakage is invisible to `tsc` + tests — only the full `vite build`
  sees it** (issue #14): a dangling declaration + stray `}` passed the
  typecheck and all 128 tests while vite 5 logged it as a mere minify
  *warning* for an entire release; a vite upgrade turned that warning into a
  hard error. Treat ANY minify warning in build output as a latent build
  blocker and fix it in the same pass. Related: junk dependencies can sneak
  into package.json from accidental installs (the `"24": "^0.0.0"` of
  issue #19) — review dependency diffs before committing. Since the vite 8
  upgrade, `@vitejs/plugin-react` must be v6+ (native vite 8 peers);
  plugin-react 4.x triggers ERESOLVE — the temporary `.npmrc`
  `legacy-peer-deps` pin was removed once v6 landed (0.19.0).
- **Vercel env vars are per-environment *and per-git-branch*, and Vite bakes
  them at build time.** The real cause of the recurring "login breaks on
  preview" was **not** Production-only scoping: `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` *were* ticked for Preview, but pinned to
  `gitBranch: "test"` — so only previews built from branch `test` got a
  backend and every other branch compiled blind. The app renders normally,
  then login fails with a bare `Failed to fetch` that reads exactly like a
  wrong password. `vite.config.ts` now **aborts a Vercel build** when
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are missing or still the
  `YOUR-PROJECT` template; CI and local builds only warn, since they
  legitimately have no credentials. Editing a var never fixes an existing
  deployment — **Redeploy** it.
- **A Vercel check failing on an already-verified tree is usually infra, not
  code — but prove it from the deployment payload, not the check name.** During
  the v0.55.0 promotion, every Vercel check on `test` failed (PR #218 blocked)
  while local verify ×3 and CI were green and identical content had deployed
  fine minutes earlier. The check-run/commit-status descriptions only say "run
  `npx vercel inspect <dpl> --logs`", which returns nothing useful; the real
  error lives in the deployment object —
  `MSYS_NO_PATHCONV=1 npx vercel api '/v13/deployments/<dpl>'` (the leading `/`
  gets MSYS-path-mangled without the env var) → `errorMessage:
  "Resource provisioning timed out", errorCode: BUILD_FAILED`. The unblock:
  `MSYS_NO_PATHCONV=1 npx vercel redeploy <dpl>` (Ready in 36s) — the commit
  status flipped to success on its own and the merge proceeded. Scope it first
  by committing-statusing a few recent SHAs (`gh api .../commits/<sha>/statuses`):
  all-recent-failures on green-local trees = infra; one-sharp-onset = diff.
  Also: `npx vercel` works while `vercel` alone does not on this machine —
  don't relearn which invocation is authenticated.
- **Trust `vercel env ls`, not the dashboard's checkboxes.** Its
  `environments (git branch)` column is the only place a branch pin shows up;
  the UI reads as "all enabled" (this misread cost a full wrong-diagnosis
  cycle). `vercel env add NAME preview --value … --type config --force`
  **adds** a branch-free record rather than editing the pinned one — both then
  coexist. Inspect/delete precisely via the API:
  `vercel api '/v10/projects/<prj>/env?teamId=<team>'` lists every record with
  its `id` + `gitBranch` (payload key is `.envs`, not `.env`),
  `vercel api '/v1/projects/<prj>/env/<id>?teamId=<team>'` returns the
  **decrypted** value (the only way to prove what is really stored), and
  duplicates go via the *batch* endpoint —
  `-X DELETE --field 'ids=["<id>","<id>"]'` on `/v1/projects/<prj>/env`
  (a per-id DELETE path 404s). Caveat: captured CLI output can swallow an id's
  **first character** into a preceding ANSI escape — print `.Length` (16) to
  catch it before a 404.
- **To reproduce a no-env build, move `.env.local` aside — blanking
  `$env:VITE_*` does nothing.** `vite build` reads `.env.local` regardless of
  the process environment, so a "stripped" build silently still had the real
  values and appeared to disprove the diagnosis. Check what a live deployment
  actually contains by fetching its `index-*.js` and grepping for `supabase.co`
  (recipe in `docs/DEPLOYMENT.md`) — with three traps, all of which produced
  wrong readings here:
  - **SSO walls more than previews.** The *deployment-specific* URL
    (`yatraflow-<8char>-<scope>.vercel.app`) is behind Vercel SSO **even when
    `vercel inspect` reports `target production`**, so an anonymous fetch
    returns Vercel's own Next.js login page (~340 KB, `X-Matched-Path: /login`)
    and the grep reports a misleading `False`. Grep the **canonical alias**
    (`yatraflow-blond.vercel.app`). Tell them apart by size: the real
    `index.html` is ~1.2 KB, the login page ~340 KB.
  - **The `localhost:54321` fallback is in *every* bundle.** `supabase.ts`
    compiles `import.meta.env.X || 'http://localhost:54321'`, so the placeholder
    string is present whether or not the env var was set — its presence proves
    nothing. Only the real `.supabase.co` host / project ref discriminates.
  - **`vercel ls` is newest-first** — `Select-Object -Last N` returns the
    *oldest* rows and can make a deploy that finished two minutes ago look
    entirely absent. Use `-First N`, or filter on `vercel\.app`.
  A green Vercel check is the proof for previews. Strongest proof for
  production: the alias's bundle hash equals a local `npm run build`'s, i.e.
  the artifact you tested is the artifact that shipped.
- **A browser probe that imports an app module can silently get a SECOND copy of it (learned 2026-09-19).** After any HMR update Vite serves the app's modules under timestamped URLs (`/src/store/store.ts?t=1789806911002`), so a probe doing `await import('/src/store/store.ts')` resolves the *clean* URL and instantiates a fresh module with empty state — no user, no trips, `ready: false`. It reads exactly like "the app is signed out and hydrate is broken", and it produced a wrong diagnosis until the DOM contradicted it: the page rendered "3 trips match …" while the probe's own snapshot reported zero users and zero trips. Before believing a probe about app state, restart the dev server (a fresh module graph carries no timestamps) or reload and probe **without editing a file in between**; and cross-check the rendered DOM, which always reflects the app's real instance. Related: `import.meta.url` in an `agent-browser eval` payload is a SyntaxError — it is not a module context.
- **A test that spawns `node` children is unreliable inside the full parallel
  vitest run on this box — the child dies before executing anything, while the
  same test passes in isolation (learned 2026-09-21).**
  `tests/migration-status.test.ts` failed twice in `npm run verify`, each time a
  *different* one of its stub-server tests, and each time as an assertion that
  read like a broken check: once an empty `stdout`, once
  `expected 3221226505 to be 0` (Windows `0xC0000409`, V8's fastfail).
  `npx vitest run tests/migration-status.test.ts` was green every time, and the
  script itself ran fine from the shell against the live project. The file now
  retries once when a child exits non-zero **with no output on either stream** —
  every real outcome of that check prints something, including exit 2, which
  writes to stderr, so that signature can only mean the process never ran — and
  otherwise throws naming it as an environment failure. Generalize the reading:
  when a spawned-child test fails only under the full suite, ask whether it
  produced *any* output before suspecting the code, and make "the process died" a
  distinct, named failure so an environment problem can never masquerade as a
  wrong verdict about the thing being tested.

- **Supabase auth fails two different ways** — rejected credentials come back as
  `{ error }`, but a network failure *throws* `AuthRetryableFetchError`. Wrap
  both (see `store.login`/`signup`) and map through `lib/authErrors.ts`; an
  unwrapped throw leaves the sign-in form silently re-enabling after its 10 s
  failsafe timer with no message shown.
- **A source-level test regex that spans a line boundary must tolerate CRLF — `core.autocrlf=true` means a pre-existing file is checked out CRLF while a file you created is LF, so the same pattern matches one and silently never matches the other (learned 2026-09-21).** Pinning I-21, `expect(handler).toMatch(/} catch {\n    return false\n  }/)` failed against `api/i.js` while single-line patterns over the same file passed — the file's lines end `\r\n`, so `\n` never follows `catch {`. Write `/\r?\n/` in any multi-line source assertion, and be aware the *opposite* trap is live too: a test file or migration authored this session is LF in the working tree until the next checkout converts it, so an assertion that passes today can be reading a different line ending than the file it pins. (Companion: when a source assertion fails, print what the regex was actually run against before suspecting the code — `codeOf()` in `tests/purchase-share-card.test.ts` exists because the failing match was a COMMENT saying "I bought", not the code claiming it.)
- **A doc line in the future tense about shipped work is a defect class no gate can see, and the source comment is usually what it quotes (found 2026-09-21).** A sweep for "not yet / does not exist / blocked on / still to come" against the code found the monetisation plan still reading `Payment rail — Does not exist`, `Entitlements — Does not exist` and `**The lock does not exist yet.**` weeks after v0.61.0 shipped them, and `docs/ARCHITECTURE.md` still promising "What M7 must add for real rows (none of it exists yet, by design)". The tell: those lines agreed with each other and disagreed with the repo — and the *seed* of the drift was the code comment `premiumPriceInr // placeholder for future payments`, which the plan quoted as its evidence. So: when reconciling docs, grep the CODE for a stale claim and fix it there too, or the next doc will quote it straight back. Method: grep, then classify each hit by **what the code does now** (not by how the sentence reads), and for a doc whose header carries a date + baseline (PLAN-COMMERCIAL-EXECUTION, REPORT-2026-09-15) add a status block naming what has since shipped rather than rewriting the dated body — the plan is the record of a decision, the status block is the truth about today. Dated snapshots keep their date; live tables (`PLAN-MONETISATION` §1, which already tracked the fee model as shipped) get corrected in place. **This is a gate now, not a method (2026-09-21):** `tests/doc-drift.test.ts` scans every live doc for absence cues and fails unless each hit is registered with a reason it is still true and — where the subject can be detected in the repo — a **marker** that turns the claim red the day the thing ships (a `payouts` table is what three payout claims watch). A registered sentence that gets reworded fails too, so the registry cannot rot into quotes nobody wrote. Working on a live doc: never silence a hit by widening the cue list, and when the subject ships, delete the entry *and* fix the sentence in the same commit. **The gate covers live source copy too (2026-09-28, #392):** `SOURCE_COPY` scans user-facing strings (`src/App.tsx`) with the same machinery, and `requires` is the marker's inverse polarity — a sentence naming shipped work is registered with evidence that must KEEP existing, so the next change to the subject fails the gate instead of drifting the copy. A copy fix ships with its registry entry and its sibling sweep in the same commit. And any prose in a scanned file must spell cue phrases out rather than quote them, or the gate fires on its own documentation.
- **A surface that needs a session can only be *asserted*, never *rendered* — so give it a fixture whose numbers a test pins (learned 2026-09-21).** The earnings ledger, the payout-runs ledger and the publish editor all need a creator with real sales behind them: the node suite has no DOM and no session, so their arithmetic was pinned by `tests/earnings.test.ts` while their rendering was verified by nothing at all — the gap where `.reveal` (I-20) hid a whole-page layout bug behind a green `npm run verify`. `scripts/seedCreatorFixture.mjs` closes it: a creator + buyers (signed up via the anon key, the harness's idiom), trips, priced publications and backdated sales, printing credentials and deep links. Two rules it follows that the next fixture should too: **(1) the seeded rows are the same rows a test prices** (the fixture's five sales are pinned in `tests/earnings.test.ts`, so a browser check has an answer key instead of an opinion), and **(2) a fixture that writes money rows must elevate and say so** — `entitlements` is SELECT-only for authenticated clients by design (the only write path is the buyer-scoped claim RPC), so it uses `SUPABASE_SERVICE_ROLE_KEY` or `PGCONN` (the `scripts/apply-schema.mjs` precedent) and otherwise prints the SQL to paste. Dry run by default; `--apply` writes; only ever touches the rows it names. **(3) A fixture CLI cannot be imported by a test — put its numbers in a PURE module instead (learned 2026-09-21).** `scripts/seedCreatorFixture.mjs` runs its whole seed on import, so importing it to check its arithmetic would create accounts; the traffic plan it seeds therefore lives in `scripts/fixtureFunnelPlan.mjs` (no I/O, no env, no side effects), which both the script and `tests/pub-funnel.test.ts` import — and the test runs the SHIPPED derivation over the fixture's own rows, so a browser check has the app's arithmetic as its answer key rather than a second opinion. Its window helper is duplicated on purpose: the two must agree, and a one-day drift in either is a red build. **(4) A fixture that seeds an event LOG must REPLACE it, not append (same date).** Trips and publications are guarded by slug, but rows keyed only by a parent id — funnels, counters, any date-series — double on a second `--apply`, and a doubled trend reads as a product whose traffic is exploding. Delete the fixture's own publications' rows first, in BOTH the elevated path and the SQL it prints for a keyless machine.
- **Each `run_commands` array entry is a separate shell process** — a `$var`
  assigned in one entry is empty in the next, so multi-step probes silently
  return nothing and look like failures. Put a dependent pipeline in a single
  command string, with `try/finally` whenever it touches real files.
- **A screenshot pass runs one browser command per tool call, and never
  wrapped in a shell `timeout`.** An `agent-browser` call that chains `open` +
  `wait` + `screenshot` + `eval` exhausted the call budget and the harness
  returned **no output at all** (not partial stdout), which reads exactly like
  a hung CLI; the same commands, one per call, all returned in seconds. A
  `timeout` wrapper makes it worse, not safer: killing the CLI leaves its
  browser child holding the pipe, so the call hangs to the tool's own limit
  anyway. And a *brand-new* session's first command really is slow — a cold
  browser launch outlived a 280 s call — so start that one detached
  (`nohup agent-browser open <url> > /tmp/ab.log 2>&1 &`), poll the log, then
  reuse the warm session. Three companions: relative screenshot paths are
  ignored — they land in `~/.agent-browser/tmp/screenshots/` whatever you pass,
  so hand it an absolute path; a cold Vite transform is what makes the *page*
  slow, so warm the route *and its modules* with `curl` first; and
  `transferSize` reads 0 on cross-origin images (Wikimedia exposes no resource
  timing), so prove a cover's weight from the origin
  (`curl -w '%{size_download}'` on the `src` the DOM actually rendered)rather than from `performance.getEntriesByType('resource')`.
- **A hidden preview webview freezes `requestAnimationFrame` and can stall the MapLibre style forever (learned 2026-09-22).** With `document.visibilityState === "hidden"` rAF callbacks never run (screenshots report "produced no frames" for the same reason) and the map style can sit `isStyleLoaded() === false` indefinitely. A map fit that "never runs" in that state is the environment, not the product: verify geometry through an un-gated path (`fitBounds({duration: 0})` jumps synchronously), or patch `requestAnimationFrame`→`setTimeout` and `matchMedia('(prefers-reduced-motion: reduce)')`→`{ matches: true }` in-page BEFORE driving the UI (the app reads both at call time), then measure the camera through the map instance found via the host node's React fiber — importing app modules to probe state gets a SECOND instance under HMR's timestamped URLs.
- **That freeze reaches React itself — and the module graph will render a component for you (learned 2026-09-25).** In the same hidden state, passive effects never flush and a state update can run its updater (side effects fire — a resolved promise) yet never commit, so a dialog "stays open" after its close resolved: that reads as a state-code bug and is not one. The tell is `preview_screenshot` failing with "produced no frames"; `preview_navigate "reload"` restores compositing mid-session, and probes should put their side effects in the render body, not `useEffect`. For a rendered check with no test infra: `import('/@id/react')` + `import('/@id/react-dom/client')` (its `createRoot` is on `.default`) + the component's module URL renders the REAL module graph into a detached root, and real clicks drive it end-to-end (empty-submit errors, manual entry, skip-resolves-null). Poll for state instead of fixed sleeps — a hidden webview throttles timers into the evaluate timeout.
- **`str_replace` can report a real, existing file as missing** (`package-lock.json`,
  ~160 KB, during the v0.55.0 cut) — fall back to a targeted `sed -i` and verify
  with grep before moving on. Related: Vercel Agent opens its PRs as **drafts**;
  `gh pr merge` fails with "still a draft" until `gh pr ready <n>` runs.

- **In a harness sandbox, `git rev-list --count <base>..HEAD` is not the release's size — the clone is shallow and it undercounts (measured on the v0.68.0 cut: it answered `3` where the promotion was 41 commits).** Quote the promotion in the units that survive a shallow clone: `gh api repos/<org>/<repo>/compare/<base>...<head> --jq '{ahead: .ahead_by, behind: .behind_by}'` for the count, and `git diff --stat <base>..HEAD` for the size — the diffstat is what the release actually carries, and the same compare call answers "does this release touch `supabase/`" (`.files[] | select(.filename | startswith("supabase/"))`) in one query, which is what tells you whether a SQL handover is owed. Only `git log --oneline` for the *coverage* audit is affected the same way: prefer the compare API's commit list, and remember a shallow `git log` cannot reach the CHANGELOG commits a coverage audit needs.

- **A release bullet can name the wrong tag, and nothing in the gate reads tag names — so grep the tag you quote.** Writing the v0.68.0 cut turned up the v0.67.0 promotion bullet asserting the tag `v0.66.0` on its merge commit (the tag itself was right; only the prose was wrong). Compare `git tag -l -n1 vX.Y.Z` against the sentence in the same session you touch the release's status lines, and treat every `vX.Y.Z` in prose as a claim about `refs/tags` — the same rule as §2.6c for "done"/"missing" claims, applied to version strings.

- **A test that compares a file byte-for-byte needs pinned line endings (learned 2026-10-02).** `tests/lint-ratchet.test.ts` rewrites `eslint-baseline.json` and demands the rewrite be identical. A Windows checkout converts LF to CRLF, so the rewrite always differed and the test failed on every Windows machine while CI on Linux stayed green. Pin such files with a `.gitattributes` rule (`eslint-baseline.json text eol=lf`). A byte-identity assertion and platform line-ending conversion cannot coexist without one.

### 3.1 What CI actually runs, per destination

Neither workflow has a `paths` filter, so **docs-only changes still run the full
gate**. What runs depends on *where* you push, and the two destinations are not
the same job:

| Destination | `ci.yml` (tsc + vitest + build) | `yatraflow-apk.yml` (Android APK) |
| --- | --- | --- |
| push to `test` | yes | **no** |
| push to `main` | yes | **yes** |
| push to `redesign/**` | yes | **no** |
| PR into `main` | yes | **no** |
| PR into `test` | yes | **no** |
| `v*` tag | — | yes (publishes the artifact) |

The APK workflow triggers on `push` to `main`, `feat/capacitor-android` and `v*`
tags — **not on pull requests**. So a PR into `main` costs one `ci.yml` run plus
Vercel, while the merge itself is what burns an Android build. Verify with
`gh pr checks <n>` rather than reasoning from the YAML; the check list names the
workflow that actually fired.

**A run that dies at ~15 minutes with zero executed steps is the runner queue,
not the code (seen twice, 2026-10-05/06).** Two runs hit it. Run `37364628598`
was the auto-close job on #573's merge. Run `37370502800` was the `Verify` job
on PR #642. Both ended `cancelled`/`fail` at about 15 minutes, with zero steps
executed. The annotation says the job was never acquired by a hosted runner.
The first cost a hand-closed issue under the workflow's own fall-back rule.
The second read as a red gate; a rerun went green in under two minutes. The
signature is unambiguous: duration near 15 minutes, conclusion `cancelled`,
no steps, no log. Rerun once (`gh run rerun <id> --failed`) before any other
diagnosis. Only a rerun that fails with real steps executed is a code problem.

**A PR that conflicts with its base runs NO gate at all — and its check list
still looks nearly complete (learned 2026-09-20).** #268 and #269 both sat with
Codacy and Vercel green and **no `Verify` job of any kind**: GitHub cannot build
the merge commit for a conflicted PR, so a `pull_request`-triggered workflow is
never started — while Codacy and Vercel report regardless, being GitHub Apps
rather than Actions, which is precisely what hides the absence. Proven by the
fix and not only the theory: #268's `Verify` run appeared within seconds of the
push that cleared its conflict. So the row below describes a PR that *can*
merge; on a `CONFLICTING` PR `gh pr checks` is not weak evidence but **no**
evidence, and rebasing is a prerequisite for the gate rather than merely a way
to unblock the merge — which makes the stalest branches exactly the ones CI has
never tested. (Related: `gh pr checks` renders Codacy's `action_required`
conclusion as `fail`, so read the check-run's own `conclusion` and its
annotations, per the Codacy note below.)

**A PR into `test` now runs the same job as one into `main`** — `ci.yml`'s
`pull_request` trigger lists `[main, test]` as of 2026-09-20. The gap it closes
was found 2026-09-14, when PR #105 (a 23-file feature PR into `test`) showed only
Codacy/Vercel checks and no "Verify" job. `test` is where feature work
integrates, so it was the one destination where a green check list proved
nothing: the gate waited for the merge and fired as a `push to test`, after the
point where a red tree can still be refused. This section described the fix for
six days and nothing enforced it — which is why `tests/ci-workflow.test.ts` now
pins the trigger, so the gap fails a build instead of outliving another entry
about it. The PR run checks out the merge ref, so it duplicates the push run
rather than replacing it; that duplication is deliberate. Verify with
`gh pr checks <n>` rather than reasoning from the YAML; the check list names the
workflow that actually fired.

**Codacy's `action_required` state hides REAL findings too — read the
annotations, not just the conclusion.** The "auth-gated bot quirk" framing was
right for merges (nothing blocks), but on PR #224 the same `action_required`
conclusion carried the summary line "1 new issue (0 max.)" and a real finding
in its annotations. Fetch them every time:
`gh api repos/<org>/<repo>/commits/<head-sha>/check-runs` → the Codacy run's
`output.annotations_url` → `gh api <annotations_url>`. An `annotations_count`
of 0 is the true quirk signature; a non-zero count is a finding to triage.

**SAST taint on URLs is contained with a strict validator at ONE boundary —
and the boundary is wherever the value is FIRST stringified, not just the
fetch. (Validation is the right ENGINEERING, but see the next entry: it does
not silence the Codacy rule — only a dashboard code-pattern ignore resolves
the finding.)**
Codacy flagged `routing.ts` for user-controlled coordinates flowing into the
OSRM URL. Two half-lessons from fixing it: (1) `Number()` coercion is NOT
validation — it accepts `'12.9'` and turns `null` into `0`, the Null-Island
sentinel; use `typeof x === 'number'` + `Number.isFinite` + range checks.
(2) The first `.toFixed()`/template use can sit in the *cache key*, so guarding
only the URL builder still crashes on a poisoned row — one `coordValid()`
helper must feed both consumers. Fail safe: refuse the measurement and degrade
to the engine estimate, exactly like a network failure.

**The "user-controlled URLs to HTTP client" rule is UNRESOLVABLE in code — do
not chase it past one hardening pass.** PR #224 burned four rounds on
`routing.ts` (strict `coordValid` boundary → `encodeURIComponent` → full-URL
regex allowlist → WHATWG `URL` parse + origin assertion, the OWASP SSRF
pattern) and the SAME rule re-fired on the same `fetch` every time: the engine
flags `fetch()` with ANY data-derived URL string regardless of sanitizer.
(Hardening still worth keeping: the crash-on-poisoned-row fix, the regex
allowlist, the origin gate.) The practical loop: read the annotation, triage
real-vs-baseline on its merits, fix the substance once, then mark the finding
as managed in the Codacy dashboard (code-pattern ignore on that file with the
four-layer justification) — and say so in the PR so the review trail shows the
decision was made, not missed.

**The verify gate must GATE the push — no `;`-chained command strings.** On
PR #224 a `npm run verify …; git commit … && git push …` one-liner pushed a
RED tree (5 failing test files) because `;` runs every statement regardless of
the previous exit code — and the failing log was then deleted, destroying the
evidence. Sequence: run verify alone, read its exit code, and only on success
chain the commit/push (or run them as separate tool calls). Keep every failing
log until the failure is diagnosed in writing.

**A red verify that passes on rerun is usually cross-file test interference,
not flakiness to shrug at** — vitest workers share module state across files
(stubbed env, global fetch, the routing leg cache), so file-set/ordering
changes flip suites that pass in isolation. The routing tests pin their env
and clear caches per file for exactly this reason; when a rerun goes green,
name the mechanism or keep reproducing — never just re-run until green.

**Integration-harness probes are clients too — a delivery assertion needs a state snapshot, not an accumulator, and free-tier realtime can eat the first 10 s.** (Found live 2026-09-19, harness run 1/2: 35/37.) (1) The presence probe's `sync` handler merged each payload into a persistent object (`Object.assign(seenByA, ...)`), so once a session key entered, no later sync could remove it — the `untrack` assertion failed on both runs while the room itself was behaving. A delivery probe must REPLACE its snapshot each event (`seenByA = ch.presenceState()`); an accumulator can only ever prove arrival, never departure. Same shape as "a verification probe can lie about the thing it probes": before calling a probe failure a product bug, check whether the probe's own data structure can even express the transition it asserts. (2) The realtime UPDATE probe missed its 10 s window once (run 1) and passed on rerun — first-connect latency on the free tier; probe windows are now 15 s and the re-run rule below applies before diagnosing. Credentials: the harness signs in OR signs up from `.env.local`'s `TEST_USER*` block (documented in `.env.example`); create them with the anon key via `POST /auth/v1/signup` (email confirmation off → session in the response), and `example.com` addresses work fine.

**A verify that fails with `Errors 1` while every test passes is the worker-teardown race, not a failure — read the summary line before the conclusion.** On `test`
(2026-09-18, the v0.60.0 merge) the gate printed **1353 passed, 1 error** and exited 1:
one unhandled rejection, `EnvironmentTeardownError: [vitest-worker]: Closing rpc while
"onUserConsoleLog" was pending`, attributed to `tests/store-robustness.test.ts` and
preceded by that file's own console logging. Nothing asserted false — the worker's RPC
channel closed with a log message still in flight, and the re-run of the same commit was
green. `N passed` + `Errors 1` is this race (a real failure shows `N failed`); re-run the
job, and name this mechanism rather than reaching for "flaky".

- **A PR's `changedFiles` is measured against ITS OWN base branch, not the
  integration branch — stacked PRs therefore report inherited work as their
  own.** Reviewing PR #262 (based on the stacked `feat/clock-map-zones`), the
  44-file diff carried a DB migration, admin-console and settings changes that
  the branch's own commits never touched (`git log <merge-base>..head -- <file>`
  is empty) — they arrived via test-sync merges into the long-lived stack.
  Before judging scope or "unrelated changes" in a PR, diff against the merge
  base with the TARGET branch (`git diff $(git merge-base origin/test HEAD)..HEAD
  --stat`) — and prefer retargeting a stacked PR's base to the integration
  branch once its parent lands, so review sees the real diff. **The same
  overstatement applies to the promotion's own size:** after a long-lived stack
  merges, `git log --oneline origin/main..test` lists its old commits even when
  their content is already in `main` via other commits — the v0.63.0 promotion
  read as 67 commits, but `git diff --stat origin/main..HEAD` was **52 files,
  +3766/−268**, and the Sept-13/14 Day Planner batch in that list contributed
  none of them. Quote the diffstat, not the commit count, when saying what
  production is about to receive; and audit coverage with
  `git log --oneline <base>..HEAD [-- CHANGELOG.md]` (§2.6b).

### 3.2 The migration status check (the one part `verify` cannot see)

```bash
npm run check:migrations              # applied / MISSING per migration; exit 1 if anything is
npm run check:migrations -- --list    # what it would probe, no network
```

`verify` typechecks, tests and builds; it says nothing about SQL that has never
run — so a release can merge, deploy, pass CI and Vercel while its migration was
never applied. `scripts/checkMigrations.mjs` closes that hole: it derives each
migration's artifacts from its own SQL (`create table`, `add column`, the
`storage.buckets` insert) and asks the live project whether each one is really
there. It uses the app's own anon key and **GET only**, so pointing it at
production is safe.

Read it by exit code: **0** everything probed is present · **1** something is
missing, undeclared, or could not be checked (unchecked is NOT present — a probe
that could not answer has proved nothing) · **2** no credentials. Run it before
promoting a release and after applying a migration; `--allow-missing` makes it a
report instead of a gate, `--json` makes it machine-readable.

Two things it deliberately does NOT probe — do not "fix" these:

- **Functions.** PostgREST answers the *same* `404 PGRST202` for a function
  called without its parameters whether or not it exists (verified live against
  `admin_delete_user`), so the only way to probe one is to execute it. Their
  absence is loud instead: the app fails at call time.
- **Policies and triggers.** Covered by `supabase/tests/rls_contract.test.sql`
  through `npm run test:integration`, and by behavior rather than by catalog.

Such a migration is declared in the script's `NO_PROBE_SURFACE` with its reason.
A new migration that is neither probed nor declared fails the check as
**undeclared** — that ratchet, plus `tests/migration-status.test.ts` (coverage,
the parser against real SQL shapes plus fixtures, a stub server replaying the
bodies the live project returns, and a tripwire keeping the check GET-only), is
what keeps the check honest as the directory grows.

It earned its place on the first run: `20260914_trip_stay_budget.sql` had never
been applied to production, so `trips.stay_style` was absent, the store's
optional-column probe reported `stayStyle: false`, and the stay-budget dial
silently reverted on every reload — the same class as the `cover_image_url`
migration-gap rule in §4, and the first thing in this repo that could see it.
Applying that file's own one-line `alter table` closed it the same day. Expect
that shape: the check names a file, a human runs it, the next run flips to `ok`
— and nothing else in the pipeline would have noticed either way.

- **A source-scanning guard that greps for a literal breaks the moment you introduce a constant — teach the guard to resolve it, do not revert the constant (learned 2026-09-26).** Moving the create route into `lib/routes.ts` (#398) turned two green guards red without touching their subject: `tests/route-integrity.test.ts` scanned `case '([a-z-]+)'` to learn the router's route list, and `tests/mobile-shell.test.ts` asserted App.tsx *contains* `'#/new'`. Both are the right tests — a source check is the only way to pin markup and call sites in a node-env suite — but they had learned the literal. Each now substitutes the imported constant into the source before scanning (a shared `expandRouteConstants` / `appResolved`), so they keep checking the real invariant (every in-app link resolves; every shell destination stays reachable) while the rename-proof form stays. The reflex to distrust is "the test is in my way": a guard that fails after a refactor is information about the refactor's reach, and the fix belongs in the guard's parser. Corollary: when a route, class name or storage key is read by a scanner, that scanner is part of the rename surface — grep `tests/` for the literal before concluding a rename is complete. Mechanics that made it cheap: run the gate before pushing and read the *failing file's name* from the log; the two guards were the only reds, which is what told us the fix was right and the guards were stale.
- **Editing a watched source file while a Vite dev server runs can fail with `ReplaceFileW EIO (Win32 1175)` — that is a file lock, not a bad edit (learned 2026-09-26).** A write to `src/pages/CreateTrip.tsx` was refused mid-session while `vite --port 5180` served that worktree; the file was left byte-intact (confirm with a targeted grep before retrying) and the identical edit succeeded immediately after the server was killed. So an `EIO` during a dev-server session means: stop the server or its watcher, verify the file still parses, then retry — not "the tooling is broken". Cheap prevention: that lock window belongs to the same pid you started for the localhost check (§7), so stop that server when the check is finished instead of leaving it running through the rest of the batch.
- **An audit issue's `file:line` anchors have expired by the time anyone acts on them — re-grep before scoping, and name regions by their symbols (learned 2026-09-26).** A P0–P3 sweep's issue bodies carried line numbers that were wrong by ~140 lines within days: the finding that said `MapTab.tsx:2335` is `focusDay={activeDayIndex}` pointed at a "Stay" button, and a lane that had already announced those numbers to a parallel agent had to correct the record. Treat every anchor in a written artifact — an issue, a plan doc, a decision block, a handoff note, a PR body — as a hypothesis about a file that has moved since it was written: resolve it with grep in the session that uses it, quote live numbers in the PR you open, and when coordinating with another agent name the REGION by its symbols (`daySlotDeps`, the fill/delete handlers, the banner) rather than by line numbers that will drift under both of you. This is §6c's rule one step out: an absence claim expires at the next merge, and so does a location claim.
- **A scripted source edit that matches nothing succeeds quietly — count the token you meant to insert, never the absence of an error (learned 2026-09-26).** Three PowerShell edits in a row wrote nothing and reported success because the pattern could not match: this clone's working copy is **LF**, so a `\r\n` literal or a `$`-anchored regex silently no-ops (`.Replace()` and `-replace` return the input unchanged by design and raise nothing). The "repair" of that sequence then inserted a SECOND copy of a line whose first insertion had in fact succeeded — the declaration was missing, the call was duplicated, and the token count (3 where 2 was correct) is the only reason it was caught. So: check the file's line endings before writing one (git's *"LF will be replaced by CRLF"* warning, printed for the file you are editing, is the tell), and verify every scripted edit by **counting the token** (`([regex]::Matches($src,'setMapFilter')).Count` must be exactly 2) — never by the absence of an exception, and never by byte count alone (the #416 wiring grew `MapTab.tsx` by 252 bytes with the state declaration missing and a handler call doubled: the size looked plausible, the counts did not). Same reasoning that makes `CHANGELOG.md` editor-primitive-only (§9) applies to source: for a file whose braces are load-bearing, a silent no-op and a shredding look alike until the gate runs.

