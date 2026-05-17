# PRD-0019: Race-mode finish cleanup

Status: ready-for-agent

- **Owner**: @gloeckner
- **Depends on**: FEAT-0013 (race-mode), FEAT-0014 (race-mode-cleanup),
  ADR-0009 (race excludes warmup/cooldown), ADR-0010
  (session-lifecycle-and-resumability), ADR-0012 (race-mode-non-resumable),
  ADR-0013 (race-canvas-mounts-at-attention)
- **Date**: 2026-05-17

## Problem Statement

A rower completes a 500 m race. The finish horn fires. From that moment
the experience falls apart in five distinct ways:

1. The **StatBar and the Canvas keep running as if the race were still
   on**. The StatBar shows a live "vs. Ghost" gap that contradicts the
   latched gap in the FinishOverlay. The Canvas keeps interpolating
   opponent positions against the rower's still-advancing
   `userDistanceM`, so the ghost visibly flies past during the
   paddle-down (-52 m → +53 m in 60 s observed in real data) and the
   rower's own sprite drifts off-screen.
2. The **session totals in the database include the paddle-down**:
   `total_distance_m=603`, `total_time_sec=163`, `avg_pace=2:09`,
   `avg_power=429 W` — none of which match the `500 m / 1:38 / 2:05.0`
   the rower just saw on the FinishOverlay.
3. There is **no user-actionable way to end the race**. Idle-timeout
   `session_end` is the only exit path. In real testing the rower had
   to kill the app.
4. After killing the app, **the nav stayed locked on reopen**. All
   three bottom tabs read as disabled because `LiveSessionContext`
   rehydrated cached "active workout" state from before the kill, while
   the backend had already finalised the session.
5. The **ambient `Paddelst aus...` label** on the FinishOverlay is
   grammatically broken (2nd-person verb with no pronoun and an
   ellipsis), factually wrong when the rower is reading the overlay
   while sitting still, and implies an unstoppable in-progress phase
   exactly when the rower wants to know how to leave.

## Solution

From the finish horn onward, the race is **over** — and the app must
behave that way. The Canvas and StatBar freeze on the horn's snapshot.
Post-horn strokes are stripped from race aggregates so the database
record matches the result on screen. The FinishOverlay carries an
explicit **Fertig** button that immediately ends the session, with
idle-timeout retained as a passive fallback. The ambient
"Paddelst aus..." label is removed — `Ziel!` and the button speak for
themselves. On app boot, the frontend reconciles its cached
"active workout" state against the backend, so a session the backend
has already finalised never traps the nav.

## User Stories

### Frozen race surface after finish horn

1. As a rower, I want the StatBar's `vs. Ghost` and `vs. PB` numbers
   to match the FinishOverlay's after the finish horn, so that I am
   not shown two contradicting versions of the same fact.
2. As a rower, I want my own sprite to remain visible on the canvas
   after the finish horn, so that I can see where I finished relative
   to the line.
3. As a rower, I want the ghost and PB-leader sprites to stop moving
   after the finish horn, so that I am not visually overtaken during
   my paddle-down by opponents whose race is also already over.
4. As a rower, I want the StatBar's elapsed time, distance-to-go,
   split, watts and spm to freeze at the finish-horn values, so that
   I am not reading nonsense ("0 m to go, 367 W") while drifting.
5. As a rower paddling down past the finish line, I want my sprite to
   stay anchored to the finish line on the canvas rather than
   drifting off the right edge, so that I always have a reference
   for where I am.

### Race aggregates match the FinishOverlay

6. As a rower, I want my 500 m race to appear in Historie with the
   same `500 m / 1:38 / 2:05.0` numbers I saw on the FinishOverlay,
   not the paddle-down-inflated totals, so that one event tells one
   story.
7. As a rower, I want my session's `avg_power`, `avg_spm`, and
   `avg_pace` to reflect the race itself, so that those numbers are
   not diluted by my low-effort drift after the line.
8. As a rower, I want my full stroke history (including paddle-down)
   preserved for replay and audit, so that I do not lose data even
   while my race aggregates are computed cleanly.
9. As a developer looking at session aggregates downstream, I want
   the work/cooldown split reflected in phase tags on the strokes,
   so that I do not need a special-case rule for races.

### Explicit Fertig affordance

10. As a rower, I want a clearly labelled "Fertig" button on the
    FinishOverlay, so that I always have a one-tap exit from the race
    surface, regardless of whether the idle-timeout has fired.
11. As a rower, I want the idle-timeout `session_end` to remain as a
    passive fallback, so that if I walk away without tapping anything
    my session still closes cleanly.
12. As a rower, I want the button labelled "Fertig" (not "Beenden"),
    so that it doesn't read as an abort — the result is already
    latched and there is nothing to wave off.
13. As a rower, I want tapping Fertig to immediately fire
    `session_end`, dismiss the race surface, and return me to Home,
    so that I'm not stuck through any further animation or timeout.

### Boot-time reconciliation

14. As a rower returning to the app after killing it (or any other
    cause of an unclean shutdown), I want the bottom-nav tabs to be
    enabled when the backend says my last session is already ended,
    so that I am not trapped on a locked nav.
15. As a rower who killed the app mid-paddle-down, I want the
    `Frühere Session abschließen?` recovery card to appear if the
    backend still has my session as stale-open, so that I can
    finalise or discard it, exactly as ADR-0010 / ADR-0012 already
    specify.
16. As a rower, I want my locally cached "active workout" state
    silently dropped when the backend has finalised the matching
    session, so that the local cache never overrides the backend's
    view of my session lifecycle.

### Removal of `Paddelst aus...`

17. As a rower reading the FinishOverlay, I want the header to read
    just `Ziel!` and nothing else, so that I'm not presented with a
    grammatically broken status label asserting an action I'm not
    currently performing.
18. As a rower, I want the next-action affordance (the Fertig button)
    to be the only thing on the overlay telling me what to do next,
    so that the interface speaks with one voice rather than two
    contradicting ones.

## Implementation Decisions

### Race surface freezes at finish horn (frontend)

A new **`useRaceFreeze`** hook in `web/src/race/` is the single source
of truth for the race surface's render inputs from the finish horn
onward. It takes the live `LiveState` and the `RaceResultLatch` and
returns a frozen snapshot of `{ elapsedSec, userDistanceM, split,
watts, spm, ghostGap, pbGap }`. Until the horn it passes the live
values through; on the first stroke where `userDistanceM ≥ totalMeters`
it captures the snapshot and returns it unchanged for the remainder
of the session.

`RaceLiveView`'s `StatBar` and `RaceCanvas` both consume `useRaceFreeze`
outputs instead of reading from `liveState.stroke?.*` directly.
Opponent positions inside the Canvas are recomputed using the frozen
`elapsedSec` and `userDistanceM`, so ghost and PB-leader sprites
freeze in place mechanically.

### Post-horn strokes classified as Cooldown (backend)

`backend/internal/session/phaseplan.go` gains a race-specific rule:
for a race shape, any stroke at `userDistanceM ≥ totalMeters` is
classified as `cooldown`, regardless of the workout's declared
`cooldown_sec=0`. The finish horn is itself the implicit Work-to-
Cooldown transition. The knock-on effects ride existing infrastructure:
`filterWorkStrokes` already strips cooldown strokes, so race
aggregates collapse to the race proper automatically. The full stroke
history is preserved (ADR-0011); only the `phase` tag changes for
post-horn rows.

### Explicit Fertig affordance (frontend)

`FinishOverlay` gains an `onFinish` callback prop and renders a
**Fertig** button. The parent wires the callback to the existing
`endSessionQueue` path used by the manual abort flow — same end-point,
different trigger. The button is enabled from the moment the overlay
mounts. The idle-timeout `session_end` path is unchanged.

### Boot-time session reconciliation (frontend)

A new **`useBootReconcile`** hook in `web/src/live/` runs exactly once
when the app boots. It compares the locally cached `LiveSessionContext`
"active workout" state against the backend's view of that session via
the existing session-detail endpoint.

- BE has `ended_at` set → drop cached active-workout state, load
  `summary` from BE, do not surface any recovery card.
- BE has `ended_at IS NULL` matching the cached state → keep cache,
  allow the existing ADR-0010 / ADR-0012 stale-open recovery flow.
- BE has no record of the cached session → drop the cache silently.

`BottomNav` is unchanged — its `workoutActive` derivation already
keys off `state.session?.workout_id && summary === null`.

### Removal of `Paddelst aus...`

Pure implementation polish. Header is just `Ziel!`. CONTEXT.md is
intentionally not modified (absence of an ambient status label is
not a domain term).

### Verification steps

- **Race-mode stale-open recovery card.** Verify with a Playwright
  test that the card renders for a synthesised race-mode stale-open
  session. May be no-op if the surface already works.
- **Player-sprite drift residual.** Re-test the original scenario
  against the merged freeze. Investigate only if drift reproduces.

## Testing Decisions

### What makes a good test in this work

Tests observe rendered output, classified phase tags, and reconciled
state. They do not assert on internal hook implementation details,
React re-render counts, or specific SSE-event ordering. Synthetic
stroke sequences are minimal — just enough to exercise the boundary
each test cares about.

### Modules to test

- **`useRaceFreeze`** (heavy unit): passes through before horn;
  snapshots on first crossing; idempotent on later strokes; frozen
  values seed ghost/PB gap computations.
- **`PhasePlan` race-cooldown** (unit, `phaseplan_test.go`): race
  shape pre-horn = work, post-horn = cooldown; non-race shapes
  unchanged.
- **`useBootReconcile`** (integration with mocked fetch): all three
  BE responses produce the right reconciled state; runs exactly once.
- **`FinishOverlay`** (render): Fertig button renders and invokes
  callback; no `Paddelst aus...` text.
- **End-to-end** (Playwright): full race finish → freeze → Fertig →
  Home with unlocked nav. Separate spec for race-mode stale-open
  recovery card.

### Prior art

- `web/src/race/FinishOverlay.test.tsx` — render-test pattern.
- `web/src/race/raceResultLatch.test.ts` — latch-test pattern for
  immutable post-horn snapshots.
- `web/src/live/usePhaseBaseline.test.tsx` — hook-test pattern for
  derived state across live updates.
- `backend/internal/session/phaseplan*_test.go` — synthetic stroke
  sequence pattern.
- Existing race-flow specs in `web/tests/` and the race-flow UX
  capture spec — end-to-end pattern.

## Out of Scope

- Anything `pb_workout`-related (covered by PRD-0018).
- Changes to `pb_distance` candidate computation.
- Race-result schema changes; `RaceResultLatch` and
  `summary_json.race` are unchanged.
- PB-leader curve source; continues from `pb_distance` per
  CONTEXT.md `§PB-leader`.
- Falschstart and start-ceremony behaviour.
- Race-mode session abort UX (pre-horn); `Abbrechen` unchanged.
- Intervals and time-mode finish behaviour.

## Further Notes

- The five decisions are tightly coupled and ship together. Cutting
  any one in isolation leaves a worse experience than today.
- The two verification steps may turn out to be no-ops. They are
  explicitly listed in the implementation work so they are not
  silently skipped.
- CONTEXT.md has been updated in the grill for `§Finish horn`,
  `§Stale-open session` (boot reconciliation), and `§PB-leader`.
- No new ADR is warranted; ADR-0009, ADR-0010, and ADR-0012 cover
  the load-bearing decisions, and today's calls are sharpenings
  captured in-glossary.
