# 0016-06 — Canonical scenario: Falschstart at ATTENTION and SET

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0016](../PRD.md)

## What to build

Two E2E scenarios in one spec covering the Falschstart rule from
CONTEXT.md and the `raceLifecycle` reducer:

1. **Falschstart at ATTENTION** — release the fixture immediately
   after Bereit tap (before ATTENTION expires at 1500 ms). First
   stroke arrives during ATTENTION → reducer transitions to
   `Live(falschstart=true)` → Falschstart toast renders → toast
   auto-dismisses around 2 s → race clock starts from GO!,
   pre-GO meters excluded → race finishes → `summary.race` non-null.
2. **Falschstart at SET** — release the fixture 1500 ms after Bereit
   tap (so the first stroke arrives during SET, between 1500 ms and
   3000 ms post-tap). Same downstream expectations.

The Falschstart toast copy is `Falschstart — Uhr läuft ab GO!`.

The spec collects screenshots at each meaningful step (Bereit, the
ceremony step at which the stroke arrived, the toast visible, the
toast auto-dismissed, the race in progress, the finish) and invokes
the `e2e-critic` sub-agent.

## Acceptance criteria

- [ ] Spec lives at `web/tests/e2e/race/falschstart.spec.ts`.
- [ ] Both scenarios use the dynamic-port infra from 0016-01.
- [ ] Both scenarios use `resumeFixture()` from 0016-02 with deterministic timing relative to Bereit tap.
- [ ] Spot-check: the Falschstart toast renders at the correct phase for both scenarios.
- [ ] Spot-check: the toast auto-dismisses after ~2 s.
- [ ] Spot-check: race clock at finish reflects GO!-onwards timing (pre-GO meters/seconds excluded).
- [ ] Spot-check: after finish, the persisted `summary.race` is non-null (the race counts; Falschstart only affects the clock anchor).
- [ ] Spec invokes `e2e-critic` with screenshots + AC list.
- [ ] Critic returns no `severity: blocker` findings against current code.
- [ ] Total wall-clock under 90 s for both scenarios combined.

## Blocked by

- 0016-01 (dynamic ports)
- 0016-02 (fixture-resume endpoint)
- 0016-03 (`e2e-critic` sub-agent)
