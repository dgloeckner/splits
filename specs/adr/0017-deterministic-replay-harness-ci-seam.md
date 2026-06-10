# ADR-0017: Deterministic replay harness as a CI seam

- **Status**: Accepted
- **Date**: 2026-06-10

## Context

Every distance/pace bug to date (U3 split jitter, B1 missing PB-5000,
B5 warmup eating the distance goal, the A8 field-framing fix) was found
by a human rowing on the erg and noticing a wrong number. The pipeline
that produces those numbers — IPM frames → Sessionizer → SSE events →
web reducer → hero tiles — has no deterministic end-to-end test.

The pieces already exist but are not connected as a test seam:

- `cmd/replay` re-feeds a *persisted* session through the Sessionizer
  and emits per-stroke CSV (the ADR-0011 "validation substrate"), but
  it reads from a DB and is manual-only.
- `ipm.FixtureProducer` replays captured console CSVs as frames, with
  pause/resume and pacing control, but only the dev backend and the
  Playwright e2e suite use it.
- `cmd/replay/parity_test.go` compares backend race math against a
  **hand-ported Go copy** of `opponentLookup.ts`. The port can drift
  from the real TS — a hypothetical seam, not a real one.
- Web reducer tests feed hand-built events, never a recorded stream.

Two recent user reports motivate closing this: hardware-vs-UI distance
mismatch, and stats measured outside the work phase. Both are exactly
the class of bug a recorded-frames → expected-UI-numbers test catches.
The planned Pause/auto-resume work (CONTEXT.md §Pause / Abort) also
needs "pause 2 min, resume, totals unchanged" as an assertable fixture.

Since the corrected A8 layout (commit 9bfd6f9), the wire carries the
console's own displayed values: cumulative `distance_m` and
`DeviceSplitPaceSec` are what the LCD shows. "UI agrees with hardware"
is therefore assertable from the frame fields themselves.

## Options considered

### Option A — Golden event-stream JSONL as the committed contract

A Go test harness runs `FixtureProducer → Sessionizer` with an injected
clock and (1) asserts phase transitions, session totals, and PB
candidates per fixture, (2) writes the emitted SSE event stream to a
golden JSONL file committed to the repo (regenerated via an explicit
`-update` flag). A vitest suite feeds the committed JSONL through the
real reducer + display hooks and asserts hero-tile values per stroke.

Pros: the golden file is a real seam with two adapters (Go producer,
TS consumer); wire changes appear as reviewable diffs; both suites run
standalone and fast; the hand-ported parity test becomes obsolete.
Cons: golden files can go stale; regeneration needs discipline.

### Option B — Generate the stream at test time

CI runs the Go harness first and pipes its output into vitest in one
job. No stale-golden risk, but the TS suite can no longer run
standalone, CI gains a cross-language dependency, and wire changes
produce no reviewable artifact.

### Option C — Everything through Playwright e2e

Extend the existing ADR-0014 e2e gate with fixture-driven numeric
assertions. Exercises the real browser, but slow, flaky for
per-stroke numeric assertions, and cannot assert backend internals
(PB candidates, accumulator state).

## Decision

Option A, plus two principles:

1. **Hardware truth = device-emitted fields.** Assertions compare UI
   values against `distance_m` / `DeviceSplitPaceSec` from the frames
   (modulo the documented work-offset), not human-noted console
   readings. One manual spot-check during the next capture session
   verifies the console displays what it transmits.
2. **Fixture gaps are filled by a real capture session** (idle
   broadcast ≥2 min to settle the device-timer question; one workout
   with warmup → work → pause → resume → cooldown). Synthetic fixtures
   are acceptable placeholders until then and must be replaced.

The Playwright e2e gate (ADR-0014) is unchanged; it remains the UX
gate. This harness is the numeric gate.

## Consequences

- Every future distance/pace/phase bug report becomes a regression
  fixture: capture or synthesize the frames, assert the expected
  numbers, fix until green.
- The Pause/auto-resume work (CONTEXT.md §Pause / Abort) is developed
  test-first against a pause fixture.
- The golden JSONL doubles as living documentation of the SSE wire
  format; `cmd/replay/parity_test.go`'s Go port of the TS lookup can
  be retired once the race fixtures cover the same assertion.
- New discipline required: intentional wire changes regenerate goldens
  via the `-update` flag and reviewers treat golden diffs as API
  review.
- Display hooks (`usePhasedDistance` etc.) must stay testable with
  fake timers; dead-reckoning code keeps its injected-clock seams.
