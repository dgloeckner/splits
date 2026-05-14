# 0015-02 — Canvas + opponent fetch mount at Ceremony(ATTENTION)

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0015](../PRD.md)
- **Implements**: [ADR-0013](../../../specs/adr/0013-race-canvas-mounts-at-attention.md)

## What to build

Today the race live stage (`RaceLiveView` + `useRaceData` opponent fetch +
stroke dispatch) mounts only on `Ceremony(GO!)`. That produces a visible
mount/swap flash at GO! and leaves the first frame of the race without
opponents in view.

Per **ADR-0013**, broaden the gate so the **canvas** and the **opponent
fetch** mount from `Ceremony(ATTENTION)` onward, while the **live stroke
subscription** (dispatch of stroke events into the reducer) continues to
gate on GO!. The ceremony renders as an overlay over the still canvas,
so GO! produces no swap. The Falschstart rule is preserved: pre-GO
strokes still open the session via the reducer, but no stroke advances
the visible boat until GO! (i.e. the user lane's drawn position is
gated on race_t0).

Gating rule (from PRD-0015, derived from ADR-0013):

```text
canvas + opponent fetch:   mount at Ceremony(ATTENTION)
ceremony overlay:          render during Ceremony(*)
stroke dispatch → reducer: dispatch during Ceremony(*), Live, Finished  (unchanged)
visible boat advance:      gated on race_t0 (GO!) — pre-GO strokes excluded
```

## Acceptance criteria

- [ ] `RaceFlow` mounts the live stage (canvas + `useRaceData`) from `Ceremony(ATTENTION)` onward.
- [ ] The start ceremony renders as an overlay over the canvas; the canvas remains mounted across the ATTENTION → SET → GO! → Live transitions (no remount).
- [ ] `useRaceData` is called at ATTENTION, not before (Bereit still does not open the opponent fetch).
- [ ] No stroke event is dispatched into the reducer before ATTENTION.
- [ ] The visible user boat stays at distance 0 until GO! even if strokes arrive during ATTENTION/SET (preserves Falschstart semantics).
- [ ] Existing tests that asserted "no `useRaceData` before GO!" are updated to assert "no `useRaceData` before ATTENTION".
- [ ] `raceLifecycle` reducer tests for Falschstart at ATTENTION/SET stay green.
- [ ] Integration test in `RaceFlow.test.tsx` drives a fake clock through Bereit → ATTENTION → SET → GO! → Live and asserts the canvas is mounted from ATTENTION on, the ceremony overlay sits over the canvas during Ceremony(*), and no stroke event reaches the reducer pre-ATTENTION.
- [ ] FEAT-0014 PRD ("Further Notes") references ADR-0013 alongside the existing override notes.

## Blocked by

None — can start immediately. Visual verification is easier after 0015-01 lands, but the tests do not depend on it.
