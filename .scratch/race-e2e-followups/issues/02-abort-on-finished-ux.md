# 0017-02 — Resolve Abbrechen-pill behaviour during Finished (paddle-down)

Status: ready-for-agent

- **Type**: HITL (decision) → AFK (implementation)
- **Parent**: [PRD-0017](../PRD.md)
- **Surfaced by**: [PRD-0016 / 0016-07](../../e2e-automation/issues/07-canonical-abort-each-phase.md), Scenario D
- **Related**: PRD-0015 / 0015-03 (AbortControl), ADR-0012 (race-mode non-resumable), CONTEXT.md §Finish horn

## What to build

The PRD-0016 abort-from-each-phase E2E spec (Scenario D) surfaced a
behaviour mismatch between the user-story intent and the shipped
code. After the rower crosses the finish line and `FinishOverlay`
appears:

- The `AbortControl` pill stays visible (correct per the PRD-0015
  spec — only hidden on `Post`).
- Tapping the pill opens the confirmation sheet.
- Confirming dispatches the `abort` event into the `raceLifecycle`
  reducer.
- The reducer's `abort` handler is a **no-op on `Finished`** (per
  `web/src/race/raceLifecycle.ts`), so the latched result stays.
- The session is later ended normally (idle timeout or session_end);
  the backend's `ComputeRaceResult` returns the latched result
  because `userDistanceM >= rp.Meters` (per
  `backend/internal/storage/race_result.go:92`), so `summary.race`
  is populated.

From the rower's perspective: the pill *appears* to do nothing. The
visible result on the FinishOverlay stays. The persisted session
contains the result. The whole gesture is invisible.

This is consistent with CONTEXT.md ("the finish horn latches the
race result; the rower typically continues rowing for a paddle-down;
the result overlay does not wait for the rower to stop") — the
domain rule is "once the finish horn fires, the result is
immutable". But the AbortControl UI lets the rower attempt
something that has no effect.

### Decision required

Two coherent paths; pick one.

**Option A — Hide the Abbrechen pill on `Finished`.**
Treat the finish horn as the moment the race becomes a result, not a
race-in-progress. The pill disappears the moment `FinishOverlay`
slides in. The rower paddles down without a misleading affordance.

- Pros: matches the domain rule; no confusing dead button.
- Cons: small asymmetry — the rower can still abort during Live but
  not during Finished. If the rower wanted to "scrub" the race
  *after* seeing the result (e.g. realised they fouled), there's no
  path.

**Option B — Keep the pill visible; rename / repurpose the confirm
copy on `Finished`.**
When tapped during `Finished`, the confirm sheet says something like
*"Das Rennen ist abgeschlossen — möchtest du die Session ohne
Paddeln beenden?"*, and confirm just calls the existing
session-termination path (without unwinding `summary.race`).

- Pros: rower has a consistent escape route through paddle-down;
  the result stays latched as it should.
- Cons: changes the affordance's meaning by phase (abort vs
  "session end"); a touch UX-confusing.

**My recommendation (for the human deciding this): Option A.** It
matches the domain rule (finish horn = result locked) and is the
simplest change. The "session end" path during paddle-down is
already covered by the idle timeout firing `session_end`
automatically.

### What to build, given a decision

If **Option A** is chosen:
- Update `RaceFlow.tsx` so `AbortControl` is rendered only when
  `state.phase === 'Bereit' || 'Ceremony' || 'Live'` (drop
  `Finished`).
- Update PRD-0015 / 0015-03 AC list to reflect: pill present on
  Bereit/Ceremony/Live; absent on Finished + Post.
- Update CONTEXT.md §Pause/Abort to spell out: "Abort is unavailable
  once the finish horn has fired; the result is locked at that
  instant (CONTEXT.md §Finish horn)".
- Update PRD-0016 / 0016-07 Scenario D so the assertion is "pill is
  NOT in the DOM during Finished" rather than the current
  "tap-pill-and-nothing-happens" documented finding.

If **Option B** is chosen:
- Add a phase-aware confirm-sheet text in `AbortControl.tsx`.
- Wire the `Finished`-phase confirm to call the existing
  `onAbort` prop (which calls `useWorkoutOverlay().abort()` →
  backend session-end → existing `ComputeRaceResult` path keeps
  `summary.race` because `userDistanceM >= rp.Meters`).
- Update PRD-0015 / 0015-03 and CONTEXT.md to document the
  phase-aware copy.
- Update PRD-0016 / 0016-07 Scenario D so the assertion is "pill
  visible; confirm ends session with `summary.race` populated".

## Acceptance criteria

- [ ] A decision between Option A and Option B is captured in this issue file (mark which option was chosen and by whom).
- [ ] The chosen option is implemented per the per-option work list above.
- [ ] PRD-0015 / 0015-03 AC list updated to reflect the new behaviour.
- [ ] CONTEXT.md §Pause/Abort updated to match.
- [ ] PRD-0016 / 0016-07 Scenario D assertion updated to match.
- [ ] Component test for `AbortControl` (Option A: absent on Finished; Option B: phase-aware copy on Finished) added.
- [ ] E2E abort-from-Finished scenario in `abort.spec.ts` asserts the new contract.

## E2E walkthrough

Same scenario as PRD-0016 / 0016-07 Scenario D, but with the
finalised assertion replacing the current `expectRaceSummaryPersisted`
(which encodes the "no-op" workaround).

## E2E spot-checks

- Option A: `abort-pill` is NOT in the DOM when `finish-overlay` is visible.
- Option B: `abort-pill` is in the DOM; tapping it opens a sheet whose confirm-button copy is the Finished-phase variant; tapping confirm ends the session and `summary.race` is still populated.

## Blocked by

- A human decision between Option A and Option B (this is the HITL part of the issue).
