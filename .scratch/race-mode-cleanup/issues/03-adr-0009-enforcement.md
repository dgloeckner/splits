# 0014-03 — ADR-0009 enforcement: hide toggles, reject server-side

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0014](../PRD.md)

## What to build

Close the loop on ADR-0009 (race excludes warmup/cooldown) on both the
client and the server.

- `ConfirmScreen` hides the warmup and cooldown toggles when
  `mode === 'race'`, and the race state machine forces
  `warmupEnabled = cooldownEnabled = false`.
- Backend `POST /workouts` rejects race-mode payloads with non-zero
  `warmup_sec` or `cooldown_sec`, returning HTTP 400 with a clear
  message. No data migration is required.

## Acceptance criteria

- [ ] `ConfirmScreen` does not render warmup/cooldown toggles when `mode === 'race'`.
- [ ] Race-mode submissions from `ConfirmScreen` always carry `warmup_sec=0` and `cooldown_sec=0`.
- [ ] `POST /workouts` returns `400` for `mode === 'race'` with `warmup_sec > 0`.
- [ ] `POST /workouts` returns `400` for `mode === 'race'` with `cooldown_sec > 0`.
- [ ] Race-mode submission with both at `0` is accepted (regression guard).
- [ ] Component test for `ConfirmScreen` covers the visibility branch.
- [ ] Backend handler test covers the accept/reject cases.

## Blocked by

None — can start immediately.
