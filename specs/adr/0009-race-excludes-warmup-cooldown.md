# ADR-0009: Race mode excludes warmup and cooldown

- **Status**: Proposed
- **Date**: 2026-05-09

## Context

FEAT-0013 (Race Mode) shipped with race workouts inheriting the same
warmup/cooldown UI as `distance` and `time` modes: the confirm screen
shows the toggles, and `warmup_sec` / `cooldown_sec` participate in
`shape_hash`. In practice this caused a chain of integration problems:

- The `RaceStartSequence` (FISA traffic light) fires the moment
  `RaceLiveView` mounts, i.e. at session start. When `warmup_sec > 0`,
  the green "GO!" flashes 4.5 s into a multi-minute warmup, while the
  rower is still at a recovery pace. The ceremony has no relationship
  to the actual race start.
- Race opponents (ghost, PB-leader) are pace curves sampled from
  prior sessions. The user's `userDistanceM` and `elapsedSec` start
  at session_start, so the comparison plots opponent's-warmup-pace
  against user's-warmup-pace — meaningless.
- The stat bar's "distance remaining" ticks down during warmup,
  implying the warmup is part of the race.
- `shape_hash` includes warmup/cooldown, so a 2 km race with a 5 min
  warmup is a different `pb_workout` row than a bare 2 km race. The
  home-screen chip surfaces only meters; users have no visibility
  into the implicit shape fragmentation.
- The post-race overlay does not appear until `session_end` (after
  cooldown), even though the result is deterministic the moment the
  finish line is crossed.

A real race in rowing is a self-contained competition unit: start
line, course, finish line. Warmup and cooldown happen on either side
in separate pieces of water — not within the race itself.

## Options considered

### Option A — Drop warmup/cooldown from race mode entirely

Race workouts always have `warmup_sec = cooldown_sec = 0`. The
confirm screen hides the toggles for race mode. Backend validation
enforces zero on create. Rowers who want to warm up first do a
separate `just_row` session.

Pros: eliminates the start-sequence misfire, opponent-pace-curve
alignment garbage, and PB fragmentation in one move. Matches the
real-world domain. Simplifies the live view (no segment plumbing).

Cons: rowers must explicitly start a second session for warmup —
slight friction. Historical race rows that already carry non-zero
warmup/cooldown need a one-time data audit.

### Option B — Keep warmup/cooldown, fix the integration

Keep the toggles. Make `RaceLiveView` aware of segments: render a
plain warmup screen during the warmup segment, transition to the
race canvas at warmup→work, fire the start ceremony at the
transition, transition back to a cooldown screen at work→cooldown.
Trim opponent samples to their own work segment.

Pros: race is one workout; rower doesn't manage two sessions.

Cons: significant plumbing (segment-aware live view, opponent-sample
trimming, ceremony coupled to segment transitions, post-race overlay
that handles a still-active cooldown). Encodes the assumption that
warmup/cooldown belong to the race when domain experts disagree.

### Option C — Race-specific pre-race phase ("paddle to start")

Replace generic warmup with a race-specific phase: paddle up to the
start, an attention/set/go ceremony at the work segment boundary, no
cooldown by default.

Pros: most authentic to FISA. Cons: largest scope. Premature for
v1 — not enough signal that users want this beyond a generic warmup.

## Decision

**Option A.** Race mode forces `warmup_sec = cooldown_sec = 0`. The
race competition unit owns its own start (the `Bereit` tap +
ceremony) and its own finish (the at-cross overlay). Pre-race and
post-race rowing are explicitly separate sessions if the rower wants
them recorded.

## Consequences

Becomes easier:
- `RaceLiveView` stops needing segment awareness.
- The start ceremony has a clear t=0 (the `Bereit` tap → first
  stroke).
- `shape_hash` for race shapes always equals the corresponding
  bare-distance shape, unifying race and distance PBs cleanly.
- The post-race overlay can fire at finish-line cross without
  fighting an active cooldown segment.

Becomes harder:
- Rowers wanting a warmup must remember to start a `just_row`
  session first. A future onboarding hint can address this.
- Historical race rows with non-zero warmup/cooldown exist in the
  wild (created during the FEAT-0013 window). They keep working but
  no longer match new race PBs at the same distance because the
  shape differs. Acceptable: the population is small and recent.

New work required:
- Hide warmup/cooldown UI in `ConfirmScreen` when `mode === 'race'`.
- Add backend validation on `POST /workouts` rejecting non-zero
  warmup/cooldown for race mode.
- One-shot migration: for existing race rows with
  `warmup_sec > 0 OR cooldown_sec > 0`, either rewrite to zero
  (and recompute `shape_hash` + PBs) or leave as-is. Decision
  deferred to FEAT-0014 — see open questions there.
- Update `specs/feat/0013-race-mode.md` to note that line 54
  ("meters/warmup/cooldown") simplifies to "meters" for race shapes.
