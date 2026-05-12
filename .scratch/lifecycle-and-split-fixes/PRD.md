# PRD: Rowing-Session Lifecycle, Phase-Aware UX, and Windowed Live Split

Status: ready-for-agent

Companion specs: ADR-0010 (lifecycle + resumability), ADR-0011 (replay-grade
persistence + windowed split). Both Accepted 2026-05-10.

## Problem Statement

A real 5K row on the Pi exposed a tangled set of failures in the live rowing
experience:

- The phone screen power-saved during cooldown. The connection died, the
  pause-detection abort dialog auto-popped, the user tapped "Speichern", the
  end-event silently failed, the session row stayed `ended_at IS NULL`, and
  the 5K PB never appeared. (Even if it had, only 3 770 m of *work-phase*
  distance was rowed because the IPM hardware shows cumulative metres
  including warmup; the user trusted the hardware and stopped early.)
- The live "current split" tile is visibly wrong vs. the IPM hardware
  display — it jitters stroke-to-stroke while the hardware reads smoothly.
  The 5K *average* is correct, so the underlying numbers are fine; only the
  per-stroke extrapolation in `PaceSecPer500m(dps, cycleSec)` is too noisy.
- Auto-end detection fires too aggressively (during cooldown, where idleness
  is expected); after exiting an unwanted pause the cooldown timer was set
  to zero.
- Warmup and cooldown have no dedicated UX — the user can't tell at a glance
  what phase they're in or what's expected of them.
- There is no way to validate any future stat-formula change against
  captured sessions: strokes are deleted at session-end (per ADR-0008), so
  only `summary_json.samples` survives, which is too aggregated to replay.

## Solution

Three coordinated changes to the live rowing experience:

1. **Phase-aware lifecycle.** The `Phase` (warmup / work / cooldown) is the
   canonical input for end-of-session, abort-prompt suppression, and live
   UX. Cooldown elapsing finalizes the session and shows the results
   overlay. The pause-detection dialog is suppressed during warmup and
   cooldown. A small ✕ icon (already present in `WorkoutProgressStrip`)
   opens the existing Speichern / Weiter / Verwerfen sheet on demand in
   any phase.
2. **Resumable session-end.** The PWA holds a `screen-wake-lock` for the
   duration of every open session. Failed `endSession()` POSTs are no
   longer fire-and-forget — they enter a localStorage retry queue and
   surface as a toast. A backend janitor flags sessions stale-open after
   five minutes of no strokes; on the home page, the rower sees a
   "Frühere Session abschließen?" card with three options (Beenden mit
   gerudertem Stand, Verwerfen, Weiter rudern).
3. **Windowed live split + replay-grade persistence.** The current-split
   tile is computed over a sliding window (provisional 5 s, value TBD via
   replay) of distance covered, with a sparse-window fallback that holds
   the previous value when fewer than two strokes are in the window.
   Strokes are no longer deleted at session-end (`DeleteSessionStrokes`
   removed); they remain indefinitely in the `strokes` table. A new
   `cmd/replay` tool reloads any session's strokes and emits per-stroke
   "what was on screen" output as a CSV, providing the substrate to
   validate (and later tune) the window value against captured IPM-display
   ground truth.

A persistent `<workDistanceM> / <targetM> m` badge under the progress strip
during the work phase, plus an opt-in "Distance to go" tile in the
FEAT-0001a catalogue, eliminate the hardware-vs-app-distance confusion that
caused the user to stop early.

## User Stories

1. As a rower mid-cooldown, I want the app to *not* pop up "Workout
   beenden?" while I'm doing my paddle-down, so that I'm not pressured into
   ending early.
2. As a rower, I want my cooldown to end my session automatically when its
   planned time elapses, so that I never have to remember to tap save.
3. As a rower in cooldown, I want a big countdown showing how much time is
   left, so that I always know where I am in the workout.
4. As a rower in warmup, I want the same big countdown for the warmup
   phase, so that warmup feels like a first-class part of the workout, not
   a forgotten preamble.
5. As a rower mid-cooldown who needs to stop now (cramp, phone call), I
   want a clearly accessible ✕ button that opens the existing
   Speichern / Weiter / Verwerfen sheet, so that I have agency without the
   dialog auto-firing.
6. As a rower whose phone screen would normally power-save mid-row, I want
   the app to hold the screen on for the duration of the session, so that
   my live data keeps streaming.
7. As a rower whose phone *did* lock anyway and broke the connection, I
   want my pending session-end to retry when the page comes back up, so
   that I don't silently lose my session.
8. As a rower returning to the app after my session got stranded (phone
   died, browser crashed), I want to see a "Frühere Session abschließen?"
   card on the home page, so that I can finalize, discard, or rejoin
   without manually hunting the session.
9. As a rower glancing at the current-split tile while rowing, I want the
   number to be as smooth and consistent as the one on my IPM hardware
   display, so that the two screens agree.
10. As a rower in the recovery phase between strokes, I want the live split
    tile to hold its previous value rather than jumping to nonsense, so
    that my eye isn't drawn to a meaningless flicker.
11. As a rower doing a structured 5000 m work phase, I want a clearly
    visible "<rowed> / 5000 m" indicator under the progress strip, so that
    I know exactly how far I have to go *in the work segment* — not the
    hardware total that includes warmup.
12. As a rower customising my dashboard, I want the option to add a
    "Distance to go" tile, so that the work-distance target is dominant
    rather than just a small badge.
13. As a rower finishing my workout, I want the Session-beendet results
    overlay to appear on the live page when cooldown ends, so that I can
    see my stats without being navigated away.
14. As a rower doing a FreeRow / Just Row session (no phases), I want the
    existing Speichern / Weiter / Verwerfen pause dialog to keep working
    as it does today, so that nothing regresses for sessions without a
    workout.
15. As a developer investigating a stat discrepancy in a past session, I
    want a `cmd/replay` tool that re-feeds the session's strokes through
    the live reducer, so that I can compare against ground truth and try
    alternative formulas.
16. As a developer adjusting the live-split window value, I want past
    sessions' strokes still in the database, so that I can validate
    formula changes against historical data, not just future captures.
17. As a maintainer worried about disk usage, I want the indefinite
    stroke-retention to be bounded by hard-delete and (eventually) an
    annual prune ADR, so that disk growth is predictable.
18. As a rower whose connection drops mid-work-phase, I want the toast for
    the failed `endSession` to be visible and actionable, so that I know
    something went wrong and what to do.
19. As a rower whose stale-open session card I tap "Weiter rudern", I
    want to land directly back in the live view with that session_id
    reattached, so that I can finish the workout without re-pairing.

## Implementation Decisions

### Module breakdown

The work splits into the following modules. Deep modules are isolated
behind a simple interface and absorb most of the testable logic.

**Backend / Go:**

- **M1 — `session/phaseplan` emits session_end on `PhaseDone`.** The
  classifier already returns the done-bool; today no one acts on it.
  The sessionizer now fires `KindSessionEnd` directly when classification
  transitions to done, with `ended_at = now()`. Modify, deep at the
  state-machine layer. Tested.
- **M2 — `storage/staleJanitor` (new).** Periodic sweep, 1-minute tick.
  Marks sessions where `ended_at IS NULL` and the most recent stroke is
  older than 5 minutes as `status='stale-open'`. Pure SQL + scheduling,
  isolated from API/UI. Smoke-tested only.
- **M3 — Resume API (new).** `GET /api/sessions/stale-open?rower_id=...`
  returns the rower's stale-open sessions. `POST /api/sessions/:id/finalize`
  synthesises a `session_end` event with `ended_at = last_stroke_at` and
  the existing summary aggregator. Existing `DELETE /api/sessions/:id`
  serves the discard path. Shallow handlers over M1/M2.
- **M12 — `session/livePace` (new, deep).** Pure function:
  `(strokeBuffer, windowSec) → (paceSecPer500m, kind)`. `kind` is
  `value | held | empty` so the caller can decide whether to treat as
  "no signal". Sparse-window fallback: when the buffer holds < 2 strokes
  inside the window, returns `held`; the caller (sessionizer) keeps the
  previous value. **Linear interpolation at the leading edge** of the
  window: when `t = now − W` falls between two strokes, the position
  at that instant is linearly interpolated between them — reusing the
  same arithmetic that `stats/candidates.go` (`interpTime`,
  `distpb_interp_test.go`) already applies to distance-PB candidates.
  The trailing edge is `now`. This guarantees the window represents
  exactly `W` seconds of motion and makes M12's output
  bit-comparable to the PB-candidate path under replay. The window
  value is provisional 5 s; the parameter is exposed for replay-driven
  validation. Heavily fixture-tested.
- **M13 — `session/sessionizer` uses M12.** Maintains a small ring buffer
  of recent strokes. Replaces the per-stroke `PaceSecPer500m(dps, cycle)`
  call. The per-stroke `pace_sec_per_500m` field on `StrokePayload`
  remains in the wire shape for backwards compatibility; its value is
  the windowed result.
- **M14 — `storage/persister.applySessionEnd` no longer deletes strokes.**
  Drop the `DeleteSessionStrokes` call. Hard-delete (FEAT-0009) continues
  to remove strokes for the deleted session.
- **M15 — `cmd/replay` (new).** Loads strokes for a `session_id`, steps
  them through `Sessionizer`, emits per-stroke CSV with the live-screen
  values (paceSecPer500m, dps, spm, etc.). Used as a manual debugging
  tool and as the substrate for validating window-value changes.

**Frontend / TypeScript:**

- **M4 — `web/useWakeLock` (new hook).** Requests
  `navigator.wakeLock.request('screen')` on session start; re-requests on
  `visibilitychange === 'visible'`. Failures logged, non-blocking.
- **M5 — `web/endSessionQueue` (new, deep).** Pure module independent of
  React. Owns a localStorage-backed queue of pending end-events, keyed
  by `session_id`. Public surface: `enqueue(sessionId)`,
  `processPending()` (called on app start and on online events). On
  failure, surfaces a toast. On success, invalidates the sessions query.
  Replaces the inline `void endSession().catch(() => {})` calls in
  `PauseDialog.tsx` and `WorkoutProgressStrip.tsx`. Heavily unit-tested.
- **M6 — `web/PauseDialog` phase-gate.** One-line guard on `open`:
  the dialog opens only when `state.session.currentPhase === 'work'`. The
  ✕ trigger in the progress strip continues to open the same dialog
  unconditionally.
- **M7 — `web/PhaseCountdownView` (new component).** Big-number countdown
  (mm:ss), phase label ("Warmup" / "Cooldown"), shown by `LivePage` when
  `currentPhase` is warmup or cooldown. Replaces the dashboard tiles for
  those phases.
- **M8 — `web/SessionEndedOverlay` no longer navigates away on
  auto-end.** When the overlay is triggered by phase-driven auto-end,
  "Neue Session starten" returns to the home page; the page itself
  doesn't navigate proactively.
- **M9 — `web/StaleSessionCard` (new).** Home-page card surfacing the
  result of `GET /sessions/stale-open` for the active rower. Three
  buttons: "Beenden mit gerudertem Stand" (calls
  `POST /sessions/:id/finalize`), "Verwerfen" (existing DELETE), "Weiter
  rudern" (rejoins live with that session_id).
- **M10 — `web/WorkProgressBadge` (new).** Persistent under
  `WorkoutProgressStrip` while `currentPhase === 'work'` for Distance-mode
  workouts. Renders `<workDistanceM> / <targetM> m`. Work-distance is
  total session distance minus distance-at-end-of-warmup.
- **M11 — Tile: `DistanceToGoTile` (new).** Adds a tile to the
  FEAT-0001a catalogue: large `<targetM - workDistanceM> m` value with
  "übrig" label.
- **M16 — `web/reducer` split EMA.** Relax the EMA alpha or drop it
  entirely; the backend window is now the smoother. Sparkline buffers
  for split unchanged.

### Schema and persistence

- No new SQL migrations *required* for v1 — `sessions.ended_at IS NULL`
  + `MAX(strokes.at) WHERE session_id = ...` is enough to compute
  stale-open. A view or a denormalised `last_stroke_at` column can be
  added later as an optimisation.
- `DeleteSessionStrokes` is removed from `applySessionEnd`. Strokes for
  ended sessions remain in the table indefinitely. ADR-0008 is amended
  to reflect this.

### API contracts

- `GET /api/sessions/stale-open?rower_id=<id>` → `{ sessions: [{ id,
  started_at, last_stroke_at, total_distance_m, workout_id }] }`. Server
  computes stale-open server-side using the rule above.
- `POST /api/sessions/:id/finalize` → 204. Synthesises `session_end`
  with `ended_at = last_stroke_at`, runs the existing
  `applySessionEnd` path (now without delete-strokes). Idempotent: a
  second call on an already-ended session returns 204.
- Existing `DELETE /api/sessions/:id` is the discard path.
- Existing `POST /api/sessions/end` (aliased here as `endSession()`) is
  unchanged on the wire — the change is on the client side: it now goes
  through the retry queue.

### Phase-aware client state

- The live-session reducer already exposes `currentPhase` (segment
  classification arrives via SSE). PauseDialog gates on it; the
  PhaseCountdownView mounts/unmounts on it; `WorkProgressBadge` mounts
  only when `currentPhase === 'work'` AND the workout is Distance mode.

### Live-split window

- v1 default: 5 s. Implemented as a parameter of M12, not a magic
  constant. Tunable via build-time flag for replay experiments. The
  ADR explicitly does not bless 5 s; it commits only to "windowed".
- Sparse-window fallback: strict — fewer than two strokes inside the
  window means `kind=held`. The sessionizer caches the last
  `value`-kind result and re-emits it in `pace_sec_per_500m` until
  another `value` lands.

### Backwards compatibility

- Per-stroke `pace_sec_per_500m` field on the wire stays. Historical
  sessions in the DB retain whatever per-stroke value was written at
  the time. Replay can re-derive a windowed value retroactively.
- Existing `samples_json` continues to be written from the strokes at
  session-end. Strokes-as-truth and samples-as-cache co-exist.

## Testing Decisions

### What makes a good test here

Tests should exercise externally-observable behavior, not implementation
details:

- For state-machine-shaped modules (M1, M5, M12), inputs are sequences
  of events / strokes / network-results and outputs are state
  transitions or emitted values. Drive them with fixtures, never with
  internal mocking.
- For UI behaviour (M6, M9), tests assert that the right element is on
  screen given a backing state — same shape as the existing
  `*.test.tsx` files in `web/src/pages/live/` and `web/src/live/`.
- Avoid testing the React/Go scheduler. Avoid asserting on internal
  field shapes that are not part of the wire contract.

### Modules with explicit tests in v1

- **M1 — phase-end emission.** Drive the sessionizer with fixture
  strokes that cross each phase boundary. Assert that `session_end` is
  emitted exactly once when (and only when) cooldown elapses for
  structured workouts. Prior art: `session/sessionizer_test.go`,
  `session/phaseplan_test.go`.
- **M5 — endSessionQueue.** Pure module, no React. Cases: enqueue then
  network-success drains the queue; enqueue then network-failure leaves
  the entry in localStorage; multiple enqueues for the same session_id
  collapse to one; processing on app-start drains pending entries from
  a previous run; toast surfaces on persistent failure. Prior art:
  pure-logic suites under `web/src/live/*.test.ts`.
- **M12 — livePace.** Fixture-driven: a stroke buffer + window seconds
  + expected `(paceSecPer500m, kind)`. Cases: normal rowing produces
  reasonable values; sparse window (< 2 strokes) returns `held`;
  empty window returns `empty`; large gap between strokes triggers
  `held` not nonsense; window edge inclusion semantics are explicit;
  **leading-edge interpolation** is exact (synthetic fixtures with
  the leading edge falling at known fractional positions between
  strokes assert the interpolated distance to within float-rounding).
  Prior art: `session/metrics_test.go`,
  `stats/distpb_interp_test.go` (the interpolation arithmetic is
  shared between the two contexts).

### Modules with smoke tests only in v1

- **M2 — staleJanitor.** One end-to-end test that inserts a session
  with `ended_at IS NULL` and an old last-stroke, runs the sweep,
  asserts the session is reported as stale-open by the API. The query
  is small enough that this is enough.
- **M15 — cmd/replay.** One smoke test that runs replay against a
  fixture session and asserts the CSV header is right and per-stroke
  rows are produced. The tool's value is in interactive use, not in
  CI.

### UI components without dedicated unit tests

M4 (wakeLock hook), M6 (PauseDialog phase-gate — covered by an
extension to existing PauseDialog tests), M7 (PhaseCountdownView), M8
(SessionEndedOverlay no-nav change — extension of existing test), M9
(StaleSessionCard), M10 (WorkProgressBadge), M11 (DistanceToGoTile),
M16 (reducer EMA relax). These are visual / wiring changes; manual
verification on the Pi is the gate.

## Out of Scope

- Tuning the live-split window value beyond shipping 5 s. Validation
  against IPM hardware-display capture is a separate follow-up issue
  driven by the replay tool.
- Stroke-retention pruning. ADR-0011 commits to indefinite retention
  for ended sessions; an annual prune ADR can come later if disk grows
  unexpectedly.
- Frame-level replay (raw IPM frames). The replay harness operates on
  persisted strokes only; frame replay can be added if a parser bug
  ever needs investigating.
- Configurable per-tile window length. v1 is a single global window
  value applied to the canonical split tile and any tile derived from
  it.
- Wake-lock on non-iOS platforms beyond best-effort. Android Chrome /
  desktop browsers will likely Just Work; iOS PWA is the difficult
  case and the spec accepts platform-imposed flakiness there.
- Migration of historical `pace_sec_per_500m` values. Past sessions
  keep their old per-stroke values; the replay tool can re-derive
  windowed values on demand without a backfill.

## Further Notes

- The chain of failures on the Pi this morning is preserved verbatim
  in ADR-0010's Context section as the canonical reproducer for
  regression purposes.
- ADR-0008 has been amended to reflect that stroke compaction at
  session-end is dropped; ADR-0011 supersedes that part.
- CONTEXT.md now defines Workout phases (Warmup / Work / Cooldown),
  Pause-prompt suppression, Stale-open session, and Live split
  (windowed).
- `docs/domain-glossary.md` has been updated to redefine *live* split
  as windowed (provisional 5 s) with the sparse fallback behaviour
  noted.
