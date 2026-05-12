# 0014-10 — Annotate FEAT-0013 overrides

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0014](../PRD.md)

## What to build

Annotate `specs/feat/0013-race-mode.md` inline where FEAT-0014 overrides
or simplifies prior behaviour, so future readers do not reintroduce the
older rules.

- Line ~54: race distance copy simplifies to "meters".
- Lines ~132–133: reduced-motion behaviour is overridden by FEAT-0014
  (text transitions still render; the cue is never an empty render).

## Acceptance criteria

- [ ] FEAT-0013 line 54 carries an inline note pointing to FEAT-0014 / PRD-0014.
- [ ] FEAT-0013 lines 132–133 carry an inline note overriding the reduced-motion behaviour to point at FEAT-0014 / PRD-0014.
- [ ] No other text in FEAT-0013 is changed (preserve as historical record).

## Blocked by

- 0014-04 (reduced-motion behaviour must actually ship before the doc claims it).
