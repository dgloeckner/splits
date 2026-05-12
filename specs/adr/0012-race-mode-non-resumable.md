# ADR-0012: Race-mode sessions are non-resumable

- **Status**: Proposed
- **Date**: 2026-05-12

## Context

ADR-0010 establishes the stale-open session recovery flow: when a
session's backend row remains `ended_at IS NULL` for more than five
minutes without new strokes, the home page surfaces a "Frühere Session
abschließen?" card on rower reconnect with three actions — **finalize
from last stroke**, **discard**, or **rejoin live**. This covers the
common case of an iPhone screen-lock killing the live connection
mid-session.

FEAT-0014 (race mode cleanup) raises the question of how this flow
applies to race-mode sessions. CONTEXT.md defines a race as a
self-contained competition unit with a deliberate start ceremony, a
fixed course, and a finish horn. Three properties of the race model
sit awkwardly with "rejoin live":

- The race result is **deterministic at finish-line cross**. The
  finish-horn behaviour and the backend re-derivation of
  `summary.race` at `session_end` (see FEAT-0014 decision 4) both
  depend on the app having continuously witnessed strokes through
  the cross moment. If the connection dropped before the cross and
  reconnected after, the app does not know on which side of the
  finish line each missing stroke fell.
- The race canvas, opponent pace curves, gap chips and start
  ceremony are useless past the finish horn except as a paddle-down
  display. "Rejoining live" for a race that has already crossed its
  own finish (during the dropout) puts the user back into a UI that
  no longer applies.
- The competition framing in CONTEXT.md is unambiguous: a race
  either witnessed its own finish or did not happen. Producing an
  official race result from a session the app partially missed
  would undermine that framing.

## Options considered

### Option A — Race sessions are non-resumable

The recovery card for a race-mode session omits "rejoin live"; only
Finalize and Discard are offered. An interrupted race always
finalizes with `summary_json.race = null` — the same outcome as an
explicit abort. The rower's stroke data is preserved as a normal
session row.

Pros: matches the domain framing; keeps lifecycle code paths simple
(no "did the race finish during the dropout?" branch); aligns with
the spec's existing abort behaviour (FEAT-0014 AC line 72–74).

Cons: a rower who finished a real race cleanly but lost the phone
connection between the finish line and `session_end` does not get a
race result — only stroke data with no `summary.race`. Mitigated by
the rarity of mid-paddle-down connection loss and by the rower
having seen the latched in-flight overlay on their own screen up
until the dropout.

### Option B — Resume iff the finish line wasn't crossed

If `max(stroke.distance_m) < race_t0_distance + totalMeters`,
"rejoin live" rejoins the race in progress; otherwise it goes
straight to `RacePostScreen` with the race latched at the
last-stroke time and gaps recomputed.

Pros: preserves race results for the dropout-during-paddle-down
case.

Cons: introduces a branch that is hard to test reliably; requires
the recovery flow to inspect stroke history before deciding which
action to expose; expands the surface area of "what is a valid race
result" to include results the live UI never finished rendering.

### Option C — Treat race sessions identically to other sessions

The recovery card surfaces all three actions; "rejoin live" lands
the rower on a `RaceLiveView` that figures out its own state.

Pros: zero special-casing.

Cons: stale opponent curves, stale gap chips, ceremony state
machine in an undefined position; almost certainly produces a
broken UI for any non-trivial dropout duration.

## Decision

**Option A.** Race-mode sessions are non-resumable. The recovery
card for a race omits "rejoin live"; only Finalize and Discard are
offered. An interrupted race always finalizes with
`summary_json.race = null` — the same outcome as an explicit abort.

## Consequences

Becomes easier:

- Recovery flow code path for race mode is the simplest of the
  three modes: two buttons, no branch on stroke history.
- `summary.race` is always either present (race witnessed
  end-to-end) or null (race not witnessed end-to-end). No
  partial-witness state.
- Replay determinism: every persisted `summary.race` corresponds to
  a stroke stream the app saw continuously, which the replay
  harness can re-derive without dropout reasoning.

Becomes harder:

- A rower who genuinely finished a race but lost connection during
  paddle-down has stroke data but no race result. The rower has
  already seen their result on their own screen via the latched
  in-flight overlay, but the home-screen history and PB views will
  not reflect it. Acceptable: the rower can re-race; the in-flight
  overlay value was always advisory pending `session_end`.

New work required:

- The recovery card UI branches on `workout.mode == 'race'` and
  hides "rejoin live" for race rows.
- Finalize-from-last-stroke for race rows must explicitly set
  `summary.race = null` regardless of where the last stroke landed.
- CONTEXT.md's "Stale-open session" section reflects this rule
  (already updated alongside FEAT-0014).
