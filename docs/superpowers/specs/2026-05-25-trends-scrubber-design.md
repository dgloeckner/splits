# Trends Scrubber + Axes + Rolling Average — Design

> Brainstormed 2026-05-25. Implements ADR-0016 plus three adjacent UX decisions accepted in the original ADR-0015 grilling session that were deferred from the v2 plan: sparse axes, range-scaled rolling-average overlay (Leistung only), and the per-series "vs N-d Ø" delta in the values strip. Out of scope: PB dashed horizontal line, per-dot SPM-band coloring on Effizienz, refined color palette across many series. Those are a follow-up polish slice.

## Goals

Make the Historie → Trends charts readable on an iPad mounted to the C2 ergo, without changing the API or the data model.

After this slice, the Leistung and Effizienz cards on the Trends tab will:

- Show sparse axes (3 horizontal gridlines + 3–5 date ticks) so the line's *shape* is readable at a glance.
- Show a rolling-average dashed overlay on Leistung's primary series (range-scaled window) so the *trend* is readable past per-session noise.
- Let the user scrub a finger across the chart to read precise values, with a persistent values strip above the chart that updates live and falls back to the latest session when idle.
- Let the user tap any dot to push to the existing `SessionDetailPage` at `/historie/:sessionId`.

## Non-goals

- Bar charts, heatmaps, and milestone strips (FEAT-0003a deferred items). This spec binds only line charts.
- PB dashed horizontal reference lines. The PB value continues to appear as text in the values strip; drawing it on the chart is a follow-up.
- Per-dot color encoding by SPM band on Effizienz.
- Replacing or removing the existing `DualLineChart` component. If no caller remains after this slice, a separate cleanup PR can delete it.

## Architecture

One new chart primitive (`TrendsChart`) replaces `DualLineChart` usage inside `TrendsTab.tsx`. A pure gesture hook (`useChartScrubber`) implements ADR-0016's interaction rules. A small set of pure helpers handles rolling averages and date formatting.

```
web/src/components/charts/
├── TrendsChart.tsx              ← the SVG + strip primitive (~250 LOC)
├── useChartScrubber.ts          ← gesture state machine
├── useChartScrubber.test.tsx    ← hook tests
├── rolling.ts                   ← rollingAverage + rangeRollingWindowDays
├── rolling.test.ts              ← pure-function tests
├── format.ts                    ← formatChartDate (per-range) + formatGerman
└── format.test.ts
```

`TrendsTab.tsx` swaps two `<DualLineChart>` call sites for `<TrendsChart>` calls. Its `LeistungChart` and `EffizienzChart` local components stay (they own the series-filtering and metric-projection logic) and become thin shells over `<TrendsChart>`.

## Components

### `<TrendsChart>`

```ts
type TrendsChartSeries = {
  key: string                  // stable for React-key purposes
  label: string                // for the strip row (e.g. "5 k" or "Ø DPS")
  tone: 'primary' | 'neutral'  // existing palette tokens
  variant: 'solid' | 'dashed'  // matches DualLineChart vocabulary
  points: { t: number; y: number; sessionId: string }[]
  fmt: (y: number) => string   // value formatter (pace500m for Leistung, fmtFloat for Effizienz)
}

type Props = {
  series: TrendsChartSeries[]
  range: TrendsRange
  rollingFor?: 'primary-only' | 'none'   // Leistung: 'primary-only', Effizienz: 'none'
  onDotTap: (sessionId: string) => void
}
```

Renders, in this order:

1. The values strip above the SVG, fed by current scrub state.
2. An SVG `viewBox="0 0 300 160"` (matching the existing aspect for visual continuity) containing:
   - 3 horizontal gridlines (faint, full-width), labelled at the left.
   - A bottom baseline.
   - 3–5 x-axis date labels below the baseline (count and format depend on range; see Format helpers below).
   - The rolling-average dashed path, *only* for the first series when `rollingFor === 'primary-only'` and the range has a non-null window.
   - One path per series (monotone-interpolated; we already have `monotonePath` in `web/src/components/charts/path.ts`).
   - One dot per point per series.
   - The scrub guideline (1 px vertical, 50% accent opacity) and outer ring around the active dot — rendered only while scrub state is active.
   - A full-plot-area transparent `<rect>` that captures pointer events (so dots themselves do not need to be interactive).

### `useChartScrubber`

```ts
type UseChartScrubberArgs = {
  // The plot rect in screen coordinates, sampled from a ref.
  getPlotRect: () => DOMRect | null
  // x-positions (screen pixels relative to plot left) of all dots across all visible series,
  // each tagged with its session id for tap routing.
  dots: { x: number; sessionId: string }[]
  onDotTap: (sessionId: string) => void
}

type UseChartScrubberResult = {
  // null = idle (strip shows latest), number = scrubbed x in plot pixels.
  scrubX: number | null
  // Pointer handlers spread onto the capture <rect>:
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
  }
}
```

Internal state machine:

| State          | Trigger to enter             | Trigger to leave                                            |
|----------------|------------------------------|-------------------------------------------------------------|
| `idle`         | initial; release timer fires | `pointerdown` → `armed`                                     |
| `armed`        | pointerdown                  | `pointermove` with movement ≥ 10 px → `scrubbing`; or `pointerup` (within 200 ms, within 10 px of a dot) → `tap` → `idle`; or `pointerup` otherwise → `idle` |
| `scrubbing`    | drag past threshold          | `pointerup`/`pointercancel` → `released`                    |
| `released`     | pointer released after scrub | 3 000 ms timer or another `pointerdown` → `idle`            |

In `idle` and `armed`, `scrubX === null` (strip shows latest). In `scrubbing` and `released`, `scrubX` snaps to the nearest dot's x across all series.

If `prefers-reduced-motion: reduce`, the `released → idle` transition is instant (skip the 3 s wait).

### `<TrendsValueStrip>` (inline inside `TrendsChart`)

Layout for Leistung (multi-series):

```
17. Mai · Sonntag
● 5 k    1:47    ↓1.0s vs 14-d Ø
○ 2 k    1:45    —
```

Layout for Effizienz (single series, two metrics):

```
17. Mai · Sonntag
● Ø DPS  9.59    ↓0.10 vs 14-d Ø
○ Ø SPI  12.0    ↑0.5 vs 14-d Ø
```

The dot column uses the same color tokens as the SVG (`tone: 'primary'` solid disc, `tone: 'neutral'` outlined disc). The "vs N-d Ø" chip:

- Computes against the rolling-avg point at the SAME x as the scrubbed dot (or the latest dot, in idle state). The rolling avg is computed for every input series regardless of whether it's *drawn* — this is how Effizienz can show chips for both metrics without drawing rolling lines.
- Renders `—` if the rolling-avg window is null for the current range (Wochen).
- Renders `—` if the dot is too close to the start of the x-domain for a stable trailing window (< window/2 days of prior data).
- Uses sign color: improvement (lower pace, higher DPS) → primary-accent; regression → muted. No red/green per the existing design system.

### Pure helpers

```ts
// rolling.ts
export function rangeRollingWindowDays(range: TrendsRange): number | null {
  switch (range) {
    case 'week': return null
    case 'month': return 14
    case 'year': return 30
    case 'all': return 90
  }
}

// Returns one rolling-avg point per input point, using a trailing window
// of `windowDays`. The first point's window is shorter; windows are
// clamped to available data.
export function rollingAverage(
  points: { t: number; y: number }[],
  windowDays: number
): { t: number; y: number }[]
```

```ts
// format.ts
// Per-range date format for x-axis tick labels.
//   week  → "Mo", "Di", ... "So"
//   month → "5. Mai", "12. Mai", "19. Mai", "26. Mai"
//   year  → "Jan", "Apr", "Jul", "Okt"
//   all   → "2024", "2025", "2026"
export function formatChartDate(t: number, range: TrendsRange): string

// Full date for the strip header.
//   "17. Mai · Sonntag"
export function formatStripDate(t: number): string

// "↓1.0s vs 14-d Ø" / "↑0.10 vs 14-d Ø" / "—"
export function formatRollingDelta(
  current: number,
  rollingAvg: number | null,
  windowDays: number | null,
  fmt: (v: number) => string,
  invert?: boolean  // true for pace (lower=better)
): string
```

## Data flow

1. `TrendsTab` fetches `TrendsResponse` (no API change).
2. `LeistungChart` filters `data.series` to series with `points.length >= 3`, takes the first two, projects each into a `TrendsChartSeries` using `pace500m` for `y` and the series's points-mapped-to-pace.
3. `EffizienzChart` filters `data.efficiency_series` likewise, takes the first one, projects it into *two* `TrendsChartSeries` (DPS and SPI) using `fmtFloat`.
4. Both pass their series array, the current `range`, the appropriate `rollingFor`, and an `onDotTap` (`useNavigate()(`/historie/${sessionId}`)`) to `<TrendsChart>`.
5. `<TrendsChart>` computes:
   - x-domain from the union of all input dots.
   - y-domain from all drawn data: input series + (if `rollingFor === 'primary-only'`) the rolling avg of the first series. Padded 5% top and bottom so dots don't kiss the edges.
   - rolling-avg arrays for every input series (drawn or not) so the strip can render chips uniformly.
6. `useChartScrubber` consumes the pre-computed dot positions and turns pointer events into `scrubX`.
7. The strip's row data is a derived projection of `(scrubX | latest) → nearest-dot-index → series points + rolling-avg arrays`.

## Error handling and edge cases

| Scenario | Behavior |
|---|---|
| No qualifying series (≥3 threshold) | `LeistungChart`/`EffizienzChart` render the existing `leistung-empty`/`effizienz-empty` placeholders. `TrendsChart` is not mounted. |
| Rolling window is null (Wochen range) | No dashed line drawn. Strip chip renders `—`. |
| Dot near start of x-domain (< window/2 of trailing data) | Strip chip renders `—` rather than a misleading delta. |
| Pointer leaves the SVG mid-scrub (`pointerleave`/`pointercancel`) | Treated as `pointerup`: enter `released` and start the 3 s timer. |
| `prefers-reduced-motion: reduce` | The `released → idle` snap-back is instant. The scrub guideline does not animate in/out. |
| Loading or error fetching trends | Existing `TrendsTab` handles this above the `<TrendsContent>` level. Unchanged. |
| Single-point primary series | Cannot occur — the ≥3 threshold blocks it. |
| Dot-tap target is busy (e.g., two series have dots at the same x) | The tap routes to the dot whose plot-coordinate is closest to the tap point (Euclidean distance, primary then secondary on ties). |
| Touch + mouse on a hybrid device | `PointerEvents` covers both. The 10 px / 200 ms thresholds are unchanged across input modes; they're tuned for touch but tolerable with mouse. |

## Testing

### Unit (Vitest, no DOM)

- `rolling.ts`:
  - `rangeRollingWindowDays` — table-driven, all 4 ranges.
  - `rollingAverage` — empty input returns empty; single point returns that point; trailing window across 10 evenly-spaced points produces the right moving mean at every index; window longer than the data clamps gracefully.
- `format.ts`:
  - `formatChartDate` — one fixture per range.
  - `formatStripDate` — exact string match against a frozen `Date`.
  - `formatRollingDelta` — improvement, regression, exactly equal, `rollingAvg === null`, `invert` flag for pace.

### Component (Vitest + React Testing Library)

- `useChartScrubber` (via `renderHook`):
  - `pointerdown` + `pointermove` past 10 px advances `scrubX`; subsequent `pointermove` updates it; `pointerup` releases.
  - `pointerdown` + `pointerup` within 200 ms and < 10 px of a registered dot invokes `onDotTap` with that dot's `sessionId`.
  - `pointerdown` + `pointerup` < 10 px movement but not near a dot leaves `scrubX === null` and does NOT fire `onDotTap`.
  - After `released`, advancing time by 3 s clears `scrubX`. Using `vi.useFakeTimers()`.
- `TrendsChart`:
  - Renders correct number of dots, gridlines, x-tick labels for a fixture.
  - Strip shows the latest dot's values in idle state.
  - Simulated `userEvent.pointer()` drag updates the strip's value text.
  - Tap on a dot calls `onDotTap` with the right `sessionId`.
  - When `rollingFor === 'primary-only'`, the rolling-avg path is rendered exactly once; when `'none'`, not at all.
- `TrendsTab` (extend existing `TrendsTab.test.tsx`):
  - The existing threshold tests stay green (no semantic regression).
  - A new test: tap a dot in the Leistung chart navigates to `/historie/${sessionId}`.

### E2E (Playwright)

One new spec: `web/e2e/historie/trends-scrubber.spec.ts`.

Seed: a rower with ≥3 completed `distance {meters:5000}` sessions. Steps:

1. Navigate to `/historie/trends?range=month`.
2. Wait for the Leistung chart's `dlc-primary`-equivalent (rename to `trends-chart-primary-path`).
3. Use Playwright's touch emulation (`page.touchscreen.tap` / `page.locator(...).touch` with explicit `force: true` if needed) to simulate a drag across the Leistung chart from the left edge to the middle.
4. Assert the strip's primary-row value text changes from the latest pace to a different pace value (any change is sufficient — exact value depends on seed data).
5. Tap a dot directly; assert the URL becomes `/historie/${id}`.

Per ADR-0016: this scenario must use touch emulation, not `hover`/`mouse`.

## Open questions deferred to follow-ups

- **PB dashed reference line.** Where exactly on the chart, what tone, what behavior when scrubber crosses it? Punted from this slice; the strip's PB display (already in `TrendsTab.tsx`) remains the user-visible PB.
- **Per-dot SPM-band tint on Effizienz.** Requires the FEAT-0007 SPM band thresholds. Punted.
- **Color palette for multi-series at N ≥ 3.** Currently only the first 2 render; if/when more do, a real palette decision is needed. Not blocking.
- **Removing `DualLineChart`** once `TrendsChart` ships. Audit for non-Trends consumers first.

## Acceptance criteria

- [ ] On Daniel's seeded `splits-raspi.db`, the Leistung card's 5 k series renders with 4 dots, a dashed rolling-avg line, 3 y-gridlines (`1:46 / 1:48 / 1:50`-ish), 3 date ticks, and a values strip showing the latest dot's pace + PB.
- [ ] Dragging across the chart on touch advances a vertical guideline and ring-highlighted dot; the strip value text updates live.
- [ ] Tapping a dot navigates to `/historie/:sessionId`.
- [ ] Releasing the scrub leaves the position visible for 3 s, then animates back to "latest" (or instant if reduced-motion).
- [ ] Effizienz card has no drawn rolling-avg line but the strip's "vs N-d Ø" chips for DPS and SPI are populated.
- [ ] All existing `TrendsTab` tests stay green; new tests for `TrendsChart`, `useChartScrubber`, `rolling.ts`, `format.ts` all pass.
- [ ] One Playwright spec exercises the scrubber via touch emulation.
- [ ] No bundle size regression beyond the new component files (no chart library added).
- [ ] No backend changes.
