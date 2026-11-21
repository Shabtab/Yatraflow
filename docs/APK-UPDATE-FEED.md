# APK update feed

How an installed YatraFlow Android build learns that a newer one exists.
Reference for the client contract, the route that serves the feed, and the
activation steps.

**The feed is served, not committed.** `api/android-manifest.js` answers
`https://www.yatraflow.in/android/manifest.json` from the newest release that
carries an APK asset, so a release cut is the whole publishing step. The two
build variables below still have to be set once, and the coordinator approves
them once.

## What the client reads

One JSON document, fetched over HTTPS. The client parses exactly these fields
and ignores anything else.

| Field | Type | Meaning |
|---|---|---|
| `packageId` | string | The Android application id this release is for |
| `channel` | `production` or `audit` | Which line the release belongs to |
| `versionCode` | integer | The native version code, compared with the installed one |
| `versionName` | string | The display version, shown to the user |
| `notes` | string | A short line about the release |
| `downloadUrl` | string | The permanent download page, on an approved host |

`src/lib/apkUpdates.ts` checks every field before the app offers anything. A
release is offered only when the document is well formed. The package and the
channel must both match the installed app. The destination must be HTTPS on an
approved host.

## Where the feed is served

`vercel.json` routes two paths ahead of the SPA catch-all, which would
otherwise answer them with `index.html`:

| Path | Answered by | Result |
|---|---|---|
| `/android/manifest.json` | `api/android-manifest.js` | the JSON document above |
| `/android/latest.apk` | the same route, `?apk=1` | a `302` to the release asset |

The route reads `https://api.github.com/repos/<repo>/releases?per_page=15` and
takes the newest entry that is not a draft or a prerelease, whose tag is
`vX.Y.Z`, and that carries an `.apk` asset. `versionCode` is the same formula
`build.gradle` bakes, `major*10000 + minor*100 + patch`. `versionName` is
`<version>-native`. The repo is `hasnaina955/Yatraflow` unless `APK_UPDATE_REPO`
sets another. The read needs no token, and `GITHUB_TOKEN` only raises its rate
limit. The answer carries
`cache-control: public, s-maxage=300, stale-while-revalidate=600`.

An expiring CI artifact is not a destination. The `302` points at the release
asset, which is permanent, and the public URL stays on the approved host
`www.yatraflow.in` — the same host the download URL is checked against.

## Activation, and what it needs

Two variables turn the feature on. Both are build-time, so they must be set
before the build that bakes them:

```
VITE_APK_UPDATE_FEED_URL=https://www.yatraflow.in/android/manifest.json
VITE_APK_UPDATE_HOSTS=www.yatraflow.in
```

While either is unset the app stays inert: no request, and Profile says the
check is not configured. **The coordinator must approve these before they are
set in Vercel or in the Android build.** That approval also covers the published
manifest, and the compatible signed APK behind it.

The Android bundle comes from `.github/workflows/yatraflow-apk.yml`, not from
Vercel. So the APK reads these two values from **repository variables**
(Settings → Secrets and variables → Actions → Variables), and the workflow
writes them into `.env.production` before `npm run build`. A Vercel variable has
no effect on the APK. An absent variable writes an empty line, and an empty
value keeps the check inert.

The catch-all rewrite in `vercel.json` once answered `/android/manifest.json`
with `index.html`. Two explicit rewrites now sit ahead of it, so the path
answers JSON. The client fails closed, so an HTML answer reads as a failed
check.

Steps, once the two variables are set:

1. Cut the release as usual: bump `package.json` and add the `## [X.Y.Z]`
   section to `CHANGELOG.md`. Then promote to `main`.
2. The push to `main` builds the APK. When no release exists for `vX.Y.Z`, the
   run creates it from the `CHANGELOG.md` section and attaches the APK. You do
   not need to tag or create the release by hand. That is the whole publish
   step: the route picks the newest release with an APK asset.
   If you push a tag first, the tag run waits 60 s for a release you write.
   Then it creates the release itself. Hand-written notes win.
3. Check the feed: `curl -s https://www.yatraflow.in/android/manifest.json`.
   Expect the six fields, and a `versionCode` equal to the tag's.
4. Install the new APK, open Profile, and read "App updates". A build equal to
   the feed says "You are on the newest build." An older build says "Version
   X is available."

To check one specific artifact before it is released, use the same script that
documents the contract:

```
node scripts/apk-release-manifest.mjs --apk <apk> --channel production \
  --expect-signer-sha256 <cert-fingerprint> --download-url <url> \
  --hosts www.yatraflow.in --out manifest.json
```

It refuses to emit a document unless the artifact passes every check. The
artifact must be available. Its package must match the channel. Its version code
must be higher than every published code, its signature must verify **and** its
signer must match the expected certificate, and its destination must be
approved. `--check <manifest.json>` runs the same checks against an existing
document.

## What the signature check does and does not prove

These are two different questions, and only the second one protects an install.

| Check | What it proves | What it does not prove |
|---|---|---|
| `apksigner verify` | The APK is intact and self-consistent | **Which key signed it.** Any valid key passes |
| Certificate fingerprint comparison | The signer is the key you expect | Nothing about the APK's contents |

Android refuses to install an update over an app whose signing key changed. So a
release signed with a different but perfectly valid key would still pass
`apksigner verify`, be published, and be offered to users who then cannot
install it. Integrity is not identity.

That is why you must pass `--expect-signer-sha256`, and why it has no default. The value is
the **SHA-256 certificate digest** that `apksigner verify --print-certs` prints,
for example:

```
Signer #1 certificate SHA-256 digest: 8e4c634df4bb72af022d5a9da9ae8ebfc4c5a8377ea61ad7ee59f0e9fecd25f8
```

The fingerprint is public information. It identifies a certificate and cannot be
used to sign anything. The release owner supplies it, out of band. The script
never reads a keystore, and it never derives the expected value from the APK it
is checking, because that would compare a value with itself. A mismatch stops
generation with exit 1. Pass the value as `--expect-signer-sha256`, or set
`APK_UPDATE_EXPECT_SIGNER_SHA256`.

Colons, spaces and letter case are ignored when the two values are compared, so
the fingerprint can be pasted in the form `apksigner` prints it.

**The APK must carry exactly one signer.** This tool takes one expected
fingerprint, so it refuses an APK that reports more than one signer rather than
matching whichever one happens to come first. An APK signed by the expected key
*plus* an unrelated key is not the same artifact as a single-signer build, and it
cannot update an app installed from one. Signing lineage and rotation are out of
scope here: a rotated key needs its own reviewed procedure, not a passing check.

Do not read a passing `apksigner verify` as "the same key as the installed app".
It is not that claim. Only the fingerprint comparison is.

## Tool invocation

The script finds the Android tools under `ANDROID_HOME` (or
`ANDROID_SDK_ROOT`), in the newest `build-tools` version that has them. It runs
each tool directly, with an argument vector and no shell:

- `aapt2` runs as a program, which on Windows is `aapt2.exe`.
- `apksigner` ships only as a `.bat` wrapper, which cannot be spawned without a
  shell on current Node. The script runs its `apksigner.jar` through `java`
  instead, using `JAVA_HOME` when set.

A tool that cannot be launched is reported as an environment problem with exit
code 2. A genuine verification failure is exit code 1. The two are kept apart,
because reporting a broken environment as a bad APK sends you looking in the
wrong place.

## Version codes

Android compares one integer, `versionCode` in `android/app/build.gradle`. The
build in users' hands today is **14**.

- A new published release takes a code **higher than the highest published
  code**, not merely one that has never been used. Code 13 was never published,
  and it is still refused, because a device on 14 would never be offered it.
- A rebuild of an already published release keeps that release's own code.
- Do not derive the code from a date or a timestamp. Two builds on one day would
  collide, and the value must stay inside Android's own range.
- The list of published codes lives in `scripts/apk-release-manifest.mjs` as
  `PUBLISHED_VERSION_CODES`. Add the code when a release ships. The check uses
  the maximum of that list.

## What the client does with the page

Update opens the download page in the system browser. The user installs from
there. The app never installs anything itself, never downloads the APK, and
never bypasses the Android install dialog.

Evidence has to keep those apart. "The download page opened" is not "the update
was installed". The two are separate checks, and only the first one is the
app's.

## Local fixtures

Verification uses local, controlled feeds only. A fixture lives in the evidence
folder for a packet, never in the repo, and never as production data. These are
the feed cases worth exercising: a current release, a newer release, a malformed
document, an unavailable feed, and an unapproved destination.
