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

Six images are committed. Each one is a copy of an accepted derivative.

| Id | Used for | Widths | WebP |
| --- | --- | --- | --- |
| `kerala-1` | Kerala region | 320, 640, 960 | 640 |
| `himalaya-1` | Kashmir region (the manifest key) | 320, 640, 960 | 640 |
| `rajasthan-1` | Rajasthan region | 320, 640, 960 | 640 |
| `city-1` | City fallback, one place | 320, 640, 960 | 640 |
| `road-1` | Road fallback, two or more places | 320, 640, 960 | 640 |
| `es-first-trip` | First-trip empty state (square) | 280, 560 | 560 |

The region lists in `manifest.json` map the trip regions to these ids. Regions with an empty list
(`goa`, `coorg`, `meghalaya`, `generic`) have no image of their own yet.

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
The current total is 366436 bytes (357.8 KiB) for 23 files.

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
2. Add the master file name to `MASTER_FILES` in `scripts/build-art.mjs`.
3. Add or update the id in `src/assets/art/manifest.json`. Set its widths, its WebP width, its ratio and its focal points.
4. Add the id to the region or fallback list it belongs to.
5. Run the build with `--out` to a scratch folder. Check the table and the caps.
6. Run the build into `src/assets/art/`.
7. Run `npx vitest run tests/region-art.test.ts tests/art-manifest.test.ts`.
8. Update the table in this file and the changelog entry.

## Why the files live in `src/assets`

Vite gives each file under `src/assets` a hashed name. Hashed files can be cached for a long time.
The service worker also caches `/assets/*` first.

Files under `public/` get no hash, so a change to one can stay in a browser cache.

Vite inlines any asset under 4 KB into the JavaScript as base64. A small AVIF is often under 4 KB.
`vite.config.ts` sets `build.assetsInlineLimit` to a function. The function returns `false` for
paths under `src/assets/art/`. Every other asset keeps the default limit.

## Tools on Windows

Use `magick` for ImageMagick. Do not use `convert`. On Windows, `convert` is the disk tool.
