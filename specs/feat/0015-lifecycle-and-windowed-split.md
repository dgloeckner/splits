# FEAT-0015: Rowing-Session Lifecycle, Phase-Aware UX, and Windowed Live Split

- **Status**: Ready-for-agent
- **Owner**: @dg
- **Depends on**: ADR-0010 (lifecycle + resumability, Accepted 2026-05-10),
  ADR-0011 (replay-grade persistence + windowed split, Accepted 2026-05-10);
  partially supersedes the stroke-compaction part of ADR-0008
- **Source PRD**: `.scratch/lifecycle-and-split-fixes/PRD.md`

## Summary

Three coordinated changes to the live rowing experience, captured from a
real 5K row on the Pi where the phone power-saved during cooldown, the
end-event silently failed, and the session was lost:

1. **Phase-aware lifecycle.** `Phase` (warmup / work / cooldown) drives
   end-of-session, abort-prompt suppression, and live UX. Cooldown elapse
   finalizes the session in place.
2. **Resumable session-end.** Wake-lock for the duration of every session;
   failed end-events enter a localStorage retry queue; backend janitor flags
   stale-open sessions; home page surfaces a "Frühere Session abschließen?"
   card.
3. **Windowed live split + replay-grade persistence.** The current-split
   tile is computed over a sliding 5 s window with sparse-window `held`
   fallback. Strokes are no longer deleted at session-end. A new
   `cmd/replay` tool replays a session through the live reducer for
   formula validation.

A persistent `<workDistanceM> / <targetM> m` badge under the progress strip
(plus an opt-in "Distance to go" tile) eliminates the
hardware-vs-app-distance confusion that caused the user to stop early.

## User stories

1. As a rower mid-cooldown, I want the app to *not* pop "Workout beenden?"
   while I'm doing my paddle-down.
2. As a rower, I want my cooldown to end the session automatically when its
   planned time elapses.
3. As a rower in cooldown, I want a big countdown showing time left.
4. As a rower in warmup, I want the same big countdown for warmup.
5. As a rower mid-cooldown who needs to stop now, I want a clearly
   accessible ✕ button that opens the existing
   Speichern / Weiter / Verwerfen sheet.
6. As a rower whose phone would normally power-save mid-row, I want the
   app to hold the screen on for the duration of the session.
7. As a rower whose phone *did* lock and broke the connection, I want my
   pending session-end to retry when the page comes back up.
8. As a rower returning after a stranded session, I want a "Frühere
   Session abschließen?" card on the home page.
9. As a rower glancing at the current-split tile, I want the number to be
   as smooth and consistent as my IPM hardware display.
10. As a rower in the recovery between strokes, I want the live split to
    hold its previous value rather than jump to nonsense.
11. As a rower doing a 5000 m work phase, I want a clearly visible
    `<rowed> / 5000 m` indicator under the progress strip — work-segment
    distance, not hardware total.
12. As a rower customising my dashboard, I want the option to add a
    "Distance to go" tile.
13. As a rower finishing my workout, I want the Session-beendet results
    overlay to appear in place when cooldown ends.
14. As a rower doing FreeRow / Just Row (no phases), I want the existing
    pause dialog to keep working unchanged.
15. As a developer investigating a stat discrepancy, I want a `cmd/replay`
    tool that re-feeds a session's strokes through the live reducer.
16. As a developer adjusting the live-split window, I want past sessions'
    strokes still in the database for validation.
17. As a maintainer worried about disk usage, I want indefinite stroke
    retention bounded by hard-delete and (eventually) an annual prune ADR.
18. As a rower whose connection drops mid-work-phase, I want a visible
    actionable toast for the failed `endSession`.
19. As a rower tapping "Weiter rudern" on the stale-open card, I want to
    land back in the live view with that `session_id` reattached.

## Vertical slices (tracer bullets)

Each slice cuts end-to-end through every layer it touches and is demoable
on its own. All slices are AFK unless noted.

### Slice 1 — Phase-aware auto-end & countdown UX

**Modules**: M1 (`session/phaseplan` emits `session_end` on `PhaseDone`),
M6 (`PauseDialog` phase-gate on `currentPhase === 'work'`),
M7 (`PhaseCountdownView`), M8 (`SessionEndedOverlay` no-nav on auto-end).

**User stories**: 1, 2, 3, 4, 5, 13, 14.

**Blocked by**: none.

**Acceptance criteria**:

- [ ] A structured Distance-mode workout that crosses cooldown emits
      `KindSessionEnd` exactly once, with `ended_at = now()`, when
      classification reports `PhaseDone`.
- [ ] PauseDialog does not auto-open during warmup or cooldown.
- [ ] The ✕ trigger in `WorkoutProgressStrip` opens the
      Speichern / Weiter / Verwerfen sheet in any phase.
- [ ] During warmup or cooldown, `LivePage` renders `PhaseCountdownView`
      (mm:ss countdown + phase label) instead of dashboard tiles.
- [ ] On phase-driven auto-end, `SessionEndedOverlay` shows on the live
      page in place; "Neue Session starten" returns to home rather than
      LivePage navigating proactively.
- [ ] FreeRow / Just Row sessions (no phases) retain today's pause-dialog
      behaviour.
- [ ] Sessionizer test fixtures cover phase-end emission across each
      boundary; `PauseDialog` test extension covers phase-gate.

### Slice 2 — Wake lock + endSession retry queue

**Modules**: M4 (`web/useWakeLock`), M5 (`web/endSessionQueue`).

**User stories**: 6, 7, 18.

**Blocked by**: none.

**Acceptance criteria**:

- [ ] `useWakeLock` requests `navigator.wakeLock.request('screen')` on
      session start; re-requests on `visibilitychange === 'visible'`;
      failures are logged but non-blocking.
- [ ] `endSessionQueue` is a pure module (no React) that owns a
      localStorage-backed queue keyed by `session_id`, exposing
      `enqueue(sessionId)` and `processPending()`.
- [ ] `processPending()` runs on app start and on `online` events.
- [ ] All call sites that currently do
      `void endSession().catch(() => {})` (PauseDialog, WorkoutProgressStrip)
      route through the queue.
- [ ] Persistent failures surface a toast.
- [ ] Successful drains invalidate the sessions query.
- [ ] Unit tests cover: success drains the queue; failure leaves the
      entry; duplicate enqueues collapse; app-start drains prior-run
      entries; toast on persistent failure.

### Slice 3 — Stale-open session resumption

**Modules**: M2 (`storage/staleJanitor`), M3 (resume API),
M9 (`web/StaleSessionCard`).

**User stories**: 8, 19.

**Blocked by**: none.

**Acceptance criteria**:

- [ ] A 1-minute janitor sweep marks `sessions` rows as
      `status='stale-open'` where `ended_at IS NULL` and
      `MAX(strokes.at) < now() - 5 minutes`.
- [ ] `GET /api/sessions/stale-open?rower_id=<id>` returns
      `{ sessions: [{ id, started_at, last_stroke_at, total_distance_m,
      workout_id }] }`.
- [ ] `POST /api/sessions/:id/finalize` synthesises `session_end` with
      `ended_at = last_stroke_at`, runs `applySessionEnd`, returns 204;
      idempotent (second call on an ended session also returns 204).
- [ ] Existing `DELETE /api/sessions/:id` continues to serve discard.
- [ ] Home page renders `StaleSessionCard` for the active rower's
      stale-open sessions with three buttons:
      "Beenden mit gerudertem Stand" → finalize,
      "Verwerfen" → DELETE, "Weiter rudern" → rejoin live with that
      `session_id`.
- [ ] Smoke test: insert a session with stale strokes, run sweep, assert
      API returns it.

### Slice 4 — Replay-grade persistence

**Modules**: M14 (`storage/persister.applySessionEnd` no longer deletes
strokes).

**User stories**: 16, 17.

**Blocked by**: none.

**Acceptance criteria**:

- [ ] `DeleteSessionStrokes` is removed from `applySessionEnd`.
- [ ] After a session ends, its rows in the `strokes` table remain.
- [ ] FEAT-0009 hard-delete continues to remove strokes for deleted
      sessions.
- [ ] No new SQL migration is required for v1.
- [ ] Existing `samples_json` continues to be written from strokes at
      session-end (strokes-as-truth and samples-as-cache co-exist).

### Slice 5 — Windowed live split

**Modules**: M12 (`session/livePace` pure function),
M13 (`session/sessionizer` ring buffer wiring), M16 (`web/reducer` EMA
relax).

**User stories**: 9, 10.

**Blocked by**: none.

**Acceptance criteria**:

- [ ] `livePace(strokeBuffer, windowSec) → (paceSecPer500m, kind)` exists
      as a pure function; `kind ∈ {value, held, empty}`.
- [ ] Leading-edge linear interpolation: when `t = now − W` falls between
      two strokes, position at that instant is interpolated using the same
      arithmetic as `stats/candidates.go` (`interpTime`,
      `distpb_interp_test.go`). Interpolation accuracy asserted to within
      float-rounding by fixture tests.
- [ ] Trailing edge is `now`; the window represents exactly `W` seconds
      of motion.
- [ ] Sparse-window fallback: < 2 strokes inside the window returns
      `held`; sessionizer caches the last `value` and re-emits it in
      `pace_sec_per_500m` until another `value` lands.
- [ ] Window value is a parameter (provisional 5 s default), not a magic
      constant; tunable via build-time flag for replay experiments.
- [ ] The per-stroke `pace_sec_per_500m` field on the wire is unchanged
      in shape; its value is the windowed result.
- [ ] Frontend reducer EMA alpha is relaxed (or dropped) for the split;
      sparkline buffers unchanged.
- [ ] Fixture tests cover: normal rowing, sparse `held`, empty `empty`,
      large stroke gap, edge-inclusion semantics, interpolation accuracy.

### Slice 6 — `cmd/replay` tool

**Modules**: M15 (`cmd/replay`).

**User stories**: 15.

**Blocked by**: Slice 4 (strokes must persist after session-end), Slice 5
(replay output uses the windowed reducer).

**Acceptance criteria**:

- [ ] `cmd/replay <session_id>` loads strokes for that session and steps
      them through `Sessionizer`.
- [ ] Output is CSV with one row per stroke containing the live-screen
      values: `paceSecPer500m`, `dps`, `spm`, etc.
- [ ] Smoke test: replay a fixture session, assert CSV header and that
      per-stroke rows are produced.

### Slice 7 — Work-distance badge + Distance-to-go tile

**Modules**: M10 (`web/WorkProgressBadge`), M11 (`DistanceToGoTile`).

**User stories**: 11, 12.

**Blocked by**: none.

**Acceptance criteria**:

- [ ] `WorkProgressBadge` renders persistently under `WorkoutProgressStrip`
      while `currentPhase === 'work'` for Distance-mode workouts.
- [ ] Badge shows `<workDistanceM> / <targetM> m` where work-distance is
      total session distance minus distance-at-end-of-warmup.
- [ ] Badge is hidden during warmup and cooldown.
- [ ] `DistanceToGoTile` is added to the FEAT-0001a tile catalogue:
      large `<targetM − workDistanceM> m` value with "übrig" label.
- [ ] Tile is opt-in via the existing dashboard customisation flow.

## UX notes

- Phase-aware countdown replaces dashboard tiles during warmup and
  cooldown. Big mm:ss + phase label.
- The ✕ icon already exists in `WorkoutProgressStrip`; it now also
  serves as the unconditional escape hatch in any phase.
- Stale-open card: three buttons in German — "Beenden mit gerudertem
  Stand", "Verwerfen", "Weiter rudern".
- Work-distance badge sits under the progress strip; the
  Distance-to-go tile is a dashboard option for users who want it
  dominant.

## Non-goals

- Tuning the live-split window value beyond shipping 5 s. Validation
  against IPM hardware-display capture is a separate follow-up driven by
  the replay tool.
- Stroke-retention pruning. ADR-0011 commits to indefinite retention; an
  annual prune ADR can come later.
- Frame-level replay (raw IPM frames). Replay operates on persisted
  strokes only.
- Configurable per-tile window length. v1 is a single global window.
- Wake-lock on iOS PWA beyond best-effort.
- Migration of historical `pace_sec_per_500m` values. The replay tool can
  re-derive windowed values on demand.

## Open questions

- Optimal window value (5 s is provisional). Resolved by replay-driven
  validation — a separate follow-up.
- Whether to denormalise `last_stroke_at` onto `sessions` later as an
  optimisation for the stale-open query.

## Further notes

- The chain of failures on the Pi is preserved verbatim in ADR-0010's
  Context section as the canonical regression reproducer.
- ADR-0008 amended: stroke compaction at session-end is dropped;
  ADR-0011 supersedes that part.
- CONTEXT.md defines Workout phases (Warmup / Work / Cooldown),
  Pause-prompt suppression, Stale-open session, and Live split (windowed).
- `docs/domain-glossary.md` redefines *live* split as windowed
  (provisional 5 s) with sparse-fallback behaviour noted.
