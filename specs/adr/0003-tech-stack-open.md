# ADR-0003: Tech Stack — Open Decision

- **Status**: Proposed (decision deferred until after M0)
- **Date**: 2026-04-19

## Context

The project needs a backend language/framework and a frontend framework.
The choice affects deployment story, ARM compatibility, RAM/CPU footprint,
and maintainer productivity. We explicitly want to defer this decision
until **after M0** (protocol verification on real hardware) — implementing
the protocol parser against captured fixtures is largely language-agnostic
preparation, and the hands-on experience will inform the choice.

This ADR captures the option space so the decision is traceable when made.

## Options considered — Backend

### Option A — Go

Pros: Single static binary, trivial cross-compile (Mac → Linux/ARM in one
command), ~10–20 MB binary, ~20–40 MB RAM at runtime, first-class ARMv6
support, excellent concurrency story (goroutines fit the
serial-reader ↔ websocket-fan-out pattern idiomatically), `//go:embed` lets
us ship the PWA bundle inside the binary for one-file deploys.

Cons: More verbose than Python for data wrangling; fewer batteries for
later ML/analytics work; ORM story is weaker than Python/Kotlin
(use sqlc or hand-written SQL).

### Option B — Python (FastAPI + uvicorn)

Pros: Fastest prototyping; pyserial is mature; FastAPI gives OpenAPI and
WebSocket out of the box; huge ecosystem for later analytics work.

Cons: Heavier footprint (~80–150 MB RAM with uvicorn + workers); packaging
for Pi / Windows is clunkier than a single binary; deps graph gets
surprisingly large.

### Option C — Kotlin / Ktor

Pros: Aligns with the maintainer's daily stack (DVAG is Kotlin/Spring);
mature libraries; Coroutines for concurrency.

Cons: JVM startup and RAM footprint (~150–250 MB) are tough on Pi Zero
class hardware; GraalVM native-image is possible but adds build
complexity; overkill for a household project.

### Option D — Node.js / TypeScript

Pros: Same language as the frontend; `node-serialport` is mature;
ws library for WebSockets; easy to deploy.

Cons: Runtime footprint moderate; prod packaging (pkg/nexe) is less clean
than Go; ARMv6 support patchy on recent Node versions.

## Options considered — Frontend

### Option A — Angular (+ PWA schematic)

Pros: Maintainer is fluent; `ng add @angular/pwa` gives Service Worker,
Manifest and App Shell; solid for structured apps with multiple views.

Cons: Larger initial bundle than micro-frameworks; steeper learning curve
for anyone else picking up the project later.

### Option B — SvelteKit

Pros: Small bundles, excellent DX, built-in PWA story via adapters,
reactive by default.

Cons: Maintainer has less hands-on time with it.

### Option C — Vite + Preact + minimal libs

Pros: Tiny bundle, fast, cheap to reason about; Chart.js for charts.

Cons: More manual wiring for routing, state, PWA setup.

### Option D — Plain HTML + vanilla JS

Pros: Simplest possible, no build step.

Cons: State management and PWA updates get painful fast as features grow.

## Persistence

SQLite is strongly favoured regardless of backend language:

- Single file, trivial backup (`sqlite3 .backup`)
- WAL mode for concurrent read + single writer
- No server process, no network port, no credentials
- Native across all three deployment targets
- Easily exportable and human-inspectable

The only decision is the **driver**, which depends on backend language:
- Go: `modernc.org/sqlite` (pure Go, CGO-free, easy cross-compile)
- Python: stdlib `sqlite3`
- Kotlin: JDBC + `sqlite-jdbc`
- Node: `better-sqlite3`

## Decision

**Deferred.** Revisit after M0. Criteria for the decision:

1. How complex does the IPM parser turn out to be? (Complex = Python
   wins on iteration speed; simple = Go's footprint advantage wins.)
2. Is Pi Zero 2 W the primary deploy target, or is it a Pi 3/4? (Zero 2 W
   leans Go; Pi 3/4 neutralises the footprint argument.)
3. How important is "one binary" for sharing the project with less
   technical household members?

**Current lean**: Go backend + Angular PWA, embedded static assets. Revisit
with fresh eyes after the first protocol capture.

## Consequences

- No backend code committed until this ADR is Accepted with a concrete
  choice.
- M0 protocol work happens in a throwaway script (Python REPL or similar)
  that does **not** commit to a stack.
- Supersede this ADR with ADR-0003a (or a new ADR) once the decision is
  made; do not edit the options section retroactively.
