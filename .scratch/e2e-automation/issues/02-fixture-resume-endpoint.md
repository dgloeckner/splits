# 0016-02 — Fixture-resume endpoint (dev-mode only)

Status: ready-for-agent

- **Type**: AFK · Backend + Infra
- **Parent**: [PRD-0016](../PRD.md)

## What to build

Race-mode E2E needs deterministic phase-boundary timing — for example
producing a stroke during ATTENTION (1500 ms window) for Falschstart
tests. The current `SPLITS_FIXTURE_DELAY` is a wall-clock offset from
backend boot and is not synchronised with the user's Bereit tap.

Add:

- A `paused` flag on the fixture replayer. Default `false` for
  backward compatibility.
- A new env var `SPLITS_FIXTURE_PAUSED=1` that starts the replayer
  paused.
- A new HTTP endpoint `POST /test/fixture/resume`, mounted only when
  `SPLITS_DEV_MODE=1`, which flips the flag and starts (or continues)
  the schedule. Returns `200 {"started": true}` on first resume,
  `200 {"started": false, "reason": "already_running" | "no_fixture"}`
  otherwise.
- A non-dev build returns `404` for the endpoint.
- A small e2e helper `resumeFixture(backend)` POSTs to the endpoint.

## Acceptance criteria

- [ ] Fixture replayer started with `SPLITS_FIXTURE_PAUSED=1` emits no strokes until resumed.
- [ ] `POST /test/fixture/resume` with `SPLITS_DEV_MODE=1` flips paused → running; returns `200 {"started": true}`.
- [ ] Second call returns `200 {"started": false, "reason": "already_running"}`.
- [ ] `POST /test/fixture/resume` without `SPLITS_DEV_MODE=1` returns `404`.
- [ ] `POST /test/fixture/resume` with no fixture configured returns `200 {"started": false, "reason": "no_fixture"}` or `404` — pick one and document.
- [ ] Go test covers all four cases (paused/resumed/already-running/dev-mode-gated).
- [ ] `resumeFixture(backend)` helper added to `web/tests/e2e/helpers/`.
- [ ] No regression in existing fixture-replay e2e specs (they default to `paused: false` and behave as today).

## Blocked by

None — can start immediately.
