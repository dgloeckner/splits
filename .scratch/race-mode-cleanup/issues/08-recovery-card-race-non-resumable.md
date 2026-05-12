# 0014-08 — ADR-0012 recovery card: race rows hide `rejoin live`

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0014](../PRD.md)

## What to build

Implement the recovery flow consequence of ADR-0012 (race-mode
non-resumable).

- The home recovery card (`Frühere Session abschließen?`) branches on
  `workout.mode == 'race'`. For race rows, only **Finalize** and
  **Discard** are exposed; **rejoin live** is hidden.
- Finalize-from-last-stroke for a race row explicitly sets
  `summary.race = null` regardless of where the last stroke landed
  relative to the finish line.
- The simple-two-button race path requires no stroke-history
  inspection.

## Acceptance criteria

- [ ] Recovery card for a race row renders Finalize and Discard only; `rejoin live` is not in the DOM.
- [ ] Recovery card for a non-race row continues to render all three actions (regression guard).
- [ ] Finalize on a race row produces a session record with `summary.race = null`.
- [ ] Component test covers race vs non-race branches.
- [ ] Backend test confirms finalize sets `summary.race = null` for race rows.

## Blocked by

None — can start immediately.
