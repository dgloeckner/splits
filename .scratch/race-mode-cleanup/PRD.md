# PRD-0014: Race Mode Cleanup

Status: ready-for-agent

- **Owner**: @gloeckner
- **Source**: `specs/feat/0014-race-mode-cleanup.md`
- **Depends on**: FEAT-0013 (Race Mode), ADR-0009 (race excludes warmup/cooldown), ADR-0012 (race-mode non-resumable)
- **Date**: 2026-05-12

## Problem Statement

After FEAT-0013 shipped, race mode in `splits` does not yet feel like a
self-contained competition unit. A rower opens the live page and the start
ceremony fires immediately — before they are settled at the catch. There is no
moment of choosing to begin. At the other end of the race, crossing the finish
line gives no immediate result; the rower has to stop and trigger
`session_end` before seeing their time and gaps. Mid-race, the live page still
shows a pause control, which contradicts the framing of a race as a
one-shot competition. Reduced-motion users get *no* start cue at all when
they should still see a visible ATTENTION → SET → GO! transition.
Opponent comparisons can also be wrong when the source session had a warmup,
because the opponent's samples start from `session_start` (minute zero of the
source session) instead of from the work-segment start. The rower notices
this as a phantom early lead/deficit that has nothing to do with how either
boat is actually rowing.

## Solution

Pull race mode into a coherent competition arc by adding a deliberate
**Bereit am Catch** ready state, latching a **finish-horn** result overlay at
finish-cross, removing the pause control during a race, fixing the
reduced-motion start cue regression, and trimming opponent samples to the
opponent's work-segment start. Re-shape the opponent-pace transport so the
client receives `t_sec[]` + `distance_m[]` directly and stops integrating
split → distance on every frame. Round out the flow so `Erneut rennen`
re-enters via Bereit (not directly into the live page), and finalise
ADR-0009 enforcement on both the client (hide warmup/cooldown toggles in
race mode) and backend (reject race workouts with non-zero
`warmup_sec`/`cooldown_sec`).

## User Stories

1. As a rower starting a 2k, I want to sit at the catch and tap **Bereit** when I'm settled, so the green light fires when I'm actually ready — not the moment the live page mounts.
2. As a rower on the Bereit screen, I want to see the distance and opponents I'm about to race against, so I can verify the setup before committing.
3. As a rower at the catch, I want the **Bereit** button to be large and forgiving to a sweaty fingertip, so I don't need to look down to tap it.
4. As a rower who taps Bereit, I want the FISA ATTENTION → SET → GO! ceremony to play (~3 s total) and dismiss itself, so the cue feels like a real start.
5. As a rower with reduced-motion enabled, I still want to see ATTENTION → SET → GO! text transitions (without pulsing animation), so I know exactly when the race starts.
6. As a rower, I never want the start cue skipped entirely, so reduced-motion does not regress my race start versus FEAT-0013.
7. As a rower who jumps the gun, I want a **Falschstart** toast and to keep my session open, so I am not punished by a hard restart — but the race clock and meters still start from GO!.
8. As a rower who false-started, I want the Falschstart toast to dismiss itself after ~2 s, so it doesn't linger over the canvas.
9. As a rower in the middle of a race, I want **no pause button** visible, so the UI matches the framing that a race is a competition unit.
10. As a rower who needs to stop, I want the abort control to still be available, so I can end the session with `summary_json.race = null`.
11. As a rower crossing the finish line, I want my result on screen immediately, so I can paddle down knowing the time without waiting for `session_end`.
12. As a rower paddling down past the finish, I want the result overlay to **stay latched** while my distance keeps advancing on the canvas, so the result does not re-compute past the cross.
13. As a rower in paddle-down, I want the canvas to remain visible behind the overlay, so the overlay feels like an addition rather than a screen change.
14. As a rower whose session has ended, I want the latched overlay to expand into the full `RacePostScreen` with the pace overlay chart and CTAs, so the post-flow is continuous from the finish horn.
15. As a rower who finished a race, I want the latched in-flight result and the persisted `summary.race` to agree on time and gaps within ±0.1 s, so I can trust whichever I see first.
16. As a rower who taps **Erneut rennen**, I want to land back on a **Bereit** screen with my prior distance and opponents pre-selected, so I get a deliberate restart with the ceremony.
17. As a rower comparing against a session-ghost whose source session included a warmup, I want the comparison to begin at the ghost's actual race start, so I don't see a phantom early lead/deficit.
18. As a rower comparing against an opponent from a session with no warmup, I want the behaviour unchanged, so the trimming pass is a true no-op.
19. As a rower racing a synth-ghost, I want the ghost to remain anchored at t=0 by construction, so synthetic curves are unaffected.
20. As a developer (race UI), I want opponent pace transport to be `t_sec[]` + `distance_m[]`, so I do not integrate split → distance on every frame.
21. As a developer (race UI), I want a direct distance-lookup helper for gap computation, so the old `gapAtTime` integration loop in `RaceLiveView` is replaced.
22. As a rower configuring a race in `ConfirmScreen`, I want warmup/cooldown toggles hidden, so the UI cannot lead me into a configuration that ADR-0009 forbids.
23. As a developer building a race workout via the backend, I want `POST /workouts` to reject race-mode workouts with non-zero warmup or cooldown (HTTP 400), so the invariant cannot be bypassed via the API.
24. As a rower whose phone screen locked mid-race, I want the home recovery card to offer **Finalize** and **Discard** only, so the race lifecycle stays simple and an interrupted race always finalises with `summary_json.race = null`.
25. As a rower, I want a finished race to either witness its own finish or not exist as a race result, so the framing of a race in CONTEXT.md is respected.
26. As a documentation reader, I want FEAT-0013 to be annotated where this PRD overrides it (race distance simplifies to "meters"; reduced-motion behaviour overridden), so future work doesn't reintroduce old behaviour.

## Implementation Decisions

The implementation breaks into a few deep modules and a handful of surgical
edits to existing components. The deep modules are deliberately chosen to be
testable in isolation against the rules captured in CONTEXT.md and the ADRs.

### Modules to introduce or extract

- **`raceLifecycle` state machine (new, web)** — A pure reducer over the
  states `Confirmed → Bereit → Ceremony{ATTENTION, SET, GO} → Live{NormalStart, Falschstart} → Finished{LatchedOverlay} → Post`.
  Inputs: ceremony ticks, stroke events, `session_end` event, abort. Outputs:
  the current state, `race_t0` timestamp, `falschstart` flag, latched
  result. The reducer never touches React; it is consumed by `RaceLiveView`
  / `BereitScreen` via a small hook. This is the natural place to encode
  the "first stroke during ATTENTION/SET opens session but `race_t0` =
  GO!" rule from CONTEXT.md, and the "result latches at
  `userDistanceM >= totalMeters`" rule.

- **`opponentSamples` trim/transport module (new, backend)** — Encapsulates
  the rule: given an opponent source (session-ghost, PB-leader,
  synth-ghost), produce parallel `t_sec[]` and `distance_m[]` arrays
  rebased so that `t_sec[0] == 0` corresponds to the opponent's
  work-segment start. For session-sourced opponents the leading
  warmup-covering samples are dropped; for warmup-free sources and
  synth-ghosts this is a no-op. Exposed via the existing
  `GET /api/v1/workouts/{id}/opponents` endpoint with the new transport
  shape.

- **`raceResultLatch` helper (new, web)** — A small pure function that, given
  the user's stroke stream and the opponent `distance_m[]` curves, returns
  the immutable race result at the moment the user crosses
  `totalMeters`: final time, final split, signed gap to each present
  opponent. Once produced, it does not recompute.

- **`opponentLookup` helper (new, web)** — Replaces the integration loop in
  `gapAtTime` (`web/src/race/RaceLiveView.tsx:68-86`). Given parallel
  `t_sec[]` + `distance_m[]` arrays and a user `(distance, time)` pair,
  return the signed gap via direct binary-search lookup.

- **`BereitScreen` component (new, web, `web/src/race/`)** — Full-bleed
  dark screen with the chosen distance + opponents summary line and a
  large primary `Bereit` button. Does not mount the live subscription;
  only on `Bereit` tap does the flow transition.

- **`FinishOverlay` component (new, web, `web/src/race/`)** — Slides in
  from the bottom over the canvas at finish-cross. Shows final time,
  final split, signed opponent gaps, `Paddelst aus...` copy. Does not
  unmount the canvas. On `session_end`, becomes / hands off to
  `RacePostScreen`.

### Modules to modify

- **`RaceLiveView`** — Drop the on-mount ceremony trigger. Subscribe to
  the `raceLifecycle` reducer. Hide the pause control via
  `workout.mode === 'race'`. Consume opponent `distance_m[]` directly and
  delete the internal `gapAtTime` integration in favour of
  `opponentLookup`. Render `FinishOverlay` when the reducer reports a
  latched result.

- **`RaceStartSequence`** — Reduced-motion path renders the same
  ATTENTION/SET/GO text transitions sans dot-pulse animations. It is
  never an empty render (regression fix vs FEAT-0013 lines 132–133).

- **`RacePostScreen`** — `Erneut rennen` CTA re-enters the race flow with
  prior distance + opponents pre-selected, landing on `BereitScreen`,
  not directly on the live page.

- **`ConfirmScreen` (`web/src/pages/workout/`)** — Hide warmup and
  cooldown toggles when `mode === 'race'`. The race state machine forces
  `warmupEnabled = cooldownEnabled = false`.

- **Backend `POST /workouts` handler** — Reject race-mode payloads with
  `warmup_sec > 0` or `cooldown_sec > 0`. Returns HTTP 400 with a clear
  message. No data migration required.

- **Home recovery card (per ADR-0012)** — For race rows, expose only
  Finalize and Discard; never `rejoin live`. Finalize-from-last-stroke
  for race rows explicitly sets `summary.race = null`.

### Interfaces and contracts

- `GET /api/v1/workouts/{id}/opponents` response shape for each present
  opponent (`ghost`, `pb`): `{ t_sec: number[], distance_m: number[] }`.
  The `split[]` field is removed. Arrays are parallel, monotonically
  non-decreasing in `t_sec`, with `t_sec[0] === 0` aligned to the
  opponent's work-segment start.
- `POST /workouts` invariant: `mode === 'race' ⇒ warmup_sec === 0 && cooldown_sec === 0`.
- Race lifecycle state machine, summarised (extracted from the spec's AC
  set, not a runnable snippet):

  ```text
  Confirmed --confirm--> Bereit
  Bereit --tap--> Ceremony(ATTENTION) --1500ms--> Ceremony(SET) --1500ms--> Ceremony(GO!)
  Ceremony(*) --stroke--> Live(Falschstart, session_start=stroke, race_t0=pending-GO)
  Ceremony(GO!) --1500ms--> Live(NormalStart, session_start=first-post-GO-stroke, race_t0=GO)
  Live --userDistance>=total--> Finished(latched)
  Finished --session_end--> Post
  Live|Finished --abort--> Aborted(summary.race=null)
  ```

### Architectural decisions worth re-stating

- `race_t0` is a first-class concept distinct from `session_start` (CONTEXT.md).
- Falschstart does *not* discard the session; it discards pre-GO meters and seconds from race-distance/race-time only.
- Race lifecycle is non-resumable (ADR-0012). All recovery paths for race rows finalise with `summary.race = null`.
- The race result is **deterministic at finish-cross** and is latched in
  client state at that instant. Backend re-derivation at `session_end`
  must agree within ±0.1 s.

## Testing Decisions

A good test here exercises observable external behaviour: state
transitions, rendered text, persisted payloads, HTTP responses. It does
not assert on private reducer fields, internal effect ordering, or
specific component internals. Where the behaviour is timing-sensitive
(the 1.5 s ceremony steps, the 4.5 s ceremony auto-dismiss, the
finish-overlay slide-in), tests drive time with a fake clock rather than
real waits.

### Modules to test (priority order)

1. **`raceLifecycle` reducer** — Unit tests covering every transition in
   the state diagram above: clean start, Falschstart on each ceremony
   step, finish-cross while still rowing, abort from each state, and
   `session_end` arrival before/after finish-cross. This is the deepest
   module and the highest-leverage place to spend test budget.
2. **`opponentSamples` trim module (backend, Go)** — Table-driven test:
   session with `warmup_sec=0` (no-op), session with `warmup_sec>0`
   (drops leading samples, rebases `t_sec[0]=0`), synth-ghost (untouched).
   Asserts on returned arrays — parallel, monotone, rebased.
3. **`raceResultLatch` + `opponentLookup` helpers** — Pure-function unit
   tests. Inputs: synthetic `t_sec[]`/`distance_m[]` curves; outputs:
   expected signed gaps at chosen `(distance, time)` points. Includes
   edge cases: `userDist <= 0`, `userDist >= last`, and a stroke exactly
   at the finish line.
4. **`POST /workouts` race-mode validator (backend, Go)** — Two cases:
   accept race with both warmup/cooldown at 0; reject race with non-zero
   warmup (HTTP 400), reject race with non-zero cooldown (HTTP 400).
5. **`BereitScreen` → ceremony → live mount** — Component/integration
   test asserting that no live subscription opens before `Bereit` tap,
   the ATTENTION/SET/GO sequence renders, and on GO! the live view
   mounts. Reduced-motion variant asserts that the text transitions
   still render (no empty cue).
6. **`FinishOverlay` latch behaviour** — Component test driving the
   reducer to the finish-cross state and asserting that the overlay
   appears over the canvas, the canvas remains mounted, and the
   displayed time/gaps do not recompute while strokes continue to flow
   in.
7. **Round-trip parity** — Integration test (web + backend) ensuring the
   latched in-flight result and the persisted `summary.race` agree on
   time and gaps within ±0.1 s for a representative race.

### Prior art

- Go table-driven tests like `backend/internal/session/phaseplan_test.go`
  are the model for the `opponentSamples` trim tests.
- `web/src/race/RaceCanvas.test.tsx`, `RaceLiveView.test.tsx`, and
  `RacePostScreen.test.tsx` are the prior art for the new component
  tests (same testing library, same module-CSS setup).
- The replay harness (cmd/replay, recent FEAT-0015 slice 6) is the
  appropriate place to add the round-trip parity test, since it already
  reasons about stroke streams end-to-end and is deterministic.

## Out of Scope

- Multiplayer / live opponents (v2+).
- New synth-ghost curve shapes — a separate FEAT will tackle pacing curves.
- False-start penalty modelling (e.g. DSQ on a second false start). v1 only
  shows the Falschstart toast.
- Camera zoom-out / canvas re-frame at finish — revisit after this polish pass.
- Coaching cues, pace-boat opponent type, custom distances — unchanged from
  FEAT-0013 non-goals.
- A "rejoin live" recovery path for race rows — explicitly ruled out by
  ADR-0012.
- Data migration of legacy race rows — none exist in production.

## Further Notes

- All open questions raised in FEAT-0014 were resolved in the 2026-05-12
  grilling session. The substantive decisions live in:
  - CONTEXT.md (Race t=0, Falschstart, Bereit, start ceremony,
    finish horn, stale-open session for races).
  - ADR-0012 (race-mode non-resumability).
  - The AC list in `specs/feat/0014-race-mode-cleanup.md`, which this PRD
    organises into modules and tests.
- FEAT-0013 should be annotated alongside this work: race distance copy
  simplifies to "meters" (line 54), and the reduced-motion behaviour on
  lines 132–133 is overridden by this PRD.
- The opponent transport shape change is observable across the web/back
  boundary; merging the backend change before the web change will break
  the existing client, so coordinate the two slices (backend first,
  then a single web slice that switches consumers to `distance_m[]`).
- There is no GitHub remote on this repository; this PRD is published
  under `.scratch/race-mode-cleanup/` per `docs/agents/issue-tracker.md`.
  The `ready-for-agent` label is recorded as the `Status:` line at the
  top of the file.
