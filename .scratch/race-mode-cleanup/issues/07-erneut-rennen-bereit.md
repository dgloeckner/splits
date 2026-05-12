# 0014-07 — `Erneut rennen` re-enters via Bereit

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0014](../PRD.md)

## What to build

The `Erneut rennen` CTA on `RacePostScreen` re-enters the race flow with
the same distance and opponents pre-selected, landing on `BereitScreen`
— not directly on the live page. The ceremony plays again on the next
`Bereit` tap.

## Acceptance criteria

- [ ] Tapping `Erneut rennen` navigates to `BereitScreen` with prior distance and opponents pre-filled.
- [ ] No live subscription opens until `Bereit` is tapped.
- [ ] The start ceremony plays on the next `Bereit` tap, identical to a first-run race.
- [ ] Component test asserts the navigation target and the pre-filled selections.

## Blocked by

- 0014-04 (`BereitScreen` exists and is the canonical entry point into the race flow).
