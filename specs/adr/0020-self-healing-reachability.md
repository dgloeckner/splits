# ADR-0020: Reachability is self-healing and owns connectivity recovery

- **Status**: Accepted — amended by [ADR-0021](0021-local-first-boot.md)
- **Date**: 2026-07-03
- **Amends**: [ADR-0019](0019-offline-reads-served-from-sw-cache.md) (Offline reads served from SW cache; reachability as uncached probe)

## Context

ADR-0019 made `ergoStatus.reachable` (driven by an uncached `/api/health`
probe) the authority for "am I at home / is the ergo reachable". In
practice offline mode was still unstable, because the probe was
fire-and-forget and three connectivity state machines never talked:

- The probe ran only on boot / `online` / `visibilitychange`. One
  mistimed probe (Wi-Fi still re-associating after unlock) latched
  `reachable = false` at home until the next visibility change; iOS
  standalone PWAs deliver `online` events unreliably. There was no
  interval retry and no manual trigger.
- The SSE channel (`EventSourceChannel`) gave up after 8 consecutive
  failures (`permanently_disconnected`) — away from home that budget
  burns in under a minute — and nothing ever revived it except a banner
  button that only exists on the Live page. Coming home left the stream
  dead app-wide.
- `useRowers` / `useActiveRower` retried failures **forever**
  (`retry: true`), behind a developer-facing hard-error screen
  (`RowerGate` → `BootstrapScreen`) that still fired whenever the SW
  runtime cache missed (first away-launch, 30-day expiry, iOS storage
  purge) — a leftover from before ADR-0019.

## Decision

`ergoStatus` becomes the **single connectivity authority** with a
self-healing loop; everything else reacts to its transitions:

1. While `reachable === false`, the probe re-runs every 25 s, plus on
   `visibilitychange` / `online` / `pageshow`. `retryReachabilityNow()`
   is the manual trigger behind every "Erneut verbinden" button
   (offline hero, offline bootstrap screen, Live-page banner).
2. On the false→true transition exactly one hook fires (wired in
   `main.tsx`): invalidate all queries, drain the end-session queue,
   refresh the offline pack.
3. `ChannelReviver` (mounted inside `LiveSessionProvider`) calls
   `channel.reconnect()` whenever `reachable` is true and the channel
   is `permanently_disconnected`. The channel keeps its 8-failure
   budget; recovery cadence is owned by the probe.
4. `RowerGate` shows a friendly "Ergo nicht erreichbar" screen when
   `reachable === false`; the diagnostic screen (error cause + URL) is
   reserved for "reachable but failing". Bootstrap queries use the
   global finite retry policy — recovery is the probe's job.

Explicitly rejected: wiring react-query's `onlineManager` to
`reachable`. Pausing queries while unreachable would stop them hitting
the SW `NetworkFirst` cache — the durable offline read layer of
ADR-0019. Queries keep fetching (and succeeding from cache) offline.

## Consequences

- Easier: one owner for recovery; stuck states self-heal within 25 s;
  users get an explicit reconnect affordance; away-from-home is a
  first-class state, not an error dump.
- Cost: a 25 s probe cadence while unreachable (one tiny `no-store`
  GET that fails fast; negligible battery next to the SSE backoff it
  replaces as the de-facto retry mechanism).
- Unchanged: SW route allowlist and `NetworkFirst` semantics
  (ADR-0019); no backend changes; the Pi stays LAN-only.
- Testing gap remains: the preview-build offline e2e (ADR-0019's
  follow-up) is still outstanding.
