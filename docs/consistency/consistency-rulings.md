# YatraFlow consistency work: standing rulings

Owner: Claude (design lead). Updated 2026-10-11. Cline and Codex: **read this file before you ask the user a question.** If a ruling covers your question, follow it. If none does, ask the user and quote the question in full.

This file grows. Claude adds a ruling each time an agent asks something new. Re-read it at the start of each task.

## Stage A: moving inline styles into classes (no visual change)

**R1. One class per unique value-set, named by role.** Use the page prefix: `prof-`, `adm-`, `bud-`, `gin-`, `ovw-`, `shr-`, `auth-`. Do not make one class per element.

**R2. No generic utility classes.** Do not add `.m0` or `.fw400`. A utility is a design-system choice. Claude makes those.

**R3. Two elements with the same values but different jobs get two classes.** Their roles may change later.

**R4. Keep dynamic values inline.** A width, colour or position that comes from data stays in `style`. You may pass it as a CSS custom property set inline, for example `style={{ '--pct': pct }}`.

**R5. An inline declaration that fights a host class.** The host class (for example `.row-between` with `gap: 12px`) has the same specificity as one new class. A single appended class wins only by source order. Use a **same-element compound selector**: `.row-between.prof-notif-row { gap: 10px }`. It has higher specificity, so it wins in any order. It names no descendant relationship. Put both classes on the element. Do not use a descendant selector. Do not leave the declaration inline.

**R6. Append only.** Add CSS at the end of `src/styles.css`, under one section comment per file. Never insert above an existing rule.

**R7. Prove no visual change.** Take before and after screenshots in light and dark at 1280 and 390. Report any difference. Do not "fix" a difference by changing a value.

**R8. One local branch per file. No push until the batch is ready.** Keep each file on its own local branch. Do not push. Do not open a PR. The user decides when a batch is finished (updated 2026-10-11, replaces the earlier "one PR per file" rule).

**R11. Batch at the end, one PR per lane.** When all your files are done and proven, create one batch branch from `origin/test` named `chore/consistency-<lane>-batch` (`cline` or `codex`). Merge each file branch into it. Expect trailing conflicts in `src/styles.css`. Keep every section. Run `npm run verify` on the batch branch. Tell the user. The user says when to push. Open one PR into `test`. Do not merge it.

**R12. Do not re-proof a finished file.** A file is done when it has: its before and after screenshots (light and dark, 1280 and 390), a clean `npm run verify` run, and a changelog entry. Send Claude those three things. Claude reviews. Then move to the next file.

**R13. A value that breaks a design-system gate stays inline.** The gate checks the CSS in `src/styles.css` (for example the spacing ladder `2, 4, 6, 8, 12, 14, 16, 20, 22, 24`). An inline style is not scanned. If moving a value into a class makes a gate fail, leave that one value inline. Do not snap it to the ladder. Do not re-baseline the gate. A snap is a visual change, and Claude decides those. Add a short comment above the element, such as `{/* off-ladder 18px: stays inline until the page redesign */}`, and list each one in your report to Claude. Claude clears them when the page gets its real pass.

## Working copies

**R9. Cline works only in `C:\Users\hasna\yatraflow-cline`.** Leave `feat/launch-film` and the `launch-film/` files alone. Cut branches from `origin/test`.

**R10. Codex works only in `C:\Users\hasna\yatraflow-codex`, using a git worktree.** Do not stash, reset, discard or commit the discovery work in the main tree. Run `git worktree add -b chore/consistency-<file> .codex-worktrees/<file> origin/test`. Add `.codex-worktrees/` to `.git/info/exclude`.

## Design rulings (user-approved 2026-10-11, on Opus advice)

**R14. Serif scope (Q1).** Playfair Display (`--font-serif`) appears only on the page h1, in `.ex-hero h1` and `.yf-header-title`. The handwritten caveat (`--font-hand`) appears only in `.ex-note` and `.yf-header-note`. Use it at most once per page. Never use it in a `StateBlock`. The two font names appear only in the `:root` definitions. No `.tsx` file names them. Section and card titles use Plus Jakarta Sans 800.

**R15. Button skin (Q3).** The catalog button skin stays scoped to `yf-page` for the whole migration. Before the workspace page (P2) converts, Claude decides where the skin stops (for example at `.tab-panel`, or with a `yf-tools` class). At P16 only the corner radius and the weight fold into base `.btn`.

**R16. One tab component, two variants.** `SegmentedTabs` has two variants chosen by its `semantics` prop. Tablist (workspace, auth, hub, admin) uses the glass `tabbar` with the teal glider. Toggle (Grid and List) uses `mt-seg` with an ink glider. The toggle must emit the active-state attribute the glider reads.

**R17. My trips keeps its own filter bar for now.** Do not add `foldSelects`, search-row or `clearKeepsSpace` options to `FilterBar`. After PR #695 lands, My trips changes to match Explore's bar in one PR. Claude proposes it and the user approves it.

**R18. Merge order.** #695, then #696, #697, #698, then foundations-2 last. Resolve `styles.css` append conflicts locally and keep every section, older first. Do not use the GitHub web editor. Do not set `merge=union` on `styles.css`. The user decides when each merge happens.

**R19. Wait for `page-enter`.** `page-enter` exists only in #695. No page branch starts until #695 is on `test`. After that, `page-enter` owns the page entrance and `cardIn` entrances on page headers are removed.

## Where decisions go

Design questions (a colour, a layout, a font size, a new component shape, a motion feel) are never yours to decide. Write the question down. The user decides, with Claude's advice.
