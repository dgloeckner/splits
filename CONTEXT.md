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

### Ghost

A virtual opponent boat whose pace curve is either (a) the user's
last matching session for the same distance — the *session-ghost* —
or (b) a synthetic constant-split curve derived from the chosen
hardness level — the *synth-ghost*. Picking is per-race; not
persistent.

### PB-leader

A virtual opponent boat whose pace curve is the user's fastest prior
session at this exact race shape (`pb_workout`) or, if that is empty,
their fastest prior session at this distance (`pb_distance`),
whichever is faster.

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

### Session end

For a structured workout, the session ends automatically when
cooldown elapses (`PhasePlan.Classify` returns `PhaseDone`). The
client surfaces this via the results overlay; no "save?" prompt.

For a FreeRow / Just Row session (no phases), the session ends only
when the rower goes idle long enough to trigger the pause dialog and
they confirm Save / Discard.

### Stale-open session

A session whose backend row remains `ended_at IS NULL` for > 5 minutes
with no new strokes. Caused most often by an iPhone screen-lock that
killed the live connection mid-cooldown. The home page surfaces these
on rower reconnect with a "Frühere Session abschließen?" card —
finalize from last stroke, discard, or rejoin live. See ADR-0010.

**Race-mode sessions are non-resumable.** The recovery card for a
race omits "rejoin live"; only Finalize and Discard are offered. An
interrupted race always finalizes with `summary_json.race = null` —
the same outcome as an explicit abort. A race is a competition unit
that either witnessed its own finish or did not happen.

### Live split (windowed)

The "current split" tile reads the average pace over a sliding
window of recent motion (distance covered ÷ window time → 500 m). It
is *not* a per-stroke extrapolation. The window is **provisionally
5 seconds** in v1; the value is to be validated against an IPM
hardware-display capture using the replay harness, and may change.
When the window contains fewer than two completed strokes the tile
**holds the previous value** rather than dropping to nonsense. See
ADR-0011.

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
