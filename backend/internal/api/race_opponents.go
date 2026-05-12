package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/gloeckner-daniel/splits/internal/race"
	"github.com/gloeckner-daniel/splits/internal/workout"
)

// WorkoutOpponent is the wire shape for one opponent (ghost or PB).
// `kind` distinguishes synthesised ghosts from real session-derived
// opponents. `source_session_id` is omitted for synth ghosts.
//
// Transport (0014-01): the client receives parallel `t_sec` and
// `distance_m` arrays. The legacy `split` field is removed; clients
// look up opponent distance directly via binary search rather than
// integrating split→distance every frame.
type WorkoutOpponent struct {
	Kind            string    `json:"kind"`
	SourceSessionID string    `json:"source_session_id,omitempty"`
	Label           string    `json:"label"`
	TSec            []float64 `json:"t_sec"`
	DistanceM       []float64 `json:"distance_m"`
}

type WorkoutOpponentsResponse struct {
	Ghost *WorkoutOpponent `json:"ghost"`
	PB    *WorkoutOpponent `json:"pb"`
}

// WorkoutOpponentsHandler serves GET /api/v1/workouts/{id}/opponents.
// Race-mode workouts only.
func WorkoutOpponentsHandler(db *sql.DB) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		workoutID := r.PathValue("id")
		rowerID := r.URL.Query().Get("rower_id")
		if workoutID == "" || rowerID == "" {
			http.Error(w, "workout id and rower_id required", http.StatusBadRequest)
			return
		}
		mode, params, shape, intensity, err := loadOpponentWorkout(r.Context(), db, workoutID)
		if errors.Is(err, sql.ErrNoRows) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if mode != string(workout.ModeRace) {
			http.Error(w, "workout is not race mode", http.StatusBadRequest)
			return
		}

		resp := WorkoutOpponentsResponse{}

		ghost, err := loadOpponentGhost(r.Context(), db, rowerID, shape)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if ghost == nil {
			var rp workout.RaceParams
			if jerr := json.Unmarshal([]byte(params), &rp); jerr != nil {
				http.Error(w, jerr.Error(), http.StatusInternalServerError)
				return
			}
			tSec, split := race.SynthGhost(rp.Meters, workout.Intensity(intensity))
			ghost = &WorkoutOpponent{
				Kind:      "synth",
				Label:     "ghost",
				TSec:      tSec,
				DistanceM: integrateDistance(tSec, split),
			}
		}
		resp.Ghost = ghost

		pb, err := loadOpponentPB(r.Context(), db, rowerID, shape, params)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		resp.PB = pb

		if resp.Ghost != nil && resp.PB != nil &&
			resp.Ghost.SourceSessionID != "" &&
			resp.Ghost.SourceSessionID == resp.PB.SourceSessionID {
			resp.Ghost = nil
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	})
}

func loadOpponentWorkout(ctx context.Context, db *sql.DB, workoutID string) (mode, params, shape, intensity string, err error) {
	var sh, ints sql.NullString
	err = db.QueryRowContext(ctx,
		`SELECT mode, params_json, COALESCE(shape_hash,''), COALESCE(intensity,'') FROM workout WHERE id = ?`,
		workoutID).Scan(&mode, &params, &sh, &ints)
	if err != nil {
		return "", "", "", "", err
	}
	return mode, params, sh.String, ints.String, nil
}

const opponentGhostQuery = `
SELECT s.id, s.summary_json
FROM sessions s
JOIN workout w ON w.id = s.workout_id
WHERE s.rower_id = ?
  AND w.shape_hash = ?
  AND s.ended_at IS NOT NULL
  AND s.deleted_at IS NULL
ORDER BY s.started_at DESC
LIMIT 1`

func loadOpponentGhost(ctx context.Context, db *sql.DB, rowerID, shape string) (*WorkoutOpponent, error) {
	if shape == "" {
		return nil, nil
	}
	var sid, summary string
	err := db.QueryRowContext(ctx, opponentGhostQuery, rowerID, shape).Scan(&sid, &summary)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	tSec, split, ok := opponentSamplesFromSummary(summary)
	if !ok {
		return nil, nil
	}
	tSec = rebaseToZero(tSec)
	return &WorkoutOpponent{
		Kind: "session", SourceSessionID: sid, Label: "ghost",
		TSec: tSec, DistanceM: integrateDistance(tSec, split),
	}, nil
}

const opponentPBWorkoutQuery = `
SELECT s.id, s.summary_json, pw.value
FROM pb_workout pw
JOIN sessions s ON s.id = pw.source_session_id
WHERE pw.rower_id = ?
  AND pw.shape_hash = ?
  AND pw.value_kind = 'time_sec'
  AND pw.invalidated_at IS NULL
  AND s.deleted_at IS NULL
LIMIT 1`

const opponentPBDistanceQuery = `
SELECT s.id, s.summary_json, pd.time_sec
FROM pb_distance pd
JOIN sessions s ON s.id = pd.source_session_id
WHERE pd.rower_id = ?
  AND pd.distance_m = ?
  AND pd.invalidated_at IS NULL
  AND s.deleted_at IS NULL
LIMIT 1`

func loadOpponentPB(ctx context.Context, db *sql.DB, rowerID, shape, paramsJSON string) (*WorkoutOpponent, error) {
	var rp workout.RaceParams
	if err := json.Unmarshal([]byte(paramsJSON), &rp); err != nil {
		return nil, fmt.Errorf("decode race params: %w", err)
	}
	var bestID, bestSummary string
	bestTime := -1.0
	if shape != "" {
		var sid, summary string
		var t float64
		err := db.QueryRowContext(ctx, opponentPBWorkoutQuery, rowerID, shape).Scan(&sid, &summary, &t)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if err == nil {
			bestID, bestSummary, bestTime = sid, summary, t
		}
	}
	if workout.IsStandardRaceDistance(rp.Meters) {
		var sid, summary string
		var t float64
		err := db.QueryRowContext(ctx, opponentPBDistanceQuery, rowerID, rp.Meters).Scan(&sid, &summary, &t)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if err == nil && (bestTime < 0 || t < bestTime) {
			bestID, bestSummary = sid, summary
		}
	}
	if bestID == "" {
		return nil, nil
	}
	tSec, split, ok := opponentSamplesFromSummary(bestSummary)
	if !ok {
		return nil, nil
	}
	tSec = rebaseToZero(tSec)
	return &WorkoutOpponent{
		Kind: "session", SourceSessionID: bestID, Label: "pb",
		TSec: tSec, DistanceM: integrateDistance(tSec, split),
	}, nil
}

// rebaseToZero returns a copy of tSec with the first sample subtracted
// from every entry. Today, summary `t_sec[]` arrays are emitted starting
// at 0, so this is a no-op; the explicit rebase guarantees the
// `t_sec[0]==0` invariant in the wire response regardless of source.
// Issue 0014-02 will trim leading warmup-covering samples before this
// rebase runs.
func rebaseToZero(tSec []float64) []float64 {
	if len(tSec) == 0 || tSec[0] == 0 {
		return tSec
	}
	out := make([]float64, len(tSec))
	base := tSec[0]
	for i, v := range tSec {
		out[i] = v - base
	}
	return out
}

// integrateDistance turns parallel (t_sec, split) samples into a
// parallel distance_m series. Velocity at step i is `500 / split[i]`
// m/s; non-positive split contributes zero progress for that step.
// The first sample is always 0 — `t_sec[0]` is treated as the
// opponent's work-segment start. Output length matches input length.
func integrateDistance(tSec, split []float64) []float64 {
	n := len(tSec)
	if n == 0 {
		return nil
	}
	out := make([]float64, n)
	out[0] = 0
	for i := 1; i < n; i++ {
		dt := tSec[i] - tSec[i-1]
		v := 0.0
		if i < len(split) && split[i] > 0 {
			v = 500.0 / split[i]
		}
		out[i] = out[i-1] + v*dt
	}
	return out
}

type opponentSamplesPayload struct {
	Samples struct {
		TSec  []float64 `json:"t_sec"`
		Split []float64 `json:"split"`
	} `json:"samples"`
}

func opponentSamplesFromSummary(summary string) ([]float64, []float64, bool) {
	var sp opponentSamplesPayload
	if err := json.Unmarshal([]byte(summary), &sp); err != nil {
		return nil, nil, false
	}
	if len(sp.Samples.TSec) == 0 {
		return nil, nil, false
	}
	return sp.Samples.TSec, sp.Samples.Split, true
}
