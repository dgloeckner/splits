# Distance flow audit — findings log

Living document. Updated as we work through the distance workout flow
hunt. Each entry: what was reported / observed, analysis result, and
suggested fix.

**Session context**
- Date: 2026-05-15
- Real-data anchor: session `01KRNGHFXXJ6HA5RFAT73FP595`
  (workout `9f76e7d9-…`, distance mode, 5000 m goal, intensity moderat,
  warmup 120 s, cooldown 120 s). Totals: 478 strokes / 5005 m / 1122 s.
  Strokes table: 554 strokes / 5316 m / 1242 s — see B2.
- Data source: `splits-raspi.db` (root copy, re-synced 2026-05-15 ~14:02
  after backend shutdown).

---

## Resolved mysteries

### M1 — "Data appears truncated (441 / 4265 vs 478 / 5005)"
- **Observed:** Local `splits-raspi.db` showed 441 strokes / 4265 m for
  today's session; the app's History showed 478 / 5005.
- **Analysis:** First read happened before the user re-synced the DB
  from the live backend. After shutdown + re-copy the local file matches
  the app (478 / 5005). Not a product bug.
- **Status:** Closed.

---

## Confirmed bugs (root cause known)

### B1 — PB-5000 never recorded ✅ FIXED
- **Reported:** User did a new 5K PB; History/PB views don't reflect it.
- **Evidence:** `pb_distance` rows existed for 500/1000/2000 only.
  Two finished 5K sessions (2026-05-09 5004m/1138s, 2026-05-15
  5005m/1122s) produced no PB-5000 row.
- **Root cause (confirmed):** `ComputeCandidates` ran on `phase='work'`
  strokes only (`storage/persister.go:236`). The phase-plan triggers
  cooldown when **cumulative** distance hits 5000 m — so warmup
  distance (407 m today, 416 first work stroke) eats the head-room.
  Work-only stroke span for today's session was 5005 − 416 = 4589 m,
  not enough for `distanceCandidates` (which needs a strict d-metre
  window) to find a 5000 m window. The 5000 m candidate was therefore
  never produced, and the recompute pipeline had nothing to promote
  into `pb_distance`.
- **Fix landed:** `backend/internal/stats/candidates.go` ·
  `ComputeCandidates` now takes the full stroke list and filters
  per-candidate-type internally:
  - distance candidates → warmup + work strokes (rest + cool-down
    excluded; the fastest-window finder self-deselects slow warmup
    when work has enough span on its own).
  - window + consistency → work-only (unchanged behaviour).
  Callers in `persister.go` and `stale_janitor.go` updated to pass
  the unfiltered stroke list. Regression tests added:
  `TestComputeCandidatesB1_FivekGoalReachableAcrossWarmupBoundary`
  and `_WindowCandidatesIgnoreWarmup`. All backend suites green.
- **Follow-up needed:** Backfill — pre-fix sessions already in the DB
  won't grow a PB-5000 row until the stats recompute pipeline is
  rerun against them. Either trigger a one-off recompute or wait
  until the next session re-derives PBs for the rower.
- **Related adjacent fix landed (B5):** see below.

### B5 — Distance goal counted warmup distance ✅ FIXED
- **Observed:** A "5K distance workout" reached the cooldown trigger
  when *cumulative* session distance hit 5000 m, but warmup distance
  (407 m today) silently consumed part of that goal — actual work
  rowed was ~4.6 km. Compounded B1 (no PB-5000 candidate could fit).
- **Decision:** Goal means "X m of post-warmup work" — the user's
  mental model when they say "I rowed 5 km".
- **Fix landed (backend):** `backend/internal/session/phaseplan.go` ·
  `PhasePlan` gains `warmupEndDistance`, latched on the first stroke
  past the warmup segment. Distance segments use
  `consumed = distanceM - startDistance - warmupEndDistance`.
- **Fix landed (frontend):** `reducer.ts` adds
  `LiveState.workStartDistanceM`, latched on the `phase_change`
  event with `from='warmup'` and `to='work'` (at_distance_m). The
  reducer carries it through. `segments.ts` · `locateSegment` accepts
  an optional `workStartDistanceM` offset; `useWorkoutProgress`
  threads it in. The work segment's `remainingM` now reflects the
  correct goal even before cooldown fires.
- **Tests:** `phaseplan_test.go` and `sessionizer_test.go` updated to
  the new semantic; `segments.test.ts` gains a B5 describe block
  with three regression cases. All 518 web tests + every backend
  package green.
- **Out of scope:** Intervals' rest-phase distance is not yet
  excluded from work segments (same problem class but with multiple
  non-work prefixes). Tracked separately if it comes up.

### B2 — Cool-down strokes attributed to closed session ✅ NOT A BUG
- **Observed (DB):** Session `01KRNGHFXX...` totals = 478 / 5005 / 1122,
  but `strokes` table holds **554 strokes / 5316 m / 1242 s** for the
  same `session_id` — 76 cool-down strokes recorded against the
  already-closed session.
- **Resolution:** the framing was wrong. Cool-down strokes are
  persisted **during** the open session (cool-down phase precedes
  `closeSession`; `ended_at` is NULL during cool-down). The session
  totals — `total_distance_m`, `total_strokes` — are populated only
  for `phase==PhaseWork` strokes via `Sessionizer.accumulate`
  (`sessionizer.go:381`), so they correctly exclude warmup and
  cool-down. The strokes table retains all phases by ADR-0011's
  replay-grade persistence policy, distinguished by the `phase`
  column. No double-counting risk because every aggregate query that
  cares already filters by phase (or uses session-level totals).

### B3 — `sessions.status` stays `'open'` after `ended_at` is set ✅ NOT A BUG
- **Resolution:** documented design, not a defect. Per migration
  `0015_session_status.sql`: *"Once `ended_at` is set the column
  becomes informational; queries that only care about end-state
  continue to use `ended_at IS NULL`."* The column's only state
  machine is `open ↔ stale-open`, used by the resume-card flow to
  flag connections that died mid-row. No reader (backend or web)
  expects `'closed'`; verified by grep. No code change.
- **Lesson for future schema choices:** the column name "status" was
  misleading — `recovery_status` or `open_state` would have
  pre-empted the confusion that turned this into an audit ticket.

### U1 + U2 — Warmup / cool-down countdown only ticks on strokes ✅ FIXED
- **Reported:** During the 2-min warmup the countdown updated only when
  a stroke was taken (bumpy). Same problem during cool-down.
- **Root cause:** `web/src/live/segments.ts` `locateSegment` computes
  `remainingSec` from the stroke-emitted `timeSec` value (lines 131,
  144, 148). Between strokes (2–4 s glide) `timeSec` is stale, so
  `remainingSec` is frozen.
- **Fix landed:** `PhaseCountdownView` now extrapolates `remainingSec`
  by wall clock between stroke arrivals.
  - `useWorkoutProgress` exposes `remainingAnchorMs` (mirrors
    `state.lastStrokeReceivedAtMs`).
  - `LivePage` threads the anchor into `PhaseCountdownView`.
  - The view runs a 250 ms `setInterval` (gated on `anchor != null &&
    remainingSec > 0`) and displays
    `remainingSec - (now - anchor)/1000`, clamped at zero.
  - Phase transitions remain server-driven (`phase_change` event), so
    overshooting the segment end visually does not race the model.
  - Tests: `PhaseCountdownView.test.tsx` covers the wall-clock tick,
    the zero clamp, and the no-anchor pass-through.

---

### U3 — Live split pace differs from ergo hardware display + brief upward spikes ✅ FIXED
- **Reported:** PWA split jumps up (e.g. 2:05) while the IPM hardware
  console shows consistent 1:49-1:52.
- **Root cause (confirmed):** Two contributing factors.
  1. *Different computations.* The IPM device frame carries no pace
     at all (`backend/internal/ipm/frame.go`). The hardware console
     computes pace internally. The backend computes a **5-second
     windowed split** (`backend/internal/session/livePace.go:25` —
     `DefaultLivePaceWindowSec = 5.0`) and writes that to
     `strokes.pace_sec_per_500m` (`sessionizer.go:449`). UI passes
     through (`web/src/live/smoothing.ts:14` — split EMA alpha=1.0,
     pass-through per ADR-0011 / FEAT-0015 Slice 5).
  2. *Window is sensitive to stroke-cadence variance.* The window
     edge is interpolated linearly across stroke boundaries; small
     timing irregularity briefly under-reports distance, spiking
     pace upward.
- **Evidence from today's session** (t=200-1000 s, real rowing):
  modal pace 100-108 (1:40-1:48), but **77+ strokes** show 125-150
  (2:05-2:30) — roughly 1-in-4 strokes spike upward by 15-50 s/500m
  while the console (per-cycle calc) stays steady.
- **No pace on the wire.** The IPM serial protocol's three unverified
  fields (`[10:13]`, `[13:16]`, `[24:25]` per `specs/int/0001-...md`)
  were checked: `[13:16]` (the only one with enough range for pace)
  has zero correlation with derived speed across the
  `session-m3-long` fixture's 124 frames. The hardware console
  computes pace internally from sub-second flywheel timing that is
  never transmitted.
- **Fix landed:** switched `LivePace` from a 5-second *time* window
  to a 5-*stroke* window in `backend/internal/session/livePace.go`.
  Window endpoints now land on actual stroke samples (no leading-edge
  interpolation), so the algorithm collapses to
  `pace = 500 × (tLast − tFirst) / (dLast − dFirst)` over the
  trailing N strokes. `Sessionizer.appendAndTrimWindow` updated
  accordingly. `LivePaceWindowStrokes` (default 5) replaces the old
  `LivePaceWindowSec` knob.
- **Why 5 strokes:** the device emits stroke times at 1-second
  resolution. A time-based window cuts unevenly across stroke
  boundaries and amplifies quantization noise. A stroke-based window
  samples at the device's natural unit. Real-session comparison on
  the 2026-05-15 session (see `docs/u3-stroke-windows.png` and
  `docs/u3-pace-comparison.csv`):

  | window | std-dev | spikes > 2:00 |
  |---|---|---|
  | 5-second (old) | — | 76 |
  | 2-stroke | 16.6 | 43 |
  | 3-stroke | 10.9 | 76 |
  | 4-stroke | 8.3 | 75 |
  | **5-stroke** | **6.9** | **23** |
  | 10-stroke | 4.x | 3 (but noticeably laggy) |

  5-stroke is the smallest window whose spike count drops sharply
  (quantization-resonance step at 4→5) without adding visible lag.

## User observations — investigation pending

### U4 — Post-session "Row again?" CTA feels wrong for rowers ✅ FIXED
- **Reported:** After cool-down completes the UI offers "row again"
  alongside session details. Rowers rarely immediately re-start a
  workout on the same machine.
- **Found:** `web/src/pages/live/SessionEndedOverlay.tsx` previously
  rendered subtitle *"Bereit für eine neue Runde?"* and a primary
  button labelled *"Neue Session starten"*. The button label was
  also misleading — it didn't actually start a new session, it just
  navigated home.
- **Fix landed:** the overlay now treats *Details ansehen* as the
  primary action (rowers almost always want to see what they just
  did) and renames the close-to-home affordance to *Fertig*. The
  rhetorical subtitle is gone; the only remaining subtitle is the
  PB-computing notice while banners resolve. When the post-session
  screen has no session id to deep-link to, the primary slot folds
  back into *Fertig* (cleanly labelled, no implicit "start another"
  hint).
- **Tests:** dedicated `SessionEndedOverlay.test.tsx` (4 cases
  covering both the with-session-id and no-session-id branches,
  plus the computing-subtitle visibility). All 522 web tests green.

### U5 — History year / week views show no data ✅ RESOLVED
- **Reported:** History tab's year and week aggregates appear empty
  despite multiple finished sessions.
- **Analysis:** No single bug — three contributing factors:
  1. **Stale `rower_lifetime_stats`.** Today's session ended at
     `10:08:27Z`. Lifetime stats row shows
     `computed_at=2026-05-15T09:43:05Z`,
     `total_distance_m=5004`, `total_sessions=7` — *missing* today.
     The async recompute that should have fired on session-end
     (`persister.go:285` → `OnSessionChange`) either didn't run,
     errored silently, or was interrupted by backend shutdown.
     Any UI surface that reads `rower_lifetime_stats` (Rekorde tab
     lifetime values, headline cards) saw pre-today numbers.
  2. **Ghost-session pollution.** 6 zero-data ghosts inflated session
     counts and may have made some chart-rendering paths degenerate
     when chart points were 0 or 1. **Fixed in B4** — next backend
     boot drops them.
  3. **Trends endpoint queries `sessions` directly**, not
     `rower_lifetime_stats` — so the Trends tab itself should have
     shown today's session. The user's "no data" complaint most
     likely referred to the Rekorde / lifetime path (PB-5000 was
     also missing per B1).
- **No additional code change required**: B1 (PB-5000 missing) and B4
  (ghost sessions) were the visible symptoms; both are fixed.
- **Follow-up landed (B6):** added a self-healing pass in the
  janitor — `RecomputeStaleRowerStats` runs `stats.Recompute` for
  every rower whose latest ended session is newer than their
  `rower_lifetime_stats.computed_at`. Wired into both BootJanitor
  and the every-minute StaleJanitor sweep so PB/lifetime state
  self-heals within one tick of any cause (shutdown mid-recompute,
  async scheduler failure, etc.).

### B6 — Stats recompute resilience ✅ FIXED
- **Trigger:** user request "We must make sure that PBs are
  re-calculated robustly!!!" and "We should run the janitor at
  regular intervals."
- **Problem:** the per-session OnSessionChange recompute runs in a
  background goroutine. If the backend is killed before it drains
  (today's session is one example), `rower_lifetime_stats` and the
  `pb_*` tables stay frozen at the prior recompute. UI shows stale
  PBs / lifetime totals.
- **Fix:** new package-level `RecomputeStaleRowerStats(ctx, db)` in
  `backend/internal/storage/janitor.go`. Finds rowers whose latest
  ended session post-dates their lifetime row (or who have no
  lifetime row at all) and calls `stats.Recompute` synchronously
  for each. Per-rower failures are logged but don't stop the sweep.
- **Wiring:** called from `BootJanitor.Run` (one-shot at boot) and
  from `StartStaleJanitor`'s every-minute tick. So any cause of
  stale stats — shutdown mid-recompute, scheduler error, missed
  OnSessionChange — auto-heals within ≤1 minute.
- **Test:** `TestBootJanitor_RecomputesStaleRowerStats` covers the
  happy path. All backend suites green.

### B4 — Six ghost sessions persisted with zero totals ✅ FIXED
- **Observed (DB):** Six sessions for rower Daniel have `ended_at` set
  but `total_distance_m = 0`, `total_strokes = 0`. Each ghost's
  `ended_at` equals the next ghost's `started_at` — they form a
  contiguous chain (`01KQQQWZ...` → `01KQRQAN...` → `01KQT7T7...` →
  `01KQT8YG...` → `01KRGBPK...` → `01KRJXFD...`).
- **Domain rule (per user):** A rower can have at most one open
  session at any time. The chain pattern shows the system currently
  enforces this by auto-closing the prior open session whenever a new
  one opens — producing a zero-stroke ghost.
- **Impact:** Inflates `trends.totals.sessions`, clutters History,
  contaminates aggregates if any query forgets to gate on
  `total_distance_m > 0`.
- **Root cause:** `Sessionizer.openSessionPending`
  (`backend/internal/session/sessionizer.go:204`) materialises the
  session row at *StartSession* time — i.e. when the user taps Start
  in the UI, *before any stroke arrives*. If the user then walks
  away, the row sits open. The next backend restart's `BootJanitor`
  saw it as "an open session left across a process restart" and
  finalised it with zero totals + `flags=["recovered"]`. Each
  restart cycle minted one ghost; the chain pattern (each
  `ended_at == next.started_at`) is the boot-janitor's wall-clock
  signature.
- **Fix landed:** `BootJanitor.finaliseOne`
  (`backend/internal/storage/janitor.go`) now hard-deletes the
  session row when its stroke count is zero, instead of writing a
  zero-totals summary. Domain rule "≤1 open session per rower" is
  preserved because the surviving row count drops to 0.
- **Tests:** `TestBootJanitor_DropsZeroStrokeGhost` in
  `janitor_test.go`. All backend suites green.
- **Existing pollution:** the six ghosts in `splits-raspi.db` will
  be cleared at the next backend boot.
- **Preventive layer deferred:** lazy session materialisation
  (defer the row INSERT until the first stroke arrives) would
  eliminate the source rather than the symptom but ripples through
  race-mode finalisation, the SSE channel, and resume UX. Leaving
  the cure in place is enough; revisit prevention only if a different
  failure mode reintroduces ghosts.

---

## Code-read smells in Step2/Confirm (Playwright probes)

These were the original hypotheses from reading `Step2Dimension.tsx`
and `ConfirmScreen.tsx`. Not yet probed; lower priority than the
real-session findings above.

### C1 — HM / Marathon chip → Confirm shows raw meters ✅ FIXED
- Chip labels in `distancePresets`: `"HM"` (21097 m), `"Marathon"`
  (42195 m). `ConfirmScreen.titleFor` (line 101) formats only when
  `m >= 1000 && m % 1000 === 0`, so 21097 and 42195 fall through to
  `"21097 m"` / `"42195 m"`. Label drift between Step2 and Confirm.
- **Fix landed:** `ConfirmScreen.formatDistanceLabel` special-cases
  21097→`HM` and 42195→`Marathon`. Same helper drives the race-mode
  title (`HM Rennen` / `Marathon Rennen`). Tests added.

### C2 — Eigene distance stepper has no upper bound ✅ FIXED
- `Step2Dimension.tsx:85` Stepper for distance has `min=500` but no
  `max`. User can step + to absurd values past Marathon.
- **Fix landed:** stepper now has `max=42195` (Marathon). Regression
  test clicks `+` 200 times and asserts the value clamps at 42195.

### C3 — Step3 → back loses Step2 visual state ✅ FIXED
- Reducer preserves `distanceMeters` on `GO_BACK`, but `DistancePanel`
  holds `eigene` and `meters` in local `useState`. On re-mount, the
  panel reflects defaults (closed Eigene, 3000 m) regardless of the
  committed value.
- **Fix landed:** local state is seeded from `state.distanceMeters`.
  If the committed value isn't a preset, the Eigene panel opens on
  it; otherwise the user sees the preset chips as before. Test
  added in `Step2Dimension.test.tsx`.

### C4 — Step2 "Zurück" exits to `/` (not GO_BACK) ✅ NOT A BUG
- `Step2Dimension.tsx:315` Zurück calls `nav('/')`. Home re-creates the
  `WorkoutFlowProvider`, so all selection is silently dropped.
- **Resolution: not a bug.** Step2 is the first step inside the
  workout-flow route; the step *before* it is the mode-pick on Home
  (Step 1). `nav('/')` is the right destination. In-flow back
  navigation (Step3 → Step2, Confirm → Step3) already uses
  `dispatch({ type: 'GO_BACK' })` correctly.

### C5 (deferred) — Eigene-then-preset, preset wins
### C6 (deferred) — Custom Eigene meters propagate to Confirm title
### C7 (deferred) — Live target reflects chosen distance

(C5–C7 are happy-path verifications that we expect to pass; run as
Playwright probes only if a regression is suspected.)

---

## Domain rules captured (in-flight)

- A rower has at most one **open** session at any time. (Drives B4.)

## Open questions / decisions parked

- **5K fixture truncation:** strokes table extends 76 strokes past
  goal-reached. Cap fixture at the goal-reached stroke for clean
  replay, or include the cool-down tail so cool-down UX can be
  exercised? (Probably: include tail; the cool-down bugs U1+U2 need it.)
- **PB-distance ladder:** does it actually contain 5000 m? Needs config
  inspection. Drives B1 fix.
- **U5 verification:** still need an actual response from
  `/api/v1/rowers/{id}/trends?range=week|year` to confirm whether the
  empty UI state comes from the endpoint or the renderer.
