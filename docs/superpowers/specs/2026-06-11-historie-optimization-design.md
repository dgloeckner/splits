# Historie-Optimierung — Verlauf + Rekorde

Design spec, 2026-06-11. Outcome of the history/stats feature review
(same date) and a brainstorming session. Supersedes the current
three-tab structure (Sessions · Trends · Rekorde).

## Goals

The section serves three jobs, in priority order:

1. **Am I getting better?** — progress per comparable workout, in the
   metrics rowers think in (split, watts, SPM, DPS).
2. **How was my last session?** — quick post-row review.
3. **What are my records?** — the trophy wall.

"Am I training enough?" (volume/habit) is explicitly demoted: volume
appears as a footnote, never as the headline.

Non-goals: streaks/gamification beyond existing milestones, social
features, new workout modes.

## Decisions carried in from the review

- **SPI is retired everywhere** (task #2). It had two conflicting
  definitions (watts/spm with integer division in the sessionizer;
  joules/stroke in the window-PB candidates) and means nothing to
  rowers.
- **DPS is the efficiency metric** and gets first-class display
  (task #3).
- **Auswertung (per-session insights) stays as is** and is backfilled
  for historical sessions (task #1).
- **Konstanz-Bestleistungen are cut from Rekorde.** Within-session
  consistency lives solely in the per-session Auswertung finding.
  Cross-session consistency "records" (best-ever CV across unlike
  workouts) are statistically indefensible and demotivating.

## Structure

Two tabs under Historie:

- **Verlauf** (default) — merges the old Sessions and Trends tabs.
- **Rekorde** — the trophy wall.

Routing: `/historie` renders Verlauf; `/historie/rekorde` unchanged;
`/historie/trends` redirects to `/historie`; query `range=week`
(old links) maps to the month window. `/historie/:sessionId` detail
route unchanged.

## Verlauf

Top to bottom (iPhone, single column):

### 1. Global range bar

`Monat · Jahr · Alles`. **Woche is dropped.** One window scopes
everything on the surface — chart, session list, volume footnote.
Persisted in the URL query (`?window=`), default Monat.

Windows are **rolling and end today**: Monat = last 30 days, Jahr =
last 365 days, Alles = everything. Consequences:

- The delta in the volume footnote always compares equal-length
  windows (last 30 days vs the 30 days before), so the
  "−98 % on the 1st of the month" failure mode is impossible.
- There is exactly one window. The current split between "headline
  period" and "silently wider chart window" is removed.

### 2. Progress card

One chart card.

- **Line series**: completed sessions (≥ 80 % of workout target,
  existing rule) of one workout shape (shape_hash grouping,
  unchanged). If several shapes have ≥ 3 completed sessions in the
  window, small chips (`5 km · 2 km · …`) switch the line; default is
  the most-rowed shape in the window.
- **Context dots**: every other session in the window (Just Row,
  intervals, aborted, other shapes) renders as a faint dot at its avg
  split (or the toggled metric). Nothing rowed is invisible; a
  free-rower sees dots instead of an empty chart.
- **Metric toggle**: `Split | Watt | SPM | DPS`. Split is default.
  DPS folds in here — there is no separate Effizienz chart anymore.
  Data is already in the API per point (avg_pace / avg_power_w /
  avg_spm / avg_dps).
- **Scrubber** (existing) stays: drag shows per-point strip values,
  tap on a dot opens the session AND highlights the matching list row.

### 3. Session list

All sessions in the window, newest first. Row: date, workout-shape
chip, distance, time, split (visually strongest element). Tapping a
row opens session detail. 🏆 badge only when the session set a
**standard-distance PB** — not for window/workout PBs — so the badge
stops appearing on virtually every row.

Chart dots and list rows are two views of the same items: selecting
either highlights both.

### 4. Volume footnote

One quiet line: `Letzte 30 Tage: 12 km · 6 Sessions · 1 h 30 min`
plus a small, fair delta vs the prior equal-length window (no red
oversized percent chip). Durations use real units (`1 h 30 min`,
`2 min`) — never bare `h:mm` like the current `Dauer 0:01`.

### Empty states

Keep the existing pattern: copy + widen-range action
("Zeitraum erweitern → Jahr"). With context dots, the chart is
non-empty whenever any session exists in the window.

## Chart rules (all charts in the section)

- **Split axis is NOT inverted.** Lower split = lower on the axis,
  matching erg displays rowers know. Watt/SPM/DPS naturally read
  up = better.
- **Reference lines are always direct-labeled** — no line without its
  name and value printed at its right end in the line's own color:
  gold dashed `PB 1:47` (distance-PB pace, from the already-plumbed
  `pb_pace_sec_per_500m`; Split mode only), grey dashed `Ø 14 T`
  (rolling average, all modes). Rolling-average window per range keeps
  the existing mapping minus Woche: Monat → 14 d, Jahr → 30 d,
  Alles → 90 d. At most two reference lines per plot. The scrubber
  strip uses the same color swatches.
- **X ticks sit on calendar boundaries** (day/week/month/year starts)
  chosen from the actual data span, deduplicated, with the coarser
  unit appended when the span crosses it ("Mai ’26"). This makes the
  observed bug class (2026 2026 2026 / Mai Mai Mai / weekday labels
  on an 8-week window) structurally impossible.
- **Y ticks on round values** per metric (split: 5 s steps; watt:
  10 W; SPM: 1; DPS: 0.5 m), not data-span ± 5 %.
- **Strip delta in rower language**: `−1,3 s vs Ø 14 Tage`, not
  `↓0:01.3 vs 14-d Ø`. Sign and color agree (no `↓ −98 %`
  double-encoding anywhere).

## Responsive layout

Targets: iPhone (~390 pt) and iPad (~768 pt+).

- **iPhone**: single column as described above.
- **iPad (≥ 768 pt)**: Verlauf becomes **two panes** — range bar +
  progress card + volume footnote fixed on the left, session list
  scrolling independently on the right. Chart and list share the
  screen permanently, making the dot ↔ row link the primary iPad
  interaction. Rekorde scales its existing card grids to the width
  (no second layout).
- Both form factors are covered by the e2e capture spec (below).

## Rekorde

- **Distance-PB grid**: layout unchanged; the displayed date becomes
  `source_session_started_at` (fixes every card reading the recompute
  date, e.g. "11.06.26" on all PBs). Deep-link flash stays.
- **Window-PBs**: only `Beste 60 s Ø Power` survives — an honest
  sprint benchmark that gives short hard sessions a record to aim at.
  The SPI *and* DPS window-PB definitions are deleted (`WindowDefs`
  shrinks to power/seconds/60): SPI is retired entirely; DPS as a
  trophy rewards low-rate hauling, not progress — it stays first-class
  in the Verlauf metric toggle and the planned Auswertung detector,
  where it compares like with like. Existing spi/dps `pb_window` rows
  are invalidated by migration and drop out of cards, hero, timeline,
  and session-detail PB banners.
- **Workout-PBs become time-mode only, with the duration named.**
  Distance-mode workout-PBs are dropped (redundant with the Distanz
  grid — best 5 km workout ≈ 5 km PB) and their `pb_workout` rows
  invalidated. Time-mode cards render as
  `Beste Distanz · 20 min: 4.812 m` — fixing the current label that
  shows only the bare mode ("Distanz · 18:00" without the distance).
  This section is the natural home of classic 20/30/60-min tests.
- **Konstanz-Bestleistungen: section deleted.** Consistency
  achievements (`consistency_intra`) are invalidated by migration and
  no longer produced by recompute.
- Hero ("Neuester Erfolg"), Meilensteine, and the achievement
  timeline stay, minus SPI/DPS-window/Konstanz/distance-workout
  entries.

## Session detail

- Hero loses **Ø SPI**; keeps Distanz, Zeit, Ø Split, Ø SPM, Ø Watt,
  Ø DPS, Schläge.
- The three charts (Split/Watt/SPM-Verlauf) adopt the shared chart
  rules: round y-ticks, time x-axis, direct-labeled grey reference
  line for the session Ø. Same component family as the progress
  chart — one chart language everywhere.
- Auswertung unchanged in shape; historical sessions get findings via
  backfill (task #1). A DPS detector for the defined-but-empty
  EFFICIENCY category is a follow-up (task #3).

## Backend & data

- **Trends endpoint reworked to the one-window model**:
  `GET /api/v1/rowers/{id}/trends?window=30d|365d|all` returns
  - all session points in window (timestamp, session id, mode/shape,
    distance, time, avg split/watt/spm/dps, plus a
    `distance_pb: bool` flag — true only for standard-distance PBs,
    driving the list's 🏆 badge) — feeds context dots AND the session
    list in one fetch;
  - per-shape series of completed sessions (existing grouping),
    each with `pb_pace_sec_per_500m`;
  - window totals + prior-equal-window totals for the footnote delta.
  The never-rendered `performance`/`efficiency` aggregate blocks and
  all SPI fields are removed from the response.
- **SPI removal end-to-end** (task #2): sessionizer accumulator,
  sample buckets, summary field, `WindowDefs` entry, API types.
- **One records migration** invalidates: spi + dps `pb_window` rows,
  `consistency_intra` achievements, and distance-mode `pb_workout`
  rows. The persister stops producing workout candidates for
  distance/race-mode sessions. The FEAT-0010 "locked WindowDefs" note
  gets an amendment documenting the removals.
- Unchanged: ≥ 80 % completion rule, shape-hash series grouping
  (ADR-0015), Berlin-time window bounds.

## Testing

- **Unit**: calendar-boundary tick generation (regression suite for
  the axis bug class: single-year span, two-month span, multi-year
  span, sparse data), rolling-window bounds + fair-delta windows,
  round y-tick selection, duration formatting.
- **API**: golden tests for the new trends response shape; migration
  test proving spi/Konstanz rows are invalidated and absent from
  responses.
- **E2E**: new `web/tests/e2e/ux-audit/history-capture.spec.ts`
  driving Verlauf (all three windows, metric toggle, dot↔row link)
  and Rekorde on phone + tablet viewports, so the section joins the
  ux-heuristic-audit pipeline.

## Out of scope / follow-ups

- DPS detector in insights (EFFICIENCY category) — tracked in task #3.
- Insights backfill implementation — tracked in task #1.
- Any redesign of the live/workout surfaces.
