# ADR-0008: Cleanup, Retention, and Derived-Stats Architecture

- **Status**: Proposed
- **Date**: 2026-04-25

## Context

ADR-0004 established SQLite as the single source of truth. ADR-0007
locked the ingest pipeline: events land once, losslessly, in SQLite
and fan out to the live view.

Neither ADR said anything about the *other* end of the data
lifecycle: how does the database stay healthy when it's still
running a year from now? FEAT-0009 now introduces user-visible
cleanup (soft delete, hard delete, stroke compaction), and FEAT-0010
adds a full achievement system (distance PBs, window PBs,
consistency, volume milestones, per-workout PBs) whose rows
*reference* sessions and *embed snapshots* from them.

The two features interact tightly:

- A cleanup operation invalidates or removes rows that an
  achievement may still point at.
- An achievement backfill must re-scan sessions, which may have been
  stroke-compacted.
- Future features (goals — FEAT-0005; trends — FEAT-0003a) are
  further consumers of the same derived-stats infrastructure.

Left unspecified, each feature ends up with its own ad-hoc "update
derived thing after X happens" hook, and the first time a soft-delete
leaves an orphan PB on the Profil screen we lose trust in the data.
This ADR sets the architectural rules the two FEATs must follow, so
"cleanup happened" and "derived stats are correct" cannot drift.

## Options considered

### Option A — Event-sourced derived stats

Append every session state change to a log table. Derived stats
(PBs, lifetime) subscribe to the log and mutate incrementally:
on delete, undo the contribution; on create, apply it.

Pros: Incremental updates are cheap. Audit trail is free.

Cons: Incremental updates to PBs are wrong. When the current PB is
deleted, "undo the contribution" does **not** give you the new PB —
you have to re-scan all remaining sessions to find it anyway. So the
complexity of an event-sourced pipeline buys nothing over
full-recompute for the operations that actually matter, while
costing us a log table plus replay logic plus correctness paranoia.

### Option B — Incremental bookkeeping per derived stat

Maintain a counter (lifetime distance) and update it inline: `+Δ`
on create, `-Δ` on delete. Keep PB tables and update when the new
session's effort beats the active.

Pros: O(1) per mutation.

Cons:
- PB deletion still needs a scan (see Option A).
- Counter drift is possible across bugs and partial failures; no
  cheap way to validate.
- Compaction would need a separate code path (strokes are gone,
  totals stay — but the counter never used strokes).
- Tangled: every future consumer of derived stats has to opt in to
  this custom update protocol.

### Option C — Full-recompute on every session change

One function: `on_session_change(rower_id, session_id, change)`.
Every lifecycle transition (created, restored, soft-deleted,
hard-deleted, compacted) funnels through it. The function
recomputes the derived tables from whatever is currently live.

Pros:
- Correctness by construction. "The derived tables equal what you
  would get from a cold recompute" is an invariant, not a wish.
- Cheap to validate: the nightly sweep (FEAT-0009) runs a sum
  query and compares.
- Cleanup operations already have to scan anyway to find the new
  PB; doing the whole recompute is the same shape of work.
- New derived consumers (goals, trends, future analytics) just add
  a branch inside `on_session_change`; no new event plumbing.

Cons:
- Worst case is O(sessions × metrics) per change. Needs
  measurement. Mitigation: bounded by household scale (hundreds to
  low-thousands of sessions), and the fallback is a background
  goroutine with UI feedback — not architectural rework.

## Decision

**Option C — single `on_session_change` recompute hook, snapshot
fields on every derived row.**

Three architectural anchors:

### 1. Per-stroke data is ephemeral; aggregates and achievements are forever

The `strokes` table is **working memory for the open session**, not
an archive. The session-end pipeline (FEAT-0009 Mode 0) computes
everything we ever want to keep — `summary_json` including a
downsampled chart series, achievements via `on_session_change`, and
the lifetime-stats refresh — and then deletes the strokes in the
same transaction.

State machine:

```
open (strokes present) ──session_end──> active (no strokes, full summary)
                                              │
                                              └──user_confirmed_delete──> gone
```

Three states only: `open`, `active`, `gone`. No soft-delete, no
trash, no restore, no time-based compaction. Compaction is part of
`session_end`. Delete is immediate after user confirmation.

### 2. Derived stats use full recompute, never incremental bookkeeping

`on_session_change` is the single entry point. Every handler that
mutates a session's lifecycle state calls it, inside the same
transaction as the mutation. No handler is allowed to skip it —
FEAT-0009 encodes this as a non-HTTP internal function precisely so
it cannot be forgotten.

Recompute scope per change:

| Change         | Recompute                                         |
|----------------|---------------------------------------------------|
| `created`      | Incremental update is permitted here because the   |
|                | old actives still win (unique index catches        |
|                | regression). Full recompute is the equivalent      |
|                | fallback and also acceptable.                      |
| `restored`     | Same as created.                                   |
| `soft_deleted` | Invalidate affected rows; full recompute.          |
| `hard_deleted` | Delete affected rows; full recompute.              |
(There is no separate `compacted` change type — compaction is part
of `created`, atomic with the session_end transaction. The enum in
FEAT-0010's `OnSessionChange` keeps a `compacted` value reserved
for the boot-time janitor's repair path; in steady state it never
fires.)

The invariant: after any `on_session_change` returns, a cold
recompute from an empty derived-tables state would produce the
same actives.

### 3. Derived rows carry snapshot fields

Every derived row (PB, milestone, lifetime cache) stores the
source-visible values it needs to render:

- `source_session_started_at`
- the achievement's value itself (`time_sec`, `value`, etc.)
- `achieved_at` (the wall-clock time the PB was confirmed)

Consequence: rendering the Profil-PB grid, the Historie ribbon, or
the Home milestone tile **never** requires a join back to
`strokes`. A compacted session (no strokes left) renders its PBs
intact. A soft-deleted session's invalidated PB renders its
historical value with the correct date. Aggregation lives on the
same page as consumption.

## Consequences

- **New internal contract.** `on_session_change(rower_id,
  session_id, change_type)` becomes part of the backend's public
  internal API. Every mutation path (soft delete, restore, hard
  delete, compaction, new session creation in the persister) must
  call it. Reviews flag handlers that mutate `sessions` without
  calling it.
- **One recompute module.** All six PB/achievement computations
  (distance, window, consistency-intra, consistency-streak,
  volume, workout) live inside `internal/stats/` (or similar). They
  share the same "read live sessions, produce actives" shape, and
  are individually testable.
- **No silent drift.** The daily recompute sweep (FEAT-0009 job 3)
  sums `(rower_id, total_distance_m)` across non-deleted sessions
  and compares with `rower_lifetime_stats`. Mismatch → warning log,
  not auto-correct: drift means a `on_session_change` caller is
  missing, which is a bug.
- **Cleanup operations are cheap in the common case.** Compaction
  is part of session_end (one DELETE on strokes for the just-ended
  session). Soft delete is a single UPDATE plus a bounded
  recompute. Only the daily purge touches multiple sessions at
  once — batched.
- **Backfill on migration.** Introducing FEAT-0010 requires a
  one-shot full recompute per rower, gated on a migration
  sentinel. ADR-0004's "migrations apply at startup" already
  covers this; recompute is just the migration's payload.
- **Performance ceiling.** At household scale (≤ a few thousand
  sessions per rower) full recompute per change is sub-second.
  When it isn't — either because the data grew unexpectedly or
  because a new metric with an expensive window landed — the
  mitigation is a background goroutine with a sequence number
  that the UI polls. No architectural rework needed.
- **No event-sourced state for derived stats.** We explicitly do
  **not** add a session-events log table for replay. SQLite
  history is what you can reconstruct by scanning current
  sessions. If a future requirement ("show me what my PBs were on
  2025-01-01") demands replay, that is a new feature with its own
  schema — do not retrofit.
- **Compaction is irreversible and immediate.** A session that has
  ended has no `strokes` rows; per-stroke detail is gone the moment
  the session closes. This is deliberate — SQLite stays bounded by
  rower count and session count, not by stroke count. Past-session
  charts read the downsampled series in `summary_json.samples`.
- **No admin role.** The household trusts every rower; any rower
  can see and trigger any cleanup action. If a future deployment
  context demands isolation, that is a new ADR.
- **Tab close ≠ session end.** The Live page must support
  re-attach via `GET /session/active` so a dropped connection
  doesn't fragment a row. Sessionizer keeps the open-session
  snapshot in memory across client disconnects.
- **References.** FEAT-0009 and FEAT-0010 depend on this ADR.
  FEAT-0003a (PB-badge), FEAT-0004 (PB section, now superseded by
  FEAT-0010), and FEAT-0001a (home milestone tile) consume the
  derived data but do not need to know how it is maintained.
  ADR-0004 remains the record of *where* data lives; this ADR
  records *how it evolves*.
