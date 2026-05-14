# ADR-0013: Race canvas mounts at Ceremony(ATTENTION); live stroke subscription gates at GO!

- **Status**: Accepted
- **Date**: 2026-05-14

## Context

PRD-0014 / issue 0014-04 shipped the rule "the live stage (`RaceLiveView` +
`useRaceData` opponent fetch + live stroke subscription) mounts only once the
race lifecycle reaches `Ceremony(GO!)`". This was a deliberate gate: no live
work happens before the rower commits to the start.

User testing on 2026-05-14 surfaced two consequences of this gate:

1. **Visual disruption at GO!.** The canvas appears in the same frame the
   ceremony dismisses, producing a perceptible swap. The transition from
   "settled at the catch" to "racing" should be seamless.
2. **Empty paddle-down between ceremony and first stroke.** Even after the
   canvas mounts, the rower needs ~one stroke before opponents arrive over
   the network, leaving the canvas without context boats for the first
   second of the race.

The Falschstart rule from CONTEXT.md is unambiguous: a stroke during
ATTENTION/SET still opens the session, but `race_t0` = GO! and pre-GO meters
are excluded from race-distance/race-time. Whatever we change must preserve
this rule — the visual race must not advance pre-GO.

## Options considered

### Option A — Mount canvas + open opponent fetch at Ceremony(ATTENTION); stroke subscription still gates at GO!

The canvas paints lanes and boats parked at the start line (userDistance=0,
elapsedSec=0). Opponent curves are fetched at ATTENTION — they are static,
so the early fetch is harmless and warms the data. Live stroke subscription
remains gated on GO!, so no strokes drive the canvas pre-GO. The Falschstart
rule is unaffected.

- **Pros:** seamless GO! transition; opponent data ready when the rower
  needs it; preserves Falschstart semantics; small wiring change in
  `RaceFlow`.
- **Cons:** the live stage is mounted slightly earlier, increasing
  start-of-flow render work by one component subtree (negligible).

### Option B — Mount canvas + open live stroke subscription at Ceremony(ATTENTION)

The canvas paints in real time during the ceremony, including strokes that
arrive before GO! (which would trigger Falschstart in the reducer).

- **Pros:** truly continuous live view.
- **Cons:** the visual boat would advance pre-GO, conflicting with the
  Falschstart toast copy ("Uhr läuft ab GO!") and the race-clock semantics.
  The race result computation also has to mask out pre-GO motion. Wrong.

### Option C — Mount canvas at Bereit (before tap)

BereitScreen becomes "starting position visible, big BEREIT button
overlaying it".

- **Pros:** maximally seamless.
- **Cons:** dilutes the BereitScreen design — currently a deliberate
  minimal beat of stillness — and renders a static race scene before the
  rower has committed to starting. Risk of "did the race start?"
  confusion.

## Decision

**Option A.** Mount the race canvas and start the opponent fetch at
`Ceremony(ATTENTION)`; keep the live stroke subscription gated on `GO!`.
The ceremony renders as an overlay over the still canvas.

## Consequences

- `RaceFlow` (`web/src/race/RaceFlow.tsx`) needs to broaden its `liveMounted`
  test so that the live stage subtree mounts from Ceremony(ATTENTION)
  onward. The stroke-forwarding `useEffect` already filters on
  `state.phase === 'Live' || state.phase === 'Finished' || state.phase === 'Ceremony'`,
  so opening it earlier is consistent.
- The `RaceLiveStage` inner component (which hosts `useRaceData`) is the
  natural mount point — moving it under `Ceremony(ATTENTION)` triggers the
  opponent fetch early without changing the live-stroke gating logic.
- The PRD-0014 phrase "live stage gates on GO!" is **superseded** by this
  ADR for canvas + opponent fetch; it remains in force for the live stroke
  subscription specifically.
- FEAT-0014 spec (`specs/feat/0014-race-mode-cleanup.md`) and PRD
  (`.scratch/race-mode-cleanup/PRD.md`) should reference this ADR alongside
  the existing FEAT-0013 override annotations.
- Tests that asserted "no `useRaceData` call before GO!" need to relax to
  "no `useRaceData` call before ATTENTION".
