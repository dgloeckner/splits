# 0016-07 — Canonical scenario: abort from each phase

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0016](../PRD.md)

## What to build

Four sub-scenarios in one spec covering the abort affordance from
PRD-0015 / 0015-03 + ADR-0012 (race-mode non-resumable):

1. **Abort from Bereit** — on BereitScreen, tap Abbrechen pill →
   confirm → race surface unmounts → poll sessions API → assert
   `summary.race = null`.
2. **Abort from Ceremony** — tap Bereit → wait for ATTENTION → tap
   Abbrechen → confirm → same downstream assertions.
3. **Abort from Live** — release fixture so strokes flow → tap
   Abbrechen mid-race → confirm → same downstream assertions.
4. **Abort from Finished** — let the rower cross the finish line →
   FinishOverlay appears → tap Abbrechen (still rendered until Post)
   → confirm → same downstream assertions.

Across all four: confirm cancel path leaves the race surface intact
and `summary.race` is still derivable / non-null in the abort-after-
finish case (per CONTEXT.md, the finish horn latches the result;
verify what the post-finish abort actually does and update the AC if
the behaviour differs from the user-story expectation — that's the
AC-strengthening feedback loop in action).

Screenshots at each step; critic invoked.

## Acceptance criteria

- [ ] Spec lives at `web/tests/e2e/race/abort.spec.ts`.
- [ ] All four sub-scenarios use the dynamic-port infra from 0016-01.
- [ ] Each sub-scenario: tap Abbrechen → confirm → race surface unmounts.
- [ ] After confirm on Bereit, Ceremony, and Live aborts: `summary.race = null` (polled via sessions API).
- [ ] Behaviour on Finished-phase abort is documented in the spec comments and reflected in the AC list (post-finish abort may legitimately keep the latched result; if so, surface that here).
- [ ] Cancel path: tap Abbrechen → cancel → race surface intact, reducer state unchanged.
- [ ] Spec invokes `e2e-critic` with screenshots + AC list.
- [ ] Critic returns no `severity: blocker` findings against current code.
- [ ] Total wall-clock under 90 s for all four sub-scenarios combined.

## Blocked by

- 0016-01 (dynamic ports)
- 0016-02 (fixture-resume endpoint)
- 0016-03 (`e2e-critic` sub-agent)
