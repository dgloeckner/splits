# ADR-0007: Lossless Event Ingestion with Decoupled Processing

- **Status**: Accepted (amended 2026-04-19 — see Amendment)
- **Date**: 2026-04-19

## Context

The backend is the only process with access to the IPM serial link
(INT-0001). Every A8 stroke message it reads is the *sole* record of
that stroke — the hardware will not retransmit. Losing an event means
permanently corrupting a session's distance, power, and stroke count.

**SQLite is the source of truth for all rowing statistics** (ADR-0004).
Every ingested event must land there. The SSE feed (INT-0002) is a
latency-optimized view of the same stream, not an alternate canonical
channel: if the broadcaster delivers an event that never made it to
SQLite, reconnecting clients and session history would diverge from
what the live view showed.

Downstream of the serial read sits work that can be slow or fail:

- SQLite writes (disk fsync, lock contention with a replay query).
- Derived metric computation (FEAT-0007 Tier-2/Tier-3).
- SSE fan-out to N connected clients (INT-0002), any of which may be
  slow, wedged, or momentarily disconnected.
- Future additions: export, cloud sync, analytics.

If any of those ran inline with the serial read loop, a single slow
client, a momentary fsync stall, or a transient panic in metric code
would back-pressure the serial reader, overflow the OS tty buffer, and
drop strokes. That is unacceptable.

Event rate is modest (~0.5 Hz during rowing, bursts at session
transitions), so the cost of a queue is negligible compared to the
correctness it buys.

Prior decisions:
- ADR-0003 — Go backend. Go channels + goroutines are the natural
  primitive for this.
- ADR-0004 — SQLite is the durable store; writes may block briefly.
- INT-0002 — SSE stream with replay-on-reconnect from an in-memory
  ring buffer.

## Options considered

### Option A — Inline processing in the serial reader

Read a line, parse, persist, fan out, loop.

Pros: Simplest code; no concurrency.

Cons: Any slow consumer stalls the reader. Serial buffer overflow =
lost strokes. A single misbehaving client breaks ingestion for
everyone. Disqualifying.

### Option B — Bounded in-memory queue, one producer + many consumers

Serial reader is the sole producer. Its only job: read a line, parse
into a typed event, push onto an in-process channel. That loop does
no I/O beyond the serial read.

Consumers run in **parallel** goroutines, each with their own channel.
The dispatcher copies each event to every consumer channel at once —
it does not wait for the persister to finish before handing the event
to the broadcaster, so live-view latency is not gated on disk I/O:

- **Persister** — appends to SQLite; this is the canonical write that
  makes the event durable. On error, retries with backoff and keeps
  draining so transient disk issues don't block newer events from
  being persisted once the issue clears.
- **SSE broadcaster** — fans events out to connected clients in
  parallel with the persister; slow clients are dropped (INT-0002
  backpressure rule), not propagated.
- **Replay buffer** — the ring buffer INT-0002 already specifies,
  used for short-window reconnect replay before SQLite is consulted.

The broadcaster and persister are peers, not a pipeline. This is
deliberate: latency-sensitive consumers do not pay the tail latency of
durable consumers.

Consumer channels are bounded; if one fills, *that consumer's* events
are dropped or the consumer is restarted — the ingest loop is never
blocked. The persister's channel is sized generously and it never
drops; only latency-tolerant consumers (broadcaster per-client) have a
drop policy.

Pros: Reader is never blocked by downstream failures. Each consumer's
failure mode is isolated. Natural fit for Go. Easy to test
(fixture-driven producer, inspectable consumers).

Cons: More moving parts than Option A. Bounded queues force an
explicit policy per consumer for what to do when full.

### Option C — External message broker (Redis Streams, NATS, Kafka)

Pros: Durable queue; survives process restarts.

Cons: Violates the "no mandatory external dependencies" constraint
(ADR-0001/0004). Adds operational surface for a single-process,
single-ergo household app. Overkill.

### Option D — On-disk queue (SQLite WAL table, embedded BadgerDB)

Pros: Survives a backend crash mid-session.

Cons: The serial reader now depends on disk writes again — the exact
coupling we're trying to break. Crash-during-session is handled
well enough by "next connect re-reads totals from IPM via `O`" plus
the fact that the IPM keeps counting. Not worth the complexity.

## Decision

**Option B** — bounded in-memory queue, one producer goroutine for the
serial reader, independent consumer goroutines for persistence, SSE
fan-out, and the replay buffer.

Guarantees, in priority order:

1. **No stroke is ever dropped at ingest.** The serial reader's only
   blocking operation is the serial read itself. Parsing is pure; the
   push onto the ingest channel uses a buffer sized for worst-case
   bursts (target: ≥ 256 events, ~8 minutes at stroke cadence). If
   the ingest channel ever fills, that is a bug and the backend logs
   loudly; we do not silently drop.
2. **Every event reaches SQLite.** The persister is the canonical
   sink; it has no drop policy. Past-session queries (FEAT-0003) and
   statistics (FEAT-0004) read from SQLite, never from in-memory
   state.
3. **Live-view latency is independent of disk latency.** Persister
   and broadcaster receive each event in parallel, not in series. A
   slow `fsync` does not delay the current stroke reaching connected
   clients.
4. **Downstream failures do not propagate upstream.** A wedged
   persister, a slow client, or a panicking metric computation
   affects only its own consumer goroutine.
5. **Each consumer has an explicit overflow policy.** Persister:
   never drop, retry with backoff, surface errors to ops log.
   Broadcaster per-client: drop the client (INT-0002 rule). Replay
   buffer: drop oldest (ring).

## Consequences

- The ingest pipeline is a named module (`backend/ingest/`) with its
  own tests. Fixtures from `specs/int/fixtures/` drive the producer
  directly in unit tests — no hardware needed.
- Consumers register with the dispatcher at startup; adding a new
  consumer (e.g. export, analytics) does not touch the serial reader.
- The persister owns the "session boundary" logic (idle timeout,
  `session_start`/`session_end` derivation per INT-0002). The serial
  reader stays dumb: parse and push.
- Observability: each channel exposes depth + drop counters via a
  `/debug/ingest` endpoint. If the ingest channel ever reports > 0
  "would-block" events, we have a real bug to fix — that counter is
  the correctness canary.
- Backend crash mid-session still loses the in-memory queue contents
  and whatever the persister hadn't yet fsynced. Acceptable: the IPM
  keeps counting, the next connect re-reads totals (`O`), and the
  user sees a small gap rather than wrong data. If crash-tolerance
  across sessions becomes a requirement, revisit with Option D.
- Graceful shutdown: on SIGTERM the serial reader stops first, then
  consumers drain their channels before exit. Clients see a normal
  SSE disconnect and resume via `Last-Event-ID` (INT-0002).

## Amendment (2026-04-19) — sessionizer owns boundary detection

The original decision placed session-boundary logic ("idle timeout,
`session_start`/`session_end` derivation") inside the persister. That
made sense in isolation, but the SSE broadcaster (INT-0002) must emit
the *same* `session_start` / `session_end` events it sends to SQLite,
and those events need identical ids and payloads across both sinks.
Duplicating the FSM in two consumers risked drift between the live
view and stored history.

**Amended pipeline shape**: a dedicated `sessionizer` stage sits
*upstream* of the dispatcher. It owns the idle-timeout FSM,
synthesises `session_start` / `session_end` events, computes Tier-2
metrics (FEAT-0007) on each stroke, and stamps every event with a
lifetime-monotonic `uint64` id. The dispatcher then fans these
already-enriched events to the persister, broadcaster, and ring buffer
in parallel.

The persister becomes "boring": write what you're told, one statement
per event. The broadcaster reads the same enriched event. Both see
the same ids. The correctness invariant (stored history cannot
diverge from what the live view showed) is upheld by construction.

All other guarantees in this ADR stand unchanged: the producer is
still the sole thing reading serial; channels are still bounded; the
persister still has no drop policy; the broadcaster still drops slow
clients, not events; `/debug/ingest` is still the correctness canary.

Full glue (stage types, channel sizes, shutdown order, config) lives
in [ARCH-0001](../arch/0001-backend-pipeline.md).
