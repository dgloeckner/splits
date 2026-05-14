# PRD-0017: Race-flow follow-ups surfaced by PRD-0016 E2E gate

Status: ready-for-agent

- **Owner**: @gloeckner
- **Source**: First-integration findings from PRD-0016 / ADR-0014's per-slice E2E gate
- **Date**: 2026-05-14

## Problem Statement

PRD-0016 landed the per-slice E2E gate (deterministic walkthrough +
spot-checks + `e2e-critic`). On the very first run of the canonical
race-flow scenarios, two real-app findings surfaced that the unit
suite (504 passing tests) could not have caught. Both are AC-level —
the existing acceptance criteria in PRD-0014 / 0015 did not anticipate
them, and the rower would experience each as a UI surprise.

This PRD captures both findings as actionable follow-ups. It is
exactly the AC-strengthening feedback loop ADR-0014 promised, applied
to its own output.

## Solution

Two narrow follow-ups:

- **0017-01** — Boats deterministically positioned at the start line
  on the same frame the canvas mounts at `Ceremony(ATTENTION)`. Closes
  the gap between *"canvas mounted from ATTENTION"* (ADR-0013) and
  *"rower can actually see the boats"* (PRD-0015 user story 1).
- **0017-02** — Decide and implement the correct Abbrechen-pill
  behaviour during `Finished` (paddle-down). The reducer's `abort`
  event is currently a no-op on `Finished`; the pill stays visible
  but tapping it does nothing observable. Either hide the pill or
  document explicitly that finishing locks the result.

## User Stories

1. As a rower at the catch in ATTENTION, I want to see my boat at the
   start line on the same visual frame the canvas appears, so the
   transition from BereitScreen to Ceremony feels continuous.
2. As a rower in ATTENTION, I want the ghost and PB boats also at
   the start line on the first frame, so the field is fully
   established before SET fires.
3. As an AFK agent running the canonical happy-path E2E, I want
   `expect(userBoat).toBeVisible()` to pass during ATTENTION, so the
   spot-check that catches the empty-canvas regression class is
   tight rather than flaky.
4. As a rower who has crossed the finish line, I want the Abbrechen
   pill to either disappear or visibly do nothing-with-explanation
   when tapped, so I am not left wondering whether my finish was
   discarded.
5. As a developer reading CONTEXT.md, I want the rule "the finish
   horn latches the race result; abort after finish is a no-op"
   explicit, so the AC author of the next race PRD can rely on it.

## Out of Scope

- Larger changes to the ceremony timing or the canvas lifecycle.
- Multiplayer / live opponents.
- Race-mode resumability (still ruled out by ADR-0012).

## Further Notes

- Both findings are documented in the originating issues'
  `## Comments` sections:
  - `.scratch/e2e-automation/issues/05-canonical-happy-path.md`
    (boat at ATTENTION).
  - the abort-from-Finished AC in
    `.scratch/e2e-automation/issues/07-canonical-abort-each-phase.md`
    (and the spec's documented `expectRaceSummaryPersisted`
    behaviour).
- ADR-0013 (canvas mounts at ATTENTION) and ADR-0014 (per-slice E2E
  gate) are both in `Accepted` status and are the relevant durable
  records.
- This PRD is published under `.scratch/race-e2e-followups/` per
  `docs/agents/issue-tracker.md`.
