# APK update feed

How an installed YatraFlow Android build learns that a newer one exists.
Reference for the client contract, plus the activation steps that are still
owed. **Nothing here is live.** No feed is published, and neither build
variable is set in any environment.

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

## The proposed destination

The project already serves the app from its canonical origin. The manifest
belongs at:

```
https://www.yatraflow.in/android/manifest.json
```

with the APK behind a stable path on that same host, such as
`/android/yatraflow-0.15.apk`. The host list is exactly
`www.yatraflow.in`.

An expiring CI artifact is not a destination. A signed-in Actions URL stops
working, and it never was a public page.

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

Steps, in this sequence:

1. Build the release APK with a new version code (see below).
2. Sign it with the release key, and check `apksigner verify` passes.
3. Generate the manifest locally:
   `node scripts/apk-release-manifest.mjs --apk <apk> --channel production --expect-signer-sha256 <cert-fingerprint> --download-url <url> --notes "<text>" --hosts www.yatraflow.in --out manifest.json`
4. Publish the APK, then the manifest, to the origin above.
5. Fetch the published manifest and check it answers with the expected fields.
6. Only then set the two variables and ship the build that reads them.

Step 3 refuses to emit a document unless the artifact passes every check. The
artifact must be available. Its package must match the channel. Its version code
must be higher than every published code, its signature must verify **and** its
signer must match the expected certificate, and its destination must be
approved.

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
