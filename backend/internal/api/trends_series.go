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
