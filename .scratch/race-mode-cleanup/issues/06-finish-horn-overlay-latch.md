# 0014-06 — Finish horn: `raceResultLatch` + `FinishOverlay`

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0014](../PRD.md)

## What to build

At the instant `userDistanceM >= totalMeters`, latch the race result in
client state and surface a `FinishOverlay` over the canvas. The rower
keeps rowing; the canvas keeps advancing; the latched result does not
recompute. When `session_end` arrives, the overlay expands into the
full `RacePostScreen`.

- `raceResultLatch` (pure helper) — given the user's stroke at the
  cross moment and opponent `distance_m[]` curves, return the immutable
  result: final time, final split, signed gap to each present opponent.
- `FinishOverlay` (component) — slides in from the bottom (~200 ms),
  sits at ~40% viewport height, does not unmount the canvas. Status
  copy: `Paddelst aus...`.
- Wire the `raceLifecycle` reducer's `Finished` state to render the
  overlay; on `session_end`, transition to `Post` and hand off to
  `RacePostScreen`.

## Acceptance criteria

- [ ] At `userDistanceM >= totalMeters` the result is latched and the overlay appears, without unmounting the canvas.
- [ ] Overlay shows final time, final split, signed gap to each present opponent, plus `Paddelst aus...`.
- [ ] After the latch, additional strokes continue advancing the canvas but the displayed result does not change.
- [ ] On `session_end`, the overlay expands into / hands off to the full `RacePostScreen` (pace overlay chart, CTAs).
- [ ] `raceResultLatch` has unit tests covering: cross exactly at a sample, cross between samples, ghost-only / pb-only / both present.
- [ ] Component test drives the reducer to `Finished` and asserts: overlay rendered, canvas still mounted, latched values stable across subsequent strokes.

## Blocked by

- 0014-01 (opponent `distance_m[]` available for gap latch).
- 0014-04 (reducer in place to host `Finished` state).
