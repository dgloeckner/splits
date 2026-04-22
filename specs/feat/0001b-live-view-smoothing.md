# FEAT-0001b: Live-View Smoothing & Dead-Reckoning

- **Status**: Draft
- **Depends on**: FEAT-0001 (Realtime Live View), FEAT-0001a (Customizable Live Dashboard)

## Summary

The Live-View currently updates strictly on frame arrival (~0.5 Hz), which
produces visible 2-second jumps on continuous values (time, distance) and
flicker on per-stroke values (watts, split, SPM). This feature introduces
frontend-side dead-reckoning for continuously-monotonic values and
exponential smoothing + hysteresis for per-stroke values, so the live
screen reads like a professional ergo console rather than a refreshing
web page.

All work happens in the frontend. The backend continues to stream raw
per-stroke values. Smoothing is a presentation concern: parameters,
window sizes, and discrete-vs-smooth choices are UI decisions, not
pipeline decisions. Persisted samples stay unmodified so history shows
the full signal.

## User stories

- As a rower looking at the live screen, I want the time to increment
  smoothly every frame, not to jump by 2 seconds, so the display feels
  like a stopwatch rather than a polling console.
- As a rower looking at the live screen, I want watts, split, and SPM to
  settle into a stable reading instead of jittering every stroke, so I
  can read intensity at a glance without eye-strain.
- As a rower looking at the sparkline tiles, I want the curve to scroll
  continuously along the X-axis rather than jump once per stroke, so
  trend perception is immediate.
- As a rower pausing mid-session (handle dropped), I want the display to
  stop extrapolating and show a "Pause" state rather than continuing to
  tick up time as if I were still rowing.
- As a rower at session start, I want the first few seconds to show raw
  values without smoothing artefacts, so I don't see a cold-start
  `0 W → 184 W` jump.
- As a rower who cares about stroke feedback, I want the stroke-pulse
  indicator to pulse *discretely* once per stroke, even though the hero
  numbers are smoothed, so I get haptic-style confirmation that my
  strokes are registering.

## Acceptance criteria

### Dead-reckoning (monotonic values)

- [ ] **Time counter**: display value is computed per `requestAnimationFrame`
      as `last_frame.elapsed + (now - last_frame.received_at)` using the
      browser's `performance.now()` monotonic clock. Frame arrival
      corrects drift by <50 ms in normal conditions.
- [ ] **Distance counter**: same pattern, using speed derived from the
      last two frames (`Δdistance / Δtime`) as the extrapolation rate.
- [ ] **Pause detection**: after `pause_threshold_ms` with no frame
      (default `4000`, i.e. 2× expected interval), dead-reckoning freezes
      and the affected tiles show a muted "Pause" indicator until the
      next frame arrives.
- [ ] **Resume**: on the first frame after a pause, the display snaps to
      the true value (no catch-up animation).

### EMA smoothing (per-stroke values)

- [ ] **Watts (hero)**: EMA with α = 0.3, plus 3 W hysteresis on the
      displayed integer.
- [ ] **Split (hero)**: EMA with α = 0.3, plus 0.1 s hysteresis on the
      displayed `mm:ss.s` format.
- [ ] **SPM (hero)**: EMA with α = 0.4, plus 0.5 hysteresis before
      rounding to integer.
- [ ] **DPS (tile)**: EMA with α = 0.3, one decimal place.
- [ ] **SPI (tile)**: EMA with α = 0.3, one decimal place.
- [ ] **Heart rate (future, when BLE belt integrated)**: EMA with
      α = 0.5, hysteresis on zone transitions only. Noted for when HR
      lands (currently deferred per FEAT-0001).
- [ ] EMA state is transient UI state. Raw per-stroke values remain the
      source of truth in the DB and over the event stream.

### Number animation (hero tiles only)

- [ ] When the displayed hero number changes, the DOM transitions
      linearly over 200-300 ms (e.g. CountUp.js or an equivalent tiny
      helper). Tile tiles (DPS, SPI, …) update immediately; only hero
      numbers animate.

### Sparklines

- [ ] Default rolling window: 90 s (= 45 samples at 0.5 Hz) on phone
      viewports. Tablet/desktop viewports use 120 s (see FEAT-0001a
      tile-size responsiveness).
- [ ] The SVG path uses a monotone-cubic interpolation (e.g.
      `d3.curveMonotoneX`) rather than straight segments, so the curve is
      smooth between data points *without* overshooting recorded peaks.
      Cardinal / B-splines that clip peaks are explicitly forbidden.
- [ ] The sparkline scrolls continuously along the X-axis using a CSS
      transform animated in `requestAnimationFrame`, not by re-drawing
      the path. On new-point arrival, the point is appended and the
      transform is reset atomically so no jump is visible.
- [ ] On session start, a sparkline renders nothing until at least two
      data points exist; below that threshold it shows a compact "sammle
      Daten…" placeholder.

### Stroke pulse

- [ ] The stroke-pulse indicator is *not* smoothed. It triggers a CSS
      transition (opacity 1 → 0.3 → 1, or scale 1 → 1.15 → 1, over ≤400
      ms) on every stroke-frame received. Explicit intent: this widget
      is the discrete counter-point to the smoothed hero numbers.

### Cold start

- [ ] For the first `T_cold` seconds after `session_start` (default 5 s,
      empirically ~2-3 strokes at typical cadence), EMA is bypassed and
      raw values flow through. After `T_cold`, EMA activates seeded
      with the current raw value as its initial state (no cold-start
      jump from 0).
- [ ] Sparklines show the "sammle Daten…" placeholder during the cold
      window (see above).

### Sparkline Y-axis scaling

Adaptive scaling with per-metric minimum span and absolute clamps so
calm sessions do not look dramatic and extreme sessions do not overflow
the tile. Min/max labels at the tile corners always show the **actual**
visible data range so the viewer can see real values even when the axis
is padded.

Algorithm:
1. Compute `dataMin`, `dataMax` across visible points.
2. `desiredRange = max(dataRange * 1.2, metricMinRange)`.
3. Center the scale on the data mean: `center = (dataMin + dataMax) / 2`.
4. `yMin = center - desiredRange/2`, `yMax = center + desiredRange/2`.
5. Clamp `yMin`, `yMax` to the metric's absolute bounds. If the clamp
   shrinks one side, do not re-expand the other — let the window be
   smaller; the visible line will sit near the clamped edge, which is
   the correct signal.

Per-metric config:

| Metric | Min range | Clamp min | Clamp max |
|--------|-----------|-----------|-----------|
| Watt   | 100 W     | 0         | 600       |
| Split  | 30 s      | 60 s      | 240 s     |
| DPS    | 4 m       | 0         | 20        |
| SPM    | 10        | 0         | 50        |
| HF     | 40 bpm    | resting   | max       |

Notes:
- Split: smaller is better; the line inverted on screen is handled by
  the tile render, not by the axis computation.
- HF: `resting` / `max` default to 40 / 200 until the rower profile
  carries zones (FEAT-0004).

Tile chrome (per Stitch "Live-Ansicht (Sparkline Refinement)"):
- Top-left: metric label (uppercase tracking).
- Top-right: current value in primary colour.
- Bottom-left corner: actual `dataMin` value.
- Bottom-right corner: actual `dataMax` value.
- Horizontal dashed reference line at `mean(dataMin, dataMax)`.

- [ ] `computeAxis(points, metric)` is a pure function with tests
      covering: empty input, single point, flat-line input, range below
      minimum, range above minimum, clamp-low, clamp-high, clamp-both.
- [ ] `Sparkline` accepts a `metric` prop and calls `computeAxis` to
      derive `yMin` / `yMax`. No data is clipped — the path is allowed
      to overflow when a real peak exceeds the padded range. Overflow
      is visually acceptable; the tile clips with `overflow: hidden`.
- [ ] `SparklineTile` renders the chrome described above; values pulled
      from `computeAxis` (`dataMin`, `dataMax`) and the latest sample
      (current value).

### Observability

- [ ] Smoothing parameters (`α`, hysteresis thresholds, `T_cold`,
      `pause_threshold_ms`, window durations) live in a single
      frontend configuration object so they can be tuned without
      cross-file hunts. Future personalisation ("reactive" vs. "calm"
      preset) attaches here.

## Non-goals

- Backend-side smoothing. Backend continues to stream raw per-stroke
  frames. Any smoothing knobs are frontend-only.
- Persisting smoothed values. DB and export paths (CSV / FIT) keep raw
  samples.
- HR smoothing implementation (deferred until FEAT-0001 ships HR; the
  acceptance line is forward-looking only).
- Per-user preference UI for smoothing style. The config lives in code;
  exposing a settings toggle is a follow-up (see FEAT-0002 / FEAT-0008).
- Clock-offset handshake between server and client. Browser `performance.now()`
  against `frame.received_at` (browser-local) is accurate enough for
  dead-reckoning within a session.

## UX notes

- **Hero tiles** (watts, split, SPM): smoothed + animated.
- **Sparklines**: continuous scroll + monotone spline + 90/120 s window.
- **Stroke-pulse tile**: discrete, one flash per stroke, no smoothing.
- **Time & distance tiles**: dead-reckoned at 60 fps, corrected per frame.
- **Cold-start copy**: first 5 s show raw values; sparklines show
  "sammle Daten…" placeholder until ≥2 points.
- **Pause state**: affected tiles fade to 70 % opacity and overlay a small
  "Pause" chip anchored top-right of the tile.

## Open questions

- **Pause threshold tuning**: 4 s covers typical-stroke-rate-halved
  detection, but an athlete briefly letting go mid-stroke (< 4 s) will
  see dead-reckoning overshoot slightly. Field-test needed. Possibly
  scale the threshold with the current stroke interval rather than
  using a constant.
- **Split format at very low speeds**: `mm:ss.s` breaks at <0.1 m/s
  (split → ∞). Current code shows `--:--`; confirm EMA + hysteresis
  do not latch onto a stale pre-pause value when speed recovers.
- **Dead-reckoning of distance when speed is zero for ≥1 frame**:
  extrapolation rate = 0 is correct, but the transition into pause
  should still happen once pause threshold elapses. Verify order of
  operations.
- **Number-animation library choice**: CountUp.js is mature but adds
  ~3 KB gzipped; a custom `requestAnimationFrame`-based tween is ~20
  lines. Prefer homegrown unless a library feature (easing presets,
  accessibility suppression under `prefers-reduced-motion`) materially
  pays off.
- **Frame-drop under backgrounding**: browsers throttle `requestAnimationFrame`
  when the tab is hidden. Dead-reckoning needs a `visibilitychange`
  handler to skip the gap and snap to the authoritative value on wake.
