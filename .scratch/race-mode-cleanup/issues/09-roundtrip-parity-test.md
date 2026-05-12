# 0014-09 — Round-trip parity: latched overlay vs persisted `summary.race`

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0014](../PRD.md)

## What to build

Add a deterministic round-trip parity test in the replay harness
(`cmd/replay`). For a representative race stroke stream, assert that
the latched in-flight result (as produced by `raceResultLatch` at
`userDistanceM >= totalMeters`) and the persisted `summary.race`
payload (as produced by the backend at `session_end`) agree on final
time and on every opponent gap within ±0.1 s.

## Acceptance criteria

- [ ] Replay harness scenario plays a complete race stroke stream end-to-end.
- [ ] Test extracts the latched in-flight result at the cross moment and the persisted `summary.race` at `session_end`.
- [ ] Asserts `|t_inflight - t_persisted| <= 0.1 s` for the final time.
- [ ] Asserts `|gap_inflight - gap_persisted| <= 0.1 s` for each present opponent.
- [ ] Test is deterministic across runs.

## Blocked by

- 0014-06 (in-flight latch must exist before parity can be measured).
