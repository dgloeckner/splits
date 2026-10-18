# ADR-0019: Offline reads are served from a durable service-worker cache; reachability is an uncached probe

- **Status**: Accepted — amended by [ADR-0020](0020-self-healing-reachability.md), [ADR-0021](0021-local-first-boot.md)
- **Date**: 2026-06-13
- **Amends**: [ADR-0018](0018-offline-as-packed-snapshot.md) (Offline history as a packed snapshot)

## Context

ADR-0018 made offline history a read-only packed snapshot persisted
through the **react-query cache → IndexedDB** (`@tanstack/react-query-persist-client`
over `idb-keyval`), and explicitly kept two invariants: *no
service-worker changes*, and *the SW never caches `/api/*`*. It rejected
a Workbox `NetworkFirst` option (its "Option B") for three reasons:
staleness would be invisible (no Stand label), only visited URLs would
be cached, and a backend hiccup at home would silently serve stale data.

That design assumed the IndexedDB bag survives on the target device. **On
iOS it does not.** The driving use case is an installed (Home-Screen)
PWA. To toggle Wi-Fi the user opens Settings, which backgrounds and
terminates the standalone PWA; reopening it on LTE is a *cold* launch
that depends entirely on restoring the IndexedDB bag. iOS evicts /
fails to return that store on cold relaunch.

Observed in production (iPhone, installed PWA, LTE):

- The app shows `RowerGate`'s hard error "Backend nicht erreichbar".
- Console: `FetchEvent.respondWith received an error: no-response` for
  `/api/v1/rowers` and `/api/v1/active-rower` — the SW's `NetworkOnly`
  rule failing the bootstrap reads with no fallback.
- Storage: `splits:rq-cache` is present **but holds 0 queries / 0
  mutations** — the durable store ADR-0018 relies on is empty.

So both halves of ADR-0018 failed together: the IndexedDB bag was empty,
and the SW was forbidden from caching `/api`, so there was nothing to
fall back to. `RowerGate` blocks the whole app when `['rowers']` /
`['active-rower']` fail without data (RowerGate.tsx), so an empty bag is
fatal, not degraded. The desktop offline E2E (`offline.spec.ts`, which
blocks the SW to exercise the IndexedDB path) is red on `main` for the
same root shape: the failing bootstrap fetch races the async cache
restore.

The IndexedDB persistence is also fragile independent of iOS: `buster:
__BUILD_SHA__` (the git SHA) discards the whole bag on any new build,
after which an offline, non-`success` query set can be re-persisted as
an empty client — matching the observed empty bag.

## Options considered

### Option A — Harden Option B: SW `NetworkFirst` for read GETs + uncached reachability probe

Cache the offline-read GETs in the service worker with `NetworkFirst`;
keep mutations, the SSE stream, session control, and `/api/health`
`NetworkOnly`. Drive `reachable` (the Stand label, the offline hero, and
dimmed start affordances) from a `no-store` probe to `/api/health` —
deliberately uncached — rather than from query success.

This answers ADR-0018's three rejection reasons head-on:

- *Staleness invisible* → reachability is an explicit uncached probe, so
  the "Stand: …" label is correct even when the SW serves a cached
  body. (Query success can no longer mean "reachable" — a cache hit is a
  success too — which is exactly why the probe is needed.)
- *Only visited URLs cached* → the at-home pack already visits the
  trainer-demo URLs, so Cache-Storage coverage equals the pack's set —
  the same bound as Option A in ADR-0018.
- *Hiccup at home serves stale silently* → `NetworkFirst` serves cache
  only when the network fails; the probe then flips `reachable` false
  and the data is *labelled* a snapshot — honest, not silent. Online,
  the network always wins, so a healthy backend is never shadowed.

Cache Storage survives an iOS cold relaunch far better than IndexedDB
and is not tied to `__BUILD_SHA__`. The bootstrap fetch *succeeds* from
cache, so `RowerGate` passes and the gate-vs-restore race disappears.

### Option B — Keep IndexedDB; mirror only the bootstrap into a durable store

Stash just `['rowers']` / `['active-rower']` into Cache Storage (or
localStorage) at pack time so the gate passes, leaving history/detail on
the fragile IndexedDB path. Smaller, but the trainer-demo surfaces
(Verlauf, Rekorde, detail) keep depending on the store iOS evicts.

### Option C — Make IndexedDB durable (fix the buster, lean on `navigator.storage.persist()`)

Keep ADR-0018's architecture and try to stop the eviction/empty-persist.
`persist()` is weakly honoured on iOS and eviction still happens under
storage pressure; this fights the platform instead of using the more
durable store already in the request path.

## Decision

**Option A.** Offline-read GETs are served from a durable SW
`NetworkFirst` cache (`splits-api-read`); `reachable` is owned by an
uncached `/api/health` probe (`web/src/offline/reachability.ts`), not by
query success. The exact path allowlist lives as a tested pure function
`isOfflineReadPath` (`web/src/offline/swRoutes.ts`), mirrored by the
self-contained `urlPattern` Workbox inlines into the generated SW
(`vite.config.ts`).

The ADR-0018 invariant "the SW never caches `/api/*`" is **narrowed**:
the SW may cache the *idempotent offline-read GETs*, never mutations,
session control, the SSE stream, or `/api/health`. The invariant's
*intent* — never show an unlabelled stale response — is preserved by the
reachability probe and the Stand label.

The react-query → IndexedDB persistence (ADR-0018) is **kept as
redundant belt-and-suspenders**, no longer load-bearing. It can be
removed in a later cleanup.

## Consequences

- Easier: offline survives an iOS cold relaunch (the actual use case);
  the bootstrap fetch succeeds from cache so `RowerGate` can't hard-error
  on an empty bag; the gate-vs-restore race is gone; no dependence on
  `navigator.storage.persist()` honouring.
- Harder / new obligations: `isOfflineReadPath` and the inlined
  `urlPattern` must stay in sync (commented on both sides; unit-tested);
  reachability is now a real round-trip the app must schedule (boot /
  visibility / `online`); any new offline-read endpoint must be added to
  the allowlist or it will 404 offline.
- Testing gap: `offline.spec.ts` blocks the SW and tests the legacy
  IndexedDB path (red on `main`). A faithful test of this decision needs
  a **production preview build** (the dev SW does not precache the shell,
  so offline navigation can't be exercised against `vite dev`). Tracked
  as a follow-up; on-device verification is the current acceptance.
- Unchanged: no backend changes; no offline writes; the Pi stays
  LAN-only; the SQLite DB remains the single writer/source of truth.
