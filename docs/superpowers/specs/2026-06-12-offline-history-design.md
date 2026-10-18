# Offline history in the PWA — design

**Date:** 2026-06-12
**Status:** Partially superseded (2026-06-13, 2026-10-18) — see ADR-0019, ADR-0021
**Depends on:** docs/superpowers/plans/2026-06-12-historie-optimization.md Tasks 7–9 (new trends endpoint + VerlaufTab/RekordeTab). Implement after those land.

> **Amendment (2026-06-13, ADR-0019).** The "persist react-query cache
> to IndexedDB, no service-worker changes" decision below failed in
> production on iOS: an installed PWA's IndexedDB is evicted/empty on a
> cold relaunch (the exact moment you reopen the app on LTE after
> toggling Wi-Fi), and with `/api/*` `NetworkOnly` there was no
> fallback, so `RowerGate` hard-errored "Backend nicht erreichbar".
> The rejected "Workbox `NetworkFirst`" alternative is now **adopted**
> for offline-read GETs, hardened so its three original objections no
> longer hold: reachability (and the Stand label) is driven by an
> uncached `/api/health` probe instead of query success. The IndexedDB
> persistence stays as redundant belt-and-suspenders. See
> `specs/adr/0019-offline-reads-served-from-sw-cache.md`.

> **Amendment (2026-10-18, ADR-0021).** The boot is now **local-first**:
> the app renders from a synchronous `localStorage` mirror of
> `rowers` / `active-rower` plus the persisted query cache, and the
> network is a background revalidation — `RowerGate` no longer blocks a
> device that has been at home once. Reachability is three-valued
> (`unknown → true | false`, neutral „Suche Ergo…" while probing) and is
> also flipped by real request failures; the user can latch an explicit
> offline mode („Offline weiter") on any network error. Queries run with
> `networkMode: 'offlineFirst'` so airplane mode reaches the SW cache.
> The SW `NetworkFirst` cache is hardened (client GET timeout > SW
> timeout, 5xx falls back to cache, bootstrap paths never expire), and
> the IndexedDB buster becomes a schema version instead of the build
> SHA, so the bag survives deploys. See
> `specs/adr/0021-local-first-boot.md`.

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
session detail** (incl. samples charts) for recent sessions, and a
**Home offline state** (hero card + dimmed favorites) that signals the
Ergo is unreachable and routes the user to Verlauf.

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
  `isPersistableQuery(queryKey)` so it is unit-testable).
  **Exact-shape matching, not prefixes** — concrete key shapes only:
  - `['rowers']`, `['active-rower']` — bootstrap; lets RowerGate pass
  - `['favorites', rowerId]` — offline Home renders real favorites
  - `['rower-trends', rowerId, window]`
  - `['rower-pbs', rowerId]`, `['rower-achievements', rowerId]`,
    `['rower-lifetime', rowerId]`
  - `['sessions', id]`, `['sessions', id, 'samples' | 'pb-banners']`
  - `['workout', id]` — session detail resolves the workout shape
  - Everything else falls through — notably
    `['sessions', 'stale-open', rowerId]` (length-3, non-matching
    tail), `['active-session']`, `['race-opponents', …]`, pairing.
    A prefix match on `sessions` would have persisted the volatile
    stale-open query; exact shapes exclude it structurally.
  - Drift net: the Playwright offline walkthrough asserts every
    offline surface renders from cache, so a future query missing
    from the allowlist fails CI, not the club demo. (A central
    `queryKeys.ts` factory was considered and deferred — YAGNI at
    ~15 keys, and it would touch pages the Historie rewrite is
    actively changing.)
- Only successful queries dehydrate (library default).
- `buster: __BUILD_SHA__` — a deploy invalidates the persisted cache.
  Safe offline: the service worker can only fetch an update when the
  backend is reachable, so an offline phone always runs the build its
  cache was written by; after a deploy, the next at-home open rebuilds
  the cache via prefetch.
- `maxAge: 30 days`, and `defaultOptions.queries.gcTime` raised to the
  same 30 days. **Required for correctness, not just tuning:** the
  default `gcTime` of 5 min garbage-collects prefetched-but-unmounted
  queries from the in-memory cache, and the next persister flush drops
  them from IndexedDB — the bag would silently empty minutes after
  packing. Persistence needs `gcTime ≥ maxAge`. The long `gcTime` is
  also why explicit pruning (see Storage bounds) is required.
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
  4. *Prune (storage bound):* after a successful full pack,
     `queryClient.removeQueries` (inactive queries only) for everything
     outside the keep-set: `['sessions', …]` entries whose session id
     is not among the last-N pack IDs (covers detail, samples,
     pb-banners), `['workout', id]` entries not referenced by a kept
     session, and rower-scoped aggregates (`rower-trends`, `rower-pbs`,
     `rower-achievements`, `rower-lifetime`) of rowers other than the
     active one. The persister flush rewrites the single IndexedDB
     value, so the store shrinks with the cache. This also removes
     deleted sessions' orphaned entries promptly instead of waiting
     out `maxAge`.
  5. *Cursor write:* `{rowerId, statsVersion, buildSha, packedAt}` to
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
    re-packs without it; its orphaned detail entry is removed by the
    prune step.
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
- Label: `Ergo nicht erreichbar · Stand: <date, time>`, formatted
  German (`10. Juni, 18:42`). Canonical copy per CONTEXT.md
  §"Ergo nicht erreichbar" — never "Offline" in UI copy (the phone is
  online; the Ergo isn't reachable). One shared component supplies
  this string to the Historie banner and the Home hero card.
- **Stand = the cursor's `packedAt`** — one global value: the moment
  the last full pack completed against a confirmed `stats_version`.
  Not per-page `dataUpdatedAt`: the bag is packed atomically, so it
  has one age; per-page values would show an immutable 20-day-old
  session detail as "Stand: 23. Mai" despite yesterday's verified
  pack, and the number would jump while navigating.
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
- **Verlauf list rows beyond the bag:** the list (embedded in the
  trends response) shows every session in the window, but only the
  last N have cached detail + samples. When the Ergo is unreachable,
  rows without a cached detail (`queryClient.getQueryState(['sessions',
  id])`, checked only in the unreachable state) render **dimmed and
  non-navigable** — same "visible but disabled = needs the Ergo"
  language as the Home favorites. The row's inline aggregates (date,
  distance, time, split) remain readable; no dead-end error screens
  mid-demo.

### 5. Ergo-reachability signal + offline Home

- `useErgoReachable()` — a tiny hook backed by the prefetch module's
  last cursor-probe outcome (exposed via `useSyncExternalStore`). The
  probe already runs on boot and resume, so no extra requests; any
  successful fetch flips the state back to reachable. Deliberately not
  `navigator.onLine`: at the club the phone *is* online — the Ergo is
  unreachable.
- **Home redesign for the unreachable state** (Home is the PWA entry
  route, so it is the trainer's first screen):
  - An offline hero card takes the top slot: staleness line (same
    source of truth as the Historie banner — copy and timestamp cannot
    drift) plus a single CTA **"→ Verlauf ansehen"**. No automatic
    redirect.
  - Favorites stay visible but dimmed/disabled — they are start
    affordances that need the Ergo; hiding them would look broken.
  - `StaleSessionCard` keeps hiding itself (volatile, as today).
- **Pack status at home:** a passive one-liner on ProfilePage next to
  the existing build info — `Unterwegs-Daten: Stand 12. Juni, 18:42 ·
  10 Sessions` — read straight from the cursor record. One glance
  before a trainer day confirms the bag; no badges, no notifications,
  no manual pack button (boot + resume triggers make a stale bag
  rare; a button would imply a workflow where none is needed).
- `['favorites', rowerId]` joins the persistence allowlist (organic
  capture only — no pack entry; it refreshes on every at-home Home
  visit) so the dimmed favorites render with real content.

### 6. Restore gating

`PersistQueryClientProvider` defers query mounting until the async
IndexedDB restore resolves (`useIsRestoring` internally); RowerGate
shows its existing loading state for those few ms. No code change
beyond the provider swap.

## Data volume & storage bounds

Trivially small per item: sessions are aggregate rows, samples ~120
buckets per session, trends/PB/achievement payloads are a few KB.

The local store must not grow unbounded. With `gcTime` at 30 days,
nothing ages out fast — so the pack's prune step is the bound:

- **Sessions: max N = 10** (one constant, equal to the pack depth).
  Detail/samples/pb-banners/workout entries outside the last-N
  keep-set are removed on every successful pack.
- **Rower aggregates:** kept for the active rower only.
- **Fixed key budget:** ~2 bootstrap + 3 trends + 3 records +
  N × ≤3 session entries ≈ 40 cache entries, well under 1 MB total.
- **Known growing payload (by design):** the trends `all` response
  carries one point per lifetime session (~few hundred bytes each) —
  the Verlauf "Alles" chart needs exactly that data online too.
  A decade of training stays in the few-hundred-KB range; no cap.
- The persisted state is one IndexedDB value rewritten per flush —
  no append-only growth independent of the cache contents.

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
  written only after full success); prune keep-set logic (entries
  outside last-N removed, kept and mounted entries spared, foreign
  rowers' aggregates removed, orphaned workouts removed); and the
  resume guard (visible event < 15 min after a successful probe →
  no-op; failure does not arm the guard).
- **Playwright e2e (the real proof):** warm the cache with the backend
  up (visit Verlauf/Rekorde or let prefetch run), then `route.abort()`
  all `/api/*`, reload the page, assert: Home shows the offline hero
  card with dimmed favorites; Verlauf charts, Rekorde, and a session
  detail render data with the staleness banner.

## Sequencing & coordination

Another instance is implementing the Historie plan (Tasks 7–9 rewrite
the trends endpoint and Verlauf/Rekorde pages). This feature targets
the **new** query keys (`['rower-trends', rowerId, window]`) and must
land after those tasks. All changes are additive (new `web/src/offline/`
modules, `main.tsx` provider swap, `getJSON` helper) — low merge risk.
