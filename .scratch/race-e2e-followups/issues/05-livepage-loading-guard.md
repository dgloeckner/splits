# 0017-05 — LivePage loading guard: don't render the non-race branch while the workout query is loading

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0017](../PRD.md)
- **Surfaced by**: [PRD-0016 / 0016-05](../../e2e-automation/issues/05-canonical-happy-path.md) knock-on investigation (2026-05-14)

## What to build

While `LivePage` waits for `useWorkoutProgress()` to resolve the
active workout, `workout?.mode` is `undefined`, so the page renders
the **non-race branch** transiently — including the `SessionEndedOverlay`
container and its mounting context. Once the workout query resolves
and `isRace` flips to `true`, the early-return fires and the race
branch takes over.

This transient render is normally harmless (no `latched` state means
nothing visible). But it can leak state — instrumented reproduction
during the 0017-03 investigation showed the page snapshot occasionally
containing BOTH the `RaceFlow`'s `RacePostScreen` AND the non-race
`SessionEndedOverlay` simultaneously after session_end. The exact
mechanism is unclear; suspected interaction between React reconciliation
on branch changes and the latched-summary `useState`.

The cleanest fix is to gate the entire render on the workout query's
loaded state: while `workoutQ.isLoading` or `workout === undefined`,
render a minimal `LoadingState` (or null) — never the non-race
content tree.

This issue is **possibly redundant after [0017-03](03-session-finalized-event.md)
lands** (the race summary then arrives correctly and `SessionEndedOverlay`
wouldn't render in race mode regardless). File anyway so the guard is
explicit and a future change to the workout-load flow can't reintroduce
the transient-branch issue.

## Acceptance criteria

- [ ] `LivePage` does not render the non-race content tree while the workout query is loading.
- [ ] During the loading window, a minimal `LoadingState` (or `null`) renders in place of the full page.
- [ ] Once the workout query resolves, `LivePage` renders the correct branch (race or non-race) based on `workout.mode`.
- [ ] Component test asserts: with `workoutQ.isLoading === true`, neither `RaceFlow` nor `SessionEndedOverlay` is in the DOM; once loading resolves to `mode === 'race'`, `RaceFlow` mounts.
- [ ] PRD-0016 / 0016-05 happy-path E2E spec's page snapshot at failure (if it fails) no longer shows both `RaceFlow` content AND `SessionEndedOverlay` co-existing.
- [ ] No flash of unstyled content for the rower: the loading state is brief and visually unobtrusive.

## E2E walkthrough

Same scenario as PRD-0016 / 0016-05; this issue does not change the
walkthrough but tightens its spot-checks.

## E2E spot-checks

- After navigating to `/live`, only one of `RaceFlow` / `SessionEndedOverlay` is ever in the DOM at a time.

## Blocked by

None — independent. Recommend landing after 0017-03 so the redundancy can be assessed in context (if 0017-03 alone closes the visible bug, 0017-05 becomes a pure defensive guard rather than a fix for a user-visible issue).
