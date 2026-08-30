# YatraFlow Docs

Start here. The codebase is documented across the files below — read the ones relevant to your task.

| Doc | What's in it |
|---|---|
| [`README.md`](../README.md) | Project overview, features, MVP scope, roadmap, quick start. The front door. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How the pieces fit: data model, store, engine math, AI, geocoding, routing, maps, theming, extension points, gotchas. Read before changing core logic. |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Supabase setup, Vercel + other static hosts, env vars, release checklist. |
| [`DESIGN_TOKENS.md`](../DESIGN_TOKENS.md) | The 3-layer design-token system (primitive → semantic → component) and the button/input state matrix. |
| [`USER_GUIDE.md`](USER_GUIDE.md) | End-user how-to: planning a trip, the timeline, map, budget, sharing. |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Setup + ground rules for contributors. |
| [`AGENTS.md`](../AGENTS.md) | Operating manual for AI coding agents (Cline/Hermes). **Read fully before automating any change here.** |
| [`REPORT-2026-08-29-nearby-rework-and-google-maps.md`](REPORT-2026-08-29-nearby-rework-and-google-maps.md) | ⚠️ HISTORICAL design record (shipped in 0.17.0). Decision log, not live guidance. |

## Diagrams
- [`diagrams/yatraflow-architecture.json`](diagrams/yatraflow-architecture.json) — hand-authored source of the architecture diagram; the generated `.html` is gitignored (regenerate from the JSON, don't hand-edit).

## Changelog
- [`CHANGELOG.md`](../CHANGELOG.md) — every notable change, Keep-a-Changelog style.
