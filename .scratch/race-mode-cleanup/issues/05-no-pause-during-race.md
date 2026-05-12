# 0014-05 — Hide pause control during a race

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0014](../PRD.md)

## What to build

In race mode, the live page must not expose a pause control — a race is
a one-shot competition unit; if the rower stops, they abort. The abort
control remains available and produces a session with
`summary_json.race = null`, unchanged from FEAT-0013.

## Acceptance criteria

- [ ] Live page hides the pause control when `workout.mode === 'race'`.
- [ ] Abort control is still rendered and functional in race mode.
- [ ] Aborting before the finish horn records the session with `summary_json.race = null`.
- [ ] Component test asserts the pause control is absent in race mode and present in non-race modes.

## Blocked by

None — can start immediately.
