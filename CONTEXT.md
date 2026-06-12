# Splits — domain context

This file is the canonical glossary for terms that are meaningful to
domain experts (rowers, race directors). It is not coupled to
implementation details. When a term in code disagrees with a term here,
this file is the authoritative one.

## Race

A workout mode that pits the rower against virtual opponents (a ghost
and/or a PB-leader) over a fixed standard distance (500, 1000, 2000,
5000, 6000, 10000, 21097, 42195 m). See `specs/feat/0013-race-mode.md`.

A race is a self-contained competition unit: it has a start ceremony,
a fixed course, and a finish horn. It does not include warmup or
cooldown — those are separate sessions before/after.

### Race t=0

The moment the green light fires in the start ceremony. The user's
race time is measured from t=0; their distance accumulates from t=0.
Strokes taken before t=0 do not count toward the race distance and
do not advance the race clock.

`race_t0` is a first-class concept distinct from `session_start`.
The backend subscription opens when the rower taps **Bereit**, so
any stroke during ATTENTION/SET opens the session normally
(`session_start` = that early stroke), but `race_t0` is pinned to
the GO! moment. On a clean start the two coincide; on a Falschstart
they differ and the gap is the false-start offset.

### Falschstart

A stroke taken between Bereit-tap and GO!. The session opens at that
stroke, a toast (`Falschstart — Uhr läuft ab GO!`) is shown, and
`race_t0` remains at GO!. Pre-GO! meters and seconds are excluded
from race distance and race time. v1 does not penalize a second
false start.

### Bereit (am Catch)

Pre-race ready state. After the user has confirmed distance and
opponents, they tap **Bereit** to indicate they are at the catch.
Tapping Bereit triggers the start ceremony (ATTENTION → SET → GO!).
Only on GO! does the user take their first stroke, opening the
session.

Note: the upstream configuration step's confirmation screen is named
**Übersicht**, not "Bereit", to avoid colliding with this term. Only
the at-the-catch screen carries the name Bereit.

### Start ceremony

A FISA-style traffic-light sequence: red (ATTENTION, 0 ms), amber
(SET, 1500 ms), green (GO!, 3000 ms), then dismiss. Decorative when
reduced-motion is on, but the timing is real — the user is expected
to wait at the catch through ATTENTION/SET and stroke on GO!.

The race canvas — track and boats parked at the start line — is
mounted from **Ceremony(ATTENTION)** onward and stays mounted across
GO!, Live, Finished, and the paddle-down. The ceremony is rendered
as an overlay over the still canvas, so GO! produces no mount/swap
flash. Opponent curves are fetched at ATTENTION (they are static, so
fetching early is harmless and warms the data before the rower
needs it). The **live stroke subscription** remains gated on GO! —
strokes are still excluded from race-distance/race-time until then,
preserving the Falschstart rule.

### Finish horn

The instant `userDistanceM >= totalMeters`. The race result is
deterministic at this moment: the user's time and gaps are latched.
The user typically continues rowing for a paddle-down; the result
overlay appears immediately and does not wait for the rower to stop.

**The race finish state is latched off the per-stroke reducer**,
not off React's render loop. The finish horn fires inside the
lifecycle reducer on the first stroke where `userDistanceM >=
totalMeters`; the resulting `latchedResult` is then the single source
of truth for both the FinishOverlay and the frozen StatBar/Canvas. A
known residual: if multiple strokes ever collapse into one React
commit (e.g. a backgrounded tab, severe back-pressure), only the
final committed stroke drives the lifecycle dispatch and the latch
could capture a post-horn stroke instead of the cross stroke. Under
realistic SSE cadence (~10–60 strokes/min vs. 60 Hz commit nominal)
this is essentially unreachable; the rower also isn't watching a
backgrounded tab. Accepted residual; documented here so a future
maintainer who hits the edge case knows where to look. The fully-
correct fix is to pipe SSE strokes directly into the lifecycle
reducer, bypassing the React render loop — out-of-scope today.

**The entire race surface freezes at the finish horn**, not just the
result overlay. StatBar values (elapsed, distance-to-go, split, watts,
spm, vs.Ghost, vs.PB) and Canvas positions (user boat, ghost, PB) are
snapshotted at horn and held until the session ends. Post-finish strokes
continue to be persisted (they belong to the session record for replay
and audit) but are no longer routed into the race-view's render inputs.

**The FinishOverlay carries an explicit "end session" affordance**
(working name **Fertig**). Tapping it fires `session_end` immediately,
giving the rower a one-tap escape from the race surface. The idle-
timeout `session_end` remains as a passive fallback for rowers who
just walk away.

**In race mode, the FinishOverlay IS the post-session result surface.**
The generic `SessionEndedOverlay` ("Session beendet / Bestleistungen
werden berechnet…") that other modes show when `session_end` fires
must NOT slide in over the FinishOverlay. The race result is the
information the rower wants on screen at the end of a race; replacing
it with a generic "computing PBs" message is a regression. The
FinishOverlay persists until the rower navigates (Fertig tap, or
nav-bar tap). No additional "Gespeichert" indicator is needed — the
latched result on screen, plus the visible Fertig button, is the
affirmation that the session is preserved. Rationale: relying on idle-timeout alone leaves the
rower with no agency — low-amplitude paddle-down strokes, a screen
lock, or a slow timer can trap them on the race surface with no exit.
The label is intentionally not "Beenden" (which reads as Abort, and
§Abort forbids abort after the horn — the result is already latched).

**Post-horn strokes are classified as Cooldown**, even when the race
shape declares `cooldown_sec=0`. The finish horn is itself the implicit
phase transition from Work to Cooldown. `filterWorkStrokes` strips them,
so race session aggregates (`total_distance_m`, `total_time_sec`,
`avg_power_w`, `avg_spm`, `avg_pace_sec_per_500m`) reflect the race
proper and match the FinishOverlay exactly. Without this rule, a
500 m race with 100 m of paddle-down would persist as a `603 m / 2:43 /
2:09 split` session, contradicting the `500 m / 1:38 / 2:05.0` the
rower just saw on screen. Rationale: the latched result is the single source of truth from
horn onward; allowing the StatBar to keep recomputing `vs.Ghost` against
a still-advancing `userDistanceM` produced visible contradictions
between the bar (e.g. "Ghost -10.0s") and the overlay ("vs.Ghost -22.0s").

### Ghost

A virtual opponent boat whose pace curve is either (a) the user's
last matching session for the same distance — the *session-ghost* —
or (b) a synthetic constant-split curve derived from the chosen
hardness level — the *synth-ghost*. Picking is per-race; not
persistent.

### PB-leader

A virtual opponent boat whose pace curve is sourced from the user's
fastest prior N-metre window for this race's distance (`pb_distance`).

The `pb_workout` table is reserved for **time mode** (PB = work-phase
distance covered over the **fully completed** prescribed duration,
higher better, `ValueKind=distance_m`). A candidate is emitted only
when the work phase ran to completion — partial sessions (rower
aborted before the prescribed time elapsed) do not contribute a PB
candidate, mirroring the §Stale-open rule that "a competition unit
either witnessed its own finish or did not happen". An incomplete
8-of-20-min attempt would otherwise become the rower's "20-min PB"
by default on their first try. Time mode is the only structured workout mode
whose PB value cannot be expressed as a best N-metre window. Intervals
mode is deliberately **not** in `pb_workout` — interval shapes are
hard to compare even within themselves, and they need a separate PB
surface (TBD) that engages with cross-shape comparison explicitly
rather than pretending it's a normal one-value-per-shape ranking. Race and distance modes do not emit a `pb_workout`
candidate — their PB is `pb_distance(shape_distance)`, sourced
directly. This mirrors the `ShapeHash` collapse in
`backend/internal/workout/hash.go`, which already maps `race →
distance` so the two modes share a single PB row. For **race mode**, `pb_workout` is structurally
redundant: a race's completion time always coincides with the best
N-metre window starting at `race_t0`, because race strokes are exactly
the strokes from `race_t0` to the finish horn (post-horn strokes are
Cooldown and stripped by `filterWorkStrokes`). Races therefore do
**not** emit a `pb_workout` candidate, and the PB-leader curve for a
race is read directly from `pb_distance` — this is the canonical path,
not a fallback.

### Opponent

Any virtual boat in a race — either the ghost or the PB-leader.
Opponents are pace-curves, not live rowers.

### Race shape

The combination of (mode=`race`, distance, warmup_sec=0,
cooldown_sec=0). All race shapes share `shape_hash` with the
corresponding bare-distance workout, so race PBs and distance PBs
are unified.

## Workout phases

A structured workout is a sequence of three phase kinds: an optional
**Warmup**, one or more **Work** segments (the meaningful part for
PBs, splits, achievements), and an optional **Cooldown**. The phase
classifier is `backend/internal/session/phaseplan.go`.

Two invariants follow from this:

- **Hardware distance does not reset between phases.** The IPM console
  shows cumulative session distance. When the user's workout calls for
  "5000 m of work after a 2-min warmup", the hardware will read
  ~5000 m + warmup-distance at the finish — *not* 5000 m. The app is
  responsible for showing "work distance toward target" separately.
- **Only Work-phase strokes count toward PBs.** `filterWorkStrokes`
  in `storage/persister.go` strips warmup/cooldown strokes before
  `ComputeCandidates` runs. A "5000 m PB" is 5000 m of *work*.
  Distance PB candidates are work-only (B1's warmup-headroom
  workaround retired 2026-06-10; B5 guarantees the goal fits inside
  the work phase).

### Session end

For a structured workout, the session ends automatically when
cooldown elapses (`PhasePlan.Classify` returns `PhaseDone`). The
client surfaces this via the results overlay; no "save?" prompt.

For a FreeRow / Just Row session (no phases), the session ends only
when the rower goes idle long enough to trigger the pause dialog and
they confirm Save / Discard.

### Stale-open session

A session whose backend row remains `ended_at IS NULL` with no new
strokes for longer than the §Pause resume window (15 minutes — a
merely-paused session is never stale-open). Caused most often by an
iPhone screen-lock that killed the live connection mid-cooldown. The home page surfaces these
on rower reconnect with a "Frühere Session abschließen?" card —
finalize from last stroke, discard, or rejoin live. See ADR-0010.

**Race-mode sessions are non-resumable.** The recovery card for a
race omits "rejoin live"; only Finalize and Discard are offered. An
interrupted race always finalizes with `summary_json.race = null` —
the same outcome as an explicit abort. A race is a competition unit
that either witnessed its own finish or did not happen.

### Boot-time session reconciliation

The client-side `LiveSessionContext` may cache an "active workout"
across app restarts. On app boot it must reconcile this cache against
the backend before driving any UI that gates on workout-active state
(notably BottomNav locking):

- If the BE says the session is ended (`ended_at` set), drop the
  local active-workout state and load `summary` from the BE. Nav
  unlocks; no recovery card is shown (nothing to recover).
- If the BE has `ended_at IS NULL` and matches the local active
  state, keep the state and apply the §Stale-open recovery flow.

Rationale: the backend is the source of truth for session lifecycle.
A stale local cache must never trap the rower in a locked nav for a
session that the backend has already closed.

### Live split (windowed)

The "current split" tile reads the average pace over a sliding
window of recent motion (distance covered ÷ window time → 500 m). It
is *not* a per-stroke extrapolation. The window is **provisionally
5 seconds** in v1; the value is to be validated against an IPM
hardware-display capture using the replay harness, and may change.
When the window contains fewer than two completed strokes the tile
**holds the previous value** rather than dropping to nonsense. See
ADR-0011.

### Race average split (Schnitt)

The summary split for a completed race: `(500 × race_time) /
race_distance`. Labeled **Schnitt** on the FinishOverlay and any
post-race surface. Distinct from the windowed Live split: the
Schnitt is a single number that summarises the rower's *whole race*
("I rowed this 500 m at a 4:38 Schnitt"), while the Live split
reflects the boat's pace in the last few seconds of motion.

The two concepts can coexist on the same screen — the frozen
StatBar shows the rower's Live split at the moment of the finish
horn; the FinishOverlay shows the Schnitt for the race as a whole.
They are intentionally different numbers and must be labeled
distinctly so the rower is not confused by what looks like a
contradiction.

### Pause-prompt suppression

The auto-popping pause dialog (idleness ≥ threshold → "Speichern /
Weiter / Verwerfen") only fires during the **Work** phase, where
idleness is a genuine "did the rower stop?" signal. During Warmup
and Cooldown the dialog is suppressed — those phases have known
durations and idleness inside them is expected.

A small "✕" icon in the corner opens the same Speichern / Weiter /
Verwerfen sheet on demand, in any phase. Tap-to-open, never
auto-popped during Warmup/Cooldown.

## Pause / Abort

- **Pause is a first-class session sub-state, not a session end.**
  A session enters Pause when distance stops advancing past the
  pause threshold and **auto-resumes on the next distance-advancing
  frame** — no user interaction required. The hard close (idle
  `session_end`) fires only after the **resume window** (15 minutes)
  of continuous pause. A short interruption (phone call, doorbell)
  must never end the session or drop resumed strokes.
- **The work clock stops while paused.** Pause time is excluded
  from `total_time_sec`, average pace/power, time-mode targets, and
  PB windows. A 20-minute time-mode piece requires 20 minutes of
  actual rowing. The IPM's own timer is assumed to keep running
  while idle, so the host tracks accumulated pause time and all
  phase/total computations run on pause-adjusted time, not raw
  device time. (Device idle-broadcast timer behaviour still needs a
  hardware capture to confirm.)
- **Phase countdowns halt while paused.** A pause during Warmup or
  Cooldown freezes the countdown; the rower resumes the phase where
  they left it. This also prevents the phase flipping to Work while
  the rower is away (which would auto-pop the pause dialog).
- A session inside its resume window is **not** §Stale-open; the
  stale-open threshold must not undercut the resume window.
- **Pause** is disallowed during a race. The pause control is
  hidden in race mode.
- **Abort** ends the session before the finish horn. Abort produces
  a normal session record but no race result (`summary_json.race`
  is null).
- In race mode, abort is reached via a small **Abbrechen** pill in
  the top-right of the race surface. It is visible across Bereit,
  Ceremony, and Live (rendered above the ceremony overlay).
  Tapping it opens a confirmation sheet — the abort itself only
  fires on confirm.
- **Abort is unavailable once the finish horn has fired; the result
  is locked at that instant** (see §Finish horn). The Abbrechen pill
  is therefore absent on Finished and Post — there is no in-progress
  race to wave off, only a latched result. Paddle-down ends via the
  normal idle-timeout `session_end` path.

## Trends

The Historie → Trends sub-tab aggregates per-rower performance
across a selected range (Wochen · Monate · Jahr · Alles).

### Comparable workout shape

The grouping axis used by **both** trend charts and PBs to make
sessions comparable. A *shape* is the workout's `params_json` —
e.g. `{"meters":5000}`, `{"seconds":1800}`,
`{"reps":4,"length":{"unit":"m","value":500},"rest_sec":60}`.
Captured by `workout.shape_hash`. Two sessions are comparable
iff they share a shape.

**Deliberate equivalences** (everything below merges into one
shape):

- `race {meters:N}` ≡ `distance {meters:N}` — a 2 k race and a 2 k
  tempo piece share both their PB row and their trends series.
  "Fastest 2 k effort" is one number, not two.
- Different warmup/cooldown — a 5 k with 60 s warmup and a 5 k
  with 120 s warmup are the same piece.
- Different intensity (`locker`/`moderat`/`hart`/`allout`) — the
  rower's chosen effort context doesn't fragment the series.

Trend charts group by intent, not by actual outcome. A free-row
session that happened to stop near 5 k is **not** a 5 k piece for
trend purposes — only a session whose workout target was 5 k is.
This is a deliberate rejection of tolerance-based bucketing on
`total_distance_m` (see ADR-0015).

### Completion

A session counts toward trend aggregates iff it reached **≥ 80 %**
of its workout target — `total_distance_m ≥ 0.8 × target` for
distance/race modes, `total_time_sec ≥ 0.8 × target_sec` for
time mode. Sessions below this threshold are *abandoned* and
excluded from every trend series. `just_row` sessions never appear
in trend series (no target to complete). Intervals completion is
deferred — intervals are out of scope for the v1 Leistung chart
(see ADR-0015).

### Series

A line on a trend chart corresponds to one comparable workout
shape over time. A series renders by default iff it has **≥ 3
completed sessions in the current range**. Sub-threshold series
do not render and are not surfaced in the chart UI; the existing
"Zeitraum erweitern" affordance is the user's only escape hatch
to a wider window.

### Intensity bands (Effizienz)

Efficiency metrics (DPS, SPI) are grouped not by shape but by
the session's average SPM, since technique meaning depends on
rate, not piece type: Paddle (≤ 20 spm), Steady (20–26), Hard
(≥ 26). Used for per-dot color encoding on the Effizienz chart.

## Ergo nicht erreichbar

The app state in which the backend (the Ergo at home) cannot be
reached — typically away from home, e.g. showing a trainer at the
rowing club. The phone itself is online; only the Ergo is not. The
app runs from the packed local snapshot: history data renders with an
explicit **Stand** label (the timestamp of the last successful pack),
and start affordances (favorites, new workout) are visible but
disabled — there is no Ergo to row on.

_Avoid_: "Offline" in UI copy — the phone is online, and "Offline"
reads as "the app is broken". "Offline" survives only as the informal
feature name in docs/specs.

Canonical UI copy: `Ergo nicht erreichbar · Stand: 12. Juni, 18:42`.

### Stand

The timestamp of the data snapshot currently shown — the moment the
last successful pack (or fetch) completed. Always displayed when the
Ergo is unreachable; never shown when data is live.
