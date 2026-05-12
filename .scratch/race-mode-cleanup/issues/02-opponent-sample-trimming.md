# 0014-02 — Opponent-sample trimming to work-segment start

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0014](../PRD.md)

## What to build

For session-sourced opponents (ghost, pb-leader) whose source session had a
non-zero warmup, drop the leading samples that cover the warmup and rebase
`t_sec[]` so that `t_sec[0] === 0` corresponds to the work-segment start.
For sources with no warmup (or sessions created after ADR-0009 takes
effect), the trim is a no-op. Synth-ghosts are untouched — they always
start at `t=0` by construction.

The trim/rebase logic lives in a small, isolatable backend module
(`opponentSamples`) so it can be table-driven tested without dragging in
HTTP plumbing.

## Acceptance criteria

- [ ] Source session with `warmup_sec > 0`: samples whose `t_sec` falls inside the warmup are dropped; remaining `t_sec[]` is rebased so the first element is `0`; `distance_m[]` is rebased so the first element is `0`.
- [ ] Source session with `warmup_sec == 0`: arrays are returned unchanged (no-op).
- [ ] Synth-ghost: arrays are returned unchanged (no-op).
- [ ] Trim module has table-driven Go tests covering all three cases plus an edge case where the work-segment start falls between two samples.
- [ ] `GET /api/v1/workouts/{id}/opponents` integrates the trim and exposes the rebased arrays in the shape from 0014-01.

## Blocked by

- 0014-01 (opponent transport shape settled before changing the data inside that shape).
