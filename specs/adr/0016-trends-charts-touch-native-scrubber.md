# ADR-0016: Trends charts use a touch-native scrubber, not a hover tooltip

- **Status**: Accepted
- **Date**: 2026-05-24

## Context

The Historie → Trends sub-tab renders line charts (Leistung,
Effizienz) on an iPad mounted to the C2 ergo. The current
`DualLineChart` component has no interactive value readout — only
min/max edge labels — which is the user's stated reason for finding
the charts "hard to interpret."

The default chart-readability pattern across the web ecosystem is
a hover tooltip: mousemove → nearest point → floating label. This
pattern is wrong for the primary surface here:

1. **No hover on touch.** The product runs on iPad/iPhone. Hover
   doesn't exist; the only available substitute is tap-to-reveal,
   which is a two-step interaction for a piece of information that
   should be glanceable.
2. **Small targets, big fingers.** A 160 px-tall chart with 4–6
   dots presents 6 mm tap targets. Per-dot hit detection misses
   often; even Voronoi-cell nearest-dot detection feels awkward
   because the user has to commit to a single point per tap.
3. **Modal-ish floating tooltips collide with the rest of the
   surface.** A tooltip layer over a small chart obscures other
   dots; on touch it lacks the affordance to dismiss cleanly.

Sport-tracking apps on iOS (Apple Health, Strava, Whoop, Fitness)
have converged on a different pattern: a **scrubber** — drag
anywhere on the chart, a vertical guideline tracks the finger, and
values update live in a **persistent strip above the chart**. The
strip shows the latest dot's values when idle.

## Options considered

### Option A — Touch-native scrubber + persistent values strip

A 32 px strip above the chart always shows date + each visible
series' value. When idle, it shows the latest dot. On pointerdown
+ drag across the chart, a 1 px vertical guideline snaps to the
nearest x across all visible series' dots and the strip updates
live. Release → strip returns to "latest" after 3 s, or on tap
elsewhere. A pure tap on a dot (no drag, <200 ms, <10 px) opens
that session's Session Detail screen.

- **Pros:** native iOS convention; readable without interaction
  (latest values always visible); precise reading via familiar
  scrubbing gesture; the dot retains its navigational role
  (tap → detail) without overloading it; works identically with
  mouse on desktop (mousemove drives the same code path).
- **Cons:** ~80 lines of gesture-handling code (pointermove,
  nearest-x snap, debounced release); the dot's tap target needs
  explicit disambiguation from the scrubber gesture.

### Option B — Static "latest" strip; tap dot → Session Detail

The values strip exists but never updates from interaction. To
read older points, tap the dot and look at the detail page.

- **Pros:** trivial to build; no gesture handling.
- **Cons:** comparing arbitrary historical points requires leaving
  the chart, which is the chart's reason for existing.

### Option C — Hover tooltip with Voronoi-cell nearest-dot detection

Standard desktop pattern, ported to touch via tap-to-reveal.

- **Pros:** matches the rest of the web ecosystem; chart-library
  default.
- **Cons:** wrong primary surface — see Context above.

### Option D — Dense axes only, no interactive readout

Render so many gridlines and ticks that every value is readable
from grid position alone.

- **Pros:** zero interaction; nothing to misfire.
- **Cons:** grid clutter on a 160 px chart is unreadable;
  precision is gridline-limited (you can't read pace to the
  second from a chart that only has 3 horizontal lines).

## Decision

**Option A.** All Trends charts (Leistung in v1, Effizienz in v1,
and any future deferred-0003a chart that displays time series)
use the scrubber + persistent values strip pattern. Hover
tooltips are explicitly rejected.

Gesture rules:

- **Drag** (pointermove with movement ≥ 10 px before pointerup):
  scrub. Guideline tracks finger; strip updates to nearest x.
- **Tap on dot** (movement < 10 px, duration < 200 ms, ≤ 10 px
  from a dot): navigate to Session Detail for that session.
- **Tap elsewhere on chart** (same gating, no nearby dot): dismiss
  scrubber, return strip to "latest."
- **Release without further input**: strip stays at scrubbed
  position for 3 s, then animates back to "latest."

The strip is part of the chart card, not a floating layer. Its
layout is fixed: line 1 = date + weekday; subsequent lines = one
per visible series (`{series name}  {formatted value}`).

## Consequences

- A new `<ChartScrubber>` primitive lives in
  `web/src/components/charts/` and is shared between Leistung and
  Effizienz. The existing `DualLineChart` is replaced by a new
  `TrendsChart` primitive that wraps `ChartScrubber`; the old
  component is retained only as long as some non-Trends caller
  still needs it (audit pending).
- Per-dot click handlers continue to exist but are routed through
  the scrubber's gesture-disambiguation logic (the chart owns the
  pointer events; per-dot SVG elements are non-interactive).
- Desktop usage works automatically — `pointermove` covers mouse
  and touch — but the gesture thresholds (10 px / 200 ms) are
  tuned for touch and may feel slow with a mouse. Acceptable: the
  rower's iPad is the primary surface.
- E2E tests must drive the scrubber via Playwright touch
  emulation, not mouse-hover, to match the production interaction.
- Future deferred 0003a charts (Volumen bar chart, Regelmäßigkeit
  heatmap) have different interaction needs and are out of scope
  for this ADR. This ADR only binds *line* charts in Trends.
