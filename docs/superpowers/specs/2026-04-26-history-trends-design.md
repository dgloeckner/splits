# Historie: Trends tab

**Status:** approved 2026-04-26
**Sub-project:** B (depends on 2026-04-26-storage-refactor-design)

## Problem

`HistoryPage` shows only the session list. Users have no aggregated view of
volume, performance, or efficiency trends over time. Stitch frame
"Historie: Trends (Refined) — Headline Numbers Card (Current User Only)"
defines the target UI.

## Scope

MVP: 4 sections — range selector, headline card, Leistung chart, Effizienz
chart. **Excluded** from MVP: rower filter chips, milestones row, calendar
custom range, volume bar chart, consistency heatmap, goals.

## Design

### Routing

`HistoryPage` becomes a router shell:

| Route | Renders |
|-------|---------|
| `/historie` | `<SessionsTab />` (existing list extracted) |
| `/historie/trends` | `<TrendsTab />` (new) |
| `/historie/:id` | `<SessionDetailPage />` (unchanged, outside shell) |

Shell renders `<h1>Historie</h1>` + sub-nav (`<NavLink>` Sessions | Trends).
Calendar icon top-right deferred (no custom range).

### Active rower

`useActiveRower()` (existing). Empty rower → `RowerGate` redirect (existing).

### Range semantics

Local `range: 'week' | 'month' | 'year' | 'all'` state, default `month`. URL
search param `?range=` for shareable/back-button.

| Range | Period bounds | Compare to | Chart x-axis |
|-------|---------------|------------|--------------|
| week  | current ISO week (Mon–Sun, Europe/Berlin) | prior ISO week | last 8 weeks, per-session points |
| month | current calendar month | prior month | last 6 months, per-session points |
| year  | YTD (Jan 1 → today) | prior year same YTD slice | last 12 months, per-session points |
| all   | lifetime | n/a | all sessions, per-session points |

Per-session points (not bucketed) preserves chart fidelity.

### Backend endpoint

`GET /api/v1/rowers/{id}/trends?range=week|month|year|all`

Response:

```ts
type TrendsResponse = {
  range: 'week' | 'month' | 'year' | 'all'
  period: { label: string; from: string; to: string }
  totals: { distance_m: number; active_sec: number; sessions: number }
  prior?: { distance_m: number; active_sec: number; sessions: number }
  performance: {
    points: { t: string; avg_power_w: number; avg_pace_sec_per_500m: number }[]
    avg_power_w: number
    avg_pace_sec_per_500m: number
  }
  efficiency: {
    points: { t: string; avg_dps: number; avg_spi: number }[]
    avg_dps: number
    avg_spi: number
    delta_dps: number
    delta_spi: number
  }
  stats_version: number
}
```

`period.label` localized German: "Diese Woche" / "Diesen Monat" / "Dieses Jahr"
/ "Insgesamt".

`prior` omitted for `range=all`.

Sessions with `total_distance_m == 0` excluded from chart points but still
counted in totals.

`delta_dps`/`delta_spi` = mean over last 14 days minus mean of prior 14 days,
both inside chart window.

### Backend implementation

File: `backend/internal/api/trends.go`. Wire into mux at
`GET /api/v1/rowers/{id}/trends`.

Single SQL query per request (clean SELECT against typed columns from
sub-project A — no JSON parsing):

```sql
SELECT id, started_at, total_distance_m, total_time_sec,
       avg_power_w, avg_pace_sec_per_500m, avg_dps, avg_spi
FROM sessions
WHERE rower_id = ? AND deleted_at IS NULL AND ended_at IS NOT NULL
  AND started_at >= ?
ORDER BY started_at ASC;
```

Lower bound = `min(period_from, chart_window_from)`.

Go computes period bounds (Europe/Berlin), prior-period bounds, period means,
14-day deltas, and packs response. `stats_version` from `rower_lifetime_stats`.

### Frontend components

```
web/src/pages/HistoryPage.tsx                # router shell
web/src/pages/history/SessionsTab.tsx        # extracted from existing
web/src/pages/history/TrendsTab.tsx          # new
web/src/pages/history/RangeTabs.tsx          # new
web/src/pages/history/TrendsHeadlineCard.tsx # new
web/src/components/DualLineChart/...         # new dual-series chart
web/src/api/client.ts                        # +TrendsResponse, +getRowerTrends
web/src/util/format.ts                       # +hhmm, +signedPct, +signedNum
```

`<TrendsTab>`:

1. Fetch via `useQuery(['rower-trends', rowerId, range], () => getRowerTrends(rowerId, range))`.
2. Loading → skeleton; error → terse message; empty totals → placeholder.
3. Render `<RangeTabs>`, `<TrendsHeadlineCard>`, Leistung card, Effizienz card.

`<TrendsHeadlineCard>`:
- Period label + big number (km, derived from `totals.distance_m`)
- Delta chip top-right (`arrow_upward` / `arrow_downward`, hidden for `range=all` or zero prior)
- Dauer + Sessions row

Leistung card:
- Title "Leistung", legend rows: "Ø Watt: 215" (teal dot), "Ø Split: 2:04 /500m" (white dashed)
- `<DualLineChart>` with Watt (solid teal, primary) + Split (dashed white, secondary)
- No interactive pills (per Stitch frame "THIS ONE")

Effizienz card:
- Title "Effizienz", "14-Tage Trend" tag
- Two stat cells: Ø DPS + delta chip; Ø SPI + delta chip
- `<DualLineChart>` with DPS (solid teal) + SPI (white)

### `<DualLineChart>`

Built same way as existing `LineChart`: hand-rolled SVG, viewBox-based, CSS
module. Two independent y-scales (Watt 0–500 vs Split 60–180s/500m can't
share). Shared x-domain.

API:

```ts
type Series = {
  label: string
  points: { x: number; y: number }[]
  variant: 'solid' | 'dashed'
  tone: 'primary' | 'neutral'
  fmt?: (v: number) => string
}

type Props = {
  primary: Series
  secondary?: Series
  height?: number  // default 160
}
```

No axes/grid/tooltips for v1.

Optional: factor monotone-cubic path util out of `Sparkline.tsx` into shared
`web/src/components/charts/path.ts`. Include only if straightforward.

### Cache invalidation

`['rower-trends', rowerId, range]` invalidated on session insert/delete +
`stats_version` bump. Same pattern as `rower-lifetime`.

## Test plan

### Backend
Table-driven `trends_test.go`:
- empty rower → zero totals, no prior, empty charts
- single session in current month → totals match, no prior
- multi-session across DST shift, year boundary, ISO week boundary
- soft-deleted session excluded
- `range=all` → no prior, full lifetime
- 14-day delta computation correctness
- Sessions with `total_distance_m=0` excluded from chart points but counted

### Frontend
- `<TrendsTab>`: renders all 4 sections with mocked trends data
- `<TrendsTab>`: range selector swaps query
- `<TrendsTab>`: empty totals → placeholder
- `<TrendsHeadlineCard>`: delta chip absent for `range=all`
- `<DualLineChart>`: renders both paths; one series → secondary path absent;
  empty → placeholder
- Format helpers: `hhmm`, `signedPct`, `signedNum`

## Risks

- **Per-session-point density.** "Alles" range with 1 000+ sessions could
  produce an unreadable chart. Defer; if it bites, decimate visually.
- **Europe/Berlin timezone.** Period boundaries must use the same TZ as
  session display elsewhere. Confirm `dates.ts` util exposes appropriate
  bounds helpers; otherwise add.

## Out of scope

- Rower filter chips
- Milestones row, volume bar chart, consistency heatmap, goals
- Calendar custom date range
- Cross-rower comparison
