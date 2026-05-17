# 0019-02 — Race surface freezes at finish horn

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0019](../PRD.md)

## What to build

After the finish horn fires, the StatBar continues live-updating off
the post-horn stroke stream (showing e.g. `0 m to go, 367 W,
Ghost -10.0s` during paddle-down) and the Canvas keeps interpolating
opponent positions, producing both a visible contradiction with the
FinishOverlay's latched `-22.0s` and a ghost that visibly flies past
during paddle-down (observed: -52 m → +53 m in 60 s).

Introduce a `useRaceFreeze` hook in `web/src/race/` as the single
source of truth for the race surface's render inputs from the finish
horn onward. The hook takes the live `LiveState` and the
`RaceResultLatch` and returns a frozen snapshot of `{ elapsedSec,
userDistanceM, split, watts, spm, ghostGap, pbGap }`. Before the horn
it passes live values through; on the first stroke where
`userDistanceM ≥ totalMeters` it captures the snapshot and returns it
unchanged for the remainder of the session.

`RaceLiveView`'s `StatBar` and `RaceCanvas` consume `useRaceFreeze`
outputs instead of reading from `liveState.stroke?.*` directly.
Opponent positions inside the Canvas are recomputed using the frozen
`elapsedSec` and `userDistanceM`, so ghost and PB-leader sprites
freeze in place mechanically — no separate freeze path needed for
opponents.

`RaceResultLatch` is unchanged; it continues to feed the FinishOverlay.

Domain rule in CONTEXT.md `§Finish horn`: already captured.

## Acceptance criteria

- [ ] `useRaceFreeze` passes live values through before
      `userDistanceM ≥ totalMeters`.
- [ ] On the first stroke crossing the threshold, the hook captures
      a snapshot and returns the same snapshot on every subsequent
      stroke.
- [ ] The frozen `elapsedSec` is the horn-crossing stroke's time, not
      a later post-horn stroke's.
- [ ] Ghost / PB gaps in the StatBar match the FinishOverlay's
      latched values after the horn (no `-10.0s` vs `-22.0s`
      contradiction).
- [ ] The ghost and PB-leader sprites stop moving after the horn
      (no -52 m → +53 m swing during paddle-down).
- [ ] The StatBar's elapsed, distance-to-go, split, watts, and spm
      freeze at the horn-snapshot values.
- [ ] Pre-horn behaviour of `StatBar` and `RaceCanvas` is unchanged
      (regression coverage with a mid-race snapshot).

## E2E walkthrough

Rower opens a 500 m race, taps Bereit, completes the start ceremony,
rows to and past the finish line, then keeps paddling at a low effort
for several post-horn strokes. The FinishOverlay slides in carrying
latched `vs. Ghost / vs. PB` values. While the rower keeps paddling
during paddle-down, the StatBar values do not change; the user, ghost
and PB sprites on the Canvas remain visually anchored at their
finish-horn positions; the FinishOverlay continues to show the same
latched numbers. No second `vs. Ghost` value appears anywhere on
screen.

## E2E spot-checks

- StatBar `data-testid="statbar-vs-ghost"` value is identical at
  finish-horn and after at least two subsequent paddle-down strokes
  have been injected.
- StatBar `data-testid="statbar-vs-ghost"` value equals the
  FinishOverlay `data-testid="finish-gap-ghost"` value after the horn.
- Canvas `data-testid="boat-user"` element is present and at the
  same `left` CSS pixel value at finish-horn and after subsequent
  paddle-down strokes (no drift).
- Canvas `data-testid="boat-ghost"` element does not change `left`
  CSS pixel value across post-horn strokes.
- Pre-horn (mid-race) snapshot: StatBar `data-testid="statbar-elapsed"`
  changes between successive strokes (live behaviour preserved).

## Blocked by

None — can start immediately.

## Comments

**2026-05-17 — implementation note.** Hook signature is
`useRaceFreeze({ liveState, totalMeters, opponents })` rather than the
PRD's nominal `{ liveState, RaceResultLatch }`. The latch doesn't
carry split/watts/spm/distance-left, so the hook needs the live state
+ opponents directly. AC4's cross-component consistency (StatBar gaps
match FinishOverlay's latched gaps) is pinned by a unit test that
compares `useRaceFreeze.ghostGap` against
`computeRaceResultLatch.gaps.vs_ghost` for the same horn-crossing
stroke and opponent curve.

**2026-05-17 — StatBar gained an elapsed cell.** Before this slice
the StatBar showed split / distance-to-go / watts / spm / gaps but
not elapsed time. Per PRD user story 4 and AC6 the StatBar must
freeze "elapsed time, distance-to-go, split, watts and spm" — so
elapsed is now a first-class cell (`data-testid="statbar-elapsed"`),
rendered in both phone and tablet layouts.

**2026-05-17 — optional nits parked.** Code-quality review flagged
four optional improvements (drop unused `frozen` flag or surface it
as DOM data attr; add `statbar-distance` testid; extract shared
stroke fixture; check `web/test-results/.last-run.json` gitignore).
Not blocking; can be picked up in a follow-up polish slice.
