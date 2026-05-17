# 0019-01 — Post-horn strokes classified as Cooldown

Status: ready-for-agent

- **Type**: AFK · Backend
- **Parent**: [PRD-0019](../PRD.md)

## What to build

A rower completes a race, then continues paddling for ~100 m of
paddle-down. Today every paddle-down stroke is classified as `work`,
so the persisted session row reports `total_distance_m=603`,
`total_time_sec=163`, `avg_pace=2:09`, `avg_power=429 W` —
contradicting the `500 m / 1:38 / 2:05.0` the rower just saw on the
FinishOverlay.

Make `PhasePlan.Classify` (`backend/internal/session/phaseplan.go`)
classify any race-shape stroke at `userDistanceM ≥ totalMeters` as
`cooldown`, regardless of the workout's declared `cooldown_sec=0`.
The finish horn is itself the implicit Work-to-Cooldown transition.

This rides existing infrastructure: `filterWorkStrokes` already strips
cooldown strokes from race aggregates, so `total_distance_m`,
`total_time_sec`, `avg_power_w`, `avg_spm`, and
`avg_pace_sec_per_500m` collapse to the race proper automatically. The
full stroke history is preserved in the `strokes` table for
replay/audit (ADR-0011) — only the `phase` tag changes for post-horn
strokes.

Domain rule in CONTEXT.md `§Finish horn`: already captured.

## Acceptance criteria

- [ ] For a race shape, `PhasePlan.Classify` returns `work` for
      strokes with `userDistanceM < totalMeters`.
- [ ] For a race shape, `PhasePlan.Classify` returns `cooldown` for
      strokes with `userDistanceM ≥ totalMeters`, even though the
      shape declares `cooldown_sec=0`.
- [ ] For non-race shapes, classification is unchanged (regression
      coverage).
- [ ] After a 500 m race with ~100 m of paddle-down (replay-driven
      integration test), the persisted session row reports
      `total_distance_m=500`, `total_time_sec≈98`, and `avg_*`
      aggregates computed from race-only strokes.
- [ ] `ComputeRaceResult` produces the same race result as before
      this change (regression check; race-time and race-distance
      were already computed independently of phase tagging).
- [ ] Full stroke history including post-horn paddle-down strokes
      remains present in the `strokes` table, with `phase='cooldown'`
      on post-horn rows.

## Blocked by

None — can start immediately.
