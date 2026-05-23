# 0019-07 — Schnitt: race-average split on FinishOverlay

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0019](../PRD.md)

## What to build

Today the FinishOverlay shows a value labeled "Split" computed as the
last-segment split (`(500 × (cross.t - prev.t)) / (cross.dist -
prev.dist)`). The frozen StatBar above shows a different value also
labeled "Split" (the IPM's instantaneous `pace_sec_per_500m` at the
cross stroke). Two different numbers, same word, same screen, same
moment — observed in E2E captures (StatBar `2:16` vs FinishOverlay
`2:11.9`).

Per CONTEXT.md `§Race average split (Schnitt)` (added in the post-E2E
grill), the FinishOverlay should show the **race-average split**:
`(500 × race_time) / race_distance`. This is the universally
meaningful summary number — "I rowed this 500 m at a 4:38 Schnitt."
Relabel it **Schnitt** so the two coexisting concepts on the race
finish surface (Schnitt = race summary; Split = pace at the moment)
are clearly distinct.

Drop the last-segment computation in `raceResultLatch.ts`; it's an
esoteric value that's neither what rowers want to remember from
their race nor what the StatBar already shows.

## Acceptance criteria

- [ ] `raceResultLatch.computeRaceResultLatch` returns a
      `finalSplitS` equal to `(500 × finalTimeS) / totalMeters` for
      every race shape (drop the `prev → cross` segment branch).
- [ ] FinishOverlay renders this value under the label **Schnitt**
      (not "Split").
- [ ] StatBar's `data-testid="statbar-split"` cell continues to
      render the cross-stroke instantaneous split unchanged (label
      remains "Split").
- [ ] Existing unit tests for `raceResultLatch` are updated to
      pin the new computation; a regression test asserts a 500 m
      race at 100 s yields `finalSplitS == 250.0`.
- [ ] Existing FinishOverlay tests are updated; the label
      assertion checks for "Schnitt" rather than "Split".
- [ ] No other consumers of `finalSplitS` regress (grep for
      `finalSplitS` and verify each call site).

## E2E walkthrough

Rower completes a 500 m race. FinishOverlay slides in. The header
shows "Ziel!" with "Endzeit", "Schnitt", "vs. Ghost", "vs. PB"
labels. The Schnitt value reads as `(race_time × 500) / 500m` —
i.e. for a 1:38 race the Schnitt is 1:38 × 2 = 3:16. The frozen
StatBar above continues to show its own "Split" cell with the
instantaneous IPM value at the cross stroke; the two numbers are
visibly distinct in label and meaning.

## E2E spot-checks

- `data-testid="finish-split"` (or whatever the FinishOverlay
  testid is for this cell) renders text matching the pattern
  `\d+:\d{2}\.\d`.
- The cell's accessible label / surrounding text contains the
  word "Schnitt" and does NOT contain "Split" as a standalone label.
- `data-testid="statbar-split"` still renders a `\d+:\d{2}` value.
- The two values are mathematically distinct for a non-constant-pace
  race: `Schnitt = race_time × 2` for a 500 m race; `Split` from
  StatBar is whatever the IPM reported at the cross stroke.

## Blocked by

None — can start immediately.
