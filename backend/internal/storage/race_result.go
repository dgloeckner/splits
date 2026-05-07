package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// synthGhost mirrors race.SynthGhost. Inlined to avoid an import
// cycle (race -> workout, and workout's white-box tests import
// storage). Sample step: 5 s. Targets seconds-per-500m by intensity.
func synthGhost(meters int, intensity string) ([]float64, []float64) {
	const sampleStepSec = 5.0
	split := 120.0
	switch intensity {
	case "locker":
		split = 135
	case "hart":
		split = 110
	case "allout":
		split = 102
	}
	velocity := 500.0 / split
	totalSec := float64(meters) / velocity
	n := int(totalSec/sampleStepSec) + 1
	tSec := make([]float64, 0, n+1)
	splits := make([]float64, 0, n+1)
	for i := 0; i < n; i++ {
		tSec = append(tSec, float64(i)*sampleStepSec)
		splits = append(splits, split)
	}
	if len(tSec) > 0 && tSec[len(tSec)-1] < totalSec {
		tSec = append(tSec, totalSec)
		splits = append(splits, split)
	}
	return tSec, splits
}

// raceModeValue mirrors workout.ModeRace. Inlined to avoid an import
// cycle with internal/workout (whose tests depend on storage).
const raceModeValue = "race"

// standardRaceDistances mirrors workout.StandardRaceDistances; inlined
// for the same reason as raceModeValue.
var standardRaceDistances = []int{500, 1000, 2000, 5000, 6000, 10000, 21097, 42195}

func isStandardRaceDistance(m int) bool {
	for _, s := range standardRaceDistances {
		if s == m {
			return true
		}
	}
	return false
}

type raceParamsLocal struct {
	Meters int `json:"meters"`
}

// ComputeRaceResult returns the race outcome for the given session.
// Returns nil for non-race workouts or when neither opponent has a
// usable sample series. Reads `workout`, `sessions`, `pb_workout`,
// `pb_distance` directly.
func ComputeRaceResult(ctx context.Context, db *sql.DB, workoutID, rowerID string,
	userDistanceM int, userTimeSec float64) (*event.RaceResult, error) {
	if workoutID == "" {
		return nil, nil
	}
	var mode, params, shape, intensity string
	var sh, ints sql.NullString
	err := db.QueryRowContext(ctx,
		`SELECT mode, params_json, COALESCE(shape_hash,''), COALESCE(intensity,'') FROM workout WHERE id = ?`,
		workoutID).Scan(&mode, &params, &sh, &ints)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	shape, intensity = sh.String, ints.String
	if mode != raceModeValue {
		return nil, nil
	}
	var rp raceParamsLocal
	if err := json.Unmarshal([]byte(params), &rp); err != nil {
		return nil, err
	}
	// FEAT-0013: aborts before workout distance goal write no race result.
	if userDistanceM < rp.Meters {
		return nil, nil
	}

	res := &event.RaceResult{}

	ghostID, gT, gS, kind, err := loadGhostForResult(ctx, db, rowerID, shape, rp.Meters, intensity)
	if err != nil {
		return nil, err
	}
	if len(gT) > 0 {
		gap := gapAtDistance(gT, gS, float64(userDistanceM), userTimeSec)
		res.VsGhostSec = &gap
		res.GhostKind = kind
		if ghostID != "" {
			res.OpponentIDs = append(res.OpponentIDs, ghostID)
		}
	}

	pbID, pT, pS, err := loadPBForResult(ctx, db, rowerID, shape, rp.Meters)
	if err != nil {
		return nil, err
	}
	if len(pT) > 0 {
		gap := gapAtDistance(pT, pS, float64(userDistanceM), userTimeSec)
		res.VsPbSec = &gap
		if pbID != "" {
			res.OpponentIDs = append(res.OpponentIDs, pbID)
		}
	}

	if res.VsPbSec == nil && res.VsGhostSec == nil {
		return nil, nil
	}
	return res, nil
}

func loadGhostForResult(ctx context.Context, db *sql.DB, rowerID, shape string, meters int, intensity string) (string, []float64, []float64, string, error) {
	if shape != "" {
		var sid, summary string
		err := db.QueryRowContext(ctx, `
            SELECT s.id, s.summary_json
            FROM sessions s JOIN workout w ON w.id = s.workout_id
            WHERE s.rower_id = ? AND w.shape_hash = ? AND s.ended_at IS NOT NULL AND s.deleted_at IS NULL
            ORDER BY s.started_at DESC LIMIT 1`, rowerID, shape).Scan(&sid, &summary)
		if err == nil {
			t, sp, ok := samplesFromSummaryJSON(summary)
			if ok {
				return sid, t, sp, "session", nil
			}
		} else if !errors.Is(err, sql.ErrNoRows) {
			return "", nil, nil, "", err
		}
	}
	t, sp := synthGhost(meters, intensity)
	return "", t, sp, "synth", nil
}

func loadPBForResult(ctx context.Context, db *sql.DB, rowerID, shape string, meters int) (string, []float64, []float64, error) {
	var bestID, bestSummary string
	bestTime := -1.0
	if shape != "" {
		var sid, summary string
		var t float64
		err := db.QueryRowContext(ctx, `
            SELECT s.id, s.summary_json, pw.value
            FROM pb_workout pw JOIN sessions s ON s.id = pw.source_session_id
            WHERE pw.rower_id = ? AND pw.shape_hash = ? AND pw.value_kind='time_sec'
              AND pw.invalidated_at IS NULL AND s.deleted_at IS NULL
            LIMIT 1`, rowerID, shape).Scan(&sid, &summary, &t)
		if err == nil {
			bestID, bestSummary, bestTime = sid, summary, t
		} else if !errors.Is(err, sql.ErrNoRows) {
			return "", nil, nil, err
		}
	}
	if isStandardRaceDistance(meters) {
		var sid, summary string
		var t float64
		err := db.QueryRowContext(ctx, `
            SELECT s.id, s.summary_json, pd.time_sec
            FROM pb_distance pd JOIN sessions s ON s.id = pd.source_session_id
            WHERE pd.rower_id = ? AND pd.distance_m = ? AND pd.invalidated_at IS NULL
              AND s.deleted_at IS NULL
            LIMIT 1`, rowerID, meters).Scan(&sid, &summary, &t)
		if err == nil && (bestTime < 0 || t < bestTime) {
			bestID, bestSummary = sid, summary
		} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", nil, nil, err
		}
	}
	if bestID == "" {
		return "", nil, nil, nil
	}
	t, sp, ok := samplesFromSummaryJSON(bestSummary)
	if !ok {
		return "", nil, nil, nil
	}
	return bestID, t, sp, nil
}

// gapAtDistance returns userTime - oppTimeAtDistance via cumulative
// pace integration + linear inverse interpolation. Clamps below to
// tSec[0] and above to tSec[last].
func gapAtDistance(tSec, split []float64, userDistance, userTime float64) float64 {
	if len(tSec) < 2 {
		return userTime
	}
	dist := make([]float64, len(tSec))
	for i := 1; i < len(tSec); i++ {
		dt := tSec[i] - tSec[i-1]
		v := 0.0
		if split[i] > 0 {
			v = 500.0 / split[i]
		}
		dist[i] = dist[i-1] + v*dt
	}
	if userDistance <= 0 {
		return userTime - tSec[0]
	}
	if userDistance >= dist[len(dist)-1] {
		return userTime - tSec[len(tSec)-1]
	}
	lo, hi := 0, len(dist)-1
	for hi-lo > 1 {
		mid := (lo + hi) / 2
		if dist[mid] <= userDistance {
			lo = mid
		} else {
			hi = mid
		}
	}
	span := dist[hi] - dist[lo]
	var oppTime float64
	if span <= 0 {
		oppTime = tSec[lo]
	} else {
		f := (userDistance - dist[lo]) / span
		oppTime = tSec[lo] + f*(tSec[hi]-tSec[lo])
	}
	return userTime - oppTime
}

type raceSamplesPayload struct {
	Samples struct {
		TSec  []float64 `json:"t_sec"`
		Split []float64 `json:"split"`
	} `json:"samples"`
}

func samplesFromSummaryJSON(summary string) ([]float64, []float64, bool) {
	var sp raceSamplesPayload
	if err := json.Unmarshal([]byte(summary), &sp); err != nil {
		return nil, nil, false
	}
	if len(sp.Samples.TSec) == 0 {
		return nil, nil, false
	}
	return sp.Samples.TSec, sp.Samples.Split, true
}
