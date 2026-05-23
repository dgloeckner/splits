# 0019-10 — Race-mode timing tests fail under fast-fixture replay

Status: ready-for-agent

- **Type**: AFK · Test reliability + UX
- **Parent**: [PRD-0019](../PRD.md)
- **Surfaced by**: Investigation of e2e failures during the
  pause→discard backend fix. Not caused by the backend changes;
  pre-existing fragility exposed when the test harness's cached
  binary was finally rebuilt against HEAD.

## What's broken

Four race-mode e2e tests fail consistently when run against a fresh
splits binary:

- `tests/e2e/race/falschstart.spec.ts:75` — Falschstart at ATTENTION
- `tests/e2e/race/falschstart.spec.ts:93` — Falschstart at SET
- `tests/e2e/race/happy-path.spec.ts:77` — full walkthrough (never
  reaches `race-post-screen`)
- `tests/e2e/race/abort.spec.ts:218` — Abort from Live mid-race

All four use the same fixture config:

```ts
fixturePaused: true, fixtureDelay: '0s', fixtureRate: 'fast',
```

After `resumeFixture()` the entire 124-stroke race CSV floods through
the sessionizer → SSE pipeline in ~50 ms (verified via trace: SSE
`started_at` → `ended_at` 220 ms apart). For the Falschstart test
specifically, the lifecycle reducer transitions:

1. First stroke dispatched while `state.phase === 'Ceremony'` +
   `ceremonyStep === 'ATTENTION'` → `state = Live(falschstart: true)`.
2. Subsequent strokes dispatched while `state.phase === 'Live'`. At
   stroke ~60 (d≥500 m) the finish-cross transitions
   `phase → 'Finished'`.
3. Toast visibility condition (`RaceFlow.tsx:151`) is
   `state.falschstart && state.phase === 'Live'`. Once `Finished`,
   the toast hides.

Under `fixtureRate: 'fast'` with no inter-stroke delay this whole
sequence completes in well under one Playwright poll cycle, so
`waitForFalschstartToast(4_000)` never observes the toast even
though it briefly existed in the DOM.

`happy-path` and `abort-from-Live` fail for adjacent reasons —
either the post-screen transition outruns the test's wait, or the
abort handler tries to interact with a session that's already in
Finished/Post phase by the time the click lands.

## Root cause shape

The race-mode lifecycle was designed for human-paced strokes where
each phase transition holds for hundreds of ms. The "fast" fixture
pacing compresses 140 s of captured wall time into ~50 ms, which:

- collapses the Falschstart → Live → Finished window below
  Playwright's polling resolution,
- collapses the Live → Finished → Post window below the post-screen
  test's polling resolution,
- makes the AbortControl pill un-tappable because the dialog mounts
  during Finished, when the AC pill is hidden (per ADR-0012 / 0017-02
  Option A).

Falschstart is the cleanest case to fix and the most user-visible
even outside tests: on a fast device, a real-world Falschstart on a
short race (500 m at ~1:35 pace) can land on the finish line in
under 2 s, which means the toast would also flash and vanish on
real hardware before the rower has time to read it.

## What to build

Two layers, only the first is strictly required to green the tests:

### Layer 1 — Toast lifetime decoupled from `state.phase`

Extend the Falschstart toast condition so it stays visible for a
minimum duration after `falschstart === true` was first set,
independent of subsequent phase transitions. Concretely: latch a
`falschstartShownAtMs` field on the reducer when transitioning to
`Live(Falschstart)`, and update `FalschstartToast` (or its
container in `RaceFlow.tsx`) to render while

```
state.falschstart === true &&
performance.now() - state.falschstartShownAtMs < TOAST_DURATION_MS
```

with `TOAST_DURATION_MS` matching the existing auto-dismiss
timeout (~2000 ms). The post screen can also surface a
"Falschstart" badge near the race-time so the rower has a durable
record of why the clock started where it did — but that's the
Layer 2 polish below.

### Layer 2 — Falschstart annotation on RacePostScreen

When the lifecycle reaches `Post` and `falschstart === true`, the
RacePostScreen renders a small "Falschstart — Uhr lief ab GO!"
badge next to the finish time. Persisted with the session summary
(new optional `summary.race.falschstart: boolean`) so a re-opened
race detail page also shows the badge.

## Acceptance criteria

- [ ] Falschstart toast remains visible for ≥1500 ms after first
      render regardless of subsequent `phase` transitions.
- [ ] `tests/e2e/race/falschstart.spec.ts:75` + `:93` pass against
      a freshly built backend on the existing `fixturePaused: true,
      fixtureDelay: '0s', fixtureRate: 'fast'` config.
- [ ] Existing falschstart unit tests in
      `src/race/raceLifecycle.test.ts` continue to pass; new
      coverage asserts the `falschstartShownAtMs` latch is set on
      the Ceremony→Live(Falschstart) transition and **not** updated
      on subsequent strokes (one-shot).
- [ ] `tests/e2e/race/happy-path.spec.ts:77` passes — likely needs
      a similar guard on `race-post-screen` mount-time
      (don't allow Finished → Post to fly past the test poll).
- [ ] `tests/e2e/race/abort.spec.ts:218` passes — the Live-phase
      abort dialog either remains tappable during the Finished
      grace window, or the test is updated to abort against the
      Finished phase explicitly.
- [ ] No regression in `recovery-card.spec.ts`, `fertig.spec.ts`,
      `freeze.spec.ts`, `sprite-drift.spec.ts`, `boot-reconcile.spec.ts`,
      or the v1-flows distance/time/intervals suites.

## E2E walkthrough

Identical to the existing falschstart spec — the fix is internal.

## E2E spot-checks

- Visual: `falschstart-toast` `getByTestId` is visible within 4 s
  of `resumeFixture()` and remains visible for at least 1500 ms.
- Trace assertion (optional): the reducer dispatched stroke events
  reach `phase=Finished` *after* the toast's display deadline.

## Blocked by

None — but coordinate with the in-flight raceResultLatch refactor
(`07-schnitt-race-average.md`, `08-finishoverlay-persists-in-race.md`)
to avoid merge conflicts in `RaceFlow.tsx` / `raceLifecycle.ts`.

## Follow-up (not in this slice)

The faster a future home-ergo session becomes (e.g. wattbike-tier
hardware streaming at 50 Hz), the more these "fast burst" timing
collisions will appear. The general pattern — "two adjacent phase
transitions can happen in the same animation frame" — affects any
UI surface gated on `state.phase === X`. Worth a follow-up audit
to identify other surfaces with the same shape (e.g. the
WorkoutProgressStrip's `RestPhase` countdown, the
SegmentStatus extrapolation cliff at phase boundaries) and apply
the same "latch + min-duration" pattern where appropriate.
