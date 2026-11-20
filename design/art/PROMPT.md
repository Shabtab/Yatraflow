# Illustration prompt

The exact prompt and rules for every new illustration in the "balanced" style.
The look is in [`STYLE.md`](STYLE.md). The build is in [`docs/ART-PIPELINE.md`](../../docs/ART-PIPELINE.md).

## Status

- **Current style:** "balanced" painterly papercut, approved by the founder on 2026-11-08 and shipped in PR #916 (55 refreshed scenes and 50 new destination scenes).
- **Superseded:** the flat cut-paper "batch 1" look (October 2026), with a flat sun disc and hard cut edges. The founder rejected it on 2026-11-08. Do not use its prompts or its masters in `E:\YatraFlow\yatraflow-art-codex\`.

## Reference images

Attach these as style and lighting references only. Never copy their subject or buildings.

| Reference | In the repo | Master (outside git) |
|---|---|---|
| Manali, the approved style anchor | `src/assets/art/dest-manali-v2-1600.avif` | `E:\T3\evidence\art-destinations-20261108\review\manali-balanced-reference.jpg` |
| Goa coast | `src/assets/art/goa-1-1600.avif` | `E:\T3\evidence\art-live-balanced-20261108\masters\goa-1-balanced-v2.png` |
| Himalaya | `src/assets/art/himalaya-1-1600.avif` | `E:\T3\evidence\art-live-balanced-20261108\masters\himalaya-1-balanced-v3.png` |

More approved masters: `E:\T3\evidence\art-destinations-20261108\masters\balanced-v2\` and `E:\T3\evidence\art-live-balanced-20261108\masters\` (files named `*-balanced-v2.png`).
The selected outputs are listed in `E:\T3\evidence\art-destinations-20261108\records\balanced-set-v2-manifest.json`.

## Prompt A: restyle an existing scene

Use this prompt word for word when you bring an existing app image up to the balanced style. Input 1 is the image to edit. Input 2 is the Manali reference.

```text
Use case: style-transfer. Create ONE updated full-bleed landscape 1536x1024 illustration for YatraFlow. INPUT 1 is the EXISTING LIVE-APP IMAGE TO EDIT, preserve its specific scene, geography, composition and subject identity. INPUT 2 is the approved BALANCED MANALI illustration, STYLE AND LIGHTING REFERENCE ONLY. Bring input1 up to this same beautiful painterly finish: rich harmonious colours, confident broad forms, crisp major silhouettes, gently modelled depth, subtle fine grain and soft layered-paper material integrated naturally. Balance moderately developed detail in focal areas with simpler broad foliage masses and calm open water, meadow, sky, sand or ground appropriate to the ORIGINAL scene. Do not overfill with tiny texture marks or giant decorative leaves. Vary trees naturally. Keep enough clear detail for beautiful full-size viewing and easy recognition at trip-card size. PRESERVE THE ORIGINAL SCENE, not Manali's subject: do not add temples, trains, bridges, people, animals, snow, tropical plants or buildings unless they already belong to input1. Keep local geology and native vegetation. Remove any visible sun disc from input1 and paint clean natural sky in its place; the light comes from outside the frame. Absolutely no visible sun, orb, halo, bright dot, rays or lens flare. Slightly restrained warmth; rich natural local colours, deep teal/cool-blue shadows and luminous gentle highlights. No global orange filter or beige desaturation. A softly coloured sky with modest peach and cool blue, only delicate lavender. No text, letters, signage, logos, borders, watermark or collage. Preserve one coherent full landscape with foreground breathing room. No photorealism, glossy3D or obvious cutout pieces.
```

Source: `E:\T3\evidence\art-live-balanced-20261108\records\style-prompt.txt`.

## Prompt B: a new scene with no input image

Use this for a new scene: a new destination, a banner or other marketing art. Replace `{SIZE}`, `{SCENE}` and `{LAYOUT}`. Attach the three reference images above.

```text
Use case: stylized-concept. Create ONE new full-bleed landscape illustration for YatraFlow, {SIZE}. The attached images are the approved BALANCED style, STYLE AND LIGHTING REFERENCE ONLY. Do not copy their subject, framing or buildings. Scene: {SCENE}. Paint it in the same beautiful painterly finish: rich harmonious colours, confident broad forms, crisp major silhouettes, gently modelled depth, subtle fine grain and soft layered-paper material integrated naturally. Balance moderately developed detail in focal areas with simpler broad foliage masses and calm open water, meadow, sky, sand or ground. Do not overfill with tiny texture marks or giant decorative leaves. Vary trees naturally. Keep local geology and native vegetation. The light comes from outside the frame. Absolutely no visible sun, orb, halo, bright dot, rays or lens flare. Slightly restrained warmth; rich natural local colours, deep teal/cool-blue shadows and luminous gentle highlights. No global orange filter or beige desaturation. A softly coloured sky with modest peach and cool blue, only delicate lavender. Layout: {LAYOUT}. No text, letters, digits, signage, logos, borders, watermark or collage. No people, faces, temples, domes or religious buildings. No maps or outlines of India. One coherent full landscape with foreground breathing room. No photorealism, glossy3D or obvious cutout pieces.
```

For a banner, `{LAYOUT}` names the calm area for text and the safe zones. Example: "keep the left third as calm soft sky for one line of text; keep the bottom-left avatar area simple and low-detail".

## Acceptance

- A candidate passes only after a side-by-side check with the reference masters. Generation success is not acceptance (`E:\T3\evidence\art-destinations-20261108\records\STYLE-CORRECTION.md`).
- Check each image at a 64 px thumbnail, a 3:1 crop and a 2× zoom for letters, glyphs, symbols and a visible sun.
- Record the exact prompt, the reference files and their SHA-256 hashes, the generated size and every crop or scale step.
- The hard rules and the layout rules in [`STYLE.md`](STYLE.md) apply to every image.

## Tool notes

- The Codex image tool always writes to `C:\Users\hasna\.codex\generated_images\` first. Allow that folder in a brief, or a strict "write only to this folder" rule stops the worker after one image.
- Keep masters outside git. Only the built AVIF and WebP files go in `src/assets/art/` (see `docs/ART-PIPELINE.md`).
