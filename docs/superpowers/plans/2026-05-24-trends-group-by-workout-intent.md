# Trends grouped by workout intent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Trends API's per-point aggregates with a series-aware response keyed by `(workout.mode, workout.shape_hash)`, filtered for completion (≥80% of target), and wire the existing `TrendsTab` chart to render per-shape multi-series lines, threshold-gated at ≥3 completed sessions per range. Implements ADR-0015.

**Architecture:** Backend change is additive — the existing `performance.points` and `efficiency.points` fields remain (so `TrendsHeadlineCard` keeps working untouched); two new top-level fields `series` (Leistung) and `efficiency_series` (Effizienz) carry the per-shape data. Frontend chart code switches to the new fields. PB reference lines come from `pb_distance` joined per series. Scrubber interaction (ADR-0016) is out of scope — multi-series rendering reuses the current `DualLineChart` primitive in a minimal multi-line mode; full interaction polish lives in a follow-up plan.

**Tech Stack:** Go 1.22 (backend, `net/http` + `database/sql`), TypeScript + React + Vite (frontend), Vitest + React Testing Library (frontend tests), Go's `testing` package (backend tests), SQLite (storage).

**Scope notes:**
- ADR-0016 (touch-native scrubber) is **explicitly deferred** to its own plan. This plan does not implement the scrubber.
- The `Effizienz` chart's intensity-band per-dot coloring is **deferred** — the API change for Effizienz here is structural only (per-session points with completion filter); the visual SPM-band encoding lands with the chart rewrite plan.
- `intervals` and `just_row` workout modes are **excluded from series** per ADR-0015. They're filtered out at the SQL join.
- No frontend visual polish (axes, gridlines, rolling-average overlay, PB dashed lines) — those decisions are documented in the grilling session but belong with ADR-0016's plan. This plan ships only what ADR-0015 mandates: correct *data shape* with correct *grouping* and *completion semantics*.

---

## File Structure

**Backend (new and modified):**
- Modify `backend/internal/api/trends.go` — extend response types, add series-aware query.
- Modify `backend/internal/api/trends_test.go` — extend test helpers to seed workouts with shape hashes; add series-grouping tests.
- Create `backend/internal/api/trends_series.go` — series-assembly helpers kept separate from the handler for readability.
- Create `backend/internal/api/trends_series_test.go` — focused unit tests for series assembly.

**Frontend (modified):**
- Modify `web/src/api/client.ts` — extend `TrendsResponse` type with the new series fields.
- Modify `web/src/pages/history/TrendsTab.tsx` — render new `series` and `efficiency_series` in `DualLineChart`-style multi-line mode; apply ≥3-completed-in-range threshold; preserve the existing widen-range empty state.
- Modify `web/src/pages/history/TrendsTab.test.tsx` — add tests for multi-series rendering and threshold behavior.

**Data model:** No new migrations. `workout.shape_hash` is already populated 100% in the live DB; if a deployment is found with NULL hashes, Task 3's startup health check surfaces it loudly.

---

## Task 1: Backend — add series-aware response types

**Files:**
- Modify: `backend/internal/api/trends.go`

- [ ] **Step 1: Add series types to `trends.go`**

Add the following type declarations to `backend/internal/api/trends.go` immediately after the existing `effPoint` struct (line 41):

```go
// trendsSeriesKey identifies a comparable workout shape. ShapeHash
// alone is insufficient because `race {meters:2000}` and
// `distance {meters:2000}` share a hash by design (see
// workout/hash_test.go TestShapeHashRaceEqualsDistance). ADR-0015
// requires them to be distinct series, so we key on (mode, hash).
type trendsSeriesKey struct {
	Mode      string `json:"mode"`
	ShapeHash string `json:"shape_hash"`
}

// trendsSeriesPoint is one completed session within a series.
type trendsSeriesPoint struct {
	T                 string  `json:"t"`
	SessionID         string  `json:"session_id"`
	TotalDistanceM    int     `json:"total_distance_m"`
	TotalTimeSec      float64 `json:"total_time_sec"`
	AvgPowerW         float64 `json:"avg_power_w"`
	AvgPaceSecPer500m float64 `json:"avg_pace_sec_per_500m"`
	AvgDPS            float64 `json:"avg_dps"`
	AvgSPI            float64 `json:"avg_spi"`
	AvgSPM            float64 `json:"avg_spm"`
}

// trendsSeries is one comparable-workout-shape group over time.
type trendsSeries struct {
	Key         trendsSeriesKey     `json:"key"`
	ParamsJSON  json.RawMessage     `json:"params"`
	DisplayName string              `json:"display_name"`
	PBPaceSecPer500m float64        `json:"pb_pace_sec_per_500m,omitempty"`
	Points      []trendsSeriesPoint `json:"points"`
}
```

- [ ] **Step 2: Add `encoding/json` import**

Modify the import block in `backend/internal/api/trends.go` to add `"encoding/json"`:

```go
import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gloeckner-daniel/splits/internal/rower"
)
```

- [ ] **Step 3: Extend `trendsResponse` with the two new series fields**

In `backend/internal/api/trends.go`, modify the `trendsResponse` struct (currently lines 57–65) to add the two new top-level fields:

```go
type trendsResponse struct {
	Range            string           `json:"range"`
	Period           trendsPeriod     `json:"period"`
	Totals           trendsTotals     `json:"totals"`
	Prior            *trendsTotals    `json:"prior,omitempty"`
	Performance      performanceBlock `json:"performance"`
	Efficiency       efficiencyBlock  `json:"efficiency"`
	Series           []trendsSeries   `json:"series"`
	EfficiencySeries []trendsSeries   `json:"efficiency_series"`
	StatsVersion     int              `json:"stats_version"`
}
```

- [ ] **Step 4: Build to verify the file still compiles**

Run from repo root:

```bash
cd backend && go build ./... && cd ..
```

Expected: clean build. The new fields are unused in the handler — they'll come up nil in JSON until Task 4. Tests still pass against the unchanged handler logic.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/trends.go
git commit -m "feat(trends): add series-aware response types (ADR-0015)"
```

---

## Task 2: Backend — define completion-filter helper with TDD

**Files:**
- Create: `backend/internal/api/trends_series.go`
- Create: `backend/internal/api/trends_series_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/api/trends_series_test.go`:

```go
package api

import (
	"encoding/json"
	"testing"
)

func TestIsCompletedSession(t *testing.T) {
	cases := []struct {
		name      string
		mode      string
		params    string
		distM     int
		timeSec   float64
		want      bool
	}{
		{"distance 5k completed", "distance", `{"meters":5000}`, 5004, 1138, true},
		{"distance 5k abandoned at 80%", "distance", `{"meters":5000}`, 4000, 900, true},
		{"distance 5k abandoned below 80%", "distance", `{"meters":5000}`, 3999, 800, false},
		{"distance 500m abandoned at 134m", "distance", `{"meters":500}`, 134, 36, false},
		{"race 2k completed", "race", `{"meters":2000}`, 2010, 420, true},
		{"race 500m completed", "race", `{"meters":500}`, 603, 163, true},
		{"time 20min completed", "time", `{"sec":1200}`, 5500, 1200, true},
		{"time 20min completed at 80%", "time", `{"sec":1200}`, 4000, 960, true},
		{"time 20min abandoned", "time", `{"sec":1200}`, 2000, 500, false},
		{"intervals never qualifies (deferred)", "intervals", `{"reps":4,"length":{"unit":"m","value":500},"rest_sec":60}`, 2200, 600, false},
		{"just_row never qualifies", "just_row", `{}`, 5000, 1100, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := isCompletedSession(c.mode, json.RawMessage(c.params), c.distM, c.timeSec)
			if got != c.want {
				t.Fatalf("isCompletedSession(%q, %q, %d, %v) = %v, want %v",
					c.mode, c.params, c.distM, c.timeSec, got, c.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run from repo root:

```bash
cd backend && go test ./internal/api/ -run TestIsCompletedSession -v && cd ..
```

Expected: FAIL — `undefined: isCompletedSession`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/internal/api/trends_series.go`:

```go
package api

import "encoding/json"

// completionFraction is the floor for "completed": a session must
// reach at least 80% of its workout target to count toward trend
// aggregates. See CONTEXT.md §Trends.
const completionFraction = 0.8

// isCompletedSession returns true iff the session reached the
// completion threshold for its workout mode. Returns false for
// intervals (deferred) and just_row (no target).
func isCompletedSession(mode string, params json.RawMessage, totalDistanceM int, totalTimeSec float64) bool {
	switch mode {
	case "distance", "race":
		var p struct {
			Meters int `json:"meters"`
		}
		if err := json.Unmarshal(params, &p); err != nil || p.Meters <= 0 {
			return false
		}
		return float64(totalDistanceM) >= completionFraction*float64(p.Meters)
	case "time":
		var p struct {
			Sec int `json:"sec"`
		}
		if err := json.Unmarshal(params, &p); err != nil || p.Sec <= 0 {
			return false
		}
		return totalTimeSec >= completionFraction*float64(p.Sec)
	}
	// intervals, just_row, or unknown mode → not in trend series.
	return false
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && go test ./internal/api/ -run TestIsCompletedSession -v && cd ..
```

Expected: PASS for all 11 cases.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/trends_series.go backend/internal/api/trends_series_test.go
git commit -m "feat(trends): completion threshold helper with mode-specific rules"
```

---

## Task 3: Backend — series-assembly helper with TDD

**Files:**
- Modify: `backend/internal/api/trends_series.go`
- Modify: `backend/internal/api/trends_series_test.go`

- [ ] **Step 1: Write the failing test**

Append to `backend/internal/api/trends_series_test.go`:

```go
import "time"

func TestAssembleSeriesGroupsByModeAndHash(t *testing.T) {
	t0 := time.Date(2026, 5, 9, 8, 35, 0, 0, time.UTC)
	rows := []sessionRow{
		// 4× distance 5k — one shape
		{ID: "a", StartedAt: t0,                 Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_DIST_5K", DistM: 5004, TimeSec: 1138, AvgPower: 374, AvgPace: 110, AvgDPS: 9.69, AvgSPI: 12, AvgSPM: 28.0},
		{ID: "b", StartedAt: t0.Add(6 * 24 * time.Hour), Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_DIST_5K", DistM: 5005, TimeSec: 1122, AvgPower: 375, AvgPace: 109, AvgDPS: 9.62, AvgSPI: 12, AvgSPM: 28.4},
		{ID: "c", StartedAt: t0.Add(8 * 24 * time.Hour), Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_DIST_5K", DistM: 5029, TimeSec: 1102, AvgPower: 379, AvgPace: 107, AvgDPS: 9.53, AvgSPI: 12, AvgSPM: 28.9},
		{ID: "d", StartedAt: t0.Add(14 * 24 * time.Hour), Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_DIST_5K", DistM: 5008, TimeSec: 1082, AvgPower: 382, AvgPace: 107, AvgDPS: 9.59, AvgSPI: 12, AvgSPM: 28.7},
		// 1× race 2k — same hash as distance 2k, but separate series
		{ID: "e", StartedAt: t0.Add(4 * 24 * time.Hour), Mode: "race", Params: json.RawMessage(`{"meters":2000}`), ShapeHash: "H_DIST_2K", DistM: 2010, TimeSec: 420, AvgPower: 410, AvgPace: 105, AvgDPS: 9.0, AvgSPI: 13, AvgSPM: 32.0},
		// 1× distance 2k — same hash as race 2k, different mode → different series
		{ID: "f", StartedAt: t0.Add(5 * 24 * time.Hour), Mode: "distance", Params: json.RawMessage(`{"meters":2000}`), ShapeHash: "H_DIST_2K", DistM: 2020, TimeSec: 440, AvgPower: 390, AvgPace: 109, AvgDPS: 9.2, AvgSPI: 12, AvgSPM: 30.0},
		// 1× abandoned distance 500m (134m / 500m = 27%) — excluded
		{ID: "g", StartedAt: t0.Add(15 * 24 * time.Hour), Mode: "distance", Params: json.RawMessage(`{"meters":500}`), ShapeHash: "H_DIST_500", DistM: 134, TimeSec: 36, AvgPower: 182, AvgPace: 143, AvgDPS: 8.4, AvgSPI: 7, AvgSPM: 24.0},
		// 1× just_row — never appears
		{ID: "h", StartedAt: t0.Add(16 * 24 * time.Hour), Mode: "just_row", Params: json.RawMessage(`{}`), ShapeHash: "H_JUSTROW", DistM: 3000, TimeSec: 700, AvgPower: 200, AvgPace: 120, AvgDPS: 9.0, AvgSPI: 10, AvgSPM: 24.0},
	}
	series := assembleSeries(rows)

	if len(series) != 3 {
		t.Fatalf("got %d series, want 3 (distance 5k, race 2k, distance 2k); got keys %v", len(series), keysOf(series))
	}
	bySid := indexByKey(series)

	dist5k := bySid["distance|H_DIST_5K"]
	if dist5k == nil {
		t.Fatal("missing distance|H_DIST_5K series")
	}
	if len(dist5k.Points) != 4 {
		t.Fatalf("distance 5k: got %d points, want 4", len(dist5k.Points))
	}

	race2k := bySid["race|H_DIST_2K"]
	if race2k == nil {
		t.Fatal("missing race|H_DIST_2K series")
	}
	if len(race2k.Points) != 1 {
		t.Fatalf("race 2k: got %d points, want 1", len(race2k.Points))
	}

	dist2k := bySid["distance|H_DIST_2K"]
	if dist2k == nil {
		t.Fatal("missing distance|H_DIST_2K series")
	}
	if len(dist2k.Points) != 1 {
		t.Fatalf("distance 2k: got %d points, want 1", len(dist2k.Points))
	}
}

func keysOf(s []trendsSeries) []string {
	out := make([]string, len(s))
	for i, sr := range s {
		out[i] = sr.Key.Mode + "|" + sr.Key.ShapeHash
	}
	return out
}

func indexByKey(s []trendsSeries) map[string]*trendsSeries {
	out := make(map[string]*trendsSeries, len(s))
	for i := range s {
		k := s[i].Key.Mode + "|" + s[i].Key.ShapeHash
		out[k] = &s[i]
	}
	return out
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && go test ./internal/api/ -run TestAssembleSeriesGroupsByModeAndHash -v && cd ..
```

Expected: FAIL — `undefined: sessionRow`, `undefined: assembleSeries`.

- [ ] **Step 3: Write minimal implementation**

Append to `backend/internal/api/trends_series.go`:

```go
import (
	"sort"
	"time"
)

// sessionRow is the row shape consumed by assembleSeries — one
// completed session joined with its workout. ShapeHash is the
// workout.shape_hash; Mode is workout.mode.
type sessionRow struct {
	ID         string
	StartedAt  time.Time
	Mode       string
	Params     json.RawMessage
	ShapeHash  string
	DistM      int
	TimeSec    float64
	AvgPower   float64
	AvgPace    float64
	AvgDPS     float64
	AvgSPI     float64
	AvgSPM     float64
}

// assembleSeries groups completed sessions by (mode, shape_hash)
// into series suitable for the multi-series chart. Caller is
// responsible for filtering rows via isCompletedSession before
// passing them in. Series are returned sorted descending by point
// count (most-rowed first), points within each series ascending
// by time. Sessions whose mode is "intervals" or "just_row" are
// silently dropped (defensive — caller should have filtered).
func assembleSeries(rows []sessionRow) []trendsSeries {
	type bucket struct {
		key    trendsSeriesKey
		params json.RawMessage
		points []trendsSeriesPoint
	}
	buckets := make(map[string]*bucket)
	for _, r := range rows {
		if r.Mode == "intervals" || r.Mode == "just_row" {
			continue
		}
		k := r.Mode + "|" + r.ShapeHash
		b, ok := buckets[k]
		if !ok {
			b = &bucket{
				key:    trendsSeriesKey{Mode: r.Mode, ShapeHash: r.ShapeHash},
				params: r.Params,
			}
			buckets[k] = b
		}
		b.points = append(b.points, trendsSeriesPoint{
			T:                 r.StartedAt.UTC().Format(time.RFC3339),
			SessionID:         r.ID,
			TotalDistanceM:    r.DistM,
			TotalTimeSec:      r.TimeSec,
			AvgPowerW:         r.AvgPower,
			AvgPaceSecPer500m: r.AvgPace,
			AvgDPS:            r.AvgDPS,
			AvgSPI:            r.AvgSPI,
			AvgSPM:            r.AvgSPM,
		})
	}
	out := make([]trendsSeries, 0, len(buckets))
	for _, b := range buckets {
		sort.Slice(b.points, func(i, j int) bool { return b.points[i].T < b.points[j].T })
		out = append(out, trendsSeries{
			Key:         b.key,
			ParamsJSON:  b.params,
			DisplayName: displayNameForShape(b.key.Mode, b.params),
			Points:      b.points,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if len(out[i].Points) != len(out[j].Points) {
			return len(out[i].Points) > len(out[j].Points)
		}
		// Stable secondary sort by key string.
		return out[i].Key.Mode+out[i].Key.ShapeHash < out[j].Key.Mode+out[j].Key.ShapeHash
	})
	return out
}

// displayNameForShape returns a German label like "5 k", "Race 2 k",
// "20 min" for the chart legend / strip readout.
func displayNameForShape(mode string, params json.RawMessage) string {
	switch mode {
	case "distance":
		var p struct {
			Meters int `json:"meters"`
		}
		_ = json.Unmarshal(params, &p)
		return formatMeters(p.Meters)
	case "race":
		var p struct {
			Meters int `json:"meters"`
		}
		_ = json.Unmarshal(params, &p)
		return "Race " + formatMeters(p.Meters)
	case "time":
		var p struct {
			Sec int `json:"sec"`
		}
		_ = json.Unmarshal(params, &p)
		mins := p.Sec / 60
		return formatInt(mins) + " min"
	}
	return mode
}

func formatMeters(m int) string {
	if m >= 1000 && m%1000 == 0 {
		return formatInt(m/1000) + " k"
	}
	if m >= 1000 {
		// 21097 → "21,1 k"
		return formatFloatDE(float64(m)/1000.0, 1) + " k"
	}
	return formatInt(m) + " m"
}

func formatInt(n int) string {
	// Minimal stdlib stringification; chart never sees negatives.
	if n == 0 {
		return "0"
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}

func formatFloatDE(f float64, decimals int) string {
	whole := int(f)
	frac := f - float64(whole)
	mul := 1
	for i := 0; i < decimals; i++ {
		mul *= 10
	}
	fInt := int(frac*float64(mul) + 0.5)
	if fInt == mul {
		whole++
		fInt = 0
	}
	out := formatInt(whole) + ","
	fStr := formatInt(fInt)
	for len(fStr) < decimals {
		fStr = "0" + fStr
	}
	return out + fStr
}
```

(Note: the `import "encoding/json"` block at the top of `trends_series.go` needs to be merged with the new `"sort"` / `"time"` imports — combine into a single import block.)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && go test ./internal/api/ -run TestAssembleSeriesGroupsByModeAndHash -v && cd ..
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/trends_series.go backend/internal/api/trends_series_test.go
git commit -m "feat(trends): group completed sessions into shape-keyed series"
```

---

## Task 4: Backend — wire series into the handler

**Files:**
- Modify: `backend/internal/api/trends.go`

- [ ] **Step 1: Modify the main SQL query to join workout**

In `backend/internal/api/trends.go`, replace the existing `rows, err := db.QueryContext(...)` block (lines 117–123) with a join that also returns workout mode + params + shape_hash:

```go
		rows, err := db.QueryContext(r.Context(), `
			SELECT s.id, s.started_at, s.total_distance_m, s.total_time_sec,
			       s.avg_power_w, s.avg_pace_sec_per_500m, s.avg_dps, s.avg_spi, s.avg_spm,
			       w.mode, w.params_json, w.shape_hash
			FROM sessions s
			LEFT JOIN workout w ON w.id = s.workout_id
			WHERE s.rower_id = ? AND s.deleted_at IS NULL AND s.ended_at IS NOT NULL
			  AND s.started_at >= ?
			ORDER BY s.started_at ASC`, rid, lowerArg)
```

- [ ] **Step 2: Extend the row scan and collect completed sessions for series assembly**

In the `for rows.Next()` block (lines 145–228), update the scan to consume the new columns and accumulate a `[]sessionRow` slice of completed-in-chart-window rows:

Replace the variable declarations near the top of the loop (lines 146–153) with:

```go
			var (
				id                 string
				startedStr         string
				dist               sql.NullInt64
				timeSec            sql.NullFloat64
				avgPower, avgPace  sql.NullFloat64
				avgDPS, avgSPI     sql.NullFloat64
				avgSPM             sql.NullFloat64
				wMode              sql.NullString
				wParams            sql.NullString
				wShapeHash         sql.NullString
			)
			if err := rows.Scan(&id, &startedStr, &dist, &timeSec,
				&avgPower, &avgPace, &avgDPS, &avgSPI, &avgSPM,
				&wMode, &wParams, &wShapeHash); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
```

Then, before `for rows.Next()` (after line 144), declare the series-accumulator:

```go
			var seriesRows []sessionRow
```

Inside the loop, after the `inChart && distM > 0` block (right before the closing `}` of the for loop), add the completion check and accumulator append:

```go
			if inChart && wMode.Valid && wParams.Valid && wShapeHash.Valid {
				params := json.RawMessage(wParams.String)
				if isCompletedSession(wMode.String, params, distM, secs) {
					seriesRows = append(seriesRows, sessionRow{
						ID:        id,
						StartedAt: tBerlin,
						Mode:      wMode.String,
						Params:    params,
						ShapeHash: wShapeHash.String,
						DistM:     distM,
						TimeSec:   secs,
						AvgPower:  avgPower.Float64,
						AvgPace:   avgPace.Float64,
						AvgDPS:    avgDPS.Float64,
						AvgSPI:    avgSPI.Float64,
						AvgSPM:    avgSPM.Float64,
					})
				}
			}
```

- [ ] **Step 3: Assemble series, attach PBs, populate response**

Immediately after the `if err := rows.Err(); err != nil { ... }` block (around line 232), before the `mean := func(...)` declaration, add the series assembly + PB join:

```go
			series := assembleSeries(seriesRows)
			attachPBs(r.Context(), db, rid, series)

			// Both Leistung and Effizienz currently expose the same
			// underlying series. Future ADR-0015 follow-up may split
			// Effizienz off (it groups by SPM band, not shape) — but
			// that grouping happens client-side from the same points,
			// so the response shape stays symmetric.
			effSeries := series
```

Then in the `out := trendsResponse{...}` literal (line 241), add the two new fields:

```go
			out := trendsResponse{
				Range: rng,
				Period: trendsPeriod{
					Label: label,
					From:  periodFrom.UTC().Format(time.RFC3339),
					To:    periodTo.UTC().Format(time.RFC3339),
				},
				Totals: totals,
				Performance: performanceBlock{
					Points:            perfPtsOrEmpty(perfPts),
					AvgPowerW:         mean(perfPowerSum, perfPowerN),
					AvgPaceSecPer500m: mean(perfPaceSum, perfPaceN),
				},
				Efficiency: efficiencyBlock{
					Points:   effPtsOrEmpty(effPts),
					AvgDPS:   mean(effDPSSum, effDPSN),
					AvgSPI:   mean(effSPISum, effSPIN),
					DeltaDPS: mean(recentDPSSum, recentDPSN) - mean(prevDPSSum, prevDPSN),
					DeltaSPI: mean(recentSPISum, recentSPIN) - mean(prevSPISum, prevSPIN),
				},
				Series:           series,
				EfficiencySeries: effSeries,
			}
```

- [ ] **Step 4: Add `attachPBs` helper to `trends_series.go`**

Append to `backend/internal/api/trends_series.go`:

```go
import (
	"context"
	"database/sql"
)

// attachPBs populates trendsSeries.PBPaceSecPer500m for distance/race
// series by looking up the matching pb_distance row. Mutates series
// in place. Best-effort: a missing PB leaves the field at zero, which
// the client treats as "no PB to render."
func attachPBs(ctx context.Context, db *sql.DB, rowerID string, series []trendsSeries) {
	for i := range series {
		mode := series[i].Key.Mode
		if mode != "distance" && mode != "race" {
			continue
		}
		var p struct {
			Meters int `json:"meters"`
		}
		if err := json.Unmarshal(series[i].ParamsJSON, &p); err != nil || p.Meters <= 0 {
			continue
		}
		var timeSec sql.NullFloat64
		err := db.QueryRowContext(ctx, `
			SELECT time_sec FROM pb_distance
			WHERE rower_id = ? AND distance_m = ? AND invalidated_at IS NULL
			LIMIT 1`,
			rowerID, p.Meters).Scan(&timeSec)
		if err != nil || !timeSec.Valid || timeSec.Float64 <= 0 {
			continue
		}
		// pace per 500m = total_time / (meters / 500)
		series[i].PBPaceSecPer500m = timeSec.Float64 / (float64(p.Meters) / 500.0)
	}
}
```

(Merge the new `"context"` and `"database/sql"` imports into the existing import block at the top of the file.)

- [ ] **Step 5: Build to verify the file compiles**

```bash
cd backend && go build ./... && cd ..
```

Expected: clean build.

- [ ] **Step 6: Run the full backend test suite to catch any unexpected regressions**

```bash
cd backend && go test ./internal/api/... && cd ..
```

Expected: PASS. Existing `TrendsHandler` tests still pass because the legacy fields are untouched; new `series` and `efficiency_series` fields land but the existing tests don't assert against them.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/api/trends.go backend/internal/api/trends_series.go
git commit -m "feat(trends): emit series + PB per shape in API response"
```

---

## Task 5: Backend — integration test on a seeded DB

**Files:**
- Modify: `backend/internal/api/trends_test.go`

- [ ] **Step 1: Extend the seed helper to include workout joins**

Read the current `seedSessions` (lines 38–60) and `seedSession` struct (lines 16–27) in `backend/internal/api/trends_test.go`. Add an optional `workoutID`, `mode`, `params`, `shapeHash` to the seed struct and have the helper insert a matching `workout` row when those fields are set.

Replace the `seedSession` struct definition with:

```go
type seedSession struct {
	id        string
	startedAt time.Time
	endedAt   time.Time
	distM     int
	timeSec   float64
	avgPower  float64
	avgPace   float64
	avgDPS    float64
	avgSPI    float64
	avgSPM    float64
	deleted   bool
	// optional workout assignment for series tests
	workoutID  string
	mode       string
	params     string
	shapeHash  string
}
```

And replace the `seedSessions` helper body (lines 38–60) so that when `s.workoutID != ""` it inserts a `workout` row first and links the session via `workout_id`:

```go
func seedSessions(t *testing.T, db *storage.DB, rowerID string, ss []seedSession) {
	t.Helper()
	for _, s := range ss {
		if s.workoutID != "" {
			if _, err := db.Handle().Exec(`
				INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
				VALUES(?, ?, ?, 'moderat', 0, 0, ?, ?)`,
				s.workoutID, s.mode, s.params,
				s.startedAt.UTC().Format(time.RFC3339Nano),
				s.shapeHash,
			); err != nil {
				t.Fatalf("insert workout: %v", err)
			}
		}
		var deletedAt any
		if s.deleted {
			deletedAt = s.endedAt.UTC().Format(time.RFC3339Nano)
		}
		var workoutID any
		if s.workoutID != "" {
			workoutID = s.workoutID
		}
		if _, err := db.Handle().Exec(`
			INSERT INTO sessions(id, rower_id, started_at, ended_at, initial_level,
				total_distance_m, total_time_sec, total_strokes,
				avg_power_w, avg_pace_sec_per_500m, avg_dps, avg_spi, avg_spm,
				deleted_at, workout_id, status)
			VALUES(?, ?, ?, ?, 3, ?, ?, 100, ?, ?, ?, ?, ?, ?, ?, 'ended')`,
			s.id, rowerID,
			s.startedAt.UTC().Format(time.RFC3339Nano),
			s.endedAt.UTC().Format(time.RFC3339Nano),
			s.distM, s.timeSec,
			s.avgPower, s.avgPace, s.avgDPS, s.avgSPI, s.avgSPM,
			deletedAt, workoutID,
		); err != nil {
			t.Fatalf("insert session: %v", err)
		}
	}
}
```

- [ ] **Step 2: Write the failing integration test**

Append to `backend/internal/api/trends_test.go`:

```go
func TestTrendsHandlerReturnsSeriesByShape(t *testing.T) {
	db := storage.MustOpenForTest(t, filepath.Join(t.TempDir(), "test.db"))
	rid := "r1"
	seedRower(t, db, rid)

	now := time.Now().UTC()
	day := 24 * time.Hour
	seedSessions(t, db, rid, []seedSession{
		// 4 completed 5k pieces over the last 2 weeks
		{id: "s1", startedAt: now.Add(-15 * day), endedAt: now.Add(-15 * day).Add(20 * time.Minute), distM: 5004, timeSec: 1138, avgPower: 374, avgPace: 110, avgDPS: 9.69, avgSPI: 12, avgSPM: 28.0, workoutID: "w-5k-1", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K"},
		{id: "s2", startedAt: now.Add(-9 * day),  endedAt: now.Add(-9 * day).Add(19 * time.Minute), distM: 5005, timeSec: 1122, avgPower: 375, avgPace: 109, avgDPS: 9.62, avgSPI: 12, avgSPM: 28.4, workoutID: "w-5k-2", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K"},
		{id: "s3", startedAt: now.Add(-7 * day),  endedAt: now.Add(-7 * day).Add(18 * time.Minute), distM: 5029, timeSec: 1102, avgPower: 379, avgPace: 107, avgDPS: 9.53, avgSPI: 12, avgSPM: 28.9, workoutID: "w-5k-3", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K"},
		{id: "s4", startedAt: now.Add(-1 * day),  endedAt: now.Add(-1 * day).Add(18 * time.Minute), distM: 5008, timeSec: 1082, avgPower: 382, avgPace: 107, avgDPS: 9.59, avgSPI: 12, avgSPM: 28.7, workoutID: "w-5k-4", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K"},
		// 1 abandoned 500m (134m / 500m = 27%) — should NOT appear in any series
		{id: "s5", startedAt: now.Add(-2 * day), endedAt: now.Add(-2 * day).Add(40 * time.Second), distM: 134, timeSec: 36, avgPower: 182, avgPace: 143, avgDPS: 8.4, avgSPI: 7, avgSPM: 24, workoutID: "w-500", mode: "distance", params: `{"meters":500}`, shapeHash: "H_500"},
		// 1 completed race 2k
		{id: "s6", startedAt: now.Add(-5 * day), endedAt: now.Add(-5 * day).Add(7 * time.Minute), distM: 2010, timeSec: 420, avgPower: 410, avgPace: 105, avgDPS: 9.0, avgSPI: 13, avgSPM: 32.0, workoutID: "w-r2k", mode: "race", params: `{"meters":2000}`, shapeHash: "H_2K"},
	})

	// PB for 5k = s4 (18:02 = 1082 sec → pace 108.2)
	if _, err := db.Handle().Exec(`
		INSERT INTO pb_distance(rower_id, distance_m, time_sec, source_session_id, source_session_started_at, achieved_at, window_start_stroke, window_end_stroke)
		VALUES(?, 5000, 1082, 's4', ?, ?, 1, 480)`,
		rid, now.Add(-1*day).UTC().Format(time.RFC3339Nano), now.Add(-1*day).UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("seed pb: %v", err)
	}

	repo := rower.NewRepo(db.Handle())
	srv := httptest.NewServer(api.TrendsHandler(db.Handle(), repo))
	defer srv.Close()

	req := httptest.NewRequest("GET", "/api/v1/rowers/"+rid+"/trends?range=month", nil)
	rec := httptest.NewRecorder()
	api.TrendsHandler(db.Handle(), repo).ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}

	var got struct {
		Series           []map[string]any `json:"series"`
		EfficiencySeries []map[string]any `json:"efficiency_series"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}

	if len(got.Series) != 2 {
		t.Fatalf("got %d series, want 2 (distance 5k + race 2k); body=%s", len(got.Series), rec.Body.String())
	}
	// Most-rowed first.
	first := got.Series[0]
	if first["display_name"] != "5 k" {
		t.Fatalf("first series display_name = %v, want \"5 k\"", first["display_name"])
	}
	pts, ok := first["points"].([]any)
	if !ok || len(pts) != 4 {
		t.Fatalf("first series points = %v, want 4 points", first["points"])
	}
	pb, _ := first["pb_pace_sec_per_500m"].(float64)
	if pb < 108.0 || pb > 108.5 {
		t.Fatalf("first series PB pace = %v, want ~108.2 s/500m", pb)
	}

	// 134m piece must NOT have created a distance|H_500 series.
	for _, s := range got.Series {
		key, _ := s["key"].(map[string]any)
		if key != nil && key["shape_hash"] == "H_500" {
			t.Fatalf("abandoned 134m piece leaked into series: %v", s)
		}
	}
}
```

Add `"context"` to the existing imports if not already present.

- [ ] **Step 3: Run test to verify it fails (or already passes if Task 4 is complete)**

```bash
cd backend && go test ./internal/api/ -run TestTrendsHandlerReturnsSeriesByShape -v && cd ..
```

Expected: PASS (this test exercises the integration of Tasks 2–4). If it fails, that's a real bug to fix before moving on — investigate the actual failure.

- [ ] **Step 4: Run the full backend test suite**

```bash
cd backend && go test ./... && cd ..
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/trends_test.go
git commit -m "test(trends): integration test for series-by-shape grouping"
```

---

## Task 6: Frontend — extend TrendsResponse type

**Files:**
- Modify: `web/src/api/client.ts`

- [ ] **Step 1: Add the new types**

In `web/src/api/client.ts`, after the existing `TrendsResponse` declaration (lines 181–199), add:

```typescript
export type TrendsSeriesKey = {
  mode: string
  shape_hash: string
}

export type TrendsSeriesPoint = {
  t: string
  session_id: string
  total_distance_m: number
  total_time_sec: number
  avg_power_w: number
  avg_pace_sec_per_500m: number
  avg_dps: number
  avg_spi: number
  avg_spm: number
}

export type TrendsSeries = {
  key: TrendsSeriesKey
  params: unknown
  display_name: string
  pb_pace_sec_per_500m?: number
  points: TrendsSeriesPoint[]
}
```

Then modify the existing `TrendsResponse` type to add the two new fields:

```typescript
export type TrendsResponse = {
  range: TrendsRange
  period: { label: string; from: string; to: string }
  totals: TrendsTotals
  prior?: TrendsTotals
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
  series: TrendsSeries[]
  efficiency_series: TrendsSeries[]
  stats_version: number
}
```

- [ ] **Step 2: Verify frontend type-checks**

```bash
cd web && npm run typecheck && cd ..
```

Expected: PASS. The new fields are unused so far, which is fine.

- [ ] **Step 3: Commit**

```bash
git add web/src/api/client.ts
git commit -m "feat(trends): frontend types for series-aware API"
```

---

## Task 7: Frontend — apply ≥3-in-range threshold and render series

**Files:**
- Modify: `web/src/pages/history/TrendsTab.tsx`

- [ ] **Step 1: Replace the `TrendsContent` rendering with series-aware logic**

In `web/src/pages/history/TrendsTab.tsx`, replace the entire `TrendsContent` function (lines 96–165) with a version that:
1. Filters `data.series` to those with ≥ 3 points (the threshold).
2. Reuses `DualLineChart` to render the most-rowed qualifying series' pace line (and optionally a second series as the dashed secondary).
3. Falls back to the existing widen-range empty state when no series qualifies.

```tsx
const SERIES_THRESHOLD = 3

function TrendsContent({ data }: { data: TrendsResponse }) {
  const perfSeries = data.series.filter((s) => s.points.length >= SERIES_THRESHOLD)
  const effSeries = data.efficiency_series.filter((s) => s.points.length >= SERIES_THRESHOLD)

  return (
    <>
      <TrendsHeadlineCard data={data} />

      <section className={styles.card} aria-label="Leistung">
        <header className={styles.cardHead}>
          <span className={styles.cardTitle}>Leistung</span>
        </header>
        <LeistungChart series={perfSeries} />
      </section>

      <section className={styles.card} aria-label="Effizienz">
        <header className={styles.cardHead}>
          <span className={styles.cardTitle}>Effizienz</span>
        </header>
        <EffizienzChart series={effSeries} />
      </section>
    </>
  )
}

function LeistungChart({ series }: { series: TrendsSeries[] }) {
  if (series.length === 0) {
    return (
      <p className={styles.placeholder} data-testid="leistung-empty">
        Noch keine Serie mit genug Sessions im Zeitraum.
      </p>
    )
  }
  // Primary = most-rowed series (API already sorts by point count desc).
  const primary: Series = {
    label: `${series[0].display_name} · Ø Split`,
    variant: 'solid',
    tone: 'primary',
    fmt: (v) => pace500m(v) ?? '—',
    points: series[0].points.map((p) => ({ x: tToX(p.t), y: p.avg_pace_sec_per_500m })),
  }
  const secondary: Series | undefined =
    series.length >= 2
      ? {
          label: `${series[1].display_name} · Ø Split`,
          variant: 'dashed',
          tone: 'neutral',
          fmt: (v) => pace500m(v) ?? '—',
          points: series[1].points.map((p) => ({ x: tToX(p.t), y: p.avg_pace_sec_per_500m })),
        }
      : undefined
  return (
    <>
      <div className={styles.legend}>
        {series.slice(0, 2).map((s, i) => (
          <div key={s.key.mode + s.key.shape_hash} className={styles.legendRow}>
            <span
              className={i === 1 ? `${styles.dot} ${styles.dotNeutral}` : styles.dot}
            />{' '}
            {s.display_name}: {pace500m(s.points[s.points.length - 1].avg_pace_sec_per_500m) ?? '—'}
            {s.pb_pace_sec_per_500m ? (
              <>
                {' '}
                <small data-testid={`pb-${s.key.mode}-${s.key.shape_hash}`}>
                  PB {pace500m(s.pb_pace_sec_per_500m) ?? '—'}
                </small>
              </>
            ) : null}
          </div>
        ))}
      </div>
      <DualLineChart primary={primary} secondary={secondary} />
    </>
  )
}

function EffizienzChart({ series }: { series: TrendsSeries[] }) {
  if (series.length === 0) {
    return (
      <p className={styles.placeholder} data-testid="effizienz-empty">
        Noch keine Serie mit genug Sessions im Zeitraum.
      </p>
    )
  }
  // Use the most-rowed series; DPS solid, SPI dashed.
  const s0 = series[0]
  const dps: Series = {
    label: `${s0.display_name} · Ø DPS`,
    variant: 'solid',
    tone: 'primary',
    fmt: (v) => fmtFloat(v, 1),
    points: s0.points.map((p) => ({ x: tToX(p.t), y: p.avg_dps })),
  }
  const spi: Series = {
    label: `${s0.display_name} · Ø SPI`,
    variant: 'dashed',
    tone: 'neutral',
    fmt: (v) => fmtFloat(v, 1),
    points: s0.points.map((p) => ({ x: tToX(p.t), y: p.avg_spi })),
  }
  return (
    <>
      <div className={styles.legend}>
        <div className={styles.legendRow}>
          <span className={styles.dot} /> Ø DPS: {fmtFloat(s0.points[s0.points.length - 1].avg_dps, 1)}
        </div>
        <div className={styles.legendRow}>
          <span className={`${styles.dot} ${styles.dotNeutral}`} /> Ø SPI:{' '}
          {fmtFloat(s0.points[s0.points.length - 1].avg_spi, 1)}
        </div>
      </div>
      <DualLineChart primary={dps} secondary={spi} />
    </>
  )
}
```

Also update the imports at the top of `web/src/pages/history/TrendsTab.tsx` to add `TrendsSeries`:

```tsx
import { getRowerTrends, type TrendsRange, type TrendsResponse, type TrendsSeries } from '../../api/client'
```

And the `signedNum` import becomes unused — remove it from the import line.

- [ ] **Step 2: Verify the frontend type-checks**

```bash
cd web && npm run typecheck && cd ..
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/history/TrendsTab.tsx
git commit -m "feat(trends): render series-by-shape with ≥3 threshold (ADR-0015)"
```

---

## Task 8: Frontend — tests for series rendering + threshold

**Files:**
- Modify: `web/src/pages/history/TrendsTab.test.tsx`

- [ ] **Step 1: Read the existing test file to understand its fixtures**

```bash
cat web/src/pages/history/TrendsTab.test.tsx | head -60
```

This tells you the existing mock structure for `getRowerTrends`. The new tests must extend that mock to populate the new `series` and `efficiency_series` fields.

- [ ] **Step 2: Write a failing test for ≥3 threshold**

Append to `web/src/pages/history/TrendsTab.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { TrendsTab } from './TrendsTab'
import * as client from '../../api/client'

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/historie/trends?range=month']}>
        <Routes>
          <Route path="/historie/trends" element={<TrendsTab />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TrendsTab series threshold (ADR-0015)', () => {
  it('hides Leistung when no series has ≥3 completed sessions', async () => {
    vi.spyOn(client, 'getRowerTrends').mockResolvedValue({
      range: 'month',
      period: { label: 'Diesen Monat', from: '', to: '' },
      totals: { distance_m: 5000, active_sec: 1100, sessions: 2 },
      performance: { points: [], avg_power_w: 0, avg_pace_sec_per_500m: 0 },
      efficiency: { points: [], avg_dps: 0, avg_spi: 0, delta_dps: 0, delta_spi: 0 },
      series: [
        {
          key: { mode: 'distance', shape_hash: 'H' },
          params: { meters: 5000 },
          display_name: '5 k',
          points: [
            { t: '2026-05-09T08:35:00Z', session_id: 's1', total_distance_m: 5000, total_time_sec: 1100, avg_power_w: 374, avg_pace_sec_per_500m: 110, avg_dps: 9.6, avg_spi: 12, avg_spm: 28 },
            { t: '2026-05-15T09:00:00Z', session_id: 's2', total_distance_m: 5000, total_time_sec: 1080, avg_power_w: 380, avg_pace_sec_per_500m: 108, avg_dps: 9.7, avg_spi: 12, avg_spm: 28 },
          ], // 2 points — below threshold
        },
      ],
      efficiency_series: [],
      stats_version: 1,
    })
    renderTab()
    expect(await screen.findByTestId('leistung-empty')).toBeInTheDocument()
    expect(screen.getByTestId('effizienz-empty')).toBeInTheDocument()
  })

  it('renders Leistung when at least one series has ≥3 completed sessions', async () => {
    const pts = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        t: `2026-05-${String(9 + i).padStart(2, '0')}T08:35:00Z`,
        session_id: `s${i + 1}`,
        total_distance_m: 5000,
        total_time_sec: 1100 - i,
        avg_power_w: 374 + i,
        avg_pace_sec_per_500m: 110 - i,
        avg_dps: 9.6,
        avg_spi: 12,
        avg_spm: 28,
      }))
    vi.spyOn(client, 'getRowerTrends').mockResolvedValue({
      range: 'month',
      period: { label: 'Diesen Monat', from: '', to: '' },
      totals: { distance_m: 15000, active_sec: 3300, sessions: 3 },
      performance: { points: [], avg_power_w: 0, avg_pace_sec_per_500m: 0 },
      efficiency: { points: [], avg_dps: 0, avg_spi: 0, delta_dps: 0, delta_spi: 0 },
      series: [
        {
          key: { mode: 'distance', shape_hash: 'H' },
          params: { meters: 5000 },
          display_name: '5 k',
          pb_pace_sec_per_500m: 108.2,
          points: pts(4),
        },
      ],
      efficiency_series: [
        {
          key: { mode: 'distance', shape_hash: 'H' },
          params: { meters: 5000 },
          display_name: '5 k',
          points: pts(4),
        },
      ],
      stats_version: 1,
    })
    renderTab()
    expect(await screen.findByTestId('dlc-primary')).toBeInTheDocument()
    expect(screen.getByTestId('pb-distance-H')).toBeInTheDocument()
    expect(screen.queryByTestId('leistung-empty')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the new tests to verify they pass**

```bash
cd web && npm test -- TrendsTab.test.tsx --run && cd ..
```

Expected: PASS for both new cases. If existing tests in the file fail because they don't populate the new required fields, fix them by adding `series: []` and `efficiency_series: []` to their mock returns.

- [ ] **Step 4: Run the full frontend test suite to catch any other regressions**

```bash
cd web && npm test --run && cd ..
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/history/TrendsTab.test.tsx
git commit -m "test(trends): threshold + series rendering tests"
```

---

## Task 9: Smoke test against the real DB

**Files:** none modified.

- [ ] **Step 1: Start the backend pointing at the seeded DB**

In one terminal:

```bash
cd backend && go run ./cmd/server --db ../splits-raspi.db --port 8080
```

(Adjust flags to match the actual `cmd/server` flags — check `backend/cmd/server/main.go` for the correct flag names before running.)

- [ ] **Step 2: Hit the trends endpoint for Daniel**

In another terminal:

```bash
curl -s "http://localhost:8080/api/v1/rowers/fbab95cb-ca02-432c-b570-ad263c6d678b/trends?range=month" | jq '.series[] | {display_name, point_count: (.points | length), pb_pace_sec_per_500m}'
```

Expected output (approximate — depends on which sessions in the seeded DB carry a workout_id):

```json
{
  "display_name": "5 k",
  "point_count": 4,
  "pb_pace_sec_per_500m": 108.2
}
```

Possibly also a `Race 500 m` series with `point_count: 1` (won't render in the frontend due to threshold, but shows up in the API response).

If point_count is wrong, the most likely cause is sessions in the DB missing a `workout_id` — run:

```bash
sqlite3 splits-raspi.db "SELECT s.id, s.total_distance_m, s.workout_id, w.mode FROM sessions s LEFT JOIN workout w ON w.id = s.workout_id WHERE s.deleted_at IS NULL ORDER BY s.started_at"
```

…to confirm join coverage.

- [ ] **Step 3: Start the dev server and visually verify the Trends tab**

```bash
cd web && npm run dev
```

Open the app, log in as Daniel, navigate to Historie → Trends, select Monat. Expect:
- The Leistung card renders a primary line (the 5 k series, 4 dots).
- The legend row reads `5 k: 1:47 · PB 1:48` (or similar) — PB is the small-cap text.
- The Effizienz card renders the DPS + SPI lines for the 5 k series.
- If you set range to Woche and Daniel has < 3 completed sessions in the current week, the `leistung-empty` placeholder shows.

- [ ] **Step 4: Document any deviations**

If the actual output differs materially from expected (e.g. PB pace looks wrong, point counts off), file an issue with the curl output before claiming the plan complete. Don't paper over data discrepancies.

---

## Self-review

After implementing the plan:

1. **Spec coverage:** Each ADR-0015 §Decision requirement maps to a task:
   - Series keyed on `(mode, shape_hash)`: Task 3 (`assembleSeries`).
   - Completion filter ≥80%: Task 2 (`isCompletedSession`).
   - ≥3-in-range threshold: Task 7 (`SERIES_THRESHOLD`).
   - Intervals + just_row excluded: Task 2 (returns false), Task 3 (defensive skip).
   - PB reference per series (data only — visual line is ADR-0016 scope): Task 4 (`attachPBs`).
2. **Placeholder scan:** None — every step contains the actual code or command.
3. **Type consistency:** `trendsSeries.Key.Mode` and `Key.ShapeHash` are referenced consistently across Tasks 1, 3, 4. Frontend `TrendsSeries.key.shape_hash` mirrors the JSON tags from Task 1.

**Explicitly out of scope (ADR-0016 follow-up plan):**
- Scrubber + persistent values strip
- Sparse axes + gridlines + rolling-average overlay
- Per-dot SPM-band coloring on Effizienz
- PB dashed horizontal lines (the *data* lands in this plan; the *visual* lands later)
- Tap-dot-opens-Session-Detail navigation
- Color palette (currently inherits `primary`/`neutral` from existing chart styles)

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-trends-group-by-workout-intent.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
