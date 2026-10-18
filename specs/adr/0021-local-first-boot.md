# ADR-0021: Boot is local-first; the network is a background upgrade

- **Status**: Accepted
- **Date**: 2026-10-18
- **Amends**: [ADR-0019](0019-offline-reads-served-from-sw-cache.md) (Offline reads served from SW cache), [ADR-0020](0020-self-healing-reachability.md) (Self-healing reachability)

## Context

ADR-0018/0019/0020 built offline history as a packed snapshot: SW
`NetworkFirst` for the offline-read GETs, the react-query → IndexedDB
bag as reserve, and `ergoStatus.reachable` owned by an uncached
`/api/health` probe with a 25 s self-healing loop. The architecture is
sound, but the installed PWA still gets stuck on the bootstrap screen
„Ergo nicht erreichbar" away from home (LTE, foreign Wi-Fi) or with the
Pi switched off, and „Erneut verbinden" changes nothing. Verlauf and
Rekorde are on the device but unreachable. Four gaps reinforce each
other (analysis of `main` @ 29ad8de, epic #1):

- **B1 — Timeout race.** The client GET timeout (6 s,
  `AbortSignal.timeout`) equals the SW `networkTimeoutSeconds` (6 s) and
  starts first. On a *hanging* connection (DuckDNS → private IP off the
  LAN; Pi powered off on the home Wi-Fi) the page aborts one tick before
  the SW would have served the cache, so `NetworkFirst` never falls back.
  Only fast failures (connection refused) win — which is the one case
  `offline.spec.ts` tests.
- **B2 — Airplane mode.** react-query's default `networkMode: 'online'`
  *pauses* queries while `navigator.onLine === false`; the `queryFn`
  never runs and the SW cache is never consulted. With an empty IDB bag
  the gate spins forever — but AGENTS.md requires airplane mode to work.
- **B3 — 5xx from the reverse proxy.** Pi up, service down → Caddy
  answers 502. `NetworkFirst` treats any *response* as success and
  passes the 502 through instead of falling back to the cache.
- **B4 — The boot is network-bound; every local source is volatile.**
  `RowerGate` blocks the whole app when `rowers` / `active-rower` fail
  without data. The SW cache is defeated by B1–B3 and expires (30 days,
  LRU 200); the IDB bag is discarded on every deploy (`buster:
  __BUILD_SHA__`) and evicted by iOS. `reachable` starts at `true` with
  no "not yet probed" state, and failures of real requests never feed
  the recovery loop — it only runs once the probe has said `false`.

The requirement this ADR serves: **the offline state must always be
reachable** — the snapshot renders without a backend, and on any
network error the user can switch to it on request.

## Options considered

### Option A — Local-first boot with a three-valued, evidence-fed reachability (chosen)

Render from local data first, revalidate over the network in the
background, start reachability at `unknown`, feed it from real request
failures, and let the user latch an explicit offline mode. Harden the SW
cache as the second line. Detailed in *Decision*.

### Option B — Optimistic start: offline affordances during `unknown`

Start as today (`reachable = true`) or show the offline hero while the
first probe runs. Rejected: optimistic start is exactly what hides B1–B4
(the gate waits on the network); a pessimistic hero flashes
„Ergo nicht erreichbar" on every launch at home before the probe
answers. A neutral `unknown` state avoids both.

### Option C — SW `StaleWhileRevalidate` for read GETs

Serve the cache instantly, update in the background. Rejected: the
revalidated body reaches the cache but not the page that already
rendered — the background revalidation of a local-first boot must
*receive* fresh data, which `NetworkFirst` + react-query revalidation
gives us. It would also mask a reachable-but-failing backend at home.
Instant render is delivered by the local mirror and persisted cache
instead (Decision §1).

### Option D — Continuous probing while reachable

Poll `/api/health` on an interval even while reachable, to notice "Ergo
just went down". Rejected: battery and noise for a household app; the
SSE ping is already the heartbeat on the Live page, and real request
failures are cheaper, more truthful evidence (Decision §3).

### Option E — Auto-unlatch the manual offline mode

Leave the user-chosen offline mode automatically when a probe succeeds.
Rejected: the user decided to stay offline (e.g. flaky club Wi-Fi that
reaches the Pi intermittently, or a trainer demo that must not jump
around); flipping back mid-demo overrides that decision. A successful
probe while latched shows a hint instead.

## Decision

**Option A.**

1. **Boot is local-first.** The app renders from the local snapshot
   first and treats the network as a background revalidation. The local
   snapshot is (a) a durable, *synchronous* bootstrap mirror of
   `rowers` / `active-rower` in `localStorage`, written on every
   successful fetch and read as react-query `initialData`, plus (b) the
   persisted query cache (IndexedDB bag). `RowerGate` never blocks a
   device that has been at home once; the hard gate remains only for a
   device that has never paired.
2. **Reachability is three-valued: `unknown → true | false`**, starting
   at `unknown` on every launch. `unknown` renders neutrally: no offline
   hero, no diagnostics, start affordances briefly held with the copy
   „Suche Ergo…". The first probe (3.5 s timeout) resolves it, so a
   device away from home reaches the offline hero within ~4 s, and a
   device at home never flashes „Ergo nicht erreichbar".
3. **The recovery loop is fed by evidence.** ADR-0020's 25 s loop while
   `false` stays, as do the `visibilitychange` / `online` / `pageshow`
   triggers. In addition, failures of `NetworkOnly` requests — SSE
   channel `permanently_disconnected`, network errors on session
   start / end — flip the status to `false` and start the loop. There is
   **no continuous polling while reachable**; the SSE ping is the
   heartbeat on the Live page.
4. **Offline on request.** A latched mode `offline`, entered by the user
   from a prompt („Ergo antwortet nicht — Offline weiter?") shown on any
   network error while the probe still says `true` / `unknown`, and left
   only via „Erneut verbinden". While latched, the app renders exactly as
   when `reachable === false` (Stand-labelled snapshot, disabled start
   affordances). A successful probe while latched shows a hint that the
   Ergo is back; it does **not** switch back by itself.
5. **Queries use `networkMode: 'offlineFirst'`**, so the `queryFn` runs
   (and reaches the SW cache) even when `navigator.onLine === false`
   — airplane mode shows the Rucksack instead of a spinner. ADR-0020's
   rejection of coupling `onlineManager` to `reachable` **stands**:
   `offlineFirst` *un-pauses* queries, it never pauses them; nothing in
   react-query is driven by `reachable`.
6. **SW `NetworkFirst` stays** for the offline-read GETs (not
   `StaleWhileRevalidate`, see Option C), hardened:
   - the client GET timeout **exceeds** the SW `networkTimeoutSeconds`
     by a margin, so the SW always gets to serve the cache before the
     page aborts (fixes B1);
   - a **5xx counts as a network failure** for offline-read paths and
     falls back to the cache (fixes B3);
   - bootstrap paths (`rowers`, `active-rower`) **never expire** from
     the SW cache (no `maxAgeSeconds` / LRU eviction for them).
7. **The persisted-cache buster is a schema version**, bumped by hand
   when the persisted shape changes, instead of `__BUILD_SHA__` — the
   bag must survive a deploy.

ADR-0019's narrowed invariant is unchanged: the SW caches only the
idempotent offline-read GETs, never mutations, session control, the SSE
stream or `/api/health`, and no stale response is ever shown unlabelled.

## Consequences

- Easier: every launch renders immediately from local data; away from
  home the app degrades to the Stand-labelled snapshot regardless of the
  failure shape (hanging, refused, 502, airplane mode, IDB evicted); the
  user always has a way into the offline state.
- New obligations: two durable local sources to keep coherent (the
  `localStorage` bootstrap mirror and the persisted cache) — the mirror
  is written only from successful network responses; a third
  connectivity value (`unknown`) and a user-latched mode every consumer
  of `ergoStatus` must handle; the GET-timeout / SW-timeout margin is an
  invariant that needs a test; the schema-version buster must be bumped
  whenever persisted shapes change.
- Schema-version rule: `PERSIST_SCHEMA_VERSION` (`web/src/offline/persister.ts`)
  is the persisted-cache buster *and* the pack cursor's freshness key.
  Bump it by hand only when the shape of a persisted response changes —
  never per build — so neither the bag nor the pack is discarded by a
  deploy. An old cursor shape fails validation and triggers one full pack.
- Testing: the ADR-0019/0020 testing gap is closed by a Playwright
  project against the **preview build** with the real failure shapes
  (hanging connection, 502, airplane mode, IDB evicted), not only the
  instant `connectionrefused` abort `offline.spec.ts` uses.
- `networkMode: 'offlineFirst'` (Decision §5) changes only *whether a
  query runs* while the browser reports offline — it does not couple
  react-query's `onlineManager` to `reachable`, so ADR-0020's rejection
  of that coupling stands. Note that `onlineManager` learns about
  offline only from the `offline` event (not from `navigator.onLine` at
  boot), so the failure it fixes is going offline while the app is open:
  every query mounted afterwards used to pause without asking the SW
  cache. Retries still wait for `online`.
- Copy: the hero stays „Ergo nicht erreichbar · Stand: …"; „Offline"
  appears only as the action label „Offline weiter" (a user decision,
  not a status).
- Unchanged: no backend changes; no offline writes; the Pi stays
  LAN-only; the SQLite DB remains the single source of truth.
- Implementation is staged per epic #1 (issues #3–#9), each stage
  shippable on its own.
