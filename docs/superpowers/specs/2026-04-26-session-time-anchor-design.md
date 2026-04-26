# Session-Time Anchoring

Date: 2026-04-26
Status: Draft

## Problem

The PM5 / FDF IPM emits absolute `time_sec` and `distance_m` cumulated since machine wake or last reset, not since session start. The sessionizer currently treats those as session-relative and feeds them straight into `PhasePlan.Classify` and into stroke persistence.

If the rower starts rowing before pressing "Start workout", the first stroke arrives with non-zero values. A 30 s pre-roll silently shaves 30 s off the workout's warmup. A 90 s pre-roll skips warmup entirely and starts the user mid-work without warning. Distance leaks the same way: pre-rolled meters consume the warmup distance budget.

Same leak corrupts the persisted strokes (samples chart x-axis starts at the absolute machine time, not 0), and the per-session PB candidate windows operate over the leaked range.

## Goal

Make the session timeline session-relative. When the user presses Start, t=0 / d=0 is the moment the first stroke arrives. Warmup countdown begins from that point, regardless of how long the rower has been rowing on the PM5 beforehand.

When a workout is attached mid-session (free-row → workout), the warmup re-anchors so the user gets a fresh warmup window starting from the attach moment.

## Two-Anchor Model

The sessionizer holds two anchors per session:

1. **Storage anchor** `(D₀, T₀)` — captured at the first stroke after `session_start`. Frozen for the session's lifetime. Every persisted stroke and every SSE-emitted stroke has its `distance_m` / `time_sec` rebased: `f.DistanceM - D₀`, `f.TimeSec - T₀`. Stored stroke rows are session-relative from t=0; samples charts start at 0.

2. **Phase anchor** `(Dp, Tp)` — drives `PhasePlan.Classify`. Initially equal to the storage anchor. **Reset on `workout_attached`**: the next stroke after attach captures `(Dp, Tp)` as its current absolute values, before rebase. `PhasePlan.Classify` then sees `(D - Dp, T - Tp)` so warmup starts fresh from 0 at the attach moment.

For the common case (workout selected before Start, no mid-session attach), the two anchors coincide and the model behaves identically to a single rebase.

## Backend Changes

### `backend/internal/session/sessionizer.go`

`sessionState` gains:

```go
storageAnchorSet      bool
storageAnchorDistance int
storageAnchorTimeSec  float64
phaseAnchorSet        bool
phaseAnchorDistance   int
phaseAnchorTimeSec    float64
```

`onFrame` captures the absolute values, sets anchors on first encounter, then rebases the frame in place before `enrich`:

```go
absDist, absTime := f.DistanceM, f.TimeSec
if !s.session.storageAnchorSet {
    s.session.storageAnchorSet = true
    s.session.storageAnchorDistance = absDist
    s.session.storageAnchorTimeSec  = absTime
}
if !s.session.phaseAnchorSet {
    s.session.phaseAnchorSet = true
    s.session.phaseAnchorDistance = absDist
    s.session.phaseAnchorTimeSec  = absTime
    if s.session.plan != nil { s.session.plan.Reset() }
}
f.DistanceM -= s.session.storageAnchorDistance
f.TimeSec   -= s.session.storageAnchorTimeSec
```

When classifying, subtract the (phase-relative) offset:

```go
phaseD := stroke.DistanceM -
    (s.session.phaseAnchorDistance - s.session.storageAnchorDistance)
phaseT := stroke.TimeSec -
    (s.session.phaseAnchorTimeSec - s.session.storageAnchorTimeSec)
phase, complete := s.session.plan.Classify(phaseD, phaseT)
```

Before any stroke, the offsets are zero — `phaseD` / `phaseT` equal the rebased stroke values.

### `handleAttach` re-anchor

On `workout_attached`:

- Build a new `PhasePlan` from the freshly attached workout (currently the plan is loaded only in `openSessionInternal` from `pendingWorkoutID`; extend to also load on attach).
- Set `phaseAnchorSet = false`. The next stroke captures the new phase anchor.
- Existing storage anchor stays put — the DB stroke timeline remains monotonic.

### `PhasePlan.Reset()`

Add a small method that clears the `crossedAt` map. Called whenever the phase anchor resets, so cooldown anchors re-record against the new origin.

## Edge Cases

- **Free-row session, no workout attached**: storage anchor still applies (DB rebased). Phase plan is `FreeRowPhasePlan` (always work, never completes). No phase reset triggers.
- **Workout selected before Start**: both anchors set on the same first stroke. Identical to a single-anchor rebase.
- **Mid-session workout attach**: phase anchor resets at the next stroke; storage anchor unchanged so the persisted timeline stays monotonic. Strokes persisted before the attach were tagged `phase = "work"` (free-row plan); they remain in the work-only summary totals, which is correct (the rower was in fact working).
- **Pause and resume mid-warmup**: PM5 `time_sec` only advances during rowing, so warmup countdown pauses naturally with the rower.
- **Backend restart with SSE replay**: anchors live in-memory per session. After restart, the sessionizer no longer holds the anchor, but emitted events are already rebased (rebase happens on emit), so replay sends rebased values. New sessions start with fresh anchors.
- **PB candidate ranges**: distance / window two-pointers operate on per-stroke deltas inside a single contiguous run, so the absolute baseline does not affect them. PB outputs are unchanged.
- **Server wall-clock fields**: `event.At` and any timeouts (`IdleTimeout`, `InactivityTimeout`) use server time and are unaffected.

## Migration

No schema change. Existing rows in `strokes` keep whatever values they were inserted with. The plan owner has agreed to reset the DB at deployment to avoid a history with mixed-anchor sessions.

## Testing

- `TestSessionizerRebasesStrokesFromFirstStroke`: frames `(t=30, d=50)`, `(t=35, d=60)` → emitted stroke events have `time_sec=0,5` and `distance_m=0,10`.
- `TestSessionizerWarmupNotSkippedWhenPM5PreCounted`: workout `warmup_sec=60`, distance=100. First frame `(t=120, d=200)` and a few continuing frames. Warmup phase is honored from t=0 (rebased). Without the fix, classification would jump straight to work or cooldown.
- `TestSessionizerReanchorsOnWorkoutAttach`: open free-row session, drive five frames ending at `(t=300, d=600)`. `AttachWorkout` for a workout with `warmup_sec=30`. Next frame `(t=305, d=605)` re-anchors phase. The next several frames classify as warmup (relative time < 30 s). Storage strokes continue numbering from the storage anchor (no negative deltas).
- `TestPhasePlanReset`: classify until a distance segment crosses, then `Reset()`, then classify again — `crossedAt` is cleared and the next crossing returns the segment's phase, not `PhaseDone`.

## Out of Scope

- Sending PM5 hardware reset commands at session start.
- Wall-clock-based warmup countdown (where waiting after Start consumes warmup). PM5 rowing-time is preferred.
- Migrating existing rows to the new anchor model.
