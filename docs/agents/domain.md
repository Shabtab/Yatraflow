# Domain docs

**Layout: single-context.** One `GLOSSARY.md` and one `docs/adr/` at the
repo root. No per-package contexts (this is not a monorepo).

## Consumer rules

- **Before naming a domain term, look it up in `GLOSSARY.md`.** If the term
  is missing, that is a gap worth filling rather than a licence to invent.
- **Glossary entries are definitions, not aspirations.** They describe what
  the code does today. When behaviour changes, update the entry in the same
  change — a stale glossary is worse than none.
- **ADRs record decisions and their reasons.** Write one when a choice is
  expensive to reverse, surprising, or was contested. Format:
  `docs/adr/NNNN-short-title.md`, status Proposed → Accepted → Superseded.
  Never edit an Accepted ADR's decision; supersede it with a new one.
- Existing prose that already plays this role: `docs/ARCHITECTURE.md`,
  `docs/MOTION-TOKENS.md`, `DESIGN_TOKENS.md`. Link to them; don't duplicate.