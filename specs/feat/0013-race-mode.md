# FEAT-0013: Race Mode (Workout Type + Dedicated Live View)

- **Status**: Proposed
- **Owner**: @gloeckner
- **Supersedes**: FEAT-0012 (Race Boat tile) — the tile is removed; race
  becomes a first-class workout mode with its own live-view canvas.
- **Depends on**: FEAT-0001 (live view), FEAT-0001b (smoothing),
  FEAT-0005a (workout selection / hardness), FEAT-0008 (design system),
  FEAT-0009 (cleanup — `summary_json.samples`), FEAT-0010 (PBs —
  `pb_workout`, `pb_distance`)

## Summary

A new `race` workout mode that mirrors `distance` (fixed meters) but
runs against virtual opponents — a **ghost** (last matching session, or
synthesised from chosen hardness when no prior session exists) and a
**PB-leader** (workout-PB or matching distance-PB, whichever is faster).
Selecting Race lives in the third row of the home-screen workout
chips; an opponent picker appears before the session starts. The live
view is a full-bleed racing canvas — no hero band, no tile grid — with
animated water, distance markers (tablet only), and a finish-line
banner. End-of-race opens a dedicated post-race screen showing both
gaps and the opponent pace curves overlaid on the user's. Race results
are persisted (new fields on `summary_json` and lifetime PB recompute
runs against both `pb_workout` and `pb_distance`).

## User stories

- As a rower, I want a dedicated **Race** option on the home screen so
  I don't have to enable a tile to get a race experience.
- As a first-time racer for a given distance, I want a **synthesised
  ghost** based on the hardness I picked, so I'm not blocked by "row a
  2k once first".
- As a tablet user, I want the race canvas to fill the screen so it
  reads like a broadcast.
- As any user, I want a **post-race result** that shows me both gaps
  and the pace shapes, not just an ephemeral toast.

## Acceptance criteria

### Workout mode

- [ ] New mode value `race` accepted by the `workout` table (migration
      extends the CHECK constraint to `just_row | distance | time |
      intervals | race`).
- [ ] `race` params reuse the `distance` mode shape: `{"meters": N}`
      with N restricted to standard PB distances (500, 1000, 2000,
      5000, 6000, 10000, 21097, 42195) for v1. Non-standard distances
      are not selectable.
- [ ] `race` workouts carry an `intensity` (`locker | moderat | hart |
      allout`) which is interpreted as **target hardness for the
      synthesised ghost** when no prior session exists for the shape.
- [ ] `shape_hash` for a `race` workout is computed identically to a
      `distance` workout of the same meters/warmup/cooldown — i.e. a
      race and a distance row of the same shape **share** the same
      `pb_workout` row.
- [ ] Completing a `race` workout sets/refreshes BOTH `pb_workout`
      (race shape) AND `pb_distance` (the meters achieved). FEAT-0010
      recompute is unchanged; the race mode does not bypass it.

### Home / selection

- [ ] Home page exposes a third row of workout chips below the
      existing rows. Chip label `Rennen`, icon = boat silhouette.
- [ ] Tapping the chip opens an inline distance picker (same UX as
      distance-mode picker) restricted to the standard distances.
- [ ] After distance is chosen, an **opponent picker** sheet appears
      with up to two toggleable rows:
  - `Geist (letzte Session)` — enabled iff a matching prior session
    exists; otherwise disabled with copy `Synthetischer Geist nach
    Härte` and pre-selected.
  - `Bestzeit` — enabled iff a matching `pb_workout` or matching
    `pb_distance` exists; otherwise the row is **hidden** entirely
    (not shown disabled).
- [ ] User confirms with `Rennen starten`. Selection is locked for
      the session.
- [ ] When neither real ghost nor PB exists, picker still proceeds:
      synthesised ghost is the only opponent. Race mode never blocks
      "row once first".

### Synthesised ghost (no prior session)

- [ ] Ghost pace curve is derived from chosen `intensity` mapped to a
      target split:
  - `locker` → 2:15/500m
  - `moderat` → 2:00/500m
  - `hart` → 1:50/500m
  - `allout` → 1:42/500m
- [ ] Synthesised ghost has a constant split for the entire distance
      (no fade, no surge). v2 may add curve shapes.
- [ ] Synthesised ghost is **not** a real session — the post-race PB
      hooks operate against the user's session only; opponent does not
      become a PB candidate.

### Live view (full takeover)

- [ ] Race-mode sessions render a dedicated `RaceLiveView` that
      replaces hero band AND tile grid AND workout progress strip AND
      segment status. Pause/abort overlays remain unchanged.
- [ ] Tile grid configuration is **ignored** for race-mode sessions
      (race view is not a tile and not configurable).
- [ ] **Stat bar** (top, ~16% of viewport height):
  - Phone portrait: 4 cells — `split | distance remaining | watts |
    leader gap` (single signed chip showing the gap to whichever
    opponent is ahead of the user; ties → gap to PB).
  - Tablet landscape: 6 cells — `split | distance remaining | watts |
    SPM | gap to PB | gap to ghost`.
- [ ] **Race canvas** (remaining viewport): three lanes
      (`pb / user / ghost`) when both opponents present; two lanes
      when only one. User boat is always horizontally centered.
- [ ] **Pace trail**: each opponent renders a translucent trail showing
      its position 5 / 10 / 15 s ago (three trail segments,
      decreasing opacity). User's own boat does not render a trail.
- [ ] **Animated water**: subtle horizontal-scrolling water texture
      under all lanes, scroll speed scales with median user velocity.
      Reduced-motion media query disables animation.
- [ ] **Distance markers**: every 100 m on tablet (≥ 768 px wide
      viewport), every 250 m on phone with markers visible only when
      lane width affords ≥ 6 markers on screen. Below that threshold,
      markers are omitted.
- [ ] **Finish line**: vertical line + flag glyph at the final-meter
      mark. Banner text overhead (`2000 m Rennen`) shown only on
      viewports ≥ 768 px wide.
- [ ] **Off-screen chips**: per-opponent edge chip identical to the
      old FEAT-0012 spec — meters by default, split-equivalent
      seconds when `|gap| < 5 m`.
- [ ] **Camera**: always centers on user. Zoom-out at finish is **not**
      in scope for v1.
- [ ] **Sounds**: rowing-start "set ready, attention, beep" sequence
      at session start; finish horn at user finish. Reduced-motion or
      muted-page user setting disables sounds.

### Pause & abort

- [ ] Pause halts user, ghost, and PB (existing pause-sync mechanism:
      backend stops emitting strokes → all opponent positions freeze).
- [ ] Aborting before reaching the workout's distance goal records the
      session normally (no race result is persisted).

### Post-race screen

- [ ] At session_end (when goal is reached), the live view transitions
      directly into a dedicated `RacePostScreen` (replaces the
      existing `SessionEndedOverlay` for race mode only — non-race
      sessions still see the standard overlay).
- [ ] Post-race screen shows:
  - User's final time + final split.
  - For each opponent present: signed gap (e.g. `vs. PB: -4.2 s`),
    opponent's final time, opponent's final split.
  - **Pace overlay chart**: x-axis = distance, y-axis = split; one
    line per boat (user, opponents). Reuses FEAT-0003a pace-curve
    component if available; otherwise the spec defines a new chart.
  - Two CTAs: `Erneut rennen` (re-enters race-mode start with same
    distance + opponents pre-selected), `Detail` (opens
    `SessionDetailPage` for the new session).
- [ ] Race result is **persisted** as new fields on `summary_json`:
  ```jsonc
  "race": {
    "vs_pb_sec": -4.2,           // null when no PB opponent
    "vs_ghost_sec": 2.1,          // null when no ghost opponent
    "ghost_kind": "session" | "synth",
    "opponent_session_ids": ["S_GHOST", "S_PB"]   // omit synth ghost
  }
  ```
  No new table required.

### Backend API changes

- [ ] Old route `GET /api/v1/race/opponents` is **removed**.
- [ ] New route `GET /api/v1/workouts/{id}/opponents` resolves
      opponents for a given (race-mode) workout id. Response shape:
  ```jsonc
  {
    "ghost": {
      "kind": "session" | "synth",
      "source_session_id": "S123",       // omit when synth
      "label": "ghost",
      "t_sec": [...], "split": [...]
    } | null,
    "pb": {
      "kind": "session",
      "source_session_id": "S456",
      "label": "pb",
      "t_sec": [...], "split": [...]
    } | null
  }
  ```
- [ ] Synth-ghost is generated server-side: total seconds = `meters /
      (500 / target_split)`; emit one sample every 5 s with constant
      split.
- [ ] Endpoint returns 400 when workout is not race-mode (caller bug).

### Workout-mode list

- [ ] FEAT-0005a workout selection UI surfaces `race` only via the
      home-screen chip; the existing builder/library does not list it.

## UX notes

- Stat bar font size minimum 18 pt for sweaty-meter-away readability,
  per FEAT-0008 design anchor.
- Trails use 35 / 20 / 10 % opacity at 5 / 10 / 15 s lookback.
- Reduced-motion: disable water + trails + start beep tone (visual
  start cue stays).
- Chip-vs-onscreen threshold from FEAT-0012 retained: opponent off
  when `|offsetPx| > paneWidthPx/2 - 12`.
- Tablet portrait is treated like phone portrait (single gap chip)
  unless viewport width ≥ 768 px AND aspect ratio > 1.

## Visual reference

```
PHONE PORTRAIT (375×667 — race in progress)
┌──────────────────────────────┐
│ 1:48  780m  285W  PB -3.2s   │ ← stat bar
├──────────────────────────────┤
│ ░░░░░🚣── PB                 │
│ ░░░░░░░░🚣 ── you (centered) │
│ ░░🚣 ────── ghost      +12m  │
│ ··250··  ··500··  ··750··  🏁│
└──────────────────────────────┘

TABLET LANDSCAPE (1024×768)
┌────────────────────────────────────────────────────────────┐
│ 1:48/500m  780m  285W  24SPM  PB -3.2s  GHOST +12m         │
├────────────────────────────────────────────────────────────┤
│                            2000 m Rennen                   │
│              ════════════════════════                       │
│  ░░░░░░░░░░░░🚣 ── PB                                       │
│  ░░░░░░░░░░░░░░░🚣 ── you                                   │
│  ░░░░🚣 ────── ghost                                        │
│              ════════════════════════                       │
│  ·100·200·300·400·500·600·700·800·900·1000············1900·🏁│
└────────────────────────────────────────────────────────────┘
```

## Non-goals

- **Multiplayer / live opponent.** Out of scope. v2+.
- **Coaching cues** ("push, -2s"). Out of scope.
- **Pace boat** (constant target split as opponent type) — superseded
  by synthesised ghost in this FEAT.
- **Camera zoom-out at finish.** Out of scope.
- **Synth-ghost curve shapes** (fade, surge). Constant split only.
- **Race mode in workout builder.** Home-chip only.
- **Custom race distances.** Standard distances only.
- **Audio mixing / volume sliders.** Hard-coded subtle defaults; UA
  mute respected.

## Migration / removal of FEAT-0012

- [ ] Remove the `race-boat` tile from `web/src/tiles/registry.ts`.
- [ ] Remove `RaceTile`, `RaceTileAdapter`, `RaceOpponentsContext`,
      `RaceResultToast`, `useRaceFinish`, `raceFinish.ts`,
      `useRaceOpponents.ts`, and the corresponding tests. Keep
      `BoatSprite.tsx` (reused by RaceLiveView) and `distance.ts`
      (reused).
- [ ] Remove the backend `/api/v1/race/opponents` route and the
      `RaceOpponentsHandler` that backed it (the workout-id-driven
      replacement supersedes it).
- [ ] Mark FEAT-0012 spec **Superseded by FEAT-0013** in its header
      and `specs/feat/README.md`.

## Resolved decisions (locked)

- **Synth-ghost target splits**: `locker → 2:15`, `moderat → 2:00`,
  `hart → 1:50`, `allout → 1:42`.
- **Phone-portrait stat bar**: 4 cells — `split | dist-remaining |
  watts | leader-gap` (single signed chip showing the gap to whichever
  opponent leads; ties → PB gap).
- **Reduced-motion**: disables water animation + sounds only. Pace
  trails are static position offsets and remain rendered.
- **Race-result cleanup**: nested in `summary_json.race`; FEAT-0009
  hard/soft delete already covers `summary_json`. No separate cleanup.

## Audio assets

Start sequence (`set ready` / `attention` / `beep`) and finish horn
must be commissioned. Until assets land, the live view ships with
sounds **disabled by default**; an internal toggle (env or feature
flag) enables playback once files are in `web/public/audio/race/`.
Track this in the implementation plan as a separate sub-task with no
code dependency on the asset arrival.
