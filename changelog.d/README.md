# Change fragments

Each change has a Markdown file in `changelog.d/pending/`.
Run this command from the repository root:

```sh
npm run changelog:new -- --section Changed --message "Release notes use separate change files."
```

The command creates a UUID file with exclusive creation.
Edit that file to describe the final outcome. Details follow the bold outcome sentence.
Use nonempty sections in this order: Added, Changed, Fixed, Removed.
Use LF line endings and one bullet per line. Commit the fragment with the change.
Edit the pending fragment if later work replaces its claim.

```markdown
### Fixed

- **A saved stop stays in its day after reload.** The update keeps the saved day. (#123)
```

Run `npm run changelog:check` to check format, STE prose, retired IDs, and change coverage.
`npm run verify` runs this check. A pull request run in CI uses the event base and head SHAs. A push run checks format only.
The local base is the merge base with `origin/test`. Fetch that ref if it is absent. With no commit ahead of that base, the check covers format only.
Use `--base <commit> --head <commit>` for an explicit PR range.
The check reads the PR range and the candidate merged tree. Target-only notes do not count.
Renames, copies, and whitespace changes do not count. Review coverage for each outcome as well.

## Release procedure

The agent that prepares the `test` to `main` promotion owns assembly.
Freeze the input in a commit. Select a web version and an ISO date.

```sh
npm run changelog:release -- --version X.Y.Z --date YYYY-MM-DD --base HEAD
```

This command prints a diff and writes nothing. `--dry-run` has the same effect.
Use `--write` to save `changelog-release.patch` with exclusive creation.
The script never writes `CHANGELOG.md`. Review the patch, then apply it with editor primitives.
The patch inserts release lines, removes consumed fragments, and adds a JSON receipt.
The first release patch also removes the transition boundary file.
The receipt records the source commit, input hashes, and output hashes.
Do not pipe the patch into a writer. Remove the patch file after review.
The checker reconstructs the release from Git and checks the receipt against the actual result.
Keep later fragments pending. Freeze a new input if a selected fragment changes.

Assembly preserves the preamble and every released byte. It adds lines only.
The line-loss guard rejects a result shorter than the original plus the inserted lines.
A missing or repeated Unreleased heading stops assembly before any write.
Malformed notes, reused IDs, duplicate bullets, and conflict markers also stop assembly.
Review pending claims against the batch commits before release.
Update package versions, the roadmap snapshot, and README highlights with the release.
Run `npm run verify` and the release checks. The user reviews the changelog diff before a push to `main`.

Tag the promotion merge commit in the same pass as the merge. Use a lightweight tag named `vX.Y.Z`. Nothing in the gate reads tags, so check the tag by hand.

```sh
git tag vX.Y.Z <merge-commit>
git push origin refs/tags/vX.Y.Z
```

`git tag -l -n1 vX.Y.Z` shows the version on the commit. `git ls-remote --tags origin vX.Y.Z` shows the remote tag. A missing tag stops the release.

## Adoption and bridge

New changes need fragments from the PR that adopts this system.
Existing Unreleased notes stay in place and ship with the next release. Do not convert them.
Open PRs #911 and #914 can keep their direct Unreleased edits.
The bridge accepts a direct Unreleased edit as PR coverage.
The exception ends at the next release, after web version 0.84.0.
The checker uses `transition.json` to detect that boundary. The release patch removes that file.

On a changelog conflict, compare both sides with the merge base.
Keep both sets of pending notes under one Unreleased heading.
Preserve the preamble and released history. Use editor primitives and run the checker.
Do not restore an older whole file. `CHANGELOG.md` has no union merge driver, so git shows each conflict.
Run `git check-attr merge -- CHANGELOG.md` once per clone. It must print `unspecified`.
If it names a driver, remove that line from `.git/info/attributes` and from `merge.*` in the git config.
On a fragment conflict, coordinate with its owner and keep one final claim.

## Design sources

The approved proposal compares Towncrier and Changesets under MIT, and Scriv under Apache-2.0.
This Node CLI uses the fragment workflow without copied source or a new dependency.
The rollout retains legacy notes and uses a local release rehearsal. It does not cut a release during adoption.
