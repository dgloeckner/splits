package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strconv"
	"time"
)

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

// sessionRow is the row shape consumed by assembleSeries — one
// completed session joined with its workout. ShapeHash is the
// workout.shape_hash and is used as the series key: same params →
// same hash → same series bucket. Mode is workout.mode.
type sessionRow struct {
	ID        string
	StartedAt time.Time
	Mode      string
	Params    json.RawMessage
	ShapeHash string // series key — workout.shape_hash (params-only, mode/warmup-agnostic)
	DistM     int
	TimeSec   float64
	AvgPower  float64
	AvgPace   float64
	AvgDPS    float64
	AvgSPI    float64
	AvgSPM    float64
}

// assembleSeries groups completed sessions by shape_hash into series
// suitable for the multi-series chart. Same params → same hash → same
// series bucket (race-2k and distance-2k collapse). Caller is responsible
// for filtering rows via isCompletedSession before passing them in. Series
// are returned sorted descending by point count (most-rowed first), points
// within each series ascending by time. Sessions whose mode is "intervals"
// or "just_row" are silently dropped (defensive — caller should have filtered).
func assembleSeries(rows []sessionRow) []trendsSeries {
	type bucket struct {
		key    trendsSeriesKey
		mode   string
		params json.RawMessage
		points []trendsSeriesPoint
	}
	buckets := make(map[string]*bucket)
	for _, r := range rows {
		if r.Mode == "intervals" || r.Mode == "just_row" {
			continue
		}
		k := r.ShapeHash
		b, ok := buckets[k]
		if !ok {
			b = &bucket{
				key:    trendsSeriesKey{ShapeHash: r.ShapeHash},
				mode:   r.Mode,
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
			DisplayName: displayNameForShape(b.mode, b.params),
			Points:      b.points,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if len(out[i].Points) != len(out[j].Points) {
			return len(out[i].Points) > len(out[j].Points)
		}
		return out[i].Key.ShapeHash < out[j].Key.ShapeHash
	})
	return out
}

// displayNameForShape returns a human-readable label like "5 k", "Race 2 k",
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
		return strconv.Itoa(mins) + " min"
	}
	return mode
}

// formatMeters formats a meter count as the chart label. 5000 → "5 k",
// 21097 → "21,1 k" (German decimal comma), 500 → "500 m".
func formatMeters(m int) string {
	if m >= 1000 && m%1000 == 0 {
		return strconv.Itoa(m/1000) + " k"
	}
	if m >= 1000 {
		// One decimal place, German comma separator.
		whole := m / 1000
		// Round to one decimal: tenths = round((m - whole*1000) / 100)
		tenths := ((m - whole*1000) + 50) / 100
		if tenths == 10 {
			whole++
			tenths = 0
		}
		return strconv.Itoa(whole) + "," + strconv.Itoa(tenths) + " k"
	}
	return strconv.Itoa(m) + " m"
}

// attachPBs populates trendsSeries.PBPaceSecPer500m for distance/race
// series by looking up the matching pb_distance row. Mutates series
// in place. Best-effort: a missing PB leaves the field at zero, which
// the client treats as "no PB to render."
func attachPBs(ctx context.Context, db *sql.DB, rowerID string, series []trendsSeries) {
	for i := range series {
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
