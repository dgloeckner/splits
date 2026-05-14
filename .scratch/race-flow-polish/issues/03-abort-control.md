# 0015-03 — AbortControl pill + confirm sheet

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0015](../PRD.md)

## What to build

Add an abort affordance to the race surface. PRD-0014 / 0014-05 correctly
hid the pause control during a race, but did not add an abort affordance,
so a rower has no way to wave off mid-race or change their mind on
Bereit.

Add a small **Abbrechen** pill in the top-right of the race surface,
owned by `RaceFlow`. Tapping the pill opens a confirmation sheet
("Rennen abbrechen?" with cancel and confirm actions). Confirming
dispatches the existing `raceLifecycle` reducer `abort` event, which
transitions to `Aborted` and triggers the existing session-end path
that records `summary.race = null` (unchanged from PRD-0014). Cancelling
returns the rower to the prior phase with no state change — no clock or
position disturbance.

The pill is visible across **Bereit**, **Ceremony**, and **Live**
(above the ceremony overlay's z-index so it remains reachable
mid-countdown). It is absent on **Finished** and **Post** — once
the finish horn has fired, the race result is latched and abort is
unavailable (see PRD-0017 / 0017-02 for the Option A decision and
CONTEXT.md §Pause/Abort).

## Acceptance criteria

- [ ] An "Abbrechen" pill renders in the top-right of the race surface on Bereit, Ceremony, and Live phases.
- [ ] The pill is absent on Finished and Post.
- [ ] The pill sits above the ceremony overlay's z-index and is tappable during ATTENTION/SET/GO!.
- [ ] Tapping the pill opens a confirmation sheet with cancel and confirm actions.
- [ ] Confirming dispatches the reducer `abort` event; the reducer transitions to `Aborted`.
- [ ] After abort confirm, the persisted session has `summary.race = null` (existing PRD-0014 path; assert via test or by referencing the existing test that already covers this).
- [ ] Cancelling the confirmation sheet leaves the reducer state untouched and does not disturb the live clock or visible boat position.
- [ ] Component test renders the pill in each phase (Bereit, Ceremony, Live) and asserts presence; renders in Finished and Post and asserts absence.
- [ ] Component test taps the pill → asserts the confirmation sheet opens; tap confirm → reducer receives `abort`; tap cancel → reducer untouched.

## Blocked by

None — can start immediately.
