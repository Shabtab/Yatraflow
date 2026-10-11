# 0002. The mockup palette is not adopted; the shipped `--yf-*` tokens stay authoritative

**Status:** Accepted · **Date:** 2026-10-05

## Context

A four-page static mockup arrived at `C:\Users\hasna\yatraflow-mockup`, outside the repo and
never reconciled with `docs/redesign/ALIGNMENT.md`. It proposes a layout, a set of interactions,
and a second colour palette.

The repo is already mid-redesign. The "Calm Travel Intelligence" layer shipped and is audited
through M6. `src/styles.css` carries 351 lines and 425 occurrences of `--yf-*` declarations, and
`docs/redesign/YATRAFLOW_DESIGN_DIRECTION.md` is its written direction.

The mockup's palette is a separate system. All ten of its swatches have zero occurrences in
`src/styles.css`. The file holds 417 hex literals, and the shipped tokens resolve as hex, so this
is a real absence rather than a notation mismatch.

| Mockup swatch | Nearest shipped token |
|---|---|
| Pramal `#0EA5A0` | `--yf-teal-600` `#0D8D82` |
| Navy `#0F2D46` | `--yf-navy` `#123F49` |
| Coral `#FF8A65` | `--yf-coral` `#D6534D` |
| Warning `#F59E0B` | `--yf-saffron` `#F3AA3D` |
| Sand `#FBF5ED`, Mint `#E8F5F1` | no equivalent |

Adopting the palette means re-pointing 425 declarations that an audited direction document already
governs, and it splits the meaning of every colour the app has shipped.

The mockup's imagery cannot help either. `_gen3.json` records the prompts that generated every
file in `assets/`, so those images carry no licence.

## Decision

**The mockup's layout and interactions are adopted. Its palette is not.**

- The `--yf-*` layer stays the only source of colour truth.
- No MR row may change a colour value or add a hex literal to `src/styles.css`.
- Any new colour must arrive as a `--yf-*` token in both themes, as M1 did.
- No MR row may ship a file from the mockup's `assets/` directory.

## Consequences

The MR track carries twelve rows. Each adopts one layout or interaction idea and re-points it at the
existing tokens, so the work never touches a colour value.

Two contributors can now disagree usefully about a screen. They argue about layout, because colour
is already decided. That is the point of the split.

The mockup folder stays outside the repo. It is a reference, not a dependency, so nothing in
`package.json` or the build reads it.