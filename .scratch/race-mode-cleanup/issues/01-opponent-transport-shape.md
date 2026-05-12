# 0014-01 — Opponent-pace transport: `t_sec[]` + `distance_m[]`

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0014](../PRD.md)

## What to build

Change the opponent-pace transport shape so the backend returns parallel
`t_sec[]` and `distance_m[]` arrays for each opponent (`ghost`, `pb`)
instead of `t_sec[]` + `split[]`. The web race UI consumes `distance_m[]`
directly via a new pure `opponentLookup(t_sec, distance_m, userDist,
userTime)` helper that does a binary-search distance lookup and returns a
signed gap. The existing `gapAtTime` integration loop in the live view is
removed.

This is a coordinated backend → web change. Ship the backend response
update and the web consumer update together so no client sees the old
shape against the new server (or vice versa).

## Acceptance criteria

- [ ] `GET /api/v1/workouts/{id}/opponents` returns, for each present opponent, `{ t_sec: number[], distance_m: number[] }` — `split[]` is removed.
- [ ] Arrays are parallel, monotonically non-decreasing in `t_sec`, `t_sec[0] === 0`.
- [ ] Web race UI calls `opponentLookup` to compute opponent gap; the old `gapAtTime` integration loop is deleted.
- [ ] `opponentLookup` unit-tested for: `userDist <= 0`, `userDist >= last`, an exact match, and an interpolated case.
- [ ] Backend handler unit-tested for the new response shape (ghost-only, pb-only, both, neither).
- [ ] Existing race component tests pass against the new shape.

## Blocked by

None — can start immediately.
