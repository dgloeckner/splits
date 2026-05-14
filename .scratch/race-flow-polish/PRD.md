# PRD-0015: Race-flow polish (second pass)

Status: ready-for-agent

- **Owner**: @gloeckner
- **Depends on**: FEAT/PRD-0014 (Race Mode Cleanup), ADR-0009 (race excludes
  warmup/cooldown), ADR-0012 (race-mode non-resumable),
  **ADR-0013 (race canvas mounts at Ceremony(ATTENTION))**
- **Date**: 2026-05-14

## Problem Statement

After PRD-0014 shipped, a hands-on pass through race mode surfaced a small
cluster of UX gaps that together break the "one coherent competition unit"
framing the prior PRD aimed for. Specifically:

- After GO! and before the first stroke, the rower sees a **black canvas
  with only the stat bar above it**. The track does not render and no
  boats are visible. The race appears not to have started.
- There is **no way to stop a race** mid-flight. Pause was correctly
  hidden by PRD-0014, but no abort affordance was added to the race
  surface, so a rower who wants to wave off has no UI.
- The GO! transition is **visually disrupted**: BereitScreen → ceremony
  full-bleed → canvas mount happens in a single frame, producing a
  noticeable swap rather than a continuous moment.
- The **Intensität** picker title gives no clue what it actually
  controls, and the meaning is in fact mode-dependent (target Split/SPM
  bracket in distance/time mode; synthetic-ghost target split in race
  mode). The rower has to know.
- The pre-race screen sequence has **inconsistent step numbering** —
  `1/2` and `2/2` on the pickers, then three further unnumbered screens
  (Confirm, opponent picker sheet, BereitScreen) — and the Confirm
  screen's title is literally the word **"Bereit"**, colliding with the
  separately-named BereitScreen the prior PRD introduced. The
  configuration phase feels longer and more confused than it needs to be.

## Solution

Land a focused second pass on race mode that:

1. Restores the visible **race track and boats** before the rower's first
   stroke by fixing the live-page height collapse, then mounts the canvas
   from **Ceremony(ATTENTION)** onward — with the ceremony overlaid on
   the still canvas — so GO! produces no mount/swap flash (per
   ADR-0013).
2. Adds a small **Abbrechen** pill to the top-right of the race surface,
   visible from Bereit through Finished, that opens a confirmation sheet
   and dispatches the existing reducer `abort` event — producing a
   normal session record with `summary.race = null`.
3. Adds a **mode-aware subtitle** to the Intensität picker so the rower
   knows whether they are choosing their own target pace or the synthetic
   ghost's pace.
4. **Consolidates the pre-race flow** by merging the opponent-picker
   sheet into the Confirm screen and renaming the Confirm header from
   "Bereit" to "Übersicht", eliminating the collision with BereitScreen.
   Step numbering (`1/2`, `2/2`) remains only on the two pickers; Confirm
   and BereitScreen are unnumbered because they are commitment beats,
   not configuration steps.

## User Stories

1. As a rower who has just seen GO! and is about to take the first
   stroke, I want to see the race track and my boat parked at the start
   line, so the race feels like it has actually begun.
2. As a rower on the live page, I want the canvas region to fill the
   space below the stat bar at any viewport size, so the boats and lanes
   are visible.
3. As a rower at the catch during ATTENTION/SET, I want the race track
   already rendered behind the ceremony overlay, so GO! does not
   visually swap screens.
4. As a rower who false-started during ATTENTION/SET, I want my visible
   boat to stay at the start line until GO!, so the canvas does not
   contradict the Falschstart rule that pre-GO meters are excluded.
5. As a rower who has just hit GO!, I want opponents (ghost, PB) to be
   visible at the start line on the first frame, so I don't see a
   single-second "no opponents" flicker before the data loads.
6. As a rower mid-race, I want a clearly visible abort control, so I can
   stop the race if I have to, without having to remember a gesture.
7. As a rower on the Bereit screen, I want the same abort control
   available, so I can change my mind before the ceremony fires.
8. As a rower during the start ceremony, I want the abort control still
   reachable above the ceremony overlay, so I can wave off mid-countdown.
9. As a rower who taps the abort control, I want a confirmation sheet
   ("Rennen abbrechen?"), so I don't kill my race by accidentally
   tapping the pill.
10. As a rower who confirms abort, I want my session recorded but with
    `summary.race = null`, so the session is preserved as a paddle but
    not falsely counted as a finished race (unchanged from PRD-0014).
11. As a rower who cancels the abort confirmation, I want to return to
    exactly the prior race state with no clock or position disturbance,
    so the affordance is safe to tap exploratorily.
12. As a rower configuring intensity for a distance or time workout, I
    want the picker to tell me intensity sets my own target Split/SPM
    bracket, so I understand what the live stat bar will compare me to.
13. As a rower configuring intensity for a race, I want the picker to
    tell me intensity sets the **synthetic ghost's** target pace, so I
    understand whether I am picking my own difficulty or my opponent's.
14. As a rower configuring a race, I want the opponent toggles
    (synth-ghost-by-intensity, PB) on the same screen as the
    distance/intensity summary and Start button, so I do not have to
    pass through an extra modal sheet.
15. As a rower on the configuration confirmation screen, I want the
    header to be **Übersicht** (not "Bereit"), so it does not collide
    with the separately-named BereitScreen that comes later.
16. As a rower stepping through configuration, I want the step indicator
    (`1/2`, `2/2`) only on the picker screens, so Confirm and Bereit
    read as commitment beats, not as a continuation of the picker flow.
17. As a rower on the Übersicht screen who toggles synth-ghost off, I
    want a small inline note saying intensity will not affect this race,
    so I don't wonder why I picked it.
18. As a developer reading the race flow source, I want CONTEXT.md and
    ADR-0013 to state clearly when the canvas mounts vs when the live
    stroke subscription opens, so I don't reintroduce a GO!-gated mount.
19. As a developer extending race mode, I want abort UX to be owned by
    `RaceFlow`, so individual phase components (BereitScreen,
    RaceLiveView, etc.) do not need to know about abort.
20. As a developer adjusting the Intensität picker, I want the mode-aware
    copy to live in the picker component (not hidden in a shared utility),
    so the per-mode meaning is discoverable from the file the user sees.
21. As a rower with reduced-motion enabled, I want the canvas-behind-
    ceremony transition to remain calm — no extra animation introduced
    by the new wiring — so the regression fix from PRD-0014 stays
    correct.

## Implementation Decisions

The work breaks into one CSS fix, two surgical UI additions, one flow
consolidation, and a small documentation pass.

### Modules to modify or extract

- **`LivePage` page-level CSS.** The `.page` grid currently has no
  explicit height; race-mode's inner `grid-template-rows: 56px 1fr`
  collapses the `1fr` canvas pane to 0px. Give `.page` a viewport-based
  fill (e.g. `min-height: 100dvh` — `dvh` over `vh` so mobile chrome
  doesn't truncate). No non-race impact: non-race children already
  define intrinsic heights. This is a one-line bug fix that should
  land first.

- **`RaceFlow` (re-wire canvas mount).** Broaden the live-stage gate
  so the canvas and `useRaceData` opponent fetch mount from
  `Ceremony(ATTENTION)` onward. The ceremony continues to render as an
  overlay; but the canvas now sits *behind* it from the start. The
  **live stroke subscription** (i.e. the dispatch of stroke events into
  the reducer) remains gated on GO! — pre-GO strokes still trigger
  Falschstart in the reducer, but no stroke advances the visible boat.
  This is the wiring decision recorded in **ADR-0013**.

  Sketch of the new gating rule, distilled from the reducer + RaceFlow:

  ```text
  canvas + opponent fetch:   mount at Ceremony(ATTENTION)  (this PRD, ADR-0013)
  ceremony overlay:          render during Ceremony(*)
  stroke dispatch → reducer: dispatch during Ceremony(*) and Live and Finished
  visible boat advance:      gated on race_t0 (GO!) — pre-GO strokes excluded
  ```

- **`AbortControl` (new, web).** A small component owned by `RaceFlow`
  that renders a top-right **Abbrechen** pill plus a confirmation sheet.
  Tapping the pill opens the sheet; confirming dispatches the existing
  reducer `abort` event and unmounts the race surface in favour of the
  Aborted terminal state (which the existing summary path renders as
  `summary.race = null`). The pill sits above the ceremony overlay's
  z-index so it is reachable mid-countdown. It is absent on the Post
  screen (the race has already ended).

- **`Step3Intensity` (mode-aware subtitle).** Add a subtitle slot under
  the "Intensität" title that reads, by mode:
  - **race** → *"Wie schnell dein synthetischer Geist rudert."*
  - **non-race** → *"Dein Zieltempo — Split und Schlagzahl auf der Live-Anzeige."*
  The mode is already available via `WorkoutFlowProvider`. The per-card
  Split/SPM bracket numbers stay unchanged — the subtitle reframes
  their meaning.

- **`ConfirmScreen` (consolidation + rename).**
  - Rename the screen header from "Bereit" to **"Übersicht"** for race
    mode (non-race retains whatever it currently shows — investigate
    whether the collision exists there too; if not, the rename is
    race-scoped).
  - Inline the opponent toggles (currently a separate sheet — "500 m
    Rennen" with `Synthetischer Geist nach Härte` and `Bestzeit`
    checkboxes) directly onto Übersicht. The sheet is removed.
  - Drop the step indicator on this screen (it was already absent;
    confirm it stays absent).
  - When synth-ghost is toggled off, render an inline note: *"Intensität
    wirkt sich nicht aus."* — informational only, no state change.

- **Opponent picker sheet (remove).** The `500 m Rennen` modal that
  appears between the Start button and the BereitScreen is removed.
  Its responsibilities (the two opponent toggles + the "Rennen starten"
  confirmation) collapse into Übersicht and the existing flow's Start
  → BereitScreen transition.

- **Step indicator.** Confirm the picker screens keep `1/2` / `2/2` and
  that the format/spacing matches. Übersicht and BereitScreen carry no
  step indicator. The ceremony, by definition, has none.

### Doc updates

- **CONTEXT.md** has already been updated under §Start ceremony,
  §Bereit (am Catch), and §Pause/Abort to reflect Q2/Q3/Q5 decisions
  from the 2026-05-14 grilling. No further CONTEXT.md edits expected.
- **ADR-0013** is in `Accepted` status. Reference it from the
  implementation PR description and from the FEAT-0014 PRD's
  "Further Notes" section.

### Interfaces and contracts

- `RaceFlow` props are unchanged.
- The `raceLifecycle` reducer's event surface is unchanged — `abort` and
  `Aborted` already exist.
- The opponent-picker sheet's removal eliminates the `race-opp-selection`
  flow that read/wrote from sessionStorage in the prior PRD's
  `Erneut rennen` path; the selection now flows directly from Übersicht
  state. Behaviour of `Erneut rennen` (re-enters via BereitScreen with
  prior distance + opponents pre-selected) is preserved.

### Architectural decisions re-stated

- Canvas + opponent fetch mount at `Ceremony(ATTENTION)` (ADR-0013).
- Live stroke subscription gates on GO! (unchanged from PRD-0014).
- Falschstart semantics unchanged: pre-GO strokes open the session but
  pre-GO meters/seconds are excluded from race-distance/race-time.
- Abort affordance lives on the race surface and is owned by `RaceFlow`.
- Übersicht is the canonical name for the race configuration's
  confirmation screen; **Bereit** is reserved for the at-the-catch
  ready screen.

## Testing Decisions

A good test here exercises observable external behaviour: what the rower
sees on each phase of the flow, whether the abort sheet opens and dismisses
correctly, whether opponent fetch fires at the right phase. It does not
assert on private reducer fields or internal effect ordering.

### Modules to test (priority order)

1. **Canvas-behind-ceremony wiring (`RaceFlow` integration test).** Drive
   the reducer with a fake clock through `Bereit → Ceremony(ATTENTION)
   → SET → GO! → Live`. Assert: the canvas is mounted at ATTENTION
   (not just at GO!); `useRaceData` is called at ATTENTION (not before);
   the ceremony renders as an overlay while the canvas is also rendered;
   no stroke event is dispatched into the reducer until GO!.

2. **`AbortControl` component test.** Render the pill in each phase
   (Bereit, Ceremony, Live, Finished); tap → confirm sheet opens; tap
   confirm → reducer receives `abort`; tap cancel → reducer untouched.
   Assert the pill is absent on Post.

3. **Falschstart preservation under canvas-behind-ceremony.** Existing
   `raceLifecycle.test.ts` cases for Falschstart at ATTENTION/SET stay
   green. Add a `RaceFlow` integration assertion that the visible boat
   stays at distance 0 until GO!, even if a stroke event during
   ATTENTION/SET would otherwise advance it.

4. **`Step3Intensity` subtitle test.** Render in race mode → assert
   the synth-ghost subtitle string is present. Render in
   distance/time mode → assert the target-bracket subtitle string.

5. **Confirm screen consolidation test.** Render `Übersicht` with
   distance + intensity pre-filled; assert the opponent toggles
   render inline (no separate sheet); toggle synth-ghost off → assert
   the "Intensität wirkt sich nicht aus." note appears; Start →
   navigates to BereitScreen with the toggled selection preserved.

6. **LivePage height regression guard.** Render `LivePage` in race mode
   inside a sized container; assert the canvas region's computed
   height > 0. (Catches a future change that re-introduces the grid
   collapse.)

### Prior art

- `web/src/race/RaceFlow.test.tsx` — drives the reducer with fake
  ticks; the new ATTENTION-mount assertion belongs here.
- `web/src/race/raceLifecycle.test.ts` — pure reducer tests for
  Falschstart; extend with one more invariant case if needed.
- `web/src/race/BereitScreen.test.tsx`, `RaceStartSequence.test.tsx`,
  `FinishOverlay.test.tsx` — pattern for surface-level component tests.
- `web/src/pages/workout/ConfirmScreen.test.tsx` and
  `Step3Intensity.test.tsx` (if it exists; otherwise the pattern lives
  in `Step1Mode.test.tsx`) — pattern for the configuration screen
  tests.

## Out of Scope

- Multiplayer or live opponents.
- New synth-ghost curve shapes (a separate FEAT will tackle pacing
  curves).
- DSQ on a second false start.
- Camera/zoom changes at finish.
- Coaching cues.
- A "rejoin live" recovery path for race rows — explicitly ruled out by
  ADR-0012.
- Any change to the FISA timing (1.5 s ATTENTION → SET → GO!).
- Any change to the existing Falschstart toast copy or auto-dismiss.

## Further Notes

- All five decisions in this PRD were resolved in the 2026-05-14
  grilling session. The substantive decisions live in:
  - **CONTEXT.md** (Bereit collision note, canvas-at-ATTENTION rule,
    abort affordance).
  - **ADR-0013** (canvas mounts at ATTENTION, live subscription at GO!).
- The opponent transport (PRD-0014 / 0014-01) and finish latch
  (PRD-0014 / 0014-06) decisions are unaffected by this PRD.
- This repo has no GitHub remote; this PRD is published under
  `.scratch/race-flow-polish/` per `docs/agents/issue-tracker.md`.
- Suggested implementation order — there is light coupling between
  slices, so they can mostly be done in parallel, but the LivePage CSS
  fix should land first because it unblocks visual verification of the
  canvas-behind-ceremony work:
  1. LivePage CSS fix (one-line).
  2. RaceFlow canvas-at-ATTENTION (ADR-0013) — visual continuity.
  3. AbortControl + confirm sheet — wired into RaceFlow.
  4. Step3Intensity mode-aware subtitle.
  5. ConfirmScreen consolidation + rename + opponent-sheet removal.
