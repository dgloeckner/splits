# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a **multi-context** monorepo with two top-level contexts:

- **`backend/`** — Go service: serial ingestion from the IPM console, SQLite persistence, HTTP API, QR pairing.
- **`web/`** — React PWA: live training UI, history, stats, settings.

There is also a shared root context covering rowing/ergometer domain language and the IPM wire protocol — both contexts depend on this vocabulary.

## Before exploring, read these

Always start with the root-level docs (shared across contexts):

- **`docs/domain-glossary.md`** — system-wide domain vocabulary (rowing terms, `splits` brand, IPM protocol terms). Treat this as the root `CONTEXT.md`.
- **`docs/protocol-notes.md`** — IPM serial protocol reference (relevant whenever touching ingestion or test fixtures).
- **`specs/adr/`** — system-wide Architectural Decision Records (ADR-0001 … ADR-0008). These cross both contexts.
- **`specs/feat/`** — feature specs (FEAT-XXXX). Useful supplementary context when working on a named feature.
- **`AGENTS.md`** at the repo root — project mission, confirmed requirements, per-tool guidance.

Then read the per-context docs for whichever context you're working in:

- **`backend/CONTEXT.md`** — backend-specific terms (created lazily by `/grill-with-docs`).
- **`backend/docs/adr/`** — backend-scoped ADRs (created lazily).
- **`web/CONTEXT.md`** — web-specific terms (created lazily by `/grill-with-docs`).
- **`web/docs/adr/`** — web-scoped ADRs (created lazily).

If any per-context file doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## Picking the right context

Before exploring or proposing changes, decide which context the work touches:

- Touching `backend/**` → backend context. Read `backend/CONTEXT.md` and `backend/docs/adr/` if present.
- Touching `web/**` → web context. Read `web/CONTEXT.md` and `web/docs/adr/` if present.
- Touching both (e.g. an API contract change, a new event type, a new persisted field) → read **both** per-context docs *and* the root-level docs. Cross-context changes are the most common source of drift; treat them with extra care and surface the impact on each side explicitly.

## File structure (this repo)

```
/
├── AGENTS.md
├── docs/
│   ├── domain-glossary.md          ← root CONTEXT (shared vocabulary)
│   ├── protocol-notes.md
│   └── agents/                     ← this file lives here
├── specs/
│   ├── adr/                        ← system-wide ADRs (cross-cutting)
│   ├── feat/                       ← feature specs (FEAT-XXXX)
│   ├── arch/
│   └── int/
├── backend/                        ← context: backend (Go)
│   ├── CONTEXT.md                  ← lazy; created by /grill-with-docs
│   └── docs/adr/                   ← lazy; backend-scoped ADRs
└── web/                            ← context: web (React PWA)
    ├── CONTEXT.md                  ← lazy
    └── docs/adr/                   ← lazy
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant glossary — per-context first, then `docs/domain-glossary.md` for shared terms. Don't drift to synonyms the glossary explicitly avoids — for example, the product is `splits` (plural), not `split`.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR (system-wide or per-context), surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event ingestion pipeline) — but worth reopening because…_

For per-context decisions, name the context: _"Contradicts `backend/docs/adr/0001-…`"_.
