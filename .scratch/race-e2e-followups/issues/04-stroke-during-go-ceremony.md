# 0017-04 — First stroke during Ceremony(GO!) transitions Live immediately + processes its distance

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0017](../PRD.md)
- **Surfaced by**: [PRD-0016 / 0016-05](../../e2e-automation/issues/05-canonical-happy-path.md) knock-on investigation (2026-05-14)
- **Related**: CONTEXT.md §Start ceremony

## What to build

The `raceLifecycle` reducer's `stroke` handler currently drops
strokes that arrive during the **GO!** step of the ceremony — no
state transition, no distance accumulation, no `_prevStroke` update.
The Ceremony → Live transition is driven exclusively by the
`tick` handler (rAF loop in `useRaceLifecycle`) when elapsed >=
3*CEREMONY_STEP_MS (4500 ms post-Bereit).

Code today:

```ts
case 'stroke': {
  if (state.phase === 'Ceremony') {
    if (state.ceremonyStep === 'ATTENTION' || state.ceremonyStep === 'SET') {
      // Falschstart — session opens at this stroke...
    }
    // Stroke during GO! is a normal first stroke. Defer transition
    // to the post-GO tick; record session_start though.
    return state              // ← returns unchanged; comment lies
  }
  // ...
}
```

Two problems:

1. **The comment claims** the stroke records `session_start`. **The
   code returns state unchanged**, so `session_start` is never set on
   this path.
2. **The stroke's distance is dropped.** `_prevStroke` doesn't
   advance; the cumulative distance accounting is lost for that
   stroke. The next stroke in `Live` covers the gap (the `dist`
   field is cumulative session distance, not a delta), so for
   human-paced rowers (one stroke per ~1.7 s at race pace) this is
   invisible. But under fast-fixture E2E replay, the **entire
   fixture** can fit in the 1.5 s GO! window, all strokes dropped,
   reducer never reaches `Finished`, `latchedResult` stays `null`,
   `RacePostScreen` renders with `userTotalSec = 0`.

CONTEXT.md §Start ceremony explicitly says: *"the user is expected to
wait at the catch through ATTENTION/SET and stroke on GO!"* — i.e.,
the **first stroke is the race start**. The reducer should treat the
first stroke during GO! as the race-begins signal, not as a
deferrable nothing.

### Fix shape

In the reducer's `case 'stroke'`, when `state.phase === 'Ceremony' &&
state.ceremonyStep === 'GO'`:

- Transition to `Live(NormalStart)`.
- Process this stroke through the existing Live path:
  - Record `session_start = event.t` (the lie in the comment becomes
    truth).
  - Update `_prevStroke = { t: event.t, dist: event.dist }`.
  - If `event.userDistance >= event.total`, transition to `Finished`
    and compute the latch (the `userDistance >= total` finish-cross
    check fires immediately if applicable; for human rowers this
    won't trigger on stroke 1, but the path is uniform).
- `race_t0` stays as set at `bereitTap + 2*STEP_MS` (the GO! moment).
  If the rower's first stroke happens slightly before `race_t0` (they
  jumped GO!), that's still NormalStart — Falschstart only applies to
  ATTENTION/SET strokes. The `race_t0` clamp on visible distance
  handles the "stroke arrived before GO! moment" case correctly.

The rAF-driven tick → Ceremony→Live transition stays as the fallback
for "no stroke yet within 1.5 s of GO!".

## Acceptance criteria

- [ ] When the reducer is in `Ceremony(GO!)` and receives a `stroke` event, it transitions to `Live(NormalStart)`.
- [ ] The stroke's distance, time, and `_prevStroke` are recorded the same way they would be in `Live`.
- [ ] `session_start` is set to `event.t` (the comment in the old code becomes accurate).
- [ ] If the stroke also satisfies `event.userDistance >= event.total`, the reducer transitions through `Live` to `Finished` in the same step and computes the latch.
- [ ] Falschstart at ATTENTION/SET is unchanged: those strokes still open a `Live(Falschstart)` session with pre-GO! meters excluded.
- [ ] Reducer unit tests cover: stroke at GO! with `userDistance < total` → Live(NormalStart); stroke at GO! with `userDistance >= total` → Finished (skips Live frame); existing Falschstart cases stay green.
- [ ] PRD-0016 / 0016-05 happy-path E2E spec's `userBoat().toBeVisible()` and downstream `RacePostScreen` assertions pass at fast fixture rate. (Co-dependent with [0017-03](03-session-finalized-event.md) — both needed for end-to-end green.)

## E2E walkthrough

Same scenario as PRD-0016 / 0016-05 (canonical race happy-path) at
`fixtureRate: 'fast'`. The race finishes within the 2 s mid-race
`waitForTimeout`; `userBoat()` is visible during Live; `FinishOverlay`
appears; `RacePostScreen` renders with the latched final time.

## E2E spot-checks

- After GO! and `resumeFixture()`, the user boat advances horizontally on the canvas as strokes flow.
- The reducer reaches `Finished` (visible via `FinishOverlay` rendering) within the test budget.
- `latchedResult.finalTimeS` is non-zero by the time `RacePostScreen` renders.

## Blocked by

None — can start immediately. Independent of 0017-03; together they make the full happy-path E2E green.
