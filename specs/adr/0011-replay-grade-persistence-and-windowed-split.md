# ADR-0011: Replay-Grade Stroke Persistence and Windowed Live Split

- **Status**: Accepted (2026-05-10) — supersedes part of ADR-0008
- **Date**: 2026-05-10

## Context

Two issues forced this decision together:

1. **The live "current split" is visibly wrong** vs. the IPM hardware
   display. The on-device console shows a smooth, consistent split;
   the app's split jitters stroke-to-stroke. The 5K *average* is
   correct, so the underlying cumulative numbers are fine — only the
   *current* split is off. Root cause in `session/metrics.go:36`:

   ```go
   PaceSecPer500m(dps, cycleSec) = 500 / dps * cycleSec
   ```

   Both inputs are *single-stroke* values. EMA-smoothing on the
   frontend (`reducer.ts`) inherits the per-stroke noise without
   removing it. The IPM hardware almost certainly uses a sliding
   window; INT-0001 confirms there is no clean current-split field in
   the wire stream, so the hardware computes its own internally.

2. **There is no way to validate fixes**, current or future, against
   captured sessions. ADR-0008 prescribed deleting strokes at
   session-end (`persister.go:DeleteSessionStrokes`); only
   `summary_json.samples` survives compaction. Samples are aggregated
   buckets — sufficient for charting, insufficient for re-running a
   different pace algorithm against the same input.

The two problems are coupled: any new live-split formula needs
validation against ground truth, and ground truth requires that we
*kept* the strokes.

ADR-0008 was scoped around "the live tail must not pile up forever".
The sledgehammer it chose — drop everything at compaction — is wider
than that goal needs to be.

## Options considered

### Option A — Per-stroke instantaneous + harder smoothing

Keep the formula, push EMA alpha lower. Cheap.

Con: still inherits per-stroke noise; trades twitchiness for lag.
Doesn't address validation.

### Option B — Reverse-engineer the hardware formula by capture

Photograph the IPM display with synchronized timestamps; fit a window
function until app matches. No persistence change required.

Con: laborious, not generalisable to other stat questions, doesn't
help future statisticians replay anything else.

### Option C — Replay infrastructure + windowed split (chosen)

Two-pronged:

- **Persistence**: stop deleting strokes at session-end. Rows in
  `strokes` (`distance_m`, `time_sec`, `dps`, `cycle_sec`, `power_w`,
  `phase`, …) are the canonical replay input.
- **Live split**: switch to a 5-second sliding-window pace —
  cumulative metres covered in the last 5 s, divided into 500 m. This
  matches Concept2's well-known behaviour and is the most likely
  shape of FDF's internal calculation.
- **Replay harness**: a `cmd/replay` (or test binary) that loads a
  session's persisted strokes and runs them through the live reducer,
  outputting a CSV of "what was on screen at t=N". Used to compare
  alternative pace formulas against captured sessions before they
  ship.

### Option D — Slim replay table (`stroke_replay`)

Keep just the columns needed for stat-formula replay; drop everything
else at compaction. Halfway between A/B and C on disk cost.

Con: every future stat question that wants a column we dropped is
stuck. Disk cost of (C) is genuinely negligible at this scale.

## Decision

**Option C.** Concretely:

### Persistence

- `DeleteSessionStrokes` is removed from the `applySessionEnd` path.
  Strokes for ended sessions remain in the `strokes` table
  indefinitely.
- The `summary_json.samples` aggregation continues to be written, as
  cheap pre-computed input for the charts. It is no longer the *only*
  surviving artefact — strokes are now the source of truth.
- Disk budget: ~500 strokes/session × 365 sessions/year ≈ 180 k rows
  per rower per year. Each stroke row is small (~80 B with all
  columns); a year is ~15 MB. Nothing for SQLite.
- Hard delete (`FEAT-0009`) of a session continues to remove its
  strokes — privacy/cleanup semantics unchanged.

### Live split (`PaceSecPer500m`)

- Replace the per-stroke extrapolation with a **sliding-window pace**
  computed in the sessionizer. The window *value* is intentionally
  not committed by this ADR: v1 ships with a **provisional 5-second
  window** to be validated against an IPM-display capture corpus once
  the replay harness exists. The value is adjustable in code without
  an ADR change.

  ```text
  window_distance_m = sum of distance covered in last W seconds
  window_time_s     = W    (or actual elapsed if < W s)
  pace_sec_per_500m = 500 / (window_distance_m / window_time_s)
  ```

- **Sparse-window fallback**: when the window contains fewer than
  two completed strokes, the previous displayed value is held rather
  than recomputed. This avoids the split jumping to ∞ during the
  recovery phase of a slow paddle-down or while the rower pauses
  briefly between strokes. The next stroke that lands inside the
  window resumes normal computation.
- **Linear interpolation at the leading edge.** The window boundary
  `t = now − W` will almost always fall *between* two strokes. The
  position at that instant is linearly interpolated between strokes
  `i` and `i+1` on the time axis (same arithmetic that
  `stats/candidates.go:interpTime` and `distpb_interp_test.go` already
  perform for distance-PB candidates). The trailing edge is `now`
  (or the most recent stroke). This makes the live-pace formula
  bit-comparable to the PB-candidate formula and ensures the window
  represents exactly `W` seconds of motion, not "the strokes that
  happened to fall inside the last `W` seconds".
- Frontend EMA can be removed or have its alpha relaxed; the window
  itself is the smoother now.
- Per-stroke `pace_sec_per_500m` field on `StrokePayload` continues to
  exist for backwards compatibility but is recomputed against the
  window, not from `dps × cycleSec`.

### Replay harness

- New tool `cmd/replay` (or Go test binary) that:
  - Takes a `session_id`.
  - Loads strokes in order.
  - Steps them through `session.Sessionizer`.
  - Emits per-stroke "what would be on the live screen" rows
    (paceSecPer500m, EMA values, smoothed metrics).
- Used as a regression substrate when changing any live or derived
  metric formula.

## Consequences

Easier:

- Live split is dramatically more stable, matching hardware
  expectation.
- Every future stat-formula question ("was the SPI tile right?",
  "would this candidate algorithm have produced a 2K PB?") becomes a
  replay run, not a guess.
- Past sessions retroactively gain a windowed split when summaries are
  re-rendered, since the strokes are still there.

Harder / new work:

- ADR-0008's "compact at end" intent is partially superseded. ADR-0008
  is amended: stroke-table compaction at session-end is dropped;
  retention is now indefinite for ended sessions, bounded only by
  hard-delete and by an annual prune ADR if disk ever becomes a
  concern.
- Sessionizer must maintain a small ring buffer of recent strokes for
  the window calculation. Negligible memory.
- Per-stroke `pace_sec_per_500m` semantics change. Anything storing or
  charting that field must be re-rendered (samples re-bucketed) for
  historical sessions to look consistent — or accept a discontinuity
  at the cutover date and rely on replay for retroactive parity.
- The provisional 5-second window is a *starting point*, explicitly
  not blessed by this ADR. The first user-visible split tile under
  the new formula will be wrong by some unknown delta from the IPM
  hardware until a capture-and-fit pass on the replay harness
  produces evidence for the right value. Plan for at least one
  follow-up tuning pass.

## See also

- ADR-0007 — event-ingestion pipeline; strokes-as-events stay
  unchanged.
- ADR-0008 — partially superseded (stroke compaction at session-end).
- ADR-0010 — companion ADR for session lifecycle / resumability.
- FEAT-0007 — rowing metrics catalogue; this changes the *definition*
  of "current split" listed there.
- INT-0001 — IPM serial protocol; documents that current-split is not
  in the wire stream and must be derived host-side.
