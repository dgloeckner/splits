# Offline history in the PWA — design

**Date:** 2026-06-12
**Status:** Approved (brainstorming session)
**Depends on:** docs/superpowers/plans/2026-06-12-historie-optimization.md Tasks 7–9 (new trends endpoint + VerlaufTab/RekordeTab). Implement after those land.

## Problem

The backend (Go + SQLite) runs loopback-only on a Raspberry Pi behind
Caddy; its DuckDNS hostname resolves to a **private LAN IP**. Security
constraint: the backend is never exposed to the internet, and no VPN.
Away from home (use case: showing a trainer at the rowing club how the
rower stands), the phone has internet but **zero route to the backend**.

The installed PWA already opens offline — `vite-plugin-pwa` precaches
the app shell — but every page is empty because `/api/*` is
deliberately `NetworkOnly` in the Workbox config ("stale API responses
would lie to the user") and nothing is cached on-device.

Two failure details shape the design:

1. `RowerGate` (web/src/app/RowerGate.tsx) blocks the whole app with an
   error screen when `['rowers']` / `['active-rower']` fail without
   data. Offline bootstrap data is a prerequisite for everything else.
2. At the club, `navigator.onLine` is `true` and the hostname resolves
   to an unreachable private IP — fetches don't fail fast, they hang
   for the TCP timeout (30–75 s).

## Decision

**Persist the react-query cache to IndexedDB and prefetch the trainer-
demo data while at home.** No backend changes. No service-worker
changes — the "SW never caches /api/*" invariant stays; staleness is
handled in the app layer where it can be *labeled*.

Rejected alternatives:

- **Workbox `NetworkFirst` for history GETs** — config-only, but
  staleness is invisible to the app (no "Stand: …" label possible),
  only visited URLs get cached, and a backend hiccup *at home* would
  silently serve stale data — exactly the lie the current config
  comment guards against.
- **Local-first replica (sync endpoint + IndexedDB domain store)** —
  duplicates every history read path, and the new trends endpoint
  computes rolling windows + fair prior deltas server-side, which
  would need a TS reimplementation. Overkill for read-only offline.

## Scope

Offline-readable at the club: **Verlauf** (trends charts, all three
windows), **Rekorde** (PBs, lifetime, achievements), **session list +
session detail** (incl. samples charts) for recent sessions.

Out of scope: offline writes (the ergometer is at home; there is
nothing to write at the club), Live page (errors as today), multi-rower
prefetch (active rower only).

## Components

### 1. Persistence layer — `web/src/offline/persister.ts`

- New deps (npm): `@tanstack/react-query-persist-client`, `idb-keyval`.
- `main.tsx`: `QueryClientProvider` → `PersistQueryClientProvider`
  with an async IndexedDB persister (`persistClient` / `restoreClient`
  / `removeClient` over `idb-keyval`).
- **Allowlist** via `shouldDehydrateQuery` (exported pure function
  `isPersistableQuery(queryKey)` so it is unit-testable). Persisted
  key prefixes:
  - `rowers`, `active-rower` — bootstrap; lets RowerGate pass offline
  - `rower-trends` (`['rower-trends', rowerId, window]`)
  - `rower-pbs`, `rower-achievements`, `rower-lifetime`
  - `sessions` (list, `['sessions', id]`, `['sessions', id, 'samples']`)
  - `workout` (session detail resolves the workout shape)
  - Never persisted: `active-session`, `stale-open`, `race-opponents`,
    pairing/favorites-mutation state — anything live or volatile.
- Only successful queries dehydrate (library default).
- `buster: __BUILD_SHA__` — a deploy invalidates the persisted cache.
  Safe offline: the service worker can only fetch an update when the
  backend is reachable, so an offline phone always runs the build its
  cache was written by; after a deploy, the next at-home open rebuilds
  the cache via prefetch.
- `maxAge: 30 days`.
- Boot: call `navigator.storage.persist()` once (best-effort, resists
  iOS storage eviction; data re-syncs on every at-home use anyway).

### 2. Prefetch ("Rucksack packen") — `web/src/offline/prefetch.ts`

- Triggers: once per app load, low priority (after first paint /
  `requestIdleCallback` fallback `setTimeout`), **and** on
  `visibilitychange` → visible when the last *successful* pack is
  older than 15 minutes. Not a periodic timer: a mobile PWA rarely
  reloads — it gets resumed — and the resume trigger covers the
  "rowed with the app open in the background, left home without
  reopening it" gap (post-session invalidation only refetches
  *mounted* queries; the new session's detail/samples are never
  fetched otherwise). A timer would poll the Pi while idle and fire
  uselessly when away. The 15-min guard (plus a no-concurrent-pack
  guard) keeps foreground-flapping from hammering the Pi Zero.
- **Cursor-based packing.** The backend already provides the cursor:
  `stats.Recompute` bumps `rower_lifetime_stats.stats_version` on
  every call (recompute.go), and recompute runs after every session
  end and delete. No backend changes.
  1. *Probe:* each trigger fetches `getRowerLifetime` (single-row
     query; doubles as the `rower-lifetime` cache refresh) and reads
     `stats_version`.
  2. *Cursor hit:* `stats_version` equals the persisted cursor **and**
     the last full pack is < 24 h old → done. A resume at home costs
     one request.
  3. *Cursor miss:* full pack — `rower-trends` × {`30d`, `365d`,
     `all`}, `rower-pbs`, `rower-achievements`, then detail + samples
     (+ workout) for the **last 10 sessions**, whose IDs are derived
     from the just-packed trends response (the Verlauf session list is
     embedded in `TrendsResponse` — no separate `listSessions` pack;
     that endpoint is only consumed by Wartung). Already-cached
     session IDs are skipped: finalized sessions are immutable, so a
     cached entry stays valid (within `maxAge`). Steady state: a new
     workout costs ~8 requests.
  4. *Cursor write:* `{rowerId, statsVersion, buildSha, packedAt}` to
     `idb-keyval`, only after a fully successful pack. `buildSha`
     (from `__BUILD_SHA__`) must match at probe time or the pack runs
     in full: the persisted query cache is busted on deploy, but the
     cursor record would survive — without this check, a same-day
     "deploy at home, club at noon" trip would skip packing into the
     freshly emptied cache. (The `maxAge`-expiry variant of the same
     desync is already covered by the 24 h condition.)
  - The 24 h secondary condition exists because trends windows are
    rolling: a 30d window drifts daily even with no new session, so an
    unchanged cursor alone would let chart content age silently.
  - Not covered by the cursor (deliberately): rower profile edits
    (name/color) don't bump `stats_version` — `rowers`/`active-rower`
    refresh organically on every app open and the persister captures
    the live cache. A deleted session bumps the version, so the list
    re-packs without it; its orphaned detail entry ages out via
    `maxAge`.
- Uses `queryClient.prefetchQuery` with the *exact* keys and client
  functions the pages use — offline cache hits are automatic, and a
  later page visit reuses the prefetched entry (no double fetch within
  `staleTime`).
- Unreachable backend → prefetches fail silently (they share the fast
  fetch timeout below). No retry storm: `retry: false` for prefetches.
- Freshness model: boot + resume packing means the bag is refreshed
  whenever the app is in hand at home — at most one workout stale in
  practice. No manual "pack" button in v1.

### 3. Fast failure — `web/src/api/client.ts`

- History/bootstrap **read** functions get `AbortSignal.timeout(6000)`
  via a small `getJSON(url)` helper. Mutations (`session/end`,
  finalize, delete) and the SSE stream are untouched.
- No change to react-query `networkMode` (stays `'online'`; at the
  club `navigator.onLine` is true, so refetches run, fail fast, and
  the UI keeps rendering the restored data).

### 4. Staleness UI — `web/src/offline/OfflineBanner.tsx`

- Shown on HistoryPage (covers Verlauf + Rekorde) and
  SessionDetailPage when the surface's queries are **erroring but
  rendering persisted data**: any relevant query has `isError` (or
  `failureCount > 0`) while `data` is present.
- Label: `Offline — Stand: <date, time>` from the **oldest**
  `dataUpdatedAt` among the page's queries, formatted German
  (`10. Juni, 18:42`).
- No banner while fresh or while a first fetch is in flight. Banner
  disappears as soon as a refetch succeeds.
- **Page error-gate audit (required):** the surfaces must be
  data-first — error UI only when `error && !data`, banner when
  `error && data`. Two concrete fixes:
  - `SessionDetailPage.tsx` gates with `sessionQ.error || !sessionQ.data`
    → offline it flips to the full error screen even though restored
    data is present. Change to `!sessionQ.data` (error screen only
    without data).
  - `VerlaufTab.tsx` renders `{error && 'Konnte Verlauf nicht laden.'}`
    unconditionally alongside `{data && …}` → gate to `error && !data`.
  - `RekordeTab.tsx` is already data-first; no change.

### 5. Restore gating

`PersistQueryClientProvider` defers query mounting until the async
IndexedDB restore resolves (`useIsRestoring` internally); RowerGate
shows its existing loading state for those few ms. No code change
beyond the provider swap.

## Data volume

Trivially small: sessions are aggregate rows, samples ~120 buckets per
session, trends/PB/achievement payloads are a few KB. A full prefetch
is well under 1 MB — no quota or write-throttling concerns.

## Error handling

- Club scenario (no route): refetches abort after 6 s, queries enter
  error state with persisted `data` intact, banner appears. The
  existing 429/410/403 toast mapping is unaffected (timeouts are
  `AbortError`, not `ApiError`).
- First-ever offline open (never used at home): no persisted cache —
  RowerGate shows its existing bootstrap-error screen. Acceptable; the
  phone must have been used at home once.
- Corrupt/incompatible persisted payload: persister `removeClient` +
  throwing restore falls back to an empty cache (library behavior) —
  identical to first-open.
- Accepted residual: the persister flushes on a ~1 s throttle, so
  killing the app between pack-success and flush can leave a cursor
  that claims packed while an entry is missing. Self-heals on the next
  version bump or 24 h pack; not worth extra machinery.

## Testing

- **vitest:** `isPersistableQuery` allowlist (each prefix in/out);
  banner visibility logic (error+data → shown, fresh → hidden,
  date formatting); page error gates (`error && data` → content +
  banner, `error && !data` → error UI); prefetch cursor logic
  (unchanged version + recent pack → probe only; version bump or
  `buildSha` mismatch → full pack; cached session IDs skipped; cursor
  written only after full success) and the resume guard (visible
  event < 15 min after a successful probe → no-op; failure does not
  arm the guard).
- **Playwright e2e (the real proof):** warm the cache with the backend
  up (visit Verlauf/Rekorde or let prefetch run), then `route.abort()`
  all `/api/*`, reload the page, assert Verlauf charts, Rekorde, and a
  session detail render data and the banner shows `Offline — Stand:`.

## Sequencing & coordination

Another instance is implementing the Historie plan (Tasks 7–9 rewrite
the trends endpoint and Verlauf/Rekorde pages). This feature targets
the **new** query keys (`['rower-trends', rowerId, window]`) and must
land after those tasks. All changes are additive (new `web/src/offline/`
modules, `main.tsx` provider swap, `getJSON` helper) — low merge risk.
