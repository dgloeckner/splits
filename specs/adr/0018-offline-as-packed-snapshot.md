# ADR-0018: Offline history is a read-only packed snapshot; the backend stays LAN-only

- **Status**: Accepted — amended by [ADR-0019](0019-offline-reads-served-from-sw-cache.md)
- **Date**: 2026-06-12

## Context

The backend (Go + SQLite) runs loopback-only on a Raspberry Pi behind
Caddy; its DuckDNS hostname resolves to a private LAN IP. Away from
home — the driving use case is showing a trainer at the rowing club
how the rower stands — the phone is online but has **no route to the
backend**.

Hard security constraint, non-negotiable: **the Pi is never exposed to
the internet**, and a VPN was rejected as too clumsy for the use case.
So "offline support" cannot mean "tolerate a flaky connection"; it
means everything visible away from home must already be on the device,
captured while at home.

Standing invariants that any design must respect:

- The backend SQLite DB is the single source of truth.
- The service worker never caches `/api/*` (vite.config.ts) — a
  silently stale API response "lies to the user". Any cached data
  shown to the user must be *labeled* as a snapshot.

## Options considered

### Option A — Persisted react-query cache + at-home prefetch

Persist the existing query cache (allowlist-filtered) to IndexedDB;
a cursor-driven prefetch packs the trainer-demo data while the Ergo
is reachable; staleness is surfaced in the app layer with an explicit
Stand label.

Pros: no backend changes; no SW changes; pages keep their exact query
keys, so offline is a pure cache property; staleness is visible and
labeled. Cons: requires `gcTime` ≥ persistence age and explicit
storage pruning; offline coverage is bounded by what was packed.

### Option B — Service-worker runtime caching (NetworkFirst)

Cache history GETs in Workbox with a network timeout.

Pros: config-only. Cons: violates the "SW never caches /api/*"
invariant; staleness is invisible to the app (no Stand label
possible); only previously visited URLs get cached; a backend hiccup
*at home* silently serves stale data — the exact lie the invariant
guards against.

### Option C — Local-first replica with a sync protocol

A backend export/sync endpoint (since-cursor) feeding an IndexedDB
domain store; pages read local-first.

Pros: true local-first foundation, future multi-device story. Cons:
duplicates every history read path; the trends endpoint computes
rolling windows + fair prior deltas server-side and would need a TS
reimplementation (or response snapshots — which is Option A with
extra steps). Overkill for read-only "show the trainer".

(Exposing the backend via internet/VPN was excluded up front by the
security constraint, not evaluated on engineering merits.)

## Decision

**Option A.** Offline access is a read-only, atomically packed,
explicitly labeled snapshot of history data, persisted through the
existing react-query cache. The pack is cursor-driven: per-rower
`stats_version` (bumped by every `stats.Recompute`, which every
mutation path goes through) decides whether anything changed; a probe
costs one request, a new workout ~8.

There is deliberately **no sync protocol and no offline write path**:
the ergometer is at home, so away from home there is nothing to write,
and a competition-grade source of truth (PBs, records) should have
exactly one writer — the Pi.

Full design: `docs/superpowers/specs/2026-06-12-offline-history-design.md`.
Canonical terminology (Ergo nicht erreichbar, Stand): `CONTEXT.md`.

## Consequences

- Easier: offline surfaces are ordinary pages reading ordinary query
  keys; no second data plane to maintain; the SW invariant survives.
- Harder / new obligations: `gcTime` must stay ≥ persisted `maxAge`
  (default GC would empty the bag); the pack must prune (max N
  sessions, active rower only) or local storage grows unbounded; the
  persistence allowlist must match key shapes exactly (volatile keys
  like `['sessions', 'stale-open', …]` live under persisted
  prefixes); UI needs explicit unreachable states (Stand label,
  dimmed start affordances, dimmed non-cached rows).
- Foreclosed until revisited: multi-device sync, offline writes, and
  any feature requiring fresh data away from home. Revisiting any of
  these means superseding this ADR with a real sync protocol.
