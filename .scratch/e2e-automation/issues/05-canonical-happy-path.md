# 0016-05 — Canonical scenario: race-flow happy path

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0016](../PRD.md)

## What to build

The first canonical E2E retrofit: a full race-flow happy-path
walkthrough that exercises the user's journey end-to-end against the
real running app.

The scenario walks: Distance picker → Intensity picker → Übersicht
(with synth-ghost + PB toggled on, intensity = Moderat) → tap Start
→ BereitScreen → tap Bereit → ATTENTION → SET → GO! → strokes
arrive → finish-cross → FinishOverlay → session_end → RacePostScreen
with latched values.

Pre-test seeding: insert a prior session via the backend API so that
both ghost (session-ghost-by-distance) and PB are present in the
opponent fetch. Use the new `resumeFixture()` helper from 0016-02 to
release the fixture replay just after GO! so the strokes arrive at
the correct phase.

The walkthrough collects ordered screenshots at each meaningful step
(at minimum: Übersicht, BereitScreen, ATTENTION, SET, GO!, mid-race,
finish-cross / FinishOverlay, RacePostScreen) and invokes the
`e2e-critic` sub-agent with them + the AC list.

Add any missing `data-testid`s the walkthrough requires on the
existing user-facing components. Use the soft convention from 0016-04.

## Acceptance criteria

- [ ] Walkthrough spec lives at `web/tests/e2e/race/happy-path.spec.ts` (or equivalent under the race folder).
- [ ] Pre-test seeds a prior session via the API so ghost + PB are populated for the under-test workout.
- [ ] Walkthrough uses the dynamic-port infra from 0016-01 (no fixed ports).
- [ ] Walkthrough uses `resumeFixture()` from 0016-02 to release strokes after GO!.
- [ ] Spot-check: the race canvas is mounted from ATTENTION onward (per ADR-0013).
- [ ] Spot-check: user boat is visible at the start line during ATTENTION and SET.
- [ ] Spot-check: ghost and PB boats are both present in the canvas.
- [ ] Spot-check: FinishOverlay appears over the still-mounted canvas at finish-cross.
- [ ] Spot-check: RacePostScreen shows latched final time and gaps.
- [ ] Walkthrough invokes the `e2e-critic` sub-agent with screenshots + AC list.
- [ ] Critic returns no `severity: blocker` findings against the current code (after 0015-01 fix is in tree).
- [ ] Total wall-clock under 60 s per run at fast fixture rate.

## Blocked by

- 0016-01 (dynamic ports)
- 0016-02 (fixture-resume endpoint)
- 0016-03 (`e2e-critic` sub-agent)
