# FEAT-0014: Race Mode Cleanup (Bereit, Finish Horn, Pause Removal, Polish)

- **Status**: Draft
- **Owner**: @gloeckner
- **Depends on**: FEAT-0013 (Race Mode), ADR-0009 (Race excludes
  warmup/cooldown)

## Summary

A polish pass on FEAT-0013 that pulls the race mode into a coherent
competition unit: a deliberate **Bereit** ready state with the start
ceremony, an **at-finish-cross** result overlay, **no pause** during
the race, and several smaller integration fixes (opponent-sample
trimming, reduced-motion start cue, `Erneut rennen` flow,
opponent-pace transport shape).

## User stories

- As a rower starting a 2k, I want to sit at the catch and tap
  **Bereit** when I'm settled, so the green light fires when I'm
  actually ready — not the moment the live page mounts.
- As a rower crossing the finish line, I want my result on screen
  immediately, so I can paddle down knowing the time without waiting
  for the session to end.
- As a rower mid-race, I want there to be **no pause button** — a
  race is a race; if I stop, I abort.
- As a rower with reduced-motion enabled, I still want a visible
  ATTENTION → SET → GO! cue so I know when the race starts.
- As a rower whose ghost was a session that included its own warmup,
  I want the comparison to start from the ghost's actual race start,
  not from minute zero of the source session.

## Acceptance criteria

### Bereit + start ceremony (replaces "ceremony fires on mount")

- [ ] After the opponent picker confirms, the flow lands on a
      **Bereit am Catch** screen rather than directly on the live
      page. No live-data subscriptions yet.
- [ ] The Bereit screen shows the chosen distance, opponents, and a
      large primary `Bereit` button.
- [ ] Tapping `Bereit` plays the FISA traffic-light ceremony
      (ATTENTION → SET → GO!, total 3 s; auto-dismisses at 4.5 s).
- [ ] On GO!, the live page mounts and starts subscribing. The
      rower's first stroke = `session_start` = race t=0.
      *(Superseded by ADR-0013 for the canvas + opponent fetch only: the
      `RaceCanvas` and `useRaceData` opponent fetch now mount at
      Ceremony(ATTENTION) so the rower can orient. The visible boat
      stays parked at distance 0 until GO! fires. The live-stroke
      subscription and `session_start`/race t=0 semantics are
      unchanged.)*
- [ ] If the rower strokes during ATTENTION/SET (i.e. before GO!),
      that stroke still opens the session but a small toast notes
      `Falschstart` and t=0 remains the GO! moment (clock starts
      from there; pre-GO meters discarded from race-distance).
- [ ] Reduced-motion: the same ATTENTION/SET/GO text transitions
      render without dot pulse animations. The cue is **never**
      skipped entirely (regression vs FEAT-0013 line 132-133).

### Finish horn (immediate result overlay)

- [ ] The instant `userDistanceM >= totalMeters`, the race result is
      latched in client state and a result overlay appears on top of
      the canvas (does not unmount the canvas).
- [ ] The overlay shows: final time, final split, signed gap to each
      present opponent. Status copy: `Paddelst aus...`.
- [ ] The rower may continue rowing freely. Their `distance_m`
      continues advancing on the canvas but the race result remains
      latched (no re-computation past the finish).
- [ ] When `session_end` arrives, the overlay expands to the full
      `RacePostScreen` (pace overlay chart, CTAs).
- [ ] The latched in-flight result and the persisted `summary.race`
      payload must agree on time and gaps within ±0.1 s.

### No pause during race

- [ ] Live page hides the pause control when `workout.mode === 'race'`.
- [ ] The abort control remains. Aborting before the finish horn
      records the session normally with `summary_json.race = null`
      (unchanged from FEAT-0013).

### Opponent-sample trimming

- [ ] `GET /api/v1/workouts/{id}/opponents` returns opponent samples
      that start at the **opponent's work-segment start**, not their
      `session_start`. For session-sourced opponents whose source
      session has `warmup_sec > 0`, the leading samples covering the
      warmup are dropped and `t_sec[]` is rebased to 0 at the work
      start.
- [ ] For opponents from sessions with no warmup (or after ADR-0009
      takes effect), this is a no-op.
- [ ] Synth-ghost is unchanged (always starts at t=0 by construction).

### Opponent-pace transport shape

- [ ] The `ghost` and `pb` payloads return parallel `t_sec[]` and
      `distance_m[]` arrays directly (instead of `t_sec[]` +
      `split[]`). The client no longer integrates split → distance.
- [ ] `RaceLiveView` / `RaceCanvas` consume `distance_m[]` directly
      for opponent positioning at a given `t_sec`. The existing
      `gapAtTime` helper in `RaceLiveView.tsx:68-86` is replaced with
      a direct lookup.

### `Erneut rennen` flow

- [ ] The `Erneut rennen` CTA on `RacePostScreen` re-enters the race
      flow with the same distance and opponents pre-selected, landing
      on the **Bereit** screen — not directly on the live page. The
      ceremony plays again on the next Bereit tap.

### ADR-0009 follow-through

- [ ] `ConfirmScreen` hides warmup/cooldown toggles when
      `mode === 'race'`. Race state-machine forces
      `warmupEnabled = cooldownEnabled = false`.
- [ ] Backend `POST /workouts` rejects race-mode workouts with
      non-zero `warmup_sec` or `cooldown_sec` (HTTP 400).
- [ ] FEAT-0013 spec is annotated: line 54 simplifies to "meters",
      line 132-133 reduced-motion behavior is overridden by this
      FEAT.

No data migration is required — there are no legacy race-mode rows
with non-zero warmup/cooldown in production.

## UX notes

- Bereit screen is full-bleed dark, centered button, large enough
  for a sweaty finger. Distance + opponents shown above the button
  in a single line so the rower verifies before committing.
- Falschstart toast appears top-center, dismisses at 2 s, copy
  `Falschstart — Uhr läuft ab GO!`.
- Finish overlay slides in from bottom 200 ms, sits at ~40% viewport
  height while canvas remains visible above.

## Non-goals

- Multiplayer / live opponents (still v2+).
- Synth-ghost curve shapes (separate FEAT).
- False-start penalty modeling (e.g. DSQ on a second false start).
  v1 just shows the toast.
- Camera zoom-out at finish (revisit later).
- Coaching cues, pace-boat opponent type, custom distances —
  unchanged from FEAT-0013 non-goals.

## Open questions

All open questions resolved during the 2026-05-12 grilling session.
See decisions captured in this spec's AC, in CONTEXT.md (Race t=0,
Falschstart, stale-open recovery), and in ADR-0012 (race-mode
non-resumability).
