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
      strokes with `userDistanceM > totalMeters`, even though the
      shape declares `cooldown_sec=0`. (The cross stroke at `==
      totalMeters` stays `work` so race totals land exactly on the
      finish line, mirroring the existing distance-shape crossing
      convention; the §Finish horn rule "the instant
      `userDistanceM >= totalMeters`" still holds — the horn fires
      at the cross stroke, which is the last work stroke.)
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

## Comments

**2026-05-17 — implementation note.** AC2 was tightened during
implementation: a literal `≥` reading would have stripped the cross
stroke from work totals, breaking AC4 (`total_distance_m=500`).
Resolved by classifying the cross stroke as `work` and every
subsequent stroke as `cooldown`, mirroring the existing distance-shape
convention. AC2 wording updated above.

**2026-05-17 — strokes-table retention.** The strokes-table
retention AC is verified at the sessionizer/event-stream layer
(post-horn strokes emit with `Phase='cooldown'`). The persister path
that writes to the `strokes` table is untouched (ADR-0011) and
existing persister tests still pass; no additional persister-level
test was added for this single bullet.

**2026-05-17 — race termination.** Race shapes never report
`PhasePlan.Classify(...).complete=true`; termination remains owned by
`EndSession`/idle-timeout per ADR-0009. A one-line comment at the
race early-return in `Classify` documents this.
