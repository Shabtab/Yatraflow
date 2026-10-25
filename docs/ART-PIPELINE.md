# Illustration pipeline

How the papercut illustrations are stored, built, checked and replaced.
The style brief is in [`design/art/STYLE.md`](../design/art/STYLE.md).

## What is in the repo

| Path | What it is |
| --- | --- |
| `src/assets/art/manifest.json` | The source of truth. It lists each image id, its widths, its WebP width, its ratio, its focal points, the region lists, the fallbacks and the size budget. |
| `src/assets/art/<id>-<width>.avif` | One AVIF file per width. |
| `src/assets/art/<id>-<width>.webp` | One WebP fallback file. |
| `scripts/build-art.mjs` | Builds the derivatives from the master PNGs. It also checks the caps. |
| `src/lib/regionArt.ts` | Pure code. It picks an id for a seed and resolves the fallback chain. |
| `src/lib/artUrls.ts` | Pure code. It maps an id and a width to the hashed Vite URL. |
| `tests/region-art.test.ts` | Tests the pick logic and the manifest shape. |
| `tests/art-manifest.test.ts` | Tests the files on disk: names, presence, caps, total and header sizes. |

The master PNGs are not in the repo. Each master is about 2 MB. Keep them in a folder outside git,
with a backup.

## The current set

Twenty-two images are committed: fifteen landscape scenes and seven square state vignettes.
Each one is a byte-identical copy of an accepted derivative. The id carries no review round,
so a replaced master keeps its id.

| Id | Used for | Widths | WebP |
| --- | --- | --- | --- |
| `kerala-1` | Kerala region | 320, 640, 960 | 640 |
| `himalaya-1` | Kashmir region (the manifest key) | 320, 640, 960 | 640 |
| `himalaya-2` | Kashmir region, second scene | 320, 640, 960 | 640 |
| `rajasthan-1` | Rajasthan region | 320, 640, 960 | 640 |
| `rajasthan-2` | Rajasthan region, second scene | 320, 640, 960 | 640 |
| `goa-1` | Goa region | 320, 640, 960 | 640 |
| `goa-2` | Goa region, second scene | 320, 640, 960 | 640 |
| `coorg-1` | Coorg region | 320, 640, 960 | 640 |
| `coorg-2` | Coorg region, second scene | 320, 640, 960 | 640 |
| `meghalaya-1` | Meghalaya region | 320, 640, 960 | 640 |
| `meghalaya-2` | Meghalaya region, second scene | 320, 640, 960 | 640 |
| `city-1` | City fallback, one place. Declared, unreachable while every region has a scene | 320, 640, 960 | 640 |
| `road-1` | Road fallback, two or more places. Declared, unreachable while every region has a scene | 320, 640, 960 | 640 |
| `road-2` | Road fallback, second scene. Declared, unreachable while every region has a scene | 320, 640, 960 | 640 |
| `generic-1` | Generic region, a destination no keyword matches | 320, 640, 960 | 640 |
| `es-first-trip` | First-trip empty state (square) | 280, 560 | 560 |
| `es-no-saved` | Explore saved-empty state (square) | 280, 560 | 560 |
| `es-no-results` | Explore filter-empty state (square) | 280, 560 | 560 |
| `es-no-purchases` | Purchases empty state (square) | 280, 560 | 560 |
| `es-no-published` | Explore catalog-empty state (square) | 280, 560 | 560 |
| `es-offline` | Offline state (square), declared and unused | 280, 560 | 560 |
| `es-error` | Page read failed (square) | 280, 560 | 560 |

The region lists in `manifest.json` map the trip regions to these ids. Every region has at
least one scene. `generic` holds `generic-1`, a geographically neutral scene: a place name no
keyword matches shows it rather than borrowing another region's scene, so the tile still shows
a finished illustration and still identifies no region.

The road and city families are kept as a declared compatibility fallback. `coverFor` still tries
them after the region step, and the tests still prove that step against a manifest with one
region emptied. Nothing selects them today: every region has a scene, so the region step always
answers first. They stay in the manifest and on disk for a future region list that is emptied,
and their twelve files are not re-encoded or removed.

`es-offline` is declared and committed but wired to nothing. No page has a supported offline
branch that could show it: `OfflineBanner` already owns the connection message in the shell, and
a page-level read failure cannot tell offline from a refused request. It stays unused until such
a branch exists. `vignetteArtFor('offline')` still resolves, so wiring it later needs no manifest
change.

A wide scene's 3:1 crop takes `focalY` 60 by default. `himalaya-2` sets its own 3:1 value of 40
because its peaks sit high in the frame. That is a manifest value, not a code branch.

## Budget

| Check | Limit |
| --- | --- |
| AVIF, 280 px | 12 KiB |
| AVIF, 320 px | 10 KiB |
| AVIF, 560 px | 30 KiB |
| AVIF, 640 px | 24 KiB |
| AVIF, 960 px | 40 KiB |
| WebP, any width | 45 KiB |
| Whole folder | 6 MiB |

The limits are in `manifest.json` under `budget`. The build and the tests read the same values.
The current total is 1151135 bytes (1124.2 KiB) for 81 files.

## Encoder settings

- AVIF: quality 50, effort 6, chroma subsampling 4:2:0.
- WebP: quality 60, effort 6.
- Each file is rotated from its EXIF data, converted to sRGB and resized to its width.
- Metadata is removed. Sharp does not copy it by default.
- The sharp version is pinned to 0.35.5 in `package.json`.

A change to any of these settings changes every file. Check the budget after you make the change.

## Build

Run the build from the repo root. Pass the folder that holds the masters:

```powershell
npm run art:build -- --masters C:\path\to\masters
```

The build writes into `src/assets/art/`. It also deletes stale files that match the naming pattern
and are no longer in the manifest. It prints a byte table and exits with code 1 when a file or the
total is over its cap, or when a master is missing.

`MASTER_FILES` in `scripts/build-art.mjs` names each id's master relative to the folder you pass.
The pilot masters sit flat and the batch masters sit in `batch1/` or `batch2/`, so one root
serves every id:

```powershell
npm run art:build -- --masters E:\YatraFlow\yatraflow-art-codex\masters --check
```

A batch-2 master is not copied into the art workspace. Stage a folder of the same shape under
`E:\T3` instead, with byte-identical copies, and point `--masters` at it:

```
<staging>\            the six pilot masters, flat
<staging>\batch1\     the fifteen batch-1 masters
<staging>\batch2\     the batch-2 masters
```

The table names only paths relative to that root, so no machine path enters the build. A rebuild
from the staging root reproduces every derivative. The art workspace root reproduces all but
`generic-1`, because that master was never copied into it.

```powershell
npm run art:build -- --masters E:\T3\evidence\art-batch2-generation-20261025\staging --list-masters
```

The art workspace root resolves 21 of 22 ids. `--list-masters` against it reports
`generic-1` missing, which is correct. Use the staging root for a full resolve, and expect the
workspace root to fail the `generic-1` row. A build against the workspace root does not delete the
four `generic-1` files: the stale-file sweep keeps every id the manifest declares, so the files
survive and the run exits 1.

To confirm every id still resolves to a master of the right ratio, without encoding anything:

```powershell
npm run art:build -- --masters E:\YatraFlow\yatraflow-art-codex\masters --list-masters
```

To compare a build with the committed files without changing them, write to a scratch folder:

```powershell
npm run art:build -- --masters C:\path\to\masters --out C:\scratch\art-check
```

Then compare the SHA-256 of each file with `src/assets/art/`. Only copy files into the repo after
the hashes match or after you accept the new output.

To check the committed files only, run:

```powershell
npm run art:build -- --check
```

On 2026-10-11 the build reproduced all 23 committed files byte for byte from the pilot masters.

## Add or replace an image

1. Put the master PNG in the masters folder. Use a 3:2 landscape master for a scene, or a 1:1 square master for a vignette.
2. Add the master file name to `MASTER_FILES` in `scripts/build-art.mjs`. The name is relative to the masters folder. A batch file reads `batch1/goa-1-v1.png` or `batch2/generic-1-v1.png`.
3. Add or update the id in `src/assets/art/manifest.json`. Set its widths, its WebP width, its ratio and its focal points.
4. Add the id to the region or fallback list it belongs to.
5. Run `--list-masters` to confirm the master resolves and its ratio matches the manifest.
6. Run the build with `--out` to a scratch folder. Check the table and the caps.
7. Run the build into `src/assets/art/`.
8. Run `npx vitest run tests/region-art.test.ts tests/art-manifest.test.ts`.
9. Update the table in this file and the changelog entry.

A state vignette also needs a key in `manifest.vignettes`, and a `StateVignette` at a page-level
`StateBlock` whose condition really means that state. Do not wire a vignette to a state the page
cannot distinguish: an image that claims a cause the code has not established is worse than the
icon it replaces.

## Why the files live in `src/assets`

Vite gives each file under `src/assets` a hashed name. Hashed files can be cached for a long time.
The service worker also caches `/assets/*` first.

Files under `public/` get no hash, so a change to one can stay in a browser cache.

Vite inlines any asset under 4 KB into the JavaScript as base64. A small AVIF is often under 4 KB.
`vite.config.ts` sets `build.assetsInlineLimit` to a function. The function returns `false` for
paths under `src/assets/art/`. Every other asset keeps the default limit.

## Tools on Windows

Use `magick` for ImageMagick. Do not use `convert`. On Windows, `convert` is the disk tool.
