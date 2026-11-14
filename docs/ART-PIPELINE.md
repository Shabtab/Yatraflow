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

One hundred and twelve images are committed: 105 landscape scenes and seven square
empty-state vignettes. Every landscape id has five files: AVIF at 320, 640, 960 and
1600 pixels, plus WebP at 640. Every vignette has AVIF at 280 and 560, plus WebP at
560. The 1600 AVIF serves cover-size slots on a DPR-2 desktop screen.

### The 55 refreshed live scenes

These 55 landscape ids were already live and keep their names, so a replaced master never
moves a selection. Each file is encoded from the SELECTED output of the approved balanced
set.

- The fifteen original landscape scenes: `kerala-1`, `himalaya-1`, `himalaya-2`,
  `rajasthan-1`, `rajasthan-2`, `goa-1`, `goa-2`, `coorg-1`, `coorg-2`, `meghalaya-1`,
  `meghalaya-2`, `city-1`, `road-1`, `road-2` and `generic-1`.
- The 31 jurisdiction scenes: `andhra-pradesh-v1`, `arunachal-pradesh-v1`, `assam-v1`,
  `bihar-v1`, `chhattisgarh-v1`, `gujarat-v1`, `haryana-v1`, `jharkhand-v1`,
  `karnataka-v1`, `madhya-pradesh-v1`, `maharashtra-v1`, `manipur-v1`, `mizoram-v1`,
  `nagaland-v1`, `odisha-v1`, `punjab-v1`, `rajasthan-v1`, `sikkim-v1`,
  `tamil-nadu-v1`, `telangana-v1`, `tripura-v1`, `uttar-pradesh-v1`,
  `uttarakhand-v1`, `west-bengal-v1`, `andaman-and-nicobar-islands-v1`,
  `chandigarh-v1`, `dadra-and-nagar-haveli-and-daman-and-diu-v1`, `delhi-v1`,
  `jammu-and-kashmir-v2`, `lakshadweep-v1` and `puducherry-v1`.
- The nine legacy destination scenes: `jaipur-v1`, `udaipur-v1`, `mumbai-v1`, `leh-v1`,
  `manali-v1`, `rishikesh-v1`, `munnar-v1`, `darjeeling-v1` and `shillong-v1`.

Five jurisdictions reuse a scene rather than own a new one: Kerala (`kerala-1`), Goa
(`goa-1` and `goa-2`), Rajasthan (`rajasthan-v1`), Meghalaya (`meghalaya-1` and
`meghalaya-2`) and Himachal Pradesh (`himalaya-2`). Ladakh takes `himalaya-1`, the
trans-Himalayan lake scene. Jammu and Kashmir takes `jammu-and-kashmir-v2`, so a Kashmir
valley destination never shows the Ladakh lake.

### The 50 new destination scenes

Each id carries the review round (`-v2`). The display name and the jurisdiction live in the
place table.

| Id | Destination | State or UT |
| --- | --- | --- |
| `dest-agra-v2` | Agra | Uttar Pradesh |
| `dest-alappuzha-v2` | Alappuzha | Kerala |
| `dest-amritsar-v2` | Amritsar | Punjab |
| `dest-ayodhya-v2` | Ayodhya | Uttar Pradesh |
| `dest-cherrapunji-v2` | Cherrapunji | Meghalaya |
| `dest-coorg-v2` | Coorg | Karnataka |
| `dest-darjeeling-v2` | Darjeeling | West Bengal |
| `dest-delhi-v2` | Delhi | Delhi |
| `dest-dharamshala-v2` | Dharamshala | Himachal Pradesh |
| `dest-ekta-nagar-v2` | Ekta Nagar | Gujarat |
| `dest-gangtok-v2` | Gangtok | Sikkim |
| `dest-goa-v2` | Goa | Goa |
| `dest-gulmarg-v2` | Gulmarg | Jammu and Kashmir |
| `dest-hampi-v2` | Hampi | Karnataka |
| `dest-haridwar-v2` | Haridwar | Uttarakhand |
| `dest-jaipur-v2` | Jaipur | Rajasthan |
| `dest-jaisalmer-v2` | Jaisalmer | Rajasthan |
| `dest-jodhpur-v2` | Jodhpur | Rajasthan |
| `dest-kaziranga-v2` | Kaziranga | Assam |
| `dest-kochi-v2` | Kochi | Kerala |
| `dest-kodaikanal-v2` | Kodaikanal | Tamil Nadu |
| `dest-kovalam-v2` | Kovalam | Kerala |
| `dest-leh-v2` | Leh | Ladakh |
| `dest-madurai-v2` | Madurai | Tamil Nadu |
| `dest-manali-v2` | Manali | Himachal Pradesh |
| `dest-mumbai-v2` | Mumbai | Maharashtra |
| `dest-munnar-v2` | Munnar | Kerala |
| `dest-mussoorie-v2` | Mussoorie | Uttarakhand |
| `dest-mysuru-v2` | Mysuru | Karnataka |
| `dest-nubra-valley-v2` | Nubra Valley | Ladakh |
| `dest-ooty-v2` | Ooty | Tamil Nadu |
| `dest-pahalgam-v2` | Pahalgam | Jammu and Kashmir |
| `dest-pangong-tso-v2` | Pangong Tso | Ladakh |
| `dest-puri-v2` | Puri | Odisha |
| `dest-pushkar-v2` | Pushkar | Rajasthan |
| `dest-rameswaram-v2` | Rameswaram | Tamil Nadu |
| `dest-ranthambore-v2` | Ranthambore | Rajasthan |
| `dest-rishikesh-v2` | Rishikesh | Uttarakhand |
| `dest-shaheed-dweep-v2` | Shaheed Dweep | Andaman and Nicobar Islands |
| `dest-shillong-v2` | Shillong | Meghalaya |
| `dest-shimla-v2` | Shimla | Himachal Pradesh |
| `dest-sonamarg-v2` | Sonamarg | Jammu and Kashmir |
| `dest-sri-vijaya-puram-v2` | Sri Vijaya Puram | Andaman and Nicobar Islands |
| `dest-srinagar-v2` | Srinagar | Jammu and Kashmir |
| `dest-swaraj-dweep-v2` | Swaraj Dweep | Andaman and Nicobar Islands |
| `dest-tawang-v2` | Tawang | Arunachal Pradesh |
| `dest-thekkady-v2` | Thekkady | Kerala |
| `dest-udaipur-v2` | Udaipur | Rajasthan |
| `dest-varanasi-v2` | Varanasi | Uttar Pradesh |
| `dest-white-rann-v2` | White Rann of Kutch | Gujarat |

### The seven square vignettes

The vignettes are unchanged. They keep the accepted masters and the 280, 560 and
560 WebP widths. They get no 1600 AVIF, because a square vignette never fills a
cover-size slot.

| Id | Used for |
| --- | --- |
| `es-first-trip` | First-trip empty state |
| `es-no-saved` | Explore saved-empty state |
| `es-no-results` | Explore filter-empty state |
| `es-no-purchases` | Purchases empty state |
| `es-no-published` | Explore catalog-empty state |
| `es-offline` | Offline state, declared and unused |
| `es-error` | Page read failed |

### Place tables and selection

The `places` table in `manifest.json` holds 36 jurisdictions and 51 destinations. Sixteen
legacy destination keys now list the new scene first and the old scene as a fallback. The
other 35 destinations are new keys. Puducherry keeps `puducherry-v1`.

`src/lib/placeArt.ts` resolves a destination string against those tables. The order is:

1. The traveller's own upload, before this module is reached.
2. An exact supported destination.
3. A supported state or UT representative.
4. The neutral road scene when the matched stops span two or more states.
5. The neutral generic scene for anything unknown or ambiguous.

Matching uses whole tokens only. It never uses a substring, so `Goalpara` is not Goa and
`Keralapuram` is not Kerala. Unicode letters and combining marks stay in a token, so an
Indic-script name is not split apart. An exact destination always selects the first id in
its list. The later ids are fallback variants for the cover plan; they never replace the
exact destination's own scene.

### Review status

The user approved both approved sets on 2026-11-08. The live set has 55 of 55 records
updated. The destination set has 28 updated records and 22 kept records. No further
generation or cleanup is requested.

The manifests that hold the selected output per id are outside git:

- `E:/T3/evidence/art-live-balanced-20261108/records/balanced-manifest.json`
- `E:/T3/evidence/art-destinations-20261108/records/balanced-set-v2-manifest.json`

The review pages are `review/balanced-set.html` and `review/balanced-set-v2.html` in the same
evidence folders. The PNG masters stay outside git.

The live source files for Bihar and Odisha had mismatched original master revisions. Their
approved outputs are lossless PNGs decoded from the actual app AVIF files, so the refresh
keeps the scene the app already showed.

Karnataka keeps the original `karnataka-v1`. The `karnataka-study-v2` revision was
rejected and is not shipped.

The region lists in `manifest.json` map the trip regions to these ids. Every region has at
least one scene. `generic` holds `generic-1`, a geographically neutral scene: a place name no
keyword matches shows it rather than borrowing another region's scene, so the tile still shows
a finished illustration and still identifies no region.

The road and city families are kept as a declared compatibility fallback. `coverFor` still tries
them after the region step, and the tests still prove that step against a manifest with one
region emptied. The India layer does select `road` for a trip whose positively matched stops
span two states. They stay in the manifest and on disk for a future region list that is emptied,
and their twelve files are not re-encoded or removed.

`es-offline` is declared and committed but wired to nothing. No page has a supported offline
branch that could show it: `OfflineBanner` already owns the connection message in the shell, and
a page-level read failure cannot tell offline from a refused request. It stays unused until such
a branch exists. `vignetteArtFor('offline')` still resolves, so wiring it later needs no manifest
change.

A wide scene's 3:1 crop takes `focalY` 60 by default. `himalaya-2` sets its own 3:1 value of 40
because its peaks sit high in the frame. That is a manifest value, not a code branch.

`focalX` sits beside `focalY` with a default of 50. `rishikesh-v1` declares 70.3125 at
`1:1`. The master is 1536x1024, so a square crop has 512 px of horizontal overflow. The
two towers sit at x 526..550 and x 1335..1354; a window of side 1024 keeps both for any
left offset in 330..526 px. At 70.3125% the window is 360..1384, leaving 166 px before the
first tower and 30 px after the second. A new destination declares its own value only when
the pixels need one. An out-of-range, non-finite or unknown value clamps to 50.

## Budget

| Check | Limit |
| --- | --- |
| AVIF, 280 px | 12 KiB |
| AVIF, 320 px | 10 KiB |
| AVIF, 560 px | 30 KiB |
| AVIF, 640 px | 24 KiB |
| AVIF, 960 px | 40 KiB |
| AVIF, 1600 px | 172 KiB |
| WebP, any width | 45 KiB |
| Whole folder | 20 MiB |

The limits are in `manifest.json` under `budget`. The build and the tests read the same
values. The total cap rose from 11 MiB to 20 MiB, because the set grew from 441 files
to 546. The 1600 AVIF cap is 172 KiB. The largest 1600 file is 145,940 bytes. The current
total is 19,203,488 bytes (18.31 MiB) for 546 files.

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

The build writes into `src/assets/art/`. It also deletes stale files that match the naming
pattern and are no longer in the manifest. It prints a byte table and exits with code 1 when
a file or the total is over its cap, or when a master is missing.

`MASTER_FILES` in `scripts/build-art.mjs` names each id's master relative to the folder you
pass. One staging root serves every id:

```
<staging>\balanced\      the 55 selected live masters, one per id
<staging>\destinations\  the 50 selected destination masters, one per record id
<staging>\es-first-trip-v3.png  the square first-trip vignette
<staging>\batch1\        the six other square empty-state vignettes
```

The `coverWidths` key in `manifest.json` lists the extra AVIF widths for landscape
scenes. The build adds them to each id whose ratio is `3:2`. It does not add them
to square vignettes. `src/lib/regionArt.ts` reads the same key for the srcset.

The approved staging root for this batch is
`E:\T3\evidence\art-balanced-final-staging-20261108`. It holds hard links to the selected
evidence outputs, so its bytes match the approved masters. The table names only paths
relative to that root, so any folder of the documented shape rebuilds the same bytes.

To confirm every id resolves to a master of the right ratio, without encoding anything:

```powershell
npm run art:build -- --masters E:\T3\evidence\art-balanced-final-staging-20261108 --list-masters
```

That command must print `112 of 112 ids resolved`. A missing master, an id that names no
master, or a master whose dimensions contradict the manifest ratio fails the command.

`ENCODER_OVERRIDES` holds a per-file quality and effort override. 69 entries
keep files within their cap after the bounded ladder. A full rebuild at the baseline
quality would silently lose those encodings, so the table is part of the contract. An
entry that names no manifest file is an error.

To compare a build with the committed files without changing them, write to a scratch
folder:

```powershell
npm run art:build -- --masters E:\T3\evidence\art-balanced-final-staging-20261108 --out C:\scratch\art-check --report C:\scratch\art-report.json
```

Then compare the SHA-256 of each file with `src/assets/art/`. Only copy files into the repo
after the hashes match or after you accept the new output. The report holds the bytes and
SHA-256 of every file.

To check the committed files only, run:

```powershell
npm run art:build -- --check
```

The 2026-11-08 batch reproduced all 441 committed files byte for byte from the staging root.

## Add or replace an image

1. Put the master PNG in the staging root. Use a 3:2 landscape master for a scene, or a
   1:1 square master for a vignette. A refreshed live master reads
   `balanced/<id>.png`. A new destination master reads `destinations/<record-id>.png`.
2. Add the relative path to `MASTER_FILES` in `scripts/build-art.mjs`. Do not write an
   absolute machine path.
3. Add or update the id in `src/assets/art/manifest.json`. Set its widths, its WebP
   width, its ratio and its focal points.
4. Add the id to the region, fallback or place table it belongs to. A destination lists
   its primary scene first and any legacy variant after it.
5. Run `--list-masters` to confirm the master resolves and its ratio matches the manifest.
6. Run the build with `--out` to a scratch folder. Check the table and the caps.
7. Run the build into `src/assets/art/`.
8. Run `npx vitest run tests/region-art.test.ts tests/art-manifest.test.ts`.
9. Update the table in this file and the change fragment.

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
