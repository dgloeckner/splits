// Package session owns the sessionizer stage: idle-boundary FSM,
// Tier-2 metric enrichment, and lifetime-monotonic id-stamping.
// See specs/arch/0001-backend-pipeline.md.
package session

import "math"

// DPS (distance-per-stroke) in metres between two consecutive stroke
// events. Returns the delta; callers handle the first-stroke case
// with DPSFirst.
func DPS(prevDistanceM, curDistanceM int, _ int) float64 {
	d := curDistanceM - prevDistanceM
	if d < 0 {
		return 0
	}
	return float64(d)
}

// DPSFirst is the sentinel value for the first stroke of a session.
// FEAT-0007 specifies 0 until a delta is available.
func DPSFirst() float64 { return 0 }

// StrokeCycleSec is the time between the previous and current stroke.
// Negative / zero gaps round to 0.
func StrokeCycleSec(prevTimeSec, curTimeSec float64) float64 {
	d := curTimeSec - prevTimeSec
	if d <= 0 {
		return 0
	}
	return d
}

// PaceSecPer500m extrapolates the current stroke's pace over a 500 m
// reference. Returns 0 when either input is zero (FEAT-0007 renders
// an em-dash at that state).
func PaceSecPer500m(dps float64, cycleSec float64) int {
	if dps <= 0 || cycleSec <= 0 {
		return 0
	}
	return int(500.0 / dps * cycleSec)
}

// EnergyJoules for one stroke — power_W * cycle_sec, rounded to int.
func EnergyJoules(powerW int, cycleSec float64) int {
	if cycleSec <= 0 {
		return 0
	}
	return int(math.Round(float64(powerW) * cycleSec))
}
