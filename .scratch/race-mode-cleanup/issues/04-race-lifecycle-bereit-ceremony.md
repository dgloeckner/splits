# 0014-04 — `raceLifecycle` reducer, `BereitScreen`, ceremony-on-tap

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0014](../PRD.md)

## What to build

Replace "ceremony fires on live-page mount" with a deliberate Bereit am
Catch flow, encoded in a pure state-machine reducer.

- Extract a `raceLifecycle` reducer with states
  `Confirmed → Bereit → Ceremony{ATTENTION, SET, GO} → Live{NormalStart, Falschstart} → Finished{LatchedOverlay} → Post`,
  plus an `Aborted` terminal. Inputs: ceremony ticks, stroke events,
  `session_end`, abort. Outputs: current state, `race_t0`, `falschstart`
  flag, latched result placeholder. The reducer is pure — no React.
- Add `BereitScreen` (full-bleed dark, centred large `Bereit` button,
  single-line distance + opponents summary). No live subscription
  opens before `Bereit` is tapped.
- `RaceLiveView` mounts on `GO!`, subscribes to live data, and reads
  reducer state via a small hook.
- Falschstart: a stroke during ATTENTION/SET still opens the session
  (`session_start` = that stroke), `race_t0` remains the GO! moment,
  pre-GO meters and seconds are discarded from race-distance and
  race-time. A top-centre toast renders the copy
  `Falschstart — Uhr läuft ab GO!` and auto-dismisses at ~2 s.
- Reduced-motion: `RaceStartSequence` renders the ATTENTION/SET/GO text
  transitions without dot-pulse animations. The cue is **never** an
  empty render — this is a regression fix versus FEAT-0013 lines
  132–133.

State machine summary (from the PRD; not a runnable snippet):

```text
Confirmed --confirm--> Bereit
Bereit --tap--> Ceremony(ATTENTION) --1500ms--> Ceremony(SET) --1500ms--> Ceremony(GO!)
Ceremony(*) --stroke--> Live(Falschstart, session_start=stroke, race_t0=pending-GO)
Ceremony(GO!) --1500ms--> Live(NormalStart, session_start=first-post-GO-stroke, race_t0=GO)
Live --userDistance>=total--> Finished(latched)   # latch logic lives in 0014-06
Finished --session_end--> Post                    # post-screen handoff lives in 0014-06
Live|Finished --abort--> Aborted(summary.race=null)
```

## Acceptance criteria

- [ ] Opponent picker confirm lands on `BereitScreen`, not on the live page.
- [ ] `BereitScreen` shows the chosen distance and opponents above a large primary `Bereit` button.
- [ ] No live-data subscription is opened until `Bereit` is tapped.
- [ ] Tapping `Bereit` plays ATTENTION → SET → GO! (≈3 s total, auto-dismiss at 4.5 s).
- [ ] On `GO!`, the live view mounts and starts subscribing; the rower's first post-GO stroke sets `session_start` and `race_t0`.
- [ ] Strokes during ATTENTION/SET open the session at that stroke, render the Falschstart toast, and pin `race_t0` to GO!.
- [ ] Pre-GO meters and seconds are excluded from race-distance and race-time.
- [ ] Reduced-motion path renders the ATTENTION/SET/GO text transitions sans dot-pulse — never an empty cue.
- [ ] `raceLifecycle` reducer has unit tests for every transition (clean start, Falschstart per ceremony step, abort per state, finish-cross stub).

## Blocked by

None — can start immediately.
