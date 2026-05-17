# PRD-0018: Time-mode workout PB (`pb_workout` candidate emission)

Status: ready-for-agent

- **Owner**: @gloeckner
- **Depends on**: FEAT-0010 (achievements-and-pbs), ADR-0011
  (replay-grade-persistence-and-windowed-split)
- **Date**: 2026-05-17

## Problem Statement

A rower who completes structured time-mode workouts (e.g. "row 20 minutes
as hard as you can") has no personal best to chase. They open the PB list
and see distance-PBs and (after a race) race-completion times, but
nothing about how far they covered in a fixed time. The pipeline for
tracking this — `pb_workout` — exists end-to-end in the schema and
recompute code, but the persister never emits a candidate, so the table
is empty for every rower for every session. Half the value proposition
of structured time-mode workouts (chase your past self) is silently
missing.

## Solution

When a rower finishes a time-mode workout (`mode='time'`, e.g.
`{seconds: 1200}`) and the work phase ran to completion, the backend
emits a `WorkoutCandidate` carrying the work-phase distance covered.
The existing recompute pipeline projects candidates into `pb_workout`
keyed on `shape_hash`, so subsequent sessions of the same shape are
ranked against past attempts. A backfill pass over historical time-mode
sessions ensures the rower's first post-deploy time-mode workout is
ranked against their actual history, not treated as a phantom "first
attempt = PB".

Race and distance modes are **not** in scope: per CONTEXT.md §PB-leader
their PB is sourced directly from `pb_distance(shape_distance)`, which
already records the same value. Intervals mode is **not** in scope:
interval shapes are hard to compare even within themselves and need a
separate PB surface designed alongside the cross-shape display question.

## User Stories

1. As a rower, I want to see a "20-minute distance" PB after I complete a
   `{seconds: 1200}` workout, so that I have a personal best to chase on
   future time-mode workouts.
2. As a rower, I want my time-mode PB to reflect only the work phase of
   the workout, so that warmup and cooldown don't dilute the number I
   compare to.
3. As a rower, I want my time-mode PB to be set only when I completed
   the prescribed duration, so that an aborted 5-of-20-minute attempt
   doesn't pollute my PB list.
4. As a rower with a history of time-mode workouts before this feature
   ships, I want my PB list to reflect my actual best historical
   performance, so that the day this feature lands my PBs are honest
   rather than reset.
5. As a rower, I want my 20-minute PB and my 30-minute PB tracked
   separately, so that one shape's record doesn't shadow another's.
6. As a rower, I want my time-mode PB to update only when I cover more
   distance than my previous best, so that the PB number means what it
   says.
7. As a rower, I want a previous PB-value preserved on each PB row
   (`previous_value`), so that the UI can show "+38m over previous PB".
8. As a rower, I want a deleted session's contribution to my time-mode
   PB to be invalidated, so that deleting a session that set a PB
   correctly demotes me to my next-best historical attempt.
9. As a rower who races, I want race results and distance-PB results
   unchanged by this work, so that no existing surface regresses.
10. As a rower running an interval workout, I want no surprise PB row
    appearing for the intervals shape, so that the PB list reflects only
    the workouts we've decided to rank.
11. As a developer maintaining this codebase, I want the candidate
    computation to live in a small pure function so that the gating
    rules (mode, completion, phase filtering) are unit-testable in
    isolation from the SQLite-backed persister.
12. As a developer, I want the backfill to be idempotent so that
    re-running it (e.g. after a partial failure) does not duplicate
    candidates or corrupt the recompute output.
13. As a developer, I want the backfill to skip very old sessions whose
    strokes have been hard-deleted (FEAT-0009 path) by falling back to
    `summary.TotalDistanceM` and the workout's prescribed duration when
    a phase-tagged stroke list is unavailable.

## Implementation Decisions

### Scope

- **In scope:** time mode (`mode='time'`).
- **Out of scope:** race, distance, intervals, just_row. Race and
  distance are sourced from `pb_distance` per CONTEXT.md §PB-leader.
  Intervals is a separate piece of work (cross-shape comparison UX
  must be designed first).

### `ComputeWorkoutCandidate` — new pure function in `backend/internal/stats`

A deep module encapsulating all of the candidate-emission rules. Input:
the attached workout (mode, params, warmup/cooldown), the session
summary, and the session's full stroke list with phase tags. Output:
`*WorkoutCandidate` or `nil`.

Encapsulated rules:

- **Mode gate:** returns `nil` for any mode other than `time`.
- **Completion gate:** returns `nil` if the work phase did not run to
  the prescribed duration (`params.Time.Seconds`). Completion is
  measured by comparing the last work-phase stroke's elapsed time
  against the prescribed duration. Mirrors the §Stale-open
  "competition unit either witnessed its own finish or did not happen"
  rule.
- **Value extraction:** returns
  `WorkoutCandidate{ShapeHash, Mode: "time", ValueKind: "distance_m", Value: work-phase distance covered}`.
  Work-phase distance is the cumulative `DistanceM` of the last
  work-phase stroke minus that of the first work-phase stroke (i.e.
  warmup distance is excluded).

The persister becomes a one-line caller:
`summary.PBCandidates.Workout = stats.ComputeWorkoutCandidate(workout, summary, strokes)`.

### Persister wiring in `backend/internal/storage/persister.go`

Inside the `session_end` handler, after `ComputeCandidates`, load the
attached workout row and call `ComputeWorkoutCandidate`. The existing
INSERT path in `storage/queries.go` already handles a non-nil
`WorkoutCandidate`; the existing `stats.OnSessionChange` already
triggers the recompute that projects into `pb_workout`. No schema
change, no new index.

### `BackfillWorkoutCandidates` — new one-shot in `backend/internal/stats`

A one-time migration run at app startup, guarded by a
`schema_migrations` marker so it executes exactly once per
deployment. Walks historical sessions where `workout.mode='time'` and
no row exists in `session_pb_workout_candidate` for the session_id.
For each: loads the workout + strokes, calls `ComputeWorkoutCandidate`,
inserts when non-nil, accumulates affected rower IDs, then calls
`OnSessionChange` per distinct rower to project into `pb_workout`.

**Stroke-availability fallback:** for sessions whose strokes were
hard-deleted (FEAT-0009 path), the function falls back to
`summary.TotalDistanceM` and `workout.params.Time.Seconds` as a proxy.
The fallback is opt-in per session (recorded on the candidate row) so
future reconciliation logic can revisit if needed.

**Idempotency:** keyed on `session_id` (the candidate table's primary
key). Re-running the backfill is a no-op for sessions already
processed.

### CONTEXT.md update

Already captured in the grill — `§PB-leader` now states that
`pb_workout` is reserved for time mode and explains why race and
distance modes do not emit a candidate (`ShapeHash` collapse +
`pb_distance` already records the same value).

### What does NOT change

- The `pb_workout` table schema is unchanged.
- The recompute logic in `stats/recompute.go` is unchanged.
- Downstream readers (`api/pbs.go`, `api/race_opponents.go`,
  `storage/race_result.go`, `storage/reads.go`) are unchanged —
  they already query `pb_workout` and gracefully handle empty results.
- Session deletion handling is unchanged — the existing
  `api/sessions.go` `DELETE FROM pb_workout WHERE source_session_id = ?`
  path already invalidates contributions.

## Testing Decisions

### What makes a good test in this work

Tests should observe external behavior: given a workout shape, a
session summary, and a stroke list, does `ComputeWorkoutCandidate`
return the expected candidate (or nil)? Tests should *not* assert
internal field traversals, helper-function call counts, or the
particular SQL the recompute emits. Stroke lists in tests are
synthetic and minimal — just enough to exercise the gate being
tested.

### Modules to test

**`ComputeWorkoutCandidate` (heavy unit coverage):**

- Returns nil for `mode='race'`, `'distance'`, `'intervals'`, `'just_row'`
- Returns nil when work phase elapsed < prescribed duration (partial completion)
- Returns nil when there are zero work-phase strokes
- Returns a candidate with `ValueKind='distance_m'` for a completed
  time-mode session, `Value` = work-phase distance only (warmup
  distance excluded)
- Returns a candidate even when the session continued past the
  prescribed duration into cooldown — value is the work-phase
  distance at the moment of work→cooldown transition, not the
  session total
- Returns a candidate when the work-phase elapsed exactly equals the
  prescribed duration (no off-by-one)
- `ShapeHash` on the emitted candidate matches the workout's
  `shape_hash`

**`BackfillWorkoutCandidates` (integration coverage against seeded SQLite):**

- Idempotent: running twice produces the same `pb_workout` state as
  running once
- Skips sessions that already have a row in
  `session_pb_workout_candidate`
- Honors the completion gate (a historical aborted time-mode
  session inserts no candidate)
- Stroke-fallback path: for a session with no strokes but a valid
  `summary.TotalDistanceM`, synthesizes a candidate using the
  prescribed duration as the assumed work-phase elapsed
- Triggers exactly one `OnSessionChange` per affected rower, not
  per affected session
- After backfill, `pb_workout` for an affected rower reflects the
  best historical candidate, with `previous_value` set on the row
  when at least two distinct historical values were observed

**Persister wiring:** covered indirectly by the existing
`persister_test.go` once the new function call lands. No new
persister-level test is required for the one-line call site; the
gating logic lives in `ComputeWorkoutCandidate` and is tested there.

### Prior art

- `backend/internal/stats/candidates_test.go` — pattern for testing
  candidate-emission functions against synthetic stroke lists.
- `backend/internal/stats/recompute_test.go` — pattern for
  integration-style tests against a seeded SQLite, covering the
  recompute path that this work's candidates flow into.
- `backend/internal/storage/persister_test.go` — pattern for end-to-end
  `session_end` coverage; the new candidate will appear in
  `summary.PBCandidates.Workout` here once wired.

## Out of Scope

- **Intervals mode `pb_workout` candidate emission.** Deferred to a
  separate piece of work that designs the within-shape PB definition
  alongside the cross-shape display UX.
- **Race and distance mode candidate emission.** Per CONTEXT.md
  §PB-leader these modes are sourced directly from `pb_distance`.
- **Tolerance for "fully completed".** Strict equality on the
  completion gate.
- **PB-list UI changes.** The existing `api/pbs.go` PB-list endpoint
  already returns `pb_workout` rows; the existing UI already renders
  them.
- **New `pb_workout` columns or schema migration** beyond the
  one-shot backfill marker.

## Further Notes

- The five other decisions from the same grill series (race-surface
  freeze at finish horn, post-horn strokes as Cooldown, explicit
  `Fertig` affordance, boot-time session reconciliation, removal of
  `Paddelst aus...`) are scoped to a separate PRD (PRD-0019).
- The `WorkoutCandidate` struct and the comment `"filled by the
  persister when the session is attached to a workout"` in
  `stats/candidates.go` were a planning artifact from FEAT-0010 that
  never landed an implementation. This work closes that loop for the
  one mode where the value is meaningful and well-defined.
