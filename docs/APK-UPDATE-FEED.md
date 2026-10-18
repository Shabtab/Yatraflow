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
   `node scripts/apk-release-manifest.mjs --apk <apk> --channel production --download-url <url> --notes "<text>" --hosts www.yatraflow.in --out manifest.json`
4. Publish the APK, then the manifest, to the origin above.
5. Fetch the published manifest and check it answers with the expected fields.
6. Only then set the two variables and ship the build that reads them.

Step 3 refuses to emit a document unless the artifact passes every check. The
artifact must be available. Its package must match the channel. Its version code
must be new, its signature must verify, and its destination must be approved.

## Version codes

Android compares one integer, `versionCode` in `android/app/build.gradle`. The
build in users' hands today is **14**.

- A new published release takes the next higher integer. Never reuse a code.
- A rebuild of an already published release keeps that release's own code.
- Do not derive the code from a date or a timestamp. Two builds on one day would
  collide, and the value must stay inside Android's own range.
- The list of published codes lives in `scripts/apk-release-manifest.mjs` as
  `PUBLISHED_VERSION_CODES`. Add the code when a release ships.

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
