# FEAT-0012: Race Boat (Ghost + PB Leader)

- **Status**: Proposed
- **Owner**: @gloeckner
- **Depends on**: FEAT-0001 (live view), FEAT-0001a (dashboard tiles),
  FEAT-0001b (smoothing), FEAT-0008 (design system), FEAT-0009
  (cleanup — `summary_json.samples`), FEAT-0010 (PBs — `pb_workout`,
  `pb_distance`)

## Summary

Race a virtual boat in the live view. Two opponents, simultaneous
when both eligible: a **ghost** of the rower's last completed session
of the same workout-shape, and a **PB-leader** (best `pb_workout`,
or matching `pb_distance` if shape is a standard distance). Renders as
a 3-lane horizontal track tile in the live dashboard, side-scrolling
with the user centered and off-screen opponents collapsed to a `+Xm`
chip. The opponent set is locked at session start.

## User stories

- As a rower, I want to race my last session so I can feel whether
  today is faster or slower without staring at split numbers.
- As a rower chasing a PB, I want to see how far ahead my best ever
  is, so I can pace the attack.
- As a rower with no PB on this workout-shape yet, I want the ghost
  alone, without a phantom PB lane making me feel behind.

## Acceptance criteria

### Eligibility & opponent selection

- [ ] At workout start, app resolves opponents and locks them for the
      duration of the session. Mid-session swap is not possible.
- [ ] **Ghost** = most recent past session whose `workout_shape_key`
      matches the current workout (strict equality on distance,
      intervals, rest), excluding free-row sessions.
- [ ] **PB-leader** = `pb_workout` row for the same shape; if shape is
      a standard distance and a `pb_distance` for that distance is
      faster than the workout-PB, use `pb_distance` source session.
- [ ] If ghost source session = PB-leader source session, render
      single ghost lane (de-dupe), color = PB amber.
- [ ] If no eligible ghost: tile is hidden entirely.
- [ ] If ghost eligible but no PB: PB lane hidden, 2-lane render
      (you + ghost). No fallback to "second-best ghost".
- [ ] Free-row sessions: tile always hidden.
- [ ] Source session for either opponent is **soft- or hard-deleted**
      → opponent treated as gone. If both gone, tile hidden.

### Replay data

- [ ] PB-leader and ghost positions are derived from
      `summary_json.samples.t_sec` and `samples.split` of the source
      session. No new schema field. Distance reconstructed
      client-side: `d[i] = d[i-1] + (500 / split[i]) * (t[i]-t[i-1])`.
- [ ] Between samples, position is interpolated with a monotone
      cubic spline (same approach as FEAT-0001b hero metrics).
- [ ] Sample bucket size for new sessions: `max(1s, dur_sec / 360)`.
      Applied to new sessions only; existing sessions keep their
      stored series.
- [ ] Ghost ends when its source session ends. After that the lane
      stays open and the user races to their own finish line; ghost
      sprite stops at its final position with a small flag.

### Pause & abort

- [ ] When user pauses, ghost and PB-leader both pause. Resume
      restarts all clocks together.
- [ ] If user quits before reaching the workout's defined end (e.g.
      stops a 2k at 1500m), no race result is recorded — toast not
      shown.

### Geometry & rendering

- [ ] Tile is a horizontal 3-lane track. User centered vertically,
      ghost above, PB below. (2-lane variant when only one opponent.)
- [ ] Lane scrolls so user is always horizontally centered.
- [ ] When an opponent is off-screen (lead or trail), a chip on the
      lane edge shows signed gap for that lane. Per-opponent chips,
      not one combined chip. Default unit is meters (`+18m`,
      `-22m`); when absolute gap < 5 m, switch to split-equivalent
      seconds (`+1.4s`, `-0.8s`) for legibility on close finishes.
- [ ] At workout finish, an ephemeral toast displays gaps to **both**
      opponents (e.g. `vs. PB: -4.2 s · vs. last: +2.1 s`). Result is
      not persisted — no `races` table, no field added to
      `summary_json`.
- [ ] Tie at finish renders as `0m` / `0.0s`.
- [ ] Tile is responsive: on iPad landscape, occupies a wider footprint
      so the lane reads at a glance; mobile portrait collapses to
      minimum 28px-tall lanes.

### Visual / design system

- [ ] Boat sprite is a single inline SVG component, viewBox `0 0 72
      24`, strokes use `currentColor`, fill uses `currentColor` with
      `fill-opacity` for the hull. Each lane sets `color` via CSS.
- [ ] Above 28 px lane height, render the full SVG (hull + rower +
      oar). Between 20 px and 28 px, render the hull-only variant
      (rower torso, head, oar shaft and blade dropped). Below 20 px
      hard floor, the tile is hidden.
- [ ] Lane colors:
  - User boat: `#14B8A6` (teal)
  - PB-leader: `#F59E0B` (amber)
  - Ghost (last): `#94A3B8` (slate)
- [ ] Opponents are anonymous — labelled `PB` and `Ghost`. No date or
      rower name shown on the tile.

## Boat SVG (inline reference)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 24" fill="none"
     stroke="currentColor" stroke-linejoin="round" stroke-linecap="round">
  <!-- Hull -->
  <path d="M 2 11 Q 28 7 56 8 L 70 11 L 56 14 Q 28 15 2 11 Z"
        fill="currentColor" fill-opacity="0.16" stroke-width="1.5"/>
  <!-- Rower torso -->
  <path d="M 30 8 Q 35 2 40 6" stroke-width="1.6"/>
  <!-- Head -->
  <circle cx="40" cy="3" r="2" fill="currentColor" stroke="none"/>
  <!-- Oar shaft -->
  <line x1="34" y1="6" x2="14" y2="20" stroke-width="1.2"/>
  <!-- Oar blade -->
  <ellipse cx="11" cy="20.5" rx="3" ry="1" fill="currentColor" stroke="none"/>
</svg>
```

Bow points right. For mirrored layouts, wrap in `transform="scale(-1,
1) translate(-72, 0)"` or apply CSS `transform: scaleX(-1)`. Hull-only
variant strips torso, head, oar shaft, oar blade.

## UX notes

- Lane width auto-scales: when both opponents on-screen, lane fits
  worst-case gap with ~10% headroom. When user is far behind/ahead,
  user stays centered and opponents collapse to edge chips.
- Distance reconstruction uses cumulative integration of pace, so
  ghost position drifts vs. true historical distance. Acceptable —
  user's own boat uses live SSE distance, both reconstructions are
  internally consistent within a lane.
- Sprint sessions (<5 min) get sub-second buckets via the
  `max(1s, dur/360)` floor → ghost sprite moves smoothly even at
  high cadence.

## Non-goals

- **Multiplayer / live opponent.** Not in scope. v2+.
- **Coaching cues** ("push, -2s"). Not in scope. v2+.
- **Pace boat** (constant target split). Not in scope. v2+.
- **Persisted race results.** Toast only; no races table, no
  `summary_json` extension.
- **Opponent picker UI.** v1 auto-selects last + PB. No manual choice.
- **Shape-fuzzy matching.** Strict equality only.
- **Free-row ghosts.** Excluded entirely.
- **Retroactive bucket-size re-derivation.** Old sessions keep their
  stored series.

## Resolved decisions (locked)

- **Shape-key reuse**: ghost selector reuses the same
  `workout_shape_key` semantics defined in FEAT-0010 (`pb_workout`).
  No parallel helper in this FEAT.
- **Tile catalogue**: adds a new tile type `race-boat` to FEAT-0001a,
  default **off**, opt-in via the tile picker.
- **Lane height**: full SVG ≥ 28 px, hull-only variant 20–28 px,
  tile hidden below 20 px.
- **Off-screen chip unit**: meters by default, switch to
  split-equivalent seconds when absolute gap < 5 m.

## Deferred

- Full end-to-end Playwright spec for race-boat tile + finish toast (T18 plan) is deferred. Backend handler, opponent-selection logic, and the finish-toast pipeline are covered by Go and Vitest tests. The remaining gap is a single browser-driven test that seeds a prior matching session, drives strokes through completion, and asserts the toast appears. To be picked up once the E2E fixture set grows a "seeded prior session with samples" helper.
