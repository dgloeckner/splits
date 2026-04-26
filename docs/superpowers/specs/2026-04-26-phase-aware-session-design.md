# Phase-Aware Session: Cooldown End-Flow + Stats/PB Filtering

Date: 2026-04-26
Status: Draft

## Problem

Current behavior:

- A session ends only via explicit "Beenden", idle timeout, or inactivity timeout. Reaching the workout's target distance / time does not end the session, and a configured cooldown segment never causes completion.
- Every stroke from the session contributes to `SessionSummary` totals, samples, and PB candidates — including warmup and cooldown strokes. There is no segment-aware filtering.
- The frontend hero shows machine-absolute distance/time, so a workout with 60 s warmup followed by 2000 m work starts the work portion already at the warmup's distance, with no visible reset.

Desired behavior:

- Cooldown is part of the workout. Session ends after cooldown elapses.
- Only work-phase strokes count toward summary totals and PB candidates. Warmup, rest, and cooldown strokes are excluded everywhere.
- At the warmup→work boundary, the live display hard-resets distance and time to 0 so the user sees a fresh counter for the work portion.
- Workout completion is detected and emitted by the backend (authoritative), not by the client.

## Phase Model

Each stroke maps to exactly one phase based on its machine-absolute `(distance_m, time_sec)` and the workout's expanded segments:

```
warmup | work | rest | cooldown
```

`work` is the only counted phase. All others are ignored for totals, samples, and PB candidates.

Phases are ordered as `[warmup] [work (rest work)*] [cooldown]`. Boundaries are derived from the workout via the existing `expandWorkout` logic (already implemented in the frontend at `web/src/live/segments.ts`); a Go port of the same algorithm runs in the backend.

The cooldown-after-distance bug in `web/src/live/segments.ts` is fixed in passing: when a cooldown follows a distance-based work segment, the cooldown timer's `consumed` is computed from `timeSec - workCompletedAtSec`, where `workCompletedAtSec` is captured the moment the last work segment's distance is reached. The current code hard-codes `consumed = 0`, freezing the cooldown countdown.

## Backend Changes

### Sessionizer (`backend/internal/session/sessionizer.go`)

- On session open with a `workout_id`, load the workout and expand its segments into a phase plan (cached on the session).
- Per incoming stroke, classify the stroke's phase against the plan. Track `workCompletedAtSec` when the final work segment's distance/time target is reached.
- Add a fourth end-trigger to the `Run` select loop: `WorkoutComplete` — fires when `cooldown` phase has elapsed (`stroke.timeSec >= cooldownEndSec`) for workouts that include cooldown, or when the last work segment completes for workouts without cooldown.
- Emit a new SSE event at every phase boundary so the frontend can hard-reset the display authoritatively.
- Sessions without a `workout_id` (free-row) get an implicit single-phase plan of all-`work`. Behavior is identical to today.
- After a session closes via `WorkoutComplete`, the sessionizer reverts to its existing post-end behavior: incoming strokes with no pending `StartSession` are dropped silently. There is no auto-restart on continued rowing — a new session requires the user to navigate to `/workout` and explicitly start.

### Stroke Storage

- New migration `0006_stroke_phase.sql`: add `phase TEXT NOT NULL DEFAULT 'work'` column to `strokes`. The default keeps free-row sessions counting every stroke.
- The DB is reset as part of this rollout (per project owner), so backfill of historical rows is not required.
- The persister writes `phase` per insert from the sessionizer's classification.

### Compaction (`backend/internal/storage/persister.go applySessionEnd`)

- After `LoadSessionStrokes`, filter to a `workStrokes` slice (`phase == 'work'`).
- `ComputeSamples`, `ComputeCandidates`, and the `SessionSummary` aggregation all consume `workStrokes` only.
- `SessionSummary.TotalDistanceM`, `TotalTimeSec`, `TotalStrokes`, `AvgPowerW`, `PeakPowerW`, `AvgSPM`, `AvgDPS`, `AvgPaceSecPer500m`, `SessionCalories` are **work-only**. Ancillary durations `WarmupSec`, `RestSec`, `CooldownSec` are recorded for context but are not part of the totals.
- All strokes (every phase) are still deleted at compaction — the `phase` column is purely transient and exists only to drive filtering.

### PB Candidates (`backend/internal/stats/candidates.go`)

For interval workouts (multiple work segments separated by rest), candidates are computed **per work-segment run** and the best across runs is returned, rather than concatenating all work strokes into one stream. This prevents the distance two-pointer from spanning a rest gap and falsely producing a PB across reps.

For non-interval workouts, the work portion is one contiguous run and the existing two-pointer logic applies unchanged to that run.

Window PBs (60 s power/pace, 30-stroke dps/spi) and consistency CV are computed per work run and the best across runs is selected.

## Frontend Changes

### Display Baseline (`web/src/live/`)

- New hook `usePhaseBaseline()`. Reads `useWorkoutProgress` and the raw stroke. Returns `{ phase, displayDistanceM, displayTimeSec, frozen }`.
  - `warmup`: `displayDistance = 0`, `displayTime = warmupCountdown`.
  - `work`: `displayDistance = stroke.distance_m - workSeg.startDistanceM`, `displayTime = stroke.time_sec - workSeg.startTimeSec`. Hard reset at the warmup→work boundary.
  - `rest`: countdown only; work totals are frozen at their last value (`frozen = true`).
  - `cooldown`: cooldown countdown plus frozen work totals (`frozen = true`).
- `LiveHero` and `TileGrid` consume the baseline values, not the raw stroke.
- `useSegmentTransitions` is extended to subscribe to the backend `phase_change` SSE for the authoritative reset moment, avoiding client/server drift on edge frames.

### End Trigger

- The `useAutoEndOnComplete` hook (added earlier in this branch) is removed. The backend now drives end-of-workout. The frontend receives `session_end` via SSE exactly as it does today, and the existing latch in `web/src/pages/LivePage.tsx` shows `SessionEndedOverlay`.
- The "Beenden" button continues to POST `/api/v1/session/end` for early termination.

## Data Flow

```
PM5 stroke → fdf-ipm → backend sessionizer
                         ├─ classify phase
                         ├─ persist stroke + phase column
                         ├─ broadcast SSE: stroke (phase included)
                         └─ on phase boundary: SSE phase_change

frontend SSE consumer
   ├─ stroke event → reducer updates raw stroke + phase
   ├─ phase_change → reducer updates current phase + baseline anchor
   └─ usePhaseBaseline derives display values

backend session-end conditions (any one):
   ├─ explicit POST /session/end (Beenden)
   ├─ idle timeout
   ├─ inactivity timeout
   └─ NEW: workout complete (cooldown elapsed, or last work seg
                              done if no cooldown configured)
                         ↓
               sessionizer emits SessionEnd
                         ↓
        applySessionEnd transaction:
           1. LoadSessionStrokes
           2. workStrokes = filter phase=='work'
           3. Summary  = aggregate(workStrokes)   // totals work-only
           4. Samples  = bucket(workStrokes)
           5. PBs      = perWorkSegment(workStrokes)
           6. Persist summary_json, delete strokes
                         ↓
               SSE session_end → frontend latch → SessionEndedOverlay
```

## Edge Cases

- **No warmup or no cooldown configured**: phase plan starts directly at work, or work is the last phase. Baseline is 0 from t=0; end fires when work completes.
- **Free-row session (no workout)**: every stroke phase=`work`. Summary and PBs identical to today.
- **User stops mid-warmup**: idle/inactivity timeout fires. Summary built from zero work strokes → all-zero totals. PB candidates empty; persister skips candidate write.
- **Tab close mid-cooldown**: backend keeps running. Cooldown elapses → backend ends the session autonomously. SSE reconnect on revisit shows the summary via the existing latch path.
- **User keeps rowing after cooldown elapsed**: backend has already closed the session. Subsequent strokes have no active session and no pending `StartSession`, so the sessionizer drops them silently. Starting a new session requires the user to navigate to `/workout` and explicitly start.
- **Intervals with one rep**: degenerates to a single work run; per-run PB calculation is identical to non-interval distance/time mode.

## Testing

- Backend `sessionizer_test.go`: phase classification per stroke for each workout mode (distance, time, intervals; with and without warmup/cooldown). `WorkoutComplete` fires at the correct moment. Cooldown-after-distance timer anchors to work-completion `timeSec`.
- Backend `candidates_test.go`: PB candidates exclude warmup, rest, and cooldown strokes. Per-work-segment two-pointer never spans a rest gap.
- Backend `persister_test.go`: summary totals are work-only; ancillary `WarmupSec`/`RestSec`/`CooldownSec` are populated.
- Frontend `usePhaseBaseline.test.tsx`: hard reset at warmup→work, frozen totals during rest and cooldown, phase-change SSE drives the reset moment.
- Frontend `LivePage.test.tsx` regression: `SessionEndedOverlay` still latches once on null→summary and survives a subsequent `session_start`.

## Out of Scope

- PM5 hardware reset command at the warmup→work boundary. The display reset is purely client-side baseline subtraction.
- Recompute of historical PBs against the new filter. The DB is reset as part of this rollout.
- Per-segment / per-rep stat charting in history view. Future work.
