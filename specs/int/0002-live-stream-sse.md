# INT-0002: Live-Stream API (Server-Sent Events)

- **Status**: Draft
- **External system**: The PWA frontend (same repo, separate deploy
  unit). Considered "external" from the backend's perspective for
  wire-format purposes.
- **Depends on**: INT-0001 (IPM live-data stream), FEAT-0001 (Live
  View), FEAT-0007 (metrics catalogue), ADR-0005 (rower auth)

## Purpose

Push rowing events from the backend to all connected PWA clients with
sub-second latency so the live view reflects each stroke as it happens,
and so a second device joining mid-session can catch up.

## Transport choice

**Server-Sent Events (SSE) over HTTPS.** Rationale (full comparison in
FEAT-0001 brainstorm):

- One-way flow matches our data direction (backend → client). Control
  actions ("end session", "switch rower") go over regular HTTP `POST`.
- Built-in reconnect with `Last-Event-ID` → replay-on-reconnect is
  near-free.
- Plain HTTP streaming; no protocol upgrade; passes through Caddy
  (ADR-0006) without special configuration.
- `HttpOnly` session cookie authentication works automatically via
  same-origin rules.

WebSockets were the runner-up. We chose SSE for the simplicity of the
stroke-event use case; revisit only if bidirectional traffic becomes
load-bearing.

## Endpoint

```
GET /api/v1/stream
```

- **Auth**: session cookie from the rower-pair exchange (ADR-0005). No
  auth → `401`. No rower paired → `403` with `{"error":"no_rower"}`.
- **Response**: `Content-Type: text/event-stream; charset=utf-8`
  with `Cache-Control: no-store` and connection kept open.
- **Fan-out model**: **shared**. All connected clients receive the same
  event stream for the single ergo. The app is v1-single-ergo; any
  authenticated rower's device can watch.
- **Query parameters**:
  - `session=<uuid>` — replay events for a specific past session (no
    further events pushed after the session's last one; the stream
    closes cleanly with an `event: eof`).
  - `session=live` (default when omitted) — follow the current / next
    session. Includes replay of events already emitted in the current
    session if one is underway, then continues with live events.
  - `since=<event-id>` — resume from a specific event id, overriding
    the `Last-Event-ID` request header. Useful for clients resuming
    from local storage after a long offline interval.

## Event types

All event `data` payloads are JSON-encoded. All events carry a
monotonically increasing `id:` so `Last-Event-ID`-based resume works.

### `stroke`

Emitted once per A8 message, i.e. per detected stroke (see INT-0001
"cadence" — one A8 per stroke, verified). Derived Tier-2 metrics
(FEAT-0007) are computed server-side and included.

```
event: stroke
id: 47
data: {
  "session_id": "01HV…",
  "stroke": 47,
  "time_sec": 85.3,
  "distance_m": 342,
  "spm": 27,
  "power_w": 245,
  "cal_per_hr": 1175,
  "level": 3,
  "dps": 8.4,
  "stroke_cycle_sec": 2.22,
  "pace_sec_per_500m": 132,
  "energy_joules": 544
}
```

### `session_start`

Emitted on the first `stroke` after an idle period or on server
startup if the IPM is already rowing. Contains session metadata so the
client can build its view without guessing.

```
event: session_start
id: 0
data: {
  "session_id": "01HV…",
  "started_at": "2026-04-19T19:42:03Z",
  "rower_id": "01HV…",
  "rower_name": "Daniel",
  "initial_level": 3
}
```

Fields:
- `session_id` — ULID assigned by the sessionizer.
- `started_at` — RFC 3339 timestamp of the session's first stroke.
- `rower_id` — ULID of the rower the session is attributed to.
- `rower_name` — Display name of that rower.
- `initial_level` — Resistance level at session open.
- `workout_id` (string, optional) — present when the session is tagged with a workout. Frontend uses this to fetch the workout definition and drive segment overlays.

### `session_end`

Emitted when the session is closed (idle timeout per INT-0001 state
machine, or explicit "stop" action). Contains the Tier-3 aggregate
summary (FEAT-0007).

```
event: session_end
id: 48
data: {
  "session_id": "01HV…",
  "ended_at": "2026-04-19T19:47:30Z",
  "summary": {
    "total_distance_m": 1035,
    "total_time_sec": 284.0,
    "total_strokes": 124,
    "avg_power_w": 259,
    "peak_power_w": 322,
    "avg_spm": 26.3,
    "avg_dps": 8.35,
    "avg_pace_sec_per_500m": 137,
    "session_calories": 112
  }
}
```

### `level_change`

Emitted when the resistance level `[25:27]` of the A8 stream changes
between consecutive strokes. The `stroke` events already carry the
current `level`; this is a convenience event for timelines / annotated
charts.

```
event: level_change
id: 23
data: {"from": 2, "to": 3, "at_stroke": 23, "at_time_sec": 52.1}
```

### `ping`

Emitted every 20 s on otherwise-idle streams. Keeps NAT and reverse
proxies from dropping the long-held connection; the client ignores the
payload.

```
event: ping
data: {}
```

### `eof`

Terminal event for replay-only streams (`?session=<past>`). Client
should close the EventSource afterward; the server will have already
closed its end.

```
event: eof
data: {"session_id": "01HV…"}
```

## Replay / resume semantics

- The backend keeps an in-memory ring buffer of the current session's
  events (sized to handle ~10 000 strokes — ample for any single row).
- Completed sessions are served from storage for replay.
- On reconnect, the client sends `Last-Event-ID`; the backend replays
  all buffered events with `id > Last-Event-ID` before resuming live.
- If the requested id is older than what's buffered (e.g. joining an
  old session through `?since=`), the backend replays from storage.

## Backpressure and errors

- Slow client: the backend drops clients whose per-connection send
  buffer exceeds 1 MiB (≈ 5 000 unacked stroke events). Dropped
  clients reconnect as normal; `Last-Event-ID` ensures correctness.
- Malformed client request: `400` with a JSON error body before the
  stream opens. Once the stream is open, protocol errors close it with
  a best-effort final `event: error` message.
- Server restart: connected clients see the TCP close, `EventSource`
  auto-reconnects with `Last-Event-ID`, replay resumes.

## Client expectations

- Use `new EventSource("/api/v1/stream", {withCredentials: true})`.
- Handle `stroke`, `session_start`, `session_end`, `level_change`,
  `ping`, `eof`, and a generic `error` event.
- Persist `lastEventId` to local storage so cold reloads resume from
  where the view was.
- Treat any `401`/`403` on the SSE `connect` as "re-pair needed"
  and route to the scan screen (FEAT-0002).

## Security

- Stream is same-origin with the PWA; cookie-based auth applies.
- The `rower_id` on `session_start` is informational — which rower the
  session is attributed to is decided by the **backend**, not the
  connecting client, based on the active rower at the time of the
  session's first stroke (see FEAT-0002 for the "active rower" model).
- Per ADR-0005's threat model (attribution, not adversarial defense),
  any paired device on the household LAN can read the stream for the
  active ergo. Intentional.

## Test fixtures

Directory `specs/int/fixtures/sse/` (to be created):

- `short-session.sse` — a replay of the `session-m1` IPM capture
  expressed as an SSE event stream. Regenerated by a small tool from
  the CSV; acts as a golden file for backend unit tests.
- `level-change.sse` — same for `session-m4-level-changes`; verifies
  the `level_change` event emission timing.

## Open questions

- **Event id scheme**: monotonic per session (resets to 0 on
  `session_start`) or monotonic per server lifetime? Per-session is
  simpler for resume; per-server is simpler for ordering across
  sessions. Current spec assumes per-session. Decide during M3.
- **Compression**: enable gzip/br on the event stream? Negligible
  benefit for a ~200 B-per-stroke payload at 0.5 Hz. Leave off.
- **Cross-session reconnect**: if a client was connected during
  session A and reconnects after session B has started, should we
  replay A's tail or only emit B from the start? Default proposal:
  skip A's tail, start B fresh with a `session_start`. Clients showing
  history can refetch A via `?session=<A>`.
- **Write-path events** (e.g. "rower switched active profile while
  rowing"): useful later for attribution edge cases, not v1.
